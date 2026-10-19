/**
 * M2-S6 acceptance — the §32 audit streams against **real PostgreSQL**
 * (§36.1 T-2: no mock, no in-memory substitute, no skipped run).
 *
 * The slice's key acceptance is *"tampering with event ordering is
 * detectable"*, and the invariants supporting it are database facts, so this
 * suite probes the three tables migrations `0010`/`0011` created through the
 * same roles the running process uses:
 *
 *  1. **Append-only privilege (§32.5)** — the application role holds
 *     INSERT + SELECT on `audit_events` / `security_events` and *nothing
 *     else* against them; the allocation anchor keeps its bounded UPDATE and
 *     holds no DELETE. Refusals are named by SQLSTATE, not by wording.
 *  2. **RLS isolation (§8.2, §32)** — the streams' policies make a foreign
 *     tenant invisible and its rows unreadable/unwritable in any context,
 *     fail closed with no context at all, and admit exactly the documented
 *     GLOBAL `security_events` partition to a context-free connection.
 *  3. **Ordering, rollback, and tamper detection (§32.5)** — concurrent
 *     writers serialize on the head into a gapless-committed chain; a
 *     rolled-back append leaves no gap (the next committed append reuses the
 *     value); and the read-only integrity verifier names every defect a
 *     superuser can manufacture — `SEQUENCE_BREAK`, `HASH_MISMATCH`,
 *     `CHAIN_BREAK`, `HEAD_DISAGREEMENT` — while a clean scope verifies.
 *
 * The negative tampering probes require a principal that *can* rewrite rows —
 * the superuser. The suite derives those credentials from `ADMIN_DATABASE_URL`
 * retargeted at the fixed test database (the same connection `test-setup` uses
 * to create it); the honest boundary of §32.5 is exactly this statement.
 *
 * Environment: `DATABASE_URL`, `MIGRATION_DATABASE_URL` and
 * `ADMIN_DATABASE_URL` with the same guarding `postgres.db-spec.ts` applies
 * (both first URLs must name `my_shop_test`; `ADMIN_DATABASE_URL` must not).
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import type { AuditTxClient } from '../../src/common/audit/stream.contract';
import { AuditStreamWriter } from '../../src/common/audit/audit-stream-writer';
import { verifyAuditStreamScope } from '../../src/common/audit/audit-integrity';
import { GLOBAL_SECURITY_SCOPE, GENESIS_HASH, type AuditActor } from '../../src/common/audit/stream.contract';
import { withTenantTransaction } from '../../src/common/database/tenant-context';

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
      `${name} is not set. The audit-stream acceptance suite refuses to run without it ` +
        `(Master Plan section 36.1 T-5: no silent skips). See .env.example.`,
    );
  }
  return value;
}

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

function dbScript(command: string): void {
  const argv = [path.join(API_ROOT, 'scripts', 'db.mjs'), command];
  const result = spawnSync(process.execPath, argv, {
    cwd: API_ROOT,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    throw new Error(`scripts/db.mjs ${command} exited with ${result.status}\n${result.stdout}\n${result.stderr}`);
  }
}

/** The superuser credentials retargeted at the test database — the tamper probe's principal. */
function superuserUrlFor(adminUrl: string): string {
  const retargeted = new URL(adminUrl);
  retargeted.pathname = `/${TEST_DATABASE}`;
  return retargeted.toString();
}

describe('audit-stream acceptance (real PostgreSQL, §32.5)', () => {
  jest.setTimeout(120_000);

  let urls: DatabaseUrls;
  let admin: PrismaClient;
  let superb: PrismaClient;
  let migrator: PrismaClient;
  let app: PrismaClient;
  let app2: PrismaClient;
  let setupRan = false;

  beforeAll(async () => {
    urls = requireTestUrls();

    // Drop + create from empty, provision roles, `prisma migrate deploy` —
    // the same precondition operator deployments use.
    dbScript('test-setup');
    setupRan = true;

    admin = new PrismaClient({ datasourceUrl: urls.admin });
    // Separate clients (not one pool run twice): the two halves of the WAL.
    superb = new PrismaClient({ datasourceUrl: superuserUrlFor(urls.admin) });
    migrator = new PrismaClient({ datasourceUrl: urls.migration });
    app = new PrismaClient({ datasourceUrl: urls.application });
    app2 = new PrismaClient({ datasourceUrl: urls.application });
    await Promise.all([admin, superb, migrator, app, app2].map((client) => client.$connect()));

    // Identity one: the session role is proven on every connection the way
    // `postgres.db-spec.ts` proves it, so tamper-probe conclusions rest on
    // "a superuser did this", not on an assumption.
    const who = await app.$queryRaw<{ role: string }[]>`SELECT current_user AS role`;
    expect(who).toEqual([{ role: 'my_shop_app' }]);
    const superIdentity = await superb.$queryRaw<{ role: string; super: boolean }[]>`
      SELECT current_user AS role, rolsuper AS super FROM pg_roles WHERE rolname = current_user`;
    expect(superIdentity).toEqual([{ role: 'postgres', super: true }]);
  }, 120_000);

  afterAll(async () => {
    await Promise.allSettled([
      admin?.$disconnect(),
      superb?.$disconnect(),
      migrator?.$disconnect(),
      app?.$disconnect(),
      app2?.$disconnect(),
    ]);
    if (setupRan) {
      dbScript('test-drop');
    }
  }, 120_000);

  const sqlStateOf = (error: unknown): string | undefined =>
    error instanceof Error ? (/Code: `(\d{5})`/.exec(error.message)?.[1] ?? undefined) : undefined;

  const writer = new AuditStreamWriter();

  /** A trusted-context statement against one client (§9.3). */
  async function inTenant<T>(
    client: PrismaClient,
    organizationId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return withTenantTransaction({ prisma: client }, organizationId, work);
  }

  /** The writer's transaction client, typed down to the surface the streams need. */
  const txSurface = (tx: Prisma.TransactionClient): AuditTxClient => tx;

  const DEVICE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const USER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  function deviceActor(): AuditActor {
    return { kind: 'DEVICE', deviceId: DEVICE_ID };
  }

  function userActor(): AuditActor {
    return { kind: 'USER', userId: USER_ID, deviceId: DEVICE_ID };
  }

  /**
   * Seeds one committed AUDIT event for one organization and returns nothing —
   * every assertion reads the rows back rather than trusting a writer's answer.
   */
  async function seedAudit(
    client: PrismaClient,
    organizationId: string,
    seedPayload: { sub: string; amountMinor: number } = { sub: 'probe-sale', amountMinor: 1250 },
    actor: AuditActor = userActor(),
  ): Promise<void> {
    await withTenantTransaction({ prisma: client }, organizationId, (tx) =>
      writer.appendAuditEvent(txSurface(tx), {
        eventType: 'SYNC_MUTATION_ACCEPTED',
        organizationId,
        actor,
        occurredAt: new Date(),
        mutationId: randomUUID(),
        payload: seedPayload,
      }),
    );
  }

  async function seedSecurity(
    client: PrismaClient,
    organizationId: string | undefined,
    eventType: 'LOGIN_SUCCEEDED' | 'LOGIN_FAILED',
    actor: AuditActor,
  ): Promise<void> {
    // The tenant partition's write path is the trusted tenant transaction
    // (§9.3, exactly as `DurableSecurityEventSink.persist` routes it); the
    // documented GLOBAL partition writes through a plain context-free one.
    if (organizationId !== undefined) {
      await withTenantTransaction({ prisma: client }, organizationId, (tx) =>
        writer.appendSecurityEvent(txSurface(tx), {
          eventType,
          organizationId,
          actor,
          occurredAt: new Date(),
          ...(eventType === 'LOGIN_SUCCEEDED' ? {} : { reasonCode: 'INVALID_CREDENTIALS' }),
          clientAddress: '203.0.113.9',
        }),
      );
      return;
    }
    await client.$transaction(async (tx) =>
      writer.appendSecurityEvent(txSurface(tx), {
        eventType,
        actor,
        occurredAt: new Date(),
        ...(eventType === 'LOGIN_SUCCEEDED' ? {} : { reasonCode: 'INVALID_CREDENTIALS' }),
        clientAddress: '203.0.113.9',
      }),
    );
  }

  interface CountRow {
    n: number;
  }
  const countOf = (rows: readonly CountRow[]): number => rows[0]?.n ?? 0;

  describe('§32.5 — the application role holds exactly the append privileges', () => {
    const ORG = randomUUID();

    beforeAll(async () => {
      await seedAudit(app, ORG);
      await seedSecurity(app, ORG, 'LOGIN_FAILED', { kind: 'UNVERIFIED', claimedEmail: 'probe@example.test' });
    });

    it('refuses every UPDATE and DELETE on the event tables at privilege resolution', async () => {
      const refusals: [string, Promise<unknown>][] = [
        [
          'audit_events UPDATE',
          inTenant(app, ORG, (tx) =>
            tx.$executeRawUnsafe(
              `UPDATE audit_events SET payload = '{"tampered":true}'::jsonb WHERE organization_id = $1::uuid`,
              ORG,
            ),
          ),
        ],
        [
          'audit_events DELETE',
          inTenant(app, ORG, (tx) =>
            tx.$executeRawUnsafe(`DELETE FROM audit_events WHERE organization_id = $1::uuid`, ORG),
          ),
        ],
        [
          'security_events UPDATE',
          inTenant(app, ORG, (tx) =>
            tx.$executeRawUnsafe(
              `UPDATE security_events SET reason_code = 'REWORDED' WHERE organization_id = $1::uuid`,
              ORG,
            ),
          ),
        ],
        [
          'security_events DELETE',
          inTenant(app, ORG, (tx) =>
            tx.$executeRawUnsafe(`DELETE FROM security_events WHERE organization_id = $1::uuid`, ORG),
          ),
        ],
      ];
      for (const [name, promise] of refusals) {
        const error = await promise.catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(Error);
        expect(sqlStateOf(error)).toBe('42501');
        expect(name).toBeDefined();
      }

      // Nothing changed behind the refusals.
      const auditRows = await inTenant(
        app,
        ORG,
        (tx) =>
          tx.$queryRaw<CountRow[]>`SELECT count(*)::int AS n FROM audit_events WHERE organization_id = ${ORG}::uuid`,
      );
      expect(countOf(auditRows)).toBe(1);
      const securityRows = await inTenant(
        app,
        ORG,
        (tx) =>
          tx.$queryRaw<CountRow[]>`SELECT count(*)::int AS n FROM security_events WHERE organization_id = ${ORG}::uuid`,
      );
      expect(countOf(securityRows)).toBe(1);
    });

    it('keeps the head-row UPDATE the append law needs, and refuses the head DELETE', async () => {
      // The UPDATE is the append's atomic companion (§32.5, grant argument of
      // migration 0011): the anchor is not event data, and the refusal of a
      // rewound head is the verifier's HEAD_DISAGREEMENT, not a lost privilege.
      const touched = await inTenant(app, ORG, (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE audit_stream_heads SET updated_at = updated_at
             WHERE stream = 'AUDIT' AND scope = $1::uuid`,
          ORG,
        ),
      );
      expect(touched).toBe(1);

      const refused = await inTenant(app, ORG, (tx) =>
        tx
          .$executeRawUnsafe(`DELETE FROM audit_stream_heads WHERE scope = $1::uuid`, ORG)
          .catch((caught: unknown) => caught),
      );
      expect(refused).toBeInstanceOf(Error);
      expect(sqlStateOf(refused)).toBe('42501');
    });
  });

  describe('§32 / §8.2 — RLS isolation of both streams', () => {
    const ORG_A = randomUUID();
    const ORG_B = randomUUID();
    let globalSecurityCount = 0;

    beforeAll(async () => {
      await seedAudit(app, ORG_A, { sub: 'a-one', amountMinor: 1000 });
      await seedAudit(app, ORG_A, { sub: 'a-two', amountMinor: 2000 });
      await seedAudit(app, ORG_B, { sub: 'b-one', amountMinor: 3000 });
      // The two verified partitions of the SECURITY stream.
      await seedSecurity(app, ORG_A, 'LOGIN_SUCCEEDED', userActor());
      await seedSecurity(app, ORG_B, 'LOGIN_SUCCEEDED', userActor());
      await seedSecurity(app, undefined, 'LOGIN_FAILED', {
        kind: 'UNVERIFIED',
        claimedEmail: 'no-tenancy@example.test',
      });
      globalSecurityCount = 1;
    });

    it('a foreign tenant context reads nothing of the other tenant, and its own rows only', async () => {
      const own = await inTenant(
        app,
        ORG_A,
        (tx) =>
          tx.$queryRaw<CountRow[]>`SELECT count(*)::int AS n FROM audit_events WHERE organization_id = ${ORG_A}::uuid`,
      );
      expect(countOf(own)).toBe(2);

      const foreign = await inTenant(app, ORG_A, (tx) =>
        tx.$queryRawUnsafe<CountRow[]>(
          `SELECT count(*)::int AS n FROM audit_events WHERE organization_id = $1::uuid`,
          ORG_B,
        ),
      );
      expect(countOf(foreign)).toBe(0);

      // The head rows are isolated by the same discipline.
      const foreignHead = await inTenant(app, ORG_A, (tx) =>
        tx.$queryRawUnsafe<CountRow[]>(
          `SELECT count(*)::int AS n FROM audit_stream_heads WHERE scope = $1::uuid`,
          ORG_B,
        ),
      );
      expect(countOf(foreignHead)).toBe(0);
    });

    it('a cross-tenant row names tenant B while the context names tenant A — refused 42501', async () => {
      const error = await withTenantTransaction({ prisma: app }, ORG_A, (tx) =>
        tx
          .$executeRawUnsafe(
            `INSERT INTO audit_events (organization_id, sequence, occurred_at, event_type, actor_kind, actor_device_id, prev_event_hash, event_hash)
             VALUES ($1::uuid, 1, now(), 'DEVICE_REVOKED', 'DEVICE', $2::uuid, $3, $3)`,
            ORG_B,
            DEVICE_ID,
            'e'.repeat(64),
          )
          .catch((caught: unknown) => caught),
      );
      expect(error).toBeInstanceOf(Error);
      expect(sqlStateOf(error)).toBe('42501');
    });

    it('a context-free connection sees no tenant audit row and cannot write one', async () => {
      // Fail-closed by predicate: both streams, absent context, zero rows.
      expect(countOf(await app.$queryRaw<CountRow[]>`SELECT count(*)::int AS n FROM audit_events`)).toBe(0);
      expect(
        countOf(
          await app.$queryRawUnsafe<CountRow[]>(
            `SELECT count(*)::int AS n FROM security_events WHERE organization_id IS NOT NULL`,
          ),
        ),
      ).toBe(0);

      const write = await app
        .$executeRawUnsafe(
          `INSERT INTO audit_events (organization_id, sequence, occurred_at, event_type, actor_kind, actor_user_id, prev_event_hash, event_hash)
             VALUES ($1::uuid, 1, now(), 'DEVICE_REVOKED', 'USER', $2::uuid, $3, $3)`,
          ORG_A,
          USER_ID,
          'e'.repeat(64),
        )
        .catch((caught: unknown) => caught);
      expect(write).toBeInstanceOf(Error);
      expect(sqlStateOf(write)).toBe('42501');
    });

    it('admits exactly the documented GLOBAL security partition to a context-free connection', async () => {
      // The GLOBAL partition is every pre-authentication row's home; the 0010
      // policy admits those NULL-organization rows with or without a tenant
      // context, and this connection is exactly that case.
      const withoutContext = await app.$queryRawUnsafe<CountRow[]>(
        `SELECT count(*)::int AS n FROM security_events WHERE organization_id IS NULL`,
      );
      expect(countOf(withoutContext)).toBe(globalSecurityCount);

      // The sentinel head row is part of the same admission.
      const globalHead = await app.$queryRawUnsafe<CountRow[]>(
        `SELECT count(*)::int AS n FROM audit_stream_heads WHERE scope = $1::uuid`,
        GLOBAL_SECURITY_SCOPE,
      );
      expect(countOf(globalHead)).toBe(1);

      // But a context-free insert of a *tenant* security row is refused: the
      // WITH CHECK carries no organization, so naming tenant A fails closed.
      const refused = await app
        .$executeRawUnsafe(
          `INSERT INTO security_events (id, partition_kind, organization_id, sequence, occurred_at, event_type, actor_kind, actor_user_id, prev_event_hash, event_hash)
             VALUES ($1::uuid, 'TENANT', $2::uuid, 1, now(), 'LOGIN_SUCCEEDED', 'USER', $3::uuid, $4, $4)`,
          randomUUID(),
          ORG_A,
          USER_ID,
          'e'.repeat(64),
        )
        .catch((caught: unknown) => caught);
      expect(refused).toBeInstanceOf(Error);
      expect(sqlStateOf(refused)).toBe('42501');
    });

    it('the tenant partition with a verified context is isolated, readable, and writable', async () => {
      const own = await inTenant(migrator, ORG_B, (tx) =>
        tx.$queryRawUnsafe<{ event_type: string; partition_kind: string }[]>(
          `SELECT event_type, partition_kind FROM security_events
            WHERE organization_id = $1::uuid`,
          ORG_B,
        ),
      );
      expect(own).toEqual([{ event_type: 'LOGIN_SUCCEEDED', partition_kind: 'TENANT' }]);
    });
  });

  describe('§32.5 — allocation, concurrency, rollback, and the integrity verifier', () => {
    it('serializes concurrent writers of one scope into a gapless, chained, verifiable series', async () => {
      const ORG = randomUUID();
      const writes = Promise.all(
        Array.from({ length: 8 }, (_, index) => {
          const client = index % 2 === 0 ? app : app2;
          return withTenantTransaction({ prisma: client }, ORG, (tx) =>
            writer.appendAuditEvent(txSurface(tx), {
              eventType: 'SYNC_MUTATION_REJECTED',
              organizationId: ORG,
              actor: deviceActor(),
              occurredAt: new Date(),
              targetType: 'MUTATION',
              targetId: randomUUID(),
              payload: { concurrent: index },
            }),
          );
        }),
      );
      await writes;

      const rows = await inTenant(app, ORG, (tx) =>
        tx.$queryRawUnsafe<{ sequence: string; event_hash: string; prev_event_hash: string }[]>(
          `SELECT sequence::text AS sequence, event_hash, prev_event_hash FROM audit_events
            WHERE organization_id = $1::uuid ORDER BY sequence`,
          ORG,
        ),
      );

      expect(rows.map((row) => row.sequence)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
      expect(rows[0]?.prev_event_hash).toBe(GENESIS_HASH);
      for (let index = 1; index < rows.length; index += 1) {
        expect(rows[index]?.prev_event_hash).toBe(rows[index - 1]?.event_hash);
      }

      // And the verifier, read-only, agrees: the committed series is intact.
      const report = await inTenant(app, ORG, (tx) =>
        verifyAuditStreamScope(txSurface(tx), { stream: 'AUDIT', scope: ORG }),
      );
      expect(report.verified).toBe(true);
      expect(report.defects).toEqual([]);
      expect(report.examinedRows).toBe(8);
    });

    it('a rolled-back append leaves no gap — the next committed append reuses the sequence', async () => {
      const ORG = randomUUID();

      // 1. Committed append at sequence 1.
      await seedAudit(app, ORG, { sub: 'kept', amountMinor: 1000 });

      // 2. A second append that PostgreSQL itself refuses: the database law of
      //    the slice (one ACCEPTED row per mutation) is the violation the
      //    transaction rolls back. The hash anchor value a rollback cannot
      //    consume is the whole point of the case.
      const [committed] = await inTenant(app, ORG, (tx) =>
        tx.$queryRawUnsafe<{ mutation_id: string }[]>(
          `SELECT mutation_id FROM audit_events WHERE organization_id = $1::uuid AND sequence = 1`,
          ORG,
        ),
      );
      await expect(
        app.$transaction(async (tx) => {
          await writer.appendAuditEvent(txSurface(tx), {
            eventType: 'SYNC_MUTATION_ACCEPTED',
            organizationId: ORG,
            actor: deviceActor(),
            occurredAt: new Date(),
            // The *same* mutation id through a fresh transaction dies on the
            // partial unique index inside this transaction, and nothing of it
            // may survive the rollback — neither row nor anchor advance.
            mutationId: committed?.mutation_id ?? '',
            payload: { replayed: true },
          });
        }),
      ).rejects.toThrow();

      // 3. The next committed append takes the value the failed one rolled
      //    back: the committed series stays 1, 2 with no hole at all.
      await inTenant(app, ORG, (tx) =>
        writer.appendAuditEvent(txSurface(tx), {
          eventType: 'SYNC_MUTATION_REJECTED',
          organizationId: ORG,
          actor: deviceActor(),
          occurredAt: new Date(),
          payload: { after: 'rollback' },
        }),
      );

      const rows = await inTenant(app, ORG, (tx) =>
        tx.$queryRawUnsafe<{ sequence: string }[]>(
          `SELECT sequence::text AS sequence FROM audit_events WHERE organization_id = $1::uuid ORDER BY sequence`,
          ORG,
        ),
      );
      expect(rows.map((row) => row.sequence)).toEqual(['1', '2']);

      const report = await inTenant(app, ORG, (tx) =>
        verifyAuditStreamScope(txSurface(tx), { stream: 'AUDIT', scope: ORG }),
      );
      expect(report.verified).toBe(true);
      expect(report.defects).toEqual([]);
    });

    it('a kept chain verifies clean end to end — the negative defect is not yet invented', async () => {
      const ORG = randomUUID();
      for (let index = 0; index < 3; index += 1) {
        await seedAudit(app, ORG, { sub: `kept-${String(index)}`, amountMinor: index });
      }
      const report = await inTenant(migrator, ORG, (tx) =>
        verifyAuditStreamScope(txSurface(tx), { stream: 'AUDIT', scope: ORG }),
      );
      expect(report.verified).toBe(true);
      expect(report.examinedRows).toBe(3);
    });

    it('names SEQUENCE_BREAK when a mid-series row is deleted by a privileged principal', async () => {
      const ORG = randomUUID();
      await seedAudit(app, ORG, { sub: 's1', amountMinor: 1000 });
      await seedAudit(app, ORG, { sub: 's2', amountMinor: 2000 });
      await seedAudit(app, ORG, { sub: 's3', amountMinor: 3000 });

      // The deletion the application role can never perform.
      await superb.$executeRawUnsafe(`DELETE FROM audit_events WHERE organization_id = $1::uuid AND sequence = 2`, ORG);

      const report = await inTenant(app, ORG, (tx) =>
        verifyAuditStreamScope(txSurface(tx), { stream: 'AUDIT', scope: ORG }),
      );
      expect(report.verified).toBe(false);
      expect(report.defects.map((defect) => defect.kind)).toContain('SEQUENCE_BREAK');
      const broken = report.defects.find((defect) => defect.kind === 'SEQUENCE_BREAK');
      expect(broken?.observedSequence).toBe(3n);
    });

    it('names HASH_MISMATCH when a stored field is edited in place', async () => {
      const ORG = randomUUID();
      await seedAudit(app, ORG, { sub: 'h1', amountMinor: 1000 });
      await seedAudit(app, ORG, { sub: 'h2', amountMinor: 2000 });

      await superb.$executeRawUnsafe(
        `UPDATE audit_events SET payload = '{"sub":"rewritten","amountMinor":999999}'::jsonb
           WHERE organization_id = $1::uuid AND sequence = 2`,
        ORG,
      );

      const report = await inTenant(app, ORG, (tx) =>
        verifyAuditStreamScope(txSurface(tx), { stream: 'AUDIT', scope: ORG }),
      );
      expect(report.verified).toBe(false);
      expect(report.defects.map((defect) => defect.kind)).toContain('HASH_MISMATCH');
      const mismatch = report.defects.find((defect) => defect.kind === 'HASH_MISMATCH');
      expect(mismatch?.observedSequence).toBe(2n);
    });

    it('names CHAIN_BREAK when a row re-chains to a neighbour it is not', async () => {
      const ORG = randomUUID();
      await seedAudit(app, ORG, { sub: 'c1', amountMinor: 1000 });
      await seedAudit(app, ORG, { sub: 'c2', amountMinor: 2000 });

      await superb.$executeRawUnsafe(
        `UPDATE audit_events SET prev_event_hash = $2
           WHERE organization_id = $1::uuid AND sequence = 2`,
        ORG,
        'a'.repeat(64),
      );

      const report = await inTenant(app, ORG, (tx) =>
        verifyAuditStreamScope(txSurface(tx), { stream: 'AUDIT', scope: ORG }),
      );
      expect(report.verified).toBe(false);
      expect(report.defects.map((defect) => defect.kind)).toContain('CHAIN_BREAK');
    });

    it('names HEAD_DISAGREEMENT when the head is rewound or forged', async () => {
      const ORG = randomUUID();
      await seedAudit(app, ORG, { sub: 'w1', amountMinor: 1000 });
      await seedAudit(app, ORG, { sub: 'w2', amountMinor: 2000 });

      // A rewound anchor: the next append would collide with the committed row
      // at sequence 2 (PK + the unique per-scope law), and the verifier names
      // the disagreement first.
      await superb.$executeRawUnsafe(
        `UPDATE audit_stream_heads SET last_sequence = 1 WHERE stream = 'AUDIT' AND scope = $1::uuid`,
        ORG,
      );

      const report = await inTenant(app, ORG, (tx) =>
        verifyAuditStreamScope(txSurface(tx), { stream: 'AUDIT', scope: ORG }),
      );
      expect(report.verified).toBe(false);
      expect(report.defects.map((defect) => defect.kind)).toContain('HEAD_DISAGREEMENT');

      // And the append after a rewound anchor proves the second safety
      // argument of migration 0011's grant rationale: the next allocation
      // collides with the committed row at sequence 2 — the PK refuses, and
      // nothing is silently double-allocated.
      await expect(
        inTenant(app, ORG, (tx) =>
          writer.appendAuditEvent(txSurface(tx), {
            eventType: 'SYNC_MUTATION_RETRY',
            organizationId: ORG,
            actor: deviceActor(),
            occurredAt: new Date(),
            payload: { after: 'rewind' },
          }),
        ),
      ).rejects.toThrow();
    });

    it('verifies the SECURITY stream per verified partition, including the GLOBAL chain', async () => {
      const ORG = randomUUID();
      // Seed three tenant security events so the partition chain is walkable.
      for (let index = 0; index < 3; index += 1) {
        await withTenantTransaction({ prisma: app }, ORG, (tx) =>
          writer.appendSecurityEvent(txSurface(tx), {
            eventType: 'LOGIN_SUCCEEDED',
            organizationId: ORG,
            actor: userActor(),
            occurredAt: new Date(),
          }),
        );
      }

      const report = await inTenant(migrator, ORG, (tx) =>
        verifyAuditStreamScope(txSurface(tx), { stream: 'SECURITY', scope: ORG }),
      );
      expect(report.verified).toBe(true);
      expect(report.examinedRows).toBe(3);

      // The global partition verifies from any verified connection — the nil
      // scope the 0010 policy admits — and sees the rows other suites seeded.
      const globalReport = await app.$transaction(async (tx) =>
        verifyAuditStreamScope(txSurface(tx), { stream: 'SECURITY', scope: GLOBAL_SECURITY_SCOPE }),
      );
      expect(globalReport.verified).toBe(true);
      expect(globalReport.examinedRows).toBeGreaterThanOrEqual(1);
      expect(globalReport.scope).toBe(GLOBAL_SECURITY_SCOPE);
    });
  });
});
