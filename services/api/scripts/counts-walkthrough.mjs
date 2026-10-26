#!/usr/bin/env node
/**
 * The M4-S4 counts walkthrough (Master Plan S15.8, S30.5, O-14, S38.22 Tier 2;
 * S40.8 row M4-S4).
 *
 * A demonstrable, repeatable acceptance run against the **real** API process
 * and the **real** PostgreSQL database: no mock, no in-memory substitute. It
 * drives the live HTTP surface exactly the way the milestone scenarios read:
 *
 *   prelude  real org bootstrap + real credential + real login (+ the verified
 *            actor id via /auth/me), then the product and variant the story moves
 *   A        the seeded default location (S15.4)
 *   B        opening balance +24 with a cost offer, then one -3 issue -> 21
 *   C        open count -> OPEN, empty observation set at the one location
 *   D        record/re-record one line: a repeated scan EDITS the same line
 *            with a refreshed snapshot (S15.8)
 *   E        posting an unexplained variance refuses 409 STOCK_COUNT_REASON_
 *            REQUIRED (O-14); the count stays OPEN, no movement exists
 *   F        the explanation arrives -> post: APPLIED; count POSTED; level 23;
 *            one STOCK_COUNT_ADJUSTMENT movement (+2) through the one engine
 *   G        the count row is the idempotency identity: posting again answers
 *            REPLAY and history still holds exactly one produced movement
 *   H        closed history is immutable: recording against POSTED refuses
 *            409 STOCK_COUNT_CLOSED, and so does cancelling a POSTED count
 *   I        cancellation: a second count records a matched observation,
 *            cancels APPLIED (observations rest unposted), re-cancel REPLAY,
 *            and posting the cancelled document refuses 409 STOCK_COUNT_CLOSED
 *   J        the Tier-2 offline path over the REAL device boundary: register a
 *            device, bind the session (the did claim, S12.4), and push one
 *            INVENTORY_ADJUSTMENT mutation to /sync/push -> APPLIED with a
 *            resultRef/resultHash; the fold moves to 18; an identical re-push
 *            answers REPLAY and the fold never moves twice
 *   K        an offline count document: the whole INVENTORY_COUNT payload
 *            (identity, one line with a device line id, posting) applies
 *            inside the ledger's own acceptance transaction -> APPLIED,
 *            level 16, the document reads POSTED; a re-push answers REPLAY
 *   L        the ledger records refusals honestly: an overdraw pushes REJECTED
 *            (INSUFFICIENT_STOCK) with the level untouched; an adjustment
 *            carrying the producer-only cause pushes REJECTED (VALIDATION_
 *            FAILED); a re-push of the refused mutation is still not APPLIED
 *            - nothing ever silently applies or silently drops
 *   M        tenancy: a second real organization is refused 403 ORGANIZATION_
 *            FORBIDDEN on the first org's count routes, and its own count
 *            page is honestly empty
 *
 * Provisioning rides the supported operator commands (bootstrap:org,
 * provision:credential) and authentication rides the real /api/v1/auth/login
 * route - the walkthrough never mints a token itself. No password, no token,
 * and no installation secret is ever printed (S13.6): the log lines carry step
 * names, HTTP statuses, problem codes, and quantities only. Exit code 0 means
 * every step passed.
 *
 * Environment: the standard server environment (DATABASE_URL,
 * MIGRATION_DATABASE_URL) for the provisioning subcommands, plus the running
 * API's port (WALKTHROUGH_BASE_URL, default 3000).
 */

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** The base URL of the real, running API process. */
const BASE_URL = process.env.WALKTHROUGH_BASE_URL ?? 'http://127.0.0.1:3000/api/v1';

/** The walkthrough's in-memory credentials; never printed, never persisted. */
const secrets = {
  ownerEmail: 'owner@m4s4-walkthrough.test',
  ownerPassword: 'Counts-Walkthrough-2026!',
  secondEmail: 'owner-b@m4s4-walkthrough.test',
  secondPassword: 'Counts-Isolation-2026!',
};

/** A unique SKU per run, so a repeat run never collides with committed history. */
const SKU = `WT-CNT-${randomUUID().slice(0, 8).toUpperCase()}`;

let failures = 0;

/** One step, one honest JSON line: PASS or FAIL with the evidence the step saw. */
function record(step, pass, detail) {
  process.stdout.write(`${JSON.stringify({ step, status: pass ? 'PASS' : 'FAIL', ...(detail ?? {}) })}\n`);
  if (!pass) failures += 1;
}

/** The HTTP client: one real bearer, one concern at a time. */
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

/** The refusal shape: exactly one stable code and one HTTP status. */
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
// Prelude — the catalog facts the quantity story moves.
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
    typeof variant.body.id === 'string';
  record('prelude-product-and-variant-created', ok, { httpStatuses: [product.status, variant.status] });
  return variant.body.id;
}

// ---------------------------------------------------------------------------
// Steps A–I — the online count lifecycle over the count routes.
// ---------------------------------------------------------------------------

/** A: one default location, seeded on first read. */
async function stepA(token, orgId) {
  const first = await http(token, 'GET', `/organizations/${orgId}/inventory/locations`);
  const ok = first.status === 200 && first.body.locations?.length === 1 && first.body.locations[0]?.isDefault === true;
  record('A-default-location-seeded', ok, { httpStatus: first.status });
  return first.body.locations?.[0]?.id;
}

/** The movement route, folded to one helper the quantity steps share. */
async function submitMovement(token, orgId, offer, expectedQuantity) {
  const response = await http(token, 'POST', `/organizations/${orgId}/inventory/movements`, {
    movementId: randomUUID(),
    ...offer,
  });
  record(`${offer.cause}-applied-at-${expectedQuantity}`, response.status === 200 && response.body.status === 'APPLIED' && response.body.resultingQuantity === expectedQuantity, {
    httpStatus: response.status,
    code: response.status === 200 ? undefined : response.body?.code,
    resultingQuantity: response.body.resultingQuantity,
  });
}

/** B: stock at 21 (opening +24 with its cost offer, one -3 issue). */
async function stepB(token, orgId, variantId) {
  await submitMovement(token, orgId, {
    cause: 'OPENING_BALANCE',
    variantId,
    quantityDelta: '24',
    unitCostMinor: '18500',
  }, '24');
  await submitMovement(token, orgId, {
    cause: 'MANUAL_ADJUSTMENT',
    variantId,
    quantityDelta: '-3',
    reasonCode: 'DAMAGED',
  }, '21');
}

/** C: the count opens OPEN with an empty observation set at the one location. */
async function stepC(token, orgId, locationId) {
  const response = await http(token, 'POST', `/organizations/${orgId}/inventory/counts`, { note: 'جرد فصلي' });
  const count = response.body.count;
  record(
    'C-count-opened-empty',
    response.status === 200 &&
      count?.status === 'OPEN' &&
      count.locationId === locationId &&
      Array.isArray(count.lines) &&
      count.lines.length === 0,
    { httpStatus: response.status, countId: count?.countId },
  );
  return count;
}

/** D: recording, and the record-edit law of a repeated scan. */
async function stepD(token, orgId, countId, variantId) {
  const first = await http(token, 'POST', `/organizations/${orgId}/inventory/counts/${countId}/lines`, {
    variantId,
    countedQuantity: '21',
  });
  record(
    'D-matched-observation-recorded',
    first.status === 200 &&
      first.body.count?.lines?.length === 1 &&
      first.body.count.lines[0]?.countedQuantity === '21' &&
      first.body.count.lines[0]?.expectedQuantity === '21' &&
      first.body.count.lines[0]?.reasonCode === null,
    { httpStatus: first.status, expectedQuantity: first.body.count?.lines?.[0]?.expectedQuantity },
  );

  const revised = await http(token, 'POST', `/organizations/${orgId}/inventory/counts/${countId}/lines`, {
    variantId,
    countedQuantity: '23',
  });
  record(
    'D-repeat-scan-edits-the-same-line',
    revised.status === 200 &&
      revised.body.count?.lines?.length === 1 &&
      revised.body.count.lines[0]?.countedQuantity === '23' &&
      revised.body.count.lines[0]?.movementId === null,
    { httpStatus: revised.status, lineCount: revised.body.count?.lines?.length },
  );
}

/** E: the unexplained variance refuses and changes nothing. */
async function stepE(token, orgId, countId, variantId) {
  await expectProblem(
    'E-unexplained-variance-refused',
    await http(token, 'POST', `/organizations/${orgId}/inventory/counts/${countId}/post`),
    409,
    'STOCK_COUNT_REASON_REQUIRED',
  );

  const count = await http(token, 'GET', `/organizations/${orgId}/inventory/counts/${countId}`);
  const level = await http(token, 'GET', `/organizations/${orgId}/inventory/levels?variantId=${variantId}`);
  record(
    'E-refusal-changed-nothing',
    count.status === 200 &&
      count.body.count?.status === 'OPEN' &&
      count.body.count.lines?.every((line) => line.movementId === null) &&
      level.status === 200 &&
      level.body.levels?.[0]?.quantity === '21',
    { httpStatuses: [count.status, level.status], quantity: level.body.levels?.[0]?.quantity },
  );
}

/** F: the explanation arrives; the posting folds through the one engine. */
async function stepF(token, orgId, countId, variantId) {
  await http(token, 'POST', `/organizations/${orgId}/inventory/counts/${countId}/lines`, {
    variantId,
    countedQuantity: '23',
    reasonCode: 'MISCOUNT',
  });

  const post = await http(token, 'POST', `/organizations/${orgId}/inventory/counts/${countId}/post`);
  const line = post.body.count?.lines?.[0];
  record(
    'F-posting-folded-through-the-engine',
    post.status === 200 &&
      post.body.status === 'APPLIED' &&
      post.body.count?.status === 'POSTED' &&
      typeof line?.movementId === 'string' &&
      line.movementId === line.lineId,
    { httpStatus: post.status },
  );

  const level = await http(token, 'GET', `/organizations/${orgId}/inventory/levels?variantId=${variantId}`);
  record('F-quantity-follows-the-count', level.status === 200 && level.body.levels?.[0]?.quantity === '23', {
    quantity: level.body.levels?.[0]?.quantity,
  });

  const history = await http(token, 'GET', `/organizations/${orgId}/inventory/movements?variantId=${variantId}`);
  const produced = history.body.movements?.find((movement) => movement.movementId === line.movementId);
  record(
    'F-movement-cause-and-delta-visible',
    history.status === 200 &&
      produced?.cause === 'STOCK_COUNT_ADJUSTMENT' &&
      produced?.quantityDelta === '2' &&
      produced?.reasonCode === 'MISCOUNT',
    { cause: produced?.cause, delta: produced?.quantityDelta },
  );
}

/** G: the count row is its own idempotency identity. */
async function stepG(token, orgId, countId, variantId) {
  const replay = await http(token, 'POST', `/organizations/${orgId}/inventory/counts/${countId}/post`);
  record(
    'G-second-post-answers-replay',
    replay.status === 200 && replay.body.status === 'REPLAY' && replay.body.count?.status === 'POSTED',
    { httpStatus: replay.status, replayStatus: replay.body?.status },
  );

  const history = await http(token, 'GET', `/organizations/${orgId}/inventory/movements?variantId=${variantId}`);
  const produced = history.body.movements?.filter((movement) => movement.cause === 'STOCK_COUNT_ADJUSTMENT') ?? [];
  record('G-exactly-one-produced-movement', history.status === 200 && produced.length === 1, {
    producedCount: produced.length,
  });
}

/** H: closed history is immutable. */
async function stepH(token, orgId, postedCountId, variantId) {
  await expectProblem(
    'H-recording-against-posted-refused',
    await http(token, 'POST', `/organizations/${orgId}/inventory/counts/${postedCountId}/lines`, {
      variantId,
      countedQuantity: '99',
      reasonCode: 'RESTOCK',
    }),
    409,
    'STOCK_COUNT_CLOSED',
  );

  await expectProblem(
    'H-cancelling-a-posted-count-refused',
    await http(token, 'POST', `/organizations/${orgId}/inventory/counts/${postedCountId}/cancel`),
    409,
    'STOCK_COUNT_CLOSED',
  );
}

/** I: the cancellation lifecycle. */
async function stepI(token, orgId, variantId, levelNow) {
  const opened = await http(token, 'POST', `/organizations/${orgId}/inventory/counts`, {});
  const countId = opened.body.count?.countId;
  record('I-second-count-opened', opened.status === 200 && typeof countId === 'string', { httpStatus: opened.status });
  if (typeof countId !== 'string') return;

  await http(token, 'POST', `/organizations/${orgId}/inventory/counts/${countId}/lines`, {
    variantId,
    countedQuantity: levelNow,
  });

  const cancel = await http(token, 'POST', `/organizations/${orgId}/inventory/counts/${countId}/cancel`);
  record(
    'I-cancel-applied',
    cancel.status === 200 && cancel.body.status === 'APPLIED' && cancel.body.count?.status === 'CANCELLED',
    { httpStatus: cancel.status, cancelStatus: cancel.body?.status },
  );

  const again = await http(token, 'POST', `/organizations/${orgId}/inventory/counts/${countId}/cancel`);
  record('I-second-cancel-answers-replay', again.status === 200 && again.body.status === 'REPLAY', {
    replayStatus: again.body?.status,
  });

  await expectProblem(
    'I-posting-a-cancelled-count-refused',
    await http(token, 'POST', `/organizations/${orgId}/inventory/counts/${countId}/post`),
    409,
    'STOCK_COUNT_CLOSED',
  );
}

// ---------------------------------------------------------------------------
// Steps J–L — the Tier-2 offline path over the real device boundary.
// ---------------------------------------------------------------------------

/**
 * One S38.8.1 mutation envelope as the offline outbox would present it: the
 * device identifies itself, the payload is the whole immutable event, and the
 * server re-proves everything at acceptance from its own facts.
 */
function offlineMutation(deviceId, orgId, actorUserId, sequence, aggregateType, aggregateId, payload) {
  const mutationId = randomUUID();
  return {
    mutationId,
    organizationId: orgId,
    deviceId,
    actorUserId,
    actorRoleSnapshot: {
      permissions: [
        'catalog.view',
        'inventory.view',
        'inventory.receive',
        'inventory.adjust',
        'inventory.count',
        'catalog.cost.edit',
        'sales.create',
      ],
      permissionsVersion: 1,
    },
    aggregateType,
    aggregateId,
    operationType: 'CREATE',
    payload,
    payloadVersion: 1,
    deviceLocalSequence: sequence,
    localCreatedAt: new Date().toISOString(),
    deviceIdempotencyKey: mutationId,
  };
}

/** The per-device total order (S38.10.2) the whole offline act rides on. */
const deviceSequence = (() => {
  let counter = 0;
  return () => {
    counter += 1;
    return counter;
  };
})();

function outcomeOf(response, label, mutationId) {
  const outcome = response.body?.outcomes?.find((entry) => entry.mutationId === mutationId);
  record(label, outcome != null && response.status === 200, {
    httpStatus: response.status,
    outcome: outcome?.status,
    code: outcome?.rejectionCode,
  });
  return outcome;
}

async function pushBatch(token, deviceId, mutations) {
  return http(token, 'POST', '/sync/push', {
    deviceId,
    syncBatchId: randomUUID(),
    localSchemaVersion: 1,
    mutations,
  });
}

/** The device boundary: register this installation, then bind the session. */
async function registerAndBindDevice(token, orgId) {
  const installationSecret = `${randomUUID()}${randomUUID()}`;
  const registered = await http(token, 'POST', `/organizations/${orgId}/devices`, {
    installationId: randomUUID(),
    installationSecret,
    platform: 'windows',
    appVersion: '1.0.0',
    label: 'm4s4 walkthrough device',
  });
  const deviceId = registered.body.deviceId;
  record('J-device-registered', registered.status === 200 && typeof deviceId === 'string', { httpStatus: registered.status });
  if (typeof deviceId !== 'string') return null;

  const bound = await http(token, 'POST', `/organizations/${orgId}/devices/${deviceId}/bind-session`, {
    installationSecret,
  });
  const deviceToken = bound.body.accessToken;
  record('J-device-bound-token-minted', bound.status === 200 && typeof deviceToken === 'string', { httpStatus: bound.status });
  if (typeof deviceToken !== 'string') return null;

  return { deviceId, deviceToken };
}

/** J: the real device-bound offline adjustment — fold, replay, still 18. */
async function stepJ(binding, orgId, variantId, actorUserId) {
  const { deviceId, deviceToken } = binding;
  const aggregateId = randomUUID();
  const adjustment = offlineMutation(deviceId, orgId, actorUserId, deviceSequence(), 'INVENTORY_ADJUSTMENT', aggregateId, {
    movementId: aggregateId,
    cause: 'MANUAL_ADJUSTMENT',
    variantId,
    quantityDelta: '-5',
    reasonCode: 'LOST',
    reasonNote: 'أفقد من الجرد',
  });

  const pushed = await pushBatch(deviceToken, deviceId, [adjustment]);
  const outcome = outcomeOf(pushed, 'J-offline-adjustment-applied', adjustment.mutationId);
  record(
    'J-result-carries-the-fold',
    outcome?.status === 'APPLIED' && outcome?.resultRef === aggregateId && outcome?.resultHash?.length === 64,
    { resultRef: outcome?.resultRef },
  );

  const level = await http(deviceToken, 'GET', `/organizations/${orgId}/inventory/levels?variantId=${variantId}`);
  record('J-fold-moved-to-18', level.status === 200 && level.body.levels?.[0]?.quantity === '18', {
    quantity: level.body.levels?.[0]?.quantity,
  });

  const replay = await pushBatch(deviceToken, deviceId, [adjustment]);
  record(
    'J-identical-repush-answers-replay',
    replay.status === 200 && replay.body.outcomes?.[0]?.status === 'REPLAY',
    { outcome: replay.body?.outcomes?.[0]?.status },
  );

  const aftermath = await http(deviceToken, 'GET', `/organizations/${orgId}/inventory/levels?variantId=${variantId}`);
  record('J-replay-moved-nothing-again', aftermath.status === 200 && aftermath.body.levels?.[0]?.quantity === '18', {
    quantity: aftermath.body.levels?.[0]?.quantity,
  });
}

/** K: the offline count document, atomically applied. Reads ride the
 * device-bound token: the bind rewrote the session's device fact, so the
 * pre-binding owner token is honestly refused (§12.4 — the token and its
 * session agree about the device binding, in both directions). */
async function stepK(binding, orgId, variantId, actorUserId) {
  const { deviceId, deviceToken } = binding;
  const countId = randomUUID();
  const lineId = randomUUID();
  const offline = offlineMutation(deviceId, orgId, actorUserId, deviceSequence(), 'INVENTORY_COUNT', countId, {
    countId,
    lines: [{ lineId, variantId, countedQuantity: '16', reasonCode: 'EXPIRED' }],
  });

  const pushed = await pushBatch(deviceToken, deviceId, [offline]);
  const outcome = outcomeOf(pushed, 'K-offline-count-applied', offline.mutationId);
  record(
    'K-result-names-the-document',
    outcome?.status === 'APPLIED' && outcome?.resultRef === `count:${countId}`,
    { resultRef: outcome?.resultRef },
  );

  const level = await http(deviceToken, 'GET', `/organizations/${orgId}/inventory/levels?variantId=${variantId}`);
  record('K-fold-moved-to-16', level.status === 200 && level.body.levels?.[0]?.quantity === '16', {
    quantity: level.body.levels?.[0]?.quantity,
  });

  const document = await http(deviceToken, 'GET', `/organizations/${orgId}/inventory/counts/${countId}`);
  record(
    'K-document-reads-posted-with-its-movement',
    document.status === 200 &&
      document.body.count?.status === 'POSTED' &&
      document.body.count.lines?.length === 1 &&
      typeof document.body.count.lines[0]?.movementId === 'string',
    { httpStatus: document.status, documentStatus: document.body.count?.status },
  );

  const replay = await pushBatch(deviceToken, deviceId, [offline]);
  record(
    'K-identical-repush-answers-replay',
    replay.status === 200 && replay.body.outcomes?.[0]?.status === 'REPLAY',
    { outcome: replay.body?.outcomes?.[0]?.status },
  );
}

/** L: refusals are recorded honestly — never applied, never dropped. */
async function stepL(binding, orgId, variantId, actorUserId) {
  const { deviceId, deviceToken } = binding;

  const overdraw = offlineMutation(deviceId, orgId, actorUserId, deviceSequence(), 'INVENTORY_ADJUSTMENT', randomUUID(), {
    movementId: randomUUID(),
    cause: 'MANUAL_ADJUSTMENT',
    variantId,
    quantityDelta: '-99',
    reasonCode: 'LOST',
  });
  const first = await pushBatch(deviceToken, deviceId, [overdraw]);
  const outcome = outcomeOf(first, 'L-overdraw-pushed-rejected', overdraw.mutationId);
  record(
    'L-insufficient-stock-recorded',
    outcome?.status === 'REJECTED' && outcome?.rejectionCode === 'INSUFFICIENT_STOCK',
    { code: outcome?.rejectionCode },
  );

  const producerOnly = offlineMutation(deviceId, orgId, actorUserId, deviceSequence(), 'INVENTORY_ADJUSTMENT', randomUUID(), {
    movementId: randomUUID(),
    cause: 'STOCK_COUNT_ADJUSTMENT',
    variantId,
    quantityDelta: '-1',
    reasonCode: 'LOST',
  });
  const refused = await pushBatch(deviceToken, deviceId, [producerOnly]);
  const refusedOutcome = outcomeOf(refused, 'L-producer-only-cause-pushed-rejected', producerOnly.mutationId);
  record(
    'L-validation-failure-recorded',
    refusedOutcome?.status === 'REJECTED' && refusedOutcome?.rejectionCode === 'VALIDATION_FAILED',
    { code: refusedOutcome?.rejectionCode },
  );

  const again = await pushBatch(deviceToken, deviceId, [overdraw]);
  const againOutcome = outcomeOf(again, 'L-refused-repush-stays-refused', overdraw.mutationId);
  record(
    'L-nothing-silently-applied-on-retry',
    againOutcome?.status !== 'APPLIED',
    { replayStatus: againOutcome?.status },
  );

  const level = await http(deviceToken, 'GET', `/organizations/${orgId}/inventory/levels?variantId=${variantId}`);
  record('L-refusals-moved-nothing', level.status === 200 && level.body.levels?.[0]?.quantity === '16', {
    quantity: level.body.levels?.[0]?.quantity,
  });
}

// ---------------------------------------------------------------------------
// Step M — tenancy.
// ---------------------------------------------------------------------------

async function stepM(orgId, countId, variantId) {
  // The walkthrough's own session is device-bound by step J (§12.4: the token
  // and its session agree about the binding), so the owner logs in fresh — a
  // new, unbound session — to play org A's reading tenant.
  const ownerToken = await login(secrets.ownerEmail, secrets.ownerPassword);
  record('M-fresh-owner-login', typeof ownerToken === 'string' && ownerToken.length > 0, {});

  const bootstrapped = runBootstrap([
    '--bootstrap-key',
    'm4s4-walkthrough-b',
    '--name',
    'M4S4 Counts Walkthrough Shop B',
    '--owner-email',
    secrets.secondEmail,
  ]);
  const orgBId = bootstrapped.payload?.organizationId;
  record('M-second-org-bootstrapped', bootstrapped.code === 0 && typeof orgBId === 'string', { exitCode: bootstrapped.code });
  if (typeof orgBId !== 'string') return;

  const cred = runOperator('provision-credential.mjs', ['--email', secrets.secondEmail], {
    PROVISION_PASSWORD: secrets.secondPassword,
  });
  record('M-second-owner-credential-provisioned', cred.status === 0, { exitCode: cred.status });

  const tokenB = await login(secrets.secondEmail, secrets.secondPassword);
  record('M-second-owner-real-login', typeof tokenB === 'string' && tokenB.length > 0, {});

  await expectProblem(
    'M-cross-tenant-count-read-refused',
    await http(tokenB, 'GET', `/organizations/${orgId}/inventory/counts`),
    403,
    'ORGANIZATION_FORBIDDEN',
  );

  await expectProblem(
    'M-cross-tenant-count-write-refused',
    await http(tokenB, 'POST', `/organizations/${orgId}/inventory/counts`, {}),
    403,
    'ORGANIZATION_FORBIDDEN',
  );

  const own = await http(tokenB, 'GET', `/organizations/${orgBId}/inventory/counts`);
  record('M-second-org-count-page-honestly-empty', own.status === 200 && (own.body.counts?.length ?? 0) === 0, {
    countCount: own.body.counts?.length,
  });
}

// ---------------------------------------------------------------------------
// The runner.
// ---------------------------------------------------------------------------

async function fullRun() {
  const bootstrapped = runBootstrap([
    '--bootstrap-key',
    'm4s4-walkthrough',
    '--name',
    'M4S4 Counts Walkthrough Shop',
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

  const me = await http(token, 'GET', '/auth/me');
  const actorUserId = me.body.userId;
  record('prelude-verified-actor-resolved', me.status === 200 && typeof actorUserId === 'string', {});

  const variantId = await preludeCatalog(token, orgId);
  if (typeof variantId !== 'string') process.exit(1);

  const locationId = await stepA(token, orgId);
  if (typeof locationId !== 'string') process.exit(1);

  await stepB(token, orgId, variantId);
  const count = await stepC(token, orgId, locationId);
  if (typeof count?.countId !== 'string') process.exit(1);
  await stepD(token, orgId, count.countId, variantId);
  await stepE(token, orgId, count.countId, variantId);
  await stepF(token, orgId, count.countId, variantId);
  await stepG(token, orgId, count.countId, variantId);
  // The mutation, not the shadowing, is what stepH reads from its name below.
  await stepH(token, orgId, count.countId, variantId);
  await stepI(token, orgId, variantId, '23');

  const binding = await registerAndBindDevice(token, orgId);
  if (binding === null) process.exit(1);
  await stepJ(binding, orgId, variantId, actorUserId);
  await stepK(binding, orgId, variantId, actorUserId);
  await stepL(binding, orgId, variantId, actorUserId);

  await stepM(orgId, count.countId, variantId);

  process.exitCode = failures === 0 ? 0 : 1;
}

process.on('unhandledRejection', (error) => {
  record('unhandled', false, { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});

await fullRun();
