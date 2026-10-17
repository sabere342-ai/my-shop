/**
 * §38.16.3/§38.17 / §40.6 M2-S3 — the signed authorization snapshot.
 *
 * The snapshot is a compact RS256 JWS minted by the server (using the identity key
 * material) that carries the effective permission set, the user's permissions_version,
 * the catalog version, the organization id, the role, the owner flag, and an
 * expiry. It is validated strictly on read (three segments, pinned alg, signature,
 * issuer, audience, expiry, catalog version, and the structural owner-exclusivity
 * guard) before an offline surface may use it. Device binding is M2-S5 and is
 * therefore **not** present here; no endpoint accepts a caller-supplied device id.
 *
 * The snapshot reuses the identity key pair (`config.identity`) so no new secret,
 * no new env var, and no new dependency are introduced. The audience for the snapshot
 * is a distinct code constant (`my-shop:authorization-snapshot`) rather than the
 * access token's audience, so a token cannot be interpreted as a snapshot and vice
 * versa. The TTL is a code constant (72 h) — no config group change.
 *
 * A non-owner snapshot that carries an owner-exclusive permission is refused at
 * verification (AC-20), and the issuer must never mint one. Unknown permission ids
 * are not expected in a minted set (the resolver orders and filters to the catalog);
 * verification is fail-closed on any id the catalog does not serve or on any
 * owner-exclusive id in a non-owner snapshot.
 */

import { createPrivateKey, createPublicKey, createSign, createVerify, type KeyObject } from 'node:crypto';

import type { AppConfigShape } from '../../config/app.config';
import { DomainError } from '../../errors/domain.error';
import { ERROR_CODES } from '../../errors/problem';
import {
  isOwnerExclusivePermission,
  isPermissionId,
  PERMISSION_CATALOG_VERSION,
  PERMISSION_IDS,
} from './permission-catalog';
import { orderPermissionIds } from './effective-permissions';
import type { PermissionId } from './permission-catalog';

const ALGORITHM = 'RS256';
const SIGNING_ALGORITHM = 'RSA-SHA256';
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** The TTL of a minted snapshot, in seconds. 72 h as stated in the plan slice. */
export const AUTHORIZATION_SNAPSHOT_TTL_SECONDS = 72 * 60 * 60;

export const AUTHORIZATION_SNAPSHOT_ISSUER = 'my-shop';
export const AUTHORIZATION_SNAPSHOT_AUDIENCE = 'my-shop:authorization-snapshot';

const CLOCK_SKEW_SECONDS = 60;

function unauthenticated(diagnostic: string): DomainError {
  return new DomainError(ERROR_CODES.UNAUTHENTICATED, diagnostic);
}

function encodeSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeSegment(segment: string): Record<string, unknown> {
  if (!BASE64URL.test(segment)) {
    throw unauthenticated('a JWT segment contained characters outside the base64url alphabet');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    throw unauthenticated('a JWT segment was not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw unauthenticated('a JWT segment was not a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function stringClaim(payload: Record<string, unknown>, name: string): string {
  const value = payload[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw unauthenticated(`claim ${name} was missing or not a string`);
  }
  return value;
}

function numberClaim(payload: Record<string, unknown>, name: string): number {
  const value = payload[name];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw unauthenticated(`claim ${name} was missing or not a finite number`);
  }
  return value;
}

function stringArrayClaim(payload: Record<string, unknown>, name: string): readonly string[] {
  const value = payload[name];
  if (!Array.isArray(value) || !value.every((entry): entry is string => typeof entry === 'string')) {
    throw unauthenticated(`claim ${name} was missing or not a string array`);
  }
  return value;
}

function booleanClaim(payload: Record<string, unknown>, name: string): boolean {
  const value = payload[name];
  if (typeof value !== 'boolean') {
    throw unauthenticated(`claim ${name} was missing or not a boolean`);
  }
  return value;
}

/** The facts minted into a signed authorization snapshot. */
export interface AuthorizationSnapshotClaims {
  readonly userId: string;
  readonly organizationId: string;
  readonly roleId: string | null;
  readonly roleKey: string | null;
  readonly isOwner: boolean;
  readonly permissions: readonly PermissionId[];
  readonly permissionsVersion: number;
  readonly issuedAtSeconds: number;
}

/** The verified snapshot, resolved to Date objects and a checked permission set. */
export interface VerifiedAuthorizationSnapshot {
  readonly userId: string;
  readonly organizationId: string;
  readonly roleId: string | null;
  readonly roleKey: string | null;
  readonly isOwner: boolean;
  readonly permissions: readonly PermissionId[];
  readonly permissionsVersion: number;
  readonly catalogVersion: number;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

export interface AuthorizationSnapshotOptions {
  readonly issuer: string;
  readonly audience: string;
  readonly ttlSeconds: number;
  readonly clockSkewSeconds: number;
  readonly catalogVersion: number;
}

/** Mints and verifies signed authorization snapshots. */
export interface AuthorizationSnapshotService {
  mint(claims: AuthorizationSnapshotClaims, now?: Date): string;
  verify(token: string, now?: Date): VerifiedAuthorizationSnapshot;
}

class RsaAuthorizationSnapshotService implements AuthorizationSnapshotService {
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;

  constructor(
    privateKeyPem: string,
    publicKeyPem: string,
    private readonly options: AuthorizationSnapshotOptions,
  ) {
    this.privateKey = createPrivateKey(privateKeyPem);
    this.publicKey = createPublicKey(publicKeyPem);
  }

  mint(claims: AuthorizationSnapshotClaims, now: Date = new Date()): string {
    const issuedAtSeconds = Math.floor(now.getTime() / 1000);
    const expiresAtSeconds = issuedAtSeconds + this.options.ttlSeconds;

    let permissions = orderPermissionIds(claims.permissions);
    if (claims.isOwner) {
      // Owner must be able to hold the catalog by structure.
      permissions = orderPermissionIds([...PERMISSION_IDS]);
    } else {
      for (const id of permissions) {
        if (isOwnerExclusivePermission(id)) {
          throw validationFailed('a non-owner snapshot must not carry an owner-exclusive permission');
        }
      }
    }

    const header = { alg: ALGORITHM, typ: 'JWT' };
    const payload = {
      sub: claims.userId,
      org: claims.organizationId,
      role_id: claims.roleId,
      role_key: claims.roleKey,
      owner: claims.isOwner,
      perms: permissions as unknown as string[],
      perms_version: claims.permissionsVersion,
      catalog_version: this.options.catalogVersion,
      iss: this.options.issuer,
      aud: this.options.audience,
      iat: issuedAtSeconds,
      exp: expiresAtSeconds,
    };

    const signingInput = `${encodeSegment(header)}.${encodeSegment(payload)}`;
    const signature = createSign(SIGNING_ALGORITHM).update(signingInput).sign(this.privateKey);
    return `${signingInput}.${signature.toString('base64url')}`;
  }

  verify(token: string, now: Date = new Date()): VerifiedAuthorizationSnapshot {
    const segments = token.split('.');
    if (segments.length !== 3) {
      throw unauthenticated('authorization snapshot was not a three-segment JWT');
    }
    const [headerSegment, payloadSegment, signatureSegment] = segments;
    if (headerSegment === undefined || payloadSegment === undefined || signatureSegment === undefined) {
      throw unauthenticated('authorization snapshot was not a three-segment JWT');
    }
    if (!BASE64URL.test(signatureSegment)) {
      throw unauthenticated('authorization snapshot signature was not base64url');
    }

    const header = decodeSegment(headerSegment);
    if (header['alg'] !== ALGORITHM) {
      throw unauthenticated('authorization snapshot did not declare the expected algorithm');
    }

    const verified = createVerify(SIGNING_ALGORITHM)
      .update(`${headerSegment}.${payloadSegment}`)
      .verify(this.publicKey, Buffer.from(signatureSegment, 'base64url'));
    if (!verified) {
      throw unauthenticated('authorization snapshot signature did not verify');
    }

    const payload = decodeSegment(payloadSegment);
    if (payload['iss'] !== this.options.issuer) {
      throw unauthenticated('authorization snapshot was issued by an unexpected issuer');
    }
    if (payload['aud'] !== this.options.audience) {
      throw unauthenticated('authorization snapshot was issued for an unexpected audience');
    }

    const issuedAtSeconds = numberClaim(payload, 'iat');
    const expiresAtSeconds = numberClaim(payload, 'exp');
    const nowSeconds = Math.floor(now.getTime() / 1000);
    if (nowSeconds >= expiresAtSeconds) {
      throw new DomainError(ERROR_CODES.TOKEN_EXPIRED, 'authorization snapshot is past its expiry');
    }
    if (issuedAtSeconds > nowSeconds + this.options.clockSkewSeconds) {
      throw unauthenticated('authorization snapshot was issued in the future');
    }

    const catalogVersion = numberClaim(payload, 'catalog_version');
    if (catalogVersion !== this.options.catalogVersion) {
      throw unauthenticated('authorization snapshot carries an incompatible catalog version');
    }

    const isOwner = booleanClaim(payload, 'owner');
    const perms = stringArrayClaim(payload, 'perms');
    for (const id of perms) {
      if (!isPermissionId(id)) {
        throw unauthenticated('authorization snapshot carried an unknown permission id');
      }
      if (!isOwner && isOwnerExclusivePermission(id)) {
        throw unauthenticated('authorization snapshot carried an owner-exclusive permission for a non-owner');
      }
    }
    const permissions = orderPermissionIds(perms);

    const roleIdRaw = payload['role_id'];
    const roleId = typeof roleIdRaw === 'string' && roleIdRaw.length > 0 ? roleIdRaw : null;
    const roleKeyRaw = payload['role_key'];
    const roleKey = typeof roleKeyRaw === 'string' && roleKeyRaw.length > 0 ? roleKeyRaw : null;

    return {
      userId: stringClaim(payload, 'sub'),
      organizationId: stringClaim(payload, 'org'),
      roleId,
      roleKey,
      isOwner,
      permissions,
      permissionsVersion: numberClaim(payload, 'perms_version'),
      catalogVersion,
      issuedAt: new Date(issuedAtSeconds * 1000),
      expiresAt: new Date(expiresAtSeconds * 1000),
    };
  }
}

class FailClosedAuthorizationSnapshotService implements AuthorizationSnapshotService {
  mint(): string {
    throw new DomainError(
      ERROR_CODES.SERVICE_UNAVAILABLE,
      'identity key material is not configured; the authorization snapshot surface fails closed',
    );
  }
  verify(): VerifiedAuthorizationSnapshot {
    throw new DomainError(
      ERROR_CODES.SERVICE_UNAVAILABLE,
      'identity key material is not configured; the authorization snapshot surface fails closed',
    );
  }
}

export function createAuthorizationSnapshotService(
  identity: AppConfigShape['identity'],
  options?: Partial<AuthorizationSnapshotOptions>,
): AuthorizationSnapshotService {
  if (identity === undefined || identity.jwtPrivateKey === undefined || identity.jwtPublicKey === undefined) {
    return new FailClosedAuthorizationSnapshotService();
  }
  return new RsaAuthorizationSnapshotService(identity.jwtPrivateKey, identity.jwtPublicKey, {
    issuer: AUTHORIZATION_SNAPSHOT_ISSUER,
    audience: AUTHORIZATION_SNAPSHOT_AUDIENCE,
    ttlSeconds: AUTHORIZATION_SNAPSHOT_TTL_SECONDS,
    clockSkewSeconds: CLOCK_SKEW_SECONDS,
    catalogVersion: PERMISSION_CATALOG_VERSION,
    ...options,
  });
}

function validationFailed(diagnostic: string): DomainError {
  return new DomainError(ERROR_CODES.VALIDATION_FAILED, diagnostic);
}
