/**
 * The settings wire contract (Master Plan §22, §22.4, §38.18; §40.7 row M3-S1;
 * §34.1 two routes under the versioned `/api/v1` namespace, organization-scoped
 * by the route parameter the authorization guard validates against the access
 * token's membership claim — never by a request body field (§9.3)):
 *
 * - `GET …/settings` — the organization's typed settings with the current
 *   `settings_version` (§38.18). Requires `settings.view`.
 * - `PUT …/settings` — a field-authorized partial update. Every member is
 *   optional (absent = untouched) and is checked against the §22.2/§22.4
 *   permission column *inside* the write transaction; `settingsVersion` in the
 *   body is the §38.18 concurrency token (`expected`), a mismatch answers the
 *   new `409 SETTINGS_VERSION_CONFLICT`, and the changed row, its version
 *   increment, and the audit event commit in one transaction (§32.5 class A).
 *   The route requires whatever permissions the provided fields' gates demand
 *   (§22.2); an owner-exclusive field is refused to any non-owner regardless
 *   of the catalog permissions they hold (the M2-S3 catalog note).
 *
 * Types are the plan's, named exactly (§22.1): typed columns on 64-bit money —
 * decimal strings (the M1b-S6 `server_sequence` wire decision), decimal
 * integers — plain numbers, closed enum vocabularies. No response or request
 * ever carries a credential, a session value, or a tenant identifier other
 * than the verified one.
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import {
  CURRENCY_VALUES,
  DISPLAY_NUMERAL_VALUES,
  INVOICE_OUTPUT_VALUES,
  OFFLINE_RECEIPT_ID_FORMAT_VALUES,
  PRICING_MODE_VALUES,
  ROUNDING_MODE_VALUES,
} from './settings.contract';
import { DECIMAL_MINORS_WIRE_PATTERN } from './settings.domain';

/** Path constant, re-exported so a routing test can assert it without importing the file. */
export const SETTINGS_PATH = 'api/v1/organizations/:organizationId/settings';

/** One `featureFlags` array member: the flag key and its target state. */
export class FeatureFlagUpdate {
  @ApiPropertyOptional({
    description:
      'The flag key from the versioned code catalog (§22.2 typed rows). An unknown key is refused, never invented.',
    example: 'SEEDED_FLAG_EXAMPLE',
  })
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{2,63}$/)
  readonly key!: string;

  @ApiPropertyOptional({ description: 'The target state of the flag (§22.2).' })
  @IsBoolean()
  readonly enabled!: boolean;
}

/** `PUT …/settings` request: only the provided members change; every value is validated. */
export class UpdateOrganizationSettingsRequest {
  @ApiProperty({
    type: 'integer',
    description:
      'The §38.18 concurrency token: the settings_version the caller read. A mismatch answers ' +
      'SETTINGS_VERSION_CONFLICT (409) rather than performing a silent lost update.',
  })
  @IsInt()
  @Min(1)
  readonly settingsVersion!: number;

  @ApiPropertyOptional({
    description: 'The organization display name (§22.2 `organization_name`).',
    minLength: 1,
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @Matches(/^\S[\s\S]*\S$|^\S$/, { message: 'organizationName must have non-whitespace ends after trimming' })
  readonly organizationName?: string;

  @ApiPropertyOptional({ description: 'The V1 currency (§22.2).', enum: [...CURRENCY_VALUES] })
  @IsOptional()
  @IsIn([...CURRENCY_VALUES])
  readonly currency?: (typeof CURRENCY_VALUES)[number];

  @ApiPropertyOptional({
    description: 'The minor-unit exponent (§22.2). Owner-exclusive.',
    type: 'integer',
    minimum: 0,
    maximum: 9,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9)
  readonly minorUnitExponent?: number;

  @ApiPropertyOptional({
    description: 'The on-screen display numerals (§6.8, §22.2).',
    enum: [...DISPLAY_NUMERAL_VALUES],
  })
  @IsOptional()
  @IsIn([...DISPLAY_NUMERAL_VALUES])
  readonly displayNumerals?: (typeof DISPLAY_NUMERAL_VALUES)[number];

  @ApiPropertyOptional({ description: 'The active pricing mode (§17, §22.2).', enum: [...PRICING_MODE_VALUES] })
  @IsOptional()
  @IsIn([...PRICING_MODE_VALUES])
  readonly pricingMode?: (typeof PRICING_MODE_VALUES)[number];

  @ApiPropertyOptional({ description: 'The discount ceiling, percent (§18, §22.2).', minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  readonly maxDiscountPercentage?: number;

  @ApiPropertyOptional({
    description: 'The discount ceiling as a decimal string of minor units (64-bit wire money). Zero or positive.',
    pattern: DECIMAL_MINORS_WIRE_PATTERN.source,
  })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL_MINORS_WIRE_PATTERN)
  readonly maxDiscountAmountMinor?: string;

  @ApiPropertyOptional({
    description:
      'The discount approval gate in minor units: a decimal string, or explicit null to clear it. ' +
      'Absent leaves the value untouched (§22.2 the setting is nullable by decision).',
    required: false,
    type: 'string',
    nullable: true,
    pattern: DECIMAL_MINORS_WIRE_PATTERN.source,
  })
  @IsOptional()
  readonly discountApprovalThresholdMinor?: string | null;

  @ApiPropertyOptional({ description: 'Whether a salesperson may apply discounts (§18, §22.2).' })
  @IsOptional()
  @IsBoolean()
  readonly discountAllowedForSalesperson?: boolean;

  @ApiPropertyOptional({ description: 'Whether a below-cost discount is blocked (§18, §22.2).' })
  @IsOptional()
  @IsBoolean()
  readonly blockDiscountBelowCost?: boolean;

  @ApiPropertyOptional({
    description: 'The default invoice output behaviour (§21.2, §22.2).',
    enum: [...INVOICE_OUTPUT_VALUES],
  })
  @IsOptional()
  @IsIn([...INVOICE_OUTPUT_VALUES])
  readonly invoiceOutputDefault?: (typeof INVOICE_OUTPUT_VALUES)[number];

  @ApiPropertyOptional({ description: 'The footer text on printed invoices (§22.2).', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  readonly invoiceFooter?: string;

  @ApiPropertyOptional({ description: 'Whether invoices show the organization logo (§22.2).' })
  @IsOptional()
  @IsBoolean()
  readonly invoiceShowLogo?: boolean;

  @ApiPropertyOptional({ description: 'Whether a credit sale requires a customer record (§22.2).' })
  @IsOptional()
  @IsBoolean()
  readonly customerRequiredOnCreditSale?: boolean;

  @ApiPropertyOptional({
    description: 'The money rounding mode (§30.6, §22.2). Owner-exclusive.',
    enum: [...ROUNDING_MODE_VALUES],
  })
  @IsOptional()
  @IsIn([...ROUNDING_MODE_VALUES])
  readonly roundingMode?: (typeof ROUNDING_MODE_VALUES)[number];

  @ApiPropertyOptional({ description: 'Whether receivables aging is enabled (§22.2).' })
  @IsOptional()
  @IsBoolean()
  readonly receivablesAgingEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'The offline grace window in seconds — 1 second to 30 days (§22.4, O-13/O-20). Owner-exclusive.',
    type: 'integer',
    minimum: 1,
    maximum: 2592000,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2592000)
  readonly offlineGraceDurationSeconds?: number;

  @ApiPropertyOptional({
    description: 'The device receipt presentation format (§16.4A.2, §22.4).',
    enum: [...OFFLINE_RECEIPT_ID_FORMAT_VALUES],
  })
  @IsOptional()
  @IsIn([...OFFLINE_RECEIPT_ID_FORMAT_VALUES])
  readonly offlineReceiptIdFormat?: (typeof OFFLINE_RECEIPT_ID_FORMAT_VALUES)[number];

  @ApiPropertyOptional({
    description: 'Whether offline receipts may use reserved invoice-look number blocks (§16.4A.2, §22.4).',
  })
  @IsOptional()
  @IsBoolean()
  readonly offlineReservedNumberBlocks?: boolean;

  @ApiPropertyOptional({
    description: 'The reserved block size (§22.4). Owner-exclusive.',
    type: 'integer',
    minimum: 1,
    maximum: 10000,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  readonly reservedBlockSize?: number;

  @ApiPropertyOptional({
    description: 'The §22.2 feature flags as typed row updates. Owner-exclusive; an unknown key is refused.',
    type: () => [FeatureFlagUpdate],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  @ValidateNested({ each: true })
  @Type(() => FeatureFlagUpdate)
  readonly featureFlags?: FeatureFlagUpdate[];
}

/** The GET/PUT response: every typed setting with its current value and version. */
export class OrganizationSettingsResponse {
  @ApiProperty({
    format: 'uuid',
    description: 'The tenant whose settings these are (derived from the verified route).',
  })
  readonly organizationId!: string;

  @ApiProperty({ type: 'integer', description: 'The §38.18 monotonic settings version (§40.7 M3-S1).' })
  readonly settingsVersion!: number;

  @ApiProperty({ description: 'The organization display name (§22.2 `organization_name`).' })
  readonly organizationName!: string;

  @ApiProperty({ description: 'The V1 currency (§22.2).', enum: [...CURRENCY_VALUES] })
  readonly currency!: (typeof CURRENCY_VALUES)[number];

  @ApiProperty({ type: 'integer', description: 'The minor-unit exponent (§22.2).' })
  readonly minorUnitExponent!: number;

  @ApiProperty({ description: 'The on-screen display numerals (§6.8).', enum: [...DISPLAY_NUMERAL_VALUES] })
  readonly displayNumerals!: (typeof DISPLAY_NUMERAL_VALUES)[number];

  @ApiProperty({ description: 'The active pricing mode (§17).', enum: [...PRICING_MODE_VALUES] })
  readonly pricingMode!: (typeof PRICING_MODE_VALUES)[number];

  @ApiProperty({ description: 'The discount ceiling, percent (§18).', type: 'number' })
  readonly maxDiscountPercentage!: number;

  @ApiProperty({ description: 'The discount ceiling as a decimal string of minor units (64-bit wire money).' })
  readonly maxDiscountAmountMinor!: string;

  @ApiProperty({
    description: 'The discount approval gate as a decimal string of minor units, or null when no gate stands.',
    type: 'string',
    nullable: true,
  })
  readonly discountApprovalThresholdMinor!: string | null;

  @ApiProperty({ description: 'Whether a salesperson may apply discounts (§18).' })
  readonly discountAllowedForSalesperson!: boolean;

  @ApiProperty({ description: 'Whether a below-cost discount is blocked (§18).' })
  readonly blockDiscountBelowCost!: boolean;

  @ApiProperty({ description: 'The default invoice output behaviour (§21.2).', enum: [...INVOICE_OUTPUT_VALUES] })
  readonly invoiceOutputDefault!: (typeof INVOICE_OUTPUT_VALUES)[number];

  @ApiProperty({ description: 'The footer text on printed invoices (§22.2).' })
  readonly invoiceFooter!: string;

  @ApiProperty({ description: 'Whether invoices show the organization logo.' })
  readonly invoiceShowLogo!: boolean;

  @ApiProperty({ description: 'Whether a credit sale requires a customer record.' })
  readonly customerRequiredOnCreditSale!: boolean;

  @ApiProperty({ description: 'The money rounding mode (§30.6).', enum: [...ROUNDING_MODE_VALUES] })
  readonly roundingMode!: (typeof ROUNDING_MODE_VALUES)[number];

  @ApiProperty({ description: 'Whether receivables aging is enabled.' })
  readonly receivablesAgingEnabled!: boolean;

  @ApiProperty({
    type: 'integer',
    description: 'The offline grace window in seconds — 1 second to 30 days (§22.4, O-13/O-20).',
  })
  readonly offlineGraceDurationSeconds!: number;

  @ApiProperty({
    description: 'The device receipt presentation format (§16.4A.2).',
    enum: [...OFFLINE_RECEIPT_ID_FORMAT_VALUES],
  })
  readonly offlineReceiptIdFormat!: (typeof OFFLINE_RECEIPT_ID_FORMAT_VALUES)[number];

  @ApiProperty({ description: 'Whether offline receipts may use reserved number blocks (§16.4A.2).' })
  readonly offlineReservedNumberBlocks!: boolean;

  @ApiProperty({ type: 'integer', description: 'The reserved block size (§22.4).', minimum: 1, maximum: 10000 })
  readonly reservedBlockSize!: number;

  @ApiProperty({
    type: () => [FeatureFlagUpdate],
    description: 'The §22.2 feature flags as typed rows (empty in V1 — the plan defines no flag vocabulary yet).',
  })
  readonly featureFlags!: readonly { readonly key: string; readonly enabled: boolean }[];

  @ApiProperty({ format: 'date-time', description: 'The last accepted settings write (§38.18 freshness marker).' })
  readonly updatedAt!: string;
}
