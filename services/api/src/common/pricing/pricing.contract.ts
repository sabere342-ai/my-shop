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

import { PRICING_MODE_VALUES, type PricingModeValue, type RoundingModeValue } from '../settings/settings.contract';

/** The pricing modes, single-sourced from the §22.2 settings inventory. */
export { PRICING_MODE_VALUES };
export type { PricingModeValue };

/**
 * The contract version of the pricing decision shape (§38.19's "versioned,
 * deterministic contract"). Bump when the decision shape or its semantics
 * change in a way a recorded decision could not survive unchanged.
 *
 * Version 2 (M3-S3): the §18 discount machinery arrives. The decision shape
 * grows the per-line discount facts, and `FIXED_WITH_DISCOUNT`'s reduction
 * semantics change — the offer-less manual reduction stays refused exactly as
 * v1 fixed it, but an authorized §18 discount offer now derives the applied
 * price. A recorded v1 decision is therefore never silently reinterpreted by
 * this contract.
 */
export const PRICING_POLICY_CONTRACT_VERSION = 2;

/**
 * The §18.1 discount types, verbatim: `PERCENTAGE` applies a percentage to
 * `unitPriceList`, `FIXED_AMOUNT` subtracts an amount from `unitPriceList`,
 * and `FIXED_PRICE` sets the applied price to exactly an amount. A closed
 * set: a fourth type is a contract change, not a value.
 */
export const DISCOUNT_TYPE_VALUES = ['PERCENTAGE', 'FIXED_AMOUNT', 'FIXED_PRICE'] as const;

export type DiscountTypeValue = (typeof DISCOUNT_TYPE_VALUES)[number];

/**
 * The wire grammar of a §18.1 `PERCENTAGE` discount value: at most three
 * integer digits and at most two fraction digits — the exact decimal(5,2)
 * space the §22.2 `max_discount_percentage` setting stores, so an offered
 * percentage and the stored ceiling compare exactly (§30.1: never a binary
 * float). Pair with the 0–100 range check; the grammar alone admits `150`.
 */
export const DISCOUNT_PERCENTAGE_WIRE_PATTERN = /^\d{1,3}(\.\d{1,2})?$/;

/**
 * The scale of an exact percentage: value × 100 as an integer, so `12.50` is
 * `1250n`. Both the offered percentage and the stored ceiling parse into this
 * one space, making every comparison an exact integer comparison.
 */
export const PERCENTAGE_SCALE = 100n;
/** The percentage maximum, in the scaled space: 100% is `10000n`. */
export const PERCENTAGE_SCALED_MAX = 100n * PERCENTAGE_SCALE;
/** The percentage division's fixed denominator: `scaled / 10000` of the list price. */
export const PERCENTAGE_RATE_DENOMINATOR = PERCENTAGE_SCALE * 100n;

/**
 * One line's §18 discount **offer** — what the caller offers, never what the
 * server computed. A discriminated union mirroring §18.1's value-field table:
 * the percentage rides a decimal string (the exact-decimal rule above) and
 * the amounts ride decimal-string minor units (the 64-bit wire decision; the
 * caller parses with the shared minor-units grammar before this boundary
 * sees the line). The applied price and the discount amount are **derived
 * server-side** (§17.4, §18.2 step 6): this offer can never dictate them.
 */
export type SaleLineDiscountOffer =
  | { readonly type: 'PERCENTAGE'; readonly percentage: string }
  | { readonly type: 'FIXED_AMOUNT'; readonly amountMinor: string }
  | { readonly type: 'FIXED_PRICE'; readonly amountMinor: string };

/**
 * The organization's §18.2 discount policy, as exact integers and booleans —
 * the live settings row's discount columns after the service parsed them once.
 * A corrupt stored value (a non-readable percentage, a negative ceiling) is
 * refused `INTERNAL_ERROR` before any decision can be guessed from it.
 */
export interface DiscountPolicyFacts {
  /** `max_discount_percentage` × 100 (hundredths of a percent; `12.50` → `1250n`). */
  readonly maxDiscountPercentageScaled: bigint;
  readonly maxDiscountAmountMinor: bigint;
  /** `null` means the §18.2 approval gate is off. */
  readonly discountApprovalThresholdMinor: bigint | null;
  readonly discountAllowedForSalesperson: boolean;
  readonly blockDiscountBelowCost: boolean;
  /** §30.6: the one rounding rule the percentage division rounds under. */
  readonly roundingMode: RoundingModeValue;
}

/**
 * One line's discount decision: exactly the facts the §16.2 snapshot's
 * discount columns will record, plus the approval state (§18.3). The
 * authorization reference is minted by the **service** from authenticated
 * facts, so the pure domain leaves it `null` and the service fills it when
 * (and only when) the decision itself approved the discount.
 */
export interface DiscountLineDecision {
  readonly type: DiscountTypeValue;
  /** The offered value exactly as the caller offered it (§16.2 `discountValue`). */
  readonly offeredValue: string;
  /** The computed amount, minor units: `unitPriceList − unitPriceApplied` (§16.2 identity). */
  readonly discountAmountMinor: bigint;
  /**
   * True only when the discount crossed the §18.2 approval threshold and the
   * authenticated actor held `pricing.discount.approve` — never a client
   * assertion.
   */
  readonly approved: boolean;
  /** Set by the service for an approved decision; `null` means no approval was involved. */
  readonly authorizationRef: string | null;
}

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
  /**
   * The §18 discount offer, when the line carries one. Present, the applied
   * price is **derived** from it and the list price (§17.3, §18.2); the
   * caller's applied value above is then only a hint, and it must agree with
   * the derived value or the request is refused `VALIDATION_FAILED` — the
   * server's derivation is the only basis of a financial value (§17.4).
   */
  readonly discount?: SaleLineDiscountOffer;
}

/** The policy facts a decision is made under — the organization's live settings plus the actor's effective permissions. */
export interface PricingPolicyInput {
  readonly pricingMode: PricingModeValue;
  /** The §11 effective permission ids, as `readEffectiveInTransaction` resolved them. */
  readonly permissions: readonly string[];
  /**
   * The §18 discount policy facts, exactly as the live settings row states
   * them. Absent is a wiring fault, refused `INTERNAL_ERROR` the moment a
   * discount offer needs them — never a guessed default (§18.2 step 1).
   */
  readonly discount?: DiscountPolicyFacts;
  /**
   * The server-resolved role key of the actor's membership (§11.4), used only
   * by the §18.2 `discount_allowed_for_salesperson` rule. Never a client
   * assertion: the resolver reads it from the membership row in the deciding
   * transaction.
   */
  readonly actorRoleKey?: string | null;
  /**
   * The known ids the actor carries explicit `DENY` overrides for (§11.4),
   * so a settings-granted discount authority cannot resurrect a denied one.
   */
  readonly deniedPermissions?: readonly string[];
}

/** One line's pricing outcome: the snapshot values and the flags that ride them. */
export interface PricingLineOutcome {
  readonly unitPriceListMinor: bigint;
  readonly unitPriceAppliedMinor: bigint;
  readonly flags: readonly PricingFlagValue[];
  /** The §18 discount decision facts, present exactly when the line carried a discount offer. */
  readonly discount?: DiscountLineDecision;
}
