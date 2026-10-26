/**
 * The push endpoint module (Master Plan §40.5, M1b-S5; §38.10).
 *
 * This is the transport that M1b-S4's ledger deliberately did not offer: the
 * `POST /api/v1/sync/push` route, its authentication boundary, and the
 * per-mutation outcome stream (§38.10.1).
 *
 * Dynamic with `forRoot(config)` for the same reason `LedgerModule` is: a
 * module's providers can only see themselves, their imports, and globals, so the
 * validated configuration is an explicit input rather than an import side effect,
 * and the logger is built from the same validated values every other component
 * uses. It imports `LedgerModule.forRoot(config)` for the single door through
 * which a mutation becomes a durable server fact (§38.9).
 *
 * Both the authenticator and the mutation applier are **ports**, and the
 * production bindings fail closed — they just fail closed at different walls
 * now. M2-S5 (§40.6, §12.4) binds the authenticator to the real
 * `DeviceBoundSyncAuthenticator`: a push must present a bearer token minted from
 * a device-bound session, and the device must still be active — so an
 * unauthenticated or unbound caller is still refused `UNAUTHENTICATED`, and a
 * revoked device is refused `DEVICE_REVOKED`. The applier is the inventory
 * applier since M4-S4 (Tier 2, §38.22): two aggregate families apply for real
 * through the one movement engine and the count lifecycle; everything else is
 * still recorded `REJECTED`/`UNSUPPORTED_MUTATION` — never anonymous
 * acceptance, never a silent drop. A test overrides the two tokens with
 * implementations that live under `test/`, so the trusting code is
 * structurally absent from a production build.
 */

import { Module, type DynamicModule } from '@nestjs/common';
import type { Logger as PinoLogger } from 'pino';
import { APP_LOGGER, createAppLogger } from '../../../app.providers';
import { APP_CONFIG, type AppConfigShape } from '../../config/app.config';
import { AuthorizationModule } from '../../authorization/authorization.module';
import { AuthorizationService } from '../../tenancy/authorization/authorization.service';
import { DeviceModule, DEVICE_SYNC_AUTHENTICATOR } from '../../devices/device.module';
import { DeviceService } from '../../devices/device.service';
import { IdentityModule, SECURITY_EVENT_SINK } from '../../identity/identity.module';
import type { SecurityEventSink } from '../../identity/security-event.sink';
import { LedgerModule } from '../ledger/mutation-ledger.module';
import { MutationLedgerService } from '../ledger/mutation-ledger.service';
import { InventoryModule } from '../../inventory/inventory.module';
import { InventoryService } from '../../inventory/inventory.service';
import { StockCountService } from '../../inventory/count/stock-count.service';
import { InventoryMutationApplier } from '../../inventory/inventory-sync-applier';
import { SYNC_AUTHENTICATOR } from './sync-auth';
import {
  MembershipPermissionRevalidator,
  SYNC_INGRESS_REVALIDATOR,
  type SyncIngressRevalidator,
} from './ingress-revalidation';
import { SYNC_MUTATION_APPLIER, type SyncMutationApplier } from './sync-mutation-applier';
import { SyncAuthGuard } from './sync-push.guard';
import { SyncPushController } from './sync-push.controller';
import { SyncPushService } from './sync-push.service';

@Module({})
export class PushModule {
  /**
   * @param config Validated configuration. Callers pass the same value they gave
   *   `AppModule.forRoot` and `DatabaseModule.forRoot`.
   */
  static forRoot(config: AppConfigShape): DynamicModule {
    return {
      module: PushModule,
      imports: [
        LedgerModule.forRoot(config),
        // §9.4 (M2-S4): the re-validator resolves through the same §11
        // authorization context the routing controllers use — one resolver, one
        // rule set. `AuthorizationModule.forRoot` re-exports the shared
        // `IdentityModule`/`DatabaseModule.forRoot(config)` graph, deduplicated
        // by the NestJS module system like every other composition here.
        AuthorizationModule.forRoot(config),
        // M2-S6 (§32.3): the identity module's `SECURITY_EVENT_SINK` port is
        // imported (deduped with the graph above) so the push service's §38.16
        // identity refusals become durable `security_events` rows at the same
        // call sites that already emitted the structured log lines.
        IdentityModule.forRoot(config),
        // §12.4 (M2-S5): the push boundary is a device capability. The devices
        // module exports the production `DeviceBoundSyncAuthenticator` and the
        // `DeviceService` that records the §12.5 sync metadata; the same
        // composition the device routes use, deduplicated like every other
        // `forRoot` import.
        DeviceModule.forRoot(config),
        // Tier 2 (§38.22, M4-S4): the inventory module exports the services the
        // applier composes — the one movement engine and the count lifecycle —
        // deduplicated with the graph above like every other `forRoot` import.
        InventoryModule.forRoot(config),
      ],
      controllers: [SyncPushController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        {
          provide: APP_LOGGER,
          inject: [APP_CONFIG],
          useFactory: (resolved: AppConfigShape): PinoLogger => createAppLogger(resolved),
        },
        // §38.16 / §12.4: production identifies a push by the bearer token
        // (signature, session liveness, permission generation) **and** the
        // session's registered, still-active device binding. An unbound or
        // revoked device never reaches the ledger. A test overrides this token.
        { provide: SYNC_AUTHENTICATOR, useExisting: DEVICE_SYNC_AUTHENTICATOR },
        // §38.27 / §38.10.3: production supports the two inventory aggregates
        // the desktop can produce offline (Tier 2, §38.22 — M4-S4): every
        // other aggregate is still a recorded per-mutation rejection. A test
        // overrides this token.
        {
          provide: SYNC_MUTATION_APPLIER,
          inject: [InventoryService, StockCountService],
          useFactory: (inventory: InventoryService, counts: StockCountService): SyncMutationApplier =>
            new InventoryMutationApplier(inventory, counts),
        },
        // §9.4 (M2-S4): production admission re-validates live membership and
        // §11 effective permissions inside the acceptance transaction. It is
        // only ever reached with a trusted context, which production does not
        // yet issue — so the fail-closed posture is preserved end to end. A
        // test overrides this token.
        {
          provide: SYNC_INGRESS_REVALIDATOR,
          inject: [AuthorizationService],
          useFactory: (authorization: AuthorizationService): SyncIngressRevalidator =>
            new MembershipPermissionRevalidator(authorization),
        },
        SyncAuthGuard,
        {
          provide: SyncPushService,
          inject: [
            MutationLedgerService,
            SYNC_MUTATION_APPLIER,
            SYNC_INGRESS_REVALIDATOR,
            APP_LOGGER,
            DeviceService,
            SECURITY_EVENT_SINK,
          ],
          useFactory: (
            ledger: MutationLedgerService,
            applier: SyncMutationApplier,
            ingressRevalidator: SyncIngressRevalidator,
            logger: PinoLogger,
            devices: DeviceService,
            securitySink: SecurityEventSink,
          ) => new SyncPushService(ledger, applier, ingressRevalidator, logger, devices, securitySink),
        },
      ],
      exports: [SyncPushService],
    };
  }
}
