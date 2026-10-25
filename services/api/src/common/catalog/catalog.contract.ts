/**
 * The catalog closed vocabularies and bounds (Master Plan §15.1, §15.2, §15.3A,
 * §17, §30.1; §40.8 row M4-S1).
 *
 * Every constant here is restated by the database CHECKs of migration
 * `0013_product_catalog`, which is the last line of defence for a writer that
 * bypasses the service; the acceptance suite refutes raw-SQL writes outside
 * each bound. The vocabulary lives in code, never in a database enum, so a
 * catalog growth (a new attribute key, a new unit kind) is a code decision
 * recorded with its slice — the same §11.2 permission-catalog discipline.
 */

/** The two §15.2 unit kinds. Grown by a governing decision, never by accepting a foreign value. */
export const UNIT_KIND_VALUES = ['BASE', 'PURCHASING'] as const;

export type UnitKind = (typeof UNIT_KIND_VALUES)[number];

/** The code catalog's own version, for the audit payload and future drift checks. */
export const CATALOG_CONTRACT_VERSION = 1;

// --- text bounds (wire and service share them; migration 0013 restates them) ---

export const NAME_MAX_LENGTH = 200;
export const CATEGORY_MAX_LENGTH = 100;
export const BRAND_MAX_LENGTH = 100;
export const SKU_MAX_LENGTH = 64;
export const DELETE_REASON_MAX_LENGTH = 300;
export const UNIT_CODE_MAX_LENGTH = 24;
export const UNIT_NAME_MAX_LENGTH = 100;

/** A non-whitespace-ends text shape: "\S.*\S|\S" — the same shape migration 0013 CHECKs. */
export const CATALOG_TEXT_WIRE_PATTERN = /^\S.*\S$|^\S$/;

// --- money (§30.1) ---

/**
 * The largest selling price the V1 money wire accepts: 12 decimal digits of
 * minor units (99,999,999,999.99 at the EGP exponent 2). The migration's bound
 * is byte-identical.
 */
export const MAX_PRICE_MINOR = 999_999_999_999n;

/**
 * Money over the wire is a decimal string (the M1b-S6 `server_sequence`
 * decision): it survives every JSON encoding, and a `Double`-typed price can
 * never drift (§30.1's rationale — the legacy application's REAL money defect).
 */
export const PRICE_MINOR_WIRE_PATTERN = /^\d{1,12}$/;

// --- unit factors (§15.2) ---

/** `BASE` is factor 1 by definition; a purchasing unit below 2 is not a carton. */
export const PURCHASING_UNIT_FACTOR_MIN = 2;
export const PURCHASING_UNIT_FACTOR_MAX = 1_000_000;

// --- typed variant attributes (§15.3A.2) ---

/**
 * The closed attribute catalog. A shoe shop (color/size) and a grocery shop
 * (capacity) both fit; adding a key is a code decision recorded with its
 * owning slice, never an accepted request value.
 */
export const VARIANT_ATTRIBUTE_KEYS = ['color', 'size', 'capacity'] as const;

export type VariantAttributeKey = (typeof VARIANT_ATTRIBUTE_KEYS)[number];

/** The two typed shapes an attribute value may take. */
export const VARIANT_ATTRIBUTE_TYPES = ['TEXT', 'INTEGER'] as const;

export type VariantAttributeType = (typeof VARIANT_ATTRIBUTE_TYPES)[number];

/** Text attribute bound (wire, service, and migration 0013 agree). */
export const VARIANT_ATTRIBUTE_TEXT_MAX_LENGTH = 50;

/** Integer attribute bound (wire, service, and migration 0013 agree). */
export const VARIANT_ATTRIBUTE_INTEGER_MAX = 1_000_000;

/** The typed catalog: which attribute key carries which shape. */
export const VARIANT_ATTRIBUTE_CATALOG: Readonly<
  Record<VariantAttributeKey, { readonly type: VariantAttributeType }>
> = Object.freeze({
  color: { type: 'TEXT' },
  size: { type: 'TEXT' },
  capacity: { type: 'INTEGER' },
});

// --- effective price resolution (§15.3A.2) ---

/** Where a variant's effective selling price came from. */
export const PRICE_SOURCE_VALUES = ['VARIANT', 'PRODUCT', 'UNSET'] as const;

export type PriceSource = (typeof PRICE_SOURCE_VALUES)[number];

/**
 * The M4-S1 honest costing answer: the engine that maintains cost prices
 * (§30.2 moving average) arrives with M4-S3, and until then the catalog
 * answers `false` — which distinguishes "costing not yet available" from an
 * actual zero cost, exactly as the slice brief requires.
 */
export const COSTING_UNAVAILABLE = false as const;
