/**
 * Push contract tests (Master Plan §40.5, M1b-S5; §38.10).
 *
 * The contract's load-bearing parts are the envelope bounds, the per-mutation status
 * vocabulary, and the minimum schema version. Each is pinned here as a literal so a
 * change to what the client compiles against is a deliberate edit, not a drift; the
 * shape reaches the HTTP layer through the same `class-validator` metadata the global
 * pipe runs, so validation is asserted by running it rather than by reading metadata.
 */

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  MAX_PUSH_BATCH_SIZE,
  MIN_PUSH_BATCH_SIZE,
  MIN_SUPPORTED_LOCAL_SCHEMA_VERSION,
  PUSH_MUTATION_STATUSES,
  PushBatchRequest,
  SYNC_PUSH_PATH,
} from './push.contract';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const DEVICE_ID = '22222222-2222-4222-8222-222222222222';
const BATCH_ID = '55555555-5555-4555-8555-555555555555';

/** One §38.8.1 valid mutation; `sequence` fills the ordering field. */
function mutation(sequence: number): Record<string, unknown> {
  return {
    mutationId: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    organizationId: ORGANIZATION_ID,
    deviceId: DEVICE_ID,
    actorUserId: '33333333-3333-4333-8333-333333333333',
    actorRoleSnapshot: { permissions: ['sales.create'] },
    aggregateType: 'SALE',
    aggregateId: '44444444-4444-4444-8444-444444444444',
    operationType: 'CREATE',
    payload: { saleNo: 'S-1' },
    payloadVersion: 1,
    deviceLocalSequence: sequence,
    localCreatedAt: '2026-01-01T00:00:00.000Z',
    deviceIdempotencyKey: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
  };
}

function body(mutations: readonly Record<string, unknown>[]): Record<string, unknown> {
  return {
    deviceId: DEVICE_ID,
    syncBatchId: BATCH_ID,
    localSchemaVersion: MIN_SUPPORTED_LOCAL_SCHEMA_VERSION,
    mutations,
  };
}

function validate(input: Record<string, unknown>): readonly string[] {
  const instance = plainToInstance(PushBatchRequest, input);
  return validateSync(instance, { whitelist: true, forbidNonWhitelisted: true }).map((error) => error.property);
}

describe('push contract', () => {
  it('pins the §38.10.1 batch bounds and the §38.7.2 minimum schema version', () => {
    expect(MIN_PUSH_BATCH_SIZE).toBe(1);
    expect(MAX_PUSH_BATCH_SIZE).toBe(50);
    expect(MIN_SUPPORTED_LOCAL_SCHEMA_VERSION).toBe(1);
    expect(SYNC_PUSH_PATH).toBe('api/v1/sync/push');
  });

  it('closes the §38.9.2 acknowledgement vocabulary', () => {
    // A fifth status would be a contract change; the client branches on these four.
    expect([...PUSH_MUTATION_STATUSES]).toEqual(['APPLIED', 'REPLAY', 'REJECTED', 'CONTRADICTION']);
  });

  it('accepts a well-formed single-mutation batch', () => {
    expect(validate(body([mutation(1)]))).toEqual([]);
  });

  it('accepts a well-formed batch at the maximum size', () => {
    const full = Array.from({ length: MAX_PUSH_BATCH_SIZE }, (_value, index) => mutation(index + 1));
    expect(validate(body(full))).toEqual([]);
  });

  it('refuses an empty batch (§38.10.1: 1–50)', () => {
    expect(validate(body([]))).toContain('mutations');
  });

  it('refuses a batch beyond the maximum (§38.10.1)', () => {
    const tooMany = Array.from({ length: MAX_PUSH_BATCH_SIZE + 1 }, (_value, index) => mutation(index + 1));
    expect(validate(body(tooMany))).toContain('mutations');
  });

  it('refuses a non-uuid envelope identity', () => {
    expect(validate({ ...body([mutation(1)]), deviceId: 'not-a-uuid' })).toContain('deviceId');
    expect(validate({ ...body([mutation(1)]), syncBatchId: 'not-a-uuid' })).toContain('syncBatchId');
  });

  it('accepts a below-minimum schema version so the service can refuse it CLIENT_TOO_OLD (§38.7.2)', () => {
    // §38.7.2: an outdated client must receive the domain refusal (426 CLIENT_TOO_OLD),
    // not a generic shape error, so the envelope lets the value through and the service
    // owns the floor. A negative or fractional version is still a malformed field.
    expect(validate({ ...body([mutation(1)]), localSchemaVersion: 0 })).toEqual([]);
  });

  it('refuses a non-integer or negative schema version', () => {
    expect(validate({ ...body([mutation(1)]), localSchemaVersion: 1.5 })).toContain('localSchemaVersion');
    expect(validate({ ...body([mutation(1)]), localSchemaVersion: -1 })).toContain('localSchemaVersion');
  });

  it('forbids a caller-supplied envelope field outside the contract', () => {
    // §9.3 / §34.2: `forbidNonWhitelisted` turns a smuggled property into a 400 rather
    // than letting it reach a service. `organizationId` is not part of the envelope.
    expect(validate({ ...body([mutation(1)]), organizationId: ORGANIZATION_ID })).toContain('organizationId');
  });

  it('validates each nested mutation, not only the envelope', () => {
    const broken = { ...mutation(1), operationType: 'DROP' };
    expect(validate(body([broken]))).toContain('mutations');
  });
});
