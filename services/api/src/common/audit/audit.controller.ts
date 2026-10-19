/**
 * The audit read route (Master Plan §32.1; §40.6 M2-S6; §34.1).
 *
 * One thin handler over `AuditReadService`: the §32.1 business history, under
 * `audit.view` (§11.2 — `ownerExclusive: false`, so a trusted manager can read
 * the trail the owner is accountable for). Guard order is the §9.3 one:
 * `@Authorize` runs the bearer guard, the organization check, then the
 * permission. The tenant comes from the route parameter the guard validated —
 * never a body field — and the handler projects rows onto the wire, deciding
 * nothing.
 */

import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';

import { Authorize, OrganizationId } from '../authorization/authorization.guard';
import {
  AUDIT_EVENTS_PATH,
  AuditEventPageResponse,
  AuditEventResponse,
  DEFAULT_AUDIT_PAGE_SIZE,
  ListAuditEventsQuery,
  MAX_AUDIT_PAGE_SIZE,
} from './audit.contract';
import { AuditReadService } from './audit.service';

@Controller('api/v1/organizations/:organizationId/audit')
export class AuditController {
  constructor(private readonly audit: AuditReadService) {}

  @Get('events')
  @Authorize('audit.view')
  @ApiOperation({
    summary: 'The business audit trail (§32.1).',
    description:
      'Requires `audit.view`. Reads the organization’s `audit_events` — the durable business history the ' +
      '§32.2/§32.2A writers append — newest first, cursor-paged on the per-organization chain position. ' +
      'Isolation is the database policy (§8.2), not a filter: the read runs inside the trusted tenant ' +
      'transaction, so no caller behavior can reach another organization’s rows. The security history ' +
      '(`security_events`) is owner-only and deliberately not on this route.',
  })
  @ApiResponse({ status: 200, type: AuditEventPageResponse, description: 'One bounded page, newest first.' })
  @ApiResponse({ status: 401, description: 'UNAUTHENTICATED.' })
  @ApiResponse({ status: 403, description: 'PERMISSION_DENIED or ORGANIZATION_FORBIDDEN.' })
  async list(
    @OrganizationId() organizationId: string,
    @Query() query: ListAuditEventsQuery,
  ): Promise<AuditEventPageResponse> {
    const limit = query.limit ?? DEFAULT_AUDIT_PAGE_SIZE;
    const page = await this.audit.listAuditEvents({
      organizationId,
      limit: Math.min(limit, MAX_AUDIT_PAGE_SIZE),
      ...(query.eventType === undefined ? {} : { eventType: query.eventType }),
      ...(query.cursor === undefined ? {} : { cursor: BigInt(query.cursor) }),
    });
    return {
      events: page.events.map((row) => toResponse(row)),
      ...(page.nextAfter === null ? {} : { nextAfter: page.nextAfter.toString() }),
    };
  }
}

/** The stable date/bigint-to-wire projection; absent optionals are omitted, not null. */
function toResponse(row: {
  sequence: bigint;
  eventType: string;
  occurredAt: Date;
  localOccurredAt: Date | null;
  actorKind: string;
  actorUserId: string | null;
  actorDeviceId: string | null;
  targetType: string | null;
  targetId: string | null;
  documentRef: string | null;
  mutationId: string | null;
  deviceLocalSequence: bigint | null;
  payload: unknown;
}): AuditEventResponse {
  return {
    sequence: row.sequence.toString(),
    eventType: row.eventType,
    occurredAt: row.occurredAt.toISOString(),
    ...(row.localOccurredAt === null ? {} : { localOccurredAt: row.localOccurredAt.toISOString() }),
    actorKind: row.actorKind,
    ...(row.actorUserId === null ? {} : { actorUserId: row.actorUserId }),
    ...(row.actorDeviceId === null ? {} : { actorDeviceId: row.actorDeviceId }),
    ...(row.targetType === null ? {} : { targetType: row.targetType }),
    ...(row.targetId === null ? {} : { targetId: row.targetId }),
    ...(row.documentRef === null ? {} : { documentRef: row.documentRef }),
    ...(row.mutationId === null ? {} : { mutationId: row.mutationId }),
    ...(row.deviceLocalSequence === null ? {} : { deviceLocalSequence: row.deviceLocalSequence.toString() }),
    ...(row.payload === null || row.payload === undefined ? {} : { payload: row.payload as Record<string, unknown> }),
  };
}

export { AUDIT_EVENTS_PATH };
