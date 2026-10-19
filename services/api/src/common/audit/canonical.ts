/**
 * The canonical serialization and chain hashing (Master Plan §32.5).
 *
 * One canonical byte string per event:
 *
 *   stream 0x1F event_type 0x1F scope 0x1F sequence 0x1F
 *   occurred_at (fixed ISO-8601 UTC, millisecond precision) 0x1F
 *   actor fields / reason / target / mutation provenance / payload 0x1F
 *   prev_event_hash
 *
 * The payload is canonical JSON: sorted keys, no whitespace, array order
 * preserved, plain-JSON values only. The hash covers the *stored* semantic
 * fields of the row, so the verifier (which re-serializes what PostgreSQL
 * holds) recomputes the same digest when and only when the row is exactly as
 * it was appended.
 *
 * Fields deliberately inside the hash: everything invariant about the event.
 * Times are reduced to millisecond ISO form because the columns are
 * `timestamptz(6)` and the write path passes milliseconds through unchanged —
 * the writer never degrades a stored timestamp, so round-trips are exact.
 *
 * Determinism rules: `bigint` serializes as its decimal digits; `Date` as
 * `.toISOString()`; `undefined`/`null` payload as `"null"`; nested objects by
 * sorted key. A value the canonicalizer cannot reduce raises — never renders
 * a storage-dependent fallback.
 */

import { createHash } from 'node:crypto';

const FIELD_SEPARATOR = '\u001f';

/** Canonical JSON: sorted keys, no whitespace, plain values only. */
export function canonicalJson(value: unknown): string {
  return inspectValue(value);
}

function inspectValue(value: unknown): string {
  switch (typeof value) {
    case 'undefined':
      return 'null';
    case 'boolean':
    case 'number':
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'bigint':
      return value.toString();
    case 'object': {
      if (value === null) return 'null';
      if (value instanceof Date) return JSON.stringify(value.toISOString());
      if (Array.isArray(value)) return `[${value.map(inspectValue).join(',')}]`;
      // A canonical *plain* JSON object only: class instances (Map, Set, typed
      // arrays, remote-data wrappers) have no unambiguous JSON meaning and are
      // refused rather than rendered as a misleading `{}`.
      if (Object.getPrototypeOf(value) !== Object.prototype) {
        throw new TypeError(
          `a canonical audit payload cannot contain a ${value.constructor.name ?? 'non-plain object'}`,
        );
      }
      const entries = Object.entries(value)
        .filter(([, field]) => field !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
      return `{${entries.map(([key, field]) => `${JSON.stringify(key)}:${inspectValue(field)}`).join(',')}}`;
    }
    default:
      throw new TypeError(`a canonical audit payload cannot contain a ${typeof value}`);
  }
}

/** The SHA-256 hex digest of a canonical byte string. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** The invariant fields of one audit/security event, in canonical order. */
export interface HashedEventFields {
  readonly stream: string;
  readonly scope: string;
  readonly sequence: bigint;
  readonly occurredAt: Date;
  readonly eventType: string;
  readonly actorKind: string;
  readonly actorUserId: string | null;
  readonly actorDeviceId: string | null;
  readonly actorPrincipal: string | null;
  readonly claimedUserId?: string | null;
  readonly claimedEmail?: string | null;
  readonly deviceId?: string | null;
  readonly reasonCode?: string | null;
  readonly clientAddress?: string | null;
  readonly targetType?: string | null;
  readonly targetId?: string | null;
  readonly documentRef?: string | null;
  readonly mutationId?: string | null;
  readonly deviceLocalSequence?: bigint | null;
  readonly localOccurredAt?: Date | null;
  readonly payload?: Record<string, unknown> | null;
  readonly prevEventHash: string;
}

/** The canonical hash of one event: chain input for the next row's hash. */
export function eventHashOf(fields: HashedEventFields): string {
  const rendered = [
    fields.stream,
    fields.eventType,
    fields.scope,
    fields.sequence.toString(),
    fields.occurredAt.toISOString(),
    fields.actorKind,
    renderNullable(fields.actorUserId),
    renderNullable(fields.actorDeviceId),
    renderNullable(fields.actorPrincipal),
    renderNullable(fields.claimedUserId ?? null),
    renderNullable(fields.claimedEmail ?? null),
    renderNullable(fields.deviceId ?? null),
    renderNullable(fields.reasonCode ?? null),
    renderNullable(fields.clientAddress ?? null),
    renderNullable(fields.targetType ?? null),
    renderNullable(fields.targetId ?? null),
    renderNullable(fields.documentRef ?? null),
    renderNullable(fields.mutationId ?? null),
    fields.deviceLocalSequence === undefined || fields.deviceLocalSequence === null
      ? 'null'
      : fields.deviceLocalSequence.toString(),
    fields.localOccurredAt === null || fields.localOccurredAt === undefined
      ? 'null'
      : fields.localOccurredAt.toISOString(),
    renderPayload(fields.payload ?? null),
    fields.prevEventHash,
  ].join(FIELD_SEPARATOR);
  return sha256Hex(rendered);
}

/** One committed row as the verifier reads it back from PostgreSQL. */
export interface VerifiableEventRow {
  /** Security rows: the tenant org, or null on the global partition. */
  readonly organizationId?: string | null;
  readonly sequence: bigint;
  readonly occurredAt: Date;
  readonly eventType: string;
  readonly actorKind: string;
  readonly actorUserId: string | null;
  readonly actorDeviceId: string | null;
  readonly actorPrincipal: string | null;
  readonly claimedUserId: string | null;
  readonly claimedEmail: string | null;
  readonly deviceId: string | null;
  readonly reasonCode: string | null;
  readonly clientAddress: string | null;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly documentRef: string | null;
  readonly mutationId: string | null;
  readonly deviceLocalSequence: bigint | null;
  readonly localOccurredAt: Date | null;
  readonly payload: Record<string, unknown> | null;
  readonly prevEventHash: string;
  readonly eventHash: string;
}

/** Recomputes one stored row's hash from what the database holds. */
export function hashOfStoredRow(stream: string, scope: string, row: VerifiableEventRow): string {
  return eventHashOf({
    stream,
    scope,
    sequence: row.sequence,
    occurredAt: row.occurredAt,
    eventType: row.eventType,
    actorKind: row.actorKind,
    actorUserId: row.actorUserId,
    actorDeviceId: row.actorDeviceId,
    actorPrincipal: row.actorPrincipal,
    claimedUserId: row.claimedUserId,
    claimedEmail: row.claimedEmail,
    deviceId: row.deviceId,
    reasonCode: row.reasonCode,
    clientAddress: row.clientAddress,
    targetType: row.targetType,
    targetId: row.targetId,
    documentRef: row.documentRef,
    mutationId: row.mutationId,
    deviceLocalSequence: row.deviceLocalSequence,
    localOccurredAt: row.localOccurredAt,
    payload: row.payload,
    prevEventHash: row.prevEventHash,
  });
}

function renderNullable(value: string | null): string {
  return value === null ? 'null' : value;
}

function renderPayload(payload: Record<string, unknown> | null): string {
  return payload === null ? 'null' : canonicalJson(payload);
}
