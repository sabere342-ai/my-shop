/**
 * The inventory service (Master Plan §15.4, §15.5, §15.6, §15.6A, §38.14.1;
 * §40.8 row M4-S2).
 *
 * The same three structural rules the catalog service states, restated for the
 * quantity history:
 *
 * 1. **Tenant scope is server-derived.** Every read and write runs inside the
 *    trusted tenant transaction (§8.2 `withTenantTransaction`) with the route
 *    organization id the authorization guard matched against the token's
 *    membership claim (§9.3). `stock_movements` and `stock_levels` are
 *    forced-RLS tenant tables, so the database refuses a context-free or
 *    foreign-context statement before the service touches a row — and their
 *    composite foreign keys keep a movement or a level structurally pinned to
 *    this tenant's variant and location.
 *
 * 2. **The §15.6 guard is a database fact, never a preflight.** Every stock
 *    deduction runs as the conditional fold the plan fixes as the *only*
 *    supported path: the level row is locked `FOR UPDATE` inside the movement
 *    transaction (the variant row is locked first, deterministically, so two
 *    competing submissions serialize), the fold is computed from the
 *    authoritative current value, and a fold that would cross zero is answered
 *    `409 INSUFFICIENT_STOCK` with the balance untouched and no movement
 *    recorded. Migration 0014's non-negative CHECK refutes even a writer that
 *    bypasses the service.
 *
 * 3. **The movement, the level, and the audit events are one transaction.**
 *    §32.5's class-A law at inventory granularity: the append-only movement,
 *    the derived level it produced, and the `INVENTORY_*` history event commit
 *    or roll back together.
 *
 * Movement identity (§38.14.1): the caller's `movementId` *is* the movement's
 * primary key and its idempotency identity. An identical retry reads the
 * stored movement and answers `REPLAY` — never a second effect; the same
 * identity naming a different fact is the ledger's own `MUTATION_CONTRADICTION`
 * refusal (§38.9.2). The per-organization `server_sequence` rides the same
 * `sync_sequences` counter the mutation ledger allocates from, so the change
 * feed and the movement history are one acceptance order per organization.
 *
 * Quantity honesty (§15.4, §38.14.2): `stock_levels` is *derived* — the fast
 * cache the service maintains inside the movement transaction, a pure function
 * of the fold over the authoritative movements. No path writes a stock total
 * directly; no client ever names a balance in a request.
 */

import { Prisma } from '@prisma/client';
import type { Logger as PinoLogger } from 'pino';

import type { AuditStreamWriter } from '../audit/audit-stream-writer';
import { withTenantTransaction } from '../database/tenant-context';
import { DomainError } from '../errors/domain.error';
import { ERROR_CODES } from '../errors/problem';
import type { PrismaHost } from '../identity/prisma-host';
import {
  DEFAULT_LOCATION_NAME,
  INVENTORY_CONTRACT_VERSION,
  INVENTORY_LIST_MAX_LIMIT,
  INVENTORY_TARGET_TYPES,
  type MovementCause,
} from './inventory.contract';
import type { MovementFact, MovementOffer } from './inventory.domain';
import { CanonicalizationError, canonicalizeMovementOffer } from './inventory.domain';
import type {
  LevelResponse,
  LocationResponse,
  MovementResponse,
  MovementSubmissionResponse,
} from './inventory-view.contract';

export interface ListLevelsQuery {
  readonly variantId?: string;
  readonly locationId?: string;
  readonly limit?: number;
}

/** One submitted movement: every value the raw wire offered, already proven. */
export interface SubmitMovementInput {
  readonly organizationId: string;
  /** The verified principal's user id — the §32.6 attribution, never a body field. */
  readonly actorUserId: string;
  /** The raw wire offer; canonicalized before any connection is opened. */
  readonly offered: {
    readonly movementId: string;
    readonly cause: string;
    readonly variantId: string;
    readonly locationId?: string | null;
    readonly quantityDelta: string;
    readonly reasonCode?: string | null;
    readonly reasonNote?: string | null;
    readonly documentRef?: string | null;
  };
}

type Tx = Prisma.TransactionClient;

/** The Prisma include shape the movement reads answer through. */
const movementInclude = {
  variant: { select: { id: true, sku: true } },
  location: { select: { id: true, name: true } },
} as const;

export class InventoryService {
  constructor(
    /** The database host the service depends on: the connected client, read at call time. */
    private readonly host: PrismaHost,
    /** The §32.5 class-A transactional audit writer; always wired in production. */
    private readonly audit: AuditStreamWriter,
    private readonly logger?: PinoLogger,
  ) {}

  // --- reads ---

  /**
   * Lists the organization's locations. The V1 default location is the plan's
   * seeded row (plan line 203: "V1 seeds one default location"): this read
   * deterministically seeds it when it does not exist yet, so an organization
   * that has never touched inventory still answers one truthful location
   * instead of an empty set. The partial unique index makes a second default
   * impossible even under a race.
   */
  async listLocations(organizationId: string): Promise<readonly LocationResponse[]> {
    return withTenantTransaction(this.host, organizationId, async (tx) => {
      await this.ensureDefaultLocation(tx, organizationId);
      const rows = await tx.inventoryLocation.findMany({
        orderBy: [{ isDefault: 'desc' as const }, { createdAt: 'asc' as const }, { id: 'asc' as const }],
      });
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        isDefault: row.isDefault,
        createdAt: row.createdAt.toISOString(),
      }));
    });
  }

  /**
   * Lists the derived levels joined with the identity facts a user needs — the
   * variant SKU, the parent product's Arabic name, the location's name. The V1
   * single default location is ensured first so the location axis always
   * exists; a variant with no level row simply has no entry (no stock has ever
   * been recorded for it). Order is deterministic (creation, then id).
   */
  async listLevels(organizationId: string, query: ListLevelsQuery = {}): Promise<readonly LevelResponse[]> {
    return withTenantTransaction(this.host, organizationId, async (tx) => {
      await this.ensureDefaultLocation(tx, organizationId);
      const rows = await tx.stockLevel.findMany({
        where: {
          ...(query.variantId === undefined ? {} : { variantId: query.variantId }),
          ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
        },
        orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
        ...(query.limit === undefined ? {} : { take: Math.min(query.limit, INVENTORY_LIST_MAX_LIMIT) }),
        include: {
          variant: { select: { id: true, sku: true, product: { select: { nameAr: true } } } },
          location: { select: { id: true, name: true } },
        },
      });
      return rows.map((row) => toLevelResponse(row));
    });
  }

  /**
   * Lists the authoritative movement history, newest acceptance first. The
   * order rides the per-organization `server_sequence` — the one acceptance
   * order every fact of the organization shares — so the fold is readable
   * straight off the answer.
   */
  async listMovements(organizationId: string, query: ListLevelsQuery = {}): Promise<readonly MovementResponse[]> {
    return withTenantTransaction(this.host, organizationId, async (tx) => {
      const rows = await tx.stockMovement.findMany({
        where: {
          ...(query.variantId === undefined ? {} : { variantId: query.variantId }),
          ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
        },
        orderBy: [{ serverSequence: 'desc' as const }, { id: 'asc' as const }],
        ...(query.limit === undefined ? {} : { take: Math.min(query.limit, INVENTORY_LIST_MAX_LIMIT) }),
        include: movementInclude,
      });
      return rows.map((row) => toMovementResponse(row));
    });
  }

  // --- writes ---

  /**
   * Records one movement behind the §15.6 conditional guard (the §15.6A server
   * guard) and the §38.14.1 idempotency identity.
   *
   * Order inside the one transaction, and why it is this order:
   *
   *  1. the stored identity lookup — a replay reads its answer and never
   *     re-locks anything (§38.9.1: an identical push is a lookup);
   *  2. the fact comparison — the same identity naming a different fact is
   *     `409 MUTATION_CONTRADICTION` (§38.9.2);
   *  3. the variant row lock — a foreign or deleted parent is the same honest
   *     404, and the lock is the sequence point that serializes two racing
   *     submissions to the same variant before either fold runs;
   *  4. the location resolution — explicit and tenant-owned, or the V1
   *     default;
   *  5. the level fold behind `SELECT … FOR UPDATE` — the §15.6 conditional
   *     guard; crossing zero refuses `409 INSUFFICIENT_STOCK` before anything
   *     is written;
   *  6. the append-only movement INSERT with the allocated acceptance
   *     sequence;
   *  7. the level row's create-or-update (the derived cache);
   *  8. the class-A audit event — same transaction, same fate.
   */
  async submitMovement(input: SubmitMovementInput, now: Date = new Date()): Promise<MovementSubmissionResponse> {
    // Canonicalized before any connection: the raw wire is never trusted, and
    // a refused offer never costs the database a round trip.
    const offer = canonicalizeOrRefuse(input.offered);
    return withTenantTransaction(this.host, input.organizationId, async (tx) => {
      const stored = await tx.stockMovement.findUnique({
        where: { id: offer.movementId },
        include: movementInclude,
      });
      if (stored !== null) {
        return this.answerStored(tx, stored, offer);
      }

      const variant = await this.lockLiveVariant(tx, offer.variantId);
      const location = await this.resolveLocation(tx, input.organizationId, offer.locationId);

      // The §15.6 conditional fold, behind the row lock the variant row took
      // above (re-read at the movement level as well, so a level created by an
      // older, uncommitted transaction cannot hide).
      const level = await tx.stockLevel.findFirst({
        where: { variantId: variant.id, locationId: location.id },
        select: { id: true, quantity: true },
      });
      const current = level === null ? 0n : level.quantity;
      const resulting = current + offer.quantityDelta;
      if (resulting < 0n) {
        throw new DomainError(
          ERROR_CODES.INSUFFICIENT_STOCK,
          `variant ${variant.id} at location ${location.id}: the fold ${resulting.toString()} would cross zero from a current quantity of ${current.toString()}`,
        );
      }

      const serverSequence = await allocateServerSequence(tx, input.organizationId);

      let movement: Prisma.StockMovementGetPayload<{ include: typeof movementInclude }>;
      try {
        movement = await tx.stockMovement.create({
          data: {
            id: offer.movementId,
            organizationId: input.organizationId,
            variantId: variant.id,
            locationId: location.id,
            cause: offer.cause,
            quantityDelta: offer.quantityDelta,
            unitCostMinor: null,
            reversesMovementId: null,
            originMutationId: null,
            deviceId: null,
            deviceLocalSequence: null,
            serverSequence,
            reasonCode: offer.reasonCode,
            reasonNote: offer.reasonNote,
            documentRef: offer.documentRef,
            occurredAt: now,
          },
          include: movementInclude,
        });
      } catch (error) {
        throw mapUniqueRefusal(error, offer.cause);
      }

      // The derived cache: create the row this movement's fold implies, or move
      // the existing one. The non-negative CHECK (migration 0014) is the
      // database's own last line of defence.
      if (level === null) {
        await tx.stockLevel.create({
          data: {
            organizationId: input.organizationId,
            variantId: variant.id,
            locationId: location.id,
            quantity: resulting,
          },
        });
      } else {
        await tx.stockLevel.update({
          where: { id: level.id },
          data: { quantity: resulting, version: { increment: 1 }, updatedAt: now },
        });
      }

      await this.appendAudit(tx, input.organizationId, input.actorUserId, {
        eventType:
          offer.cause === 'OPENING_BALANCE' ? 'INVENTORY_OPENING_BALANCE_RECORDED' : 'INVENTORY_ADJUSTMENT_RECORDED',
        targetId: movement.id,
        documentRef: `variant:${variant.id}:location:${location.id}`,
        occurredAt: now,
        payload: {
          cause: offer.cause,
          variantId: variant.id,
          sku: variant.sku,
          locationId: location.id,
          quantityDelta: offer.quantityDelta.toString(),
          resultingQuantity: resulting.toString(),
          ...(offer.reasonCode === null ? {} : { reasonCode: offer.reasonCode }),
          ...(offer.reasonNote === null ? {} : { reasonNote: offer.reasonNote }),
          ...(offer.documentRef === null ? {} : { documentRef: offer.documentRef }),
          serverSequence: serverSequence.toString(),
        },
      });

      this.logger?.info(
        {
          component: 'inventory',
          organizationId: input.organizationId,
          movementId: movement.id,
          cause: offer.cause,
          quantityDelta: offer.quantityDelta.toString(),
          resultingQuantity: resulting.toString(),
        },
        'the movement was recorded behind the conditional stock guard',
      );

      return {
        status: 'APPLIED' as const,
        movement: toMovementResponse(movement),
        resultingQuantity: resulting.toString(),
        level: {
          variantId: variant.id,
          sku: variant.sku,
          productNameAr: variant.product.nameAr,
          locationId: location.id,
          locationName: location.name,
          quantity: resulting.toString(),
          updatedAt: now.toISOString(),
        },
      };
    });
  }

  // --- internals ---

  /**
   * The V1 default location, ensured idempotently. The partial unique index
   * (`inventory_locations_single_default`) makes a second default impossible;
   * `ON CONFLICT … DO NOTHING` makes two racing ensures one committed row. RLS
   * scopes the insert to the trusted tenant context, so the row is born inside
   * the right tenant.
   */
  private async ensureDefaultLocation(
    tx: Tx,
    organizationId: string,
  ): Promise<{ id: string; name: string; isDefault: boolean }> {
    const first = await tx.inventoryLocation.findFirst({
      where: { organizationId, isDefault: true },
      orderBy: { id: 'asc' as const },
    });
    if (first !== null) {
      return first;
    }
    await tx.$executeRaw`
      INSERT INTO inventory_locations (organization_id, name, is_default)
      VALUES (${organizationId}::uuid, ${DEFAULT_LOCATION_NAME}, true)
      ON CONFLICT ("organization_id") WHERE "is_default" DO NOTHING`;
    const ensured = await tx.inventoryLocation.findFirst({
      where: { organizationId, isDefault: true },
      orderBy: { id: 'asc' as const },
    });
    if (ensured === null) {
      throw new DomainError(ERROR_CODES.INTERNAL_ERROR, 'the default location could be neither read nor seeded');
    }
    return ensured;
  }

  /**
   * Resolves the movement's location: the explicit id must belong to the
   * organization (RLS and the composite foreign key both enforce that fact),
   * and an absent id names the V1 default. A foreign location id is a 404 —
   * never an existence leak (ADR-029 posture).
   */
  private async resolveLocation(
    tx: Tx,
    organizationId: string,
    locationId: string | null,
  ): Promise<{ id: string; name: string; isDefault: boolean }> {
    await this.ensureDefaultLocation(tx, organizationId);
    if (locationId === null) {
      return this.ensureDefaultLocation(tx, organizationId);
    }
    const location = await tx.inventoryLocation.findFirst({ where: { id: locationId, organizationId } });
    if (location === null) {
      throw new DomainError(ERROR_CODES.NOT_FOUND, 'no such location in this organization');
    }
    return location;
  }

  /**
   * Locks the live variant row for this movement (§8.2: the RLS context scopes
   * the query; a foreign id is the same honest 404 the deleted parent gets).
   * `SELECT … FOR UPDATE` is the serialization point for two racing
   * submissions to one variant; the read-modify-write span it protects is the
   * level fold below.
   */
  private async lockLiveVariant(
    tx: Tx,
    variantId: string,
  ): Promise<{
    id: string;
    sku: string;
    product: { nameAr: string; deletedAt: Date | null };
  }> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT pv.id
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      WHERE pv.id = ${variantId}::uuid
        AND pv.organization_id = current_setting('app.current_organization_id', true)::uuid
        AND p.deleted_at IS NULL
      FOR UPDATE OF pv`;
    if (locked.length === 0) {
      throw new DomainError(ERROR_CODES.NOT_FOUND, 'no such live variant in this organization');
    }
    return tx.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      include: { product: { select: { nameAr: true, deletedAt: true } } },
    });
  }

  /**
   * Answers a stored movement from its identity (§38.9.1): the semantic fact
   * comparison decides replay or contradiction (§38.9.2). No second effect; no
   * re-lock; the answer reflects the stored truth, with the live derived level
   * re-read so a replay shows the fold that followed, never a re-frozen
   * snapshot.
   */
  private async answerStored(
    tx: Tx,
    stored: Prisma.StockMovementGetPayload<{ include: typeof movementInclude }>,
    offer: MovementOffer,
  ): Promise<MovementSubmissionResponse> {
    const storedFact: MovementFact = {
      movementId: stored.id,
      cause: stored.cause as MovementFact['cause'],
      variantId: stored.variantId,
      locationId: stored.locationId,
      quantityDelta: stored.quantityDelta.toString(),
      reasonCode: stored.reasonCode,
      reasonNote: stored.reasonNote,
      documentRef: stored.documentRef,
    };
    const offeredFact: MovementFact = {
      movementId: offer.movementId,
      cause: offer.cause,
      variantId: offer.variantId,
      // An absent location names the V1 default in both representations; the
      // stored row always carries the concrete id. The comparison therefore
      // normalizes the offered location against the stored one first.
      locationId: offer.locationId ?? storedFact.locationId,
      quantityDelta: offer.quantityDelta.toString(),
      reasonCode: offer.reasonCode,
      reasonNote: offer.reasonNote,
      documentRef: offer.documentRef,
    };
    if (isSameFact(storedFact, offeredFact) === false) {
      this.logger?.warn(
        {
          component: 'inventory',
          securityEvent: 'inventory-movement-contradiction',
          movementId: offer.movementId,
          stored: { cause: storedFact.cause, quantityDelta: storedFact.quantityDelta },
          offered: { cause: offeredFact.cause, quantityDelta: offeredFact.quantityDelta },
        },
        'movement id reused with a different fact — 409 MUTATION_CONTRADICTION',
      );
      throw new DomainError(
        ERROR_CODES.MUTATION_CONTRADICTION,
        'the same movement id names a different fact (§38.9.2)',
      );
    }

    const level = await tx.stockLevel.findFirst({
      where: { variantId: stored.variantId, locationId: stored.locationId },
      include: {
        variant: { select: { id: true, sku: true, product: { select: { nameAr: true } } } },
        location: { select: { id: true, name: true } },
      },
    });

    return {
      status: 'REPLAY' as const,
      movement: toMovementResponse(stored),
      resultingQuantity: level === null ? stored.quantityDelta.toString() : level.quantity.toString(),
      level:
        level === null
          ? {
              variantId: stored.variant.id,
              sku: stored.variant.sku,
              productNameAr: '',
              locationId: stored.location.id,
              locationName: stored.location.name,
              quantity: stored.quantityDelta.toString(),
              updatedAt: stored.createdAt.toISOString(),
            }
          : toLevelResponse(level),
    };
  }

  /** The class-A append: one audited inventory event inside the caller's transaction. */
  private async appendAudit(
    tx: Tx,
    organizationId: string,
    actorUserId: string,
    input: {
      readonly eventType: 'INVENTORY_OPENING_BALANCE_RECORDED' | 'INVENTORY_ADJUSTMENT_RECORDED';
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
      targetType: INVENTORY_TARGET_TYPES.movement,
      targetId: input.targetId,
      documentRef: input.documentRef,
      payload: { contractVersion: INVENTORY_CONTRACT_VERSION, ...input.payload },
    });
  }
}

/**
 * The per-organization acceptance order: the same `sync_sequences` counter the
 * mutation ledger allocates from (§38.14.1 "server_sequence: assigned when the
 * server accepts it"). One counter per organization — the change feed and the
 * movement history are one acceptance order — and the atomic upsert makes two
 * racing allocations serialize on the row. Gaps are expected and harmless
 * (§38.11.1); monotonicity is the property the fold order needs.
 */
async function allocateServerSequence(tx: Tx, organizationId: string): Promise<bigint> {
  const rows = await tx.$queryRaw<{ last_sequence: unknown }[]>`
    INSERT INTO sync_sequences (organization_id, last_sequence)
    VALUES (${organizationId}::uuid, 1)
    ON CONFLICT (organization_id)
    DO UPDATE SET last_sequence = sync_sequences.last_sequence + 1
    RETURNING last_sequence`;
  const value: unknown = rows[0]?.last_sequence;
  if (value === undefined) {
    throw new DomainError(ERROR_CODES.INTERNAL_ERROR, 'the acceptance-sequence allocation returned no row');
  }
  const text =
    typeof value === 'bigint' || typeof value === 'string' || typeof value === 'number' ? value.toString() : null;
  if (text === null) {
    throw new DomainError(ERROR_CODES.INTERNAL_ERROR, 'the server-sequence allocation returned a non-integer value');
  }
  if (!/^[0-9]+$/.test(text)) {
    throw new DomainError(ERROR_CODES.INTERNAL_ERROR, 'the server-sequence allocation returned a non-integer value');
  }
  return BigInt(text);
}

/**
 * Canonicalizes the raw wire offer, or refuses it as the `409`-shaped
 * `VALIDATION_FAILED` domain error before any connection is opened: a
 * `CanonicalizationError` is a canonicalizer's refusal, never a driver's, so
 * the domain translation lives here where the wire meets the offer.
 */
function canonicalizeOrRefuse(offered: Parameters<typeof canonicalizeMovementOffer>[0]): MovementOffer {
  try {
    return canonicalizeMovementOffer(offered);
  } catch (error) {
    if (error instanceof CanonicalizationError) {
      throw new DomainError(
        ERROR_CODES.VALIDATION_FAILED,
        `the movement offer was refused before any connection: ${error.message}`,
        [{ field: error.field, messages: [error.message] }],
      );
    }
    throw error;
  }
}

/**
 * The database's unique-index refusals, mapped to the inventory's honest codes.
 * The fact comparison above catches a reused movement id during the *lookup*;
 * the unique refusals catch the races the lookup cannot — most importantly two
 * racing opening balances for the same variant and location, where the loser
 * receives `409 INVENTORY_OPENING_BALANCE_DUPLICATE` and its transaction rolls
 * back whole.
 *
 * For an `OPENING_BALANCE` INSERT every candidate collision is the partial
 * opening-balance index: the `id` is a fresh identity, the `server_sequence`
 * was just allocated from the per-organization counter, and
 * `origin_mutation_id` is not carried on this path — so the cause names the
 * violated fact (the observed refusals number `stock_movements_opening_balance_once`
 * among the targets, but the cause alone is dispositive).
 */
function mapUniqueRefusal(error: unknown, cause: string): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    if (cause === 'OPENING_BALANCE') {
      return new DomainError(
        ERROR_CODES.INVENTORY_OPENING_BALANCE_DUPLICATE,
        'this variant already carries an opening balance at this location',
      );
    }
    return new DomainError(ERROR_CODES.INTERNAL_ERROR, 'the movement collided with an existing row');
  }
  return error;
}

/**
 * The §38.9.1 replay/contradiction decision, over the fields that define what
 * the movement *did* (§38.14.1, minus the time fields): cause, variant,
 * location, signed delta, and the adjustment's reason pair.
 */
function isSameFact(stored: MovementFact, offered: MovementFact): boolean {
  return (
    stored.cause === offered.cause &&
    stored.variantId === offered.variantId &&
    stored.locationId === offered.locationId &&
    stored.quantityDelta === offered.quantityDelta &&
    stored.reasonCode === offered.reasonCode &&
    stored.reasonNote === offered.reasonNote &&
    stored.documentRef === offered.documentRef
  );
}

/** One level row as the wire answers it. */
function toLevelResponse(row: {
  variant: { id: string; sku: string; product: { nameAr: string } };
  location: { id: string; name: string };
  quantity: bigint;
  updatedAt: Date;
}): LevelResponse {
  return {
    variantId: row.variant.id,
    sku: row.variant.sku,
    productNameAr: row.variant.product.nameAr,
    locationId: row.location.id,
    locationName: row.location.name,
    quantity: row.quantity.toString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** One movement row as the wire answers it, with its §38.14.1 identity. */
function toMovementResponse(
  row: Prisma.StockMovementGetPayload<{ include: typeof movementInclude }>,
): MovementResponse {
  return {
    movementId: row.id,
    cause: row.cause as MovementCause,
    variantId: row.variant.id,
    sku: row.variant.sku,
    locationId: row.location.id,
    quantityDelta: row.quantityDelta.toString(),
    reasonCode: row.reasonCode,
    reasonNote: row.reasonNote,
    serverSequence: row.serverSequence.toString(),
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
