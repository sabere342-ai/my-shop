#!/usr/bin/env node
/**
 * The M4-S2 inventory walkthrough (§15.4, §15.5, §15.6, §15.6A, §38.14.1;
 * §40.8 M4-S2).
 *
 * A demonstrable, repeatable acceptance run against the **real** API process
 * and the **real** PostgreSQL database: no mock, no in-memory substitute. It
 * drives the live HTTP surface exactly the way the milestone scenarios read:
 *
 *   prelude  real org bootstrap + real credential + real login, then the
 *            product and variant the quantity story moves (real catalog routes)
 *   A        the seeded default location (§15.4, "V1 seeds one default location")
 *   B        opening balance +24, then the issue of 3 pieces → 21 (§15.2 exact
 *            base-unit folds, no float anywhere)
 *   C        an overdraw attempt → 409 INSUFFICIENT_STOCK, balance untouched,
 *            no movement recorded (§15.6 / §15.6A)
 *   D        movement identity (§38.14.1): an identical retry is REPLAY with no
 *            second effect; the same identity naming a different fact is 409
 *            MUTATION_CONTRADICTION
 *   E        two racing deductions → exactly one lands, one honest refusal, the
 *            derived fold agrees with the history (the concurrency acceptance)
 *   F        tenancy isolation: a second real organization cannot read, write,
 *            or move this one's quantity facts — and its own history is empty
 *   RESUME   (--resume) the same rows re-read after a server restart
 *
 * Provisioning rides the supported operator commands (`bootstrap:org`,
 * `provision:credential`) and authentication rides the real
 * `/api/v1/auth/login` route — the walkthrough never mints a token itself. No
 * password and no token is ever printed (§13.6): the log lines carry step
 * names, HTTP statuses, and problem codes only. Exit code 0 means every step
 * passed.
 *
 * Environment: the standard server environment (DATABASE_URL,
 * MIGRATION_DATABASE_URL) for the provisioning subcommands, plus the running
 * API's port (default 3000, or WALKTHROUGH_BASE_URL for a non-default host).
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
const STATE_DIR = path.join(process.env.TEMP ?? '/tmp', 'opencode', 'm4s2-walkthrough');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

/** The walkthrough's in-memory passwords; never printed, never persisted. */
const secrets = {
  ownerEmail: 'owner@m4s2-walkthrough.test',
  ownerPassword: 'Inventory-Walkthrough-2026!',
  secondEmail: 'owner-b@m4s2-walkthrough.test',
  secondPassword: 'Isolation-Walkthrough-2026!',
};

/** A unique SKU per run, so a repeat run never collides with committed history. */
const SKU = `WT-INV-${randomUUID().slice(0, 8).toUpperCase()}`;

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
 * The §34.3 refusal shape: exactly one stable code and one HTTP status; the
 * walkthrough asserts both, never a message string (§13.1).
 */
async function expectProblem(label, response, expectedStatus, expectedCode) {
  const ok = response.status === expectedStatus && response.body?.code === expectedCode;
  record(label, ok, {
    httpStatus: response.status,
    code: response.body?.code,
    ...(ok ? {} : { expectedStatus, expectedCode }),
  });
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
// Prelude — the variant the quantity story moves, through the real catalog.
// ---------------------------------------------------------------------------

async function preludeCatalog(token, orgId) {
  const product = await http(token, 'POST', `/organizations/${orgId}/catalog/products`, {
    nameAr: 'تيشيرت قطن',
    nameEn: 'Cotton T-Shirt',
    baseUnit: { code: 'PCS', name: 'قطعة', kind: 'BASE' },
    purchasingUnit: { code: 'CRT', name: 'كرتونة', baseQuantityFactor: 12, kind: 'PURCHASING' },
  });
  const productId = product.body.id;
  const variant = await http(token, 'POST', `/organizations/${orgId}/catalog/products/${productId}/variants`, {
    sku: SKU,
    attributes: { color: 'أسود', size: 'M' },
  });
  const ok =
    product.status === 201 &&
    typeof productId === 'string' &&
    variant.status === 201 &&
    variant.body.sku === SKU &&
    typeof variant.body.id === 'string';
  record('prelude-product-and-variant-created', ok, {
    httpStatuses: [product.status, variant.status],
    productId,
    variantId: variant.body.id,
    sku: variant.body.sku ?? SKU,
  });
  return variant.body.id;
}

// ---------------------------------------------------------------------------
// Phase A — one location, seeded on first read, exactly one default forever.
// ---------------------------------------------------------------------------

async function phaseA(token, orgId) {
  const first = await http(token, 'GET', `/organizations/${orgId}/inventory/locations`);
  const firstOk =
    first.status === 200 &&
    Array.isArray(first.body.locations) &&
    first.body.locations.length === 1 &&
    first.body.locations[0]?.isDefault === true &&
    first.body.locations[0]?.name === 'المخزن الرئيسي';
  record('A-default-location-seeded-on-first-read', firstOk, {
    httpStatus: first.status,
    locationCount: first.body.locations?.length,
    isDefault: first.body.locations?.[0]?.isDefault,
  });

  const again = await http(token, 'GET', `/organizations/${orgId}/inventory/locations`);
  record(
    'A-second-read-is-idempotent',
    again.status === 200 && again.body.locations?.[0]?.id === first.body.locations?.[0]?.id,
    { httpStatus: again.status },
  );
  return first.body.locations?.[0]?.id;
}

// ---------------------------------------------------------------------------
// Phase B — §15.2 exact folds: +24 in through an OPENING_BALANCE, −3 issued.
// ---------------------------------------------------------------------------

async function phaseB(token, orgId, variantId) {
  const openingId = randomUUID();
  const opening = await http(token, 'POST', `/organizations/${orgId}/inventory/movements`, {
    movementId: openingId,
    cause: 'OPENING_BALANCE',
    variantId,
    quantityDelta: '24',
  });
  const openingOk =
    opening.status === 200 &&
    opening.body.status === 'APPLIED' &&
    opening.body.movement?.cause === 'OPENING_BALANCE' &&
    opening.body.movement?.quantityDelta === '24' &&
    opening.body.resultingQuantity === '24' &&
    opening.body.level?.quantity === '24';
  record('B-opening-balance-24-applied', openingOk, {
    httpStatus: opening.status,
    code: opening.status === 200 ? undefined : opening.body?.code,
    resultingQuantity: opening.body.resultingQuantity,
    serverSequence: opening.body.movement?.serverSequence,
  });
  if (!openingOk) return null;

  const issueId = randomUUID();
  const issue = await http(token, 'POST', `/organizations/${orgId}/inventory/movements`, {
    movementId: issueId,
    cause: 'MANUAL_ADJUSTMENT',
    variantId,
    quantityDelta: '-3',
    reasonCode: 'MISCOUNT',
    reasonNote: 'صرف ثلاث قطع',
  });
  const issueOk =
    issue.status === 200 &&
    issue.body.status === 'APPLIED' &&
    issue.body.resultingQuantity === '21' &&
    issue.body.movement?.quantityDelta === '-3';
  record('B-issue-3-of-24-leaves-21', issueOk, {
    httpStatus: issue.status,
    code: issue.status === 200 ? undefined : issue.body?.code,
    resultingQuantity: issue.body.resultingQuantity,
    serverSequence: issue.body.movement?.serverSequence,
  });

  const levels = await http(token, 'GET', `/organizations/${orgId}/inventory/levels?variantId=${variantId}`);
  record(
    'B-derived-level-agrees-with-the-fold',
    levels.status === 200 && levels.body.levels?.[0]?.quantity === '21' && levels.body.levels?.[0]?.sku === SKU,
    { httpStatus: levels.status, quantity: levels.body.levels?.[0]?.quantity },
  );

  const history = await http(token, 'GET', `/organizations/${orgId}/inventory/movements?variantId=${variantId}`);
  const deltas = history.body.movements?.map((movement) => movement.quantityDelta);
  record(
    'B-history-is-newest-first-exact-ledger',
    history.status === 200 && deltas?.join(',') === '-3,24' && Number(history.body.movements?.[0]?.serverSequence) > Number(history.body.movements?.[1]?.serverSequence),
    { httpStatus: history.status, deltas },
  );
  return { openingId, issueId };
}

// ---------------------------------------------------------------------------
// Phase C — the §15.6 guard: an overdraw is refused with an untouched balance.
// ---------------------------------------------------------------------------

async function phaseC(token, orgId, variantId) {
  const before = await http(token, 'GET', `/organizations/${orgId}/inventory/levels?variantId=${variantId}`);
  const balanceBefore = before.body.levels?.[0]?.quantity;

  const overdraw = await http(token, 'POST', `/organizations/${orgId}/inventory/movements`, {
    movementId: randomUUID(),
    cause: 'MANUAL_ADJUSTMENT',
    variantId,
    quantityDelta: '-30',
    reasonCode: 'LOST',
  });
  await expectProblem('C-overdraw-refused-insufficient-stock', overdraw, 409, 'INSUFFICIENT_STOCK');

  const after = await http(token, 'GET', `/organizations/${orgId}/inventory/levels?variantId=${variantId}`);
  const movements = await http(token, 'GET', `/organizations/${orgId}/inventory/movements?variantId=${variantId}`);
  record(
    'C-refusal-left-no-trace',
    after.status === 200 &&
      after.body.levels?.[0]?.quantity === balanceBefore &&
      movements.body.movements?.every((movement) => movement.quantityDelta !== '-30'),
    { balance: after.body.levels?.[0]?.quantity },
  );
}

// ---------------------------------------------------------------------------
// Phase D — §38.14.1: the movement id is the idempotency identity.
// ---------------------------------------------------------------------------

async function phaseD(token, orgId, variantId) {
  const replayId = randomUUID();
  const first = await http(token, 'POST', `/organizations/${orgId}/inventory/movements`, {
    movementId: replayId,
    cause: 'MANUAL_ADJUSTMENT',
    variantId,
    quantityDelta: '-2',
    reasonCode: 'DAMAGED',
  });
  const replay = await http(token, 'POST', `/organizations/${orgId}/inventory/movements`, {
    movementId: replayId,
    cause: 'MANUAL_ADJUSTMENT',
    variantId,
    quantityDelta: '-2',
    reasonCode: 'DAMAGED',
  });
  const okReplay =
    first.status === 200 &&
    replay.status === 200 &&
    first.body.status === 'APPLIED' &&
    replay.body.status === 'REPLAY' &&
    replay.body.movement?.movementId === replayId &&
    replay.body.movement?.serverSequence === first.body.movement?.serverSequence;
  record('D-identical-retry-answers-replay-no-second-effect', okReplay, {
    httpStatuses: [first.status, replay.status],
    statuses: [first.body.status, replay.body.status],
    serverSequence: replay.body.movement?.serverSequence,
  });

  const contradiction = await http(token, 'POST', `/organizations/${orgId}/inventory/movements`, {
    movementId: replayId,
    cause: 'MANUAL_ADJUSTMENT',
    variantId,
    quantityDelta: '-5',
    reasonCode: 'DAMAGED',
  });
  await expectProblem('D-same-id-different-fact-refused', contradiction, 409, 'MUTATION_CONTRADICTION');

  const history = await http(token, 'GET', `/organizations/${orgId}/inventory/movements?variantId=${variantId}`);
  const forId = history.body.movements?.filter((movement) => movement.movementId === replayId) ?? [];
  record('D-exactly-one-movement-for-the-identity', history.status === 200 && forId.length === 1, {
    movementsForId: forId.length,
  });
}

// ---------------------------------------------------------------------------
// Phase E — the concurrency acceptance: two racers, one balance, one effect.
// ---------------------------------------------------------------------------

async function phaseE(token, orgId, variantId) {
  const before = await http(token, 'GET', `/organizations/${orgId}/inventory/levels?variantId=${variantId}`);
  const balanceBefore = before.body.levels?.[0]?.quantity;
  // From nineteen (opening 24, one 3-piece issue in phase B, one 2-piece
  // issue in phase D), −10 and −12 cannot both land: the first fold leaves 9
  // or 7, and from there the other deduction crosses zero (§15.6A).
  if (balanceBefore !== '19') {
    record('E-race-precondition-balanced-at-19', false, { balanceBefore });
    return;
  }

  const [big, bigger] = await Promise.allSettled([
    http(token, 'POST', `/organizations/${orgId}/inventory/movements`, {
      movementId: randomUUID(),
      cause: 'MANUAL_ADJUSTMENT',
      variantId,
      quantityDelta: '-10',
      reasonCode: 'EXPIRED',
    }),
    http(token, 'POST', `/organizations/${orgId}/inventory/movements`, {
      movementId: randomUUID(),
      cause: 'MANUAL_ADJUSTMENT',
      variantId,
      quantityDelta: '-12',
      reasonCode: 'EXPIRED',
    }),
  ]);

  const outcomes =
    big.status === 'fulfilled' && bigger.status === 'fulfilled'
      ? [
          big.value.status === 200 ? 'APPLIED' : big.value.body?.code,
          bigger.value.status === 200 ? 'APPLIED' : bigger.value.body?.code,
        ]
      : ['TRANSPORT', 'TRANSPORT'];
  const oneLanded = outcomes.includes('APPLIED') && outcomes.includes('INSUFFICIENT_STOCK');
  record('E-two-racing-deductions-one-lands-one-refuses', oneLanded, { outcomes });

  const winner = big.value?.body?.status === 'APPLIED' ? big.value.body : bigger.value?.body;
  const levels = await http(token, 'GET', `/organizations/${orgId}/inventory/levels?variantId=${variantId}`);
  record(
    'E-derived-fold-agrees-with-the-winner',
    winner != null &&
      (winner.resultingQuantity === '9' || winner.resultingQuantity === '7') &&
      levels.body.levels?.[0]?.quantity === winner.resultingQuantity,
    { winnerResult: winner?.resultingQuantity, levelQuantity: levels.body.levels?.[0]?.quantity },
  );
}

// ---------------------------------------------------------------------------
// Phase F — two real tenants; neither reads, writes, nor moves the other's rows.
// ---------------------------------------------------------------------------

async function phaseF(orgAId, variantId) {
  const bootstrapped = runBootstrap([
    '--bootstrap-key',
    'm4s2-walkthrough-b',
    '--name',
    'M4S2 Walkthrough Shop B',
    '--owner-email',
    secrets.secondEmail,
  ]);
  const orgBId = bootstrapped.payload?.organizationId;
  record('F-second-org-bootstrapped', bootstrapped.code === 0 && typeof orgBId === 'string', {
    exitCode: bootstrapped.code,
  });
  if (typeof orgBId !== 'string') return;

  const cred = runOperator('provision-credential.mjs', ['--email', secrets.secondEmail], {
    PROVISION_PASSWORD: secrets.secondPassword,
  });
  record('F-second-owner-credential-provisioned', cred.status === 0, { exitCode: cred.status });

  const tokenB = await login(secrets.secondEmail, secrets.secondPassword);
  record('F-second-owner-real-login', typeof tokenB === 'string' && tokenB.length > 0, {});

  // B's write into A's inventory: the guard refuses the tenant mismatch before
  // any variant lookup runs.
  const crossWrite = await http(tokenB, 'POST', `/organizations/${orgAId}/inventory/movements`, {
    movementId: randomUUID(),
    cause: 'MANUAL_ADJUSTMENT',
    variantId,
    quantityDelta: '-3',
    reasonCode: 'LOST',
  });
  await expectProblem('F-cross-tenant-movement-refused', crossWrite, 403, 'ORGANIZATION_FORBIDDEN');

  // B's own quantity story is real but empty: no opening balance was ever
  // recorded for its variants, so neither the ledger nor the cache answers.
  const bLevels = await http(tokenB, 'GET', `/organizations/${orgBId}/inventory/levels`);
  const bMovements = await http(tokenB, 'GET', `/organizations/${orgBId}/inventory/movements`);
  record(
    'F-second-org-sees-none-of-org-A-facts',
    bLevels.status === 200 &&
      (bLevels.body.levels?.length ?? 0) === 0 &&
      bMovements.status === 200 &&
      (bMovements.body.movements?.length ?? 0) === 0,
    { httpStatuses: [bLevels.status, bMovements.status] },
  );
}

// ---------------------------------------------------------------------------
// The runner.
// ---------------------------------------------------------------------------

/** The full walkthrough: prelude + phases A–F on the real process, then persist the state. */
async function fullRun() {
  const bootstrapped = runBootstrap([
    '--bootstrap-key',
    'm4s2-walkthrough',
    '--name',
    'M4S2 Walkthrough Shop',
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

  const variantId = await preludeCatalog(token, orgId);
  if (typeof variantId !== 'string') process.exit(1);

  const locationId = await phaseA(token, orgId);
  if (typeof locationId !== 'string') process.exit(1);
  await phaseB(token, orgId, variantId);
  await phaseC(token, orgId, variantId);
  await phaseD(token, orgId, variantId);
  await phaseE(token, orgId, variantId);
  await phaseF(orgId, variantId);  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(
    STATE_FILE,
    JSON.stringify({ orgId, variantId, locationId, sku: SKU, nameAr: 'تيشيرت قطن' }),
    'utf8',
  );
  record('state-persisted-for-resume', true, { stateFile: STATE_FILE });

  process.exitCode = failures === 0 ? 0 : 1;
}

/** The post-restart proof: a fresh login reads the same committed quantity facts. */
async function resumeRun() {
  const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  const token = await login(secrets.ownerEmail, secrets.ownerPassword);
  const variantId = state.variantId;

  const levels = await http(token, 'GET', `/organizations/${state.orgId}/inventory/levels?variantId=${variantId}`);
  const history = await http(token, 'GET', `/organizations/${state.orgId}/inventory/movements?variantId=${variantId}`);
  // The full run leaves the fold at 9 or 7 (opening 24, one 3-piece issue in
  // phase B, one 2-piece issue in phase D, and the race winner −10 or −12);
  // the resume demands exactly that number back from a fresh process, with
  // four committed movements.
  const quantity = levels.body.levels?.[0]?.quantity;
  const ok =
    levels.status === 200 &&
    history.status === 200 &&
    levels.body.levels?.[0]?.sku === state.sku &&
    (quantity === '9' || quantity === '7') &&
    (history.body.movements?.length ?? 0) === 4;
  record('RESUME-quantity-facts-persist-after-restart', ok, {
    httpStatuses: [levels.status, history.status],
    quantity,
    movementCount: history.body.movements?.length,
    serverSequences: history.body.movements?.map((movement) => movement.serverSequence),
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
