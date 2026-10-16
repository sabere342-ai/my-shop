/**
 * §10.2 / §40.6 M2-S2 — bounded failed-attempt backoff.
 *
 * §10.2 forbids a permanent lockout and requires failed-attempt counting with
 * exponential backoff plus a security audit event, with an administrative unlock.
 * This file is the counting and the backoff; the audit event is raised by the
 * caller through `SecurityEventSink`, and the administrative unlock is the operator
 * deleting the row (or the successful login clearing it), which is possible because
 * the block is always bounded.
 *
 * **The curve.** The first `freeAttempts` failures do not block — a person who
 * mistypes twice has not attacked anything. From there the delay doubles per
 * failure (`baseDelay * 2^(n - freeAttempts)`) and is capped at `maxDelaySeconds`.
 * Because the cap exists, there is no `n` that blocks forever: the worst case is
 * `maxDelaySeconds` between attempts, which is a speed bump, not a lockout.
 *
 * **The run resets.** A failure more than `maxDelaySeconds` after the previous one
 * begins a fresh run. By then the previous block has fully decayed, so carrying the
 * counter forward would punish a user for one typo per day with a growing delay —
 * the "permanent lockout by accumulation" §10.2 rules out in spirit.
 *
 * The backoff arithmetic is a pure function (`nextFailure`/`delaySecondsFor`) so it
 * is unit-tested without a database; the class is the thin storage orchestration.
 */

import { DomainError } from '../errors/domain.error';
import { ERROR_CODES } from '../errors/problem';
import type { PrismaHost } from './prisma-host';

/** The backoff policy, taken from validated configuration. */
export interface ThrottlePolicy {
  /** Failures before any blocking begins. */
  readonly freeAttempts: number;
  /** The delay after the `freeAttempts`-th failure, in seconds. */
  readonly baseDelaySeconds: number;
  /** The ceiling on the delay, in seconds. Never exceeded, so blocking is bounded. */
  readonly maxDelaySeconds: number;
}

/** One throttle row, as the arithmetic needs it. */
export interface ThrottleState {
  readonly failureCount: number;
  readonly firstFailureAt: Date;
  readonly lastFailureAt: Date;
  readonly blockedUntil: Date | null;
}

/** One persisted throttle row. */
export interface AuthThrottleRow extends ThrottleState {
  readonly key: string;
}

/** The storage the throttle needs. Narrow so a unit test needs no Prisma. */
export interface AuthThrottleStore {
  read(key: string): Promise<AuthThrottleRow | null>;
  write(row: AuthThrottleRow): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * The delay, in seconds, that a run of `failureCount` failures earns.
 *
 * Zero while the run is within the free attempts, then doubling, then capped. The
 * cap is applied with `Math.min`, and because `2 ** exponent` saturates to
 * `Infinity` for a large exponent the cap still holds — a long run can never
 * overflow into an unbounded block.
 */
export function delaySecondsFor(failureCount: number, policy: ThrottlePolicy): number {
  if (failureCount < policy.freeAttempts) {
    return 0;
  }
  const exponent = failureCount - policy.freeAttempts;
  const delay = policy.baseDelaySeconds * 2 ** exponent;
  return Math.min(Math.max(delay, policy.baseDelaySeconds), policy.maxDelaySeconds);
}

/**
 * The next row after one more failure, given the current row (or `null`).
 *
 * Pure: it reads no clock beyond the `now` it is given, so a test can drive it
 * deterministically.
 */
export function nextFailure(state: ThrottleState | null, policy: ThrottlePolicy, now: Date): ThrottleState {
  const withinRun = state !== null && now.getTime() - state.lastFailureAt.getTime() < policy.maxDelaySeconds * 1000;

  const failureCount = withinRun ? state.failureCount + 1 : 1;
  const firstFailureAt = withinRun ? state.firstFailureAt : now;
  const delaySeconds = delaySecondsFor(failureCount, policy);

  return {
    failureCount,
    firstFailureAt,
    lastFailureAt: now,
    blockedUntil: delaySeconds === 0 ? null : new Date(now.getTime() + delaySeconds * 1000),
  };
}

/** Whether a row currently blocks, and for how much longer. */
export function isBlocked(state: ThrottleState | null, now: Date): boolean {
  return state !== null && state.blockedUntil !== null && now.getTime() < state.blockedUntil.getTime();
}

/**
 * The throttle over one or more keys.
 *
 * A login is throttled under two keys — the account and the client address — so one
 * person mistyping cannot lock an office out of a shared account and one source
 * cannot grind many accounts. Each key is counted independently.
 */
export class AuthThrottle {
  constructor(
    private readonly store: AuthThrottleStore,
    private readonly policy: ThrottlePolicy,
  ) {}

  /** Throws `RATE_LIMITED` if any key is currently blocked. */
  async assertNotBlocked(keys: readonly string[], now: Date = new Date()): Promise<void> {
    for (const key of keys) {
      const row = await this.store.read(key);
      if (isBlocked(row, now)) {
        throw new DomainError(
          ERROR_CODES.RATE_LIMITED,
          'login refused by failed-attempt backoff; the block is bounded and the row is the unlock',
        );
      }
    }
  }

  /** Records one failed attempt against every key. */
  async recordFailure(keys: readonly string[], now: Date = new Date()): Promise<void> {
    for (const key of keys) {
      const row = await this.store.read(key);
      const next = nextFailure(row, this.policy, now);
      await this.store.write({ key, ...next });
    }
  }

  /** Clears the run for every key after a success (and is the administrative unlock). */
  async clear(keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      await this.store.delete(key);
    }
  }
}

/** The `auth_throttles` table, through Prisma. */
export class PrismaAuthThrottleStore implements AuthThrottleStore {
  constructor(private readonly host: PrismaHost) {}

  async read(key: string): Promise<AuthThrottleRow | null> {
    const row = await this.host.prisma.authThrottle.findUnique({ where: { key } });
    if (row === null) {
      return null;
    }
    return {
      key: row.key,
      failureCount: row.failureCount,
      firstFailureAt: row.firstFailureAt,
      lastFailureAt: row.lastFailureAt,
      blockedUntil: row.blockedUntil,
    };
  }

  async write(row: AuthThrottleRow): Promise<void> {
    await this.host.prisma.authThrottle.upsert({
      where: { key: row.key },
      create: {
        key: row.key,
        failureCount: row.failureCount,
        firstFailureAt: row.firstFailureAt,
        lastFailureAt: row.lastFailureAt,
        blockedUntil: row.blockedUntil,
      },
      update: {
        failureCount: row.failureCount,
        firstFailureAt: row.firstFailureAt,
        lastFailureAt: row.lastFailureAt,
        blockedUntil: row.blockedUntil,
      },
    });
  }

  async delete(key: string): Promise<void> {
    // `deleteMany` is a no-op when the row is absent, which is what "clear a run
    // that may not exist" should be — never a thrown not-found.
    await this.host.prisma.authThrottle.deleteMany({ where: { key } });
  }
}
