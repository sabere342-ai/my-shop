/**
 * The catalog module (Master Plan §15.1, §15.2, §15.3A, §17, §30.1; §40.8 row
 * M4-S1).
 *
 * Owns the eight catalog routes and the `CatalogService` behind them. It
 * imports `AuthorizationModule.forRoot(config)` — which dedupes the shared
 * `IdentityModule.forRoot(config)` graph — because the controller is decorated
 * with `@Authorize` (its composite guard must be the exported authorization
 * instance the routes assert against, §39.3): `catalog.view` on the reads,
 * `catalog.edit` on the writes, resolved by the same effective-permission
 * rule every other module uses (§11.4). `PrismaService` arrives from the
 * global database module, and the service's tenant transactions carry the
 * §8.2 trusted context the three catalog tables' forced-RLS policies demand
 * (migration 0013).
 *
 * The module communicates with the M2-S6 audit streams only through the
 * `AuditStreamWriter` the service composes for its class-A appends — the same
 * dependency direction every other audit consumer follows. There is no cost
 * surface here: §30.2's costing engine arrives with M4-S3.
 */

import { Module, type DynamicModule } from '@nestjs/common';

import { APP_LOGGER, createAppLogger } from '../../app.providers';
import { APP_CONFIG, type AppConfigShape } from '../config/app.config';
import { AuthorizationModule } from '../authorization/authorization.module';
import { IdentityModule } from '../identity/identity.module';
import { DatabaseModule } from '../database/database.module';
import { PrismaService } from '../database/prisma.service';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { AuditStreamWriter } from '../audit/audit-stream-writer';

@Module({})
export class CatalogModule {
  /**
   * @param config Validated configuration. Callers pass the same value they
   *   gave `AppModule.forRoot` or any other `forRoot` in the graph — the
   *   composition root, once.
   */
  static forRoot(config: AppConfigShape): DynamicModule {
    return {
      module: CatalogModule,
      imports: [AuthorizationModule.forRoot(config), IdentityModule.forRoot(config), DatabaseModule.forRoot(config)],
      controllers: [CatalogController],
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
        // transactional audit writer rides with the service: the catalog rows
        // and their audit events share the caller's transaction (§32.5).
        {
          provide: CatalogService,
          inject: [PrismaService, APP_LOGGER],
          useFactory: (host: PrismaService, logger: ReturnType<typeof createAppLogger>) =>
            new CatalogService(host, new AuditStreamWriter(), logger),
        },
      ],
      exports: [CatalogService],
    };
  }
}
