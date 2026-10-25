/**
 * The catalog wire contract (Master Plan §15.1, §15.2, §15.3A, §17, §30.1;
 * §40.8 row M4-S1; §34.1 — the routes ride the versioned `/api/v1` namespace,
 * organization-scoped by the route parameter the authorization guard validates
 * against the access token's membership claim, never by a body field §9.3):
 *
 * - `GET    …/catalog/products`                      — the live list (`catalog.view`).
 * - `POST   …/catalog/products`                      — create with §15.2 units (`catalog.edit`).
 * - `GET    …/catalog/products/:productId`           — one product, units + variants (`catalog.view`).
 * - `PATCH  …/catalog/products/:productId`           — partial update (`catalog.edit`).
 * - `DELETE …/catalog/products/:productId`           — §15.1 soft delete with reason (`catalog.edit`).
 * - `PUT    …/catalog/products/:productId/units`     — the whole §15.2 configuration (`catalog.edit`).
 * - `POST   …/catalog/products/:productId/variants`              — one variant (`catalog.edit`).
 * - `PATCH  …/catalog/products/:productId/variants/:variantId` — one variant update (`catalog.edit`).
 *
 * Wire types (§22.1 discipline): 64-bit money is a decimal **string** of
 * minor units (§30.1 — never a float, never a fractional element), bounded
 * integers are plain JSON numbers, closed vocabularies are closed unions.
 * No response ever carries a credential, a session value, or a tenant
 * identifier other than the verified one.
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, Allow } from 'class-validator';

import {
  BRAND_MAX_LENGTH,
  CATEGORY_MAX_LENGTH,
  CATALOG_TEXT_WIRE_PATTERN,
  DELETE_REASON_MAX_LENGTH,
  NAME_MAX_LENGTH,
  PRICE_MINOR_WIRE_PATTERN,
  PRICE_SOURCE_VALUES,
  SKU_MAX_LENGTH,
  UNIT_CODE_MAX_LENGTH,
  UNIT_NAME_MAX_LENGTH,
  UNIT_KIND_VALUES,
  PURCHASING_UNIT_FACTOR_MAX,
} from './catalog.contract';

/** Path constant, re-exported so a routing test can assert it without importing the file. */
export const CATALOG_PATH = 'api/v1/organizations/:organizationId/catalog';

/** The bounded-text pattern a trimmed wire string must hold (the migration CHECKs restate it). */
const BOUNDED_TEXT = CATALOG_TEXT_WIRE_PATTERN.source;

/** One unit row as an offer member and as a response member. */
export class ProductUnitWire {
  @ApiProperty({
    description: 'The §15.2 unit kind (V1: BASE or PURCHASING).',
    enum: [...UNIT_KIND_VALUES],
  })
  readonly kind!: (typeof UNIT_KIND_VALUES)[number];

  @ApiProperty({ description: 'The short unit code (e.g. "PCS", "CRT").', maxLength: UNIT_CODE_MAX_LENGTH })
  readonly code!: string;

  @ApiProperty({ description: 'The human unit name.', maxLength: UNIT_NAME_MAX_LENGTH })
  readonly name!: string;

  @ApiProperty({
    type: 'string',
    description:
      'The exact base-quantity factor: "1" for BASE, an exact integer ≥ 2 for PURCHASING (a decimal-string ' +
      'so the 64-bit value can never survive a float).',
  })
  readonly baseQuantityFactor!: string;
}

/** `POST …/catalog/products` request. */
export class CreateProductRequest {
  @ApiProperty({
    description: 'The Arabic product name (§6.1 Arabic-first).',
    minLength: 1,
    maxLength: NAME_MAX_LENGTH,
  })
  @IsString()
  @Matches(new RegExp(BOUNDED_TEXT, 'u'), { message: 'nameAr must have non-whitespace ends after trimming' })
  @MaxLength(NAME_MAX_LENGTH)
  readonly nameAr!: string;

  @ApiPropertyOptional({
    description: 'The optional English name.',
    type: 'string',
    maxLength: NAME_MAX_LENGTH,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Matches(new RegExp(BOUNDED_TEXT, 'u'), { message: 'nameEn must have non-whitespace ends after trimming' })
  @MaxLength(NAME_MAX_LENGTH)
  readonly nameEn?: string | null;

  @ApiPropertyOptional({
    description: 'The optional category label.',
    type: 'string',
    maxLength: CATEGORY_MAX_LENGTH,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Matches(new RegExp(BOUNDED_TEXT, 'u'), { message: 'category must have non-whitespace ends after trimming' })
  @MaxLength(CATEGORY_MAX_LENGTH)
  readonly category?: string | null;

  @ApiPropertyOptional({
    description: 'The optional brand label.',
    type: 'string',
    maxLength: BRAND_MAX_LENGTH,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Matches(new RegExp(BOUNDED_TEXT, 'u'), { message: 'brand must have non-whitespace ends after trimming' })
  @MaxLength(BRAND_MAX_LENGTH)
  readonly brand?: string | null;

  @ApiPropertyOptional({
    description: 'The product-level default selling price as a decimal string of minor units (§30.1); null is unset.',
    type: 'string',
    pattern: PRICE_MINOR_WIRE_PATTERN.source,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Matches(PRICE_MINOR_WIRE_PATTERN)
  readonly unitPriceMinor?: string | null;

  @ApiProperty({
    description: 'The base selling unit (§15.2): required, factor exactly 1.',
    type: 'object',
    required: ['code', 'name'],
    properties: {
      code: { type: 'string', maxLength: UNIT_CODE_MAX_LENGTH },
      name: { type: 'string', maxLength: UNIT_NAME_MAX_LENGTH },
      kind: { type: 'string', enum: ['BASE'] },
    },
  })
  // The unit's deep validation lives in the catalog canonicalizer (raw-wire
  // discipline); `Allow` only admits the member past the whitelist pipe.
  @Allow()
  readonly baseUnit!: Omit<ProductUnitWire, 'kind'> & { readonly kind?: 'BASE' };

  @ApiPropertyOptional({
    description: 'The optional purchasing unit (§15.2) with its exact integer factor ≥ 2.',
    type: 'object',
    required: ['code', 'name'],
    properties: {
      code: { type: 'string', maxLength: UNIT_CODE_MAX_LENGTH },
      name: { type: 'string', maxLength: UNIT_NAME_MAX_LENGTH },
      baseQuantityFactor: {
        type: 'integer',
        minimum: 2,
        maximum: PURCHASING_UNIT_FACTOR_MAX,
        description: 'The exact buying factor: how many base units one purchasing unit holds.',
      },
    },
    nullable: true,
  })
  @Allow()
  readonly purchasingUnit?: (Omit<ProductUnitWire, 'kind'> & { readonly kind?: 'PURCHASING' }) | null;
}

/** `PATCH …/catalog/products/:productId` request: absent members stay untouched. */
export class UpdateProductRequest {
  @ApiPropertyOptional({ description: 'The Arabic product name.', minLength: 1, maxLength: NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @Matches(new RegExp(BOUNDED_TEXT, 'u'), { message: 'nameAr must have non-whitespace ends after trimming' })
  @MaxLength(NAME_MAX_LENGTH)
  readonly nameAr?: string;

  @ApiPropertyOptional({
    description: 'The English name; explicit null clears it.',
    type: 'string',
    maxLength: NAME_MAX_LENGTH,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Matches(new RegExp(BOUNDED_TEXT, 'u'), { message: 'nameEn must have non-whitespace ends after trimming' })
  @MaxLength(NAME_MAX_LENGTH)
  readonly nameEn?: string | null;

  @ApiPropertyOptional({
    description: 'The category; explicit null clears it.',
    type: 'string',
    maxLength: CATEGORY_MAX_LENGTH,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Matches(new RegExp(BOUNDED_TEXT, 'u'), { message: 'category must have non-whitespace ends after trimming' })
  @MaxLength(CATEGORY_MAX_LENGTH)
  readonly category?: string | null;

  @ApiPropertyOptional({
    description: 'The brand; explicit null clears it.',
    type: 'string',
    maxLength: BRAND_MAX_LENGTH,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Matches(new RegExp(BOUNDED_TEXT, 'u'), { message: 'brand must have non-whitespace ends after trimming' })
  @MaxLength(BRAND_MAX_LENGTH)
  readonly brand?: string | null;

  @ApiPropertyOptional({
    description:
      'The default selling price in minor units; explicit null clears it back to unset (never zero by drift).',
    type: 'string',
    pattern: PRICE_MINOR_WIRE_PATTERN.source,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Matches(PRICE_MINOR_WIRE_PATTERN)
  readonly unitPriceMinor?: string | null;

  @ApiPropertyOptional({
    description: 'The active flag. Deactivation is not the soft delete: it is a visibility of intent.',
  })
  @IsOptional()
  @IsBoolean()
  readonly isActive?: boolean;
}

/** `DELETE …/catalog/products/:productId` request body: the §15.1 recorded reason. */
export class DeleteProductRequest {
  @ApiProperty({
    description: 'Why the product leaves the live catalog (§15.1: the soft delete records its reason).',
    minLength: 1,
    maxLength: DELETE_REASON_MAX_LENGTH,
  })
  @IsString()
  @Matches(new RegExp(BOUNDED_TEXT, 'u'), { message: 'reason must have non-whitespace ends after trimming' })
  @MaxLength(DELETE_REASON_MAX_LENGTH)
  readonly reason!: string;
}

/** `PUT …/catalog/products/:productId/units` request: the whole configuration is the new truth. */
export class UpdateUnitsRequest {
  @ApiProperty({
    description: 'The base unit: required, factor exactly 1.',
    type: 'object',
    required: ['code', 'name'],
    properties: {
      code: { type: 'string', maxLength: UNIT_CODE_MAX_LENGTH },
      name: { type: 'string', maxLength: UNIT_NAME_MAX_LENGTH },
      kind: { type: 'string', enum: ['BASE'] },
    },
  })
  // Deep validation is the canonicalizer's job; `Allow` admits the member past
  // the whitelist pipe.
  @Allow()
  readonly baseUnit!: Omit<ProductUnitWire, 'kind'> & { readonly kind?: 'BASE' };

  @ApiPropertyOptional({
    description: 'The purchasing unit with its exact factor, or explicit null to remove it.',
    type: 'object',
    required: ['code', 'name'],
    properties: {
      code: { type: 'string', maxLength: UNIT_CODE_MAX_LENGTH },
      name: { type: 'string', maxLength: UNIT_NAME_MAX_LENGTH },
      baseQuantityFactor: {
        type: 'integer',
        minimum: 2,
        maximum: PURCHASING_UNIT_FACTOR_MAX,
        description: 'The exact buying factor: how many base units one purchasing unit holds.',
      },
    },
    nullable: true,
  })
  @Allow()
  readonly purchasingUnit?: (Omit<ProductUnitWire, 'kind'> & { readonly kind?: 'PURCHASING' }) | null;
}

/** `POST …/catalog/products/:productId/variants` request. */
export class CreateVariantRequest {
  @ApiProperty({
    description: 'The SKU — unique per organization by a real database index.',
    minLength: 1,
    maxLength: SKU_MAX_LENGTH,
  })
  @IsString()
  @Matches(new RegExp(BOUNDED_TEXT, 'u'), { message: 'sku must have non-whitespace ends after trimming' })
  @MaxLength(SKU_MAX_LENGTH)
  readonly sku!: string;

  @ApiPropertyOptional({
    description:
      'The typed attribute object (§15.3A.2): only the V1 catalog keys (color/size/capacity) with their ' +
      'typed shapes are accepted; unknown keys and malformed values are refused field by field.',
    example: { color: 'أسود', size: 'M' },
  })
  @IsObject()
  readonly attributes?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'The own selling price override in minor units; null inherits the product price (§15.3A.2).',
    type: 'string',
    pattern: PRICE_MINOR_WIRE_PATTERN.source,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Matches(PRICE_MINOR_WIRE_PATTERN)
  readonly priceMinor?: string | null;

  @ApiPropertyOptional({ description: 'Whether the variant is sellable (default true).' })
  @IsOptional()
  @IsBoolean()
  readonly isActive?: boolean;
}

/** `PATCH …/catalog/products/:productId/variants/:variantId` request: absent members stay untouched. */
export class UpdateVariantRequest {
  @ApiPropertyOptional({
    description: 'The SKU (a duplicate answers 409 CATALOG_SKU_DUPLICATE).',
    minLength: 1,
    maxLength: SKU_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @Matches(new RegExp(BOUNDED_TEXT, 'u'), { message: 'sku must have non-whitespace ends after trimming' })
  @MaxLength(SKU_MAX_LENGTH)
  readonly sku?: string;

  @ApiPropertyOptional({
    description:
      'A whole replacement attribute object — present (even as {}) means the offer is the new truth; ' +
      'absent keeps the stored set.',
    example: { color: 'أسود', size: 'L' },
  })
  @IsOptional()
  @IsObject()
  readonly attributes?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'The own price override in minor units; explicit null clears it back to inheritance.',
    type: 'string',
    pattern: PRICE_MINOR_WIRE_PATTERN.source,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Matches(PRICE_MINOR_WIRE_PATTERN)
  readonly priceMinor?: string | null;

  @ApiPropertyOptional({ description: 'Whether the variant is sellable.' })
  @IsOptional()
  @IsBoolean()
  readonly isActive?: boolean;
}

/** `GET …/catalog/products` query parameters. */
export class ListProductsQuery {
  @ApiPropertyOptional({ description: 'A case-insensitive substring match against the Arabic or English name.' })
  @IsOptional()
  @IsString()
  @MaxLength(NAME_MAX_LENGTH)
  readonly search?: string;

  @ApiPropertyOptional({ description: 'Include §15.1 soft-deleted products (default false).', type: 'boolean' })
  @IsOptional()
  @IsBoolean()
  readonly includeDeleted?: boolean;

  @ApiPropertyOptional({
    description: 'The maximum number of products to answer (1..500).',
    type: 'integer',
    minimum: 1,
    maximum: 500,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  readonly limit?: number;
}

/** One variant as the response answers it. */
export class ProductVariantResponse {
  @ApiProperty({ format: 'uuid', description: "The variant id — the identity M4-S2's inventory engine will track." })
  readonly id!: string;

  @ApiProperty({ description: 'The SKU.' })
  readonly sku!: string;

  @ApiProperty({
    description: 'The typed attributes object.',
    type: 'object',
    additionalProperties: true,
    example: { color: 'أسود', size: 'M' },
  })
  readonly attributes!: Record<string, string | number>;

  @ApiProperty({
    description: 'The own price override in minor units, or null when it inherits the product price (§15.3A.2).',
    type: 'string',
    nullable: true,
  })
  readonly priceMinor!: string | null;

  @ApiProperty({ description: 'Whether the variant is sellable.' })
  readonly isActive!: boolean;

  @ApiProperty({
    description: 'The §15.3A.2 resolved selling price — never a fabricated zero.',
    type: 'string',
    nullable: true,
  })
  readonly effectivePriceMinor!: string | null;

  @ApiProperty({ description: 'Where the effective price came from (§15.3A.2).', enum: [...PRICE_SOURCE_VALUES] })
  readonly priceSource!: (typeof PRICE_SOURCE_VALUES)[number];

  @ApiProperty({
    description:
      'Whether the variant carries a cost price. False in V1 — the costing engine arrives with M4-S3 (§30.2); never a real zero.',
  })
  readonly hasCost!: boolean;

  @ApiProperty({ format: 'date-time', description: 'The creation instant.' })
  readonly createdAt!: string;

  @ApiProperty({ format: 'date-time', description: 'The last accepted write.' })
  readonly updatedAt!: string;
}

/** One product as the detail response answers it. */
export class ProductResponse {
  @ApiProperty({ format: 'uuid', description: 'The product id.' })
  readonly id!: string;

  @ApiProperty({ format: 'uuid', description: 'The verified tenant (derived from the route, never the body).' })
  readonly organizationId!: string;

  @ApiProperty({ description: 'The Arabic name (§6.1).' })
  readonly nameAr!: string;

  @ApiProperty({ description: 'The optional English name.', nullable: true, type: 'string' })
  readonly nameEn!: string | null;

  @ApiProperty({ description: 'The optional category.', nullable: true, type: 'string' })
  readonly category!: string | null;

  @ApiProperty({ description: 'The optional brand.', nullable: true, type: 'string' })
  readonly brand!: string | null;

  @ApiProperty({
    description: 'The product-level default price in minor units, or null when unset (§15.3A.2 inheritance).',
    type: 'string',
    nullable: true,
  })
  readonly unitPriceMinor!: string | null;

  @ApiProperty({ description: 'The active flag.' })
  readonly isActive!: boolean;

  @ApiProperty({
    type: () => [ProductUnitWire],
    description: 'The §15.2 units: one BASE, plus at most one PURCHASING.',
  })
  readonly units!: readonly ProductUnitWire[];

  @ApiProperty({ type: () => [ProductVariantResponse], description: 'The variants with their effective prices.' })
  readonly variants!: readonly ProductVariantResponse[];

  @ApiProperty({ format: 'date-time', description: 'The creation instant.' })
  readonly createdAt!: string;

  @ApiProperty({ format: 'date-time', description: 'The last accepted write.' })
  readonly updatedAt!: string;
}

/** One product summary as the list response answers it. */
export class ProductSummaryResponse {
  @ApiProperty({ format: 'uuid', description: 'The product id.' })
  readonly id!: string;

  @ApiProperty({ description: 'The Arabic name (§6.1).' })
  readonly nameAr!: string;

  @ApiProperty({ description: 'The optional English name.', nullable: true, type: 'string' })
  readonly nameEn!: string | null;

  @ApiProperty({ description: 'The optional category.', nullable: true, type: 'string' })
  readonly category!: string | null;

  @ApiProperty({ description: 'The optional brand.', nullable: true, type: 'string' })
  readonly brand!: string | null;

  @ApiProperty({ description: 'The default price in minor units, or null when unset.', type: 'string', nullable: true })
  readonly unitPriceMinor!: string | null;

  @ApiProperty({ description: 'The active flag.' })
  readonly isActive!: boolean;

  @ApiProperty({ type: 'integer', description: 'How many variants the product carries.' })
  readonly variantCount!: number;

  @ApiProperty({ description: 'Whether a PURCHASING unit exists (§15.2).' })
  readonly hasPurchasingUnit!: boolean;

  @ApiProperty({ format: 'date-time', description: 'The creation instant.' })
  readonly createdAt!: string;

  @ApiProperty({ format: 'date-time', description: 'The last accepted write.' })
  readonly updatedAt!: string;
}

/** `GET …/catalog/products` response. */
export class ProductListResponse {
  @ApiProperty({ type: () => [ProductSummaryResponse], description: 'The live products, in deterministic order.' })
  readonly products!: readonly ProductSummaryResponse[];
}
