/**
 * The pure settings domain (Master Plan §22.1–§22.4; §40.7 row M3-S1).
 *
 * No I/O, no framework, no Prisma — exactly the validation and classification
 * half of the settings surface, unit-tested in isolation (§36.2's "unit" is
 * what this file is for). Its job:
 *
 * 1. **Canonicalization & validation** — canonicalize one offered value (trim
 *    the name, bound the ranges) or refuse it with the stable
 *    `VALIDATION_FAILED` code and the field named. Refusal, never coercion:
 *    §22.1 forbids critical financial behaviour excused by a coerced value.
 * 2. **Classification** — compare a canonical offer against the stored row and
 *    name the effective changes, including the absent-vs-clear distinction of
 *    `discount_approval_threshold_minor` and the typed feature-flag set.
 * 3. **Authorization gates** — map every field to the §22.2/§22.4 permission
 *    column so the service layer (which owns the transaction) can refuse a
 *    caller who only half-holds authority before any statement is attempted.
 *
 * Bigint money stays string-shaped exactly as the decimal-string decision for
 * 64-bit wire values states (M1b-S6's `server_sequence` precedent): the JSON
 * number space is not trusted with second-decimal money. The name trimming is
 * canonical, exactly as the bootstrap command's is (§10.4).
 */

import { DomainError } from '../errors/domain.error';
import { ERROR_CODES } from '../errors/problem';
import {
  CURRENCY_VALUES,
  DISPLAY_NUMERAL_VALUES,
  FEATURE_FLAG_KEYS,
  FEATURE_FLAG_KEY_PATTERN,
  INVOICE_FOOTER_MAX_LENGTH,
  INVOICE_OUTPUT_VALUES,
  MINOR_UNIT_EXPONENT_MAX,
  MINOR_UNIT_EXPONENT_MIN,
  OFFLINE_GRACE_DURATION_MAX_SECONDS,
  OFFLINE_GRACE_DURATION_MIN_SECONDS,
  OFFLINE_RECEIPT_ID_FORMAT_VALUES,
  ORGANIZATION_NAME_MAX_LENGTH,
  PRICING_MODE_VALUES,
  RESERVED_BLOCK_SIZE_MAX,
  RESERVED_BLOCK_SIZE_MIN,
  ROUNDING_MODE_VALUES,
  SETTINGS_FIELD_GATES,
  type CurrencyValue,
  type DisplayNumeralsValue,
  type InvoiceOutputValue,
  type OfflineReceiptIdFormatValue,
  type PricingModeValue,
  type RoundingModeValue,
  type SettingsFieldGate,
} from './settings.contract';

/**
 * The update offer as the wire carries it: money and duration are decimal
 * strings/plain numbers (the 64-bit wire decision, M1b-S6 precedent — the
 * JSON number space is not trusted with second-decimal money). `undefined`
 * means untouched; an explicit `null` on `discountApprovalThresholdMinor`
 * means "clear the gate". The service canonicalizes this shape, converts the
 * string money to bigint, and applies it.
 */
export interface SettingsUpdateOffer {
  readonly organizationName?: string;
  readonly currency?: CurrencyValue;
  readonly displayNumerals?: DisplayNumeralsValue;
  readonly pricingMode?: PricingModeValue;
  readonly invoiceOutputDefault?: InvoiceOutputValue;
  readonly roundingMode?: RoundingModeValue;
  readonly offlineReceiptIdFormat?: OfflineReceiptIdFormatValue;
  /** The wire's decimal-string minor-unit money (digits only). */
  readonly maxDiscountAmountMinor?: string;
  /** The approval gate as a decimal string, or explicit `null` to clear it. */
  readonly discountApprovalThresholdMinor?: string | null;
  readonly discountAllowedForSalesperson?: boolean;
  readonly blockDiscountBelowCost?: boolean;
  readonly invoiceShowLogo?: boolean;
  readonly customerRequiredOnCreditSale?: boolean;
  readonly receivablesAgingEnabled?: boolean;
  readonly offlineReservedNumberBlocks?: boolean;
  readonly minorUnitExponent?: number;
  readonly reservedBlockSize?: number;
  /** A whole second count between 1 and 2592000 (30 days). */
  readonly offlineGraceDurationSeconds?: number;
  readonly maxDiscountPercentage?: number;
  readonly invoiceFooter?: string;
  /** Only keys the catalog knows, each with its target state. */
  readonly featureFlags?: readonly { readonly key: string; readonly enabled: boolean }[];
}

/**
 * The canonical offer after the service converted the wire shapes: the
 * decimal strings are bigint minor-unit amounts and the grace window is a
 * bigint second count. This is the shape `classifyChanges` and the write
 * consume — already proven, never re-parsed.
 */
export interface CommittedSettingsOffer {
  readonly organizationName?: string;
  readonly currency?: CurrencyValue;
  readonly displayNumerals?: DisplayNumeralsValue;
  readonly pricingMode?: PricingModeValue;
  readonly invoiceOutputDefault?: InvoiceOutputValue;
  readonly roundingMode?: RoundingModeValue;
  readonly offlineReceiptIdFormat?: OfflineReceiptIdFormatValue;
  /** bigint-shaped minor-unit money. */
  readonly maxDiscountAmountMinor?: bigint;
  /** bigint-shaped approval gate; `null` clears it; absent leaves it as is. */
  readonly discountApprovalThresholdMinor?: bigint | null;
  readonly discountAllowedForSalesperson?: boolean;
  readonly blockDiscountBelowCost?: boolean;
  readonly invoiceShowLogo?: boolean;
  readonly customerRequiredOnCreditSale?: boolean;
  readonly receivablesAgingEnabled?: boolean;
  readonly offlineReservedNumberBlocks?: boolean;
  readonly minorUnitExponent?: number;
  readonly reservedBlockSize?: number;
  readonly offlineGraceDurationSeconds?: bigint;
  readonly maxDiscountPercentage?: number;
  readonly invoiceFooter?: string;
  readonly featureFlags?: readonly { readonly key: string; readonly enabled: boolean }[];
}

/** The caller's authorization context, exactly what the M2-S4 resolver answers. */
export interface SettingsCallerAuthorization {
  readonly isOwner: boolean;
  readonly permissions: readonly string[];
}

/** One effective change, in the audit payload's shape. */
export interface EffectiveChange {
  readonly field: string;
  readonly oldValue: string | number | boolean | null;
  readonly newValue: string | number | boolean | null;
}

/** The stored row exactly as the claims-free classifier reads it (no ids, no version). */
export interface StoredSettingsShape {
  readonly organizationName: string;
  readonly currency: string;
  readonly minorUnitExponent: number;
  readonly displayNumerals: string;
  readonly pricingMode: string;
  readonly maxDiscountPercentage: string;
  readonly maxDiscountAmountMinor: string;
  readonly discountApprovalThresholdMinor: string | null;
  readonly discountAllowedForSalesperson: boolean;
  readonly blockDiscountBelowCost: boolean;
  readonly invoiceOutputDefault: string;
  readonly invoiceFooter: string;
  readonly invoiceShowLogo: boolean;
  readonly customerRequiredOnCreditSale: boolean;
  readonly roundingMode: string;
  readonly receivablesAgingEnabled: boolean;
  readonly offlineGraceDurationSeconds: string;
  readonly offlineReceiptIdFormat: string;
  readonly offlineReservedNumberBlocks: boolean;
  readonly reservedBlockSize: number;
  readonly flags: readonly { readonly key: string; readonly enabled: boolean }[];
}

function validationFailed(field: string, message: string): DomainError {
  return new DomainError(ERROR_CODES.VALIDATION_FAILED, `${field} ${message}`, [
    { field, messages: [`${field} ${message}`] },
  ]);
}

/** The wire's exact decimal-string money grammar (the 64-bit wire decision, M1b-S6 precedent). */
export const DECIMAL_MINORS_WIRE_PATTERN = /^\d{1,18}$/;

/** Parses a decimal-string minor-unit money value, or refuses it. Explicit `null` is the documented clear. */
export function parseMinorsOrNull(field: string, value: string | number | null): bigint | null {
  if (value === null) return null;
  const text = typeof value === 'number' ? `${value}` : value;
  if (!DECIMAL_MINORS_WIRE_PATTERN.test(text)) {
    throw validationFailed(field, 'must be a decimal string of digits (or null to clear)');
  }
  return BigInt(text);
}

/** Parses a **required** decimal-string minor-unit amount (no clearing), or refuses it. */
export function parseMinors(field: string, value: string): bigint {
  if (!DECIMAL_MINORS_WIRE_PATTERN.test(value)) {
    throw validationFailed(field, 'must be a decimal string of digits');
  }
  return BigInt(value);
}

/** Parses a bounded duration into its bigint seconds, or refuses it. */
export function parseGraceDurationSeconds(field: string, value: number): bigint {
  if (
    !Number.isInteger(value) ||
    value < OFFLINE_GRACE_DURATION_MIN_SECONDS ||
    value > OFFLINE_GRACE_DURATION_MAX_SECONDS
  ) {
    throw validationFailed(field, 'must be a whole second count between 1 and 2592000 (30 days)');
  }
  return BigInt(value);
}

/** Parses one integer bound (the exponent, the block size), or refuses it. */
function parseUnboundedInt(field: string, value: number): number {
  if (!Number.isInteger(value)) {
    throw validationFailed(field, 'must be a whole number');
  }
  return value;
}

/**
 * Normalizes and validates one update offer. This is the domain's own re-proof
 * (§8.3: application checks never stand alone — the wire validator and the
 * database CHECKs are the other two lines) and the canonicalization seam.
 */
export function canonicalizeUpdateOffer(offer: SettingsUpdateOffer): SettingsUpdateOffer {
  const canonical: { -readonly [K in keyof SettingsUpdateOffer]?: SettingsUpdateOffer[K] } = { ...offer };

  if (offer.organizationName !== undefined) {
    const trimmed = offer.organizationName.trim();
    if (trimmed.length === 0) {
      throw validationFailed('organizationName', 'must not be blank');
    }
    if (trimmed.length > ORGANIZATION_NAME_MAX_LENGTH) {
      throw validationFailed('organizationName', `must be at most ${ORGANIZATION_NAME_MAX_LENGTH} characters`);
    }
    canonical.organizationName = trimmed;
  }

  if (offer.currency !== undefined && !CURRENCY_VALUES.includes(offer.currency)) {
    throw validationFailed('currency', `must be one of ${CURRENCY_VALUES.join(', ')}`);
  }
  if (offer.displayNumerals !== undefined && !DISPLAY_NUMERAL_VALUES.includes(offer.displayNumerals)) {
    throw validationFailed('displayNumerals', `must be one of ${DISPLAY_NUMERAL_VALUES.join(', ')}`);
  }
  if (offer.pricingMode !== undefined && !PRICING_MODE_VALUES.includes(offer.pricingMode)) {
    throw validationFailed('pricingMode', `must be one of ${PRICING_MODE_VALUES.join(', ')}`);
  }
  if (offer.invoiceOutputDefault !== undefined && !INVOICE_OUTPUT_VALUES.includes(offer.invoiceOutputDefault)) {
    throw validationFailed('invoiceOutputDefault', `must be one of ${INVOICE_OUTPUT_VALUES.join(', ')}`);
  }
  if (offer.roundingMode !== undefined && !ROUNDING_MODE_VALUES.includes(offer.roundingMode)) {
    throw validationFailed('roundingMode', `must be one of ${ROUNDING_MODE_VALUES.join(', ')}`);
  }
  if (
    offer.offlineReceiptIdFormat !== undefined &&
    !OFFLINE_RECEIPT_ID_FORMAT_VALUES.includes(offer.offlineReceiptIdFormat)
  ) {
    throw validationFailed('offlineReceiptIdFormat', `must be one of ${OFFLINE_RECEIPT_ID_FORMAT_VALUES.join(', ')}`);
  }

  if (offer.invoiceFooter !== undefined) {
    if (offer.invoiceFooter.length > INVOICE_FOOTER_MAX_LENGTH) {
      throw validationFailed('invoiceFooter', `must be at most ${INVOICE_FOOTER_MAX_LENGTH} characters`);
    }
  }

  if (offer.maxDiscountPercentage !== undefined) {
    if (typeof offer.maxDiscountPercentage !== 'number' || !Number.isFinite(offer.maxDiscountPercentage)) {
      throw validationFailed('maxDiscountPercentage', 'must be a number');
    }
    if (offer.maxDiscountPercentage < 0 || offer.maxDiscountPercentage > 100) {
      throw validationFailed('maxDiscountPercentage', 'must be between 0 and 100');
    }
  }

  if (offer.minorUnitExponent !== undefined) {
    parseUnboundedInt('minorUnitExponent', offer.minorUnitExponent);
    if (offer.minorUnitExponent < MINOR_UNIT_EXPONENT_MIN || offer.minorUnitExponent > MINOR_UNIT_EXPONENT_MAX) {
      throw validationFailed(
        'minorUnitExponent',
        `must be a whole number between ${MINOR_UNIT_EXPONENT_MIN} and ${MINOR_UNIT_EXPONENT_MAX}`,
      );
    }
  }

  if (offer.reservedBlockSize !== undefined) {
    parseUnboundedInt('reservedBlockSize', offer.reservedBlockSize);
    if (offer.reservedBlockSize < RESERVED_BLOCK_SIZE_MIN || offer.reservedBlockSize > RESERVED_BLOCK_SIZE_MAX) {
      throw validationFailed(
        'reservedBlockSize',
        `must be a whole number between ${RESERVED_BLOCK_SIZE_MIN} and ${RESERVED_BLOCK_SIZE_MAX}`,
      );
    }
  }

  if (offer.offlineGraceDurationSeconds !== undefined) {
    parseGraceDurationSeconds('offlineGraceDurationSeconds', offer.offlineGraceDurationSeconds);
  }

  if (offer.featureFlags !== undefined) {
    canonical.featureFlags = canonicalizeFeatureFlags(offer.featureFlags);
  }

  return canonical;
}

/**
 * Refuses a field whose §22.2/§22.4 gate the caller does not hold — including
 * the owner-exclusive fields beyond the two catalog permissions, since the
 * M2-S3 record fixes that enforcement as the settings layer's own policy on
 * top of `settings.edit`.
 */
export function assertFieldGate(field: string, caller: SettingsCallerAuthorization): SettingsFieldGate {
  const gate = SETTINGS_FIELD_GATES[field];
  if (gate === undefined) {
    throw validationFailed(field, 'is not a setting this server accepts');
  }
  if (gate === 'owner') {
    if (!caller.isOwner) {
      throw new DomainError(ERROR_CODES.PERMISSION_DENIED, 'this setting is reserved for the organization owner');
    }
    return gate;
  }
  if (!caller.permissions.includes(gate)) {
    throw new DomainError(ERROR_CODES.PERMISSION_DENIED, `this setting requires the ${gate} permission`);
  }
  return gate;
}

/** The keys the request's `featureFlags` array knows. An unknown key is a rejection, not a guess. */
export function canonicalizeFeatureFlags(
  flags: readonly { readonly key: string; readonly enabled: boolean }[],
): readonly { readonly key: string; readonly enabled: boolean }[] {
  for (const flag of flags) {
    if (!FEATURE_FLAG_KEY_PATTERN.test(flag.key) || !FEATURE_FLAG_KEYS.includes(flag.key)) {
      throw validationFailed('featureFlags', `names "${flag.key}", which is not a flag this server knows`);
    }
  }
  return flags;
}

/**
 * Compares an offer against the stored row and names every effective change.
 * Bigint money surfaces as a decimal string (the wire's money shape); a
 * cleared approval threshold is `old: string|null → new: null`.
 */
export function classifyChanges(offer: CommittedSettingsOffer, stored: StoredSettingsShape): EffectiveChange[] {
  const changes: EffectiveChange[] = [];
  const push = (field: string, oldValue: EffectiveChange['oldValue'], newValue: EffectiveChange['newValue']): void => {
    if (oldValue !== newValue) changes.push({ field, oldValue, newValue });
  };

  if (offer.organizationName !== undefined) push('organizationName', stored.organizationName, offer.organizationName);
  if (offer.currency !== undefined) push('currency', stored.currency, offer.currency);
  if (offer.displayNumerals !== undefined) push('displayNumerals', stored.displayNumerals, offer.displayNumerals);
  if (offer.pricingMode !== undefined) push('pricingMode', stored.pricingMode, offer.pricingMode);
  if (offer.invoiceOutputDefault !== undefined) {
    push('invoiceOutputDefault', stored.invoiceOutputDefault, offer.invoiceOutputDefault);
  }
  if (offer.roundingMode !== undefined) push('roundingMode', stored.roundingMode, offer.roundingMode);
  if (offer.offlineReceiptIdFormat !== undefined) {
    push('offlineReceiptIdFormat', stored.offlineReceiptIdFormat, offer.offlineReceiptIdFormat);
  }
  if (offer.invoiceFooter !== undefined) push('invoiceFooter', stored.invoiceFooter, offer.invoiceFooter);

  if (offer.maxDiscountPercentage !== undefined) {
    push(
      'maxDiscountPercentage',
      storedDecimalToNumber('maxDiscountPercentage', stored.maxDiscountPercentage),
      offer.maxDiscountPercentage,
    );
  }
  if (offer.maxDiscountAmountMinor !== undefined) {
    push('maxDiscountAmountMinor', stored.maxDiscountAmountMinor, minorsToString(offer.maxDiscountAmountMinor));
  }
  if (offer.discountApprovalThresholdMinor !== undefined) {
    push(
      'discountApprovalThresholdMinor',
      stored.discountApprovalThresholdMinor,
      offer.discountApprovalThresholdMinor === null ? null : minorsToString(offer.discountApprovalThresholdMinor),
    );
  }

  if (offer.discountAllowedForSalesperson !== undefined) {
    push('discountAllowedForSalesperson', stored.discountAllowedForSalesperson, offer.discountAllowedForSalesperson);
  }
  if (offer.blockDiscountBelowCost !== undefined) {
    push('blockDiscountBelowCost', stored.blockDiscountBelowCost, offer.blockDiscountBelowCost);
  }
  if (offer.invoiceShowLogo !== undefined) push('invoiceShowLogo', stored.invoiceShowLogo, offer.invoiceShowLogo);
  if (offer.customerRequiredOnCreditSale !== undefined) {
    push('customerRequiredOnCreditSale', stored.customerRequiredOnCreditSale, offer.customerRequiredOnCreditSale);
  }
  if (offer.receivablesAgingEnabled !== undefined) {
    push('receivablesAgingEnabled', stored.receivablesAgingEnabled, offer.receivablesAgingEnabled);
  }

  if (offer.minorUnitExponent !== undefined) {
    push('minorUnitExponent', stored.minorUnitExponent, offer.minorUnitExponent);
  }
  if (offer.reservedBlockSize !== undefined) {
    push('reservedBlockSize', stored.reservedBlockSize, offer.reservedBlockSize);
  }
  if (offer.offlineGraceDurationSeconds !== undefined) {
    push(
      'offlineGraceDurationSeconds',
      stored.offlineGraceDurationSeconds,
      minorsToString(offer.offlineGraceDurationSeconds),
    );
  }
  if (offer.offlineReservedNumberBlocks !== undefined) {
    push('offlineReservedNumberBlocks', stored.offlineReservedNumberBlocks, offer.offlineReservedNumberBlocks);
  }

  if (offer.featureFlags !== undefined) {
    const byKey = new Map(stored.flags.map((flag) => [flag.key, flag.enabled]));
    for (const flag of offer.featureFlags) {
      push(`featureFlags:${flag.key}`, byKey.get(flag.key) ?? null, flag.enabled);
    }
  }

  return changes;
}

function storedDecimalToNumber(field: string, stored: string): number {
  const asNumber = Number(stored);
  if (!Number.isFinite(asNumber)) {
    throw new DomainError(ERROR_CODES.INTERNAL_ERROR, `the stored ${field} is not a readable number`);
  }
  return asNumber;
}

/** Bigint renders as its decimal string — the wire's 64-bit money shape. */
function minorsToString(value: bigint | null): string | null {
  return value === null ? null : value.toString();
}
