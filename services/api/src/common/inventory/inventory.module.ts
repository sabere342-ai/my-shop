/**
 * The inventory module (Master Plan §15.4, §15.5, §15.6, §15.6A, §38.14.1;
 * §40.8 row M4-S2).
 *
 * Owns the six inventory routes and the `InventoryService` behind them. It
 * imports `AuthorizationModule.forRoot(config)` — which dedupes the shared
 * `IdentityModule.forRoot(config)` graph — because the controller is decorated
 * with `@Authorize` and reuses the exported `AuthorizationService` for the §38.5
 * cost escalation (`inventory.view` on the quantity reads, `inventory.adjust` on
 * the movement write, `catalog.cost.edit` on the valuation face and the
 * cost-imposing causes, resolved by the same effective-permission rule every
 * other module uses, §11.4). `PrismaService` arrives from the global database
 * module, and the service's tenant transactions carry the §8.2 trusted context
 * the inventory tables' forced-RLS policies demand (migrations 0014/0015).
 *
 * The module communicates with the M2-S6 audit streams only through the
 * `AuditStreamWriter` the service composes for its class-A appends, and with
 * the M1b-S4 convergence machinery only through the shared `sync_sequences`
 * counter — the movement's `server_sequence` allocation. The §30 moving-average
 * engine lives behind the movement write and the two cost reads; the count
 * surface is M4-S4's (§15.8), and M6-S2's purchase documents will ride this
 * exact receipt path as their producer (§38.22 Tier 3, online only).
 */

import { Module, type DynamicModule } from '@nestjs/common';

import { APP_LOGGER, createAppLogger } from '../../app.providers';
import { APP_CONFIG, type AppConfigShape } from '../config/app.config';
import { AuthorizationModule } from '../authorization/authorization.module';
import { IdentityModule } from '../identity/identity.module';
import { DatabaseModule } from '../database/database.module';
import { PrismaService } from '../database/prisma.service';
import { AuditStreamWriter } from '../audit/audit-stream-writer';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({})
export class InventoryModule {
  /**
   * @param config Validated configuration. Callers pass the same value they
   *   gave `AppModule.forRoot` or any other `forRoot` in the graph — the
   *   composition root, once.
   */
  static forRoot(config: AppConfigShape): DynamicModule {
    return {
      module: InventoryModule,
      imports: [AuthorizationModule.forRoot(config), IdentityModule.forRoot(config), DatabaseModule.forRoot(config)],
      controllers: [InventoryController],
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
        // transactional audit writer rides with the service: the movement rows,
        // the derived level, and their audit events share the caller's
        // transaction (§32.5).
        {
          provide: InventoryService,
          inject: [PrismaService, APP_LOGGER],
          useFactory: (host: PrismaService, logger: ReturnType<typeof createAppLogger>) =>
            new InventoryService(host, new AuditStreamWriter(), logger),
        },
      ],
      exports: [InventoryService],
    };
  }
}
