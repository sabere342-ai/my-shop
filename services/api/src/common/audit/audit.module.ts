/**
 * The audit module (Master Plan §32, §40.6 M2-S6).
 *
 * Registers the one audit read route (`GET …/audit/events`, `audit.view`) with
 * the `AuditReadService` behind it. It imports `AuthorizationModule.forRoot(config)`
 * for exactly the reason the devices module does: a controller decorated with
 * `@Authorize()` instantiates the composite guard in *its own* module context,
 * so the `AuthorizationService` the guard resolves through must be the one the
 * routes assert against (§39.3), never a rebuilt one.
 *
 * `IdentityModule.forRoot(config)` rides along for the same guard-ownership
 * reason: the composite guard's inner `JwtAuthGuard` injects `AuthService`, and
 * the token it verifies against must be the composition root's — the same
 * import chain `DeviceModule` and `sync-push.module.ts` already carry.
 *
 * The `common/audit` *domain* (contracts, canonical serializer, writers,
 * verifier, durable sinks) is a leaf with no runtime edge into identity,
 * tenancy, devices, sync, bootstrap, or authorization — machine-enforced by
 * `common/architecture/import-boundary.spec.ts`. The two composition files
 * (this module and the controller that serves the leaf over the wire) are the
 * documented exceptions the boundary rule names: they are the edge where the
 * leaf is served, exactly like authorization's own composition layer.
 */

import { Module, type DynamicModule } from '@nestjs/common';

import { APP_CONFIG, type AppConfigShape } from '../config/app.config';
import { AuthorizationModule } from '../authorization/authorization.module';
import { IdentityModule } from '../identity/identity.module';
import { PrismaService } from '../database/prisma.service';
import { AuditController } from './audit.controller';
import { AuditReadService } from './audit.service';

@Module({})
export class AuditModule {
  /**
   * @param config Validated configuration. Callers pass the same value they
   *   gave `AppModule.forRoot`, `DatabaseModule.forRoot`, or any other
   *   `forRoot` in the graph — the composition root, once.
   */
  static forRoot(config: AppConfigShape): DynamicModule {
    return {
      module: AuditModule,
      imports: [AuthorizationModule.forRoot(config), IdentityModule.forRoot(config)],
      controllers: [AuditController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        {
          provide: AuditReadService,
          inject: [PrismaService],
          // `PrismaService` is itself the host shape (`ContextHost`): it exposes
          // the connected client through a `prisma` getter and reads it at call
          // time, so the graph boots with no `DATABASE_URL` (§7.2's pattern).
          useFactory: (prisma: PrismaService): AuditReadService => new AuditReadService(prisma),
        },
      ],
      exports: [AuditReadService],
    };
  }
}
