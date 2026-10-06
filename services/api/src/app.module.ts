/**
 * Root application module.
 *
 * Master Plan §7.2: each business capability is a NestJS module owning its controller,
 * DTOs, service, repository, and write paths to its tables, and modules communicate only
 * through exported services or explicit domain events. §7.3: the backend is the only
 * authority for every business invariant.
 *
 * `common/` is cross-cutting - errors, auth, tenancy, logging, pipes (§6.2). No business
 * module exists yet, and none is created here: §12 forbids building a capability ahead
 * of its slice, and §2.4 forbids using rigour to justify scope.
 *
 * The module is a dynamic module (`forRoot`) because configuration must be an explicit
 * input rather than an import side effect. A module that reads `process.env` on import
 * cannot be constructed twice in one process with two configurations, which is exactly
 * what an integration test needs.
 *
 * The global validation pipe and the exception filter are registered here rather than in
 * a feature module, because §34.2 requires exactly one of each application-wide. A second
 * pipe on a feature would be two answers to the same question.
 */

import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import type { Logger as PinoLogger } from 'pino';
import { HealthModule } from './common/health/health.module';
import { ProblemDetailsFilter } from './common/errors/problem.filter';
import { createValidationPipe } from './common/pipes/validation.pipe';
import { APP_LOGGER, createAppLogger } from './app.providers';
import { APP_CONFIG, type AppConfigShape } from './common/config/app.config';

function coreProviders(config: AppConfigShape): Provider[] {
  return [
    { provide: APP_CONFIG, useValue: config },
    {
      provide: APP_LOGGER,
      inject: [APP_CONFIG],
      useFactory: (resolved: AppConfigShape): PinoLogger => createAppLogger(resolved),
    },
    {
      provide: APP_PIPE,
      useFactory: createValidationPipe,
    },
    {
      provide: APP_FILTER,
      inject: [APP_LOGGER],
      useFactory: (logger: PinoLogger): ProblemDetailsFilter => new ProblemDetailsFilter({ logger }),
    },
  ];
}

@Module({})
export class AppModule {
  /**
   * @param config Validated configuration. Callers use `loadConfig`, which throws on
   *   invalid input rather than defaulting.
   */
  static forRoot(config: AppConfigShape): DynamicModule {
    return {
      module: AppModule,
      imports: [HealthModule],
      providers: coreProviders(config),
      exports: [APP_CONFIG, APP_LOGGER],
    };
  }
}
