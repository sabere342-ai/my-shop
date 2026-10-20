/**
 * The pure pricing-policy domain (Master Plan §17, §18 boundary, §30.1, §38.19;
 * §40.7 row M3-S2).
 *
 * No I/O, no framework, no Prisma, no clock — exactly the decision half of the
 * pricing surface, unit-tested in isolation (§36.2). Its job:
 *
 * 1. **Structural validation** — the line's money is integer minor units
 *    (§30.1, ADR-016). A negative *applied* price is a malformed client input
 *    (`VALIDATION_FAILED`); a negative *stored* price or cost is server data
 *    corruption, not a client's fault (`INTERNAL_ERROR`) — the two refusals are
 *    deliberately different codes because the two faults have different owners.
 * 2. **Mode enforcement** — §17.1–§17.3, one deterministic rule set per mode,
 *    permissions resolved from the actor's *effective* authorization (§11.4):
 *
 *    - `FIXED`: the stored selling price is authoritative. Any difference
 *      between the applied and the list price — up or down — requires
 *      `pricing.override`, else `403 PRICE_OVERRIDE_FORBIDDEN` (§17.1).
 *    - `VARIABLE`: entering an applied price is §17.2's `sales.create`
 *      authority; any applied price is then permitted, list and applied stay
 *      two distinct snapshotted values (§16.2), and selling below the known
 *      cost is permitted but flagged `BELOW_COST` (§17.2, §33.2).
 *    - `FIXED_WITH_DISCOUNT` (§17.3): the base price stays authoritative. A
 *      **manual** reduction below the list price — an applied price offered
 *      without a §18 discount offer — is refused outright: the only
 *      legitimate reduction path is the discount machinery below, and letting
 *      a manual price (even an authorized `pricing.override` one) cut below
 *      the list price here would silently bypass the discount ceilings. An
 *      increase requires `pricing.override` (§17.4).
 * 3. **Below-cost handling** — applied < known cost flags `BELOW_COST` in
 *    every mode, and for the §18 discount path the §18.4
 *    `block_discount_below_cost` setting decides between the flag (false:
 *    permitted, flagged for the gross-margin report) and a refusal (true: the
 *    discount may not reach below the snapshotted cost). An absent or unknown
 *    cost is unproven: flag invented from nothing, refusal refused from
 *    nothing.
 * 4. **The §18 discount path** — the M3-S3 machinery, deterministic in one
 *    classifier both entry points share. The discount offer is the
 *    caller's *offer*; every financial fact is derived server-side (§17.4):
 *
 *    - the offer is meaningful only in `FIXED_WITH_DISCOUNT` (§17.3 ties
 *      that mode's derivation to §18); `FIXED` refuses it with
 *      `PRICE_OVERRIDE_FORBIDDEN` — uniform with that mode's
 *      authoritative-price rule — and `VARIABLE` refuses it with
 *      `DISCOUNT_FORBIDDEN`, the mode's free price entry leaving a discount
 *      offer a second, competing applied-price source;
 *    - ceilings first, unconditionally (§18.2 steps 3–4): a breach over the
 *      organization's `max_discount_percentage` or
 *      `max_discount_amount_minor` answers `403 DISCOUNT_LIMIT_EXCEEDED` for
 *      every actor — owner and approver included; no authority bypasses a
 *      hard ceiling. For `FIXED_PRICE` the ceiling compares the **computed
 *      reduction**: a small final price is never mistaken for a small
 *      discount;
 *    - authority second (`403 DISCOUNT_FORBIDDEN`): the actor holds
 *      `pricing.discount.apply`, or `discount_allowed_for_salesperson` opens
 *      it for the server-resolved `salesperson` role — never over an
 *      explicit `DENY` (§11.4 deny over allow);
 *    - the approval gate third (`403 DISCOUNT_APPROVAL_REQUIRED`): a
 *      computed amount strictly above `discount_approval_threshold_minor`
 *      requires `pricing.discount.approve` in the actor's effective set.
 *      Approval is never an input — there is no client-asserted approval to
 *      forge, reuse, or revoke; the gate is satisfied only by the
 *      authenticated actor's own authority. The approver-identifying
 *      reference is minted by the service from authenticated facts (§18.3);
 *    - the §18.4 cost floor last: with `block_discount_below_cost` set, a
 *      discount reaching strictly below a known cost is refused
 *      `DISCOUNT_LIMIT_EXCEEDED` — the floor is a limit on how deep the
 *      discount may go, and approval does not lift it;
 *    - arithmetic is exact integer minor-unit math (§30.1): the percentage
 *      rides an exact decimal scaled ×100, the division rounds **exactly
 *      once** under the organization's §30.6 `rounding_mode`, and no binary
 *      floating-point value exists anywhere in the path.
 * 5. **Offline reconciliation** — §38.19's server-side re-validation: a
 *    completed offline sale is **never refused for policy drift** (the goods
 *    physically changed hands; refusing a completed physical sale over a
 *    policy change is exactly the cashier dead-end the owner prohibited).
 *    Instead, a line the *then-current* policy would not have permitted is
 *    flagged `PRICING_POLICY_DRIFT` and surfaced to the owner. The two entry
 *    points share one internal classifier, so the online refusal and the
 *    offline drift flag can never disagree about what the policy permits.
 *
 * The result is deterministic: same policy facts, same line, same answer —
 * the property §38.19's device-side enforcement and the server's
 * reconciliation both depend on.
 */

import { DomainError } from '../errors/domain.error';
import { ERROR_CODES } from '../errors/problem';
import { DECIMAL_MINORS_WIRE_PATTERN } from '../settings/settings.domain';
import type { RoundingModeValue } from '../settings/settings.contract';
import {
  DISCOUNT_PERCENTAGE_WIRE_PATTERN,
  PERCENTAGE_RATE_DENOMINATOR,
  PERCENTAGE_SCALED_MAX,
  PERCENTAGE_SCALE,
  type DiscountPolicyFacts,
  type DiscountTypeValue,
  type PricingFlagValue,
  type PricingLineOutcome,
  type PricingPolicyInput,
  type SaleLineDiscountOffer,
  type SaleLinePriceOffer,
} from './pricing.contract';

/** The permission that lets a caller enter an applied price in `VARIABLE` mode (§17.2). */
const SALES_CREATE_PERMISSION = 'sales.create';

/** The permission that lets a caller alter a fixed list price (§17.1). */
const PRICE_OVERRIDE_PERMISSION = 'pricing.override';

/** The permission that lets a caller apply a §18 discount within the policy (§11.2/§18.2). */
const DISCOUNT_APPLY_PERMISSION = 'pricing.discount.apply';

/** The permission that satisfies the §18.2 approval gate above the threshold (§11.2/§18.2). */
const DISCOUNT_APPROVE_PERMISSION = 'pricing.discount.approve';

/**
 * The seeded preset key the §18.2 `discount_allowed_for_salesperson` policy
 * opens the discount authority for — a **server-resolved role key** from the
 * deciding transaction's membership row, never a client-asserted role name.
 */
const SALESPERSON_ROLE_KEY = 'salesperson';

function validationFailed(field: string, message: string): DomainError {
  return new DomainError(ERROR_CODES.VALIDATION_FAILED, `${field} ${message}`, [
    { field, messages: [`${field} ${message}`] },
  ]);
}

function holds(permissions: readonly string[], id: string): boolean {
  return permissions.includes(id);
}

/**
 * The structural half: minor-unit money may not be negative, and the three
 * money facts have three distinct refusals. Ran before any policy logic, so a
 * malformed line is refused the same way in every mode and by both entry
 * points.
 */
function assertLineMoney(line: SaleLinePriceOffer): void {
  if (line.unitPriceAppliedMinor < 0n) {
    throw validationFailed('unitPriceAppliedMinor', 'must not be negative');
  }
  if (line.unitPriceListMinor < 0n) {
    // A stored product price is server-owned (M4's catalog). Reaching this
    // boundary with a negative list price means the store itself is corrupt —
    // a server fault, never a client's validation failure.
    throw new DomainError(ERROR_CODES.INTERNAL_ERROR, 'the stored unit price list is negative');
  }
  if (line.unitCostAppliedMinor !== undefined && line.unitCostAppliedMinor !== null && line.unitCostAppliedMinor < 0n) {
    // Same server-integrity reasoning for the snapshotted cost (M4-S3's engine).
    throw new DomainError(ERROR_CODES.INTERNAL_ERROR, 'the snapshotted unit cost is negative');
  }
}

/**
 * The below-cost comparison: strictly below a **known** cost. An absent or
 * null cost is "unproven", and an unproven comparison invents no flag.
 */
function belowCostFlags(line: SaleLinePriceOffer): readonly PricingFlagValue[] {
  const cost = line.unitCostAppliedMinor;
  if (cost === undefined || cost === null) return [];
  return line.unitPriceAppliedMinor < cost ? ['BELOW_COST'] : [];
}

/**
 * The one policy classifier both entry points share.
 *
 * Returns the line's outcome when the then-current policy permits it, or the
 * `DomainError` the policy refusal maps to. `reconcile` converts the refusal
 * into the §38.19 `PRICING_POLICY_DRIFT` flag instead of throwing; `evaluate`
 * throws it — the conversion is the *only* difference between the two paths,
 * so the two enforcement points cannot drift apart (§38.19's "the device
 * enforces the same rule ... and the server re-checks on sync", applied here
 * to the server's own online/offline pair).
 */
function classifyLine(
  policy: PricingPolicyInput,
  line: SaleLinePriceOffer,
): { outcome: PricingLineOutcome; refusal?: undefined } | { refusal: DomainError; outcome?: undefined } {
  const list = line.unitPriceListMinor;
  const applied = line.unitPriceAppliedMinor;
  const differs = applied !== list;

  if (line.discount !== undefined) {
    // The §18 discount path (M3-S3). The offer routes the line out of the
    // manual-price logic: the applied price is derived, not submitted.
    return classifyDiscountOffer(policy, line);
  }

  switch (policy.pricingMode) {
    case 'FIXED': {
      // §17.1: the stored selling price is authoritative, in both directions —
      // a cheapening and a markup are both alterations of the authoritative
      // price, and both answer the same documented refusal without the
      // override authority.
      if (differs && !holds(policy.permissions, PRICE_OVERRIDE_PERMISSION)) {
        return {
          refusal: new DomainError(
            ERROR_CODES.PRICE_OVERRIDE_FORBIDDEN,
            'the pricing mode is FIXED and the applied price differs from the list price without the pricing.override permission',
          ),
        };
      }
      break;
    }
    case 'VARIABLE': {
      // §17.2: entering an applied price is the sales.create authority. The
      // sale-level admission is the entry point's check (the guard or the
      // §9.4 ingress revalidator); this boundary re-proves the price-entry
      // authority inside the same transaction so a policy decision and its
      // authorization are one consistent moment.
      if (!holds(policy.permissions, SALES_CREATE_PERMISSION)) {
        return {
          refusal: new DomainError(
            ERROR_CODES.PERMISSION_DENIED,
            'entering an applied price in the VARIABLE pricing mode requires the sales.create permission',
          ),
        };
      }
      break;
    }
    case 'FIXED_WITH_DISCOUNT': {
      if (applied < list) {
        // §17.3: a reduction below the list price arrives only through the §18
        // discount machinery — which a line reaches by carrying a discount
        // offer (routed above). A manual, offer-less cut is refused to every
        // actor, because such a cut would be the discount ceilings' bypass
        // this boundary exists to close.
        return {
          refusal: new DomainError(
            ERROR_CODES.PRICE_OVERRIDE_FORBIDDEN,
            'the pricing mode is FIXED_WITH_DISCOUNT and the applied price may not be reduced below the list price outside the discount policy',
          ),
        };
      }
      if (differs && !holds(policy.permissions, PRICE_OVERRIDE_PERMISSION)) {
        // An increase over the fixed base is a manual override, exactly as
        // §17.4's recompute-and-validate rule treats it.
        return {
          refusal: new DomainError(
            ERROR_CODES.PRICE_OVERRIDE_FORBIDDEN,
            'the pricing mode is FIXED_WITH_DISCOUNT and raising the applied price above the list price requires the pricing.override permission',
          ),
        };
      }
      break;
    }
  }

  return { outcome: { unitPriceListMinor: list, unitPriceAppliedMinor: applied, flags: belowCostFlags(line) } };
}

/**
 * The online enforcement decision for one sale line (§17.4): the caller's
 * computed price is an untrusted hint, and the boundary answers with either
 * the permitted outcome or the documented refusal.
 *
 * Throws `DomainError` — `PRICE_OVERRIDE_FORBIDDEN` (403), `PERMISSION_DENIED`
 * (403), `VALIDATION_FAILED` (400), or `INTERNAL_ERROR` (500, server data
 * corruption) — so the caller's transaction rolls back before any line is
 * written when the policy refuses.
 */
export function evaluateSaleLinePricing(policy: PricingPolicyInput, line: SaleLinePriceOffer): PricingLineOutcome {
  assertLineMoney(line);
  const classified = classifyLine(policy, line);
  if (classified.refusal !== undefined) {
    throw classified.refusal;
  }
  // §17.4, online only: the caller's applied value is an untrusted hint and
  // must agree with the server's derivation — the derived value is the only
  // basis of a financial value. The reconciliation path compares the same two
  // numbers as its §38.19 drift decision instead, never as a request refusal.
  if (line.discount !== undefined && classified.outcome.unitPriceAppliedMinor !== line.unitPriceAppliedMinor) {
    throw validationFailed(
      'unitPriceAppliedMinor',
      'does not match the price the discount offer derives (the server derives the applied price)',
    );
  }
  return classified.outcome;
}

/**
 * The §38.19 server-side reconciliation of one **offline-recorded** sale line
 * on sync. The policy facts are the *then-current* server settings and the
 * actor's *current* effective permissions; the line is the snapshot the
 * device recorded (§16.2 — both the list and the applied price ride it).
 *
 * Availability is preserved (§38.19): the reconciliation never refuses a line
 * for policy drift — a drift is flagged `PRICING_POLICY_DRIFT` and surfaced to
 * the owner, and it is never silently voided. Structural corruption (negative
 * money, a recorded line inconsistent with its own discount offer — the §16.2
 * identity — or an above-list "fixed price" no policy ever permitted) is still
 * refused `VALIDATION_FAILED`: that is a corrupt payload, not a policy
 * outcome, and §38.19's availability promise does not extend to accepting
 * nonsense as money or as a discount. The recorded snapshot values are
 * returned untouched either way — never silently repriced.
 */
export function reconcileOfflineSaleLinePricing(
  policy: PricingPolicyInput,
  line: SaleLinePriceOffer,
): PricingLineOutcome {
  assertLineMoney(line);
  if (line.discount !== undefined) {
    return reconcileDiscountLine(policy, line);
  }
  const classified = classifyLine(policy, line);
  if (classified.refusal === undefined) {
    return classified.outcome;
  }
  // The refusal the online boundary would have thrown becomes the drift flag
  // the §38.19 table fixes. The flags stay in the contract's vocabulary order.
  return {
    unitPriceListMinor: line.unitPriceListMinor,
    unitPriceAppliedMinor: line.unitPriceAppliedMinor,
    flags: [...belowCostFlags(line), 'PRICING_POLICY_DRIFT'],
  };
}

/* ------------------------------------------------------------------ *
 * The §18 discount machinery (M3-S3). Everything below is pure: exact
 * integer arithmetic, no clock, no I/O — the same deterministic answer for
 * the online decision and the offline reconciliation, which is the property
 * §38.19's two enforcement points depend on.
 * ------------------------------------------------------------------ */

/** One §18 discount offer after its wire shape is proven. */
interface NormalizedDiscountOffer {
  readonly type: DiscountTypeValue;
  /** The offered value exactly as the caller wrote it (§16.2 `discountValue`). */
  readonly offeredValue: string;
  /** `PERCENTAGE` only: the exact percentage scaled ×100 (hundredths of a percent). */
  readonly percentageScaled?: bigint;
  /** `FIXED_AMOUNT` / `FIXED_PRICE` only: the exact minor-unit amount. */
  readonly amountMinor?: bigint;
}

/**
 * The exact-decimal percentage parse: the wire grammar fixes the shape, the
 * range check fixes 0–100, and the result is an exact integer — no binary
 * floating-point value ever exists (§30.1). Scaled, so the offered percentage
 * and the stored decimal(5,2) ceiling compare exactly.
 */
function normalizePercentage(percentage: string): bigint {
  if (!DISCOUNT_PERCENTAGE_WIRE_PATTERN.test(percentage)) {
    throw validationFailed(
      'discount.percentage',
      'must be a decimal percentage between 0 and 100 with at most two fraction digits',
    );
  }
  let scaled: bigint;
  try {
    const dot = percentage.indexOf('.');
    scaled =
      dot === -1
        ? BigInt(percentage) * PERCENTAGE_SCALE
        : BigInt(percentage.slice(0, dot)) * PERCENTAGE_SCALE + BigInt(percentage.slice(dot + 1).padEnd(2, '0'));
  } catch {
    // Unreachable behind the grammar check; kept as a fail-closed guard so an
    // unexpected BigInt refusal is never a crash.
    throw validationFailed('discount.percentage', 'must be a decimal percentage between 0 and 100');
  }
  if (scaled > PERCENTAGE_SCALED_MAX) {
    throw validationFailed('discount.percentage', 'must not exceed 100 percent');
  }
  return scaled;
}

/** The minor-unit amount parse: the shared 64-bit wire money grammar, digits only (§30.1). */
function normalizeAmountMinor(field: string, amountMinor: string): bigint {
  if (typeof amountMinor !== 'string' || !DECIMAL_MINORS_WIRE_PATTERN.test(amountMinor)) {
    throw validationFailed(field, 'must be a decimal string of digits');
  }
  return BigInt(amountMinor);
}

/** Proves a §18 discount offer's wire shape, or refuses `VALIDATION_FAILED`. */
function normalizeDiscountOffer(offer: SaleLineDiscountOffer): NormalizedDiscountOffer {
  if (offer === null || typeof offer !== 'object') {
    throw validationFailed('discount', 'must be a discount offer object');
  }
  switch (offer.type) {
    case 'PERCENTAGE':
      return {
        type: offer.type,
        offeredValue: offer.percentage,
        percentageScaled: normalizePercentage(offer.percentage),
      };
    case 'FIXED_AMOUNT':
      return {
        type: offer.type,
        offeredValue: offer.amountMinor,
        amountMinor: normalizeAmountMinor('discount.amountMinor', offer.amountMinor),
      };
    case 'FIXED_PRICE':
      return {
        type: offer.type,
        offeredValue: offer.amountMinor,
        amountMinor: normalizeAmountMinor('discount.amountMinor', offer.amountMinor),
      };
    default:
      throw validationFailed('discount.type', 'must be one of PERCENTAGE, FIXED_AMOUNT, FIXED_PRICE');
  }
}

/**
 * The one-percentage-division rounding of §30.6: explicit integer division
 * rounded exactly once, under the organization's `rounding_mode`. Operands
 * are non-negative; `HALF_EVEN` ties round to the even quotient.
 */
function roundDivHalf(numerator: bigint, denominator: bigint, mode: RoundingModeValue): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator - quotient * denominator;
  if (remainder === 0n) {
    return quotient;
  }
  const twiceRemainder = remainder * 2n;
  if (mode === 'HALF_UP') {
    return twiceRemainder >= denominator ? quotient + 1n : quotient;
  }
  if (mode === 'HALF_EVEN') {
    if (twiceRemainder > denominator) {
      return quotient + 1n;
    }
    if (twiceRemainder < denominator) {
      return quotient;
    }
    return quotient % 2n === 0n ? quotient : quotient + 1n;
  }
  // The typed policy facts carry only the two §30.6 vocabulary values; a
  // different runtime value is stored-policy corruption, refused closed.
  throw new DomainError(ERROR_CODES.INTERNAL_ERROR, 'the stored rounding mode is not a mode this server knows');
}

/** The server-derived applied price of a percentage discount under one rounding mode. */
function percentageOutcome(
  list: bigint,
  percentageScaled: bigint,
  mode: RoundingModeValue,
): { applied: bigint; discountAmount: bigint } {
  const discountAmount = roundDivHalf(list * percentageScaled, PERCENTAGE_RATE_DENOMINATOR, mode);
  return { applied: list - discountAmount, discountAmount };
}

/**
 * §18.2's discount authority: the actor holds `pricing.discount.apply` in the
 * effective set — or `discount_allowed_for_salesperson` opens it for the
 * **server-resolved** `salesperson` role, never over an explicit `DENY`
 * (§11.4: deny over allow). A client role name is nowhere in this answer.
 */
function holdsDiscountApplyAuthority(policy: PricingPolicyInput, discount: DiscountPolicyFacts): boolean {
  if (holds(policy.permissions, DISCOUNT_APPLY_PERMISSION)) {
    return true;
  }
  if (!discount.discountAllowedForSalesperson) {
    return false;
  }
  if (policy.actorRoleKey !== SALESPERSON_ROLE_KEY) {
    return false;
  }
  return !(policy.deniedPermissions ?? []).includes(DISCOUNT_APPLY_PERMISSION);
}

/** The §16.2 discount decision facts for a derived discount; the service mints an approval's authorization reference. */
function discountDecision(
  offer: NormalizedDiscountOffer,
  discountAmount: bigint,
  approved: boolean,
): NonNullable<PricingLineOutcome['discount']> {
  return {
    type: offer.type,
    offeredValue: offer.offeredValue,
    discountAmountMinor: discountAmount,
    approved,
    authorizationRef: null,
  };
}

/**
 * The §18.2 classification of one discount-offer line, in the documented
 * resolution order. Returns the derived outcome or the policy refusal;
 * structural refusals (malformed offer values) throw from the normalization
 * step in both entry points — corruption is corruption, online or offline.
 */
function classifyDiscountOffer(
  policy: PricingPolicyInput,
  line: SaleLinePriceOffer,
): { outcome: PricingLineOutcome; refusal?: undefined } | { refusal: DomainError; outcome?: undefined } {
  const offer = normalizeDiscountOffer(line.discount as SaleLineDiscountOffer);
  const discountPolicy = policy.discount;
  if (discountPolicy === undefined) {
    // §18.2 step 1: no decision can be guessed without the organization's
    // policy — a manager wiring fault, refused closed.
    throw new DomainError(ERROR_CODES.INTERNAL_ERROR, 'the discount policy facts are missing from the policy input');
  }
  const list = line.unitPriceListMinor;

  switch (policy.pricingMode) {
    case 'FIXED':
      // §17.1: the stored price is authoritative; the discount machinery is
      // §17.3's derivation rule, not this mode's. Uniform with the mode's
      // alteration refusal, zero value included (fail closed).
      return {
        refusal: new DomainError(
          ERROR_CODES.PRICE_OVERRIDE_FORBIDDEN,
          'the pricing mode is FIXED and the discount path is not available in this mode',
        ),
      };
    case 'VARIABLE':
      // §17.2: free price entry under sales.create already covers every
      // reduction; a discount offer here would be a second, competing
      // applied-price source (the double-application bypass).
      return {
        refusal: new DomainError(
          ERROR_CODES.DISCOUNT_FORBIDDEN,
          'the pricing mode is VARIABLE and the discount path is not available in this mode',
        ),
      };
    case 'FIXED_WITH_DISCOUNT':
      break;
    default:
      // The policy input's mode is contract-typed; a runtime surprise is a
      // wiring fault, refused closed before a decision could be guessed.
      throw new DomainError(ERROR_CODES.INTERNAL_ERROR, 'the pricing mode is not a mode this server knows');
  }

  // §18.2 step 6's derivation happens first (the amounts/ceilings need it),
  // with the two line-bound refusals the derivation itself answers.
  let derived: { applied: bigint; discountAmount: bigint };
  switch (offer.type) {
    case 'PERCENTAGE':
      derived = percentageOutcome(list, offer.percentageScaled as bigint, discountPolicy.roundingMode);
      break;
    case 'FIXED_AMOUNT': {
      const amount = offer.amountMinor as bigint;
      if (amount > list) {
        // A discount can never exceed the price being discounted: the applied
        // price may never go negative (§30.1 money law, §18.1 semantics).
        return {
          refusal: new DomainError(
            ERROR_CODES.DISCOUNT_LIMIT_EXCEEDED,
            'the fixed discount amount exceeds the line price, and a discount may never exceed the price it discounts',
          ),
        };
      }
      derived = { applied: list - amount, discountAmount: amount };
      break;
    }
    case 'FIXED_PRICE': {
      const amount = offer.amountMinor as bigint;
      if (amount > list) {
        // A "fixed price" above the list is a price increase, not a discount;
        // the increase path is the manual override boundary (§17.4), never
        // the discount path.
        return {
          refusal: new DomainError(
            ERROR_CODES.DISCOUNT_FORBIDDEN,
            'a FIXED_PRICE discount may not set the applied price above the list price; a price increase requires the override boundary',
          ),
        };
      }
      derived = { applied: amount, discountAmount: list - amount };
      break;
    }
  }

  // §17.4 online-hint discipline is the online entry point's own check, so
  // the shared classifier stays shared: the reconciliation compares the
  // recorded price against the current derivation as its §38.19 drift
  // decision, never as a request refusal.

  // §18.2 step 3: the hard ceilings, unconditionally — no authority, owner or
  // approver included, may bypass them.
  switch (offer.type) {
    case 'PERCENTAGE': {
      const percentageScaled = offer.percentageScaled as bigint;
      if (percentageScaled > discountPolicy.maxDiscountPercentageScaled) {
        return {
          refusal: new DomainError(
            ERROR_CODES.DISCOUNT_LIMIT_EXCEEDED,
            'the offered percentage exceeds the organization maximum discount percentage',
          ),
        };
      }
      break;
    }
    case 'FIXED_AMOUNT':
    case 'FIXED_PRICE': {
      // FIXED_PRICE compares the **computed reduction** (§18.2's amount
      // ceiling): a small final price is never mistaken for a small discount.
      if (derived.discountAmount > discountPolicy.maxDiscountAmountMinor) {
        return {
          refusal: new DomainError(
            ERROR_CODES.DISCOUNT_LIMIT_EXCEEDED,
            'the discount amount exceeds the organization maximum discount amount',
          ),
        };
      }
      break;
    }
  }

  // §18.2 step 4: the actor's effective authority.
  if (!holdsDiscountApplyAuthority(policy, discountPolicy)) {
    return {
      refusal: new DomainError(
        ERROR_CODES.DISCOUNT_FORBIDDEN,
        'the actor does not hold the discount authority this discount requires',
      ),
    };
  }

  // §18.2 step 5: the approval gate — strictly above the threshold, an
  // approver satisfies it, a non-approver is rejected (never a silently
  // pending cash sale). Approval is never an input to forge.
  let approved = false;
  const threshold = discountPolicy.discountApprovalThresholdMinor;
  if (threshold !== null && derived.discountAmount > threshold) {
    if (!holds(policy.permissions, DISCOUNT_APPROVE_PERMISSION)) {
      return {
        refusal: new DomainError(
          ERROR_CODES.DISCOUNT_APPROVAL_REQUIRED,
          'the discount exceeds the approval threshold and requires an approver',
        ),
      };
    }
    approved = true;
  }

  // §18.4: the cost floor. Block on → refusal, strictly below a *known* cost;
  // block off → the line is permitted and flagged, exactly as the manual
  // below-cost rule flags it. An unproven comparison invents neither.
  const flags = belowCostFlags(line);
  const cost = line.unitCostAppliedMinor;
  if (cost !== undefined && cost !== null && derived.applied < cost && discountPolicy.blockDiscountBelowCost) {
    return {
      refusal: new DomainError(
        ERROR_CODES.DISCOUNT_LIMIT_EXCEEDED,
        'the discount would take the applied price below the unit cost and block_discount_below_cost is set',
      ),
    };
  }

  return {
    outcome: {
      unitPriceListMinor: list,
      unitPriceAppliedMinor: derived.applied,
      flags,
      discount: discountDecision(offer, derived.discountAmount, approved),
    },
  };
}

/**
 * The recorded snapshot's internal consistency (§16.2): the recorded values
 * must be the values some rounding of the recorded discount *could* have
 * produced. Violations are malformed financial data and are refused in both
 * entry points — §38.19's availability promise covers policy changes, not
 * corrupt payloads. The rounding-mode comparison is deliberately the
 * *either-mode* set: an organization's rounding change between the record
 * time and the sync is policy drift, decided below, not corruption.
 */
function assertRecordedDiscountStructure(line: SaleLinePriceOffer): NormalizedDiscountOffer {
  const offer = normalizeDiscountOffer(line.discount as SaleLineDiscountOffer);
  const list = line.unitPriceListMinor;
  const applied = line.unitPriceAppliedMinor;
  switch (offer.type) {
    case 'FIXED_AMOUNT':
      if (applied !== list - (offer.amountMinor as bigint)) {
        throw validationFailed(
          'unitPriceAppliedMinor',
          'does not equal the list price minus the recorded discount amount (the recorded line is inconsistent)',
        );
      }
      break;
    case 'FIXED_PRICE':
      if (applied !== (offer.amountMinor as bigint)) {
        throw validationFailed(
          'unitPriceAppliedMinor',
          'does not equal the recorded fixed price (the recorded line is inconsistent)',
        );
      }
      if (applied > list) {
        // An above-list applied price was never producible by any policy
        // version's derivation: corruption, never drift.
        throw validationFailed(
          'unitPriceAppliedMinor',
          'is above the list price, which no discount policy permits (the recorded line is inconsistent)',
        );
      }
      break;
    case 'PERCENTAGE': {
      const halfUp = percentageOutcome(list, offer.percentageScaled as bigint, 'HALF_UP').applied;
      const halfEven = percentageOutcome(list, offer.percentageScaled as bigint, 'HALF_EVEN').applied;
      if (applied !== halfUp && applied !== halfEven) {
        throw validationFailed(
          'unitPriceAppliedMinor',
          'is not the price the recorded percentage derives under either rounding mode (the recorded line is inconsistent)',
        );
      }
      break;
    }
  }
  return offer;
}

/** The reconcile-side classification of one discount-offer line (§38.19). */
function reconcileDiscountLine(policy: PricingPolicyInput, line: SaleLinePriceOffer): PricingLineOutcome {
  const offer = assertRecordedDiscountStructure(line);
  // The recorded decision facts: the §16.2 identity holds by the structural
  // proof above. The recorded actor and authorization reference ride the
  // mutation payload (§32.2A attribution survives sync) and M5 stamps them on
  // the persisted line — the boundary re-proves the *policy*, not provenance.
  const recordedDecision = discountDecision(offer, line.unitPriceListMinor - line.unitPriceAppliedMinor, false);
  const classified = classifyDiscountOffer(policy, line);
  if (classified.refusal !== undefined) {
    // Never refused for policy drift (§38.19): accepted, flagged, surfaced,
    // snapshots untouched.
    return {
      unitPriceListMinor: line.unitPriceListMinor,
      unitPriceAppliedMinor: line.unitPriceAppliedMinor,
      flags: [...belowCostFlags(line), 'PRICING_POLICY_DRIFT'],
      discount: recordedDecision,
    };
  }
  const flags = [...belowCostFlags(line)];
  if (classified.outcome.unitPriceAppliedMinor !== line.unitPriceAppliedMinor) {
    // The then-current derivation produces a different price than the one
    // recorded (a rounding-mode change, or an otherwise changed policy
    // output): policy drift, never a silent reprice.
    flags.push('PRICING_POLICY_DRIFT');
  }
  return {
    unitPriceListMinor: line.unitPriceListMinor,
    unitPriceAppliedMinor: line.unitPriceAppliedMinor,
    flags,
    discount: recordedDecision,
  };
}
