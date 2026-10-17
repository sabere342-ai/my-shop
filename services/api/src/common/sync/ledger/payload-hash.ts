/**
 * §38.9.1 `payload_hash` — SHA-256 of the canonical payload.
 *
 * The whole idempotency contract rests on this function, so both halves are
 * pinned here rather than assumed:
 *
 * - **Canonical** means exactly one serialization for one logical JSON value:
 *   object keys sorted at every depth, no insignificant whitespace, no
 *   `1` vs `1.0` distinction. Two semantically equal payloads — key orders
 *   differ, but the JSON the device actually committed is the same — must hash
 *   to the same value, otherwise a genuine replay would be misread as a
 *   §38.9.2 contradiction.
 * - **Hash** means SHA-256 over the UTF-8 bytes of that serialization,
 *   rendered as 64 lower-case hex characters (the same shape as `git hash-object`).
 *
 * The payload must be plain JSON data (object/array/string/number/boolean/null).
 * Anything else — a function, a `Date`, a non-finite number, a circular
 * reference — throws rather than producing a hash that later replays could not
 * reproduce, because a device can only replay what it can serialize.
 */

import { createHash } from 'node:crypto';

/** Accumulates canonical JSON into `out` without building one giant string. */
function writeCanonical(value: unknown, out: string[], seen: unknown[]): void {
  if (value === null) {
    out.push('null');
    return;
  }

  switch (typeof value) {
    case 'boolean':
      out.push(value ? 'true' : 'false');
      return;
    case 'string':
      // JSON.stringify's escaping is the JSON escaping; reimplementing it here
      // would be another place for the two to disagree.
      out.push(JSON.stringify(value));
      return;
    case 'number':
      if (!Number.isFinite(value)) {
        throw new Error('the payload contains a non-finite number, which is not JSON');
      }
      // `1` and `1.0` are one Number in JavaScript and one value in JSON;
      // JSON.stringify emits the shared shortest form, so the distinction
      // cannot leak into the hash.
      out.push(JSON.stringify(value));
      return;
    case 'object': {
      if (seen.includes(value)) {
        throw new Error('the payload contains a circular reference, which is not JSON');
      }
      // Top-level arrays are permitted for symmetry, though a mutation payload
      // is a record (§38.8.1) — the caller types it as such.
      if (Array.isArray(value)) {
        seen.push(value);
        out.push('[');
        for (let index = 0; index < value.length; index += 1) {
          if (index > 0) out.push(',');
          writeCanonical(value[index], out, seen);
        }
        out.push(']');
        seen.pop();
        return;
      }
      const record = value as Record<string, unknown>;
      // JSON.stringify drops keys whose value is `undefined`; the canonical
      // form must agree with it, or "the same payload" would hash differently
      // depending on how an undefined key survived serialization on the way in.
      const keys = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort();
      seen.push(value);
      out.push('{');
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        if (key === undefined) continue;
        if (index > 0) out.push(',');
        out.push(JSON.stringify(key));
        out.push(':');
        writeCanonical(record[key], out, seen);
      }
      out.push('}');
      seen.pop();
      return;
    }
    default:
      // undefined (as a value, not an object key), functions, symbols, bigint.
      throw new Error('the payload contains a value that is not canonical JSON');
  }
}

/**
 * One deterministic serialization of a JSON value.
 *
 * @throws when the value contains anything that is not plain JSON data, because
 *   a payload that cannot be re-serialized identically cannot be replayed.
 */
export function canonicalJson(value: unknown): string {
  const out: string[] = [];
  writeCanonical(value, out, []);
  return out.join('');
}

/** SHA-256 of the given UTF-8 text, rendered as 64 lower-case hex characters. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * §38.9.1: the hash stored in `mutation_ledger.payload_hash`.
 *
 * @param payload the complete immutable business event (§38.8.1 `payload`).
 */
export function payloadHashOf(payload: Record<string, unknown>): string {
  return sha256Hex(canonicalJson(payload));
}
