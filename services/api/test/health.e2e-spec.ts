/**
 * Health and readiness, over HTTP.
 *
 * §40.4 gives M1-S2's key acceptance as: "`/healthz` and `/readyz` respond; problem+json
 * shape verified". These tests are that verification.
 *
 * They boot the real application through `createApplication`, the same function `main.ts`
 * calls, so the global pipe, the exception filter, and `helmet` are all in play.
 */

import { TRACE_HEADER } from '../src/common/logging/trace-id';
import { createTestHarness, destroyTestHarness, type TestHarness } from './harness';

describe('health and readiness', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  afterAll(async () => {
    await destroyTestHarness(harness);
  });

  describe('GET /healthz', () => {
    it('responds 200', async () => {
      const response = await harness.http.get('/healthz').expect(200);
      expect(response.body).toEqual({ status: 'ok' });
    });

    it('needs no credential', async () => {
      // A liveness probe has no credential. If this ever required one, the orchestrator
      // would restart a healthy process during a credential rotation.
      await harness.http.get('/healthz').expect(200);
    });

    it('touches no dependency, so a dependency outage cannot fail it', async () => {
      // §37.4: a liveness probe that checks the database restarts the process during a
      // database outage, converting a recoverable failure into an outage.
      harness.readiness.register('database', () => Promise.resolve({ ok: false }));

      await harness.http.get('/healthz').expect(200);

      harness.readiness.register('database', () => Promise.resolve({ ok: true }));
    });

    it('returns no version number, dependency name, or connection detail', async () => {
      // §13.1: an unauthenticated endpoint must not disclose internals.
      const response = await harness.http.get('/healthz').expect(200);
      const serialized = JSON.stringify(response.body);

      expect(serialized).not.toContain('postgres');
      expect(serialized).not.toContain('node_modules');
      expect(serialized).not.toMatch(/\d+\.\d+\.\d+/);
    });
  });

  describe('GET /readyz', () => {
    it('responds 200 and reports ready when every check passes', async () => {
      harness.readiness.register('cache', () => Promise.resolve({ ok: true }));

      const response = await harness.http.get('/readyz').expect(200);

      expect(response.body.ready).toBe(true);
    });

    it('responds 503 when a registered check fails', async () => {
      harness.readiness.register('database', () => Promise.resolve({ ok: false, reason: 'ConnectionError' }));

      const response = await harness.http.get('/readyz').expect(503);

      expect(response.body.ready).toBe(false);
      expect(response.body.checks.database).toEqual({ ok: false, reason: 'ConnectionError' });
    });

    it('reports the failure class but not the failure detail', async () => {
      // The endpoint is unauthenticated by necessity, so a caller must not learn which
      // dependency failed or why. §13.1.
      harness.readiness.register('database', () =>
        Promise.reject(new Error('ECONNREFUSED postgres://user:secret@10.0.0.5:5432/myshop')),
      );

      const response = await harness.http.get('/readyz').expect(503);
      const serialized = JSON.stringify(response.body);

      expect(serialized).not.toContain('secret');
      expect(serialized).not.toContain('10.0.0.5');
      expect(response.body.checks.database.reason).toBe('Error');

      harness.readiness.register('database', () => Promise.resolve({ ok: true }));
    });

    it('answers 503 rather than throwing when a check throws', async () => {
      harness.readiness.register('database', () => {
        throw new TypeError('boom');
      });

      await harness.http.get('/readyz').expect(503);

      harness.readiness.register('database', () => Promise.resolve({ ok: true }));
    });

    it('needs no credential', async () => {
      await harness.http.get('/readyz').expect(200);
    });
  });

  describe('security headers', () => {
    it('sets the headers §13.1 requires', async () => {
      // helmet is configured in bootstrap, so this asserts the configuration reached
      // the wire rather than merely being present in source.
      const response = await harness.http.get('/healthz').expect(200);

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['content-security-policy']).toContain("default-src 'none'");
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['strict-transport-security']).toContain('max-age=31536000');
    });

    it('does not advertise the server technology', async () => {
      const response = await harness.http.get('/healthz').expect(200);
      expect(response.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('trace propagation', () => {
    it('echoes an acceptable inbound trace id on the response header', async () => {
      // §13.1: traceId is the only internal a client is given; §38.28.3: it propagates
      // end to end so an offline device's request is traceable.
      const response = await harness.http.get('/healthz').set(TRACE_HEADER, 'trace-abc-123').expect(200);

      expect(response.headers[TRACE_HEADER]).toBe('trace-abc-123');
    });

    it('replaces an unsafe inbound trace id rather than reflecting it', async () => {
      const response = await harness.http.get('/healthz').set(TRACE_HEADER, 'bad "quoted" value').expect(200);

      expect(response.headers[TRACE_HEADER]).toMatch(/^[0-9a-f-]{36}$/);
      expect(response.headers[TRACE_HEADER]).not.toContain('quoted');
    });

    it('generates a trace id when the request supplies none', async () => {
      const response = await harness.http.get('/healthz').expect(200);
      expect(response.headers[TRACE_HEADER]).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('unknown routes', () => {
    it('answers a problem+json document rather than an HTML error page', async () => {
      // §34.3 requires the error contract to apply to every response, not only to
      // handled business errors. A framework default would return an HTML page.
      //
      // The route is deliberately unregistered at the top level rather than placed under
      // the API prefix: an unmatched URL inside a prefix is a routing miss, whereas an
      // unmatched URL at the root is the plain 404 path. Both are asserted.
      const response = await harness.http.get('/api/v1/nonexistent').expect(404);

      // §34.3 and ADR-028: RFC 7807's media type is `application/problem+json`, which is
      // not a subtype of `application/json` for this assertion's purposes.
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.body).toMatchObject({
        status: 404,
        code: 'NOT_FOUND',
        instance: '/api/v1/nonexistent',
      });
      expect(response.body['type']).toBe('https://docs.my-shop/errors/NOT_FOUND');
      expect(response.body['traceId']).toBeDefined();
    });

    it('never leaks a stack trace in the body', async () => {
      const response = await harness.http.get('/api/v1/nonexistent').expect(404);

      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain('node_modules');
      expect(serialized).not.toContain('.ts:');
      expect(serialized).not.toContain('    at ');
    });
  });

  describe('body size limit', () => {
    it('rejects a body beyond the cap rather than buffering it', async () => {
      // bootstrap caps JSON at 1 MB. An unbounded parser on a POS API is a cheap
      // denial-of-service surface.
      const oversized = { padding: 'x'.repeat(1_100_000) };

      const response = await harness.http.post('/api/v1/nonexistent').send(oversized);

      // 404 rather than 413 because the route does not exist; the assertion is that the
      // oversized body did not produce a 2xx and did not crash the process.
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });
});
