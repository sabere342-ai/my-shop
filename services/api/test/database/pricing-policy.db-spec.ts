/**
 * M3-S2 acceptance — the pricing-mode enforcement boundary against **real
 * PostgreSQL** (Master Plan §17.1–§17.4, §22.3, §38.19, §36.1 T-2/T-5; §40.7
 * row M3-S2).
 *
 * The invariants the plan makes acceptance hinges on, each probed through the
 * same code paths the running process will use — the transactional
 * `PricingPolicyService`, the M3-S1 typed settings row, the M2-S4 effective
 * authorization resolver, and the forced-RLS tenant tables:
 *
 *  1. **FIXED (§17.1)** — the stored selling price is authoritative; a
 *     differing applied price answers the documented `403
 *     PRICE_OVERRIDE_FORBIDDEN` without `pricing.override`, and the same
 *     alteration passes with it.
 *  2. **VARIABLE (§17.2)** — `sales.create` is the price-entry authority,
 *     re-proven inside the transaction; list and applied stay distinct; a
 *     below-cost line is permitted and flagged.
 *  3. **FIXED_WITH_DISCOUNT (§17.3)** — a reduction below the list price is
 *     refused to every actor in this slice (the reduction path is M3-S3's
 *     discount machinery); an increase requires `pricing.override`.
 *  4. **The policy is read live (§22.3)** — a committed `pricing_mode` change
 *     takes effect on the next transaction, the decision records the
 *     `settings_version` it decided under, and a change committed between the
 *     caller's transaction start and the pricing statement is *seen* by the
 *     decision, never a stale policy.
 *  5. **Authorization is resolved in-transaction (§11.4/§9.4)** — a permission
 *     override that grants or denies `pricing.override` changes the decision;
 *     a foreign actor resolves to the same refusal the guards answer with.
 *  6. **Tenant isolation (§8.2/§9.3)** — a decision scoped to another
 *     organization fails closed inside this organization's transaction; no
 *     cross-tenant policy read exists.
 *  7. **Offline reconciliation (§38.19)** — a line the current policy would
 *     refuse is *accepted and flagged* `PRICING_POLICY_DRIFT` on sync, never
 *     refused, never silently voided.
 *  8. **M3-S1 regression** — the typed settings surface, its version
 *     discipline, and its same-transaction audit event are untouched.
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

/** Declared here so the concurrency test's closure can close over them. */
let pollStarted!: () => void;
let release!: () => void;

interface DatabaseUrls {
  readonly application: string;
  readonly migration: string;
  readonly admin: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `${name} is not set. The pricing acceptance suite refuses to run without it ` +
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
const CHEAPER = 2000n;
const UNDER_COST = 1500n;
const COST = 1800n;
/** Runs a pricing-boundary call already bound to a tenant transaction and asserts its refusal. */
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

describe('pricing policy acceptance (real PostgreSQL, §17/§38.19)', () => {
  jest.setTimeout(180_000);

  let urls: DatabaseUrls;
  let app: PrismaClient;
  let settings: SettingsService;
  let authorization: AuthorizationService;
  let pricing: PricingPolicyService;
  let setupRan = false;

  let mainOrgId = '';
  let mainOwnerId = '';
  let cashierUserId = '';
  let noSalesUserId = '';
  let cashierRoleId = '';

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
    // tenant-isolation probes have a real foreign tenant to be refused with.
    const [main, otherA, otherB] = await Promise.all([
      new OrganizationBootstrapService({ prisma: app }).bootstrap({
        bootstrapKey: 'pricing-main-shop',
        organizationName: 'Pricing Main Shop',
        ownerEmail: 'owner-pricing-main@example.test',
      }),
      new OrganizationBootstrapService({ prisma: app }).bootstrap({
        bootstrapKey: 'pricing-other-shop-a',
        organizationName: 'Pricing Other Shop A',
        ownerEmail: 'owner-pricing-a@example.test',
      }),
      new OrganizationBootstrapService({ prisma: app }).bootstrap({
        bootstrapKey: 'pricing-other-shop-b',
        organizationName: 'Pricing Other Shop B',
        ownerEmail: 'owner-pricing-b@example.test',
      }),
    ]);
    mainOrgId = main.organizationId;
    mainOwnerId = main.userId;

    cashierUserId = otherA.userId;
    noSalesUserId = otherB.userId;
    // The main organization's non-owner actors: a cashier whose role grants
    // exactly the cashier preset's sale-facing grants (sales.create without
    // pricing.override — the §11.3 cashier), and a second actor whose role
    // grants nothing at all (the fail-closed empty set, §11.3).
    cashierRoleId = randomUUID();
    const emptyRoleId = randomUUID();
    await withTenantTransaction({ prisma: app }, mainOrgId, async (tx) => {
      await tx.role.create({
        data: {
          id: cashierRoleId,
          organizationId: mainOrgId,
          key: 'pricing_cashier',
          name: 'Pricing Cashier',
          isSystem: false,
          isOwner: false,
        },
      });
      await tx.rolePermission.createMany({
        data: [
          { organizationId: mainOrgId, roleId: cashierRoleId, permissionId: 'sales.view' },
          { organizationId: mainOrgId, roleId: cashierRoleId, permissionId: 'sales.create' },
          { organizationId: mainOrgId, roleId: cashierRoleId, permissionId: 'catalog.view' },
        ],
      });
      await tx.role.create({
        data: {
          id: emptyRoleId,
          organizationId: mainOrgId,
          key: 'pricing_bystander',
          name: 'Pricing Bystander',
          isSystem: false,
          isOwner: false,
        },
      });
      await tx.organizationMembership.createMany({
        data: [
          { organizationId: mainOrgId, userId: cashierUserId, isOwner: false, roleId: cashierRoleId },
          { organizationId: mainOrgId, userId: noSalesUserId, isOwner: false, roleId: emptyRoleId },
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

  /** Flips one pricing policy field through the accepted M3-S1 write path. */
  async function ownerUpdates(offer: { pricingMode?: 'FIXED' | 'VARIABLE' | 'FIXED_WITH_DISCOUNT' }): Promise<bigint> {
    const version = await currentVersion();
    const result = await settings.update(
      { organizationId: mainOrgId, actorUserId: mainOwnerId, expectedSettingsVersion: Number(version), offered: offer },
      new Date(),
    );
    return result.view.settingsVersion;
  }

  describe('FIXED mode — the stored selling price is authoritative (§17.1)', () => {
    it('accepts an applied price equal to the list price for an actor with no price authority at all', async () => {
      const version = await currentVersion();
      const result = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        pricing.evaluateSaleLinesInTransaction(tx, {
          organizationId: mainOrgId,
          actorUserId: cashierUserId,
          lines: [{ unitPriceListMinor: LIST, unitPriceAppliedMinor: LIST }],
        }),
      );
      expect(result.pricingMode).toBe('FIXED');
      expect(result.settingsVersion).toBe(version);
      // M3-S3 bumps the decision contract to version 2 (the §18 discount
      // facts); v1 recorded decisions are never re-interpreted.
      expect(result.contractVersion).toBe(2);
      expect(result.lines[0]?.flags).toEqual([]);
      expect(result.lines[0]?.unitPriceListMinor).toBe(LIST);
    });

    it('refuses a differing applied price for a cashier with the documented 403 PRICE_OVERRIDE_FORBIDDEN', async () => {
      expect(statusForCode(ERROR_CODES.PRICE_OVERRIDE_FORBIDDEN)).toBe(403);
      await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        expectRefusal(
          () =>
            pricing.evaluateSaleLinesInTransaction(tx, {
              organizationId: mainOrgId,
              actorUserId: cashierUserId,
              lines: [{ unitPriceListMinor: LIST, unitPriceAppliedMinor: CHEAPER }],
            }),
          ERROR_CODES.PRICE_OVERRIDE_FORBIDDEN,
        ),
      );
    });

    it('refuses the alteration with no state change — the refusal rolls back before anything is written', async () => {
      const before = await currentVersion();
      await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        expectRefusal(
          () =>
            pricing.evaluateSaleLinesInTransaction(tx, {
              organizationId: mainOrgId,
              actorUserId: cashierUserId,
              lines: [{ unitPriceListMinor: LIST, unitPriceAppliedMinor: CHEAPER }],
            }),
          ERROR_CODES.PRICE_OVERRIDE_FORBIDDEN,
        ),
      );
      expect(await currentVersion()).toBe(before);
    });

    it('accepts the same alteration for an actor holding pricing.override, resolved live', async () => {
      await withTenantTransaction({ prisma: app }, mainOrgId, async (tx) => {
        await tx.permissionOverride.create({
          data: { organizationId: mainOrgId, userId: cashierUserId, permissionId: 'pricing.override', effect: 'ALLOW' },
        });
      });
      try {
        const result = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
          pricing.evaluateSaleLinesInTransaction(tx, {
            organizationId: mainOrgId,
            actorUserId: cashierUserId,
            lines: [{ unitPriceListMinor: LIST, unitPriceAppliedMinor: CHEAPER }],
          }),
        );
        expect(result.lines[0]?.flags).toEqual([]);
        expect(result.lines[0]?.unitPriceAppliedMinor).toBe(CHEAPER);
      } finally {
        await withTenantTransaction({ prisma: app }, mainOrgId, async (tx) => {
          await tx.permissionOverride.deleteMany({
            where: { organizationId: mainOrgId, userId: cashierUserId, permissionId: 'pricing.override' },
          });
        });
      }
    });
  });

  describe('VARIABLE mode — sales.create is the price-entry authority (§17.2)', () => {
    let versionAfterFlip = 0n;

    beforeAll(async () => {
      versionAfterFlip = await ownerUpdates({ pricingMode: 'VARIABLE' });
    });

    it('accepts a differing applied price for a cashier without any override permission', async () => {
      const result = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        pricing.evaluateSaleLinesInTransaction(tx, {
          organizationId: mainOrgId,
          actorUserId: cashierUserId,
          lines: [{ unitPriceListMinor: LIST, unitPriceAppliedMinor: CHEAPER }],
        }),
      );
      expect(result.pricingMode).toBe('VARIABLE');
      expect(result.settingsVersion).toBe(versionAfterFlip);
      // List and applied stay two distinct snapshot values (§16.2).
      expect(result.lines[0]?.unitPriceListMinor).toBe(LIST);
      expect(result.lines[0]?.unitPriceAppliedMinor).toBe(CHEAPER);
      expect(result.lines[0]?.flags).toEqual([]);
    });

    it('flags BELOW_COST for a permitted price below the server-resolved cost', async () => {
      const result = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        pricing.evaluateSaleLinesInTransaction(tx, {
          organizationId: mainOrgId,
          actorUserId: cashierUserId,
          lines: [
            { unitPriceListMinor: LIST, unitPriceAppliedMinor: UNDER_COST, unitCostAppliedMinor: COST },
            { unitPriceListMinor: LIST, unitPriceAppliedMinor: COST, unitCostAppliedMinor: COST },
          ],
        }),
      );
      // Strictly below cost is flagged; exactly at cost is not (§17.2).
      expect(result.lines[0]?.flags).toEqual(['BELOW_COST']);
      expect(result.lines[1]?.flags).toEqual([]);
    });

    it('refuses an actor without sales.create with 403 PERMISSION_DENIED — even for an equal price', async () => {
      await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        expectRefusal(
          () =>
            pricing.evaluateSaleLinesInTransaction(tx, {
              organizationId: mainOrgId,
              actorUserId: noSalesUserId,
              lines: [{ unitPriceListMinor: LIST, unitPriceAppliedMinor: LIST }],
            }),
          ERROR_CODES.PERMISSION_DENIED,
        ),
      );
    });

    it('refuses malformed money with VALIDATION_FAILED before any policy is consulted', async () => {
      await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        expectRefusal(
          () =>
            pricing.evaluateSaleLinesInTransaction(tx, {
              organizationId: mainOrgId,
              actorUserId: cashierUserId,
              lines: [{ unitPriceListMinor: LIST, unitPriceAppliedMinor: -1n }],
            }),
          ERROR_CODES.VALIDATION_FAILED,
        ),
      );
    });

    it('refuses an evaluation that carries no sale line', async () => {
      await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        expectRefusal(
          () =>
            pricing.evaluateSaleLinesInTransaction(tx, {
              organizationId: mainOrgId,
              actorUserId: cashierUserId,
              lines: [],
            }),
          ERROR_CODES.VALIDATION_FAILED,
        ),
      );
    });
  });

  describe('FIXED_WITH_DISCOUNT mode — the reduction path is M3-S3 (§17.3)', () => {
    beforeAll(async () => {
      await ownerUpdates({ pricingMode: 'FIXED_WITH_DISCOUNT' });
    });

    it('refuses a reduction below the list price to the owner too — no manual bypass of the M3-S3 discount boundary', async () => {
      await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        expectRefusal(
          () =>
            pricing.evaluateSaleLinesInTransaction(tx, {
              organizationId: mainOrgId,
              actorUserId: mainOwnerId,
              lines: [{ unitPriceListMinor: LIST, unitPriceAppliedMinor: CHEAPER }],
            }),
          ERROR_CODES.PRICE_OVERRIDE_FORBIDDEN,
        ),
      );
    });

    it('refuses an increase over the list price to a cashier without pricing.override', async () => {
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

    it('accepts an increase for the owner (the override authority) and records the live version', async () => {
      const version = await currentVersion();
      const result = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        pricing.evaluateSaleLinesInTransaction(tx, {
          organizationId: mainOrgId,
          actorUserId: mainOwnerId,
          lines: [{ unitPriceListMinor: LIST, unitPriceAppliedMinor: LIST + 100n }],
        }),
      );
      expect(result.settingsVersion).toBe(version);
      expect(result.lines[0]?.flags).toEqual([]);
    });
  });

  describe('the live policy read and its version stamp (§22.3, §38.18)', () => {
    beforeAll(async () => {
      await ownerUpdates({ pricingMode: 'VARIABLE' });
    });

    it('records the settings_version the decision was made under, matching the committed row', async () => {
      const version = await currentVersion();
      const result = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        pricing.evaluateSaleLinesInTransaction(tx, {
          organizationId: mainOrgId,
          actorUserId: cashierUserId,
          lines: [{ unitPriceListMinor: LIST, unitPriceAppliedMinor: CHEAPER }],
        }),
      );
      expect(result.settingsVersion).toBe(version);
    });

    it('sees a policy change committed between two pricing statements — and stamps each decision with the version it enforced', async () => {
      // §22.3: a stale affordance must never become a stale posted value. READ
      // COMMITTED re-reads committed state at each pricing statement, so this
      // evaluation observes the tightened mode even though its transaction
      // opened under the looser one — and each result records the exact
      // settings_version of the policy it enforced.
      const versionBefore = await currentVersion();
      expect(versionBefore).toBeGreaterThan(0n);
      const started = new Promise<void>((resolve) => {
        pollStarted = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const insideTx = app.$transaction(async (tx) => {
        // The raw transaction must carry the trusted tenant context itself —
        // exactly what `withTenantTransaction` does for the accepted paths —
        // before a pricing statement can read the forced-RLS settings row.
        await establishTenantContext(tx, mainOrgId);
        // The caller's first statement runs under VARIABLE; the differing
        // price is the mode's own authority and is accepted.
        const underVariable = await pricing.evaluateSaleLinesInTransaction(tx, {
          organizationId: mainOrgId,
          actorUserId: cashierUserId,
          lines: [{ unitPriceListMinor: LIST, unitPriceAppliedMinor: CHEAPER }],
        });
        pollStarted();
        await released;
        // The equal-price line is accepted in *every* mode, so the second
        // statement's outcome isolates exactly one fact: which policy moment
        // it decided under.
        const afterTightening = await pricing.evaluateSaleLinesInTransaction(tx, {
          organizationId: mainOrgId,
          actorUserId: cashierUserId,
          lines: [{ unitPriceListMinor: LIST, unitPriceAppliedMinor: LIST }],
        });
        return { underVariable, afterTightening };
      });

      await started;
      const bumpedVersion = await ownerUpdates({ pricingMode: 'FIXED' });
      release();

      const pinned = await insideTx;
      expect(pinned.underVariable.pricingMode).toBe('VARIABLE');
      expect(pinned.underVariable.settingsVersion).toBe(versionBefore);
      // The decision enforced the *then-current* committed policy, not the
      // mode its transaction opened under.
      expect(pinned.afterTightening.pricingMode).toBe('FIXED');
      expect(pinned.afterTightening.settingsVersion).toBe(bumpedVersion);
      // And the tightened mode refuses the alteration deterministically from
      // here on.
      await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        expectRefusal(
          () =>
            pricing.evaluateSaleLinesInTransaction(tx, {
              organizationId: mainOrgId,
              actorUserId: cashierUserId,
              lines: [{ unitPriceListMinor: LIST, unitPriceAppliedMinor: CHEAPER }],
            }),
          ERROR_CODES.PRICE_OVERRIDE_FORBIDDEN,
        ),
      );
    });

    it('audits the policy change in the same transaction as the accepted settings write (M3-S1 regression)', async () => {
      const version = await ownerUpdates({ pricingMode: 'VARIABLE' });
      // The audit stream is a forced-RLS tenant table: the read rides a
      // tenant transaction exactly as the M3-S1 acceptance suite reads it.
      const event = await withTenantTransaction({ prisma: app }, mainOrgId, async (tx) => {
        const events = await tx.auditEvent.findMany({
          where: { organizationId: mainOrgId, eventType: 'SETTINGS_UPDATED' },
          orderBy: { sequence: 'desc' },
          take: 1,
        });
        return events[0];
      });
      expect(event).toBeDefined();
      const payload = event?.payload as {
        settingsVersionAfter?: string;
        changes?: { field: string; oldValue: string; newValue: string }[];
      };
      expect(payload.settingsVersionAfter).toBe(version.toString());
      expect(payload.changes).toEqual([{ field: 'pricingMode', oldValue: 'FIXED', newValue: 'VARIABLE' }]);
    });
  });

  describe('authorization is resolved live, inside the transaction (§11.4, §9.4)', () => {
    beforeAll(async () => {
      await ownerUpdates({ pricingMode: 'FIXED' });
    });

    it('an ALLOW override grants the alteration and a DENY of the same id takes it back — deny beats allow', async () => {
      await withTenantTransaction({ prisma: app }, mainOrgId, async (tx) => {
        await tx.permissionOverride.create({
          data: { organizationId: mainOrgId, userId: cashierUserId, permissionId: 'pricing.override', effect: 'ALLOW' },
        });
      });
      const granted = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        pricing.evaluateSaleLinesInTransaction(tx, {
          organizationId: mainOrgId,
          actorUserId: cashierUserId,
          lines: [{ unitPriceListMinor: LIST, unitPriceAppliedMinor: CHEAPER }],
        }),
      );
      expect(granted.lines[0]?.flags).toEqual([]);

      await withTenantTransaction({ prisma: app }, mainOrgId, async (tx) => {
        await tx.permissionOverride.update({
          where: {
            organizationId_userId_permissionId: {
              organizationId: mainOrgId,
              userId: cashierUserId,
              permissionId: 'pricing.override',
            },
          },
          data: { effect: 'DENY' },
        });
      });
      await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        expectRefusal(
          () =>
            pricing.evaluateSaleLinesInTransaction(tx, {
              organizationId: mainOrgId,
              actorUserId: cashierUserId,
              lines: [{ unitPriceListMinor: LIST, unitPriceAppliedMinor: CHEAPER }],
            }),
          ERROR_CODES.PRICE_OVERRIDE_FORBIDDEN,
        ),
      );

      await withTenantTransaction({ prisma: app }, mainOrgId, async (tx) => {
        await tx.permissionOverride.deleteMany({
          where: { organizationId: mainOrgId, userId: cashierUserId, permissionId: 'pricing.override' },
        });
      });
      await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        expectRefusal(
          () =>
            pricing.evaluateSaleLinesInTransaction(tx, {
              organizationId: mainOrgId,
              actorUserId: cashierUserId,
              lines: [{ unitPriceListMinor: LIST, unitPriceAppliedMinor: CHEAPER }],
            }),
          ERROR_CODES.PRICE_OVERRIDE_FORBIDDEN,
        ),
      );
    });

    it('answers a foreign actor with the same refusal the guards answer with', async () => {
      // A user id with no membership in this organization — the trusted
      // context's actor is verified, and the §11 reader fails closed.
      await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        expectRefusal(
          () =>
            pricing.evaluateSaleLinesInTransaction(tx, {
              organizationId: mainOrgId,
              actorUserId: randomUUID(),
              lines: [{ unitPriceListMinor: LIST, unitPriceAppliedMinor: LIST }],
            }),
          ERROR_CODES.ORGANIZATION_FORBIDDEN,
        ),
      );
    });
  });

  describe('tenant isolation (§8.2, §9.3, I-9)', () => {
    it('refuses a decision scoped to another organization inside this tenant transaction — fail closed, never a foreign policy', async () => {
      const foreignOrg = randomUUID(); // a real but absent organization id: no row is visible or writable
      await withTenantTransaction({ prisma: app }, mainOrgId, async (tx) => {
        let threw: unknown;
        try {
          await pricing.evaluateSaleLinesInTransaction(tx, {
            organizationId: foreignOrg,
            actorUserId: cashierUserId,
            lines: [{ unitPriceListMinor: LIST, unitPriceAppliedMinor: LIST }],
          });
        } catch (error) {
          threw = error;
        }
        // Either way the boundary must not produce an outcome: the foreign
        // settings read is RLS-refused before any policy is applied.
        expect(threw).toBeDefined();
      });
    });
  });

  describe('offline reconciliation on sync (§38.19)', () => {
    beforeAll(async () => {
      // Tighten after the "sale" was recorded: sold under VARIABLE, now FIXED.
      await ownerUpdates({ pricingMode: 'FIXED' });
    });

    it('accepts and flags a line the current policy would refuse — never a refusal, never a silent pass', async () => {
      const result = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        pricing.reconcileOfflineSaleLinesInTransaction(tx, {
          organizationId: mainOrgId,
          actorUserId: cashierUserId,
          lines: [
            { unitPriceListMinor: LIST, unitPriceAppliedMinor: CHEAPER },
            { unitPriceListMinor: LIST, unitPriceAppliedMinor: LIST },
          ],
        }),
      );
      expect(result.driftLineCount).toBe(1);
      expect(result.lines[0]?.flags).toEqual(['PRICING_POLICY_DRIFT']);
      // The physically-completed equal-price line carries no exception.
      expect(result.lines[1]?.flags).toEqual([]);
      // Both lines keep the recorded snapshot values untouched (§16.2).
      expect(result.lines[0]?.unitPriceAppliedMinor).toBe(CHEAPER);
      expect(result.lines[1]?.unitPriceAppliedMinor).toBe(LIST);
    });

    it('reports no drift when the current policy still permits the recorded price', async () => {
      await ownerUpdates({ pricingMode: 'VARIABLE' });
      const result = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        pricing.reconcileOfflineSaleLinesInTransaction(tx, {
          organizationId: mainOrgId,
          actorUserId: cashierUserId,
          lines: [{ unitPriceListMinor: LIST, unitPriceAppliedMinor: CHEAPER }],
        }),
      );
      expect(result.driftLineCount).toBe(0);
      expect(result.lines[0]?.flags).toEqual([]);
      await ownerUpdates({ pricingMode: 'FIXED' });
    });

    it('flags a forged override as drift while the batch keeps moving — the M2-S4 ingress refusal is unchanged', async () => {
      // The permission refusal for the sale itself is the ingress
      // revalidator's (M2-S4), not the pricing boundary's; the pricing
      // reconciliation of an unauthorized override is the §38.19 flag.
      const result = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        pricing.reconcileOfflineSaleLinesInTransaction(tx, {
          organizationId: mainOrgId,
          actorUserId: noSalesUserId, // holds no sales.create; pricing still classifies the price facts
          lines: [{ unitPriceListMinor: LIST, unitPriceAppliedMinor: CHEAPER }],
        }),
      );
      expect(result.driftLineCount).toBe(1);
      expect(result.lines[0]?.flags).toEqual(['PRICING_POLICY_DRIFT']);
    });
  });

  describe('M3-S1 regression — the settings surface is unchanged', () => {
    it('the in-transaction read answers exactly what the standalone read answers', async () => {
      const standalone = await settings.get(mainOrgId);
      const inside = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        settings.readInTransaction(tx, mainOrgId),
      );
      expect(inside).toEqual(standalone);
      expect(inside.settingsVersion).toBe(standalone.settingsVersion);
      expect(inside.pricingMode).toBe(standalone.pricingMode);
    });

    it('a refused pricing decision leaves the settings row, its version, and the audit chain untouched', async () => {
      const before = await currentVersion();
      const eventsBefore = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        tx.auditEvent.count({ where: { organizationId: mainOrgId } }),
      );
      await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        expectRefusal(
          () =>
            pricing.evaluateSaleLinesInTransaction(tx, {
              organizationId: mainOrgId,
              actorUserId: cashierUserId,
              lines: [{ unitPriceListMinor: LIST, unitPriceAppliedMinor: CHEAPER }],
            }),
          ERROR_CODES.PRICE_OVERRIDE_FORBIDDEN,
        ),
      );
      expect(await currentVersion()).toBe(before);
      const eventsAfter = await withTenantTransaction({ prisma: app }, mainOrgId, (tx) =>
        tx.auditEvent.count({ where: { organizationId: mainOrgId } }),
      );
      expect(eventsAfter).toBe(eventsBefore);
    });
  });
});
