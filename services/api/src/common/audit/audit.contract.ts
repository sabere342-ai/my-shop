/**
 * The audit read-API wire contract (Master Plan §32.1, §40.6 M2-S6).
 *
 * One route this slice owns:
 *
 *   `GET /api/v1/organizations/:organizationId/audit/events` — the business
 *   history (§32.1 `audit_events`), readable under `audit.view` (§11.2).
 *
 * The security history is deliberately **not** on the wire: owner-only reads of
 * `security_events` are a service capability (`AuditReadService.listSecurityEvents`)
 * until an owner console exists (the slice record's point 5 / documented
 * deferral). No response carries a secret, a token, or any credential material —
 * the stored payloads are allow-listed by construction (§32.4), and these
 * classes simply project what PostgreSQL holds.
 *
 * Big integers (`sequence`, `deviceLocalSequence`) travel as decimal strings,
 * exactly like the sync bugdet's server sequence bytes (§38.8.1 wire rules):
 * JSON numbers cannot carry the full `BIGINT` domain without precision loss.
 */

import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

import { AUDIT_EVENT_TYPES } from './stream.contract';

/** The bounded page size — the read surface is a review screen, never a feed. */
export const MAX_AUDIT_PAGE_SIZE = 100;
export const DEFAULT_AUDIT_PAGE_SIZE = 50;

/** `GET …/audit/events` query: one optional closed-vocabulary filter and a cursor page. */
export class ListAuditEventsQuery {
  @ApiProperty({
    description: 'Restrict the page to one closed audit-vocabulary event type.',
    required: false,
    enum: [...AUDIT_EVENT_TYPES],
  })
  @IsOptional()
  @IsIn([...AUDIT_EVENT_TYPES])
  readonly eventType?: string;

  @ApiProperty({
    description:
      'Cursor: the decimal `sequence` of the last row of the previous page, from `nextAfter`. ' +
      'Exclusive — the page starts strictly below it (the list is newest first).',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]+$/, { message: 'cursor must be a decimal sequence number' })
  readonly cursor?: string;

  @ApiProperty({
    description: 'The page size (bounded).',
    required: false,
    type: 'integer',
    default: DEFAULT_AUDIT_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_AUDIT_PAGE_SIZE)
  readonly limit?: number;
}

/** One business-history row, as the §32.1 table stores it. */
export class AuditEventResponse {
  @ApiProperty({ description: 'The per-organization chain position (§32.5), as a decimal string.' })
  readonly sequence!: string;

  @ApiProperty({ description: 'The closed audit-vocabulary event type (§32.2A).' })
  readonly eventType!: string;

  @ApiProperty({ format: 'date-time', description: 'The server-recorded time (clients never supply it).' })
  readonly occurredAt!: string;

  @ApiProperty({
    format: 'date-time',
    required: false,
    description: 'The §32.2A device-local event time, when the event carries one.',
  })
  readonly localOccurredAt?: string;

  @ApiProperty({
    description: 'The §32.6 attribution class: USER, DEVICE, SYSTEM, or UNVERIFIED — never absent.',
    enum: ['USER', 'DEVICE', 'SYSTEM', 'UNVERIFIED'],
  })
  readonly actorKind!: string;

  @ApiProperty({ format: 'uuid', required: false, description: 'The verified user, when the actor is one.' })
  readonly actorUserId?: string;

  @ApiProperty({
    format: 'uuid',
    required: false,
    description: 'A server-resolved device, when the event is device-anchored.',
  })
  readonly actorDeviceId?: string;

  @ApiProperty({ required: false, description: 'The target aggregate type, when the event targets one.' })
  readonly targetType?: string;

  @ApiProperty({ required: false, description: 'The target aggregate id, when the event targets one.' })
  readonly targetId?: string;

  @ApiProperty({ required: false, description: 'The originating document reference, when the event carries one.' })
  readonly documentRef?: string;

  @ApiProperty({
    format: 'uuid',
    required: false,
    description: 'The mutation that produced the event (§32.2A server rows).',
  })
  readonly mutationId?: string;

  @ApiProperty({ required: false, description: 'The §32.2A device-local sequence, as a decimal string, when present.' })
  readonly deviceLocalSequence?: string;

  @ApiProperty({
    required: false,
    description: 'The allow-listed payload the event type defines (§32.2/§32.2A; never credentials, §32.4).',
  })
  readonly payload?: Record<string, unknown>;
}

/** `GET …/audit/events` response: one bounded page and the next cursor. */
export class AuditEventPageResponse {
  @ApiProperty({ type: AuditEventResponse, isArray: true, description: 'The page, newest first.' })
  readonly events!: readonly AuditEventResponse[];

  @ApiProperty({
    type: 'string',
    required: false,
    description:
      'The cursor for the following page — the last served `sequence`, absent when the stream is exhausted. ' +
      'Pass it back as `cursor`.',
  })
  readonly nextAfter?: string;
}

/** Path constants, re-exported so a routing test can assert them without importing the file. */
export const AUDIT_EVENTS_PATH = 'api/v1/organizations/:organizationId/audit/events';
