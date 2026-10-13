/**
 * The push auth guard and the `@SyncContext()` parameter decorator (§38.10.1).
 *
 * The guard is the only place a push acquires tenant and device identity: it runs
 * the authenticator against the `Authorization` header and attaches the resulting
 * trusted context to the request. The controller then reads that context through
 * the decorator — never from the body — so `organizationId`/`deviceId` in the
 * payload are assertions to verify, not authority to obey (§38.16, §9.3).
 *
 * The guard rethrows whatever the authenticator throws (a `DomainError`), which
 * the global filter turns into the RFC 7807 `UNAUTHENTICATED` document. It never
 * invents a context on failure.
 */

import { createParamDecorator, Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { SYNC_AUTHENTICATOR, type SyncAuthenticator, type SyncTrustedContext } from './sync-auth';

/** A request the guard has authenticated, carrying the trusted context. */
export interface SyncAuthenticatedRequest extends Request {
  syncTrustedContext?: SyncTrustedContext;
}

@Injectable()
export class SyncAuthGuard implements CanActivate {
  constructor(@Inject(SYNC_AUTHENTICATOR) private readonly authenticator: SyncAuthenticator) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SyncAuthenticatedRequest>();
    const header = request.headers['authorization'];
    const authorizationHeader = typeof header === 'string' ? header : undefined;

    request.syncTrustedContext = await this.authenticator.authenticate({ authorizationHeader });
    return true;
  }
}

/**
 * Reads the trusted context the guard attached. Throws if the guard did not run,
 * because an unauthenticated context reaching the service would mean the tenant
 * scope fell back to caller input — the one thing §38.16 forbids.
 */
export const SyncContext = createParamDecorator((_data: unknown, context: ExecutionContext): SyncTrustedContext => {
  const request = context.switchToHttp().getRequest<SyncAuthenticatedRequest>();
  const trusted = request.syncTrustedContext;
  if (trusted === undefined) {
    throw new Error('SyncContext was read without SyncAuthGuard; refusing to proceed without a trusted context');
  }
  return trusted;
});
