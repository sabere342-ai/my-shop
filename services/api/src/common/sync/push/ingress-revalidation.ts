/**
 * The offline-mutation ingress re-validator (Master Plan §9.4 T-8…T-12, §38.16.4;
 * M2-S4).
 *
 * The §38.16 boundary already proves that a batch is *authenticated* and asserts
 * its own tenant correctly. That proves who was online when the token was
 * minted — nothing more. An offline device appears days later carrying
 * mutations whose authority may have changed in every way the server-side
 * fact can change: the membership may have been classified, the role may have
 * been replaced, an override may have denied. The §9.4 answer is
 * **re-validation at acceptance**: before a mutation's effect runs, the
 * current, live, server-side authorization facts are re-read inside the same
 * transaction the effect will commit in, so what the ledger applies is exactly
 * what this validator proved.
 *
 * Three facts are re-proven per mutation, in order:
 *
 * 1. **Actor.** The trusted context carries a verified actor (`SYNC_AUTHENTICATOR` §38.16:
 *    M2-S2's claim today, M2-S5's device binding later) — never the body's
 *    `actorUserId`, which is an assertion and is not consulted. No verified
 *    actor means no authority: the mutation is refused `UNAUTHENTICATED` and
 *    recorded.
 * 2. **Membership.** The actor must hold a live `organization_memberships` row
 *    in the trusted organization — re-read from the database *now*, never from
 *    a cached snapshot (§38.16.3 proxies are claims, not authority). Failures
 *    are recorded `ORGANIZATION_FORBIDDEN`.
 * 3. **Effective permissions.** The actor's current §11 effective set — role
 *    grants evaluated then per-user allow/deny overrides — must contain the
 *    required permission of the mutation. Failures are recorded
 *    `PERMISSION_DENIED`.
 *
 * Every refusal is thrown as a `MutationRejectedError`, so the M1b-S4 ledger
 * records a durable per-mutation REJECTED row (§38.13): the next replay is
 * answered from the store, the batch keeps moving (§38.10.3), and nothing the
 * actor lost permission for silently applies or silently drops.
 *
 * The permission map is deliberately minimal and fail-closed: no business
 * module exists yet (§40.5), so the only aggregate this slice can honestly
 * name is the SALE sale its test fixtures exercise; an aggregate without a
 * mapped permission is refused rather than guessed. Business slices own the
 * map when they own the aggregate.
 */

import type { Prisma } from '@prisma/client';
import { DomainError } from '../../errors/domain.error';
import { ERROR_CODES } from '../../errors/problem';
import type { AuthorizationService, EffectiveAuthorization } from '../../tenancy/authorization/authorization.service';
import type { PermissionId } from '../../tenancy/authorization/permission-catalog';
import { MutationRejectedError } from '../ledger/mutation-ledger.errors';
import type { MutationPayload } from '../sync.contract';
import type { SyncTrustedContext } from './sync-auth';

/** Injection token for the ingress re-validator, overridable in tests only. */
export const SYNC_INGRESS_REVALIDATOR = Symbol('SYNC_INGRESS_REVALIDATOR');

/**
 * The per-mutation hook the push service hands to the ledger
 * (`ApplyMutationRequest.validateIngress`). It runs inside the ledger's
 * tenant transaction, after the idempotency lookup and before the effect
 * (§9.4: a stored replay answers from the record without a second
 * authorization, so rejected pushes are replay-stable).
 */
export interface SyncIngressRevalidator {
  revalidate(tx: Prisma.TransactionClient, context: SyncTrustedContext, mutation: MutationPayload): Promise<void>;
}

/**
 * The required permission id of one `(aggregateType, operationType)` admission.
 *
 * The §11.2 catalog is the only source of ids. M2-S4 admits exactly one
 * composition — a SALE created by its own producer — because that is the one
 * the acceptance fixtures can script against a server that has no business
 * module yet. Anything else fails closed: `PERMISSION_DENIED` with no second
 * guess.
 */
const REQUIRED_PERMISSION_BY_ADMISSION: ReadonlyMap<string, readonly PermissionId[]> = new Map([
  [`SALE:${'CREATE'}`, ['sales.create']],
]);

/** The permission the mutation's admission requires, or `null` when none is served yet. */
export function requiredPermissionOf(mutation: MutationPayload): PermissionId | null {
  const required = REQUIRED_PERMISSION_BY_ADMISSION.get(`${mutation.aggregateType}:${mutation.operationType}`);
  return required === undefined ? null : (required[0] ?? null);
}

/**
 * The production re-validator: server-side membership and §11 effective
 * permissions, re-read inside the caller's transaction through the same
 * authorization context the HTTP guards resolve with — one resolution rule
 * set, two callers (§7.2).
 *
 * `readEffectiveInTransaction` opens nothing of its own and seeds nothing
 * (§35.4's lazy seed is the authorization touch, never a silent mutation-side
 * write), so an admission always sees current committed state.
 */
export class MembershipPermissionRevalidator implements SyncIngressRevalidator {
  constructor(private readonly authorization: AuthorizationService) {}

  async revalidate(
    tx: Prisma.TransactionClient,
    context: SyncTrustedContext,
    mutation: MutationPayload,
  ): Promise<void> {
    // 1. Actor — authority, never an assertion. The §38.16 identity check
    //    (assertIdentity) invalidated mismatched body assertions already; the
    //    absence of a verified actor is a refusal recorded per mutation.
    const actorUserId = context.actorUserId;
    if (actorUserId === undefined) {
      throw new MutationRejectedError(ERROR_CODES.UNAUTHENTICATED);
    }

    // 2 + 3. Live membership and effective permissions, one read, one moment:
    //        the validation cannot observe a world the effect did not.
    let effective: EffectiveAuthorization;
    try {
      effective = await this.authorization.readEffectiveInTransaction(tx, context.organizationId, actorUserId);
    } catch (error) {
      if (error instanceof DomainError) {
        // A missing membership resolves to ORGANIZATION_FORBIDDEN from the §11
        // reader; the ledger records the same code the HTTP guard answers
        // with, so the client sees one consistent vocabulary offline and
        // online.
        throw new MutationRejectedError(error.code);
      }
      throw error;
    }

    const required = requiredPermissionOf(mutation);
    if (required === null || !effective.permissions.includes(required)) {
      throw new MutationRejectedError(ERROR_CODES.PERMISSION_DENIED);
    }
  }
}
