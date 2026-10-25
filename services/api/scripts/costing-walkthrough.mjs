#!/usr/bin/env node
/**
 * The M4-S3 costing walkthrough (Â§30.2, Â§30.3, Â§30.4, Â§30.5, Â§30.6, Â§30.8;
 * Â§40.8 M4-S3).
 *
 * A demonstrable, repeatable acceptance run against the **real** API process
 * and the **real** PostgreSQL database: no mock, no in-memory substitute. It
 * drives the live HTTP surface exactly the way the Â§30 scenarios read:
 *
 *   prelude  real org bootstrap + real credential + real login, then the two
 *            variants the costing story moves (real catalog routes)
 *   A        the receipt that opens a basis: +24 @ 18500 â†’ average 18500,
 *            value 444000 (Â§30.2: the valuation is quantity Ã— average, exact)
 *   B        the second acquisition: +12 @ 24000 â†’ (24Â·18500 + 12Â·24000)/36 =
 *            20333.33â€¦ â†’ HALF_UP 20333, value 731988 (Â§30.3's single rounding
 *            point, HALF_UP by default)
 *   C        a deduction âˆ’3 â†’ the average never moves (Â§30.4): 33 @ 20333,
 *            value 670989 â€” historical COGS is never restated
 *   D        the movement identity rides its cost fact (Â§38.14.1): an
 *            identical cost-bearing retry is REPLAY with no second effect;
 *            the same identity naming a different cost is 409
 *            MUTATION_CONTRADICTION; the fold stands at 35 @ 19743 / 691005
 *   E        two racing cost-bearing receipts serialize on the fold â€” the
 *            race is chosen so each intermediate fold lands on an exact
 *            division, so either serialization answers 55 @ 12568 / 691240
 *   F        the Â§30.5 revaluation restates only the current average: 12568 â†’
 *            12000 across 55 pieces, value 660000; the acquisition ledger's
 *            own snapshots are never rewritten (Â§30.8: server-only act)
 *   G        the refusals: a cost-imposing cause without a cost (400
 *            VALIDATION_FAILED), a REVALUATION that moves stock (400), a
 *            consumption A OFFERED cost (400), and a cost-bearing adjustment
 *            onto stock with no basis (409 INVENTORY_COST_BASIS_REQUIRED) â€”
 *            the engine never fabricates a cost
 *   H        an offered zero is a real fact: +4 @ 5000, a plain âˆ’2 issue at
 *            the engine's own average, then +1 @ 0 â†’ 3 @ 3333, value 9999 â€”
 *            the explicit zero folds, the implied zero never existed
 *   I        the cost-free faces stay cost-free (Â§38.5): `levels` and
 *            `movements` carry no cost member on the wire, while `valuation`
 *            and `cost-snapshots` answer the costing authority with exact
 *            integers â€” org totals 669999, two valued lines, none uncosted
 *   J        tenancy: a second real organization cannot write a movement into
 *            the first (403 ORGANIZATION_FORBIDDEN) and its own valuation is
 *            honestly empty
 *   RESUME   (--resume) a fresh login after a server restart re-reads the
 *            committed facts: 55 @ 12000 / 660000, org grand total 669999,
 *            the Â§38.14.1 histories intact
 *
 * Provisioning rides the supported operator commands (`bootstrap:org`,
 * `provision:credential`) and authentication rides the real `/api/v1/auth/login`
 * route â€” the walkthrough never mints a token itself. No password and no token
 * is ever printed (Â§13.6): the log lines carry step names, HTTP statuses, and
 * problem codes only. Exit code 0 means every step passed.
 *
 * Environment: the standard server environment (DATABASE_URL,
 * MIGRATION_DATABASE_URL) for the provisioning subcommands, plus the running
 * API's port (WALKTHROUGH_BASE_URL, default 3000).
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const apiRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** The base URL of the real, running API process. */
const BASE_URL = process.env.WALKTHROUGH_BASE_URL ?? 'http://127.0.0.1:3000/api/v1';

/** The persisted walkthrough state between the full run and the --resume proof. */
const STATE_DIR = path.join(process.env.TEMP ?? '/tmp', 'opencode', 'm4s3-walkthrough');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

/** The walkthrough's in-memory passwords; never printed, never persisted. */
const secrets = {
  ownerEmail: 'owner@m4s3-walkthrough.test',
  ownerPassword: 'Costing-Walkthrough-2026!',
  secondEmail: 'owner-b@m4s3-walkthrough.test',
  secondPassword: 'Isolation-Costing-2026!',
};

/** Unique SKUs per run, so a repeat run never collides with committed history. */
const SKU_MAIN = `WT-COST-A-${randomUUID().slice(0, 8).toUpperCase()}`;
const SKU_BARE = `WT-COST-B-${randomUUID().slice(0, 8).toUpperCase()}`;

let failures = 0;

/** One step, one honest JSON line: PASS or FAIL with the evidence the step saw. */
function record(step, pass, detail) {
  process.stdout.write(`${JSON.stringify({ step, status: pass ? 'PASS' : 'FAIL', ...(detail ?? {}) })}\n`);
  if (!pass) failures += 1;
}

/** The HTTP client: one real bearer, one organization at a time. */
async function http(token, method, urlPath, body) {
  const response = await fetch(`${BASE_URL}${urlPath}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let parsed = {};
  const text = await response.text();
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { unparsedBodyLength: text.length };
    }
  }
  return { status: response.status, body: parsed };
}

/**
 * The Â§34.3 refusal shape: exactly one stable code and one HTTP status; the
 * walkthrough asserts both, never a message string (Â§13.1).
 */
async function expectProblem(label, response, expectedStatus, expectedCode) {
  const ok = response.status === expectedStatus && response.body?.code === expectedCode;
  record(label, ok, {
    httpStatus: response.status,
    code: response.body?.code,
    ...(ok ? {} : { expectedStatus, expectedCode }),
  });
}

/** One accepted costing movement, honestly recorded. */
async function submit(token, orgId, offer) {
  return http(token, 'POST', `/organizations/${orgId}/inventory/movements`, {
    movementId: randomUUID(),
    ...offer,
  });
}

/** The valuation the Â§30.2 cache answers for one variant (or the whole org). */
function valuationQuery(token, orgId, variantId) {
  const suffix = variantId === undefined ? '' : `?variantId=${variantId}`;
  return http(token, 'GET', `/organizations/${orgId}/inventory/valuation${suffix}`);
}

/** The Â§30.2 cost snapshot ledger for one variant (or the whole org). */
function snapshotsQuery(token, orgId, variantId) {
  const suffix = variantId === undefined ? '' : `?variantId=${variantId}`;
  return http(token, 'GET', `/organizations/${orgId}/inventory/cost-snapshots${suffix}`);
}

/** The valuation row of one variant, or null when the shape broke. */
function valuedLevelOf(response) {
  return response.body?.levels?.find((row) => row.sku === response.body?.levels?.[0]?.sku) ?? response.body?.levels?.[0] ?? null;
}

/** A real login through the real route; the tokens stay in memory. */
async function login(email, password) {
  const response = await http(undefined, 'POST', '/auth/login', { email, password });
  if (response.status !== 200) {
    record('prelude-login', false, { httpStatus: response.status, code: response.body?.code });
    process.exit(1);
  }
  return response.body.accessToken;
}

/** Runs a supported operator CLI as a real subprocess (never imported internals). */
function runOperator(script, args, extraEnv) {
  return spawnSync(process.execPath, [path.join(apiRoot, 'scripts', script), ...args], {
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
    shell: false,
  });
}

function runBootstrap(args) {
  const result = runOperator('org-bootstrap.mjs', args);
  let payload = null;
  try {
    payload = JSON.parse((result.stdout ?? '').trim().split('\n').reverse()[0]);
  } catch {
    payload = null;
  }
  return { code: result.status, payload };
}

// ---------------------------------------------------------------------------
// Prelude â€” the two variants the costing story moves, through the real catalog.
// ---------------------------------------------------------------------------

async function preludeCatalog(token, orgId) {
  const product = await http(token, 'POST', `/organizations/${orgId}/catalog/products`, {
    nameAr: 'ØªÙŠØ´ÙŠØ±Øª Ù‚Ø·Ù†',
    nameEn: 'Cotton T-Shirt',
    baseUnit: { code: 'PCS', name: 'Ù‚Ø·Ø¹Ø©', kind: 'BASE' },
    purchasingUnit: { code: 'CRT', name: 'ÙƒØ±ØªÙˆÙ†Ø©', baseQuantityFactor: 12, kind: 'PURCHASING' },
  });
  const productId = product.body.id;
  const first = await http(token, 'POST', `/organizations/${orgId}/catalog/products/${productId}/variants`, {
    sku: SKU_MAIN,
    attributes: { color: 'Ø£Ø³ÙˆØ¯', size: 'M' },
  });
  const second = await http(token, 'POST', `/organizations/${orgId}/catalog/products/${productId}/variants`, {
    sku: SKU_BARE,
    attributes: { color: 'Ø£Ø¨ÙŠØ¶', size: 'S' },
  });
  const ok =
    product.status === 201 &&
    first.status === 201 &&
    first.body.sku === SKU_MAIN &&
    second.status === 201 &&
    second.body.sku === SKU_BARE;
  record(
    'prelude-product-and-both-variants-created',
    ok,
    {
      httpStatuses: [product.status, first.status, second.status],
      productId,
      variantIdA: first.body.id,
      variantIdB: second.body.id,
    },
  );
  return { variantIdA: first.body.id, variantIdB: second.body.id };
}

// ---------------------------------------------------------------------------
// Phase A â€” the receipt that opens a basis (Â§30.3's zero-quantity arm).
// ---------------------------------------------------------------------------

async function phaseA(token, orgId, variantId) {
  const opening = await submit(token, orgId, {
    cause: 'OPENING_BALANCE',
    variantId,
    quantityDelta: '24',
    unitCostMinor: '18500',
  });
  const opened =
    opening.status === 200 &&
    opening.body.status === 'APPLIED' &&
    opening.body.resultingQuantity === '24';
  record('A-opening-receipt-24-applied', opened, {
    httpStatus: opening.status,
    code: opening.status === 200 ? undefined : opening.body?.code,
    resultingQuantity: opening.body.resultingQuantity,
  });
  if (!opened) return;

  const valued = await valuationQuery(token, orgId, variantId);
  const ok =
    valued.status === 200 &&
    valued.body.levels?.[0]?.quantity === '24' &&
    valued.body.levels?.[0]?.averageCostMinor === '18500' &&
    valued.body.levels?.[0]?.inventoryValueMinor === '444000';
  record('A-valuation-is-24-at-18500-exact-444000', ok, {
    httpStatus: valued.status,
    quantity: valued.body.levels?.[0]?.quantity,
    averageCostMinor: valued.body.levels?.[0]?.averageCostMinor,
    inventoryValueMinor: valued.body.levels?.[0]?.inventoryValueMinor,
  });
}

// ---------------------------------------------------------------------------
// Phase B â€” the Â§30.3 accumulation: one rounding point, HALF_UP.
// ---------------------------------------------------------------------------

async function phaseB(token, orgId, variantId) {
  const receipt = await submit(token, orgId, {
    cause: 'PURCHASE_RECEIPT',
    variantId,
    quantityDelta: '12',
    unitCostMinor: '24000',
  });
  record('B-receipt-12-at-24000-applied', receipt.status === 200 && receipt.body.status === 'APPLIED', {
    httpStatus: receipt.status,
    code: receipt.status === 200 ? undefined : receipt.body?.code,
  });

  const valued = await valuationQuery(token, orgId, variantId);
  const ok =
    valued.status === 200 &&
    valued.body.levels?.[0]?.quantity === '36' &&
    valued.body.levels?.[0]?.averageCostMinor === '20333' &&
    valued.body.levels?.[0]?.inventoryValueMinor === '731988';
  record('B-mva-fold-is-20333-value-731988', ok, {
    httpStatus: valued.status,
    quantity: valued.body.levels?.[0]?.quantity,
    averageCostMinor: valued.body.levels?.[0]?.averageCostMinor,
    inventoryValueMinor: valued.body.levels?.[0]?.inventoryValueMinor,
  });
}

// ---------------------------------------------------------------------------
// Phase C â€” Â§30.4: the deduction consumes at the average, never restating it.
// ---------------------------------------------------------------------------

async function phaseC(token, orgId, variantId) {
  const issue = await submit(token, orgId, {
    cause: 'MANUAL_ADJUSTMENT',
    variantId,
    quantityDelta: '-3',
    reasonCode: 'MISCOUNT',
    reasonNote: 'ØµØ±Ù Ø«Ù„Ø§Ø« Ù‚Ø·Ø¹',
  });
  record('C-issue-3-applied', issue.status === 200 && issue.body.status === 'APPLIED', {
    httpStatus: issue.status,
    code: issue.status === 200 ? undefined : issue.body?.code,
  });

  const valued = await valuationQuery(token, orgId, variantId);
  const ok =
    valued.status === 200 &&
    valued.body.levels?.[0]?.quantity === '33' &&
    valued.body.levels?.[0]?.averageCostMinor === '20333' &&
    valued.body.levels?.[0]?.inventoryValueMinor === '670989';
  record(
    'C-average-never-moved-on-a-deduction',
    ok,
    {
      quantity: valued.body.levels?.[0]?.quantity,
      averageCostMinor: valued.body.levels?.[0]?.averageCostMinor,
      inventoryValueMinor: valued.body.levels?.[0]?.inventoryValueMinor,
    },
  );
}

// ---------------------------------------------------------------------------
// Phase D â€” Â§38.14.1 identity over a cost-bearing receipt: replay/contradiction.
// ---------------------------------------------------------------------------

async function phaseD(token, orgId, variantId) {
  const replayId = randomUUID();
  const first = await submit(token, orgId, {
    movementId: replayId,
    cause: 'PURCHASE_RECEIPT',
    variantId,
    quantityDelta: '2',
    unitCostMinor: '10000',
  });
  const replay = await submit(token, orgId, {
    movementId: replayId,
    cause: 'PURCHASE_RECEIPT',
    variantId,
    quantityDelta: '2',
    unitCostMinor: '10000',
  });
  const okReplay =
    first.status === 200 &&
    replay.status === 200 &&
    first.body.status === 'APPLIED' &&
    replay.body.status === 'REPLAY' &&
    replay.body.movement?.movementId === replayId &&
    replay.body.movement?.serverSequence === first.body.movement?.serverSequence;
  record('D-identical-cost-bearing-retry-answers-replay', okReplay, {
    httpStatuses: [first.status, replay.status],
    statuses: [first.body.status, replay.body.status],
  });

  // (670989 + 2Â·10000)/35 = 690989/35 = 19742.54â€¦ â†’ 19743, value 691005.
  const valued = await valuationQuery(token, orgId, variantId);
  record(
    'D-stand-after-the-retry-is-35-at-19743',
    valued.status === 200 &&
      valued.body.levels?.[0]?.quantity === '35' &&
      valued.body.levels?.[0]?.averageCostMinor === '19743' &&
      valued.body.levels?.[0]?.inventoryValueMinor === '691005',
    { httpStatus: valued.status },
  );

  const contradiction = await submit(token, orgId, {
    movementId: replayId,
    cause: 'PURCHASE_RECEIPT',
    variantId,
    quantityDelta: '2',
    unitCostMinor: '12000',
  });
  await expectProblem('D-same-id-different-cost-refused', contradiction, 409, 'MUTATION_CONTRADICTION');

  const after = await valuationQuery(token, orgId, variantId);
  record(
    'D-contradiction-left-the-fold-untouched',
    after.status === 200 && after.body.levels?.[0]?.averageCostMinor === '19743',
    { httpStatus: after.status },
  );
}

// ---------------------------------------------------------------------------
// Phase E â€” two racing cost-bearing receipts serialize on the fold.
// ---------------------------------------------------------------------------

async function phaseE(token, orgId, variantId) {
  // From 35 @ 19743 (value 691005): each intermediate fold lands on an exact
  // division, so both serializations agree:
  //   (691005 + 10Â·15)/45 = 691155/45 = 15359 exact;
  //   (691005 + 10Â·6)/45  = 691065/45 = 15357 exact;
  //   then 691215/55 = 12567.54â€¦ â†’ 12568, value 691240.
  const [cheap, cheaper] = await Promise.allSettled([
    submit(token, orgId, { cause: 'PURCHASE_RECEIPT', variantId, quantityDelta: '10', unitCostMinor: '15' }),
    submit(token, orgId, { cause: 'PURCHASE_RECEIPT', variantId, quantityDelta: '10', unitCostMinor: '6' }),
  ]);
  const outcomes = [
    cheap.status === 'fulfilled' && cheap.value.status === 200 && cheap.value.body?.status === 'APPLIED'
      ? 'APPLIED'
      : 'other',
    cheaper.status === 'fulfilled' && cheaper.value.status === 200 && cheaper.value.body?.status === 'APPLIED'
      ? 'APPLIED'
      : 'other',
  ];
  record('E-both-racing-receipts-applied', outcomes[0] === 'APPLIED' && outcomes[1] === 'APPLIED', { outcomes });

  const valued = await valuationQuery(token, orgId, variantId);
  const ok =
    valued.status === 200 &&
    valued.body.levels?.[0]?.quantity === '55' &&
    valued.body.levels?.[0]?.averageCostMinor === '12568' &&
    valued.body.levels?.[0]?.inventoryValueMinor === '691240';
  record('E-serialization-order-never-moved-the-average', ok, {
    quantity: valued.body.levels?.[0]?.quantity,
    averageCostMinor: valued.body.levels?.[0]?.averageCostMinor,
    inventoryValueMinor: valued.body.levels?.[0]?.inventoryValueMinor,
  });
}

// ---------------------------------------------------------------------------
// Phase F â€” the Â§30.5 revaluation: the only retroactive change, server-only.
// ---------------------------------------------------------------------------

async function phaseF(token, orgId, variantId) {
  const revaluation = await submit(token, orgId, {
    cause: 'REVALUATION',
    variantId,
    quantityDelta: '0',
    unitCostMinor: '12000',
  });
  record(
    'F-revaluation-applied-zero-delta',
    revaluation.status === 200 &&
      revaluation.body.status === 'APPLIED' &&
      revaluation.body.movement?.cause === 'REVALUATION' &&
      revaluation.body.movement?.quantityDelta === '0',
    { httpStatus: revaluation.status, code: revaluation.status === 200 ? undefined : revaluation.body?.code },
  );

  const valued = await valuationQuery(token, orgId, variantId);
  record(
    'F-restated-to-12000-value-660000',
    valued.status === 200 &&
      valued.body.levels?.[0]?.quantity === '55' &&
      valued.body.levels?.[0]?.averageCostMinor === '12000' &&
      valued.body.levels?.[0]?.inventoryValueMinor === '660000',
    { httpStatus: valued.status, averageCostMinor: valued.body.levels?.[0]?.averageCostMinor },
  );

  // History is never rewritten: the snapshots keep the acquisition costs and
  // the revaluation carries only its own restatement.
  const costs = await snapshotsQuery(token, orgId, variantId);
  const observed = costs.body?.costSnapshots?.map((row) => `${row.cause}:${row.unitCostMinor}`) ?? [];
  const ok =
    costs.status === 200 &&
    observed[0] === 'REVALUATION:12000' &&
    observed.includes('OPENING_BALANCE:18500') &&
    observed.includes('PURCHASE_RECEIPT:24000') &&
    observed.includes('PURCHASE_RECEIPT:15') &&
    observed.includes('PURCHASE_RECEIPT:6') &&
    observed.includes('MANUAL_ADJUSTMENT:20333');
  record('F-cost-snapshots-never-rewritten', ok, { httpStatus: costs.status, observed });
}

// ---------------------------------------------------------------------------
// Phase G â€” the refusals: the engine never fabricates a cost (fresh variant).
// ---------------------------------------------------------------------------

async function phaseG(token, orgId, variantIdB) {
  const noCostOpening = await submit(token, orgId, {
    cause: 'OPENING_BALANCE',
    variantId: variantIdB,
    quantityDelta: '10',
  });
  await expectProblem('G-opening-without-cost-refused', noCostOpening, 400, 'VALIDATION_FAILED');

  const noCostReceipt = await submit(token, orgId, {
    cause: 'PURCHASE_RECEIPT',
    variantId: variantIdB,
    quantityDelta: '10',
  });
  await expectProblem('G-receipt-without-cost-refused', noCostReceipt, 400, 'VALIDATION_FAILED');

  const stockMovingRevaluation = await submit(token, orgId, {
    cause: 'REVALUATION',
    variantId: variantIdB,
    quantityDelta: '5',
    unitCostMinor: '1000',
  });
  await expectProblem(
    'G-stock-moving-revaluation-refused',
    stockMovingRevaluation,
    400,
    'VALIDATION_FAILED',
  );

  const reCostedConsumption = await submit(token, orgId, {
    cause: 'MANUAL_ADJUSTMENT',
    variantId: variantIdB,
    quantityDelta: '-1',
    reasonCode: 'DAMAGED',
    unitCostMinor: '5000',
  });
  await expectProblem('G-consumption-with-offered-cost-refused', reCostedConsumption, 400, 'VALIDATION_FAILED');

  // Uncosted stock has no basis to fold a cost-bearing inclusion onto.
  const uncostedInclusion = await submit(token, orgId, {
    cause: 'MANUAL_ADJUSTMENT',
    variantId: variantIdB,
    quantityDelta: '4',
    reasonCode: 'RESTOCK',
  });
  await expectProblem(
    'G-cost-bearing-adjustment-without-basis-refused',
    uncostedInclusion,
    409,
    'INVENTORY_COST_BASIS_REQUIRED',
  );

  const valued = await valuationQuery(token, orgId, variantIdB);
  record(
    'G-refusals-invented-nothing',
    valued.status === 200 &&
      (valued.body.levels?.length ?? 0) === 0 &&
      valued.body.totals?.uncostedLines === 0,
    { httpStatus: valued.status, levels: valued.body.levels?.length },
  );
}

// ---------------------------------------------------------------------------
// Phase H â€” an offered zero is a real economic fact (the fresh variant folds).
// ---------------------------------------------------------------------------

async function phaseH(token, orgId, variantIdB) {
  const inclusion = await submit(token, orgId, {
    cause: 'MANUAL_ADJUSTMENT',
    variantId: variantIdB,
    quantityDelta: '4',
    reasonCode: 'RESTOCK',
    unitCostMinor: '5000',
  });
  record(
    'H-cost-bearing-inclusion-applied',
    inclusion.status === 200 && inclusion.body.status === 'APPLIED' && inclusion.body.resultingQuantity === '4',
    { httpStatus: inclusion.status, code: inclusion.status === 200 ? undefined : inclusion.body?.code },
  );

  const issue = await submit(token, orgId, {
    cause: 'MANUAL_ADJUSTMENT',
    variantId: variantIdB,
    quantityDelta: '-2',
    reasonCode: 'LOST',
  });
  record('H-plain-issue-consumed-at-the-average', issue.status === 200 && issue.body.status === 'APPLIED', {
    httpStatus: issue.status,
  });

  const zero = await submit(token, orgId, {
    cause: 'PURCHASE_RECEIPT',
    variantId: variantIdB,
    quantityDelta: '1',
    unitCostMinor: '0',
  });
  record('H-explicit-zero-cost-receipt-applied', zero.status === 200 && zero.body.status === 'APPLIED', {
    httpStatus: zero.status,
  });

  // 2 @ 5000 + 1 @ 0 = 10000/3 = 3333.33â€¦ â†’ 3333, value 9999.
  const valued = await valuationQuery(token, orgId, variantIdB);
  record(
    'H-zero-cost-folded-not-implied',
    valued.status === 200 &&
      valued.body.levels?.[0]?.quantity === '3' &&
      valued.body.levels?.[0]?.averageCostMinor === '3333' &&
      valued.body.levels?.[0]?.inventoryValueMinor === '9999',
    {
      httpStatus: valued.status,
      averageCostMinor: valued.body.levels?.[0]?.averageCostMinor,
      inventoryValueMinor: valued.body.levels?.[0]?.inventoryValueMinor,
    },
  );

  const costs = await snapshotsQuery(token, orgId, variantIdB);
  const observed = costs.body?.costSnapshots?.map((row) => `${row.cause}:${row.unitCostMinor}`) ?? [];
  record(
    'H-snapshots-record-the-zero-as-a-fact',
    costs.status === 200 && observed[0] === 'PURCHASE_RECEIPT:0' && observed.includes('MANUAL_ADJUSTMENT:5000'),
    { httpStatus: costs.status, observed },
  );
}

// ---------------------------------------------------------------------------
// Phase I â€” the cost-free faces stay cost-free; the cost reads answer exact.
// ---------------------------------------------------------------------------

async function phaseI(token, orgId, variantId, variantIdB) {
  const levels = await http(token, 'GET', `/organizations/${orgId}/inventory/levels`);
  const movements = await http(token, 'GET', `/organizations/${orgId}/inventory/movements?variantId=${variantId}`);
  const levelsWire = JSON.stringify(levels.body ?? {});
  const movementsWire = JSON.stringify(movements.body ?? {});
  record(
    'I-view-faces-carry-no-cost-member',
    levels.status === 200 &&
      movements.status === 200 &&
      !levelsWire.includes('ost') &&
      !movementsWire.includes('ost'),
    { httpStatuses: [levels.status, movements.status] },
  );

  const all = await valuationQuery(token, orgId);
  const okTotals =
    all.status === 200 &&
    all.body.totals?.valuedLevels === 2 &&
    all.body.totals?.uncostedLines === 0 &&
    all.body.totals?.inventoryValueMinor === '669999';
  record('I-org-valuation-exact-669999-two-valued-lines', okTotals, {
    httpStatus: all.status,
    totals: all.body.totals,
  });

  const costs = await snapshotsQuery(token, orgId);
  record(
    'I-cost-snapshots-answer-the-costing-authority',
    costs.status === 200 && (costs.body?.costSnapshots?.length ?? 0) >= 9,
    { httpStatus: costs.status, count: costs.body?.costSnapshots?.length },
  );

  // The lives of the two variants never cross: the per-variant query answers
  // only its own rows.
  const onlyB = await valuationQuery(token, orgId, variantIdB);
  record(
    'I-per-variant-valuation-answers-one-row',
    onlyB.status === 200 && (onlyB.body.levels?.length ?? 0) === 1 && onlyB.body.levels?.[0]?.sku === SKU_BARE,
    { httpStatus: onlyB.status, sku: onlyB.body.levels?.[0]?.sku },
  );
}

// ---------------------------------------------------------------------------
// Phase J â€” tenancy: the second org reads neither rows nor costs of the first.
// ---------------------------------------------------------------------------

async function phaseJ(orgAId, variantId) {
  const bootstrapped = runBootstrap([
    '--bootstrap-key',
    'm4s3-walkthrough-b',
    '--name',
    'M4S3 Costing Shop B',
    '--owner-email',
    secrets.secondEmail,
  ]);
  const orgBId = bootstrapped.payload?.organizationId;
  record('J-second-org-bootstrapped', bootstrapped.code === 0 && typeof orgBId === 'string', {
    exitCode: bootstrapped.code,
  });
  if (typeof orgBId !== 'string') return;

  const cred = runOperator('provision-credential.mjs', ['--email', secrets.secondEmail], {
    PROVISION_PASSWORD: secrets.secondPassword,
  });
  record('J-second-owner-credential-provisioned', cred.status === 0, { exitCode: cred.status });

  const tokenB = await login(secrets.secondEmail, secrets.secondPassword);
  record('J-second-owner-real-login', typeof tokenB === 'string' && tokenB.length > 0, {});

  const crossWrite = await http(tokenB, 'POST', `/organizations/${orgAId}/inventory/movements`, {
    movementId: randomUUID(),
    cause: 'PURCHASE_RECEIPT',
    variantId,
    quantityDelta: '3',
    unitCostMinor: '9999',
  });
  await expectProblem('J-cross-tenant-costing-write-refused', crossWrite, 403, 'ORGANIZATION_FORBIDDEN');

  const bValuation = await valuationQuery(tokenB, orgBId);
  const bSnapshots = await snapshotsQuery(tokenB, orgBId);
  record(
    'J-second-org-valuation-honestly-empty',
    bValuation.status === 200 &&
      (bValuation.body.levels?.length ?? 0) === 0 &&
      bValuation.body.totals?.inventoryValueMinor === '0' &&
      bSnapshots.status === 200 &&
      (bSnapshots.body?.costSnapshots?.length ?? 0) === 0,
    { httpStatuses: [bValuation.status, bSnapshots.status] },
  );
}

// ---------------------------------------------------------------------------
// The runner.
// ---------------------------------------------------------------------------

/** The full walkthrough: prelogue + phases Aâ€“J on the real process, then persist the state. */
async function fullRun() {
  const bootstrapped = runBootstrap([
    '--bootstrap-key',
    'm4s3-walkthrough',
    '--name',
    'M4S3 Costing Shop',
    '--owner-email',
    secrets.ownerEmail,
  ]);
  const orgId = bootstrapped.payload?.organizationId;
  if (bootstrapped.code !== 0 || typeof orgId !== 'string') {
    record('prelude-first-org-bootstrapped', false, { exitCode: bootstrapped.code });
    process.exit(1);
  }
  record('prelude-first-org-bootstrapped', true, { organizationId: orgId });

  const cred = runOperator('provision-credential.mjs', ['--email', secrets.ownerEmail], {
    PROVISION_PASSWORD: secrets.ownerPassword,
  });
  record('prelude-owner-credential-provisioned', cred.status === 0, { exitCode: cred.status });

  const token = await login(secrets.ownerEmail, secrets.ownerPassword);
  record('prelude-owner-real-login', typeof token === 'string' && token.length > 0, {});

  const variants = await preludeCatalog(token, orgId);
  if (typeof variants?.variantIdA !== 'string' || typeof variants?.variantIdB !== 'string') process.exit(1);

  await phaseA(token, orgId, variants.variantIdA);
  await phaseB(token, orgId, variants.variantIdA);
  await phaseC(token, orgId, variants.variantIdA);
  await phaseD(token, orgId, variants.variantIdA);
  await phaseE(token, orgId, variants.variantIdA);
  await phaseF(token, orgId, variants.variantIdA);
  await phaseG(token, orgId, variants.variantIdB);
  await phaseH(token, orgId, variants.variantIdB);
  await phaseI(token, orgId, variants.variantIdA, variants.variantIdB);
  await phaseJ(orgId, variants.variantIdA);

  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(
    STATE_FILE,
    JSON.stringify({ orgId, ...variants, skuA: SKU_MAIN, skuB: SKU_BARE }),
    'utf8',
  );
  record('state-persisted-for-resume', true, { stateFile: STATE_FILE });

  process.exitCode = failures === 0 ? 0 : 1;
}

/** The post-restart proof: a fresh login reads the same committed costing facts. */
async function resumeRun() {
  const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  const token = await login(secrets.ownerEmail, secrets.ownerPassword);

  const valuedA = await valuationQuery(token, state.orgId, state.variantIdA);
  const valuedB = await valuationQuery(token, state.orgId, state.variantIdB);
  // The full run leaves variant A at 55 @ 12000 / 660000 and variant B at
  // 3 @ 3333 / 9999; the resume demands exactly those numbers back from a
  // fresh process.
  const okA =
    valuedA.status === 200 &&
    valuedA.body.levels?.[0]?.quantity === '55' &&
    valuedA.body.levels?.[0]?.averageCostMinor === '12000' &&
    valuedA.body.levels?.[0]?.inventoryValueMinor === '660000';
  record('RESUME-variant-A-costing-facts-persist', okA, {
    httpStatus: valuedA.status,
    quantity: valuedA.body.levels?.[0]?.quantity,
    averageCostMinor: valuedA.body.levels?.[0]?.averageCostMinor,
  });

  const okB =
    valuedB.status === 200 &&
    valuedB.body.levels?.[0]?.quantity === '3' &&
    valuedB.body.levels?.[0]?.averageCostMinor === '3333' &&
    valuedB.body.levels?.[0]?.inventoryValueMinor === '9999';
  record('RESUME-variant-B-costing-facts-persist', okB, {
    httpStatus: valuedB.status,
    quantity: valuedB.body.levels?.[0]?.quantity,
  });

  const all = await valuationQuery(token, state.orgId);
  record(
    'RESUME-org-grand-total-exact-669999',
    all.status === 200 &&
      all.body.totals?.inventoryValueMinor === '669999' &&
      all.body.totals?.valuedLevels === 2 &&
      all.body.totals?.uncostedLines === 0,
    { httpStatus: all.status, totals: all.body.totals },
  );

  const historyA = await http(token, 'GET', `/organizations/${state.orgId}/inventory/movements?variantId=${state.variantIdA}`);
  const costsA = await snapshotsQuery(token, state.orgId, state.variantIdA);
  const histOk =
    historyA.status === 200 &&
    (historyA.body.movements?.length ?? 0) === 7 &&
    historyA.body.movements?.some((row) => row.cause === 'REVALUATION' && row.quantityDelta === '0') &&
    costsA.status === 200 &&
    (costsA.body?.costSnapshots?.length ?? 0) === 7 &&
    costsA.body?.costSnapshots?.[0]?.cause === 'REVALUATION';
  record('RESUME-ledger-and-snapshots-intact', histOk, {
    httpStatuses: [historyA.status, costsA.status],
    movements: historyA.body.movements?.length,
    snapshots: costsA.body?.costSnapshots?.length,
  });

  process.exitCode = failures === 0 ? 0 : 1;
}

process.on('unhandledRejection', (error) => {
  record('unhandled', false, { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});

if (process.argv.includes('--resume')) {
  await resumeRun();
} else {
  await fullRun();
}
