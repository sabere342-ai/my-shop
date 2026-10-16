/**
 * §11.1/§11.4 / §40.6 M2-S3 — the pure **effective-permission resolver**.
 *
 * This is the single decision point of the authorization model, and it is
 * deliberately a pure function with no database and no clock: resolution is a rule,
 * not an effect. §11.4 fixes the order — a role's grant set, then the per-user
 * `allow`/`deny` overrides, then the **structural** restrictions — and everything
 * surprising about the model lives in that order.
 *
 * The four invariants this function makes structural:
 *
 * 1. **The Owner holds every catalog permission** (§11.3). Owner-ness is not a set
 *    that can be shrunk: an owner's effective set is the whole catalog, whatever the
 *    role rows or the override rows happen to say. This mirrors the write path, which
 *    refuses an override for an owner membership, so the two agree even if a writer
 *    bypasses the service.
 * 2. **`DENY` beats everything.** A `DENY` removes a permission whether it came from
 *    the role or from an `ALLOW` override for the same id. Because there is at most
 *    one override row per `(organization, user, permission)` the two effects cannot
 *    both be stored, but the resolver orders the passes (`ALLOW` first, then `DENY`)
 *    so a combined input still resolves the safe way.
 * 3. **`ownerExclusive` is structural, not a grant.** A non-owner can never hold an
 *    owner-exclusive permission (§11.2, §38.17): it is stripped at the *end*, after
 *    every grant and override, so neither a role row nor an `ALLOW` override can
 *    confer it. This is the §40.6 M2-S3 key acceptance.
 * 4. **Fail closed.** An id the catalog does not know is **ignored** — it grants
 *    nothing and it denies nothing — and an absent role or an empty set yields the
 *    empty set, never a default permission. Resolution is the one place a missing
 *    fact must never read as "allow".
 *
 * The result is returned in **catalog order**, so a snapshot or a response built from
 * it is byte-stable and two resolutions of the same state compare equal.
 */

import { isOwnerExclusivePermission, isPermissionId, PERMISSION_IDS, type PermissionId } from './permission-catalog';

/** The closed vocabulary of an override, mirroring the `permission_effect` enum. */
export type OverrideEffect = 'ALLOW' | 'DENY';

/** One override as the resolver consumes it. Only the effect and the id matter. */
export interface PermissionOverrideEntry {
  readonly permissionId: PermissionId;
  readonly effect: OverrideEffect;
}

/** Everything the resolver needs. All of it is server state; none of it is the request. */
export interface ResolutionInput {
  /** Whether this membership is the organization's single owner (§11.3). */
  readonly isOwner: boolean;
  /**
   * The permission ids the membership's role grants. `null` means "no role" — an
   * unclassified membership, which resolves to the empty set rather than to a
   * default grant (§11.3).
   */
  readonly rolePermissionIds: readonly PermissionId[] | null;
  /** The per-user overrides, in any order. */
  readonly overrides: readonly PermissionOverrideEntry[];
}

/**
 * Resolves the effective permission set.
 *
 * @returns the effective ids, in catalog order, deduplicated. Never a superset of
 *   the catalog. Owner-ness short-circuits to the whole catalog.
 */
export function resolveEffectivePermissions(input: ResolutionInput): readonly PermissionId[] {
  if (input.isOwner) {
    // §11.3: the Owner always holds every permission. An override cannot shrink this
    // (the write path refuses one), and a future catalog addition is included
    // automatically because the answer is the catalog, not a stored set.
    return PERMISSION_IDS;
  }

  const candidates = new Set<PermissionId>();

  // 1. The role's grants, filtered to known ids (fail closed on an unknown id).
  for (const id of input.rolePermissionIds ?? []) {
    if (isPermissionId(id)) {
      candidates.add(id);
    }
  }

  // 2. ALLOW overrides add, DENY overrides remove. Two passes, ALLOW first, so a
  //    combined input resolves `DENY` beats `ALLOW` (§11.4).
  for (const override of input.overrides) {
    if (override.effect === 'ALLOW' && isPermissionId(override.permissionId)) {
      candidates.add(override.permissionId);
    }
  }
  for (const override of input.overrides) {
    if (override.effect === 'DENY') {
      candidates.delete(override.permissionId);
    }
  }

  // 3. Structural restriction last: a non-owner can never hold an owner-exclusive
  //    permission, however it was granted (§11.2, §38.17).
  return Object.freeze(PERMISSION_IDS.filter((id) => candidates.has(id) && !isOwnerExclusivePermission(id)));
}

/**
 * The resolver result as a membership test.
 *
 * The guard asks one question — "does this user hold this permission?" — and a `Set`
 * answers it without a linear scan. The ordered array stays the canonical form the
 * snapshot signs.
 */
export function toPermissionSet(permissions: readonly PermissionId[]): ReadonlySet<PermissionId> {
  return new Set(permissions);
}

/** True when `permissions` contains `id`. A convenience for a single check. */
export function holdsPermission(permissions: readonly PermissionId[], id: PermissionId): boolean {
  return permissions.includes(id);
}
