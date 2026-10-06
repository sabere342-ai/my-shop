/**
 * Health and readiness endpoints.
 *
 * Master Plan §37.4 describes the deployment order: migration job, then application
 * rollout, then a smoke check against `/healthz` and `/readyz`. The distinction between
 * the two is the point:
 *
 * - `/healthz` answers **"is this process alive?"** It touches nothing. A liveness
 *   probe that checks the database restarts the process during a database outage,
 *   converting a recoverable dependency failure into an outage.
 * - `/readyz` answers **"should this instance receive traffic?"** It runs the
 *   registered checks and answers 503 when any fails.
 *
 * Both are unauthenticated by necessity — a probe has no credential — so both are
 * deliberately narrow. Neither reveals a version number, a dependency name, or a
 * connection string. An unauthenticated endpoint that reports
 * `cannot reach postgres://user:pass@host/db` is a disclosure, and §13.1 does not permit
 * it, so a failing readiness check reports only the failure class.
 *
 * Both sit outside the `/api/v1` namespace on purpose. §34.1 namespaces business
 * traffic; a probe is not business traffic, and a versioned liveness endpoint would
 * imply a framework upgrade could break it, which is not a useful coupling.
 */

import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ReadinessRegistry, type ReadinessReport } from './readiness.registry';

interface LivenessReport {
  readonly status: 'ok';
}

@Controller()
export class HealthController {
  constructor(private readonly readiness: ReadinessRegistry) {}

  /** Liveness. Never touches a dependency, by design. */
  @Get('healthz')
  healthz(): LivenessReport {
    return { status: 'ok' };
  }

  /**
   * Readiness. Answers 200 or 503 on the same handler, so `@Res` is used: returning a
   * body with a fixed status would force one of the two answers to lie.
   */
  @Get('readyz')
  async readyz(@Res() response: Response<ReadinessReport>): Promise<void> {
    const report = await this.readiness.report();
    response.status(report.ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json(report);
  }
}
