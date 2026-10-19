/**
 * The durable class-B writers (Master Plan §32; the failure-policy classes of
 * the M2-S6 slice record, points 9–11).
 *
 * Class A (inside the protected transaction) lives in `AuditStreamWriter`.
 * These two classes are the **class B** policies: events recorded after a
 * decision was already committed or refused, in their own short transaction,
 * because the protected transaction's fate is not theirs to affect:
 *
 * - `DurableSecurityEventSink` implements the identity port
 *   (`SecurityEventSink`) every consumer already records through — the one
 *   binding M2-S2 reserved for M2-S6. A tenant-scoped event persists inside
 *   the trusted tenant transaction; an event without a verified organization
 *   persists into the documented GLOBAL partition. It **never throws**: the
 *   outcome it records was already taken, and authentication must never turn
 *   on the persistence of its own history. The redacted allow-listed log line
 *   is always emitted alongside the attempt (§38.28.3), so a persistence
 *   failure degrades to the log, never to silence.
 * - `DurableAuditRecorder` records the §32.2A rows that follow a *rejected*
 *   transaction — whose class-A frame is gone by the time the service learns
 *   the outcome — with the same non-throwing, own-transaction discipline.
 *
 * Neither class is a queue and neither claims more durability than it has: a
 * process crash between the decision and the append window can lose a class-B
 * row (documented residual risk #1 of the slice record; the log line stands).
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import type { Logger as PinoLogger } from 'pino';
import { withTenantTransaction } from '../database/tenant-context';
import { logPayload } from '../logging/logger';
import type { SecurityEvent, SecurityEventSink } from '../identity/security-event.sink';
import { AuditStreamWriter } from './audit-stream-writer';
import type { AuditEventInput, SecurityEventInput } from './stream.contract';

/** The host shape both durable writers need (PrismaService satisfies it). */
export interface AuditPersistHost {
  readonly prisma: PrismaClient;
}

/**
 * The production `SECURITY_EVENT_SINK` binding. Construction needs the
 * application Prisma host and the redaction logger; see `identity.module.ts`.
 */
export class DurableSecurityEventSink implements SecurityEventSink {
  private readonly writer = new AuditStreamWriter();

  constructor(
    private readonly host: AuditPersistHost,
    private readonly logger?: PinoLogger,
  ) {}

  record(event: SecurityEvent): void {
    // The observability line first — identical shape and destination as the
    // M2-S2 logging sink, so operators lose nothing in the transition.
    this.log(event);
    // The durable write is fire-and-forget **on purpose**: the decision this
    // event records has been taken; a persistence failure must never reach
    // the caller as an authentication outcome. It is not *asynchronous
    // logging*: the append opens its own transaction and persists the row.
    void this.persist(event).catch((error: unknown) => {
      this.logger?.warn(
        {
          component: 'identity',
          reason: event.type,
          persistenceFailure: error instanceof Error ? error.name : 'unknown',
        },
        'the durable security-event persistence failed; the structured log line above is the record of the event',
      );
    });
  }

  /** The §38.28.3 allow-listed log line, by construction (same payload rule). */
  private log(event: SecurityEvent): void {
    try {
      this.logger?.info(
        logPayload({
          component: 'identity',
          reason: event.type,
          ...(event.userId === undefined ? {} : { userId: event.userId }),
          ...(event.deviceId === undefined ? {} : { deviceId: event.deviceId }),
          ...(event.organizationId === undefined ? {} : { organizationId: event.organizationId }),
          ...(event.errorCode === undefined ? {} : { errorCode: event.errorCode }),
          ...(event.clientAddress === undefined ? {} : { ip: event.clientAddress }),
        }),
        'identity security event',
      );
    } catch {
      // A logging failure must never change the outcome of the call site.
    }
  }

  private async persist(event: SecurityEvent): Promise<void> {
    if (event.organizationId !== undefined) {
      await withTenantTransaction(this.host, event.organizationId, async (tx: Prisma.TransactionClient) =>
        this.writer.appendSecurityEvent(tx, toSecurityInput(event)),
      );
      return;
    }
    await this.host.prisma.$transaction(async (tx: Prisma.TransactionClient) =>
      this.writer.appendSecurityEvent(tx, toSecurityInput(event)),
    );
  }
}

/** The §32.2A durable recorder for rows that follow a rejected transaction. */
export class DurableAuditRecorder {
  private readonly writer = new AuditStreamWriter();

  constructor(
    private readonly host: AuditPersistHost,
    private readonly logger?: PinoLogger,
  ) {}

  /** Fire-and-forget durability, exactly like the security sink's policy. */
  recordTenantAuditEvent(input: AuditEventInput): void {
    void (async () => {
      await withTenantTransaction(this.host, input.organizationId, async (tx) =>
        this.writer.appendAuditEvent(tx, input),
      );
    })().catch((error: unknown) => {
      this.logger?.warn(
        {
          component: 'audit',
          reason: input.eventType,
          persistenceFailure: error instanceof Error ? error.name : 'unknown',
        },
        'the durable audit-event persistence failed; the structured log line for this outcome stands',
      );
    });
  }

  /** The matching security row, on the same class-B policy. */
  recordSecurityEvent(input: SecurityEventInput): void {
    void (async () => {
      await this.recordSecurity(input);
    })().catch((error: unknown) => {
      this.logger?.warn(
        {
          component: 'audit',
          reason: input.eventType,
          persistenceFailure: error instanceof Error ? error.name : 'unknown',
        },
        'the durable security-event persistence failed; the structured log line for this outcome stands',
      );
    });
  }

  private async recordSecurity(input: SecurityEventInput): Promise<void> {
    if (input.organizationId !== undefined) {
      await withTenantTransaction(this.host, input.organizationId, async (tx) =>
        this.writer.appendSecurityEvent(tx, input),
      );
      return;
    }
    await this.host.prisma.$transaction(async (tx) => this.writer.appendSecurityEvent(tx, input));
  }
}

/** The port event, normalized once, into the stored row's attribution. */
const SYSTEM_PRINCIPAL_IDENTITY = 'system:identity';

function toSecurityInput(event: SecurityEvent): SecurityEventInput {
  const unverified = event.actorKind === 'UNVERIFIED';
  const payload = securityPayload(event);
  return {
    eventType: event.type,
    ...(event.organizationId === undefined ? {} : { organizationId: event.organizationId }),
    actor: unverified
      ? {
          kind: 'UNVERIFIED',
          ...(event.userId === undefined ? {} : { claimedUserId: event.userId }),
          ...(event.claimedEmail === undefined ? {} : { claimedEmail: event.claimedEmail }),
        }
      : // §32.6: attribution is exactly what server facts carry — a verified
        // principal is USER; a refusal anchored only to a server-resolved device
        // is DEVICE; a record with no identity fact at all is the documented
        // system principal (`system:identity`), never a fabricated USER row and
        // never "nobody". The database's CHECK constraints refuse a USER row
        // without a user id, so the old `?? 'USER'` default would silently drop
        // every such durable row behind its own thrown shape error.
        event.userId !== undefined
        ? {
            kind: event.actorKind ?? 'USER',
            userId: event.userId,
            ...(event.deviceId === undefined ? {} : { deviceId: event.deviceId }),
          }
        : event.deviceId !== undefined
          ? { kind: 'DEVICE', deviceId: event.deviceId }
          : { kind: 'SYSTEM', principal: SYSTEM_PRINCIPAL_IDENTITY },
    occurredAt: new Date(),
    ...(event.deviceId === undefined ? {} : { deviceId: event.deviceId }),
    ...(event.errorCode === undefined ? {} : { reasonCode: event.errorCode }),
    ...(event.clientAddress === undefined ? {} : { clientAddress: event.clientAddress }),
    ...(payload === undefined ? {} : { payload }),
  };
}

/**
 * The §32.4/§38.28.3 redaction rule lives in the payload's provenance: only
 * these named fields ever enter a security payload, and each is an
 * identifier-shaped or hash-shaped diagnostic — never credentials, tokens,
 * bodies, or secrets.
 */
function securityPayload(event: SecurityEvent): Record<string, string> | undefined {
  const payload: Record<string, string> = {};
  if (event.mutationId !== undefined) payload.mutationId = event.mutationId;
  if (event.assertedDeviceId !== undefined) payload.assertedDeviceId = event.assertedDeviceId;
  if (event.assertedOrganizationId !== undefined) payload.assertedOrganizationId = event.assertedOrganizationId;
  if (event.storedPayloadHash !== undefined) payload.storedPayloadHash = event.storedPayloadHash;
  if (event.replayedPayloadHash !== undefined) payload.replayedPayloadHash = event.replayedPayloadHash;
  if (event.syncBatchId !== undefined) payload.syncBatchId = event.syncBatchId;
  return Object.keys(payload).length === 0 ? undefined : payload;
}
