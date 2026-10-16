/**
 * Unit acceptance for the failed-attempt backoff (§10.2, AC-25, AC-26).
 *
 * §10.2 forbids a permanent lockout, so the properties that matter are the ones that
 * keep the block *bounded*: the first free attempts never block, the delay doubles
 * and then caps, and a failure after the block has decayed starts a fresh run rather
 * than accumulating forever. The arithmetic is a pure function, so all of this is
 * asserted with an injected clock and an in-memory store — no database.
 */

import { DomainError } from '../errors/domain.error';
import { ERROR_CODES } from '../errors/problem';
import {
  AuthThrottle,
  delaySecondsFor,
  isBlocked,
  nextFailure,
  type AuthThrottleRow,
  type AuthThrottleStore,
  type ThrottlePolicy,
} from './auth-throttle';

const POLICY: ThrottlePolicy = { freeAttempts: 5, baseDelaySeconds: 1, maxDelaySeconds: 900 };
const T0 = new Date('2026-01-01T00:00:00.000Z');

/** A store that keeps rows in a map, so the class is exercised without Prisma. */
class MemoryStore implements AuthThrottleStore {
  readonly rows = new Map<string, AuthThrottleRow>();

  read(key: string): Promise<AuthThrottleRow | null> {
    return Promise.resolve(this.rows.get(key) ?? null);
  }

  write(row: AuthThrottleRow): Promise<void> {
    this.rows.set(row.key, row);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.rows.delete(key);
    return Promise.resolve();
  }
}

describe('throttle backoff arithmetic', () => {
  it('does not block within the free attempts', () => {
    for (let count = 1; count < POLICY.freeAttempts; count += 1) {
      expect(delaySecondsFor(count, POLICY)).toBe(0);
    }
  });

  it('applies the base delay at the first blocking failure, then doubles', () => {
    expect(delaySecondsFor(5, POLICY)).toBe(1);
    expect(delaySecondsFor(6, POLICY)).toBe(2);
    expect(delaySecondsFor(7, POLICY)).toBe(4);
    expect(delaySecondsFor(8, POLICY)).toBe(8);
  });

  it('caps the delay so no run can block forever — the §10.2 no-permanent-lockout rule', () => {
    expect(delaySecondsFor(9, POLICY)).toBe(16);
    expect(delaySecondsFor(15, POLICY)).toBe(900);
    expect(delaySecondsFor(100, POLICY)).toBe(900);
    expect(delaySecondsFor(1000, POLICY)).toBe(900);
  });

  it('a fresh run starts at one failure and never blocks within the free attempts', () => {
    const next = nextFailure(null, POLICY, T0);
    expect(next).toEqual({ failureCount: 1, firstFailureAt: T0, lastFailureAt: T0, blockedUntil: null });
  });

  it('continues a run that is within the decay window', () => {
    const first = nextFailure(null, POLICY, T0);
    const second = nextFailure(first, POLICY, new Date(T0.getTime() + 1000));

    expect(second.failureCount).toBe(2);
    expect(second.firstFailureAt).toEqual(T0);
    expect(second.blockedUntil).toBeNull();
  });

  it('starts a fresh run once the window has decayed', () => {
    let state = null as ReturnType<typeof nextFailure> | null;
    for (let count = 0; count < 6; count += 1) {
      state = nextFailure(state, POLICY, new Date(T0.getTime() + count * 1000));
    }
    expect(state?.failureCount).toBe(6);
    expect(state?.blockedUntil).not.toBeNull();

    // A failure more than maxDelay after the previous one is a new run.
    const afterDecay = nextFailure(state, POLICY, new Date(T0.getTime() + (POLICY.maxDelaySeconds + 10) * 1000));
    expect(afterDecay.failureCount).toBe(1);
    expect(afterDecay.blockedUntil).toBeNull();
  });

  it('isBlocked is true only while the bound is in the future', () => {
    const blocked = {
      failureCount: 6,
      firstFailureAt: T0,
      lastFailureAt: T0,
      blockedUntil: new Date(T0.getTime() + 2000),
    };
    expect(isBlocked(blocked, T0)).toBe(true);
    expect(isBlocked(blocked, new Date(T0.getTime() + 2000))).toBe(false);
    expect(isBlocked(null, T0)).toBe(false);
  });
});

describe('throttle over keys', () => {
  it('records a failure against every key independently', async () => {
    const store = new MemoryStore();
    const throttle = new AuthThrottle(store, POLICY);

    await throttle.recordFailure(['login:account:a@example.com', 'login:address:1.2.3.4'], T0);

    expect(store.rows.get('login:account:a@example.com')?.failureCount).toBe(1);
    expect(store.rows.get('login:address:1.2.3.4')?.failureCount).toBe(1);
  });

  it('throws RATE_LIMITED once a key is blocked', async () => {
    const store = new MemoryStore();
    const throttle = new AuthThrottle(store, POLICY);
    const keys = ['login:account:a@example.com'];

    for (let count = 0; count < POLICY.freeAttempts; count += 1) {
      await throttle.recordFailure(keys, T0);
    }
    await expect(throttle.assertNotBlocked(keys, T0)).rejects.toBeInstanceOf(DomainError);
    await expect(throttle.assertNotBlocked(keys, T0)).rejects.toMatchObject({ code: ERROR_CODES.RATE_LIMITED });

    // The block is bounded: past `blockedUntil` the key is usable again.
    await expect(throttle.assertNotBlocked(keys, new Date(T0.getTime() + 10_000))).resolves.toBeUndefined();
  });

  it('does not block while within the free attempts', async () => {
    const store = new MemoryStore();
    const throttle = new AuthThrottle(store, POLICY);
    const keys = ['login:address:1.2.3.4'];

    await throttle.recordFailure(keys, T0);
    await expect(throttle.assertNotBlocked(keys, T0)).resolves.toBeUndefined();
  });

  it('clears a run on success, which is also the administrative unlock', async () => {
    const store = new MemoryStore();
    const throttle = new AuthThrottle(store, POLICY);
    const keys = ['login:account:a@example.com'];

    await throttle.recordFailure(keys, T0);
    await throttle.clear(keys);
    expect(store.rows.has('login:account:a@example.com')).toBe(false);
  });
});
