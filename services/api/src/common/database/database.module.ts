/**
 * Database module — the Prisma half of Master Plan §13.4 (slice M1-S3).
 *
 * Global and dynamic, for two reasons that are the same reason seen twice:
 *
 * - `global` because the Prisma client is cross-cutting infrastructure, exactly
 *   like the logger and the configuration. Every business module that owns tables
 *   will need it (§7.2), and a module graph that re-imports a configured database
 *   module per feature is a graph with several databases by accident.
 * - `forRoot(config)` because configuration is an explicit input, never an import
 *   side effect — the same rule `AppModule.forRoot` follows, and for the same
 *   reason: a test must be able to boot the application twice with two
 *   configurations, one with a database and one without.
 *
 * The module provides its own `APP_CONFIG` and `APP_LOGGER` because a module's
 * provider can only see its own scope and its imports; `AppModule`'s providers
 * are not visible from here. Both are constructed from the same validated values,
 * so the logger's format and redaction are identical to every other component's.
 *
 * `HealthModule` is imported for its exported `ReadinessRegistry`: registering
 * the `database` check there is what keeps `/readyz` able to answer "not ready"
 * while migrations are still running (§37.4).
 */

import { Global, Module, type DynamicModule } from '@nestjs/common';
import { APP_LOGGER, createAppLogger } from '../../app.providers';
import { APP_CONFIG, type AppConfigShape } from '../config/app.config';
import { HealthModule } from '../health/health.module';
import { ReadinessRegistry } from '../health/readiness.registry';
import { PrismaService } from './prisma.service';

@Global()
@Module({})
export class DatabaseModule {
  /**
   * @param config Validated configuration. Callers pass `loadConfig(...)`, which
   *   throws on invalid input rather than defaulting.
   */
  static forRoot(config: AppConfigShape): DynamicModule {
    return {
      module: DatabaseModule,
      global: true,
      imports: [HealthModule],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        {
          provide: APP_LOGGER,
          inject: [APP_CONFIG],
          useFactory: (resolved: AppConfigShape) => createAppLogger(resolved),
        },
        {
          provide: PrismaService,
          inject: [APP_CONFIG, APP_LOGGER, ReadinessRegistry],
          useFactory: (
            resolved: AppConfigShape,
            logger: ReturnType<typeof createAppLogger>,
            readiness: ReadinessRegistry,
          ) => new PrismaService(resolved, logger, readiness),
        },
      ],
      exports: [PrismaService],
    };
  }
}
