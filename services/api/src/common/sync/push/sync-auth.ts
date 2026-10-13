/**
 * The push authentication boundary (Master Plan §38.10.1 "Bearer access token
 * (§38.16) plus the device identity assertion", §38.16, §9.3).
 *
 * Two rules shape this boundary, and both are structural rather than
 * conventional:
 *
 * 1. **Tenant and device identity are never taken from the request body.** The
 *    body's `organizationId`/`deviceId` are assertions to be verified against an
 *    authenticated context; the context is the only authority (§38.16, §9.3).
 *    A device cannot name another organization into existence.
 * 2. **Production fails closed when the identity infrastructure is absent.** M2
 *    owns real token verification, device enrolment, and revocation. Until then
 *    the default authenticator refuses every request (`UNAUTHENTICATED`) rather
 *    than accepting anonymous production mutations. A test supplies a trusted
 *    context by overriding the `SYNC_AUTHENTICATOR` provider; that implementation
 *    lives under `test/`, so it is structurally absent from a production build.
 *
 * The authenticator receives only what it is allowed to trust — the
 * `Authorization` header — and never the parsed body, so a caller cannot smuggle
 * authority into the identity decision.
 */

import { DomainError } from '../../errors/domain.error';
import { ERROR_CODES } from '../../errors/problem';

/** Injection token for the sync authenticator, overridable in tests only. */
export const SYNC_AUTHENTICATOR = Symbol('SYNC_AUTHENTICATOR');

/**
 * The authenticated facts a push is allowed to rely on (§38.16.3). Both values are
 * server-established; neither is read from the request body.
 */
export interface SyncTrustedContext {
  /** §38.8.1 `organization_id`: the tenant the authenticated device belongs to. */
  readonly organizationId: string;
  /** §38.8.1 `device_id`: the registered installation the credential is bound to. */
  readonly deviceId: string;
}

/** What the authenticator may read: the raw `Authorization` header value, if any. */
export interface SyncAuthRequest {
  readonly authorizationHeader: string | undefined;
}

/**
 * Verifies the caller's credential and returns the trusted context, or throws a
 * `DomainError` (`UNAUTHENTICATED`) when the credential is missing or invalid.
 */
export interface SyncAuthenticator {
  authenticate(request: SyncAuthRequest): Promise<SyncTrustedContext>;
}

/**
 * The production default: refuse everything.
 *
 * M2-S2 (§40.6) introduces token verification, device enrolment, and the signed
 * authorization snapshot. Until that lands there is no way to authenticate a
 * push, so the honest answer is `UNAUTHENTICATED` — never anonymous acceptance of
 * a production mutation (§9.3). This default is what makes "fail closed" a
 * property of the module graph rather than of a configuration flag.
 */
export class FailClosedSyncAuthenticator implements SyncAuthenticator {
  authenticate(): Promise<SyncTrustedContext> {
    return Promise.reject(
      new DomainError(
        ERROR_CODES.UNAUTHENTICATED,
        'sync identity and device verification are not available yet (M2); the push boundary fails closed',
      ),
    );
  }
}
