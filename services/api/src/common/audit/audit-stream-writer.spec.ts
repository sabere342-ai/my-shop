/**
 * Unit tests for the transactional audit-stream writer (§32.5) and the class-B
 * durable writers (`durable-security-event-sink.ts`, points 9–11 of the
 * M2-S6 slice record).
 *
 * Pinned here, against an in-memory stand-in of the four statements the
 * append makes on its transaction client:
 *
 * - vocabulary enforcement: the closed §32.2A/§32.3 lists, before anything is
 *   allocated;
 * - actor attribution consistency (§32.6): kind/field pairs, and UNVERIFIED
 *   existing only in the security stream;
 * - payload provenance: plain JSON objects only, validated before any
 *   sequence space is consumed;
 * - allocation + chain law over the shared head state: gapless sequences,
 *   every row chaining to its scope's previous committed hash, the head
 *   advanced atomically with the row;
 * - the class-B policy: the outcome is recorded in its own transaction, the
 *   call never throws, and a persistence failure degrades to the logged warn
 *   line, never to a changed outcome.
 */

import { Prisma, type Prisma as PrismaTypes } from '@prisma/client';
import { AuditStreamWriter } from './audit-stream-writer';
import { DurableAuditRecorder, DurableSecurityEventSink } from './durable-security-event-sink';
import { eventHashOf } from './canonical';
import {
  AUDIT_STREAMS,
  GENESIS_HASH,
  GLOBAL_SECURITY_SCOPE,
  SECURITY_EVENT_TYPES,
  type AuditActor,
  type AuditEventInput,
  type AuditPayload,
  type SecurityEventInput,
} from './stream.contract';
import type { SecurityEvent as IdentitySecurityEvent } from '../identity/security-event.sink';

/** The shared, in-memory "audit schema" every fake transaction works against. */
interface AuditDb {
  readonly heads: Map<string, { last_sequence: bigint; last_event_hash: string }>;
  readonly audit: Record<string, unknown>[];
  readonly security: Record<string, unknown>[];
}

interface Scenario {
  /** The environment aborts this step once (a simulated constraint failure). */
  readonly failOnInsert?: boolean;
}

function fakeAuditTx(db: AuditDb, scenario: Scenario = {}): PrismaTypes.TransactionClient {
  const headKey = (stream: unknown, scope: unknown): string => `${String(stream)}|${String(scope)}`;
  let failed = false;
  // The fake models the jsonb column's serialization: a Date inside a payload
  // becomes the ISO string the database would hold.
  const serializePayload = (payload: unknown): unknown =>
    payload === undefined || payload === null || payload === Prisma.DbNull
      ? payload
      : JSON.parse(JSON.stringify(payload));
  const tx = {
    $executeRaw: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('|');
      if (sql.includes('pg_advisory_xact_lock')) return Promise.resolve(0);
      if (sql.includes('audit_stream_heads') && sql.includes('INSERT INTO')) {
        const key = headKey(values[0], values[1]);
        if (!db.heads.has(key)) {
          db.heads.set(key, { last_sequence: 0n, last_event_hash: GENESIS_HASH });
        }
        return Promise.resolve(0);
      }
      if (sql.includes('audit_stream_heads') && sql.includes('UPDATE') && sql.includes('last_sequence')) {
        db.heads.set(headKey(values[2], values[3]), {
          last_sequence: values[0] as bigint,
          last_event_hash: values[1] as string,
        });
        return Promise.resolve(1);
      }
      return Promise.resolve(0);
    }),
    $queryRaw: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('|');
      if (sql.includes('audit_stream_heads') && sql.includes('FOR UPDATE')) {
        const head = db.heads.get(headKey(values[0], values[1]));
        return Promise.resolve(
          head === undefined ? [] : [{ last_sequence: head.last_sequence, last_event_hash: head.last_event_hash }],
        );
      }
      return Promise.resolve([]);
    }),
    auditEvent: {
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        if (scenario.failOnInsert && !failed) {
          failed = true;
          return Promise.reject(new Error('integrity constraint violation: simulated insert failure'));
        }
        db.audit.push({ ...args.data, payload: serializePayload(args.data.payload) });
        return Promise.resolve(args.data);
      }),
    },
    securityEvent: {
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        db.security.push({ ...args.data, payload: serializePayload(args.data.payload) });
        return Promise.resolve(args.data);
      }),
    },
  };
  return tx as unknown as PrismaTypes.TransactionClient;
}

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const DEVICE = '33333333-3333-4333-8333-333333333333';
const USER = '44444444-4444-4444-8444-444444444444';
const AT = new Date('2026-05-01T09:00:00.000Z');

function db(): AuditDb {
  return { heads: new Map(), audit: [], security: [] };
}

function auditInput(overrides: Partial<AuditEventInput> = {}): AuditEventInput {
  return {
    eventType: 'SYNC_MUTATION_ACCEPTED',
    organizationId: ORG,
    actor: { kind: 'DEVICE', deviceId: DEVICE },
    occurredAt: AT,
    mutationId: 'mutation-1',
    payload: { resultRef: 'sales/sale-1', serverSequence: '3' },
    ...overrides,
  };
}

function securityInput(overrides: Partial<SecurityEventInput> = {}): SecurityEventInput {
  return {
    eventType: 'LOGIN_FAILED',
    actor: { kind: 'UNVERIFIED', claimedEmail: 'attacker@example.test' },
    occurredAt: AT,
    reasonCode: 'INVALID_CREDENTIALS',
    clientAddress: '203.0.113.9',
    ...overrides,
  };
}

function asEventType(name: string): AuditEventInput['eventType'] {
  return name as AuditEventInput['eventType'];
}

describe('AuditStreamWriter — the closed vocabularies (§32.2A/§32.3)', () => {
  it('rejects an event type no stream knows, before any allocation', async () => {
    const store = db();
    const writer = new AuditStreamWriter();
    await expect(
      writer.appendAuditEvent(fakeAuditTx(store), auditInput({ eventType: asEventType('SOMETHING_UNKNOWN') })),
    ).rejects.toThrow('does not know the event type');
    expect(store.audit).toHaveLength(0);
    expect(store.heads.size).toBe(0);
  });

  it('rejects the security vocabulary on the audit stream and vice versa', async () => {
    const store = db();
    const writer = new AuditStreamWriter();
    await expect(
      writer.appendAuditEvent(fakeAuditTx(store), auditInput({ eventType: asEventType('LOGIN_FAILED') })),
    ).rejects.toThrow('does not know the event type');
    await expect(
      writer.appendSecurityEvent(
        fakeAuditTx(store),
        securityInput({ eventType: asEventType('SYNC_MUTATION_ACCEPTED') } as Partial<SecurityEventInput>),
      ),
    ).rejects.toThrow('does not know the event type');
    expect(store.audit).toHaveLength(0);
    expect(store.heads.size).toBe(0);
  });

  it('rejects identifiers that are not canonical closed-vocabulary names', async () => {
    const writer = new AuditStreamWriter();
    await expect(
      writer.appendAuditEvent(fakeAuditTx(db()), auditInput({ eventType: asEventType('lower_case') })),
    ).rejects.toThrow('not a valid closed-vocabulary identifier');
  });

  it('exposes exactly the documented vocabulary lists for the tests that pin them', () => {
    expect(AUDIT_STREAMS).toEqual(['AUDIT', 'SECURITY']);
    expect(SECURITY_EVENT_TYPES).toContain('SYNC_IDENTITY_MISMATCH');
    expect(SECURITY_EVENT_TYPES).toContain('SYNC_MUTATION_CONTRADICTION');
  });
});

describe('AuditStreamWriter — actor attribution consistency (§32.6)', () => {
  const writer = new AuditStreamWriter();

  const cases: readonly {
    readonly name: string;
    readonly actor: AuditActor;
    readonly expected: RegExp;
  }[] = [
    {
      name: 'a USER actor without a verified user id',
      actor: { kind: 'USER' },
      expected: /carries a verified user id/,
    },
    {
      name: 'a USER actor with a principal name',
      actor: { kind: 'USER', userId: USER, principal: 'x' },
      expected: /no principal name/,
    },
    {
      name: 'a DEVICE actor without a server-resolved device',
      actor: { kind: 'DEVICE' },
      expected: /carries a server-resolved device id/,
    },
    {
      name: 'a DEVICE actor claiming a user id',
      actor: { kind: 'DEVICE', deviceId: DEVICE, userId: USER },
      expected: /no user id or principal name/,
    },
    {
      name: 'a SYSTEM actor without its documented principal',
      actor: { kind: 'SYSTEM' },
      expected: /names its documented principal/,
    },
    {
      name: 'a SYSTEM actor with user attribution',
      actor: { kind: 'SYSTEM', principal: 'system:identity', userId: USER },
      expected: /no user or device id/,
    },
  ];

  for (const { name, actor, expected } of cases) {
    it(`refuses ${name}`, async () => {
      await expect(writer.appendAuditEvent(fakeAuditTx(db()), auditInput({ actor }))).rejects.toThrow(expected);
    });
  }

  it('refuses UNVERIFIED actors outside the security stream', async () => {
    const actor: AuditActor = { kind: 'UNVERIFIED', claimedEmail: 'attacker@example.test' };
    await expect(writer.appendAuditEvent(fakeAuditTx(db()), auditInput({ actor }))).rejects.toThrow(
      'exists only in the security stream',
    );
    await expect(writer.appendSecurityEvent(fakeAuditTx(db()), securityInput({ actor }))).resolves.toBeUndefined();
  });

  it('refuses an UNVERIFIED actor that claims a verified identity attribute', async () => {
    const actor: AuditActor = { kind: 'UNVERIFIED', claimedEmail: 'a@example.test', deviceId: DEVICE };
    await expect(writer.appendSecurityEvent(fakeAuditTx(db()), securityInput({ actor }))).rejects.toThrow(
      /must not claim a verified identity/,
    );
  });
});

describe('AuditStreamWriter — payload provenance and early rejection', () => {
  const writer = new AuditStreamWriter();

  it('refuses non-plain payloads', async () => {
    const store = db();
    await expect(writer.appendAuditEvent(fakeAuditTx(store), auditInput({ payload: [1, 2] }))).rejects.toThrow(
      'a plain object',
    );
    await expect(
      writer.appendAuditEvent(
        fakeAuditTx(store),
        auditInput({ payload: { bad: (): string => 'no' } as unknown as AuditPayload }),
      ),
    ).rejects.toThrow(TypeError);
  });

  it('serializes a Date payload field deterministically (ISO-8601), never as a class instance', async () => {
    const store = db();
    await writer.appendAuditEvent(fakeAuditTx(store), auditInput({ payload: { when: AT } as unknown as AuditPayload }));
    expect(store.audit[0]?.payload).toEqual({ when: AT.toISOString() });
  });

  it('fails a poisoned payload before any sequence space or head state is consumed', async () => {
    const store = db();
    await expect(
      writer.appendAuditEvent(
        fakeAuditTx(store),
        auditInput({ payload: { bad: (): string => 'no' } as unknown as AuditPayload }),
      ),
    ).rejects.toThrow(TypeError);
    expect(store.heads.size).toBe(0);
    expect(store.audit).toHaveLength(0);
    // A following clean append still allocates 1 — the failed one never moved the head.
    await writer.appendAuditEvent(fakeAuditTx(store), auditInput());
    expect(store.audit.map((row) => row.sequence)).toEqual([1n]);
  });

  it('stores an absent payload as the NULL jsonb, never a bare object', async () => {
    const store = db();
    await writer.appendAuditEvent(fakeAuditTx(store), auditInput({ payload: null }));
    expect(store.audit[0]?.payload === Prisma.DbNull).toBe(true);
  });
});

describe('AuditStreamWriter — allocation, chain, and head law (§32.5)', () => {
  it('allocates gapless sequences per scope and chains each row to the previous committed hash', async () => {
    const store = db();
    const writer = new AuditStreamWriter();

    await writer.appendAuditEvent(fakeAuditTx(store), auditInput());
    await writer.appendAuditEvent(fakeAuditTx(store), auditInput({ mutationId: 'mutation-2' }));
    await writer.appendSecurityEvent(fakeAuditTx(store), securityInput({ organizationId: ORG }));

    expect(store.audit.map((row) => row.sequence)).toEqual([1n, 2n]);
    expect(store.audit[0]?.prevEventHash).toBe(GENESIS_HASH);
    expect(store.audit[1]?.prevEventHash).toBe(store.audit[0]?.eventHash);

    // A different (stream, scope) is a different chain, and starts at genesis.
    expect(store.security[0]?.prevEventHash).toBe(GENESIS_HASH);
    expect(store.heads.get(`SECURITY|${ORG}`)?.last_event_hash).toBe(store.security[0]?.eventHash);

    const head = store.heads.get(`AUDIT|${ORG}`);
    expect(head).toBeDefined();
    expect(head?.last_sequence).toBe(2n);
    expect(head?.last_event_hash).toBe(store.audit[1]?.eventHash);
  });

  it('keeps separate chains per (stream, scope): another tenant starts at 1 from genesis', async () => {
    const store = db();
    const writer = new AuditStreamWriter();
    await writer.appendAuditEvent(fakeAuditTx(store), auditInput());
    await writer.appendAuditEvent(fakeAuditTx(store), auditInput({ organizationId: OTHER_ORG }));
    expect(store.audit.map((row) => row.sequence)).toEqual([1n, 1n]);
    expect(store.audit[0]?.organizationId).toBe(ORG);
    expect(store.audit[1]?.organizationId).toBe(OTHER_ORG);
    expect(store.audit[1]?.prevEventHash).toBe(GENESIS_HASH);
  });

  it('routes the GLOBAL security partition to the nil scope with a NULL organization', async () => {
    const store = db();
    await new AuditStreamWriter().appendSecurityEvent(fakeAuditTx(store), securityInput());
    const row = store.security[0];
    expect(row?.organizationId).toBeNull();
    const head = store.heads.get(`SECURITY|${GLOBAL_SECURITY_SCOPE}`);
    expect(head?.last_sequence).toBe(1n);
    expect(head?.last_event_hash).toBe(row?.eventHash);
  });

  it('marks tenant security rows on the TENANT partition with their verified organization', async () => {
    const store = db();
    await new AuditStreamWriter().appendSecurityEvent(fakeAuditTx(store), securityInput({ organizationId: ORG }));
    expect(store.security[0]?.organizationId).toBe(ORG);
  });

  it('carries the event hash the canonical verifier logic recomputes from the row', async () => {
    const store = db();
    await new AuditStreamWriter().appendAuditEvent(fakeAuditTx(store), auditInput());
    const row = store.audit[0] as Record<string, unknown>;
    const recomputed = eventHashOf({
      stream: 'AUDIT',
      scope: String(row.organizationId),
      sequence: row.sequence as bigint,
      occurredAt: row.occurredAt as Date,
      eventType: String(row.eventType),
      actorKind: String(row.actorKind),
      actorUserId: (row.actorUserId as string | null) ?? null,
      actorDeviceId: (row.actorDeviceId as string | null) ?? null,
      actorPrincipal: null,
      claimedUserId: null,
      claimedEmail: null,
      deviceId: null,
      reasonCode: null,
      clientAddress: null,
      targetType: (row.targetType as string | null) ?? null,
      targetId: (row.targetId as string | null) ?? null,
      documentRef: (row.documentRef as string | null) ?? null,
      mutationId: (row.mutationId as string | null) ?? null,
      deviceLocalSequence: (row.deviceLocalSequence as bigint | null) ?? null,
      localOccurredAt: (row.localOccurredAt as Date | null) ?? null,
      payload: (row.payload as Record<string, unknown> | null) ?? null,
      prevEventHash: String(row.prevEventHash),
    });
    expect(recomputed).toBe(row.eventHash);
  });

  it('leaves the head untouched when the insert fails — the next committed append reuses the value', async () => {
    const store = db();
    const writer = new AuditStreamWriter();
    await writer.appendAuditEvent(fakeAuditTx(store), auditInput());
    const headAfterFirst = store.heads.get(`AUDIT|${ORG}`);
    expect(headAfterFirst).toBeDefined();

    // The failing append happens inside its own transaction that rolls back;
    // the fake models that by throwing from the insert and revealing the head.
    await expect(writer.appendAuditEvent(fakeAuditTx(store, { failOnInsert: true }), auditInput())).rejects.toThrow(
      'simulated insert failure',
    );
    expect(store.heads.get(`AUDIT|${ORG}`)).toEqual(headAfterFirst);

    await writer.appendAuditEvent(fakeAuditTx(store), auditInput({ mutationId: 'mutation-3' }));
    // Sequence 2 was allocated by the rolled-back attempt — the committed
    // series reuses it: gaplessness is a property of the allocation law.
    expect(store.audit.map((row) => row.sequence)).toEqual([1n, 2n]);
  });
});

describe('class-B durable writers (points 9–11 of the M2-S6 slice record)', () => {
  /** Drains the fire-and-forget persistence chain — 10 macrotask hops cover it. */
  async function flushPersistence(): Promise<void> {
    for (let index = 0; index < 10; index += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  function hostOver(store: AuditDb, scenario: Scenario = {}): { prisma: unknown } {
    return {
      prisma: {
        $transaction: (fn: (tx: PrismaTypes.TransactionClient) => Promise<unknown>) =>
          Promise.resolve(fn(fakeAuditTx(store, scenario))),
      },
    };
  }

  it('records the tenant event in its own short transaction and never throws into the caller', async () => {
    const store = db();
    const warn = jest.fn();
    const recorder = new DurableAuditRecorder(hostOver(store) as never, { warn } as never);

    expect(() => recorder.recordTenantAuditEvent(auditInput())).not.toThrow();
    await flushPersistence();

    expect(store.audit).toHaveLength(1);
    expect(store.audit[0]?.organizationId).toBe(ORG);
    expect(warn).not.toHaveBeenCalled();
  });

  it('degrades a failed class-B persistence to the logged warn line, never an outcome change', async () => {
    const store = db();
    const warn = jest.fn();
    const recorder = new DurableAuditRecorder(hostOver(store, { failOnInsert: true }) as never, { warn } as never);

    expect(() => recorder.recordTenantAuditEvent(auditInput())).not.toThrow();
    await flushPersistence();

    expect(store.audit).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        component: 'audit',
        reason: 'SYNC_MUTATION_ACCEPTED',
        persistenceFailure: 'Error',
      }),
      expect.stringContaining('persistence failed'),
    );
  });

  it('routes the sink event without a verified organization to the GLOBAL partition', async () => {
    const store = db();
    const sink = new DurableSecurityEventSink(hostOver(store) as never);
    const event: IdentitySecurityEvent = {
      type: 'LOGIN_FAILED',
      actorKind: 'UNVERIFIED',
      claimedEmail: 'attacker@example.test',
      errorCode: 'INVALID_CREDENTIALS',
      clientAddress: '203.0.113.9',
    } as unknown as IdentitySecurityEvent;

    expect(() => sink.record(event)).not.toThrow();
    await flushPersistence();

    expect(store.security).toHaveLength(1);
    expect(store.security[0]?.organizationId).toBeNull();
    expect(store.security[0]?.claimedEmail).toBe('attacker@example.test');
    expect(store.heads.has(`SECURITY|${GLOBAL_SECURITY_SCOPE}`)).toBe(true);
  });

  it('never lets a persistence failure escape record()', async () => {
    const store = db();
    const warn = jest.fn();

    // Force the durable write itself to fail: the row insert rejects.
    const broken = fakeAuditTx(store, { failOnInsert: true });
    const host = {
      prisma: { $transaction: (fn: (t: PrismaTypes.TransactionClient) => Promise<unknown>) => fn(broken) },
    };
    const sink = new DurableSecurityEventSink(host as never, { warn } as never);

    expect(() => sink.record(securityInput() as unknown as IdentitySecurityEvent)).not.toThrow();
    await flushPersistence();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ component: 'identity', persistenceFailure: 'Error' }),
      expect.stringContaining('persistence failed'),
    );
    expect(store.security).toHaveLength(0);
  });
});
