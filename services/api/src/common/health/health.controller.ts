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
import { ApiExtraModels, ApiOperation, ApiProperty, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { ProblemDocument, ProblemFieldError } from '../errors/problem';
import { ReadinessRegistry, ReadinessReport } from './readiness.registry';

/**
 * The liveness response body (Master Plan §37.4).
 *
 * A class rather than an interface so the OpenAPI document is generated from the
 * same type the handler returns (Master Plan §7.1, ADR-001).
 */
export class LivenessReport {
  @ApiProperty({
    description: 'Always `ok` — this response exists only to prove the process is alive.',
    example: 'ok',
    enum: ['ok'],
  })
  readonly status!: 'ok';
}

@ApiExtraModels(ProblemDocument, ProblemFieldError)
@Controller()
export class HealthController {
  constructor(private readonly readiness: ReadinessRegistry) {}

  /** Liveness. Never touches a dependency, by design. */
  @ApiOperation({
    summary: 'Liveness probe',
    description:
      'Answers whether the process is alive. Unauthenticated and touches no dependency: a liveness probe that checks the database restarts a process during a database outage (Master Plan §37.4).',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'The process is alive.', type: LivenessReport })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description:
      'An unexpected error occurred; the global filter answers an RFC 7807 problem document (Master Plan §34.3).',
    content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDocument' } } },
  })
  @Get('healthz')
  healthz(): LivenessReport {
    return { status: 'ok' };
  }

  /**
   * Readiness. Answers 200 or 503 on the same handler, so `@Res` is used: returning a
   * body with a fixed status would force one of the two answers to lie.
   */
  @ApiOperation({
    summary: 'Readiness probe',
    description:
      'Answers whether this instance should receive traffic. Unauthenticated and runs every registered readiness check, naming the failing class only — never a dependency, host, or credential (Master Plan §13.1).',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Every registered readiness check passed; the instance should receive traffic.',
    type: ReadinessReport,
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: 'At least one registered readiness check failed; the instance should not receive traffic.',
    type: ReadinessReport,
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description:
      'An unexpected error occurred; the global filter answers an RFC 7807 problem document (Master Plan §34.3).',
    content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDocument' } } },
  })
  @Get('readyz')
  async readyz(@Res() response: Response<ReadinessReport>): Promise<void> {
    const report = await this.readiness.report();
    response.status(report.ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json(report);
  }
}
