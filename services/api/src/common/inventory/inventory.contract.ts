/**
 * The inventory closed vocabularies and bounds (Master Plan §15.4, §15.5, §15.6,
 * §15.6A, §38.14.1; §40.8 row M4-S2).
 *
 * The same §11.2/§15.3A discipline the catalog contract states, restated for the
 * quantity history: every constant here is a code decision recorded with its
 * owning slice, and the shape-carrying ones are restated by the CHECKs of
 * migration `0014_inventory_core`, which is the last line of defence for a
 * writer that bypasses the service.
 *
 * **Cause vocabulary discipline (§15.5).** The closed movement-cause vocabulary
 * is the plan's eleven values, and the database CHECK restates all of them. But
 * a cause a client can *submit* must name a real producing execution path: this
 * slice produces `OPENING_BALANCE` (server only, §38.14.1) and
 * `MANUAL_ADJUSTMENT` (device or server). Every other cause — `SALE`, sale
 * returns, `PURCHASE_RECEIPT`, counts, transfers, `REVALUATION` — arrives with
 * its owning slice (M5 sales, M6 purchases, M4-S4 counts): the vocabulary below
 * is the *admissible* subset, never the whole truth.
 *
 * `INVENTORY_ADJUSTMENT` appears nowhere here on purpose: §38.7's
 * `aggregate_type` names the outbox mutation class, not the movement cause, and
 * §15.5 is the movement vocabulary the database CHECKs restate.
 */

/** The code catalog's own version, for the audit payload. */
export const INVENTORY_CONTRACT_VERSION = 1;

/** The closed §15.5 movement-cause vocabulary, as the database CHECK restates it. */
export const MOVEMENT_CAUSE_VOCABULARY = [
  'SALE',
  'SALE_RETURN',
  'PURCHASE_RECEIPT',
  'PURCHASE_RETURN',
  'STOCK_COUNT_ADJUSTMENT',
  'MANUAL_ADJUSTMENT',
  'OPENING_BALANCE',
  'SHRINKAGE',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'REVALUATION',
] as const;

export type MovementCause = (typeof MOVEMENT_CAUSE_VOCABULARY)[number];

/**
 * The causes this slice produces — the means a caller may submit. `OPENING_BALANCE`
 * is the server-only initial quantity of a variant at a location; `MANUAL_ADJUSTMENT`
 * is the reason-coded correction (§38.5: goods present that the system does not know
 * about are corrected here, never through a sale — a rule M5 will inherit verbatim).
 */
export const SUBMITTABLE_MOVEMENT_CAUSES = ['OPENING_BALANCE', 'MANUAL_ADJUSTMENT'] as const;

export type SubmittableMovementCause = (typeof SUBMITTABLE_MOVEMENT_CAUSES)[number];

/**
 * The closed adjustment reason codes. §38.5: every adjustment is
 * **reason-coded**, so an unexplained quantity change cannot exist. The codes
 * are short machine values; the free note carries the operator's own words.
 */
export const ADJUSTMENT_REASON_CODES = ['DAMAGED', 'EXPIRED', 'LOST', 'MISCOUNT', 'RESTOCK', 'OTHER'] as const;

export type AdjustmentReasonCode = (typeof ADJUSTMENT_REASON_CODES)[number];

// --- text bounds (wire and service share them; migration 0014 restates them) ---

export const LOCATION_NAME_MAX_LENGTH = 100;
export const REASON_CODE_MAX_LENGTH = 24;
export const REASON_NOTE_MAX_LENGTH = 300;
export const DOCUMENT_REF_MAX_LENGTH = 300;

/** A non-whitespace-ends text shape, the same one migration 0014 CHECKs. */
export const INVENTORY_TEXT_WIRE_PATTERN = /^\S.*\S$|^\S$/;

/** The canonical lower-hex UUID shape every identifier must hold. */
export const UUID_WIRE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// --- quantities (§15.6: exact integers in base units; never a float) ---

/**
 * The largest quantity magnitude the V1 wire accepts: 12 decimal digits in
 * base units, the same width the money wire uses (migration 0014 restates the
 * bound byte-for-byte on both the delta and the level).
 */
export const MAX_QUANTITY_MAGNITUDE = 999_999_999_999n;

/** Quantities ride a signed decimal string (§30.1's money decision, extended to quantities). */
export const QUANTITY_WIRE_PATTERN = /^[+-]?[0-9]{1,12}$/;

// --- reads ---

/** The bounded page size of every list read. */
export const INVENTORY_LIST_MAX_LIMIT = 100;

/** The default location's Arabic-first name (§6.1), the V1 deterministic seed. */
export const DEFAULT_LOCATION_NAME = 'المخزن الرئيسي';

// --- the audit targets the rows carry (M2-S6 §32.2 vocabulary) ---

export const INVENTORY_TARGET_TYPES = {
  movement: 'STOCK_MOVEMENT',
  level: 'STOCK_LEVEL',
  location: 'INVENTORY_LOCATION',
} as const;
