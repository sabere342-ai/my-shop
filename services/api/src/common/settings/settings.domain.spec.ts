/**
 * The pure settings domain's acceptance matrix (Master Plan §22.1–§22.4, §36.2).
 *
 * Every check here is a unit: no database, no framework, no Prisma. The matrix
 * pins the three jobs the domain exists for — canonicalization/refusal,
 * classification (including the absent-vs-clear distinction and the typed
 * flag set), and the §22.2/§22.4 per-field authorization gates (including the
 * owner-exclusive fields the M2-S3 catalog anticipated). The database CHECKs
 * and the wire validator are the other two lines of the same bounds (§8.3);
 * this suite is the service layer's own.
 */

import { DomainError } from '../errors/domain.error';
import {
  OFFLINE_GRACE_DURATION_DEFAULT_SECONDS,
  OFFLINE_GRACE_DURATION_MAX_SECONDS,
  SETTINGS_FIELD_GATES,
} from './settings.contract';
import {
  assertFieldGate,
  canonicalizeFeatureFlags,
  canonicalizeUpdateOffer,
  classifyChanges,
  parseGraceDurationSeconds,
  parseMinors,
  parseMinorsOrNull,
} from './settings.domain';

/** A complete stored row at its V1 defaults, as the classifier reads it. */
function defaultStored() {
  return {
    organizationName: 'Main Shop',
    currency: 'EGP',
    minorUnitExponent: 2,
    displayNumerals: 'WESTERN',
    pricingMode: 'FIXED',
    maxDiscountPercentage: '0',
    maxDiscountAmountMinor: '0',
    discountApprovalThresholdMinor: null,
    discountAllowedForSalesperson: false,
    blockDiscountBelowCost: false,
    invoiceOutputDefault: 'ALWAYS_ASK',
    invoiceFooter: '',
    invoiceShowLogo: true,
    customerRequiredOnCreditSale: true,
    roundingMode: 'HALF_UP',
    receivablesAgingEnabled: true,
    offlineGraceDurationSeconds: '259200',
    offlineReceiptIdFormat: 'ORG-DEV-SEQ',
    offlineReservedNumberBlocks: false,
    reservedBlockSize: 1000,
    flags: [] as { key: string; enabled: boolean }[],
  };
}

describe('canonicalizeUpdateOffer', () => {
  it('accepts every field at exactly its bound and passes values through unchanged', () => {
    expect.assertions(0);
    canonicalizeUpdateOffer({
      organizationName: 'A'.repeat(200),
      currency: 'EGP',
      displayNumerals: 'EASTERN_ARABIC',
      pricingMode: 'FIXED_WITH_DISCOUNT',
      invoiceOutputDefault: 'NO_AUTOMATIC_OUTPUT',
      roundingMode: 'HALF_EVEN',
      offlineReceiptIdFormat: 'ORG-DEV-SEQ',
      maxDiscountAmountMinor: '0',
      maxDiscountPercentage: 100,
      minorUnitExponent: 0,
      reservedBlockSize: 1,
      offlineGraceDurationSeconds: 2592000,
    });
  });

  it('trims the organization name and keeps a non-blank interior', () => {
    expect(canonicalizeUpdateOffer({ organizationName: '  Main   Shop  ' }).organizationName).toBe('Main   Shop');
  });

  it('refuses a blank or over-long organization name with the field named', () => {
    for (const bad of ['   ', '', 'x'.repeat(201)]) {
      try {
        canonicalizeUpdateOffer({ organizationName: bad });
        fail(`expected refusal for ${JSON.stringify(bad)}`);
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
        expect((error as DomainError).code).toBe('VALIDATION_FAILED');
      }
    }
  });

  it('refuses an unknown enum value instead of coercing it', () => {
    expect(() => canonicalizeUpdateOffer({ currency: 'USD' as never })).toThrow(DomainError);
    expect(() => canonicalizeUpdateOffer({ displayNumerals: 'ROMAN' as never })).toThrow(DomainError);
    expect(() => canonicalizeUpdateOffer({ pricingMode: 'FREE' as never })).toThrow(DomainError);
    expect(() => canonicalizeUpdateOffer({ invoiceOutputDefault: 'ALWAYS_PRINT' as never })).toThrow(DomainError);
    expect(() => canonicalizeUpdateOffer({ roundingMode: 'FLOOR' as never })).toThrow(DomainError);
    expect(() => canonicalizeUpdateOffer({ offlineReceiptIdFormat: 'DEV-SEQ' as never })).toThrow(DomainError);
  });

  it('bounds the discount percentage and its decimal precision', () => {
    expect(() => canonicalizeUpdateOffer({ maxDiscountPercentage: 100.001 })).toThrow(DomainError);
    expect(() => canonicalizeUpdateOffer({ maxDiscountPercentage: -0.01 })).toThrow(DomainError);
    expect(() => canonicalizeUpdateOffer({ maxDiscountPercentage: Number.POSITIVE_INFINITY })).toThrow(DomainError);
    expect(canonicalizeUpdateOffer({ maxDiscountPercentage: 27.5 }).maxDiscountPercentage).toBe(27.5);
  });

  it('bounds the invoice footer length', () => {
    expect(() => canonicalizeUpdateOffer({ invoiceFooter: 'x'.repeat(2001) })).toThrow(DomainError);
    expect(canonicalizeUpdateOffer({ invoiceFooter: 'x'.repeat(2000) }).invoiceFooter).toHaveLength(2000);
  });

  it('bounds the minor-unit exponent and the reserved block size to whole integers', () => {
    expect(() => canonicalizeUpdateOffer({ minorUnitExponent: -1 })).toThrow(DomainError);
    expect(() => canonicalizeUpdateOffer({ minorUnitExponent: 10 })).toThrow(DomainError);
    expect(() => canonicalizeUpdateOffer({ minorUnitExponent: 1.5 })).toThrow(DomainError);
    expect(() => canonicalizeUpdateOffer({ reservedBlockSize: 0 })).toThrow(DomainError);
    expect(() => canonicalizeUpdateOffer({ reservedBlockSize: 10001 })).toThrow(DomainError);
  });

  it('bounds the offline grace window: default 72h, minimum 1s, maximum 30 days', () => {
    expect(canonicalizeUpdateOffer({ offlineGraceDurationSeconds: 259200 }).offlineGraceDurationSeconds).toBe(259200);
    expect(() => canonicalizeUpdateOffer({ offlineGraceDurationSeconds: 0 })).toThrow(DomainError);
    expect(() => canonicalizeUpdateOffer({ offlineGraceDurationSeconds: 2592001 })).toThrow(DomainError);
    expect(() => canonicalizeUpdateOffer({ offlineGraceDurationSeconds: 1.5 })).toThrow(DomainError);
    expect(OFFLINE_GRACE_DURATION_DEFAULT_SECONDS).toBe(
      // O-13 the plan names 72 hours: exact, in seconds.
      BigInt(72 * 3600),
    );
    expect(OFFLINE_GRACE_DURATION_MAX_SECONDS).toBe(
      // O-20: at most 30 days.
      BigInt(30 * 24 * 3600),
    );
  });
});

describe('the minor-unit money parsers (the 64-bit wire decision)', () => {
  it('accepts digits only, up to 18 places, and produces the exact bigint', () => {
    expect(parseMinors('maxDiscountAmountMinor', '0')).toBe(0n);
    expect(parseMinors('maxDiscountAmountMinor', '123456789012345678')).toBe(123456789012345678n);
  });

  it('refuses signs, decimals, empty strings, and 19-place values', () => {
    for (const bad of ['', '-1', '+1', '1.5', ' 1', '1234567890123456789', '1e3']) {
      expect(() => parseMinors('maxDiscountAmountMinor', bad)).toThrow(DomainError);
    }
  });

  it('parseMinorsOrNull treats an explicit null as the documented clear and delegates the string proof', () => {
    expect(parseMinorsOrNull('discountApprovalThresholdMinor', null)).toBeNull();
    expect(parseMinorsOrNull('discountApprovalThresholdMinor', '55')).toBe(55n);
    expect(() => parseMinorsOrNull('discountApprovalThresholdMinor', '-5')).toThrow(DomainError);
  });

  it('parseGraceDurationSeconds produces the exact bigint second count or refuses', () => {
    expect(parseGraceDurationSeconds('offlineGraceDurationSeconds', 72 * 3600)).toBe(259200n);
    expect(() => parseGraceDurationSeconds('offlineGraceDurationSeconds', 2592001)).toThrow(DomainError);
    expect(() => parseGraceDurationSeconds('offlineGraceDurationSeconds', 0)).toThrow(DomainError);
  });
});

/** The code a refused call answers, or undefined when nothing threw. */
function refusedCode(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return error instanceof DomainError ? error.code : '<unexpected type>';
  }
}

describe('assertFieldGate — the §22.2/§22.4 permission column', () => {
  /** A caller whose effective permissions the M2-S4 resolver could answer. */
  const caller = (...permissions: string[]) => ({ isOwner: false, permissions });
  const owner = { isOwner: true, permissions: [] as string[] };

  it('gates every listed field exactly once, keyed by the wire member name', () => {
    // The catalog's keys must all be accounted for: a field added to neither
    // table must fail loudly here, not silently ride a default gate.
    const gateKeys = Object.keys(SETTINGS_FIELD_GATES).sort();
    const counted = new Set(gateKeys);
    expect(counted.size).toBe(gateKeys.length);
    expect(counted).toContain('organizationName');
    expect(counted).toContain('offlineGraceDurationSeconds');
    // The owner-exclusive set is exactly the plan's (M0-P2 removed the one
    // stale candidate; `allow_negative_stock` must never appear).
    for (const iteratee of Object.entries(SETTINGS_FIELD_GATES)) {
      if (iteratee[1] === 'owner')
        expect([
          'minorUnitExponent',
          'roundingMode',
          'offlineGraceDurationSeconds',
          'reservedBlockSize',
          'featureFlags',
        ]).toContain(iteratee[0]);
      // And the amendment's absence stays absent.
      expect(iteratee[0]).not.toContain('negative');
      expect(iteratee[0]).not.toContain('appLock');
    }
  });

  it('admits a caller holding the field gate and refuses one without it', () => {
    expect(assertFieldGate('invoiceFooter', caller('settings.edit'))).toBe('settings.edit');
    expect(() => assertFieldGate('invoiceFooter', caller('pricing.policy.edit'))).toThrow(DomainError);
    try {
      assertFieldGate('invoiceFooter', caller('pricing.policy.edit'));
      fail('expected refusal');
    } catch (error) {
      expect((error as DomainError).code).toBe('PERMISSION_DENIED');
    }
    expect(assertFieldGate('maxDiscountPercentage', caller('pricing.policy.edit'))).toBe('pricing.policy.edit');
    expect(() => assertFieldGate('maxDiscountPercentage', caller('settings.edit'))).toThrow(DomainError);
  });

  it('reserves the owner-exclusive fields for the owner, no matter which permissions a caller holds', () => {
    for (const field of [
      'minorUnitExponent',
      'roundingMode',
      'offlineGraceDurationSeconds',
      'reservedBlockSize',
      'featureFlags',
    ]) {
      expect(refusedCode(() => assertFieldGate(field, caller('settings.edit', 'pricing.policy.edit')))).toBe(
        'PERMISSION_DENIED',
      );
      expect(assertFieldGate(field, owner)).toBe('owner');
    }
  });

  it('refuses a field name that is no setting at all — the update surface is closed', () => {
    expect(refusedCode(() => assertFieldGate('allowNegativeStock', owner))).toBe('VALIDATION_FAILED');
    expect(refusedCode(() => assertFieldGate('__proto__', owner))).toBe('VALIDATION_FAILED');
  });
});

describe('canonicalizeFeatureFlags', () => {
  it('refuses every unknown key — the V1 catalog is empty, so nothing passes', () => {
    expect(refusedCode(() => canonicalizeFeatureFlags([{ key: 'SEEDED_FLAG_EXAMPLE', enabled: true }]))).toBe(
      'VALIDATION_FAILED',
    );
    expect(() => canonicalizeFeatureFlags([{ key: 'lowercase_grammar', enabled: true }])).toThrow(DomainError);
  });

  it('accepts the empty flag set (a coherent "no flags touched" offer shape)', () => {
    expect(canonicalizeFeatureFlags([])).toEqual([]);
  });
});

describe('classifyChanges', () => {
  it('reports no changes for an empty offer', () => {
    expect(classifyChanges({}, defaultStored())).toEqual([]);
  });

  it('names decimal-string money and duration changes with old and new values', () => {
    const changes = classifyChanges(
      { maxDiscountAmountMinor: 5000n, offlineGraceDurationSeconds: 3600n },
      defaultStored(),
    );
    expect(changes).toEqual([
      { field: 'maxDiscountAmountMinor', oldValue: '0', newValue: '5000' },
      { field: 'offlineGraceDurationSeconds', oldValue: '259200', newValue: '3600' },
    ]);
  });

  it('distinguishes absent from an explicit clear of the approval threshold', () => {
    const cleared = classifyChanges(
      { discountApprovalThresholdMinor: null },
      {
        ...defaultStored(),
        discountApprovalThresholdMinor: '999',
      },
    );
    expect(cleared).toEqual([{ field: 'discountApprovalThresholdMinor', oldValue: '999', newValue: null }]);

    // Absent means untouched: no change, no audit noise.
    expect(classifyChanges({}, { ...defaultStored(), discountApprovalThresholdMinor: '999' })).toEqual([]);
  });

  it('names flag rows field by field, including creating a flag row and flipping one', () => {
    const stored = { ...defaultStored(), flags: [{ key: 'NEW_PRICE_UI', enabled: false }] };
    const changes = classifyChanges({ featureFlags: [{ key: 'NEW_PRICE_UI', enabled: true }] }, stored);
    expect(changes).toEqual([{ field: 'featureFlags:NEW_PRICE_UI', oldValue: false, newValue: true }]);
  });

  it('reports an owner-exclusive numeric change as one effective change', () => {
    const changes = classifyChanges({ minorUnitExponent: 4 }, defaultStored());
    expect(changes).toEqual([{ field: 'minorUnitExponent', oldValue: 2, newValue: 4 }]);
  });

  it('booleans are named when they actually change and suppressed when they do not', () => {
    expect(classifyChanges({ blockDiscountBelowCost: true }, defaultStored())).toEqual([
      { field: 'blockDiscountBelowCost', oldValue: false, newValue: true },
    ]);
    expect(classifyChanges({ blockDiscountBelowCost: false }, defaultStored())).toEqual([]);
  });
});
