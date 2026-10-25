/**
 * The catalog domain half (Master Plan §15.1, §15.2, §15.3A, §17, §30.1;
 * §40.8 row M4-S1).
 *
 * Pure validation and normalization, no I/O and no transport types: every
 * request value is proven (and normalized) here before any connection work is
 * attempted, so a refused offer costs nothing and can never half-apply — the
 * same shape `settings.domain.ts` gives the settings surface. Every refusal is
 * a `VALIDATION_FAILED` with field-shaped detail, so the RFC 7807 problem
 * document names the offending property (§34.3).
 *
 * Normalization is deliberately minimal and honest text-in/text-out:
 * whitespace trimming on bounded text (each bound restated by the migration's
 * CHECKs), decimal-string money parsed to exact `bigint` minor units
 * (§30.1 — never a float, never a locale-parsed number), and integer
 * attribute values accepted only as JSON numbers that are exact integers.
 */

import { DomainError } from '../errors/domain.error';
import { ERROR_CODES } from '../errors/problem';
import type { PriceSource } from './catalog.contract';
import {
  BRAND_MAX_LENGTH,
  CATALOG_TEXT_WIRE_PATTERN,
  CATEGORY_MAX_LENGTH,
  DELETE_REASON_MAX_LENGTH,
  MAX_PRICE_MINOR,
  NAME_MAX_LENGTH,
  PRICE_MINOR_WIRE_PATTERN,
  PURCHASING_UNIT_FACTOR_MAX,
  PURCHASING_UNIT_FACTOR_MIN,
  SKU_MAX_LENGTH,
  UNIT_CODE_MAX_LENGTH,
  UNIT_NAME_MAX_LENGTH,
  VARIANT_ATTRIBUTE_CATALOG,
  VARIANT_ATTRIBUTE_INTEGER_MAX,
  VARIANT_ATTRIBUTE_KEYS,
  VARIANT_ATTRIBUTE_TEXT_MAX_LENGTH,
} from './catalog.contract';

/** One field-shaped violation a caller can act on. */
export interface FieldViolation {
  readonly field: string;
  readonly messages: readonly string[];
}

/** A closed shape a validated offer must satisfy. */
export interface TextInput {
  readonly patternError: string;
  readonly maxLength: number;
}

/**
 * Trimmed, shaped text for one bounded field: absent stays `undefined`, an
 * explicit `null` (where the caller clears an optional field) stays `null`,
 * and anything that is not whitespace-bounded text of a legal length is a
 * violation.
 */
export function normalizeOptText(
  field: string,
  value: string | null | undefined,
  input: TextInput,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new DomainError(ERROR_CODES.VALIDATION_FAILED, `${field} must be a string`, [
      { field, messages: [`${field} must be a string`] },
    ]);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || !CATALOG_TEXT_WIRE_PATTERN.test(trimmed) || trimmed.length > input.maxLength) {
    throw new DomainError(ERROR_CODES.VALIDATION_FAILED, `${field} is not acceptable bounded text`, [
      {
        field,
        messages: [
          `${input.patternError} — text of 1..${input.maxLength} characters after trimming, without leading or trailing whitespace`,
        ],
      },
    ]);
  }
  return trimmed;
}

/** Required trimmed text: a missing field is a violation like a malformed one. */
export function normalizeRequiredText(field: string, value: string, input: TextInput): string {
  const normalized = normalizeOptText(field, value, input);
  if (normalized === undefined || normalized === null) {
    throw new DomainError(ERROR_CODES.VALIDATION_FAILED, `${field} is required`, [
      { field, messages: [`${field} is required`] },
    ]);
  }
  return normalized;
}

/** An exact-integer selling price in minor units, from its decimal-string wire form. */
export function parsePriceMinor(text: string): bigint {
  if (typeof text !== 'string' || !PRICE_MINOR_WIRE_PATTERN.test(text)) {
    throw new DomainError(
      ERROR_CODES.VALIDATION_FAILED,
      'a selling price must be a decimal string of up to 12 minor-unit digits',
      [{ field: 'price', messages: [`must match ${PRICE_MINOR_WIRE_PATTERN.source}`] }],
    );
  }
  const value = BigInt(text);
  if (value > MAX_PRICE_MINOR) {
    throw new DomainError(ERROR_CODES.VALIDATION_FAILED, 'a selling price exceeds the bounded maximum', [
      { field: 'price', messages: [`must not exceed 12 minor-unit digits`] },
    ]);
  }
  return value;
}

/** Canonicalized offer scalar for the `name_ar` column end to end. */
export function normalizeSku(value: string): string {
  return normalizeRequiredText('sku', value, {
    patternError: 'sku must be bounded text',
    maxLength: SKU_MAX_LENGTH,
  });
}

/** One variant's attribute object, canonicalized against the closed catalog. */
export function canonicalizeAttributes(value: unknown): Record<string, string | number> {
  if (value === undefined) return {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DomainError(ERROR_CODES.VALIDATION_FAILED, 'attributes must be an object', [
      { field: 'attributes', messages: ['attributes must be a JSON object whose keys are catalog attribute keys'] },
    ]);
  }
  const raw = value as Record<string, unknown>;
  const violations: FieldViolation[] = [];
  const canonical: Record<string, string | number> = {};
  for (const key of Object.keys(raw)) {
    const definition = (VARIANT_ATTRIBUTE_CATALOG as Record<string, { type: string } | undefined>)[key];
    if (definition === undefined) {
      violations.push({
        field: `attributes.${key}`,
        messages: [`unknown attribute key; the V1 catalog keys are ${VARIANT_ATTRIBUTE_KEYS.join(', ')}`],
      });
      continue;
    }
    const item = raw[key];
    if (definition.type === 'TEXT') {
      if (typeof item !== 'string') {
        violations.push({ field: `attributes.${key}`, messages: ['must be a string'] });
        continue;
      }
      const trimmed = item.trim();
      if (
        trimmed.length < 1 ||
        trimmed.length > VARIANT_ATTRIBUTE_TEXT_MAX_LENGTH ||
        !CATALOG_TEXT_WIRE_PATTERN.test(trimmed)
      ) {
        violations.push({
          field: `attributes.${key}`,
          messages: [`must be bounded text of 1..${VARIANT_ATTRIBUTE_TEXT_MAX_LENGTH} characters after trimming`],
        });
        continue;
      }
      canonical[key] = trimmed;
      continue;
    }
    // The INTEGER shape: an exact JSON number, never a string or a fraction —
    // `1.5` is not a quantity, and a "1.5 pack" is exactly the ambiguity the
    // plan keeps out of the unit model (§15.2).
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 0 || item > VARIANT_ATTRIBUTE_INTEGER_MAX) {
      violations.push({
        field: `attributes.${key}`,
        messages: [`must be an integer between 0 and ${VARIANT_ATTRIBUTE_INTEGER_MAX}`],
      });
      continue;
    }
    canonical[key] = item;
  }
  if (violations.length > 0) {
    throw new DomainError(ERROR_CODES.VALIDATION_FAILED, 'the attributes object is not acceptable', violations);
  }
  return canonical;
}

/** One §15.2 unit row as it arrives from an offer, already proven. */
export interface UnitOffer {
  readonly kind: 'BASE' | 'PURCHASING';
  readonly code: string;
  readonly name: string;
  /** Exactly 1 for `BASE`; 2..1,000,000 for `PURCHASING` (§15.2, migration 0013). */
  readonly baseQuantityFactor: bigint;
}

function unitOf(
  kind: UnitOffer['kind'],
  value: { readonly code?: string | null; readonly name?: string | null; readonly baseQuantityFactor?: number },
  violations: FieldViolation[],
): UnitOffer | undefined {
  const prefix = kind === 'BASE' ? 'baseUnit' : 'purchasingUnit';
  if (value === undefined || value === null) {
    violations.push({ field: prefix, messages: [`${prefix} is required`] });
    return undefined;
  }
  let code: string | undefined;
  let name: string | undefined;
  try {
    code = normalizeRequiredText(`${prefix}.code`, (value as Record<string, unknown>)['code'] as string, {
      patternError: `${prefix}.code must be bounded text`,
      maxLength: UNIT_CODE_MAX_LENGTH,
    });
  } catch {
    violations.push({
      field: `${prefix}.code`,
      messages: [`must be bounded text of 1..${UNIT_CODE_MAX_LENGTH} characters after trimming`],
    });
  }
  try {
    name = normalizeRequiredText(`${prefix}.name`, (value as Record<string, unknown>)['name'] as string, {
      patternError: `${prefix}.name must be bounded text`,
      maxLength: UNIT_NAME_MAX_LENGTH,
    });
  } catch {
    violations.push({
      field: `${prefix}.name`,
      messages: [`must be bounded text of 1..${UNIT_NAME_MAX_LENGTH} characters after trimming`],
    });
  }
  // A buying factor is a plain count, but it must be exactly it: a fraction
  // (a "12.5 carton") would put a unit boundary through §30.1's integer law.
  const factor = (value as Record<string, unknown>)['baseQuantityFactor'];
  if (kind === 'PURCHASING') {
    if (
      typeof factor !== 'number' ||
      !Number.isInteger(factor) ||
      factor < PURCHASING_UNIT_FACTOR_MIN ||
      factor > PURCHASING_UNIT_FACTOR_MAX
    ) {
      violations.push({
        field: `${prefix}.baseQuantityFactor`,
        messages: [`must be an integer between ${PURCHASING_UNIT_FACTOR_MIN} and ${PURCHASING_UNIT_FACTOR_MAX}`],
      });
    }
  }
  if (
    code === undefined ||
    name === undefined ||
    (kind === 'PURCHASING' && typeof factor === 'number' && !Number.isInteger(factor))
  ) {
    return undefined;
  }
  return {
    kind,
    code: code,
    name: name,
    baseQuantityFactor: kind === 'BASE' ? 1n : BigInt(factor as number),
  };
}

/**
 * Proof for a full unit configuration (§15.2): the base unit is required and
 * carries factor 1 by definition; the purchasing unit is optional with its
 * exact integer factor. This is the whole configuration: a request that
 * omits the purchasing unit ends the day without one.
 */
export function canonicalizeUnitOffer(value: { readonly base?: unknown; readonly purchasing?: unknown }): {
  readonly base: UnitOffer;
  readonly purchasing: UnitOffer | null;
} {
  const violations: FieldViolation[] = [];
  const base = unitOf('BASE', value.base as never, violations);
  const purchasing =
    value.purchasing === undefined || value.purchasing === null
      ? null
      : unitOf('PURCHASING', value.purchasing, violations);
  if (base === undefined) {
    if (value.base === undefined || value.base === null) {
      violations.push({ field: 'baseUnit', messages: ['baseUnit is required'] });
    }
  }
  if (violations.length > 0) {
    throw new DomainError(ERROR_CODES.VALIDATION_FAILED, 'the unit configuration is not acceptable', violations);
  }
  if (base === undefined || (value.purchasing !== undefined && value.purchasing !== null && purchasing === undefined)) {
    // Unreachable in practice: every fail above collected a violation and
    // threw. Kept as a type narrow for the compiler's exactness (§7.1).
    throw new DomainError(ERROR_CODES.INTERNAL_ERROR, 'unreachable unit offer state');
  }
  return { base, purchasing: purchasing ?? null };
}

/** A product create offer, every field proven and normalized. */
export interface CreateProductOffer {
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly category: string | null;
  readonly brand: string | null;
  readonly unitPriceMinor: bigint | null;
  readonly baseUnit: UnitOffer;
  readonly purchasingUnit: UnitOffer | null;
}

/** The raw wire shape `canonicalizeCreateProductOffer` proves (the service's input type). */
export interface CreateProductOfferWire {
  readonly nameAr?: string | null;
  readonly nameEn?: string | null;
  readonly category?: string | null;
  readonly brand?: string | null;
  readonly unitPriceMinor?: string | null;
  readonly baseUnit?: unknown;
  readonly purchasingUnit?: unknown;
}

export function canonicalizeCreateProductOffer(value: CreateProductOfferWire): CreateProductOffer {
  const violations: FieldViolation[] = [];
  const nameAr = textOrViolation('nameAr', value.nameAr, { maxLength: NAME_MAX_LENGTH }, violations, true);
  const nameEn = textOrViolation('nameEn', value.nameEn, { maxLength: NAME_MAX_LENGTH }, violations);
  const category = textOrViolation('category', value.category, { maxLength: CATEGORY_MAX_LENGTH }, violations);
  const brand = textOrViolation('brand', value.brand, { maxLength: BRAND_MAX_LENGTH }, violations);
  const unitPriceMinor = priceOrViolation(value.unitPriceMinor, violations);
  let units: { base: UnitOffer; purchasing: UnitOffer | null };
  try {
    units = canonicalizeUnitOffer({ base: value.baseUnit, purchasing: value.purchasingUnit });
  } catch (error) {
    if (error instanceof DomainError && error.errors !== undefined) {
      violations.push(...error.errors.map((entry) => ({ field: entry.field, messages: [...entry.messages] })));
      units = { base: { kind: 'BASE', code: '', name: '', baseQuantityFactor: 1n }, purchasing: null };
    } else {
      throw error;
    }
  }
  if (violations.length > 0) {
    throw new DomainError(ERROR_CODES.VALIDATION_FAILED, 'the product offer is not acceptable', violations);
  }
  return {
    nameAr: nameAr as string,
    nameEn: nameEn ?? null,
    category: category ?? null,
    brand: brand ?? null,
    unitPriceMinor: unitPriceMinor ?? null,
    baseUnit: units.base,
    purchasingUnit: units.purchasing,
  };
}

/** A product update offer. `undefined` keeps a column; `null` clears it. */
export interface UpdateProductOffer {
  readonly nameAr: string | undefined;
  readonly nameEn: string | null | undefined;
  readonly category: string | null | undefined;
  readonly brand: string | null | undefined;
  readonly unitPriceMinor: bigint | null | undefined;
  readonly isActive: boolean | undefined;
  readonly deactivatedReason: string | null | undefined;
}

/** The raw wire shape `canonicalizeUpdateProductOffer` proves (the service's input type). */
export interface UpdateProductOfferWire {
  readonly nameAr?: string | null;
  readonly nameEn?: string | null;
  readonly category?: string | null;
  readonly brand?: string | null;
  readonly unitPriceMinor?: string | null;
  readonly isActive?: boolean;
  readonly deactivatedReason?: string | null;
}

export function canonicalizeUpdateProductOffer(value: UpdateProductOfferWire): UpdateProductOffer {
  const violations: FieldViolation[] = [];
  const nameAr = textOrViolation('nameAr', value.nameAr, { maxLength: NAME_MAX_LENGTH }, violations);
  if (value.nameAr === null) {
    violations.push({ field: 'nameAr', messages: ['nameAr cannot be cleared; it is required text'] });
  }
  const nameEn = textOrViolation('nameEn', value.nameEn, { maxLength: NAME_MAX_LENGTH }, violations);
  const category = textOrViolation('category', value.category, { maxLength: CATEGORY_MAX_LENGTH }, violations);
  const brand = textOrViolation('brand', value.brand, { maxLength: BRAND_MAX_LENGTH }, violations);
  const unitPriceMinor = priceOrViolation(value.unitPriceMinor, violations);
  const deactivatedReason = textOrViolation(
    'deactivatedReason',
    value.deactivatedReason,
    { maxLength: DELETE_REASON_MAX_LENGTH },
    violations,
  );
  if (value.isActive !== undefined && typeof value.isActive !== 'boolean') {
    violations.push({ field: 'isActive', messages: ['isActive must be a boolean'] });
  }
  if (violations.length > 0) {
    throw new DomainError(ERROR_CODES.VALIDATION_FAILED, 'the product update is not acceptable', violations);
  }
  return {
    nameAr: nameAr ?? undefined,
    nameEn,
    category,
    brand,
    unitPriceMinor,
    isActive: value.isActive,
    deactivatedReason,
  };
}

/** A variant create offer, every field proven and normalized. */
export interface CreateVariantOffer {
  readonly sku: string;
  readonly attributes: Record<string, string | number>;
  readonly priceMinor: bigint | null;
  readonly isActive: boolean;
}

/** The raw wire shape `canonicalizeCreateVariantOffer` proves (the service's input type). */
export interface CreateVariantOfferWire {
  readonly sku?: string;
  readonly attributes?: unknown;
  readonly priceMinor?: string | null;
  readonly isActive?: boolean;
}

export function canonicalizeCreateVariantOffer(value: CreateVariantOfferWire): CreateVariantOffer {
  const violations: FieldViolation[] = [];
  let sku: string | undefined;
  try {
    sku = normalizeSku(value.sku ?? '');
  } catch {
    violations.push({
      field: 'sku',
      messages: [`sku must be bounded text of 1..${SKU_MAX_LENGTH} characters after trimming`],
    });
  }
  let attributes: Record<string, string | number>;
  try {
    attributes = canonicalizeAttributes(value.attributes);
  } catch (error) {
    if (error instanceof DomainError && error.errors !== undefined) {
      violations.push(...error.errors.map((entry) => ({ field: entry.field, messages: [...entry.messages] })));
    }
    attributes = {};
  }
  const priceMinor = priceOrViolation(value.priceMinor, violations);
  if (value.isActive !== undefined && typeof value.isActive !== 'boolean') {
    violations.push({ field: 'isActive', messages: ['isActive must be a boolean'] });
  }
  if (violations.length > 0) {
    throw new DomainError(ERROR_CODES.VALIDATION_FAILED, 'the variant offer is not acceptable', violations);
  }
  return { sku: sku as string, attributes, priceMinor: priceMinor ?? null, isActive: value.isActive !== false };
}

/** A variant update offer. `undefined` keeps a field; `null` on a price clears the override. */
export interface UpdateVariantOffer {
  readonly sku: string | undefined;
  /** Present (even as `{}`) replaces the whole attribute set — the offer is the new truth. */
  readonly attributes: Record<string, string | number> | undefined;
  readonly priceMinor: bigint | null | undefined;
  readonly isActive: boolean | undefined;
}

/** The raw wire shape `canonicalizeUpdateVariantOffer` proves (the service's input type). */
export interface UpdateVariantOfferWire {
  readonly sku?: string;
  readonly attributes?: unknown;
  readonly priceMinor?: string | null;
  readonly isActive?: boolean;
}

export function canonicalizeUpdateVariantOffer(value: UpdateVariantOfferWire): UpdateVariantOffer {
  const violations: FieldViolation[] = [];
  let sku: string | undefined;
  if (value.sku !== undefined) {
    try {
      sku = normalizeSku(value.sku);
    } catch {
      violations.push({
        field: 'sku',
        messages: [`sku must be bounded text of 1..${SKU_MAX_LENGTH} characters after trimming`],
      });
    }
  }
  let attributes: Record<string, string | number> | undefined;
  if (value.attributes !== undefined) {
    try {
      attributes = canonicalizeAttributes(value.attributes);
    } catch (error) {
      if (error instanceof DomainError && error.errors !== undefined) {
        violations.push(...error.errors.map((entry) => ({ field: entry.field, messages: [...entry.messages] })));
      }
      // Keep `attributes` defined so the service commits *nothing* for it; a
      // violation below aborts the whole attempt anyway.
      attributes = {};
    }
  }
  const priceMinor = priceOrViolation(value.priceMinor, violations);
  if (value.isActive !== undefined && typeof value.isActive !== 'boolean') {
    violations.push({ field: 'isActive', messages: ['isActive must be a boolean'] });
  }
  if (violations.length > 0) {
    throw new DomainError(ERROR_CODES.VALIDATION_FAILED, 'the variant update is not acceptable', violations);
  }
  return { sku, attributes, priceMinor, isActive: value.isActive };
}

/** One changed field, safe by construction: values are stored-domain scalars, never credentials. */
export interface CatalogFieldChange {
  readonly field: string;
  readonly oldValue: string | boolean | null;
  readonly newValue: string | boolean | null;
}

/** Compares a before/after scalar map and returns only the actually changed fields. */
export function classifyChanges(
  before: { readonly [key: string]: string | boolean | null | undefined },
  after: { readonly [key: string]: string | boolean | null | undefined },
): readonly CatalogFieldChange[] {
  const changes: CatalogFieldChange[] = [];
  for (const field of Object.keys(after)) {
    const beforeValue = before[field] ?? null;
    const afterValue = after[field] ?? null;
    if (beforeValue !== afterValue) {
      changes.push({ field, oldValue: beforeValue, newValue: afterValue });
    }
  }
  return changes;
}

/**
 * The §15.3A.2 price inheritance rule: the variant's own override wins; an
 * absent override inherits the product's default; absent everywhere the price
 * is **unset** — never zero, because zero is a real value a catalog editor
 * stores deliberately and unset is a distinct business state.
 */
export function resolveEffectivePrice(
  productUnitPriceMinor: bigint | null,
  variantPriceMinor: bigint | null,
): { readonly effective: bigint | null; readonly source: PriceSource } {
  if (variantPriceMinor !== null) {
    return { effective: variantPriceMinor, source: 'VARIANT' };
  }
  if (productUnitPriceMinor !== null) {
    return { effective: productUnitPriceMinor, source: 'PRODUCT' };
  }
  return { effective: null, source: 'UNSET' };
}

// --- internals ---

type Violations = FieldViolation[];

function textOrViolation(
  field: string,
  value: string | null | undefined,
  input: { readonly maxLength: number },
  violations: Violations,
  required = false,
): string | null | undefined {
  if (value === undefined) {
    if (required) violations.push({ field, messages: [`${field} is required`] });
    return required ? undefined : undefined;
  }
  try {
    return normalizeOptText(field, value, {
      patternError: `${field} must be bounded text`,
      maxLength: input.maxLength,
    });
  } catch {
    violations.push({
      field,
      messages:
        value === null
          ? required
            ? [`${field} is required`]
            : ['explicit null is not accepted here']
          : [`must be bounded text of 1..${input.maxLength} characters after trimming`],
    });
    return undefined;
  }
}

type PriceWire = string | null | undefined;

function priceOrViolation(value: PriceWire, violations: Violations): bigint | null | undefined {
  if (value === undefined) return undefined;
  try {
    return value === null ? null : parsePriceMinor(value);
  } catch {
    violations.push({
      field: 'price',
      messages: ['a selling price must be a decimal string of up to 12 minor-unit digits, or explicit null to clear'],
    });
    return undefined;
  }
}
