import {
  API_NAMESPACE,
  CONTRACT_VERSION,
  PROBLEM_CONTENT_TYPE,
  type MutationId,
  type MutationPayload,
  type ProblemDocument,
  type SyncState,
  type TraceId,
} from './index';

describe('contract constants', () => {
  it('serves the REST namespace under /api/v1', () => {
    // Master Plan §34.1, ADR-027: a breaking change requires v2.
    expect(API_NAMESPACE).toBe('/api/v1');
  });

  it('returns errors as RFC 7807 problem documents', () => {
    // Master Plan §34.3, ADR-028.
    expect(PROBLEM_CONTENT_TYPE).toBe('application/problem+json');
  });

  it('exposes a contract version for drift detection', () => {
    // Master Plan §7.1 G-7: contract drift fails CI.
    expect(CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('types a trace id as an opaque string', () => {
    // Master Plan §13.1: production errors carry a traceId only, never internals.
    const traceId: TraceId = '01JB8Q2W7XK9V4M6N3P5R0T2YD';
    expect(typeof traceId).toBe('string');
  });

  it('exposes a generated contract type the backend would accept', () => {
    // Master Plan §7.1 G-7 / ADR-001: the generated type is the compile-time
    // contract. This assignment proves `ProblemDocument` compiles to the shape
    // the backend decorators declare (its non-`errors` members are required).
    const problem: ProblemDocument = {
      type: 'https://docs.my-shop/errors/INSUFFICIENT_STOCK',
      title: 'Insufficient stock',
      status: 409,
      code: 'INSUFFICIENT_STOCK',
      detail: 'Not enough stock is available.',
      instance: '/api/v1/sales',
      traceId: '01JB8Q2W7XK9V4M6N3P5R0T2YD',
    };
    expect(problem.code).toBe('INSUFFICIENT_STOCK');
  });

  it('exposes the generated sync contract types', () => {
    // §40.5 M1b-S2: the mutation payload schema, `mutation_id`, and the sync
    // state enum are generated from the backend, so a client cannot compile
    // against a shape the server does not publish.
    const mutation: MutationPayload = {
      mutationId: '0192f0c1-8f0e-7e00-9b3e-6a1f0d2c4a10',
      organizationId: '0192f0c1-8f0e-7e00-9b3e-6a1f0d2c4a11',
      deviceId: '0192f0c1-8f0e-7e00-9b3e-6a1f0d2c4a12',
      actorUserId: '0192f0c1-8f0e-7e00-9b3e-6a1f0d2c4a13',
      actorRoleSnapshot: { permissions: ['sales.create'] },
      aggregateType: 'SALE',
      aggregateId: '0192f0c1-8f0e-7e00-9b3e-6a1f0d2c4a14',
      operationType: 'CREATE',
      payload: { saleId: '0192f0c1-8f0e-7e00-9b3e-6a1f0d2c4a15' },
      payloadVersion: 1,
      deviceLocalSequence: 42,
      localCreatedAt: '2026-10-07T12:00:00.000Z',
      deviceIdempotencyKey: '0192f0c1-8f0e-7e00-9b3e-6a1f0d2c4a10',
    };

    // §38.8.1: the idempotency key is the mutation_id duplicated verbatim.
    const id: MutationId = mutation.deviceIdempotencyKey;
    const state: SyncState = 'PENDING';
    expect(id).toBe(mutation.mutationId);
    expect(state).toBe('PENDING');
  });

  it('bumps the contract version for the sync surface', () => {
    // §40.5 M1b-S2 adds named types to this package — a contract-surface change,
    // so the version a client checks against moves with it.
    expect(CONTRACT_VERSION).toBe('0.3.0');
  });
});
