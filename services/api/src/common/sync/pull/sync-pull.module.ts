/**
 * The pull endpoint module (Master Plan §40.5, M1b-S6; §38.11).
 *
 * This is the transport that M1b-S4's ledger deliberately did not offer: the
 * `GET /api/v1/sync/pull` route, its authentication boundary, and the
 * change-feed page (§38.11.2).
 *
 * Dynamic with `forRoot(config)` for the same reason `LedgerModule` is: a
 * module's providers can only see themselves, their imports, and globals, so the
 * validated configuration is an explicit input rather than an import side effect,
 * and the logger is built from the same validated values every other component
 * uses. It imports `LedgerModule.forRoot(config)` for the single door through
 * which the change feed is read (§38.11.1).
 *
 * The authenticator is a **port**, and its production binding failed closed at
 * every wall. M2-S5 (§40.6, §12.4) binds it to the real
 * `DeviceBoundSyncAuthenticator`: a pull must present a bearer token minted from
 * a device-bound session whose device is still active — an unbound caller is
 * refused `UNAUTHENTICATED`, a revoked device is refused `DEVICE_REVOKED`. A
 * test overrides the token with an implementation that lives under `test/`, so
 * the trusting code is structurally absent from a production build.
 *
 * Pull needs no mutation applier: it reads a feed the push path already wrote.
 * That is the whole point of the split — M1b-S5 owns ingress, M1b-S6 owns egress,
 * and neither re-implements the ledger.
 */

import { Module, type DynamicModule } from '@nestjs/common';
import type { Logger as PinoLogger } from 'pino';
import { APP_LOGGER, createAppLogger } from '../../../app.providers';
import { APP_CONFIG, type AppConfigShape } from '../../config/app.config';
import { DeviceModule, DEVICE_SYNC_AUTHENTICATOR } from '../../devices/device.module';
import { DeviceService } from '../../devices/device.service';
import { LedgerModule } from '../ledger/mutation-ledger.module';
import { MutationLedgerService } from '../ledger/mutation-ledger.service';
import { SYNC_AUTHENTICATOR } from './sync-auth';
import { SyncAuthGuard } from './sync-pull.guard';
import { SyncPullController } from './sync-pull.controller';
import { SyncPullService } from './sync-pull.service';

@Module({})
export class PullModule {
  /**
   * @param config Validated configuration. Callers pass the same value they gave
   *   `AppModule.forRoot` and `DatabaseModule.forRoot`.
   */
  static forRoot(config: AppConfigShape): DynamicModule {
    return {
      module: PullModule,
      imports: [
        LedgerModule.forRoot(config),
        // §12.4 (M2-S5): the pull boundary is a device capability too. The same
        // devices module composition the device routes use, deduplicated like
        // every other `forRoot` import.
        DeviceModule.forRoot(config),
      ],
      controllers: [SyncPullController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        {
          provide: APP_LOGGER,
          inject: [APP_CONFIG],
          useFactory: (resolved: AppConfigShape): PinoLogger => createAppLogger(resolved),
        },
        // §38.16 / §12.4: production identifies a pull by the bearer token
        // (signature, session liveness, permission generation) **and** the
        // session's registered, still-active device binding. A test overrides
        // this token.
        { provide: SYNC_AUTHENTICATOR, useExisting: DEVICE_SYNC_AUTHENTICATOR },
        SyncAuthGuard,
        {
          provide: SyncPullService,
          inject: [MutationLedgerService, APP_LOGGER, DeviceService],
          useFactory: (ledger: MutationLedgerService, logger: PinoLogger, devices: DeviceService) =>
            new SyncPullService(ledger, logger, devices),
        },
      ],
      exports: [SyncPullService],
    };
  }
}
