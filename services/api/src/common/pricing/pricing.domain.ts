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
 *    - `FIXED_WITH_DISCOUNT`: the base price stays authoritative. A reduction
 *      below the list price is **refused outright in this slice** — the only
 *      legitimate reduction path is the §18 discount machinery, which is
 *      M3-S3's scope, and letting a manual price (even an authorized
 *      `pricing.override` one) cut below the list price here would silently
 *      implement M3-S3's ceiling bypass inside M3-S2. An increase is a manual
 *      override and requires `pricing.override` (§17.4).
 * 3. **Below-cost flagging** — applied < known cost flags `BELOW_COST` in
 *    every mode, warn-only: the §22.2 inventory defines no setting that makes
 *    below-cost *selling* refuse (the only below-cost refuser in the plan is
 *    `block_discount_below_cost`, §18.4, which is the M3-S3 discount
 *    boundary), so inventing one here would be an anti-scope setting (§2.4,
 *    §40.1). Flagged, reported (§33.2), never coerced away.
 * 4. **Offline reconciliation** — §38.19's server-side re-validation: a
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
import type { PricingFlagValue, PricingLineOutcome, PricingPolicyInput, SaleLinePriceOffer } from './pricing.contract';

/** The permission that lets a caller enter an applied price in `VARIABLE` mode (§17.2). */
const SALES_CREATE_PERMISSION = 'sales.create';

/** The permission that lets a caller alter a fixed list price (§17.1). */
const PRICE_OVERRIDE_PERMISSION = 'pricing.override';

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
        // §17.3: reductions below the list price arrive only through the §18
        // discount machinery (M3-S3). No actor — not even the owner with
        // pricing.override — may cut the price manually here, because such a
        // cut would bypass the discount ceilings this slice deliberately does
        // not implement (§40.7's M3-S2/M3-S3 boundary).
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
 * money) is still refused `VALIDATION_FAILED`: that is a corrupt payload, not
 * a policy outcome, and §38.19's availability promise does not extend to
 * accepting nonsense as money.
 */
export function reconcileOfflineSaleLinePricing(
  policy: PricingPolicyInput,
  line: SaleLinePriceOffer,
): PricingLineOutcome {
  assertLineMoney(line);
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
