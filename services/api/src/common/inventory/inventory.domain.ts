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
  DOCUMENT_REF_MAX_LENGTH,
  INVENTORY_TEXT_WIRE_PATTERN,
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
  /** Signed exact base units. Never zero. */
  readonly quantityDelta: bigint;
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
 * caller's bug, not a silence.
 */
export function parseQuantity(field: string, wire: string): bigint {
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
  if (value === 0n) {
    throw new CanonicalizationError(`${field} must not be zero`, field);
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

  const quantityDelta = parseQuantity('quantityDelta', wire.quantityDelta);

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
  if (cause === 'OPENING_BALANCE' && rawReasonCode !== null) {
    throw new CanonicalizationError('an OPENING_BALANCE carries no reason code', 'reasonCode');
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
  readonly reasonCode: string | null;
  readonly reasonNote: string | null;
  readonly documentRef: string | null;
}
