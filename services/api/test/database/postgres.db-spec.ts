/**
 * M1-S3 acceptance — migration workflow and role separation against **real
 * PostgreSQL** (§36.1 T-2: no mock, no in-memory substitute, no skipped run).
 *
 * §40.4's key acceptance for this slice is "`migrate deploy` works from empty;
 * role separation verified". This suite is that verification, in three blocks:
 *
 *  1. Workflow  — `scripts/db.mjs test-setup` drops and recreates the fixed test
 *     database, provisions roles, and runs `prisma migrate deploy` from empty.
 *     The assertions below inspect what that run left behind.
 *  2. Roles     — the two roles exist with the §13.4 attributes, each connection
 *     authenticates as its declared role, the application cannot execute DDL, and
 *     a table the migrator owns is writable by the application without anyone
 *     having granted on it by hand (the default-privileges path).
 *  3. Readiness — `/readyz` reports the database check when it should, with a
 *     reason safe for an unauthenticated caller (§13.1), and `/healthz` stays
 *     green through the same outage (§37.4).
 *
 * Environment: `DATABASE_URL` and `MIGRATION_DATABASE_URL` must name the fixed
 * test database `my_shop_test`; `ADMIN_DATABASE_URL` must name a different one.
 * Missing or misdirected variables **fail the suite with the variable named** —
 * §36.1 T-5 forbids a silently skipped acceptance test — and the guard is what
 * makes the destructive recreate safe: a development or production `DATABASE_URL`
 * is refused before anything is dropped.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { loadConfig } from '../../src/common/config/app.config';
import { PrismaService } from '../../src/common/database/prisma.service';
import { ERROR_CODES } from '../../src/common/errors/problem';
import { MutationContradictionError, MutationRejectedError } from '../../src/common/sync/ledger/mutation-ledger.errors';
import { payloadHashOf } from '../../src/common/sync/ledger/payload-hash';
import {
  type ApplyMutationRequest,
  type MutationAppliedOutcome,
  type MutationEffectResult,
  MutationLedgerService,
} from '../../src/common/sync/ledger/mutation-ledger.service';
import { createTestHarness, destroyTestHarness, type TestHarness } from '../harness';

/** The one database this suite may destroy; `scripts/db.mjs` enforces the same name. */
const TEST_DATABASE = 'my_shop_test';

const API_ROOT = path.resolve(__dirname, '..', '..');

interface DatabaseUrls {
  readonly application: string;
  readonly migration: string;
  readonly admin: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `${name} is not set. The database acceptance suite refuses to run without it ` +
        `(Master Plan section 36.1 T-5: no silent skips). See .env.example.`,
    );
  }
  return value;
}

/**
 * Fails before anything is destroyed unless every URL names the database the
 * suite is allowed to touch. Values are never echoed; the message names the
 * variable and the expectation (§13.6).
 */
function requireTestUrls(): DatabaseUrls {
  const urls: DatabaseUrls = {
    application: required('DATABASE_URL'),
    migration: required('MIGRATION_DATABASE_URL'),
    admin: required('ADMIN_DATABASE_URL'),
  };

  const applicationPath = new URL(urls.application).pathname;
  const migrationPath = new URL(urls.migration).pathname;
  const adminPath = new URL(urls.admin).pathname;

  if (applicationPath !== `/${TEST_DATABASE}` || migrationPath !== `/${TEST_DATABASE}`) {
    throw new Error(
      `DATABASE_URL and MIGRATION_DATABASE_URL must both name ${TEST_DATABASE}; ` +
        `one of them points elsewhere, so no database will be touched.`,
    );
  }
  if (adminPath === `/${TEST_DATABASE}`) {
    throw new Error(`ADMIN_DATABASE_URL must not name ${TEST_DATABASE} — it drops it.`);
  }

  return urls;
}

/**
 * Runs `scripts/db.mjs <command>` in a child process, which is the same entry
 * point an operator uses (`npm run db:migrate`), so the suite exercises the
 * supported workflow rather than a test-only shortcut.
 */
function dbScript(command: string): void {
  const result = spawnSync(process.execPath, [path.join(API_ROOT, 'scripts', 'db.mjs'), command], {
    cwd: API_ROOT,
    encoding: 'utf8',
    env: process.env,
    // Captured rather than inherited: on success the output is Prisma's banner
    // noise, and on failure it is appended to the thrown error where it is
    // actually useful.
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    throw new Error(`scripts/db.mjs ${command} exited with ${result.status}\n${result.stdout}\n${result.stderr}`);
  }
}

interface RoleRow {
  rolname: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolreplication: boolean;
  rolcanlogin: boolean;
}

interface NameRow {
  tablename: string;
}

interface OwnerRow {
  relname: string;
  owner: string;
}

interface MigrationRow {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

interface RoleNameRow {
  role_name: string;
}

interface IdRow {
  id: number;
}

describe('database acceptance (real PostgreSQL)', () => {
  let urls: DatabaseUrls;
  let admin: PrismaClient;
  let migrator: PrismaClient;
  let app: PrismaClient;
  let setupRan = false;

  beforeAll(async () => {
    urls = requireTestUrls();

    // Drop + create from empty, provision roles, `prisma migrate deploy`.
    dbScript('test-setup');
    setupRan = true;

    // One client per role, each built from the URL that declares that role —
    // exactly the credentials the application and the migration job use.
    admin = new PrismaClient({ datasourceUrl: urls.admin });
    migrator = new PrismaClient({ datasourceUrl: urls.migration });
    app = new PrismaClient({ datasourceUrl: urls.application });
    await Promise.all([admin.$connect(), migrator.$connect(), app.$connect()]);
  }, 120_000);

  afterAll(async () => {
    await Promise.all([admin?.$disconnect(), migrator?.$disconnect(), app?.$disconnect()]);
    if (setupRan) {
      dbScript('test-drop');
    }
  }, 120_000);

  describe('migration workflow from an empty database', () => {
    it('applies every migration and records exactly one applied row each', async () => {
      const rows = await migrator.$queryRaw<MigrationRow[]>`
        SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations
        ORDER BY migration_name
      `;

      // M1b-S4 adds the sync ledger migrations to M1-S3's skeleton; every applied
      // migration must be finished and never rolled back (migration history is
      // append-only, Master Plan §44.1).
      expect(rows.map((row) => row.migration_name)).toEqual(['0001_schema_skeleton', '0002_mutation_ledger']);
      for (const row of rows) {
        expect(row.finished_at).not.toBeNull();
        expect(row.rolled_back_at).toBeNull();
      }
    });

    it('creates exactly the sync-ledger tables and no domain tables yet', async () => {
      // §39.5: a table exists only for a capability whose slice authorized it.
      // M1b-S4 authorizes the four tables of the sync ledger (§38.9, §38.11,
      // §40.5): the idempotency table, the change feed, the per-device cursors,
      // and the per-organization sequence counter. No business table exists yet —
      // the first is a business slice's to authorize.
      const rows = await migrator.$queryRaw<NameRow[]>`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
        ORDER BY tablename
      `;

      expect(rows.map((row) => row.tablename)).toEqual([
        'change_log',
        'device_sync_cursors',
        'mutation_ledger',
        'sync_sequences',
      ]);
    });

    it('is idempotent: a second deploy applies nothing and succeeds', async () => {
      dbScript('deploy');

      const rows = await migrator.$queryRaw<MigrationRow[]>`SELECT migration_name FROM _prisma_migrations`;
      expect(rows).toHaveLength(2);
    });
  });

  describe('role separation (section 13.4)', () => {
    it('provisions exactly the two roles with the attributes the plan requires', async () => {
      const rows = await admin.$queryRaw<RoleRow[]>`
        SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication, rolcanlogin
        FROM pg_roles
        WHERE rolname IN ('my_shop_migrator', 'my_shop_app')
        ORDER BY rolname
      `;

      expect(rows.map((row) => row.rolname)).toEqual(['my_shop_app', 'my_shop_migrator']);
      for (const row of rows) {
        expect(row).toMatchObject({
          rolsuper: false,
          rolbypassrls: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolreplication: false,
          rolcanlogin: true,
        });
      }
    });

    it('authenticates each connection as the role its URL declares', async () => {
      const asApp = await app.$queryRaw<RoleNameRow[]>`SELECT current_user AS role_name`;
      const asMigrator = await migrator.$queryRaw<RoleNameRow[]>`SELECT current_user AS role_name`;

      expect(asApp).toEqual([{ role_name: 'my_shop_app' }]);
      expect(asMigrator).toEqual([{ role_name: 'my_shop_migrator' }]);
    });

    it('refuses DDL on the application role', async () => {
      // The whole point of the split: the credential the running process holds
      // cannot alter schema, so no bug in the application can.
      await expect(app.$executeRaw`CREATE TABLE separation_probe (id integer)`).rejects.toThrow();

      const rows = await migrator.$queryRaw<
        NameRow[]
      >`SELECT tablename FROM pg_tables WHERE tablename = 'separation_probe'`;
      expect(rows).toEqual([]);
    });

    it('lets the migrator own a table the application can use without a hand-written grant', async () => {
      await migrator.$executeRaw`CREATE TABLE separation_probe (id serial PRIMARY KEY)`;

      const owners = await migrator.$queryRaw<OwnerRow[]>`
        SELECT c.relname, r.rolname AS owner
        FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
        WHERE c.relname = 'separation_probe'
      `;
      expect(owners).toEqual([{ relname: 'separation_probe', owner: 'my_shop_migrator' }]);

      // `serial` also creates a sequence, so this single insert proves both halves
      // of the default-privilege grants (tables and sequences) that roles.sql
      // set up before the table ever existed.
      await expect(app.$executeRaw`INSERT INTO separation_probe DEFAULT VALUES`).resolves.toBe(1);
      await expect(app.$queryRaw<IdRow[]>`SELECT id FROM separation_probe`).resolves.toEqual([{ id: 1 }]);

      // DML is all the application role has: the same table, and ALTER is refused.
      await expect(app.$executeRaw`ALTER TABLE separation_probe ADD COLUMN note text`).rejects.toThrow();

      await migrator.$executeRaw`DROP TABLE separation_probe`;
    });
  });

  describe('readiness (section 37.4)', () => {
    let harness: TestHarness | undefined;

    afterEach(async () => {
      // Each case boots its own application — one with a reachable database, one
      // without — and closes it before the next, so no second Prisma connection
      // pool outlives the case that needed it.
      if (harness !== undefined) {
        await destroyTestHarness(harness);
        harness = undefined;
      }
    });

    it('reports ready with a passing database check, connected as the application role', async () => {
      // The config is loaded through the same validation the process uses, and
      // the harness boots the same application the process boots.
      const config = loadConfig({
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        LOG_PRETTY: 'false',
        DATABASE_URL: urls.application,
      });
      harness = await createTestHarness(config);

      const response = await harness.http.get('/readyz').expect(200);
      expect(response.body).toEqual({ ready: true, checks: { database: { ok: true } } });

      // §13.4's runtime half: the process connects as the application role, so it
      // is never the owner of a table it writes to.
      const client = harness.app.get(PrismaService).prisma;
      const identity = await client.$queryRaw<RoleNameRow[]>`SELECT current_user AS role_name`;
      expect(identity).toEqual([{ role_name: 'my_shop_app' }]);
    });

    it('reports not ready with a safe reason when the database is unreachable', async () => {
      // Port 1 on loopback is refused by the OS immediately; no dependency on a
      // real server being configured to fail.
      const config = loadConfig({
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        LOG_PRETTY: 'false',
        DATABASE_URL: 'postgresql://my_shop_app@127.0.0.1:1/my_shop_test',
      });
      harness = await createTestHarness(config);

      const response = await harness.http.get('/readyz').expect(503);

      expect(response.body['ready']).toBe(false);
      expect(response.body['checks']['database']).toEqual({ ok: false, reason: 'unavailable' });

      // §13.1: an unauthenticated caller must not learn the dependency's
      // identity, host, or driver.
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain('my_shop_app');
      expect(serialized).not.toContain('127.0.0.1');
      expect(serialized).not.toContain('postgres');

      // §37.4: liveness must not follow readiness into the outage — restarting
      // the process during a migration window would not help it.
      await harness.http.get('/healthz').expect(200);
    });
  });

  describe('mutation ledger (M1b-S4)', () => {
    let service: MutationLedgerService;
    const probeEffects = { n: 0 };

    // A migrator-owned table the ledger's caller-effects write to through the
    // application role. It exists only while this suite runs, so its
    // acceptance is proof of the §38.9.3 atomicity claim: "10 replays produce
    // one effect" counts probe rows, not in-memory flags.
    beforeAll(async () => {
      await migrator.$executeRaw`
        CREATE TABLE acceptance_probe (
          id bigserial PRIMARY KEY,
          org_tag uuid NOT NULL,
          effect_note text NOT NULL
        )
      `;
      probeEffects.n = 0;
      service = new MutationLedgerService({ prisma: app });
    }, 30_000);

    afterAll(async () => {
      await migrator.$executeRaw`DROP TABLE acceptance_probe`;
    });

    /** A business effect for the probe table; `counter` counts invocations. */
    function probeEffect(counter: { n: number }, org: string, note: string): ApplyMutationRequest['apply'] {
      return async (tx: Prisma.TransactionClient): Promise<MutationEffectResult> => {
        counter.n += 1;
        await tx.$executeRaw`INSERT INTO acceptance_probe (org_tag, effect_note) VALUES (${org}::uuid, ${note})`;
        return {
          entityType: 'PROBE',
          entityId: `probe:${note}`,
          resultRef: `probes/${note}`,
          resultHash: 'f'.repeat(64),
        };
      };
    }

    function mutationRequest(
      org: string,
      mutationId: string,
      deviceId: string,
      note: string,
      apply: ApplyMutationRequest['apply'],
    ): ApplyMutationRequest {
      return { organizationId: org, mutationId, deviceId, payload: { probe: { note } }, apply };
    }

    /** Counts effect rows for one organization (int8 narrowed to int, so jest sees numbers). */
    async function probeRowCount(org: string): Promise<number> {
      const rows = await app.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM acceptance_probe WHERE org_tag = ${org}::uuid
      `;
      return rows[0]?.n ?? 0;
    }

    it('accepts once and answers nine replays from the store with exactly one effect (§38.9.2)', async () => {
      const org = randomUUID();
      const mutationId = randomUUID();
      const deviceId = randomUUID();
      const counter = { n: 0 };
      const request = mutationRequest(
        org,
        mutationId,
        deviceId,
        'ten-replays',
        probeEffect(counter, org, 'ten-replays'),
      );

      const first = await service.applyMutation(request);
      expect(first).toMatchObject({ status: 'APPLIED', isReplay: false, serverSequence: BigInt(1) });

      for (let i = 0; i < 9; i += 1) {
        const replay = await service.applyMutation(request);
        expect(replay).toMatchObject({
          status: 'APPLIED',
          isReplay: true,
          serverSequence: BigInt(1),
          resultRef: 'probes/ten-replays',
        });
        expect(replay).toMatchObject({ receivedAt: (first as MutationAppliedOutcome).receivedAt });
      }

      // The whole acceptance: one effect — one probe row — ten answers.
      expect(counter.n).toBe(1);
      expect(await probeRowCount(org)).toBe(1);

      // §38.11.1: one change-log row at server_sequence 1, with the entity stamp.
      const feed = await app.$queryRaw<{ server_sequence: string; entity_type: string }[]>`
        SELECT server_sequence::text AS server_sequence, entity_type
        FROM change_log WHERE organization_id = ${org}::uuid
      `;
      expect(feed).toEqual([{ server_sequence: '1', entity_type: 'PROBE' }]);

      // §40.5: one cursor, exactly at the sequence that was applied.
      const cursors = await app.$queryRaw<{ device_id: string; seq: string }[]>`
        SELECT device_id, last_pushed_server_sequence::text AS seq
        FROM device_sync_cursors WHERE organization_id = ${org}::uuid
      `;
      expect(cursors).toEqual([{ device_id: deviceId, seq: '1' }]);
    });

    it('a second payload under the same mutation_id is a 409 contradiction, never an effect (§38.9.2, F-14)', async () => {
      const org = randomUUID();
      const mutationId = randomUUID();
      const deviceId = randomUUID();
      const counter = { n: 0 };

      const first = await service.applyMutation(
        mutationRequest(org, mutationId, deviceId, 'version-a', probeEffect(counter, org, 'version-a')),
      );
      expect(first).toMatchObject({ status: 'APPLIED' });

      await expect(
        service.applyMutation(
          mutationRequest(org, mutationId, deviceId, 'version-b', probeEffect(counter, org, 'version-b')),
        ),
      ).rejects.toBeInstanceOf(MutationContradictionError);

      expect(counter.n).toBe(1);
      expect(await probeRowCount(org)).toBe(1);

      const [row] = await app.$queryRaw<{ status: string; payload_hash: string }[]>`
        SELECT status, payload_hash FROM mutation_ledger
        WHERE organization_id = ${org}::uuid AND mutation_id = ${mutationId}::uuid
      `;
      expect(row).toMatchObject({ status: 'APPLIED' });
      expect(row?.payload_hash).toBe(payloadHashOf({ probe: { note: 'version-a' } }));
    });

    it('records a business rejection with no sequence, feed, or cursor, and replays it (§38.13)', async () => {
      const org = randomUUID();
      const mutationId = randomUUID();
      const deviceId = randomUUID();
      const counter = { n: 0 };

      const rejectingApply: ApplyMutationRequest['apply'] = (): never => {
        counter.n += 1;
        throw new MutationRejectedError(ERROR_CODES.INSUFFICIENT_STOCK);
      };
      const request = mutationRequest(org, mutationId, deviceId, 'reject-me', rejectingApply);

      const outcome = await service.applyMutation(request);
      expect(outcome).toMatchObject({
        status: 'REJECTED',
        isReplay: false,
        rejectionCode: ERROR_CODES.INSUFFICIENT_STOCK,
      });

      const [ledger] = await app.$queryRaw<{ status: string; rejection_code: string | null }[]>`
        SELECT status, rejection_code FROM mutation_ledger
        WHERE organization_id = ${org}::uuid AND mutation_id = ${mutationId}::uuid
      `;
      expect(ledger).toEqual({ status: 'REJECTED', rejection_code: ERROR_CODES.INSUFFICIENT_STOCK });

      // A rejected mutation consumes no sequence, writes no change-log row, and
      // leaves no cursor behind.
      expect(
        await app.$queryRaw<
          { last_sequence: string }[]
        >`SELECT last_sequence::text AS last_sequence FROM sync_sequences WHERE organization_id = ${org}::uuid`,
      ).toEqual([]);
      expect(
        await app.$queryRaw<
          { entity_type: string }[]
        >`SELECT entity_type FROM change_log WHERE organization_id = ${org}::uuid`,
      ).toEqual([]);
      expect(
        await app.$queryRaw<
          { device_id: string }[]
        >`SELECT device_id FROM device_sync_cursors WHERE organization_id = ${org}::uuid`,
      ).toEqual([]);

      // A resend must not re-run the rejecting effect: the stored rejection IS
      // the answer (§38.13 "never silently dropped, never accidentally revived").
      const replay = await service.applyMutation(request);
      expect(replay).toMatchObject({
        status: 'REJECTED',
        isReplay: true,
        rejectionCode: ERROR_CODES.INSUFFICIENT_STOCK,
      });
      expect(counter.n).toBe(1);
    });

    it('a failed effect rolls the probe insert, the feed, and the cursor all back (§38.9.3)', async () => {
      const org = randomUUID();
      const mutationId = randomUUID();
      const deviceId = randomUUID();
      const counter = { n: 0 };

      const failingApply: ApplyMutationRequest['apply'] = async (tx: Prisma.TransactionClient) => {
        counter.n += 1;
        await tx.$executeRaw`INSERT INTO acceptance_probe (org_tag, effect_note) VALUES (${org}::uuid, 'boom')`;
        throw new Error('effect exploded');
      };

      await expect(
        service.applyMutation(mutationRequest(org, mutationId, deviceId, 'boom', failingApply)),
      ).rejects.toThrow('effect exploded');

      expect(counter.n).toBe(1);
      expect(await probeRowCount(org)).toBe(0);
      expect(
        await app.$queryRaw<
          { status: string }[]
        >`SELECT status FROM mutation_ledger WHERE organization_id = ${org}::uuid`,
      ).toEqual([]);
      expect(
        await app.$queryRaw<
          { last_sequence: string }[]
        >`SELECT last_sequence::text AS last_sequence FROM sync_sequences WHERE organization_id = ${org}::uuid`,
      ).toEqual([]);
    });

    it('serializes racing same-mutation requests into exactly one effect (T-O5)', async () => {
      const org = randomUUID();
      const mutationId = randomUUID();
      const counter = { n: 0 };

      const racing = Array.from({ length: 10 }, () =>
        service.applyMutation(
          mutationRequest(org, mutationId, randomUUID(), 'race', probeEffect(counter, org, 'race')),
        ),
      );
      const outcomes = await Promise.all(racing);

      expect(outcomes.filter((outcome) => outcome.status === 'APPLIED')).toHaveLength(10);
      expect(outcomes.filter((outcome) => outcome.isReplay)).toHaveLength(9);
      expect(counter.n).toBe(1);
      expect(await probeRowCount(org)).toBe(1);
    });

    it('allocates sequences per organization and never moves a cursor backwards (§38.11.1, §40.5)', async () => {
      const orgA = randomUUID();
      const orgB = randomUUID();

      const deviceA1 = randomUUID();
      const deviceA2 = randomUUID();
      const counterA = { n: 0 };

      // Org A: two mutations through two devices land at sequences 1 and 2.
      const first = await service.applyMutation(
        mutationRequest(orgA, randomUUID(), deviceA1, 'a-first', probeEffect(counterA, orgA, 'a-first')),
      );
      const second = await service.applyMutation(
        mutationRequest(orgA, randomUUID(), deviceA2, 'a-second', probeEffect(counterA, orgA, 'a-second')),
      );
      expect(first).toMatchObject({ serverSequence: BigInt(1) });
      expect(second).toMatchObject({ serverSequence: BigInt(2) });

      // A replay of the first mutation through the second device must not drag
      // that device's cursor from 2 back to 1: GREATEST is a database property.
      const replay = await service.applyMutation(
        mutationRequest(
          orgA,
          (first as MutationAppliedOutcome).mutationId,
          deviceA2,
          'a-first',
          probeEffect(counterA, orgA, 'a-first'),
        ),
      );
      expect(replay).toMatchObject({ isReplay: true, serverSequence: BigInt(1) });

      const cursorA2 = await app.$queryRaw<{ seq: string }[]>`
        SELECT last_pushed_server_sequence::text AS seq FROM device_sync_cursors
        WHERE organization_id = ${orgA}::uuid AND device_id = ${deviceA2}::uuid
      `;
      expect(cursorA2).toEqual([{ seq: '2' }]);

      const counterB = { n: 0 };
      const orgBBegin = await service.applyMutation(
        mutationRequest(orgB, randomUUID(), randomUUID(), 'b-first', probeEffect(counterB, orgB, 'b-first')),
      );
      expect(orgBBegin).toMatchObject({ serverSequence: BigInt(1) });
    });
  });
});
