/**
 * The test-only ingress re-validators (Master Plan §9.4; M2-S4).
 *
 * Production binds `SYNC_INGRESS_REVALIDATOR` to
 * `MembershipPermissionRevalidator`, which re-proves the actor, their live
 * membership, and their §11 effective permissions before every effect. A test
 * that exercises the *authorized* push or pull path without standing up a real
 * tenant's RBAC rows overrides that port with an implementation from this file,
 * so the trusting code is structurally absent from a production build — it
 * lives under `test/`, which is never emitted.
 *
 * A re-validation acceptance test that needs the real machinery overrides
 * nothing: the production validator and its dependency are what run.
 */

import type { Prisma } from '@prisma/client';
import type { SyncIngressRevalidator } from '../../src/common/sync/push/ingress-revalidation';
import type { MutationPayload } from '../../src/common/sync/sync.contract';
import type { SyncTrustedContext } from '../../src/common/sync/push/sync-auth';

/**
 * Answers every re-validation with "admitted": the push-path analogue of the
 * permissive test authenticator. It records nothing and reads nothing — the
 * assertion a test makes with it is about the boundary behind the validator,
 * not the validator.
 */
export class PermitAllIngressRevalidator implements SyncIngressRevalidator {
  revalidate(tx: Prisma.TransactionClient, context: SyncTrustedContext, mutation: MutationPayload): Promise<void> {
    // Admits everything and consults nothing: taking the arguments keeps the
    // implementation honest about the signature it satisfies.
    void tx;
    void context;
    void mutation;
    return Promise.resolve();
  }
}
