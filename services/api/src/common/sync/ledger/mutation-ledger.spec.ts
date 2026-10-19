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
    // The §32.2A audit surface the ledger touches on the same transaction: the
    // retry counter read (§38.13 replay of a stored rejection) and, should a
    // spec ever wire the real writer, the row insert. Counting runs against a
    // small in-memory store so `attemptNumber` tests stay observable.
    auditEvent: (() => {
      const auditRows: Record<string, unknown>[] = [];
      const matches = (row: Record<string, unknown>, where: Record<string, unknown>): boolean =>
        Object.entries(where).every(([field, value]) => row[field] === value);
      return {
        store: auditRows,
        count: jest.fn((args: { where: Record<string, unknown> }) =>
          Promise.resolve(auditRows.filter((row) => matches(row, args.where)).length),
        ),
        create: jest.fn((args: { data: Record<string, unknown> }) => {
          auditRows.push(args.data);
          return Promise.resolve(args.data);
        }),
      };
    })(),
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
  const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
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

    // The trusted transaction context (`set_config`, M2-S4) and the §38.11.1
    // counter allocation are `$queryRaw`; the advisory lock and the cursor
    // advance are statements (`$executeRaw`).
    expect(tx.calls).toEqual(['advisory-lock', 'cursor-upsert']);
    expect(tx.tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(tx.tx.$queryRaw).toHaveBeenCalledTimes(2);
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
    // counter was never allocated, and no cursor upsert. The one `$queryRaw`
    // call is the trusted tenant context establishment (M2-S4).
    expect(tx.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.calls).toEqual(['advisory-lock']);
    expect(tx.tx.$queryRaw).toHaveBeenCalledTimes(1);
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

/**
 * The §9.4 ingress re-validation hook (Master Plan §40.6, M2-S4).
 *
 * The real re-validator's authorization rules are proven by the authorization
 * suites and the RLS acceptance suite; this suite pins the **contract the
 * ledger owes the hook**: it runs inside the ledger's transaction, after the
 * idempotency lookup and before the effect (`§9.4` order); a
 * `MutationRejectedError` becomes the durable §38.13 rejection row; a replay is
 * answered from the stored record without a second authorization; and any
 * other error propagates as the server fault it is.
 */
describe('MutationLedgerService ingress re-validation hook (M2-S4)', () => {
  const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
  const MUTATION_ID = '33333333-3333-4333-8333-333333333333';
  const DEVICE_ID = '22222222-2222-4222-8222-222222222222';

  interface Captured {
    readonly calls: string[];
    rejected: MutationRejectedError | null;
  }

  function requestWith(
    reconcile: { readonly calls: string[]; rejected: MutationRejectedError | null },
    effect: ApplyMutationRequest['apply'],
  ): ApplyMutationRequest {
    return {
      organizationId: ORGANIZATION_ID,
      mutationId: MUTATION_ID,
      deviceId: DEVICE_ID,
      payload: { sale: { totalMinor: 1000 } },
      apply: async (tx: Prisma.TransactionClient) => {
        reconcile.calls.push('effect');
        return effect(tx);
      },
      validateIngress: (tx: Prisma.TransactionClient) => {
        reconcile.calls.push('ingress');
        if (reconcile.rejected !== null) throw reconcile.rejected;
        void tx;
        return Promise.resolve();
      },
    };
  }

  function credited(): ApplyMutationRequest['apply'] {
    return () =>
      Promise.resolve({
        entityType: 'SALE',
        entityId: 'sale-1',
        resultRef: 'sales/1',
        resultHash: 'result-hash-1',
      });
  }

  it('runs the re-validation after the idempotency lookup and before the effect (§9.4 order)', async () => {
    const state: Captured = { calls: [], rejected: null };
    const tx = fakeTransaction();
    const service = new MutationLedgerService({
      prisma: { $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => fn(tx.tx) },
    } as unknown as PrismaHost);

    const outcome = await service.applyMutation(requestWith(state, credited()));

    expect(outcome).toMatchObject({ status: 'APPLIED', isReplay: false });
    expect(state.calls).toEqual(['ingress', 'effect']);
  });

  it('a rejected re-validation is a recorded per-mutation rejection with no effect (§38.13)', async () => {
    const refusal = new MutationRejectedError(ERROR_CODES.ORGANIZATION_FORBIDDEN);
    const state: Captured = { calls: [], rejected: refusal };
    const tx = fakeTransaction();
    const service = new MutationLedgerService({
      prisma: { $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => fn(tx.tx) },
    } as unknown as PrismaHost);

    const outcome = await service.applyMutation(requestWith(state, credited()));

    expect(outcome).toMatchObject({
      status: 'REJECTED',
      isReplay: false,
      rejectionCode: ERROR_CODES.ORGANIZATION_FORBIDDEN,
    });
    expect(state.calls).toEqual(['ingress']);
    expect(tx.store).toHaveLength(1);
    expect(tx.store[0]).toMatchObject({ status: 'REJECTED', rejectionCode: ERROR_CODES.ORGANIZATION_FORBIDDEN });
    // No sequence, no feed row, no cursor — the §38.13 invariants hold for the
    // admission path exactly as they do for the effect path.
    expect(tx.tx.changeLog.create).not.toHaveBeenCalled();
    expect(tx.calls).toEqual(['advisory-lock']);
  });

  it('a replay answers from the stored record without calling the hook again', async () => {
    const refusal = new MutationRejectedError(ERROR_CODES.PERMISSION_DENIED);
    const state: Captured = { calls: [], rejected: refusal };
    const tx = fakeTransaction();
    const service = new MutationLedgerService({
      prisma: { $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => fn(tx.tx) },
    } as unknown as PrismaHost);
    const request = requestWith(state, credited());

    const first = await service.applyMutation(request);
    state.rejected = null; // even an actor who since recovered is replay-answered
    const second = await service.applyMutation(request);

    expect(first).toMatchObject({ status: 'REJECTED', rejectionCode: ERROR_CODES.PERMISSION_DENIED });
    expect(second).toMatchObject({ status: 'REJECTED', isReplay: true });
    expect(second).toMatchObject({ receivedAt: (first as MutationRejectedOutcome).receivedAt });
    expect(state.calls).toEqual(['ingress']);
    expect(tx.store).toHaveLength(1);
  });

  it('a non-rejection re-validation failure propagates as a server fault and records nothing', async () => {
    const tx = fakeTransaction();
    const service = new MutationLedgerService({
      prisma: { $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => fn(tx.tx) },
    } as unknown as PrismaHost);
    const request = {
      ...requestWith({ calls: [], rejected: null }, credited()),
      validateIngress: (): Promise<void> => Promise.reject(new Error('resolver exploded')),
    };

    await expect(service.applyMutation(request)).rejects.toThrow('resolver exploded');
    expect(tx.store).toHaveLength(0);
    expect(tx.tx.mutationLedger.create).not.toHaveBeenCalled();
  });

  it('the hook receives the ledger’s transaction client', async () => {
    const state: Captured = { calls: [], rejected: null };
    let seen: Prisma.TransactionClient | null = null;
    const tx = fakeTransaction();
    const service = new MutationLedgerService({
      prisma: { $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => fn(tx.tx) },
    } as unknown as PrismaHost);
    const request = requestWith(state, credited());
    const effect = request.apply;
    const instrumented = {
      ...request,
      validateIngress: (provided: Prisma.TransactionClient): Promise<void> => {
        seen = provided;
        state.calls.push('ingress');
        return Promise.resolve();
      },
      // Effect and hook run in one transaction; the effect asserts they saw the
      // same client, so the re-validation read and the effect cannot disagree
      // about server state (§9.4).
      apply: async (provided: Prisma.TransactionClient) => {
        expect(provided).toBe(seen);
        return effect(provided);
      },
    };

    await service.applyMutation(instrumented);
  });
});

/**
 * The change-feed read (§38.11.1, §38.11.2).
 *
 * `pullChanges` is the one ledger method that reads rather than writes, and it is
 * the whole server half of M1b-S6. Its correctness is the cursor semantics — a
 * strict lower bound, ascending, one row beyond the page to make `hasMore` a fact
 * — plus the two properties that keep the read honest: it re-baselines rather
 * than serving a partial feed from a stale cursor, and it never advances a stored
 * cursor. The real SQL behaviour is proven against PostgreSQL in
 * `test/database/postgres.db-spec.ts`; this suite pins the classification and the
 * cursor arithmetic as pure logic.
 */
describe('MutationLedgerService change feed (M1b-S6)', () => {
  const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';

  interface FeedRow {
    readonly serverSequence: bigint;
    readonly entityType: string;
    readonly entityId: string;
    readonly mutationId: string | null;
    readonly changedAt: Date;
  }

  function feedRow(sequence: bigint, mutationId: string | null = null): FeedRow {
    return {
      serverSequence: sequence,
      entityType: 'SALE',
      entityId: `sale-${String(sequence)}`,
      mutationId,
      changedAt: new Date('2026-01-02T03:04:05.000Z'),
    };
  }

  /**
   * A host that answers the two reads the feed performs: the retention-floor
   * `$queryRaw`, and an interactive `changeLog.findMany` that faithfully filters,
   * orders, and takes — so the page mapping above it is exercised, not stubbed.
   * The write surface is present but must stay untouched (T-O6).
   *
   * M2-S4: the read runs inside the trusted tenant transaction, so the host
   * also fulfils `withTenantTransaction` — `$transaction` runs synchronously
   * over the same client, and the first `$queryRaw` call it receives is the
   * `set_config` context establishment.
   */
  function feedHost(
    rows: readonly FeedRow[],
    agedOutMax: bigint | null,
  ): {
    host: PrismaHost;
    findMany: jest.Mock;
    queryRaw: jest.Mock;
    cursorWrite: jest.Mock;
  } {
    const findMany = jest.fn(
      (args: {
        where: { organizationId: string; serverSequence: { gt: bigint } };
        orderBy: { serverSequence: 'asc' };
        take: number;
      }) => {
        const after = args.where.serverSequence.gt;
        const page = [...rows]
          .filter((row) => row.serverSequence > after)
          .sort((left, right) => (left.serverSequence < right.serverSequence ? -1 : 1))
          .slice(0, args.take);
        return Promise.resolve(page);
      },
    );
    const queryRaw = jest.fn((strings: TemplateStringsArray) => {
      if (strings.join('|').includes('set_config')) return Promise.resolve([]);
      return Promise.resolve([{ max_aged_out: agedOutMax }]);
    });
    const cursorWrite = jest.fn(() => Promise.resolve(1));
    const tenantClient = {
      changeLog: { findMany },
      $queryRaw: queryRaw,
    };
    const host = {
      prisma: {
        changeLog: { findMany },
        $queryRaw: queryRaw,
        $executeRaw: cursorWrite,
        deviceSyncCursor: { upsert: cursorWrite },
        $transaction: jest.fn((run: (tx: unknown) => Promise<unknown>) => run(tenantClient)),
      },
    } as unknown as PrismaHost;
    return { host, findMany, queryRaw, cursorWrite };
  }

  it('establishes the trusted tenant context as the transaction’s first statement (§8.2, M2-S4)', async () => {
    const { host, queryRaw } = feedHost([feedRow(1n)], null);
    const service = new MutationLedgerService(host);

    await service.pullChanges({ organizationId: ORGANIZATION_ID, after: 0n, limit: 200, retentionDays: 90 });

    const firstStatement = (queryRaw.mock.calls[0]?.[0] as TemplateStringsArray).join('|');
    expect(firstStatement).toContain('set_config');
  });

  it('returns an empty page from the beginning when nothing is retained', async () => {
    const { host } = feedHost([], null);
    const service = new MutationLedgerService(host);

    const page = await service.pullChanges({
      organizationId: ORGANIZATION_ID,
      after: 0n,
      limit: 200,
      retentionDays: 90,
    });

    expect(page).toEqual({
      changes: [],
      nextAfter: 0n,
      hasMore: false,
      rebaselineRequired: false,
      retentionFloor: null,
    });
  });

  it('returns changes strictly after the cursor, ascending, with the last as nextAfter', async () => {
    const { host, findMany } = feedHost([feedRow(1n), feedRow(2n), feedRow(3n)], null);
    const service = new MutationLedgerService(host);

    const page = await service.pullChanges({
      organizationId: ORGANIZATION_ID,
      after: 1n,
      limit: 200,
      retentionDays: 90,
    });

    expect(page.changes.map((change) => change.serverSequence)).toEqual([2n, 3n]);
    expect(page.nextAfter).toBe(3n);
    expect(page.hasMore).toBe(false);
    expect(page.rebaselineRequired).toBe(false);
    // The exclusive lower bound and the tenant scope reach the query as facts.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORGANIZATION_ID, serverSequence: { gt: 1n } },
        orderBy: { serverSequence: 'asc' },
      }),
    );
  });

  it('fetches one row beyond the page so hasMore is a fact and truncates the reply', async () => {
    const rows = [feedRow(1n), feedRow(2n), feedRow(3n), feedRow(4n)];
    const { host, findMany } = feedHost(rows, null);
    const service = new MutationLedgerService(host);

    const page = await service.pullChanges({
      organizationId: ORGANIZATION_ID,
      after: 0n,
      limit: 2,
      retentionDays: 90,
    });

    expect(page.changes.map((change) => change.serverSequence)).toEqual([1n, 2n]);
    expect(page.hasMore).toBe(true);
    expect(page.nextAfter).toBe(2n);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 3 }));
  });

  it('carries the mutation id only when the change came from a device', async () => {
    const deviceMutation = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const { host } = feedHost([feedRow(1n, deviceMutation), feedRow(2n, null)], null);
    const service = new MutationLedgerService(host);

    const page = await service.pullChanges({
      organizationId: ORGANIZATION_ID,
      after: 0n,
      limit: 200,
      retentionDays: 90,
    });

    expect(page.changes[0]?.mutationId).toBe(deviceMutation);
    expect(page.changes[1]?.mutationId).toBeNull();
  });

  it('re-baselines instead of serving a partial feed when the cursor is older than the floor', async () => {
    // 500 aged out ⇒ the first retained sequence is 501.
    const { host, findMany } = feedHost([feedRow(501n)], 500n);
    const service = new MutationLedgerService(host);

    const page = await service.pullChanges({
      organizationId: ORGANIZATION_ID,
      after: 10n,
      limit: 200,
      retentionDays: 90,
    });

    expect(page).toEqual({
      changes: [],
      nextAfter: 10n,
      hasMore: false,
      rebaselineRequired: true,
      retentionFloor: 501n,
    });
    // A stale cursor is never served a partial feed: the page query must not run.
    expect(findMany).not.toHaveBeenCalled();
  });

  it('does not re-baseline once the cursor reaches the floor', async () => {
    const { host } = feedHost([feedRow(502n)], 500n);
    const service = new MutationLedgerService(host);

    const page = await service.pullChanges({
      organizationId: ORGANIZATION_ID,
      after: 501n,
      limit: 200,
      retentionDays: 90,
    });

    expect(page.rebaselineRequired).toBe(false);
    expect(page.retentionFloor).toBe(501n);
    expect(page.changes.map((change) => change.serverSequence)).toEqual([502n]);
  });

  it('treats a null aged-out maximum as "nothing has aged out"', async () => {
    const { host, queryRaw } = feedHost([feedRow(1n)], null);
    const service = new MutationLedgerService(host);

    const page = await service.pullChanges({
      organizationId: ORGANIZATION_ID,
      after: 0n,
      limit: 200,
      retentionDays: 90,
    });

    expect(page.retentionFloor).toBeNull();
    // Two raw statements inside the tenant transaction: the `set_config`
    // context establishment (M2-S4), then the §38.11.1 floor probe.
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it('normalizes a decimal-string aged-out maximum to a bigint floor', async () => {
    const { host } = feedHost([feedRow(1n)], null);
    // node-postgres may deliver int8 as a decimal string; the floor must still be
    // a bigint, so the boundary comparison is exact rather than floating-point.
    (host.prisma.$queryRaw as jest.Mock).mockResolvedValue([{ max_aged_out: '9007199254740992' }]);
    const service = new MutationLedgerService(host);

    const page = await service.pullChanges({
      organizationId: ORGANIZATION_ID,
      after: 0n,
      limit: 200,
      retentionDays: 90,
    });

    expect(page.retentionFloor).toBe(9007199254740993n);
    expect(page.rebaselineRequired).toBe(true);
  });

  it("never advances a stored cursor — the read is the client's resume point (T-O6)", async () => {
    const { host, cursorWrite } = feedHost([feedRow(1n), feedRow(2n)], null);
    const service = new MutationLedgerService(host);

    await service.pullChanges({ organizationId: ORGANIZATION_ID, after: 0n, limit: 200, retentionDays: 90 });

    // §38.11.2: the client stores the cursor only after the page is applied
    // locally, so the server cannot advance it on a read.
    expect(cursorWrite).not.toHaveBeenCalled();
  });
});
