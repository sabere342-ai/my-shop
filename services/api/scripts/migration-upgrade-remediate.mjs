#!/usr/bin/env node
/**
 * The migration-0015 pre-upgrade remediation (M4-S4 mandatory first task).
 *
 * The M4-S3 costing migration refuses to run on a database whose
 * `stock_levels` rows carry a positive quantity without an
 * `average_cost_minor` basis (`chk_inventory_level_cost_with_stock`). The
 * honest recovery is **not** a later migration (0015 aborts first) and it is
 * **not** a data wipe: it is an explicitly authorized, idempotent,
 * fail-closed pre-migration remediation that gives each offending level back
 * the basis the organization's own ledger proves — never an invented zero,
 * never a guessed agenda (§30: cost history is never silently rewritten; an
 * explicit, attributed derivation is not a silent rewrite).
 *
 * Provenance rules (fail-closed):
 *
 *   1. A level with quantity 0 is never touched — its NULL basis is the
 *      lawful state (the stale average of stock that fully left).
 *   2. A level whose *own ledger* carries costing movements
 *      (`stock_movements.unit_cost_minor IS NOT NULL` for that level's
 *      variant, location, organization) proposes the **latest** costing
 *      snapshot as the basis — the most authoritative per-unit fact the
 *      history holds, recorded with its provenance (the movement id).
 *   3. A level with positive quantity and NO costing movement anywhere is
 *      reported as an **unknown historical cost**: the script refuses it. No
 *      zero is fabricated, no acquisition cost is invented. That refusal is
 *      the upgrade blocker the owner must resolve — by authorizing the load
 *      a real cost (an operator decision on genuine documents) before the
 *      upgrade, or by accepting the block. The script never resolves it.
 *
 * Atomicity: the database is one deployment unit, so a run is all-or-nothing.
 * If any unknown-cost row exists, --apply withholds EVERYTHING (no schema
 * change, no data change) and exits 1 — the database stays at the exact shape
 * the failed 0015 left it, and a re-run of the deploy refuses exactly as
 * before. Only a run whose plan is entirely provable (or empty) applies.
 *
 * Schema completion: under a transactional deployer (prisma migrate deploy;
 * the probe replays one file = one transaction) a refused 0015 rolls back its
 * `ADD COLUMN` entirely, so at apply time the column usually does not exist.
 * The script therefore performs migration 0015's OWN DDL — the column, the
 * column comment, the two CHECK constraints, and the read index — with every
 * artifact existence-guarded, so the apply is idempotent and the artifact set
 * after it is exactly what 0015 would have left. The operator's follow-up is
 * bookkeeping, not SQL: record the migration as applied
 * (`prisma migrate resolve --applied 0015_inventory_costing`) and continue
 * the deploy with later migrations. NEVER replay the 0015 file manually —
 * without `IF NOT EXISTS` its replay can only lie about what already exists.
 *
 * The script never rewrites `stock_movements`, never deletes rows, never
 * truncates history; the level UPDATE it performs is the same column the
 * M4-S3 engine maintains, performed by a privileged operator before the
 * engine existed — and it is `--apply`-gated (a plan is the default; a plan
 * followed by `--apply` is idempotent: a re-run with the same ledger and the
 * completed schema finds nothing to do).
 *
 * Every decision is emitted as one structured record (the script's own
 * artifact) so an operator can review it against the permission ledger:
 * level id, tenant, variant, location, quantity, the proposed basis, the
 * provenance (movement id + cause), and the decision.
 *
 * Environment: the ADMIN plane only (ADMIN_DATABASE_URL). The operation is a
 * privileged maintenance action on rows the application deliberately cannot
 * see across tenants (`stock_levels` is FORCE RLS, and the migrator role is
 * NOBYPASSRLS with it — by design no application-plane role may read across
 * tenants). The script rewrites only the database name of that URL, never the
 * credentials, and never prints a URL (§13.1).
 *
 * Usage:
 *   ADMIN_DATABASE_URL=<postgres> node scripts/migration-upgrade-remediate.mjs --database <name>          plan
 *   ADMIN_DATABASE_URL=<postgres> node scripts/migration-upgrade-remediate.mjs --database <name> --apply  apply
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const apiRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const apply = process.argv.includes('--apply');
const databaseArg = process.argv[process.argv.indexOf('--database') + 1];

const workUrl = process.env.ADMIN_DATABASE_URL;
if (!workUrl || databaseArg === undefined || databaseArg.startsWith('--')) {
  process.stderr.write('usage: ADMIN_DATABASE_URL=<postgres> node scripts/migration-upgrade-remediate.mjs --database <name> [--apply]\n');
  process.exit(2);
}

const url = (() => {
  const schemeEnd = workUrl.indexOf('://');
  const scheme = workUrl.slice(0, schemeEnd);
  const rest = workUrl.slice(schemeEnd + 3);
  const queryIndex = rest.indexOf('?');
  const authority = (queryIndex === -1 ? rest : rest.slice(0, queryIndex)).split('/')[0];
  const query = queryIndex === -1 ? '' : rest.slice(queryIndex);
  return scheme + '://' + authority + '/' + databaseArg + query;
})();

function psql(script) {
  const result = spawnSync('psql', ['-v', 'ON_ERROR_STOP=1', '--no-psqlrc', '--no-align', '--tuples-only', url, '-c', script], {
    encoding: 'utf8',
    shell: false,
  });
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
  };
}

/**
 * The column's presence decides the offending predicate: under a
 * transactional deployer a refused 0015 rolls back to the 0014 shape where
 * `average_cost_minor` does not exist at all, and then EVERY positive
 * quantity is offending (the level never had a basis to lose). After
 * 0015's column exists, only a NULL basis is.
 */
const columnProbe = psql(
  "SELECT count(*) FROM pg_attribute WHERE attrelid = 'stock_levels'::regclass AND attname = 'average_cost_minor' AND NOT attisdropped;",
);
if (!columnProbe.ok) {
  process.stderr.write('the schema read failed; nothing was decided\n');
  process.exit(1);
}
const hasCostColumn = columnProbe.stdout === '1';

/**
 * The remediation plan: every level beyond the CHECK's lawful state, with the
 * basis derived ONLY from that level's own costing ledger (the latest
 * snapshot), or the explicit refusal when no provenance exists.
 */
const plan = psql(`WITH offending AS (
  SELECT l.id AS level_id, l.organization_id, l.variant_id, l.location_id, l.quantity
    FROM stock_levels l
   ${
     hasCostColumn
       ? 'WHERE l.quantity > 0 AND l.average_cost_minor IS NULL'
       : 'WHERE l.quantity > 0'
   }
), provenance AS (
  SELECT o.level_id, o.organization_id, o.variant_id, o.location_id, o.quantity,
         m.unit_cost_minor, m.id AS movement_id, m.cause, m.occurred_at
    FROM offending o
    LEFT JOIN LATERAL (
      SELECT sm.id, sm.unit_cost_minor, sm.cause, sm.occurred_at
        FROM stock_movements sm
       WHERE sm.organization_id = o.organization_id
         AND sm.variant_id = o.variant_id
         AND sm.location_id = o.location_id
         AND sm.unit_cost_minor IS NOT NULL
       ORDER BY sm.occurred_at DESC, sm.created_at DESC, sm.id ASC
       LIMIT 1
    ) m ON true
   ORDER BY o.organization_id, o.variant_id, o.location_id
)
SELECT level_id, organization_id, variant_id, location_id, quantity, unit_cost_minor, movement_id, cause
  FROM provenance;`);

if (!plan.ok) {
  process.stderr.write('the provenance read failed; nothing was decided\n');
  process.stderr.write(plan.stderr.length > 0 ? plan.stderr + '\n' : '');
  process.exit(1);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AMOUNT = /^\d+$/;

const rows = plan.stdout
  .split('\n')
  .filter((line) => line.length > 0)
  .map((line) => {
    const [levelId, organizationId, variantId, locationId, quantity, unitCostMinor, movementId, cause] = line.split('|');
    return {
      levelId,
      organizationId,
      variantId,
      locationId,
      quantity,
      unitCostMinor: unitCostMinor || null,
      movementId: movementId || null,
      cause: cause || null,
    };
  });

// Fail-closed against anything the read produced that this script cannot
// interpret: an apply statement is built from these exact fields, so any
// malformed identity or amount refuses the run before one character is sent.
const interpretable = rows.every(
  (row) =>
    UUID.test(row.levelId) &&
    UUID.test(row.organizationId) &&
    UUID.test(row.variantId) &&
    UUID.test(row.locationId) &&
    AMOUNT.test(row.quantity) &&
    (row.unitCostMinor === null || AMOUNT.test(row.unitCostMinor)) &&
    (row.movementId === null || UUID.test(row.movementId)),
);
if (!interpretable) {
  const malformed = rows.filter(
    (row) =>
      !UUID.test(row.levelId) ||
      !UUID.test(row.organizationId) ||
      !UUID.test(row.variantId) ||
      !UUID.test(row.locationId) ||
      !AMOUNT.test(row.quantity) ||
      (row.unitCostMinor !== null && !AMOUNT.test(row.unitCostMinor)) ||
      (row.movementId !== null && !UUID.test(row.movementId)),
  ).length;
  process.stderr.write(`the provenance read returned ${malformed} record(s) the script cannot interpret; nothing was decided\n`);
  process.exit(1);
}

const proposable = rows.filter((row) => row.movementId !== null);
const refusals = rows.filter((row) => row.movementId === null);

function emitProposal(row, status) {
  process.stdout.write(
    `${JSON.stringify({
      decision: 'PROPOSE_FROM_LEDGER',
      levelId: row.levelId,
      organizationId: row.organizationId,
      variantId: row.variantId,
      locationId: row.locationId,
      quantity: row.quantity,
      basis: row.unitCostMinor,
      provenance: { movementId: row.movementId, cause: row.cause },
      status,
    })}\n`,
  );
}

function emitRefusal(row) {
  process.stdout.write(
    `${JSON.stringify({
      decision: 'REFUSED_UNKNOWN_COST',
      levelId: row.levelId,
      organizationId: row.organizationId,
      variantId: row.variantId,
      locationId: row.locationId,
      quantity: row.quantity,
      shape: 'unknown-historical-cost',
      status: 'BLOCKED',
      reason: 'no costing movement carries a unit cost for this level; the owner must authorize a real basis before the upgrade',
    })}\n`,
  );
}

// A plan is read-only: proposals are PLANNED, unknown rows are BLOCKED, and a
// non-empty plan exits 1 so no operator script mistakes the plan for a
// successful nothing-to-do.
if (!apply) {
  for (const row of proposable) emitProposal(row, 'PLANNED');
  for (const row of refusals) emitRefusal(row);
  process.stdout.write(
    `${JSON.stringify({ decision: 'PLAN_ONLY', proposable: proposable.length, unknown: refusals.length })}\n`,
  );
  process.exit(rows.length > 0 ? 1 : 0);
}

// The apply is all-or-nothing: any unknown-cost row withholds everything so
// the deployed database stays exactly where the failed 0015 left it.
if (refusals.length > 0) {
  for (const row of proposable) emitProposal(row, 'WITHHELD');
  for (const row of refusals) emitRefusal(row);
  process.stdout.write(
    `${JSON.stringify({
      decision: 'APPLY_WITHHELD',
      proposable: proposable.length,
      unknown: refusals.length,
      reason: 'an unknown historical cost keeps the upgrade blocked; nothing was applied',
    })}\n`,
  );
  process.exit(1);
}

if (proposable.length === 0) {
  process.stdout.write(`${JSON.stringify({ decision: 'NOTHING_TO_DO', applied: 0 })}\n`);
  process.exit(0);
}

/**
 * The migration 0015 DDL, executed by the authorized operator: the same
 * column the migration would have added (never a different shape), with the
 * artifacts existence-guarded so a re-run is a no-op. Applying it is what
 * makes the operator's bookkeeping (record 0015 applied, continue the deploy)
 * legitimate without ever replaying the migration file.
 *
 * Everything runs in ONE transaction: a half-applied recovery must not exist.
 */
const statements = [];
if (!hasCostColumn) {
  statements.push('ALTER TABLE "stock_levels" ADD COLUMN "average_cost_minor" bigint;');
  statements.push(
    "COMMENT ON COLUMN \"stock_levels\".\"average_cost_minor\" IS 'A30.2 perpetual moving weighted average per base unit, minor units (M4-S3); NULL until a costing movement records a basis';",
  );
}
for (const row of proposable) {
  // The WHERE re-asserts every precondition the plan claims: identity,
  // tenant, positive quantity, and an unfilled basis. A row that racing
  // writer newly filled is left alone (idempotent, provenance-honouring).
  statements.push(
    'UPDATE stock_levels SET average_cost_minor = ' +
      row.unitCostMinor +
      ', updated_at = now() WHERE id = \'' +
      row.levelId +
      "'::uuid AND organization_id = '" +
      row.organizationId +
      "'::uuid AND quantity > 0 AND average_cost_minor IS NULL;",
  );
}
statements.push(`DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
     WHERE c.conname = 'chk_inventory_level_cost_bounds' AND t.relname = 'stock_levels'
  ) THEN
    ALTER TABLE "stock_levels" ADD CONSTRAINT "chk_inventory_level_cost_bounds"
      CHECK ("average_cost_minor" IS NULL
             OR ("average_cost_minor" >= 0 AND "average_cost_minor" <= 999999999999));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
     WHERE c.conname = 'chk_inventory_level_cost_with_stock' AND t.relname = 'stock_levels'
  ) THEN
    ALTER TABLE "stock_levels" ADD CONSTRAINT "chk_inventory_level_cost_with_stock"
      CHECK ("quantity" = 0 OR "average_cost_minor" IS NOT NULL);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'stock_levels_organization_id_variant_idx'
  ) THEN
    CREATE INDEX "stock_levels_organization_id_variant_idx"
      ON "stock_levels" ("organization_id", "variant_id");
  END IF;
END $$;`);

const applyResult = psql('BEGIN;\n' + statements.join('\n') + '\nCOMMIT;');
if (!applyResult.ok) {
  process.stderr.write('the remediation apply refused; everything above rolled back\n');
  process.stderr.write(applyResult.stderr.length > 0 ? applyResult.stderr + '\n' : '');
  process.exit(1);
}

for (const row of proposable) emitProposal(row, 'APPLIED');
process.stdout.write(
  `${JSON.stringify({
    decision: 'APPLY_RESULT',
    applied: proposable.length,
    columnCreated: !hasCostColumn,
    schemaCompleted: true,
    note: 'migration 0015 artifacts are now exactly what the migration would have left; record it as applied and continue the deploy — never replay the file',
  })}\n`,
);
process.exit(0);
