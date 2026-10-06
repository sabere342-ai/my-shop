import { TRACE_HEADER, isAcceptableTraceId, resolveTraceId } from './trace-id';

describe('isAcceptableTraceId', () => {
  it('accepts an opaque identifier with safe characters', () => {
    expect(isAcceptableTraceId('01JB8Q2W7XK9V4M6N3P5R0T2YD')).toBe(true);
    expect(isAcceptableTraceId('trace.with:separators-and_underscores')).toBe(true);
  });

  it('rejects anything containing whitespace or a quote', () => {
    // These values would be unsafe echoed into a JSON body or a log line.
    expect(isAcceptableTraceId('has space')).toBe(false);
    expect(isAcceptableTraceId('has"quote')).toBe(false);
    expect(isAcceptableTraceId('has\ttab')).toBe(false);
    expect(isAcceptableTraceId('has\nnewline')).toBe(false);
  });

  it('rejects an over-long value', () => {
    expect(isAcceptableTraceId('a'.repeat(65))).toBe(false);
    expect(isAcceptableTraceId('a'.repeat(64))).toBe(true);
  });

  it('rejects a non-string', () => {
    expect(isAcceptableTraceId(undefined)).toBe(false);
    expect(isAcceptableTraceId(null)).toBe(false);
    expect(isAcceptableTraceId(42)).toBe(false);
    expect(isAcceptableTraceId(['array'])).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isAcceptableTraceId('')).toBe(false);
  });
});

describe('resolveTraceId', () => {
  it('returns the inbound value when it is acceptable', () => {
    expect(resolveTraceId('trace-from-device')).toBe('trace-from-device');
  });

  it('replaces an unacceptable inbound value with a fresh uuid', () => {
    // Replacing rather than rejecting: a request-logging header must not be a way to
    // make requests fail.
    const resolved = resolveTraceId('not safe"value');
    expect(resolved).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('replaces a missing value with a fresh uuid', () => {
    expect(resolveTraceId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns a different uuid each time, so concurrent requests stay distinguishable', () => {
    // §36.1 T-6: no test may depend on execution order; more practically, two in-flight
    // requests must not share a correlation id.
    expect(resolveTraceId(undefined)).not.toBe(resolveTraceId(undefined));
  });

  it('exports the header name clients and devices set', () => {
    expect(TRACE_HEADER).toBe('x-trace-id');
  });
});
