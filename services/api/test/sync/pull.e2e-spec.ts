/**
 * Pull endpoint, over HTTP (Master Plan §40.5, M1b-S6; §38.11).
 *
 * §40.5's M1b-S6 key acceptance is the pull boundary: an authenticated read is
 * answered one page of the change feed, and every refusal that happens before the
 * ledger is a well-formed RFC 7807 document. This suite covers the boundary that
 * needs **no database** — the fail-closed default, the cursor grammar and page
 * bounds (§38.11.2), and the "cursor, never offset" rule. The successful feed, its
 * cursor semantics, T-O6 resume, tenant isolation, and the read-only guarantee are
 * proven against **real PostgreSQL** in `test/database/postgres.db-spec.ts`
 * (§36.1 T-2).
 *
 * A successful pull reads `change_log`, which is a database dependency, so — like
 * the push suite — only the pre-ledger boundary is asserted here. §36.2 forbids a
 * mock or in-memory substitute, so the ledger is not stubbed to fake a 200.
 *
 * Every request goes through `createApplication`'s real middleware stack via the
 * harness, so routing, the global validation pipe, the exception filter, and
 * helmet are all in play.
 */

import { TRACE_HEADER } from '../../src/common/logging/trace-id';
import { MAX_PULL_PAGE_SIZE } from '../../src/common/sync/pull/pull.contract';
import { SYNC_AUTHENTICATOR } from '../../src/common/sync/pull/sync-auth';
import type { SyncTrustedContext } from '../../src/common/sync/pull/sync-auth';
import {
  TEST_CONFIG,
  createOverriddenTestHarness,
  createTestHarness,
  destroyTestHarness,
  type TestHarness,
} from '../harness';
import { FixedSyncAuthenticator } from './test-sync-authenticator';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const DEVICE_ID = '22222222-2222-4222-8222-222222222222';
const CONTEXT: SyncTrustedContext = { organizationId: ORGANIZATION_ID, deviceId: DEVICE_ID };

const PULL_PATH = '/api/v1/sync/pull';

describe('GET /api/v1/sync/pull (no database)', () => {
  describe('production default', () => {
    let harness: TestHarness;

    beforeAll(async () => {
      // No override: the module binds the fail-closed authenticator (§38.16).
      harness = await createTestHarness();
    });

    afterAll(async () => {
      await destroyTestHarness(harness);
    });

    it('refuses every pull UNAUTHENTICATED until M2 supplies identity', async () => {
      const response = await harness.http.get(PULL_PATH).expect(401);

      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.body).toMatchObject({ status: 401, code: 'UNAUTHENTICATED', instance: PULL_PATH });
      expect(response.body['traceId']).toBeDefined();
    });

    it('authenticates before validating: a malformed query from an anonymous caller is still 401', async () => {
      // The guard runs before the pipe, so a caller cannot use validation errors
      // to probe the query contract without a credential.
      await harness.http
        .get(PULL_PATH)
        .query({ limit: MAX_PULL_PAGE_SIZE + 1, offset: 1 })
        .expect(401);
    });
  });

  describe('authorized boundary', () => {
    let harness: TestHarness;

    beforeAll(async () => {
      harness = await createOverriddenTestHarness(TEST_CONFIG, (builder) => {
        builder.overrideProvider(SYNC_AUTHENTICATOR).useValue(new FixedSyncAuthenticator(CONTEXT));
      });
    });

    afterAll(async () => {
      await destroyTestHarness(harness);
    });

    it('refuses a malformed cursor with 400 (§38.11.2)', async () => {
      const response = await harness.http.get(PULL_PATH).query({ after: 'not-a-sequence' }).expect(400);

      expect(response.body).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
      expect(String(response.body['instance'])).toContain(PULL_PATH);
    });

    it('refuses a page size above the hard maximum with 400 (§38.11.2)', async () => {
      const response = await harness.http
        .get(PULL_PATH)
        .query({ limit: MAX_PULL_PAGE_SIZE + 1 })
        .expect(400);

      expect(response.body).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    });

    it('refuses a page size below one with 400 (§38.11.2)', async () => {
      const response = await harness.http.get(PULL_PATH).query({ limit: 0 }).expect(400);

      expect(response.body).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    });

    it('refuses an offset-style parameter, so paging stays cursor-based', async () => {
      // §38.11.2: an offset page is not a snapshot. `forbidNonWhitelisted` turns
      // the attempt into a 400 before the handler could honour it.
      const response = await harness.http.get(PULL_PATH).query({ offset: 40 }).expect(400);

      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('refuses a caller-supplied organization, so tenant scope cannot be forged', async () => {
      const response = await harness.http
        .get(PULL_PATH)
        .query({ organizationId: '99999999-9999-4999-8999-999999999999' })
        .expect(400);

      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('names the offending query field in the problem document (§34.3)', async () => {
      const response = await harness.http.get(PULL_PATH).query({ limit: 5000 }).expect(400);

      const errors = response.body['errors'] as { readonly field: string; readonly messages: readonly string[] }[];
      expect(errors.flatMap((error) => error.messages).join(' ')).toContain('limit');
    });

    it('never leaks an internal detail on a refusal (§13.1)', async () => {
      const response = await harness.http.get(PULL_PATH).query({ after: 'x', offset: 1 }).expect(400);
      const serialized = JSON.stringify(response.body);

      expect(serialized).not.toContain('node_modules');
      expect(serialized).not.toContain('.ts:');
      expect(serialized).not.toContain('    at ');
    });

    it('echoes an inbound trace id on a refusal (§38.28.3)', async () => {
      const response = await harness.http
        .get(PULL_PATH)
        .set(TRACE_HEADER, 'trace-pull-1')
        .query({ after: 'x' })
        .expect(400);

      expect(response.headers[TRACE_HEADER]).toBe('trace-pull-1');
    });
  });
});
