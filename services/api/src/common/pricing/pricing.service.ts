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
import type { AuthorizationService } from '../tenancy/authorization/authorization.service';
import type { SettingsService } from '../settings/settings.service';
import {
  PRICING_MODE_VALUES,
  PRICING_POLICY_CONTRACT_VERSION,
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
   * throws — `PRICE_OVERRIDE_FORBIDDEN`, `PERMISSION_DENIED`,
   * `VALIDATION_FAILED`, or `INTERNAL_ERROR` — so the caller's transaction
   * rolls back before a line is written.
   */
  async evaluateSaleLinesInTransaction(tx: Tx, input: PricingLinesInput): Promise<PricingEvaluationResult> {
    const { pricingMode, settingsVersion, effective } = await this.readPolicyFacts(tx, input);
    const lines = input.lines.map((line) => {
      const outcome = evaluateSaleLinePricing({ pricingMode, permissions: effective }, line);
      return {
        unitPriceListMinor: outcome.unitPriceListMinor,
        unitPriceAppliedMinor: outcome.unitPriceAppliedMinor,
        flags: outcome.flags,
        settingsVersion,
        pricingMode,
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
    const { pricingMode, settingsVersion, effective } = await this.readPolicyFacts(tx, input);
    const lines = input.lines.map((line) => {
      const outcome = reconcileOfflineSaleLinePricing({ pricingMode, permissions: effective }, line);
      return {
        unitPriceListMinor: outcome.unitPriceListMinor,
        unitPriceAppliedMinor: outcome.unitPriceAppliedMinor,
        flags: outcome.flags,
        settingsVersion,
        pricingMode,
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
   * neither reads from a cache (§22.3).
   */
  private async readPolicyFacts(
    tx: Tx,
    input: PricingLinesInput,
  ): Promise<{ pricingMode: PricingModeValue; settingsVersion: bigint; effective: readonly string[] }> {
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
      effective: effective.permissions,
    };
  }
}
