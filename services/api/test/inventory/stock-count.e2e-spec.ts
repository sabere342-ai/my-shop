/**
 * Integration acceptance for the stock-count HTTP boundary (M4-S4 §15.8,
 * §30.5; §34.1 — the count routes ride the versioned namespace, organization-
 * scoped, `inventory.count`-gated).
 *
 * The same shape the inventory boundary suite proves, on the count document's
 * six routes: the guard order (§9.3 — authentication before validation before
 * any permission decision) and the fail-closed posture when the identity graph
 * cannot verify anything. Every database-backed flow — the lifecycle's
 * trigger-guarded transitions, the posting's fold, the RLS scoping, the audit
 * faces — lives in the database acceptance suite against real PostgreSQL, and
 * the full real-HTTP lifecycle is the walkthrough's evidence (§15.8).
 *
 * The suite never prints a token; only codes and statuses are asserted.
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

/** The count routes, under the §34.1 versioned namespace. */
const COUNTS = `/api/v1/organizations/${ABSENT_ORGANIZATION}/inventory/counts`;
const ONE_COUNT = `${COUNTS}/ef110000-0000-4000-8000-000000000001`;
const COUNT_LINES = `${ONE_COUNT}/lines`;
const COUNT_POST = `${ONE_COUNT}/post`;
const COUNT_CANCEL = `${ONE_COUNT}/cancel`;

describe('stock-count routes over HTTP (no database)', () => {
  describe('with no identity key material (fail-closed)', () => {
    it('answers 401 for a missing bearer on every count lifecycle route', async () => {
      await withHarness(TEST_CONFIG, async (harness) => {
        const open = await harness.http.post(COUNTS).send({}).expect(401);
        expect(open.body.code).toBe('UNAUTHENTICATED');

        const list = await harness.http.get(COUNTS).expect(401);
        expect(list.body.code).toBe('UNAUTHENTICATED');

        const read = await harness.http.get(ONE_COUNT).expect(401);
        expect(read.body.code).toBe('UNAUTHENTICATED');

        const record = await harness.http.post(COUNT_LINES).send({}).expect(401);
        expect(record.body.code).toBe('UNAUTHENTICATED');

        const post = await harness.http.post(COUNT_POST).expect(401);
        expect(post.body.code).toBe('UNAUTHENTICATED');

        const cancel = await harness.http.post(COUNT_CANCEL).expect(401);
        expect(cancel.body.code).toBe('UNAUTHENTICATED');
      });
    });

    it('answers 503 for a well-formed bearer while the access-token port fails closed', async () => {
      await withHarness(TEST_CONFIG, async (harness) => {
        const open = await harness.http
          .post(COUNTS)
          .set('Authorization', 'Bearer aaa.bbb.ccc')
          .send({ note: 'جرد' })
          .expect(503);
        expect(open.body.code).toBe('SERVICE_UNAVAILABLE');

        const list = await harness.http.get(COUNTS).set('Authorization', 'Bearer aaa.bbb.ccc').expect(503);
        expect(list.body.code).toBe('SERVICE_UNAVAILABLE');

        const post = await harness.http.post(COUNT_POST).set('Authorization', 'Bearer aaa.bbb.ccc').expect(503);
        expect(post.body.code).toBe('SERVICE_UNAVAILABLE');

        const cancel = await harness.http.post(COUNT_CANCEL).set('Authorization', 'Bearer aaa.bbb.ccc').expect(503);
        expect(cancel.body.code).toBe('SERVICE_UNAVAILABLE');
      });
    });

    it('answers 404 for an unknown route — there is no count surface without authentication either', async () => {
      await withHarness(TEST_CONFIG, async (harness) => {
        await harness.http.get(`/api/v1/organizations/${ABSENT_ORGANIZATION}/inventory/count-documents`).expect(404);
      });
    });
  });

  describe('with identity key material configured', () => {
    it('refuses a garbage bearer with 401 UNAUTHENTICATED on the count routes', async () => {
      await withHarness(configuredConfig(), async (harness) => {
        const open = await harness.http.post(COUNTS).set('Authorization', 'Bearer aaa.bbb.ccc').send({}).expect(401);
        expect(open.body.code).toBe('UNAUTHENTICATED');

        const list = await harness.http.get(COUNTS).set('Authorization', 'Bearer aaa.bbb.ccc').expect(401);
        expect(list.body.code).toBe('UNAUTHENTICATED');

        const record = await harness.http
          .post(COUNT_LINES)
          .set('Authorization', 'Bearer aaa.bbb.ccc')
          .send({ variantId: 'ef110000-0000-4000-8000-000000000002', countedQuantity: '4' })
          .expect(401);
        expect(record.body.code).toBe('UNAUTHENTICATED');
      });
    });

    it('refuses before request validation: a malformed count offer is 401, not 400, without a principal', async () => {
      // §9.3: the guard runs before the validation pipe, so an unauthenticated
      // caller learns nothing about what the count route would have refused —
      // not the counted-quantity shape, not the reason-code vocabulary.
      await withHarness(configuredConfig(), async (harness) => {
        await harness.http
          .post(COUNT_LINES)
          .set('Authorization', 'Bearer aaa.bbb.ccc')
          .send({ variantId: 42, countedQuantity: 'four', reasonCode: 'not-a-reason' })
          .expect(401);
      });
    });

    it('still answers 404 for an unknown route — routing precedes every guard', async () => {
      await withHarness(configuredConfig(), async (harness) => {
        await harness.http
          .post(`/api/v1/organizations/${ABSENT_ORGANIZATION}/inventory/count-documents`)
          .set('Authorization', 'Bearer aaa.bbb.ccc')
          .send({})
          .expect(404);
      });
    });
  });
});
