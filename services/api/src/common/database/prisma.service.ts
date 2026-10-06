/**
 * Prisma client lifecycle and the database readiness check.
 *
 * Master Plan §40.4 gives M1-S3 the key acceptance "`migrate deploy` works from
 * empty; role separation verified", and §13.4 fixes what each role may do. This
 * service is the application half of that split:
 *
 * - It connects with the **application role** only, by handing Prisma the
 *   validated `DATABASE_URL` explicitly. The migrator credential never reaches
 *   this process — `scripts/db.mjs` rebinds `DATABASE_URL` for the CLI instead.
 * - It registers the `database` readiness check (§37.4, M1-S2's `ReadinessRegistry`).
 *   `/readyz` must answer "not ready" while migrations are still running, so a
 *   failed `$connect` at startup is reported, not thrown: the rollout continues
 *   and the smoke check observes the truth.
 * - The check reports a fixed `unavailable` reason and logs only an error class
 *   and code. An unauthenticated endpoint must not learn a dependency name, host,
 *   or version (§13.1), and an exit-path log must never carry a connection
 *   string (§13.6).
 *
 * The probe races the query against a timeout because `/readyz` is polled by an
 * orchestrator: a TCP connect that takes the OS default of ~20 seconds would make
 * every probe hang, and readiness would lag the truth instead of tracking it.
 */

import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Logger as PinoLogger } from 'pino';
import type { AppConfigShape } from '../config/app.config';
import type { ReadinessRegistry } from '../health/readiness.registry';

/** The only reason string `/readyz` ever shows for this check. */
const UNAVAILABLE = 'unavailable';

/** Default bound on a single readiness probe. */
const DEFAULT_PROBE_TIMEOUT_MS = 2000;

/**
 * Log-safe facts about an error: the class name and a SQLSTATE or Prisma code if
 * one exists. Never the message — a Prisma connection error's message can embed
 * the host, and older drivers embedded the whole URL (§13.6).
 */
function errorFacts(error: unknown): Record<string, string> {
  const facts: Record<string, string> = {
    errorClass: error instanceof Error ? error.constructor.name : 'UnknownError',
  };
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    facts['errorCode'] = error.code;
  }
  return facts;
}

export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private client: PrismaClient | undefined = undefined;
  private readonly probeTimeoutMs: number;

  /**
   * Probe queries that have not settled yet.
   *
   * Disconnecting the client while one of these is still in flight makes Prisma
   * reject an internal future that nothing observes — an unhandled rejection that
   * kills the process during exactly the outage a graceful shutdown is meant to
   * survive. `onModuleDestroy` waits them out first; each is bounded by the
   * driver's own connection timeout.
   */
  private readonly pendingProbes = new Set<Promise<void>>();

  constructor(
    private readonly config: AppConfigShape,
    private readonly logger: PinoLogger,
    private readonly readiness: ReadinessRegistry,
    probeTimeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS,
  ) {
    this.probeTimeoutMs = probeTimeoutMs;
  }

  /**
   * The connected client, for repositories and acceptance tests that need a raw
   * query. Throws when `DATABASE_URL` is unset: handing back a client that would
   * fail later is worse than failing at the call site.
   */
  get prisma(): PrismaClient {
    if (this.client === undefined) {
      throw new Error('PrismaService has no client because DATABASE_URL is not configured');
    }
    return this.client;
  }

  async onModuleInit(): Promise<void> {
    const url = this.config.database.applicationUrl;
    if (url === undefined) {
      // The M1-S2 contract stands: a process with no database dependency reports
      // ready, and that answer must stay truthful rather than become a stub.
      this.logger.debug(
        { component: 'database' },
        'DATABASE_URL is not set; the database readiness check is not registered',
      );
      return;
    }

    this.client = new PrismaClient({ datasourceUrl: url });

    // Registered before the first connection attempt on purpose: while migrations
    // are running, /readyz must answer not-ready (§37.4 fixes that order), and a
    // check that only appears after a successful connect could never say so.
    this.readiness.register('database', () => this.probe());

    try {
      await this.client.$connect();
    } catch (error) {
      this.logger.warn(
        { component: 'database', ...errorFacts(error) },
        'the initial database connection failed; readiness reports unavailable',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([...this.pendingProbes]);
    await this.client?.$disconnect();
  }

  /**
   * One readiness probe: `SELECT 1`, raced against the probe timeout.
   *
   * Returns `{ ok: true }` without a `reason` — the health endpoint's contract is
   * that a passing check carries no detail at all.
   */
  private async probe(): Promise<{ readonly ok: boolean; readonly reason?: string }> {
    const client = this.client;
    if (client === undefined) {
      // Unreachable in practice: the check is registered only alongside a client.
      // Kept so the probe can never throw into the registry's catch path with an
      // internal error class as the public reason.
      return { ok: false, reason: UNAVAILABLE };
    }

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), this.probeTimeoutMs);
    });
    const query = client.$queryRaw`SELECT 1`;

    // `settled` absorbs the query's rejection the moment it arrives. A probe that
    // loses the race would otherwise reject with nothing observing it — the exact
    // unhandled rejection that would take the process down during an outage — and
    // these promises are what `onModuleDestroy` waits for before disconnecting.
    const settled = query.then(
      () => undefined,
      () => undefined,
    );
    this.pendingProbes.add(settled);
    void settled.then(() => this.pendingProbes.delete(settled));

    try {
      const outcome = await Promise.race([query.then(() => 'ok' as const), timeout]);
      return outcome === 'ok' ? { ok: true } : { ok: false, reason: UNAVAILABLE };
    } catch (error) {
      this.logger.warn({ component: 'database', ...errorFacts(error) }, 'the database readiness probe failed');
      return { ok: false, reason: UNAVAILABLE };
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }
}
