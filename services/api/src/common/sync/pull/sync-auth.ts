/**
 * The pull authentication boundary (Master Plan §38.11.2 "Bearer access token
 * (§38.16) plus the device identity assertion", §38.16, §9.3).
 *
 * Two rules shape this boundary, and both are structural rather than
 * conventional:
 *
 * 1. **Tenant identity is never taken from the request.** Pull has no body and
 *    no organization parameter: the feed is per-organization (§38.11.1) and the
 *    organization is the one the authenticated device belongs to. A caller
 *    cannot name another tenant into existence (§38.16, §9.3) — there is no
 *    field that could try.
 * 2. **Production fails closed when the identity infrastructure is absent.** M2
 *    owns real token verification, device enrolment, and revocation. Until then
 *    the default authenticator refuses every request (`UNAUTHENTICATED`) rather
 *    than exposing a production change feed anonymously. A test supplies a
 *    trusted context by overriding the `SYNC_AUTHENTICATOR` provider; that
 *    implementation lives under `test/`, so it is structurally absent from a
 *    production build.
 *
 * The authenticator receives only what it is allowed to trust — the
 * `Authorization` header — and never the parsed query, so a caller cannot
 * smuggle authority into the identity decision.
 */

import { DomainError } from '../../errors/domain.error';
import { ERROR_CODES } from '../../errors/problem';

/**
 * Injection token for the pull authenticator, overridable in tests only.
 *
 * Distinct from push's token on purpose: the two transports are separate
 * modules with separate boundaries, so a test that authorizes one cannot
 * accidentally authorize the other.
 */
export const SYNC_AUTHENTICATOR = Symbol('SYNC_AUTHENTICATOR');

/**
 * The authenticated facts a pull is allowed to rely on (§38.16.3). Both values
 * are server-established; neither is read from the request. The feed is
 * organization-scoped (§38.11.1), so `deviceId` is authentication context
 * rather than a filter — a registered device reads its organization's feed.
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
 * pull, so the honest answer is `UNAUTHENTICATED` — never anonymous exposure of
 * a production change feed (§9.3). This default is what makes "fail closed" a
 * property of the module graph rather than of a configuration flag.
 */
export class FailClosedSyncAuthenticator implements SyncAuthenticator {
  authenticate(): Promise<SyncTrustedContext> {
    return Promise.reject(
      new DomainError(
        ERROR_CODES.UNAUTHENTICATED,
        'sync identity and device verification are not available yet (M2); the pull boundary fails closed',
      ),
    );
  }
}
