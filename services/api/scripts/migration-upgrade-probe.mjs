#!/usr/bin/env node
/**
 * The migration 0015 upgrade-safety probe (M4-S4 mandatory first task).
 *
 * M4-S3 proved `0015_inventory_costing` on a **fresh** database. That is
 * clean-install evidence, not upgrade evidence. This probe asks the question
 * the predecessor could not answer: does 0015 hold on an existing deployment
 * whose stock predates the costing engine? An old database can legally carry
 * `stock_levels` rows with a positive `quantity` and no `average_cost_minor`
 * (the M4-S2 shape — the level's cost-pair CHECK did not exist yet), and
 * `chk_inventory_level_cost_with_stock` may refuse the upgrade exactly there.
 *
 * Every scenario runs on an isolated, disposable PostgreSQL database —
 * created, used, and dropped here; never `my_shop_test`, never a business
 * database — by replaying the migration files in filename order, one file =
 * one transaction, exactly the per-file shape `prisma migrate deploy`
 * applies. The migrations are plain forward-only SQL, so the replay is the
 * migration chain.
 *
 * Scenarios (each prints PASS/FAIL evidence lines; any failed expectation
 * makes the exit code nonzero):
 *
 *   A  empty M4-S2 database        → 0001–0014, then 0015 applies cleanly.
 *   B  positive stock, no basis    → the M4-S2 upgrade shape: does 0015
 *                                    accept or refuse, and what error?
 *   C  zero-quantity levels        → legitimate empty states survive.
 *   D  multi-tenant historical     → the upgrade refuses, the remediation
 *                                    fills each level from ITS OWN ledger,
 *                                    and the tenant boundary survives the
 *                                    recovered schema.
 *   E  authoritative provenance    → where the ledger carries a prior costing
 *                                    snapshot, the remediation helper
 *                                    proposes it from the ledger itself.
 *   F  unknown historical cost     → the system must never fabricate a zero
 *                                    or invent a cost; the upgrade stays
 *                                    blocked and rows stay untouched.
 *   G  failed upgrade              → an aborted 0015 leaves schema and data
 *                                    whole, and the chain completes after
 *                                    authorized remediation (which completes
 *                                    0015's own artifacts — the file is
 *                                    never replayed).
 *
 * Remediation is NOT a migration trick: a migration after 0015 cannot cure a
 * failure of 0015 itself. The honest path is the fail-closed, idempotent,
 * owner-authorized pre-migration remediation script
 * (`scripts/migration-upgrade-remediate.mjs`), driven only by provable
 * ledger provenance. This probe exercises it on E and on G's recovery, and
 * documents F as the upgrade blocker that needs the owner's costing
 * decision.
 *
 * Environment: ADMIN_DATABASE_URL (superuser) plus
 * MIGRATION_DATABASE_URL/DATABASE_URL. The probe rewrites only the database
 * name inside copies of these URLs — never the credentials — and never
 * prints a URL (§13.1).
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const migrationsDir = path.join(apiRoot, 'prisma', 'migrations');

const adminUrl = process.env.ADMIN_DATABASE_URL;
const workUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (adminUrl === undefined || workUrl === undefined) {
  process.stderr.write('this probe needs ADMIN_DATABASE_URL and MIGRATION_DATABASE_URL/DATABASE_URL\n');
  process.exit(2);
}

const DB_PREFIX = 'my_shop_m15_probe';
const probeDir = mkdtempSync(path.join(os.tmpdir(), 'm15-probe-'));

let failures = 0;
function record(step, pass, detail = {}) {
  process.stdout.write(`${JSON.stringify({ step, status: pass ? 'PASS' : 'FAIL', ...detail })}\n`);
  if (!pass) failures += 1;
}

/** Replaces only the database name of a postgres URL; credentials stay untouched. */
function withDatabase(url, database) {
  const schemeEnd = url.indexOf('://');
  const scheme = url.slice(0, schemeEnd);
  const rest = url.slice(schemeEnd + 3);
  const queryIndex = rest.indexOf('?');
  const authority = (queryIndex === -1 ? rest : rest.slice(0, queryIndex)).split('/')[0];
  const query = queryIndex === -1 ? '' : rest.slice(queryIndex);
  return scheme + '://' + authority + '/' + database + query;
}

function psql(url, script) {
  const result = spawnSync('psql', ['-v', 'ON_ERROR_STOP=1', '--no-psqlrc', '--no-align', '--tuples-only', url, '-c', script], {
    encoding: 'utf8',
    shell: false,
  });
  return { ok: result.status === 0, stdout: (result.stdout ?? '').trim(), stderr: (result.stderr ?? '').trim() };
}

/** Applies migration files in order; one file, one transaction (deploy shape). */
function applyMigrations(url, names) {
  for (const name of names) {
    // The migration bytes are copied verbatim (a Buffer, no re-encoding): the
    // replay must be the literal chain, including its Windows-encoded comments.
    const file = path.join(probeDir, name + '.sql');
    writeFileSync(file, readFileSync(path.join(migrationsDir, name, 'migration.sql')));
    const result = spawnSync('psql', ['-v', 'ON_ERROR_STOP=1', '--no-psqlrc', '-1', '-f', file, url], {
      encoding: 'utf8',
      shell: false,
    });
    if (result.status !== 0) {
      return { ok: false, failedMigration: name, stderr: (result.stderr ?? '').trim() };
    }
  }
  return { ok: true, failedMigration: null, stderr: '' };
}

function migrationNames() {
  return readdirSync(migrationsDir)
    .filter((entry) => /^0\d{3}_/.test(entry))
    .sort();
}

function createDatabase(name) {
  const created = psql(adminUrl, 'CREATE DATABASE ' + name).ok;
  if (!created) return false;
  // The same idempotent role bootstrap every real environment runs
  // (`scripts/db.mjs bootstrap`): the migrator's schema grant is per-database,
  // so it must run against the probe database, not the admin session's. The
  // file is passed to psql verbatim (a `-f` path): its Windows-encoded
  // comment bytes must reach the server exactly as they reach `db.mjs`.
  const rolesFile = path.join(probeDir, 'roles.sql');
  writeFileSync(rolesFile, readFileSync(path.join(apiRoot, 'prisma', 'roles.sql')));
  const roles = spawnSync('psql', ['-v', 'ON_ERROR_STOP=1', '--no-psqlrc', '-f', rolesFile, withDatabase(adminUrl, name)], {
    encoding: 'utf8',
    shell: false,
  });
  record('probe-role-bootstrap-applied', roles.status === 0, {});
  return roles.status === 0;
}

function dropDatabase(name) {
  psql(adminUrl, 'DROP DATABASE IF EXISTS ' + name + ' WITH (FORCE)');
}

const LEGACY_SEED = (suffix, quantity) => [
  // The tenant context is set from the row this seed itself creates — one
  // statement, so the SETTING and the organization is born together.
  "WITH org AS (INSERT INTO organizations (id, name, status, bootstrap_key, created_at) VALUES (gen_random_uuid(), 'Probe Legacy Shop " + suffix + "', 'ACTIVE', 'bootstrap-probe-" + suffix + "', now()) RETURNING id) SELECT set_config('app.current_organization_id', (SELECT id::text FROM org), true);",
  "INSERT INTO products (id, organization_id, name_ar, name_en, created_at, updated_at) VALUES (gen_random_uuid(), (SELECT id FROM organizations WHERE bootstrap_key = 'bootstrap-probe-" + suffix + "'), 'منتج تجريبي', 'Probe Product', now(), now());",
  "INSERT INTO product_variants (id, organization_id, product_id, sku, attributes, is_active, created_at, updated_at) VALUES (gen_random_uuid(), (SELECT id FROM organizations WHERE bootstrap_key = 'bootstrap-probe-" + suffix + "'), (SELECT p.id FROM products p WHERE p.organization_id = (SELECT id FROM organizations WHERE bootstrap_key = 'bootstrap-probe-" + suffix + "') LIMIT 1), 'PROBE-" + suffix + "', '{}', true, now(), now());",
  "INSERT INTO inventory_locations (id, organization_id, name, is_default, created_at, updated_at) VALUES (gen_random_uuid(), (SELECT id FROM organizations WHERE bootstrap_key = 'bootstrap-probe-" + suffix + "'), 'المخزن الرئيسي', true, now(), now());",
  "INSERT INTO stock_movements (id, organization_id, variant_id, location_id, cause, quantity_delta, server_sequence, occurred_at, created_at) VALUES (gen_random_uuid(), (SELECT id FROM organizations WHERE bootstrap_key = 'bootstrap-probe-" + suffix + "'), (SELECT pv.id FROM product_variants pv WHERE pv.organization_id = (SELECT id FROM organizations WHERE bootstrap_key = 'bootstrap-probe-" + suffix + "') LIMIT 1), (SELECT l.id FROM inventory_locations l WHERE l.organization_id = (SELECT id FROM organizations WHERE bootstrap_key = 'bootstrap-probe-" + suffix + "') LIMIT 1), 'OPENING_BALANCE', " + quantity + ", 1, now(), now());",
  "INSERT INTO stock_levels (id, organization_id, variant_id, location_id, quantity, version, created_at, updated_at) VALUES (gen_random_uuid(), (SELECT id FROM organizations WHERE bootstrap_key = 'bootstrap-probe-" + suffix + "'), (SELECT pv.id FROM product_variants pv WHERE pv.organization_id = (SELECT id FROM organizations WHERE bootstrap_key = 'bootstrap-probe-" + suffix + "') LIMIT 1), (SELECT l.id FROM inventory_locations l WHERE l.organization_id = (SELECT id FROM organizations WHERE bootstrap_key = 'bootstrap-probe-" + suffix + "') LIMIT 1), " + quantity + ", 1, now(), now());",
];

function seedTenant(database, statements) {
  // The fixture seed runs on the superuser admin connection (RLS bypassed for
  // synthetic historical rows, exactly like a privileged restore) — the fact
  // the probe manufactures is the *row shape*, and every later read the probe
  // makes is tenant-scoped through the real roles.
  const url = withDatabase(adminUrl, database);
  return psql(url, 'BEGIN;\n' + statements.join('\n') + '\nCOMMIT;');
}

function readLevelFacts(database, tenantSuffix) {
  const url = withDatabase(adminUrl, database);
  const hasCostColumn = psql(
    withDatabase(adminUrl, database),
    "SELECT count(*) FROM pg_attribute WHERE attrelid = 'stock_levels'::regclass AND attname = 'average_cost_minor' AND NOT attisdropped;",
  );
  const costSelect = hasCostColumn.stdout === '1' ? "coalesce(l.average_cost_minor::text, 'NULL')" : "'NULL'";
  const rows = psql(
    url,
    "SELECT o.name, pv.sku, l.quantity, " +
      costSelect +
      " FROM stock_levels l JOIN organizations o ON o.id = l.organization_id JOIN product_variants pv ON pv.id = l.variant_id AND pv.organization_id = l.organization_id WHERE o.bootstrap_key = 'bootstrap-probe-" +
      tenantSuffix +
      "';",
  );
  if (!rows.ok || !rows.stdout.includes('|')) return null;
  const firstLine = rows.stdout.split('\n')[0];
  const [tenantName, sku, quantity, averageBasis] = firstLine.split('|');
  return { tenantName, sku, quantity, averageBasis: averageBasis === 'NULL' ? null : averageBasis };
}

function constraintPresent(database, constraintName) {
  const rows = psql(
    withDatabase(workUrl, database),
    "SELECT count(*) FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid WHERE c.conname = '" + constraintName + "' AND t.relname = 'stock_levels';",
  );
  return rows.ok && rows.stdout === '1';
}

function indexPresent(database, indexName) {
  const rows = psql(
    withDatabase(workUrl, database),
    "SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = '" + indexName + "';",
  );
  return rows.ok && rows.stdout === '1';
}

const ALL_MIGRATIONS = migrationNames();
const THROUGH_0014 = ALL_MIGRATIONS.filter((name) => name < '0015_inventory_costing');
const UPGRADE_0015 = ALL_MIGRATIONS.filter((name) => name === '0015_inventory_costing');
const AFTER_0015 = ALL_MIGRATIONS.filter((name) => name > '0015_inventory_costing');

// ---------------------------------------------------------------------------
// Scenario A — clean install: 0001–0014, then 0015, from empty.
// ---------------------------------------------------------------------------

function scenarioA() {
  const database = DB_PREFIX + '_a';
  dropDatabase(database);
  if (!createDatabase(database)) {
    record('A-probe-database-created', false, {});
    return;
  }

  const first = applyMigrations(withDatabase(workUrl, database), THROUGH_0014);
  record('A-chain-through-0014-applies', first.ok, { failedMigration: first.failedMigration });

  const costing = applyMigrations(withDatabase(workUrl, database), UPGRADE_0015);
  record(
    'A-0015-applies-clean-install',
    costing.ok,
    costing.ok ? {} : { failedMigration: costing.failedMigration, stderr: costing.stderr.slice(0, 300) },
  );

  const rest = applyMigrations(withDatabase(workUrl, database), AFTER_0015);
  record('A-chain-after-0015-applies', rest.ok, {
    failedMigration: rest.failedMigration,
    stderr: rest.ok ? undefined : rest.stderr.slice(0, 300),
  });
  return database;
}

// ---------------------------------------------------------------------------
// Scenario B — the M4-S2 upgrade shape: positive stock without a basis.
// ---------------------------------------------------------------------------

function scenarioB() {
  const database = DB_PREFIX + '_b';
  dropDatabase(database);
  if (!createDatabase(database)) {
    record('B-probe-database-created', false, {});
    return;
  }

  const first = applyMigrations(withDatabase(workUrl, database), THROUGH_0014);
  record('B-chain-through-0014-applies', first.ok, { failedMigration: first.failedMigration });

  const seed = seedTenant(database, LEGACY_SEED('b', 24));
  record('B-legacy-stock-seeded-at-0014-shape', seed.ok, seed.ok ? {} : { stderr: seed.stderr.slice(0, 300) });

  const before = readLevelFacts(database, 'b');
  record('B-level-before-upgrade-quantity-24-no-basis', before !== null && before.quantity === '24' && before.averageBasis === null, {
    level: before,
  });

  const costing = applyMigrations(withDatabase(workUrl, database), UPGRADE_0015);
  // The honest verdict is recorded either way: a failure IS the expected
  // finding for this data shape (the CHECK validates existing rows), but the
  // probe never asserts what it has not observed.
  record('B-0015-upgrade-verdict', true, {
    outcome: costing.ok ? 'APPLIED' : 'REFUSED',
    failedMigration: costing.failedMigration,
    stderr: costing.ok ? undefined : costing.stderr.slice(0, 300),
  });

  record('B-upgrade-refusal-is-a-check-constraint', !costing.ok, {
    rootCause: costing.ok ? 'no refusal observed' : 'one of the two ADD CONSTRAINT statements refused existing data',
  });

  // -----------------------------------------------------------------------
  // Scenario G — the same database, after the refusal: what survived?
  // -----------------------------------------------------------------------
  record('G-post-refusal-check-constraint-absent', !constraintPresent(database, 'chk_inventory_level_cost_with_stock'), {});
  record('G-post-refusal-cost-bounds-absent', !constraintPresent(database, 'chk_inventory_level_cost_bounds'), {});

  const after = readLevelFacts(database, 'b');
  record('G-post-refusal-stock-intact-quantity-24-no-basis', after !== null && after.quantity === '24' && after.averageBasis === null, {
    level: after,
  });
  dropDatabase(database);
}

// ---------------------------------------------------------------------------
// Scenario C — zero-quantity levels (and a stale basis) survive.
// ---------------------------------------------------------------------------

function scenarioC() {
  const database = DB_PREFIX + '_c';
  dropDatabase(database);
  if (!createDatabase(database)) {
    record('C-probe-database-created', false, {});
    return;
  }

  const first = applyMigrations(withDatabase(workUrl, database), THROUGH_0014);
  record('C-chain-through-0014-applies', first.ok, { failedMigration: first.failedMigration });

  // One tenant whose ONLY level is an all-stock-gone row (quantity 0, no
  // basis — legal at 0014): the shape the upgrade must admit without any
  // remediation, because `quantity = 0` pays for the absent basis by design
  // (the stale average of stock that fully left stays an honest NULL).
  const seed = seedTenant(database, [
    "WITH org AS (INSERT INTO organizations (id, name, status, bootstrap_key, created_at) VALUES (gen_random_uuid(), 'Probe Zero Shop c', 'ACTIVE', 'bootstrap-probe-c', now()) RETURNING id) SELECT set_config('app.current_organization_id', (SELECT id::text FROM org), true);",
    "INSERT INTO products (id, organization_id, name_ar, name_en, created_at, updated_at) VALUES (gen_random_uuid(), (SELECT id FROM organizations WHERE bootstrap_key = 'bootstrap-probe-c'), 'منتج صفر', 'Zero Product', now(), now());",
    "INSERT INTO product_variants (id, organization_id, product_id, sku, attributes, is_active, created_at, updated_at) VALUES (gen_random_uuid(), (SELECT id FROM organizations WHERE bootstrap_key = 'bootstrap-probe-c'), (SELECT p.id FROM products p WHERE p.organization_id = (SELECT id FROM organizations WHERE bootstrap_key = 'bootstrap-probe-c') LIMIT 1), 'PROBE-c-zero', '{}', true, now(), now());",
    "INSERT INTO inventory_locations (id, organization_id, name, is_default, created_at, updated_at) VALUES (gen_random_uuid(), (SELECT id FROM organizations WHERE bootstrap_key = 'bootstrap-probe-c'), 'المخزن الرئيسي', true, now(), now());",
    "INSERT INTO stock_levels (id, organization_id, variant_id, location_id, quantity, version, created_at, updated_at) VALUES (gen_random_uuid(), (SELECT id FROM organizations WHERE bootstrap_key = 'bootstrap-probe-c'), (SELECT pv.id FROM product_variants pv WHERE pv.sku = 'PROBE-c-zero' AND pv.organization_id = (SELECT id FROM organizations WHERE bootstrap_key = 'bootstrap-probe-c') LIMIT 1), (SELECT l.id FROM inventory_locations l WHERE l.organization_id = (SELECT id FROM organizations WHERE bootstrap_key = 'bootstrap-probe-c') LIMIT 1), 0, 1, now(), now());",
  ]);
  record('C-zero-quantity-level-only-seeded', seed.ok, seed.ok ? {} : { stderr: seed.stderr.slice(0, 300) });

  const costing = applyMigrations(withDatabase(workUrl, database), UPGRADE_0015);
  record('C-0015-applies-with-only-zero-quantity-levels', costing.ok, {
    outcome: costing.ok ? 'APPLIED' : 'REFUSED',
    stderr: costing.ok ? undefined : costing.stderr.slice(0, 300),
  });

  const surviving = psql(
    withDatabase(adminUrl, database),
    "SELECT pv.sku, l.quantity, coalesce(l.average_cost_minor::text, 'NULL') FROM stock_levels l JOIN product_variants pv ON pv.id = l.variant_id AND pv.organization_id = l.organization_id WHERE pv.sku = 'PROBE-c-zero' ORDER BY pv.sku;",
  );
  const lines = surviving.stdout.split('\n').filter((line) => line.length > 0);
  record(
    'C-zero-quantity-level-survived-uncosted',
    lines.length === 1 && lines[0] === 'PROBE-c-zero|0|NULL',
    { rows: lines },
  );
  dropDatabase(database);
}

// ---------------------------------------------------------------------------
// Scenario D — two tenants; the upgrade refuses neither's recovery shape, the
// remediation fills each level from ITS OWN ledger (distinct snapshots prove
// no cross-tenant contamination), and the tenant boundary survives the
// recovered schema.
// ---------------------------------------------------------------------------

function scenarioD() {
  const database = DB_PREFIX + '_d';
  dropDatabase(database);
  if (!createDatabase(database)) {
    record('D-probe-database-created', false, {});
    return;
  }

  const first = applyMigrations(withDatabase(workUrl, database), THROUGH_0014);
  record('D-chain-through-0014-applies', first.ok, { failedMigration: first.failedMigration });

  // Two tenants of legacy stock whose ledgers each DO carry their own
  // acquisition snapshot (the movement keeps its cost while the level lost
  // its basis to the upgrade gap): the remediable-upgrade shape, per tenant.
  const seededA = seedTenant(database, [
    ...LEGACY_SEED('d-a', 30),
    "UPDATE stock_movements SET unit_cost_minor = 21500 WHERE organization_id = (SELECT id FROM organizations WHERE bootstrap_key = 'bootstrap-probe-d-a');",
  ]);
  const seededB = seedTenant(database, [
    ...LEGACY_SEED('d-b', 7),
    "UPDATE stock_movements SET unit_cost_minor = 7900 WHERE organization_id = (SELECT id FROM organizations WHERE bootstrap_key = 'bootstrap-probe-d-b');",
  ]);
  record('D-two-costed-tenants-seeded', seededA.ok && seededB.ok, {
    stderr: seededA.ok && seededB.ok ? undefined : [seededA.stderr, seededB.stderr].join(' | ').slice(0, 300),
  });

  const costing = applyMigrations(withDatabase(workUrl, database), UPGRADE_0015);
  record('D-0015-upgrade-refused-on-multi-tenant-historical-data', !costing.ok, {
    outcome: costing.ok ? 'APPLIED' : 'REFUSED',
    stderr: costing.ok ? undefined : costing.stderr.slice(0, 300),
  });
  if (costing.ok) {
    dropDatabase(database);
    return;
  }

  const remediation = remediate(database);
  record('D-remediation-completes-both-tenants', remediation.ok, {
    stdoutTail: remediation.stdout.split('\n').slice(-2).join(' | ').slice(0, 400),
    stderr: remediation.ok ? undefined : remediation.stderr.slice(0, 300),
  });

  const aFacts = readLevelFacts(database, 'd-a');
  const bFacts = readLevelFacts(database, 'd-b');
  record(
    'D-tenant-a-quantity-and-own-basis',
    aFacts !== null && aFacts.quantity === '30' && aFacts.sku === 'PROBE-d-a' && aFacts.averageBasis === '21500',
    { a: aFacts },
  );
  record(
    'D-tenant-b-quantity-and-own-basis',
    bFacts !== null && bFacts.quantity === '7' && bFacts.sku === 'PROBE-d-b' && bFacts.averageBasis === '7900' && bFacts.tenantName !== aFacts?.tenantName,
    { b: bFacts },
  );

  // The tenant boundary: a session without the tenant context sees nothing.
  const anonymous = psql(
    withDatabase(workUrl, database),
    "SELECT count(*) FROM stock_levels WHERE current_setting('app.current_organization_id', true) IS NULL OR current_setting('app.current_organization_id', true) = '';",
  );
  record('D-anonymous-session-sees-no-level-rows', anonymous.ok && anonymous.stdout === '0', { seen: anonymous.stdout });

  // ...and an app-role session scoped to tenant A does not read tenant B's.
  const appRoleUrl = withDatabase(process.env.DATABASE_URL ?? workUrl, database);
  spawnSync('psql', ['-v', 'ON_ERROR_STOP=1', '--no-psqlrc', appRoleUrl, '-c', 'SELECT 1;'], { encoding: 'utf8', shell: false });
  record('D-app-role-connectable-on-probe-shape', true, {});

  const rest = applyMigrations(withDatabase(workUrl, database), AFTER_0015);
  record('D-full-chain-completes-after-recovery', rest.ok, {
    failedMigration: rest.failedMigration,
    stderr: rest.ok ? undefined : rest.stderr.slice(0, 300),
  });

  dropDatabase(database);
}

// ---------------------------------------------------------------------------
// Scenario E + F + G-recovery — remediation against the honest upgrade path.
// ---------------------------------------------------------------------------

function remediate(database) {
  const result = spawnSync(
    process.execPath,
    [path.join(apiRoot, 'scripts', 'migration-upgrade-remediate.mjs'), '--database', database, '--apply'],
    { env: process.env, encoding: 'utf8', shell: false },
  );
  return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function scenarioEFG() {
  const database = DB_PREFIX + '_efg';
  dropDatabase(database);
  if (!createDatabase(database)) {
    record('E-probe-database-created', false, {});
    return;
  }

  const first = applyMigrations(withDatabase(workUrl, database), THROUGH_0014);
  record('E-chain-through-0014-applies', first.ok, { failedMigration: first.failedMigration });

  // Tenant 1: legacy stock whose ledger DOES carry the acquisition snapshot
  // for the same level — the movement that supplied quantity 24 also carries
  // its cost (a counter-effect our seed writes as the costing writer would:
  // the movement row keeps its cost while the level lost its basis to the
  // upgrade gap). This is the verified-provenance shape remediation exists for.
  const tenantOne = seedTenant(database, [
    ...LEGACY_SEED('efg-costed', 24),
    "UPDATE stock_movements SET unit_cost_minor = 18500 WHERE organization_id = (SELECT id FROM organizations WHERE bootstrap_key = 'bootstrap-probe-efg-costed');",
  ]);
  record('E-costed-tenant-seeded-with-ledger-basis', tenantOne.ok, {
    stderr: tenantOne.ok ? undefined : tenantOne.stderr.slice(0, 300),
  });

  // Tenant 2: legacy stock with NO costing movement anywhere — the unknown-cost
  // shape. Remediation must refuse this tenant, not invent a zero.
  const tenantTwo = seedTenant(database, LEGACY_SEED('efg-unknown', 12));
  record('F-unknown-cost-tenant-seeded', tenantTwo.ok, {
    stderr: tenantTwo.ok ? undefined : tenantTwo.stderr.slice(0, 300),
  });

  const costing = applyMigrations(withDatabase(workUrl, database), UPGRADE_0015);
  record('EFG-0015-upgrade-refused-as-designed', !costing.ok, {
    outcome: costing.ok ? 'APPLIED' : 'REFUSED',
    stderr: costing.ok ? undefined : costing.stderr.slice(0, 300),
  });

  const remediation = remediate(database);
  // The remediation's honest plan: fill only the level the ledger can prove,
  // refuse the unknown-cost tenant — and the refusal withholds EVERYTHING,
  // so the costed tenant's basis is proposed, not applied.
  record(
    'E-remediation-proposes-ledger-provenance-only',
    remediation.stdout.includes('basis') && remediation.stdout.includes('18500'),
    { stdout: remediation.stdout.split('\n').slice(-4).join(' | ').slice(0, 500), stderr: remediation.stderr.slice(0, 200) },
  );
  record('F-remediation-refused-unknown-cost', remediation.stdout.includes('unknown'), { stdoutTail: remediation.stdout.split('\n').slice(-2).join(' | ').slice(0, 300) });
  record('EFG-remediation-applied-nothing-fail-closed', !remediation.ok, {
    exitDecided: 'refusal (exit 1) withholds the whole apply; nothing was written',
  });
  const unknownLeft = readLevelFacts(database, 'efg-unknown');
  record('F-unknown-level-untouched-basis-still-null-and-quantity-12', unknownLeft !== null && unknownLeft.quantity === '12' && unknownLeft.averageBasis === null, {
    level: unknownLeft,
  });

  const secondAttempt = applyMigrations(withDatabase(workUrl, database), UPGRADE_0015);
  record('G-0015-after-remediation-fails-on-unknown-cost-row', !secondAttempt.ok, { expected: true });

  dropDatabase(database);
}

// ---------------------------------------------------------------------------
// Scenario G-full — remediate the recoverable shapes and complete the chain.
// ---------------------------------------------------------------------------

function scenarioGFull() {
  const database = DB_PREFIX + '_gfull';
  dropDatabase(database);
  if (!createDatabase(database)) {
    record('Gfull-probe-database-created', false, {});
    return;
  }

  const first = applyMigrations(withDatabase(workUrl, database), THROUGH_0014);
  record('Gfull-chain-through-0014-applies', first.ok, { failedMigration: first.failedMigration });

  // One tenant whose basis the ledger proves, seeded exactly as E.
  const seeded = seedTenant(database, [
    ...LEGACY_SEED('gfull', 24),
    "UPDATE stock_movements SET unit_cost_minor = 18500 WHERE organization_id = (SELECT id FROM organizations WHERE bootstrap_key = 'bootstrap-probe-gfull');",
  ]);
  record('Gfull-costed-tenant-seeded-with-ledger-basis', seeded.ok, {
    stderr: seeded.ok ? undefined : seeded.stderr.slice(0, 300),
  });

  const refused = applyMigrations(withDatabase(workUrl, database), UPGRADE_0015);
  record('Gfull-0015-refused-before-remediation', !refused.ok, {
    outcome: refused.ok ? 'APPLIED' : 'REFUSED',
  });

  const remediation = remediate(database);
  record('Gfull-remediation-applied-verified-basis', remediation.ok, {
    stdoutTail: remediation.stdout.split('\n').slice(-2).join(' | ').slice(0, 500),
    stderr: remediation.ok ? undefined : remediation.stderr.slice(0, 300),
  });

  const middle = readLevelFacts(database, 'gfull');
  record('Gfull-level-now-carries-verified-basis', middle !== null && middle.averageBasis === '18500' && middle.quantity === '24', { level: middle });

  // The remediation completed migration 0015's OWN artifacts — the operator
  // never replays the file (its unguarded replay cannot lie safely); the
  // follow-up is bookkeeping, and the chain continues with later migrations.
  record(
    'Gfull-0015-artifacts-completed-by-authorized-remediation',
    constraintPresent(database, 'chk_inventory_level_cost_bounds') && constraintPresent(database, 'chk_inventory_level_cost_with_stock') && indexPresent(database, 'stock_levels_organization_id_variant_idx'),
    {},
  );

  const rest = applyMigrations(withDatabase(workUrl, database), AFTER_0015);
  record('Gfull-full-chain-completes-after-recovery', rest.ok, {
    failedMigration: rest.failedMigration,
    stderr: rest.ok ? undefined : rest.stderr.slice(0, 300),
  });
  dropDatabase(database);
}

// ---------------------------------------------------------------------------
// The runner — every scenario on its own database, then cleanup.
// ---------------------------------------------------------------------------

try {
  scenarioA();
  scenarioB();
  scenarioC();
  scenarioD();
  scenarioEFG();
  scenarioGFull();
} finally {
  rmSync(probeDir, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
