/**
 * Unit acceptance for the RS256 access token (§10.3, AC-10, AC-11, AC-12).
 *
 * The negative cases are the point. A JWT verifier is only as good as what it
 * refuses, so the suite spends most of its cases on the ways a token can be wrong:
 * a downgraded `alg`, a tampered signature, a foreign issuer, a token from the
 * future, an expired token, and a token that is not a JWT at all. The key material
 * is generated per run and never stored, so nothing in the repository is a secret.
 */

import { generateKeyPairSync } from 'node:crypto';

import type { IdentityConfigShape } from '../config/app.config';
import { DomainError } from '../errors/domain.error';
import { ERROR_CODES, type ErrorCode } from '../errors/problem';
import { createAccessTokenService, type AccessTokenClaims } from './access-token';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

/** Every non-key field the identity shape carries; the key fields are per-test. */
const POLICY: Omit<IdentityConfigShape, 'jwtPrivateKey' | 'jwtPublicKey'> = {
  jwtIssuer: 'my-shop',
  jwtAudience: 'my-shop-client',
  accessTokenTtlSeconds: 900,
  refreshIdleTtlSeconds: 604_800,
  refreshAbsoluteTtlSeconds: 2_592_000,
  argon2MemoryKib: 19_456,
  argon2TimeCost: 2,
  argon2Parallelism: 1,
  throttleBaseDelaySeconds: 1,
  throttleMaxDelaySeconds: 900,
  throttleFreeAttempts: 5,
  passwordMinLength: 12,
  passwordMaxLength: 128,
};

const IDENTITY: IdentityConfigShape = { ...POLICY, jwtPrivateKey: privateKey, jwtPublicKey: publicKey };

const CLAIMS: AccessTokenClaims = {
  userId: '11111111-1111-4111-8111-111111111111',
  organizations: ['22222222-2222-4222-8222-222222222222'],
  sessionId: '33333333-3333-4333-8333-333333333333',
  permissionsVersion: 7,
};

const BASE = new Date('2026-01-01T00:00:00.000Z');

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/** Asserts that a synchronous call throws a `DomainError` with an exact code. */
function expectDomainError(run: () => unknown, code: ErrorCode): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`expected a DomainError with code ${code}, but nothing was thrown`);
}

describe('access token (RS256)', () => {
  const service = createAccessTokenService(IDENTITY);

  it('round-trips the §10.3 claims', () => {
    const token = service.sign(CLAIMS, BASE);
    expect(token.split('.')).toHaveLength(3);

    const verified = service.verify(token, BASE);
    expect(verified.userId).toBe(CLAIMS.userId);
    expect(verified.organizations).toEqual(CLAIMS.organizations);
    expect(verified.sessionId).toBe(CLAIMS.sessionId);
    expect(verified.permissionsVersion).toBe(7);
    expect(verified.issuedAt).toEqual(BASE);
    expect(verified.expiresAt).toEqual(new Date(BASE.getTime() + 900_000));
  });

  it('refuses an expired token with TOKEN_EXPIRED', () => {
    const token = service.sign(CLAIMS, BASE);
    expectDomainError(() => service.verify(token, new Date(BASE.getTime() + 901_000)), ERROR_CODES.TOKEN_EXPIRED);
  });

  it('tolerates a small clock skew on `iat` but refuses a token from the future', () => {
    const slightlyAhead = service.sign(CLAIMS, new Date(BASE.getTime() + 30_000));
    expect(service.verify(slightlyAhead, BASE).userId).toBe(CLAIMS.userId);

    const future = service.sign(CLAIMS, new Date(BASE.getTime() + 3_600_000));
    expectDomainError(() => service.verify(future, BASE), ERROR_CODES.UNAUTHENTICATED);
  });

  it('refuses a tampered signature', () => {
    const token = service.sign(CLAIMS, BASE);
    const parts = token.split('.');
    const signature = parts[2] ?? '';
    const flipped = `${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`;
    const tampered = `${parts[0]}.${parts[1]}.${flipped}`;

    expectDomainError(() => service.verify(tampered), ERROR_CODES.UNAUTHENTICATED);
  });

  it('refuses an `alg: none` header before any verification runs', () => {
    const forged = `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({
      sub: CLAIMS.userId,
      orgs: CLAIMS.organizations,
      sid: CLAIMS.sessionId,
      perms_version: 7,
      iss: 'my-shop',
      aud: 'my-shop-client',
      iat: Math.floor(BASE.getTime() / 1000),
      exp: Math.floor(BASE.getTime() / 1000) + 900,
    })}.`;

    expectDomainError(() => service.verify(forged), ERROR_CODES.UNAUTHENTICATED);
  });

  it('refuses a token issued for a foreign issuer or audience', () => {
    const foreign = createAccessTokenService({ ...IDENTITY, jwtIssuer: 'someone-else' });
    expectDomainError(() => service.verify(foreign.sign(CLAIMS, BASE)), ERROR_CODES.UNAUTHENTICATED);
  });

  it('refuses a token that is not a three-segment JWT', () => {
    for (const notAToken of ['', 'abc', 'a.b', 'a.b.c.d']) {
      expectDomainError(() => service.verify(notAToken), ERROR_CODES.UNAUTHENTICATED);
    }
  });

  it('fails closed when no key material is configured — both directions answer 503', () => {
    const unconfigured = createAccessTokenService(undefined);

    expectDomainError(() => unconfigured.sign(CLAIMS), ERROR_CODES.SERVICE_UNAVAILABLE);
    expectDomainError(() => unconfigured.verify('anything'), ERROR_CODES.SERVICE_UNAVAILABLE);
  });

  it('also fails closed when only one half of the pair is configured', () => {
    const half = createAccessTokenService({ ...POLICY, jwtPrivateKey: privateKey });

    expectDomainError(() => half.sign(CLAIMS), ERROR_CODES.SERVICE_UNAVAILABLE);
    expectDomainError(() => half.verify('anything'), ERROR_CODES.SERVICE_UNAVAILABLE);
  });
});
