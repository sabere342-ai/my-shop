/**
 * The inventory domain canonicalizers (Master Plan §15.4, §15.5, §15.6, §15.6A,
 * §38.14.1; §40.8 row M4-S2).
 *
 * One structural rule, the same one the catalog half proves: **the raw wire is
 * never trusted.** The offer is canonicalized — trimmed, shape-checked,
 * direction- and vocabulary-checked, and the exact-integer quantity parsed from
 * its decimal string — *before* any connection or transaction is opened. A
 * rejected offer never costs the database a round trip, and an accepted offer
 * is a plain, deeply validated value the service can fold into the quantity
 * history without a second interpretation.
 *
 * Names (§13.6/§35.3): offered text marked `diagnostic` in error paths is
 * for the server log only; responses carry stable problem codes.
 */

import {
  ADJUSTMENT_REASON_CODES,
  COST_WIRE_PATTERN,
  DOCUMENT_REF_MAX_LENGTH,
  INVENTORY_TEXT_WIRE_PATTERN,
  MAX_COST_MAGNITUDE,
  MAX_QUANTITY_MAGNITUDE,
  MOVEMENT_CAUSE_VOCABULARY,
  REASON_CODE_MAX_LENGTH,
  REASON_NOTE_MAX_LENGTH,
  SUBMITTABLE_MOVEMENT_CAUSES,
  UUID_WIRE_PATTERN,
  type AdjustmentReasonCode,
  type MovementCause,
  type SubmittableMovementCause,
} from './inventory.contract';

/** Canonicalization refusals, named exactly like the catalog's own. */
export class CanonicalizationError extends Error {
  readonly field: string;

  constructor(message: string, field: string) {
    super(message);
    this.name = 'CanonicalizationError';
    this.field = field;
  }
}

/** One submitted movement, fully canonical: the raw wire has been proven. */
export interface MovementOffer {
  /** The §38.14.1 movement identity — the client's idempotency key for the whole operation. */
  readonly movementId: string;
  readonly cause: SubmittableMovementCause;
  readonly variantId: string;
  /** Absent → the organization's default location (the V1 seed). */
  readonly locationId: string | null;
  /** Signed exact base units. Never zero for a quantity movement; `0` only for a REVALUATION. */
  readonly quantityDelta: bigint;
  /**
   * The §30.2 acquisition cost the caller offers, exact integer minor units:
   * required for the cost-imposing causes (`OPENING_BALANCE`, `PURCHASE_RECEIPT`,
   * `REVALUATION`), refused on a consumption, and otherwise the caller's choice
   * (present: a cost-bearing inclusion; absent: the engine costs it at the
   * current average — never a fabricated zero).
   */
  readonly unitCostMinor: bigint | null;
  /** Required for `MANUAL_ADJUSTMENT` (§38.5), refused for `OPENING_BALANCE`. */
  readonly reasonCode: AdjustmentReasonCode | null;
  readonly reasonNote: string | null;
  readonly documentRef: string | null;
}

/** The raw wire shape of one submitted movement — admitted, not trusted. */
export interface MovementOfferWire {
  readonly movementId: string;
  readonly cause: string;
  readonly variantId: string;
  readonly locationId?: string | null;
  readonly quantityDelta: string;
  readonly unitCostMinor?: string | null;
  readonly reasonCode?: string | null;
  readonly reasonNote?: string | null;
  readonly documentRef?: string | null;
}

/** Trims a text member against the bounded pattern, or refuses with a field name. */
function canonicalizeBoundedText(
  field: string,
  value: string,
  maxLength: number,
  options: { readonly optional: boolean },
): string | null {
  const trimmed = value.trim();
  if (!INVENTORY_TEXT_WIRE_PATTERN.test(trimmed)) {
    if (options.optional) {
      return null;
    }
    throw new CanonicalizationError(`${field} must have non-whitespace ends after trimming`, field);
  }
  if (trimmed.length > maxLength) {
    throw new CanonicalizationError(`${field} must be at most ${String(maxLength)} characters`, field);
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
 * Parses a signed decimal-string quantity into an exact `bigint` (§15.6:
 * quantities are integers in base units; the legacy REAL-quantity defect never
 * returns). The magnitude re-proves the money-wire width; zero deltas are a
 * caller's bug, not a silence — except for a `REVALUATION`, whose delta is
 * exactly zero by definition (a valuation restatement moves no stock; §30.5),
 * which is why the zero rule is caller-selected rather than universal.
 */
export function parseQuantity(field: string, wire: string, options: { readonly allowZero?: boolean } = {}): bigint {
  if (typeof wire !== 'string' || !/^[+-]?[0-9]{1,12}$/.test(wire)) {
    throw new CanonicalizationError(`${field} must be a decimal string of at most 12 digits`, field);
  }
  let raw = wire;
  let sign = 1n;
  if (raw.startsWith('+')) {
    raw = raw.slice(1);
  } else if (raw.startsWith('-')) {
    sign = -1n;
    raw = raw.slice(1);
  }
  if (!/^[0-9]{1,12}$/.test(raw)) {
    throw new CanonicalizationError(`${field} must be a decimal string of at most 12 digits`, field);
  }
  const magnitude = BigInt(raw);
  if (magnitude > MAX_QUANTITY_MAGNITUDE) {
    throw new CanonicalizationError(`${field} exceeds the permitted magnitude`, field);
  }
  const value = sign * magnitude;
  if (value === 0n && options.allowZero !== true) {
    throw new CanonicalizationError(`${field} must not be zero`, field);
  }
  return value;
}

/**
 * Parses the §30.1 acquisition cost: a **non-negative** exact integer count of
 * minor units, bounded at the 12-digit money-wire width. The decimal-string
 * grammar is the money wire's own (`unit_cost_minor` is a `bigint` column;
 * floats and fractional strings are the legacy defect never returned). `0` is
 * a real economic fact — a genuinely zero-cost receipt — offered explicitly,
 * never implied.
 */
export function parseUnitCostMinor(field: string, wire: unknown): bigint {
  if (typeof wire !== 'string' || !COST_WIRE_PATTERN.test(wire)) {
    throw new CanonicalizationError(
      `${field} must be a non-negative integer decimal string of at most 12 digits`,
      field,
    );
  }
  const value = BigInt(wire);
  if (value > MAX_COST_MAGNITUDE) {
    throw new CanonicalizationError(`${field} exceeds the permitted magnitude`, field);
  }
  return value;
}

/** Canonicalizes one entire submission offer, or throws the first refusal. */
export function canonicalizeMovementOffer(wire: MovementOfferWire): MovementOffer {
  const movementId = canonicalizeRequiredUuid('movementId', wire.movementId);
  const variantId = canonicalizeRequiredUuid('variantId', wire.variantId);
  const locationId = canonicalizeOptionalUuid('locationId', wire.locationId ?? undefined);

  if (!MOVEMENT_CAUSE_VOCABULARY.includes(wire.cause as MovementCause)) {
    throw new CanonicalizationError('cause must be a member of the §15.5 closed vocabulary', 'cause');
  }
  if (!SUBMITTABLE_MOVEMENT_CAUSES.includes(wire.cause as SubmittableMovementCause)) {
    throw new CanonicalizationError(
      `cause ${wire.cause} has no producing execution path in this slice (§15.5)`,
      'cause',
    );
  }
  const cause = wire.cause as SubmittableMovementCause;

  const quantityDelta = parseQuantity(
    'quantityDelta',
    wire.quantityDelta,
    // A REVALUATION moves no stock: its delta is exactly zero by definition
    // (§30.5 — the value moves, the quantity never does).
    cause === 'REVALUATION' ? { allowZero: true } : {},
  );
  if (cause === 'PURCHASE_RECEIPT' && quantityDelta <= 0n) {
    // A receipt is incoming: the §15.5 cause with a negative delta is an
    // out-of-vocabulary direction for its owning shape (a purchase return is
    // `PURCHASE_RETURN`, a quantity correction is an adjust, never this).
    throw new CanonicalizationError('a PURCHASE_RECEIPT carries an incoming (positive) delta', 'quantityDelta');
  }
  if (cause === 'REVALUATION' && quantityDelta !== 0n) {
    // A REVALUATION moves no stock: a non-zero delta names no execution path
    // the costing act has — §30.5's restatement changes the value, the
    // quantity never does.
    throw new CanonicalizationError('a REVALUATION moves no stock: its delta must be exactly zero', 'quantityDelta');
  }
  if (cause === 'OPENING_BALANCE' && quantityDelta <= 0n) {
    // Stock cannot open negative (migration 0014's
    // `chk_inventory_movement_opening_direction` restates it; the wire refusal
    // saves the connection).
    throw new CanonicalizationError('an OPENING_BALANCE carries a positive delta', 'quantityDelta');
  }

  // --- the §30.2 cost offer, per the costing rule each cause carries ---
  let unitCostMinor: bigint | null = null;
  if (cause === 'OPENING_BALANCE' || cause === 'PURCHASE_RECEIPT' || cause === 'REVALUATION') {
    // A cost-imposing movement is never admitted without the acquisition cost:
    // the engine never invents one, and interpreting an absent cost as zero
    // would fabricate the valuation (the no-silent-zero rule of §30.2).
    if (wire.unitCostMinor === undefined || wire.unitCostMinor === null) {
      throw new CanonicalizationError(
        `a ${cause} must carry unitCostMinor — the engine never fabricates an acquisition cost`,
        'unitCostMinor',
      );
    }
    unitCostMinor = parseUnitCostMinor('unitCostMinor', wire.unitCostMinor);
  } else if (wire.unitCostMinor !== undefined && wire.unitCostMinor !== null) {
    // A MANUAL_ADJUSTMENT may offer a cost only when it *adds* stock: a cost-bearing
    // inclusion folds the offered cost into the §30.3 average like any receipt.
    unitCostMinor = parseUnitCostMinor('unitCostMinor', wire.unitCostMinor);
    if (quantityDelta < 0n) {
      // §30.5: a quantity correction consumes at the *current* average — the
      // wire cannot re-cost a consumption, because the engine never lets
      // a caller restate the historical cost a deduction snapshots.
      throw new CanonicalizationError(
        'a negative MANUAL_ADJUSTMENT carries no cost: it consumes inventory at the engine’s current average',
        'unitCostMinor',
      );
    }
  }

  let reasonCode: AdjustmentReasonCode | null = null;
  const rawReasonCode =
    wire.reasonCode === undefined || wire.reasonCode === null
      ? null
      : canonicalizeTextMember('reasonCode', wire.reasonCode, REASON_CODE_MAX_LENGTH);
  if (rawReasonCode !== null) {
    if (!ADJUSTMENT_REASON_CODES.includes(rawReasonCode as AdjustmentReasonCode)) {
      throw new CanonicalizationError('reasonCode must be a member of the closed adjustment vocabulary', 'reasonCode');
    }
    reasonCode = rawReasonCode as AdjustmentReasonCode;
  }
  if (cause === 'MANUAL_ADJUSTMENT' && reasonCode === null) {
    // §38.5: an adjustment is reason-coded, or it does not exist.
    throw new CanonicalizationError('a MANUAL_ADJUSTMENT requires a reasonCode', 'reasonCode');
  }
  if (cause !== 'MANUAL_ADJUSTMENT' && rawReasonCode !== null) {
    // The §38.5 reason vocabulary belongs to the adjustment cause alone; an
    // opening balance, a receipt, and a revaluation carry their own facts.
    throw new CanonicalizationError('only a MANUAL_ADJUSTMENT carries a reason code', 'reasonCode');
  }

  const reasonNote =
    wire.reasonNote === undefined || wire.reasonNote === null
      ? null
      : canonicalizeBoundedText('reasonNote', wire.reasonNote, REASON_NOTE_MAX_LENGTH, { optional: true });
  const documentRef =
    wire.documentRef === undefined || wire.documentRef === null
      ? null
      : canonicalizeBoundedText('documentRef', wire.documentRef, DOCUMENT_REF_MAX_LENGTH, { optional: true });

  return {
    movementId,
    cause,
    variantId,
    locationId,
    quantityDelta,
    unitCostMinor,
    reasonCode,
    reasonNote,
    documentRef,
  };
}

/** The reason code as bounded text before the vocabulary membership check. */
function canonicalizeTextMember(field: string, value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (!INVENTORY_TEXT_WIRE_PATTERN.test(trimmed) || trimmed.length > maxLength) {
    throw new CanonicalizationError(`${field} must be bounded text of at most ${maxLength} characters`, field);
  }
  return trimmed;
}

/**
 * The semantic fingerprint of one movement: the fields whose values define
 * what the movement *did*, excluding every time field. Two submissions reusing
 * one movement identity compare equal exactly when they describe the same
 * quantity fact (§38.9.1: an identical retry is a replay; §38.9.2: the same
 * identity with a different fact is a contradiction, answered equal-aware by
 * the ledger's own contract).
 */
export interface MovementFact {
  readonly movementId: string;
  readonly cause: MovementCause;
  readonly variantId: string;
  readonly locationId: string | null;
  readonly quantityDelta: string;
  /** The §30.2 cost snapshot the stored movement carries, as wire text (`null` uncosted). */
  readonly unitCostMinor: string | null;
  readonly reasonCode: string | null;
  readonly reasonNote: string | null;
  readonly documentRef: string | null;
}
