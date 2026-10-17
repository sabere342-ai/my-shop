/**
 * §38.9.1 `payload_hash` — the idempotency contract's first dependency.
 *
 * Every test here pins one property of the canonical form, because each is
 * load-bearing for §38.9.2: if two representations of the *same* logical payload
 * hashed differently, a genuine replay would be reported as a contradiction.
 */

import { canonicalJson, payloadHashOf, sha256Hex } from './payload-hash';

/** Hard-coded vector: SHA-256 of the canonical JSON `{"a":2,"b":1}`. */
const CANONICAL_VECTOR_SHA256 = 'd3626ac30a87e6f7a6428233b3c68299976865fa5508e4267c5415c76af7a772';

describe('canonicalJson', () => {
  it('serializes object keys in sorted order regardless of insertion order', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });

  it('sorts keys recursively and preserves array order', () => {
    expect(canonicalJson({ z: { y: [3, 1, 2], x: 0 }, a: true })).toBe('{"a":true,"z":{"x":0,"y":[3,1,2]}}');
  });

  it('emits JSON string escaping', () => {
    expect(canonicalJson({ 'a"b': 'x\ny' })).toBe('{"a\\"b":"x\\ny"}');
  });

  it('renders numbers in their shortest JSON form, collapsing 1 and 1.0', () => {
    expect(canonicalJson({ a: 1 })).toBe('{"a":1}');
    expect(canonicalJson({ a: 1.0 })).toBe('{"a":1}');
    expect(canonicalJson({ a: 100 })).toBe('{"a":100}');
  });

  it('renders json literals for booleans and null, including null as a value', () => {
    expect(canonicalJson({ a: true, b: null, c: false })).toBe('{"a":true,"b":null,"c":false}');
  });

  it('drops object keys whose value is undefined, agreeing with JSON.stringify', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('rejects values that are not canonical JSON', () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
    expect(() => canonicalJson({ a: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => canonicalJson(undefined)).toThrow();
    expect(() => canonicalJson({ a: () => undefined })).toThrow();
    expect(() => canonicalJson({ a: 10n })).toThrow();
    const circular: Record<string, unknown> = { self: undefined };
    circular['self'] = circular;
    expect(() => canonicalJson(circular)).toThrow();
  });
});

describe('payloadHashOf', () => {
  it('hashes the canonical form, not the insertion order', () => {
    expect(payloadHashOf({ a: 2, b: 1 })).toBe(payloadHashOf({ b: 1, a: 2 }));
  });

  it('produces the pinned SHA-256 vector', () => {
    const hash = sha256Hex(canonicalJson({ b: 1, a: 2 }));
    expect(hash).toBe(CANONICAL_VECTOR_SHA256);
    expect(payloadHashOf({ a: 2, b: 1 })).toBe(CANONICAL_VECTOR_SHA256);
  });

  it('returns a 64-character lower-case hex digest', () => {
    expect(payloadHashOf({ payload: ['dangling'] })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('distinguishes genuinely different payloads', () => {
    expect(payloadHashOf({ kind: 'SALE', amount: 5 })).not.toBe(payloadHashOf({ kind: 'SALE', amount: 6 }));
  });
});
