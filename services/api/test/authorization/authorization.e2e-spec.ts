/**
 * Integration acceptance for the authorization HTTP boundary (Master Plan §40.6
 * M2-S3; §9.3, §11).
 *
 * Like the identity boundary suite, this one deliberately exercises only the part
 * of the surface that needs **no database**: the strict bearer parser, the
 * fail-closed access-token port, and the ordering property that the guards run
 * before request validation and before any service. CI runs this project (Stage 6)
 * *before* the database acceptance suite (Stage 7) migrates anything, so every flow
 * that reaches PostgreSQL lives in `test/database/postgres.db-spec.ts` instead.
 *
 * Two boots make the properties visible:
 *
 * - With **no key material** the access-token port fails closed: a well-formed
 *   bearer credential is answered `503`, while a missing bearer is refused `401`
 *   by the parser before the signer is consulted. The snapshot route cannot be
 *   reached without authentication, so it inherits the same fail-closed answer.
 * - With **key material configured** a garbage token is `401 UNAUTHENTICATED`, and
 *   a guarded route still answers `401` for a body the validation pipe would reject
 *   — proof the guard is the first thing that runs (§9.3: no tenant or permission
 *   decision is taken for an unauthenticated caller).
 *
 * The suite never prints a token or a snapshot (`test-setup.base.ts` refuses
 * credential-shaped output), so it asserts on codes and statuses only.
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

/** An organization id that no test token can be a member of. */
const ABSENT_ORGANIZATION = '00000000-0000-0000-0000-000000000000';
const ABSENT_ROLE = '00000000-0000-0000-0000-000000000000';

describe('authorization routes over HTTP', () => {
  describe('with no identity key material (fail-closed)', () => {
    it('answers 401 for a missing or non-bearer Authorization header on every route', async () => {
      await withHarness(TEST_CONFIG, async (harness) => {
        const me = await harness.http.get(`/api/v1/organizations/${ABSENT_ORGANIZATION}/authorization/me`).expect(401);
        expect(me.body.code).toBe('UNAUTHENTICATED');

        const wrongScheme = await harness.http
          .get(`/api/v1/organizations/${ABSENT_ORGANIZATION}/roles`)
          .set('Authorization', 'Basic abc')
          .expect(401);
        expect(wrongScheme.body.code).toBe('UNAUTHENTICATED');
      });
    });

    it('answers 503 for a well-formed bearer credential while the surface fails closed', async () => {
      await withHarness(TEST_CONFIG, async (harness) => {
        const me = await harness.http
          .get(`/api/v1/organizations/${ABSENT_ORGANIZATION}/authorization/me`)
          .set('Authorization', 'Bearer aaa.bbb.ccc')
          .expect(503);
        expect(me.body.code).toBe('SERVICE_UNAVAILABLE');

        // The snapshot route is behind the same guard: an unauthenticated caller
        // never reaches the mint, so it is the access-token port that refuses.
        const snapshot = await harness.http
          .post(`/api/v1/organizations/${ABSENT_ORGANIZATION}/authorization/snapshot`)
          .set('Authorization', 'Bearer aaa.bbb.ccc')
          .expect(503);
        expect(snapshot.body.code).toBe('SERVICE_UNAVAILABLE');
      });
    });

    it('answers 404 for an unknown authorization route — there is no route without authentication either', async () => {
      await withHarness(TEST_CONFIG, async (harness) => {
        await harness.http.get(`/api/v1/organizations/${ABSENT_ORGANIZATION}/authorization/does-not-exist`).expect(404);
      });
    });
  });

  describe('with identity key material configured', () => {
    it('refuses a garbage bearer token with 401 UNAUTHENTICATED on a guarded route', async () => {
      await withHarness(configuredConfig(), async (harness) => {
        const response = await harness.http
          .get(`/api/v1/organizations/${ABSENT_ORGANIZATION}/roles`)
          .set('Authorization', 'Bearer aaa.bbb.ccc')
          .expect(401);
        expect(response.body.code).toBe('UNAUTHENTICATED');
      });
    });

    it('refuses before request validation: a malformed body is 401, not 400, without a principal', async () => {
      // §9.3: the guard runs before the validation pipe, so an unauthenticated
      // caller learns nothing about the body's shape and no tenant or permission
      // decision is taken. The 400 for a malformed body is asserted in the
      // database acceptance suite, where a real token exists.
      await withHarness(configuredConfig(), async (harness) => {
        const response = await harness.http
          .put(`/api/v1/organizations/${ABSENT_ORGANIZATION}/roles/${ABSENT_ROLE}/permissions`)
          .set('Authorization', 'Bearer aaa.bbb.ccc')
          .send({ permissions: 'not-an-array' })
          .expect(401);
        expect(response.body.code).toBe('UNAUTHENTICATED');
      });
    });

    it('still answers 401 for a missing header — the parser refuses before the signer is consulted', async () => {
      await withHarness(configuredConfig(), async (harness) => {
        const response = await harness.http
          .post(`/api/v1/organizations/${ABSENT_ORGANIZATION}/authorization/snapshot`)
          .expect(401);
        expect(response.body.code).toBe('UNAUTHENTICATED');
      });
    });
  });
});
