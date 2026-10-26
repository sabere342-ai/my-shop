/**
 * The inventory offline applier (Master Plan §38.22 Tier 2, §40.8 row M4-S4;
 * §38.9, §9.4; §15.4, §15.8).
 *
 * The push ledger supplies the idempotency contract — one `(organization,
 * mutation_id)` row answered once, forever (§38.9); the applier supplies the
 * business effect. This class is that effect for the inventory aggregates the
 * desktop device can produce offline, wired as the production
 * `SYNC_MUTATION_APPLIER`:
 *
 * - `INVENTORY_ADJUSTMENT:CREATE` — one canonical adjustment folded through
 *   the *route's* `foldMovementInTransaction` (§15.4: no parallel engine),
 *   stamped with its §38.8.1 mutation origin (`origin_mutation_id`,
 *   `device_id`, `device_local_sequence`) so a server row answers where it
 *   came from.
 * - `INVENTORY_COUNT:CREATE` — a whole count document (creation, one recorded
 *   observation per line with its device-known line ids, the posting) applied
 *   atomically inside the ledger's own acceptance transaction, through the
 *   same three tx-scoped methods the online routes compose. The device's
 *   `countId` and per-line ids are deterministic identities: the ledger
 *   idempotency is the mutation id, and the count's own lifecycle guard
 *   answers a re-derivied replay from storage (`POSTED → REPLAY`).
 *
 * A payload the canonicalizer refuses is a *permanent* `VALIDATION_FAILED`
 * rejection (§38.13: recorded, replay-stable, never silently dropped) — the
 * same translation the route makes at the wire, made here where the ledger
 * meets the payload. Every business `DomainError` the fold or count lifecycle
 * raises (`INSUFFICIENT_STOCK`, `INVENTORY_COST_BASIS_REQUIRED`,
 * `STOCK_COUNT_*`, …) is recorded under its own stable code. Anything else —
 * an internal fault — rolls the acceptance back un-recorded.
 */

import type { Prisma } from '@prisma/client';

import { DomainError } from '../errors/domain.error';
import { ERROR_CODES } from '../errors/problem';
import { canonicalJson, sha256Hex } from '../sync/ledger/payload-hash';
import { MutationRejectedError } from '../sync/ledger/mutation-ledger.errors';
import type { MutationEffectResult } from '../sync/ledger/mutation-ledger.service';
import type { SyncMutationApplier, SyncMutationEffect } from '../sync/push/sync-mutation-applier';
import type { SyncTrustedContext } from '../sync/push/sync-auth';
import type { MutationPayload } from '../sync/sync.contract';
import type { CreateCountWire, RecordCountLineWire } from './count/stock-count.domain';
import { canonicalizeCreateCount, canonicalizeRecordCountLine } from './count/stock-count.domain';
import type { StockCountService } from './count/stock-count.service';
import { CanonicalizationError, canonicalizeMovementOffer, type MovementOfferWire } from './inventory.domain';
import { INVENTORY_AGGREGATES, INVENTORY_TARGET_TYPES } from './inventory.contract';
import type { InventoryService } from './inventory.service';

export class InventoryMutationApplier implements SyncMutationApplier {
  constructor(
    /** The one movement engine (§15.4), shared with the routes and the count poster. */
    private readonly inventory: InventoryService,
    /** The count lifecycle the count document applies through (§15.8). */
    private readonly counts: StockCountService,
  ) {}

  effectFor(mutation: MutationPayload, context: SyncTrustedContext): SyncMutationEffect {
    switch (`${mutation.aggregateType}:${mutation.operationType}`) {
      case `${INVENTORY_AGGREGATES.adjustment}:CREATE`:
        return (tx: Prisma.TransactionClient) => this.applyAdjustment(tx, mutation, context);
      case `${INVENTORY_AGGREGATES.count}:CREATE`:
        return (tx: Prisma.TransactionClient) => this.applyCount(tx, mutation, context);
      default:
        // Not an inventory aggregate this tier serves: the fail-closed answer
        // the default applier would have given stays the truth (§38.13).
        return () => Promise.reject(new MutationRejectedError(ERROR_CODES.UNSUPPORTED_MUTATION));
    }
  }

  // --- INVENTORY_ADJUSTMENT:CREATE ---

  private async applyAdjustment(
    tx: Prisma.TransactionClient,
    mutation: MutationPayload,
    context: SyncTrustedContext,
  ): Promise<MutationEffectResult> {
    // The trusted context is the actor (§38.16): the payload's asserted
    // `actorUserId` is an offline claim the applier never consults.
    const actorUserId = this.requireActor(context);
    const offer = this.canonicalizeOrRefuse(() =>
      canonicalizeMovementOffer(mutation.payload as unknown as MovementOfferWire),
    );

    const answer = await this.rejectedIfBusiness(() =>
      this.inventory.foldMovementInTransaction(
        tx,
        { organizationId: context.organizationId, actorUserId },
        offer,
        // §38.8.1: the movement row stamps where and in which device order it
        // was produced, so offline facts are traceable to their mutation.
        {
          originMutation: {
            mutationId: mutation.mutationId,
            deviceId: mutation.deviceId,
            deviceLocalSequence: mutation.deviceLocalSequence,
          },
        },
      ),
    );

    return this.effectOfMovement(answer);
  }

  // --- INVENTORY_COUNT:CREATE ---

  private async applyCount(
    tx: Prisma.TransactionClient,
    mutation: MutationPayload,
    context: SyncTrustedContext,
  ): Promise<MutationEffectResult> {
    const actorUserId = this.requireActor(context);
    const source = { organizationId: context.organizationId, actorUserId };

    // The payload is the whole document: its identity, its observations — one
    // record per line, the device-known line id riding each record — and the
    // posting that closes it. Characterization first, effect second: a refusal
    // above costs no state and no round trip.
    const payload = mutation.payload as {
      countId?: unknown;
      locationId?: unknown;
      note?: unknown;
      lines?: unknown;
    };
    const countId = payload['countId'];
    if (typeof countId !== 'string') {
      throw new MutationRejectedError(ERROR_CODES.VALIDATION_FAILED);
    }

    const creation = this.canonicalizeOrRefuse(() =>
      canonicalizeCreateCount(payload as unknown as CreateCountWire & { countId?: string }),
    );
    const lines = payload['lines'];
    if (!Array.isArray(lines)) {
      throw new MutationRejectedError(ERROR_CODES.VALIDATION_FAILED);
    }

    await this.rejectedIfBusiness(() =>
      this.counts.createCountInTransaction(tx, source, {
        locationId: creation.locationId,
        note: creation.note,
        countId,
      }),
    );

    for (const raw of lines) {
      const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
      const lineId = record['lineId'];
      if (typeof lineId !== 'string') {
        throw new MutationRejectedError(ERROR_CODES.VALIDATION_FAILED);
      }
      const offered = this.canonicalizeOrRefuse(() =>
        canonicalizeRecordCountLine(record as unknown as RecordCountLineWire),
      );
      await this.rejectedIfBusiness(() =>
        this.counts.recordCountLineInTransaction(tx, source, countId, offered, { lineId }),
      );
    }

    await this.rejectedIfBusiness(() => this.counts.postCountInTransaction(tx, source, countId));

    // The document closed POSTED above; the change feed names the document.
    // The offer vocabulary the count produced rides its own events and rows —
    // the count's one ledger detail.
    return {
      entityType: INVENTORY_TARGET_TYPES.stockCount,
      entityId: countId,
      resultRef: `count:${countId}`,
      resultHash: sha256Hex(canonicalJson({ countId, status: 'POSTED' })),
    };
  }

  // --- shared shapes ---

  /**
   * §38.16: the push trusted context carries the verified actor or it carries
   * nothing. The re-validator refuses first for a missing actor; this assert
   * keeps the applier's types honest without ever consulting the payload's one.
   */
  private requireActor(context: SyncTrustedContext): string {
    const actorUserId = context.actorUserId;
    if (actorUserId === undefined) {
      throw new MutationRejectedError(ERROR_CODES.UNAUTHENTICATED);
    }
    return actorUserId;
  }

  /**
   * Canonicalization is re-proven at the ledger's edge: a device payload is a
   * replayable claim, never a trusted offer, so the route's wire rule applies
   * here too. A refusal is a permanent `VALIDATION_FAILED` (§38.13).
   */
  private canonicalizeOrRefuse<Offer>(canonicalize: () => Offer): Offer {
    try {
      return canonicalize();
    } catch (error) {
      if (error instanceof CanonicalizationError) {
        throw new MutationRejectedError(ERROR_CODES.VALIDATION_FAILED);
      }
      throw error;
    }
  }

  /**
   * Every business `DomainError` — the fold's `INSUFFICIENT_STOCK`, the count
   * poster's `STOCK_COUNT_*`, the cost-basis refusals — is a permanent,
   * recorded rejection under its own stable code (§38.13). Another throw is an
   * internal fault: uncaught, so the whole acceptance transaction rolls back
   * and the mutation is retried, never half-recorded.
   */
  private async rejectedIfBusiness<Provided>(effect: () => Promise<Provided>): Promise<Provided> {
    try {
      return await effect();
    } catch (error) {
      if (error instanceof DomainError) {
        throw new MutationRejectedError(error.code);
      }
      throw error;
    }
  }

  /** The §38.9.1 result face of one folded movement (movement id + level fact). */
  private effectOfMovement(answer: {
    readonly movement: { readonly movementId: string; readonly quantityDelta: string };
    readonly resultingQuantity: string;
  }): MutationEffectResult {
    return {
      entityType: INVENTORY_TARGET_TYPES.movement,
      entityId: answer.movement.movementId,
      resultRef: answer.movement.movementId,
      resultHash: sha256Hex(
        canonicalJson({
          movementId: answer.movement.movementId,
          quantityDelta: answer.movement.quantityDelta,
          resultingQuantity: answer.resultingQuantity,
        }),
      ),
    };
  }
}
