/**
 * Integration acceptance for the inventory HTTP boundary (Master Plan §15.4–
 * §15.6A, §17; §40.8 M4-S2; §34.1).
 *
 * This suite exercises only the part of the surface that needs **no database**,
 * exactly as the catalog boundary suite does: the guard order (§9.3
 * authentication before validation before any permission decision), and the
 * fail-closed posture when the authorization graph cannot verify anything.
 * Every database-backed flow — the conditional guard, the movement identity's
 * idempotency, the RLS scoping, the audit rows — lives in the database
 * acceptance suite against real PostgreSQL.
 *
 * Two boots make the properties visible:
 *
 * - With **no identity key material** a well-formed bearer is answered `503`
 *   by the access-token port; a missing bearer is `401` before anything runs.
 * - With **key material configured** a garbage token is `401 UNAUTHENTICATED`,
 *   and it is answered even for a body the validation pipe would reject — the
 *   guard is the first thing to run, so an unauthenticated caller learns
 *   nothing about the body's shape or the inventory vocabulary.
 *
 * The suite never prints a token, so it asserts on codes and statuses only.
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

async function withHarness(config: AppConfigShape, body: (harness: TestHarness) => Promise<void>): Promise<void> {
  const harness = await createTestHarness(config);
  try {
    await body(harness);
  } finally {
    await destroyTestHarness(harness);
  }
}

/** An organization id no test token can be a member of. */
const ABSENT_ORGANIZATION = '00000000-0000-0000-0000-000000000000';

/** The inventory routes, under the §34.1 versioned namespace. */
const LIST_LOCATIONS = `/api/v1/organizations/${ABSENT_ORGANIZATION}/inventory/locations`;
const SUBMIT_MOVEMENT = `/api/v1/organizations/${ABSENT_ORGANIZATION}/inventory/movements`;

describe('inventory routes over HTTP (no database)', () => {
  describe('with no identity key material (fail-closed)', () => {
    it('answers 401 for a missing or non-bearer Authorization header on both routes', async () => {
      await withHarness(TEST_CONFIG, async (harness) => {
        const read = await harness.http.get(LIST_LOCATIONS).expect(401);
        expect(read.body.code).toBe('UNAUTHENTICATED');

        const write = await harness.http.post(SUBMIT_MOVEMENT).send({}).expect(401);
        expect(write.body.code).toBe('UNAUTHENTICATED');

        const wrongScheme = await harness.http.get(LIST_LOCATIONS).set('Authorization', 'Basic abc').expect(401);
        expect(wrongScheme.body.code).toBe('UNAUTHENTICATED');
      });
    });

    it('answers 503 for a well-formed bearer credential while the access-token port fails closed', async () => {
      await withHarness(TEST_CONFIG, async (harness) => {
        const read = await harness.http.get(LIST_LOCATIONS).set('Authorization', 'Bearer aaa.bbb.ccc').expect(503);
        expect(read.body.code).toBe('SERVICE_UNAVAILABLE');

        const write = await harness.http
          .post(SUBMIT_MOVEMENT)
          .set('Authorization', 'Bearer aaa.bbb.ccc')
          .send({
            movementId: 'ef110000-0000-4000-8000-000000000001',
            cause: 'OPENING_BALANCE',
            variantId: 'ef110000-0000-4000-8000-000000000002',
            quantityDelta: '12',
          })
          .expect(503);
        expect(write.body.code).toBe('SERVICE_UNAVAILABLE');
      });
    });

    it('answers 404 for an unknown route — there is no inventory surface without authentication either', async () => {
      await withHarness(TEST_CONFIG, async (harness) => {
        await harness.http.get(`/api/v1/organizations/${ABSENT_ORGANIZATION}/inventory/does-not-exist`).expect(404);
      });
    });
  });

  describe('with identity key material configured', () => {
    it('refuses a garbage bearer token with 401 UNAUTHENTICATED on both routes', async () => {
      await withHarness(configuredConfig(), async (harness) => {
        const read = await harness.http.get(LIST_LOCATIONS).set('Authorization', 'Bearer aaa.bbb.ccc').expect(401);
        expect(read.body.code).toBe('UNAUTHENTICATED');

        const write = await harness.http
          .post(SUBMIT_MOVEMENT)
          .set('Authorization', 'Bearer aaa.bbb.ccc')
          .send({ movementId: 'ef110000-0000-4000-8000-000000000001' })
          .expect(401);
        expect(write.body.code).toBe('UNAUTHENTICATED');
      });
    });

    it('refuses before request validation: a malformed body is 401, not 400, without a principal', async () => {
      // §9.3: the guard runs before the validation pipe, so an unauthenticated
      // caller learns nothing about what the inventory would have refused.
      await withHarness(configuredConfig(), async (harness) => {
        await harness.http
          .post(SUBMIT_MOVEMENT)
          .set('Authorization', 'Bearer aaa.bbb.ccc')
          .send({ movementId: 42, cause: 'not-a-cause', quantityDelta: 'twelve' })
          .expect(401);
      });
    });

    it('still answers 404 for an unknown route — routing precedes every guard', async () => {
      await withHarness(configuredConfig(), async (harness) => {
        await harness.http
          .get(`/api/v1/organizations/${ABSENT_ORGANIZATION}/inventory/does-not-exist`)
          .set('Authorization', 'Bearer aaa.bbb.ccc')
          .expect(404);
      });
    });
  });
});
