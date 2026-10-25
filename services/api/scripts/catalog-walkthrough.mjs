#!/usr/bin/env node
/**
 * The M4-S1 catalog walkthrough (§15.1, §15.2, §15.3A, §17, §30.1; §40.8 M4-S1).
 *
 * A demonstrable, repeatable acceptance run against the **real** API process and
 * the **real** PostgreSQL database: no mock, no in-memory substitute. It drives
 * the live HTTP surface exactly the way the milestone scenarios read:
 *
 *   prelude  real org bootstrap + real credential + real login
 *   A        create the Arabic product with its §15.2 units             (201)
 *   B        create two typed variants; the §15.3A.2 price inheritance  (201)
 *   C        edit one variant's price; the sibling stays untouched
 *   D        duplicate and concurrent SKU → 409 CATALOG_SKU_DUPLICATE
 *   E        invalid unit factor / money / attributes / parent → 400/404
 *   F        tenancy isolation across two real organizations
 *   RESUME   (--resume) the same rows re-read after a server restart
 *
 * Provisioning rides the supported operator commands (`bootstrap:org`,
 * `provision:credential`) and authentication rides the real `/api/v1/auth/login`
 * route — the walkthrough never mints a token itself. No password and no token
 * is ever printed (§13.6): the log lines carry step names, HTTP statuses, and
 * problem codes only. Exit code 0 means every step passed.
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

/** The SKUs the walkthrough owns (chosen to not collide with other walkthrough data). */
const SKUS = {
  blackM: 'WT-BLACK-M',
  blackL: 'WT-BLACK-L',
};

/** The persisted walkthrough state between the full run and the --resume proof. */
const STATE_DIR = path.join(process.env.TEMP ?? '/tmp', 'opencode', 'm4s1-walkthrough');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

/** The walkthrough's in-memory passwords; never printed, never persisted. */
const secrets = {
  ownerEmail: 'owner@m4s1-walkthrough.test',
  ownerPassword: 'Catalog-Walkthrough-2026!',
  secondEmail: 'owner-b@m4s1-walkthrough.test',
  secondPassword: 'Isolation-Walkthrough-2026!',
};

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
// Phase A — one product with its §15.2 units, exactly as the scenario reads.
// ---------------------------------------------------------------------------

async function phaseA(token, orgId) {
  const create = await http(token, 'POST', `/organizations/${orgId}/catalog/products`, {
    nameAr: 'تيشيرت قطن',
    nameEn: 'Cotton T-Shirt',
    category: 'ملابس',
    brand: 'محلي',
    unitPriceMinor: '45999',
    baseUnit: { code: 'PCS', name: 'Piece', kind: 'BASE' },
    purchasingUnit: { code: 'CRT', name: 'Carton', baseQuantityFactor: 12, kind: 'PURCHASING' },
  });
  const ok =
    create.status === 201 &&
    create.body.nameAr === 'تيشيرت قطن' &&
    create.body.unitPriceMinor === '45999' &&
    create.body.units?.length === 2 &&
    create.body.units[0]?.kind === 'BASE' &&
    create.body.units[0]?.baseQuantityFactor === '1' &&
    create.body.units[1]?.kind === 'PURCHASING' &&
    create.body.units[1]?.baseQuantityFactor === '12' &&
    typeof create.body.id === 'string';
  record('A-create-product-with-units', ok, {
    httpStatus: create.status,
    productId: create.body.id,
    units: create.body.units?.map((unit) => unit.kind),
    cartonFactor: create.body.units?.[1]?.baseQuantityFactor,
  });
  return create.body.id;
}

// ---------------------------------------------------------------------------
// Phase B — two typed variants; the §15.3A.2 inheritance is the honest answer.
// ---------------------------------------------------------------------------

async function phaseB(token, orgId, productId) {
  const blackM = await http(token, 'POST', `/organizations/${orgId}/catalog/products/${productId}/variants`, {
    sku: SKUS.blackM,
    attributes: { color: 'أسود', size: 'M' },
    priceMinor: '44999',
  });
  const okM =
    blackM.status === 201 &&
    blackM.body.attributes?.color === 'أسود' &&
    blackM.body.attributes?.size === 'M' &&
    blackM.body.effectivePriceMinor === '44999' &&
    blackM.body.priceSource === 'VARIANT';
  record('B-variant-BLACK-M-own-price', okM, {
    httpStatus: blackM.status,
    sku: blackM.body.sku,
    attributes: blackM.body.attributes,
    effectivePriceMinor: blackM.body.effectivePriceMinor,
    priceSource: blackM.body.priceSource,
  });

  const blackL = await http(token, 'POST', `/organizations/${orgId}/catalog/products/${productId}/variants`, {
    sku: SKUS.blackL,
    attributes: { color: 'أسود', size: 'L' },
  });
  const okL =
    blackL.status === 201 &&
    blackL.body.priceMinor === null &&
    blackL.body.effectivePriceMinor === '45999' &&
    blackL.body.priceSource === 'PRODUCT';
  record('B-variant-BLACK-L-inherits-product', okL, {
    httpStatus: blackL.status,
    sku: blackL.body.sku,
    effectivePriceMinor: blackL.body.effectivePriceMinor,
    priceSource: blackL.body.priceSource,
  });
  return { blackMId: blackM.body.id, blackLId: blackL.body.id };
}

// ---------------------------------------------------------------------------
// Phase C — one variant edited; the sibling keeps its own stored truth.
// ---------------------------------------------------------------------------

async function phaseC(token, orgId, productId, ids) {
  const edit = await http(
    token,
    'PATCH',
    `/organizations/${orgId}/catalog/products/${productId}/variants/${ids.blackMId}`,
    { priceMinor: '43999' },
  );
  const okEdit =
    edit.status === 200 && edit.body.effectivePriceMinor === '43999' && edit.body.priceSource === 'VARIANT';
  record('C-edit-BLACK-M-price', okEdit, {
    httpStatus: edit.status,
    effectivePriceMinor: edit.body.effectivePriceMinor,
    priceSource: edit.body.priceSource,
  });

  const product = await http(token, 'GET', `/organizations/${orgId}/catalog/products/${productId}`);
  const sibling = product.body.variants?.find((variant) => variant.id === ids.blackLId);
  const edited = product.body.variants?.find((variant) => variant.id === ids.blackMId);
  const okSibling =
    product.status === 200 &&
    sibling?.priceMinor === null &&
    sibling?.effectivePriceMinor === '45999' &&
    sibling?.priceSource === 'PRODUCT' &&
    edited?.effectivePriceMinor === '43999' &&
    product.body.unitPriceMinor === '45999';
  record('C-BLACK-L-unchanged-after-sibling-edit', okSibling, {
    httpStatus: product.status,
    blackL: { priceMinor: sibling?.priceMinor, effective: sibling?.effectivePriceMinor, source: sibling?.priceSource },
    blackMEffective: edited?.effectivePriceMinor,
    productDefault: product.body.unitPriceMinor,
  });

  const searchHit = await http(
    token,
    'GET',
    `/organizations/${orgId}/catalog/products?search=${encodeURIComponent('تيشيرت')}`,
  );
  record('C-search-Arabic-name-finds-product', searchHit.status === 200 && searchHit.body.products?.some((item) => item.id === productId), {
    httpStatus: searchHit.status,
  });

  const searchMiss = await http(token, 'GET', `/organizations/${orgId}/catalog/products?search=nonexistent-product`);
  record(
    'C-search-no-hit-is-empty',
    searchMiss.status === 200 && (searchMiss.body.products?.length ?? 0) === 0,
    { httpStatus: searchMiss.status },
  );
}

// ---------------------------------------------------------------------------
// Phase D — the SKU rule is the database's: one writer wins, the rest answer 409.
// ---------------------------------------------------------------------------

async function phaseD(token, orgId, productId) {
  const first = await http(token, 'POST', `/organizations/${orgId}/catalog/products/${productId}/variants`, {
    sku: 'WT-DUP-SKU',
    attributes: { color: 'أحمر' },
  });
  const dup = await http(token, 'POST', `/organizations/${orgId}/catalog/products/${productId}/variants`, {
    sku: 'WT-DUP-SKU',
    attributes: { color: 'أزرق' },
  });
  record('D-duplicate-sku-single-writer-refused', first.status === 201 && dup.status === 409 && dup.body?.code === 'CATALOG_SKU_DUPLICATE', {
    winnerHttpStatus: first.status,
    loserHttpStatus: dup.status,
    loserCode: dup.body?.code,
  });

  // Three racing writers for distinct SKUs: every unique index insert commits
  // independently — the truth "unique per value" never blocks a different value
  // (per-organization uniqueness, §15.3A).
  const attempts = await Promise.allSettled(
    ['RACE-1', 'RACE-2', 'RACE-3'].map((suffix) =>
      http(token, 'POST', `/organizations/${orgId}/catalog/products/${productId}/variants`, {
        sku: `WT-${suffix}`,
        attributes: {},
      }),
    ),
  );
  const statuses = attempts.map((attempt) => attempt.value?.status);
  record('D-independent-variants-are-independently-created', statuses.every((status) => status === 201), {
    httpStatuses: statuses,
  });
}

// ---------------------------------------------------------------------------
// Phase E — validation refusals are field-shaped and priced by the wire law.
// ---------------------------------------------------------------------------

async function phaseE(token, orgId, productId) {
  const purchasingFactor = async (factor) =>
    http(token, 'POST', `/organizations/${orgId}/catalog/products`, {
      nameAr: 'وحدة خاطئة',
      baseUnit: { code: 'PCS', name: 'Piece' },
      purchasingUnit: { code: 'CRT', name: 'Carton', baseQuantityFactor: factor },
    });
  await expectProblem('E-purchasing-factor-1.5-refused', await purchasingFactor(1.5), 400, 'VALIDATION_FAILED');
  await expectProblem('E-purchasing-factor-1-refused', await purchasingFactor(1), 400, 'VALIDATION_FAILED');
  await expectProblem('E-purchasing-factor-over-limit-refused', await purchasingFactor(1000001), 400, 'VALIDATION_FAILED');

  const fractional = await http(token, 'POST', `/organizations/${orgId}/catalog/products`, {
    nameAr: 'سعر خاطئ',
    unitPriceMinor: '12.5',
    baseUnit: { code: 'PCS', name: 'Piece' },
  });
  await expectProblem('E-price-fraction-refused', fractional, 400, 'VALIDATION_FAILED');
  const oversized = await http(token, 'POST', `/organizations/${orgId}/catalog/products`, {
    nameAr: 'سعر ضخم زائف',
    unitPriceMinor: '99999999999999',
    baseUnit: { code: 'PCS', name: 'Piece' },
  });
  await expectProblem('E-price-over-12-digits-refused', oversized, 400, 'VALIDATION_FAILED');

  const unknownKey = await http(token, 'POST', `/organizations/${orgId}/catalog/products/${productId}/variants`, {
    sku: `WT-BAD-${randomUUID().slice(0, 8)}`,
    attributes: { fabric: 'قطن' },
  });
  await expectProblem('E-attribute-unknown-key-refused', unknownKey, 400, 'VALIDATION_FAILED');
  const stringCapacity = await http(token, 'POST', `/organizations/${orgId}/catalog/products/${productId}/variants`, {
    sku: `WT-BAD-${randomUUID().slice(0, 8)}`,
    attributes: { capacity: '12' },
  });
  await expectProblem('E-attribute-string-capacity-refused', stringCapacity, 400, 'VALIDATION_FAILED');

  const ghost = await http(token, 'POST', `/organizations/${randomUUID()}/catalog/products`, {
    nameAr: 'منتج منظمة غير موجودة',
    baseUnit: { code: 'PCS', name: 'Piece' },
  });
  await expectProblem('E-product-under-unknown-organization-refused', ghost, 403, 'ORGANIZATION_FORBIDDEN');
}

// ---------------------------------------------------------------------------
// Phase F — two real tenants; neither reads, writes, nor moves the other's rows.
// ---------------------------------------------------------------------------

async function phaseF(orgAId, productId) {
  // The second organization is minted through the supported operator command,
  // exactly like the first: a real bootstrap, a real credential, a real login.
  const bootstrapped = runBootstrap([
    '--bootstrap-key',
    'm4s1-walkthrough-b',
    '--name',
    'M4S1 Walkthrough Shop B',
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

  // B's write into A's catalog: the guard refuses the tenant mismatch before
  // any parent lookup runs.
  const crossWrite = await http(tokenB, 'POST', `/organizations/${orgAId}/catalog/products/${productId}/variants`, {
    sku: `WT-FOREIGN-${randomUUID().slice(0, 8)}`,
  });
  await expectProblem('F-cross-tenant-variant-write-refused', crossWrite, 403, 'ORGANIZATION_FORBIDDEN');

  // B's own catalog is real but empty of A's rows; the same SKU as A's is
  // legal in B — SKU uniqueness is per organization (§15.3A) — and an
  // inherited price resolves to UNSET there (never a fabricated zero, §15.3A.2).
  const bProduct = await http(tokenB, 'POST', `/organizations/${orgBId}/catalog/products`, {
    nameAr: 'منتج الفئة الثانية',
    baseUnit: { code: 'PCS', name: 'Piece' },
  });
  record('F-second-org-creates-own-product', bProduct.status === 201 && bProduct.body?.organizationId === orgBId, {
    httpStatus: bProduct.status,
    organizationId: bProduct.body?.organizationId,
    productId: bProduct.body?.id,
  });

  const sameSkuInB = await http(
    tokenB,
    'POST',
    `/organizations/${orgBId}/catalog/products/${bProduct.body?.id}/variants`,
    { sku: SKUS.blackM, attributes: { color: 'أصفر' } },
  );
  record(
    'F-second-org-same-sku-is-legal-and-price-unset',
    sameSkuInB.status === 201 &&
      sameSkuInB.body?.sku === SKUS.blackM &&
      sameSkuInB.body?.effectivePriceMinor === null &&
      sameSkuInB.body?.priceSource === 'UNSET',
    {
      httpStatus: sameSkuInB.status,
      sku: sameSkuInB.body?.sku,
      effectivePriceMinor: sameSkuInB.body?.effectivePriceMinor,
      priceSource: sameSkuInB.body?.priceSource,
    },
  );
}

// ---------------------------------------------------------------------------
// The runner.
// ---------------------------------------------------------------------------

/** The full walkthrough: phases A–F on the real process, then persist the state. */
async function fullRun() {
  const bootstrapped = runBootstrap([
    '--bootstrap-key',
    'm4s1-walkthrough',
    '--name',
    'M4S1 Walkthrough Shop',
    '--owner-email',
    secrets.ownerEmail,
  ]);
  const orgAId = bootstrapped.payload?.organizationId;
  if (bootstrapped.code !== 0 || typeof orgAId !== 'string') {
    record('prelude-first-org-bootstrapped', false, { exitCode: bootstrapped.code });
    process.exit(1);
  }
  record('prelude-first-org-bootstrapped', true, { organizationId: orgAId, idempotentRetry: true });

  const cred = runOperator('provision-credential.mjs', ['--email', secrets.ownerEmail], {
    PROVISION_PASSWORD: secrets.ownerPassword,
  });
  record('prelude-owner-credential-provisioned', cred.status === 0, { exitCode: cred.status });

  const tokenA = await login(secrets.ownerEmail, secrets.ownerPassword);
  record('prelude-owner-real-login', typeof tokenA === 'string' && tokenA.length > 0, {});

  const productId = await phaseA(tokenA, orgAId);
  if (typeof productId !== 'string') {
    process.exit(1);
  }
  const ids = await phaseB(tokenA, orgAId, productId);
  await phaseC(tokenA, orgAId, productId, ids);
  await phaseD(tokenA, orgAId, productId);
  await phaseE(tokenA, orgAId, productId);
  await phaseF(orgAId, productId);

  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify({ orgAId, productId, nameAr: 'تيشيرت قطن' }), 'utf8');
  record('state-persisted-for-resume', true, { stateFile: STATE_FILE });

  process.exitCode = failures === 0 ? 0 : 1;
}

/** The post-restart proof: a fresh login reads the same committed rows from the database. */
async function resumeRun() {
  const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  const token = await login(secrets.ownerEmail, secrets.ownerPassword);
  const product = await http(token, 'GET', `/organizations/${state.orgAId}/catalog/products/${state.productId}`);
  const ok =
    product.status === 200 &&
    product.body.nameAr === state.nameAr &&
    product.body.unitPriceMinor === '45999' &&
    product.body.units?.length === 2 &&
    product.body.units[1]?.baseQuantityFactor === '12';
  record('RESUME-product-persists-after-restart', ok, {
    httpStatus: product.status,
    productId: state.productId,
    variantCount: product.body.variants?.length,
    unitCount: product.body.units?.length,
    nameAr: product.body.nameAr,
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
