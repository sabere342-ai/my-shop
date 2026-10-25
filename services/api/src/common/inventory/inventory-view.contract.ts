/**
 * The inventory wire contract (Master Plan §15.4, §15.5, §15.6, §15.6A,
 * §38.14.1; §40.8 row M4-S2; §34.1 — the routes ride the versioned `/api/v1`
 * namespace, organization-scoped by the route parameter the authorization
 * guard validates against the access token's membership claim, never by a
 * body field §9.3):
 *
 * - `GET  …/inventory/locations` — the organization's locations, the V1 default seeded (§15.4).
 * - `GET  …/inventory/levels`    — the derived, cacheable quantities (`inventory.view`).
 * - `GET  …/inventory/movements` — the authoritative movement history (`inventory.view`).
 * - `POST …/inventory/movements` — submit one movement behind the §15.6 guard (`inventory.adjust`,
 *        escalating to the cost authority for the cost-imposing causes, §38.5).
 * - `GET  …/inventory/valuation` — the §30.2 valuation: quantity × moving average, exact (`catalog.cost.edit`).
 * - `GET  …/inventory/cost-snapshots` — the movements that carry a recorded unit cost (`catalog.cost.edit`).
 *
 * The POST answers the ledger's idempotency semantics (§38.9, §38.10): an
 * identical retry of the same `movementId` is a `REPLAY` answered with the
 * stored movement (200, never a second effect); the same identity naming a
 * different fact is a 409 `MUTATION_CONTRADICTION`; a quantity the §15.6
 * conditional guard cannot cover is a 409 `INSUFFICIENT_STOCK` with the
 * balance untouched. First acceptance and replay share one precise shape: a
 * `status` member the client branches on, exactly as the push endpoint's
 * per-mutation outcomes do.
 *
 * Wire types (§22.1 discipline): 64-bit quantities are decimal **strings**
 * (§30.1 — never a float), bounded integers are plain JSON numbers, closed
 * vocabularies are closed unions, and identity ids are canonical UUIDs. No
 * response ever carries a credential, a session value, or a tenant identifier
 * other than the verified one.
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

import {
  ADJUSTMENT_REASON_CODES,
  INVENTORY_LIST_MAX_LIMIT,
  INVENTORY_TEXT_WIRE_PATTERN,
  MOVEMENT_CAUSE_VOCABULARY,
  QUANTITY_WIRE_PATTERN,
  SUBMITTABLE_MOVEMENT_CAUSES,
  UUID_WIRE_PATTERN,
} from './inventory.contract';

/** Path constant, re-exported so a routing test can assert it without importing the file. */
export const INVENTORY_PATH = 'api/v1/organizations/:organizationId/inventory';

const BOUNDED_TEXT = INVENTORY_TEXT_WIRE_PATTERN.source;
const UUID_SHAPE = UUID_WIRE_PATTERN.source;
const QUANTITY_SHAPE = QUANTITY_WIRE_PATTERN.source;

/** `GET …/inventory/levels` query. */
export class ListLevelsQuery {
  @ApiPropertyOptional({ description: 'Restrict the answer to one variant.', format: 'uuid' })
  @IsOptional()
  @Matches(new RegExp(UUID_SHAPE, 'u'), { message: 'variantId must be a canonical UUID' })
  readonly variantId?: string;

  @ApiPropertyOptional({ description: 'Restrict the answer to one location.', format: 'uuid' })
  @IsOptional()
  @Matches(new RegExp(UUID_SHAPE, 'u'), { message: 'locationId must be a canonical UUID' })
  readonly locationId?: string;

  @ApiPropertyOptional({ description: 'The bounded page size.', type: 'integer', maximum: INVENTORY_LIST_MAX_LIMIT })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(INVENTORY_LIST_MAX_LIMIT)
  readonly limit?: number;
}

/** `GET …/inventory/movements` query. */
export class ListMovementsQuery extends ListLevelsQuery {}

/** One derived stock level as the wire answers it. */
export class LevelResponse {
  @ApiProperty({ description: 'The variant the level belongs to.', format: 'uuid' })
  readonly variantId!: string;

  @ApiProperty({ description: 'The variant SKU (M4-S1).' })
  readonly sku!: string;

  @ApiProperty({ description: 'The parent product’s Arabic name (M4-S1).' })
  readonly productNameAr!: string;

  @ApiProperty({ description: 'The location the level belongs to.', format: 'uuid' })
  readonly locationId!: string;

  @ApiProperty({ description: 'The location name.' })
  readonly locationName!: string;

  @ApiProperty({
    description: 'The §15.4 derived quantity in exact base units, a decimal string — never negative.',
    example: '24',
  })
  readonly quantity!: string;

  @ApiProperty({ description: 'When the level last moved.', format: 'date-time' })
  readonly updatedAt!: string;
}

/** One movement as the wire answers it — the §38.14.1 identity, honestly labeled. */
export class MovementResponse {
  @ApiProperty({ description: 'The §38.14.1 movement id (the client’s idempotency key).', format: 'uuid' })
  readonly movementId!: string;

  @ApiProperty({ description: 'The §15.5 closed cause.', enum: [...MOVEMENT_CAUSE_VOCABULARY] })
  readonly cause!: MovementCause;

  @ApiProperty({ description: 'The variant that moved.', format: 'uuid' })
  readonly variantId!: string;

  @ApiProperty({ description: 'The variant SKU (M4-S1).' })
  readonly sku!: string;

  @ApiProperty({ description: 'The location the movement landed at.', format: 'uuid' })
  readonly locationId!: string;

  @ApiProperty({
    description: 'The signed, exact base-unit delta as a decimal string (§15.6).',
    example: '24',
  })
  readonly quantityDelta!: string;

  @ApiPropertyOptional({
    description: 'The §38.5 reason code, when the movement is an adjustment.',
    type: 'string',
    nullable: true,
    enum: [...ADJUSTMENT_REASON_CODES],
  })
  readonly reasonCode!: string | null;

  @ApiPropertyOptional({
    description: 'The operator’s own words, when the movement carries one.',
    type: 'string',
    nullable: true,
  })
  readonly reasonNote!: string | null;

  @ApiProperty({
    description: 'The per-organization acceptance order the server assigned (§38.14.1).',
    type: 'string',
    example: '7',
  })
  readonly serverSequence!: string;

  @ApiProperty({ description: 'The movement’s business time.', format: 'date-time' })
  readonly occurredAt!: string;

  @ApiProperty({ description: 'When the row was created.', format: 'date-time' })
  readonly createdAt!: string;
}

/** `POST …/inventory/movements` request. */
export class SubmitMovementRequest {
  @ApiProperty({
    description:
      'The §38.14.1 movement identity: the caller-generated UUID that is the whole operation’s idempotency key. ' +
      'An identical retry replays; the same identity naming a different fact is refused.',
    format: 'uuid',
  })
  @Matches(new RegExp(UUID_SHAPE, 'u'), { message: 'movementId must be a canonical UUID' })
  readonly movementId!: string;

  @ApiProperty({
    description: 'The cause this slice produces (§15.5; other causes arrive with their owning slices).',
    enum: [...SUBMITTABLE_MOVEMENT_CAUSES],
  })
  @IsIn([...SUBMITTABLE_MOVEMENT_CAUSES], { message: 'cause must be a member of the §15.5 closed vocabulary' })
  readonly cause!: SubmittableMovementCause;

  @ApiProperty({ description: 'The variant to move.', format: 'uuid' })
  @Matches(new RegExp(UUID_SHAPE, 'u'), { message: 'variantId must be a canonical UUID' })
  readonly variantId!: string;

  @ApiPropertyOptional({
    description: 'The location to move at; absent names the V1 default location.',
    format: 'uuid',
    nullable: true,
  })
  @IsOptional()
  @Matches(new RegExp(UUID_SHAPE, 'u'), { message: 'locationId must be a canonical UUID' })
  readonly locationId?: string | null;

  @ApiProperty({
    description: 'The signed, exact base-unit delta as a decimal string (POS for a receipt, NEG for an issue).',
    example: '24',
  })
  @Matches(new RegExp(QUANTITY_SHAPE, 'u'), { message: 'quantityDelta must be a signed decimal string' })
  readonly quantityDelta!: string;

  @ApiPropertyOptional({
    description:
      'The §30.2 acquisition cost in exact minor units as a decimal string. Required for OPENING_BALANCE, ' +
      'PURCHASE_RECEIPT, and REVALUATION (the engine never fabricates a cost); optional for a positive ' +
      'MANUAL_ADJUSTMENT (with it the engine folds the offered cost into the §30.3 moving average); ' +
      'refused for a negative one (a consumption snapshots the engine’s current average).',
    example: '18500',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,12}$/, {
    message: 'unitCostMinor must be a non-negative integer decimal string of at most 12 digits',
  })
  readonly unitCostMinor?: string | null;

  @ApiPropertyOptional({
    description: 'The §38.5 closed reason code — required for MANUAL_ADJUSTMENT, refused for OPENING_BALANCE.',
    type: 'string',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Matches(new RegExp(BOUNDED_TEXT, 'u'), { message: 'reasonCode must be bounded text' })
  readonly reasonCode?: string | null;

  @ApiPropertyOptional({
    description: 'The operator’s optional bounded note.',
    type: 'string',
    maxLength: 300,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Matches(new RegExp(BOUNDED_TEXT, 'u'), { message: 'reasonNote must have non-whitespace ends after trimming' })
  readonly reasonNote?: string | null;

  @ApiPropertyOptional({
    description: 'The optional document reference (bounded text).',
    type: 'string',
    maxLength: 300,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Matches(new RegExp(BOUNDED_TEXT, 'u'), { message: 'documentRef must have non-whitespace ends after trimming' })
  readonly documentRef?: string | null;
}

/** The `POST …/inventory/movements` answer (§38.9 stream semantics). */
export class MovementSubmissionResponse {
  @ApiProperty({
    description: '`APPLIED` on first acceptance, `REPLAY` when the stored answer is returned (§38.9.1).',
    enum: ['APPLIED', 'REPLAY'],
  })
  readonly status!: 'APPLIED' | 'REPLAY';

  @ApiProperty({ type: () => MovementResponse })
  readonly movement!: MovementResponse;

  @ApiProperty({ description: 'The variant’s resulting level at this location, a decimal string.' })
  readonly resultingQuantity!: string;

  @ApiProperty({ type: () => LevelResponse, description: 'The affected derived level row.' })
  readonly level!: LevelResponse;
}

/** `GET …/inventory/locations` answer. */
export class LocationListResponse {
  @ApiProperty({ type: () => [LocationResponse] })
  readonly locations!: LocationResponse[];
}

/** `GET …/inventory/levels` answer. */
export class LevelListResponse {
  @ApiProperty({ type: () => [LevelResponse] })
  readonly levels!: LevelResponse[];
}

/** `GET …/inventory/movements` answer. */
export class MovementListResponse {
  @ApiProperty({ type: () => [MovementResponse] })
  readonly movements!: MovementResponse[];
}

/** One location as the wire answers it. */
export class LocationResponse {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty()
  readonly name!: string;

  @ApiProperty({ description: 'The V1 default location is exactly one per organization (§15.4).', type: 'boolean' })
  readonly isDefault!: boolean;

  @ApiProperty({ format: 'date-time' })
  readonly createdAt!: string;
}

/**
 * `GET …/inventory/valuation` — one valued level. Every money member is a
 * decimal string of exact integer minor units (§30.1); an absent basis is
 * `null`, never a fabricated zero (A30.2: the engine's honesty marker).
 */
export class ValuationLevelResponse {
  @ApiProperty({ description: 'The variant the valued stock belongs to.', format: 'uuid' })
  readonly variantId!: string;

  @ApiProperty({ description: 'The variant SKU (M4-S1).' })
  readonly sku!: string;

  @ApiProperty({ description: 'The parent product’s Arabic name (M4-S1).' })
  readonly productNameAr!: string;

  @ApiProperty({ description: 'The location the valued stock sits in.', format: 'uuid' })
  readonly locationId!: string;

  @ApiProperty({ description: 'The location name.' })
  readonly locationName!: string;

  @ApiProperty({ description: 'The remaining quantity, exact base units, a decimal string.', example: '24' })
  readonly quantity!: string;

  @ApiProperty({
    description: 'The §30.2 moving average cost per base unit, minor units — null until a basis exists.',
    type: 'string',
    nullable: true,
    example: '18500',
  })
  readonly averageCostMinor!: string | null;

  @ApiProperty({
    description: 'The §30.2 inventory value: quantity × average, exact minor units — null with the basis.',
    type: 'string',
    nullable: true,
    example: '444000',
  })
  readonly inventoryValueMinor!: string | null;

  @ApiProperty({ description: 'When the level last folded.', format: 'date-time' })
  readonly updatedAt!: string;
}

/** The exact totals of one valuation answer. */
export class ValuationTotalsResponse {
  @ApiProperty({
    description: 'The sum of the valued rows’ inventory value, exact minor units (§30.2’s identity).',
    example: '444000',
  })
  readonly inventoryValueMinor!: string;

  @ApiProperty({
    description: 'How many answered levels carry a basis and are folded into the total.',
    type: 'integer',
  })
  readonly valuedLevels!: number;

  @ApiProperty({
    description: 'How many answered levels have no cost basis yet — counted, never folded in at an invented cost.',
    type: 'integer',
  })
  readonly uncostedLines!: number;
}

/** `GET …/inventory/valuation` answer (`catalog.cost.edit`). */
export class ValuationResponse {
  @ApiProperty({ type: () => [ValuationLevelResponse] })
  readonly levels!: ValuationLevelResponse[];

  @ApiProperty({ type: () => ValuationTotalsResponse })
  readonly totals!: ValuationTotalsResponse;
}

/**
 * `GET …/inventory/cost-snapshots` — one costed movement: the §30.2 snapshot
 * row that records exactly what unit cost the engine used, newest acceptance
 * first. The cost the valuation restated is reconstructible from this ledger
 * alone (§30.2’s rationale).
 */
export class CostSnapshotResponse {
  @ApiProperty({ description: 'The §38.14.1 movement id.', format: 'uuid' })
  readonly movementId!: string;

  @ApiProperty({ description: 'The §15.5 closed cause.', enum: [...MOVEMENT_CAUSE_VOCABULARY] })
  readonly cause!: MovementCause;

  @ApiProperty({ description: 'The variant that moved.', format: 'uuid' })
  readonly variantId!: string;

  @ApiProperty({ description: 'The variant SKU (M4-S1).' })
  readonly sku!: string;

  @ApiProperty({ description: 'The parent product’s Arabic name (M4-S1).' })
  readonly productNameAr!: string;

  @ApiProperty({ description: 'The location the movement landed at.', format: 'uuid' })
  readonly locationId!: string;

  @ApiProperty({ description: 'The location name.' })
  readonly locationName!: string;

  @ApiProperty({ description: 'The signed, exact base-unit delta as a decimal string.' })
  readonly quantityDelta!: string;

  @ApiProperty({
    description: 'The §30.2 unit cost the engine applied, exact minor units.',
    example: '18500',
  })
  readonly unitCostMinor!: string;

  @ApiProperty({ description: 'The per-organization acceptance order (§38.14.1).', type: 'string' })
  readonly serverSequence!: string;

  @ApiProperty({ description: 'The movement’s business time.', format: 'date-time' })
  readonly occurredAt!: string;
}

/** `GET …/inventory/cost-snapshots` answer (`catalog.cost.edit`). */
export class CostSnapshotListResponse {
  @ApiProperty({ type: () => [CostSnapshotResponse] })
  readonly costSnapshots!: CostSnapshotResponse[];
}

/** The one admissible cause type the request names (the canonicalizer re-proves membership). */
export type SubmittableMovementCause = (typeof SUBMITTABLE_MOVEMENT_CAUSES)[number];
/** The one movement-cause union the response carries. */
export type MovementCause = (typeof MOVEMENT_CAUSE_VOCABULARY)[number];
