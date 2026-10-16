/**
 * Unit acceptance for the opaque refresh-token primitive (§10.3, AC-09).
 *
 * The properties that matter are all about what is *not* stored and what cannot be
 * predicted: 256 bits of CSPRNG output, a fixed 64-hex digest as the only durable
 * form, and a constant-time comparison that refuses a length mismatch without
 * comparing. Each case names the property it pins.
 */

import {
  digestsEqual,
  generateRefreshToken,
  hashRefreshToken,
  REFRESH_TOKEN_BYTES,
  REFRESH_TOKEN_HASH_LENGTH,
} from './refresh-token';

const BASE64URL = /^[A-Za-z0-9_-]+$/;

describe('refresh tokens', () => {
  it('mints 256 bits of base64url — 43 characters, no padding', () => {
    const token = generateRefreshToken();

    expect(BASE64URL.test(token)).toBe(true);
    expect(token).toHaveLength(43);
    expect(Buffer.from(token, 'base64url')).toHaveLength(REFRESH_TOKEN_BYTES);
  });

  it('does not repeat itself — the CSPRNG is the only source', () => {
    const tokens = new Set(Array.from({ length: 64 }, () => generateRefreshToken()));
    expect(tokens.size).toBe(64);
  });

  it('stores a 64-character SHA-256 hex digest, never the token', () => {
    const token = generateRefreshToken();
    const digest = hashRefreshToken(token);

    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).toHaveLength(REFRESH_TOKEN_HASH_LENGTH);
    expect(digest).not.toContain(token);
    expect(hashRefreshToken(token)).toBe(digest);
  });

  it('a different token hashes to a different digest', () => {
    expect(hashRefreshToken(generateRefreshToken())).not.toBe(hashRefreshToken(generateRefreshToken()));
  });

  it('compares equal digests as equal, and different digests as different', () => {
    const digest = hashRefreshToken('a-token');
    expect(digestsEqual(digest, digest)).toBe(true);
    expect(digestsEqual(digest, hashRefreshToken('another-token'))).toBe(false);
  });

  it('refuses a length mismatch without comparing — the length is public, not a secret', () => {
    expect(digestsEqual('abc', 'abcd')).toBe(false);
    expect(digestsEqual('', 'a')).toBe(false);
    expect(digestsEqual('', '')).toBe(true);
  });
});
