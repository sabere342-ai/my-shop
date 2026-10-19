/**
 * §38.9 / §38.11 — the server mutation ledger (Master Plan §40.5, M1b-S4).
 *
 * This service is the single door through which a mutation becomes a durable
 * server fact. It owns no business rule (§8.4, D-8): the caller supplies the
 * `apply` effect, and this service guarantees the ledger contract around it:
 *
 * - **Idempotent.** The row is keyed on `(organization_id, mutation_id)`
 *   (§38.9.1), so an identical push is a lookup — never a second effect — and a
 *   different payload under the same `mutation_id` is a `MUTATION_CONTRADICTION`
 *   security alarm (§38.9.2, F-14).
 * - **Atomic.** The business effect, the ledger row, the change-log row, and the
 *   cursor advance run in one transaction (§38.9.3, §38.11.1). A crash before
 *   commit leaves nothing; a crash after commit can never double-apply.
 * - **Serialized.** Same-`mutation_id` requests take a Postgres advisory
 *   transaction lock before the idempotency lookup, so two devices racing the
 *   same mutation produce one effect rather than two (§38.9.2, T-O5).
 *
 * The server sequence is the §38.11.1 per-organization counter; a REJECTED
 * mutation consumes no sequence and writes no change-log row and no cursor.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import type { Logger as PinoLogger } from 'pino';
import { ERROR_CODES } from '../../errors/problem';
import { withTenantTransaction, type ContextClient } from '../../database/tenant-context';
import { payloadHashOf } from './payload-hash';
import { MutationContradictionError, MutationRejectedError } from './mutation-ledger.errors';
import type { AuditStreamWriter } from '../../audit/audit-stream-writer';
import type { DurableAuditRecorder } from '../../audit/durable-security-event-sink';
import {
  type AuditActor,
  type AuditEventInput,
  type AuditEventType,
  type SyncRejectionClassification,
} from '../../audit/stream.contract';

/**
 * The database surface the ledger needs: a client that can open interactive
 * transactions. `PrismaService` matches this structurally, and the host is never
 * read at construction — the OpenAPI build boots with no `DATABASE_URL`.
 */
export interface PrismaHost {
  readonly prisma: PrismaClient;
}

/** What the caller's business effect produced, inside the ledger's transaction. */
export interface MutationEffectResult {
  /** The §38.8.1 aggregate kind, stamped into `change_log.entity_type`. */
  readonly entityType: string;
  /** The §38.8.1 aggregate id, stamped into `change_log.entity_id`. */
  readonly entityId: string;
  /** §38.9.1 `result_ref`: the business object the mutation produced. */
  readonly resultRef: string;
  /** §38.9.1 `result_hash`: hash of the resulting state. */
  readonly resultHash: string;
}

/**
 * The admission revalidation hook (Master Plan §9.4, §40.6 M2-S4): the current,
 * server-side authorization check run inside the same transaction as the effect.
 *
 * Throw a `MutationRejectedError` to record a permanent per-mutation rejection; the
 * ledger's rejection semantics (§38.13) then apply unchanged — the stored refusal is
 * the replay answer, with no business effect and no change-log row.
 */
export type IngressRevalidation = (tx: Prisma.TransactionClient) => Promise<void>;

export interface ApplyMutationRequest {
  /** Tenant scope, from the device binding (§38.16), never user input. */
  readonly organizationId: string;
  /** The client-generated UUIDv7 (§38.8.1 `mutation_id`). */
  readonly mutationId: string;
  /** The producing installation (§38.8.1 `device_id`). */
  readonly deviceId: string;
  /** The complete immutable business event (§38.8.1 `payload`, §38.24). */
  readonly payload: Record<string, unknown>;
  /**
   * M2-S6 (§32.6, §32.2A): the **verified** actor of the push path, from the
   * sync trusted context — never the mutation's asserted `actorUserId`,
   * which is an offline claim the ledger deliberately never inspects. It
   * attributes the audit rows only; the ledger's own invariants are
   * unaffected. A caller without one records the rows as device-attributed.
   */
  readonly verifiedActorUserId?: string;
  /**
   * The business effect, executed inside the ledger's transaction with access to
   * the same transaction client. Its work, the ledger row, and the change-log
   * row commit or fail together (§38.9.3).
   *
   * Throw `MutationRejectedError` to record a permanent business rejection; any
   * other throw rolls the whole transaction back and is propagated.
   */
  readonly apply: (tx: Prisma.TransactionClient) => Promise<MutationEffectResult>;
  /**
   * §9.4 / M2-S4: run before the effect, inside the same transaction, after the
   * idempotency lookup. Order matters and is documented: a stored replay is
   * answered from the record (no second effect, nothing re-authorized), while a
   * first application is re-validated against **current** server state — live
   * membership and effective permissions — never against a cached offline snapshot.
   */
  readonly validateIngress?: IngressRevalidation;
}

/** An APPLIED mutation response (§38.10.1). `serverSequence` is the §38.11.1 order. */
export interface MutationAppliedOutcome {
  readonly status: 'APPLIED';
  /** False on first acceptance; true when the stored response is returned (§38.9.2). */
  readonly isReplay: boolean;
  readonly mutationId: string;
  readonly resultRef: string;
  readonly resultHash: string;
  readonly serverSequence: bigint;
  readonly receivedAt: Date;
}

/** A REJECTED mutation response (§38.10.1, §38.13). */
export interface MutationRejectedOutcome {
  readonly status: 'REJECTED';
  /** False on first sight; true when the stored rejection is returned. */
  readonly isReplay: boolean;
  readonly mutationId: string;
  readonly rejectionCode: string;
  readonly receivedAt: Date;
}

export type MutationOutcome = MutationAppliedOutcome | MutationRejectedOutcome;

/**
 * A request to read one page of the §38.11.1 change feed.
 *
 * `after` is an exclusive lower bound on `server_sequence` (a cursor, never an
 * offset); `limit` is the bounded page size (§38.11.2); `retentionDays` is the
 * window beyond which a cursor must re-baseline rather than page.
 */
export interface PullChangesRequest {
  /** Tenant scope, from the device binding (§38.16), never user input. */
  readonly organizationId: string;
  /** Exclusive cursor: return changes with `server_sequence` strictly greater. */
  readonly after: bigint;
  /** Bounded page size (§38.11.2). */
  readonly limit: number;
  /** §38.11.1 / O-21 retention window in days. */
  readonly retentionDays: number;
}

/** One change-feed descriptor (§38.11.1). `mutationId` is null for a server change. */
export interface PullChange {
  readonly serverSequence: bigint;
  readonly entityType: string;
  readonly entityId: string;
  readonly mutationId: string | null;
  readonly changedAt: Date;
}

/**
 * One page of the change feed (§38.11.2).
 *
 * `nextAfter` is the cursor for the following request — the last served
 * sequence, or the request `after` unchanged when the page is empty.
 * `rebaselineRequired` is true when the cursor is older than the retention
 * window, in which case the page is deliberately empty and `retentionFloor` is
 * the first sequence still inside the window (§38.11.1).
 */
export interface PullPage {
  readonly changes: readonly PullChange[];
  readonly nextAfter: bigint;
  readonly hasMore: boolean;
  readonly rebaselineRequired: boolean;
  readonly retentionFloor: bigint | null;
}

/** A mutation_ledger row as read back through Prisma. */
type LedgerRow = NonNullable<Awaited<ReturnType<PrismaClient['mutationLedger']['findUnique']>>>;

/**
 * Prisma and node-postgres may deliver `int8` as `bigint` or as a decimal string
 * depending on the code path; both represent the same integer and the sequence
 * is always an integer (§38.11.1), so normalize rather than trust one shape.
 */
function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  throw new Error('the server-sequence allocation returned a non-integer value');
}

/** The stored rejection answer when a malformed ledger row lacks its code. */
const UNKNOWN_REJECTION = 'UNKNOWN';

export class MutationLedgerService {
  constructor(
    private readonly host: PrismaHost,
    private readonly logger?: PinoLogger,
    /**
     * M2-S6 (§32.5, §32.2A): the transactional audit writer for the class-A
     * rows — accepted, rejected, and retry events commit with the ledger
     * facts they describe. Production wiring always supplies it.
     */
    private readonly audit?: AuditStreamWriter,
    /**
     * M2-S6 (§32.2A): the durable class-B recorder for the rows that follow a
     * *refused* ledger frame — the §38.9.2 idempotency contradiction, whose
     * audit row and security event must survive the transaction the alarm
     * aborts. Production wiring always supplies it.
     */
    private readonly durableAudit?: DurableAuditRecorder,
  ) {}

  /**
   * Applies a mutation exactly once, or answers a replay from the stored record.
   *
   * @throws `MutationContradictionError` when the same `mutation_id` is sent with
   *   a different payload (§38.9.2); propagates the caller's effect error.
   */
  async applyMutation(request: ApplyMutationRequest): Promise<MutationOutcome> {
    const receivedPayloadHash = payloadHashOf(request.payload);
    const validateIngress = request.validateIngress;

    // §9.3 step 6 / §9.4 T-10 (M2-S4): the ledger's one transaction is now the trusted,
    // tenant-scoped transaction. The organization id is the caller's already-verified
    // trusted context, and `withTenantTransaction` establishes §8.2's transaction-local
    // setting before the advisory lock — so the idempotency lookup, the revalidation
    // read, the effect, the ledger row, the change-log row, and the cursor all run with
    // the database policy enforcing the same tenant scope (§9.4 T-10/T-12).
    return withTenantTransaction(this.host, request.organizationId, async (tx) => {
      // §38.9.2 / T-O5: two devices racing the same mutation are serialized here,
      // before the lookup, so the second waits and then replays instead of applying.
      // `pg_advisory_xact_lock` returns the Postgres type `void`, which `$queryRaw`
      // cannot deserialize — a statement, so it belongs in `$executeRaw`.
      const lockKey = `${request.organizationId}:${request.mutationId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

      const existing = await tx.mutationLedger.findUnique({
        where: {
          organizationId_mutationId: {
            organizationId: request.organizationId,
            mutationId: request.mutationId,
          },
        },
      });

      if (existing !== null) {
        return this.replay(tx, existing, receivedPayloadHash, request);
      }

      const receivedAt = new Date();
      // §9.4 T-8/T-9 (M2-S4): the §9.4 re-validation runs here — after the
      // idempotency lookup (a stored answer is replayed without a second
      // authorization) and before the effect — inside the same transaction, so
      // what the effect consumes is exactly what re-validation read. A recorded
      // rejection follows the §38.13 path unchanged: the refusal becomes the
      // row a later replay is answered from.
      if (validateIngress !== undefined) {
        try {
          await validateIngress(tx);
        } catch (error) {
          if (error instanceof MutationRejectedError) {
            // §32.2A: an ingress refusal is the authorization class — the
            // highest-severity offline family — recorded in the same
            // transaction as the REJECTED ledger row itself (class A).
            return this.recordRejection(tx, request, receivedPayloadHash, receivedAt, error.code, 'INGRESS');
          }
          throw error;
        }
      }

      // The effect is the only code that may touch business tables; it runs with
      // the same transaction client so its writes commit or roll back with ours.
      let effect: MutationEffectResult;
      try {
        effect = await request.apply(tx);
      } catch (error) {
        if (error instanceof MutationRejectedError) {
          return this.recordRejection(tx, request, receivedPayloadHash, receivedAt, error.code, 'BUSINESS');
        }
        throw error;
      }

      const serverSequence = await this.allocateSequence(tx, request.organizationId);

      await tx.mutationLedger.create({
        data: {
          organizationId: request.organizationId,
          mutationId: request.mutationId,
          deviceId: request.deviceId,
          receivedAt,
          payloadHash: receivedPayloadHash,
          resultRef: effect.resultRef,
          resultHash: effect.resultHash,
          serverSequence,
          status: 'APPLIED',
        },
      });

      // §38.11.1: the change feed is written in the same transaction, so the
      // sequence it pages on is exactly the one acceptance ordered.
      await tx.changeLog.create({
        data: {
          organizationId: request.organizationId,
          serverSequence,
          mutationId: request.mutationId,
          entityType: effect.entityType,
          entityId: effect.entityId,
          changedAt: receivedAt,
        },
      });

      await this.advancePushCursor(tx, request, serverSequence);

      // M2-S6 (§32.2A "Sync accepted": mutation id, device, server time, result
      // reference, server sequence): the canonical acceptance row — one per
      // mutation, ever, enforced by the partial unique index beside this
      // service's replay discipline — commits with the acceptance facts. The
      // row carries the mutation id: the acceptance's own identity, and what
      // the database's `uq_audit_events_accepted_per_mutation` law keys on.
      // A replayed push never re-enters this path: its answer comes from the
      // stored record above, so no second acceptance row can pretend the same
      // mutation was accepted twice. The failed append rolls the acceptance
      // itself back (class A: an unaudited acceptance is not an acceptance).
      await this.appendMutationAuditEvent(tx, request, 'SYNC_MUTATION_ACCEPTED', {
        occurredAt: receivedAt,
        mutationId: request.mutationId,
        targetType: effect.entityType,
        targetId: effect.entityId,
        payload: { resultRef: effect.resultRef, serverSequence: serverSequence.toString() },
      });

      return {
        status: 'APPLIED',
        isReplay: false,
        mutationId: request.mutationId,
        resultRef: effect.resultRef,
        resultHash: effect.resultHash,
        serverSequence,
        receivedAt,
      };
    });
  }

  /**
   * Reads one page of the §38.11.1 change feed (§38.11.2).
   *
   * Cursor-based on `server_sequence`: changes strictly after `after`, ascending,
   * bounded by `limit`. A cursor older than the retention window is answered with
   * an empty page and `rebaselineRequired` — never a partial feed that would
   * silently drop the aged-out prefix (§38.11.1). This is a pure read: it never
   * advances `device_sync_cursors`, because §38.11.2 makes the client store its
   * cursor only after the page is applied locally, and the server cannot observe
   * that success.
   */
  async pullChanges(request: PullChangesRequest): Promise<PullPage> {
    // §9.4 T-10/T-12 (M2-S4): the feed read is tenant-owned data, so both reads —
    // the retention floor and the page — run inside the trusted tenant
    // transaction. The behaviour is unchanged from M1b-S6; only the scope in
    // which the statements run is new (and additionally enforced by the
    // `change_log` policy).
    return withTenantTransaction(this.host, request.organizationId, async (tx) => {
      const retentionFloor = await this.retentionFloor(tx, request.organizationId, request.retentionDays);

      // §38.11.1: "a client whose cursor is older than retention performs a full
      // re-baseline rather than a partial pull". The client is current when the
      // next sequence it needs (`after + 1`) is at or above the floor.
      const rebaselineRequired = retentionFloor !== null && request.after + 1n < retentionFloor;
      if (rebaselineRequired) {
        return {
          changes: [],
          nextAfter: request.after,
          hasMore: false,
          rebaselineRequired: true,
          retentionFloor,
        };
      }

      // Fetch one row beyond the page so `hasMore` is a fact, not a guess. Ordered
      // ascending so `server_sequence` is the page's order (§38.11.2 "the server
      // sequence guards application order").
      const rows = await tx.changeLog.findMany({
        where: {
          organizationId: request.organizationId,
          serverSequence: { gt: request.after },
        },
        orderBy: { serverSequence: 'asc' },
        take: request.limit + 1,
      });

      const hasMore = rows.length > request.limit;
      const page = hasMore ? rows.slice(0, request.limit) : rows;
      const changes: PullChange[] = page.map((row) => ({
        serverSequence: row.serverSequence,
        entityType: row.entityType,
        entityId: row.entityId,
        mutationId: row.mutationId,
        changedAt: row.changedAt,
      }));
      const last = changes[changes.length - 1];
      const nextAfter = last === undefined ? request.after : last.serverSequence;

      return { changes, nextAfter, hasMore, rebaselineRequired: false, retentionFloor };
    });
  }

  /**
   * §38.11.1 retention floor: one past the highest `server_sequence` older than
   * the window, or `null` when nothing has aged out (every change is retained).
   *
   * The floor is computed from the feed's own clock rather than from a purge: at
   * M1b-S6 no rows are physically deleted, so "what is retained" is the policy
   * boundary the endpoint enforces. A purge job is a later operational slice;
   * this definition does not change when one arrives.
   */
  private async retentionFloor(
    tx: Pick<ContextClient, '$queryRaw'>,
    organizationId: string,
    retentionDays: number,
  ): Promise<bigint | null> {
    const rows = await tx.$queryRaw<{ max_aged_out: unknown }[]>`
      SELECT max(server_sequence) AS max_aged_out
      FROM change_log
      WHERE organization_id = ${organizationId}::uuid
        AND changed_at < now() - make_interval(days => ${retentionDays}::int)
    `;
    const value = rows[0]?.max_aged_out;
    if (value === null || value === undefined) return null;
    return toBigInt(value) + 1n;
  }

  /**
   * §38.9.2: one stored row, two answers — replay or contradiction.
   *
   * The first classification is answered from the record alone; a rejection
   * replay appends one §32.2A `SYNC_MUTATION_RETRY` row (class A) whose payload
   * carries the attempt number (one past the prior retry count — the §32.2A
   * "attempt number" fact) and the stored rejection code.
   */
  private async replay(
    tx: Prisma.TransactionClient,
    existing: LedgerRow,
    receivedPayloadHash: string,
    request: ApplyMutationRequest,
  ): Promise<MutationOutcome> {
    if (existing.payloadHash !== receivedPayloadHash) {
      this.logger?.warn(
        {
          component: 'mutation-ledger',
          securityEvent: 'sync-rejected-idempotency-contradiction',
          organizationId: request.organizationId,
          mutationId: request.mutationId,
          storedPayloadHash: existing.payloadHash,
          replayedPayloadHash: receivedPayloadHash,
        },
        'mutation_id reused with a different payload_hash — 409 MUTATION_CONTRADICTION, owner review required',
      );
      // §32.2A "Sync rejected — idempotency contradiction" + §32.3/§38.27: the
      // contradiction is the one history this throw's own transaction cannot
      // carry — the journal rolls back with the alarm. Both durable rows are
      // therefore class B: the recorder opens its own short transaction (the
      // tenant scope is the request's verified one) and never throws into this
      // decision. A persistence failure leaves the structured warn line above
      // as the record — never the mislabeled silence of a lost fact.
      this.durableAudit?.recordTenantAuditEvent({
        eventType: 'SYNC_MUTATION_CONTRADICTION',
        organizationId: request.organizationId,
        actor: this.mutationActor(request),
        occurredAt: new Date(),
        mutationId: request.mutationId,
        payload: { storedPayloadHash: existing.payloadHash, replayedPayloadHash: receivedPayloadHash },
      });
      this.durableAudit?.recordSecurityEvent({
        eventType: 'SYNC_MUTATION_CONTRADICTION',
        organizationId: request.organizationId,
        actor: this.mutationActor(request),
        occurredAt: new Date(),
        deviceId: request.deviceId,
        reasonCode: ERROR_CODES.MUTATION_CONTRADICTION,
        payload: {
          mutationId: request.mutationId,
          storedPayloadHash: existing.payloadHash,
          replayedPayloadHash: receivedPayloadHash,
        },
      });
      throw new MutationContradictionError(
        request.organizationId,
        request.mutationId,
        existing.payloadHash,
        receivedPayloadHash,
      );
    }

    // Replay of a stored rejection is answered from the stored record and
    // applies nothing (§38.13: a permanent rejection is never silently dropped,
    // and never accidentally revived). The retry the caller just made is a
    // server-observed fact of the §32.2A vocabulary — recorded class A: this
    // read-answer frame is live and the row it appends commits with it.
    if (existing.status === 'REJECTED') {
      const priorRetries = await tx.auditEvent.count({
        where: {
          organizationId: request.organizationId,
          mutationId: request.mutationId,
          eventType: 'SYNC_MUTATION_RETRY',
        },
      });
      await this.appendMutationAuditEvent(tx, request, 'SYNC_MUTATION_RETRY', {
        occurredAt: new Date(),
        mutationId: request.mutationId,
        targetType: 'MUTATION',
        targetId: request.mutationId,
        payload: { attemptNumber: priorRetries + 1, rejectionCode: existing.rejectionCode ?? UNKNOWN_REJECTION },
      });
      return {
        status: 'REJECTED',
        isReplay: true,
        mutationId: request.mutationId,
        rejectionCode: existing.rejectionCode ?? UNKNOWN_REJECTION,
        receivedAt: existing.receivedAt,
      };
    }

    // The column is nullable for REJECTED rows, so the non-null invariants of an
    // APPLIED row are asserted here rather than assumed.
    const resultRef = existing.resultRef;
    const resultHash = existing.resultHash;
    const serverSequence = existing.serverSequence;
    if (resultRef === null || resultHash === null || serverSequence === null) {
      throw new Error('mutation_ledger row with status APPLIED lacks its result or sequence');
    }

    // An applied-mutation replay (§38.9.3: the normal offline redelivery — a
    // lost answer, a double tap, a network retry) is deliberately NOT re-audit-
    // ed: the §32.2A event vocabulary has no replay event, the canonical
    // ACCEPTED row is unique per mutation by database law, and re-auditing a
    // normal replay would manufacture a tamper-detection ambiguity (rows
    // arriving outside the chain's per-scope order for no decision). The
    // redelivered answer comes from the stored record.
    return {
      status: 'APPLIED',
      isReplay: true,
      mutationId: request.mutationId,
      resultRef,
      resultHash,
      serverSequence: toBigInt(serverSequence),
      receivedAt: existing.receivedAt,
    };
  }

  /** §38.13: record a permanent business rejection; no sequence, feed, or cursor. */
  private async recordRejection(
    tx: Prisma.TransactionClient,
    request: ApplyMutationRequest,
    payloadHash: string,
    receivedAt: Date,
    rejectionCode: string,
    classification: SyncRejectionClassification,
  ): Promise<MutationRejectedOutcome> {
    await tx.mutationLedger.create({
      data: {
        organizationId: request.organizationId,
        mutationId: request.mutationId,
        deviceId: request.deviceId,
        receivedAt,
        payloadHash,
        status: 'REJECTED',
        rejectionCode,
      },
    });
    // M2-S6 (§32.2A "Sync rejected — business/authorization"): the durable
    // refusal row commits **inside this same transaction** (class A) — the
    // stored REJECTED ledger row and the audit row that explains it are one
    // committed fact pair. `classification` is the §32.2A discriminator: the
    // re-validator's INGRESS refusal is the highest-severity offline family;
    // everything the business effect refused is BUSINESS.
    await this.appendMutationAuditEvent(tx, request, 'SYNC_MUTATION_REJECTED', {
      occurredAt: receivedAt,
      mutationId: request.mutationId,
      targetType: 'MUTATION',
      targetId: request.mutationId,
      payload: { classification, rejectionCode },
    });
    return {
      status: 'REJECTED',
      isReplay: false,
      mutationId: request.mutationId,
      rejectionCode,
      receivedAt,
    };
  }

  /**
   * §32.6 / §32.2A: one audit actor for the ledger's rows, copied from the
   * ledger's own facts — the push trusted context's verified actor when the
   * caller supplied one, the mutation's producing device otherwise. Never
   * "nobody", and never the mutation payload's *asserted* `actorUserId`, which
   * is an offline claim the ledger never inspects (§38.17's discipline: the
   * ledger's invariants are unaffected; this is attribution only).
   */
  private mutationActor(request: ApplyMutationRequest): AuditActor {
    return request.verifiedActorUserId === undefined
      ? { kind: 'DEVICE', deviceId: request.deviceId }
      : { kind: 'USER', userId: request.verifiedActorUserId, deviceId: request.deviceId };
  }

  /**
   * The §32.2A append helper: one class-A row of the closed audit vocabulary
   * inside the caller's (always tenant-scoped) ledger transaction. Append-only
   * by construction — the writer is told nothing but the event; failures roll
   * the whole protected frame back. Without a writer (narrow unit wiring), the
   * unchanged ledger contract keeps its earlier M1b behaviour.
   */
  private appendMutationAuditEvent(
    tx: Prisma.TransactionClient,
    request: ApplyMutationRequest,
    eventType: AuditEventType,
    event: Omit<AuditEventInput, 'eventType' | 'organizationId' | 'actor'>,
  ): Promise<void> {
    return Promise.resolve(
      this.audit?.appendAuditEvent(tx, {
        eventType,
        organizationId: request.organizationId,
        actor: this.mutationActor(request),
        ...event,
      }),
    );
  }

  /**
   * §38.11.1: the next value of the per-organization sequence. One
   * upsert-returning statement, so the counter cannot be double-allocated even
   * under concurrency. Gaps are expected and harmless (§38.11.1).
   */
  private async allocateSequence(tx: Prisma.TransactionClient, organizationId: string): Promise<bigint> {
    const rows = await tx.$queryRaw<{ last_sequence: unknown }[]>`
      INSERT INTO sync_sequences (organization_id, last_sequence)
      VALUES (${organizationId}::uuid, 1)
      ON CONFLICT (organization_id)
      DO UPDATE SET last_sequence = sync_sequences.last_sequence + 1
      RETURNING last_sequence
    `;
    const value = rows[0]?.last_sequence;
    if (value === undefined) {
      throw new Error('the server-sequence allocation returned no row');
    }
    return toBigInt(value);
  }

  /**
   * §40.5 M1b-S4 `device_sync_cursors`: the per-device cursor. `GREATEST` makes
   * "never moved backwards" a property of the upsert rather than a convention;
   * a late-arriving replay of an already-surpassed mutation cannot lower it.
   */
  private async advancePushCursor(
    tx: Prisma.TransactionClient,
    request: ApplyMutationRequest,
    serverSequence: bigint,
  ): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO device_sync_cursors (
        organization_id,
        device_id,
        last_pushed_server_sequence,
        last_pull_server_sequence,
        updated_at
      )
      VALUES (${request.organizationId}::uuid, ${request.deviceId}::uuid, ${serverSequence}::bigint, 0, now())
      ON CONFLICT (organization_id, device_id)
      DO UPDATE SET
        last_pushed_server_sequence = GREATEST(
          device_sync_cursors.last_pushed_server_sequence,
          EXCLUDED.last_pushed_server_sequence
        ),
        updated_at = now()
    `;
  }
}
