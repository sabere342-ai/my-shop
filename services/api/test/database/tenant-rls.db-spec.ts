/**
 * M2-S4 acceptance — tenant row-level security against **real PostgreSQL**
 * (Master Plan §8.1–§8.3, §9.3–§9.4, §40.6 slice M2-S4; §36.1 T-2: no mock, no
 * in-memory substitute, no skipped run).
 *
 * The invariants this suite proves, in the vocabulary of the M2-S4 record:
 *
 *  - **AC-01** — every tenant-owned table is protected exactly one way: `ENABLE`
 *    + `FORCE` row-level security with one `tenant_isolation` policy, and the
 *    five explicitly global identity tables carry none, on purpose.
 *  - **AC-02** — the inventory is machine-enforced: the audit query this suite
 *    uses flags *any* table that carries an `organization_id` column without
 *    forced RLS, and the case proves that flag actually fires on a probe table.
 *  - **AC-03** — direct-SQL proofs on the application role, per tenant table: a
 *    missing context sees nothing and writes nothing, a foreign tenant context
 *    neither reads nor mutates another tenant's rows, an ownership-moving
 *    `UPDATE` is refused like an insert, decision D-A's identity scope admits
 *    exactly the caller's own membership edges, decision D-B's bootstrap key
 *    admits exactly its own tenant root — and the identical tenant context
 *    admits everything (the seed itself proves that last part).
 *  - **AC-04** — the context is transaction-local: a committed transaction's
 *    scope dies with it, a rolled-back one never existed, and two concurrent
 *    tenant transactions on one pool cannot see each other's tenant.
 *  - **AC-05** — the application role is not a superuser, carries no
 *    `BYPASSRLS`, and cannot disable the policy, drop it, or write a new one.
 *  - **AC-07** — the fresh-install migration history is exactly `0001`–`0008`.
 *  - **AC-08** — an upgrade from the real predecessor state (`0001`–`0007` with
 *    predecessor-shaped rows already committed) applies `0008`, loses nothing,
 *    and is fail-closed from the first statement after it.
 *  - **AC-11** — pull isolation holds as a database fact: the change feed under
 *    one tenant's context is exactly that tenant's feed.
 *
 * Environment: `DATABASE_URL` and `MIGRATION_DATABASE_URL` must name the fixed
 * test database `my_shop_test`; `ADMIN_DATABASE_URL` must name a different one.
 * Missing or misdirected variables fail the suite with the variable named
 * (§36.1 T-5: no silent skips), and the guard is what makes the destructive
 * recreate safe.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { PrismaClient, type Prisma } from '@prisma/client';
import { hashPassword } from '../../src/common/identity/password';
import {
  establishBootstrapKeyContext,
  establishTenantContext,
  establishUserContext,
  withTenantTransaction,
} from '../../src/common/database/tenant-context';

jest.setTimeout(240_000);

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
      `${name} is not set. The tenant-RLS acceptance suite refuses to run without it ` +
        `(Master Plan section 36.1 T-5: no silent skips). See .env.example.`,
    );
  }
  return value;
}

/** The same §36.1 T-5 guard the M1-S3 suite applies, with the same expectations. */
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

interface DbScriptOptions {
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

/** Runs `scripts/db.mjs <command>` — the operator entry point, never a test shortcut. */
function dbScript(command: string, options: DbScriptOptions = {}): void {
  const argv = [path.join(API_ROOT, 'scripts', 'db.mjs'), command, ...(options.args ?? [])];
  const result = spawnSync(process.execPath, argv, {
    cwd: API_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    throw new Error(`scripts/db.mjs ${command} exited with ${result.status}\n${result.stdout}\n${result.stderr}`);
  }
}

interface ClassifiedRow {
  tablename: string;
  row_security: boolean;
  forced: boolean;
}

interface CountRow {
  n: number;
}

interface MigrationRow {
  migration_name: string;
}

/** The §4 classification, pinned as data so a change must be an explicit edit here. */
const TENANT_ROOT_TABLE = 'organizations';

/** The nine tenant tables whose isolation column is their `organization_id`. */
const TENANT_ORG_TABLES: readonly string[] = [
  'change_log',
  'device_sync_cursors',
  'devices',
  'mutation_ledger',
  'organization_memberships',
  'permission_overrides',
  'role_permissions',
  'roles',
  'sync_sequences',
];

const TENANT_TABLES: readonly string[] = [TENANT_ROOT_TABLE, ...TENANT_ORG_TABLES];

/** Explicitly classified global (record §4, migration header §38–47): no RLS, by decision. */
const GLOBAL_TABLES: readonly string[] = ['auth_throttles', 'refresh_tokens', 'sessions', 'user_credentials', 'users'];

/**
 * The fixture identifiers. Canonical lower-hex UUIDs, because the §8.2 wrapper
 * refuses anything else before a connection is ever opened — the same shape the
 * application's trusted context demands. The tenant root's isolation column is
 * its own `id`, so these ids are simultaneously the membership scope, the
 * foreign-key target, and the seeded root row id — one value, one tenant.
 */
const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const USER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DEVICE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
// The seeded tenant-A device's installation handle (§9.2 T-7): a distinct
// uuid-shaped value, never the device row's own id (§12.3 — the two facts
// must not be conflated even in a fixture).
const DEVICE_INSTALLATION_ID = 'dddddddd-dddd-4ddd-9ddd-dddddddddddd';
const DEVICE_ROGUE_ID = 'dddddddd-dddd-4ddd-8ddd-eddddddddddd';
const ROLE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const MUTATION_ID = 'ffff0000-0000-4000-8000-000000000001';

const BOOTSTRAP_KEY_A = 'rls-tenant-a';
const BOOTSTRAP_KEY_B = 'rls-tenant-b';
const BOOTSTRAP_KEY_C = 'rls-tenant-c';
const ORG_A_NAME = 'RLS Tenant A';
const ORG_B_NAME = 'RLS Tenant B';

/** The seeded payload hash of the one committed ledger row of tenant A. */
const SEEDED_PAYLOAD_HASH = 'a'.repeat(64);

/**
 * One cross-tenant INSERT probe per `organization_id` table: statement and
 * parameters written so the row being written names tenant B while the
 * transaction's trusted context names tenant A. PostgreSQL must answer `42501`.
 */
const CROSS_TENANT_INSERT: ReadonlyMap<string, { sql: string; params: readonly unknown[] }> = new Map([
  [
    'change_log',
    {
      sql: `INSERT INTO change_log (organization_id, server_sequence, mutation_id, entity_type, entity_id, changed_at)
              VALUES ($1::uuid, 99, NULL, 'RLS_PROBE', 'cross-tenant', now())`,
      params: [ORG_B],
    },
  ],
  [
    'device_sync_cursors',
    {
      sql: `INSERT INTO device_sync_cursors (organization_id, device_id, updated_at)
              VALUES ($1::uuid, $2::uuid, now())`,
      params: [ORG_B, DEVICE_ID],
    },
  ],
  [
    'devices',
    {
      sql: `INSERT INTO devices (id, organization_id, installation_id, installation_secret_hash, label, platform)
              VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'Cross-Tenant Device', 'windows')`,
      params: [DEVICE_ROGUE_ID, ORG_B, DEVICE_ID, 'c'.repeat(64)],
    },
  ],
  [
    'mutation_ledger',
    {
      sql: `INSERT INTO mutation_ledger (organization_id, mutation_id, device_id, received_at, payload_hash, status)
              VALUES ($1::uuid, $2::uuid, $3::uuid, now(), $4, 'APPLIED'::mutation_ledger_status)`,
      params: [ORG_B, randomUUID(), DEVICE_ID, 'b'.repeat(64)],
    },
  ],
  [
    'organization_memberships',
    {
      sql: `INSERT INTO organization_memberships (organization_id, user_id, is_owner) VALUES ($1::uuid, $2::uuid, false)`,
      params: [ORG_B, USER_ID],
    },
  ],
  [
    'permission_overrides',
    {
      sql: `INSERT INTO permission_overrides (organization_id, user_id, permission_id, effect)
              VALUES ($1::uuid, $2::uuid, $3, 'ALLOW'::permission_effect)`,
      params: [ORG_B, USER_ID, 'catalog.view'],
    },
  ],
  [
    'role_permissions',
    {
      sql: `INSERT INTO role_permissions (organization_id, role_id, permission_id) VALUES ($1::uuid, $2::uuid, $3)`,
      params: [ORG_B, ROLE_ID, 'catalog.view'],
    },
  ],
  [
    'roles',
    {
      sql: `INSERT INTO roles (organization_id, id, key, name, is_system, is_owner)
              VALUES ($1::uuid, $2::uuid, $3, $4, true, false)`,
      params: [ORG_B, ROLE_ID, 'cashier', 'Cashier of tenant B'],
    },
  ],
  [
    'sync_sequences',
    {
      sql: `INSERT INTO sync_sequences (organization_id, last_sequence) VALUES ($1::uuid, 1)`,
      params: [ORG_B],
    },
  ],
]);

/**
 * The UPDATE that would migrate a tenant A row into tenant B — the
 * ownership-move probe every `WITH CHECK` must refuse exactly as an insert.
 */
const CROSS_TENANT_MOVE: ReadonlyMap<string, { sql: string; params: readonly unknown[] }> = new Map([
  [
    'change_log',
    {
      sql: `UPDATE change_log SET organization_id = $1::uuid WHERE organization_id = $2::uuid`,
      params: [ORG_B, ORG_A],
    },
  ],
  [
    'device_sync_cursors',
    {
      sql: `UPDATE device_sync_cursors SET organization_id = $1::uuid WHERE organization_id = $2::uuid`,
      params: [ORG_B, ORG_A],
    },
  ],
  [
    'devices',
    {
      sql: `UPDATE devices SET organization_id = $1::uuid WHERE organization_id = $2::uuid`,
      params: [ORG_B, ORG_A],
    },
  ],
  [
    'mutation_ledger',
    {
      sql: `UPDATE mutation_ledger SET organization_id = $1::uuid WHERE organization_id = $2::uuid`,
      params: [ORG_B, ORG_A],
    },
  ],
  [
    'organization_memberships',
    {
      sql: `UPDATE organization_memberships SET organization_id = $1::uuid WHERE organization_id = $2::uuid`,
      params: [ORG_B, ORG_A],
    },
  ],
  [
    'permission_overrides',
    {
      sql: `UPDATE permission_overrides SET organization_id = $1::uuid WHERE organization_id = $2::uuid`,
      params: [ORG_B, ORG_A],
    },
  ],
  [
    'role_permissions',
    {
      sql: `UPDATE role_permissions SET organization_id = $1::uuid WHERE organization_id = $2::uuid`,
      params: [ORG_B, ORG_A],
    },
  ],
  [
    'roles',
    { sql: `UPDATE roles SET organization_id = $1::uuid WHERE organization_id = $2::uuid`, params: [ORG_B, ORG_A] },
  ],
  [
    'sync_sequences',
    {
      sql: `UPDATE sync_sequences SET organization_id = $1::uuid WHERE organization_id = $2::uuid`,
      params: [ORG_B, ORG_A],
    },
  ],
]);

describe('tenant row-level security acceptance (real PostgreSQL)', () => {
  let urls: DatabaseUrls;
  let admin: PrismaClient;
  let migrator: PrismaClient;
  let app: PrismaClient;
  let setupRan = false;

  beforeAll(async () => {
    urls = requireTestUrls();

    // Drop + create from empty, provision roles, and deploy the full
    // `0001`–`0009` history: the fresh-install precondition (AC-07).
    dbScript('test-setup');
    setupRan = true;

    admin = new PrismaClient({ datasourceUrl: urls.admin });
    migrator = new PrismaClient({ datasourceUrl: urls.migration });
    app = new PrismaClient({ datasourceUrl: urls.application });
    await Promise.all([admin.$connect(), migrator.$connect(), app.$connect()]);
  }, 120_000);

  afterAll(async () => {
    await Promise.allSettled([admin?.$disconnect(), migrator?.$disconnect(), app?.$disconnect()]);
    if (setupRan) {
      dbScript('test-drop');
    }
  }, 120_000);

  /** A tenant-scoped §9.3 statement on the application role. */
  async function inTenant<T>(organizationId: string, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return withTenantTransaction({ prisma: app }, organizationId, work);
  }

  /**
   * The decision D-A identity scope of the fixture account: a pre-tenant read
   * that makes exactly one verified account's membership edges visible.
   */
  async function inIdentityScope<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return app.$transaction(async (tx) => {
      await establishUserContext(tx, USER_ID);
      return work(tx);
    });
  }

  /** The decision D-B bootstrap scope: exactly one §10.4 key's tenant root. */
  async function underBootstrapKey<T>(
    bootstrapKey: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return app.$transaction(async (tx) => {
      await establishBootstrapKeyContext(tx, bootstrapKey);
      return work(tx);
    });
  }

  /**
   * The SQLSTATE behind a failed raw statement (Prisma carries the driver's
   * five-digit SQLSTATE in the message). `42501` is the row-level-security and
   * insufficient-privilege code every denial below is classified by, and it is
   * asserted as the database's answer rather than a wording detail.
   */
  const sqlStateOf = (error: unknown): string | undefined =>
    error instanceof Error ? (/Code: `(\d{5})`/.exec(error.message)?.[1] ?? undefined) : undefined;

  /** A quoted SQL list over a compile-time constant table name set (no client input). */
  const tableList = (tables: readonly string[]): string => tables.map((table) => `'${table}'`).join(', ');

  /** Runs a parameterized statement in the trusted tenant context of one organization. */
  async function inTenantSql<R>(organizationId: string, sql: string, params: readonly unknown[]): Promise<R[]> {
    return withTenantTransaction({ prisma: app }, organizationId, (tx) => tx.$queryRawUnsafe<R[]>(sql, ...params));
  }

  /** Runs a parameterized statement in the identity scope (decision D-A). */
  async function inIdentityScopeSql<R>(sql: string, params: readonly unknown[]): Promise<R[]> {
    return app.$transaction(async (tx) => {
      await establishUserContext(tx, USER_ID);
      return tx.$queryRawUnsafe<R[]>(sql, ...params);
    });
  }

  /** Runs a parameterized statement in the bootstrap-key scope (decision D-B). */
  async function underBootstrapKeySql<R>(bootstrapKey: string, sql: string, params: readonly unknown[]): Promise<R[]> {
    return app.$transaction(async (tx) => {
      await establishBootstrapKeyContext(tx, bootstrapKey);
      return tx.$queryRawUnsafe<R[]>(sql, ...params);
    });
  }
  /** The `count(*)::int` answer of a parameterized statement, in any scope. */
  function countOf(rows: readonly { n: number }[]): number {
    return rows[0]?.n ?? 0;
  }

  /**
   * The §4 fixture, seeded once through the application role: the seed is
   * itself the AC-03 "identical tenant context admits everything" proof,
   * because under FORCE RLS none of these statements passes without the
   * context it carries. The root rows are admitted through their own D-B
   * credential (see below); everything else is seeded inside the tenant's
   * trusted transaction.
   */
  beforeAll(async () => {
    // Both tenant roots are admitted only through their own D-B credential —
    // the §10.4 bootstrap key — because the root's isolation column is its own
    // `id`, which no transaction can be scoped to before the row exists. That
    // is exactly the admission the real bootstrap composition root uses.
    await underBootstrapKey(BOOTSTRAP_KEY_A, (tx) =>
      tx.$executeRawUnsafe(
        `INSERT INTO organizations (id, name, bootstrap_key) VALUES ($1::uuid, $2, $3)`,
        ORG_A,
        ORG_A_NAME,
        BOOTSTRAP_KEY_A,
      ),
    );
    await underBootstrapKey(BOOTSTRAP_KEY_B, (tx) =>
      tx.$executeRawUnsafe(
        `INSERT INTO organizations (id, name, bootstrap_key) VALUES ($1::uuid, $2, $3)`,
        ORG_B,
        ORG_B_NAME,
        BOOTSTRAP_KEY_B,
      ),
    );

    await inTenant(ORG_A, async (tx) => {
      // The identity account the D-A fixture resolves against. The users
      // table is classified global (no organization_id, no RLS): one plain
      // insert on the application role is exactly how identity data is owned.
      await tx.$executeRawUnsafe(
        `INSERT INTO users (id, email) VALUES ($1::uuid, $2)`,
        USER_ID,
        'rls-fixture@example.test',
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO organization_memberships (organization_id, user_id, is_owner) VALUES ($1::uuid, $2::uuid, false)`,
        ORG_A,
        USER_ID,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO roles (organization_id, id, key, name, is_system, is_owner) VALUES ($1::uuid, $2::uuid, $3, $4, true, false)`,
        ORG_A,
        ROLE_ID,
        'cashier',
        'Cashier',
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO role_permissions (organization_id, role_id, permission_id) VALUES ($1::uuid, $2::uuid, $3)`,
        ORG_A,
        ROLE_ID,
        'catalog.view',
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO permission_overrides (organization_id, user_id, permission_id, effect)
           VALUES ($1::uuid, $2::uuid, $3, 'ALLOW'::permission_effect)`,
        ORG_A,
        USER_ID,
        'catalog.view',
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO mutation_ledger (organization_id, mutation_id, device_id, received_at, payload_hash, status)
           VALUES ($1::uuid, $2::uuid, $3::uuid, now(), $4, 'APPLIED'::mutation_ledger_status)`,
        ORG_A,
        MUTATION_ID,
        DEVICE_ID,
        SEEDED_PAYLOAD_HASH,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO change_log (organization_id, server_sequence, mutation_id, entity_type, entity_id, changed_at)
           VALUES ($1::uuid, 1, $2::uuid, 'RLS_PROBE', 'rls-a-1', now())`,
        ORG_A,
        MUTATION_ID,
      );
      await tx.$executeRawUnsafe(
        // The §12.1 tenant-A device row. Without it the cross-tenant UPDATE
        // probe against `devices` matches zero rows — a no-op UPDATE proves
        // nothing about any `WITH CHECK` — so the fixture owns one real row
        // per its own trusted context, exactly as production registration
        // would write it.
        `INSERT INTO devices (id, organization_id, installation_id, installation_secret_hash, label, platform)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'windows')`,
        DEVICE_ID,
        ORG_A,
        DEVICE_INSTALLATION_ID,
        'd'.repeat(64),
        'RLS Fixture Device',
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO device_sync_cursors (organization_id, device_id, last_pushed_server_sequence, last_pull_server_sequence, updated_at)
           VALUES ($1::uuid, $2::uuid, 1, 3, now())`,
        ORG_A,
        DEVICE_ID,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO sync_sequences (organization_id, last_sequence) VALUES ($1::uuid, 7)`,
        ORG_A,
      );
    });

    // The decision D-A fixture needs a second membership edge of the same
    // account in another tenant, so the identity-scope read can prove it sees
    // the caller's edges across organizations — and nothing of anyone else's.
    await inTenant(ORG_B, (tx) =>
      tx.$executeRawUnsafe(
        `INSERT INTO organization_memberships (organization_id, user_id, is_owner) VALUES ($1::uuid, $2::uuid, false)`,
        ORG_B,
        USER_ID,
      ),
    );
  });

  describe('AC-01: the classification is a database fact', () => {
    it('every tenant-owned table is ENABLE + FORCE row-level security with exactly one tenant_isolation policy', async () => {
      const rows = await migrator.$queryRawUnsafe<ClassifiedRow[]>(
        `SELECT c.relname AS tablename, c.relrowsecurity AS row_security, c.relforcerowsecurity AS forced
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname IN (${tableList(TENANT_TABLES)})
          ORDER BY c.relname`,
      );

      expect(rows.map((row) => row.tablename)).toEqual([...TENANT_TABLES].sort());
      for (const row of rows) {
        expect({ table: row.tablename, row_security: row.row_security, forced: row.forced }).toEqual({
          table: row.tablename,
          row_security: true,
          forced: true,
        });
      }

      // Exactly one policy per protected table, its name fixed, its command
      // ALL — so no table can be "protected" by a narrower default that
      // quietly misses DML, and none carries an extra policy at all.
      const policies = await migrator.$queryRawUnsafe<{ tablename: string; n: number }[]>(
        `SELECT tablename, count(*)::int AS n FROM pg_policies
          WHERE schemaname = 'public' AND tablename IN (${tableList(TENANT_TABLES)})
            AND policyname = 'tenant_isolation' AND cmd = 'ALL'
          GROUP BY tablename`,
      );
      expect(policies).toHaveLength(TENANT_TABLES.length);
      for (const policy of policies) {
        expect(policy.n).toBe(1);
      }
      const extra = await migrator.$queryRawUnsafe<CountRow[]>(
        `SELECT count(*)::int AS n FROM pg_policies
          WHERE schemaname = 'public' AND tablename IN (${tableList(TENANT_TABLES)}) AND policyname <> 'tenant_isolation'`,
      );
      expect(countOf(extra)).toBe(0);
    });

    it('each explicitly global identity table carries no row-level security, on purpose', async () => {
      const rows = await migrator.$queryRawUnsafe<ClassifiedRow[]>(
        `SELECT c.relname AS tablename, c.relrowsecurity AS row_security, c.relforcerowsecurity AS forced
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname IN (${tableList(GLOBAL_TABLES)})
          ORDER BY c.relname`,
      );

      expect(rows.map((row) => row.tablename)).toEqual([...GLOBAL_TABLES].sort());
      for (const row of rows) {
        expect({ table: row.tablename, row_security: row.row_security, forced: row.forced }).toEqual({
          table: row.tablename,
          row_security: false,
          forced: false,
        });
      }

      // And none of them carries any policy: the classification is complete,
      // not "no RLS because nobody wrote a policy yet".
      const policies = await migrator.$queryRawUnsafe<CountRow[]>(
        `SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public' AND tablename IN (${tableList(GLOBAL_TABLES)})`,
      );
      expect(countOf(policies)).toBe(0);
    });
  });

  describe('AC-02: the future-table inventory gate is machine-enforced', () => {
    /**
     * The audit: every table with an `organization_id` column and its RLS
     * attributes. A protected tenant table answers true/true; anything else
     * makes this suite fail — which is the invariant AC-02 pins.
     */
    const tenantColumnAudit = (): Promise<ClassifiedRow[]> =>
      migrator.$queryRawUnsafe<ClassifiedRow[]>(
        `SELECT c.relname AS tablename, c.relrowsecurity AS row_security, c.relforcerowsecurity AS forced
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'
            AND EXISTS (
              SELECT 1 FROM information_schema.columns col
               WHERE col.table_schema = 'public'
                 AND col.table_name = c.relname
                 AND col.column_name = 'organization_id'
            )
          ORDER BY c.relname`,
      );

    it('the audit query sees every organization_id table, and each of them is forced-RLS protected', async () => {
      const rows = await tenantColumnAudit();

      expect(rows.map((row) => row.tablename)).toEqual([...TENANT_ORG_TABLES].sort());
      for (const row of rows) {
        expect({ table: row.tablename, row_security: row.row_security, forced: row.forced }).toEqual({
          table: row.tablename,
          row_security: true,
          forced: true,
        });
      }
    });

    it('actually flags a future tenant-shaped table that nobody protected', async () => {
      // A table the way a future slice would forget to protect it: the right
      // column shape, no policy. Created exactly the way Prisma creates tables
      // (migrator-owned, inherited grants, no RLS).
      await migrator.$executeRawUnsafe(
        `CREATE TABLE rls_inventory_probe (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL)`,
      );

      try {
        const rows = await tenantColumnAudit();
        const probe = rows.find((row) => row.tablename === 'rls_inventory_probe');

        // The gate sees it as unclassified: any future suite that runs this
        // audit as its own expectation fails here until the table gets the
        // same ENABLE + FORCE + policy treatment as its predecessors.
        expect(probe).toBeDefined();
        expect(probe?.row_security).toBe(false);
        expect(probe?.forced).toBe(false);
      } finally {
        await migrator.$executeRawUnsafe(`DROP TABLE rls_inventory_probe`);
      }
    });
  });

  describe('AC-03: direct-SQL proofs on the application role, per tenant table', () => {
    it('a missing context sees nothing in any tenant table, and writes nothing', async () => {
      // A plain pooled connection, no set_config of any kind: every tenant
      // table answers zero — the "no context" half of fail-closed by predicate.
      for (const table of TENANT_ORG_TABLES) {
        const rows = await app.$queryRawUnsafe<CountRow[]>(`SELECT count(*)::int AS n FROM ${table}`);
        expect(countOf(rows)).toBe(0);
      }
      expect(countOf(await app.$queryRawUnsafe<CountRow[]>(`SELECT count(*)::int AS n FROM organizations`))).toBe(0);

      // And a context-free write is refused with the RLS code, never applied:
      // the insert attempts tenant B's data, which no legitimate application
      // action can mint outside a trusted transaction.
      for (const table of TENANT_ORG_TABLES) {
        const insert = CROSS_TENANT_INSERT.get(table);
        if (insert === undefined) {
          throw new Error(`no INSERT probe defined for ${table}`);
        }
        const error = await app.$executeRawUnsafe(insert.sql, ...insert.params).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(Error);
        expect(sqlStateOf(error)).toBe('42501');
      }

      // The tenant root: no context, no root — minting one is refused.
      const minted = await app
        .$executeRawUnsafe(
          `INSERT INTO organizations (id, name, bootstrap_key) VALUES ($1::uuid, $2, $3)`,
          randomUUID(),
          'No Context Tenant',
          'rls-no-context',
        )
        .catch((caught: unknown) => caught);
      expect(minted).toBeInstanceOf(Error);
      expect(sqlStateOf(minted)).toBe('42501');
    });

    it('a foreign tenant context reads nothing of tenant A in any tenant table', async () => {
      for (const table of TENANT_ORG_TABLES) {
        const rows = await inTenantSql<CountRow>(
          ORG_B,
          `SELECT count(*)::int AS n FROM ${table} WHERE organization_id = $1::uuid`,
          [ORG_A],
        );
        expect(countOf(rows)).toBe(0);
      }

      // The root, keyed by its own isolation column (`id`) and its name:
      // tenant B's context sees no tenant A root either way.
      expect(
        countOf(
          await inTenantSql<CountRow>(ORG_B, `SELECT count(*)::int AS n FROM organizations WHERE id = $1::uuid`, [
            ORG_A,
          ]),
        ),
      ).toBe(0);
      expect(
        countOf(
          await inTenantSql<CountRow>(ORG_B, `SELECT count(*)::int AS n FROM organizations WHERE name = $1`, [
            ORG_A_NAME,
          ]),
        ),
      ).toBe(0);
    });

    it('a foreign tenant context deletes nothing of tenant A in any tenant table', async () => {
      for (const table of TENANT_ORG_TABLES) {
        const deleted = await app.$transaction(async (tx) => {
          await establishTenantContext(tx, ORG_B);
          return tx.$executeRawUnsafe(`DELETE FROM ${table} WHERE organization_id = $1::uuid`, ORG_A);
        });
        expect(deleted).toBe(0);
      }

      // And the root again: tenant B's scope removes no tenant A row, by id.
      const deleted = await app.$transaction(async (tx) => {
        await establishTenantContext(tx, ORG_B);
        return tx.$executeRawUnsafe(`DELETE FROM organizations WHERE id = $1::uuid`, ORG_A);
      });
      expect(deleted).toBe(0);
    });

    it('a cross-tenant INSERT — context A, row B — is refused 42501 in every tenant table', async () => {
      for (const table of TENANT_ORG_TABLES) {
        const insert = CROSS_TENANT_INSERT.get(table);
        if (insert === undefined) {
          throw new Error(`no INSERT probe defined for ${table}`);
        }
        const error = await inTenant(ORG_A, (tx) => tx.$executeRawUnsafe(insert.sql, ...insert.params)).catch(
          (caught: unknown) => caught,
        );
        expect(error).toBeInstanceOf(Error);
        expect(sqlStateOf(error)).toBe('42501');
      }

      // The root's two scopes, both refused:
      //  - the *other tenant's bootstrap key* does not authorize another key's
      //    root (WITH CHECK bootstrap-key clause),
      //  - the *other tenant's id* is not this tenant's scope
      //    (WITH CHECK id clause).
      const foreignKey = await underBootstrapKey(BOOTSTRAP_KEY_A, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO organizations (id, name, bootstrap_key) VALUES ($1::uuid, $2, $3)`,
          randomUUID(),
          'Cross Key Tenant',
          BOOTSTRAP_KEY_C,
        ),
      ).catch((caught: unknown) => caught);
      expect(foreignKey).toBeInstanceOf(Error);
      expect(sqlStateOf(foreignKey)).toBe('42501');

      const foreignId = await inTenant(ORG_A, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO organizations (id, name, bootstrap_key) VALUES ($1::uuid, $2, $3)`,
          ORG_B,
          'Cross Id Tenant',
          BOOTSTRAP_KEY_A,
        ),
      ).catch((caught: unknown) => caught);
      expect(foreignId).toBeInstanceOf(Error);
      expect(sqlStateOf(foreignId)).toBe('42501');
    });

    it('an ownership-moving UPDATE — context A, row moved to B — is refused 42501 in every tenant table', async () => {
      for (const table of TENANT_ORG_TABLES) {
        const move = CROSS_TENANT_MOVE.get(table);
        if (move === undefined) {
          throw new Error(`no UPDATE probe defined for ${table}`);
        }
        const error = await inTenant(ORG_A, (tx) => tx.$executeRawUnsafe(move.sql, ...move.params)).catch(
          (caught: unknown) => caught,
        );
        expect(error).toBeInstanceOf(Error);
        expect(sqlStateOf(error)).toBe('42501');
      }

      // A foreign scope cannot rename the root row either: the update simply
      // matches nothing (USING filters it), which is also the no-existence
      // guarantee — nothing was moved, nothing leaked that it exists.
      const renamed = await app.$transaction(async (tx) => {
        await establishTenantContext(tx, ORG_B);
        return tx.$executeRawUnsafe(`UPDATE organizations SET name = 'Hijacked' WHERE id = $1::uuid`, ORG_A);
      });
      expect(renamed).toBe(0);
      const untouched = await inTenantSql<CountRow>(
        ORG_A,
        `SELECT count(*)::int AS n FROM organizations WHERE name = $1`,
        [ORG_A_NAME],
      );
      expect(countOf(untouched)).toBe(1);
    });

    it("decision D-A: the identity scope admits exactly the caller's own membership edges, readable not writable", async () => {
      // The caller's two edges (tenant A and tenant B) — the same data the
      // signed token's organizations claim carries, re-resolvable now.
      const own = await inIdentityScopeSql<CountRow>(
        `SELECT count(*)::int AS n FROM organization_memberships WHERE user_id = $1::uuid`,
        [USER_ID],
      );
      expect(countOf(own)).toBe(2);

      // But the edges of *others* stay invisible even in the caller's own
      // tenant(s): the scope is the row's user clause, not the row's tenant.
      const tenantAScope = await inTenantSql<CountRow>(
        ORG_A,
        `SELECT count(*)::int AS n FROM organization_memberships WHERE organization_id = $1::uuid`,
        [ORG_A],
      );
      expect(countOf(tenantAScope)).toBe(1);

      // And writes remain strictly organization-scoped: an identity scope
      // without a tenant scope can read its edges but write none.
      const write = await inIdentityScope((tx) =>
        tx
          .$executeRawUnsafe(
            `INSERT INTO organization_memberships (organization_id, user_id, is_owner) VALUES ($1::uuid, $2::uuid, false)`,
            ORG_A,
            USER_ID,
          )
          .catch((caught: unknown) => caught),
      );
      expect(write).toBeInstanceOf(Error);
      expect(sqlStateOf(write)).toBe('42501');
    });

    it('decision D-B: the bootstrap key admits exactly its own tenant root, nothing else in the tenant graph', async () => {
      expect(
        countOf(
          await underBootstrapKeySql<CountRow>(
            BOOTSTRAP_KEY_A,
            `SELECT count(*)::int AS n FROM organizations WHERE bootstrap_key = $1`,
            [BOOTSTRAP_KEY_A],
          ),
        ),
      ).toBe(1);
      // Another key's root is invisible through this key's scope, and a
      // membership edge is invisible through any *key* alone (D-B is a root
      // classification credential, not a tenant-wide one).
      expect(
        countOf(
          await underBootstrapKeySql<CountRow>(
            BOOTSTRAP_KEY_A,
            `SELECT count(*)::int AS n FROM organization_memberships WHERE organization_id = $1::uuid`,
            [ORG_A],
          ),
        ),
      ).toBe(0);

      // Writing a *new* root through its own key's scope is the one admission
      // the §10.4 command needs.
      await expect(
        underBootstrapKey(BOOTSTRAP_KEY_C, (tx) =>
          tx.$executeRawUnsafe(
            `INSERT INTO organizations (id, name, bootstrap_key) VALUES ($1::uuid, $2, $3)`,
            randomUUID(),
            'Key C Tenant',
            BOOTSTRAP_KEY_C,
          ),
        ),
      ).resolves.toBe(1);
    });
  });

  describe('AC-04: the trusted context lives and dies with its transaction', () => {
    it("a committed transaction's scope is gone on the next statement of the same pool", async () => {
      // The scope commits and dies: the very next unscoped transaction — the
      // same client, the same pool — sees nothing, which is the pooled
      // connection never inheriting a previous tenant.
      for (const table of TENANT_ORG_TABLES) {
        const rows = await app.$queryRawUnsafe<CountRow[]>(`SELECT count(*)::int AS n FROM ${table}`);
        expect(countOf(rows)).toBe(0);
      }
    });

    it('a rolled-back transaction leaves no scope and no rows', async () => {
      await expect(
        app.$transaction(async (tx) => {
          await establishTenantContext(tx, ORG_A);
          await tx.$executeRawUnsafe(
            `INSERT INTO change_log (organization_id, server_sequence, mutation_id, entity_type, entity_id, changed_at)
               VALUES ($1::uuid, 99, NULL, 'RLS_PROBE', 'rolled-back', now())`,
            ORG_A,
          );
          throw new Error('deliberate rollback');
        }),
      ).rejects.toThrow('deliberate rollback');

      const orphanRows = await app.$queryRawUnsafe<CountRow[]>(`SELECT count(*)::int AS n FROM change_log`);
      expect(countOf(orphanRows)).toBe(0);
    });

    it('two concurrent tenant transactions on one pool are isolated from each other', async () => {
      // Different tenants, same client, concurrently: each transaction sets its
      // own scope and reads only its own tenant's rows, so no scope can leak
      // into a concurrent statement's view of the world.
      const [scopeA, scopeB] = await Promise.all([
        inTenantSql<CountRow>(
          ORG_A,
          `SELECT count(*)::int AS n FROM mutation_ledger WHERE organization_id = $1::uuid`,
          [ORG_A],
        ),
        inTenantSql<CountRow>(
          ORG_B,
          `SELECT count(*)::int AS n FROM mutation_ledger WHERE organization_id = $1::uuid`,
          [ORG_B],
        ),
      ]);
      expect(countOf(scopeA)).toBe(1);
      expect(countOf(scopeB)).toBe(0);
    });

    it('the settings carry no readable value at the connection level between transactions', async () => {
      // PostgreSQL semantics this slice documents: a placeholder GUC a
      // transaction set with `set_config(..., is_local => true)` keeps its
      // name defined on the pooled session after COMMIT — with an empty
      // value — while a session that never set it answers NULL. Both are "no
      // context", and the migration's `NULLIF(current_setting(...), '')`
      // makes empty and absent the same predicate case; the trusted-context
      // wrapper, for its part, never writes a value outside a transaction.
      const settings = await app.$queryRawUnsafe<{ org: string | null; user: string | null; key: string | null }[]>(
        `SELECT current_setting('app.current_organization_id', true) AS org,
                current_setting('app.current_user_id', true) AS user,
                current_setting('app.current_bootstrap_key', true) AS key`,
      );
      for (const value of [settings[0]?.org, settings[0]?.user, settings[0]?.key]) {
        expect(value === null || value === '').toBe(true);
      }
    });
  });

  describe('AC-05: the application role cannot turn the protection off', () => {
    it('is not a superuser and carries no BYPASSRLS', async () => {
      const rows = await migrator.$queryRawUnsafe<{ rolsuper: boolean; rolbypassrls: boolean }[]>(
        `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'my_shop_app'`,
      );
      expect(rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
    });

    it('cannot disable, drop, or add a policy — the owner privilege it holds is not the policy', async () => {
      const disabled = await app
        .$executeRawUnsafe(`ALTER TABLE mutation_ledger DISABLE ROW LEVEL SECURITY`)
        .catch((caught: unknown) => caught);
      expect(disabled).toBeInstanceOf(Error);
      expect(sqlStateOf(disabled)).toBe('42501');

      const dropped = await app
        .$executeRawUnsafe(`DROP POLICY "tenant_isolation" ON "mutation_ledger"`)
        .catch((caught: unknown) => caught);
      expect(dropped).toBeInstanceOf(Error);
      expect(sqlStateOf(dropped)).toBe('42501');

      const added = await app
        .$executeRawUnsafe(
          `CREATE POLICY "rls_probe_policy" ON "mutation_ledger" FOR ALL USING (true) WITH CHECK (true)`,
        )
        .catch((caught: unknown) => caught);
      expect(added).toBeInstanceOf(Error);
      expect(sqlStateOf(added)).toBe('42501');

      // Nothing changed: still enabled, still forced, still the one policy.
      const state = await migrator.$queryRawUnsafe<ClassifiedRow[]>(
        `SELECT c.relname AS tablename, c.relrowsecurity AS row_security, c.relforcerowsecurity AS forced
           FROM pg_class c WHERE c.relname = 'mutation_ledger' AND c.relkind = 'r'`,
      );
      expect(state).toEqual([{ tablename: 'mutation_ledger', row_security: true, forced: true }]);
      const policies = await migrator.$queryRawUnsafe<CountRow[]>(
        `SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'mutation_ledger'`,
      );
      expect(countOf(policies)).toBe(1);
    });
  });

  describe('AC-07: the fresh install applied exactly the nine-path history', () => {
    it('records exactly 0001 through 0009, every one finished and never rolled back', async () => {
      const rows = await migrator.$queryRawUnsafe<MigrationRow[]>(
        `SELECT migration_name FROM _prisma_migrations ORDER BY migration_name`,
      );

      expect(rows.map((row) => row.migration_name)).toEqual([
        '0001_schema_skeleton',
        '0002_mutation_ledger',
        '0003_organizations',
        '0004_bootstrap_key_shape',
        '0005_identity_auth',
        '0006_users_permissions_version',
        '0007_authorization_roles',
        '0008_tenant_row_level_security',
        '0009_device_binding',
      ]);
    });
  });

  describe('AC-11: pull isolation is a database fact', () => {
    it("the change feed under tenant A's scope is exactly tenant A's committed changes", async () => {
      const feed = await inTenantSql<{ entity_id: string }>(
        ORG_A,
        `SELECT entity_id FROM change_log WHERE organization_id = $1::uuid ORDER BY server_sequence`,
        [ORG_A],
      );
      expect(feed.map((row) => row.entity_id)).toEqual(['rls-a-1']);
    });
  });

  describe('AC-08: upgrading a predecessor-state database keeps every row and adds the scope', () => {
    it('seeds real predecessor-shaped data on 0001–0007, applies 0008 and 0009, and loses nothing', async () => {
      const scratchName = 'my_shop_m2s4_upgrade';
      const scratchMigrations = new URL(urls.migration);
      scratchMigrations.pathname = `/${scratchName}`;
      const scratchApplication = new URL(urls.application);
      scratchApplication.pathname = `/${scratchName}`;
      const scratchRoot = mkdtempSync(path.join(tmpdir(), 'my-shop-m2s4-'));
      const scratchSchema = path.join(scratchRoot, 'schema.prisma');

      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`);
      await admin.$executeRawUnsafe(`CREATE DATABASE ${scratchName}`);

      const scratch = new PrismaClient({ datasourceUrl: scratchMigrations.toString() });
      try {
        dbScript('bootstrap', { env: { DATABASE_URL: scratchApplication.toString() } });

        // The predecessor history through 0007 — no organizational graph yet,
        // no RLS yet. Merged migrations are copied, never rewritten (§35.1).
        cpSync(path.join(API_ROOT, 'prisma', 'schema.prisma'), scratchSchema);
        mkdirSync(path.join(scratchRoot, 'migrations'), { recursive: true });
        for (const migration of [
          '0001_schema_skeleton',
          '0002_mutation_ledger',
          '0003_organizations',
          '0004_bootstrap_key_shape',
          '0005_identity_auth',
          '0006_users_permissions_version',
          '0007_authorization_roles',
        ]) {
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

        await scratch.$connect();

        // Predecessor-shaped state: identity rows, credential, session with a
        // token in it, a tenant with an owner membership, the RBAC surface of
        // that tenant, and the offline-mutation surface with real values.
        const argon2Hash = await hashPassword('a-real-argon2id-candidate', {
          memoryKib: 8192,
          timeCost: 1,
          parallelism: 1,
        });
        const seedTimestamp = new Date();
        await scratch.$executeRawUnsafe(
          `INSERT INTO users (id, email) VALUES ($1::uuid, $2)`,
          USER_ID,
          'owner@rls-upgrade.test',
        );
        await scratch.$executeRawUnsafe(
          `INSERT INTO user_credentials (user_id, password_hash) VALUES ($1::uuid, $2)`,
          USER_ID,
          argon2Hash,
        );
        await scratch.$executeRawUnsafe(
          `INSERT INTO sessions (user_id, created_at, last_used_at, absolute_expires_at)
             VALUES ($1::uuid, $2, $2, $3)`,
          USER_ID,
          seedTimestamp,
          new Date(seedTimestamp.getTime() + 86_400_000),
        );
        await scratch.$executeRawUnsafe(
          `INSERT INTO refresh_tokens (session_id, token_hash, issued_at, idle_expires_at)
             SELECT id, $2::text, $3, $4 FROM sessions WHERE user_id = $1::uuid`,
          USER_ID,
          'c'.repeat(64),
          seedTimestamp,
          new Date(seedTimestamp.getTime() + 3_600_000),
        );
        await scratch.$executeRawUnsafe(
          `INSERT INTO auth_throttles (key, failure_count, first_failure_at, last_failure_at, blocked_until)
             VALUES ($1, 3, $2, $2, NULL)`,
          'login:account:owner@rls-upgrade.test',
          seedTimestamp,
        );
        await scratch.$executeRawUnsafe(
          `INSERT INTO organizations (id, name, bootstrap_key) VALUES ($1::uuid, $2, $3)`,
          ORG_A,
          ORG_A_NAME,
          BOOTSTRAP_KEY_A,
        );
        await scratch.$executeRawUnsafe(
          `INSERT INTO organization_memberships (organization_id, user_id, is_owner) VALUES ($1::uuid, $2::uuid, true)`,
          ORG_A,
          USER_ID,
        );
        await scratch.$executeRawUnsafe(
          `INSERT INTO roles (organization_id, id, key, name, is_system, is_owner) VALUES ($1::uuid, $2::uuid, $3, $4, true, false)`,
          ORG_A,
          ROLE_ID,
          'cashier',
          'Seed Cashier',
        );
        await scratch.$executeRawUnsafe(
          `INSERT INTO role_permissions (organization_id, role_id, permission_id) VALUES ($1::uuid, $2::uuid, $3)`,
          ORG_A,
          ROLE_ID,
          'catalog.view',
        );
        await scratch.$executeRawUnsafe(
          `INSERT INTO permission_overrides (organization_id, user_id, permission_id, effect)
             VALUES ($1::uuid, $2::uuid, $3, 'ALLOW'::permission_effect)`,
          ORG_A,
          USER_ID,
          'catalog.view',
        );
        await scratch.$executeRawUnsafe(
          `INSERT INTO mutation_ledger (organization_id, mutation_id, device_id, received_at, payload_hash, status)
             VALUES ($1::uuid, $2::uuid, $3::uuid, now(), $4, 'APPLIED'::mutation_ledger_status)`,
          ORG_A,
          MUTATION_ID,
          DEVICE_ID,
          SEEDED_PAYLOAD_HASH,
        );
        await scratch.$executeRawUnsafe(
          `INSERT INTO change_log (organization_id, server_sequence, mutation_id, entity_type, entity_id, changed_at)
             VALUES ($1::uuid, 1, $2::uuid, 'RLS_PROBE', 'before-m2s4', now())`,
          ORG_A,
          MUTATION_ID,
        );
        await scratch.$executeRawUnsafe(
          `INSERT INTO device_sync_cursors (organization_id, device_id, last_pushed_server_sequence, last_pull_server_sequence, updated_at)
             VALUES ($1::uuid, $2::uuid, 5, 3, now())`,
          ORG_A,
          DEVICE_ID,
        );
        await scratch.$executeRawUnsafe(
          `INSERT INTO sync_sequences (organization_id, last_sequence) VALUES ($1::uuid, 7)`,
          ORG_A,
        );

        // The slice's migration joins the in-use history — the exact file
        // production deploys, byte for byte.
        cpSync(
          path.join(API_ROOT, 'prisma', 'migrations', '0008_tenant_row_level_security'),
          path.join(scratchRoot, 'migrations', '0008_tenant_row_level_security'),
          { recursive: true },
        );
        dbScript('deploy', {
          args: ['--schema', scratchSchema],
          env: { MIGRATION_DATABASE_URL: scratchMigrations.toString() },
        });

        const migrations = await scratch.$queryRawUnsafe<MigrationRow[]>(
          `SELECT migration_name FROM _prisma_migrations ORDER BY migration_name`,
        );
        expect(migrations.map((row) => row.migration_name)).toContain('0008_tenant_row_level_security');

        // The tenant table is now protected (Enabled + Forced)...
        const protectedState = await scratch.$queryRawUnsafe<ClassifiedRow[]>(
          `SELECT c.relname AS tablename, c.relrowsecurity AS row_security, c.relforcerowsecurity AS forced
             FROM pg_class c WHERE c.relname = 'change_log' AND c.relkind = 'r'`,
        );
        expect(protectedState).toEqual([{ tablename: 'change_log', row_security: true, forced: true }]);

        // ...which means a *scanned* unscoped reading now sees zero, and every
        // pre-existing row is still exactly where it was — read back inside
        // the seeds' own scopes.
        expect(countOf(await scratch.$queryRawUnsafe<CountRow[]>(`SELECT count(*)::int AS n FROM change_log`))).toBe(0);

        const survivedFeed = await withTenantTransaction({ prisma: scratch }, ORG_A, (tx) =>
          tx.$queryRawUnsafe<CountRow[]>(
            `SELECT count(*)::int AS n FROM change_log WHERE organization_id = $1::uuid AND entity_id = 'before-m2s4'`,
            ORG_A,
          ),
        );
        expect(countOf(survivedFeed)).toBe(1);

        // Byte-identity of the values the slice must never transform: the
        // ledger payload hash and the campaign state are exactly what they
        // were before the migration ran.
        const ledger = await withTenantTransaction({ prisma: scratch }, ORG_A, (tx) =>
          tx.$queryRawUnsafe<{ payload_hash: string }[]>(
            `SELECT payload_hash FROM mutation_ledger WHERE organization_id = $1::uuid AND mutation_id = $2::uuid`,
            ORG_A,
            MUTATION_ID,
          ),
        );
        expect(ledger[0]?.payload_hash).toBe(SEEDED_PAYLOAD_HASH);

        const sequence = await withTenantTransaction({ prisma: scratch }, ORG_A, (tx) =>
          tx.$queryRawUnsafe<{ last_sequence: string }[]>(
            `SELECT last_sequence::text AS last_sequence FROM sync_sequences WHERE organization_id = $1::uuid`,
            ORG_A,
          ),
        );
        expect(sequence).toEqual([{ last_sequence: '7' }]);

        // The identity tables never got RLS — the classification is the same
        // after an upgrade, not "everyone protected now".
        const globalState = await scratch.$queryRawUnsafe<ClassifiedRow[]>(
          `SELECT c.relname AS tablename, c.relrowsecurity AS row_security, c.relforcerowsecurity AS forced
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname IN (${tableList(GLOBAL_TABLES)})
            ORDER BY c.relname`,
        );
        for (const row of globalState) {
          expect(row.row_security).toBe(false);
          expect(row.forced).toBe(false);
        }

        // M2-S5's migration joins the same in-use history: `devices` arrives
        // with the identical forced-RLS posture, and the pre-existing session
        // rows keep a NULL binding — the upgrade writes no row and binds
        // nobody.
        cpSync(
          path.join(API_ROOT, 'prisma', 'migrations', '0009_device_binding'),
          path.join(scratchRoot, 'migrations', '0009_device_binding'),
          { recursive: true },
        );
        dbScript('deploy', {
          args: ['--schema', scratchSchema],
          env: { MIGRATION_DATABASE_URL: scratchMigrations.toString() },
        });

        const upgradedMigrations = await scratch.$queryRawUnsafe<MigrationRow[]>(
          `SELECT migration_name FROM _prisma_migrations ORDER BY migration_name`,
        );
        expect(upgradedMigrations.map((row) => row.migration_name)).toContain('0009_device_binding');

        const devicesState = await scratch.$queryRawUnsafe<ClassifiedRow[]>(
          `SELECT c.relname AS tablename, c.relrowsecurity AS row_security, c.relforcerowsecurity AS forced
             FROM pg_class c WHERE c.relname = 'devices' AND c.relkind = 'r'`,
        );
        expect(devicesState).toEqual([{ tablename: 'devices', row_security: true, forced: true }]);
        const devicesPolicies = await scratch.$queryRawUnsafe<CountRow[]>(
          `SELECT count(*)::int AS n FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'devices' AND policyname = 'tenant_isolation'`,
        );
        expect(countOf(devicesPolicies)).toBe(1);
        expect(countOf(await scratch.$queryRawUnsafe<CountRow[]>(`SELECT count(*)::int AS n FROM devices`))).toBe(0);

        // And the upgrade moved nothing it must never transform: the 0008
        // assertions above still hold after 0009 applied.
        const survivedFeedAfterUpgrade = await withTenantTransaction({ prisma: scratch }, ORG_A, (tx) =>
          tx.$queryRawUnsafe<CountRow[]>(`SELECT count(*)::int AS n FROM change_log WHERE entity_id = 'before-m2s4'`),
        );
        expect(countOf(survivedFeedAfterUpgrade)).toBe(1);
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
  });
});
