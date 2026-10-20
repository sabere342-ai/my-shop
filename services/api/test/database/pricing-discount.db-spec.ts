/**
 * M3-S3 acceptance — the §18 discount policy against **real PostgreSQL**
 * (Master Plan §17.3, §18.1–§18.4, §22.3, §30.1/§30.6, §32.2, §38.18/§38.19;
 * §40.7 row M3-S3).
 *
 * Every probe rides the same code paths the running process uses — the
 * transactional `PricingPolicyService`, the M3-S1 typed settings row, the
 * M2-S3/M2-S4 effective authorization resolver, and the forced-RLS tenant
 * tables — so the acceptance is the boundary itself, not a sketch of it:
 *
 *  1. **Mode gating (§17.1–§17.3)** — a discount offer is meaningful only in
 *     `FIXED_WITH_DISCOUNT`; `FIXED` answers `403 PRICE_OVERRIDE_FORBIDDEN`
 *     and `VARIABLE` answers `403 DISCOUNT_FORBIDDEN`, in every case without
 *     consulting a ceiling or an actor.
 *  2. **The hard ceilings (§18.2 steps 3–4)** — the stored decimal(5,2)
 *     percentage and the stored minor-unit amount are the organization's
 *     exact limits; a breach answers `403 DISCOUNT_LIMIT_EXCEEDED` to *every*
 *     actor, the owner included. `FIXED_PRICE` compares the **computed
 *     reduction** against the amount ceiling, never its final price; a
 *     `FIXED_AMOUNT` larger than the price it discounts is refused; a
 *     `FIXED_PRICE` above the list price is an increase, answered
 *     `DISCOUNT_FORBIDDEN`.
 *  3. **Authority (§18.2 step 4, §11.2/§11.4)** — `pricing.discount.apply`
 *     resolved live in the deciding transaction; the
 *     `discount_allowed_for_salesperson` setting opens the authority for the
 *     **server-resolved** `salesperson` role key and never over an explicit
 *     `DENY`; a role the setting does not name stays refused.
 *  4. **The approval gate (§18.2 step 5, §18.3)** — strictly above the
 *     threshold the discount requires `pricing.discount.approve` in the
 *     deciding transaction; an approver's decision carries the server-minted
 *     `disc-appr:…` reference built from the resolved organization, approver,
 *     and the settings and permission versions of the exact moment. Approval
 *     is never an input: there is nothing a client could assert, forge, or
 *     reuse.
 *  5. **The cost floor (§18.4)** — `block_discount_below_cost` turns the
 *     below-cost *flag* into a `403 DISCOUNT_LIMIT_EXCEEDED` refusal on the
 *     discount path; approval does not lift it; an absent cost is unproven
 *     and invents neither.
 *  6. **The applied price is derived (§17.4)** — the caller's applied value
 *     is a hint that must agree with the server's derivation or the request
 *     is refused `VALIDATION_FAILED`.
 *  7. **The live policy read (§22.3, §38.18)** — the decision stamps the
 *     settings version it decided under, and a policy change committed
 *     between two statements of one transaction is *seen* by the second
 *     statement — the discount boundary changes under the caller's feet.
 *  8. **Offline reconciliation (§38.19)** — a recorded discount line the
 *     current policy would refuse is **accepted and flagged**
 *     `PRICING_POLICY_DRIFT`, snapshots untouched, never re-priced; a
 *     rounding-mode change is drift, not corruption. Structural corruption —
 *     a recorded line inconsistent with its own discount, an above-list fixed
 *     price, malformed values — is refused `VALIDATION_FAILED` in *both*
 *     entry points, because availability never extends to nonsense.
 *  9. **The M3-S2 boundary stands** — an offer-less manual reduction below
 *     the list price is still refused `PRICE_OVERRIDE_FORBIDDEN` in
 *     `FIXED_WITH_DISCOUNT`; a refused discount leaves the settings row, its
 *     version, and the audit chain untouched.
 *
 * Environment: `DATABASE_URL`, `MIGRATION_DATABASE_URL` (both naming the fixed
 * `my_shop_test`), and `ADMIN_DATABASE_URL` — guarded exactly as the other
 * database suites guard them. No silent skips (§36.1 T-5).
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

import { AuthorizationService } from '../../src/common/tenancy/authorization/authorization.service';
import { SettingsService } from '../../src/common/settings/settings.service';
import { PricingPolicyService } from '../../src/common/pricing/pricing.service';
import { AuditStreamWriter } from '../../src/common/audit/audit-stream-writer';
import { withTenantTransaction, establishTenantContext } from '../../src/common/database/tenant-context';
import { OrganizationBootstrapService } from '../../src/common/bootstrap/organization-bootstrap.service';
import { DomainError } from '../../src/common/errors/domain.error';
import { ERROR_CODES, statusForCode } from '../../src/common/errors/problem';

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
      `${name} is not set. The discount acceptance suite refuses to run without it ` +
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

/** The prices the lines carry in minor units (EGP piastres; §30.1). */
const LIST = 2500n;
/** A second list price chosen so a 1% discount is a exact HALF_UP/HALF_EVEN tie (§30.6). */
const LIST_TIE = 1050n;
const COST = 2000n;

/** Runs a pricing call already bound to a tenant transaction and asserts its refusal. */
async function expectRefusal(run: () => Promise<unknown>, code: string): Promise<DomainError> {
  let thrown: unknown;
  try {
    await run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(DomainError);
  const domainError = thrown as DomainError;
  expect(domainError.code).toBe(code);
  expect(statusForCode(domainError.code)).toBe(statusForCode(code as never));
  return domainError;
}

describe('discount policy acceptance (real PostgreSQL, §17.3/§18/§38.19)', () => {
  jest.setTimeout(180_000);

  let urls: DatabaseUrls;
  let app: PrismaClient;
  let settings: SettingsService;
  let authorization: AuthorizationService;
  let pricing: PricingPolicyService;
  let setupRan = false;

  let mainOrgId = '';
  let ownerUserId = '';
  let managerUserId = '';
  let cashierUserId = '';
  let salespersonUserId = '';
  let bystanderUserId = '';

  beforeAll(async () => {
    urls = requireTestUrls();

    dbScript('test-setup');
    setupRan = true;

    app = new PrismaClient({ datasourceUrl: urls.application });
    await app.$connect();

    authorization = new AuthorizationService({ prisma: app });
    settings = new SettingsService({ prisma: app }, authorization, new AuditStreamWriter());
    pricing = new PricingPolicyService(authorization, settings);

    // Three organizations through the real composition root; the second and
    // third exist so their users can hold *memberships* in the main
    // organization (the bootstrap owns one user per organization), and so the
    // tenant-isolation probe has a real foreign posture to fail closed with.
    const [main, otherA, otherB] = await Promise.all([
      new OrganizationBootstrapService({ prisma: app }).bootstrap({
        bootstrapKey: 'discount-main-shop',
        organizationName: 'Discount Main Shop',
        ownerEmail: 'owner-discount-main@example.test',
      }),
      new OrganizationBootstrapService({ prisma: app }).bootstrap({
        bootstrapKey: 'discount-other-shop-a',
        organizationName: 'Discount Other Shop A',
        ownerEmail: 'owner-discount-a@example.test',
      }),
      new OrganizationBootstrapService({ prisma: app }).bootstrap({
        bootstrapKey: 'discount-other-shop-b',
        organizationName: 'Discount Other Shop B',
        ownerEmail: 'owner-discount-b@example.test',
      }),
    ]);
    mainOrgId = main.organizationId;
    ownerUserId = main.userId;
    managerUserId = otherA.userId;
    // Two more actors of the main organization, created for the roles the
    // presets do not cover here: a cashier holding exactly the discount
    // authority without the approver's, and the bystander holding nothing.
    const cashierEmail = 'cashier-discount-main@example.test';
    const bystanderEmail = 'bystander-discount-main@example.test';
    cashierUserId = (await app.user.create({ data: { email: cashierEmail } })).id;
    bystanderUserId = (await app.user.create({ data: { email: bystanderEmail } })).id;
    // The salesperson actor exists so the §18.2 rule can be probed against the
    // **server-resolved role key**: the membership's role carries the preset
    // key `salesperson`, and the resolver — never a client assertion — is the
    // only thing that reports it to the boundary.
    salespersonUserId = otherB.userId;

    const salespersonRoleId = randomUUID();
    const emptyRoleId = randomUUID();
    await withTenantTransaction({ prisma: app }, mainOrgId, async (tx) => {
      // The manager's role: sale-facing access plus both §18 discount
      // authorities — the apply authority and the approver's.
      const managerRoleId = await tx.role.create({
        data: {
          organizationId: mainOrgId,
          key: 'discount_manager',
          name: 'Discount Manager',
          isSystem: false,
          isOwner: false,
        },
      });
      await tx.rolePermission.createMany({
        data: [
          { organizationId: mainOrgId, roleId: managerRoleId.id, permissionId: 'sales.view' },
          { organizationId: mainOrgId, roleId: managerRoleId.id, permissionId: 'sales.create' },
          { organizationId: mainOrgId, roleId: managerRoleId.id, permissionId: 'catalog.view' },
          { organizationId: mainOrgId, roleId: managerRoleId.id, permissionId: 'pricing.discount.apply' },
          { organizationId: mainOrgId, roleId: managerRoleId.id, permissionId: 'pricing.discount.approve' },
        ],
      });
      // The cashier's role: the §18.2 apply authority without the approver's —
      // in-ceiling discounts are theirs, above-threshold ones are not.
      const cashierRoleId = await tx.role.create({
        data: {
          organizationId: mainOrgId,
          key: 'discount_cashier',
          name: 'Discount Cashier',
          isSystem: false,
          isOwner: false,
        },
      });
      await tx.rolePermission.createMany({
        data: [
          { organizationId: mainOrgId, roleId: cashierRoleId.id, permissionId: 'sales.view' },
          { organizationId: mainOrgId, roleId: cashierRoleId.id, permissionId: 'sales.create' },
          { organizationId: mainOrgId, roleId: cashierRoleId.id, permissionId: 'catalog.view' },
          { organizationId: mainOrgId, roleId: cashierRoleId.id, permissionId: 'pricing.discount.apply' },
        ],
      });
      // The salesperson's role with the **preset key** the §18.2 setting names,
      // seeded with the minimum sale-facing grants and *no* discount permission
      // of its own — the rule-grant path must be the only way it reaches one.
      await tx.role.create({
        data: {
          id: salespersonRoleId,
          organizationId: mainOrgId,
          key: 'salesperson',
          name: 'Discount Salesperson',
          isSystem: false,
          isOwner: false,
        },
      });
      await tx.rolePermission.createMany({
        data: [
          { organizationId: mainOrgId, roleId: salespersonRoleId, permissionId: 'sales.view' },
          { organizationId: mainOrgId, roleId: salespersonRoleId, permissionId: 'sales.create' },
          { organizationId: mainOrgId, roleId: salespersonRoleId, permissionId: 'catalog.view' },
        ],
      });
      await tx.role.create({
        data: {
          id: emptyRoleId,
          organizationId: mainOrgId,
          key: 'discount_bystander',
          name: 'Discount Bystander',
          isSystem: false,
          isOwner: false,
        },
      });
      await tx.organizationMembership.createMany({
        data: [
          { organizationId: mainOrgId, userId: managerUserId, isOwner: false, roleId: managerRoleId.id },
          { organizationId: mainOrgId, userId: cashierUserId, isOwner: false, roleId: cashierRoleId.id },
          { organizationId: mainOrgId, userId: salespersonUserId, isOwner: false, roleId: salespersonRoleId },
          { organizationId: mainOrgId, userId: bystanderUserId, isOwner: false, roleId: emptyRoleId },
        ],
      });
    });
  }, 180_000);

  afterAll(async () => {
    await Promise.allSettled([app?.$disconnect()]);
    if (setupRan) {
      dbScript('test-drop');
    }
  });

  /** The owner's current settings version, read through the accepted read path. */
  async function currentVersion(): Promise<bigint> {
    const view = await settings.get(mainOrgId);
    return view.settingsVersion;
  }

  /** Applies one settings offer through the accepted M3-S1 write path, returning the new version. */
  async function ownerUpdates(offer: {
    pricingMode?: 'FIXED' | 'VARIABLE' | 'FIXED_WITH_DISCOUNT';
    maxDiscountPercentage?: number;
    maxDiscountAmountMinor?: string;
    discountApprovalThresholdMinor?: string | null;
    discountAllowedForSalesperson?: boolean;
    blockDiscountBelowCost?: boolean;
    roundingMode?: 'HALF_UP' | 'HALF_EVEN';
  }): Promise<bigint> {
    const version = await currentVersion();
    const result = await settings.update(
      { organizationId: mainOrgId, actorUserId: ownerUserId, expectedSettingsVersion: Number(version), offered: offer },
      new Date(),
    );
    return result.view.settingsVersion;
  }

  describe('the refusal vocabulary is registered as the plan documents it (§18.2)', () => {
    it('the three discount refusals answer 403', () => {
      expect(statusForCode(ERROR_CODES.DISCOUNT_LIMIT_EXCEEDED)).toBe(403);
      expect(statusForCode(ERROR_CODES.DISCOUNT_FORBIDDEN)).toBe(403);
      expect(statusForCode(ERROR_CODES.DISCOUNT_APPROVAL_REQUIRED)).toBe(403);
    });
  });

  describe('FIXED mode — the discount path is not available (§17.1)', () => {
    beforeAll(async () => {
      await ownerUpdates({ pricingMode: 'FIXED' });
    });

    it('refuses a discount offer to the owner too — uniform with the mode price rule, zero value included', async () => {
      await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        expectRefusal(
          () =>
            pricing.evaluateSaleLinesInTransaction(tx, {
              organizationId: mainOrgId,
              actorUserId: ownerUserId,
              lines: [
                {
                  unitPriceListMinor: LIST,
                  unitPriceAppliedMinor: LIST,
                  discount: { type: 'PERCENTAGE', percentage: '10' },
                },
                {
                  unitPriceListMinor: LIST,
                  unitPriceAppliedMinor: LIST,
                  discount: { type: 'FIXED_PRICE', amountMinor: '0' },
                },
              ],
            }),
          ERROR_CODES.PRICE_OVERRIDE_FORBIDDEN,
        ),
      );
    });
  });

  describe('VARIABLE mode — a discount offer is a competing price source (§17.2)', () => {
    beforeAll(async () => {
      await ownerUpdates({ pricingMode: 'VARIABLE' });
    });

    it('refuses a discount offer with DISCOUNT_FORBIDDEN even for an actor holding the apply authority', async () => {
      await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        expectRefusal(
          () =>
            pricing.evaluateSaleLinesInTransaction(tx, {
              organizationId: mainOrgId,
              actorUserId: cashierUserId,
              lines: [
                {
                  unitPriceListMinor: LIST,
                  unitPriceAppliedMinor: LIST,
                  discount: { type: 'FIXED_AMOUNT', amountMinor: '0' },
                },
              ],
            }),
          ERROR_CODES.DISCOUNT_FORBIDDEN,
        ),
      );
    });

    it('still accepts the plain manual price entry the mode grants', async () => {
      const result = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        pricing.evaluateSaleLinesInTransaction(tx, {
          organizationId: mainOrgId,
          actorUserId: cashierUserId,
          lines: [{ unitPriceListMinor: LIST, unitPriceAppliedMinor: LIST - 100n }],
        }),
      );
      expect(result.lines[0]?.flags).toEqual([]);
      expect(result.lines[0]?.discount).toBeUndefined();
    });
  });

  describe('FIXED_WITH_DISCOUNT — the ceilings are hard for every actor (§18.2 step 3)', () => {
    beforeAll(async () => {
      await ownerUpdates({
        pricingMode: 'FIXED_WITH_DISCOUNT',
        maxDiscountPercentage: 20,
        maxDiscountAmountMinor: '10000',
        discountApprovalThresholdMinor: null,
        discountAllowedForSalesperson: false,
        blockDiscountBelowCost: false,
      });
    });

    it('derives an in-ceiling percentage line exactly — applied price and discount amount are server facts', async () => {
      const version = await currentVersion();
      const result = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        pricing.evaluateSaleLinesInTransaction(tx, {
          organizationId: mainOrgId,
          actorUserId: cashierUserId,
          lines: [
            {
              unitPriceListMinor: LIST,
              unitPriceAppliedMinor: 2250n,
              discount: { type: 'PERCENTAGE', percentage: '10' },
            },
          ],
        }),
      );
      expect(result.contractVersion).toBe(2);
      expect(result.pricingMode).toBe('FIXED_WITH_DISCOUNT');
      expect(result.settingsVersion).toBe(version);
      expect(result.lines[0]?.unitPriceListMinor).toBe(LIST);
      expect(result.lines[0]?.unitPriceAppliedMinor).toBe(2250n);
      expect(result.lines[0]?.flags).toEqual([]);
      expect(result.lines[0]?.discount).toEqual({
        type: 'PERCENTAGE',
        offeredValue: '10',
        discountAmountMinor: 250n,
        approved: false,
        authorizationRef: null,
      });
    });

    it('rounds the percentage division exactly once under the organization rounding mode (§30.6)', async () => {
      // 2500 × 0.5% = 12.5 exactly: HALF_UP (the seeded default) pays the
      // customer 12, records 13 as the discount — the tie rounds up.
      const result = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        pricing.evaluateSaleLinesInTransaction(tx, {
          organizationId: mainOrgId,
          actorUserId: cashierUserId,
          lines: [
            {
              unitPriceListMinor: LIST,
              unitPriceAppliedMinor: 2487n,
              discount: { type: 'PERCENTAGE', percentage: '0.5' },
            },
          ],
        }),
      );
      expect(result.lines[0]?.unitPriceAppliedMinor).toBe(2487n);
      expect(result.lines[0]?.discount?.discountAmountMinor).toBe(13n);
    });

    it('refuses an offered percentage above the stored ceiling with DISCOUNT_LIMIT_EXCEEDED', async () => {
      await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        expectRefusal(
          () =>
            pricing.evaluateSaleLinesInTransaction(tx, {
              organizationId: mainOrgId,
              actorUserId: cashierUserId,
              lines: [
                {
                  unitPriceListMinor: LIST,
                  unitPriceAppliedMinor: LIST,
                  discount: { type: 'PERCENTAGE', percentage: '25' },
                },
              ],
            }),
          ERROR_CODES.DISCOUNT_LIMIT_EXCEEDED,
        ),
      );
    });

    it('refuses the actor without the apply authority with DISCOUNT_FORBIDDEN — after the ceiling, never before it', async () => {
      const bystander = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        expectRefusal(
          () =>
            pricing.evaluateSaleLinesInTransaction(tx, {
              organizationId: mainOrgId,
              actorUserId: bystanderUserId,
              lines: [
                {
                  unitPriceListMinor: LIST,
                  unitPriceAppliedMinor: LIST,
                  discount: { type: 'FIXED_AMOUNT', amountMinor: '250' },
                },
              ],
            }),
          ERROR_CODES.DISCOUNT_FORBIDDEN,
        ),
      );
      // Authority is the *second* gate: a line that breached the ceiling would
      // answer the ceiling first. Prove the order with a bystander offer that
      // also breaches.
      await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        expectRefusal(
          () =>
            pricing.evaluateSaleLinesInTransaction(tx, {
              organizationId: mainOrgId,
              actorUserId: bystanderUserId,
              lines: [
                {
                  unitPriceListMinor: LIST,
                  unitPriceAppliedMinor: LIST,
                  discount: { type: 'FIXED_AMOUNT', amountMinor: '99999' },
                },
              ],
            }),
          ERROR_CODES.DISCOUNT_LIMIT_EXCEEDED,
        ),
      );
      expect(bystander).toBeDefined();
    });

    it('refuses a fixed amount above the amount ceiling to the owner too — no authority bypasses a hard ceiling', async () => {
      await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        expectRefusal(
          () =>
            pricing.evaluateSaleLinesInTransaction(tx, {
              organizationId: mainOrgId,
              actorUserId: ownerUserId,
              lines: [
                {
                  unitPriceListMinor: LIST,
                  unitPriceAppliedMinor: LIST,
                  discount: { type: 'FIXED_AMOUNT', amountMinor: '10500' },
                },
              ],
            }),
          ERROR_CODES.DISCOUNT_LIMIT_EXCEEDED,
        ),
      );
    });

    it('refuses a fixed amount larger than the price it discounts — the applied price may never go negative', async () => {
      await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        expectRefusal(
          () =>
            pricing.evaluateSaleLinesInTransaction(tx, {
              organizationId: mainOrgId,
              actorUserId: cashierUserId,
              lines: [
                {
                  unitPriceListMinor: LIST,
                  unitPriceAppliedMinor: LIST,
                  discount: { type: 'FIXED_AMOUNT', amountMinor: '2600' },
                },
              ],
            }),
          ERROR_CODES.DISCOUNT_LIMIT_EXCEEDED,
        ),
      );
    });

    it('refuses a FIXED_PRICE above the list price — an increase is the override boundary, never a discount', async () => {
      await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        expectRefusal(
          () =>
            pricing.evaluateSaleLinesInTransaction(tx, {
              organizationId: mainOrgId,
              actorUserId: cashierUserId,
              lines: [
                {
                  unitPriceListMinor: LIST,
                  unitPriceAppliedMinor: 2600n,
                  discount: { type: 'FIXED_PRICE', amountMinor: '2600' },
                },
              ],
            }),
          ERROR_CODES.DISCOUNT_FORBIDDEN,
        ),
      );
    });

    it('derives an in-ceiling fixed amount and an in-ceiling fixed price as the offers state them', async () => {
      const result = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        pricing.evaluateSaleLinesInTransaction(tx, {
          organizationId: mainOrgId,
          actorUserId: cashierUserId,
          lines: [
            {
              unitPriceListMinor: LIST,
              unitPriceAppliedMinor: 2250n,
              discount: { type: 'FIXED_AMOUNT', amountMinor: '250' },
            },
            {
              unitPriceListMinor: LIST,
              unitPriceAppliedMinor: 1800n,
              discount: { type: 'FIXED_PRICE', amountMinor: '1800' },
            },
          ],
        }),
      );
      expect(result.lines[0]?.unitPriceAppliedMinor).toBe(2250n);
      expect(result.lines[0]?.discount).toEqual({
        type: 'FIXED_AMOUNT',
        offeredValue: '250',
        discountAmountMinor: 250n,
        approved: false,
        authorizationRef: null,
      });
      expect(result.lines[1]?.unitPriceAppliedMinor).toBe(1800n);
      expect(result.lines[1]?.discount).toEqual({
        type: 'FIXED_PRICE',
        offeredValue: '1800',
        discountAmountMinor: 700n,
        approved: false,
        authorizationRef: null,
      });
    });
  });

  describe('the FIXED_PRICE ceiling compares the computed reduction, never the final price (§18.2)', () => {
    beforeAll(async () => {
      await ownerUpdates({
        pricingMode: 'FIXED_WITH_DISCOUNT',
        maxDiscountPercentage: 100,
        maxDiscountAmountMinor: '800',
        discountApprovalThresholdMinor: null,
        blockDiscountBelowCost: false,
        discountAllowedForSalesperson: false,
      });
    });

    it('refuses a final price under the amount ceiling whose computed reduction is over it', async () => {
      // A fixed price of 100 is *below* the 800 ceiling and still refused: the
      // reduction 2400 is what the amount ceiling measures (§18.2).
      await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        expectRefusal(
          () =>
            pricing.evaluateSaleLinesInTransaction(tx, {
              organizationId: mainOrgId,
              actorUserId: cashierUserId,
              lines: [
                {
                  unitPriceListMinor: LIST,
                  unitPriceAppliedMinor: 100n,
                  discount: { type: 'FIXED_PRICE', amountMinor: '100' },
                },
              ],
            }),
          ERROR_CODES.DISCOUNT_LIMIT_EXCEEDED,
        ),
      );
    });

    it('accepts a fixed price whose computed reduction is within the ceiling', async () => {
      const result = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        pricing.evaluateSaleLinesInTransaction(tx, {
          organizationId: mainOrgId,
          actorUserId: cashierUserId,
          lines: [
            {
              unitPriceListMinor: LIST,
              unitPriceAppliedMinor: 2150n,
              discount: { type: 'FIXED_PRICE', amountMinor: '2150' },
            },
          ],
        }),
      );
      expect(result.lines[0]?.unitPriceAppliedMinor).toBe(2150n);
      expect(result.lines[0]?.discount?.discountAmountMinor).toBe(350n);
    });
  });

  describe('the approval gate (§18.2 step 5, §18.3)', () => {
    beforeAll(async () => {
      await ownerUpdates({
        pricingMode: 'FIXED_WITH_DISCOUNT',
        maxDiscountPercentage: 100,
        maxDiscountAmountMinor: '50000',
        discountApprovalThresholdMinor: '400',
        blockDiscountBelowCost: false,
        discountAllowedForSalesperson: false,
      });
    });

    it('refuses an above-threshold discount to an actor without pricing.discount.approve', async () => {
      await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        expectRefusal(
          () =>
            pricing.evaluateSaleLinesInTransaction(tx, {
              organizationId: mainOrgId,
              actorUserId: cashierUserId,
              lines: [
                {
                  unitPriceListMinor: LIST,
                  unitPriceAppliedMinor: LIST,
                  discount: { type: 'FIXED_AMOUNT', amountMinor: '500' },
                },
              ],
            }),
          ERROR_CODES.DISCOUNT_APPROVAL_REQUIRED,
        ),
      );
    });

    it('accepts the same discount for the approver and mints the authorization reference from resolved facts (§32.2)', async () => {
      const versionBefore = await currentVersion();
      const { permissionsVersion } = await app.user.findUniqueOrThrow({
        where: { id: managerUserId },
        select: { permissionsVersion: true },
      });
      const result = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        pricing.evaluateSaleLinesInTransaction(tx, {
          organizationId: mainOrgId,
          actorUserId: managerUserId,
          lines: [
            {
              unitPriceListMinor: LIST,
              unitPriceAppliedMinor: 2000n,
              discount: { type: 'FIXED_AMOUNT', amountMinor: '500' },
            },
          ],
        }),
      );
      expect(result.settingsVersion).toBe(versionBefore);
      expect(result.lines[0]?.discount).toEqual({
        type: 'FIXED_AMOUNT',
        offeredValue: '500',
        discountAmountMinor: 500n,
        approved: true,
        authorizationRef: `disc-appr:org=${mainOrgId}:approver=${managerUserId}:settings=${versionBefore.toString()}:permissions=${permissionsVersion}`,
      });
    });

    it('the owner approves by structure — the whole catalog is theirs — and carries the minted reference too', async () => {
      const versionBefore = await currentVersion();
      const { permissionsVersion } = await app.user.findUniqueOrThrow({
        where: { id: ownerUserId },
        select: { permissionsVersion: true },
      });
      const result = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        pricing.evaluateSaleLinesInTransaction(tx, {
          organizationId: mainOrgId,
          actorUserId: ownerUserId,
          lines: [
            {
              unitPriceListMinor: LIST,
              unitPriceAppliedMinor: 2000n,
              discount: { type: 'FIXED_AMOUNT', amountMinor: '500' },
            },
          ],
        }),
      );
      expect(result.lines[0]?.discount?.approved).toBe(true);
      expect(result.lines[0]?.discount?.authorizationRef).toBe(
        `disc-appr:org=${mainOrgId}:approver=${ownerUserId}:settings=${versionBefore.toString()}:permissions=${permissionsVersion}`,
      );
    });

    it('exactly at the threshold is not above it — no approval involved, no reference minted', async () => {
      const result = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        pricing.evaluateSaleLinesInTransaction(tx, {
          organizationId: mainOrgId,
          actorUserId: cashierUserId,
          lines: [
            {
              unitPriceListMinor: LIST,
              unitPriceAppliedMinor: 2100n,
              discount: { type: 'FIXED_AMOUNT', amountMinor: '400' },
            },
          ],
        }),
      );
      expect(result.lines[0]?.unitPriceAppliedMinor).toBe(2100n);
      expect(result.lines[0]?.discount).toEqual({
        type: 'FIXED_AMOUNT',
        offeredValue: '400',
        discountAmountMinor: 400n,
        approved: false,
        authorizationRef: null,
      });
    });

    it('a DENY on the approve permission takes the approver authority back — deny beats the role grant (§11.4)', async () => {
      await withTenantTransaction({ prisma: app }, mainOrgId, async (tx) => {
        await tx.permissionOverride.create({
          data: {
            organizationId: mainOrgId,
            userId: managerUserId,
            permissionId: 'pricing.discount.approve',
            effect: 'DENY',
          },
        });
      });
      try {
        await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
          expectRefusal(
            () =>
              pricing.evaluateSaleLinesInTransaction(tx, {
                organizationId: mainOrgId,
                actorUserId: managerUserId,
                lines: [
                  {
                    unitPriceListMinor: LIST,
                    unitPriceAppliedMinor: LIST,
                    discount: { type: 'FIXED_AMOUNT', amountMinor: '500' },
                  },
                ],
              }),
            ERROR_CODES.DISCOUNT_APPROVAL_REQUIRED,
          ),
        );
      } finally {
        await withTenantTransaction({ prisma: app }, mainOrgId, async (tx) => {
          await tx.permissionOverride.deleteMany({
            where: { organizationId: mainOrgId, userId: managerUserId, permissionId: 'pricing.discount.approve' },
          });
        });
      }
    });

    it('the gates run in order — an approver without the apply authority is refused the authority refusal, not the gate', async () => {
      // The bystander gains the *approver* permission by override only; the
      // apply authority is still absent, and the §18.2 order answers for it.
      await withTenantTransaction({ prisma: app }, mainOrgId, async (tx) => {
        await tx.permissionOverride.create({
          data: {
            organizationId: mainOrgId,
            userId: bystanderUserId,
            permissionId: 'pricing.discount.approve',
            effect: 'ALLOW',
          },
        });
      });
      try {
        await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
          expectRefusal(
            () =>
              pricing.evaluateSaleLinesInTransaction(tx, {
                organizationId: mainOrgId,
                actorUserId: bystanderUserId,
                lines: [
                  {
                    unitPriceListMinor: LIST,
                    unitPriceAppliedMinor: LIST,
                    discount: { type: 'FIXED_AMOUNT', amountMinor: '500' },
                  },
                ],
              }),
            ERROR_CODES.DISCOUNT_FORBIDDEN,
          ),
        );
      } finally {
        await withTenantTransaction({ prisma: app }, mainOrgId, async (tx) => {
          await tx.permissionOverride.deleteMany({
            where: { organizationId: mainOrgId, userId: bystanderUserId, permissionId: 'pricing.discount.approve' },
          });
        });
      }
    });
  });

  describe('the cost floor (§18.4)', () => {
    beforeAll(async () => {
      await ownerUpdates({
        pricingMode: 'FIXED_WITH_DISCOUNT',
        maxDiscountPercentage: 100,
        maxDiscountAmountMinor: '100000',
        discountApprovalThresholdMinor: null,
        blockDiscountBelowCost: true,
        discountAllowedForSalesperson: false,
      });
    });

    it('refuses a discount reaching strictly below a known cost — the approver included (approval does not lift the floor)', async () => {
      await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        expectRefusal(
          () =>
            pricing.evaluateSaleLinesInTransaction(tx, {
              organizationId: mainOrgId,
              actorUserId: managerUserId,
              lines: [
                {
                  unitPriceListMinor: LIST,
                  unitPriceAppliedMinor: LIST,
                  unitCostAppliedMinor: COST,
                  discount: { type: 'FIXED_AMOUNT', amountMinor: '1000' },
                },
              ],
            }),
          ERROR_CODES.DISCOUNT_LIMIT_EXCEEDED,
        ),
      );
    });

    it('accepts a discount staying at or above the cost', async () => {
      const result = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        pricing.evaluateSaleLinesInTransaction(tx, {
          organizationId: mainOrgId,
          actorUserId: cashierUserId,
          lines: [
            {
              unitPriceListMinor: LIST,
              unitPriceAppliedMinor: 2100n,
              unitCostAppliedMinor: COST,
              discount: { type: 'FIXED_AMOUNT', amountMinor: '400' },
            },
            {
              unitPriceListMinor: LIST,
              unitPriceAppliedMinor: COST,
              unitCostAppliedMinor: COST,
              discount: { type: 'FIXED_PRICE', amountMinor: '2000' },
            },
          ],
        }),
      );
      expect(result.lines[0]?.flags).toEqual([]);
      expect(result.lines[1]?.flags).toEqual([]);
    });

    it('never refuses on an unproven cost — an absent cost invents neither the flag nor the refusal', async () => {
      const result = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        pricing.evaluateSaleLinesInTransaction(tx, {
          organizationId: mainOrgId,
          actorUserId: cashierUserId,
          lines: [
            {
              unitPriceListMinor: LIST,
              unitPriceAppliedMinor: 1500n,
              unitCostAppliedMinor: null,
              discount: { type: 'FIXED_AMOUNT', amountMinor: '1000' },
            },
          ],
        }),
      );
      expect(result.lines[0]?.flags).toEqual([]);
      expect(result.lines[0]?.unitPriceAppliedMinor).toBe(1500n);
    });

    it('with the block off, the same below-cost discount is permitted and flagged — warn, not refuse', async () => {
      await ownerUpdates({ blockDiscountBelowCost: false });
      const result = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        pricing.evaluateSaleLinesInTransaction(tx, {
          organizationId: mainOrgId,
          actorUserId: cashierUserId,
          lines: [
            {
              unitPriceListMinor: LIST,
              unitPriceAppliedMinor: 1500n,
              unitCostAppliedMinor: COST,
              discount: { type: 'FIXED_AMOUNT', amountMinor: '1000' },
            },
          ],
        }),
      );
      expect(result.lines[0]?.flags).toEqual(['BELOW_COST']);
      expect(result.lines[0]?.unitPriceAppliedMinor).toBe(1500n);
      await ownerUpdates({ blockDiscountBelowCost: true });
    });
  });

  describe('the salesperson rule is resolved from the server-side role key (§18.2, §11.4)', () => {
    beforeAll(async () => {
      await ownerUpdates({
        pricingMode: 'FIXED_WITH_DISCOUNT',
        maxDiscountPercentage: 100,
        maxDiscountAmountMinor: '100000',
        discountApprovalThresholdMinor: null,
        blockDiscountBelowCost: false,
        discountAllowedForSalesperson: false,
      });
    });

    it('refuses the salesperson actor while the setting is off — the role carries no discount permission of its own', async () => {
      await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        expectRefusal(
          () =>
            pricing.evaluateSaleLinesInTransaction(tx, {
              organizationId: mainOrgId,
              actorUserId: salespersonUserId,
              lines: [
                {
                  unitPriceListMinor: LIST,
                  unitPriceAppliedMinor: LIST,
                  discount: { type: 'PERCENTAGE', percentage: '10' },
                },
              ],
            }),
          ERROR_CODES.DISCOUNT_FORBIDDEN,
        ),
      );
    });

    it('opens the authority for the salesperson role when the setting turns on — the role key the resolver read', async () => {
      await ownerUpdates({ discountAllowedForSalesperson: true });
      const result = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        pricing.evaluateSaleLinesInTransaction(tx, {
          organizationId: mainOrgId,
          actorUserId: salespersonUserId,
          lines: [
            {
              unitPriceListMinor: LIST,
              unitPriceAppliedMinor: 2250n,
              discount: { type: 'PERCENTAGE', percentage: '10' },
            },
          ],
        }),
      );
      expect(result.lines[0]?.unitPriceAppliedMinor).toBe(2250n);
      expect(result.lines[0]?.discount?.approved).toBe(false);
      await ownerUpdates({ discountAllowedForSalesperson: false });
    });

    it('stays refused for a role the setting does not name — the grant is role-scoped, not global', async () => {
      await ownerUpdates({ discountAllowedForSalesperson: true });
      // The bystander holds no discount permission and no salesperson role key,
      // so the rule grant reaches no one but the preset key.
      await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        expectRefusal(
          () =>
            pricing.evaluateSaleLinesInTransaction(tx, {
              organizationId: mainOrgId,
              actorUserId: bystanderUserId,
              lines: [
                {
                  unitPriceListMinor: LIST,
                  unitPriceAppliedMinor: LIST,
                  discount: { type: 'PERCENTAGE', percentage: '10' },
                },
              ],
            }),
          ERROR_CODES.DISCOUNT_FORBIDDEN,
        ),
      );
      await ownerUpdates({ discountAllowedForSalesperson: false });
    });

    it('an explicit DENY on pricing.discount.apply keeps beating the rule grant (§11.4 deny over allow)', async () => {
      await ownerUpdates({ discountAllowedForSalesperson: true });
      await withTenantTransaction({ prisma: app }, mainOrgId, async (tx) => {
        await tx.permissionOverride.create({
          data: {
            organizationId: mainOrgId,
            userId: salespersonUserId,
            permissionId: 'pricing.discount.apply',
            effect: 'DENY',
          },
        });
      });
      try {
        await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
          expectRefusal(
            () =>
              pricing.evaluateSaleLinesInTransaction(tx, {
                organizationId: mainOrgId,
                actorUserId: salespersonUserId,
                lines: [
                  {
                    unitPriceListMinor: LIST,
                    unitPriceAppliedMinor: LIST,
                    discount: { type: 'PERCENTAGE', percentage: '10' },
                  },
                ],
              }),
            ERROR_CODES.DISCOUNT_FORBIDDEN,
          ),
        );
      } finally {
        await withTenantTransaction({ prisma: app }, mainOrgId, async (tx) => {
          await tx.permissionOverride.deleteMany({
            where: { organizationId: mainOrgId, userId: salespersonUserId, permissionId: 'pricing.discount.apply' },
          });
        });
        await ownerUpdates({ discountAllowedForSalesperson: false });
      }
    });

    it('an ALLOW override grants the authority through the permission path, independent of the setting', async () => {
      await withTenantTransaction({ prisma: app }, mainOrgId, async (tx) => {
        await tx.permissionOverride.create({
          data: {
            organizationId: mainOrgId,
            userId: salespersonUserId,
            permissionId: 'pricing.discount.apply',
            effect: 'ALLOW',
          },
        });
      });
      try {
        const result = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
          pricing.evaluateSaleLinesInTransaction(tx, {
            organizationId: mainOrgId,
            actorUserId: salespersonUserId,
            lines: [
              {
                unitPriceListMinor: LIST,
                unitPriceAppliedMinor: 2250n,
                discount: { type: 'PERCENTAGE', percentage: '10' },
              },
            ],
          }),
        );
        expect(result.lines[0]?.unitPriceAppliedMinor).toBe(2250n);
      } finally {
        await withTenantTransaction({ prisma: app }, mainOrgId, async (tx) => {
          await tx.permissionOverride.deleteMany({
            where: { organizationId: mainOrgId, userId: salespersonUserId, permissionId: 'pricing.discount.apply' },
          });
        });
      }
    });
  });

  describe('the applied price is derived, and the caller value is only a hint (§17.4)', () => {
    beforeAll(async () => {
      await ownerUpdates({
        pricingMode: 'FIXED_WITH_DISCOUNT',
        maxDiscountPercentage: 100,
        maxDiscountAmountMinor: '100000',
        discountApprovalThresholdMinor: null,
        blockDiscountBelowCost: false,
        discountAllowedForSalesperson: false,
      });
    });

    it('accepts a hint that agrees with the derivation', async () => {
      const result = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        pricing.evaluateSaleLinesInTransaction(tx, {
          organizationId: mainOrgId,
          actorUserId: cashierUserId,
          lines: [
            {
              unitPriceListMinor: LIST,
              unitPriceAppliedMinor: 2250n,
              discount: { type: 'FIXED_AMOUNT', amountMinor: '250' },
            },
            {
              unitPriceListMinor: LIST,
              unitPriceAppliedMinor: 2250n,
              discount: { type: 'PERCENTAGE', percentage: '10' },
            },
          ],
        }),
      );
      expect(result.lines[0]?.unitPriceAppliedMinor).toBe(2250n);
      expect(result.lines[1]?.unitPriceAppliedMinor).toBe(2250n);
    });

    it('refuses a disagreeing hint with VALIDATION_FAILED — the server derives the financial value', async () => {
      await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        expectRefusal(
          () =>
            pricing.evaluateSaleLinesInTransaction(tx, {
              organizationId: mainOrgId,
              actorUserId: cashierUserId,
              lines: [
                {
                  unitPriceListMinor: LIST,
                  unitPriceAppliedMinor: 2200n,
                  discount: { type: 'FIXED_AMOUNT', amountMinor: '250' },
                },
              ],
            }),
          ERROR_CODES.VALIDATION_FAILED,
        ),
      );
    });

    it('refuses a malformed offer value with VALIDATION_FAILED before any policy is consulted', async () => {
      await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        expectRefusal(
          () =>
            pricing.evaluateSaleLinesInTransaction(tx, {
              organizationId: mainOrgId,
              actorUserId: cashierUserId,
              lines: [
                {
                  unitPriceListMinor: LIST,
                  unitPriceAppliedMinor: LIST,
                  discount: { type: 'PERCENTAGE', percentage: '10.999' },
                },
              ],
            }),
          ERROR_CODES.VALIDATION_FAILED,
        ),
      );
      await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        expectRefusal(
          () =>
            pricing.evaluateSaleLinesInTransaction(tx, {
              organizationId: mainOrgId,
              actorUserId: cashierUserId,
              lines: [
                {
                  unitPriceListMinor: LIST,
                  unitPriceAppliedMinor: LIST,
                  discount: { type: 'FIXED_AMOUNT', amountMinor: '-5' },
                },
              ],
            }),
          ERROR_CODES.VALIDATION_FAILED,
        ),
      );
    });
  });

  describe('the live policy read and its version stamp (§22.3, §38.18)', () => {
    beforeAll(async () => {
      // Re-open the live-read block from the looser mode, as §22.3's
      // stale-affordance probe needs a flip *inside* one transaction.
      await ownerUpdates({ pricingMode: 'VARIABLE' });
    });

    it('sees a policy change committed between two statements of one transaction — and stamps each decision with the version it enforced', async () => {
      const versionBefore = await currentVersion();
      expect(versionBefore).toBeGreaterThan(0n);
      let pollStarted!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => {
        pollStarted = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });

      const insideTx = app.$transaction(async (tx) => {
        // The raw transaction must carry the trusted tenant context itself —
        // exactly what `withTenantTransaction` does for the accepted paths.
        await establishTenantContext(tx, mainOrgId);
        // The first statement runs under VARIABLE; the manual reduction is the
        // mode's own authority and is accepted.
        const underVariable = await pricing.evaluateSaleLinesInTransaction(tx, {
          organizationId: mainOrgId,
          actorUserId: cashierUserId,
          lines: [{ unitPriceListMinor: LIST, unitPriceAppliedMinor: LIST - 100n }],
        });
        pollStarted();
        await released;
        // The second statement carries a discount offer: offered under the
        // committed FIXED_WITH_DISCOUNT policy it is accepted, and the
        // decision stamps the version of the policy it enforced.
        const afterArrival = await pricing.evaluateSaleLinesInTransaction(tx, {
          organizationId: mainOrgId,
          actorUserId: cashierUserId,
          lines: [
            {
              unitPriceListMinor: LIST,
              unitPriceAppliedMinor: 2250n,
              discount: { type: 'FIXED_AMOUNT', amountMinor: '250' },
            },
          ],
        });
        return { underVariable, afterArrival };
      });

      await started;
      // One committed settings write flips the mode to the discount mode and
      // arms its ceilings in the same version bump.
      const bumpedVersion = await ownerUpdates({
        pricingMode: 'FIXED_WITH_DISCOUNT',
        maxDiscountPercentage: 100,
        maxDiscountAmountMinor: '100000',
        discountApprovalThresholdMinor: null,
        blockDiscountBelowCost: false,
        discountAllowedForSalesperson: false,
      });
      release();

      const pinned = await insideTx;
      expect(pinned.underVariable.pricingMode).toBe('VARIABLE');
      expect(pinned.underVariable.settingsVersion).toBe(versionBefore);
      expect(pinned.underVariable.lines[0]?.discount).toBeUndefined();
      expect(pinned.afterArrival.pricingMode).toBe('FIXED_WITH_DISCOUNT');
      expect(pinned.afterArrival.settingsVersion).toBe(bumpedVersion);
      expect(pinned.afterArrival.lines[0]?.discount?.type).toBe('FIXED_AMOUNT');
      expect(pinned.afterArrival.lines[0]?.discount?.discountAmountMinor).toBe(250n);
    });
  });

  describe('offline reconciliation of discount lines (§38.19, §16.2)', () => {
    beforeAll(async () => {
      await ownerUpdates({
        pricingMode: 'FIXED_WITH_DISCOUNT',
        maxDiscountPercentage: 20,
        maxDiscountAmountMinor: '10000',
        discountApprovalThresholdMinor: null,
        blockDiscountBelowCost: false,
        discountAllowedForSalesperson: false,
      });
    });

    it('reports no drift for a recorded line the current policy and derivation still produce', async () => {
      const result = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        pricing.reconcileOfflineSaleLinesInTransaction(tx, {
          organizationId: mainOrgId,
          actorUserId: cashierUserId,
          lines: [
            {
              unitPriceListMinor: LIST,
              unitPriceAppliedMinor: 2250n,
              discount: { type: 'FIXED_AMOUNT', amountMinor: '250' },
            },
          ],
        }),
      );
      expect(result.driftLineCount).toBe(0);
      expect(result.lines[0]?.flags).toEqual([]);
      expect(result.lines[0]?.unitPriceAppliedMinor).toBe(2250n);
      expect(result.lines[0]?.discount).toEqual({
        type: 'FIXED_AMOUNT',
        offeredValue: '250',
        discountAmountMinor: 250n,
        approved: false,
        authorizationRef: null,
      });
    });

    it('accepts and flags a line a tightened ceiling would refuse — never a refusal, never a silent reprice', async () => {
      await ownerUpdates({ maxDiscountAmountMinor: '100' });
      const result = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        pricing.reconcileOfflineSaleLinesInTransaction(tx, {
          organizationId: mainOrgId,
          actorUserId: cashierUserId,
          lines: [
            {
              unitPriceListMinor: LIST,
              unitPriceAppliedMinor: 2250n,
              discount: { type: 'FIXED_AMOUNT', amountMinor: '250' },
            },
          ],
        }),
      );
      expect(result.driftLineCount).toBe(1);
      expect(result.lines[0]?.flags).toEqual(['PRICING_POLICY_DRIFT']);
      // The recorded snapshot values ride back untouched (§16.2).
      expect(result.lines[0]?.unitPriceListMinor).toBe(LIST);
      expect(result.lines[0]?.unitPriceAppliedMinor).toBe(2250n);
      await ownerUpdates({ maxDiscountAmountMinor: '10000' });
    });

    it('refuses a recorded line inconsistent with its own discount — corruption, never drift, in both entry points', async () => {
      // The §16.2 identity: applied = list − discount amount for FIXED_AMOUNT.
      await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        expectRefusal(
          () =>
            pricing.reconcileOfflineSaleLinesInTransaction(tx, {
              organizationId: mainOrgId,
              actorUserId: cashierUserId,
              lines: [
                {
                  unitPriceListMinor: LIST,
                  unitPriceAppliedMinor: 2000n,
                  discount: { type: 'FIXED_AMOUNT', amountMinor: '250' },
                },
              ],
            }),
          ERROR_CODES.VALIDATION_FAILED,
        ),
      );
      // The same corruption is refused on the online side too.
      await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        expectRefusal(
          () =>
            pricing.evaluateSaleLinesInTransaction(tx, {
              organizationId: mainOrgId,
              actorUserId: cashierUserId,
              lines: [
                {
                  unitPriceListMinor: LIST,
                  unitPriceAppliedMinor: 2000n,
                  discount: { type: 'FIXED_AMOUNT', amountMinor: '250' },
                },
              ],
            }),
          ERROR_CODES.VALIDATION_FAILED,
        ),
      );
    });

    it('refuses a recorded above-list fixed price — no policy version ever permitted it, corruption never drift', async () => {
      await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        expectRefusal(
          () =>
            pricing.reconcileOfflineSaleLinesInTransaction(tx, {
              organizationId: mainOrgId,
              actorUserId: cashierUserId,
              lines: [
                {
                  unitPriceListMinor: LIST,
                  unitPriceAppliedMinor: 2600n,
                  discount: { type: 'FIXED_PRICE', amountMinor: '2600' },
                },
              ],
            }),
          ERROR_CODES.VALIDATION_FAILED,
        ),
      );
    });

    it('treats a rounding-mode change as policy drift, flagged on the recorded price — never re-priced (§30.6)', async () => {
      // LIST_TIE × 1% sits exact on the rounding tie: HALF_UP derives 1039,
      // HALF_EVEN derives 1040 — both are structurally producible prices, so
      // the recorded line is legal data whichever mode recorded it.
      const recorded = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        pricing.evaluateSaleLinesInTransaction(tx, {
          organizationId: mainOrgId,
          actorUserId: cashierUserId,
          lines: [
            {
              unitPriceListMinor: LIST_TIE,
              unitPriceAppliedMinor: 1039n,
              discount: { type: 'PERCENTAGE', percentage: '1' },
            },
          ],
        }),
      );
      expect(recorded.lines[0]?.unitPriceAppliedMinor).toBe(1039n);
      await ownerUpdates({ roundingMode: 'HALF_EVEN' });
      const result = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        pricing.reconcileOfflineSaleLinesInTransaction(tx, {
          organizationId: mainOrgId,
          actorUserId: cashierUserId,
          lines: [
            {
              unitPriceListMinor: LIST_TIE,
              unitPriceAppliedMinor: 1039n,
              discount: { type: 'PERCENTAGE', percentage: '1' },
            },
          ],
        }),
      );
      expect(result.driftLineCount).toBe(1);
      expect(result.lines[0]?.flags).toEqual(['PRICING_POLICY_DRIFT']);
      expect(result.lines[0]?.unitPriceAppliedMinor).toBe(1039n);
      await ownerUpdates({ roundingMode: 'HALF_UP' });
    });

    it('flags a line the current mode would refuse outright — availability covers policy changes, too', async () => {
      await ownerUpdates({ pricingMode: 'FIXED' });
      const result = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        pricing.reconcileOfflineSaleLinesInTransaction(tx, {
          organizationId: mainOrgId,
          actorUserId: cashierUserId,
          lines: [
            {
              unitPriceListMinor: LIST,
              unitPriceAppliedMinor: 2250n,
              discount: { type: 'FIXED_AMOUNT', amountMinor: '250' },
            },
          ],
        }),
      );
      expect(result.driftLineCount).toBe(1);
      expect(result.lines[0]?.flags).toEqual(['PRICING_POLICY_DRIFT']);
      expect(result.lines[0]?.unitPriceAppliedMinor).toBe(2250n);
      await ownerUpdates({ pricingMode: 'FIXED_WITH_DISCOUNT' });
    });
  });

  describe('tenant isolation (§8.2, §9.3, I-9)', () => {
    it('refuses a discount decision scoped to another organization inside this tenant transaction — fail closed', async () => {
      const foreignOrg = randomUUID(); // a real but absent organization id: no row is visible or writable
      await withTenantTransaction({ prisma: app }, mainOrgId, async (tx) => {
        let threw: unknown;
        try {
          await pricing.evaluateSaleLinesInTransaction(tx, {
            organizationId: foreignOrg,
            actorUserId: cashierUserId,
            lines: [
              {
                unitPriceListMinor: LIST,
                unitPriceAppliedMinor: LIST,
                discount: { type: 'FIXED_AMOUNT', amountMinor: '250' },
              },
            ],
          });
        } catch (error) {
          threw = error;
        }
        // Either way the boundary must not produce an outcome: the foreign
        // settings read is RLS-refused before any discount policy is applied.
        expect(threw).toBeDefined();
      });
    });
  });

  describe('M3-S2 regression — the offer-less manual boundary stands beside the discount machinery', () => {
    beforeAll(async () => {
      await ownerUpdates({
        pricingMode: 'FIXED_WITH_DISCOUNT',
        maxDiscountPercentage: 20,
        maxDiscountAmountMinor: '10000',
        discountApprovalThresholdMinor: null,
        blockDiscountBelowCost: false,
        discountAllowedForSalesperson: false,
      });
    });

    it('refuses a manual reduction without a discount offer to the owner too — PRICE_OVERRIDE_FORBIDDEN, not a discount code', async () => {
      await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        expectRefusal(
          () =>
            pricing.evaluateSaleLinesInTransaction(tx, {
              organizationId: mainOrgId,
              actorUserId: ownerUserId,
              lines: [{ unitPriceListMinor: LIST, unitPriceAppliedMinor: 2250n }],
            }),
          ERROR_CODES.PRICE_OVERRIDE_FORBIDDEN,
        ),
      );
    });

    it('refuses a manual increase to an actor without pricing.override — the alteration rule is untouched by v2', async () => {
      await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        expectRefusal(
          () =>
            pricing.evaluateSaleLinesInTransaction(tx, {
              organizationId: mainOrgId,
              actorUserId: cashierUserId,
              lines: [{ unitPriceListMinor: LIST, unitPriceAppliedMinor: LIST + 100n }],
            }),
          ERROR_CODES.PRICE_OVERRIDE_FORBIDDEN,
        ),
      );
    });

    it('a refused discount leaves the settings row, its version, and the audit chain untouched (M3-S1 regression)', async () => {
      const before = await currentVersion();
      const eventsBefore = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        tx.auditEvent.count({ where: { organizationId: mainOrgId } }),
      );
      await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        expectRefusal(
          () =>
            pricing.evaluateSaleLinesInTransaction(tx, {
              organizationId: mainOrgId,
              actorUserId: ownerUserId,
              lines: [
                {
                  unitPriceListMinor: LIST,
                  unitPriceAppliedMinor: LIST,
                  discount: { type: 'FIXED_AMOUNT', amountMinor: '99999' },
                },
              ],
            }),
          ERROR_CODES.DISCOUNT_LIMIT_EXCEEDED,
        ),
      );
      expect(await currentVersion()).toBe(before);
      const eventsAfter = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        tx.auditEvent.count({ where: { organizationId: mainOrgId } }),
      );
      expect(eventsAfter).toBe(eventsBefore);
    });

    it('the in-transaction settings read answers exactly what the standalone read answers — discount columns included (M3-S1)', async () => {
      const standalone = await settings.get(mainOrgId);
      const inside = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        settings.readInTransaction(tx, mainOrgId),
      );
      expect(inside).toEqual(standalone);
      expect(inside.maxDiscountPercentage).toBe(standalone.maxDiscountPercentage);
      expect(inside.maxDiscountAmountMinor).toBe(standalone.maxDiscountAmountMinor);
      expect(inside.discountApprovalThresholdMinor).toBe(standalone.discountApprovalThresholdMinor);
      expect(inside.discountAllowedForSalesperson).toBe(standalone.discountAllowedForSalesperson);
      expect(inside.blockDiscountBelowCost).toBe(standalone.blockDiscountBelowCost);
    });
  });
});
