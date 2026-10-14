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
import { payloadHashOf } from './payload-hash';
import { MutationContradictionError, MutationRejectedError } from './mutation-ledger.errors';

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
   * The business effect, executed inside the ledger's transaction with access to
   * the same transaction client. Its work, the ledger row, and the change-log
   * row commit or fail together (§38.9.3).
   *
   * Throw `MutationRejectedError` to record a permanent business rejection; any
   * other throw rolls the whole transaction back and is propagated.
   */
  readonly apply: (tx: Prisma.TransactionClient) => Promise<MutationEffectResult>;
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

export class MutationLedgerService {
  constructor(
    private readonly host: PrismaHost,
    private readonly logger?: PinoLogger,
  ) {}

  /**
   * Applies a mutation exactly once, or answers a replay from the stored record.
   *
   * @throws `MutationContradictionError` when the same `mutation_id` is sent with
   *   a different payload (§38.9.2); propagates the caller's effect error.
   */
  async applyMutation(request: ApplyMutationRequest): Promise<MutationOutcome> {
    const receivedPayloadHash = payloadHashOf(request.payload);

    return this.host.prisma.$transaction(async (tx) => {
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
        return this.replay(existing, receivedPayloadHash, request);
      }

      const receivedAt = new Date();

      // The effect is the only code that may touch business tables; it runs with
      // the same transaction client so its writes commit or roll back with ours.
      let effect: MutationEffectResult;
      try {
        effect = await request.apply(tx);
      } catch (error) {
        if (error instanceof MutationRejectedError) {
          return this.recordRejection(tx, request, receivedPayloadHash, receivedAt, error.code);
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
    const retentionFloor = await this.retentionFloor(request.organizationId, request.retentionDays);

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
    const rows = await this.host.prisma.changeLog.findMany({
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
  private async retentionFloor(organizationId: string, retentionDays: number): Promise<bigint | null> {
    const rows = await this.host.prisma.$queryRaw<{ max_aged_out: unknown }[]>`
      SELECT max(server_sequence) AS max_aged_out
      FROM change_log
      WHERE organization_id = ${organizationId}::uuid
        AND changed_at < now() - make_interval(days => ${retentionDays}::int)
    `;
    const value = rows[0]?.max_aged_out;
    if (value === null || value === undefined) return null;
    return toBigInt(value) + 1n;
  }

  /** §38.9.2: one stored row, two answers — replay or contradiction. */
  private replay(existing: LedgerRow, receivedPayloadHash: string, request: ApplyMutationRequest): MutationOutcome {
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
      throw new MutationContradictionError(
        request.organizationId,
        request.mutationId,
        existing.payloadHash,
        receivedPayloadHash,
      );
    }

    // Replay of a stored rejection is answered from the stored record and
    // applies nothing (§38.13: a permanent rejection is never silently dropped,
    // and never accidentally revived).
    if (existing.status === 'REJECTED') {
      return {
        status: 'REJECTED',
        isReplay: true,
        mutationId: request.mutationId,
        rejectionCode: existing.rejectionCode ?? 'UNKNOWN',
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
    return {
      status: 'REJECTED',
      isReplay: false,
      mutationId: request.mutationId,
      rejectionCode,
      receivedAt,
    };
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
