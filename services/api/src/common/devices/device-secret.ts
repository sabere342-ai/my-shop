/**
 * The installation-secret credential primitives (Master Plan §12.3, §40.6 M2-S5).
 *
 * §12.3 fixes the discipline: the server stores only a SHA-256 digest of the
 * keystore-held installation secret — "never a reversible form" — and verification
 * is a constant-time comparison, the same discipline `refresh-token.ts` applies to
 * the rotating refresh token. The secret itself exists only in the platform
 * keystore of the installation that registered the handle; a server-side copy
 * cannot leak what was never stored.
 *
 * The server-issued half of the identity is the `devices.id` UUID minted at
 * registration. The `(installation_id, installation_secret)` pair presented at
 * registration and at login is a *credential, never authority*: every decision
 * that consumes it runs inside an authenticated tenant transaction against the
 * live device row (§9.3, §13.3).
 */

import { createHash, timingSafeEqual } from 'node:crypto';

/** The canonical 64-hex SHA-256 digest of an installation secret. */
export function hashDeviceSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/**
 * Constant-time digest comparison. Both digests are hex produced by
 * `hashDeviceSecret`, so lengths always agree; the buffer guard is defence in
 * depth for a caller that somehow holds a malformed digest.
 */
export function deviceSecretMatches(candidateHash: string, storedHash: string): boolean {
  if (candidateHash.length !== storedHash.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(candidateHash, 'utf8'), Buffer.from(storedHash, 'utf8'));
}
