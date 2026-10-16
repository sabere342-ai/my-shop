/**
 * §10.3 / §40.6 M2-S2 — the signed, short-lived access token.
 *
 * §10.3 fixes the shape of the access token: a short-lived JWT whose claims are
 * `sub`, `orgs`, `sid`, and `perms_version`. This file mints and verifies exactly
 * that token, and nothing else.
 *
 * **Why hand-rolled RS256 over `node:crypto` rather than a JWT package.**
 * ADR-005 settles the backend on CommonJS. The maintained JWT libraries that ship
 * a current release are ESM-only or ESM-first, and an ESM-only dependency cannot be
 * `require`d by this package's compiled CommonJS or by the Jest projects, so it
 * would break the build and the test suite rather than the feature. RS256 over
 * `node:crypto` is ~120 lines of a well-specified format, uses the same OpenSSL
 * the platform already trusts, and adds no dependency. The signature is the thing
 * that matters, and `crypto.sign`/`crypto.verify` are the platform's, not ours.
 *
 * The verification path is deliberately strict, because a lax verifier is how a
 * JWT library becomes a vulnerability:
 *
 * - exactly three base64url segments, each matching the base64url alphabet;
 * - the header's `alg` must be `RS256` — a header claiming `none` or `HS256` is
 *   refused *before* any verification, so an attacker cannot downgrade the
 *   algorithm by editing the header;
 * - the signature is verified with the **configured** algorithm and public key,
 *   never one named by the token;
 * - `iss` and `aud` must match the configured values;
 * - `exp` is enforced with `TOKEN_EXPIRED`, and a token issued meaningfully in the
 *   future is refused.
 *
 * The service is a port with two implementations: a real RS256 service when key
 * material is configured, and a fail-closed one when it is not, so "not configured"
 * is a property of the module graph and never a weaker check.
 */

import { createPrivateKey, createPublicKey, createSign, createVerify, type KeyObject } from 'node:crypto';
import type { IdentityConfigShape } from '../config/app.config';
import { DomainError } from '../errors/domain.error';
import { ERROR_CODES } from '../errors/problem';

/** The claims this slice mints (the §10.3 set). */
export interface AccessTokenClaims {
  /** `sub`: the user id. */
  readonly userId: string;
  /** `orgs`: the organizations the user is a member of, from server state only. */
  readonly organizations: readonly string[];
  /** `sid`: the session (refresh-token family) id. */
  readonly sessionId: string;
  /** `perms_version`: the permission generation this token was minted against. */
  readonly permissionsVersion: number;
}

/** The verified claims, with the times resolved. */
export interface VerifiedAccessToken {
  readonly userId: string;
  readonly organizations: readonly string[];
  readonly sessionId: string;
  readonly permissionsVersion: number;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

/** Mint and verify access tokens. */
export interface AccessTokenService {
  sign(claims: AccessTokenClaims, now?: Date): string;
  verify(token: string, now?: Date): VerifiedAccessToken;
}

const ALGORITHM = 'RS256';
const SIGNING_ALGORITHM = 'RSA-SHA256';
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * Tolerance for a token whose `iat` is slightly ahead of this server's clock.
 * Two hosts with a few seconds of skew must not reject each other's fresh tokens.
 */
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

interface RsaOptions {
  readonly privateKeyPem: string;
  readonly publicKeyPem: string;
  readonly issuer: string;
  readonly audience: string;
  readonly ttlSeconds: number;
}

/** The configured implementation. Constructed only when key material exists. */
class RsaAccessTokenService implements AccessTokenService {
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;

  constructor(private readonly options: RsaOptions) {
    // Constructing the keys here means a malformed key fails at startup, not at the
    // first login: the configuration layer checks the value is PEM, and this checks
    // it is a usable key.
    this.privateKey = createPrivateKey(options.privateKeyPem);
    this.publicKey = createPublicKey(options.publicKeyPem);
  }

  sign(claims: AccessTokenClaims, now: Date = new Date()): string {
    const issuedAt = Math.floor(now.getTime() / 1000);
    const expiresAt = issuedAt + this.options.ttlSeconds;

    const header = { alg: ALGORITHM, typ: 'JWT' };
    const payload = {
      sub: claims.userId,
      orgs: [...claims.organizations],
      sid: claims.sessionId,
      perms_version: claims.permissionsVersion,
      iss: this.options.issuer,
      aud: this.options.audience,
      iat: issuedAt,
      exp: expiresAt,
    };

    const signingInput = `${encodeSegment(header)}.${encodeSegment(payload)}`;
    const signature = createSign(SIGNING_ALGORITHM).update(signingInput).sign(this.privateKey);

    return `${signingInput}.${signature.toString('base64url')}`;
  }

  verify(token: string, now: Date = new Date()): VerifiedAccessToken {
    const segments = token.split('.');
    if (segments.length !== 3) {
      throw unauthenticated('access token was not a three-segment JWT');
    }

    const headerSegment = segments[0];
    const payloadSegment = segments[1];
    const signatureSegment = segments[2];
    if (headerSegment === undefined || payloadSegment === undefined || signatureSegment === undefined) {
      throw unauthenticated('access token was not a three-segment JWT');
    }

    const header = decodeSegment(headerSegment);
    // Checked against the configured algorithm, not the token's: this is what
    // refuses an `alg: none` or `alg: HS256` header before any verification runs.
    if (header['alg'] !== ALGORITHM) {
      throw unauthenticated('access token did not declare the expected algorithm');
    }

    if (!BASE64URL.test(signatureSegment)) {
      throw unauthenticated('access token signature was not base64url');
    }

    const verified = createVerify(SIGNING_ALGORITHM)
      .update(`${headerSegment}.${payloadSegment}`)
      .verify(this.publicKey, Buffer.from(signatureSegment, 'base64url'));
    if (!verified) {
      throw unauthenticated('access token signature did not verify');
    }

    const payload = decodeSegment(payloadSegment);

    if (payload['iss'] !== this.options.issuer) {
      throw unauthenticated('access token was issued by an unexpected issuer');
    }
    if (payload['aud'] !== this.options.audience) {
      throw unauthenticated('access token was issued for an unexpected audience');
    }

    const issuedAtSeconds = numberClaim(payload, 'iat');
    const expiresAtSeconds = numberClaim(payload, 'exp');
    const nowSeconds = Math.floor(now.getTime() / 1000);

    if (nowSeconds >= expiresAtSeconds) {
      throw new DomainError(ERROR_CODES.TOKEN_EXPIRED, 'access token is past its expiry');
    }
    if (issuedAtSeconds > nowSeconds + CLOCK_SKEW_SECONDS) {
      throw unauthenticated('access token was issued in the future');
    }

    return {
      userId: stringClaim(payload, 'sub'),
      organizations: stringArrayClaim(payload, 'orgs'),
      sessionId: stringClaim(payload, 'sid'),
      permissionsVersion: numberClaim(payload, 'perms_version'),
      issuedAt: new Date(issuedAtSeconds * 1000),
      expiresAt: new Date(expiresAtSeconds * 1000),
    };
  }
}

/**
 * The fail-closed implementation, bound when no key material is configured.
 *
 * §10.3's surface must never run unverified. Rather than minting unsigned tokens or
 * skipping verification, an unconfigured identity surface answers `503` for both
 * operations: the client is told to come back, and no caller is ever treated as
 * authenticated on the strength of a configuration omission. A production
 * deployment cannot reach this state (`checkIdentityConfig` requires the key pair
 * when `NODE_ENV=production`).
 */
class FailClosedAccessTokenService implements AccessTokenService {
  sign(): string {
    throw new DomainError(
      ERROR_CODES.SERVICE_UNAVAILABLE,
      'identity key material is not configured; the access-token surface fails closed',
    );
  }

  verify(): VerifiedAccessToken {
    throw new DomainError(
      ERROR_CODES.SERVICE_UNAVAILABLE,
      'identity key material is not configured; the access-token surface fails closed',
    );
  }
}

/**
 * Binds the access-token service for a configuration: the real RS256 service when
 * both keys are present, the fail-closed one otherwise.
 */
export function createAccessTokenService(identity: IdentityConfigShape | undefined): AccessTokenService {
  if (identity === undefined || identity.jwtPrivateKey === undefined || identity.jwtPublicKey === undefined) {
    return new FailClosedAccessTokenService();
  }

  return new RsaAccessTokenService({
    privateKeyPem: identity.jwtPrivateKey,
    publicKeyPem: identity.jwtPublicKey,
    issuer: identity.jwtIssuer,
    audience: identity.jwtAudience,
    ttlSeconds: identity.accessTokenTtlSeconds,
  });
}
