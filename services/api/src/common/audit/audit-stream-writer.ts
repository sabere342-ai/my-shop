/**
 * The audit-stream writer (Master Plan §32.5, §32.2A; §40.6 M2-S6).
 *
 * Two contracts, one allocation law:
 *
 * - **Transactional appends** (`appendAuditEvent` / `appendSecurityEvent`)
 *   take the caller's transaction client and add the event to it: the
 *   protected effect and its audit row commit or roll back together. A failed
 *   append rolls the protected change back — an unaudited success is not a
 *   success (the leather failure-policy class A of the slice record).
 * - **Durable post-decision writes** (`recordTenantAuditEvent`,
 *   `recordSecurityEvent(namespace sink)`) open their own short transaction —
 *   tenant-scoped when the event carries a verified organization, un-scoped
 *   for the GLOBAL security partition — after the decision they record was
 *   already committed or refused (class B). They never throw into the caller:
 *   a persistence failure is logged, and the always-emitted redacted log line
 *   is the degradation path, never silence.
 *
 * Allocation (the §32.5 ordering law): per `(stream, scope)`, one
 * transaction-scoped advisory lock, the head row locked `FOR UPDATE`, and the
 * next value taken from the head's **committed** `last_sequence` — never a
 * free `MAX(sequence)` read. A rolled-back append leaves both the row and the
 * head untouched, so the next committed append reuses the same next value and
 * the committed series is gapless: a gap in a committed series is therefore
 * always evidence of deletion, never of a rollback.
 */

import { Prisma } from '@prisma/client';
import { canonicalJson, eventHashOf } from './canonical';
import {
  AUDIT_EVENT_TYPES,
  AUDIT_STREAMS,
  GENESIS_HASH,
  GLOBAL_SECURITY_SCOPE,
  SECURITY_EVENT_TYPES,
  type AuditActor,
  type AuditEventInput,
  type AuditPayload,
  type AuditStream,
  type AuditTxClient,
  type SecurityEventInput,
} from './stream.contract';

/**
 * Normalizes a bigint that PostgreSQL delivered as `bigint`, `number`, or a
 * decimal string (Prisma and node-postgres disagree by code path).
 */
function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  throw new Error('the audit-stream allocation returned a non-integer value');
}

/** Payloads are plain JSON, never class instances, never `undefined` holes. */
function assertPlainPayload(
  payload: AuditPayload | Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (payload === undefined || payload === null) return null;
  if (typeof payload !== 'object' || payload instanceof Date || Array.isArray(payload)) {
    throw new TypeError('an audit payload must be a plain object');
  }
  // The canonicalizer raises on non-JSON types; run it once so a bad payload
  // fails here, before any allocation consumed sequence space.
  canonicalJson(payload);
  return { ...(payload as Record<string, unknown>) };
}

/** Validates the closed vocabulary checks the database also enforces. */
function assertEventTypeName(stream: AuditStream, eventType: string): void {
  if (!/^[A-Z][A-Z0-9_]{3,79}$/.test(eventType)) {
    throw new Error(`the audit event type ${eventType} is not a valid closed-vocabulary identifier`);
  }
  const known = stream === 'AUDIT' ? AUDIT_EVENT_TYPES : SECURITY_EVENT_TYPES;
  if (!(known as readonly string[]).includes(eventType)) {
    throw new Error(`the ${stream} stream does not know the event type ${eventType}`);
  }
}

/** Validates actor attribution consistency (§32.6; the CHECKs restate it). */
function assertActorShape(actor: AuditActor, stream: AuditStream): void {
  switch (actor.kind) {
    case 'USER':
      if (actor.userId === undefined) throw new Error('a USER audit actor carries a verified user id');
      if (actor.principal !== undefined) throw new Error('a USER audit actor carries no principal name');
      return;
    case 'DEVICE':
      if (actor.deviceId === undefined) throw new Error('a DEVICE audit actor carries a server-resolved device id');
      if (actor.userId !== undefined || actor.principal !== undefined) {
        throw new Error('a DEVICE audit actor carries no user id or principal name');
      }
      return;
    case 'SYSTEM':
      if (actor.principal === undefined) throw new Error('a SYSTEM audit actor names its documented principal');
      if (actor.userId !== undefined || actor.deviceId !== undefined) {
        throw new Error('a SYSTEM audit actor carries no user or device id');
      }
      return;
    case 'UNVERIFIED':
      if (stream !== 'SECURITY') throw new Error('an UNVERIFIED actor exists only in the security stream');
      if (actor.userId !== undefined || actor.deviceId !== undefined || actor.principal !== undefined) {
        throw new Error(
          'an UNVERIFIED actor must not claim a verified identity; claims live on claimedUserId/claimedEmail',
        );
      }
      return;
    default:
      throw new Error('an unhandled actor kind');
  }
}

/** Normalized fields of one appendable event, after validation. */
interface PreparedEvent {
  readonly eventType: string;
  readonly occurredAt: Date;
  readonly localOccurredAt: Date | null;
  readonly actorKind: string;
  readonly actorUserId: string | null;
  readonly actorDeviceId: string | null;
  readonly actorPrincipal: string | null;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly documentRef: string | null;
  readonly mutationId: string | null;
  readonly deviceLocalSequence: bigint | null;
  readonly payload: Record<string, unknown> | null;
  readonly reasonCode: string | null;
  readonly clientAddress: string | null;
  readonly deviceId: string | null;
  readonly claimedUserId: string | null;
  readonly claimedEmail: string | null;
}

function prepareCommon(
  eventType: string,
  occurredAt: Date,
  actor: AuditActor,
  rest: {
    readonly localOccurredAt?: Date;
    readonly targetType?: string;
    readonly targetId?: string;
    readonly documentRef?: string;
    readonly mutationId?: string;
    readonly deviceLocalSequence?: bigint;
    readonly payload?: AuditPayload;
  } = {},
): PreparedEvent {
  const payload = rest.payload === undefined || rest.payload === null ? null : assertPlainPayload(rest.payload);
  return {
    eventType,
    occurredAt,
    ...(rest.localOccurredAt === undefined ? { localOccurredAt: null } : { localOccurredAt: rest.localOccurredAt }),
    actorKind: actor.kind,
    ...(actor.userId === undefined ? { actorUserId: null } : { actorUserId: actor.userId }),
    ...(actor.deviceId === undefined ? { actorDeviceId: null } : { actorDeviceId: actor.deviceId }),
    ...(actor.principal === undefined ? { actorPrincipal: null } : { actorPrincipal: actor.principal }),
    ...(rest.targetType === undefined ? { targetType: null } : { targetType: rest.targetType }),
    ...(rest.targetId === undefined ? { targetId: null } : { targetId: rest.targetId }),
    ...(rest.documentRef === undefined ? { documentRef: null } : { documentRef: rest.documentRef }),
    ...(rest.mutationId === undefined ? { mutationId: null } : { mutationId: rest.mutationId }),
    ...(rest.deviceLocalSequence === undefined
      ? { deviceLocalSequence: null }
      : { deviceLocalSequence: rest.deviceLocalSequence }),
    ...(payload === null ? { payload: null } : { payload }),
    reasonCode: null,
    clientAddress: null,
    deviceId: null,
    claimedUserId: null,
    claimedEmail: null,
  };
}

/**
 * The transactional writer over one Prisma transaction client. One instance
 * per service is fine: it holds no state — all chain state lives in the
 * `audit_stream_heads` row the allocation locks.
 */
export class AuditStreamWriter {
  appendAuditEvent(tx: AuditTxClient, input: AuditEventInput): Promise<void> {
    return this.append(tx, 'AUDIT', input.organizationId, input);
  }

  appendSecurityEvent(tx: AuditTxClient, input: SecurityEventInput): Promise<void> {
    // A security event with a verified organization is a tenant row; without
    // one it is the documented GLOBAL partition row under the sentinel scope.
    return this.append(tx, 'SECURITY', input.organizationId ?? GLOBAL_SECURITY_SCOPE, input);
  }

  /**
   * The single append path: allocate the scope's next gapless sequence and
   * chain value, validate, insert, and advance the head. Every step shares
   * the caller's transaction — a throw rolls all of it back, including the
   * allocation, leaving the head row exactly as it was.
   */
  private async append(
    tx: AuditTxClient,
    stream: AuditStream,
    scope: string,
    input: AuditEventInput | SecurityEventInput,
  ): Promise<void> {
    assertEventTypeName(stream, input.eventType);
    assertActorShape(input.actor, stream);
    const event = prepareEvent(input, stream);

    // 1. Serialize the scope's writers. The lock is transaction-scoped: it
    //    exists for this transaction and disappears at commit or rollback.
    const lockKey = `audit-stream:${stream}:${scope}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

    // 2. The head row exists before it is locked; the advisory lock settles
    //    the two racing creations. The generator defaults (0, genesis) are
    //    the documented chain start.
    await tx.$executeRaw`INSERT INTO audit_stream_heads (stream, scope, last_sequence, last_event_hash)
       VALUES (${stream}, ${scope}::uuid, 0, ${GENESIS_HASH}::char(64))
       ON CONFLICT (stream, scope) DO NOTHING`;

    // 3. Lock and read the **committed** head: never a free MAX(sequence)
    //    read; the head is the serialization point, and its UPDATE below is
    //    what makes the pair atomic with the row.
    const heads = await tx.$queryRaw<
      { last_sequence: unknown; last_event_hash: string }[]
    >`SELECT last_sequence, last_event_hash FROM audit_stream_heads
       WHERE stream = ${stream} AND scope = ${scope}::uuid FOR UPDATE`;
    const head = heads[0];
    if (head === undefined) throw new Error('the audit-stream head row could not be created or read');
    const nextSequence = toBigInt(head.last_sequence) + 1n;

    // 4. The row's hash chains to the previous committed row of its scope.
    const eventHash = eventHashOf({
      stream,
      scope,
      sequence: nextSequence,
      occurredAt: event.occurredAt,
      eventType: event.eventType,
      actorKind: event.actorKind,
      actorUserId: event.actorUserId,
      actorDeviceId: event.actorDeviceId,
      actorPrincipal: event.actorPrincipal,
      claimedUserId: event.claimedUserId,
      claimedEmail: event.claimedEmail,
      deviceId: event.deviceId,
      reasonCode: event.reasonCode,
      clientAddress: event.clientAddress,
      targetType: event.targetType,
      targetId: event.targetId,
      documentRef: event.documentRef,
      mutationId: event.mutationId,
      deviceLocalSequence: event.deviceLocalSequence,
      localOccurredAt: event.localOccurredAt,
      payload: event.payload,
      prevEventHash: head.last_event_hash,
    });

    // 5. The insert and the head advance are one transaction. If either
    //    fails, both are undone — the next append reallocates the sequence.
    //    Every nullable column is passed its concrete value or `null` — the
    //    `exactOptionalPropertyTypes` discipline never lets an `undefined`
    //    hole reach the database's typed surface.
    if (stream === 'AUDIT') {
      await tx.auditEvent.create({
        data: {
          organizationId: scope,
          sequence: nextSequence,
          occurredAt: event.occurredAt,
          localOccurredAt: event.localOccurredAt,
          eventType: event.eventType,
          actorKind: event.actorKind,
          actorUserId: event.actorUserId,
          actorDeviceId: event.actorDeviceId,
          actorPrincipal: event.actorPrincipal,
          targetType: event.targetType,
          targetId: event.targetId,
          documentRef: event.documentRef,
          mutationId: event.mutationId,
          deviceLocalSequence: event.deviceLocalSequence,
          ...(event.payload === null
            ? { payload: Prisma.DbNull }
            : { payload: event.payload as Prisma.InputJsonValue }),
          prevEventHash: head.last_event_hash,
          eventHash,
        },
      });
    } else {
      await tx.securityEvent.create({
        data: {
          partitionKind: input.organizationId === undefined ? 'GLOBAL' : 'TENANT',
          ...(input.organizationId === undefined ? { organizationId: null } : { organizationId: input.organizationId }),
          sequence: nextSequence,
          occurredAt: event.occurredAt,
          eventType: event.eventType,
          actorKind: event.actorKind,
          actorUserId: event.actorUserId,
          actorDeviceId: event.actorDeviceId,
          actorPrincipal: event.actorPrincipal,
          claimedUserId: event.claimedUserId,
          claimedEmail: event.claimedEmail,
          deviceId: event.deviceId,
          reasonCode: event.reasonCode,
          clientAddress: event.clientAddress,
          ...(event.payload === null
            ? { payload: Prisma.DbNull }
            : { payload: event.payload as Prisma.InputJsonValue }),
          prevEventHash: head.last_event_hash,
          eventHash,
        },
      });
    }

    await tx.$executeRaw`UPDATE audit_stream_heads
       SET last_sequence = ${nextSequence}::bigint, last_event_hash = ${eventHash}::char(64), updated_at = CURRENT_TIMESTAMP
       WHERE stream = ${stream} AND scope = ${scope}::uuid`;
  }
}

/**
 * One normalized event, after validation: only the security-only columns
 * (reason code, client address, server-resolved device, claimed attribution)
 * are ever set, and they are set for every security row. The branch keys on
 * the **stream**, not on the presence of an optional property key: an input
 * literal that omits `reasonCode` entirely must still carry its device and
 * claimed-attribution columns (§32.3, §32.6) — a property-presence test would
 * silently null them.
 */
function prepareEvent(input: AuditEventInput | SecurityEventInput, stream: AuditStream): PreparedEvent {
  const event = prepareCommon(input.eventType, input.occurredAt, input.actor, input);
  if (stream !== 'SECURITY') return event;
  const security = input as SecurityEventInput;
  return {
    ...event,
    ...(security.reasonCode === undefined ? { reasonCode: null } : { reasonCode: security.reasonCode }),
    ...(security.clientAddress === undefined ? { clientAddress: null } : { clientAddress: security.clientAddress }),
    ...(security.deviceId === undefined ? { deviceId: null } : { deviceId: security.deviceId }),
    ...(security.actor.claimedUserId === undefined
      ? { claimedUserId: null }
      : { claimedUserId: security.actor.claimedUserId }),
    ...(security.actor.claimedEmail === undefined
      ? { claimedEmail: null }
      : { claimedEmail: security.actor.claimedEmail }),
  };
}

/** The vocabulary of the security stream, exported for the tests that pin it. */
export { SECURITY_EVENT_TYPES as ALL_SECURITY_EVENT_TYPES, AUDIT_EVENT_TYPES as ALL_AUDIT_EVENT_TYPES, AUDIT_STREAMS };
