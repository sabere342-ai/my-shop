/**
 * The typed settings vocabulary and bounds (Master Plan §22.1–§22.4, §40.7 M3-S1).
 *
 * Every value below is a plan fact, stated as data: the enum vocabularies, the
 * numeric bounds, and the field→permission gate. The database CHECKs of
 * migration `0012_organization_settings` restate the numeric and enum bounds,
 * so a writer that bypasses the service lands in a PostgreSQL refusal — the
 * same "the database is the last line of defence" posture migration `0004`
 * applied to the bootstrap key and M2-S2 applied to the password scheme.
 *
 * The service layer is the first line: it refuses a value outside the
 * vocabulary with the stable `VALIDATION_FAILED` code and never coerces —
 * §22.1's consequence is that critical financial behaviour must not depend on
 * "somehow close" values.
 */

/** The settings row's version type at the service boundary (§38.18). Version 1 is the materialized default. */
export const FIRST_SETTINGS_VERSION = 1n;

/** §22.2 `currency`: one value in V1; growth is a governing decision. */
export const CURRENCY_VALUES = ['EGP'] as const;

/** §22.2 `display_numerals` / §6.8: on-screen display only. */
export const DISPLAY_NUMERAL_VALUES = ['WESTERN', 'EASTERN_ARABIC'] as const;

/** §17: the three pricing modes, one active value per organization. */
export const PRICING_MODE_VALUES = ['FIXED', 'VARIABLE', 'FIXED_WITH_DISCOUNT'] as const;

/** §21.2: the invoice output default's three values. */
export const INVOICE_OUTPUT_VALUES = ['ALWAYS_ASK', 'PRINT_AUTOMATICALLY', 'NO_AUTOMATIC_OUTPUT'] as const;

/** §30.6: HALF_UP default, HALF_EVEN the plan-named alternative. */
export const ROUNDING_MODE_VALUES = ['HALF_UP', 'HALF_EVEN'] as const;

/** §22.4 / §16.4A.2: the one V1 device-receipt presentation format. */
export const OFFLINE_RECEIPT_ID_FORMAT_VALUES = ['ORG-DEV-SEQ'] as const;

export type CurrencyValue = (typeof CURRENCY_VALUES)[number];
export type DisplayNumeralsValue = (typeof DISPLAY_NUMERAL_VALUES)[number];
export type PricingModeValue = (typeof PRICING_MODE_VALUES)[number];
export type InvoiceOutputValue = (typeof INVOICE_OUTPUT_VALUES)[number];
export type RoundingModeValue = (typeof ROUNDING_MODE_VALUES)[number];
export type OfflineReceiptIdFormatValue = (typeof OFFLINE_RECEIPT_ID_FORMAT_VALUES)[number];

/** §22.2: exponent bounds — 0 (whole major units) through 9 (no honest currency formats beyond). */
export const MINOR_UNIT_EXPONENT_MIN = 0;
export const MINOR_UNIT_EXPONENT_MAX = 9;

/** §22.2: the discount ceiling's percentage space, at its numeric(5,2) precision. */
export const MAX_DISCOUNT_PERCENTAGE_MAX = 100 as const;

/** §22.4 / O-13 and O-20: 72 hours default, maximum 30 days. */
export const OFFLINE_GRACE_DURATION_DEFAULT_SECONDS = 72n * 3600n;
export const OFFLINE_GRACE_DURATION_MIN_SECONDS = 1n;
export const OFFLINE_GRACE_DURATION_MAX_SECONDS = 30n * 24n * 3600n;

/** §22.4 / §16.4A.2: reserved block sizing — the plan default 1000, bounded so blocks cannot balloon. */
export const RESERVED_BLOCK_SIZE_DEFAULT = 1000;
export const RESERVED_BLOCK_SIZE_MIN = 1;
export const RESERVED_BLOCK_SIZE_MAX = 10000;

/** §22.2 `invoice_footer`: bounded presentation text. */
export const INVOICE_FOOTER_MAX_LENGTH = 2000;

/** §9.2 / §10.4: the organization name's bound, shared with the bootstrap command. */
export const ORGANIZATION_NAME_MAX_LENGTH = 200;

/**
 * The §22.2 `feature_flags` vocabulary, as **data** (the §11.2 permission-catalog
 * discipline): versioned in code, so growing it is no migration. No flag exists in
 * the plan today — the honest V1 state is the empty list, and the service refuses
 * every unknown key.
 */
export const FEATURE_FLAG_CATALOG_VERSION = 1;
export const FEATURE_FLAG_KEYS: readonly string[] = [];

/** True when `key` is a flag this server knows (a fast catalog check, also applied to the stored-row grammar). */
export function isKnownFeatureFlagKey(key: string): boolean {
  return FEATURE_FLAG_KEYS.includes(key);
}

/** The `^[A-Z][A-Z0-9_]{2,63}$` grammar the database CHECK also enforces. */
export const FEATURE_FLAG_KEY_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;

/** The wire/request member a flag carries. */
export interface FeatureFlagEntry {
  readonly key: string;
  readonly enabled: boolean;
}

/**
 * The §22.2/§22.4 permission column, as the settings layer enforces it: three
 * gates. `settings.edit`-gated presentation and operational settings;
 * `pricing.policy.edit`-gated pricing and discount settings; and the
 * owner-exclusive fields the M2-S3 catalog anticipated ("§22.2 make changing a
 * setting owner-only too, but that is a policy the M3 settings layer enforces
 * on top of `settings.edit`").
 */
export type SettingsFieldGate = 'settings.edit' | 'pricing.policy.edit' | 'owner';

/** One provided field's gate, keyed by the exact wire member of the PUT body. */
/** One provided field's gate, keyed by the exact wire member of the PUT body. */
export const SETTINGS_FIELD_GATES: Readonly<Record<string, SettingsFieldGate>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, SettingsFieldGate>, {
    organizationName: 'settings.edit',
    currency: 'settings.edit',
    displayNumerals: 'settings.edit',
    invoiceOutputDefault: 'settings.edit',
    invoiceFooter: 'settings.edit',
    invoiceShowLogo: 'settings.edit',
    customerRequiredOnCreditSale: 'settings.edit',
    receivablesAgingEnabled: 'settings.edit',
    offlineReceiptIdFormat: 'settings.edit',
    offlineReservedNumberBlocks: 'settings.edit',
    pricingMode: 'pricing.policy.edit',
    maxDiscountPercentage: 'pricing.policy.edit',
    maxDiscountAmountMinor: 'pricing.policy.edit',
    discountApprovalThresholdMinor: 'pricing.policy.edit',
    discountAllowedForSalesperson: 'pricing.policy.edit',
    blockDiscountBelowCost: 'pricing.policy.edit',
    minorUnitExponent: 'owner',
    roundingMode: 'owner',
    offlineGraceDurationSeconds: 'owner',
    reservedBlockSize: 'owner',
    featureFlags: 'owner',
  }),
);
