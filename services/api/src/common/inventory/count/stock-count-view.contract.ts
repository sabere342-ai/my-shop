/**
 * The stock-count wire contract (Master Plan §15.8, §30.5, O-14; §34.1 — the
 * routes ride the versioned `/api/v1` namespace, organization-scoped by the
 * route parameter the authorization guard validates against the token's
 * membership claim, never by a body field §9.3):
 *
 * - `POST /inventory/counts`                     — open a count document (`inventory.count`).
 * - `POST /inventory/counts/:countId/lines`      — record/re-record one observation
 *                                                  (a repeat scan **edits** the same
 *                                                  line — §15.8; `inventory.count`).
 * - `POST /inventory/counts/:countId/post`       — the atomic variance posting (§15.6;
 *                                                  `inventory.count`, escalating to the
 *                                                  cost authority only when a line offers one).
 * - `POST /inventory/counts/:countId/cancel`     — close an abandoned count (`inventory.count`).
 * - `GET  /inventory/counts` / `GET …/:countId`  — the documents with their lines (`inventory.count`).
 *
 * The POST answers idempotency where it exists (§38.9 discipline): a repeated
 * posting of an already-POSTED count answers the stored document with
 * `status REPLAY` (the count row itself is the idempotency identity — its
 * trigger-guarded lifecycle cannot re-cross OPEN→POSTED, and its movement
 * attachments are one-per-line by a database unique). A POSTED count is closed
 * history: cancel refused `409 STOCK_COUNT_CLOSED`. An unexplained variance
 * (a differing line with no reason code) refuses `409
 * STOCK_COUNT_REASON_REQUIRED` — O-14's mandatory-reason rule.
 *
 * Wire types (§22.1 discipline): 64-bit quantities are decimal **strings**
 * (§30.1 — never a float), closed vocabularies are closed unions, and identity
 * ids are canonical UUIDs. No response carries an actor id: attribution is the
 * §32.2 audit stream's face, never the application response's.
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

import {
  ADJUSTMENT_REASON_CODES,
  INVENTORY_LIST_MAX_LIMIT,
  INVENTORY_TEXT_WIRE_PATTERN,
  UUID_WIRE_PATTERN,
} from '../inventory.contract';
import {
  COUNTED_QUANTITY_WIRE_PATTERN,
  STOCK_COUNT_NOTE_MAX_LENGTH,
  STOCK_COUNT_STATUSES,
  type StockCountStatus,
} from './stock-count.contract';

/** Path constant, re-exported so a routing test can assert it without importing the file. */
export const COUNT_PATH = 'api/v1/organizations/:organizationId/inventory/counts';

const BOUNDED_TEXT = INVENTORY_TEXT_WIRE_PATTERN.source;
const UUID_SHAPE = UUID_WIRE_PATTERN.source;
const COUNTED_SHAPE = COUNTED_QUANTITY_WIRE_PATTERN.source;

/** `GET …/inventory/counts` query. */
export class ListStockCountsQuery {
  @ApiPropertyOptional({ description: 'Restrict the page to one location.', format: 'uuid' })
  @IsOptional()
  @Matches(new RegExp(UUID_SHAPE, 'u'), { message: 'locationId must be a canonical UUID' })
  readonly locationId?: string;

  @ApiPropertyOptional({ description: 'Restrict the page to one lifecycle status.', enum: [...STOCK_COUNT_STATUSES] })
  @IsOptional()
  @IsIn([...STOCK_COUNT_STATUSES])
  readonly status?: StockCountStatus;

  @ApiPropertyOptional({ description: 'The bounded page size.', type: 'integer', maximum: INVENTORY_LIST_MAX_LIMIT })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(INVENTORY_LIST_MAX_LIMIT)
  readonly limit?: number;
}

/** `POST …/inventory/counts` request. */
export class CreateStockCountRequest {
  @ApiPropertyOptional({
    description: 'The location to count; absent names the V1 default location.',
    format: 'uuid',
    nullable: true,
  })
  @IsOptional()
  @Matches(new RegExp(UUID_SHAPE, 'u'), { message: 'locationId must be a canonical UUID' })
  readonly locationId?: string | null;

  @ApiPropertyOptional({
    description: 'The operator’s own words about the count (§15.8), bounded note text.',
    maxLength: STOCK_COUNT_NOTE_MAX_LENGTH,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(STOCK_COUNT_NOTE_MAX_LENGTH)
  readonly note?: string | null;
}

/** `POST …/inventory/counts/:countId/lines` request — one observation, or its revision. */
export class RecordCountLineRequest {
  @ApiProperty({ description: 'The variant observed.', format: 'uuid' })
  @Matches(new RegExp(UUID_SHAPE, 'u'), { message: 'variantId must be a canonical UUID' })
  readonly variantId!: string;

  @ApiProperty({
    description:
      'The physically observed quantity in exact base units, a non-negative decimal string. ' +
      'Zero is a real observation — the shelf is empty; an omitted variant simply has no line (§15.8).',
    example: '4',
  })
  @Matches(new RegExp(COUNTED_SHAPE, 'u'), {
    message: 'countedQuantity must be a non-negative decimal string of at most 12 digits',
  })
  readonly countedQuantity!: string;

  @ApiPropertyOptional({
    description:
      'The §38.5 closed reason code. Optional at record time; the posting of a line that would ' +
      'change the authoritative quantity refuses without one (O-14).',
    type: 'string',
    nullable: true,
    enum: [...ADJUSTMENT_REASON_CODES],
  })
  @IsOptional()
  @IsString()
  @Matches(new RegExp(BOUNDED_TEXT, 'u'), { message: 'reasonCode must be bounded text' })
  readonly reasonCode?: string | null;

  @ApiPropertyOptional({
    description:
      'The §30.1 cost offer in exact minor units as a decimal string — the posting needs it only when ' +
      'the variance *increases* stock that carries no cost basis, and posting it demands the cost ' +
      'authority (`catalog.cost.edit`). A decrease never carries a cost (it consumes at the current average).',
    example: '18500',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,12}$/, {
    message: 'unitCostMinor must be a non-negative integer decimal string of at most 12 digits',
  })
  readonly unitCostMinor?: string | null;
}

/** One recorded observation as the wire answers it. */
export class StockCountLineResponse {
  @ApiProperty({ description: 'The line’s id — also the posting movement’s deterministic id.', format: 'uuid' })
  readonly lineId!: string;

  @ApiProperty({ description: 'The variant observed.', format: 'uuid' })
  readonly variantId!: string;

  @ApiProperty({ description: 'The variant SKU (M4-S1).' })
  readonly sku!: string;

  @ApiProperty({
    description: 'The physical observation in exact base units, a decimal string (never negative).',
    example: '4',
  })
  readonly countedQuantity!: string;

  @ApiProperty({
    description:
      'The system quantity captured at record time — the snapshot the operator’s variance ' +
      'preview was computed from; the posting re-verifies against the locked authoritative level.',
    example: '10',
  })
  readonly expectedQuantity!: string;

  @ApiPropertyOptional({
    description: 'The §38.5 reason code, when the operator has already chosen one.',
    type: 'string',
    nullable: true,
    enum: [...ADJUSTMENT_REASON_CODES],
  })
  readonly reasonCode!: string | null;

  @ApiPropertyOptional({
    description: 'The stored cost offer in exact minor units, when the line carries one.',
    type: 'string',
    nullable: true,
  })
  readonly unitCostMinor!: string | null;

  @ApiProperty({ description: 'When the observation was (re)recorded.', format: 'date-time' })
  readonly recordedAt!: string;

  @ApiPropertyOptional({
    description:
      'The §38.14.1 movement the posting produced — present only after posting, and only for a differing line.',
    format: 'uuid',
    nullable: true,
  })
  readonly movementId!: string | null;
}

/** One count document as the wire answers it. */
export class StockCountResponse {
  @ApiProperty({ description: 'The count document’s id.', format: 'uuid' })
  readonly countId!: string;

  @ApiProperty({ description: 'The location the count saw.', format: 'uuid' })
  readonly locationId!: string;

  @ApiProperty({ description: 'The location’s name.' })
  readonly locationName!: string;

  @ApiProperty({ description: 'The lifecycle status.', enum: [...STOCK_COUNT_STATUSES] })
  readonly status!: StockCountStatus;

  @ApiPropertyOptional({ description: 'The operator’s note, when the document carries one.', nullable: true })
  readonly note!: string | null;

  @ApiProperty({ description: 'When the count was opened.', format: 'date-time' })
  readonly createdAt!: string;

  @ApiPropertyOptional({
    description: 'The posting’s committed time, when posted.',
    format: 'date-time',
    nullable: true,
  })
  readonly postedAt!: string | null;

  @ApiPropertyOptional({
    description: 'The cancellation’s committed time, when cancelled.',
    format: 'date-time',
    nullable: true,
  })
  readonly cancelledAt!: string | null;

  @ApiProperty({ description: 'The recorded observations, deterministic order.', type: () => [StockCountLineResponse] })
  readonly lines!: StockCountLineResponse[];
}

/** The `POST …/counts` answer (also the one-count read). */
export class CreateStockCountResponse {
  @ApiProperty({ type: () => StockCountResponse })
  readonly count!: StockCountResponse;
}

/** The `POST …/counts/:countId/lines` answer. */
export class RecordCountLineResponse {
  @ApiProperty({ type: () => StockCountResponse, description: 'The whole count document after the recording.' })
  readonly count!: StockCountResponse;
}

/** The `POST …/counts/:countId/post` and `…/cancel` answers (§38.9 stream semantics). */
export class PostStockCountResponse {
  @ApiProperty({
    description: '`APPLIED` on first acceptance, `REPLAY` when the stored closed document is returned (§38.9.1).',
    enum: ['APPLIED', 'REPLAY'],
  })
  readonly status!: 'APPLIED' | 'REPLAY';

  @ApiProperty({ type: () => StockCountResponse })
  readonly count!: StockCountResponse;
}

/** `GET …/inventory/counts` answer. */
export class StockCountListResponse {
  @ApiProperty({ type: () => [StockCountResponse] })
  readonly counts!: StockCountResponse[];
}
