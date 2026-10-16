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
import { createRequire } from 'node:module';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
import { MIN_SUPPORTED_LOCAL_SCHEMA_VERSION } from '../../src/common/sync/push/push.contract';
import { SYNC_MUTATION_APPLIER } from '../../src/common/sync/push/sync-mutation-applier';
import { SYNC_AUTHENTICATOR, type SyncTrustedContext } from '../../src/common/sync/push/sync-auth';
import { SYNC_AUTHENTICATOR as PULL_SYNC_AUTHENTICATOR } from '../../src/common/sync/pull/sync-auth';
import { MAX_PULL_PAGE_SIZE } from '../../src/common/sync/pull/pull.contract';
import {
  EXIT_CONFLICT,
  EXIT_RUNTIME,
  EXIT_SUCCESS,
  EXIT_USAGE,
  runBootstrapCli,
  type BootstrapCliIo,
  type BootstrapConnectorFactory,
} from '../../src/common/bootstrap/bootstrap-cli';
import { BootstrapConflictError } from '../../src/common/bootstrap/organization-bootstrap.errors';
import {
  OrganizationBootstrapService,
  type BootstrapRequest,
  type BootstrapResult,
} from '../../src/common/bootstrap/organization-bootstrap.service';
import { createOverriddenTestHarness, createTestHarness, destroyTestHarness, type TestHarness } from '../harness';
import { FixedSyncAuthenticator } from '../sync/test-sync-authenticator';
import { ScriptedMutationApplier, probeDirective } from '../sync/scripted-mutation-applier';

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

/** Extra arguments and environment overrides for `dbScript`. */
interface DbScriptOptions {
  /** Forwarded to the command, e.g. `--schema <path>` to aim at a scratch migration history. */
  readonly args?: readonly string[];
  /** Merged over the ambient environment, e.g. a scratch database's URLs. */
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * Runs `scripts/db.mjs <command>` in a child process, which is the same entry
 * point an operator uses (`npm run db:migrate`), so the suite exercises the
 * supported workflow rather than a test-only shortcut.
 *
 * `options` lets the M2-S1 upgrade case point the *same* operator entry point at
 * a scratch database and a reduced migration history: the workflow under test
 * stays the production one, only its target changes.
 */
function dbScript(command: string, options: DbScriptOptions = {}): void {
  const argv = [path.join(API_ROOT, 'scripts', 'db.mjs'), command, ...(options.args ?? [])];
  const result = spawnSync(process.execPath, argv, {
    cwd: API_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
    // Captured rather than inherited: on success the output is Prisma's banner
    // noise, and on failure it is appended to the thrown error where it is
    // actually useful.
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    throw new Error(`scripts/db.mjs ${command} exited with ${result.status}\n${result.stdout}\n${result.stderr}`);
  }
}

/** The Prisma CLI entry point, resolved exactly as `scripts/db.mjs` resolves it. */
function prismaCliEntry(): string {
  const requireFromApi = createRequire(path.join(API_ROOT, 'package.json'));
  return requireFromApi.resolve('prisma/build/index.js');
}

interface PrismaCliResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs the Prisma CLI directly — never through `db.mjs`, which only wraps
 * `migrate deploy|dev|status`. Used by AC-18's in-suite drift gate, which needs
 * `migrate diff`. The connection URL is passed as a process argument to a child
 * that is never echoed, and it carries no password (§13.6).
 */
function prismaCli(args: readonly string[], env: Readonly<Record<string, string>>): PrismaCliResult {
  const result = spawnSync(process.execPath, [prismaCliEntry(), ...args], {
    cwd: API_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error !== undefined && result.error !== null) {
    throw result.error;
  }

  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
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

      // M1b-S4 adds the sync ledger migrations to M1-S3's skeleton; M2-S1 adds
      // `0003_organizations`, and its hardening adds `0004_bootstrap_key_shape`;
      // every applied migration must be finished and never rolled back
      // (migration history is append-only, Master Plan §44.1).
      expect(rows.map((row) => row.migration_name)).toEqual([
        '0001_schema_skeleton',
        '0002_mutation_ledger',
        '0003_organizations',
        '0004_bootstrap_key_shape',
      ]);
      for (const row of rows) {
        expect(row.finished_at).not.toBeNull();
        expect(row.rolled_back_at).toBeNull();
      }
    });

    it('creates exactly the authorized tables and no others', async () => {
      // §39.5: a table exists only for a capability whose slice authorized it.
      // M1b-S4 authorizes the four tables of the sync ledger (§38.9, §38.11,
      // §40.5): the idempotency table, the change feed, the per-device cursors,
      // and the per-organization sequence counter. M2-S1 authorizes the first
      // domain tables (§40.6, §8.4): `organizations` (tenant root), `users`
      // (credential-free identity), and `organization_memberships`. Nothing else
      // — M2-S2's credential columns, M2-S3's roles, and M2-S4's RLS all have
      // their own slices and their own migrations.
      const rows = await migrator.$queryRaw<NameRow[]>`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
        ORDER BY tablename
      `;

      expect(rows.map((row) => row.tablename)).toEqual([
        'change_log',
        'device_sync_cursors',
        'mutation_ledger',
        'organization_memberships',
        'organizations',
        'sync_sequences',
        'users',
      ]);
    });

    it('is idempotent: a second deploy applies nothing and succeeds', async () => {
      dbScript('deploy');

      const rows = await migrator.$queryRaw<MigrationRow[]>`SELECT migration_name FROM _prisma_migrations`;
      expect(rows).toHaveLength(4);
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

  /**
   * M1b-S5 acceptance — the push endpoint against **real PostgreSQL** (§36.1 T-2).
   *
   * §40.5's M1b-S5 key acceptance is the push boundary end to end: an authenticated
   * batch takes routing, the global pipe and filter, `SyncPushService`, the S4 ledger,
   * Prisma, and a real transaction, and answers one durable outcome per mutation.
   * §36.1 T-2 forbids a mock or an in-memory substitute for exactly these assertions,
   * so the only substitution is the two ports production binds fail-closed: the
   * authenticator (§38.16) and the mutation applier (§38.27). Both overrides live in
   * `test/`, so the production graph still refuses everything.
   *
   * One fixed organization and device are used throughout; each case isolates itself
   * with a unique mutation note, so the probe-row count for that note is the effect
   * count the case is about.
   */
  describe('push endpoint (M1b-S5)', () => {
    const PUSH_ORG = randomUUID();
    const PUSH_DEVICE = randomUUID();
    const PUSH_CONTEXT: SyncTrustedContext = { organizationId: PUSH_ORG, deviceId: PUSH_DEVICE };
    const PUSH_PATH = '/api/v1/sync/push';
    let harness: TestHarness;

    beforeAll(async () => {
      // A migrator-owned table the scripted effects write to through the application
      // role; the default-privilege grants make it usable without a hand-written GRANT.
      await migrator.$executeRaw`
        CREATE TABLE push_acceptance_probe (
          id bigserial PRIMARY KEY,
          org_tag uuid NOT NULL,
          effect_note text NOT NULL
        )
      `;

      const config = loadConfig({
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        LOG_PRETTY: 'false',
        DATABASE_URL: urls.application,
      });

      const applier = new ScriptedMutationApplier(async (mutation, context, tx) => {
        const directive = probeDirective(mutation);
        const note = directive.note ?? mutation.mutationId;
        if (directive.outcome === 'reject') {
          // §38.13: a permanent business refusal is recorded, not thrown past the ledger.
          throw new MutationRejectedError(ERROR_CODES.INSUFFICIENT_STOCK);
        }
        if (directive.outcome === 'explode') {
          // §38.10.4: an unexpected fault must roll the whole transaction back and
          // propagate as 5xx so the client retries the batch.
          throw new Error('push acceptance scripted explosion');
        }
        await tx.$executeRaw`
          INSERT INTO push_acceptance_probe (org_tag, effect_note)
          VALUES (${context.organizationId}::uuid, ${note})
        `;
        return {
          entityType: 'PUSH_PROBE',
          entityId: `push:${note}`,
          resultRef: `push/${note}`,
          resultHash: 'e'.repeat(64),
        };
      });

      harness = await createOverriddenTestHarness(config, (builder) => {
        builder.overrideProvider(SYNC_AUTHENTICATOR).useValue(new FixedSyncAuthenticator(PUSH_CONTEXT));
        builder.overrideProvider(SYNC_MUTATION_APPLIER).useValue(applier);
      });
    }, 60_000);

    afterAll(async () => {
      if (harness !== undefined) {
        await destroyTestHarness(harness);
      }
      await migrator.$executeRaw`DROP TABLE push_acceptance_probe`;
    }, 60_000);

    /** One §38.8.1 mutation whose effect the scripted applier reads from `payload.probe`. */
    function pushMutation(
      sequence: number,
      note: string,
      outcome: 'apply' | 'reject' | 'explode' = 'apply',
    ): Record<string, unknown> {
      const mutationId = randomUUID();
      return {
        mutationId,
        organizationId: PUSH_ORG,
        deviceId: PUSH_DEVICE,
        actorUserId: randomUUID(),
        actorRoleSnapshot: { permissions: ['sales.create'] },
        aggregateType: 'PUSH_PROBE',
        aggregateId: randomUUID(),
        operationType: 'CREATE',
        payload: { probe: { note, outcome } },
        payloadVersion: 1,
        deviceLocalSequence: sequence,
        localCreatedAt: '2026-01-01T00:00:00.000Z',
        deviceIdempotencyKey: mutationId,
      };
    }

    function pushEnvelope(mutations: readonly Record<string, unknown>[]): Record<string, unknown> {
      return {
        deviceId: PUSH_DEVICE,
        syncBatchId: randomUUID(),
        localSchemaVersion: MIN_SUPPORTED_LOCAL_SCHEMA_VERSION,
        mutations: [...mutations],
      };
    }

    async function probeCount(note: string): Promise<number> {
      const rows = await app.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM push_acceptance_probe
        WHERE org_tag = ${PUSH_ORG}::uuid AND effect_note = ${note}
      `;
      return rows[0]?.n ?? 0;
    }

    async function ledgerRow(
      mutationId: string,
    ): Promise<{ status: string; rejection_code: string | null } | undefined> {
      const [row] = await app.$queryRaw<{ status: string; rejection_code: string | null }[]>`
        SELECT status, rejection_code FROM mutation_ledger
        WHERE organization_id = ${PUSH_ORG}::uuid AND mutation_id = ${mutationId}::uuid
      `;
      return row;
    }

    it('answers APPLIED over HTTP and commits one effect, feed row, and cursor (§38.9)', async () => {
      const note = `applied-${randomUUID()}`;
      const mutation = pushMutation(1, note);

      const response = await harness.http
        .post(PUSH_PATH)
        .send(pushEnvelope([mutation]))
        .expect(200);
      expect(response.body).toMatchObject({
        outcomes: [{ mutationId: mutation['mutationId'], status: 'APPLIED' }],
      });

      const outcome = (response.body['outcomes'] as { serverSequence: string }[])[0];
      expect(outcome?.serverSequence).toMatch(/^\d+$/);
      expect(await probeCount(note)).toBe(1);
      expect(await ledgerRow(mutation['mutationId'] as string)).toMatchObject({ status: 'APPLIED' });

      // §38.11.1: the change feed carries the effect at the returned server sequence.
      const feed = await app.$queryRaw<{ entity_type: string }[]>`
        SELECT entity_type FROM change_log
        WHERE organization_id = ${PUSH_ORG}::uuid AND server_sequence = ${BigInt(outcome?.serverSequence ?? '0')}
      `;
      expect(feed).toEqual([{ entity_type: 'PUSH_PROBE' }]);

      // §40.5: the device cursor records the accepted sequence, never behind it.
      const cursor = await app.$queryRaw<{ seq: string }[]>`
        SELECT last_pushed_server_sequence::text AS seq FROM device_sync_cursors
        WHERE organization_id = ${PUSH_ORG}::uuid AND device_id = ${PUSH_DEVICE}::uuid
      `;
      expect(Number(cursor[0]?.seq)).toBeGreaterThanOrEqual(Number(outcome?.serverSequence));
    });

    it('T-O3: ten identical pushes produce one effect and nine REPLAY answers (§38.9.2)', async () => {
      const note = `replay-${randomUUID()}`;
      const batch = pushEnvelope([pushMutation(1, note)]);

      const statuses: string[] = [];
      for (let i = 0; i < 10; i += 1) {
        const response = await harness.http.post(PUSH_PATH).send(batch).expect(200);
        statuses.push((response.body['outcomes'] as { status: string }[])[0]?.status ?? '');
      }

      expect(statuses[0]).toBe('APPLIED');
      expect(statuses.slice(1)).toEqual(Array(9).fill('REPLAY'));
      expect(await probeCount(note)).toBe(1);
    });

    it('T-O4: an applied mutation whose response was lost is answered REPLAY on retry, with one effect', async () => {
      const note = `lost-response-${randomUUID()}`;
      const batch = pushEnvelope([pushMutation(1, note)]);

      // First delivery applies; the client never sees this 200.
      const first = await harness.http.post(PUSH_PATH).send(batch).expect(200);
      expect((first.body['outcomes'] as { status: string }[])[0]?.status).toBe('APPLIED');

      // The client retries the identical batch and must be reconciled, not duplicated.
      const retry = await harness.http.post(PUSH_PATH).send(batch).expect(200);
      expect((retry.body['outcomes'] as { status: string }[])[0]?.status).toBe('REPLAY');
      expect(await probeCount(note)).toBe(1);
    });

    it('T-O5: two concurrent duplicate pushes of one mutation produce one effect (§38.9.3)', async () => {
      const note = `race-${randomUUID()}`;
      const batch = pushEnvelope([pushMutation(1, note)]);

      const [a, b] = await Promise.all([
        harness.http.post(PUSH_PATH).send(batch).expect(200),
        harness.http.post(PUSH_PATH).send(batch).expect(200),
      ]);
      const statuses = [
        (a.body['outcomes'] as { status: string }[])[0]?.status,
        (b.body['outcomes'] as { status: string }[])[0]?.status,
      ];

      expect(statuses.filter((status) => status === 'APPLIED')).toHaveLength(1);
      expect(statuses.filter((status) => status === 'REPLAY')).toHaveLength(1);
      expect(await probeCount(note)).toBe(1);
    });

    it('T-O20: a permanent rejection is recorded, never run twice, and replays as REJECTED (§38.13)', async () => {
      const note = `reject-${randomUUID()}`;
      const mutation = pushMutation(1, note, 'reject');
      const batch = pushEnvelope([mutation]);

      const first = await harness.http.post(PUSH_PATH).send(batch).expect(200);
      expect((first.body['outcomes'] as unknown[])[0]).toMatchObject({
        status: 'REJECTED',
        rejectionCode: ERROR_CODES.INSUFFICIENT_STOCK,
      });
      expect(await probeCount(note)).toBe(0);
      expect(await ledgerRow(mutation['mutationId'] as string)).toEqual({
        status: 'REJECTED',
        rejection_code: ERROR_CODES.INSUFFICIENT_STOCK,
      });

      const replay = await harness.http.post(PUSH_PATH).send(batch).expect(200);
      expect((replay.body['outcomes'] as unknown[])[0]).toMatchObject({
        status: 'REJECTED',
        rejectionCode: ERROR_CODES.INSUFFICIENT_STOCK,
      });
      expect(await probeCount(note)).toBe(0);
    });

    it('§38.10.3: a rejected mutation does not block the sale behind it in the same batch', async () => {
      const rejectNote = `partial-reject-${randomUUID()}`;
      const applyNote = `partial-apply-${randomUUID()}`;

      const response = await harness.http
        .post(PUSH_PATH)
        .send(pushEnvelope([pushMutation(1, rejectNote, 'reject'), pushMutation(2, applyNote)]))
        .expect(200);

      expect((response.body['outcomes'] as { status: string }[]).map((outcome) => outcome.status)).toEqual([
        'REJECTED',
        'APPLIED',
      ]);
      expect(await probeCount(rejectNote)).toBe(0);
      expect(await probeCount(applyNote)).toBe(1);
    });

    it('§38.9.2: a reused mutation_id with a different payload is CONTRADICTION, with no second effect', async () => {
      const note = `contradiction-${randomUUID()}`;
      const mutation = pushMutation(1, note);

      await harness.http
        .post(PUSH_PATH)
        .send(pushEnvelope([mutation]))
        .expect(200);

      const changed = {
        ...mutation,
        payload: { probe: { note: `${note}-changed`, outcome: 'apply' } },
      };
      const response = await harness.http
        .post(PUSH_PATH)
        .send(pushEnvelope([changed]))
        .expect(200);

      expect((response.body['outcomes'] as unknown[])[0]).toMatchObject({
        status: 'CONTRADICTION',
        rejectionCode: ERROR_CODES.MUTATION_CONTRADICTION,
      });
      expect(await probeCount(note)).toBe(1);
      expect(await probeCount(`${note}-changed`)).toBe(0);
    });

    it('§38.10.4: an unexpected effect fault is a rolled-back 5xx for the whole batch, safely retryable', async () => {
      const note = `explode-${randomUUID()}`;
      const mutation = pushMutation(1, note, 'explode');

      const response = await harness.http
        .post(PUSH_PATH)
        .send(pushEnvelope([mutation]))
        .expect(500);
      expect(response.body).toMatchObject({ code: 'INTERNAL_ERROR' });

      expect(await probeCount(note)).toBe(0);
      expect(await ledgerRow(mutation['mutationId'] as string)).toBeUndefined();
    });

    it('§38.7.2: an outdated client is refused the whole batch CLIENT_TOO_OLD, applying nothing', async () => {
      const note = `too-old-${randomUUID()}`;
      const mutation = pushMutation(1, note);

      const response = await harness.http
        .post(PUSH_PATH)
        .send({ ...pushEnvelope([mutation]), localSchemaVersion: 0 })
        .expect(426);

      expect(response.body).toMatchObject({ code: 'CLIENT_TOO_OLD' });
      expect(await probeCount(note)).toBe(0);
      expect(await ledgerRow(mutation['mutationId'] as string)).toBeUndefined();
    });
  });

  /**
   * M1b-S6 acceptance — the pull endpoint against **real PostgreSQL** (§36.1 T-2).
   *
   * §40.5's M1b-S6 key acceptance is the change feed end to end: an authenticated
   * read takes routing, the global pipe and filter, `SyncPullService`, the S4
   * ledger, Prisma, and real SQL, and answers one page of change descriptors that
   * the client resumes from. §36.1 T-2 forbids a mock or an in-memory substitute
   * for exactly these assertions, so the only substitution is the port production
   * binds fail-closed: the authenticator (§38.16). It lives in `test/`, so the
   * production graph still refuses every pull.
   *
   * Rows are seeded directly into `change_log` (the push block already proves the
   * ledger writes that feed in the same transaction as a business change), because
   * the read's hard cases need exact control of `server_sequence` and `changed_at`
   * — a paging boundary and an aged-out row — which an integration write cannot
   * pin. Every organization and device is fresh, so a case is isolated by its own
   * tenant rather than by ordering.
   */
  describe('pull endpoint (M1b-S6)', () => {
    const PULL_PATH = '/api/v1/sync/pull';

    /**
     * Boots the real application graph for one authenticated tenant, binds the
     * test authenticator to it, and keeps it open until this block's `afterAll`.
     */
    const openHarnesses: TestHarness[] = [];
    async function bootOrgHarness(organizationId: string, deviceId = randomUUID()): Promise<TestHarness> {
      const config = loadConfig({
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        LOG_PRETTY: 'false',
        DATABASE_URL: urls.application,
      });
      const context: SyncTrustedContext = { organizationId, deviceId };
      const harness = await createOverriddenTestHarness(config, (builder) => {
        builder.overrideProvider(PULL_SYNC_AUTHENTICATOR).useValue(new FixedSyncAuthenticator(context));
      });
      openHarnesses.push(harness);
      return harness;
    }

    /**
     * Seeds one `change_log` row through the application role, isolating the read.
     * `changedAt` defaults to now; an explicit value ages a row out for retention.
     */
    async function seedChange(
      organizationId: string,
      sequence: bigint,
      options: {
        readonly mutationId?: string;
        readonly entityType?: string;
        readonly entityId?: string;
        readonly changedAt?: Date;
      } = {},
    ): Promise<void> {
      const entityType = options.entityType ?? 'PULL_PROBE';
      const entityId = options.entityId ?? `pull-${String(sequence)}`;
      const changedAt = options.changedAt ?? new Date();
      if (options.mutationId === undefined) {
        await app.$executeRaw`
          INSERT INTO change_log (organization_id, server_sequence, mutation_id, entity_type, entity_id, changed_at)
          VALUES (${organizationId}::uuid, ${sequence}, NULL, ${entityType}, ${entityId}, ${changedAt})
        `;
      } else {
        await app.$executeRaw`
          INSERT INTO change_log (organization_id, server_sequence, mutation_id, entity_type, entity_id, changed_at)
          VALUES (${organizationId}::uuid, ${sequence}, ${options.mutationId}::uuid, ${entityType}, ${entityId}, ${changedAt})
        `;
      }
    }

    const OWN_ECHO_MUTATION_ID = randomUUID();

    afterAll(async () => {
      await Promise.all(openHarnesses.map((harness) => destroyTestHarness(harness)));
    }, 60_000);

    describe('cursor paging, ordering, and resume (T-O6)', () => {
      const ORG = randomUUID();
      let harness: TestHarness;

      beforeAll(async () => {
        harness = await bootOrgHarness(ORG);
        // Five changes at sequences 1..5; the first is a device mutation so the feed
        // has an own-echo case to carry.
        for (let sequence = 1n; sequence <= 5n; sequence += 1n) {
          await seedChange(ORG, sequence, {
            entityId: `e${String(sequence)}`,
            ...(sequence === 1n ? { mutationId: OWN_ECHO_MUTATION_ID } : {}),
          });
        }
      });

      function sequencesOf(response: { body: Record<string, unknown> }): string[] {
        return (response.body['changes'] as { serverSequence: string }[]).map((change) => change.serverSequence);
      }

      it('pages ascending on server_sequence, bounded by limit, with a truthful hasMore', async () => {
        const first = await harness.http.get(PULL_PATH).query({ after: '0', limit: 2 }).expect(200);
        expect(sequencesOf(first)).toEqual(['1', '2']);
        expect(first.body).toMatchObject({ nextAfter: '2', hasMore: true, rebaselineRequired: false });

        const second = await harness.http.get(PULL_PATH).query({ after: '2', limit: 2 }).expect(200);
        expect(sequencesOf(second)).toEqual(['3', '4']);
        expect(second.body).toMatchObject({ nextAfter: '4', hasMore: true });

        const third = await harness.http.get(PULL_PATH).query({ after: '4', limit: 2 }).expect(200);
        expect(sequencesOf(third)).toEqual(['5']);
        expect(third.body).toMatchObject({ nextAfter: '5', hasMore: false });
      });

      it('accepts the hard maximum page size and returns every change (§38.11.2)', async () => {
        const response = await harness.http.get(PULL_PATH).query({ after: '0', limit: MAX_PULL_PAGE_SIZE }).expect(200);
        expect(sequencesOf(response)).toEqual(['1', '2', '3', '4', '5']);
        expect(response.body).toMatchObject({ hasMore: false, nextAfter: '5' });
      });

      it('returns an empty page and the request cursor when fully caught up', async () => {
        const response = await harness.http.get(PULL_PATH).query({ after: '5', limit: 2 }).expect(200);
        expect(response.body).toEqual({ changes: [], nextAfter: '5', hasMore: false, rebaselineRequired: false });
      });

      it('carries the originating mutation_id so a device can reconcile its own echo (§38.11.2)', async () => {
        const response = await harness.http.get(PULL_PATH).query({ after: '0', limit: 5 }).expect(200);
        const changes = response.body['changes'] as { serverSequence: string; mutationId?: string }[];

        expect(changes[0]).toMatchObject({ serverSequence: '1', mutationId: OWN_ECHO_MUTATION_ID });
        // A server-originated change has no mutation id at all, not a null field.
        expect(changes[1]).not.toHaveProperty('mutationId');
      });

      it('T-O6: a disconnect that never stored the cursor re-fetches the same page, and draining loses nothing', async () => {
        // The client pulls a page and "disconnects" before applying it, so it never
        // stores `nextAfter`. Re-pulling from the same cursor must return the same
        // page: the server never advances the cursor on a read (§38.11.2).
        const first = await harness.http.get(PULL_PATH).query({ after: '0', limit: 2 }).expect(200);
        const retried = await harness.http.get(PULL_PATH).query({ after: '0', limit: 2 }).expect(200);
        expect(retried.body).toEqual(first.body);

        // Resuming from the client-held cursor drains every change exactly once.
        const collected: string[] = [];
        let after = '0';
        for (;;) {
          const response = await harness.http.get(PULL_PATH).query({ after, limit: 2 }).expect(200);
          collected.push(...sequencesOf(response));
          if (response.body['hasMore'] !== true) break;
          after = response.body['nextAfter'] as string;
        }
        expect(collected).toEqual(['1', '2', '3', '4', '5']);
      });
    });

    describe('the read never advances a stored cursor (T-O6 server half)', () => {
      it('leaves device_sync_cursors byte-identical across a successful pull', async () => {
        const org = randomUUID();
        const device = randomUUID();
        const sentinelUpdatedAt = new Date('2020-01-01T00:00:00.000Z');
        const harness = await bootOrgHarness(org, device);

        await seedChange(org, 1n, { entityId: 'cursor-probe' });
        // A cursor row that must not move: §38.11.2 makes the client store the cursor
        // only after the page is applied locally, so the server cannot observe that
        // success and must not write on a read.
        await app.$executeRaw`
        INSERT INTO device_sync_cursors
          (organization_id, device_id, last_pushed_server_sequence, last_pull_server_sequence, updated_at)
        VALUES (${org}::uuid, ${device}::uuid, NULL, 7, ${sentinelUpdatedAt})
      `;

        await harness.http.get(PULL_PATH).query({ after: '0' }).expect(200);

        const rows = await app.$queryRaw<{ seq: string; updated_at: Date }[]>`
        SELECT last_pull_server_sequence::text AS seq, updated_at FROM device_sync_cursors
        WHERE organization_id = ${org}::uuid AND device_id = ${device}::uuid
      `;
        expect(rows).toEqual([{ seq: '7', updated_at: sentinelUpdatedAt }]);
      });
    });

    describe('tenant isolation (§38.16, §9.3)', () => {
      it("never returns another organization's changes, even when it shares a sequence", async () => {
        const org = randomUUID();
        const foreign = randomUUID();
        const harness = await bootOrgHarness(org);

        await seedChange(org, 1n, { entityId: 'mine-1' });
        await seedChange(org, 2n, { entityId: 'mine-2' });
        // A different tenant at the same sequences the feed would return.
        await seedChange(foreign, 1n, { entityId: 'theirs-1' });
        await seedChange(foreign, 2n, { entityId: 'theirs-2' });

        const response = await harness.http.get(PULL_PATH).query({ after: '0' }).expect(200);
        const changes = response.body['changes'] as { entityId: string }[];

        expect(changes.map((change) => change.entityId)).toEqual(['mine-1', 'mine-2']);
      });
    });

    describe('retention and re-baseline (§38.11.1, O-21)', () => {
      it('returns an empty page from the beginning for an organization with no changes', async () => {
        const harness = await bootOrgHarness(randomUUID());
        const response = await harness.http.get(PULL_PATH).query({ after: '0' }).expect(200);

        expect(response.body).toEqual({ changes: [], nextAfter: '0', hasMore: false, rebaselineRequired: false });
      });

      it('requires a full re-baseline for a cursor older than the window, never a partial feed', async () => {
        const org = randomUUID();
        const harness = await bootOrgHarness(org);

        // One change 91 days old (outside the default 90-day window), two recent.
        const agedOutAt = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
        await seedChange(org, 1n, { entityId: 'aged-out', changedAt: agedOutAt });
        await seedChange(org, 2n, { entityId: 'recent-2' });
        await seedChange(org, 3n, { entityId: 'recent-3' });

        // A cursor at 0 needs sequence 1, which is gone: the answer is an empty page
        // with the floor, not sequence 2/3 as if they were the whole feed.
        const rebaseline = await harness.http.get(PULL_PATH).query({ after: '0' }).expect(200);
        expect(rebaseline.body).toEqual({
          changes: [],
          nextAfter: '0',
          hasMore: false,
          rebaselineRequired: true,
          retentionFloor: '2',
        });

        // A cursor that has reached the floor is inside the window and pages normally.
        const resumed = await harness.http.get(PULL_PATH).query({ after: '1' }).expect(200);
        const changes = resumed.body['changes'] as { entityId: string }[];
        expect(changes.map((change) => change.entityId)).toEqual(['recent-2', 'recent-3']);
        expect(resumed.body).toMatchObject({ rebaselineRequired: false, nextAfter: '3', hasMore: false });
      });
    });
  });

  /**
   * M2-S1 acceptance — organizations, memberships, and the operator-only
   * bootstrap command against **real PostgreSQL** (§36.1 T-2: no mock, no
   * in-memory substitute, no skipped run).
   *
   * §40.6's M2-S1 key acceptance is the tenancy foundation and the §10.4
   * command: the three tables this slice authorizes (and only those — the
   * table-list case above proves the "and no others"), idempotency enforced by
   * the database rather than by a flag in the caller, and a command line whose
   * credential is possession of the migrator URL.
   *
   * Every assertion below reads rows back out of PostgreSQL after the fact:
   * §36.1 T-2 is exactly the claim that the store, not the returned message, is
   * the source of truth. The clients are the ones the outer suite already
   * opened — one per role — so each case also proves *which role* may run the
   * statement it uses, and AC-14 re-drives the finished command line with a
   * credential canary in its environment (§13.6, §42.6).
   */
  describe('organizations and operator bootstrap (M2-S1)', () => {
    /** The durable organization the shared cases create, retry, and conflict on. */
    const FIRST_KEY = 'm2s1-first-tenant';
    const FIRST_NAME = 'Northwind Retail';
    const FIRST_EMAIL = 'owner.m2s1@example.test';
    /** Prepared inside AC-14: an organization whose owner membership is deleted out of band. */
    const ANOMALY_KEY = 'm2s1-anomaly-tenant';
    const CLI_KEY = 'm2s1-cli-tenant';
    const CLI_EMAIL = 'cli.m2s1@example.test';
    const CLI_ARGV: readonly string[] = [
      '--bootstrap-key',
      CLI_KEY,
      '--name',
      'CLI Tenant',
      '--owner-email',
      CLI_EMAIL,
    ];
    /**
     * The §10.4 request the shared retry replays, byte for byte: padded name
     * and mixed-case email, so the stored rows also prove trim + canonicalize.
     */
    const FIRST_REQUEST: BootstrapRequest = {
      bootstrapKey: FIRST_KEY,
      organizationName: `  ${FIRST_NAME}  `,
      ownerEmail: '  Owner.M2S1@Example.TEST  ',
    };
    /**
     * A password the repository's secret-scan already classifies as a permitted
     * fixture by name (the same value the CLI unit suite uses). Inert under the
     * trust authentication the local host and CI both use, so AC-14 can put it
     * in a URL that really connects and still assert it never reaches output.
     */
    const CANARY = 'do-not-log-this';
    const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

    interface CountRow {
      n: number;
    }
    interface OrgRow {
      id: string;
      name: string;
      status: string;
      bootstrap_key: string;
    }
    interface UserRow {
      id: string;
      email: string;
    }
    interface MembershipRow {
      id: string;
      organization_id: string;
      user_id: string;
      is_owner: boolean;
    }
    interface ColumnRow {
      column_name: string;
    }
    interface IndexDefRow {
      indexdef: string;
    }
    interface ForeignKeyRow {
      conname: string;
      confdeltype: string;
      confupdtype: string;
    }
    interface ConstraintKindRow {
      conname: string;
      contype: string;
    }
    interface EnumLabelRow {
      enumlabel: string;
    }
    interface CapturedIo {
      stdout: string[];
      stderr: string[];
    }

    /** Durable row counts for one (key, email) pair — the acceptance unit of "no duplicates". */
    const countsFor = async (
      bootstrapKey: string,
      email: string,
    ): Promise<{ orgs: number; users: number; memberships: number }> => {
      const [orgs, users, memberships] = await Promise.all([
        migrator.$queryRaw<
          CountRow[]
        >`SELECT count(*)::int AS n FROM organizations WHERE bootstrap_key = ${bootstrapKey}`,
        migrator.$queryRaw<CountRow[]>`SELECT count(*)::int AS n FROM users WHERE email = ${email}`,
        migrator.$queryRaw<CountRow[]>`
          SELECT count(*)::int AS n FROM organization_memberships m
          JOIN users u ON u.id = m.user_id WHERE u.email = ${email}`,
      ]);
      return { orgs: orgs[0]?.n ?? 0, users: users[0]?.n ?? 0, memberships: memberships[0]?.n ?? 0 };
    };

    const captureIo = (): { io: BootstrapCliIo; captured: CapturedIo } => {
      const captured: CapturedIo = { stdout: [], stderr: [] };
      const io: BootstrapCliIo = {
        out: (line) => {
          captured.stdout.push(line);
        },
        err: (line) => {
          captured.stderr.push(line);
        },
      };
      return { io, captured };
    };

    /** Drives the real command line in-process (the parser, the config, and the Prisma connector). */
    const runCli = async (
      argv: readonly string[],
      env: Record<string, string | undefined>,
      connect?: BootstrapConnectorFactory,
    ): Promise<{ code: number; captured: CapturedIo }> => {
      const { io, captured } = captureIo();
      const code = await runBootstrapCli(argv, env, io, connect === undefined ? {} : { connect });
      return { code, captured };
    };

    /** A connector factory that records the attempt and refuses: "never connected" as a fact. */
    const neverConnects = (): { readonly factory: BootstrapConnectorFactory; readonly calls: number[] } => {
      const calls: number[] = [];
      return {
        calls,
        factory: (url) => {
          calls.push(url.length);
          return Promise.reject(new Error('the command must not open a connection for this case'));
        },
      };
    };

    /**
     * A URL for the same host and database carrying the canary password. Built
     * from the suite's own environment, so it works wherever the suite runs; the
     * credential exists only at runtime, never in this file (§13.6).
     */
    const canaryUrlFor = (username: string): string => {
      const parsed = new URL(urls.migration);
      parsed.username = username;
      parsed.password = CANARY;
      return parsed.toString();
    };

    const firstOf = <T>(rows: readonly T[], what: string): T => {
      const [row] = rows;
      if (row === undefined) {
        throw new Error(`expected exactly one ${what}, found none`);
      }
      return row;
    };

    /**
     * The PostgreSQL SQLSTATE behind a failed raw statement.
     *
     * Prisma reports a raw-statement failure as `P2010` ("raw query failed")
     * and carries the driver's own five-digit SQLSTATE in the message, so the
     * assertions below use the *database's* classification — 23505 unique,
     * 23503 foreign key, 23514 check — rather than a client-side mapping of it.
     */
    const sqlStateOf = (error: unknown): string | undefined =>
      error instanceof Error ? (/Code: `(\d{5})`/.exec(error.message)?.[1] ?? undefined) : undefined;

    it('AC-01: the first bootstrap durably writes one organization, one owner user, and one owner membership', async () => {
      const result = await new OrganizationBootstrapService({ prisma: migrator }).bootstrap(FIRST_REQUEST);

      expect(result).toMatchObject({ status: 'BOOTSTRAPPED', bootstrapKey: FIRST_KEY });
      expect(result.organizationId).toMatch(UUID_PATTERN);
      expect(result.userId).toMatch(UUID_PATTERN);
      expect(result.membershipId).toMatch(UUID_PATTERN);

      // The stored organization, not the returned message (§36.1 T-2).
      const organizations = await migrator.$queryRaw<OrgRow[]>`
        SELECT id, name, status::text AS status, bootstrap_key
        FROM organizations WHERE bootstrap_key = ${FIRST_KEY}`;
      expect(organizations).toHaveLength(1);
      expect(organizations[0]).toMatchObject({
        id: result.organizationId,
        name: FIRST_NAME,
        status: 'ACTIVE',
        bootstrap_key: FIRST_KEY,
      });

      const users = await migrator.$queryRaw<UserRow[]>`SELECT id, email FROM users WHERE email = ${FIRST_EMAIL}`;
      expect(users.map((user) => user.id)).toEqual([result.userId]);

      const memberships = await migrator.$queryRaw<MembershipRow[]>`
        SELECT id, organization_id, user_id, is_owner
        FROM organization_memberships WHERE organization_id = ${result.organizationId}::uuid`;
      expect(memberships).toEqual([
        { id: result.membershipId, organization_id: result.organizationId, user_id: result.userId, is_owner: true },
      ]);

      // §8.4: the identity table is credential-free — exactly three columns.
      const columns = await migrator.$queryRaw<ColumnRow[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' ORDER BY column_name`;
      expect(columns.map((column) => column.column_name)).toEqual(['created_at', 'email', 'id']);
    });

    it('AC-02: an identical retry answers ALREADY_BOOTSTRAPPED with the stored ids and writes nothing', async () => {
      const retry = await new OrganizationBootstrapService({ prisma: migrator }).bootstrap(FIRST_REQUEST);

      expect(retry.status).toBe('ALREADY_BOOTSTRAPPED');
      expect(retry.organizationId).toMatch(UUID_PATTERN);

      const organizations = await migrator.$queryRaw<OrgRow[]>`
        SELECT id, name, status::text AS status, bootstrap_key
        FROM organizations WHERE bootstrap_key = ${FIRST_KEY}`;
      expect(organizations).toHaveLength(1);
      expect(retry.organizationId).toBe(organizations[0]?.id);
      expect(await countsFor(FIRST_KEY, FIRST_EMAIL)).toEqual({ orgs: 1, users: 1, memberships: 1 });
    });

    it('AC-03: four concurrent identical bootstraps converge on one durable consistent result', async () => {
      const raceKey = 'm2s1-race-tenant';
      const raceEmail = 'race.m2s1@example.test';
      const request: BootstrapRequest = {
        bootstrapKey: raceKey,
        organizationName: 'Race Tenant',
        ownerEmail: raceEmail,
      };
      const service = new OrganizationBootstrapService({ prisma: migrator });

      const answers = await Promise.all([
        service.bootstrap(request),
        service.bootstrap(request),
        service.bootstrap(request),
        service.bootstrap(request),
      ]);

      // The advisory lock serializes the racers: one writer, three reconciliations.
      expect(answers.filter((answer) => answer.status === 'BOOTSTRAPPED')).toHaveLength(1);
      expect(answers.filter((answer) => answer.status === 'ALREADY_BOOTSTRAPPED')).toHaveLength(3);
      expect(new Set(answers.map((answer) => answer.organizationId)).size).toBe(1);
      expect(new Set(answers.map((answer) => answer.userId)).size).toBe(1);
      expect(await countsFor(raceKey, raceEmail)).toEqual({ orgs: 1, users: 1, memberships: 1 });
    }, 60_000);

    it('AC-04: a retry with the same key but different parameters is an explicit conflict and adopts nothing', async () => {
      const service = new OrganizationBootstrapService({ prisma: migrator });

      const wrongName = await service
        .bootstrap({ ...FIRST_REQUEST, organizationName: 'Some Other Name' })
        .catch((error: unknown) => error);
      expect(wrongName).toBeInstanceOf(BootstrapConflictError);
      expect((wrongName as BootstrapConflictError).reason).toBe('NAME_MISMATCH');

      const wrongEmail = await service
        .bootstrap({ ...FIRST_REQUEST, ownerEmail: 'someone.else@example.test' })
        .catch((error: unknown) => error);
      expect(wrongEmail).toBeInstanceOf(BootstrapConflictError);
      expect((wrongEmail as BootstrapConflictError).reason).toBe('OWNER_EMAIL_MISMATCH');

      // Nothing was adopted, overwritten, or repaired: the stored row is untouched.
      const stored = await migrator.$queryRaw<OrgRow[]>`
        SELECT id, name, status::text AS status, bootstrap_key
        FROM organizations WHERE bootstrap_key = ${FIRST_KEY}`;
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ name: FIRST_NAME, status: 'ACTIVE' });
      expect(await countsFor(FIRST_KEY, FIRST_EMAIL)).toEqual({ orgs: 1, users: 1, memberships: 1 });
    });

    it('AC-05: a failure after all three inserts but before commit leaves zero committed rows', async () => {
      const rollbackKey = 'm2s1-rollback-tenant';
      const rollbackEmail = 'rollback.m2s1@example.test';
      const failing = new OrganizationBootstrapService(
        { prisma: migrator },
        {
          failureProbe: () => {
            throw new Error('injected failure before commit');
          },
        },
      );

      await expect(
        failing.bootstrap({
          bootstrapKey: rollbackKey,
          organizationName: 'Rollback Tenant',
          ownerEmail: rollbackEmail,
        }),
      ).rejects.toThrow('injected failure before commit');

      // Real rollback against real PostgreSQL: organization, user, and
      // membership all absent — not "created and then cleaned up".
      expect(await countsFor(rollbackKey, rollbackEmail)).toEqual({ orgs: 0, users: 0, memberships: 0 });
    });

    it('AC-06: the real command line bootstraps once, then answers its own identical retry with the same ids', async () => {
      const env = { MIGRATION_DATABASE_URL: urls.migration };

      const first = await runCli(CLI_ARGV, env);
      expect(first.code).toBe(EXIT_SUCCESS);
      expect(first.captured.stderr).toEqual([]);
      expect(first.captured.stdout).toHaveLength(1);
      const payload = JSON.parse(first.captured.stdout[0] ?? '{}') as BootstrapResult;
      expect(payload.status).toBe('BOOTSTRAPPED');
      expect(payload.bootstrapKey).toBe(CLI_KEY);
      expect(payload.organizationId).toMatch(UUID_PATTERN);

      const retry = await runCli(CLI_ARGV, env);
      expect(retry.code).toBe(EXIT_SUCCESS);
      expect(retry.captured.stderr).toEqual([]);
      expect(JSON.parse(retry.captured.stdout[0] ?? '{}')).toMatchObject({
        status: 'ALREADY_BOOTSTRAPPED',
        organizationId: payload.organizationId,
        userId: payload.userId,
        membershipId: payload.membershipId,
      });

      expect(await countsFor(CLI_KEY, CLI_EMAIL)).toEqual({ orgs: 1, users: 1, memberships: 1 });
    }, 60_000);

    it('AC-07: malformed input is refused with exit 2 before any connection is attempted', async () => {
      const probe = neverConnects();

      const answer = await runCli(
        ['--bootstrap-key', 'Not A Valid Key', '--name', 'Whatever', '--owner-email', 'ac07@example.test'],
        { MIGRATION_DATABASE_URL: urls.migration },
        probe.factory,
      );

      expect(answer.code).toBe(EXIT_USAGE);
      expect(probe.calls).toEqual([]);
      expect(answer.captured.stdout).toEqual([]);
      expect(answer.captured.stderr).toHaveLength(1);
      expect(JSON.parse(answer.captured.stderr[0] ?? '{}')).toMatchObject({
        error: 'BOOTSTRAP_INPUT_INVALID',
        field: 'bootstrapKey',
      });
    });

    it('AC-08: without MIGRATION_DATABASE_URL the command refuses, and §13.4 refuses identical role identities', async () => {
      const probe = neverConnects();

      const missing = await runCli(CLI_ARGV, { DATABASE_URL: urls.application }, probe.factory);
      expect(missing.code).toBe(EXIT_USAGE);
      expect(JSON.parse(missing.captured.stderr[0] ?? '{}')).toMatchObject({ error: 'MISSING_CREDENTIAL' });

      const collapsed = await runCli(
        CLI_ARGV,
        { DATABASE_URL: urls.application, MIGRATION_DATABASE_URL: urls.application },
        probe.factory,
      );
      expect(collapsed.code).toBe(EXIT_USAGE);
      expect(JSON.parse(collapsed.captured.stderr[0] ?? '{}')).toMatchObject({ error: 'CONFIGURATION_REFUSED' });

      expect(probe.calls).toEqual([]);
    });

    it('AC-09: the database refuses a second membership for the same organization and user', async () => {
      const membershipCount = async (): Promise<number> => {
        const rows = await migrator.$queryRaw<CountRow[]>`
          SELECT count(*)::int AS n FROM organization_memberships
          WHERE organization_id = (SELECT id FROM organizations WHERE bootstrap_key = ${FIRST_KEY})`;
        return rows[0]?.n ?? 0;
      };

      const before = await membershipCount();
      expect(before).toBeGreaterThan(0);

      // The application role is the writer that could ever duplicate a row, so
      // the attempt goes through it — same organization, same user, new row.
      const duplicate = await app.$executeRaw`
          INSERT INTO organization_memberships (organization_id, user_id, is_owner)
          SELECT organization_id, user_id, false FROM organization_memberships
          WHERE organization_id = (SELECT id FROM organizations WHERE bootstrap_key = ${FIRST_KEY})
          LIMIT 1`.catch((error: unknown) => error);

      expect(duplicate).toBeInstanceOf(Error);
      expect(sqlStateOf(duplicate)).toBe('23505');
      expect(await membershipCount()).toBe(before);
    });

    it('AC-10: one user can own two organizations through two membership rows (§9.2 T-4)', async () => {
      const secondKey = 'm2s1-second-tenant';
      const result = await new OrganizationBootstrapService({ prisma: migrator }).bootstrap({
        bootstrapKey: secondKey,
        organizationName: 'Second Tenant',
        ownerEmail: FIRST_EMAIL,
      });
      expect(result.status).toBe('BOOTSTRAPPED');

      // The identity row is reused, not duplicated; the membership edge is new.
      const users = await migrator.$queryRaw<UserRow[]>`SELECT id FROM users WHERE email = ${FIRST_EMAIL}`;
      expect(users.map((user) => user.id)).toEqual([result.userId]);
      expect(await countsFor(secondKey, FIRST_EMAIL)).toEqual({ orgs: 1, users: 1, memberships: 2 });

      const memberships = await migrator.$queryRaw<MembershipRow[]>`
        SELECT m.organization_id, m.is_owner FROM organization_memberships m
        JOIN users u ON u.id = m.user_id WHERE u.email = ${FIRST_EMAIL}`;
      expect(new Set(memberships.map((membership) => membership.organization_id)).size).toBe(2);
      expect(memberships.every((membership) => membership.is_owner)).toBe(true);
    });

    it('AC-11: at most one owner per organization — a partial unique index, not a code check', async () => {
      // A second identity, written straight through the application role.
      const inserted = await app.$queryRaw<UserRow[]>`
        INSERT INTO users (email) VALUES ('member.m2s1@example.test') RETURNING id`;
      const memberId = firstOf(inserted, 'member identity').id;

      const organizations = await migrator.$queryRaw<{ id: string }[]>`
        SELECT id FROM organizations WHERE bootstrap_key = ${FIRST_KEY}`;
      const organizationId = firstOf(organizations, 'organization').id;

      // A second owner row is refused by PostgreSQL whatever the caller believes.
      const secondOwner = await app.$executeRaw`
          INSERT INTO organization_memberships (organization_id, user_id, is_owner)
          VALUES (${organizationId}::uuid, ${memberId}::uuid, true)`.catch((error: unknown) => error);
      expect(secondOwner).toBeInstanceOf(Error);
      expect(sqlStateOf(secondOwner)).toBe('23505');

      // A non-owner membership for the same pair is a different row and is accepted.
      await expect(app.$executeRaw`
        INSERT INTO organization_memberships (organization_id, user_id, is_owner)
        VALUES (${organizationId}::uuid, ${memberId}::uuid, false)`).resolves.toBe(1);

      const owners = await migrator.$queryRaw<CountRow[]>`
        SELECT count(*)::int AS n FROM organization_memberships
        WHERE organization_id = ${organizationId}::uuid AND is_owner`;
      expect(owners[0]?.n ?? 0).toBe(1);
    });

    it('AC-12: foreign keys reject memberships that reference no organization or no user', async () => {
      const organizations = await migrator.$queryRaw<{ id: string }[]>`
        SELECT id FROM organizations WHERE bootstrap_key = ${FIRST_KEY}`;
      const users = await migrator.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE email = ${FIRST_EMAIL}`;
      const organizationId = firstOf(organizations, 'organization').id;
      const userId = firstOf(users, 'user').id;

      const missingOrganization = await app.$executeRaw`
          INSERT INTO organization_memberships (organization_id, user_id, is_owner)
          VALUES (${randomUUID()}::uuid, ${userId}::uuid, false)`.catch((error: unknown) => error);
      expect(missingOrganization).toBeInstanceOf(Error);
      expect(sqlStateOf(missingOrganization)).toBe('23503');

      const missingUser = await app.$executeRaw`
          INSERT INTO organization_memberships (organization_id, user_id, is_owner)
          VALUES (${organizationId}::uuid, ${randomUUID()}::uuid, false)`.catch((error: unknown) => error);
      expect(missingUser).toBeInstanceOf(Error);
      expect(sqlStateOf(missingUser)).toBe('23503');
    });

    it('AC-13: role attributes are unchanged, the new tables are migrator-owned, and the application role still cannot run DDL', async () => {
      const roles = await admin.$queryRaw<RoleRow[]>`
        SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication, rolcanlogin
        FROM pg_roles WHERE rolname IN ('my_shop_migrator', 'my_shop_app') ORDER BY rolname`;
      expect(roles.map((role) => role.rolname)).toEqual(['my_shop_app', 'my_shop_migrator']);
      for (const role of roles) {
        expect(role).toMatchObject({
          rolsuper: false,
          rolbypassrls: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolreplication: false,
          rolcanlogin: true,
        });
      }

      // Every table this slice births is owned by the migrator — the credential
      // the bootstrap command (AC-06) ran with — never by the application.
      // (Read through the migrator connection: the privileged maintenance
      // client is connected to the maintenance database, not this one.)
      const owners = await migrator.$queryRaw<OwnerRow[]>`
        SELECT c.relname, r.rolname AS owner
        FROM pg_class c
        JOIN pg_roles r ON r.oid = c.relowner
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname IN ('organizations', 'users', 'organization_memberships')
        ORDER BY c.relname`;
      expect(owners).toEqual([
        { relname: 'organization_memberships', owner: 'my_shop_migrator' },
        { relname: 'organizations', owner: 'my_shop_migrator' },
        { relname: 'users', owner: 'my_shop_migrator' },
      ]);

      // §13.4's runtime half: the application role keeps DML and loses DDL.
      await expect(app.$executeRaw`ALTER TABLE organizations ADD COLUMN probe text`).rejects.toThrow();
      const columns = await migrator.$queryRaw<ColumnRow[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'organizations' ORDER BY column_name`;
      expect(columns.map((column) => column.column_name)).toEqual([
        'bootstrap_key',
        'created_at',
        'id',
        'name',
        'status',
      ]);
      const readable = await migrator.$queryRaw<CountRow[]>`SELECT count(*)::int AS n FROM organizations`;
      expect(readable[0]?.n ?? -1).toBeGreaterThan(0);
    });

    it('AC-14: no credential-shaped value reaches any command line output path (secret canary)', async () => {
      const outputs: string[] = [];
      const collect = (answer: { readonly code: number; readonly captured: CapturedIo }): number => {
        outputs.push(...answer.captured.stdout, ...answer.captured.stderr);
        return answer.code;
      };

      // An organization whose owner membership is deleted out of band: the
      // stored row contradicts the invariants the schema enforces, which is an
      // integrity alarm (exit 1) — and the connection below succeeds, so the
      // driver has nothing to complain about either way.
      await new OrganizationBootstrapService({ prisma: migrator }).bootstrap({
        bootstrapKey: ANOMALY_KEY,
        organizationName: 'Anomaly Tenant',
        ownerEmail: 'anomaly.m2s1@example.test',
      });
      await migrator.$executeRaw`
        DELETE FROM organization_memberships
        WHERE organization_id = (SELECT id FROM organizations WHERE bootstrap_key = ${ANOMALY_KEY})`;

      // 1. Success — a real connection carrying the canary password (trust auth).
      expect(
        collect(
          await runCli(
            [
              '--bootstrap-key',
              'm2s1-canary-tenant',
              '--name',
              'Canary Tenant',
              '--owner-email',
              'canary.m2s1@example.test',
            ],
            { MIGRATION_DATABASE_URL: canaryUrlFor('my_shop_migrator') },
          ),
        ),
      ).toBe(EXIT_SUCCESS);
      // 2. Usage refused before configuration is even loaded.
      expect(
        collect(
          await runCli(['--bootstrap-key', 'm2s1', '--name'], {
            MIGRATION_DATABASE_URL: canaryUrlFor('my_shop_migrator'),
          }),
        ),
      ).toBe(EXIT_USAGE);
      // 3. Conflicting retry (the stored organization of AC-01 under a new name).
      expect(
        collect(
          await runCli(['--bootstrap-key', FIRST_KEY, '--name', 'Renamed Elsewhere', '--owner-email', FIRST_EMAIL], {
            MIGRATION_DATABASE_URL: canaryUrlFor('my_shop_migrator'),
          }),
        ),
      ).toBe(EXIT_CONFLICT);
      // 4. Missing operator credential: the canary sits in DATABASE_URL, the
      //    one variable the command must never fall back to (AC-08).
      expect(
        collect(
          await runCli(
            [
              '--bootstrap-key',
              'm2s1-canary-tenant',
              '--name',
              'Canary Tenant',
              '--owner-email',
              'canary.m2s1@example.test',
            ],
            { DATABASE_URL: canaryUrlFor('my_shop_app') },
          ),
        ),
      ).toBe(EXIT_USAGE);
      // 5. Stored-state anomaly — a real, completed connection and a real refusal.
      expect(
        collect(
          await runCli(
            ['--bootstrap-key', ANOMALY_KEY, '--name', 'Anomaly Tenant', '--owner-email', 'anomaly.m2s1@example.test'],
            { MIGRATION_DATABASE_URL: canaryUrlFor('my_shop_migrator') },
          ),
        ),
      ).toBe(EXIT_RUNTIME);

      // §10.4's output contract: exactly one line per invocation, across five
      // different exit codes — and not one of them carries the credential.
      expect(outputs).toHaveLength(5);
      const joined = outputs.join('\n');
      expect(joined.includes(CANARY)).toBe(false);
      expect(joined.includes('postgresql://')).toBe(false);
    }, 60_000);

    it('holds the M2-S1 contract in the database: enum vocabulary, CHECK rules, the single-owner index, and the foreign keys', async () => {
      const labels = await migrator.$queryRaw<EnumLabelRow[]>`
        SELECT e.enumlabel FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'organization_status' ORDER BY e.enumsortorder`;
      expect(labels.map((label) => label.enumlabel)).toEqual(['ACTIVE', 'DEACTIVATED']);

      const blankName =
        await app.$executeRaw`INSERT INTO organizations (name, bootstrap_key) VALUES ('   ', 'm2s1-blank-name-probe')`.catch(
          (error: unknown) => error,
        );
      expect(blankName).toBeInstanceOf(Error);
      expect(sqlStateOf(blankName)).toBe('23514');
      const blankRows = await migrator.$queryRaw<CountRow[]>`
        SELECT count(*)::int AS n FROM organizations WHERE bootstrap_key = 'm2s1-blank-name-probe'`;
      expect(blankRows[0]?.n ?? -1).toBe(0);

      const mixedCase = await app.$executeRaw`INSERT INTO users (email) VALUES ('Mixed.Case@Example.test')`.catch(
        (error: unknown) => error,
      );
      expect(mixedCase).toBeInstanceOf(Error);
      expect(sqlStateOf(mixedCase)).toBe('23514');
      const emailRows = await migrator.$queryRaw<CountRow[]>`
        SELECT count(*)::int AS n FROM users WHERE email = 'Mixed.Case@Example.test'`;
      expect(emailRows[0]?.n ?? -1).toBe(0);

      const indexes = await migrator.$queryRaw<IndexDefRow[]>`
        SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'uq_organizations_single_owner'`;
      expect(indexes).toHaveLength(1);
      expect(indexes[0]?.indexdef).toContain('WHERE is_owner');

      const pairs = await migrator.$queryRaw<ConstraintKindRow[]>`
        SELECT conname, contype FROM pg_constraint
        WHERE conrelid = 'organization_memberships'::regclass AND contype IN ('p', 'u') ORDER BY conname`;
      expect(pairs.map((pair) => pair.conname)).toEqual([
        'organization_memberships_organization_id_user_id_key',
        'organization_memberships_pkey',
      ]);

      const foreignKeys = await migrator.$queryRaw<ForeignKeyRow[]>`
        SELECT conname, confdeltype, confupdtype FROM pg_constraint
        WHERE conrelid = 'organization_memberships'::regclass AND contype = 'f' ORDER BY conname`;
      // 'r' = ON DELETE RESTRICT, 'c' = ON UPDATE CASCADE (§9.2 T-2/T-5).
      expect(foreignKeys).toEqual([
        { conname: 'organization_memberships_organization_id_fkey', confdeltype: 'r', confupdtype: 'c' },
        { conname: 'organization_memberships_user_id_fkey', confdeltype: 'r', confupdtype: 'c' },
      ]);
    });

    it('hardening F-3: the bootstrap-key grammar is a database fact, not just a CLI rule', async () => {
      // The constraint migration 0004 adds.
      const constraints = await migrator.$queryRaw<ConstraintKindRow[]>`
        SELECT conname, contype FROM pg_constraint
        WHERE conrelid = 'organizations'::regclass
          AND conname = 'chk_organizations_bootstrap_key_kebab'`;
      expect(constraints).toEqual([{ conname: 'chk_organizations_bootstrap_key_kebab', contype: 'c' }]);

      /** Inserts a key directly as the application role and returns the error, if any. */
      const insertKey = async (key: string): Promise<unknown> =>
        app.$executeRaw`INSERT INTO organizations (name, bootstrap_key) VALUES ('Kebab Probe', ${key})`.catch(
          (error: unknown) => error,
        );

      // Shapes the 0003 constraint allows (length in range, already trimmed)
      // but the grammar forbids; each names the exact constraint so the test
      // cannot pass on an unrelated rejection.
      for (const key of ['Mixed-Case', 'main_shop', 'has space', '-leading', 'trailing-', 'double--hyphen']) {
        const error = await insertKey(key);
        expect(error).toBeInstanceOf(Error);
        expect(sqlStateOf(error)).toBe('23514');
        expect((error as Error).message).toContain('chk_organizations_bootstrap_key_kebab');
      }

      // The 3..64 bound holds too, through two different database mechanisms:
      // under-length hits the 0003 length CHECK (23514); over-length is stopped
      // by the `varchar(64)` column type itself (22001, string truncation).
      const tooShort = await insertKey('ab');
      expect(sqlStateOf(tooShort)).toBe('23514');
      const tooLong = await insertKey('a'.repeat(65));
      expect(sqlStateOf(tooLong)).toBe('22001');

      // Not one of the rejected shapes was stored.
      const stored = await migrator.$queryRaw<CountRow[]>`
        SELECT count(*)::int AS n FROM organizations WHERE name = 'Kebab Probe'`;
      expect(stored[0]?.n ?? -1).toBe(0);

      // A compliant key is still accepted at both boundaries (3 and 64).
      await expect(
        app.$executeRaw`INSERT INTO organizations (name, bootstrap_key) VALUES ('Kebab Probe', 'ok-3')`,
      ).resolves.toBe(1);
      await expect(
        app.$executeRaw`INSERT INTO organizations (name, bootstrap_key) VALUES ('Kebab Probe', ${'a'.repeat(64)})`,
      ).resolves.toBe(1);
    });

    it('AC-16: upgrading a database that already runs 0001+0002 with M1b rows preserves every row', async () => {
      const scratchName = 'my_shop_m2s1_upgrade';
      const scratchMigrations = new URL(urls.migration);
      scratchMigrations.pathname = `/${scratchName}`;
      const scratchApplication = new URL(urls.application);
      scratchApplication.pathname = `/${scratchName}`;
      const scratchRoot = mkdtempSync(path.join(tmpdir(), 'my-shop-m2s1-'));
      const scratchSchema = path.join(scratchRoot, 'schema.prisma');

      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`);
      await admin.$executeRawUnsafe(`CREATE DATABASE ${scratchName}`);

      const scratch = new PrismaClient({ datasourceUrl: scratchMigrations.toString() });
      try {
        // Roles and grants exactly as `test-setup` provisions the fixed database.
        dbScript('bootstrap', { env: { DATABASE_URL: scratchApplication.toString() } });

        // A reduced history: only the migrations this slice is allowed to
        // upgrade from (§35.1 — merged migrations are never touched or copied
        // forward; the scratch schema is the same file production builds).
        cpSync(path.join(API_ROOT, 'prisma', 'schema.prisma'), scratchSchema);
        mkdirSync(path.join(scratchRoot, 'migrations'), { recursive: true });
        for (const migration of ['0001_schema_skeleton', '0002_mutation_ledger']) {
          cpSync(
            path.join(API_ROOT, 'prisma', 'migrations', migration),
            path.join(scratchRoot, 'migrations', migration),
            { recursive: true },
          );
        }
        dbScript('deploy', {
          args: ['--schema', scratchSchema],
          env: { MIGRATION_DATABASE_URL: scratchMigrations.toString() },
        });

        await scratch.$connect();
        const fixtureOrganization = randomUUID();
        const fixtureDevice = randomUUID();
        await scratch.$executeRaw`
          INSERT INTO mutation_ledger (organization_id, mutation_id, device_id, received_at, payload_hash, status)
          VALUES (${fixtureOrganization}::uuid, ${randomUUID()}::uuid, ${fixtureDevice}::uuid, now(), ${'a'.repeat(64)}, 'APPLIED'::mutation_ledger_status)`;
        await scratch.$executeRaw`
          INSERT INTO change_log (organization_id, server_sequence, mutation_id, entity_type, entity_id, changed_at)
          VALUES (${fixtureOrganization}::uuid, 1, NULL, 'M1B_FIXTURE', 'before-m2s1', now())`;
        await scratch.$executeRaw`
          INSERT INTO device_sync_cursors (organization_id, device_id, updated_at)
          VALUES (${fixtureOrganization}::uuid, ${fixtureDevice}::uuid, now())`;
        await scratch.$executeRaw`
          INSERT INTO sync_sequences (organization_id, last_sequence)
          VALUES (${fixtureOrganization}::uuid, 7)`;

        // The slice's migration now joins a history that is already in use,
        // followed by its hardening migration 0004.
        for (const migration of ['0003_organizations', '0004_bootstrap_key_shape']) {
          cpSync(
            path.join(API_ROOT, 'prisma', 'migrations', migration),
            path.join(scratchRoot, 'migrations', migration),
            {
              recursive: true,
            },
          );
        }
        dbScript('deploy', {
          args: ['--schema', scratchSchema],
          env: { MIGRATION_DATABASE_URL: scratchMigrations.toString() },
        });

        const migrations = await scratch.$queryRaw<MigrationRow[]>`
          SELECT migration_name FROM _prisma_migrations ORDER BY migration_name`;
        expect(migrations.map((row) => row.migration_name)).toEqual([
          '0001_schema_skeleton',
          '0002_mutation_ledger',
          '0003_organizations',
          '0004_bootstrap_key_shape',
        ]);

        // Every pre-existing M1b row survives the upgrade untouched...
        const ledger = await scratch.$queryRaw<CountRow[]>`
          SELECT count(*)::int AS n FROM mutation_ledger WHERE organization_id = ${fixtureOrganization}::uuid`;
        const changes = await scratch.$queryRaw<CountRow[]>`
          SELECT count(*)::int AS n FROM change_log WHERE organization_id = ${fixtureOrganization}::uuid`;
        const cursors = await scratch.$queryRaw<CountRow[]>`
          SELECT count(*)::int AS n FROM device_sync_cursors WHERE organization_id = ${fixtureOrganization}::uuid`;
        const sequences = await scratch.$queryRaw<{ last_sequence: string }[]>`
          SELECT last_sequence::text AS last_sequence FROM sync_sequences
          WHERE organization_id = ${fixtureOrganization}::uuid`;
        expect({ ledger: ledger[0]?.n, changes: changes[0]?.n, cursors: cursors[0]?.n }).toEqual({
          ledger: 1,
          changes: 1,
          cursors: 1,
        });
        expect(sequences).toEqual([{ last_sequence: '7' }]);

        // ...and the new tables arrive empty: an upgrade creates no tenant.
        const organizations = await scratch.$queryRaw<CountRow[]>`SELECT count(*)::int AS n FROM organizations`;
        const users = await scratch.$queryRaw<CountRow[]>`SELECT count(*)::int AS n FROM users`;
        const memberships = await scratch.$queryRaw<CountRow[]>`
          SELECT count(*)::int AS n FROM organization_memberships`;
        expect({ organizations: organizations[0]?.n, users: users[0]?.n, memberships: memberships[0]?.n }).toEqual({
          organizations: 0,
          users: 0,
          memberships: 0,
        });
      } finally {
        await Promise.allSettled([scratch.$disconnect()]);
        try {
          await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`);
        } catch {
          /* best-effort cleanup; the fixed test database is untouched either way */
        }
        rmSync(scratchRoot, { recursive: true, force: true });
      }
    }, 300_000);

    it('AC-18: the Prisma schema and the migration history agree — migrate diff exits 0', () => {
      // No shadow database and no second server: the diff runs against the very
      // database this suite just migrated, so exit 0 means "history == schema".
      const diff = prismaCli(
        [
          'migrate',
          'diff',
          '--from-url',
          urls.migration,
          '--to-schema-datamodel',
          path.join(API_ROOT, 'prisma', 'schema.prisma'),
          '--exit-code',
        ],
        { DATABASE_URL: urls.application },
      );

      if (diff.status !== 0) {
        throw new Error(`prisma migrate diff exited ${diff.status}\n${diff.stdout}\n${diff.stderr}`);
      }
    }, 60_000);

    it('AC-23: no public organizations endpoint exists — the command is operator-only (§10.4, §39.2)', async () => {
      const config = loadConfig({
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        LOG_PRETTY: 'false',
        DATABASE_URL: urls.application,
      });
      const harness = await createTestHarness(config);

      try {
        // No controller, no route, no DTO: the real application graph answers
        // 404 for both verbs, so there is no client-reachable bootstrap at all.
        await harness.http.get('/api/v1/organizations').expect(404);
        await harness.http.post('/api/v1/organizations').send({ name: 'Rogue Tenant' }).expect(404);
      } finally {
        await destroyTestHarness(harness);
      }
    }, 60_000);
  });
});
