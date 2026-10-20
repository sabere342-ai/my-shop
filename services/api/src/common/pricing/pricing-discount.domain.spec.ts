/**
 * M3-S3 acceptance — the §18 discount machinery inside the pure pricing
 * domain (Master Plan §17.3, §18, §30.1/§30.6; §40.7 row M3-S3).
 *
 * No database, no framework, no clock — exactly the deterministic decision
 * rules both enforcement points share (§36.2, §38.19). The matrix:
 *
 *  1. **PERCENTAGE (§18.1)** — exact decimal interpretation (no binary float
 *     anywhere, §30.1), the 0–100 range, the §18.2 percentage ceiling, the
 *     §30.6 single-division rounding under both rounding modes, and 18-digit
 *     minor-unit exactness.
 *  2. **FIXED_AMOUNT (§18.1)** — zero, one minor unit, free, and boundary
 *     amounts; the §18.2 amount ceiling; a discount never exceeding the price
 *     it discounts.
 *  3. **FIXED_PRICE (§18.1)** — the applied price is the amount; the ceiling
 *     compares the **computed reduction** (a small final price is never a
 *     small discount); an above-list amount is refused (an increase is not a
 *     discount).
 *  4. **Authority (§18.2 step 4)** — the effective `pricing.discount.apply`
 *     set, the `discount_allowed_for_salesperson` rule keyed on the
 *     server-resolved `salesperson` role key, and deny-over-allow (§11.4).
 *  5. **Approval gate (§18.2 step 5)** — strictly above the threshold; a
 *     non-approver receives `DISCOUNT_APPROVAL_REQUIRED` (never a pending
 *     sale); approval is never an input.
 *  6. **Below cost (§18.4)** — `block_discount_below_cost` decides flag or
 *     refusal, strictly below a *known* cost, and approval does not lift the
 *     block.
 *  7. **Mode gating (§17.1–§17.3)** — the discount offer is meaningful in
 *     exactly one mode.
 *  8. **§17.4 hint discipline** — the applied price is derived server-side;
 *     a contradicting hint is a request-shape refusal.
 *  9. **Offline reconciliation (§38.19)** — drift flagging with untouched
 *     snapshots, refusal only for structural corruption, and the
 *     online-refusal/offline-drift determinism of the shared classifier.
 */

import { DomainError } from '../errors/domain.error';
import { ERROR_CODES, statusForCode } from '../errors/problem';
import {
  PRICING_POLICY_CONTRACT_VERSION,
  type DiscountPolicyFacts,
  type PricingPolicyInput,
  type SaleLinePriceOffer,
} from './pricing.contract';
import { evaluateSaleLinePricing, reconcileOfflineSaleLinePricing } from './pricing.domain';

/** The default §18.2 policy: 20% ceiling, 1000 minor-unit amount ceiling, gate off. */
const BASE_DISCOUNT_POLICY: DiscountPolicyFacts = {
  maxDiscountPercentageScaled: 2000n,
  maxDiscountAmountMinor: 1000n,
  discountApprovalThresholdMinor: null,
  discountAllowedForSalesperson: false,
  blockDiscountBelowCost: false,
  roundingMode: 'HALF_UP',
};

const APPLY: readonly string[] = ['pricing.discount.apply', 'pricing.discount.approve', 'sales.create'];
const SALES_CREATE: readonly string[] = ['sales.create'];

/** One policy input over the defaults. */
function policy(over: {
  discount?: Partial<DiscountPolicyFacts>;
  permissions?: readonly string[];
  mode?: 'FIXED' | 'VARIABLE' | 'FIXED_WITH_DISCOUNT';
  actorRoleKey?: string | null;
  deniedPermissions?: readonly string[];
}): PricingPolicyInput {
  return {
    pricingMode: over.mode ?? 'FIXED_WITH_DISCOUNT',
    permissions: over.permissions ?? APPLY,
    ...(over.actorRoleKey === undefined ? {} : { actorRoleKey: over.actorRoleKey }),
    ...(over.deniedPermissions === undefined ? {} : { deniedPermissions: over.deniedPermissions }),
    discount: over.discount === undefined ? BASE_DISCOUNT_POLICY : { ...BASE_DISCOUNT_POLICY, ...over.discount },
  };
}

/** A percentage offer on the standard 2500 list, hint matching the derivation. */
function percentageLine(
  percentage: string,
  applied: bigint,
  over: Partial<SaleLinePriceOffer> = {},
): SaleLinePriceOffer {
  return {
    unitPriceListMinor: 2500n,
    unitPriceAppliedMinor: applied,
    discount: { type: 'PERCENTAGE', percentage },
    ...over,
  };
}

/** A fixed-amount offer on the standard 2500 list, hint matching the derivation. */
function amountLine(amountMinor: string, applied: bigint, over: Partial<SaleLinePriceOffer> = {}): SaleLinePriceOffer {
  return {
    unitPriceListMinor: 2500n,
    unitPriceAppliedMinor: applied,
    discount: { type: 'FIXED_AMOUNT', amountMinor },
    ...over,
  };
}

/** A fixed-price offer on the standard 2500 list, hint matching the amount. */
function priceLine(amountMinor: string, over: Partial<SaleLinePriceOffer> = {}): SaleLinePriceOffer {
  return {
    unitPriceListMinor: 2500n,
    unitPriceAppliedMinor: BigInt(amountMinor),
    discount: { type: 'FIXED_PRICE', amountMinor },
    ...over,
  };
}

function expectDomainError(code: string, run: () => unknown): DomainError {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(DomainError);
  const domainError = thrown as DomainError;
  expect(domainError.code).toBe(code);
  // §34.3 statuses live per code; every discount code is a 403 problem.
  expect(statusForCode(domainError.code)).toBe(statusForCode(code as never));
  return domainError;
}

describe('PERCENTAGE discounts — exact decimals, the §18.2 percentage ceiling (§18.1, §30.1)', () => {
  it('derives the applied price and the decision facts from the offer', () => {
    const outcome = evaluateSaleLinePricing(policy({}), percentageLine('10', 2250n));
    expect(outcome.unitPriceListMinor).toBe(2500n);
    expect(outcome.unitPriceAppliedMinor).toBe(2250n);
    expect(outcome.flags).toEqual([]);
    expect(outcome.discount).toEqual({
      type: 'PERCENTAGE',
      offeredValue: '10',
      discountAmountMinor: 250n,
      approved: false,
      authorizationRef: null,
    });
  });

  it('accepts the exact ceiling percentage and refuses ceiling plus one hundredth', () => {
    expect(evaluateSaleLinePricing(policy({}), percentageLine('20', 2000n)).unitPriceAppliedMinor).toBe(2000n);
    // 20.01% of 2500 is 500.25 → rounds to 500 → applied 1999.
    expectDomainError(ERROR_CODES.DISCOUNT_LIMIT_EXCEEDED, () =>
      evaluateSaleLinePricing(policy({}), percentageLine('20.01', 1999n)),
    );
  });

  it('refuses a positive percentage over a zero ceiling and accepts zero under it', () => {
    const zero = policy({ discount: { maxDiscountPercentageScaled: 0n } });
    expect(evaluateSaleLinePricing(zero, percentageLine('0', 2500n)).flags).toEqual([]);
    // 0.01% of 2500 rounds to 0 — the ceiling is on the *offered percentage* (§18.2).
    expectDomainError(ERROR_CODES.DISCOUNT_LIMIT_EXCEEDED, () =>
      evaluateSaleLinePricing(zero, percentageLine('0.01', 2500n)),
    );
  });

  it('refuses over-100, fractional-over-precision, and malformed percentages as request shape', () => {
    for (const bad of ['100.01', '150', '-5', '1.234', 'abc', '', '1e2', '+5', '.5']) {
      expectDomainError(ERROR_CODES.VALIDATION_FAILED, () =>
        evaluateSaleLinePricing(policy({}), percentageLine(bad, 2250n)),
      );
    }
  });

  it('rounds the single §30.6 division exactly once under HALF_UP and HALF_EVEN', () => {
    // 10% of 985 minor units is 98.5: HALF_UP rounds to 99, HALF_EVEN ties to the even 98.
    const list = 985n;
    const offerLine = (applied: bigint): SaleLinePriceOffer => ({
      unitPriceListMinor: list,
      unitPriceAppliedMinor: applied,
      discount: { type: 'PERCENTAGE', percentage: '10' },
    });
    expect(evaluateSaleLinePricing(policy({}), offerLine(886n)).unitPriceAppliedMinor).toBe(886n);
    expect(
      evaluateSaleLinePricing(policy({ discount: { roundingMode: 'HALF_EVEN' } }), offerLine(887n))
        .unitPriceAppliedMinor,
    ).toBe(887n);
  });

  it('carries 18-digit minor units exactly — no 53-bit or floating-point drift', () => {
    const list = 123456789012345678n; // beyond Number.MAX_SAFE_INTEGER
    const outcome = evaluateSaleLinePricing(policy({ discount: { maxDiscountPercentageScaled: 10000n } }), {
      unitPriceListMinor: list,
      unitPriceAppliedMinor: 0n,
      discount: { type: 'PERCENTAGE', percentage: '100' },
    });
    expect(outcome.discount?.discountAmountMinor).toBe(123456789012345678n);
    expect(outcome.unitPriceAppliedMinor).toBe(0n);
  });

  it('computes a sub-minor discount to zero and keeps the §16.2 identity', () => {
    // 0.01% of 99 is 0.0099 → rounds to 0: the line is unchanged, and the
    // discount amount equals list − applied exactly.
    const outcome = evaluateSaleLinePricing(policy({}), {
      unitPriceListMinor: 99n,
      unitPriceAppliedMinor: 99n,
      discount: { type: 'PERCENTAGE', percentage: '0.01' },
    });
    expect(outcome.discount?.discountAmountMinor).toBe(0n);
    expect(outcome.unitPriceAppliedMinor).toBe(99n);
  });
});

describe('FIXED_AMOUNT discounts — the §18.2 amount ceiling (§18.1)', () => {
  it('accepts zero, one minor unit, the exact ceiling, and the full price', () => {
    expect(evaluateSaleLinePricing(policy({}), amountLine('0', 2500n)).unitPriceAppliedMinor).toBe(2500n);
    expect(evaluateSaleLinePricing(policy({}), amountLine('1', 2499n)).unitPriceAppliedMinor).toBe(2499n);
    expect(evaluateSaleLinePricing(policy({}), amountLine('1000', 1500n)).unitPriceAppliedMinor).toBe(1500n);
    const free = evaluateSaleLinePricing(
      policy({ discount: { maxDiscountAmountMinor: 2500n } }),
      amountLine('2500', 0n),
    );
    expect(free.unitPriceAppliedMinor).toBe(0n);
    expect(free.discount?.discountAmountMinor).toBe(2500n);
  });

  it('refuses ceiling plus one minor unit with the documented code', () => {
    expectDomainError(ERROR_CODES.DISCOUNT_LIMIT_EXCEEDED, () =>
      evaluateSaleLinePricing(policy({}), amountLine('1001', 1499n)),
    );
  });

  it('refuses an amount above the list price — a discount never exceeds what it discounts', () => {
    expectDomainError(ERROR_CODES.DISCOUNT_LIMIT_EXCEEDED, () =>
      evaluateSaleLinePricing(policy({}), amountLine('2501', 0n)),
    );
  });

  it('refuses negative and malformed amounts as request shape', () => {
    for (const bad of ['-1', '1.5', 'abc', '', '1e2', '0.0']) {
      expectDomainError(ERROR_CODES.VALIDATION_FAILED, () =>
        evaluateSaleLinePricing(policy({}), amountLine(bad, 2400n)),
      );
    }
  });
});

describe('FIXED_PRICE discounts — a small final price is never a small discount (§18.1)', () => {
  it('derives applied = amount and the reduction as the discount amount', () => {
    const outcome = evaluateSaleLinePricing(policy({ discount: { maxDiscountAmountMinor: 500n } }), priceLine('2000'));
    expect(outcome.unitPriceAppliedMinor).toBe(2000n);
    expect(outcome.discount?.discountAmountMinor).toBe(500n);
  });

  it('enforces the amount ceiling on the computed reduction', () => {
    expectDomainError(ERROR_CODES.DISCOUNT_LIMIT_EXCEEDED, () =>
      evaluateSaleLinePricing(policy({ discount: { maxDiscountAmountMinor: 400n } }), priceLine('2000')),
    );
  });

  it('refuses a deep cut whose final price is small — the ceiling is on the reduction', () => {
    expectDomainError(ERROR_CODES.DISCOUNT_LIMIT_EXCEEDED, () =>
      evaluateSaleLinePricing(policy({ discount: { maxDiscountAmountMinor: 100n } }), priceLine('1')),
    );
  });

  it('refuses an amount above the list price as an increase, not a discount', () => {
    expectDomainError(ERROR_CODES.DISCOUNT_FORBIDDEN, () =>
      evaluateSaleLinePricing(policy({}), {
        unitPriceListMinor: 2500n,
        unitPriceAppliedMinor: 2600n,
        discount: { type: 'FIXED_PRICE', amountMinor: '2600' },
      }),
    );
  });

  it('accepts a fixed price equal to the list as the zero discount', () => {
    expect(evaluateSaleLinePricing(policy({}), priceLine('2500')).discount?.discountAmountMinor).toBe(0n);
  });
});

describe('Authority — the §18.2 effective set and the salesperson policy (§11.4)', () => {
  it('refuses an actor without the discount authority', () => {
    expectDomainError(ERROR_CODES.DISCOUNT_FORBIDDEN, () =>
      evaluateSaleLinePricing(policy({ permissions: SALES_CREATE }), percentageLine('10', 2250n)),
    );
  });

  it('refuses the salesperson while the organization policy keeps the gate off', () => {
    expectDomainError(ERROR_CODES.DISCOUNT_FORBIDDEN, () =>
      evaluateSaleLinePricing(
        policy({ permissions: SALES_CREATE, actorRoleKey: 'salesperson' }),
        percentageLine('10', 2250n),
      ),
    );
  });

  it('permits the salesperson only when the policy opens the gate — keyed on the server-resolved role key', () => {
    const opened = policy({
      permissions: SALES_CREATE,
      actorRoleKey: 'salesperson',
      discount: { discountAllowedForSalesperson: true },
    });
    expect(evaluateSaleLinePricing(opened, percentageLine('10', 2250n)).unitPriceAppliedMinor).toBe(2250n);
    // A role whose key is not the seeded salesperson preset gains nothing from
    // the policy, whatever its display name.
    const otherRole = policy({
      permissions: SALES_CREATE,
      actorRoleKey: 'manager',
      discount: { discountAllowedForSalesperson: true },
    });
    expectDomainError(ERROR_CODES.DISCOUNT_FORBIDDEN, () =>
      evaluateSaleLinePricing(otherRole, percentageLine('10', 2250n)),
    );
  });

  it('keeps deny-over-allow: an explicit DENY of pricing.discount.apply refuses a policy-permitted salesperson', () => {
    const denied = policy({
      permissions: SALES_CREATE,
      actorRoleKey: 'salesperson',
      deniedPermissions: ['pricing.discount.apply'],
      discount: { discountAllowedForSalesperson: true },
    });
    expectDomainError(ERROR_CODES.DISCOUNT_FORBIDDEN, () =>
      evaluateSaleLinePricing(denied, percentageLine('10', 2250n)),
    );
  });
});

describe('Approval gate — strictly above the threshold, never a pending sale (§18.2 step 5)', () => {
  const threshold = policy({ discount: { discountApprovalThresholdMinor: 250n } });

  it('requires no approval at the threshold', () => {
    const outcome = evaluateSaleLinePricing(threshold, amountLine('250', 2250n));
    expect(outcome.discount?.approved).toBe(false);
  });

  it('refuses one minor unit above with DISCOUNT_APPROVAL_REQUIRED for a non-approver', () => {
    expectDomainError(ERROR_CODES.DISCOUNT_APPROVAL_REQUIRED, () =>
      evaluateSaleLinePricing({ ...threshold, permissions: ['pricing.discount.apply'] }, amountLine('251', 2249n)),
    );
  });

  it('lets an approver satisfy the gate and marks the decision approved for the service-minted reference', () => {
    const outcome = evaluateSaleLinePricing(threshold, amountLine('251', 2249n));
    expect(outcome.discount?.approved).toBe(true);
    // The reference itself is the service's §18.3 mint, not the domain's.
    expect(outcome.discount?.authorizationRef).toBeNull();
  });

  it('leaves the gate off entirely when the threshold is unset', () => {
    const outcome = evaluateSaleLinePricing(
      policy({ discount: { maxDiscountPercentageScaled: 10000n } }),
      percentageLine('100', 0n),
    );
    expect(outcome.discount?.approved).toBe(false);
  });
});

describe('Below cost — the §18.4 discount floor', () => {
  const COST = 1800n;

  it('flags a permitted below-cost discount while the block is off', () => {
    const outcome = evaluateSaleLinePricing(policy({ discount: { maxDiscountAmountMinor: 1000n } }), {
      unitPriceListMinor: 2500n,
      unitPriceAppliedMinor: 1700n,
      unitCostAppliedMinor: COST,
      discount: { type: 'FIXED_AMOUNT', amountMinor: '800' },
    });
    expect(outcome.flags).toEqual(['BELOW_COST']);
  });

  it('refuses the same discount once the block is set, with the limit code', () => {
    expectDomainError(ERROR_CODES.DISCOUNT_LIMIT_EXCEEDED, () =>
      evaluateSaleLinePricing(policy({ discount: { maxDiscountAmountMinor: 1000n, blockDiscountBelowCost: true } }), {
        unitPriceListMinor: 2500n,
        unitPriceAppliedMinor: 1700n,
        unitCostAppliedMinor: COST,
        discount: { type: 'FIXED_AMOUNT', amountMinor: '800' },
      }),
    );
  });

  it('treats at-cost as not below cost', () => {
    const outcome = evaluateSaleLinePricing(
      policy({ discount: { maxDiscountAmountMinor: 700n, blockDiscountBelowCost: true } }),
      {
        unitPriceListMinor: 2500n,
        unitPriceAppliedMinor: COST,
        unitCostAppliedMinor: COST,
        discount: { type: 'FIXED_AMOUNT', amountMinor: '700' },
      },
    );
    expect(outcome.flags).toEqual([]);
  });

  it('invents neither refusal nor flag from an unknown or absent cost', () => {
    for (const known of [false, true]) {
      // Absent (undefined): the comparison is simply unproven. Explicit null:
      // the recorded cost explicitly carries no value. Same honest answer.
      const offer: SaleLinePriceOffer = {
        unitPriceListMinor: 2500n,
        unitPriceAppliedMinor: 1700n,
        ...(known ? { unitCostAppliedMinor: null as bigint | null } : {}),
        discount: { type: 'FIXED_AMOUNT', amountMinor: '800' },
      };
      const outcome = evaluateSaleLinePricing(
        policy({ discount: { maxDiscountAmountMinor: 1000n, blockDiscountBelowCost: true } }),
        offer,
      );
      expect(outcome.flags).toEqual([]);
    }
  });

  it('never refuses against zero cost, however deep the discount', () => {
    const outcome = evaluateSaleLinePricing(
      policy({ discount: { maxDiscountAmountMinor: 2500n, blockDiscountBelowCost: true } }),
      {
        unitPriceListMinor: 2500n,
        unitPriceAppliedMinor: 0n,
        unitCostAppliedMinor: 0n,
        discount: { type: 'FIXED_AMOUNT', amountMinor: '2500' },
      },
    );
    expect(outcome.unitPriceAppliedMinor).toBe(0n);
  });

  it('keeps the block standing under a valid approval', () => {
    expectDomainError(ERROR_CODES.DISCOUNT_LIMIT_EXCEEDED, () =>
      evaluateSaleLinePricing(
        policy({ discount: { maxDiscountAmountMinor: 1000n, blockDiscountBelowCost: true }, permissions: APPLY }),
        {
          unitPriceListMinor: 2500n,
          unitPriceAppliedMinor: 1700n,
          unitCostAppliedMinor: COST,
          discount: { type: 'FIXED_AMOUNT', amountMinor: '800' },
        },
      ),
    );
  });
});

describe('Mode gating and structural wiring (§17.1–§17.3)', () => {
  it('refuses a discount offer in FIXED with the mode alteration code — zero value included', () => {
    expectDomainError(ERROR_CODES.PRICE_OVERRIDE_FORBIDDEN, () =>
      evaluateSaleLinePricing(policy({ mode: 'FIXED', permissions: SALES_CREATE }), percentageLine('0', 2500n)),
    );
  });

  it('refuses a discount offer in VARIABLE — free price entry leaves the offer a double derivation', () => {
    expectDomainError(ERROR_CODES.DISCOUNT_FORBIDDEN, () =>
      evaluateSaleLinePricing(policy({ mode: 'VARIABLE', permissions: SALES_CREATE }), percentageLine('10', 2250n)),
    );
  });

  it('fails closed when the discount policy facts are missing', () => {
    expectDomainError(ERROR_CODES.INTERNAL_ERROR, () =>
      evaluateSaleLinePricing({ pricingMode: 'FIXED_WITH_DISCOUNT', permissions: APPLY }, percentageLine('10', 2250n)),
    );
  });

  it('refuses an applied-price hint that contradicts the server derivation (§17.4)', () => {
    expectDomainError(ERROR_CODES.VALIDATION_FAILED, () =>
      evaluateSaleLinePricing(policy({}), percentageLine('10', 2200n)),
    );
  });

  it('keeps the offer-less manual reduction refusal standing (M3-S2 regression)', () => {
    expectDomainError(ERROR_CODES.PRICE_OVERRIDE_FORBIDDEN, () =>
      evaluateSaleLinePricing(policy({ mode: 'FIXED_WITH_DISCOUNT', permissions: ['pricing.override', ...APPLY] }), {
        unitPriceListMinor: 2500n,
        unitPriceAppliedMinor: 2000n,
      }),
    );
  });

  it('refuses an unknown discount type as request shape', () => {
    expectDomainError(ERROR_CODES.VALIDATION_FAILED, () =>
      evaluateSaleLinePricing(policy({}), {
        unitPriceListMinor: 2500n,
        unitPriceAppliedMinor: 2250n,
        discount: { type: 'HYPERDISCOUNT', amountMinor: '250' } as never,
      }),
    );
  });

  it('still refuses structural money corruption before any policy logic', () => {
    expectDomainError(ERROR_CODES.VALIDATION_FAILED, () =>
      evaluateSaleLinePricing(policy({}), {
        unitPriceListMinor: 2500n,
        unitPriceAppliedMinor: -1n,
        discount: { type: 'FIXED_AMOUNT', amountMinor: '100' },
      }),
    );
  });

  it('carries the bumped decision contract version', () => {
    expect(PRICING_POLICY_CONTRACT_VERSION).toBe(2);
  });
});

describe('Offline reconciliation (§38.19) — drift, never a silent reprice', () => {
  it('flags a previously valid discount once the ceiling has tightened, with the snapshot untouched', () => {
    const line = percentageLine('10', 2250n);
    const outcome = reconcileOfflineSaleLinePricing(policy({ discount: { maxDiscountPercentageScaled: 0n } }), line);
    expect(outcome.flags).toEqual(['PRICING_POLICY_DRIFT']);
    expect(outcome.unitPriceListMinor).toBe(2500n);
    expect(outcome.unitPriceAppliedMinor).toBe(2250n);
    expect(outcome.discount?.discountAmountMinor).toBe(250n);
  });

  it('flags a discount whose actor no longer holds the authority, and one that now crosses the approval gate', () => {
    expect(
      reconcileOfflineSaleLinePricing(policy({ permissions: SALES_CREATE }), percentageLine('10', 2250n)).flags,
    ).toEqual(['PRICING_POLICY_DRIFT']);
    expect(
      reconcileOfflineSaleLinePricing(
        policy({
          permissions: ['pricing.discount.apply', 'sales.create'],
          discount: { discountApprovalThresholdMinor: 100n },
        }),
        percentageLine('10', 2250n),
      ).flags,
    ).toEqual(['PRICING_POLICY_DRIFT']);
  });

  it('stays silent when the policy loosened — no compensating mutation', () => {
    const line = percentageLine('10', 2250n);
    const outcome = reconcileOfflineSaleLinePricing(
      policy({ discount: { maxDiscountPercentageScaled: 10000n } }),
      line,
    );
    expect(outcome.flags).toEqual([]);
  });

  it('flags a rounding-mode change instead of silently repricing the recorded line', () => {
    // Recorded under HALF_UP (98.5 → 99); the server now rounds HALF_EVEN (98).
    const outcome = reconcileOfflineSaleLinePricing(policy({ discount: { roundingMode: 'HALF_EVEN' } }), {
      unitPriceListMinor: 985n,
      unitPriceAppliedMinor: 886n,
      discount: { type: 'PERCENTAGE', percentage: '10' },
    });
    expect(outcome.unitPriceAppliedMinor).toBe(886n);
    expect(outcome.flags).toEqual(['PRICING_POLICY_DRIFT']);
  });

  it('accepts a recorded line whose price matches the current rounding exactly', () => {
    const outcome = reconcileOfflineSaleLinePricing(policy({}), percentageLine('10', 2250n));
    expect(outcome.flags).toEqual([]);
    expect(outcome.unitPriceAppliedMinor).toBe(2250n);
  });

  it('refuses a recorded line that violates the §16.2 identity — corruption, not drift', () => {
    expectDomainError(ERROR_CODES.VALIDATION_FAILED, () =>
      reconcileOfflineSaleLinePricing(policy({}), {
        unitPriceListMinor: 2500n,
        unitPriceAppliedMinor: 1800n,
        discount: { type: 'FIXED_AMOUNT', amountMinor: '500' },
      }),
    );
  });

  it('refuses a recorded percentage outside either rounding result — corruption, not drift', () => {
    expectDomainError(ERROR_CODES.VALIDATION_FAILED, () =>
      reconcileOfflineSaleLinePricing(policy({}), {
        unitPriceListMinor: 2500n,
        unitPriceAppliedMinor: 2100n,
        discount: { type: 'PERCENTAGE', percentage: '10' },
      }),
    );
  });

  it('refuses a recorded fixed price above the list — no policy version ever permitted it', () => {
    expectDomainError(ERROR_CODES.VALIDATION_FAILED, () =>
      reconcileOfflineSaleLinePricing(policy({}), {
        unitPriceListMinor: 2500n,
        unitPriceAppliedMinor: 2600n,
        discount: { type: 'FIXED_PRICE', amountMinor: '2600' },
      }),
    );
  });

  it('refuses a malformed recorded discount value — the availability rule is not a hostile-payload rule', () => {
    expectDomainError(ERROR_CODES.VALIDATION_FAILED, () =>
      reconcileOfflineSaleLinePricing(policy({}), {
        unitPriceListMinor: 2500n,
        unitPriceAppliedMinor: 2250n,
        discount: { type: 'PERCENTAGE', percentage: 'banana' },
      }),
    );
  });

  it('answers the online refusal and the offline flag from the same policy facts (determinism)', () => {
    const tightened = policy({ discount: { maxDiscountAmountMinor: 100n } });
    const line = amountLine('900', 1600n);
    expectDomainError(ERROR_CODES.DISCOUNT_LIMIT_EXCEEDED, () => evaluateSaleLinePricing(tightened, line));
    // Same facts, same line: the online boundary refuses and the
    // reconciliation flags — one classifier, two enforcement points (§38.19).
    const offline = reconcileOfflineSaleLinePricing(tightened, line);
    expect(offline.flags).toEqual(['PRICING_POLICY_DRIFT']);
    expect(offline.unitPriceAppliedMinor).toBe(1600n);
  });

  it('answers identically for repeated reconciliations under identical facts', () => {
    const line = percentageLine('10', 2250n);
    const first = reconcileOfflineSaleLinePricing(policy({}), line);
    const second = reconcileOfflineSaleLinePricing(policy({}), line);
    expect(second).toEqual(first);
  });
});
