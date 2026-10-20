/**
 * The pricing-policy service (Master Plan §17.4, §22.3, §38.19; §40.7 row
 * M3-S2).
 *
 * The transactional enforcement boundary the future sale posting (M5) and the
 * offline mutation applier invoke **inside their own transactions**. Three
 * structural rules, inherited from the accepted slices:
 *
 * 1. **Tenant scope is server-derived.** Every decision runs inside the
 *    caller's trusted tenant transaction (§8.2 `withTenantTransaction`), with
 *    the organization id the authorization guard (or the sync ingress)
 *    matched against the verified identity. A request body never names a
 *    tenant (§9.3); the settings and permission rows are forced-RLS tenant
 *    tables, so a foreign-context read refuses at the database before this
 *    service counts a row.
 * 2. **Policy and authorization are one moment.** The live `organization_settings`
 *    row (§22.3: never cached as authority) and the actor's §11 effective
 *    permissions are read **inside the same transaction the caller's effect
 *    will commit in** — the M2-S4 `readEffectiveInTransaction` seam — so the
 *    decision cannot observe a world its transaction did not. The decision
 *    result records the `settings_version` it decided under: the honest
 *    staleness fingerprint §38.18/§38.19 reconcile against.
 * 3. **The boundary decides; it does not write.** No sale line is written
 *    here (M5 owns the sale tables), and no audit row is appended here — the
 *    sale's own class-A audit (§32.5) carries the snapshot the decision
 *    permitted, with its flags. The boundary's refusals throw, rolling the
 *    caller's transaction back before anything was written.
 *
 * The `unitPriceListMinor` and `unitCostAppliedMinor` inputs are
 * **server-resolved** facts by contract (M4's catalog and M4-S3's costing
 * engine resolve them inside the posting transaction); the applied price is
 * the client hint §17.4 re-proves here. This slice adds no HTTP route and no
 * sale surface — §40.7's non-scope — so the contract tests (the db-spec
 * acceptance suite) demonstrate the exact invocation the M5 entry points must
 * make, and the slice record documents the deferred integration.
 */

import type { Prisma } from '@prisma/client';
import type { Logger as PinoLogger } from 'pino';

import { DomainError } from '../errors/domain.error';
import { ERROR_CODES } from '../errors/problem';
import { DECIMAL_MINORS_WIRE_PATTERN } from '../settings/settings.domain';
import { ROUNDING_MODE_VALUES, type RoundingModeValue } from '../settings/settings.contract';
import type { AuthorizationService, EffectiveAuthorization } from '../tenancy/authorization/authorization.service';
import type { SettingsService, SettingsView } from '../settings/settings.service';
import {
  DISCOUNT_PERCENTAGE_WIRE_PATTERN,
  PERCENTAGE_SCALED_MAX,
  PERCENTAGE_SCALE,
  PRICING_MODE_VALUES,
  PRICING_POLICY_CONTRACT_VERSION,
  type DiscountLineDecision,
  type DiscountPolicyFacts,
  type PricingFlagValue,
  type PricingModeValue,
  type SaleLinePriceOffer,
} from './pricing.contract';
import { evaluateSaleLinePricing, reconcileOfflineSaleLinePricing } from './pricing.domain';

type Tx = Prisma.TransactionClient;

/** One evaluated line: the snapshot values, the flags that ride them, and the decision's policy moment. */
export interface SaleLinePricingEvaluation {
  readonly unitPriceListMinor: bigint;
  readonly unitPriceAppliedMinor: bigint;
  readonly flags: readonly PricingFlagValue[];
  /** The `settings_version` the line's decision was made under (§38.18's fingerprint). */
  readonly settingsVersion: bigint;
  /** The pricing mode the line's decision was made under. */
  readonly pricingMode: string;
  /** The §18 discount decision facts, present exactly when the line carried a discount offer. */
  readonly discount?: DiscountLineDecision;
}

/** The answer to one online evaluation call (§17.4). */
export interface PricingEvaluationResult {
  readonly contractVersion: number;
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly pricingMode: string;
  readonly settingsVersion: bigint;
  readonly lines: readonly SaleLinePricingEvaluation[];
}

/** The answer to one §38.19 reconciliation call on sync. */
export interface PricingReconciliationResult {
  readonly contractVersion: number;
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly pricingMode: string;
  readonly settingsVersion: bigint;
  readonly lines: readonly SaleLinePricingEvaluation[];
  /** How many lines carried `PRICING_POLICY_DRIFT` — the owner-visible exception count. */
  readonly driftLineCount: number;
}

/** One pricing evaluation request, already tenant-scoped by the caller's transaction. */
export interface PricingLinesInput {
  readonly organizationId: string;
  /** The verified actor (§32.6 attribution) — never a payload field. */
  readonly actorUserId: string;
  readonly lines: readonly SaleLinePriceOffer[];
}

export class PricingPolicyService {
  constructor(
    /** The M2-S3/M2-S4 resolver whose in-transaction read is the one §11 permission source. */
    private readonly authorization: AuthorizationService,
    /** The M3-S1 typed settings, read live inside the caller's transaction (§22.3). */
    private readonly settings: SettingsService,
    private readonly logger?: PinoLogger,
  ) {}

  /**
   * Evaluates sale lines against the live pricing policy and the actor's
   * effective permissions, inside the caller's transaction. Any refused line
   * throws — `PRICE_OVERRIDE_FORBIDDEN`, `DISCOUNT_LIMIT_EXCEEDED`,
   * `DISCOUNT_FORBIDDEN`, `DISCOUNT_APPROVAL_REQUIRED`, `PERMISSION_DENIED`,
   * `VALIDATION_FAILED`, or `INTERNAL_ERROR` — so the caller's transaction
   * rolls back before a line is written. A line the decision approved above
   * the §18.2 threshold carries the server-minted authorization reference
   * (§18.3).
   */
  async evaluateSaleLinesInTransaction(tx: Tx, input: PricingLinesInput): Promise<PricingEvaluationResult> {
    const { pricingMode, settingsVersion, effective, discountPolicy } = await this.readPolicyFacts(tx, input);
    const lines = input.lines.map((line) => {
      const outcome = evaluateSaleLinePricing(
        {
          pricingMode,
          permissions: effective.permissions,
          discount: discountPolicy,
          actorRoleKey: effective.role?.key ?? null,
          deniedPermissions: effective.deniedPermissionIds,
        },
        line,
      );
      return {
        unitPriceListMinor: outcome.unitPriceListMinor,
        unitPriceAppliedMinor: outcome.unitPriceAppliedMinor,
        flags: outcome.flags,
        settingsVersion,
        pricingMode,
        ...(outcome.discount === undefined
          ? {}
          : { discount: this.withMintedApprovalRef(outcome.discount, input, effective, settingsVersion) }),
      };
    });
    return {
      contractVersion: PRICING_POLICY_CONTRACT_VERSION,
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      pricingMode,
      settingsVersion,
      lines,
    };
  }

  /**
   * Reconciles offline-recorded sale lines against the *then-current* policy
   * on sync (§38.19): never refuses for drift, flags `PRICING_POLICY_DRIFT`
   * where the current policy would not have permitted the recorded price, and
   * reports the drift count for the owner-visible exception surface.
   */
  async reconcileOfflineSaleLinesInTransaction(tx: Tx, input: PricingLinesInput): Promise<PricingReconciliationResult> {
    const { pricingMode, settingsVersion, effective, discountPolicy } = await this.readPolicyFacts(tx, input);
    const lines = input.lines.map((line) => {
      const outcome = reconcileOfflineSaleLinePricing(
        {
          pricingMode,
          permissions: effective.permissions,
          discount: discountPolicy,
          actorRoleKey: effective.role?.key ?? null,
          deniedPermissions: effective.deniedPermissionIds,
        },
        line,
      );
      return {
        unitPriceListMinor: outcome.unitPriceListMinor,
        unitPriceAppliedMinor: outcome.unitPriceAppliedMinor,
        flags: outcome.flags,
        settingsVersion,
        pricingMode,
        // The re-validation's discount facts; the recorded actor and
        // authorization reference ride the mutation payload (§32.2A) and M5
        // stamps them on the persisted line — no reference is re-minted here.
        ...(outcome.discount === undefined ? {} : { discount: outcome.discount }),
      };
    });
    const result: PricingReconciliationResult = {
      contractVersion: PRICING_POLICY_CONTRACT_VERSION,
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      pricingMode,
      settingsVersion,
      lines,
      driftLineCount: lines.filter((line) => line.flags.includes('PRICING_POLICY_DRIFT')).length,
    };
    if (result.driftLineCount > 0) {
      // §38.19: the exception is surfaced, never silently voided. The log line
      // is the server-side trace of exactly that surface; the owner-visible
      // report rides the flags the applier persists with the line (§33.2).
      this.logger?.info(
        {
          component: 'pricing',
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          settingsVersion: settingsVersion.toString(),
          driftLineCount: result.driftLineCount,
        },
        'offline sale lines carried pricing-policy drift; accepted and flagged for the owner',
      );
    }
    return result;
  }

  /**
   * The two facts every decision needs, read inside the caller's transaction:
   * the live typed settings row and the actor's effective authorization. Both
   * refusals are the caller's to see — a missing membership resolves to
   * `ORGANIZATION_FORBIDDEN`, an RLS-refused foreign read fails closed — and
   * neither reads from a cache (§22.3). The settings row's discount columns
   * are parsed into the exact §18.2 policy facts here, once, failing closed
   * on any stored value this server cannot read.
   */
  private async readPolicyFacts(
    tx: Tx,
    input: PricingLinesInput,
  ): Promise<{
    pricingMode: PricingModeValue;
    settingsVersion: bigint;
    effective: EffectiveAuthorization;
    discountPolicy: DiscountPolicyFacts;
  }> {
    if (input.lines.length === 0) {
      throw new DomainError(ERROR_CODES.VALIDATION_FAILED, 'the evaluation carries no sale line', [
        { field: 'lines', messages: ['the evaluation carries no sale line'] },
      ]);
    }
    const view = await this.settings.readInTransaction(tx, input.organizationId);
    const storedMode = view.pricingMode;
    // The typed column's CHECK admits exactly the §17 modes; a value outside
    // them would be database corruption, refused here before a decision could
    // be guessed from it.
    if (!PRICING_MODE_VALUES.includes(storedMode as PricingModeValue)) {
      throw new DomainError(ERROR_CODES.INTERNAL_ERROR, `the stored pricing mode is not a mode this server knows`);
    }
    const effective = await this.authorization.readEffectiveInTransaction(tx, input.organizationId, input.actorUserId);
    return {
      pricingMode: storedMode as PricingModeValue,
      settingsVersion: view.settingsVersion,
      effective,
      discountPolicy: this.discountPolicyFromView(view),
    };
  }

  /**
   * The §18.2 policy, exact: the stored decimal(5,2) percentage parses into
   * the same ×100 integer space the offered percentage uses, the stored
   * minor-unit strings parse through the shared wire grammar, and every
   * unknown or unreadable stored value refuses `INTERNAL_ERROR` — never a
   * guessed default (the M3-S2 fail-closed posture, extended to the discount
   * columns).
   */
  private discountPolicyFromView(view: SettingsViewShape): DiscountPolicyFacts {
    const roundingMode = view.roundingMode;
    if (!ROUNDING_MODE_VALUES.includes(roundingMode as RoundingModeValue)) {
      throw new DomainError(ERROR_CODES.INTERNAL_ERROR, 'the stored rounding mode is not a mode this server knows');
    }
    const percentageText = view.maxDiscountPercentage;
    if (!DISCOUNT_PERCENTAGE_WIRE_PATTERN.test(percentageText)) {
      throw new DomainError(
        ERROR_CODES.INTERNAL_ERROR,
        'the stored maximum discount percentage is not a readable percentage',
      );
    }
    // Exact scale to hundredths of a percent, whatever the stored decimal's
    // textual scale is ("12.5" and "12.50" are the same 1250).
    const dot = percentageText.indexOf('.');
    const maxDiscountPercentageScaled =
      dot === -1
        ? BigInt(percentageText) * PERCENTAGE_SCALE
        : BigInt(percentageText.slice(0, dot)) * PERCENTAGE_SCALE +
          BigInt(percentageText.slice(dot + 1).padEnd(2, '0'));
    if (maxDiscountPercentageScaled > PERCENTAGE_SCALED_MAX) {
      throw new DomainError(
        ERROR_CODES.INTERNAL_ERROR,
        'the stored maximum discount percentage is outside the 0–100 range',
      );
    }
    const maxDiscountAmountMinor = this.parseStoredMinors('maxDiscountAmountMinor', view.maxDiscountAmountMinor);
    const threshold = view.discountApprovalThresholdMinor;
    return {
      maxDiscountPercentageScaled,
      maxDiscountAmountMinor,
      discountApprovalThresholdMinor:
        threshold === null ? null : this.parseStoredMinors('discountApprovalThresholdMinor', threshold),
      discountAllowedForSalesperson: view.discountAllowedForSalesperson,
      blockDiscountBelowCost: view.blockDiscountBelowCost,
      roundingMode: roundingMode as RoundingModeValue,
    };
  }

  /** A stored minor-unit string through the shared wire grammar, digits only, fail closed. */
  private parseStoredMinors(field: string, text: string): bigint {
    if (!DECIMAL_MINORS_WIRE_PATTERN.test(text)) {
      throw new DomainError(ERROR_CODES.INTERNAL_ERROR, `the stored ${field} is not a readable minor-unit amount`);
    }
    return BigInt(text);
  }

  /**
   * The §18.3/§32.2 approval reference, minted by the server from
   * authenticated facts when an above-threshold discount was decided by an
   * actor holding `pricing.discount.approve`: the organization, the approver
   * the trusted context resolved, and the settings and permissions versions
   * of the exact authorization moment. Attribution, not a credential — its
   * content is provable from the audit and permission state, and no client
   * ever supplies it.
   */
  private withMintedApprovalRef(
    decision: DiscountLineDecision,
    input: PricingLinesInput,
    effective: EffectiveAuthorization,
    settingsVersion: bigint,
  ): DiscountLineDecision {
    if (!decision.approved) {
      return decision;
    }
    return {
      ...decision,
      authorizationRef: [
        'disc-appr',
        `org=${input.organizationId}`,
        `approver=${input.actorUserId}`,
        `settings=${settingsVersion.toString()}`,
        `permissions=${effective.permissionsVersion.toString()}`,
      ].join(':'),
    };
  }
}

/** The settings view's read shape, narrowed to the fields the policy facts need. */
type SettingsViewShape = Pick<
  SettingsView,
  | 'maxDiscountPercentage'
  | 'maxDiscountAmountMinor'
  | 'discountApprovalThresholdMinor'
  | 'discountAllowedForSalesperson'
  | 'blockDiscountBelowCost'
  | 'roundingMode'
>;
