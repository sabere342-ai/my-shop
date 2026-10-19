/**
 * M3-S1 acceptance — the typed organization settings against **real
 * PostgreSQL** (Master Plan §22, §22.2/§22.4, §38.18; §40.7 row M3-S1; §36.1
 * T-2: no mock, no in-memory substitute, no skipped run).
 *
 * The invariants the plan makes acceptance hinges on, each probed through the
 * same code paths the running process uses (the service, the authorization
 * resolver, the transactional audit writer) on the same roles:
 *
 *  1. **Migration from empty** — `0012_organization_settings` deploys with the
 *     full `0001`+ history (the same precondition operator deployments use)
 *     and the two tables carry exactly the §22.2/§22.4 column set the plan
 *     names: no `allow_negative_stock` (removed by the M0-P2 amendment) and
 *     no `app_lock_enabled` (§22.2 scopes it per device; M9 owns it).
 *  2. **Forced RLS posture (§8.2, extending migration `0008`)** — both tables
 *     are ENABLE + FORCE with the one `tenant_isolation` symmetric policy.
 *  3. **Defaults and materialization (§22.4)** — a bootstrap transaction
 *     materializes the singleton (version 1, every value at its plan default),
 *     and an organization whose row was removed materializes it lazily on
 *     first read — never a missing answer.
 *  4. **The §38.18 version token** — an accepted write advances the version by
 *     exactly one and commits with it; a stale token answers
 *     `SETTINGS_VERSION_CONFLICT`; a refused or failing write advances
 *     nothing; a no-op-equivalent accepted write still bumps it (D-G).
 *  5. **Field-authorization (§22.2)** — the permission column is enforced per
 *     provided field *inside* the write transaction: a caller who only
 *     half-holds authority is refused before any write, with no partial write
 *     and no version bump.
 *  6. **Class-A audit (§32.5)** — the committed `SETTINGS_UPDATED` event and
 *     the settings change commit or roll back together, and the appender's
 *     gapless-committed chain still verifies afterwards.
 *  7. **The database CHECKs are the last line of defence (§22.1)** — a writer
 *     that bypasses the service lands in a PostgreSQL refusal, named by
 *     SQLSTATE.
 *
 * Environment: `DATABASE_URL` and `ADMIN_DATABASE_URL` with the same guarding
 * the other database suites apply. The superuser connection exists only to
 * manufacturing the pre-0012 shape (deleting a settings row) — the probe
 * principal the tame suites share.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';

import { AuthorizationService } from '../../src/common/tenancy/authorization/authorization.service';
import { SettingsService } from '../../src/common/settings/settings.service';
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
      `${name} is not set. The settings acceptance suite refuses to run without it ` +
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

/** The superuser credentials retargeted at the test database — the tamper probe's principal. */
function superuserUrlFor(adminUrl: string): string {
  const retargeted = new URL(adminUrl);
  retargeted.pathname = `/${TEST_DATABASE}`;
  return retargeted.toString();
}

describe('organization settings acceptance (real PostgreSQL, §22/§38.18)', () => {
  jest.setTimeout(180_000);

  let urls: DatabaseUrls;
  let admin: PrismaClient;
  let app: PrismaClient;
  let settings: SettingsService;
  let authorization: AuthorizationService;
  let setupRan = false;

  let mainOrgId = '';
  let mainOwnerId = '';
  let otherOrgId = '';
  let otherOwnerId = '';
  let roleId = '';

  beforeAll(async () => {
    urls = requireTestUrls();

    // Drop + create from empty, provision roles, `prisma migrate deploy` —
    // the same precondition operator deployments use; migration `0012` rides
    // the committed history like every predecessor.
    dbScript('test-setup');
    setupRan = true;

    app = new PrismaClient({ datasourceUrl: urls.application });
    admin = new PrismaClient({ datasourceUrl: superuserUrlFor(urls.admin) });
    await Promise.all([app.$connect(), admin.$connect()]);

    authorization = new AuthorizationService({ prisma: app });
    settings = new SettingsService({ prisma: app }, authorization, new AuditStreamWriter());

    // Two organizations through the real composition root — each bootstrap
    // transaction also materializes its default settings row (§22.2).
    const bootstrapped = await Promise.all([
      new OrganizationBootstrapService({ prisma: app }).bootstrap({
        bootstrapKey: 'settings-main-shop',
        organizationName: 'Settings Main Shop',
        ownerEmail: 'owner-main@example.test',
      }),
      new OrganizationBootstrapService({ prisma: app }).bootstrap({
        bootstrapKey: 'settings-other-shop',
        organizationName: 'Settings Other Shop',
        ownerEmail: 'owner-other@example.test',
      }),
    ]);
    mainOrgId = bootstrapped[0]?.organizationId ?? '';
    mainOwnerId = bootstrapped[0]?.userId ?? '';
    otherOrgId = bootstrapped[1]?.organizationId ?? '';
    otherOwnerId = bootstrapped[1]?.userId ?? '';

    // One non-owner cashier whose role grants exactly the two settings
    // permissions of the §22.2 column — no owner-exclusivity, no third grant.
    roleId = randomUUID();
    await withTenantTransaction({ prisma: app }, mainOrgId, async (tx) => {
      await tx.role.create({
        data: {
          id: roleId,
          organizationId: mainOrgId,
          key: 'settings_clerk',
          name: 'Settings Clerk',
          isSystem: false,
          isOwner: false,
        },
      });
      await tx.rolePermission.createMany({
        data: [
          { organizationId: mainOrgId, roleId, permissionId: 'settings.edit' },
          { organizationId: mainOrgId, roleId, permissionId: 'pricing.policy.edit' },
        ],
      });
      await tx.organizationMembership.create({
        data: { organizationId: mainOrgId, userId: otherOwnerId, isOwner: false, roleId },
      });
    });
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

  /** The SQLSTATE behind a failed raw statement (the driver's five-digit code). */
  const sqlStateOf = (error: unknown): string | undefined =>
    error instanceof Error ? (/Code: `(\d{5})`/.exec(error.message)?.[1] ?? undefined) : undefined;

  /** The committed SETTINGS_UPDATED rows tenant `organizationId` writes. */
  function settingsAuditRowCount(organizationId: string): Promise<number> {
    return inTenant(organizationId, (tx) =>
      tx.$queryRaw<
        { n: bigint }[]
      >`SELECT count(*)::bigint AS n FROM audit_events WHERE event_type = 'SETTINGS_UPDATED'`.then((rows) =>
        Number(rows[0]?.n ?? 0),
      ),
    );
  }

  describe('migration 0012 — shape, posture, and the removed columns', () => {
    it('deployed with the committed history and both tables exist', async () => {
      const migrations = await admin.$queryRaw<{ migration_name: string }[]>`
        SELECT migration_name FROM _prisma_migrations WHERE migration_name = '0012_organization_settings' AND finished_at IS NOT NULL`;
      expect(migrations).toHaveLength(1);
    });

    it('carries exactly the §22.2/§22.4 columns the plan names — and neither removed column', async () => {
      const settingsColumns = await admin.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'organization_settings'
         ORDER BY column_name`;
      const names = settingsColumns.map((row) => row.column_name).sort();
      // Every §22.2/§22.4 setting is a typed column; the id and bookkeeping
      // columns ride beside them.
      for (const column of [
        'organization_id',
        'settings_version',
        'currency',
        'minor_unit_exponent',
        'display_numerals',
        'pricing_mode',
        'max_discount_percentage',
        'max_discount_amount_minor',
        'discount_approval_threshold_minor',
        'discount_allowed_for_salesperson',
        'block_discount_below_cost',
        'invoice_output_default',
        'invoice_footer',
        'invoice_show_logo',
        'customer_required_on_credit_sale',
        'rounding_mode',
        'receivables_aging_enabled',
        'offline_grace_duration_seconds',
        'offline_receipt_id_format',
        'offline_reserved_number_blocks',
        'reserved_block_size',
        'updated_at',
      ]) {
        expect(names).toContain(column);
      }
      // The M0-P2 amendment: negative stock is unconditionally forbidden
      // (§38.4) — no coaxed-back column exists. `app_lock_enabled` is
      // §22.2-per-device; M9 owns wherever it lands.
      expect(names).not.toContain('allow_negative_stock');
      expect(names).not.toContain('app_lock_enabled');
      // No untyped escape hatch: a key-value `key`/`value` pair is exactly
      // §22.1's "never a key-value table".
      expect(names).not.toContain('key');
      expect(names).not.toContain('value');

      const flagColumns = await admin.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'organization_feature_flags'
         ORDER BY column_name`;
      expect(flagColumns.map((row) => row.column_name).sort()).toStrictEqual([
        'created_at',
        'enabled',
        'flag_key',
        'organization_id',
      ]);
    });

    it('protects both tables with ENABLE + FORCE RLS and the one symmetric tenant_isolation policy', async () => {
      for (const table of ['organization_settings', 'organization_feature_flags']) {
        const posture = await admin.$queryRaw<{ row_security: boolean; forced: boolean }[]>`
          SELECT relrowsecurity AS row_security, relforcerowsecurity AS forced
            FROM pg_class WHERE relname = ${table}`;
        expect(posture[0]?.row_security).toBe(true);
        expect(posture[0]?.forced).toBe(true);

        const policies = await admin.$queryRaw<{ policy: string }[]>`
          SELECT policyname AS policy FROM pg_policies WHERE tablename = ${table}`;
        expect(policies.map((row) => row['policy'])).toEqual(['tenant_isolation']);
      }
    });

    it('restates the service bounds as database CHECKs against a bypassing writer', async () => {
      // Every probe is a raw UPDATE inside the trusted tenant context on the
      // application role — the accepted-write path minus the service layer.
      // Each value the service layer refuses must also be refused *here*,
      // named by SQLSTATE 23514 (check_violation).
      const violations: readonly { sql: string; params: readonly unknown[] }[] = [
        {
          sql: `UPDATE organization_settings SET settings_version = 0 WHERE organization_id = $1::uuid`,
          params: [mainOrgId],
        },
        {
          sql: `UPDATE organization_settings SET currency = 'USD' WHERE organization_id = $1::uuid`,
          params: [mainOrgId],
        },
        {
          sql: `UPDATE organization_settings SET minor_unit_exponent = -1 WHERE organization_id = $1::uuid`,
          params: [mainOrgId],
        },
        {
          sql: `UPDATE organization_settings SET minor_unit_exponent = 10 WHERE organization_id = $1::uuid`,
          params: [mainOrgId],
        },
        {
          sql: `UPDATE organization_settings SET pricing_mode = 'FREE' WHERE organization_id = $1::uuid`,
          params: [mainOrgId],
        },
        {
          sql: `UPDATE organization_settings SET max_discount_percentage = 100.01 WHERE organization_id = $1::uuid`,
          params: [mainOrgId],
        },
        {
          sql: `UPDATE organization_settings SET max_discount_amount_minor = -1 WHERE organization_id = $1::uuid`,
          params: [mainOrgId],
        },
        {
          sql: `UPDATE organization_settings SET discount_approval_threshold_minor = -5 WHERE organization_id = $1::uuid`,
          params: [mainOrgId],
        },
        {
          sql: `UPDATE organization_settings SET invoice_output_default = 'ALWAYS_PRINT' WHERE organization_id = $1::uuid`,
          params: [mainOrgId],
        },
        {
          sql: `UPDATE organization_settings SET invoice_footer = repeat('x', 2001) WHERE organization_id = $1::uuid`,
          params: [mainOrgId],
        },
        {
          sql: `UPDATE organization_settings SET rounding_mode = 'FLOOR' WHERE organization_id = $1::uuid`,
          params: [mainOrgId],
        },
        {
          sql: `UPDATE organization_settings SET offline_grace_duration_seconds = 0 WHERE organization_id = $1::uuid`,
          params: [mainOrgId],
        },
        {
          sql: `UPDATE organization_settings SET offline_grace_duration_seconds = 2592001 WHERE organization_id = $1::uuid`,
          params: [mainOrgId],
        },
        {
          sql: `UPDATE organization_settings SET offline_receipt_id_format = 'DEV-SEQ' WHERE organization_id = $1::uuid`,
          params: [mainOrgId],
        },
        {
          sql: `UPDATE organization_settings SET reserved_block_size = 0 WHERE organization_id = $1::uuid`,
          params: [mainOrgId],
        },
        {
          sql: `UPDATE organization_settings SET reserved_block_size = 10001 WHERE organization_id = $1::uuid`,
          params: [mainOrgId],
        },
      ];

      for (const violation of violations) {
        const error = await inTenant(mainOrgId, (tx) =>
          tx.$executeRawUnsafe(violation.sql, ...violation.params).catch((caught: unknown) => caught),
        );
        expect(error).toBeInstanceOf(Error);
        expect(sqlStateOf(error)).toBe('23514');
      }

      // The flags table may not invent a key, either by grammar.
      const badKey = await inTenant(mainOrgId, (tx) =>
        tx
          .$executeRawUnsafe(
            `INSERT INTO organization_feature_flags (organization_id, flag_key, enabled) VALUES ($1::uuid, 'lowercase_bad', true)`,
            mainOrgId,
          )
          .catch((caught: unknown) => caught),
      );
      expect(sqlStateOf(badKey)).toBe('23514');
    });
  });

  describe('defaults and materialization (§22.4)', () => {
    it('a freshly bootstrapped organization carries version 1 at every plan default without a flags row', async () => {
      const before = await inTenant(otherOrgId, (tx) =>
        tx.organizationSettings.findUniqueOrThrow({ where: { organizationId: otherOrgId } }),
      );
      expect(before.settingsVersion).toBe(1n);
      expect(before.currency).toBe('EGP');
      expect(before.minorUnitExponent).toBe(2);
      expect(before.displayNumerals).toBe('WESTERN');
      expect(before.pricingMode).toBe('FIXED');
      expect(before.maxDiscountPercentage.toString()).toBe('0');
      expect(before.maxDiscountAmountMinor).toBe(0n);
      expect(before.discountApprovalThresholdMinor).toBeNull();
      expect(before.discountAllowedForSalesperson).toBe(false);
      expect(before.blockDiscountBelowCost).toBe(false);
      expect(before.invoiceOutputDefault).toBe('ALWAYS_ASK');
      expect(before.invoiceFooter).toBe('');
      expect(before.invoiceShowLogo).toBe(true);
      expect(before.customerRequiredOnCreditSale).toBe(true);
      expect(before.roundingMode).toBe('HALF_UP');
      expect(before.receivablesAgingEnabled).toBe(true);
      // O-13: the grace window is exactly 72 hours, in seconds.
      expect(before.offlineGraceDurationSeconds).toBe(259200n);
      expect(before.offlineReceiptIdFormat).toBe('ORG-DEV-SEQ');
      expect(before.offlineReservedNumberBlocks).toBe(false);
      expect(before.reservedBlockSize).toBe(1000);
      const flags = await inTenant(otherOrgId, (tx) => tx.organizationFeatureFlag.findMany());
      expect(flags).toEqual([]);
    });

    it('an organization whose settings row predates the migration materializes it lazily on first read', async () => {
      // Manufacturing the pre-0012 shape needs a principal no tenant can
      // refuse: only the superuser moves a forced-RLS row out of band.
      await admin.$executeRawUnsafe(`DELETE FROM organization_settings WHERE organization_id = $1::uuid`, mainOrgId);

      const view = await settings.get(mainOrgId);
      expect(view.settingsVersion).toBe(1n);
      expect(view.flags).toEqual([]);
      expect(view.organizationName).toBe('Settings Main Shop');

      // The created row persists for the next transaction — idempotent, and
      // never a second row: the primary key is the organization id itself.
      const count = await admin.$queryRaw<{ n: bigint }[]>`
        SELECT count(*)::bigint AS n FROM organization_settings WHERE organization_id = ${mainOrgId}::uuid`;
      expect(Number(count[0]?.n ?? 0)).toBe(1);
    });
  });

  describe('an owner write: accepted, versioned, audited (§22.2, §32.5, D-G)', () => {
    it('advances the version by exactly one and commits the SETTINGS_UPDATED event with the change', async () => {
      const before = await settingsAuditRowCount(mainOrgId);

      const { view, changes } = await settings.update(
        {
          organizationId: mainOrgId,
          actorUserId: mainOwnerId,
          expectedSettingsVersion: 1,
          offered: {
            invoiceFooter: 'Thank you for your purchase',
            maxDiscountAmountMinor: '1500',
            offlineGraceDurationSeconds: 48 * 3600,
          },
        },
        new Date('2026-01-01T00:00:00.000Z'),
      );

      expect(view.settingsVersion).toBe(2n);
      expect(view.invoiceFooter).toBe('Thank you for your purchase');
      expect(view.maxDiscountAmountMinor).toBe('1500');
      expect(view.offlineGraceDurationSeconds).toBe(48n * 3600n);
      expect(changes.map((change) => change.field).sort()).toEqual([
        'invoiceFooter',
        'maxDiscountAmountMinor',
        'offlineGraceDurationSeconds',
      ]);

      // The audit row is exactly one, committed *with* the change it names.
      expect(await settingsAuditRowCount(mainOrgId)).toBe(before + 1);

      const event = await inTenant(mainOrgId, (tx) =>
        tx.auditEvent.findFirstOrThrow({ where: { eventType: 'SETTINGS_UPDATED' }, orderBy: { sequence: 'desc' } }),
      );
      expect(event.actorKind).toBe('USER');
      expect(event.actorUserId).toBe(mainOwnerId);
      expect(event.targetType).toBe('ORGANIZATION_SETTINGS');
      expect(event.targetId).toBe(mainOrgId);
      expect(event.occurredAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
      const payload = event.payload as {
        settingsVersionBefore: string;
        settingsVersionAfter: string;
        changes: { field: string }[];
      };
      expect(payload['settingsVersionBefore']).toBe('1');
      expect(payload['settingsVersionAfter']).toBe('2');

      // §32.5's verifiable consequence: the appended row sits on a gapless
      // committed chain the read-only verifier answers clean.
      const report = await inTenant(mainOrgId, (tx) =>
        verifyAuditStreamScope(tx, { stream: 'AUDIT', scope: mainOrgId }),
      );
      expect(report.defects).toEqual([]);
    });

    it('a stale version token is refused SETTINGS_VERSION_CONFLICT and advances nothing (§38.18)', async () => {
      const stored = await inTenant(mainOrgId, (tx) =>
        tx.organizationSettings.findUniqueOrThrow({ where: { organizationId: mainOrgId } }),
      );
      const before = await settingsAuditRowCount(mainOrgId);

      await expect(
        settings.update({
          organizationId: mainOrgId,
          actorUserId: mainOwnerId,
          expectedSettingsVersion: 1, // stale: the committed version is 2
          offered: { invoiceFooter: 'lost update' },
        }),
      ).rejects.toMatchObject({ code: 'SETTINGS_VERSION_CONFLICT' });

      // No silent overwrite, no phantom bump, no unaudited anything.
      const after = await inTenant(mainOrgId, (tx) =>
        tx.organizationSettings.findUniqueOrThrow({ where: { organizationId: mainOrgId } }),
      );
      expect(after.settingsVersion).toBe(stored.settingsVersion);
      expect(after.invoiceFooter).toBe('Thank you for your purchase');
      expect(await settingsAuditRowCount(mainOrgId)).toBe(before);
    });

    it('a bare version token with no field is not an update — nothing commits', async () => {
      await expect(
        settings.update({
          organizationId: mainOrgId,
          actorUserId: mainOwnerId,
          expectedSettingsVersion: 2,
          offered: {},
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      const stored = await inTenant(mainOrgId, (tx) =>
        tx.organizationSettings.findUniqueOrThrow({ where: { organizationId: mainOrgId } }),
      );
      expect(stored.settingsVersion).toBe(2n);
    });

    it('an equivalent write still bumps the version exactly once and is audited (D-G)', async () => {
      // The stored name is offered back unchanged: §38.18's honesty rule
      // counts the accepted transaction, not the value diff — the version is
      // a staleness fingerprint that moved when a committed change did.
      const { view } = await settings.update({
        organizationId: mainOrgId,
        actorUserId: mainOwnerId,
        expectedSettingsVersion: 2,
        offered: { organizationName: 'Settings Main Shop' }, // identical to stored
      });
      expect(view.settingsVersion).toBe(3n);

      const event = await inTenant(mainOrgId, (tx) =>
        tx.auditEvent.findFirstOrThrow({ where: { eventType: 'SETTINGS_UPDATED' }, orderBy: { sequence: 'desc' } }),
      );
      const payload = event.payload as { changes: unknown[] };
      expect(payload['changes']).toEqual([]);
    });
  });

  describe('field authorization inside the transaction (§22.2, M2-S3 owner policy)', () => {
    it('a non-owner holding exactly the granted permissions writes the merchandising fields and is audited', async () => {
      const before = await settingsAuditRowCount(mainOrgId);

      const { view } = await settings.update({
        organizationId: mainOrgId,
        actorUserId: otherOwnerId,
        expectedSettingsVersion: 3,
        offered: {
          invoiceFooter: 'Clerk-written footer',
          pricingMode: 'FIXED_WITH_DISCOUNT',
          maxDiscountPercentage: 15,
        },
      });
      expect(view.settingsVersion).toBe(4n);
      expect(view.pricingMode).toBe('FIXED_WITH_DISCOUNT');
      expect(view.maxDiscountPercentage).toBe('15');
      expect(await settingsAuditRowCount(mainOrgId)).toBe(before + 1);
    });

    it('an owner-exclusive field is refused to the permission-holding non-owner with no partial write', async () => {
      const stored = await inTenant(mainOrgId, (tx) =>
        tx.organizationSettings.findUniqueOrThrow({ where: { organizationId: mainOrgId } }),
      );
      const before = await settingsAuditRowCount(mainOrgId);

      // The caller holds `settings.edit` — still not enough: the M2-S3 catalog
      // note fixes the enforcement as the settings layer's owner policy.
      await expect(
        settings.update({
          organizationId: mainOrgId,
          actorUserId: otherOwnerId,
          expectedSettingsVersion: 4,
          offered: { roundingMode: 'HALF_EVEN' },
        }),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

      const after = await inTenant(mainOrgId, (tx) =>
        tx.organizationSettings.findUniqueOrThrow({ where: { organizationId: mainOrgId } }),
      );
      expect(after.settingsVersion).toBe(stored.settingsVersion);
      expect(after.roundingMode).toBe('HALF_UP');
      expect(await settingsAuditRowCount(mainOrgId)).toBe(before);
    });

    it('a multi-field offer the caller only half-holds authority for is refused field by field, all-or-nothing', async () => {
      // `invoiceFooter` is within the clerk's grant; `minorUnitExponent` is
      // owner-exclusive. The offer is checked as a whole before any statement,
      // so one unauthorized field refuses the entire update.
      await expect(
        settings.update({
          organizationId: mainOrgId,
          actorUserId: otherOwnerId,
          expectedSettingsVersion: 4,
          offered: { invoiceFooter: 'half-authorized', minorUnitExponent: 4 },
        }),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

      const stored = await inTenant(mainOrgId, (tx) =>
        tx.organizationSettings.findUniqueOrThrow({ where: { organizationId: mainOrgId } }),
      );
      expect(stored.invoiceFooter).toBe('Clerk-written footer');
    });

    it('the unknown-flag refusal is total: no flag row and no version bump', async () => {
      await expect(
        settings.update({
          organizationId: mainOrgId,
          actorUserId: mainOwnerId,
          expectedSettingsVersion: 4,
          offered: { featureFlags: [{ key: 'SEEDED_FLAG_EXAMPLE', enabled: true }] },
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

      expect(await inTenant(mainOrgId, (tx) => tx.organizationFeatureFlag.findMany())).toEqual([]);
    });
  });

  describe('writer serialization (§38.18 optimistic token + the advisory lock)', () => {
    it('two racing writers on the same version commit exactly one, the loser answered the conflict, not an overwrite', async () => {
      const outcomes = await Promise.allSettled([
        settings.update({
          organizationId: mainOrgId,
          actorUserId: mainOwnerId,
          expectedSettingsVersion: 4,
          offered: { invoiceFooter: 'racing footer A' },
        }),
        settings.update({
          organizationId: mainOrgId,
          actorUserId: mainOwnerId,
          expectedSettingsVersion: 4,
          offered: { invoiceFooter: 'racing footer B' },
        }),
      ]);

      const committed = outcomes.filter((outcome) => outcome.status === 'fulfilled');
      const conflicted = outcomes.filter((outcome) => outcome.status === 'rejected');

      // Exactly one transaction may win; the loser's answer is the version
      // conflict, never a silent after-the-fact overwrite.
      expect(committed).toHaveLength(1);
      expect(conflicted).toHaveLength(1);
      await expect(
        Promise.resolve(conflicted[0] as PromiseRejectedResult).then((result) => {
          throw result.reason;
        }),
      ).rejects.toMatchObject({ code: 'SETTINGS_VERSION_CONFLICT' });

      // The winner advanced the version by exactly one more than the loser
      // saw — the loser now refetches, and no update ever silently persists.
      const stored = await inTenant(mainOrgId, (tx) =>
        tx.organizationSettings.findUniqueOrThrow({ where: { organizationId: mainOrgId } }),
      );
      expect(stored.settingsVersion).toBe(5n);
      expect(['racing footer A', 'racing footer B']).toContain(stored.invoiceFooter);
    });
  });
});
