import type { Prisma } from '@prisma/client';

import { DomainError } from '../errors/domain.error';
import { ERROR_CODES } from '../errors/problem';
import { MutationRejectedError } from '../sync/ledger/mutation-ledger.errors';
import type { MutationPayload } from '../sync/sync.contract';
import type { SyncTrustedContext } from '../sync/push/sync-auth';
import type { SyncMutationEffect } from '../sync/push/sync-mutation-applier';
import { canonicalJson, sha256Hex } from '../sync/ledger/payload-hash';
import type { MovementOffer } from './inventory.domain';
import { InventoryMutationApplier } from './inventory-sync-applier';
import type { InventoryService } from './inventory.service';
import type { CreateCountOffer, RecordCountLineOffer } from './count/stock-count.domain';
import type { StockCountService } from './count/stock-count.service';

/**
 * Unit acceptance for the Tier-2 offline applier (§38.22; §40.8 M4-S4).
 *
 * The ledger owns idempotency; this class owns the translation:
 * canonicalization re-proven at the ledger's edge (`VALIDATION_FAILED` on a
 * refused payload), business `DomainError`s recorded under their own stable
 * codes, other throws left to roll the acceptance back, the §38.8.1 origin
 * stamps riding the fold, and the actor taken from the trusted context —
 * never from the payload's own assertion (§38.16).
 */

const ORG_ID = 'a1000000-0000-4000-8000-000000000001';
const DEVICE_ID = 'b2000000-0000-4000-8000-000000000002';
const ACTOR_ID = 'c3000000-0000-4000-8000-000000000003';
const VARIANT_ID = 'd4000000-0000-4000-8000-000000000004';

const CONTEXT: SyncTrustedContext = {
  organizationId: ORG_ID,
  deviceId: DEVICE_ID,
  actorUserId: ACTOR_ID,
};

const TX = {} as Prisma.TransactionClient;

function payloadOf(fields: Partial<MutationPayload> & { payload?: Record<string, unknown> }): MutationPayload {
  return {
    mutationId: 'e5000000-0000-4000-8000-000000000005',
    deviceId: 'b2000000-0000-4000-8000-000000000002',
    aggregateType: 'INVENTORY_ADJUSTMENT',
    aggregateId: 'f6000000-0000-4000-8000-000000000006',
    operationType: 'CREATE',
    payload: {},

    deviceLocalSequence: 7,
    localCreatedAt: '2026-01-01T10:00:00.000Z',
    ...(fields as Partial<MutationPayload>),
  } as MutationPayload;
}

/** A well-formed offline adjustment offer (§15.5 wire shapes). */
function adjustmentPayload(): Record<string, unknown> {
  return {
    movementId: 'f6000000-0000-4000-8000-000000000006',
    cause: 'MANUAL_ADJUSTMENT',
    variantId: VARIANT_ID,
    quantityDelta: '-2',
    reasonCode: 'DAMAGED',
    // §38.16: an offline-asserted actor is claim data, never authority.
    actorUserId: '99999999-0000-4000-8000-000000000009',
    actorRoleSnapshot: { role: 'stockkeeper' },
  };
}

/** The fold fake: records the offer and the options the applier passed. */
function foldFake(answer?: {
  readonly movement: { readonly movementId: string; readonly quantityDelta: string };
  readonly resultingQuantity: string;
}) {
  return jest.fn().mockResolvedValue(
    answer ?? {
      movement: { movementId: 'f6000000-0000-4000-8000-000000000006', quantityDelta: '-2' },
      resultingQuantity: '19',
    },
  );
}

describe('InventoryMutationApplier (Tier 2, §38.22)', () => {
  describe('INVENTORY_ADJUSTMENT:CREATE — the fold through the one engine', () => {
    async function foldAdjustment(
      payload: Record<string, unknown>,
      fold: jest.Mock,
    ): Promise<Awaited<ReturnType<SyncMutationEffect>>> {
      const applier = new InventoryMutationApplier(
        { foldMovementInTransaction: fold } as unknown as InventoryService,
        {} as unknown as StockCountService,
      );
      const effect = applier.effectFor(payloadOf({ payload }), CONTEXT);
      return effect(TX);
    }

    it('folds the canonicalized offer across the trusted context’s ownership and stamps the §38.8.1 origin', async () => {
      const fold = foldFake();
      const result = await foldAdjustment(adjustmentPayload(), fold);

      expect(fold).toHaveBeenCalledTimes(1);
      const [tx, source, offer, options] = fold.mock.calls[0] as unknown as [
        Prisma.TransactionClient,
        { readonly organizationId: string; readonly actorUserId: string },
        MovementOffer,
        {
          readonly originMutation?: {
            readonly mutationId: string;
            readonly deviceId: string;
            readonly deviceLocalSequence: number;
          };
        },
      ];
      expect(tx).toBe(TX);
      // §9.3/§38.16: the trusted context is the ownership; the payload's
      // asserted actorUserId is obsolete claim data.
      expect(source).toEqual({ organizationId: ORG_ID, actorUserId: ACTOR_ID });
      expect(offer).toEqual({
        movementId: 'f6000000-0000-4000-8000-000000000006',
        cause: 'MANUAL_ADJUSTMENT',
        variantId: VARIANT_ID,
        locationId: null,
        quantityDelta: -2n,
        unitCostMinor: null,
        reasonCode: 'DAMAGED',
        reasonNote: null,
        documentRef: null,
      });
      expect(options.originMutation).toEqual({
        mutationId: 'e5000000-0000-4000-8000-000000000005',
        deviceId: DEVICE_ID,
        deviceLocalSequence: 7,
      });

      expect(result).toEqual({
        entityType: 'STOCK_MOVEMENT',
        entityId: 'f6000000-0000-4000-8000-000000000006',
        resultRef: 'f6000000-0000-4000-8000-000000000006',
        resultHash: sha256Hex(
          canonicalJson({
            movementId: 'f6000000-0000-4000-8000-000000000006',
            quantityDelta: '-2',
            resultingQuantity: '19',
          }),
        ),
      });
    });

    it('refuses a payload the canonicalizer will not admit as a permanent VALIDATION_FAILED', async () => {
      const refused = await foldAdjustment({ ...adjustmentPayload(), movementId: 'not-a-uuid' }, foldFake()).catch(
        (error: unknown) => error,
      );

      expect(refused).toBeInstanceOf(MutationRejectedError);
      expect((refused as MutationRejectedError).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('refuses an out-of-vocabulary cause the same way — the ledger edge re-proves the wire rule', async () => {
      // The count document, not the offline applier, is STOCK_COUNT_ADJUSTMENT's
      // only producer (§15.5) — the plain offer vocabulary refuses it here.
      const refused = await foldAdjustment(
        { ...adjustmentPayload(), cause: 'STOCK_COUNT_ADJUSTMENT' },
        foldFake(),
      ).catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(MutationRejectedError);
      expect((refused as MutationRejectedError).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('refuses INSUFFICIENT_STOCK under its own code, recorded — never dropped, never accepted', async () => {
      const fold = jest.fn().mockRejectedValue(new DomainError(ERROR_CODES.INSUFFICIENT_STOCK, 'overdraw'));
      const refused = await foldAdjustment(adjustmentPayload(), fold).catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(MutationRejectedError);
      expect((refused as MutationRejectedError).code).toBe(ERROR_CODES.INSUFFICIENT_STOCK);
    });

    it('propagates a non-business throw so the acceptance transaction rolls back whole', async () => {
      const fold = jest.fn().mockRejectedValue(new Error('the connection died'));
      await expect(foldAdjustment(adjustmentPayload(), fold)).rejects.toEqual(new Error('the connection died'));
    });

    it('refuses a trusted context without a verified actor — UNAUTHENTICATED, fail-closed (§38.16)', async () => {
      const applier = new InventoryMutationApplier(
        { foldMovementInTransaction: foldFake() } as unknown as InventoryService,
        {} as unknown as StockCountService,
      );
      const effect = applier.effectFor(payloadOf({ payload: adjustmentPayload() }), {
        organizationId: ORG_ID,
        deviceId: DEVICE_ID,
      });
      await expect(effect(TX)).rejects.toMatchObject({ code: ERROR_CODES.UNAUTHENTICATED });
    });
  });

  describe('INVENTORY_COUNT:CREATE — the whole document in one acceptance transaction', () => {
    function countHarness() {
      const created = jest.fn().mockResolvedValue({ countId: '60000000-0000-4000-8000-00000000000c' });
      const recorded = jest.fn().mockResolvedValue({ countId: '60000000-0000-4000-8000-00000000000c' });
      const posted = jest.fn().mockResolvedValue({ status: 'APPLIED' });
      const applier = new InventoryMutationApplier(
        {} as unknown as InventoryService,
        {
          createCountInTransaction: created,
          recordCountLineInTransaction: recorded,
          postCountInTransaction: posted,
        } as unknown as StockCountService,
      );
      return { applier, created, recorded, posted };
    }

    function countPayload(): Record<string, unknown> {
      return {
        countId: '60000000-0000-4000-8000-00000000000c',
        locationId: null,
        note: 'جرد فصلي',
        lines: [
          {
            lineId: '77000000-0000-4000-8000-000000000007',
            variantId: VARIANT_ID,
            countedQuantity: '4',
            reasonCode: 'MISCOUNT',
          },
        ],
      };
    }

    it('composes create → record (device line ids) → post, all on the ledger’s own transaction and owner', async () => {
      const { applier, created, recorded, posted } = countHarness();
      const effect = applier.effectFor(
        payloadOf({ aggregateType: 'INVENTORY_COUNT', payload: countPayload() }),
        CONTEXT,
      );
      const result = await effect(TX);

      expect(created).toHaveBeenCalledTimes(1);
      const [creationTx, creationSource, creationOffer] = created.mock.calls[0] as unknown as [
        unknown,
        { organizationId: string; actorUserId: string },
        CreateCountOffer & { countId: string },
      ];
      expect(creationTx).toBe(TX);
      expect(creationSource).toEqual({ organizationId: ORG_ID, actorUserId: ACTOR_ID });
      expect(creationOffer.countId).toBe('60000000-0000-4000-8000-00000000000c');
      expect(creationOffer.note).toBe('جرد فصلي');

      expect(recorded).toHaveBeenCalledTimes(1);
      const [recordTx, recordSource, recordCountId, recordOffer, recordOptions] = recorded.mock.calls[0] as unknown as [
        unknown,
        unknown,
        string,
        RecordCountLineOffer,
        { lineId: string },
      ];
      expect(recordTx).toBe(TX);
      expect(recordSource).toEqual({ organizationId: ORG_ID, actorUserId: ACTOR_ID });
      expect(recordCountId).toBe('60000000-0000-4000-8000-00000000000c');
      expect(recordOffer.countedQuantity).toBe(4n);
      expect(recordOptions.lineId).toBe('77000000-0000-4000-8000-000000000007');

      expect(posted).toHaveBeenCalledTimes(1);
      expect(posted.mock.calls[0][0]).toBe(TX);

      expect(result.entityType).toBe('STOCK_COUNT');
      expect(result.entityId).toBe('60000000-0000-4000-8000-00000000000c');
      expect(result.resultRef).toBe('count:60000000-0000-4000-8000-00000000000c');
    });

    it('answers a permanent VALIDATION_FAILED when the document shell is malformed', async () => {
      const { applier } = countHarness();
      const effect = applier.effectFor(
        payloadOf({ aggregateType: 'INVENTORY_COUNT', payload: { note: 'no identity' } }),
        CONTEXT,
      );
      await expect(effect(TX)).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });

      const noLines = applier.effectFor(
        payloadOf({
          aggregateType: 'INVENTORY_COUNT',
          payload: { countId: '60000000-0000-4000-8000-00000000000c', lines: 'four' },
        }),
        CONTEXT,
      );
      await expect(noLines(TX)).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
    });

    it('refuses a line payload that carries no device line id — the deterministic identity is required', async () => {
      const { applier } = countHarness();
      const payload = countPayload() as { lines: Array<Record<string, unknown>> };
      payload.lines = [{ variantId: VARIANT_ID, countedQuantity: '4' }];
      const effect = applier.effectFor(payloadOf({ aggregateType: 'INVENTORY_COUNT', payload }), CONTEXT);
      await expect(effect(TX)).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
    });

    it('refuses a business lifecycle refusal under its own code — STOCK_COUNT_REASON_REQUIRED (O-14)', async () => {
      const { applier, posted } = countHarness();
      posted.mockRejectedValue(new DomainError(ERROR_CODES.STOCK_COUNT_REASON_REQUIRED, 'unexplained variance'));
      const effect = applier.effectFor(
        payloadOf({ aggregateType: 'INVENTORY_COUNT', payload: countPayload() }),
        CONTEXT,
      );
      await expect(effect(TX)).rejects.toBeInstanceOf(MutationRejectedError);
      // The refusal surfaced under its own stable code, not erased.
      await expect(
        applier.effectFor(payloadOf({ aggregateType: 'INVENTORY_COUNT', payload: countPayload() }), CONTEXT)(TX),
      ).rejects.toMatchObject({ code: ERROR_CODES.STOCK_COUNT_REASON_REQUIRED });
      expect(posted).toHaveBeenCalledTimes(2);
    });

    it('answers UNSUPPORTED_MUTATION for any aggregate this tier does not apply — fail-closed parity (§38.13)', async () => {
      const applier = new InventoryMutationApplier(
        {} as unknown as InventoryService,
        {} as unknown as StockCountService,
      );
      const effect = applier.effectFor(payloadOf({ aggregateType: 'SALE', operationType: 'CREATE' }), CONTEXT);
      await expect(effect(TX)).rejects.toMatchObject({ code: ERROR_CODES.UNSUPPORTED_MUTATION });
    });
  });
});
