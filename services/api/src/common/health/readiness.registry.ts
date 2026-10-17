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
import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';

export type ReadinessCheck = () => Promise<{ readonly ok: boolean; readonly reason?: string }>;

/**
 * One check's outcome inside a readiness report (Master Plan §37.4).
 *
 * A class rather than an interface so the OpenAPI document is generated from the
 * same type the handler returns (Master Plan §7.1, ADR-001).
 */
export class ReadinessDetail {
  @ApiProperty({
    description: 'Whether the check passed.',
    example: true,
  })
  readonly ok!: boolean;

  /** Safe for an unauthenticated caller: a short class of failure, never a diagnostic. */
  @ApiProperty({
    description:
      'A short class of failure, never a diagnostic. Safe for an unauthenticated caller: a failing check reports only the failure class (Master Plan §13.1).',
    required: false,
    example: 'unavailable',
  })
  readonly reason?: string;
}

/**
 * The readiness report body (Master Plan §37.4).
 *
 * `@ApiExtraModels` registers `ReadinessDetail` so the `additionalProperties`
 * `$ref` below resolves: the checks map is keyed by check name, and the valueless
 * `$ref` form is the plugin-free way to describe a `Record<string, ReadinessDetail>`.
 */
@ApiExtraModels(ReadinessDetail)
export class ReadinessReport {
  @ApiProperty({
    description: 'Whether this instance should receive traffic: every registered check passed.',
    example: true,
  })
  readonly ready!: boolean;

  @ApiProperty({
    description: 'One entry per registered check, keyed by its registered name.',
    type: 'object',
    additionalProperties: { $ref: getSchemaPath(ReadinessDetail) },
  })
  readonly checks!: Readonly<Record<string, ReadinessDetail>>;
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
