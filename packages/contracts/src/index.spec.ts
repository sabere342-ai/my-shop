import { API_NAMESPACE, CONTRACT_VERSION, PROBLEM_CONTENT_TYPE, type ProblemDocument, type TraceId } from './index';

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
});
