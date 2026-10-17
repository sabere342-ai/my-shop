/**
 * The sync ledger module (Master Plan §40.5, M1b-S4; §8.4 ownership `sync`).
 *
 * Exports `MutationLedgerService`, the single door through which a mutation
 * becomes a durable server fact. It is infrastructure, not a business module:
 * it owns no controller and no route (§38.10 push / §38.11 pull arrive as
 * M1b-S5/S6), and its business value is the idempotency contract around a caller
 * supplied effect (§38.9) — so `mutation_ledger` is never posted to the
 * accounting ledger (§39.4, D-8).
 *
 * Dynamic with `forRoot(config)` for the same reasons `DatabaseModule` is: a
 * module's provider can only see itself, its imports, and globals — an
 * `AppModule`-scoped `APP_CONFIG`/`APP_LOGGER` is invisible from here, so the
 * config is an explicit input, never an import side effect, and the logger is
 * built from the same validated values every other component uses. `PrismaService`
 * is injected from the global database module; it is handled through a factory so
 * the service hands the logger to `MutationLedgerService` as a plain value.
 */

import { Module, type DynamicModule } from '@nestjs/common';
import type { Logger as PinoLogger } from 'pino';
import { APP_LOGGER, createAppLogger } from '../../../app.providers';
import { APP_CONFIG, type AppConfigShape } from '../../config/app.config';
import { PrismaService } from '../../database/prisma.service';
import { MutationLedgerService } from './mutation-ledger.service';

@Module({})
export class LedgerModule {
  /**
   * @param config Validated configuration. Callers pass the same value they gave
   *   `DatabaseModule.forRoot` and `AppModule.forRoot`.
   */
  static forRoot(config: AppConfigShape): DynamicModule {
    return {
      module: LedgerModule,
      providers: [
        { provide: APP_CONFIG, useValue: config },
        {
          provide: APP_LOGGER,
          inject: [APP_CONFIG],
          useFactory: (resolved: AppConfigShape): PinoLogger => createAppLogger(resolved),
        },
        {
          provide: MutationLedgerService,
          inject: [PrismaService, APP_LOGGER],
          useFactory: (prisma: PrismaService, logger: PinoLogger) => new MutationLedgerService(prisma, logger),
        },
      ],
      exports: [MutationLedgerService],
    };
  }
}
