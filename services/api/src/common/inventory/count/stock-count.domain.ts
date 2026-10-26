/**
 * The stock-count domain canonicalizers (Master Plan §15.8, §30.5, O-14;
 * §40.8 row M4-S4).
 *
 * One structural rule, the same one the movement offer proves: **the raw wire
 * is never trusted.** The count's offers are canonicalized — trimmed,
 * shape-checked, vocabulary-checked, and the exact-integer observation parsed
 * from its decimal string — *before* any connection or transaction is opened.
 *
 * The posting builds its movements without re-reading the wire: its per-line
 * offer is constructed from the count's own stored lines (facts the service
 * wrote behind the same canonicalizers and the migration-0016 CHECKs) and is
 * typed as the shared `MovementOffer`, so the count posts through the one and
 * only movement fold (§15.4: no parallel engine).
 */

import {
  ADJUSTMENT_REASON_CODES,
  MAX_COST_MAGNITUDE,
  MAX_QUANTITY_MAGNITUDE,
  REASON_CODE_MAX_LENGTH,
  INVENTORY_TEXT_WIRE_PATTERN,
  UUID_WIRE_PATTERN,
  type AdjustmentReasonCode,
} from '../inventory.contract';
import type { MovementOffer } from '../inventory.domain';
import { CanonicalizationError } from '../inventory.domain';
import { STOCK_COUNT_NOTE_MAX_LENGTH } from './stock-count.contract';
import type { StockCountStatus } from './stock-count.contract';

/** Canonicalization refusals, named exactly like the movement offer's own. */
export { CanonicalizationError } from '../inventory.domain';

/** A created count offer, canonical. */
export interface CreateCountOffer {
  /** Absent → the organization's default location (the V1 seed). */
  readonly locationId: string | null;
  readonly note: string | null;
}

/** A recorded count line offer, canonical. */
export interface RecordCountLineOffer {
  readonly variantId: string;
  /** The physical observation in exact base units — zero is a real observation. */
  readonly countedQuantity: bigint;
  /** Optional at record time; a posting of a *differing* line without one is refused (O-14). */
  readonly reasonCode: AdjustmentReasonCode | null;
  /** The §30.1 cost *offer* for the only posting that needs one (an increase on stock with no basis). */
  readonly unitCostMinor: bigint | null;
}

/** Raw wire of `POST …/counts` (the canonicalizer re-reads it). */
export interface CreateCountWire {
  readonly locationId?: string | null;
  readonly note?: string | null;
}

/** Raw wire of `POST …/counts/:countId/lines`. */
export interface RecordCountLineWire {
  readonly variantId: string;
  readonly countedQuantity: string;
  readonly reasonCode?: string | null;
  readonly unitCostMinor?: string | null;
}

/** Trims the document note: the same §15.5 bounded text the migration CHECKs. */
function canonicalizeCountNote(value: unknown): string | null {
  if (typeof value !== 'string') {
    throw new CanonicalizationError('note must be text', 'note');
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (!INVENTORY_TEXT_WIRE_PATTERN.test(trimmed)) {
    throw new CanonicalizationError('note must have non-whitespace ends after trimming', 'note');
  }
  if (trimmed.length > STOCK_COUNT_NOTE_MAX_LENGTH) {
    throw new CanonicalizationError(`note must be at most ${String(STOCK_COUNT_NOTE_MAX_LENGTH)} characters`, 'note');
  }
  return trimmed;
}

/** Proves a canonical UUID shape for a required identifier. */
function canonicalizeRequiredUuid(field: string, value: unknown): string {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!UUID_WIRE_PATTERN.test(text)) {
    throw new CanonicalizationError(`${field} must be a canonical UUID`, field);
  }
  return text;
}

/** Proves a canonical UUID shape for an optional identifier (absent stays absent). */
function canonicalizeOptionalUuid(field: string, value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return canonicalizeRequiredUuid(field, value);
}

/**
 * Parses the observed quantity: an unsigned decimal-string count of base
 * units, inside the same 12-digit magnitude the movement wire carries. Zero is
 * explicitly legal here — the empty shelf is a real observation (§15.8) —
 * which is exactly why counts have a parser of their own: the movement parser
 * refuses zeros because a movement never moves nothing.
 */
export function parseCountedQuantity(value: unknown): bigint {
  if (typeof value !== 'string' || !/^[0-9]{1,12}$/.test(value)) {
    throw new CanonicalizationError(
      'countedQuantity must be a non-negative decimal string of at most 12 digits',
      'countedQuantity',
    );
  }
  const parsed = BigInt(value);
  if (parsed > MAX_QUANTITY_MAGNITUDE) {
    throw new CanonicalizationError('countedQuantity exceeds the permitted magnitude', 'countedQuantity');
  }
  return parsed;
}

/** Parses the §30.1 cost offer (the exact grammar the movement wire uses). */
export function parseCountCostOffer(value: unknown): bigint {
  if (typeof value !== 'string' || !/^[0-9]{1,12}$/.test(value)) {
    throw new CanonicalizationError(
      'unitCostMinor must be a non-negative integer decimal string of at most 12 digits',
      'unitCostMinor',
    );
  }
  const parsed = BigInt(value);
  if (parsed > MAX_COST_MAGNITUDE) {
    throw new CanonicalizationError('unitCostMinor exceeds the permitted magnitude', 'unitCostMinor');
  }
  return parsed;
}

/** The reason code as bounded text before the vocabulary membership check. */
function canonicalizeReasonCode(value: unknown): AdjustmentReasonCode | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new CanonicalizationError('reasonCode must be text from the closed vocabulary', 'reasonCode');
  }
  const trimmed = value.trim();
  if (!INVENTORY_TEXT_WIRE_PATTERN.test(trimmed) || trimmed.length > REASON_CODE_MAX_LENGTH) {
    throw new CanonicalizationError(
      `reasonCode must be bounded text of at most ${String(REASON_CODE_MAX_LENGTH)} characters`,
      'reasonCode',
    );
  }
  if (!ADJUSTMENT_REASON_CODES.includes(trimmed as AdjustmentReasonCode)) {
    throw new CanonicalizationError('reasonCode must be a member of the closed adjustment vocabulary', 'reasonCode');
  }
  return trimmed as AdjustmentReasonCode;
}

/** Canonicalizes a count-creation offer, or throws the first refusal. */
export function canonicalizeCreateCount(wire: CreateCountWire): CreateCountOffer {
  return {
    locationId: canonicalizeOptionalUuid('locationId', wire.locationId),
    note: wire.note === undefined || wire.note === null ? null : canonicalizeCountNote(wire.note),
  };
}

/** Canonicalizes a line-recording offer, or throws the first refusal. */
export function canonicalizeRecordCountLine(wire: RecordCountLineWire): RecordCountLineOffer {
  const variantId = canonicalizeRequiredUuid('variantId', wire.variantId);
  const countedQuantity = parseCountedQuantity(wire.countedQuantity);
  return {
    variantId,
    countedQuantity,
    reasonCode: canonicalizeReasonCode(wire.reasonCode),
    unitCostMinor:
      wire.unitCostMinor === undefined || wire.unitCostMinor === null ? null : parseCountCostOffer(wire.unitCostMinor),
  };
}

/**
 * Builds the posted movement of one differing count line, directly typed as
 * the movement fold's offer. The caller has already established every fact
 * this builder asserts, against the locked authoritative level:
 *
 * - `movementId` is the **line's own id** — the deterministic per-line
 *   movement identity (§38.14.1: one line, at most one movement, ever; a
 *   retry of the same posting re-derives the same id as a fold lookup
 *   answers);
 * - the variance is `counted − the authoritative quantity` (never the
 *   record-time snapshot — the posting re-verifies against the locked level,
 *   §15.6);
 * - a cost offer rides **only** an increase (a consumption is re-costed by
 *   nothing; it snapshots the engine's current average — §30.5);
 * - the reason is already proven present (O-14);
 * - the document ref names the count, so every produced movement is
 *   traceable to the observation that produced it.
 */
export function buildCountLineMovementOffer(input: {
  readonly lineId: string;
  readonly variantId: string;
  readonly countId: string;
  /** The count's own location — the movement's `locationId` (never re-derived). */
  readonly locationId: string;
  /** The §15.6 authoritative variance, `counted − the locked quantity`. Never zero. */
  readonly delta: bigint;
  readonly reasonCode: AdjustmentReasonCode;
  readonly unitCostMinor: bigint | null;
}): MovementOffer {
  if (input.delta === 0n) {
    throw new CanonicalizationError('a count line with no variance produces no movement', 'countedQuantity');
  }
  if (input.unitCostMinor !== null && input.delta < 0n) {
    throw new CanonicalizationError(
      'a count decrease carries no cost: it consumes inventory at the engine’s current average',
      'unitCostMinor',
    );
  }
  return {
    movementId: input.lineId,
    cause: 'STOCK_COUNT_ADJUSTMENT',
    variantId: input.variantId,
    locationId: input.locationId,
    quantityDelta: input.delta,
    unitCostMinor: input.unitCostMinor,
    reasonCode: input.reasonCode,
    reasonNote: null,
    documentRef: `count:${input.countId}`,
  } satisfies MovementOffer;
}

/** The count status a stored row carries, re-proven against the closed vocabulary. */
export function asCountStatusOrRefuse(value: string): StockCountStatus {
  if (value === 'OPEN' || value === 'POSTED' || value === 'CANCELLED') {
    return value;
  }
  throw new Error(`the stored stock count status "${value}" is not a status this server knows`);
}

/**
 * The stored reason code, re-proven against the §38.5 closed adjustment
 * vocabulary — the same rule `canonicalizeRecordCountLine` proves at record
 * time, re-proven where the posting builds its movement from stored facts.
 */
export function asAdjustmentReasonCodeOrRefuse(value: string): AdjustmentReasonCode {
  if (ADJUSTMENT_REASON_CODES.includes(value as AdjustmentReasonCode)) {
    return value as AdjustmentReasonCode;
  }
  throw new Error(`the stored count reason code "${value}" is not a code this server knows`);
}
