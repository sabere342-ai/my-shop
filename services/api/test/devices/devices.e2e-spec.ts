/**
 * Device route acceptance over HTTP — the no-database boundary (Master Plan
 * §12, §40.6 M2-S5; §34.1, §36.2).
 *
 * The suite deliberately exercises only the part of the surface that needs no
 * database, exactly as `auth.e2e-spec.ts` does for the identity routes: the
 * route table, the guard order (bearer first, then organization, then
 * permission), and the fail-closed answers a malformed or unauthenticated
 * request receives. CI runs this project (Stage 6) before the database
 * acceptance suite (Stage 7) migrates anything, so every flow that reaches
 * PostgreSQL — registration classification, binding, the atomic revocation,
 * and the device-bound sync boundary — lives in
 * `test/database/postgres.db-spec.ts`, where the database is guaranteed.
 */

import { generateKeyPairSync } from 'node:crypto';

import { loadConfig, type AppConfigShape } from '../../src/common/config/app.config';
import { createTestHarness, destroyTestHarness, TEST_CONFIG, type TestHarness } from '../harness';

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DEVICE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BASE = `/api/v1/organizations/${ORG_ID}/devices`;
const REGISTER_PATH = `${BASE}`;
const LIST_PATH = `${BASE}`;
const BIND_PATH = `${BASE}/${DEVICE_ID}/bind-session`;
const REVOKE_PATH = `${BASE}/${DEVICE_ID}/revoke`;

/** One syntactically valid registration body; the guard is what refuses it. */
const REGISTER_BODY = {
  installationId: DEVICE_ID,
  installationSecret: 'e2e-installation-credential-padding-padded',
  platform: 'windows',
};

const BIND_BODY = { installationSecret: 'e2e-installation-credential-padding-padded' };

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
    JWT_PRIVATE_KEY: Buffer.from(privateKey, 'utf8').toString('base64'),
    JWT_PUBLIC_KEY: Buffer.from(publicKey, 'utf8').toString('base64'),
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

describe('device routes over HTTP', () => {
  describe('no identity key material: the route surface fails closed', () => {
    it('answers 401 for a missing Authorization header before any service runs', async () => {
      await withHarness(TEST_CONFIG, async (harness) => {
        // A guarded route is answered 401, never 404: the four routes exist and
        // the bearer guard is attached ahead of every handler.
        await harness.http.post(REGISTER_PATH).send(REGISTER_BODY).expect(401);
        await harness.http.get(LIST_PATH).expect(401);
        await harness.http.post(BIND_PATH).send(BIND_BODY).expect(401);
        await harness.http.post(REVOKE_PATH).expect(401);
      });
    });

    it('answers 503 for a well-formed bearer credential while the surface is unconfigured', async () => {
      await withHarness(TEST_CONFIG, async (harness) => {
        for (const attempt of [
          () => harness.http.post(REGISTER_PATH).send(REGISTER_BODY),
          () => harness.http.get(LIST_PATH),
          () => harness.http.post(BIND_PATH).send(BIND_BODY),
          () => harness.http.post(REVOKE_PATH),
        ]) {
          const response = await attempt().set('Authorization', 'Bearer aaa.bbb.ccc').expect(503);
          expect(response.body.code).toBe('SERVICE_UNAVAILABLE');
        }
      });
    });

    it('refuses a non-bearer scheme with 401 UNAUTHENTICATED', async () => {
      await withHarness(TEST_CONFIG, async (harness) => {
        const response = await harness.http.post(REVOKE_PATH).set('Authorization', 'Basic abc').expect(401);
        expect(response.body.code).toBe('UNAUTHENTICATED');
      });
    });
  });

  describe('with identity key material configured: the credential is verified before any tenant name is read', () => {
    it('refuses a garbage bearer token with 401 UNAUTHENTICATED on every route', async () => {
      await withHarness(configuredConfig(), async (harness) => {
        for (const attempt of [
          () => harness.http.post(REGISTER_PATH).send(REGISTER_BODY),
          () => harness.http.get(LIST_PATH),
          () => harness.http.post(BIND_PATH).send(BIND_BODY),
          () => harness.http.post(REVOKE_PATH),
        ]) {
          const response = await attempt().set('Authorization', 'Bearer aaa.bbb.ccc').expect(401);
          expect(response.body.code).toBe('UNAUTHENTICATED');
        }
      });
    });

    it('an unauthenticated caller never reaches request-body validation — the guard order is structural', async () => {
      // Bodies that would fail validation (bad platform, short secret, bad ids)
      // are irrelevant until the bearer credential verifies: a request that
      // carries no credential is answered 401, not 400, for every route shape.
      await withHarness(configuredConfig(), async (harness) => {
        const invalidBodies = [
          { installationId: 'not-a-uuid', installationSecret: 'x'.repeat(64), platform: 'windows' },
          { installationId: DEVICE_ID, installationSecret: 'short', platform: 'windows' },
          { installationId: DEVICE_ID, installationSecret: 'x'.repeat(64), platform: 'templeos' },
        ];
        for (const body of invalidBodies) {
          await harness.http.post(REGISTER_PATH).send(body).expect(401);
          await harness.http.post(BIND_PATH).send(body).expect(401);
        }
      });
    });
  });
});
