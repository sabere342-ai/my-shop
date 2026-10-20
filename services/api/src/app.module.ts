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
import { DatabaseModule } from './common/database/database.module';
import { LedgerModule } from './common/sync/ledger/mutation-ledger.module';
import { PullModule } from './common/sync/pull/sync-pull.module';
import { PushModule } from './common/sync/push/sync-push.module';
import { IdentityModule } from './common/identity/identity.module';
import { AuthorizationModule } from './common/authorization/authorization.module';
import { DeviceModule } from './common/devices/device.module';
import { AuditModule } from './common/audit/audit.module';
import { SettingsModule } from './common/settings/settings.module';
import { PricingModule } from './common/pricing/pricing.module';
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
      // The database module is global (M1-S3): business modules will inject the
      // Prisma service without importing it, the same way they will inject the
      // configuration and the logger. The ledger module (M1b-S4) is registered
      // as the single door for idempotent mutation acceptance; it publishes no
      // controller. The push module (M1b-S5) sits on top of it and is the first
      // sync route: `POST /api/v1/sync/push`, guarded and device-bound (§12.4).
      // The pull module (M1b-S6) is the matching egress: `GET /api/v1/sync/pull`
      // reads the same change feed under the same device-bound identity
      // (§38.11.2, §38.16). The identity module (M2-S2) issues, rotates, and
      // revokes the tokens the sync guards consume (§10.1–§10.3, §40.6). The
      // device module (M2-S5, §12) owns device registration, the bind-session
      // route, the owner-visible device list, and revocation — and exports the
      // production sync authenticator the push and pull guards bind. The audit
      // module (M2-S6, §32) exposes the business-history read route the
      // durable streams feed.
      imports: [
        HealthModule,
        DatabaseModule.forRoot(config),
        LedgerModule.forRoot(config),
        PushModule.forRoot(config),
        PullModule.forRoot(config),
        IdentityModule.forRoot(config),
        AuthorizationModule.forRoot(config),
        DeviceModule.forRoot(config),
        AuditModule.forRoot(config),
        SettingsModule.forRoot(config),
        PricingModule.forRoot(config),
      ],
      providers: coreProviders(config),
      exports: [APP_CONFIG, APP_LOGGER],
    };
  }
}
