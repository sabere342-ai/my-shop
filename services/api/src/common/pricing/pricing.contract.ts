/**
 * The pricing-policy contract vocabulary (Master Plan §17, §30.1, §38.19;
 * §40.7 row M3-S2).
 *
 * This file is the **data** half of the pricing boundary: the closed
 * vocabularies and the shapes every decision is expressed in. The rules live
 * in `pricing.domain.ts`, the transactional enforcement in
 * `pricing.service.ts` — so this file stays importable by a unit test with no
 * database, no framework, and no clock (§36.2).
 *
 * Money is **bigint minor units** inside the boundary (§30.1, ADR-016): never
 * a float, never a JSON number. The future sale wire carries minor-unit money
 * as decimal strings (the M1b-S6 64-bit wire decision) and the caller parses
 * it with `parseMinors` before it reaches this boundary — the parse refusal is
 * the wire layer's, the policy refusal is this boundary's, and neither is
 * allowed to do the other's job (§8.3: three lines of defence, never one).
 *
 * The contract is **versioned** (`PRICING_POLICY_CONTRACT_VERSION`): §38.19
 * requires offline pricing decisions and their server reconciliation to be
 * deterministic and explicitly versioned, so a decision recorded by an older
 * contract is never silently reinterpreted by a newer one.
 */

import { PRICING_MODE_VALUES, type PricingModeValue } from '../settings/settings.contract';

/** The pricing modes, single-sourced from the §22.2 settings inventory. */
export { PRICING_MODE_VALUES };
export type { PricingModeValue };

/**
 * The contract version of the pricing decision shape (§38.19's "versioned,
 * deterministic contract"). Bump when the decision shape or its semantics
 * change in a way a recorded decision could not survive unchanged.
 */
export const PRICING_POLICY_CONTRACT_VERSION = 1;

/**
 * The flags a pricing decision can attach to a sale line.
 *
 * A flag is a reported fact, never a coercion: the line's snapshotted values
 * are already what they are (§16.2), and §38.19 fixes the fate of a flagged
 * offline line — surfaced, never silently voided.
 *
 * - `BELOW_COST` — §17.2/§33.2: the applied price is below the snapshotted
 *   unit cost. Reported for the gross-margin report and salesperson reporting.
 * - `PRICING_POLICY_DRIFT` — §38.19: an offline-recorded line would **not**
 *   have been permitted by the then-current server policy; the sale is still
 *   accepted on sync (the goods physically changed hands) and the exception
 *   is surfaced to the owner.
 */
export const PRICING_FLAG_VALUES = ['BELOW_COST', 'PRICING_POLICY_DRIFT'] as const;

export type PricingFlagValue = (typeof PRICING_FLAG_VALUES)[number];

/**
 * One sale line's price facts, exactly as the boundary consumes them.
 *
 * `unitPriceListMinor` and `unitCostAppliedMinor` are **server-resolved**
 * values — the stored product price (M4-S1's catalog) and the snapshotted
 * unit cost (M4-S3's costing engine) — never client-submitted facts. The
 * applied price is the caller's offered charge: online it is an untrusted
 * hint the policy re-proves (§17.4); offline it is the already-recorded
 * snapshot the reconciliation re-validates (§38.19). An absent cost means
 * the costing engine has not priced the line; the below-cost comparison is
 * then unprovable and no `BELOW_COST` flag may be invented from nothing.
 */
export interface SaleLinePriceOffer {
  readonly unitPriceListMinor: bigint;
  readonly unitPriceAppliedMinor: bigint;
  readonly unitCostAppliedMinor?: bigint | null;
}

/** The policy facts a decision is made under — the organization's live settings plus the actor's effective permissions. */
export interface PricingPolicyInput {
  readonly pricingMode: PricingModeValue;
  /** The §11 effective permission ids, as `readEffectiveInTransaction` resolved them. */
  readonly permissions: readonly string[];
}

/** One line's pricing outcome: the snapshot values and the flags that ride them. */
export interface PricingLineOutcome {
  readonly unitPriceListMinor: bigint;
  readonly unitPriceAppliedMinor: bigint;
  readonly flags: readonly PricingFlagValue[];
}
