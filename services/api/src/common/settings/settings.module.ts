/**
 * The settings module (Master Plan §22, §22.4, §40.7 row M3-S1).
 *
 * Owns the two settings routes and the `SettingsService` behind them. It
 * imports `AuthorizationModule.forRoot(config)` — which dedupes the shared
 * `IdentityModule.forRoot(config)` graph — because the controller is
 * decorated with `@Authorize` (its composite guard must be the exported
 * authorization instance the routes assert against, §39.3) and because the
 * service resolves the caller's effective authorization *inside* its write
 * transaction through the same exported service (the guard and this layer
 * cannot disagree, §11.4). `PrismaService` arrives from the global database
 * module.
 *
 * The module communicates with the M2-S6 audit streams only through the
 * `AuditStreamWriter` the service composes for its class-A appends — the same
 * dependency direction every other audit consumer follows.
 */

import { Module, type DynamicModule } from '@nestjs/common';

import { APP_LOGGER, createAppLogger } from '../../app.providers';
import { APP_CONFIG, type AppConfigShape } from '../config/app.config';
import { AuthorizationModule } from '../authorization/authorization.module';
import { IdentityModule } from '../identity/identity.module';
import { AuthorizationService } from '../tenancy/authorization/authorization.service';
import { DatabaseModule } from '../database/database.module';
import { PrismaService } from '../database/prisma.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { AuditStreamWriter } from '../audit/audit-stream-writer';

@Module({})
export class SettingsModule {
  /**
   * @param config Validated configuration. Callers pass the same value they
   *   gave `AppModule.forRoot` or any other `forRoot` in the graph — the
   *   composition root, once.
   */
  static forRoot(config: AppConfigShape): DynamicModule {
    return {
      module: SettingsModule,
      imports: [AuthorizationModule.forRoot(config), IdentityModule.forRoot(config), DatabaseModule.forRoot(config)],
      controllers: [SettingsController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        {
          provide: APP_LOGGER,
          inject: [APP_CONFIG],
          useFactory: (resolved: AppConfigShape): unknown => createAppLogger(resolved),
        },
        // Interface-typed dependencies cannot be resolved by Nest's constructor
        // reflection, so the service is wired by factory — the same pattern as
        // every other service over `PrismaHost` in this codebase. The
        // transactional audit writer rides with the service: the class-A
        // settings rows and their audit event share the caller's transaction
        // (§32.5).
        {
          provide: SettingsService,
          inject: [PrismaService, AuthorizationService, APP_LOGGER],
          useFactory: (
            host: PrismaService,
            authorization: AuthorizationService,
            logger: ReturnType<typeof createAppLogger>,
          ) => new SettingsService(host, authorization, new AuditStreamWriter(), logger),
        },
      ],
      exports: [SettingsService],
    };
  }
}
