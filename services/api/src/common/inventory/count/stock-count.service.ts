/**
 * The stock-count service (Master Plan §15.8, §15.6, §30.5, O-14; §40.8 row
 * M4-S4).
 *
 * The count document is an operator's reconciliation instrument, and its
 * discipline is exactly the one §15.8 fixes:
 *
 * 1. **The document owns the lifecycle.** OPEN → POSTED, or OPEN →
 *    CANCELLED — and nothing else. Migration 0016's trigger refuses every
 *    other transition and every edit of a closed count; the service never
 *    fights it, it serializes on it: every lifecycle write locks the count
 *    row `FOR UPDATE` first, so two racing posts produce one posting and one
 *    replay — the count row itself is the idempotency identity (§38.9.1).
 *
 * 2. **The variance is computed at post time, against the locked authoritative
 *    level** (§15.6) — never against a record-time snapshot. The stored
 *    `expected_quantity` is the snapshot the operator's variance *preview*
 *    was computed from, honest history that never claims to be the fold's
 *    basis: stock may have moved between recording and posting, and the
 *    posting's delta is `counted − the locked quantity`, whatever time did
 *    to the snapshot in between.
 *
 * 3. **One fold, no parallel engine (§15.4).** A differing line posts through
 *    `InventoryService.foldMovementInTransaction` inside the count's own
 *    posting transaction — the same §15.6 conditional guard, the same §30
 *    costing engine, the same §38.14.1 movement identity — and the produced
 *    movement attaches to its line before the count's status flips. The
 *    transaction's audit law (§32.5 class A) covers the whole act: every
 *    movement, the level folds, and the count's one POSTED event commit or
 *    roll back together.
 *
 * 4. **O-14's mandatory reason.** A line whose posting would change the
 *    authoritative quantity carries a §38.5 reason code, or the posting is
 *    refused — an unexplained variance does not exist. A matched line
 *    (counted = the authoritative quantity) posts nothing: no movement, no
 *    attachment, no event — no unnecessary movement.
 *
 * 5. **The cost authority is separate (§30.1, §11.2).** Recording an offer is
 *    free of it; *posting* a line that carries one re-resolves the caller's
 *    current §11 effective set inside the posting transaction and demands
 *    `catalog.cost.edit` there — the acceptance moment is the posting, so the
 *    check rides the same transaction and the same resolver. A variance that
 *    increases stock with no basis needs exactly such an offer, because the
 *    engine never fabricates a cost; the absence of one is the honest 409
 *    `INVENTORY_COST_BASIS_REQUIRED` (§30.2).
 */

import type { Prisma } from '@prisma/client';
import type { Logger as PinoLogger } from 'pino';

import type { AuthorizationService } from '../../tenancy/authorization/authorization.service';
import { toPermissionSet } from '../../tenancy/authorization/effective-permissions';
import type { AuditStreamWriter } from '../../audit/audit-stream-writer';
import { withTenantTransaction } from '../../database/tenant-context';
import { DomainError } from '../../errors/domain.error';
import { ERROR_CODES } from '../../errors/problem';
import type { PrismaHost } from '../../identity/prisma-host';
import { INVENTORY_CONTRACT_VERSION, INVENTORY_TARGET_TYPES } from '../inventory.contract';
import type { MovementOffer } from '../inventory.domain';
import type { InventoryService } from '../inventory.service';
import { STOCK_COUNT_CONTRACT_VERSION } from './stock-count.contract';
import type { CreateCountOffer, RecordCountLineOffer } from './stock-count.domain';
import {
  asAdjustmentReasonCodeOrRefuse,
  asCountStatusOrRefuse,
  buildCountLineMovementOffer,
} from './stock-count.domain';

/** Re-exported so the push applier composes without reaching into internals. */
export {
  buildCountLineMovementOffer,
  canonicalizeCreateCount,
  canonicalizeRecordCountLine,
} from './stock-count.domain';

type Tx = Prisma.TransactionClient;

/** The verified attribution the count service acts under — never a body field. */
export interface StockCountSource {
  readonly organizationId: string;
  readonly actorUserId: string;
}

/** The count include shape every read answers through. */
const countInclude = {
  location: { select: { id: true, name: true } },
  lines: {
    orderBy: { variantId: 'asc' as const },
    include: { variant: { select: { id: true, sku: true, product: { select: { nameAr: true } } } } },
  },
} as const;

type CountWithLines = Prisma.StockCountGetPayload<{ include: typeof countInclude }>;

export class StockCountService {
  constructor(
    /** The database host the service depends on: the connected client, read at call time. */
    private readonly host: PrismaHost,
    /** The §32.5 class-A transactional audit writer; always wired in production. */
    private readonly audit: AuditStreamWriter,
    /** The §11 resolver the posting's cost escalation reuses — never a second permission rule. */
    private readonly authorization: AuthorizationService,
    /** The one movement engine the posting folds through (§15.4: no parallel engine). */
    private readonly inventory: InventoryService,
    private readonly logger?: PinoLogger,
  ) {}

  // --- reads ---

  /**
   * Lists the count documents, newest first, with their recorded lines (the
   * deterministic order: creation, then id on the documents, variant id on the
   * lines). A count of another tenant does not exist behind the forced-RLS
   * policy — the page simply never contains it.
   */
  async listCounts(
    organizationId: string,
    query: { locationId?: string; status?: 'OPEN' | 'POSTED' | 'CANCELLED'; limit?: number } = {},
  ): Promise<readonly StockCountResponseView[]> {
    return withTenantTransaction(this.host, organizationId, async (tx) => {
      const rows = await tx.stockCount.findMany({
        where: {
          ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
          ...(query.status === undefined ? {} : { status: query.status }),
        },
        orderBy: [{ createdAt: 'desc' as const }, { id: 'asc' as const }],
        ...(query.limit === undefined ? {} : { take: Math.min(query.limit, 100) }),
        include: countInclude,
      });
      return rows.map((row) => toCountResponse(row));
    });
  }

  /** One count document. A foreign or unknown id is the honest 404 (ADR-029 posture). */
  async getCount(organizationId: string, countId: string): Promise<StockCountResponseView> {
    return withTenantTransaction(this.host, organizationId, async (tx) => {
      const row = await tx.stockCount.findUnique({ where: { id: countId }, include: countInclude });
      if (row === null) {
        throw new DomainError(ERROR_CODES.NOT_FOUND, 'no such stock count in this organization');
      }
      return toCountResponse(row);
    });
  }

  // --- lifecycle: create, record, post, cancel ---

  /**
   * Opens a count document: the empty, OPEN shell whose lines the operator
   * records next. The lifecycle event `INVENTORY_STOCK_COUNT_RECORDED` marks
   * the document's birth; its observations audit as the posting's per-line
   * facts (a recording changes no quantity fact — nothing has been posted yet).
   */
  async createCount(
    organizationId: string,
    actorUserId: string,
    offered: CreateCountOffer,
    now: Date = new Date(),
  ): Promise<StockCountResponseView> {
    return withTenantTransaction(this.host, organizationId, (tx) =>
      this.createCountInTransaction(tx, { organizationId, actorUserId }, offered, now),
    );
  }

  /**
   * Records (or re-records) one observation against an OPEN count: a repeated
   * scan of a variant *edits* the same line (§15.8 — the per-(count, variant)
   * unique is the edit's identity), refreshing the observation, the record
   * facts, and the `expected_quantity` snapshot the new record saw.
   */
  async recordCountLine(
    organizationId: string,
    actorUserId: string,
    countId: string,
    offered: RecordCountLineOffer,
    options: { readonly lineId?: string } = {},
    now: Date = new Date(),
  ): Promise<StockCountResponseView> {
    return withTenantTransaction(this.host, organizationId, (tx) =>
      this.recordCountLineInTransaction(tx, { organizationId, actorUserId }, countId, offered, options, now),
    );
  }

  /**
   * Posts the count: for every recorded line, the §15.6 authoritative variance
   * (`counted − the locked quantity`), a movement per differing line through
   * the one fold, the movement attachment on the line, the status flip with
   * its attribution facts, and the one POSTED audit event carrying every
   * per-line fact — all inside one transaction. A POSTED count answers its
   * replay from storage; a CANCELLED count refuses `409 STOCK_COUNT_CLOSED`.
   */
  async postCount(
    organizationId: string,
    actorUserId: string,
    countId: string,
    now: Date = new Date(),
  ): Promise<PostStockCountResponseView> {
    return withTenantTransaction(this.host, organizationId, (tx) =>
      this.postCountInTransaction(tx, { organizationId, actorUserId }, countId, now),
    );
  }

  /**
   * Closes an abandoned count without posting anything: the observation shell
   * is attributed and closed, its facts rest unposted. A POSTED count is
   * closed history — refused `409 STOCK_COUNT_CLOSED`; a CANCELLED count
   * answers its replay (the same idempotency identity).
   */
  async cancelCount(
    organizationId: string,
    actorUserId: string,
    countId: string,
    now: Date = new Date(),
  ): Promise<PostStockCountResponseView> {
    return withTenantTransaction(this.host, organizationId, (tx) =>
      this.cancelCountInTransaction(tx, { organizationId, actorUserId }, countId, now),
    );
  }

  // --- transaction-scoped internals (composed by the tier-2 applier) ---

  /**
   * The count's birth, in a caller's transaction. `countId` is `undefined` on
   * the route (the database names the document) and a device-generated UUIDv7
   * on the offline path, where the client's id is the deterministic identity
   * the push's idempotency lookup keys on.
   */
  async createCountInTransaction(
    tx: Tx,
    source: StockCountSource,
    offered: CreateCountOffer & { readonly countId?: string },
    now: Date = new Date(),
  ): Promise<StockCountResponseView> {
    const location = await this.inventory.resolveLocation(tx, source.organizationId, offered.locationId);
    const created = await tx.stockCount.create({
      data: {
        ...(offered.countId === undefined ? {} : { id: offered.countId }),
        organizationId: source.organizationId,
        locationId: location.id,
        status: 'OPEN',
        actorUserId: source.actorUserId,
        note: offered.note,
      },
      include: countInclude,
    });

    await this.appendCountAudit(tx, source.organizationId, source.actorUserId, {
      eventType: 'INVENTORY_STOCK_COUNT_RECORDED',
      targetId: created.id,
      documentRef: `count:${created.id}`,
      occurredAt: now,
      payload: {
        locationId: location.id,
        locationName: location.name,
        status: created.status,
        ...(created.note === null ? {} : { note: created.note }),
      },
    });

    this.logger?.info(
      { component: 'inventory', organizationId: source.organizationId, countId: created.id },
      'the stock count was recorded',
    );
    return toCountResponse(created);
  }

  /**
   * One recorded observation, in a caller's transaction. The answer carries no
   * audit event of its own deliberately: recording changes no quantity fact,
   * and the document's POSTED event carries every recorded fact (observation,
   * snapshot, reason pair, who and when) as the observation's audit face.
   */
  async recordCountLineInTransaction(
    tx: Tx,
    source: StockCountSource,
    countId: string,
    offered: RecordCountLineOffer,
    options: { readonly lineId?: string } = {},
    now: Date = new Date(),
  ): Promise<StockCountResponseView> {
    // The authoritative lifecycle gate: the document row is locked, so a race
    // records against the truth the next writer sees, never a read snapshot.
    const count = await this.lockStockCount(tx, countId);
    if (count.status !== 'OPEN') {
      throw new DomainError(
        ERROR_CODES.STOCK_COUNT_CLOSED,
        `count ${count.id} is ${count.status} and its observations are closed history`,
      );
    }

    // The variant is live and of this tenant — the same lock the movement fold
    // takes, so a racing fold serializes before the observation is recorded.
    await this.inventory.lockLiveVariant(tx, offered.variantId);

    // The snapshot: the authoritative system quantity this recording saw. An
    // unrecorded variant observes `0` — a fact, never a guess.
    const level = await tx.stockLevel.findFirst({
      where: { variantId: offered.variantId, locationId: count.locationId },
      select: { quantity: true },
    });
    const expected = level === null ? 0n : level.quantity;

    await tx.stockCountLine.upsert({
      where: {
        organizationId_countId_variantId: {
          organizationId: source.organizationId,
          countId: count.id,
          variantId: offered.variantId,
        },
      },
      update: {
        countedQuantity: offered.countedQuantity,
        expectedQuantity: expected,
        reasonCode: offered.reasonCode,
        unitCostMinor: offered.unitCostMinor,
        recordedAt: now,
        recordedBy: source.actorUserId,
      },
      create: {
        ...(options.lineId === undefined ? {} : { id: options.lineId }),
        organizationId: source.organizationId,
        countId: count.id,
        variantId: offered.variantId,
        countedQuantity: offered.countedQuantity,
        expectedQuantity: expected,
        reasonCode: offered.reasonCode,
        unitCostMinor: offered.unitCostMinor,
        recordedAt: now,
        recordedBy: source.actorUserId,
      },
    });

    const readback = await tx.stockCount.findUniqueOrThrow({ where: { id: count.id }, include: countInclude });
    return toCountResponse(readback);
  }

  /**
   * The variance posting, in a caller's transaction. The count row is locked
   * first and authoritatively; the caller then proves the state every fold
   * below will act on.
   */
  async postCountInTransaction(
    tx: Tx,
    source: StockCountSource,
    countId: string,
    now: Date = new Date(),
  ): Promise<PostStockCountResponseView> {
    const status = await this.lockStockCountStatus(tx, countId);
    if (status === 'CANCELLED') {
      throw new DomainError(ERROR_CODES.STOCK_COUNT_CLOSED, `count ${countId} was cancelled; only an open count posts`);
    }
    if (status === 'POSTED') {
      // The §38.9.1 replay: the count row's own lifecycle is the idempotency
      // identity — the stored document (with its attached movements) is the
      // answer, never a second effect.
      const stored = await tx.stockCount.findUniqueOrThrow({ where: { id: countId }, include: countInclude });
      return { status: 'REPLAY' as const, count: toCountResponse(stored) };
    }

    const count = await tx.stockCount.findUniqueOrThrow({ where: { id: countId }, include: countInclude });

    // The cost authority is exercised at the posting (the moment the offer
    // becomes a folded cost), inside this same transaction, through the same
    // §11 resolver every guard uses (§9.4): any offered cost line demands
    // `catalog.cost.edit` from the caller's CURRENT effective set.
    const costOffered = count.lines.some((line) => line.unitCostMinor !== null);
    if (costOffered) {
      await this.requireCostAuthorityInTransaction(tx, source);
    }

    const movementIdByLine = new Map<string, string>();
    // The per-line facts the POSTED event carries (the observation's audit
    // face — including attribution; the application response never shows it).
    const lineFacts: Record<string, unknown>[] = [];

    for (const line of count.lines) {
      // The §15.6 authoritative level: re-locked and re-read per line in the
      // same posting transaction (the variant's row lock serializes against
      // every other producer; the posting's order is the lines' deterministic
      // variant order, so two overlapping posts can never deadlock).
      const { current } = await this.inventory.lockVariantLevel(tx, line.variantId, count.locationId);
      const delta = line.countedQuantity - current;

      if (delta === 0n) {
        // A matched line posts nothing — O-14's "no unnecessary movement" —
        // and nothing else about it changes.
        lineFacts.push(toPostedLineFact(line, null));
        continue;
      }

      if (line.reasonCode === null) {
        // O-14: an unexplained variance does not post. The operator resolves
        // it by recording the line's reason; the transaction rolls back whole.
        throw new DomainError(
          ERROR_CODES.STOCK_COUNT_REASON_REQUIRED,
          `count line ${line.id} variance ${delta.toString()} needs a reason code before posting`,
        );
      }

      const offer: MovementOffer = buildCountLineMovementOffer({
        lineId: line.id,
        variantId: line.variantId,
        countId: count.id,
        locationId: count.locationId,
        delta,
        reasonCode: asAdjustmentReasonCodeOrRefuse(line.reasonCode),
        unitCostMinor: line.unitCostMinor,
      });

      const answer = await this.inventory.foldMovementInTransaction(
        tx,
        source,
        offer,
        { auditDocumentRef: `count:${count.id}` },
        now,
      );
      movementIdByLine.set(line.id, answer.movement.movementId);
      lineFacts.push(
        toPostedLineFact(line, {
          movementId: answer.movement.movementId,
          quantityDelta: answer.movement.quantityDelta,
          resultingQuantity: answer.resultingQuantity,
        }),
      );
    }

    // The movement attachment runs while the count row still says OPEN (the
    // line-immutability trigger requires it), before the status flip that
    // closes the document's observations as history.
    for (const [lineId, movementId] of movementIdByLine) {
      await tx.stockCountLine.update({ where: { id: lineId }, data: { movementId } });
    }

    const closed = await tx.stockCount.update({
      where: { id: count.id },
      data: { status: 'POSTED', postedAt: now, postedActorUserId: source.actorUserId },
      include: countInclude,
    });

    await this.appendCountAudit(tx, source.organizationId, source.actorUserId, {
      eventType: 'INVENTORY_STOCK_COUNT_POSTED',
      targetId: count.id,
      documentRef: `count:${count.id}`,
      occurredAt: now,
      payload: {
        locationId: count.locationId,
        status: 'POSTED',
        varianceLines: movementIdByLine.size,
        matchedLines: count.lines.length - movementIdByLine.size,
        lines: lineFacts,
      },
    });

    this.logger?.info(
      {
        component: 'inventory',
        organizationId: source.organizationId,
        countId: count.id,
        varianceLines: movementIdByLine.size,
      },
      'the stock count posted its variance',
    );
    return { status: 'APPLIED' as const, count: toCountResponse(closed) };
  }

  /** The cancellation, in a caller's transaction: attribution facts, closed shell, one event. */
  async cancelCountInTransaction(
    tx: Tx,
    source: StockCountSource,
    countId: string,
    now: Date = new Date(),
  ): Promise<PostStockCountResponseView> {
    const status = await this.lockStockCountStatus(tx, countId);
    if (status === 'POSTED') {
      throw new DomainError(
        ERROR_CODES.STOCK_COUNT_CLOSED,
        `count ${countId} is posted history; its variance lives in the movement ledger`,
      );
    }
    if (status === 'CANCELLED') {
      const stored = await tx.stockCount.findUniqueOrThrow({ where: { id: countId }, include: countInclude });
      return { status: 'REPLAY' as const, count: toCountResponse(stored) };
    }

    await tx.stockCount.update({
      where: { id: countId },
      data: { status: 'CANCELLED', cancelledAt: now, cancelledActorUserId: source.actorUserId },
    });

    const closed = await tx.stockCount.findUniqueOrThrow({ where: { id: countId }, include: countInclude });
    await this.appendCountAudit(tx, source.organizationId, source.actorUserId, {
      eventType: 'INVENTORY_STOCK_COUNT_CANCELLED',
      targetId: countId,
      documentRef: `count:${countId}`,
      occurredAt: now,
      payload: {
        locationId: closed.locationId,
        status: 'CANCELLED',
        linesLeftUnposted: closed.lines.length,
      },
    });

    this.logger?.info(
      { component: 'inventory', organizationId: source.organizationId, countId },
      'the stock count was cancelled',
    );
    return { status: 'APPLIED' as const, count: toCountResponse(closed) };
  }

  // --- internals ---

  /**
   * Locks the count document row `FOR UPDATE` inside the caller's transaction
   * and answers its row — the serialization point of the whole lifecycle, and
   * the tenant boundary (RLS scopes the rows; a foreign count finds zero rows
   * and answers the honest 404).
   */
  private async lockStockCount(tx: Tx, countId: string): Promise<{ id: string; status: string; locationId: string }> {
    const locked = await tx.$queryRaw<Array<{ id: string; status: string; location_id: string }>>`
      SELECT id, status, location_id
      FROM stock_counts
      WHERE id = ${countId}::uuid
        AND organization_id = current_setting('app.current_organization_id', true)::uuid
      FOR UPDATE`;
    const [lockedRow] = locked;
    if (locked.length === 0 || lockedRow === undefined) {
      throw new DomainError(ERROR_CODES.NOT_FOUND, 'no such stock count in this organization');
    }
    return { id: lockedRow.id, status: asCountStatusOrRefuse(lockedRow.status), locationId: lockedRow.location_id };
  }

  /** The lifecycle state only, behind the same authoritative lock. */
  private async lockStockCountStatus(tx: Tx, countId: string): Promise<'OPEN' | 'POSTED' | 'CANCELLED'> {
    const locked = await this.lockStockCount(tx, countId);
    return asCountStatusOrRefuse(locked.status);
  }

  /** The §11 cost authority, resolved inside the posting's own transaction. */
  private async requireCostAuthorityInTransaction(tx: Tx, source: StockCountSource): Promise<void> {
    const effective = await this.authorization.readEffectiveInTransaction(
      tx,
      source.organizationId,
      source.actorUserId,
    );
    if (!toPermissionSet(effective.permissions).has('catalog.cost.edit')) {
      throw new DomainError(
        ERROR_CODES.PERMISSION_DENIED,
        'posting a count line that offers a cost requires the cost authority',
      );
    }
  }

  /** The class-A append: one audited §15.8 document event inside the caller's transaction. */
  private async appendCountAudit(
    tx: Tx,
    organizationId: string,
    actorUserId: string,
    input: {
      readonly eventType:
        'INVENTORY_STOCK_COUNT_RECORDED' | 'INVENTORY_STOCK_COUNT_POSTED' | 'INVENTORY_STOCK_COUNT_CANCELLED';
      readonly targetId: string;
      readonly documentRef: string;
      readonly occurredAt: Date;
      readonly payload: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.audit.appendAuditEvent(tx, {
      eventType: input.eventType,
      organizationId,
      actor: { kind: 'USER', userId: actorUserId },
      occurredAt: input.occurredAt,
      targetType: INVENTORY_TARGET_TYPES.stockCount,
      targetId: input.targetId,
      documentRef: input.documentRef,
      payload: {
        stockCountContractVersion: STOCK_COUNT_CONTRACT_VERSION,
        inventoryContractVersion: INVENTORY_CONTRACT_VERSION,
        ...input.payload,
      },
    });
  }
}

// --- response shapes (the wire contract classes are structurally this view) ---

/** The count response the service answers — structurally the view DTO. */
export interface StockCountLineResponseView {
  readonly lineId: string;
  readonly variantId: string;
  readonly sku: string;
  readonly countedQuantity: string;
  readonly expectedQuantity: string;
  readonly reasonCode: string | null;
  readonly unitCostMinor: string | null;
  readonly recordedAt: string;
  readonly movementId: string | null;
}

/** The count document response the service answers — structurally the view DTO. */
export interface StockCountResponseView {
  readonly countId: string;
  readonly locationId: string;
  readonly locationName: string;
  readonly status: 'OPEN' | 'POSTED' | 'CANCELLED';
  readonly note: string | null;
  readonly createdAt: string;
  readonly postedAt: string | null;
  readonly cancelledAt: string | null;
  readonly lines: StockCountLineResponseView[];
}

/** The lifecycle-write response the service answers — structurally the view DTO. */
export interface PostStockCountResponseView {
  readonly status: 'APPLIED' | 'REPLAY';
  readonly count: StockCountResponseView;
}

/** One stored count row as the wire answers it — the one projection, everywhere. */
function toCountResponse(row: CountWithLines): StockCountResponseView {
  return {
    countId: row.id,
    locationId: row.location.id,
    locationName: row.location.name,
    status: asCountStatusOrRefuse(row.status),
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    postedAt: row.postedAt === null ? null : row.postedAt.toISOString(),
    cancelledAt: row.cancelledAt === null ? null : row.cancelledAt.toISOString(),
    lines: row.lines.map((line) => ({
      lineId: line.id,
      variantId: line.variant.id,
      sku: line.variant.sku,
      countedQuantity: line.countedQuantity.toString(),
      expectedQuantity: line.expectedQuantity.toString(),
      reasonCode: line.reasonCode,
      unitCostMinor: line.unitCostMinor === null ? null : line.unitCostMinor.toString(),
      recordedAt: line.recordedAt.toISOString(),
      movementId: line.movementId,
    })),
  };
}

/** One line's audit fact for the POSTED event (the observation's audit face). */
function toPostedLineFact(
  line: CountWithLines['lines'][number],
  posted: { movementId: string; quantityDelta: string; resultingQuantity: string } | null,
): Record<string, unknown> {
  return {
    lineId: line.id,
    variantId: line.variant.id,
    sku: line.variant.sku,
    countedQuantity: line.countedQuantity.toString(),
    expectedQuantity: line.expectedQuantity.toString(),
    ...(line.reasonCode === null ? {} : { reasonCode: line.reasonCode }),
    ...(line.unitCostMinor === null ? {} : { unitCostMinor: line.unitCostMinor.toString() }),
    recordedAt: line.recordedAt.toISOString(),
    recordedBy: line.recordedBy,
    ...(posted === null ? { posted: false } : { posted: true, ...posted }),
  };
}
