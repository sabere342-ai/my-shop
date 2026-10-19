/**
 * The audit read surface (Master Plan §32.1, §32.2A; §40.6 M2-S6).
 *
 * Two capabilities, one privacy law each:
 *
 * - `listAuditEvents` — the §32.1 business history, readable under the §11.2
 *   `audit.view` permission (the route enforces it; this service enforces the
 *   scope). Every read runs inside the trusted tenant transaction, so the RLS
 *   policy — not a WHERE clause the caller could have omitted — is the isolation
 *   boundary: tenant A's owner cannot see tenant B's history by any caller
 *   behavior, and a rejected event can never appear in a scope that was never
 *   its own.
 * - `listSecurityEvents` — the security history. **No route exists**: reads are
 *   an owner-only service capability until an owner console exists (the slice's
 *   documented deferral). The tenant partition reads inside the tenant
 *   transaction; the deliberately global partition (§32's pre-authentication
 *   rows, no tenant fact) reads without a tenant context under the nil-scope
 *   visibility the RLS policy admits.
 *
 * The service is a pure read: it never writes, never repairs, and never
 * interprets events. A page is newest-first (a review screen), cursor-keyed on
 * `sequence` — a keyset cursor, never an offset, mirroring the §38.11.2 change
 * feed's discipline.
 */

import type { PrismaClient } from '@prisma/client';
import { withTenantTransaction, type ContextHost } from '../database/tenant-context';
import type { SecurityEventType } from './stream.contract';

/** The request shape of the business-history page. */
export interface ListAuditEventsRequest {
  /** The tenant scope — the verified route organization, never a body field. */
  readonly organizationId: string;
  /** One closed vocabulary filter, or none for the whole stream. */
  readonly eventType?: string;
  /** Exclusive upper bound on `sequence` (the next page cursor). */
  readonly cursor?: bigint;
  /** Bounded page size. */
  readonly limit: number;
}

/** One business-history row as the view carries it (projection happens at the route). */
export type AuditEventView = PrismaAuditEvent;

/** One security-history row as the owner-only capability carries it. */
export type SecurityEventView = PrismaSecurityEvent;

export interface ListSecurityEventsRequest {
  /** A tenant partition read when given; the global partition without one. */
  readonly organizationId?: string;
  readonly eventType?: SecurityEventType;
  readonly limit?: number;
}

type PrismaAuditEvent = Awaited<ReturnType<PrismaClient['auditEvent']['findMany']>>[number];
type PrismaSecurityEvent = Awaited<ReturnType<PrismaClient['securityEvent']['findMany']>>[number];

/** The paged business-history answer: the rows and the next keyset cursor. */
export interface AuditEventPage {
  readonly events: readonly AuditEventView[];
  /** `null` when the stream is exhausted (no further cursor to pass). */
  readonly nextAfter: bigint | null;
}

export class AuditReadService {
  constructor(private readonly host: ContextHost) {}

  /** One page of the §32.1 business history, RLS-scoped, newest first. */
  async listAuditEvents(request: ListAuditEventsRequest): Promise<AuditEventPage> {
    return withTenantTransaction(this.host, request.organizationId, async (tx) => {
      const rows = await tx.auditEvent.findMany({
        where: {
          ...(request.eventType === undefined ? {} : { eventType: request.eventType }),
          ...(request.cursor === undefined ? {} : { sequence: { lt: request.cursor } }),
        },
        orderBy: { sequence: 'desc' },
        take: request.limit,
      });

      const last = rows[rows.length - 1];
      return {
        events: rows,
        nextAfter: last === undefined ? null : last.sequence,
      };
    });
  }

  /**
   * The owner-only security-history capability (no route in this slice). With
   * an organization: that tenant's partition, inside its trusted transaction.
   * Without one: the documented GLOBAL partition — pre-authentication,
   * per-identity telemetry that carries no tenant fact and is admitted to every
   * verified connection by the 0010 policy's NULL-row clause.
   */
  async listSecurityEvents(request: ListSecurityEventsRequest): Promise<readonly SecurityEventView[]> {
    if (request.organizationId !== undefined) {
      return withTenantTransaction(this.host, request.organizationId, async (tx) =>
        tx.securityEvent.findMany({
          where: {
            partitionKind: 'TENANT',
            ...(request.eventType === undefined ? {} : { eventType: request.eventType }),
          },
          orderBy: { sequence: 'desc' },
          take: request.limit ?? 100,
        }),
      );
    }
    return this.host.prisma.$transaction(async (tx) =>
      tx.securityEvent.findMany({
        where: {
          partitionKind: 'GLOBAL',
          // No organization_id clause at all: the global partition *is* the
          // NULL-organization partition — its rows carry no tenant fact, its
          // head chains under the documented nil-scope sentinel scope, and
          // RLS admits exactly these rows to every verified connection.
          ...(request.eventType === undefined ? {} : { eventType: request.eventType }),
        },
        orderBy: { id: 'desc' },
        take: request.limit ?? 100,
      }),
    );
  }
}
