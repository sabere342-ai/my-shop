/**
 * The mutation ledger service — unit coverage of the §38.9/§38.11 contract.
 *
 * These tests exercise the orchestration (idempotency decision, outcomes,
 * transaction ordering) against an in-memory transaction stand-in. The real
 * behaviour — advisory-lock serialization, atomicity across the four tables,
 * `REPLAY` against durable rows — is proven against real PostgreSQL by
 * `test/database/postgres.db-spec.ts` (§36.1 T-2); this suite exists so the
 * unit project asserts the same contract the database suite does, and pins the
 * classification rules (§38.9.2) as pure logic.
 */

import type { Prisma } from '@prisma/client';
import type { Logger as PinoLogger } from 'pino';
import { ERROR_CODES } from '../../errors/problem';
import { MutationContradictionError, MutationRejectedError } from './mutation-ledger.errors';
import {
  type ApplyMutationRequest,
  type MutationAppliedOutcome,
  type MutationEffectResult,
  type MutationRejectedOutcome,
  type PrismaHost,
  MutationLedgerService,
} from './mutation-ledger.service';

interface StoredLedgerRow {
  organizationId: string;
  mutationId: string;
  deviceId: string;
  receivedAt: Date;
  payloadHash: string;
  resultRef: string | null;
  resultHash: string | null;
  serverSequence: bigint | null;
  status: 'APPLIED' | 'REJECTED';
  rejectionCode: string | null;
}

interface FakeTx {
  readonly tx: Prisma.TransactionClient;
  readonly store: StoredLedgerRow[];
  /** The order in which the service reached each boundary, for ordering proofs. */
  readonly calls: string[];
  /** The sequence counter the inverse of `sync_sequences` gives back. */
  sequence: number;
}

/** An in-memory transaction client that mimics the four-table surface the ledger uses. */
function fakeTransaction(initial: readonly StoredLedgerRow[] = []): FakeTx {
  const store = [...initial];
  let sequence = 0;
  const calls: string[] = [];

  const tx = {
    mutationLedger: {
      // A findUnique that never rejects: the simplest stand-in for the PK
      // lookup. Not async — it has nothing to await — so it must not claim to.
      findUnique: jest.fn(
        (args: { where: { organizationId_mutationId: { organizationId: string; mutationId: string } } }) => {
          const key = args.where.organizationId_mutationId;
          const row = store.find(
            (candidate) => candidate.organizationId === key.organizationId && candidate.mutationId === key.mutationId,
          );
          return Promise.resolve(row ?? null);
        },
      ),
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        const data = args.data;
        const resultRef = data['resultRef'] as string | undefined;
        const resultHash = data['resultHash'] as string | undefined;
        const rejectionCode = data['rejectionCode'] as string | undefined;
        const serverSequence = data['serverSequence'] as bigint | undefined;
        store.push({
          organizationId: data['organizationId'] as string,
          mutationId: data['mutationId'] as string,
          deviceId: data['deviceId'] as string,
          receivedAt: data['receivedAt'] as Date,
          payloadHash: data['payloadHash'] as string,
          resultRef: resultRef ?? null,
          resultHash: resultHash ?? null,
          serverSequence: serverSequence ?? null,
          status: data['status'] as 'APPLIED' | 'REJECTED',
          rejectionCode: rejectionCode ?? null,
        });
        return Promise.resolve(store[store.length - 1]);
      }),
    },
    changeLog: {
      create: jest.fn((args: { data: Record<string, unknown> }) => Promise.resolve(args.data)),
    },
    $queryRaw: jest.fn((strings: TemplateStringsArray) => {
      const sql = strings.join('|').toLowerCase();
      if (sql.includes('sync_sequences')) {
        sequence += 1;
        return Promise.resolve([{ last_sequence: BigInt(sequence) }]);
      }
      return Promise.resolve([]);
    }),
    $executeRaw: jest.fn((strings: TemplateStringsArray) => {
      const sql = strings.join('|').toLowerCase();
      if (sql.includes('device_sync_cursors')) {
        calls.push('cursor-upsert');
      }
      if (sql.includes('pg_advisory_xact_lock')) {
        calls.push('advisory-lock');
      }
      return Promise.resolve(1);
    }),
  };

  return { tx: tx as unknown as Prisma.TransactionClient, store, calls, sequence: 0 };
}

function loggerStub(): PinoLogger & { warn: jest.Mock } {
  const warn = jest.fn();
  return { warn } as unknown as PinoLogger & { warn: jest.Mock };
}

describe('MutationLedgerService', () => {
  const ORGANIZATION_ID = 'organization-1';
  const MUTATION_ID = 'mutation-1';
  const DEVICE_ID = 'device-1';

  function requestOver(
    apply: ApplyMutationRequest['apply'],
    payload: Record<string, unknown> = { sale: { totalMinor: 1000 } },
  ): ApplyMutationRequest {
    return {
      organizationId: ORGANIZATION_ID,
      mutationId: MUTATION_ID,
      deviceId: DEVICE_ID,
      payload,
      apply,
    };
  }

  function appliedEffect(counter: { calls: number }): ApplyMutationRequest['apply'] {
    return (): Promise<MutationEffectResult> => {
      counter.calls += 1;
      return Promise.resolve({
        entityType: 'SALE',
        entityId: 'sale-1',
        resultRef: 'sales/1',
        resultHash: 'result-hash-1',
      });
    };
  }

  it('applies a new mutation once: effect, ledger row, change-log row, cursor, sequence', async () => {
    const tx = fakeTransaction();
    const service = new MutationLedgerService({
      prisma: { $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => fn(tx.tx) },
    } as unknown as PrismaHost);
    const counter = { calls: 0 };

    const outcome = await service.applyMutation(requestOver(appliedEffect(counter)));

    expect(outcome).toMatchObject({
      status: 'APPLIED',
      isReplay: false,
      mutationId: MUTATION_ID,
      serverSequence: BigInt(1),
    });
    expect(counter.calls).toBe(1);
    expect(tx.store).toHaveLength(1);
    expect(tx.store[0]).toMatchObject({
      organizationId: ORGANIZATION_ID,
      mutationId: MUTATION_ID,
      deviceId: DEVICE_ID,
      status: 'APPLIED',
      serverSequence: BigInt(1),
      resultRef: 'sales/1',
      resultHash: 'result-hash-1',
    });
    expect(tx.store[0]?.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tx.tx.mutationLedger.create).toHaveBeenCalledTimes(1);
    expect(tx.tx.changeLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        serverSequence: BigInt(1),
        mutationId: MUTATION_ID,
        entityType: 'SALE',
        entityId: 'sale-1',
      }),
    });

    // §38.9.2 / T-O5: competing requests are serialized before the lookup, and
    // the cursor advance is part of the same transaction. The lock and cursor
    // advance are statements (`$executeRaw`); the counter allocation is a
    // `$queryRaw` reading `last_sequence`.
    expect(tx.calls).toEqual(['advisory-lock', 'cursor-upsert']);
    expect(tx.tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(tx.tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('an identical replay returns the stored response and applies nothing (§38.9.2)', async () => {
    const tx = fakeTransaction();
    const service = new MutationLedgerService({
      prisma: { $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => fn(tx.tx) },
    } as unknown as PrismaHost);
    const counter = { calls: 0 };

    const first = await service.applyMutation(requestOver(appliedEffect(counter)));
    const second = await service.applyMutation(requestOver(appliedEffect(counter)));

    expect(first).toMatchObject({ status: 'APPLIED', isReplay: false, serverSequence: BigInt(1) });
    expect(second).toMatchObject({
      status: 'APPLIED',
      isReplay: true,
      serverSequence: BigInt(1),
      resultRef: 'sales/1',
    });
    expect(second).toMatchObject({ receivedAt: (first as MutationAppliedOutcome).receivedAt });
    expect(counter.calls).toBe(1);
    expect(tx.store).toHaveLength(1);
    expect(tx.tx.mutationLedger.create).toHaveBeenCalledTimes(1);
  });

  it('a different payload under one mutation_id is a contradiction (§38.9.2, F-14)', async () => {
    const tx = fakeTransaction();
    const logger = loggerStub();
    const service = new MutationLedgerService(
      {
        prisma: { $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => fn(tx.tx) },
      } as unknown as PrismaHost,
      logger,
    );
    const counter = { calls: 0 };
    const payloadA = { sale: { totalMinor: 1000 } };
    const payloadB = { sale: { totalMinor: 2000 } };

    await service.applyMutation(requestOver(appliedEffect(counter), payloadA));

    await expect(service.applyMutation(requestOver(appliedEffect(counter), payloadB))).rejects.toBeInstanceOf(
      MutationContradictionError,
    );
    await expect(service.applyMutation(requestOver(appliedEffect(counter), payloadB))).rejects.toMatchObject({
      code: ERROR_CODES.MUTATION_CONTRADICTION,
    });

    // No second effect, no second row: the alarm is the only trace.
    expect(counter.calls).toBe(1);
    expect(tx.store).toHaveLength(1);
    expect(tx.store[0]?.status).toBe('APPLIED');
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn.mock.calls[0]?.[0]).toMatchObject({
      securityEvent: 'sync-rejected-idempotency-contradiction',
      storedPayloadHash: tx.store[0]?.payloadHash,
    });
  });

  it('a rejected mutation is recorded REJECTED with its code — no sequence, feed, or cursor', async () => {
    const tx = fakeTransaction();
    const service = new MutationLedgerService({
      prisma: { $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => fn(tx.tx) },
    } as unknown as PrismaHost);

    const rejected = requestOver((): never => {
      throw new MutationRejectedError(ERROR_CODES.INSUFFICIENT_STOCK);
    });

    const outcome = await service.applyMutation(rejected);

    expect(outcome).toMatchObject({
      status: 'REJECTED',
      isReplay: false,
      mutationId: MUTATION_ID,
      rejectionCode: ERROR_CODES.INSUFFICIENT_STOCK,
    });
    expect(tx.store).toHaveLength(1);
    expect(tx.store[0]).toMatchObject({
      status: 'REJECTED',
      rejectionCode: ERROR_CODES.INSUFFICIENT_STOCK,
      serverSequence: null,
    });
    expect(tx.tx.changeLog.create).not.toHaveBeenCalled();
    // The advisory lock is a statement (`$executeRaw`) and the only one: the
    // counter was never allocated (`$queryRaw` untouched), and no cursor upsert.
    expect(tx.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.calls).toEqual(['advisory-lock']);
    expect(tx.tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('an identical replay of a stored rejection returns the stored rejection (§38.13)', async () => {
    const tx = fakeTransaction();
    const service = new MutationLedgerService({
      prisma: { $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => fn(tx.tx) },
    } as unknown as PrismaHost);

    const rejected = requestOver((): never => {
      throw new MutationRejectedError(ERROR_CODES.INSUFFICIENT_STOCK);
    });

    const first = await service.applyMutation(rejected);
    const second = await service.applyMutation(rejected);

    expect(first).toMatchObject({ status: 'REJECTED', isReplay: false });
    expect(second).toMatchObject({
      status: 'REJECTED',
      isReplay: true,
      rejectionCode: ERROR_CODES.INSUFFICIENT_STOCK,
    });
    expect(second).toMatchObject({ receivedAt: (first as MutationRejectedOutcome).receivedAt });
    expect(tx.store).toHaveLength(1);
    expect(tx.tx.mutationLedger.create).toHaveBeenCalledTimes(1);
  });

  it('a non-rejection effect failure propagates and records nothing', async () => {
    const tx = fakeTransaction();
    const service = new MutationLedgerService({
      prisma: { $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => fn(tx.tx) },
    } as unknown as PrismaHost);

    const request = requestOver((): never => {
      throw new Error('effect exploded');
    });

    await expect(service.applyMutation(request)).rejects.toThrow('effect exploded');
    expect(tx.store).toHaveLength(0);
    expect(tx.tx.mutationLedger.create).not.toHaveBeenCalled();
    expect(tx.tx.changeLog.create).not.toHaveBeenCalled();
  });
});
