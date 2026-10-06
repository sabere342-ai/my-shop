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
import { PrismaClient } from '@prisma/client';
import { loadConfig } from '../../src/common/config/app.config';
import { PrismaService } from '../../src/common/database/prisma.service';
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
    it('applies every migration and records exactly one applied row', async () => {
      const rows = await migrator.$queryRaw<MigrationRow[]>`
        SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations
      `;

      expect(rows).toHaveLength(1);
      expect(rows[0]?.migration_name).toBe('0001_schema_skeleton');
      expect(rows[0]?.finished_at).not.toBeNull();
      expect(rows[0]?.rolled_back_at).toBeNull();
    });

    it('creates no domain tables — the schema skeleton stays a skeleton', async () => {
      // §39.5: a table exists only for a capability whose slice authorized it.
      // The only table in public may be Prisma's own bookkeeping.
      const rows = await migrator.$queryRaw<NameRow[]>`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
        ORDER BY tablename
      `;

      expect(rows).toEqual([]);
    });

    it('is idempotent: a second deploy applies nothing and succeeds', async () => {
      dbScript('deploy');

      const rows = await migrator.$queryRaw<MigrationRow[]>`SELECT migration_name FROM _prisma_migrations`;
      expect(rows).toHaveLength(1);
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
});
