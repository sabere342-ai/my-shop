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
import { INVENTORY_AGGREGATES } from '../../inventory/inventory.contract';
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
 * The required permission ids of one `(aggregateType, operationType)` admission.
 *
 * The §11.2 catalog is the only source of ids. M2-S4 admitted exactly one
 * composition — a SALE created by its own producer — because that is the one
 * the acceptance fixtures script against a server that has no other business
 * module. Business slices own the map when they own the aggregate: M4-S4's
 * Tier-2 inventory producer adds its two (§38.22 — a movement write rides
 * `inventory.adjust`, a count document rides `inventory.count`). A map entry
 * is either a static list or a payload-shaped resolver — the dynamic half of
 * the cost rules: an adjustment that *offers* a cost demands the cost
 * authority `catalog.cost.edit` at admission too, mirroring what the fold
 * refuses inside its transaction. Anything unmapped fails closed:
 * `PERMISSION_DENIED` with no second guess.
 */
type RequiredPermissions = readonly PermissionId[] | ((mutation: MutationPayload) => readonly PermissionId[]);

const REQUIRED_PERMISSION_BY_ADMISSION: ReadonlyMap<string, RequiredPermissions> = new Map<string, RequiredPermissions>(
  [
    [`SALE:${'CREATE'}`, ['sales.create'] as RequiredPermissions],
    // Tier 2 (§38.22, M4-S4): the offline inventory producer's admissions,
    // re-proven at acceptance against the current, live effective set (§9.4).
    [
      `${INVENTORY_AGGREGATES.adjustment}:${'CREATE'}`,
      (mutation: MutationPayload): readonly PermissionId[] =>
        // A cost offer rides the payload when the device recorded one; posting
        // it is the `catalog.cost.edit` act, so acceptance demands the same
        // authority the fold would demand an instant later.
        typeof mutation.payload['unitCostMinor'] === 'string'
          ? ['inventory.adjust', 'catalog.cost.edit']
          : ['inventory.adjust'],
    ],
    [`${INVENTORY_AGGREGATES.count}:${'CREATE'}`, ['inventory.count'] as RequiredPermissions],
  ],
);

/** The permissions the mutation's admission requires, or `null` when none is served yet. */
export function requiredPermissionsOf(mutation: MutationPayload): readonly PermissionId[] | null {
  const required = REQUIRED_PERMISSION_BY_ADMISSION.get(`${mutation.aggregateType}:${mutation.operationType}`);
  if (required === undefined) {
    return null;
  }
  return typeof required === 'function' ? required(mutation) : required;
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

    const required = requiredPermissionsOf(mutation);
    if (required === null || !required.every((permission) => effective.permissions.includes(permission))) {
      throw new MutationRejectedError(ERROR_CODES.PERMISSION_DENIED);
    }
  }
}
