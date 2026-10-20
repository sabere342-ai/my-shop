/**
 * The pure pricing-policy domain's acceptance matrix (Master Plan §17.1–§17.4,
 * §30.1, §38.19, §36.2; §40.7 row M3-S2).
 *
 * Every check here is a unit: no database, no framework, no Prisma, no clock.
 * The matrix pins the four jobs the domain exists for — structural minor-unit
 * validation, per-mode enforcement with the documented refusals, below-cost
 * flagging, and the §38.19 offline reconciliation that flags drift instead of
 * refusing a completed sale. The database acceptance suite (`pricing-policy
 * .db-spec.ts`) proves the same rules through the transactional service
 * against real PostgreSQL; this suite is the decision's own.
 */

import { DomainError } from '../errors/domain.error';
import { ERROR_CODES, statusForCode } from '../errors/problem';
import { PRICING_POLICY_CONTRACT_VERSION, type PricingFlagValue } from './pricing.contract';
import { evaluateSaleLinePricing, reconcileOfflineSaleLinePricing } from './pricing.domain';

/** Effective permissions shapes the suite resolves lines under. */
const SALES_CREATE = Object.freeze(['sales.create']);
const SALES_CREATE_AND_OVERRIDE = Object.freeze(['sales.create', 'pricing.override']);
const OVERRIDE_ONLY = Object.freeze(['pricing.override']);
const NO_PERMISSIONS = Object.freeze([] as readonly string[]);

function expectDomainError(code: string, run: () => unknown): void {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(DomainError);
  expect((thrown as DomainError).code).toBe(code);
}

describe('FIXED mode (§17.1)', () => {
  it('accepts an applied price exactly equal to the list price with any permission set', () => {
    expect(
      evaluateSaleLinePricing(
        { pricingMode: 'FIXED', permissions: NO_PERMISSIONS },
        { unitPriceListMinor: 2500n, unitPriceAppliedMinor: 2500n },
      ),
    ).toEqual({
      unitPriceListMinor: 2500n,
      unitPriceAppliedMinor: 2500n,
      flags: [],
    });
  });

  it('accepts a differing applied price for an actor holding pricing.override', () => {
    expect(
      evaluateSaleLinePricing(
        { pricingMode: 'FIXED', permissions: SALES_CREATE_AND_OVERRIDE },
        { unitPriceListMinor: 2500n, unitPriceAppliedMinor: 2000n },
      ),
    ).toEqual({
      unitPriceListMinor: 2500n,
      unitPriceAppliedMinor: 2000n,
      flags: [],
    });
  });

  it('refuses a cheaper applied price with 403 PRICE_OVERRIDE_FORBIDDEN without the override permission', () => {
    expectDomainError(ERROR_CODES.PRICE_OVERRIDE_FORBIDDEN, () =>
      evaluateSaleLinePricing(
        { pricingMode: 'FIXED', permissions: SALES_CREATE },
        { unitPriceListMinor: 2500n, unitPriceAppliedMinor: 2400n },
      ),
    );
    expect(statusForCode(ERROR_CODES.PRICE_OVERRIDE_FORBIDDEN)).toBe(403);
  });

  it('refuses a more expensive applied price with the same refusal — an increase is also an alteration', () => {
    expectDomainError(ERROR_CODES.PRICE_OVERRIDE_FORBIDDEN, () =>
      evaluateSaleLinePricing(
        { pricingMode: 'FIXED', permissions: SALES_CREATE },
        { unitPriceListMinor: 2500n, unitPriceAppliedMinor: 2600n },
      ),
    );
  });

  it('permits an alteration for an actor whose only relevant grant is the override permission itself', () => {
    // The override permission alone permits the alteration; the price-entry
    // authority is the sale entry point's own check (§17.4 layering).
    expect(
      evaluateSaleLinePricing(
        { pricingMode: 'FIXED', permissions: OVERRIDE_ONLY },
        { unitPriceListMinor: 2500n, unitPriceAppliedMinor: 1000n },
      ),
    ).toEqual({
      unitPriceListMinor: 2500n,
      unitPriceAppliedMinor: 1000n,
      flags: [],
    });
  });

  it('flags BELOW_COST when an overridden line sells below the known cost', () => {
    const outcome = evaluateSaleLinePricing(
      { pricingMode: 'FIXED', permissions: SALES_CREATE_AND_OVERRIDE },
      { unitPriceListMinor: 2500n, unitPriceAppliedMinor: 1000n, unitCostAppliedMinor: 1800n },
    );
    expect(outcome.flags).toEqual(['BELOW_COST']);
  });

  it('accepts a one-minor-unit drift refusal — the boundary is exact, not tolerant', () => {
    expectDomainError(ERROR_CODES.PRICE_OVERRIDE_FORBIDDEN, () =>
      evaluateSaleLinePricing(
        { pricingMode: 'FIXED', permissions: NO_PERMISSIONS },
        { unitPriceListMinor: 2500n, unitPriceAppliedMinor: 2499n },
      ),
    );
    expectDomainError(ERROR_CODES.PRICE_OVERRIDE_FORBIDDEN, () =>
      evaluateSaleLinePricing(
        { pricingMode: 'FIXED', permissions: NO_PERMISSIONS },
        { unitPriceListMinor: 2500n, unitPriceAppliedMinor: 2501n },
      ),
    );
  });
});

describe('VARIABLE mode (§17.2)', () => {
  it('accepts any applied price for an actor holding sales.create, without the override permission', () => {
    expect(
      evaluateSaleLinePricing(
        { pricingMode: 'VARIABLE', permissions: SALES_CREATE },
        { unitPriceListMinor: 2500n, unitPriceAppliedMinor: 1900n },
      ),
    ).toEqual({
      unitPriceListMinor: 2500n,
      unitPriceAppliedMinor: 1900n,
      flags: [],
    });
  });

  it('keeps the list and applied values distinct — the hint never overwrites the snapshot', () => {
    const outcome = evaluateSaleLinePricing(
      { pricingMode: 'VARIABLE', permissions: SALES_CREATE },
      { unitPriceListMinor: 2500n, unitPriceAppliedMinor: 1999n },
    );
    expect(outcome.unitPriceListMinor).toBe(2500n);
    expect(outcome.unitPriceAppliedMinor).toBe(1999n);
  });

  it('refuses an actor without sales.create with 403 PERMISSION_DENIED', () => {
    expectDomainError(ERROR_CODES.PERMISSION_DENIED, () =>
      evaluateSaleLinePricing(
        { pricingMode: 'VARIABLE', permissions: OVERRIDE_ONLY },
        { unitPriceListMinor: 2500n, unitPriceAppliedMinor: 2500n },
      ),
    );
    expect(statusForCode(ERROR_CODES.PERMISSION_DENIED)).toBe(403);
  });

  it('flags no BELOW_COST for a price exactly at the known cost — the flag is for a strict loss', () => {
    const outcome = evaluateSaleLinePricing(
      { pricingMode: 'VARIABLE', permissions: SALES_CREATE },
      { unitPriceListMinor: 2500n, unitPriceAppliedMinor: 1800n, unitCostAppliedMinor: 1800n },
    );
    // Exactly-at-cost is not below cost: the flag is for a strict loss.
    expect(outcome.flags).toEqual([]);
  });

  it('flags BELOW_COST one minor unit under the cost and not at it', () => {
    const atCost = evaluateSaleLinePricing(
      { pricingMode: 'VARIABLE', permissions: SALES_CREATE },
      { unitPriceListMinor: 2500n, unitPriceAppliedMinor: 1800n, unitCostAppliedMinor: 1800n },
    );
    const underCost = evaluateSaleLinePricing(
      { pricingMode: 'VARIABLE', permissions: SALES_CREATE },
      { unitPriceListMinor: 2500n, unitPriceAppliedMinor: 1799n, unitCostAppliedMinor: 1800n },
    );
    expect(atCost.flags).toEqual([]);
    expect(underCost.flags).toEqual(['BELOW_COST']);
  });

  it('invents no BELOW_COST flag when the cost is unknown', () => {
    expect(
      evaluateSaleLinePricing(
        { pricingMode: 'VARIABLE', permissions: SALES_CREATE },
        { unitPriceListMinor: 2500n, unitPriceAppliedMinor: 100n },
      ).flags,
    ).toEqual([]);
    expect(
      evaluateSaleLinePricing(
        { pricingMode: 'VARIABLE', permissions: SALES_CREATE },
        { unitPriceListMinor: 2500n, unitPriceAppliedMinor: 100n, unitCostAppliedMinor: null },
      ).flags,
    ).toEqual([]);
  });

  it('never flags BELOW_COST against a zero cost for a non-negative price', () => {
    expect(
      evaluateSaleLinePricing(
        { pricingMode: 'VARIABLE', permissions: SALES_CREATE },
        { unitPriceListMinor: 2500n, unitPriceAppliedMinor: 1200n, unitCostAppliedMinor: 0n },
      ).flags,
    ).toEqual([]);
  });

  it('flags BELOW_COST for a free line with a real cost', () => {
    expect(
      evaluateSaleLinePricing(
        { pricingMode: 'VARIABLE', permissions: SALES_CREATE },
        { unitPriceListMinor: 2500n, unitPriceAppliedMinor: 0n, unitCostAppliedMinor: 1800n },
      ).flags,
    ).toEqual(['BELOW_COST']);
  });
});

describe('FIXED_WITH_DISCOUNT mode (§17.3; §18 is M3-S3)', () => {
  it('accepts an applied price exactly equal to the list price with any permission set', () => {
    expect(
      evaluateSaleLinePricing(
        { pricingMode: 'FIXED_WITH_DISCOUNT', permissions: NO_PERMISSIONS },
        { unitPriceListMinor: 5000n, unitPriceAppliedMinor: 5000n },
      ),
    ).toEqual({
      unitPriceListMinor: 5000n,
      unitPriceAppliedMinor: 5000n,
      flags: [],
    });
  });

  it('refuses a reduction below the list price to every actor in this slice — including the owner-shaped override holder', () => {
    for (const permissions of [SALES_CREATE, SALES_CREATE_AND_OVERRIDE, OVERRIDE_ONLY]) {
      expectDomainError(ERROR_CODES.PRICE_OVERRIDE_FORBIDDEN, () =>
        evaluateSaleLinePricing(
          { pricingMode: 'FIXED_WITH_DISCOUNT', permissions },
          { unitPriceListMinor: 5000n, unitPriceAppliedMinor: 4500n },
        ),
      );
    }
  });

  it('refuses an increase over the list price without pricing.override', () => {
    expectDomainError(ERROR_CODES.PRICE_OVERRIDE_FORBIDDEN, () =>
      evaluateSaleLinePricing(
        { pricingMode: 'FIXED_WITH_DISCOUNT', permissions: SALES_CREATE },
        { unitPriceListMinor: 5000n, unitPriceAppliedMinor: 5100n },
      ),
    );
  });

  it('accepts an increase over the list price for an override holder', () => {
    expect(
      evaluateSaleLinePricing(
        { pricingMode: 'FIXED_WITH_DISCOUNT', permissions: SALES_CREATE_AND_OVERRIDE },
        { unitPriceListMinor: 5000n, unitPriceAppliedMinor: 5100n },
      ),
    ).toEqual({
      unitPriceListMinor: 5000n,
      unitPriceAppliedMinor: 5100n,
      flags: [],
    });
  });

  it('flags BELOW_COST for an overridden increase that still sells below a raised cost snapshot', () => {
    const outcome = evaluateSaleLinePricing(
      { pricingMode: 'FIXED_WITH_DISCOUNT', permissions: SALES_CREATE_AND_OVERRIDE },
      { unitPriceListMinor: 5000n, unitPriceAppliedMinor: 5200n, unitCostAppliedMinor: 5500n },
    );
    expect(outcome.flags).toEqual(['BELOW_COST']);
  });
});

describe('structural minor-unit validation (§30.1)', () => {
  it('refuses a negative applied price with VALIDATION_FAILED, naming the field', () => {
    try {
      evaluateSaleLinePricing(
        { pricingMode: 'VARIABLE', permissions: SALES_CREATE },
        { unitPriceListMinor: 2500n, unitPriceAppliedMinor: -1n },
      );
      throw new Error('the refusal did not throw');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      const domainError = error as DomainError;
      expect(domainError.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect(domainError.errors?.[0]?.field).toBe('unitPriceAppliedMinor');
    }
  });

  it('treats a negative stored list price as server data corruption (INTERNAL_ERROR), not a client fault', () => {
    expectDomainError(ERROR_CODES.INTERNAL_ERROR, () =>
      evaluateSaleLinePricing(
        { pricingMode: 'VARIABLE', permissions: SALES_CREATE },
        { unitPriceListMinor: -1n, unitPriceAppliedMinor: 0n },
      ),
    );
  });

  it('treats a negative snapshotted cost as server data corruption (INTERNAL_ERROR)', () => {
    expectDomainError(ERROR_CODES.INTERNAL_ERROR, () =>
      evaluateSaleLinePricing(
        { pricingMode: 'VARIABLE', permissions: SALES_CREATE },
        { unitPriceListMinor: 2500n, unitPriceAppliedMinor: 2500n, unitCostAppliedMinor: -5n },
      ),
    );
  });

  it('refuses structural corruption before any policy logic, in every mode', () => {
    for (const pricingMode of ['FIXED', 'VARIABLE', 'FIXED_WITH_DISCOUNT'] as const) {
      expectDomainError(ERROR_CODES.VALIDATION_FAILED, () =>
        evaluateSaleLinePricing(
          { pricingMode, permissions: SALES_CREATE },
          { unitPriceListMinor: 0n, unitPriceAppliedMinor: -1n },
        ),
      );
    }
  });

  it('accepts zero list and zero applied price as the legal degenerate line', () => {
    expect(
      evaluateSaleLinePricing(
        { pricingMode: 'FIXED', permissions: NO_PERMISSIONS },
        { unitPriceListMinor: 0n, unitPriceAppliedMinor: 0n },
      ),
    ).toEqual({
      unitPriceListMinor: 0n,
      unitPriceAppliedMinor: 0n,
      flags: [],
    });
  });

  it('compares 18-digit money exactly — bigint, never float folding', () => {
    const list = 999999999999999999n;
    const outcome = evaluateSaleLinePricing(
      { pricingMode: 'VARIABLE', permissions: SALES_CREATE },
      { unitPriceListMinor: list, unitPriceAppliedMinor: list - 1n },
    );
    expect(outcome.unitPriceAppliedMinor).toBe(list - 1n);
    expectDomainError(ERROR_CODES.PRICE_OVERRIDE_FORBIDDEN, () =>
      evaluateSaleLinePricing(
        { pricingMode: 'FIXED', permissions: NO_PERMISSIONS },
        { unitPriceListMinor: list, unitPriceAppliedMinor: list - 1n },
      ),
    );
  });
});

describe('offline reconciliation (§38.19)', () => {
  it('flags PRICING_POLICY_DRIFT — never refuses — for a forged override the current policy would refuse', () => {
    const outcome = reconcileOfflineSaleLinePricing(
      { pricingMode: 'FIXED', permissions: SALES_CREATE },
      { unitPriceListMinor: 2500n, unitPriceAppliedMinor: 2000n },
    );
    expect(outcome.flags).toEqual(['PRICING_POLICY_DRIFT']);
    expect(outcome.unitPriceListMinor).toBe(2500n);
    expect(outcome.unitPriceAppliedMinor).toBe(2000n);
  });

  it('flags drift for a mode change that tightened the policy after the sale', () => {
    // Sold under VARIABLE with plain sales.create authority; the organization
    // has since moved to FIXED, where the same alteration needs
    // pricing.override the actor does not hold.
    const outcome = reconcileOfflineSaleLinePricing(
      { pricingMode: 'FIXED', permissions: SALES_CREATE },
      { unitPriceListMinor: 2500n, unitPriceAppliedMinor: 2000n },
    );
    expect(outcome.flags).toEqual(['PRICING_POLICY_DRIFT']);
  });

  it('flags no drift when the current policy loosened and now permits the recorded price', () => {
    // Sold under FIXED (override was held); the mode has since moved to VARIABLE.
    const outcome = reconcileOfflineSaleLinePricing(
      { pricingMode: 'VARIABLE', permissions: SALES_CREATE },
      { unitPriceListMinor: 2500n, unitPriceAppliedMinor: 2000n },
    );
    expect(outcome.flags).toEqual([]);
  });

  it('flags drift for a FIXED_WITH_DISCOUNT reduction — the offline engine must have used the discount path', () => {
    const outcome = reconcileOfflineSaleLinePricing(
      { pricingMode: 'FIXED_WITH_DISCOUNT', permissions: SALES_CREATE_AND_OVERRIDE },
      { unitPriceListMinor: 5000n, unitPriceAppliedMinor: 4500n },
    );
    expect(outcome.flags).toEqual(['PRICING_POLICY_DRIFT']);
  });

  it('carries BELOW_COST beside the drift flag in the contract flag order', () => {
    const outcome = reconcileOfflineSaleLinePricing(
      { pricingMode: 'VARIABLE', permissions: SALES_CREATE },
      { unitPriceListMinor: 2500n, unitPriceAppliedMinor: 1000n, unitCostAppliedMinor: 1800n },
    );
    expect(outcome.flags).toEqual(['BELOW_COST'] as readonly PricingFlagValue[]);
  });

  it('stays silent for an offline line the current policy still permits', () => {
    expect(
      reconcileOfflineSaleLinePricing(
        { pricingMode: 'VARIABLE', permissions: SALES_CREATE },
        { unitPriceListMinor: 2500n, unitPriceAppliedMinor: 2500n },
      ).flags,
    ).toEqual([]);
  });

  it('still refuses structural corruption on sync — availability never extends to malformed money', () => {
    expectDomainError(ERROR_CODES.VALIDATION_FAILED, () =>
      reconcileOfflineSaleLinePricing(
        { pricingMode: 'FIXED', permissions: SALES_CREATE },
        { unitPriceListMinor: 2500n, unitPriceAppliedMinor: -5n },
      ),
    );
  });

  it('reports the contract version the decision shape belongs to', () => {
    // Bumped 1 → 2 by M3-S3 (the recorded §18 discount decision facts and the
    // FIXED_WITH_DISCOUNT reduction semantics change); a recorded v1 decision
    // is never silently reinterpreted by this contract. See the M3-S3 slice
    // record §4.1.
    expect(PRICING_POLICY_CONTRACT_VERSION).toBe(2);
  });
});

describe('determinism and the shared classifier', () => {
  it('answers identically for repeated calls under identical facts', () => {
    const policy = { pricingMode: 'VARIABLE', permissions: SALES_CREATE } as const;
    const line = { unitPriceListMinor: 2500n, unitPriceAppliedMinor: 1900n } as const;
    const first = evaluateSaleLinePricing(policy, line);
    const second = evaluateSaleLinePricing(policy, line);
    expect(second).toEqual(first);
    expect(second.flags).toEqual(first.flags);
  });

  it('classifies the online refusal and the offline drift from the same policy facts', () => {
    // The single classifier: wherever the online boundary refuses, the
    // reconciliation flags — never the reverse.
    const policy = { pricingMode: 'FIXED', permissions: SALES_CREATE } as const;
    const line = { unitPriceListMinor: 2500n, unitPriceAppliedMinor: 2000n } as const;
    let refused = false;
    try {
      evaluateSaleLinePricing(policy, line);
    } catch {
      refused = true;
    }
    expect(refused).toBe(true);
    expect(reconcileOfflineSaleLinePricing(policy, line).flags).toContain('PRICING_POLICY_DRIFT');
  });
});
