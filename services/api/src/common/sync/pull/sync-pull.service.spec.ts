/**
 * Pull service tests (Master Plan §40.5, M1b-S6; §38.11).
 *
 * The service turns one authenticated read into one page of the change feed and
 * is deliberately thin: the §38.11.1 feed, the retention boundary, and the
 * cursor arithmetic belong to the M1b-S4 ledger, which this suite replaces with
 * a recording double. What lives here — and is asserted here — is the transport
 * mapping the ledger does not own: the default cursor and page size, the
 * bigint-to-decimal-string wire conversion, the tenant scope read from the
 * authenticated context, and the re-baseline advisory.
 */

import type { Logger as PinoLogger } from 'pino';
import type { MutationLedgerService, PullChangesRequest, PullPage } from '../ledger/mutation-ledger.service';
import { DEFAULT_PULL_PAGE_SIZE, PULL_RETENTION_DAYS } from './pull.contract';
import type { SyncTrustedContext } from './sync-auth';
import { SyncPullService } from './sync-pull.service';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const DEVICE_ID = '22222222-2222-4222-8222-222222222222';
const CONTEXT: SyncTrustedContext = { organizationId: ORGANIZATION_ID, deviceId: DEVICE_ID };

/** A ledger double that records each `pullChanges` request and answers a scripted page. */
function ledgerDouble(page: PullPage): { ledger: MutationLedgerService; calls: PullChangesRequest[] } {
  const calls: PullChangesRequest[] = [];
  const ledger = {
    pullChanges: (request: PullChangesRequest): Promise<PullPage> => {
      calls.push(request);
      return Promise.resolve(page);
    },
  } as unknown as MutationLedgerService;
  return { ledger, calls };
}

function loggerStub(): PinoLogger & { warn: jest.Mock } {
  const warn = jest.fn();
  return { warn } as unknown as PinoLogger & { warn: jest.Mock };
}

describe('SyncPullService', () => {
  describe('cursor and page-size defaults (§38.11.2)', () => {
    it('reads from the beginning at the default page size when the query is empty', async () => {
      const emptyPage: PullPage = {
        changes: [],
        nextAfter: 0n,
        hasMore: false,
        rebaselineRequired: false,
        retentionFloor: null,
      };
      const { ledger, calls } = ledgerDouble(emptyPage);
      const service = new SyncPullService(ledger);

      await service.pullChanges({}, CONTEXT);

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        organizationId: ORGANIZATION_ID,
        after: 0n,
        limit: DEFAULT_PULL_PAGE_SIZE,
        retentionDays: PULL_RETENTION_DAYS,
      });
    });

    it('passes an explicit cursor and page size through unchanged', async () => {
      const { ledger, calls } = ledgerDouble({
        changes: [],
        nextAfter: 41n,
        hasMore: false,
        rebaselineRequired: false,
        retentionFloor: null,
      });
      const service = new SyncPullService(ledger);

      await service.pullChanges({ after: '41', limit: 25 }, CONTEXT);

      expect(calls[0]).toMatchObject({ after: 41n, limit: 25 });
    });
  });

  describe('tenant scope (§38.16, §9.3)', () => {
    it('scopes the ledger read to the authenticated organization, never the query', async () => {
      const { ledger, calls } = ledgerDouble({
        changes: [],
        nextAfter: 0n,
        hasMore: false,
        rebaselineRequired: false,
        retentionFloor: null,
      });
      const service = new SyncPullService(ledger);

      // The query carries no organization field at all; the context is the only
      // source of tenant identity.
      await service.pullChanges({}, CONTEXT);

      expect(calls[0]?.organizationId).toBe(ORGANIZATION_ID);
    });
  });

  describe('wire mapping (§38.11.2)', () => {
    it('carries sequences as decimal strings and instants as ISO-8601', async () => {
      const { ledger } = ledgerDouble({
        changes: [
          {
            serverSequence: 9007199254740993n,
            entityType: 'SALE',
            entityId: 'sale-1',
            mutationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            changedAt: new Date('2026-02-03T04:05:06.789Z'),
          },
        ],
        nextAfter: 9007199254740993n,
        hasMore: true,
        rebaselineRequired: false,
        retentionFloor: null,
      });
      const service = new SyncPullService(ledger);

      const response = await service.pullChanges({}, CONTEXT);

      expect(response).toEqual({
        changes: [
          {
            serverSequence: '9007199254740993',
            entityType: 'SALE',
            entityId: 'sale-1',
            mutationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            changedAt: '2026-02-03T04:05:06.789Z',
          },
        ],
        nextAfter: '9007199254740993',
        hasMore: true,
        rebaselineRequired: false,
      });
    });

    it('omits mutationId for a server-originated change', async () => {
      const { ledger } = ledgerDouble({
        changes: [
          {
            serverSequence: 1n,
            entityType: 'SALE',
            entityId: 'sale-1',
            mutationId: null,
            changedAt: new Date('2026-02-03T04:05:06.789Z'),
          },
        ],
        nextAfter: 1n,
        hasMore: false,
        rebaselineRequired: false,
        retentionFloor: null,
      });
      const service = new SyncPullService(ledger);

      const response = await service.pullChanges({}, CONTEXT);

      expect(response.changes[0]).not.toHaveProperty('mutationId');
    });

    it('returns the request cursor as nextAfter when the page is empty', async () => {
      const { ledger } = ledgerDouble({
        changes: [],
        nextAfter: 42n,
        hasMore: false,
        rebaselineRequired: false,
        retentionFloor: null,
      });
      const service = new SyncPullService(ledger);

      const response = await service.pullChanges({ after: '42' }, CONTEXT);

      expect(response).toEqual({ changes: [], nextAfter: '42', hasMore: false, rebaselineRequired: false });
    });
  });

  describe('retention re-baseline (§38.11.1, O-21)', () => {
    it('surfaces rebaselineRequired with the floor and logs an advisory', async () => {
      const logger = loggerStub();
      const { ledger } = ledgerDouble({
        changes: [],
        nextAfter: 10n,
        hasMore: false,
        rebaselineRequired: true,
        retentionFloor: 500n,
      });
      const service = new SyncPullService(ledger, logger);

      const response = await service.pullChanges({ after: '10' }, CONTEXT);

      expect(response).toEqual({
        changes: [],
        nextAfter: '10',
        hasMore: false,
        rebaselineRequired: true,
        retentionFloor: '500',
      });
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0]?.[0]).toMatchObject({
        component: 'sync-pull',
        organizationId: ORGANIZATION_ID,
        deviceId: DEVICE_ID,
        after: '10',
        retentionFloor: '500',
      });
    });

    it('omits the floor when no re-baseline is required', async () => {
      const { ledger } = ledgerDouble({
        changes: [],
        nextAfter: 7n,
        hasMore: false,
        rebaselineRequired: false,
        retentionFloor: 3n,
      });
      const service = new SyncPullService(ledger);

      const response = await service.pullChanges({}, CONTEXT);

      expect(response).not.toHaveProperty('retentionFloor');
      expect(response.rebaselineRequired).toBe(false);
    });
  });
});
