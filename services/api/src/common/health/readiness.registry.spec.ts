import { ReadinessRegistry, type ReadinessCheck } from './readiness.registry';

/** A check that always passes. */
const passing: ReadinessCheck = () => Promise.resolve({ ok: true });

/** A check that always fails with a reason. */
const failing =
  (reason: string): ReadinessCheck =>
  () =>
    Promise.resolve({ ok: false, reason });

describe('ReadinessRegistry', () => {
  it('reports ready when no checks are registered', () => {
    // Truthful for a process with no dependencies, which is the state in M1-S2. Not a
    // stub pretending to verify something.
    return expect(new ReadinessRegistry().report()).resolves.toEqual({ ready: true, checks: {} });
  });

  it('reports ready when every check passes', async () => {
    const registry = new ReadinessRegistry();
    registry.register('database', passing);

    await expect(registry.report()).resolves.toEqual({ ready: true, checks: { database: { ok: true } } });
  });

  it('reports not ready when any single check fails', async () => {
    const registry = new ReadinessRegistry();
    registry.register('database', failing('ConnectionError'));
    registry.register('cache', passing);

    await expect(registry.report()).resolves.toEqual({
      ready: false,
      checks: { database: { ok: false, reason: 'ConnectionError' }, cache: { ok: true } },
    });
  });

  it('treats a throwing check as a failed check, not a failed report', async () => {
    // A readiness endpoint that throws instead of answering 503 is useless to a probe.
    const registry = new ReadinessRegistry();
    registry.register('database', () => {
      throw new TypeError('cannot read properties of undefined');
    });

    const report = await registry.report();

    expect(report.ready).toBe(false);
    expect(report.checks['database']).toEqual({ ok: false, reason: 'TypeError' });
  });

  it('treats a rejecting check as a failed check', async () => {
    const registry = new ReadinessRegistry();
    registry.register('database', () => Promise.reject(new RangeError('timeout')));

    await expect(registry.report()).resolves.toEqual({
      ready: false,
      checks: { database: { ok: false, reason: 'RangeError' } },
    });
  });

  it('reports a rejected check by error class only, never by message', async () => {
    // §13.1: an unauthenticated caller must not learn which dependency failed or why.
    // A connection string in an error message is the obvious leak.
    const registry = new ReadinessRegistry();
    registry.register('database', () =>
      Promise.reject(new Error('connect ECONNREFUSED postgres://user:secret@10.0.0.5:5432/myshop')),
    );

    const report = await registry.report();
    const serialized = JSON.stringify(report);

    expect(report.ready).toBe(false);
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('10.0.0.5');
    expect(serialized).toContain('Error');
  });

  it('reports a non-Error rejection without throwing itself', async () => {
    // A library that rejects with a bare string is unusual but real, and a check must
    // not propagate it into the exception handler as an unhandled rejection.
    const registry = new ReadinessRegistry();
    registry.register('database', () => {
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      return Promise.reject('a bare string secret');
    });

    const report = await registry.report();

    expect(report.ready).toBe(false);
    expect(JSON.stringify(report)).not.toContain('secret');
  });

  it('names each check by its registered key', async () => {
    const registry = new ReadinessRegistry();
    registry.register('migration', passing);

    const report = await registry.report();
    expect(Object.keys(report.checks)).toEqual(['migration']);
  });

  it('replaces a check registered twice under the same name', async () => {
    // Last registration wins. Two checks with one name would be reported once, hiding a
    // real difference between them.
    const registry = new ReadinessRegistry();
    registry.register('database', failing('first'));
    registry.register('database', passing);

    await expect(registry.report()).resolves.toEqual({ ready: true, checks: { database: { ok: true } } });
  });

  it('awaits every check rather than short-circuiting on the first failure', async () => {
    // A report that stopped at the first failure would not say which dependencies are
    // down, which is the question an operator actually has.
    const registry = new ReadinessRegistry();
    registry.register('a', failing('down'));
    registry.register('b', failing('down'));
    registry.register('c', passing);

    const report = await registry.report();

    expect(Object.keys(report.checks)).toEqual(['a', 'b', 'c']);
    expect(report.ready).toBe(false);
  });
});
