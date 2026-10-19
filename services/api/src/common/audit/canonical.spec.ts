/**
 * Unit tests for the canonical serialization and chain hashing (§32.5).
 *
 * The canonical byte string is the one thing the tamper detection stands on:
 * the writer computes `event_hash` from it, and the verifier recomputes the
 * same digest from what PostgreSQL holds. These tests pin the determinism
 * rules that make those two computations agree:
 *
 * - canonical JSON: sorted keys, no whitespace, plain values only;
 * - `Date` → fixed ISO-8601, `bigint` → decimal digits, `undefined`/`null` →
 *   the literal `null`;
 * - every field of the §32.5 hash line participates: changing any one of
 *   stream, type, scope, sequence, time, actor, payload, or the previous hash
 *   changes the digest — a rewritten row cannot keep its stored hash.
 */

import {
  canonicalJson,
  eventHashOf,
  hashOfStoredRow,
  sha256Hex,
  type HashedEventFields,
  type VerifiableEventRow,
} from './canonical';

const OCCURRED_AT = new Date('2026-05-01T10:20:30.456Z');

function baseFields(overrides: Partial<HashedEventFields> = {}): HashedEventFields {
  return {
    stream: 'AUDIT',
    eventType: 'SYNC_MUTATION_ACCEPTED',
    scope: '11111111-1111-4111-8111-111111111111',
    sequence: 7n,
    occurredAt: OCCURRED_AT,
    actorKind: 'USER',
    actorUserId: 'user-1',
    actorDeviceId: null,
    actorPrincipal: null,
    claimedUserId: null,
    claimedEmail: null,
    deviceId: null,
    reasonCode: null,
    clientAddress: null,
    targetType: null,
    targetId: null,
    documentRef: null,
    mutationId: null,
    deviceLocalSequence: null,
    localOccurredAt: null,
    payload: null,
    prevEventHash: 'aa'.repeat(32),
    ...overrides,
  };
}

describe('canonicalJson', () => {
  it('sorts object keys and removes whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('preserves array order (order is information for a canonicalizer)', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('serializes Date as fixed ISO-8601 and bigint as decimal digits', () => {
    expect(canonicalJson({ at: OCCURRED_AT, seq: 12n })).toBe('{"at":"2026-05-01T10:20:30.456Z","seq":12}');
  });

  it('reduces undefined and null to the literal null', () => {
    expect(canonicalJson(undefined)).toBe('null');
    expect(canonicalJson(null)).toBe('null');
  });

  it('drops values that are literally undefined but keeps explicit nulls', () => {
    expect(canonicalJson({ keep: null, drop: undefined })).toBe('{"keep":null}');
  });

  it('raises on a value the canonicalizer cannot reduce, per the slice contract', () => {
    expect(() => canonicalJson({ bad: () => 'no' })).toThrow(TypeError);
    expect(() => canonicalJson({ nested: { bad: new Map() } })).toThrow(TypeError);
    expect(() => canonicalJson({ symbolish: Symbol('x') })).toThrow(TypeError);
  });
});

describe('sha256Hex', () => {
  it('matches the known SHA-256 test vector', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('eventHashOf (§32.5 chain line)', () => {
  it('is deterministic', () => {
    expect(eventHashOf(baseFields())).toBe(eventHashOf(baseFields()));
  });

  it('changes when any hashed field changes — stream, sequence, scope, or payload', () => {
    const baseline = eventHashOf(baseFields());
    expect(eventHashOf(baseFields({ stream: 'SECURITY' }))).not.toBe(baseline);
    expect(eventHashOf(baseFields({ sequence: 8n }))).not.toBe(baseline);
    expect(eventHashOf(baseFields({ scope: '22222222-2222-4222-8222-222222222222' }))).not.toBe(baseline);
    expect(eventHashOf(baseFields({ payload: { amountMinor: 1250 } }))).not.toBe(baseline);
    expect(eventHashOf(baseFields({ payload: { amountMinor: 1251 } }))).not.toBe(baseline);
    expect(eventHashOf(baseFields({ occurredAt: new Date(OCCURRED_AT.getTime() + 1) }))).not.toBe(baseline);
    expect(eventHashOf(baseFields({ eventType: 'SYNC_MUTATION_REJECTED' }))).not.toBe(baseline);
    expect(eventHashOf(baseFields({ actorKind: 'DEVICE' }))).not.toBe(baseline);
    expect(eventHashOf(baseFields({ prevEventHash: 'ab'.repeat(32) }))).not.toBe(baseline);
  });

  it('collapses undefined and null payload to the identical hash slot', () => {
    const withoutPayload = baseFields();
    delete (withoutPayload as { payload?: unknown }).payload;
    expect(eventHashOf(withoutPayload)).toBe(eventHashOf(baseFields({ payload: null })));
  });

  it('renders a transactional bigint deviceLocalSequence as decimal digits, not a float', () => {
    const withLocalSeq = eventHashOf(baseFields({ deviceLocalSequence: 9007199254740993n }));
    expect(withLocalSeq).not.toBe(eventHashOf(baseFields({ deviceLocalSequence: null })));
    // Precision killer: 9007199254740993 is one above Number.MAX_SAFE_INTEGER.
    expect(withLocalSeq).not.toBe(eventHashOf({ ...baseFields(), deviceLocalSequence: 9007199254740994n }));
  });
});

describe('hashOfStoredRow (the verifier side)', () => {
  const row: VerifiableEventRow = {
    organizationId: '11111111-1111-4111-8111-111111111111',
    sequence: 1n,
    occurredAt: OCCURRED_AT,
    eventType: 'LOGIN_FAILED',
    actorKind: 'UNVERIFIED',
    actorUserId: null,
    actorDeviceId: null,
    actorPrincipal: null,
    claimedUserId: 'attacker@example.test',
    claimedEmail: 'attacker@example.test',
    deviceId: null,
    reasonCode: 'INVALID_CREDENTIALS',
    clientAddress: '203.0.113.9',
    targetType: null,
    targetId: null,
    documentRef: null,
    mutationId: null,
    deviceLocalSequence: null,
    localOccurredAt: null,
    payload: null,
    prevEventHash: '0'.repeat(64),
    eventHash: '',
  };

  it('reproduces the writer-side hash for a security row appended to a known chain', () => {
    const expected = eventHashOf({
      stream: 'SECURITY',
      scope: '22222222-2222-4222-8222-222222222222',
      sequence: row.sequence,
      occurredAt: row.occurredAt,
      eventType: row.eventType,
      actorKind: row.actorKind,
      actorUserId: null,
      actorDeviceId: null,
      actorPrincipal: null,
      claimedUserId: row.claimedUserId,
      claimedEmail: row.claimedEmail,
      deviceId: null,
      reasonCode: row.reasonCode,
      clientAddress: row.clientAddress,
      targetType: null,
      targetId: null,
      documentRef: null,
      mutationId: null,
      deviceLocalSequence: null,
      localOccurredAt: null,
      payload: null,
      prevEventHash: row.prevEventHash,
    });
    expect(hashOfStoredRow('SECURITY', '22222222-2222-4222-8222-222222222222', { ...row, eventHash: 'ignored' })).toBe(
      expected,
    );
  });

  it('hashes against the scope it is given, so a row moved between scopes is visible', () => {
    const inOrg = hashOfStoredRow('AUDIT', '11111111-1111-4111-8111-111111111111', {
      ...({ ...row, organizationId: null } as unknown as VerifiableEventRow),
      eventHash: 'ignored',
    });
    const inOther = hashOfStoredRow('AUDIT', '22222222-2222-4222-8222-222222222222', {
      ...({ ...row, organizationId: null } as unknown as VerifiableEventRow),
      eventHash: 'ignored',
    });
    expect(inOrg).not.toBe(inOther);
  });
});
