/**
 * §10.3 / §40.6 M2-S2 — the opaque refresh-token primitive.
 *
 * §10.3 chooses an **opaque** refresh token rather than a second JWT, and this
 * file explains and implements that choice:
 *
 * - **Opaque, high-entropy, server-generated.** A refresh token is 256 random bits
 *   encoded as base64url. It carries no claims, so it can be revoked by deleting
 *   server state rather than by waiting for a cryptographic expiry, which is the
 *   whole point of server-side sessions.
 * - **Only the digest is stored.** The database holds the SHA-256 hex of the token
 *   (`token_hash char(64)`), never the token. A read-only leak of the table
 *   therefore yields no usable token, and the digest is also what the unique
 *   constraint and lookups key on. The token itself exists only in the response
 *   body handed to the client.
 *
 * SHA-256 is the right digest here and not a weakening: the input is 256 bits of
 * uniform randomness, so there is nothing to brute-force and no need for a
 * slow/ salted hash. A password is low-entropy and needs Argon2id; a random token
 * does not.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256 bits (§10.3). Encoded as base64url this is 43 characters. */
export const REFRESH_TOKEN_BYTES = 32;

/** The hex length of the stored digest; `token_hash` is `char(64)` to match. */
export const REFRESH_TOKEN_HASH_LENGTH = 64;

/**
 * Mints a fresh refresh token.
 *
 * `randomBytes` is the CSPRNG; there is no fallback. A predictable refresh token
 * would let an attacker who observes one rotation forge the next, which is exactly
 * what reuse detection is meant to catch — but only if the tokens are genuinely
 * unguessable.
 */
export function generateRefreshToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
}

/** The stored form of a refresh token: its SHA-256 hex digest. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Constant-time equality for two refresh-token digests.
 *
 * Lookups key on the digest, so this is used when comparing a computed digest
 * against one already in hand (for example, asserting a rotation linked the
 * expected successor). `timingSafeEqual` requires equal-length buffers, so a
 * length mismatch is answered `false` without a comparison — a length difference
 * is not a secret here, the digest length is fixed and public.
 */
export function digestsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}
