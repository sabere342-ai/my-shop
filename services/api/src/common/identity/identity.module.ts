/**
 * The identity module (Master Plan §40.6 M2-S2; §10.1–§10.3).
 *
 * Owns the four authentication routes and the `AuthService` behind them. It is
 * dynamic with `forRoot(config)` for the same reason `LedgerModule` is: a module's
 * providers can only see themselves, their imports, and globals, so the validated
 * configuration is an explicit input rather than an import side effect, and the
 * logger is built from the same validated values every other component uses.
 * `PrismaService` comes from the global database module.
 *
 * Every collaborator is bound here as a **port**, so the module is the single place
 * that decides what "the" access-token service, throttle, and security-event sink
 * are for this application:
 *
 * - the access-token port is RS256 when key material is configured and fail-closed
 *   otherwise (`createAccessTokenService`);
 * - the throttle store is the `auth_throttles` table through Prisma;
 * - the security-event sink is the M2-S6 durable implementation
 *   (`DurableSecurityEventSink`): it persists to `security_events` with the
 *   documented class-B failure policy and keeps emitting the redacted line.
 *   The `LoggingSecurityEventSink` stays exported as a redaction reference and
 *   a unit-test stand-in.
 *
 * `AuthService` is exported so a later slice (M2-S3 authorization, M2-S5 device
 * enrolment) reuses this identity context rather than rebuilding one — the §39.3
 * D-1 import boundary permits identity → tenancy, not the reverse.
 */

import { Module, type DynamicModule } from '@nestjs/common';
import type { Logger as PinoLogger } from 'pino';

import { APP_LOGGER, createAppLogger } from '../../app.providers';
import { APP_CONFIG, type AppConfigShape } from '../config/app.config';
import { PrismaService } from '../database/prisma.service';
import { createAccessTokenService } from './access-token';
import { AuthController } from './auth.controller';
import { AuthService, createAuthService } from './auth.service';
import { AuthThrottle, PrismaAuthThrottleStore, type ThrottlePolicy } from './auth-throttle';
import { JwtAuthGuard } from './jwt-auth.guard';
import { DurableSecurityEventSink } from '../audit/durable-security-event-sink';
import type { SecurityEventSink } from './security-event.sink';

/** Injection token for the access-token port. */
export const ACCESS_TOKEN_SERVICE = Symbol('ACCESS_TOKEN_SERVICE');

/** Injection token for the security-event port. */
export const SECURITY_EVENT_SINK = Symbol('SECURITY_EVENT_SINK');

@Module({})
export class IdentityModule {
  /**
   * @param config Validated configuration. Callers pass the same value they gave
   *   `DatabaseModule.forRoot` and `AppModule.forRoot`.
   */
  static forRoot(config: AppConfigShape): DynamicModule {
    const identity = config.identity;

    return {
      module: IdentityModule,
      controllers: [AuthController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        {
          provide: APP_LOGGER,
          inject: [APP_CONFIG],
          useFactory: (resolved: AppConfigShape): PinoLogger => createAppLogger(resolved),
        },
        {
          provide: ACCESS_TOKEN_SERVICE,
          useFactory: () => createAccessTokenService(identity),
        },
        {
          provide: AuthThrottle,
          inject: [PrismaService],
          useFactory: (prisma: PrismaService) =>
            new AuthThrottle(new PrismaAuthThrottleStore(prisma), throttlePolicy(identity)),
        },
        {
          // M2-S6: the production binding is now the durable sink, which
          // persists the event inside its own class-B transaction (tenant
          // transaction when the event names a verified organization, the
          // documented GLOBAL partition otherwise) and always emits the same
          // allow-listed log line. Construction needs the Prisma host and the
          // redaction logger — the same logger the port's line always used.
          provide: SECURITY_EVENT_SINK,
          inject: [PrismaService, APP_LOGGER],
          useFactory: (prisma: PrismaService, logger: PinoLogger) => new DurableSecurityEventSink(prisma, logger),
        },
        {
          provide: AuthService,
          inject: [PrismaService, ACCESS_TOKEN_SERVICE, AuthThrottle, SECURITY_EVENT_SINK],
          useFactory: (
            prisma: PrismaService,
            accessToken: ReturnType<typeof createAccessTokenService>,
            throttle: AuthThrottle,
            sink: SecurityEventSink,
          ) => createAuthService(prisma, identity, { accessToken, throttle, sink }),
        },
        JwtAuthGuard,
      ],
      exports: [AuthService, ACCESS_TOKEN_SERVICE, SECURITY_EVENT_SINK],
    };
  }
}

/**
 * The throttle policy from configuration.
 *
 * The `?? ` defaults mirror `IdentityConfig`'s defaults and exist only for a
 * configuration with no identity group — which also means a fail-closed
 * access-token port, so this policy is never exercised on a path that could
 * succeed.
 */
function throttlePolicy(identity: AppConfigShape['identity']): ThrottlePolicy {
  return {
    freeAttempts: identity?.throttleFreeAttempts ?? 5,
    baseDelaySeconds: identity?.throttleBaseDelaySeconds ?? 1,
    maxDelaySeconds: identity?.throttleMaxDelaySeconds ?? 900,
  };
}
