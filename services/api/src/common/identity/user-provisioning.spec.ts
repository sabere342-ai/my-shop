/**
 * The identity writer and the canonical email seam (M2-S1).
 *
 * §36.1 T-2 keeps the real proof against PostgreSQL — `postgres.db-spec.ts`
 * proves the lock, the unique constraint, and the transaction — while this
 * suite pins the shapes that must hold before a database is involved: what
 * "canonical" means, that an existing identity is never rewritten, and that the
 * writer acquires its per-email lock *before* it reads, so the caller's lock
 * order (bootstrap key, then email) is a property of the code rather than a
 * convention.
 */

import type { Prisma } from '@prisma/client';
import { canonicalizeEmail, EmailShapeError, findOrCreateUserByEmail, MAX_EMAIL_LENGTH } from './user-provisioning';

interface StoredUser {
  readonly id: string;
  readonly email: string;
  readonly createdAt: Date;
}

interface FakeIdentityTx {
  readonly tx: Prisma.TransactionClient;
  readonly store: StoredUser[];
  /** Boundaries the writer reached, in order, with the advisory-lock key when present. */
  readonly calls: string[];
}

/**
 * An in-memory transaction client for the two surfaces the writer uses. The
 * lock is recorded rather than simulated: what this suite asserts is the
 * *ordering* (lock, then read), which is the property that prevents the
 * deadlock the service documents.
 */
function fakeIdentityTx(options: { readonly initial?: readonly StoredUser[]; readonly failCreate?: Error } = {}) {
  const store: StoredUser[] = [...(options.initial ?? [])];
  const calls: string[] = [];
  let created = 0;

  const tx = {
    $executeRaw: jest.fn((strings: TemplateStringsArray, ...values: readonly unknown[]) => {
      const sql = strings.join('|').toLowerCase();
      if (sql.includes('pg_advisory_xact_lock')) {
        calls.push(`lock:${String(values[0])}`);
      }
      return Promise.resolve(1);
    }),
    user: {
      findUnique: jest.fn((args: { where: { email: string } }) => {
        calls.push(`read:${args.where.email}`);
        return Promise.resolve(store.find((candidate) => candidate.email === args.where.email) ?? null);
      }),
      create: jest.fn((args: { data: { email: string } }) => {
        if (options.failCreate !== undefined) return Promise.reject(options.failCreate);
        created += 1;
        const user: StoredUser = {
          id: `user-${String(created)}`,
          email: args.data.email,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        };
        store.push(user);
        return Promise.resolve(user);
      }),
    },
  };

  const fake: FakeIdentityTx = { tx: tx as unknown as Prisma.TransactionClient, store, calls };
  return { ...fake, mocks: tx };
}

describe('canonicalizeEmail', () => {
  it('trims and lowercases, so two spellings of one address are one identity', () => {
    expect(canonicalizeEmail('  Owner@Example.COM ')).toBe('owner@example.com');
    expect(canonicalizeEmail('OWNER@EXAMPLE.COM')).toBe(canonicalizeEmail('owner@example.com'));
  });

  it('accepts the shapes an operator legitimately types', () => {
    expect(canonicalizeEmail('first.last+tag@shop.example.co.uk')).toBe('first.last+tag@shop.example.co.uk');
    expect(canonicalizeEmail("o'brien@shop.example")).toBe("o'brien@shop.example");
    expect(canonicalizeEmail('a_1-2@localhost')).toBe('a_1-2@localhost');
  });

  it('refuses an empty or blank address', () => {
    expect(() => canonicalizeEmail('')).toThrow(EmailShapeError);
    expect(() => canonicalizeEmail('   ')).toThrow(EmailShapeError);
    expect(() => canonicalizeEmail('')).toThrow(/EMPTY/);
  });

  it('refuses addresses that are too long, by whole address or by part', () => {
    const longLocal = `${'a'.repeat(65)}@example.com`;
    expect(() => canonicalizeEmail(longLocal)).toThrow(/TOO_LONG/);
    expect(() => canonicalizeEmail(`${'a'.repeat(250)}@example.com`)).toThrow(/TOO_LONG/);
    // 254 is the limit, and exactly the limit is accepted.
    const atLimit = `${'a'.repeat(64)}@${'b'.repeat(MAX_EMAIL_LENGTH - 64 - 1)}`;
    expect(canonicalizeEmail(atLimit)).toHaveLength(MAX_EMAIL_LENGTH);
  });

  it('refuses malformed shapes', () => {
    for (const candidate of [
      'no-at-sign',
      '@example.com',
      'owner@',
      'two@@example.com',
      'two@at@example.com',
      'owner@exa..mple.com',
      '.owner@example.com',
      'owner.@example.com',
      'own..er@example.com',
      'owner@-example.com',
      'owner@example-.com',
      'owner name@example.com',
      'owner@exam ple.com',
    ]) {
      expect(() => canonicalizeEmail(candidate)).toThrow(EmailShapeError);
    }
  });
});

/** 254 = the RFC 5321 mailbox limit the module exports as `MAX_EMAIL_LENGTH`. */
describe('findOrCreateUserByEmail', () => {
  const EMAIL = 'owner@example.com';
  const LOCK_ORDER = `lock:identity:user-email:${EMAIL}`;

  it('creates the user when the address is unseen, canonically, and reports it as created', async () => {
    const { tx, store, calls, mocks } = fakeIdentityTx();

    const provisioned = await findOrCreateUserByEmail(tx, '  Owner@Example.COM ');

    expect(provisioned.created).toBe(true);
    expect(provisioned.user.email).toBe(EMAIL);
    expect(store).toHaveLength(1);
    expect(mocks.user.create).toHaveBeenCalledWith({ data: { email: EMAIL } });
    // The lock is acquired before the lookup — the order the tenancy service
    // depends on to make deadlocks impossible (§8.4).
    expect(calls).toEqual([LOCK_ORDER, `read:${EMAIL}`]);
  });

  it('answers an existing identity without rewriting it', async () => {
    const existing: StoredUser = { id: 'user-existing', email: EMAIL, createdAt: new Date('2025-12-31T00:00:00.000Z') };
    const { tx, store, mocks } = fakeIdentityTx({ initial: [existing] });

    const provisioned = await findOrCreateUserByEmail(tx, EMAIL);

    expect(provisioned.created).toBe(false);
    expect(provisioned.user).toBe(existing);
    expect(store).toHaveLength(1);
    expect(mocks.user.create).not.toHaveBeenCalled();
    // No UPDATE surface exists on the fake, because none exists in the writer:
    // a stored email is an identity fact, never a request parameter.
    expect(mocks.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('refuses an invalid address before any statement runs', async () => {
    const { tx, calls, mocks } = fakeIdentityTx();

    await expect(findOrCreateUserByEmail(tx, 'not-an-address')).rejects.toBeInstanceOf(EmailShapeError);

    expect(calls).toEqual([]);
    expect(mocks.$executeRaw).not.toHaveBeenCalled();
    expect(mocks.user.findUnique).not.toHaveBeenCalled();
    expect(mocks.user.create).not.toHaveBeenCalled();
  });

  it('propagates a unique violation untouched instead of retrying inside the transaction', async () => {
    // PostgreSQL aborts the whole transaction on a unique violation, so an
    // in-transaction re-read would itself fail. Translation is the caller's
    // job, after the transaction has ended — and this suite pins that the
    // writer does not pretend otherwise.
    const uniqueViolation = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: ['email'] },
    });
    const { tx, mocks } = fakeIdentityTx({ failCreate: uniqueViolation });

    await expect(findOrCreateUserByEmail(tx, EMAIL)).rejects.toBe(uniqueViolation);

    expect(mocks.user.findUnique).toHaveBeenCalledTimes(1);
    expect(mocks.user.create).toHaveBeenCalledTimes(1);
  });
});
