/**
 * Readiness check registry.
 *
 * Master Plan §37.4 requires the deployment smoke check to hit `/readyz`, and §37.4
 * fixes the order: migrations first, then rollout, then the smoke check. For that order
 * to be safe, `/readyz` must be able to say "not ready yet" while the database is
 * still migrating — which is why checks are a registry rather than a hard-coded probe.
 *
 * The registry is empty in M1-S2 by design. The database check arrives in M1-S3, where a
 * real connection exists to check. An empty registry makes `/readyz` answer `ready:
 * true`, which is a **truthful** answer for a process with no dependencies — not a
 * fabricated one, and not a stub pretending to verify something.
 */

import { Injectable } from '@nestjs/common';

export type ReadinessCheck = () => Promise<{ readonly ok: boolean; readonly reason?: string }>;

export interface ReadinessDetail {
  readonly ok: boolean;
  /** Safe for an unauthenticated caller: a short class of failure, never a diagnostic. */
  readonly reason?: string;
}

export interface ReadinessReport {
  readonly ready: boolean;
  readonly checks: Readonly<Record<string, ReadinessDetail>>;
}

@Injectable()
export class ReadinessRegistry {
  private readonly checks = new Map<string, ReadinessCheck>();

  /**
   * @param name Uniquely identifies the check. Appears in the report, so it must not
   *   embed a connection string or a host name.
   */
  register(name: string, check: ReadinessCheck): void {
    this.checks.set(name, check);
  }

  async report(): Promise<ReadinessReport> {
    const entries = await Promise.all(
      [...this.checks.entries()].map(async ([name, check]) => {
        try {
          const outcome = await check();
          return [name, outcome] as const;
        } catch (error) {
          // A check that throws is a failed check, not a failed readiness report. The
          // reason is a generic class name: the detail goes to the log, and an
          // unauthenticated caller must not learn which dependency failed or why.
          const reason = error instanceof Error ? error.constructor.name : 'UnknownError';
          return [name, { ok: false, reason }] as const;
        }
      }),
    );

    const checks: Record<string, ReadinessDetail> = {};
    for (const [name, detail] of entries) {
      checks[name] = detail;
    }

    return { ready: entries.every(([, detail]) => detail.ok), checks };
  }
}
