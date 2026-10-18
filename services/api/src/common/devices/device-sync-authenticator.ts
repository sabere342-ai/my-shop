/**
 * The production sync authenticator (Master Plan §38.16, §12.4, §12.5;
 * §40.6 M2-S5).
 *
 * This is the code the M2-S4 record pointed at: the fail-closed
 * `FailClosedSyncAuthenticator` default is replaced by a real identity
 * resolution that proves, in order, everything a sync request may rely on:
 *
 * 1. **The bearer credential.** `AuthService.authenticate` verifies the RS256
 *    signature, the `iss`/`aud` pinning, the expiry, the live session state
 *    (revoked families are refused immediately), and the permission generation —
 *    the exact path every REST route takes (§10.3). No session lookup is
 *    skipped, so a device revocation's silent session-family revocation is seen
 *    here too.
 * 2. **The device binding (§12.4, §38.16.2).** A sync caller must present a
 *    token minted from a device-bound session. The `did` claim is a signed copy
 *    of the server-written `sessions.device_id` — never a request field — so
 *    the device is re-derived from verified material on every call.
 * 3. **The live device row (§12.5).** The binding must name an *active* device
 *    of an organization the principal is a member of. The row is read inside a
 *    trusted tenant transaction, so the RLS policy scopes the lookup the same
 *    way it scopes every tenant read, and a device of another organization is
 *    indistinguishable from a nonexistent one (no cross-tenant signal, §9.2).
 *    A REVOKED device is refused `DEVICE_REVOKED` for the whole request —
 *    reconnection after revocation never re-opens the feed (§38.16.4), and the
 *    ledger keeps every already-recorded row: refused, not discarded (§38.30.2).
 *
 * The organization a device belongs to is a *server fact stored on the device*;
 * it is resolved by the RLS read rather than read off the token or the body, so
 * a cross-tenant binding cannot be asserted into existence. The distinctive
 * device id makes at most one row visible across all candidate contexts, so the
 * scan is at worst one small transaction per claimed membership.
 *
 * Every refusal carries the stable §34.3 code. None carries the secret, the
 * token, or any internal detail (§13.1).
 */

import type { Logger as PinoLogger } from 'pino';
import { bearerCredential } from '../identity/jwt-auth.guard';
import type { AuthService } from '../identity/auth.service';
import type { PrismaHost } from '../identity/prisma-host';
import { withTenantTransaction } from '../database/tenant-context';
import { DomainError } from '../errors/domain.error';
import { ERROR_CODES } from '../errors/problem';
import type { SyncAuthRequest, SyncTrustedContext } from '../sync/push/sync-auth';

export class DeviceBoundSyncAuthenticator {
  constructor(
    private readonly auth: AuthService,
    private readonly host: PrismaHost,
    private readonly logger?: PinoLogger,
  ) {}

  async authenticate(request: SyncAuthRequest): Promise<SyncTrustedContext> {
    // 1. The exact REST authentication path: signature, session liveness,
    //    permission generation, session/device-claim agreement. Anything short
    //    throws inside, and the thrown code is the client's answer.
    const principal = await this.auth.authenticate(bearerCredential(request.authorizationHeader));

    // 2. The binding is a signed fact, not an assertion. A token minted from an
    //    unbound session cannot present one here — sync is a device capability.
    const deviceId = principal.deviceId;
    if (deviceId === undefined) {
      this.logRefusal(principal.userId, 'the access token is not bound to a device');
      throw new DomainError(
        ERROR_CODES.UNAUTHENTICATED,
        'sync requires an access token bound to a registered device (§12.4, §38.16.2)',
      );
    }

    // 3. The live device row, under the trusted tenant context of each claimed
    //    membership. The first context that can see the device owns it; a
    //    membership set without it (stale claim after membership loss, forged
    //    id, foreign tenant) fails closed.
    for (const organizationId of principal.organizations) {
      const resolved = await withTenantTransaction(this.host, organizationId, async (tx) =>
        tx.device.findUnique({
          where: { id: deviceId },
          select: { organizationId: true, status: true },
        }),
      );
      if (resolved === null) {
        continue;
      }

      if (resolved.status !== 'ACTIVE') {
        this.logRefusal(principal.userId, `device ${deviceId} is not active (§12.5)`);
        throw new DomainError(
          ERROR_CODES.DEVICE_REVOKED,
          'this device has been revoked: sync is refused and the queued mutations are quarantined, not discarded (§12.5)',
        );
      }

      // The row's tenant is a server fact the RLS scan derived; the trusted
      // context carries it, and the actor is the verified principal's subject
      // the §9.4 ingress re-validation will re-prove per mutation.
      return { organizationId: resolved.organizationId, deviceId, actorUserId: principal.userId };
    }

    this.logRefusal(principal.userId, 'the device binding does not name an active device of a member organization');
    throw new DomainError(
      ERROR_CODES.UNAUTHENTICATED,
      'the access token is not bound to an active device of a member organization',
    );
  }

  /** One redacted structured line per refusal; a diagnostic, never an oracle (§13.1). */
  private logRefusal(userId: string, reason: string): void {
    this.logger?.info({ component: 'device-sync-auth', userId, reason }, 'sync authentication refused —');
  }
}
