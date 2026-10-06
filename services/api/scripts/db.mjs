#!/usr/bin/env node
/**
 * Database workflow wrapper — Master Plan §8.3, §13.4, §35 (slice M1-S3).
 *
 * Three separations are enforced here rather than by convention:
 *
 * - **Role.** The Prisma CLI always runs with `DATABASE_URL` rebound to
 *   `MIGRATION_DATABASE_URL`, so `prisma migrate` executes as the migrator role.
 *   The schema's datasource block stays a single `env("DATABASE_URL")` (§8.3), and
 *   the application role is never a selectable target of this script.
 * - **Privilege.** Role provisioning (`bootstrap`) and test-database lifecycle use
 *   `ADMIN_DATABASE_URL`, which never appears in the schema, in application code,
 *   or in a migration.
 * - **Environment.** `prisma migrate dev` is refused when `NODE_ENV=production`
 *   (§8.3: dev migrations are a local-development command only).
 *
 * The script never prints a connection string. Failures name the environment
 * variable that is missing or wrong, never its value (§13.6, §42.6).
 *
 * Usage (from `services/api`):
 *   node scripts/db.mjs [deploy] [args...]   apply migrations (default)
 *   node scripts/db.mjs dev --name <name>    create a migration (local only)
 *   node scripts/db.mjs status               show applied and pending migrations
 *   node scripts/db.mjs bootstrap            create roles and grants (roles.sql)
 *   node scripts/db.mjs test-setup           recreate the fixed test database
 *   node scripts/db.mjs test-drop            drop the fixed test database
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const apiRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const prismaEntry = require.resolve('prisma/build/index.js');
const rolesSql = path.join(apiRoot, 'prisma', 'roles.sql');

/**
 * The one database the acceptance suite is allowed to destroy.
 *
 * The name is fixed, not derived, so the destructive statements below can only
 * ever name this database, and the URL assertions refuse to run when an operator's
 * `DATABASE_URL` points at anything else — a development or production database
 * can therefore never be dropped by a test run.
 */
const TEST_DATABASE = 'my_shop_test';

const USAGE = `Usage: node scripts/db.mjs <command>

  [deploy] [args...]     prisma migrate deploy (default; args forwarded)
  dev [args...]          prisma migrate dev — refused when NODE_ENV=production
  status [args...]       prisma migrate status
  bootstrap              create/refresh roles and grants from prisma/roles.sql
  test-setup             drop + create ${TEST_DATABASE}, bootstrap, deploy
  test-drop              drop ${TEST_DATABASE}

Required environment (never printed by this script):
  MIGRATION_DATABASE_URL  migrator role, used by deploy/dev/status
  ADMIN_DATABASE_URL      privileged maintenance connection, bootstrap/test-*
  DATABASE_URL            application role; test-* require it to name ${TEST_DATABASE}
`;

/** @param {string} message */
function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/**
 * @param {string} name
 * @returns {string}
 */
function needEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    fail(`${name} is not set. See .env.example; secrets never live in this repository.`);
    // `fail` exits, but Node cannot know that, so a value is still returned for
    // the type checker of any future edit.
    throw new Error(`${name} is not set`);
  }
  return value;
}

/**
 * @param {string} value
 * @param {string} name
 * @returns {URL}
 */
function parseUrl(value, name) {
  try {
    return new URL(value);
  } catch {
    fail(`${name} is not a valid connection URL. See .env.example.`);
    throw new Error(`${name} is not a valid connection URL`);
  }
}

/**
 * Runs the Prisma CLI, forwarding stdio. A non-zero exit ends this process with
 * the same status so `npm run` and CI see the real failure.
 *
 * @param {readonly string[]} args
 * @param {{ input?: string, env?: Record<string, string> }} [options]
 * @returns {void}
 */
function runPrisma(args, options = {}) {
  const { input, env } = options;
  const result = spawnSync(process.execPath, [prismaEntry, ...args], {
    stdio: input === undefined ? ['ignore', 'inherit', 'inherit'] : ['pipe', 'inherit', 'inherit'],
    input,
    env: { ...process.env, ...env },
    windowsHide: true,
  });

  if (result.error !== undefined && result.error !== null) {
    fail(`could not start the Prisma CLI: ${result.error.code ?? result.error.message}`);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

/**
 * `prisma migrate deploy|dev|status`, always as the migrator role.
 *
 * @param {readonly string[]} args  migrate subcommand and its arguments
 * @returns {void}
 */
function runMigrator(args) {
  const migrationUrl = needEnv('MIGRATION_DATABASE_URL');
  runPrisma(['migrate', ...args], { env: { DATABASE_URL: migrationUrl } });
}

/**
 * Applies prisma/roles.sql to the database named by `DATABASE_URL`.
 *
 * The privileged credentials come from `ADMIN_DATABASE_URL` while the target
 * database path comes from `DATABASE_URL`: grants are per-database, so the
 * connection must be privileged *and* aimed at the right database. Both values
 * are read from the environment at runtime and never written down.
 *
 * @returns {void}
 */
function bootstrap() {
  const adminUrl = parseUrl(needEnv('ADMIN_DATABASE_URL'), 'ADMIN_DATABASE_URL');
  const targetUrl = parseUrl(needEnv('DATABASE_URL'), 'DATABASE_URL');
  adminUrl.pathname = targetUrl.pathname;

  runPrisma(['db', 'execute', '--file', rolesSql, '--url', adminUrl.toString()]);
}

/**
 * Guards the destructive test-database commands.
 *
 * Refuses unless `DATABASE_URL` and `MIGRATION_DATABASE_URL` both name the fixed
 * test database and `ADMIN_DATABASE_URL` names a different one. The message names
 * variables and the expected database; it never echoes a value.
 *
 * @returns {void}
 */
function assertTestUrls() {
  const app = parseUrl(needEnv('DATABASE_URL'), 'DATABASE_URL');
  const migrator = parseUrl(needEnv('MIGRATION_DATABASE_URL'), 'MIGRATION_DATABASE_URL');
  const admin = parseUrl(needEnv('ADMIN_DATABASE_URL'), 'ADMIN_DATABASE_URL');

  if (app.pathname !== `/${TEST_DATABASE}` || migrator.pathname !== `/${TEST_DATABASE}`) {
    fail(
      `refusing to touch a database: DATABASE_URL and MIGRATION_DATABASE_URL must both ` +
        `name ${TEST_DATABASE} for test-setup/test-drop, and they do not.`,
    );
  }
  if (admin.pathname === `/${TEST_DATABASE}`) {
    fail(
      `refusing to continue: ADMIN_DATABASE_URL must not name ${TEST_DATABASE} itself — ` +
        `the maintenance connection drops it and cannot be connected to it.`,
    );
  }
}

/** @returns {void} */
function testSetup() {
  assertTestUrls();
  const adminUrl = needEnv('ADMIN_DATABASE_URL');

  // One statement per invocation: `prisma db execute` wraps a multi-statement
  // script in a transaction, and PostgreSQL refuses DROP/CREATE DATABASE there.
  // Both statements are built only from the fixed constant above, so no external
  // input reaches the SQL. FORCE terminates leftover connections so the recreate
  // works even after a crashed test run.
  runPrisma(['db', 'execute', '--url', adminUrl, '--stdin'], {
    input: `DROP DATABASE IF EXISTS ${TEST_DATABASE} WITH (FORCE);\n`,
  });
  runPrisma(['db', 'execute', '--url', adminUrl, '--stdin'], {
    input: `CREATE DATABASE ${TEST_DATABASE};\n`,
  });

  bootstrap();
  runMigrator(['deploy']);
}

/** @returns {void} */
function testDrop() {
  assertTestUrls();
  runPrisma(
    ['db', 'execute', '--url', needEnv('ADMIN_DATABASE_URL'), '--stdin'],
    { input: `DROP DATABASE IF EXISTS ${TEST_DATABASE} WITH (FORCE);\n` },
  );
}

const [, , command = 'deploy', ...rest] = process.argv;

switch (command) {
  case 'deploy':
  case 'status':
    runMigrator([command, ...rest]);
    break;
  case 'dev': {
    if (process.env['NODE_ENV'] === 'production') {
      fail('prisma migrate dev is refused with NODE_ENV=production (Master Plan section 8.3).');
    }
    runMigrator(['dev', ...rest]);
    break;
  }
  case 'bootstrap':
    bootstrap();
    break;
  case 'test-setup':
    testSetup();
    break;
  case 'test-drop':
    testDrop();
    break;
  default:
    process.stderr.write(USAGE);
    process.exit(command === '--help' || command === '-h' ? 0 : 2);
}
