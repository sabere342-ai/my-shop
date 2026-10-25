/**
 * The costing engine's pure decision half (Master Plan §30.1–§30.8; §40.8 row
 * M4-S3).
 *
 * No I/O, no framework, no Prisma, no clock — exactly like the pricing domain.
 * Every rule here is a plan decision, not an invention:
 *
 * 1. **Money is integer minor units everywhere** (§30.1): every operand and
 *    every result is a `bigint` count of minor units. No `number` ever holds a
 *    monetary value; no `NUMERIC` participates; the wire carries decimal
 *    strings. The 12-digit width is the money wire's bound, restated by the
 *    `chk_inventory_movement_cost_bounds` / `chk_inventory_level_cost_bounds`
 *    CHECKs.
 * 2. **Perpetual moving weighted average** (§30.2): the recalculation point is
 *    every stock-receiving movement, the formula is §30.3's, and the single
 *    rounding point is the §30.6 division — explicitly, exactly once, under the
 *    organization's `rounding_mode` (`HALF_UP` default, `HALF_EVEN` the
 *    alternative the typed settings carry).
 * 3. **Deductions never touch the average** (§30.4): a sale, a shrinkage, a
 *    quantity correction consume at the current average snapshot — the average
 *    is unchanged — so historical COGS is never restated by later arithmetic.
 * 4. **A valuation is an integer product**, never a rounded ratio: the
 *    inventory value of a level is `quantity × average`, exact by integer
 *    multiplication. No division, no float, no presentational precision.
 *
 * The engine answers given the *locked, current* level facts call sites read
 * inside the movement transaction; it performs no reads itself. Serialization
 * is the caller's variant-row `FOR UPDATE` (M4-S2's §15.6 sequence point), so
 * two racing costing submissions can never interleave two folds of one basis.
 */

/** A live level's costing facts, exactly as the service reads them under lock. */
export interface CostingBasisFacts {
  /** Exact base-unit quantity; never negative (the §15.6 guard ran). */
  readonly quantity: bigint;
  /** The moving average so far, minor units — `null` is the honest absence of a basis. */
  readonly averageCostMinor: bigint | null;
}

/** One costing decision: the facts a movement accepts and records. */
export interface CostingDecision {
  /**
   * The unit cost the movement *snapshots* (§30.2: recorded, immutable):
   * `-` the offered cost for a §30.3 receipt, the current average for a
   * consumption or a plain incoming adjustment, `null` for a movement the
   * costing rules leave uncosted.
   */
  readonly unitCostMinorApplied: bigint | null;
  /** The level's average after the fold (`null` stays `null` on no basis). */
  readonly resultingAverageCostMinor: bigint | null;
}

export type RoundingMode = 'HALF_UP' | 'HALF_EVEN';

/**
 * §30.6's single rounding point, adapted from the pricing domain's own
 * division: explicit integer division of **non-negative** operands, rounded
 * exactly once, `HALF_UP` ties away_up by default, `HALF_EVEN` ties to even.
 * A different runtime mode is stored-policy corruption for the caller to
 * refuse closed, so the signature accepts only the typed vocabulary.
 */
export function roundDivHalfUpStyle(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (denominator <= 0n) {
    throw new RangeError('the averaging denominator must be positive');
  }
  if (numerator < 0n) {
    throw new RangeError('the averaging numerator must be non-negative');
  }
  const quotient = numerator / denominator;
  const remainder = numerator - quotient * denominator;
  if (remainder === 0n) {
    return quotient;
  }
  const twiceRemainder = remainder * 2n;
  if (mode === 'HALF_UP') {
    return twiceRemainder >= denominator ? quotient + 1n : quotient;
  }
  // HALF_EVEN: a strict tie rounds to the even quotient.
  if (twiceRemainder > denominator) {
    return quotient + 1n;
  }
  if (twiceRemainder < denominator) {
    return quotient;
  }
  return quotient % 2n === 0n ? quotient : quotient + 1n;
}

/**
 * §30.3, verbatim, over locked facts:
 *
 * ```
 * new_qty   = old_qty + received_base_qty
 * new_value = (old_qty * old_avg) + (received_base_qty * received_unit_cost)
 * new_avg   = new_qty == 0 ? received_unit_cost
 *                          : round_half_up(new_value / new_qty)
 * ```
 *
 * A `null` old average contributes zero *value* (never a fabricated cost): the
 * plan's formula is exactly what an uncosted prior lot is worth in the fold,
 * and the resulting average is then erected from the received cost alone — the
 * same rule the zero-quantity arm expresses. When the fold leaves the level
 * empty (all stock left through this one movement), the plan's own zero arm is
 * the answer: the next receipt erects its average from *its* offered cost.
 */
export function computeMovingAverage(input: {
  readonly basis: CostingBasisFacts;
  readonly receivedQuantity: bigint;
  readonly receivedUnitCostMinor: bigint | null;
  readonly roundingMode: RoundingMode;
}): bigint | null {
  const { basis, receivedQuantity, receivedUnitCostMinor, roundingMode } = input;
  const newQuantity = basis.quantity + receivedQuantity;
  const oldQuantity = basis.quantity;
  const oldValue = basis.averageCostMinor === null || oldQuantity === 0n ? 0n : oldQuantity * basis.averageCostMinor;
  const receivedValue =
    receivedUnitCostMinor === null || receivedQuantity === 0n ? 0n : receivedQuantity * receivedUnitCostMinor;
  const newValue = oldValue + receivedValue;

  if (newQuantity === 0n) {
    // §30.3's explicit zero arm: an empty level carries the basis the fold
    // itself just named (the received cost), else the basis it had.
    return receivedQuantity === 0n ? basis.averageCostMinor : (receivedUnitCostMinor ?? basis.averageCostMinor);
  }
  return roundDivHalfUpStyle(newValue, newQuantity, roundingMode);
}

/**
 * The level's inventory value under the approved costing method (§30.2's
 * remaining-valuation rule): `quantity × average`, an exact integer product of
 * minor units. An absent average is an unproven valuation — `null`, never a
 * fabricated zero (the mission's "no cost estimate as a settled result").
 */
export function inventoryValueMinor(quantity: bigint, averageCostMinor: bigint | null): bigint | null {
  if (averageCostMinor === null) {
    return null;
  }
  return quantity * averageCostMinor;
}

/**
 * The average the valuation consumer may publish (§30.8: the server's own
 * figure, never a device estimate): a non-negative average and the §30.6
 * rounding bounds at most at the §30.1 width, because a weighted average can
 * never exceed the larger of its inputs. A defensive re-check, not a rounding.
 */
export function isRepresentableAverageCost(averageCostMinor: bigint): boolean {
  return averageCostMinor >= 0n && averageCostMinor <= 999_999_999_999n;
}
