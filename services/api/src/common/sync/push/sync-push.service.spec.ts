/**
 * Push service tests (Master Plan §40.5, M1b-S5; §38.10).
 *
 * The service is the thin layer between the HTTP boundary and the M1b-S4 ledger:
 * it owns the schema gate (§38.7.2), identity verification (§38.16), ordering
 * (§38.10.2), and the per-mutation outcome mapping (§38.10.3). The ledger is
 * substituted with a recording double here because its own contract is proven
 * against real PostgreSQL in `postgres.db-spec.ts`; these tests assert what this
 * layer alone decides.
 */

import type { Logger as PinoLogger } from 'pino';
import { DomainError } from '../../errors/domain.error';
import { ERROR_CODES } from '../../errors/problem';
import { MutationContradictionError } from '../ledger/mutation-ledger.errors';
import type { MutationLedgerService } from '../ledger/mutation-ledger.service';
import { type MutationAppliedOutcome, type MutationOutcome } from '../ledger/mutation-ledger.service';
import type { MutationPayload } from '../sync.contract';
import { MIN_SUPPORTED_LOCAL_SCHEMA_VERSION, type PushBatchRequest } from './push.contract';
import type { SyncMutationApplier, SyncMutationEffect } from './sync-mutation-applier';
import { SyncPushService, mutationFingerprint } from './sync-push.service';
import type { SyncTrustedContext } from './sync-auth';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const DEVICE_ID = '22222222-2222-4222-8222-222222222222';
const BATCH_ID = '55555555-5555-4555-8555-555555555555';

const CONTEXT: SyncTrustedContext = { organizationId: ORGANIZATION_ID, deviceId: DEVICE_ID };

function mutation(sequence: number, overrides: Partial<MutationPayload> = {}): MutationPayload {
  return {
    mutationId: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    organizationId: ORGANIZATION_ID,
    deviceId: DEVICE_ID,
    actorUserId: '33333333-3333-4333-8333-333333333333',
    actorRoleSnapshot: { permissions: ['sales.create'] },
    aggregateType: 'SALE',
    aggregateId: '44444444-4444-4444-8444-444444444444',
    operationType: 'CREATE',
    payload: { saleNo: `S-${String(sequence)}` },
    payloadVersion: 1,
    deviceLocalSequence: sequence,
    localCreatedAt: '2026-01-01T00:00:00.000Z',
    deviceIdempotencyKey: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    ...overrides,
  };
}

function request(mutations: readonly MutationPayload[]): PushBatchRequest {
  return {
    deviceId: DEVICE_ID,
    syncBatchId: BATCH_ID,
    localSchemaVersion: MIN_SUPPORTED_LOCAL_SCHEMA_VERSION,
    mutations: [...mutations],
  };
}

function applied(mutationId: string, isReplay: boolean, sequence: bigint): MutationAppliedOutcome {
  return {
    status: 'APPLIED',
    isReplay,
    mutationId,
    resultRef: `sales/${mutationId}`,
    resultHash: 'a'.repeat(64),
    serverSequence: sequence,
    receivedAt: new Date('2026-01-02T03:04:05.000Z'),
  };
}

/** A ledger double that records each `applyMutation` request and answers a scripted outcome. */
function ledgerDouble(answers: readonly (MutationOutcome | Error)[]): {
  ledger: MutationLedgerService;
  calls: { organizationId: string; deviceId: string; mutationId: string; payload: Record<string, unknown> }[];
} {
  const calls: { organizationId: string; deviceId: string; mutationId: string; payload: Record<string, unknown> }[] =
    [];
  let index = 0;
  const applyMutation = (input: {
    organizationId: string;
    deviceId: string;
    mutationId: string;
    payload: Record<string, unknown>;
  }): Promise<MutationOutcome> => {
    calls.push({
      organizationId: input.organizationId,
      deviceId: input.deviceId,
      mutationId: input.mutationId,
      payload: input.payload,
    });
    const answer = answers[index] ?? answers[answers.length - 1];
    index += 1;
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve(answer as MutationOutcome);
  };
  return { ledger: { applyMutation } as unknown as MutationLedgerService, calls };
}

/** An applier that never actually applies; the ledger double decides the outcome. */
const inertApplier: SyncMutationApplier = {
  effectFor: (): SyncMutationEffect => () => Promise.reject(new Error('the applier must not run in this test')),
};

function serviceWith(ledger: MutationLedgerService, logger?: PinoLogger): SyncPushService {
  return new SyncPushService(ledger, inertApplier, logger);
}

describe('SyncPushService', () => {
  describe('schema gate (§38.7.2, F-15)', () => {
    it('refuses the whole request CLIENT_TOO_OLD before any mutation is applied', async () => {
      const { ledger, calls } = ledgerDouble([]);
      const service = serviceWith(ledger);

      const tooOld = { ...request([mutation(1)]), localSchemaVersion: 0 };
      await expect(service.pushBatch(tooOld, CONTEXT)).rejects.toMatchObject({
        code: ERROR_CODES.CLIENT_TOO_OLD,
      });
      expect(calls).toEqual([]);
    });
  });

  describe('identity verification (§38.16, §9.3)', () => {
    it('refuses a batch that asserts another device', async () => {
      const { ledger, calls } = ledgerDouble([]);
      const service = serviceWith(ledger);

      await expect(
        service.pushBatch({ ...request([mutation(1)]), deviceId: '99999999-9999-4999-8999-999999999999' }, CONTEXT),
      ).rejects.toMatchObject({ code: ERROR_CODES.PERMISSION_DENIED });
      expect(calls).toEqual([]);
    });

    it('refuses a mutation that asserts another organization', async () => {
      const { ledger, calls } = ledgerDouble([]);
      const service = serviceWith(ledger);

      const foreign = mutation(1, { organizationId: '99999999-9999-4999-8999-999999999999' });
      await expect(service.pushBatch(request([foreign]), CONTEXT)).rejects.toMatchObject({
        code: ERROR_CODES.ORGANIZATION_FORBIDDEN,
      });
      expect(calls).toEqual([]);
    });

    it('refuses a mutation that asserts another device', async () => {
      const { ledger, calls } = ledgerDouble([]);
      const service = serviceWith(ledger);

      const foreign = mutation(1, { deviceId: '99999999-9999-4999-8999-999999999999' });
      await expect(service.pushBatch(request([foreign]), CONTEXT)).rejects.toMatchObject({
        code: ERROR_CODES.PERMISSION_DENIED,
      });
      expect(calls).toEqual([]);
    });

    it('scopes the ledger call to the authenticated context, never the body', async () => {
      const { ledger, calls } = ledgerDouble([applied(mutation(1).mutationId, false, 1n)]);
      const service = serviceWith(ledger);

      await service.pushBatch(request([mutation(1)]), CONTEXT);

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ organizationId: ORGANIZATION_ID, deviceId: DEVICE_ID });
    });
  });

  describe('ordering (§38.10.2)', () => {
    it('refuses a duplicate mutation_id', async () => {
      const { ledger, calls } = ledgerDouble([]);
      const service = serviceWith(ledger);

      const duplicated = mutation(1);
      await expect(service.pushBatch(request([duplicated, { ...duplicated }]), CONTEXT)).rejects.toMatchObject({
        code: ERROR_CODES.VALIDATION_FAILED,
      });
      expect(calls).toEqual([]);
    });

    it('refuses a device_local_sequence that is not strictly ascending', async () => {
      const { ledger, calls } = ledgerDouble([]);
      const service = serviceWith(ledger);

      await expect(service.pushBatch(request([mutation(2), mutation(1)]), CONTEXT)).rejects.toMatchObject({
        code: ERROR_CODES.VALIDATION_FAILED,
      });
      expect(calls).toEqual([]);
    });

    it('refuses an equal device_local_sequence', async () => {
      const { ledger } = ledgerDouble([]);
      const service = serviceWith(ledger);

      const second = mutation(1, {
        mutationId: '00000000-0000-4000-8000-000000000099',
        deviceIdempotencyKey: '00000000-0000-4000-8000-000000000099',
      });
      await expect(service.pushBatch(request([mutation(1), second]), CONTEXT)).rejects.toBeInstanceOf(DomainError);
    });
  });

  describe('per-mutation outcomes (§38.9.2, §38.10.3)', () => {
    it('maps a first sight to APPLIED with the decimal server sequence', async () => {
      const { ledger } = ledgerDouble([applied(mutation(1).mutationId, false, 42n)]);
      const service = serviceWith(ledger);

      const response = await service.pushBatch(request([mutation(1)]), CONTEXT);

      expect(response.syncBatchId).toBe(BATCH_ID);
      expect(response.outcomes).toEqual([
        {
          mutationId: mutation(1).mutationId,
          status: 'APPLIED',
          resultRef: `sales/${mutation(1).mutationId}`,
          resultHash: 'a'.repeat(64),
          serverSequence: '42',
          receivedAt: '2026-01-02T03:04:05.000Z',
        },
      ]);
    });

    it('maps a stored replay to REPLAY', async () => {
      const { ledger } = ledgerDouble([applied(mutation(1).mutationId, true, 42n)]);
      const service = serviceWith(ledger);

      const response = await service.pushBatch(request([mutation(1)]), CONTEXT);

      expect(response.outcomes[0]).toMatchObject({ status: 'REPLAY', serverSequence: '42' });
    });

    it('maps a stored rejection to REJECTED with its code and no sequence', async () => {
      const { ledger } = ledgerDouble([
        {
          status: 'REJECTED',
          isReplay: false,
          mutationId: mutation(1).mutationId,
          rejectionCode: ERROR_CODES.INSUFFICIENT_STOCK,
          receivedAt: new Date('2026-01-02T03:04:05.000Z'),
        },
      ]);
      const service = serviceWith(ledger);

      const response = await service.pushBatch(request([mutation(1)]), CONTEXT);

      expect(response.outcomes[0]).toEqual({
        mutationId: mutation(1).mutationId,
        status: 'REJECTED',
        rejectionCode: ERROR_CODES.INSUFFICIENT_STOCK,
        receivedAt: '2026-01-02T03:04:05.000Z',
      });
    });

    it('answers a contradiction per mutation and keeps the batch going', async () => {
      const first = mutation(1);
      const second = mutation(2);
      const { ledger, calls } = ledgerDouble([
        new MutationContradictionError(ORGANIZATION_ID, first.mutationId, 'stored', 'incoming'),
        applied(second.mutationId, false, 7n),
      ]);
      const service = serviceWith(ledger);

      const response = await service.pushBatch(request([first, second]), CONTEXT);

      expect(calls).toHaveLength(2);
      expect(response.outcomes).toEqual([
        expect.objectContaining({
          mutationId: first.mutationId,
          status: 'CONTRADICTION',
          rejectionCode: ERROR_CODES.MUTATION_CONTRADICTION,
        }),
        expect.objectContaining({ mutationId: second.mutationId, status: 'APPLIED' }),
      ]);
    });

    it('processes a partial batch: a rejection does not block the sale behind it', async () => {
      const first = mutation(1);
      const second = mutation(2);
      const { ledger, calls } = ledgerDouble([
        {
          status: 'REJECTED',
          isReplay: false,
          mutationId: first.mutationId,
          rejectionCode: ERROR_CODES.UNSUPPORTED_MUTATION,
          receivedAt: new Date('2026-01-02T03:04:05.000Z'),
        },
        applied(second.mutationId, false, 9n),
      ]);
      const service = serviceWith(ledger);

      const response = await service.pushBatch(request([first, second]), CONTEXT);

      expect(calls).toHaveLength(2);
      expect(response.outcomes.map((outcome) => outcome.status)).toEqual(['REJECTED', 'APPLIED']);
    });

    it('propagates an unexpected server fault instead of mislabelling it a rejection (§38.10.4)', async () => {
      const { ledger } = ledgerDouble([new Error('connection reset')]);
      const service = serviceWith(ledger);

      await expect(service.pushBatch(request([mutation(1)]), CONTEXT)).rejects.toThrow('connection reset');
    });

    it('preserves request order in the outcome list', async () => {
      const first = mutation(1);
      const second = mutation(2);
      const third = mutation(3);
      const { ledger } = ledgerDouble([
        applied(first.mutationId, false, 1n),
        applied(second.mutationId, false, 2n),
        applied(third.mutationId, false, 3n),
      ]);
      const service = serviceWith(ledger);

      const response = await service.pushBatch(request([first, second, third]), CONTEXT);

      expect(response.outcomes.map((outcome) => outcome.mutationId)).toEqual([
        first.mutationId,
        second.mutationId,
        third.mutationId,
      ]);
    });
  });

  describe('payload fingerprint (F-14)', () => {
    it('hashes the complete immutable mutation, not a subset', async () => {
      const { ledger, calls } = ledgerDouble([applied(mutation(1).mutationId, false, 1n)]);
      const service = serviceWith(ledger);

      await service.pushBatch(request([mutation(1)]), CONTEXT);

      expect(calls[0]?.payload).toEqual(mutationFingerprint(mutation(1)));
      expect(Object.keys(mutationFingerprint(mutation(1)))).toHaveLength(13);
    });

    it('distinguishes two identities that differ only in one field', () => {
      const base = mutation(1);
      const changed = { ...base, payload: { saleNo: 'S-different' } };
      expect(mutationFingerprint(base)).not.toEqual(mutationFingerprint(changed));
    });
  });
});
