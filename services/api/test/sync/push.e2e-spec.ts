/**
 * Push endpoint, over HTTP (Master Plan §40.5, M1b-S5; §38.10).
 *
 * §40.5's M1b-S5 key acceptance is the push boundary: an authenticated batch is
 * answered per mutation, and every refusal that happens before the ledger is a
 * well-formed RFC 7807 document. This suite covers the boundary that needs **no
 * database** — the fail-closed default, identity verification (§38.16), the schema
 * gate (§38.7.2), and ordering (§38.10.2). The APPLIED/REPLAY/REJECTED/CONTRADICTION
 * outcomes and their atomicity are proven against **real PostgreSQL** in
 * `test/database/postgres.db-spec.ts` (§36.1 T-2).
 *
 * Every request goes through `createApplication`'s real middleware stack via the
 * harness, so routing, the global validation pipe, the exception filter, and helmet
 * are all in play.
 */

import { TRACE_HEADER } from '../../src/common/logging/trace-id';
import { MIN_SUPPORTED_LOCAL_SCHEMA_VERSION } from '../../src/common/sync/push/push.contract';
import { SYNC_AUTHENTICATOR } from '../../src/common/sync/push/sync-auth';
import type { SyncTrustedContext } from '../../src/common/sync/push/sync-auth';
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
const BATCH_ID = '55555555-5555-4555-8555-555555555555';
const CONTEXT: SyncTrustedContext = { organizationId: ORGANIZATION_ID, deviceId: DEVICE_ID };

const PUSH_PATH = '/api/v1/sync/push';

function mutation(sequence: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const id = `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
  return {
    mutationId: id,
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
    deviceIdempotencyKey: id,
    ...overrides,
  };
}

function body(mutations: readonly Record<string, unknown>[], overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    deviceId: DEVICE_ID,
    syncBatchId: BATCH_ID,
    localSchemaVersion: MIN_SUPPORTED_LOCAL_SCHEMA_VERSION,
    mutations: [...mutations],
    ...overrides,
  };
}

describe('POST /api/v1/sync/push (no database)', () => {
  describe('production default', () => {
    let harness: TestHarness;

    beforeAll(async () => {
      // No override: the module binds the fail-closed authenticator (§38.16).
      harness = await createTestHarness();
    });

    afterAll(async () => {
      await destroyTestHarness(harness);
    });

    it('refuses every push UNAUTHENTICATED until M2 supplies identity', async () => {
      const response = await harness.http.post(PUSH_PATH).send(body([mutation(1)])).expect(401);

      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.body).toMatchObject({ status: 401, code: 'UNAUTHENTICATED', instance: PUSH_PATH });
      expect(response.body['traceId']).toBeDefined();
    });

    it('authenticates before validating: a malformed body from an anonymous caller is still 401', async () => {
      // The guard runs before the pipe, so a caller cannot use validation errors to
      // learn the body contract without a credential.
      await harness.http.post(PUSH_PATH).send({ nonsense: true }).expect(401);
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

    it('refuses a client below the minimum schema version with 426 CLIENT_TOO_OLD (§38.7.2)', async () => {
      const response = await harness.http
        .post(PUSH_PATH)
        .send(body([mutation(1)], { localSchemaVersion: 0 }))
        .expect(426);

      expect(response.body).toMatchObject({ status: 426, code: 'CLIENT_TOO_OLD' });
    });

    it('refuses a batch that asserts another device with 403 (§38.16)', async () => {
      const response = await harness.http
        .post(PUSH_PATH)
        .send(body([mutation(1)], { deviceId: '99999999-9999-4999-8999-999999999999' }))
        .expect(403);

      expect(response.body).toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('refuses a mutation that asserts another organization with 403 (§38.16, §9.3)', async () => {
      const response = await harness.http
        .post(PUSH_PATH)
        .send(body([mutation(1, { organizationId: '99999999-9999-4999-8999-999999999999' })]))
        .expect(403);

      expect(response.body).toMatchObject({ code: 'ORGANIZATION_FORBIDDEN' });
    });

    it('refuses a duplicate mutation_id with 400 (§38.10.2)', async () => {
      const duplicate = mutation(1);
      const response = await harness.http.post(PUSH_PATH).send(body([duplicate, { ...duplicate }])).expect(400);

      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('refuses a non-ascending device_local_sequence with 400 (§38.10.2)', async () => {
      const response = await harness.http.post(PUSH_PATH).send(body([mutation(2), mutation(1)])).expect(400);

      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('refuses a batch beyond 50 mutations with 400 (§38.10.1)', async () => {
      const tooMany = Array.from({ length: 51 }, (_value, index) => mutation(index + 1));
      const response = await harness.http.post(PUSH_PATH).send(body(tooMany)).expect(400);

      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('refuses a missing envelope field with 400 and field detail', async () => {
      const withoutDevice: Record<string, unknown> = body([mutation(1)]);
      delete withoutDevice['deviceId'];

      const response = await harness.http.post(PUSH_PATH).send(withoutDevice).expect(400);

      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      // §34.3: the problem document carries field-level detail. The global pipe emits
      // validator messages per field, so the missing property is named in the messages.
      const errors = response.body['errors'] as { readonly field: string; readonly messages: readonly string[] }[];
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.flatMap((error) => error.messages).join(' ')).toContain('deviceId');
    });

    it('never leaks an internal detail on a refusal (§13.1)', async () => {
      const response = await harness.http.post(PUSH_PATH).send(body([mutation(3), mutation(2)])).expect(400);
      const serialized = JSON.stringify(response.body);

      expect(serialized).not.toContain('node_modules');
      expect(serialized).not.toContain('.ts:');
      expect(serialized).not.toContain('    at ');
    });

    it('echoes an inbound trace id on a refusal (§38.28.3)', async () => {
      const response = await harness.http
        .post(PUSH_PATH)
        .set(TRACE_HEADER, 'trace-push-1')
        .send(body([mutation(3), mutation(2)]))
        .expect(400);

      expect(response.headers[TRACE_HEADER]).toBe('trace-push-1');
    });
  });
});
