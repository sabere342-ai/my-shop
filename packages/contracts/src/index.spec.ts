import { API_NAMESPACE, CONTRACT_VERSION, PROBLEM_CONTENT_TYPE, type TraceId } from './index';

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
});
