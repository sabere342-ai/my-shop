/**
 * The devices module (Master Plan §12, §40.6 M2-S5).
 *
 * Owns the three device routes, the `DeviceService` behind them, and the
 * production `DeviceBoundSyncAuthenticator` the sync guards consume. It imports
 * `AuthorizationModule.forRoot(config)` — which composes the shared
 * `IdentityModule.forRoot(config)` graph — because a controller decorated with
 * `@Authorize()` instantiates the composite guard in *its own* module's context:
 * the `AuthorizationService` the guard resolves through must be the one exported
 * authorization instance the routes assert against (§39.3), never a rebuilt one.
 * `IdentityModule` is imported directly as well so the `SECURITY_EVENT_SINK`
 * port the device service records through is visible in this context.
 * `PrismaService` arrives from the global database module.
 *
 * The sync authenticator is exported so the push and pull modules bind their
 * `SYNC_AUTHENTICATOR` tokens to it: device binding is a `devices` capability
 * consumed by `sync` (§8.4's dependency direction: sync depends on tenancy and
 * devices), not a duplicated identity rule inside sync.
 */

import { Module, type DynamicModule } from '@nestjs/common';
import { APP_LOGGER, createAppLogger } from '../../app.providers';
import { APP_CONFIG, type AppConfigShape } from '../config/app.config';
import { AuthorizationModule } from '../authorization/authorization.module';
import { IdentityModule, SECURITY_EVENT_SINK } from '../identity/identity.module';
import { AuthService } from '../identity/auth.service';
import type { SecurityEventSink } from '../identity/security-event.sink';
import { PrismaService } from '../database/prisma.service';
import { DeviceController } from './device.controller';
import { DeviceService } from './device.service';
import { DeviceBoundSyncAuthenticator } from './device-sync-authenticator';

/** Injection token for the production device-bound sync authenticator. */
export const DEVICE_SYNC_AUTHENTICATOR = Symbol('DEVICE_SYNC_AUTHENTICATOR');

@Module({})
export class DeviceModule {
  /**
   * @param config Validated configuration. Callers pass the same value they
   *   gave `AppModule.forRoot`, `IdentityModule.forRoot`, or any other
   *   `forRoot` in the graph — the composition root, once.
   */
  static forRoot(config: AppConfigShape): DynamicModule {
    return {
      module: DeviceModule,
      imports: [AuthorizationModule.forRoot(config), IdentityModule.forRoot(config)],
      controllers: [DeviceController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        {
          provide: APP_LOGGER,
          inject: [APP_CONFIG],
          useFactory: (resolved: AppConfigShape): unknown => createAppLogger(resolved),
        },
        // Interface-typed dependencies cannot be resolved by Nest's constructor
        // reflection, so — like every other service over `PrismaHost` in this
        // codebase — the service is wired by factory rather than `useClass`.
        {
          provide: DeviceService,
          inject: [PrismaService, SECURITY_EVENT_SINK, APP_LOGGER],
          useFactory: (host: PrismaService, sink: SecurityEventSink, logger: ReturnType<typeof createAppLogger>) =>
            new DeviceService(host, sink, logger),
        },
        {
          provide: DEVICE_SYNC_AUTHENTICATOR,
          inject: [AuthService, PrismaService, APP_LOGGER],
          useFactory: (auth: AuthService, prisma: PrismaService, logger: ReturnType<typeof createAppLogger>) =>
            new DeviceBoundSyncAuthenticator(auth, prisma, logger),
        },
      ],
      exports: [DeviceService, DEVICE_SYNC_AUTHENTICATOR],
    };
  }
}
