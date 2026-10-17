/**
 * M2-S3 §40.6 — authorization module composition layer.
 *
 * The neutral composition layer over the identity and tenancy contexts: it imports
 * `IdentityModule.forRoot(config)` (deduped by the NestJS module system) for the
 * verified principal, the RS256 key material, and the security-event sink, and
 * `DatabaseModule.forRoot(config)` for the Prisma host the tenancy service reads
 * through. It owns no tables and no business rule — `AuthorizationService` and
 * `AuthorizationSnapshotService` do — so it can never reach into `bootstrap` and
 * neither `identity` nor `tenancy` may import it (§39.3 D-1).
 */
import { Module, type DynamicModule } from '@nestjs/common';

import { APP_CONFIG, type AppConfigShape } from '../config/app.config';
import { IdentityModule } from '../identity/identity.module';
import { DatabaseModule } from '../database/database.module';
import { PrismaService } from '../database/prisma.service';
import { AuthorizationService } from '../tenancy/authorization/authorization.service';
import {
  AuthorizationSnapshotService,
  createAuthorizationSnapshotService,
} from '../tenancy/authorization/authorization-snapshot';
import { AuthorizationGuard } from './authorization.guard';
import { AuthorizationController } from './authorization.controller';
import { AUTHORIZATION_SNAPSHOT_SERVICE } from './authorization.tokens';

@Module({})
export class AuthorizationModule {
  static forRoot(config: AppConfigShape): DynamicModule {
    return {
      module: AuthorizationModule,
      imports: [IdentityModule.forRoot(config), DatabaseModule.forRoot(config)],
      controllers: [AuthorizationController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        AuthorizationGuard,
        {
          provide: AuthorizationService,
          inject: [PrismaService],
          // `PrismaService` is itself a `PrismaHost`: it exposes the connected client
          // through a `prisma` getter and reads it at call time, so the graph boots
          // with no `DATABASE_URL` and no DI-time crash (§7.2, identity's pattern).
          useFactory: (prisma: PrismaService): AuthorizationService => new AuthorizationService(prisma),
        },
        {
          provide: AUTHORIZATION_SNAPSHOT_SERVICE,
          inject: [APP_CONFIG],
          useFactory: (resolved: AppConfigShape): AuthorizationSnapshotService =>
            createAuthorizationSnapshotService(resolved.identity),
        },
      ],
      exports: [AuthorizationGuard, AuthorizationService, AUTHORIZATION_SNAPSHOT_SERVICE],
    };
  }
}
