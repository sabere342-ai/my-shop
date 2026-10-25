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
 * - `POST …/inventory/movements` — submit one movement behind the §15.6 guard (`inventory.adjust`).
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

/** The one admissible cause type the request names (the canonicalizer re-proves membership). */
export type SubmittableMovementCause = (typeof SUBMITTABLE_MOVEMENT_CAUSES)[number];
/** The one movement-cause union the response carries. */
export type MovementCause = (typeof MOVEMENT_CAUSE_VOCABULARY)[number];
