/**
 * Unit acceptance for the signed authorization snapshot (§38.16.3, AC-17..AC-21).
 *
 * The snapshot reuses the identity RS256 key pair, uses a distinct audience, and
 * enforces strict rejections: tampered payload/signature, foreign signature,
 * `alg: none`/`HS256`, expired, future-issued, wrong issuer/audience,
 * incompatible catalog version, unknown permission id, and a non-owner carrying an
 * owner-exclusive permission. The issuer must never mint such a snapshot; verification
 * still rejects it defensively.
 */

import { createSign, generateKeyPairSync } from 'node:crypto';

import type { IdentityConfigShape } from '../../config/app.config';
import { DomainError } from '../../errors/domain.error';
import { ERROR_CODES, type ErrorCode } from '../../errors/problem';
import {
  AUTHORIZATION_SNAPSHOT_AUDIENCE,
  AUTHORIZATION_SNAPSHOT_ISSUER,
  createAuthorizationSnapshotService,
  type AuthorizationSnapshotClaims,
  type AuthorizationSnapshotService,
} from './authorization-snapshot';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

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

const BASE = new Date('2026-01-01T00:00:00.000Z');

const OWNER_CLAIMS: AuthorizationSnapshotClaims = {
  userId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  roleId: '33333333-3333-4333-8333-333333333333',
  roleKey: 'owner',
  isOwner: true,
  permissions: [],
  permissionsVersion: 5,
  issuedAtSeconds: Math.floor(BASE.getTime() / 1000),
};

const NON_OWNER_CLAIMS: AuthorizationSnapshotClaims = {
  userId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  roleId: '44444444-4444-4444-8444-444444444444',
  roleKey: 'manager',
  isOwner: false,
  permissions: ['sales.create'],
  permissionsVersion: 7,
  issuedAtSeconds: Math.floor(BASE.getTime() / 1000),
};

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

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

describe('authorization snapshot (§38.16.3)', () => {
  const service = createAuthorizationSnapshotService(IDENTITY);

  it('round-trips the snapshot claims and preserves the permission set (AC-17)', () => {
    const token = service.mint({ ...NON_OWNER_CLAIMS, permissions: ['sales.create', 'catalog.view'] }, BASE);
    expect(token.split('.')).toHaveLength(3);

    const verified = service.verify(token, BASE);
    expect(verified.userId).toBe(NON_OWNER_CLAIMS.userId);
    expect(verified.organizationId).toBe(NON_OWNER_CLAIMS.organizationId);
    expect(verified.roleKey).toBe('manager');
    expect(verified.isOwner).toBe(false);
    expect(verified.permissions).toEqual(['catalog.view', 'sales.create']);
    expect(verified.permissionsVersion).toBe(7);
    expect(verified.catalogVersion).toBe(1);
    expect(verified.issuedAt).toEqual(BASE);
    expect(verified.expiresAt.getTime()).toBeGreaterThan(BASE.getTime());
  });

  it('mints the whole catalog for the Owner and rejects a non-owner snapshot carrying owner-exclusive (AC-20)', () => {
    const ownerToken = service.mint(OWNER_CLAIMS, BASE);
    const verifiedOwner = service.verify(ownerToken, BASE);
    expect(verifiedOwner.isOwner).toBe(true);
    expect(verifiedOwner.permissions).toContain('accounting.journal.post');

    // The issuer refuses to mint a non-owner snapshot that carries owner-exclusive
    expectDomainError(
      () =>
        service.mint(
          {
            ...NON_OWNER_CLAIMS,
            permissions: ['sales.create', 'accounting.journal.post'],
          },
          BASE,
        ),
      ERROR_CODES.VALIDATION_FAILED,
    );
  });

  it('rejects tampering, wrong signature, alg downgrade, and malformed segments (AC-18)', () => {
    const token = service.mint(NON_OWNER_CLAIMS, BASE);
    const parts = token.split('.');
    const h = must(parts[0]);
    const pSeg = parts[1];
    const s = must(parts[2]);

    // Tampered payload
    const pTampered = base64url({
      sub: NON_OWNER_CLAIMS.userId,
      org: NON_OWNER_CLAIMS.organizationId,
      owner: false,
      perms: ['catalog.view'],
      perms_version: 99,
      catalog_version: 1,
      iss: AUTHORIZATION_SNAPSHOT_ISSUER,
      aud: AUTHORIZATION_SNAPSHOT_AUDIENCE,
      iat: Math.floor(BASE.getTime() / 1000),
      exp: Math.floor(BASE.getTime() / 1000) + 86400,
    });
    expect(() => service.verify(`${h}.${pTampered}.${s}`, BASE)).toThrow();

    // Wrong signature
    const wrongSig = Buffer.from(s, 'base64url').reverse().toString('base64url');
    expect(() => service.verify(`${h}.${must(pSeg)}.${wrongSig}`, BASE)).toThrow();

    // alg: none
    const hNone = base64url({ alg: 'none', typ: 'JWT' });
    expect(() => service.verify(`${hNone}.${must(pSeg)}.${s}`, BASE)).toThrow();

    // alg: HS256
    const hHs256 = base64url({ alg: 'HS256', typ: 'JWT' });
    expect(() => service.verify(`${hHs256}.${must(pSeg)}.${s}`, BASE)).toThrow();

    // Not a JWT
    expect(() => service.verify('not-a-token', BASE)).toThrow();
  });

  it('rejects expired, future-issued, wrong issuer/audience (AC-18)', () => {
    const now = BASE;
    const expired = service.mint(NON_OWNER_CLAIMS, new Date(now.getTime() - 120 * 60 * 60 * 1000));
    expectDomainError(() => service.verify(expired, now), ERROR_CODES.TOKEN_EXPIRED);

    const futureIssued = service.mint(NON_OWNER_CLAIMS, new Date(now.getTime() + 120 * 1000));
    expect(() => service.verify(futureIssued, now)).toThrow();

    const foreignIssuer = service.mint(NON_OWNER_CLAIMS, BASE);
    const fParts = foreignIssuer.split('.');
    const hF = must(fParts[0]);
    void must(fParts[1]);
    const pBadIss = base64url({
      sub: NON_OWNER_CLAIMS.userId,
      org: NON_OWNER_CLAIMS.organizationId,
      owner: false,
      perms: ['sales.create'],
      perms_version: 7,
      catalog_version: 1,
      iss: 'foreign',
      aud: AUTHORIZATION_SNAPSHOT_AUDIENCE,
      iat: Math.floor(BASE.getTime() / 1000),
      exp: Math.floor(BASE.getTime() / 1000) + 86400,
    });
    const sNew = signForPayload(service, hF, pBadIss, privateKey);
    expect(() => service.verify(`${hF}.${pBadIss}.${sNew}`, BASE)).toThrow();

    const pBadAud = base64url({
      sub: NON_OWNER_CLAIMS.userId,
      org: NON_OWNER_CLAIMS.organizationId,
      owner: false,
      perms: ['sales.create'],
      perms_version: 7,
      catalog_version: 1,
      iss: AUTHORIZATION_SNAPSHOT_ISSUER,
      aud: 'my-shop-client',
      iat: Math.floor(BASE.getTime() / 1000),
      exp: Math.floor(BASE.getTime() / 1000) + 86400,
    });
    const sNew2 = signForPayload(service, hF, pBadAud, privateKey);
    expect(() => service.verify(`${hF}.${pBadAud}.${sNew2}`, BASE)).toThrow();
  });

  it('rejects an incompatible catalog version (AC-19)', () => {
    const serviceOld = createAuthorizationSnapshotService(IDENTITY, { catalogVersion: 2 });
    const token = serviceOld.mint(NON_OWNER_CLAIMS, BASE);
    expect(() => service.verify(token, BASE)).toThrow();
  });

  it('rejects an unknown permission id and an owner-exclusive permission for a non-owner at verification (AC-20)', () => {
    const token = service.mint(NON_OWNER_CLAIMS, BASE);
    const tParts = token.split('.');
    const hT = must(tParts[0]);
    const pUnknown = base64url({
      sub: NON_OWNER_CLAIMS.userId,
      org: NON_OWNER_CLAIMS.organizationId,
      owner: false,
      perms: ['sales.teleport'],
      perms_version: 7,
      catalog_version: 1,
      iss: AUTHORIZATION_SNAPSHOT_ISSUER,
      aud: AUTHORIZATION_SNAPSHOT_AUDIENCE,
      iat: Math.floor(BASE.getTime() / 1000),
      exp: Math.floor(BASE.getTime() / 1000) + 86400,
    });
    const sUnknown = signForPayload(service, hT, pUnknown, privateKey);
    expect(() => service.verify(`${hT}.${pUnknown}.${sUnknown}`, BASE)).toThrow();

    const pOwnerEx = base64url({
      sub: NON_OWNER_CLAIMS.userId,
      org: NON_OWNER_CLAIMS.organizationId,
      owner: false,
      perms: ['accounting.journal.post'],
      perms_version: 7,
      catalog_version: 1,
      iss: AUTHORIZATION_SNAPSHOT_ISSUER,
      aud: AUTHORIZATION_SNAPSHOT_AUDIENCE,
      iat: Math.floor(BASE.getTime() / 1000),
      exp: Math.floor(BASE.getTime() / 1000) + 86400,
    });
    const sOwnerEx = signForPayload(service, hT, pOwnerEx, privateKey);
    expect(() => service.verify(`${hT}.${pOwnerEx}.${sOwnerEx}`, BASE)).toThrow();
  });

  it('fails closed when identity key material is missing', () => {
    const closed = createAuthorizationSnapshotService(undefined);
    expectDomainError(() => closed.mint(NON_OWNER_CLAIMS), ERROR_CODES.SERVICE_UNAVAILABLE);
    expectDomainError(() => closed.verify('a.b.c'), ERROR_CODES.SERVICE_UNAVAILABLE);
  });
});

/**
 * Re-signs an arbitrary payload under the same header to craft a token whose payload
 * was altered by the test (bypassing the service's mint path).
 *
 * The token header is taken from a real minted token, and the signature is produced
 * by creating a fresh service-like signer — which is the real private key. This is
 * purely a test helper (not shipped).
 */
function must<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('unexpected undefined in snapshot test');
  }
  return value;
}

function signForPayload(
  _service: AuthorizationSnapshotService,
  headerSegment: string,
  payloadSegment: string,
  privateKeyPem: string,
): string {
  const signature = createSign('RSA-SHA256').update(`${headerSegment}.${payloadSegment}`).sign(privateKeyPem);
  return signature.toString('base64url');
}
