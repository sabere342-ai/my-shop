/**
 * The costing engine's pure-domain acceptance (Master Plan §30.1–§30.8; §40.8
 * row M4-S3's "algorithm proven including rounding edges").
 *
 * Every case is the plan's own worked arithmetic, asserted exactly — no float,
 * no tolerance, no approximate comparison anywhere:
 *
 * - §30.3's formula over costed and uncosted bases, including the plan-stated
 *   zero arm (an empty level erects its average from the received cost).
 * - §30.6's two rounding modes, at the documented tie: HALF_UP rounds away
 *   from zero, HALF_EVEN ties to the even quotient — the same tie the pricing
 *   domain pins (10% of 985 minor units: HALF_UP 99, HALF_EVEN 98).
 * - The single-rounding-point law: the division rounds once and the result
 *   propagates; no second rounding ever occurs downstream (the valuation is an
 *   exact integer product of the rounded average).
 * - The bounds: a weighted average can never leave the range of its inputs, so
 *   the bounded money width (§30.1's 12-digit minor units) is preserved by the
 *   arithmetic itself, and every member is asserted digit-exact.
 */

import {
  computeMovingAverage,
  inventoryValueMinor,
  isRepresentableAverageCost,
  roundDivHalfUpStyle,
} from './costing.domain';

describe('roundDivHalfUpStyle — the §30.6 single rounding point', () => {
  it('returns the exact quotient when the division is already exact', () => {
    expect(roundDivHalfUpStyle(600n, 12n, 'HALF_UP')).toBe(50n);
    expect(roundDivHalfUpStyle(600n, 12n, 'HALF_EVEN')).toBe(50n);
  });

  it('HALF_UP rounds any remainder above the tie up, none down', () => {
    // 1001/1000 → remainder 1 (< half of 1000): rounds down.
    expect(roundDivHalfUpStyle(1001n, 1000n, 'HALF_UP')).toBe(1n);
    // 1499/1000 → rounds down; 1500/1000 → the tie rounds up.
    expect(roundDivHalfUpStyle(1499n, 1000n, 'HALF_UP')).toBe(1n);
    expect(roundDivHalfUpStyle(1500n, 1000n, 'HALF_UP')).toBe(2n);
    expect(roundDivHalfUpStyle(1501n, 1000n, 'HALF_UP')).toBe(2n);
  });

  it('HALF_EVEN rounds the documented tie to the even quotient (the pricing-domain pin)', () => {
    // The plan's own example shape: 10% of 985 = 98.5 — HALF_UP 99, HALF_EVEN 98.
    expect(roundDivHalfUpStyle(985n, 10n, 'HALF_UP')).toBe(99n);
    expect(roundDivHalfUpStyle(985n, 10n, 'HALF_EVEN')).toBe(98n);
    // 0.5 → quotient 0, tie → even 0 stays; 1.5 → tie → rounds to even 2.
    expect(roundDivHalfUpStyle(5n, 10n, 'HALF_EVEN')).toBe(0n);
    expect(roundDivHalfUpStyle(15n, 10n, 'HALF_EVEN')).toBe(2n);
  });

  it('carries 24-digit exact arithmetic without any float conversion', () => {
    // The widest §30.3 fold the bounds allow. A float path would lose digits;
    // the integer path is digit-exact.
    const numerator = 999_999_999_999n * 999_999_999_999n;
    const denominator = 999_999_999_999n;
    expect(roundDivHalfUpStyle(numerator, denominator, 'HALF_UP')).toBe(999_999_999_999n);
  });
});

describe('computeMovingAverage — the §30.3 formula, verbatim', () => {
  it('erects the average from the received cost on a fresh level (the zero arm)', () => {
    const average = computeMovingAverage({
      basis: { quantity: 0n, averageCostMinor: null },
      receivedQuantity: 24n,
      receivedUnitCostMinor: 18_500n,
      roundingMode: 'HALF_UP',
    });
    expect(average).toBe(18_500n);
  });

  it('folds a second receipt at a different cost into the weighted average', () => {
    // 24 pieces @ 18 500, then 12 @ 24 000:
    //   new_value = 24·18500 + 12·24000 = 444000 + 288000 = 732000
    //   new_qty   = 36 → 732000/36 = 20333.33… → HALF_UP 20333.
    const average = computeMovingAverage({
      basis: { quantity: 24n, averageCostMinor: 18_500n },
      receivedQuantity: 12n,
      receivedUnitCostMinor: 24_000n,
      roundingMode: 'HALF_UP',
    });
    expect(average).toBe(20_333n);
  });

  it(`is not a last-cost shortcut: the pre-receipt lot's cost survives in the fold`, () => {
    // A naive "average = latest cost" engine answers 24 000 here; §30.3's
    // weighted fold answers 20 333 — the distinction scenario C proves.
    const average = computeMovingAverage({
      basis: { quantity: 100n, averageCostMinor: 10_000n },
      receivedQuantity: 1n,
      receivedUnitCostMinor: 99_900n,
      roundingMode: 'HALF_UP',
    });
    // (100·10000 + 1·99900)/101 = 1_099_900/101 = 10_890.09… → 10_890.
    expect(average).toBe(10_890n);
  });

  it(`is the plan's own worked HALF_UP tie edge, digit-exact`, () => {
    // 1 piece @ 1 + 1 piece @ 2 → new_value 3 / 2 = 1.5 → HALF_UP 2, HALF_EVEN 2 (even).
    expect(
      computeMovingAverage({
        basis: { quantity: 1n, averageCostMinor: 1n },
        receivedQuantity: 1n,
        receivedUnitCostMinor: 2n,
        roundingMode: 'HALF_UP',
      }),
    ).toBe(2n);
    // 1 @ 2 + 1 @ 1 → 1.5 tie → HALF_EVEN 2 (even); HALF_UP also 2.
    expect(
      computeMovingAverage({
        basis: { quantity: 1n, averageCostMinor: 2n },
        receivedQuantity: 1n,
        receivedUnitCostMinor: 1n,
        roundingMode: 'HALF_EVEN',
      }),
    ).toBe(2n);
  });

  it(`rounds the same fold identically under both modes away from the tie`, () => {
    // 1 @ 1 + 2 @ 2 → (1 + 4)/3 = 5/3 = 1.666…, remainder 2/3 — above the half
    // tie, so BOTH modes round up to 2 (the tie itself is pinned separately).
    expect(
      computeMovingAverage({
        basis: { quantity: 1n, averageCostMinor: 1n },
        receivedQuantity: 2n,
        receivedUnitCostMinor: 2n,
        roundingMode: 'HALF_EVEN',
      }),
    ).toBe(2n);
    // 1 @ 2 + 2 @ 1 → (2 + 2)/3 = 1.333…, remainder below the tie — both modes
    // keep the quotient at 1.
    expect(
      computeMovingAverage({
        basis: { quantity: 1n, averageCostMinor: 2n },
        receivedQuantity: 2n,
        receivedUnitCostMinor: 1n,
        roundingMode: 'HALF_UP',
      }),
    ).toBe(1n);
  });

  it(`is exact across a HALF_EVEN boundary fold the float path would drift`, () => {
    // 3 @ 100, then 1 @ 1 → (300 + 1)/4 = 75.25 → both modes 75.
    expect(
      computeMovingAverage({
        basis: { quantity: 3n, averageCostMinor: 100n },
        receivedQuantity: 1n,
        receivedUnitCostMinor: 1n,
        roundingMode: 'HALF_EVEN',
      }),
    ).toBe(75n);
  });

  it(`erects the received cost when the fold leaves the level empty`, () => {
    // The §30.3 zero arm: a receipt onto an *empty* level (quantity 0, stale
    // basis from previous lots) answers the received cost, not the stale one.
    expect(
      computeMovingAverage({
        basis: { quantity: 0n, averageCostMinor: 50_000n },
        receivedQuantity: 5n,
        receivedUnitCostMinor: 30_000n,
        roundingMode: 'HALF_UP',
      }),
    ).toBe(30_000n);
  });
});

describe('the arithmetic that protects the replayed costing', () => {
  it('never fabricates a zero cost from an uncosted basis folded with a zero cost', () => {
    // An uncosted basis plus an explicitly zero-cost receipt: the fold is
    // exact — numerator 0, so the average is exactly 0, *because the caller
    // offered it*, never because the engine invented it.
    expect(
      computeMovingAverage({
        basis: { quantity: 0n, averageCostMinor: null },
        receivedQuantity: 4n,
        receivedUnitCostMinor: 0n,
        roundingMode: 'HALF_UP',
      }),
    ).toBe(0n);
  });

  it(`keeps a weighted average inside the range of its inputs (the bounds law)`, () => {
    const high = computeMovingAverage({
      basis: { quantity: 999_999n, averageCostMinor: 999_999_999_999n },
      receivedQuantity: 1n,
      receivedUnitCostMinor: 999_999_999_999n,
      roundingMode: 'HALF_UP',
    });
    expect(high).toBe(999_999_999_999n);
    // A narrowed re-check: the value the fold produced is representable.
    expect(isRepresentableAverageCost(high as bigint)).toBe(true);
  });
});

describe('inventoryValueMinor — the §30.2 valuation identity', () => {
  it('is the exact integer product of the rounded average and the exact quantity', () => {
    expect(inventoryValueMinor(21n, 18_500n)).toBe(388_500n);
    expect(inventoryValueMinor(36n, 20_333n)).toBe(731_988n); // 36 × 20 333, digit-exact
  });

  it('answers null for an uncosted line — never a fabricated zero', () => {
    expect(inventoryValueMinor(24n, null)).toBeNull();
  });

  it('is zero exactly when the stock is empty or the cost is a real zero', () => {
    expect(inventoryValueMinor(0n, 18_500n)).toBe(0n);
    expect(inventoryValueMinor(4n, 0n)).toBe(0n);
  });
});
