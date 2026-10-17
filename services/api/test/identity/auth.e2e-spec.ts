/**
 * Integration acceptance for the authentication HTTP boundary (Master Plan §40.6
 * M2-S2; §10.1, §10.3, §34.3).
 *
 * This suite deliberately exercises only the part of the surface that needs **no
 * database**: request validation, the strict bearer parser, and the fail-closed
 * access-token port. That boundary is where a malformed request and an unauthenticated
 * caller are answered, and CI runs this project (Stage 6) *before* the database
 * acceptance suite (Stage 7) migrates anything — so a dashboard-dependent case here
 * would be a case that cannot run. Every flow that reaches PostgreSQL lives in
 * `test/database/postgres.db-spec.ts`, where the database is guaranteed.
 *
 * Two boots make the fail-closed property visible: with no key material configured
 * (the default test configuration) a bearer request is answered `503`, and with a
 * configured key pair a garbage token is answered `401`. A deployment cannot reach
 * the first state (`checkIdentityConfig` requires the key pair in production), but the
 * suite proves the state is fail-closed rather than permissive.
 */

import { generateKeyPairSync } from 'node:crypto';

import { loadConfig, type AppConfigShape } from '../../src/common/config/app.config';
import { createTestHarness, destroyTestHarness, TEST_CONFIG, type TestHarness } from '../harness';

/** Base64 of PEM text, exactly how the environment carries key material (§13.6). */
function encodedPem(pem: string): string {
  return Buffer.from(pem, 'utf8').toString('base64');
}

function configuredConfig(): AppConfigShape {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    LOG_PRETTY: 'false',
    JWT_PRIVATE_KEY: encodedPem(privateKey),
    JWT_PUBLIC_KEY: encodedPem(publicKey),
  });
}

/** One boot per key-material state, shared across the cases that need it. */
async function withHarness(config: AppConfigShape, body: (harness: TestHarness) => Promise<void>): Promise<void> {
  const harness = await createTestHarness(config);
  try {
    await body(harness);
  } finally {
    await destroyTestHarness(harness);
  }
}

describe('auth routes over HTTP', () => {
  describe('with no identity key material (fail-closed)', () => {
    it('refuses malformed request bodies with VALIDATION_FAILED before any service runs', async () => {
      await withHarness(TEST_CONFIG, async (harness) => {
        const cases = [
          ['/api/v1/auth/login', {}],
          ['/api/v1/auth/login', { email: 'owner@example.com' }],
          ['/api/v1/auth/login', { email: 'owner@example.com', password: 'a'.repeat(1025) }],
          ['/api/v1/auth/refresh', {}],
          ['/api/v1/auth/logout', {}],
        ] as const;

        for (const [path, body] of cases) {
          const response = await harness.http.post(path).send(body).expect(400);
          expect(response.body.code).toBe('VALIDATION_FAILED');
          expect(response.body.instance).toBe(path);
          expect(response.headers['content-type']).toContain('application/problem+json');
        }
      });
    });

    it('answers 401 for a missing or non-bearer Authorization header on /me', async () => {
      await withHarness(TEST_CONFIG, async (harness) => {
        const missing = await harness.http.get('/api/v1/auth/me').expect(401);
        expect(missing.body.code).toBe('UNAUTHENTICATED');

        const wrongScheme = await harness.http.get('/api/v1/auth/me').set('Authorization', 'Basic abc').expect(401);
        expect(wrongScheme.body.code).toBe('UNAUTHENTICATED');
      });
    });

    it('answers 503 for a well-formed bearer credential while the surface fails closed', async () => {
      await withHarness(TEST_CONFIG, async (harness) => {
        const response = await harness.http
          .get('/api/v1/auth/me')
          .set('Authorization', 'Bearer aaa.bbb.ccc')
          .expect(503);

        expect(response.body.code).toBe('SERVICE_UNAVAILABLE');
      });
    });

    it('answers 404 for the provisioning routes — provisioning is not an API (§39.2)', async () => {
      await withHarness(TEST_CONFIG, async (harness) => {
        await harness.http.post('/api/v1/auth/provision').send({}).expect(404);
        await harness.http.post('/api/v1/auth/credential').send({}).expect(404);
      });
    });
  });

  describe('with identity key material configured', () => {
    it('refuses a garbage bearer token with 401 UNAUTHENTICATED', async () => {
      await withHarness(configuredConfig(), async (harness) => {
        const response = await harness.http
          .get('/api/v1/auth/me')
          .set('Authorization', 'Bearer aaa.bbb.ccc')
          .expect(401);

        expect(response.body.code).toBe('UNAUTHENTICATED');
      });
    });

    it('still answers 401 for a missing header — the parser refuses before the signer is consulted', async () => {
      await withHarness(configuredConfig(), async (harness) => {
        const response = await harness.http.get('/api/v1/auth/me').expect(401);
        expect(response.body.code).toBe('UNAUTHENTICATED');
      });
    });
  });
});
