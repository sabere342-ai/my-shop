/**
 * The audit-stream integrity verifier (Master Plan §32.5; the M2-S6 key
 * acceptance: **tampering with event ordering is detectable**).
 *
 * A read-only walk of one stream in one scope. It never writes, never locks
 * beyond the reads, and never "repairs" anything: its whole value is that
 * the committed rows either satisfy all of the invariants below or name
 * exactly which one broke, where, and at which sequence.
 *
 * The invariants per (stream, scope):
 *
 * 1. **Continuity** — the committed series is `1, 2, 3, …` with no gaps.
 *    Gaps cannot be produced by a rollback (the head allocation makes the
 *    next committed append reuse the rolled-back value), and the application
 *    role has no DELETE privilege (migration `0010`, §32.5), so a committed
 *    gap is evidence of deletion by a principal that had the privilege.
 * 2. **Hash recomputation** — every row's `event_hash` equals the canonical
 *    hash of the stored fields, so any *in-place* field change is visible.
 * 3. **Chain linkage** — every `prev_event_hash` equals the previous
 *    committed row's `event_hash`, so an inserted, removed, or re-sorted row
 *    cannot keep both neighbours' chains intact.
 * 4. **Head agreement** — the head row stores the committed max sequence and
 *    the last row's hash, so a rewound or forged head is visible to the next
 *    verifier run even before the next append breaks the chain.
 *
 * Honest boundary, stated in code: the hashes are application-computed. A
 * principal that can UPDATE/DELETE — or a superuser, above RLS entirely — can
 * rewrite rows and recompute the chain. The verifier detects tampering by
 * every principal whose privileges PostgreSQL constrains; §32.5's guarantee
 * is exactly those constraints plus this verification.
 */

import type { Prisma } from '@prisma/client';
import { hashOfStoredRow, type VerifiableEventRow } from './canonical';
import { GLOBAL_SECURITY_SCOPE, type AuditStream } from './stream.contract';

/** One integrity defect, located by stream, scope, and chain position. */
export interface AuditIntegrityDefect {
  readonly kind: 'SEQUENCE_BREAK' | 'HASH_MISMATCH' | 'CHAIN_BREAK' | 'HEAD_DISAGREEMENT';
  readonly detail: string;
  /** The sequence the walk expected at the failure point, when determined. */
  readonly expectedSequence: bigint | null;
  /** The sequence the walk observed at the failure point, when it had one. */
  readonly observedSequence: bigint | null;
}

/** The per-scope verification result. `defects` empty means verified. */
export interface AuditIntegrityScopeReport {
  readonly stream: AuditStream;
  readonly scope: string;
  readonly examinedRows: number;
  readonly verified: boolean;
  readonly defects: readonly AuditIntegrityDefect[];
}

/** The read surface the verifier needs (Prisma transactions and host serve it). */
export type AuditVerifierClient = Pick<Prisma.TransactionClient, 'auditEvent' | 'securityEvent' | 'auditStreamHead'>;

/** The per-scope verification input. */
export interface VerifyScopeRequest {
  readonly stream: AuditStream;
  /** An organization id, or the GLOBAL sentinel for the security stream. */
  readonly scope: string;
}

/**
 * Verifies one stream in one scope, read-only, inside the caller's
 * transaction. The caller is responsible for the tenant scope it already
 * runs in (an organization verification runs inside its trusted transaction;
 * the GLOBAL security scope runs without a tenant context under the nil
 * scope the RLS policy admits to every verified connection).
 */
export async function verifyAuditStreamScope(
  tx: AuditVerifierClient,
  request: VerifyScopeRequest,
): Promise<AuditIntegrityScopeReport> {
  const { stream, scope } = request;
  const streamIsAudit = stream === 'AUDIT';

  // Rows normalize to one shape before the walk, so the per-row logic never
  // branches on the stream again. Sequential awaits are fine: the verifier is
  // a walk, not a hot path.
  const projectRows: readonly VerifiableEventRow[] = streamIsAudit
    ? (await tx.auditEvent.findMany({ where: { organizationId: scope }, orderBy: { sequence: 'asc' } })).map(auditRow)
    : (await tx.securityEvent.findMany({ where: recordWhere(scope), orderBy: { sequence: 'asc' } })).map(securityRow);
  const heads = await tx.auditStreamHead.findUnique({ where: { stream_scope: { stream, scope } } });

  const defects: AuditIntegrityDefect[] = [];
  let expectedSequence = 1n;
  let previousHash: string | null = null;

  const securityOrgOf = (row: VerifiableEventRow): string => row.organizationId ?? GLOBAL_SECURITY_SCOPE;

  for (const row of projectRows) {
    const verifiable: VerifiableEventRow = row;

    if (verifiable.sequence !== expectedSequence) {
      defects.push({
        kind: 'SEQUENCE_BREAK',
        detail: `expected sequence ${expectedSequence} but found ${verifiable.sequence}: the committed series has a gap`,
        expectedSequence,
        observedSequence: verifiable.sequence,
      });
      // Continue the walk from where the series actually is, so later defects
      // are located against the chain that really exists.
      expectedSequence = verifiable.sequence;
    }

    const recomputed = hashOfStoredRow(stream, streamIsAudit ? scope : securityOrgOf(verifiable), verifiable);
    if (recomputed !== verifiable.eventHash) {
      defects.push({
        kind: 'HASH_MISMATCH',
        detail: `the stored fields of sequence ${verifiable.sequence} hash to ${recomputed}, not the stored ${verifiable.eventHash}`,
        expectedSequence: null,
        observedSequence: verifiable.sequence,
      });
    }

    if (previousHash !== null && verifiable.prevEventHash !== previousHash) {
      defects.push({
        kind: 'CHAIN_BREAK',
        detail: `sequence ${verifiable.sequence} chains to ${verifiable.prevEventHash}, but the previous committed row hashes to ${previousHash}`,
        expectedSequence: null,
        observedSequence: verifiable.sequence,
      });
    }

    previousHash = verifiable.eventHash;
    expectedSequence += 1n;
  }

  // 4. The head must agree with the committed chain.
  const lastRow = projectRows[projectRows.length - 1];
  if (heads === null) {
    if (projectRows.length > 0) {
      defects.push({
        kind: 'HEAD_DISAGREEMENT',
        detail: `${projectRows.length} committed row(s) exist with no head row`,
        expectedSequence: null,
        observedSequence: null,
      });
    }
  } else if (lastRow !== undefined) {
    const lastSequence = lastRow.sequence;
    const lastHash = lastRow.eventHash;
    if (heads.lastSequence !== lastSequence) {
      defects.push({
        kind: 'HEAD_DISAGREEMENT',
        detail: `the head stores sequence ${heads.lastSequence} but the chain ends at ${String(lastSequence)}`,
        expectedSequence: null,
        observedSequence: lastSequence,
      });
    }
    if (heads.lastEventHash !== lastHash) {
      defects.push({
        kind: 'HEAD_DISAGREEMENT',
        detail: 'the head stores a hash that is not the last committed row’s',
        expectedSequence: null,
        observedSequence: null,
      });
    }
  } else if (heads.lastSequence !== 0n || heads.lastEventHash !== '0'.repeat(64)) {
    defects.push({
      kind: 'HEAD_DISAGREEMENT',
      detail: 'the head is advanced but the scope has no committed rows',
      expectedSequence: null,
      observedSequence: null,
    });
  }

  return { stream, scope, examinedRows: projectRows.length, verified: defects.length === 0, defects };
}

/** Audit rows are already keyed to the scope; the rows are Prisma shapes. */
function recordWhere(scope: string): { organizationId: string } | { partitionKind: string } {
  // The GLOBAL security partition is keyed by the nil organization and differs
  // from tenant rows by its `organization_id` being NULL — which is exactly
  // the RLS-visible shape a verification transaction without a tenant context
  // can see.
  if (scope === GLOBAL_SECURITY_SCOPE) return { partitionKind: 'GLOBAL' };
  return { organizationId: scope };
}

function auditRow(row: Prisma.AuditEventGetPayload<Record<string, never>>): VerifiableEventRow {
  return {
    sequence: row.sequence,
    occurredAt: row.occurredAt,
    eventType: row.eventType,
    actorKind: row.actorKind,
    actorUserId: row.actorUserId,
    actorDeviceId: row.actorDeviceId,
    actorPrincipal: row.actorPrincipal,
    // The security-only columns an audit row never carries: their hash slots
    // still exist and hold the documented `null`.
    claimedUserId: null,
    claimedEmail: null,
    deviceId: null,
    reasonCode: null,
    clientAddress: null,
    targetType: row.targetType,
    targetId: row.targetId,
    documentRef: row.documentRef,
    mutationId: row.mutationId,
    deviceLocalSequence: row.deviceLocalSequence,
    localOccurredAt: row.localOccurredAt,
    payload: row.payload === null ? null : (row.payload as Record<string, unknown>),
    prevEventHash: row.prevEventHash,
    eventHash: row.eventHash,
  };
}

function securityRow(row: Prisma.SecurityEventGetPayload<Record<string, never>>): VerifiableEventRow {
  return {
    // An audit row's scope is its organization; a security row's scope is the
    // org it carries — or the global sentinel when partitioned global. The
    // nullable column travels so the hash scope resolves without a branch.
    organizationId: row.organizationId,
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
    // The audit-only columns a security row never carries.
    targetType: null,
    targetId: null,
    documentRef: null,
    mutationId: null,
    deviceLocalSequence: null,
    localOccurredAt: null,
    payload: row.payload === null ? null : (row.payload as Record<string, unknown>),
    prevEventHash: row.prevEventHash,
    eventHash: row.eventHash,
  };
}
