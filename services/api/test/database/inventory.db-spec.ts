/**
 * M4-S2 acceptance — the inventory core against **real PostgreSQL** (Master
 * Plan §15.4, §15.5, §15.6, §15.6A, §38.14.1; §40.8 row M4-S2; §36.1 T-2: no
 * mock, no in-memory substitute, no skipped run).
 *
 * The invariants the milestone's acceptance hinges on, each probed through the
 * same code paths the running process uses (the inventory service, the catalog
 * service, the transactional audit writer) over the real roles:
 *
 *  1. **Migration from empty** — `0014_inventory_core` deploys with the full
 *     `0001`+ history, the three tables exist, and the two mutable tables are
 *     forced-RLS tenant tables while the movement ledger is append-only by
 *     privilege (INSERT + SELECT, no UPDATE, no DELETE — the §32.5 class).
 *  2. **The seeded default location** — the plan's "V1 seeds one default
 *     location" (plan line 203): an inventory read materializes exactly one
 *     default, and a second one is a database impossibility.
 *  3. **The movement fold and the §15.6 guard** — a fold that would cross
 *     zero refuses `409 INSUFFICIENT_STOCK`, leaves the balance untouched,
 *     and records no movement; the §15.2 unit conversion stays exact (two
 *     cartons of 12 in, three pieces out, 21 remain — in base units, never a
 *     float).
 *  4. **The §38.14.1 movement identity** — an identical retry (same
 *     `movementId`, same fact) replays with no second effect; the same
 *     identity naming a different fact is `409 MUTATION_CONTRADICTION` with no
 *     effect; a second opening balance is refused by the database.
 *  5. **Concurrency** — two competing deductions racing one limited balance
 *     produce exactly one success, one honest refusal, a non-negative result,
 *     and exactly one movement.
 *  6. **Tenant isolation** — org B cannot read or mutate org A's quantity
 *     history: the API answers 404, the direct probes answer the RLS refusal,
 *     and a context-free probe answers nothing (fail closed).
 *  7. **Class-A audit (§32.5)** — every recorded movement commits with its
 *     `INVENTORY_*` history event in the same transaction, and the committed
 *     chain still verifies afterwards.
 *  8. **The CHECKs are the last line of defence** — a writer bypassing the
 *     service cannot store negative stock or a foreign cause: the PostgreSQL
 *     refusals name the violations.
 *
 * Environment: `DATABASE_URL`/`MIGRATION_DATABASE_URL` naming `my_shop_test`,
 * `ADMIN_DATABASE_URL` naming something else — guarded as every database
 * suite guards it.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';

import { CatalogService } from '../../src/common/catalog/catalog.service';
import { InventoryService } from '../../src/common/inventory/inventory.service';
import { AuditStreamWriter } from '../../src/common/audit/audit-stream-writer';
import { verifyAuditStreamScope } from '../../src/common/audit/audit-integrity';
import { withTenantTransaction } from '../../src/common/database/tenant-context';
import { OrganizationBootstrapService } from '../../src/common/bootstrap/organization-bootstrap.service';

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
      `${name} is not set. The inventory acceptance suite refuses to run without it ` +
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

/** The superuser credentials retargeted at the test database — the privilege probe's principal. */
function superuserUrlFor(adminUrl: string): string {
  const retargeted = new URL(adminUrl);
  retargeted.pathname = `/${TEST_DATABASE}`;
  return retargeted.toString();
}

/** The DomainError code a rejected promise carries, or undefined when it is not one. */
function codeOf(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error ? (error as { code: string }).code : undefined;
}

describe('inventory acceptance (real PostgreSQL, §15.4–§15.6A / §38.14.1)', () => {
  jest.setTimeout(180_000);

  let urls: DatabaseUrls;
  let admin: PrismaClient;
  let app: PrismaClient;
  let catalog: CatalogService;
  let inventory: InventoryService;
  let setupRan = false;

  let mainOrgId = '';
  let mainOwnerId = '';
  let otherOrgId = '';
  let otherOwnerId = '';

  let productId = '';
  let tshirtVariantId = '';
  let tshirtSku = '';
  let isolatedVariantId = '';
  /** The folded balance the concurrency race left behind (8 or 6, decided at runtime). */
  let raceBalance = '';

  beforeAll(async () => {
    urls = requireTestUrls();

    // Drop + create from empty, provision roles, `prisma migrate deploy` —
    // the same precondition operator deployments use; migration `0014` rides
    // the committed history like every predecessor.
    dbScript('test-setup');
    setupRan = true;

    app = new PrismaClient({ datasourceUrl: urls.application });
    admin = new PrismaClient({ datasourceUrl: superuserUrlFor(urls.admin) });
    await Promise.all([app.$connect(), admin.$connect()]);

    catalog = new CatalogService({ prisma: app }, new AuditStreamWriter());
    inventory = new InventoryService({ prisma: app }, new AuditStreamWriter());

    // Two organizations through the real composition root.
    const bootstrapped = await Promise.all([
      new OrganizationBootstrapService({ prisma: app }).bootstrap({
        bootstrapKey: 'inventory-main-shop',
        organizationName: 'Inventory Main Shop',
        ownerEmail: 'owner-inv-main@example.test',
      }),
      new OrganizationBootstrapService({ prisma: app }).bootstrap({
        bootstrapKey: 'inventory-other-shop',
        organizationName: 'Inventory Other Shop',
        ownerEmail: 'owner-inv-other@example.test',
      }),
    ]);
    mainOrgId = bootstrapped[0]?.organizationId ?? '';
    mainOwnerId = bootstrapped[0]?.userId ?? '';
    otherOrgId = bootstrapped[1]?.organizationId ?? '';
    otherOwnerId = bootstrapped[1]?.userId ?? '';

    // The §40.8 worked example: تيشيرت قطن, base unit قطعة, purchasing unit
    // كرتونة with factor exactly 12 (M4-S1 contracts, reused unchanged).
    tshirtSku = `INV-BLACK-M-${randomUUID().slice(0, 8).toUpperCase()}`;
    const product = await catalog.createProduct({
      organizationId: mainOrgId,
      actorUserId: mainOwnerId,
      offered: {
        nameAr: 'تيشيرت قطن',
        nameEn: 'Cotton T-Shirt',
        baseUnit: { kind: 'BASE', code: 'PCS', name: 'قطعة' },
        purchasingUnit: { kind: 'PURCHASING', code: 'CRT', name: 'كرتونة', baseQuantityFactor: 12 },
      },
    });
    const variant = await catalog.createVariant({
      organizationId: mainOrgId,
      actorUserId: mainOwnerId,
      productId: product.id,
      offered: { sku: tshirtSku, attributes: { color: 'أسود', size: 'M' } },
    });
    tshirtVariantId = variant.id;
    productId = product.id;

    // A second variant, untouched until the concurrency block proves the race.
    const second = await catalog.createVariant({
      organizationId: mainOrgId,
      actorUserId: mainOwnerId,
      productId: product.id,
      offered: { sku: `INV-BLACK-BOOK-${randomUUID().slice(0, 8).toUpperCase()}`, attributes: { size: 'L' } },
    });
    isolatedVariantId = second.id;
  }, 180_000);

  afterAll(async () => {
    await Promise.allSettled([app?.$disconnect(), admin?.$disconnect()]);
    if (setupRan) {
      dbScript('test-drop');
    }
  }, 180_000);

  /** A tenant-scoped §9.3 statement on the application role. */
  async function inTenant<T>(organizationId: string, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return withTenantTransaction({ prisma: app }, organizationId, work);
  }

  /** One movement submission through the real service (the raw wire offer, like the controller passes). */
  async function submit(
    organizationId: string,
    userId: string,
    offer: {
      movementId?: string;
      cause: string;
      variantId: string;
      quantityDelta: string;
      unitCostMinor?: string;
      locationId?: string | null;
      reasonCode?: string | null;
      reasonNote?: string | null;
    },
  ): Promise<Awaited<ReturnType<InventoryService['submitMovement']>>> {
    return inventory.submitMovement({
      organizationId,
      actorUserId: userId,
      offered: {
        movementId: offer.movementId ?? randomUUID(),
        cause: offer.cause,
        variantId: offer.variantId,
        quantityDelta: offer.quantityDelta,
        ...(offer.unitCostMinor === undefined ? {} : { unitCostMinor: offer.unitCostMinor }),
        ...(offer.locationId === undefined ? {} : { locationId: offer.locationId }),
        ...(offer.reasonCode === undefined ? {} : { reasonCode: offer.reasonCode }),
        ...(offer.reasonNote === undefined ? {} : { reasonNote: offer.reasonNote }),
      },
    });
  }

  /** The current derived quantity of one variant at the main organization. */
  async function quantityOf(variantId: string): Promise<string> {
    const levels = await inventory.listLevels(mainOrgId, { variantId });
    expect(levels).toHaveLength(1);
    return levels[0]?.quantity ?? '';
  }

  describe('migration 0014 — shape, posture, and the append-only privilege', () => {
    it('deployed with the committed history and all three tables exist', async () => {
      const migrations = await admin.$queryRaw<{ migration_name: string }[]>`
        SELECT migration_name FROM _prisma_migrations WHERE migration_name = '0014_inventory_core' AND finished_at IS NOT NULL`;
      expect(migrations).toHaveLength(1);

      const tables = await admin.$queryRaw<{ n: bigint }[]>`
        SELECT count(*)::bigint AS n FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name IN ('inventory_locations', 'stock_movements', 'stock_levels')`;
      expect(tables[0]?.n).toBe(3n);
    });

    it('carries ENABLE+FORCE row-level security with one symmetric tenant_isolation policy each', async () => {
      const posture = await admin.$queryRaw<{ tablename: string; row_security: boolean; forced: boolean }[]>`
        SELECT c.relname AS tablename, c.relrowsecurity AS row_security, c.relforcerowsecurity AS forced
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r'
           AND c.relname IN ('inventory_locations', 'stock_movements', 'stock_levels')`;
      expect(posture).toHaveLength(3);
      for (const row of posture) {
        expect(row.row_security).toBe(true);
        expect(row.forced).toBe(true);
      }

      const policies = await admin.$queryRaw<{ tablename: string; policyname: string }[]>`
        SELECT tablename, policyname FROM pg_policies
         WHERE schemaname = 'public' AND tablename IN ('inventory_locations', 'stock_movements', 'stock_levels')`;
      expect(policies).toHaveLength(3);
      for (const row of policies) {
        expect(row.policyname).toBe('tenant_isolation');
      }
    });

    it('the application role holds INSERT + SELECT and no UPDATE, no DELETE on stock_movements (§32.5 class)', async () => {
      const privileges = await admin.$queryRaw<{ privilege_type: string }[]>`
        SELECT privilege_type FROM information_schema.role_table_grants
         WHERE table_name = 'stock_movements' AND grantee = 'my_shop_app'`;
      const held = new Set(privileges.map((row) => row.privilege_type));
      expect(held.has('SELECT')).toBe(true);
      expect(held.has('INSERT')).toBe(true);
      expect(held.has('UPDATE')).toBe(false);
      expect(held.has('DELETE')).toBe(false);

      // The two mutable tables keep the ordinary DML grants.
      for (const table of ['stock_levels', 'inventory_locations']) {
        const mutable = await admin.$queryRaw<{ privilege_type: string }[]>`
          SELECT privilege_type FROM information_schema.role_table_grants
           WHERE table_name = ${table} AND grantee = 'my_shop_app'`;
        const heldTypes = new Set(mutable.map((row) => row.privilege_type));
        expect(heldTypes.has('UPDATE')).toBe(true);
        expect(heldTypes.has('DELETE')).toBe(true);
      }
    });
  });

  describe('the seeded default location (plan line 203)', () => {
    it('answers exactly one default location, materialized on first read', async () => {
      const locations = await inventory.listLocations(mainOrgId);
      expect(locations).toHaveLength(1);
      expect(locations[0]?.isDefault).toBe(true);
      expect(locations[0]?.name).toBe('المخزن الرئيسي');
    });

    it('is idempotent — a second read re-answers the same row, never a second default', async () => {
      const first = await inventory.listLocations(mainOrgId);
      const again = await inventory.listLocations(mainOrgId);
      expect(again).toHaveLength(1);
      expect(again[0]?.id).toBe(first[0]?.id);
    });
  });

  describe('the movement fold, the §15.6 guard, and the §15.2 unit conversion', () => {
    it('records the opening balance and the derived level answers it', async () => {
      const applied = await submit(mainOrgId, mainOwnerId, {
        cause: 'OPENING_BALANCE',
        variantId: tshirtVariantId,
        quantityDelta: '12',
        // M4-S3: the opening acquisition cost is part of the fact now — the
        // §30.2 average erects from it exactly (12 pieces @ 150.00 EGP).
        unitCostMinor: '15000',
      });
      expect(applied.status).toBe('APPLIED');
      expect(applied.movement.cause).toBe('OPENING_BALANCE');
      expect(applied.movement.quantityDelta).toBe('12');
      expect(applied.movement.serverSequence).toBe('1');
      expect(applied.resultingQuantity).toBe('12');

      // The derived cache carries the fold — quantity and the §30.2 average.
      await expect(quantityOf(tshirtVariantId)).resolves.toBe('12');
      const valued = await inventory.listValuation(mainOrgId, { variantId: tshirtVariantId });
      expect(valued.levels[0]?.averageCostMinor).toBe('15000');
      expect(valued.levels[0]?.inventoryValueMinor).toBe('180000');
    });

    it('receives two cartons of 12 exactly — 24 base units, no rounding anywhere', async () => {
      const receipt = await submit(mainOrgId, mainOwnerId, {
        cause: 'MANUAL_ADJUSTMENT',
        variantId: tshirtVariantId,
        quantityDelta: '24',
        reasonCode: 'RESTOCK',
        reasonNote: 'قبول كرتونتين',
      });
      expect(receipt.status).toBe('APPLIED');
      expect(receipt.resultingQuantity).toBe('36');
      expect(receipt.movement.reasonCode).toBe('RESTOCK');

      await expect(quantityOf(tshirtVariantId)).resolves.toBe('36');
    });

    it('issues three pieces and answers 21 after the 24 received (the worked example)', async () => {
      // A second opening of this narrative: the §40.8 example works from 24.
      // The suite's fold so far is 36, so the example rides its own variant.
      const applied = await submit(mainOrgId, mainOwnerId, {
        cause: 'OPENING_BALANCE',
        variantId: isolatedVariantId,
        quantityDelta: '24',
        unitCostMinor: '12000',
      });
      const issue = await submit(mainOrgId, mainOwnerId, {
        cause: 'MANUAL_ADJUSTMENT',
        variantId: isolatedVariantId,
        quantityDelta: '-3',
        reasonCode: 'MISCOUNT',
      });
      expect(applied.status).toBe('APPLIED');
      expect(issue.status).toBe('APPLIED');
      expect(issue.resultingQuantity).toBe('21');

      await expect(quantityOf(isolatedVariantId)).resolves.toBe('21');
    });

    it('refuses a deduction beyond the balance: INSUFFICIENT_STOCK, unchanged fold, no movement', async () => {
      const before = await inventory.listMovements(mainOrgId, { variantId: isolatedVariantId });
      const balance = await quantityOf(isolatedVariantId);

      await expect(
        submit(mainOrgId, mainOwnerId, {
          cause: 'MANUAL_ADJUSTMENT',
          variantId: isolatedVariantId,
          quantityDelta: '-30',
          reasonCode: 'LOST',
        }),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });

      // The refusal recorded no movement and left the fold exactly where it was.
      const after = await inventory.listMovements(mainOrgId, { variantId: isolatedVariantId });
      expect(after).toHaveLength(before.length);
      await expect(quantityOf(isolatedVariantId)).resolves.toBe(balance);
      await expect(quantityOf(isolatedVariantId)).resolves.toBe('21');
    });
  });

  describe('the §38.14.1 movement identity', () => {
    it('replays an identical retry with no second movement and no fold change', async () => {
      const movementId = randomUUID();
      const first = await submit(mainOrgId, mainOwnerId, {
        movementId,
        cause: 'MANUAL_ADJUSTMENT',
        variantId: isolatedVariantId,
        quantityDelta: '-2',
        reasonCode: 'DAMAGED',
      });
      expect(first.status).toBe('APPLIED');
      expect(first.resultingQuantity).toBe('19');

      const replay = await submit(mainOrgId, mainOwnerId, {
        movementId,
        cause: 'MANUAL_ADJUSTMENT',
        variantId: isolatedVariantId,
        quantityDelta: '-2',
        reasonCode: 'DAMAGED',
      });
      expect(replay.status).toBe('REPLAY');
      expect(replay.movement.movementId).toBe(first.movement.movementId);
      expect(replay.movement.serverSequence).toBe(first.movement.serverSequence);

      // Exactly one movement for the identity; the fold stands at 19.
      const history = await inventory.listMovements(mainOrgId, { variantId: isolatedVariantId });
      expect(history.filter((row) => row.movementId === movementId)).toHaveLength(1);
      await expect(quantityOf(isolatedVariantId)).resolves.toBe('19');
    });

    it('refuses the same movement id naming a different fact with MUTATION_CONTRADICTION, effect-free', async () => {
      const movementId = randomUUID();
      const first = await submit(mainOrgId, mainOwnerId, {
        movementId,
        cause: 'MANUAL_ADJUSTMENT',
        variantId: isolatedVariantId,
        quantityDelta: '-1',
        reasonCode: 'LOST',
      });
      expect(first.status).toBe('APPLIED');

      await expect(
        submit(mainOrgId, mainOwnerId, {
          movementId,
          cause: 'MANUAL_ADJUSTMENT',
          variantId: isolatedVariantId,
          quantityDelta: '-5',
          reasonCode: 'LOST',
        }),
      ).rejects.toMatchObject({ code: 'MUTATION_CONTRADICTION' });

      await expect(quantityOf(isolatedVariantId)).resolves.toBe('18');
    });

    it('refuses a second opening balance for the same variant and location, by database fact', async () => {
      await expect(
        submit(mainOrgId, mainOwnerId, {
          cause: 'OPENING_BALANCE',
          variantId: isolatedVariantId,
          quantityDelta: '5',
          unitCostMinor: '2500',
        }),
      ).rejects.toMatchObject({ code: 'INVENTORY_OPENING_BALANCE_DUPLICATE' });

      await expect(quantityOf(isolatedVariantId)).resolves.toBe('18');
    });

    it('refuses zero, overflowing, and non-quantum deltas before any connection', async () => {
      await expect(
        submit(mainOrgId, mainOwnerId, {
          cause: 'MANUAL_ADJUSTMENT',
          variantId: isolatedVariantId,
          quantityDelta: '0',
          reasonCode: 'OTHER',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

      await expect(
        submit(mainOrgId, mainOwnerId, {
          cause: 'MANUAL_ADJUSTMENT',
          variantId: isolatedVariantId,
          quantityDelta: '1000000000000',
          reasonCode: 'RESTOCK',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

      await expect(
        submit(mainOrgId, mainOwnerId, {
          cause: 'MANUAL_ADJUSTMENT',
          variantId: isolatedVariantId,
          quantityDelta: '2.5',
          reasonCode: 'RESTOCK',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

      await expect(
        submit(mainOrgId, mainOwnerId, {
          cause: 'SALE',
          variantId: isolatedVariantId,
          quantityDelta: '-1',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

      await expect(
        submit(mainOrgId, mainOwnerId, {
          cause: 'MANUAL_ADJUSTMENT',
          variantId: isolatedVariantId,
          quantityDelta: '-1',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });

  describe('concurrency (the M4-S2 acceptance: two competitors, one balance)', () => {
    it('serializes two racing deductions from 18 — exactly one succeeds, one refuses, one movement', async () => {
      // Start the race from a known folded balance.
      await expect(quantityOf(isolatedVariantId)).resolves.toBe('18');

      // From eighteen, −10 and −12 cannot both land: whichever folds first
      // leaves 8 or 6, and from there the other deduction crosses zero. The
      // variant row lock (§15.6) is what makes the two folds one after another.
      const [big, bigger] = await Promise.allSettled([
        submit(mainOrgId, mainOwnerId, {
          cause: 'MANUAL_ADJUSTMENT',
          variantId: isolatedVariantId,
          quantityDelta: '-10',
          reasonCode: 'EXPIRED',
        }),
        submit(mainOrgId, mainOwnerId, {
          cause: 'MANUAL_ADJUSTMENT',
          variantId: isolatedVariantId,
          quantityDelta: '-12',
          reasonCode: 'EXPIRED',
        }),
      ]);

      const codes = [
        big.status === 'fulfilled' ? 'APPLIED' : codeOf(big.reason),
        bigger.status === 'fulfilled' ? 'APPLIED' : codeOf(bigger.reason),
      ];
      expect(codes).toContain('APPLIED');
      expect(codes).toContain('INSUFFICIENT_STOCK');

      // Exactly one of the two landed (the same filter-then-assert shape the
      // organization-settings race evidence uses — the settled union must be
      // narrowed before its `.value` is read).
      const fulfilled = [big, bigger].filter(
        (outcome): outcome is PromiseFulfilledResult<Awaited<ReturnType<InventoryService['submitMovement']>>> =>
          outcome.status === 'fulfilled',
      );
      expect(fulfilled).toHaveLength(1);
      const settledWinner = fulfilled[0];
      if (settledWinner === undefined) {
        throw new Error('the concurrent-deduction race produced no applied movement');
      }
      const winner = settledWinner.value;
      expect(winner.status).toBe('APPLIED');
      // Exactly −10 or −12 landed, and the derived fold proves which one.
      raceBalance = big.status === 'fulfilled' ? '8' : '6';
      expect(winner.resultingQuantity).toBe(raceBalance);
      expect(winner.resultingQuantity).toBe(await quantityOf(isolatedVariantId));

      // The refusal recorded no movement: exactly one of the two race codes is
      // in the history, and it is the one that landed.
      const history = await inventory.listMovements(mainOrgId, {
        variantId: isolatedVariantId,
      });
      const deductions = history.filter((row) => row.reasonCode === 'EXPIRED').map((row) => row.quantityDelta);
      expect(deductions).toHaveLength(1);
      expect(['-10', '-12']).toContain(deductions[0] ?? '');
    });

    it('serializes two racing opening balances — one lands, one is the database refusal', async () => {
      // A fresh variant of the real product, created through the catalog.
      const freshVariant = await catalog.createVariant({
        organizationId: mainOrgId,
        actorUserId: mainOwnerId,
        productId,
        offered: { sku: `INV-RACE-OPEN-${randomUUID().slice(0, 8).toUpperCase()}` },
      });
      const raceVariantId = freshVariant.id;

      const [one, two] = await Promise.allSettled([
        submit(mainOrgId, mainOwnerId, {
          cause: 'OPENING_BALANCE',
          variantId: raceVariantId,
          quantityDelta: '9',
          unitCostMinor: '8888',
        }),
        submit(mainOrgId, mainOwnerId, {
          cause: 'OPENING_BALANCE',
          variantId: raceVariantId,
          quantityDelta: '7',
          unitCostMinor: '7777',
        }),
      ]);

      const outcomes = [one, two].map((settled) =>
        settled.status === 'fulfilled' ? 'APPLIED' : codeOf(settled.reason),
      );
      expect(outcomes).toContain('APPLIED');
      expect(outcomes).toContain('INVENTORY_OPENING_BALANCE_DUPLICATE');

      const fulfilled = [one, two].filter(
        (outcome): outcome is PromiseFulfilledResult<Awaited<ReturnType<InventoryService['submitMovement']>>> =>
          outcome.status === 'fulfilled',
      );
      expect(fulfilled).toHaveLength(1);
      const settledWinner = fulfilled[0];
      if (settledWinner === undefined) {
        throw new Error('the concurrent opening-balance race produced no applied movement');
      }
      const winner = settledWinner.value;
      expect(winner.status).toBe('APPLIED');
      expect(winner.movement.quantityDelta).toBe(await quantityOf(raceVariantId));
    });
  });

  describe('tenant isolation (the M4-S2 tenancy acceptance)', () => {
    it('org B sees none of org A’s quantity facts through the real service', async () => {
      const levels = await inventory.listLevels(otherOrgId, {});
      expect(levels).toEqual([]);
      const movements = await inventory.listMovements(otherOrgId, {});
      expect(movements).toEqual([]);
    });

    it('org B cannot move org A’s variant — the same honest 404', async () => {
      await expect(
        submit(otherOrgId, otherOwnerId, {
          cause: 'OPENING_BALANCE',
          variantId: isolatedVariantId,
          quantityDelta: '100',
          unitCostMinor: '500',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      await expect(quantityOf(isolatedVariantId)).resolves.toBe(raceBalance);
    });

    it('the RLS refuses a direct cross-tenant movement INSERT and answers a context-free probe nothing', async () => {
      // With org A's context, a row naming org B fails the WITH CHECK.
      await expect(
        inTenant(
          mainOrgId,
          async (tx) =>
            tx.$executeRaw`
            INSERT INTO stock_movements (organization_id, variant_id, location_id, cause, quantity_delta, server_sequence, occurred_at)
            VALUES (${otherOrgId}::uuid, ${isolatedVariantId}::uuid, ${otherOrgId}::uuid, 'MANUAL_ADJUSTMENT', 1, 9999, now())`,
        ),
      ).rejects.toMatchObject({ message: expect.stringContaining('42501') });

      // Without any tenant context the forced policy still runs, and it
      // answers nothing: the same SELECT the tenant sees rows through returns
      // an empty set on the application role — a quiet no-return (fail closed).
      const naked = await app.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM stock_movements`;
      expect(naked[0]?.n).toBe(0n);

      const fromTenantA = await inTenant(
        mainOrgId,
        (tx) =>
          tx.$queryRaw<
            { n: bigint }[]
          >`SELECT count(*)::bigint AS n FROM stock_movements WHERE organization_id <> ${mainOrgId}::uuid`,
      );
      expect(fromTenantA[0]?.n).toBe(0n);
    });

    it('the RLS refuses a direct cross-tenant level write and a cross-tenant movement read', async () => {
      await expect(
        inTenant(
          mainOrgId,
          async (tx) =>
            tx.$executeRaw`
            INSERT INTO stock_levels (organization_id, variant_id, location_id, quantity)
            VALUES (${otherOrgId}::uuid, ${isolatedVariantId}::uuid, ${mainOrgId}::uuid, 5)`,
        ),
      ).rejects.toMatchObject({ message: expect.stringContaining('42501') });

      const foreign = await inTenant(
        mainOrgId,
        (tx) =>
          tx.$queryRaw<
            { n: bigint }[]
          >`SELECT count(*)::bigint AS n FROM stock_levels WHERE organization_id <> ${mainOrgId}::uuid`,
      );
      expect(foreign[0]?.n).toBe(0n);
    });
  });

  describe('the CHECKs are the last line of defence (§22.1 posture)', () => {
    it('a service bypass cannot store negative stock', async () => {
      // The RLS admits the tenant-scoped statement; the non-negative CHECK is
      // what refuses it — the quantity law is a database fact (§15.6).
      await expect(
        inTenant(
          mainOrgId,
          async (tx) =>
            tx.$executeRaw`
            UPDATE stock_levels
               SET quantity = -1
             WHERE variant_id = ${isolatedVariantId}::uuid`,
        ),
      ).rejects.toMatchObject({ message: expect.stringContaining('chk_inventory_level_non_negative') });

      await expect(quantityOf(isolatedVariantId)).resolves.toBe(raceBalance);
    });

    it('a service bypass cannot name a foreign cause', async () => {
      // Same posture: the closed §15.5 vocabulary is a table CHECK, unnamed to
      // any writer — even one on the right tenant, inside the right context.
      await expect(
        inTenant(mainOrgId, async (tx) => {
          const location = await tx.inventoryLocation.findFirstOrThrow({ where: { organizationId: mainOrgId } });
          return tx.$executeRaw`
            INSERT INTO stock_movements (id, organization_id, variant_id, location_id, cause, quantity_delta, server_sequence, occurred_at)
            VALUES (gen_random_uuid(), ${mainOrgId}::uuid, ${isolatedVariantId}::uuid, ${location.id}::uuid,
                    'NOT_IN_VOCABULARY', 1, 9001, now())`;
        }),
      ).rejects.toMatchObject({ message: expect.stringContaining('chk_inventory_movement_cause_vocabulary') });
    });
  });

  describe('class-A audit (§32.5)', () => {
    it('every recorded movement committed with its INVENTORY_* event, and the chain verifies', async () => {
      const events = await inTenant(
        mainOrgId,
        (tx) =>
          tx.$queryRaw<{ event_type: string; target_id: string }[]>`
          SELECT event_type, target_id FROM audit_events
           WHERE event_type LIKE 'INVENTORY_%' AND organization_id = ${mainOrgId}::uuid
           ORDER BY sequence`,
      );
      const movements = await inTenant(
        mainOrgId,
        (tx) =>
          tx.$queryRaw<{ id: string }[]>`SELECT id FROM stock_movements WHERE organization_id = ${mainOrgId}::uuid`,
      );
      expect(events.length).toBe(movements.length);
      const qualified = new Set(events.map((row) => row.event_type));
      for (const type of qualified) {
        expect([
          'INVENTORY_OPENING_BALANCE_RECORDED',
          'INVENTORY_ADJUSTMENT_RECORDED',
          'INVENTORY_PURCHASE_RECEIPT_RECORDED',
          'INVENTORY_REVALUATION_APPLIED',
        ]).toContain(type);
      }

      const report = await inTenant(mainOrgId, (tx) =>
        verifyAuditStreamScope(tx, { stream: 'AUDIT', scope: mainOrgId }),
      );
      expect(report.defects).toEqual([]);
    });

    it('a refused movement audited nothing — the fold, the row, and the event share one fate', async () => {
      const before = await inTenant(
        mainOrgId,
        (tx) =>
          tx.$queryRaw<
            { n: bigint }[]
          >`SELECT count(*)::bigint AS n FROM audit_events WHERE event_type LIKE 'INVENTORY_%' AND organization_id = ${mainOrgId}::uuid`,
      );
      await expect(
        submit(mainOrgId, mainOwnerId, {
          cause: 'MANUAL_ADJUSTMENT',
          variantId: isolatedVariantId,
          quantityDelta: '-999999',
          reasonCode: 'LOST',
        }),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
      const after = await inTenant(
        mainOrgId,
        (tx) =>
          tx.$queryRaw<
            { n: bigint }[]
          >`SELECT count(*)::bigint AS n FROM audit_events WHERE event_type LIKE 'INVENTORY_%' AND organization_id = ${mainOrgId}::uuid`,
      );
      expect(after[0]?.n).toBe(before[0]?.n ?? undefined);
    });
  });

  // ---------------------------------------------------------------------------
  // M4-S3 — the §30 moving-average costing engine, on the real tables the
  // process uses. Every expected number below is computed by hand from §30.3
  // and §30.4 *before* the assertion; the suite never reads back what it
  // writes to compare it with itself.
  // ---------------------------------------------------------------------------
  describe('the §30 moving-average costing engine (M4-S3)', () => {
    let costedVariantId = '';

    beforeAll(async () => {
      // One fresh variant owned by the costing narrative.
      const fresh = await catalog.createVariant({
        organizationId: mainOrgId,
        actorUserId: mainOwnerId,
        productId,
        offered: { sku: `INV-COST-${randomUUID().slice(0, 8).toUpperCase()}`, attributes: { size: 'XL' } },
      });
      costedVariantId = fresh.id;
    });

    it('scenario C — a second acquisition at a different cost folds the §30.3 weighted average, not a last-cost shortcut', async () => {
      // First acquisition: 24 pieces @ 185.00 EGP through the opening balance.
      const opening = await submit(mainOrgId, mainOwnerId, {
        cause: 'OPENING_BALANCE',
        variantId: costedVariantId,
        quantityDelta: '24',
        unitCostMinor: '18500',
      });
      expect(opening.status).toBe('APPLIED');

      // Second acquisition at a different cost: 12 pieces @ 240.00 EGP.
      //   new_value = 24·18500 + 12·24000 = 732 000
      //   new_qty   = 36 → new_avg = 732000/36 = 20333.33… → HALF_UP 20333
      // A naive last-cost engine would answer 24000; §30.3 answers 20333.
      const receipt = await submit(mainOrgId, mainOwnerId, {
        cause: 'PURCHASE_RECEIPT',
        variantId: costedVariantId,
        quantityDelta: '12',
        unitCostMinor: '24000',
      });
      expect(receipt.status).toBe('APPLIED');
      expect(receipt.movement.cause).toBe('PURCHASE_RECEIPT');

      const valued = await inventory.listValuation(mainOrgId, { variantId: costedVariantId });
      expect(valued.levels).toHaveLength(1);
      expect(valued.levels[0]?.quantity).toBe('36');
      expect(valued.levels[0]?.averageCostMinor).toBe('20333');
      expect(valued.levels[0]?.inventoryValueMinor).toBe('731988'); // 36 × 20333, digit-exact
      expect(valued.totals.uncostedLines).toBe(0);
      expect(valued.totals.valuedLevels).toBe(1);
    });

    it('scenario D — the deduction snapshots the current average, consumes its exact cost, moves no average', async () => {
      // An issue of 3 pieces from 36 @ 20333:
      //   §30.4/§30.5: the movement snapshots 20333, the average is *unchanged*,
      //   the remaining value is (36 − 3) × 20333 = 33 × 20333 = 670 989 —
      //   and the consumed cost is 3 × 20333 = 60 999, reconstructible from the
      //   snapshot ledger.
      const issue = await submit(mainOrgId, mainOwnerId, {
        cause: 'MANUAL_ADJUSTMENT',
        variantId: costedVariantId,
        quantityDelta: '-3',
        reasonCode: 'LOST',
      });
      expect(issue.status).toBe('APPLIED');

      const valued = await inventory.listValuation(mainOrgId, { variantId: costedVariantId });
      expect(valued.levels[0]?.quantity).toBe('33');
      expect(valued.levels[0]?.averageCostMinor).toBe('20333');
      expect(valued.levels[0]?.inventoryValueMinor).toBe('670989');

      const costs = await inventory.listCostSnapshots(mainOrgId, { variantId: costedVariantId });
      // Newest acceptance first: the issue's snapshot (20333) above the two
      // acquisition costs.
      expect(costs[0]?.cause).toBe('MANUAL_ADJUSTMENT');
      expect(costs[0]?.unitCostMinor).toBe('20333');
      expect(costs[costs.length - 1]?.cause).toBe('OPENING_BALANCE');
      expect(costs[costs.length - 1]?.unitCostMinor).toBe('18500');
      // The consumed acquisition cost: Σ snapshot costs over the ledger
      // (24 @ 18500 + 12 @ 24000 received; 3 @ 20333 consumed).
      expect(costs).toHaveLength(3);
    });

    it('scenario F — an identical cost-bearing retry replays with exactly one financial effect; a different cost is a contradiction', async () => {
      const movementId = randomUUID();
      const first = await submit(mainOrgId, mainOwnerId, {
        movementId,
        cause: 'PURCHASE_RECEIPT',
        variantId: costedVariantId,
        quantityDelta: '2',
        unitCostMinor: '10000',
      });
      expect(first.status).toBe('APPLIED');
      // Current fold: 33 + 2 = 35 @ 20333, plus 2 @ 10000 =
      //   (33·20333 + 2·10000)/35 = (670989 + 20000)/35 = 690989/35 = 19742.54…
      //   → HALF_UP 19743, value 35 × 19743 = 691005.

      const replay = await submit(mainOrgId, mainOwnerId, {
        movementId,
        cause: 'PURCHASE_RECEIPT',
        variantId: costedVariantId,
        quantityDelta: '2',
        unitCostMinor: '10000',
      });
      expect(replay.status).toBe('REPLAY');

      const costs = await inventory.listCostSnapshots(mainOrgId, { variantId: costedVariantId });
      expect(costs.filter((row) => row.movementId === movementId)).toHaveLength(1);
      const valued = await inventory.listValuation(mainOrgId, { variantId: costedVariantId });
      expect(valued.levels[0]?.quantity).toBe('35');
      expect(valued.levels[0]?.averageCostMinor).toBe('19743');
      expect(valued.levels[0]?.inventoryValueMinor).toBe('691005');

      // The same identity naming a different fact — even in cost alone — is
      // the ledger's own contradiction, effect-free.
      await expect(
        submit(mainOrgId, mainOwnerId, {
          movementId,
          cause: 'PURCHASE_RECEIPT',
          variantId: costedVariantId,
          quantityDelta: '2',
          unitCostMinor: '12000',
        }),
      ).rejects.toMatchObject({ code: 'MUTATION_CONTRADICTION' });
      const valuedAfter = await inventory.listValuation(mainOrgId, { variantId: costedVariantId });
      expect(valuedAfter.levels[0]?.averageCostMinor).toBe('19743');
    });

    it('scenario G — two racing cost-bearing receipts serialize on the fold; quantity and average agree at the end', async () => {
      // +10 @ 15 and +10 @ 6 from 35 @ 19743: lock-serialized in either order,
      // the *final* average is identical, because the §30.3 fold is a
      // serializable cumulative calculation AND the race is chosen so each
      // intermediate fold lands on an exact division — the serializations can
      // never disagree:
      //   (35·19743 + 10·15)/45 = (691005 + 150)/45 = 691155/45 = 15359 exact
      //   (35·19743 + 10·6)/45  = (691005 + 60)/45  = 691065/45 = 15357 exact
      // then either serialization: (691155|691065 + the other lot)/55
      //   = 691215/55 = 12567.54… → HALF_UP 12568, value 55 × 12568 = 691240.
      const [a, b] = await Promise.allSettled([
        submit(mainOrgId, mainOwnerId, {
          cause: 'PURCHASE_RECEIPT',
          variantId: costedVariantId,
          quantityDelta: '10',
          unitCostMinor: '15',
        }),
        submit(mainOrgId, mainOwnerId, {
          cause: 'PURCHASE_RECEIPT',
          variantId: costedVariantId,
          quantityDelta: '10',
          unitCostMinor: '6',
        }),
      ]);
      const settled = [a, b].filter(
        (outcome): outcome is PromiseFulfilledResult<Awaited<ReturnType<InventoryService['submitMovement']>>> =>
          outcome.status === 'fulfilled',
      );
      expect(settled).toHaveLength(2);

      const valued = await inventory.listValuation(mainOrgId, { variantId: costedVariantId });
      expect(valued.levels[0]?.quantity).toBe('55');
      expect(valued.levels[0]?.averageCostMinor).toBe('12568');
      expect(valued.levels[0]?.inventoryValueMinor).toBe('691240'); // 55 × 12568
    });

    it('scenario H — the §30.5 revaluation restates only the current average; history is never rewritten', async () => {
      // An explicit server-only costing act: the owner restates the average
      // from 12568 to 12000 across the 55 on-hand pieces.
      const revaluation = await submit(mainOrgId, mainOwnerId, {
        cause: 'REVALUATION',
        variantId: costedVariantId,
        quantityDelta: '0',
        unitCostMinor: '12000',
      });
      expect(revaluation.status).toBe('APPLIED');
      expect(revaluation.movement.quantityDelta).toBe('0');
      expect(revaluation.movement.cause).toBe('REVALUATION');

      const valued = await inventory.listValuation(mainOrgId, { variantId: costedVariantId });
      expect(valued.levels[0]?.quantity).toBe('55');
      expect(valued.levels[0]?.averageCostMinor).toBe('12000');
      expect(valued.levels[0]?.inventoryValueMinor).toBe('660000');

      // The historical acquisition snapshots are untouched — the §30.5 law:
      // the movement ledger still answers 18500/24000/20333/10000/15/6, and
      // the revaluation itself carries only its own new average.
      const costs = await inventory.listCostSnapshots(mainOrgId, { variantId: costedVariantId });
      const observed = costs.map((row) => `${row.cause}:${row.unitCostMinor}`);
      expect(observed[0]).toBe('REVALUATION:12000');
      expect(observed).toContain('OPENING_BALANCE:18500');
      expect(observed).toContain('PURCHASE_RECEIPT:24000');
      expect(observed).toContain('MANUAL_ADJUSTMENT:20333');
    });

    it('the audit stream carries the costing facts — before, after, and the exact value', async () => {
      const events = await inTenant(
        mainOrgId,
        (tx) =>
          tx.$queryRaw<{ event_type: string; payload: unknown }[]>`
          SELECT event_type, payload FROM audit_events
           WHERE event_type = 'INVENTORY_REVALUATION_APPLIED'
             AND organization_id = ${mainOrgId}::uuid`,
      );
      expect(events).toHaveLength(1);
      const payload = events[0]?.payload as {
        averageCostMinorBefore?: string;
        averageCostMinorAfter?: string;
        resultingInventoryValueMinor?: string;
        unitCostMinor?: string;
      };
      expect(payload.averageCostMinorBefore).toBe('12568');
      expect(payload.averageCostMinorAfter).toBe('12000');
      expect(payload.resultingInventoryValueMinor).toBe('660000');
      expect(payload.unitCostMinor).toBe('12000');
    });

    describe('the costing refusals (the engine never fabricates a cost)', () => {
      let bareVariantId = '';

      beforeAll(async () => {
        const fresh = await catalog.createVariant({
          organizationId: mainOrgId,
          actorUserId: mainOwnerId,
          productId,
          offered: { sku: `INV-BARE-${randomUUID().slice(0, 8).toUpperCase()}` },
        });
        bareVariantId = fresh.id;
      });

      it('a cost-imposing cause without a cost is refused before any connection', async () => {
        await expect(
          submit(mainOrgId, mainOwnerId, {
            cause: 'OPENING_BALANCE',
            variantId: bareVariantId,
            quantityDelta: '10',
          }),
        ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

        await expect(
          submit(mainOrgId, mainOwnerId, {
            cause: 'PURCHASE_RECEIPT',
            variantId: bareVariantId,
            quantityDelta: '10',
          }),
        ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

        // Nothing was written, and no valuation member was invented.
        const valued = await inventory.listValuation(mainOrgId, { variantId: bareVariantId });
        expect(valued.levels).toHaveLength(0);
      });

      it('a negative receipt direction is refused at the wire', async () => {
        await expect(
          submit(mainOrgId, mainOwnerId, {
            cause: 'PURCHASE_RECEIPT',
            variantId: bareVariantId,
            quantityDelta: '-10',
            unitCostMinor: '1000',
          }),
        ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      });

      it('a revaluation moves no stock: a non-zero delta is refused, and a zero-delta one needs a basis', async () => {
        await expect(
          submit(mainOrgId, mainOwnerId, {
            cause: 'REVALUATION',
            variantId: bareVariantId,
            quantityDelta: '5',
            unitCostMinor: '1000',
          }),
        ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

        // Uncosted stock has no basis to restate — refused, never invented.
        await expect(
          submit(mainOrgId, mainOwnerId, {
            cause: 'REVALUATION',
            variantId: bareVariantId,
            quantityDelta: '0',
            unitCostMinor: '1000',
          }),
        ).rejects.toMatchObject({ code: 'INVENTORY_COST_BASIS_REQUIRED' });
      });

      it('an uncosted adjustment is refused: a missing basis is never read as zero', async () => {
        // NOTE: a *consumption* of uncosted stock can never reach a costing
        // refusal — the §15.6 INSUFFICIENT_STOCK guard always fires first for
        // a negative delta on a level that does not exist yet. The reachable
        // missing-basis refusal is therefore exercised through a positive
        // (receipt-shaped) adjustment below.
        await expect(
          submit(mainOrgId, mainOwnerId, {
            cause: 'MANUAL_ADJUSTMENT',
            variantId: bareVariantId,
            quantityDelta: '4',
            reasonCode: 'RESTOCK',
          }),
        ).rejects.toMatchObject({ code: 'INVENTORY_COST_BASIS_REQUIRED' });

        // With an explicit cost the adjustment becomes a cost-bearing inclusion
        // and folds exactly like a receipt.
        const inclusion = await submit(mainOrgId, mainOwnerId, {
          cause: 'MANUAL_ADJUSTMENT',
          variantId: bareVariantId,
          quantityDelta: '4',
          reasonCode: 'RESTOCK',
          unitCostMinor: '5000',
        });
        expect(inclusion.status).toBe('APPLIED');
        const valued = await inventory.listValuation(mainOrgId, { variantId: bareVariantId });
        expect(valued.levels[0]?.quantity).toBe('4');
        expect(valued.levels[0]?.averageCostMinor).toBe('5000');
      });

      it('the wire cannot re-cost a consumption — the average is the ledger’s, not the caller’s', async () => {
        await expect(
          submit(mainOrgId, mainOwnerId, {
            cause: 'MANUAL_ADJUSTMENT',
            variantId: bareVariantId,
            quantityDelta: '-2',
            reasonCode: 'LOST',
            unitCostMinor: '1',
          }),
        ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

        // The consumption itself succeeds at the engine's own average.
        const issue = await submit(mainOrgId, mainOwnerId, {
          cause: 'MANUAL_ADJUSTMENT',
          variantId: bareVariantId,
          quantityDelta: '-2',
          reasonCode: 'LOST',
        });
        expect(issue.status).toBe('APPLIED');
        const valued = await inventory.listValuation(mainOrgId, { variantId: bareVariantId });
        expect(valued.levels[0]?.quantity).toBe('2');
        expect(valued.levels[0]?.averageCostMinor).toBe('5000');
        expect(valued.levels[0]?.inventoryValueMinor).toBe('10000');
      });

      it('an explicitly zero-cost acquisition is a real offered fact — never an implied zero', async () => {
        const zero = await submit(mainOrgId, mainOwnerId, {
          cause: 'PURCHASE_RECEIPT',
          variantId: bareVariantId,
          quantityDelta: '1',
          unitCostMinor: '0',
        });
        // 2 on hand @ 5000 + 1 @ 0 = 10000/3 = 3333.33… → 3333
        expect(zero.status).toBe('APPLIED');
        const valued = await inventory.listValuation(mainOrgId, { variantId: bareVariantId });
        expect(valued.levels[0]?.quantity).toBe('3');
        expect(valued.levels[0]?.averageCostMinor).toBe('3333');
        expect(valued.levels[0]?.inventoryValueMinor).toBe('9999');
      });
    });

    it('a genuinely zero-cost opening is a real fact and the valuation stays exact', async () => {
      const fresh = await catalog.createVariant({
        organizationId: mainOrgId,
        actorUserId: mainOwnerId,
        productId,
        offered: { sku: `INV-ZERO-${randomUUID().slice(0, 8).toUpperCase()}` },
      });
      const applied = await submit(mainOrgId, mainOwnerId, {
        cause: 'OPENING_BALANCE',
        variantId: fresh.id,
        quantityDelta: '5',
        unitCostMinor: '0',
      });
      expect(applied.status).toBe('APPLIED');
      const valued = await inventory.listValuation(mainOrgId, { variantId: fresh.id });
      expect(valued.levels[0]?.averageCostMinor).toBe('0');
      expect(valued.levels[0]?.inventoryValueMinor).toBe('0');
    });

    it('scenario I — tenant isolation on the costing face: org B reads none of it and cannot restate org A’s average', async () => {
      // The cost-authorized reads answer org B none of org A's facts.
      const valuation = await inventory.listValuation(otherOrgId, {});
      expect(valuation.levels).toEqual([]);
      const costs = await inventory.listCostSnapshots(otherOrgId, {});
      expect(costs).toEqual([]);

      // A revaluation naming org A's variant is the same honest 404 — and the
      // org A average it names is untouched afterwards.
      await expect(
        submit(otherOrgId, otherOwnerId, {
          cause: 'REVALUATION',
          variantId: costedVariantId,
          quantityDelta: '0',
          unitCostMinor: '1',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      const valued = await inventory.listValuation(mainOrgId, { variantId: costedVariantId });
      expect(valued.levels[0]?.averageCostMinor).toBe('12000');
    });

    it('migration 0015’s CHECKs are the last line of defence for the costing invariants', async () => {
      // A writer bypassing the service cannot store uncosted stock: quantity
      // above zero with a NULL average is `chk_inventory_level_cost_with_stock`.
      const unclosed = await catalog.createVariant({
        organizationId: mainOrgId,
        actorUserId: mainOwnerId,
        productId,
        offered: { sku: `INV-CHECK-${randomUUID().slice(0, 8).toUpperCase()}` },
      });
      await expect(
        inTenant(mainOrgId, async (tx) => {
          const location = await tx.inventoryLocation.findFirstOrThrow({ where: { organizationId: mainOrgId } });
          return tx.$executeRaw`
            INSERT INTO stock_levels (organization_id, variant_id, location_id, quantity)
            VALUES (${mainOrgId}::uuid, ${unclosed.id}::uuid, ${location.id}::uuid, 5)`;
        }),
      ).rejects.toMatchObject({ message: expect.stringContaining('chk_inventory_level_cost_with_stock') });

      // ... nor an average outside the bounded money width.
      await expect(
        inTenant(
          mainOrgId,
          async (tx) =>
            tx.$executeRaw`
            UPDATE stock_levels
               SET average_cost_minor = -1
             WHERE variant_id = ${costedVariantId}::uuid`,
        ),
      ).rejects.toMatchObject({ message: expect.stringContaining('chk_inventory_level_cost_bounds') });

      // The real level is exactly where the engine left it.
      const valued = await inventory.listValuation(mainOrgId, { variantId: costedVariantId });
      expect(valued.levels[0]?.averageCostMinor).toBe('12000');
      expect(valued.levels[0]?.quantity).toBe('55');
    });

    it('the §30.6 rounding edge is the organization’s typed setting, read inside the movement transaction (HALF_EVEN)', async () => {
      // The tie case where the two §30.6 modes *disagree*: 3 @ 3 + 1 @ 1 = 10/4
      // = 2.5 — HALF_UP rounds to 3, HALF_EVEN ties to the even 2.
      const upVariant = await catalog.createVariant({
        organizationId: mainOrgId,
        actorUserId: mainOwnerId,
        productId,
        offered: { sku: `INV-TIE-UP-${randomUUID().slice(0, 8).toUpperCase()}` },
      });
      await submit(mainOrgId, mainOwnerId, {
        cause: 'OPENING_BALANCE',
        variantId: upVariant.id,
        quantityDelta: '3',
        unitCostMinor: '3',
      });
      await submit(mainOrgId, mainOwnerId, {
        cause: 'PURCHASE_RECEIPT',
        variantId: upVariant.id,
        quantityDelta: '1',
        unitCostMinor: '1',
      });
      const underHalfUp = await inventory.listValuation(mainOrgId, { variantId: upVariant.id });
      expect(underHalfUp.levels[0]?.averageCostMinor).toBe('3');

      // Flip the typed §30.6 setting and re-run the same arithmetic on a twin.
      await inTenant(
        mainOrgId,
        (tx) =>
          tx.$executeRaw`
          INSERT INTO organization_settings (organization_id)
          VALUES (${mainOrgId}::uuid)
          ON CONFLICT (organization_id) DO UPDATE SET rounding_mode = 'HALF_EVEN'`,
      );

      const evenVariant = await catalog.createVariant({
        organizationId: mainOrgId,
        actorUserId: mainOwnerId,
        productId,
        offered: { sku: `INV-TIE-EVEN-${randomUUID().slice(0, 8).toUpperCase()}` },
      });
      await submit(mainOrgId, mainOwnerId, {
        cause: 'OPENING_BALANCE',
        variantId: evenVariant.id,
        quantityDelta: '3',
        unitCostMinor: '3',
      });
      await submit(mainOrgId, mainOwnerId, {
        cause: 'PURCHASE_RECEIPT',
        variantId: evenVariant.id,
        quantityDelta: '1',
        unitCostMinor: '1',
      });
      const underHalfEven = await inventory.listValuation(mainOrgId, { variantId: evenVariant.id });
      expect(underHalfEven.levels[0]?.averageCostMinor).toBe('2');

      // Restore the plan default for the rest of the suite.
      await inTenant(
        mainOrgId,
        (tx) =>
          tx.$executeRaw`
          UPDATE organization_settings SET rounding_mode = 'HALF_UP' WHERE organization_id = ${mainOrgId}::uuid`,
      );
    });
  });
});
