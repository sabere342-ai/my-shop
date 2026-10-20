/**
 * The pricing module (Master Plan §17, §38.19; §40.7 row M3-S2).
 *
 * Exports the transactional `PricingPolicyService` for the future sale
 * posting (M5) and the sync ingress (the M5 sale mutation applier) to invoke
 * inside their own transactions. It imports `SettingsModule.forRoot(config)`
 * — the §22.3 live typed settings the policy reads — and
 * `AuthorizationModule.forRoot(config)` for the §11 effective-permission
 * resolver; both dedupe the shared identity/database graphs. `PrismaService`
 * arrives from the global database module.
 *
 * This module publishes **no controller**: §40.7's M3-S2 row has no HTTP
 * surface of its own — enforcement is invoked by the entry points that admit
 * a sale, and inventing a route with no sale domain behind it would be a
 * placeholder success path (forbidden). The slice record documents the
 * deferred integration and the invocation contract the M5 entry points must
 * make.
 */

import { Module, type DynamicModule } from '@nestjs/common';

import { APP_LOGGER, createAppLogger } from '../../app.providers';
import { APP_CONFIG, type AppConfigShape } from '../config/app.config';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AuthorizationService } from '../tenancy/authorization/authorization.service';
import { DatabaseModule } from '../database/database.module';
import { SettingsModule } from '../settings/settings.module';
import { SettingsService } from '../settings/settings.service';
import { PricingPolicyService } from './pricing.service';

@Module({})
export class PricingModule {
  /**
   * @param config Validated configuration. Callers pass the same value they
   *   gave `AppModule.forRoot` or any other `forRoot` in the graph — the
   *   composition root, once.
   */
  static forRoot(config: AppConfigShape): DynamicModule {
    return {
      module: PricingModule,
      imports: [SettingsModule.forRoot(config), AuthorizationModule.forRoot(config), DatabaseModule.forRoot(config)],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        {
          provide: APP_LOGGER,
          inject: [APP_CONFIG],
          useFactory: (resolved: AppConfigShape): unknown => createAppLogger(resolved),
        },
        // Interface-typed dependencies cannot be resolved by Nest's constructor
        // reflection, so the service is wired by factory — the same pattern as
        // every other service over `PrismaHost` in this codebase.
        {
          provide: PricingPolicyService,
          inject: [AuthorizationService, SettingsService, APP_LOGGER],
          useFactory: (
            authorization: AuthorizationService,
            settings: SettingsService,
            logger: ReturnType<typeof createAppLogger>,
          ) => new PricingPolicyService(authorization, settings, logger),
        },
      ],
      exports: [PricingPolicyService],
    };
  }
}
