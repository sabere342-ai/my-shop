/**
 * The stock-count canonicalizers' unit acceptance (Master Plan §15.8, §30.5,
 * O-14; §40.8 row M4-S4).
 *
 * The raw wire is never trusted (§7.3): every case here pins one structural
 * refusal or one canonicalization fact of the count surface before any
 * connection is opened —
 *
 * - a count creation offer: the note trim, the optional location, the UUID
 *   shapes, the bounded note width;
 * - a recorded observation: **zero is a real observation** (the empty shelf is
 *   the whole point §15.8 makes against the movement parser's zero refusal),
 *   the 12-digit exact-integer magnitude, the §38.5 closed reason vocabulary,
 *   and the §30.1 cost-offer grammar (integer, non-negative, bounded);
 * - the per-line movement offer a posting builds: the deterministic line-id
 *   movement identity, the count-document ref, and the two structural
 *   invariants that keep a posting honest (no variance → no movement; a
 *   decrease carries no cost offer).
 */

import { ADJUSTMENT_REASON_CODES } from '../inventory.contract';
import { CanonicalizationError } from '../inventory.domain';
import {
  asAdjustmentReasonCodeOrRefuse,
  asCountStatusOrRefuse,
  buildCountLineMovementOffer,
  canonicalizeCreateCount,
  canonicalizeRecordCountLine,
  parseCountCostOffer,
  parseCountedQuantity,
} from './stock-count.domain';

const VARIANT = '0f1e2d3c-4b5a-4c9d-8e7f-0a1b2c3d4e5f';
const LOCATION = '1f1e2d3c-4b5a-4c9d-8e7f-0a1b2c3d4e5f';
const COUNT = '2f1e2d3c-4b5a-4c9d-8e7f-0a1b2c3d4e5f';
const LINE = '3f1e2d3c-4b5a-4c9d-8e7f-0a1b2c3d4e5f';

/** Asserts a canonicalizer refuses the named field with its own error type. */
async function expectFieldRefusal(field: string, canonicalize: () => unknown): Promise<void> {
  await expect(Promise.resolve().then(canonicalize)).rejects.toMatchObject({
    name: 'CanonicalizationError',
    field,
  });
}

describe('canonicalizeCreateCount', () => {
  it('absence is absence: no location names the default, no note stays null', () => {
    expect(canonicalizeCreateCount({})).toEqual({ locationId: null, note: null });
  });

  it('the note is trimmed; whitespace-only stays absent', () => {
    expect(canonicalizeCreateCount({ note: '  جرد الرف الأول  ' })).toEqual({
      locationId: null,
      note: 'جرد الرف الأول',
    });
    expect(canonicalizeCreateCount({ note: '   ' })).toEqual({ locationId: null, note: null });
  });

  it('a non-text note is refused', async () => {
    await expectFieldRefusal('note', () => canonicalizeCreateCount({ note: 17 as unknown as string }));
  });

  it('a note beyond the bounded width is refused', async () => {
    await expectFieldRefusal('note', () => canonicalizeCreateCount({ note: 'أ'.repeat(301) }));
  });

  it('an unshaped locationId is refused as a UUID refusal; a shaped one is kept', async () => {
    await expectFieldRefusal('locationId', () => canonicalizeCreateCount({ locationId: 'not-a-uuid' }));
    expect(canonicalizeCreateCount({ locationId: LOCATION })).toEqual({ locationId: LOCATION, note: null });
  });
});

describe('canonicalizeRecordCountLine', () => {
  it('zero is a real observation — the empty shelf records as 0', () => {
    expect(canonicalizeRecordCountLine({ variantId: VARIANT, countedQuantity: '0' })).toEqual({
      variantId: VARIANT,
      countedQuantity: 0n,
      reasonCode: null,
      unitCostMinor: null,
    });
  });

  it('a non-integer, signed, or over-wide counted quantity is refused; the 12-digit width is kept', async () => {
    await expectFieldRefusal('countedQuantity', () =>
      canonicalizeRecordCountLine({ variantId: VARIANT, countedQuantity: '4.5' }),
    );
    await expectFieldRefusal('countedQuantity', () =>
      canonicalizeRecordCountLine({ variantId: VARIANT, countedQuantity: '-1' }),
    );
    await expectFieldRefusal('countedQuantity', () =>
      canonicalizeRecordCountLine({ variantId: VARIANT, countedQuantity: '1000000000000' }),
    );
    expect(canonicalizeRecordCountLine({ variantId: VARIANT, countedQuantity: '999999999999' })).toMatchObject({
      countedQuantity: 999_999_999_999n,
    });
  });

  it('a reason code outside the closed vocabulary is refused; absence stays absent; bound text trims', async () => {
    await expectFieldRefusal('reasonCode', () =>
      canonicalizeRecordCountLine({ variantId: VARIANT, countedQuantity: '1', reasonCode: 'HONESTLY_NOT_A_CODE' }),
    );
    expect(
      canonicalizeRecordCountLine({ variantId: VARIANT, countedQuantity: '1', reasonCode: '  DAMAGED  ' }),
    ).toMatchObject({
      reasonCode: 'DAMAGED',
    });
    expect(canonicalizeRecordCountLine({ variantId: VARIANT, countedQuantity: '1' })).toMatchObject({
      reasonCode: null,
    });
  });

  it('a cost offer rides the integer grammar: non-negative, bounded, exact', async () => {
    await expectFieldRefusal('unitCostMinor', () =>
      canonicalizeRecordCountLine({ variantId: VARIANT, countedQuantity: '1', unitCostMinor: '18.5' }),
    );
    await expectFieldRefusal('unitCostMinor', () =>
      canonicalizeRecordCountLine({ variantId: VARIANT, countedQuantity: '1', unitCostMinor: '-18500' }),
    );
    await expectFieldRefusal('unitCostMinor', () =>
      canonicalizeRecordCountLine({ variantId: VARIANT, countedQuantity: '1', unitCostMinor: '9999999999999' }),
    );
    expect(canonicalizeRecordCountLine({ variantId: VARIANT, countedQuantity: '1', unitCostMinor: '0' })).toMatchObject(
      {
        unitCostMinor: 0n,
      },
    );
  });

  it('an unshaped variant id is refused', async () => {
    await expectFieldRefusal('variantId', () =>
      canonicalizeRecordCountLine({ variantId: 'nope', countedQuantity: '1' }),
    );
  });
});

describe('parseCountedQuantity / parseCountCostOffer — the two exact grammars', () => {
  it('the quantity parser admits zero and names its own field on any refusal', () => {
    expect(parseCountedQuantity('0')).toBe(0n);
    try {
      parseCountedQuantity('12x');
      throw new Error('unreachable: the parser accepted "12x"');
    } catch (error) {
      expect(error).toBeInstanceOf(CanonicalizationError);
      expect((error as CanonicalizationError).field).toBe('countedQuantity');
    }
  });

  it('the cost parser refuses fractional or signed text with its own field name', () => {
    expect(parseCountCostOffer('18500')).toBe(18_500n);
    try {
      parseCountCostOffer('12x');
      throw new Error('unreachable: the parser accepted "12x"');
    } catch (error) {
      expect(error).toBeInstanceOf(CanonicalizationError);
      expect((error as CanonicalizationError).field).toBe('unitCostMinor');
    }
  });
});

describe("buildCountLineMovementOffer — the posting's per-line movement", () => {
  it("the movement identity is the line's own id; the ref names the document", () => {
    const offer = buildCountLineMovementOffer({
      lineId: LINE,
      variantId: VARIANT,
      countId: COUNT,
      locationId: LOCATION,
      delta: -3n,
      reasonCode: 'DAMAGED',
      unitCostMinor: null,
    });
    expect(offer).toEqual({
      movementId: LINE,
      cause: 'STOCK_COUNT_ADJUSTMENT',
      variantId: VARIANT,
      locationId: LOCATION,
      quantityDelta: -3n,
      unitCostMinor: null,
      reasonCode: 'DAMAGED',
      reasonNote: null,
      documentRef: `count:${COUNT}`,
    });
  });

  it('no variance posts nothing — the O-14 no-unnecessary-movement law', async () => {
    await expectFieldRefusal('countedQuantity', () =>
      buildCountLineMovementOffer({
        lineId: LINE,
        variantId: VARIANT,
        countId: COUNT,
        locationId: LOCATION,
        delta: 0n,
        reasonCode: 'MISCOUNT',
        unitCostMinor: null,
      }),
    );
  });

  it('a decrease carries no cost offer — a consumption is re-costed by nothing', async () => {
    await expectFieldRefusal('unitCostMinor', () =>
      buildCountLineMovementOffer({
        lineId: LINE,
        variantId: VARIANT,
        countId: COUNT,
        locationId: LOCATION,
        delta: -2n,
        reasonCode: 'LOST',
        unitCostMinor: 18_500n,
      }),
    );
  });

  it('an increase carries its cost offer unchanged', () => {
    const offer = buildCountLineMovementOffer({
      lineId: LINE,
      variantId: VARIANT,
      countId: COUNT,
      locationId: LOCATION,
      delta: 5n,
      reasonCode: 'MISCOUNT',
      unitCostMinor: 18_500n,
    });
    expect(offer.unitCostMinor).toBe(18_500n);
    expect(offer.quantityDelta).toBe(5n);
  });

  it('the reason vocabulary is the shared closed set the fold expects', () => {
    expect(ADJUSTMENT_REASON_CODES.length).toBeGreaterThan(0);
    expect([...ADJUSTMENT_REASON_CODES]).toContain('MISCOUNT');
  });
});

describe('stored-value re-proofs', () => {
  it('asCountStatusOrRefuse admits exactly the closed lifecycle vocabulary', () => {
    expect(asCountStatusOrRefuse('OPEN')).toBe('OPEN');
    expect(asCountStatusOrRefuse('POSTED')).toBe('POSTED');
    expect(asCountStatusOrRefuse('CANCELLED')).toBe('CANCELLED');
    expect(() => asCountStatusOrRefuse('POSTING')).toThrow(/status this server knows/);
  });

  it('asAdjustmentReasonCodeOrRefuse re-proves the closed reason vocabulary', () => {
    expect(asAdjustmentReasonCodeOrRefuse('EXPIRED')).toBe('EXPIRED');
    expect(() => asAdjustmentReasonCodeOrRefuse('SMELLED')).toThrow(/reason/);
  });
});
