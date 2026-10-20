/**
 * The settings service (Master Plan §22, §22.4, §38.18; §40.7 row M3-S1).
 *
 * Three structural rules shape every path:
 *
 * 1. **Tenant scope is server-derived.** Every read and write runs inside the
 *    trusted tenant transaction (§8.2 `withTenantTransaction`) with the route
 *    organization id the authorization guard matched against the token's
 *    membership claim. A request body never names a tenant (§9.3). The two
 *    settings tables are forced-RLS tenant tables, so the database refuses a
 *    context-free or foreign-context statement before the service counts a
 *    row.
 * 2. **Authorization is a field property, decided inside the transaction.**
 *    §22.2's permission column is enforced per provided field through the
 *    M2-S4 `readEffectiveInTransaction` (role grants, then overrides, then
 *    owner structure — the same resolution every read path uses, so this
 *    layer and the guard cannot disagree), *in the same transaction that will
 *    commit the change* (M2-S4 §9.4). A caller who only half-holds authority
 *    is refused `PERMISSION_DENIED` before any change is written: no partial
 *    write, no version bump, no audit row.
 * 3. **The change, its version, and its audit event are one transaction.**
 *    §32.5's class-A law: the protected updates and the `SETTINGS_UPDATED`
 *    audit row commit or roll back together. A refused, conflicting, or
 *    failed write never advances `settings_version` (§38.18): the version is
 *    therefore an honest staleness fingerprint that moved exactly when a
 *    committed change did.
 *
 * The version check is the §38.18 optimistic-concurrency token: the request
 * carries the version its caller read base on; a mismatch answers
 * `409 SETTINGS_VERSION_CONFLICT` rather than performing a silent lost
 * update. Writers serialize on a per-organization advisory transaction lock,
 * and the row's own update is the second serialization point.
 */

import type { Prisma } from '@prisma/client';
import type { Logger as PinoLogger } from 'pino';

import { DomainError } from '../errors/domain.error';
import { ERROR_CODES } from '../errors/problem';
import { withTenantTransaction } from '../database/tenant-context';
import type { PrismaHost } from '../identity/prisma-host';
import type { AuthorizationService } from '../tenancy/authorization/authorization.service';
import type { AuditStreamWriter } from '../audit/audit-stream-writer';
import { FIRST_SETTINGS_VERSION } from './settings.contract';
import type { CommittedSettingsOffer } from './settings.domain';
import {
  assertFieldGate,
  canonicalizeFeatureFlags,
  canonicalizeUpdateOffer,
  classifyChanges,
  parseGraceDurationSeconds,
  parseMinors,
  parseMinorsOrNull,
  type EffectiveChange,
  type SettingsUpdateOffer,
} from './settings.domain';

/** The audit event one accepted settings write appends (§22.2's consequence). */
export const SETTINGS_UPDATED_EVENT_TYPE = 'SETTINGS_UPDATED';

/** The target type the settings audit rows carry (§32.2). */
export const SETTINGS_TARGET_TYPE = 'ORGANIZATION_SETTINGS';

/** The settings state as the wire contract answers it. */
export interface SettingsView {
  readonly organizationId: string;
  readonly settingsVersion: bigint;
  readonly organizationName: string;
  readonly currency: string;
  readonly minorUnitExponent: number;
  readonly displayNumerals: string;
  readonly pricingMode: string;
  readonly maxDiscountPercentage: string;
  readonly maxDiscountAmountMinor: string;
  readonly discountApprovalThresholdMinor: string | null;
  readonly discountAllowedForSalesperson: boolean;
  readonly blockDiscountBelowCost: boolean;
  readonly invoiceOutputDefault: string;
  readonly invoiceFooter: string;
  readonly invoiceShowLogo: boolean;
  readonly customerRequiredOnCreditSale: boolean;
  readonly roundingMode: string;
  readonly receivablesAgingEnabled: boolean;
  readonly offlineGraceDurationSeconds: bigint;
  readonly offlineReceiptIdFormat: string;
  readonly offlineReservedNumberBlocks: boolean;
  readonly reservedBlockSize: number;
  /** The §22.2 typed flag rows, in catalog-agnostic deterministic order. */
  readonly flags: readonly { readonly key: string; readonly enabled: boolean }[];
  readonly updatedAt: Date;
}

/** One update attempt, already shape-proven by the wire layer. */
export interface SettingsUpdateInput {
  readonly organizationId: string;
  /** The verified principal's user id — the §32.6 attribution, never a body field. */
  readonly actorUserId: string;
  readonly expectedSettingsVersion: number;
  readonly offered: SettingsUpdateOffer;
}

/** The one write attempt's answer. */
export interface SettingsUpdateResult {
  readonly view: SettingsView;
  readonly changes: readonly EffectiveChange[];
}

type Tx = Prisma.TransactionClient;

/** A settings row exactly as the service reads it (the Prisma payload plus its flags). */
interface StoredSettingsRow {
  readonly organizationId: string;
  readonly settingsVersion: bigint;
  readonly currency: string;
  readonly minorUnitExponent: number;
  readonly displayNumerals: string;
  readonly pricingMode: string;
  readonly maxDiscountPercentage: Prisma.Decimal;
  readonly maxDiscountAmountMinor: bigint;
  readonly discountApprovalThresholdMinor: bigint | null;
  readonly discountAllowedForSalesperson: boolean;
  readonly blockDiscountBelowCost: boolean;
  readonly invoiceOutputDefault: string;
  readonly invoiceFooter: string;
  readonly invoiceShowLogo: boolean;
  readonly customerRequiredOnCreditSale: boolean;
  readonly roundingMode: string;
  readonly receivablesAgingEnabled: boolean;
  readonly offlineGraceDurationSeconds: bigint;
  readonly offlineReceiptIdFormat: string;
  readonly offlineReservedNumberBlocks: boolean;
  readonly reservedBlockSize: number;
  readonly updatedAt: Date;
  readonly flags?: readonly { readonly flagKey: string; readonly enabled: boolean }[];
}

export class SettingsService {
  constructor(
    /** The database host the service depends on: the connected client, read at call time. */
    private readonly host: PrismaHost,
    /** The M2-S3/M2-S4 resolver whose in-transaction read enforces the §22.2 permission column. */
    private readonly authorization: AuthorizationService,
    /** The §32.5 class-A transactional audit writer; always wired in production. */
    private readonly audit?: AuditStreamWriter,
    private readonly logger?: PinoLogger,
  ) {}

  /**
   * Reads the organization's settings (`settings.view` is the guard's
   * decision, before this method runs). An organization that has never had a
   * settings row materializes its default row (version 1) lazily inside the
   * same tenant transaction — upgrade compatibility for an organization that
   * predates migration `0012`, never silent absence: a caller reading settings
   * always receives a complete, versioned answer (§38.18's safe-fallback
   * posture read from the server side).
   */
  async get(organizationId: string): Promise<SettingsView> {
    return withTenantTransaction(this.host, organizationId, async (tx) => this.readInTransaction(tx, organizationId));
  }

  /**
   * Reads the settings **inside a transaction the caller already owns** (M3-S2,
   * §22.3's "the server reads them from the database on every transaction that
   * depends on them"). A pricing decision, a future sale posting, or a sync
   * ingress re-validation must see the settings exactly as its transaction
   * will commit them — not through a second transaction's snapshot, and never
   * through a cache (§22.3). Same materialization rule as `get`: an
   * organization without a row receives its version-1 defaults inside this
   * transaction, never a missing answer.
   */
  async readInTransaction(tx: Tx, organizationId: string): Promise<SettingsView> {
    const { row, organizationName } = await this.ensureSettingsRow(tx, organizationId);
    return this.toView(row, organizationName);
  }

  /**
   * Applies a field-authorized, version-checked settings update in one
   * transaction: the §22.2 permission column per provided field, the §38.18
   * optimistic version token, the typed-column updates (name through the
   * tenancy seam), the version increment, the typed flag rows, and the
   * class-A `SETTINGS_UPDATED` audit row — all or nothing.
   */
  async update(input: SettingsUpdateInput, now: Date = new Date()): Promise<SettingsUpdateResult> {
    // The domain half proves every offered value before any connection work:
    // a refused offer costs nothing and can never half-apply (§8.3).
    const offer = canonicalizeUpdateOffer(input.offered);

    // At least one settings field must be offered. A bare version token is
    // not an update, so it cannot commit anything — not even a version bump.
    const offeredFields = Object.keys(offer).filter((field) => (offer as Record<string, unknown>)[field] !== undefined);
    if (offeredFields.length === 0) {
      throw new DomainError(ERROR_CODES.VALIDATION_FAILED, 'the update carries no settings field');
    }

    return withTenantTransaction(this.host, input.organizationId, async (tx) => {
      // Serialize the organization's settings writers before the row is
      // even looked up: the advisory lock is transaction-scoped, so racing
      // writers commit one after the other and the version check below
      // classifies the loser instead of letting a lost update win.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`settings:org:${input.organizationId}`}, 0))`;

      const { row, organizationName: storedName } = await this.ensureSettingsRow(tx, input.organizationId);

      // §38.18: the caller's fingerprint must still be the stored one. The
      // version read and the write share the transaction, so a competing
      // committed write is seen as a conflict by whichever request arrives
      // second — never a silent overwrite in either direction.
      if (row.settingsVersion !== BigInt(input.expectedSettingsVersion)) {
        throw new DomainError(
          ERROR_CODES.SETTINGS_VERSION_CONFLICT,
          'the settings changed since the version this request was based on; refetch and retry',
        );
      }

      // The §22.2 permission column, resolved inside the transaction that
      // will commit the change. A refusal throws, and the throw rolls the
      // transaction back before it wrote anything.
      const effective = await this.authorization.readEffectiveInTransaction(
        tx,
        input.organizationId,
        input.actorUserId,
      );
      for (const field of offeredFields) {
        assertFieldGate(field, { isOwner: effective.isOwner, permissions: effective.permissions });
      }

      // The wire's decimal-string money and duration become bigints here;
      // the unknown-flag refusal happens for a non-owner caller in the gate
      // and for everyone in the canonicalization below.
      const {
        maxDiscountAmountMinor,
        discountApprovalThresholdMinor,
        offlineGraceDurationSeconds,
        featureFlags,
        ...textFields
      } = offer;
      const committed: CommittedSettingsOffer = {
        ...textFields,
        ...(maxDiscountAmountMinor === undefined
          ? {}
          : { maxDiscountAmountMinor: parseMinors('maxDiscountAmountMinor', maxDiscountAmountMinor) }),
        ...(discountApprovalThresholdMinor === undefined
          ? {}
          : {
              discountApprovalThresholdMinor: parseMinorsOrNull(
                'discountApprovalThresholdMinor',
                discountApprovalThresholdMinor,
              ),
            }),
        ...(offlineGraceDurationSeconds === undefined
          ? {}
          : {
              offlineGraceDurationSeconds: parseGraceDurationSeconds(
                'offlineGraceDurationSeconds',
                offlineGraceDurationSeconds,
              ),
            }),
        ...(featureFlags === undefined ? {} : { featureFlags: canonicalizeFeatureFlags(featureFlags) }),
      };

      const changes = classifyChanges(committed, this.toStoredShape(storedName, row));

      // The write: every typed column its offer carries, the version
      // increment, the tenancy seam for the organization name, and the audit
      // row — one transaction (the §32.5 class-A law; a throw below rolls
      // them all back together, leaving the head and the version exactly as
      // they were).
      const nextVersion = row.settingsVersion + 1n;
      const flags = committed.featureFlags;

      const updated = (await tx.organizationSettings.update({
        where: { organizationId: input.organizationId },
        data: {
          ...(committed.currency === undefined ? {} : { currency: committed.currency }),
          ...(committed.displayNumerals === undefined ? {} : { displayNumerals: committed.displayNumerals }),
          ...(committed.pricingMode === undefined ? {} : { pricingMode: committed.pricingMode }),
          ...(committed.invoiceOutputDefault === undefined
            ? {}
            : { invoiceOutputDefault: committed.invoiceOutputDefault }),
          ...(committed.roundingMode === undefined ? {} : { roundingMode: committed.roundingMode }),
          ...(committed.offlineReceiptIdFormat === undefined
            ? {}
            : { offlineReceiptIdFormat: committed.offlineReceiptIdFormat }),
          ...(committed.invoiceFooter === undefined ? {} : { invoiceFooter: committed.invoiceFooter }),
          ...(committed.minorUnitExponent === undefined ? {} : { minorUnitExponent: committed.minorUnitExponent }),
          ...(committed.reservedBlockSize === undefined ? {} : { reservedBlockSize: committed.reservedBlockSize }),
          ...(committed.maxDiscountPercentage === undefined
            ? {}
            : { maxDiscountPercentage: committed.maxDiscountPercentage }),
          ...(committed.maxDiscountAmountMinor === undefined
            ? {}
            : { maxDiscountAmountMinor: committed.maxDiscountAmountMinor }),
          ...(committed.discountApprovalThresholdMinor === undefined
            ? {}
            : { discountApprovalThresholdMinor: committed.discountApprovalThresholdMinor }),
          ...(committed.discountAllowedForSalesperson === undefined
            ? {}
            : { discountAllowedForSalesperson: committed.discountAllowedForSalesperson }),
          ...(committed.blockDiscountBelowCost === undefined
            ? {}
            : { blockDiscountBelowCost: committed.blockDiscountBelowCost }),
          ...(committed.invoiceShowLogo === undefined ? {} : { invoiceShowLogo: committed.invoiceShowLogo }),
          ...(committed.customerRequiredOnCreditSale === undefined
            ? {}
            : { customerRequiredOnCreditSale: committed.customerRequiredOnCreditSale }),
          ...(committed.receivablesAgingEnabled === undefined
            ? {}
            : { receivablesAgingEnabled: committed.receivablesAgingEnabled }),
          ...(committed.offlineGraceDurationSeconds === undefined
            ? {}
            : { offlineGraceDurationSeconds: committed.offlineGraceDurationSeconds }),
          ...(committed.offlineReservedNumberBlocks === undefined
            ? {}
            : { offlineReservedNumberBlocks: committed.offlineReservedNumberBlocks }),
          ...(flags === undefined
            ? {}
            : {
                flags: {
                  upsert: flags.map((flag) => ({
                    where: { organizationId_flagKey: { organizationId: input.organizationId, flagKey: flag.key } },
                    create: { organizationId: input.organizationId, flagKey: flag.key, enabled: flag.enabled },
                    update: { enabled: flag.enabled },
                  })),
                },
              }),
          settingsVersion: nextVersion,
          updatedAt: now,
        },
        include: { flags: true },
      })) as StoredSettingsRow;

      if (committed.organizationName !== undefined) {
        // The tenant root's name is the single source of truth (§9.2); the
        // settings surface composes with it inside the same transaction
        // rather than duplicating a second name column. The row is in this
        // transaction's tenant scope (RLS-scoped read at row load), so the
        // update names exactly the verified organization.
        await tx.organization.update({
          where: { id: input.organizationId },
          data: { name: committed.organizationName },
        });
      }

      if (this.audit !== undefined) {
        await this.audit.appendAuditEvent(tx, {
          eventType: SETTINGS_UPDATED_EVENT_TYPE,
          organizationId: input.organizationId,
          actor: { kind: 'USER', userId: input.actorUserId },
          occurredAt: now,
          targetType: SETTINGS_TARGET_TYPE,
          targetId: input.organizationId,
          documentRef: `organization-settings:${input.organizationId}`,
          payload: {
            settingsVersionBefore: row.settingsVersion.toString(),
            settingsVersionAfter: nextVersion.toString(),
            changes: changes.map((change) => ({ ...change })),
          },
        });
      }

      const finalName = committed.organizationName ?? storedName;
      const view = this.toView(updated, finalName);
      this.logger?.info(
        {
          component: 'settings',
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          settingsVersionAfter: nextVersion.toString(),
          changedFields: changes.map((change) => change.field),
        },
        "the organization's typed settings changed; the audit event committed with them",
      );
      return { view, changes };
    });
  }

  /**
   * Materializes the settings row when an organization has none yet (an
   * organization created before migration `0012`, or whose bootstrap
   * preceded the default-row step). Insert-only and idempotent — a racing
   * writer's row is the same default either way, and the caller's
   * transaction supplies the tenant context the row's WITH CHECK requires
   * (§8.2). The flags table's default state is the plan's: zero rows.
   */
  private async ensureSettingsRow(tx: Tx, organizationId: string) {
    const existing = await tx.organizationSettings.findUnique({
      where: { organizationId },
      include: { flags: true },
    });
    if (existing !== null) {
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { name: true },
      });
      return { row: existing as StoredSettingsRow, organizationName: organization.name };
    }
    const created = (await tx.organizationSettings.create({
      data: { organizationId, settingsVersion: FIRST_SETTINGS_VERSION },
      include: { flags: true },
    })) as StoredSettingsRow;
    const organization = await tx.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true },
    });
    return { row: created, organizationName: organization.name };
  }

  /** The row as the classifier reads it: values only, no ids, no version, no timestamps. */
  private toStoredShape(organizationName: string, row: StoredSettingsRow) {
    return {
      organizationName,
      currency: row.currency,
      minorUnitExponent: row.minorUnitExponent,
      displayNumerals: row.displayNumerals,
      pricingMode: row.pricingMode,
      maxDiscountPercentage: row.maxDiscountPercentage.toString(),
      maxDiscountAmountMinor: row.maxDiscountAmountMinor.toString(),
      discountApprovalThresholdMinor:
        row.discountApprovalThresholdMinor === null ? null : row.discountApprovalThresholdMinor.toString(),
      discountAllowedForSalesperson: row.discountAllowedForSalesperson,
      blockDiscountBelowCost: row.blockDiscountBelowCost,
      invoiceOutputDefault: row.invoiceOutputDefault,
      invoiceFooter: row.invoiceFooter,
      invoiceShowLogo: row.invoiceShowLogo,
      customerRequiredOnCreditSale: row.customerRequiredOnCreditSale,
      roundingMode: row.roundingMode,
      receivablesAgingEnabled: row.receivablesAgingEnabled,
      offlineGraceDurationSeconds: row.offlineGraceDurationSeconds.toString(),
      offlineReceiptIdFormat: row.offlineReceiptIdFormat,
      offlineReservedNumberBlocks: row.offlineReservedNumberBlocks,
      reservedBlockSize: row.reservedBlockSize,
      flags: (row.flags ?? []).map((flag) => ({ key: flag.flagKey, enabled: flag.enabled })),
    };
  }

  /** The wire-facing projection: decimal strings for 64-bit money, native numbers for bounded integers. */
  private toView(row: StoredSettingsRow, organizationName: string): SettingsView {
    return {
      organizationId: row.organizationId,
      settingsVersion: row.settingsVersion,
      organizationName,
      currency: row.currency,
      minorUnitExponent: row.minorUnitExponent,
      displayNumerals: row.displayNumerals,
      pricingMode: row.pricingMode,
      maxDiscountPercentage: row.maxDiscountPercentage.toString(),
      maxDiscountAmountMinor: row.maxDiscountAmountMinor.toString(),
      discountApprovalThresholdMinor:
        row.discountApprovalThresholdMinor === null ? null : row.discountApprovalThresholdMinor.toString(),
      discountAllowedForSalesperson: row.discountAllowedForSalesperson,
      blockDiscountBelowCost: row.blockDiscountBelowCost,
      invoiceOutputDefault: row.invoiceOutputDefault,
      invoiceFooter: row.invoiceFooter,
      invoiceShowLogo: row.invoiceShowLogo,
      customerRequiredOnCreditSale: row.customerRequiredOnCreditSale,
      roundingMode: row.roundingMode,
      receivablesAgingEnabled: row.receivablesAgingEnabled,
      offlineGraceDurationSeconds: row.offlineGraceDurationSeconds,
      offlineReceiptIdFormat: row.offlineReceiptIdFormat,
      offlineReservedNumberBlocks: row.offlineReservedNumberBlocks,
      reservedBlockSize: row.reservedBlockSize,
      flags: [...(row.flags ?? [])]
        .map((flag) => ({ key: flag.flagKey, enabled: flag.enabled }))
        .sort((a, b) => a.key.localeCompare(b.key)),
      updatedAt: row.updatedAt,
    };
  }
}
