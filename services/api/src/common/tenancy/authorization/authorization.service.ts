/**
 * §8.4/§11 / §40.6 M2-S3 — the tenancy-context authorization service.
 *
 * This is the DB-backed surface the authorization engine needs and nothing more: the
 * idempotent seeding of the six §11.3 preset roles, effective-permission resolution,
 * role listing, role-permission replacement, per-user role/override assignment, and
 * the **atomic `users.permissions_version` bump** that makes a committed
 * authorization change invalidate outstanding tokens (§10.3, §11).
 *
 * Three properties are structural rather than conventional:
 *
 * - **Seeding is idempotent application code, never SQL (§35.4).** A role is tenant
 *   data; the migration creates the tables, and this service materializes the presets.
 *   Because the bootstrap composition root is out of this slice's allowed paths, the
 *   seed runs **lazily** — the first authorization touch of an organization seeds it,
 *   which is also the §35.4 upgrade path for an organization that existed before
 *   `0007`. Seeding is insert-only: it never deletes a row an administrator edited,
 *   and it never overwrites a role's stored grants.
 * - **The Owner is structural.** The resolver already returns the whole catalog for an
 *   owner; here the write path agrees — the Owner role cannot be edited and the owner
 *   membership accepts no role change and no override, so the stored state can never
 *   disagree with the resolution.
 * - **A change and its version bump are one transaction.** The `permissions_version`
 *   increment is written through the same interactive transaction as the grant it
 *   invalidates, so a committed grant and its invalidation are never separated.
 *
 * Every read is tenant-scoped: `organizationId` is a parameter here and, at the HTTP
 * boundary, is taken from the route and checked against the token's membership set
 * (§9.3) before this service is called. A body never names a tenant.
 */

import { PermissionEffect, type Prisma, type PrismaClient } from '@prisma/client';

import { DomainError } from '../../errors/domain.error';
import { ERROR_CODES } from '../../errors/problem';
import { withTenantTransaction } from '../../database/tenant-context';
import { isOwnerExclusivePermission, isPermissionId, type PermissionId } from './permission-catalog';
import { orderPermissionIds, resolveEffectivePermissions } from './effective-permissions';
import { OWNER_ROLE_KEY, ROLE_PRESETS, ROLE_PRESET_KEYS } from './role-presets';

/** The database host the service depends on: the connected client, read at call time. */
export interface PrismaHost {
  readonly prisma: PrismaClient;
}

/** The role summary a reader sees. */
export interface RoleView {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly isSystem: boolean;
  readonly isOwner: boolean;
  /** The stored grants, in catalog order (an unknown stored id is dropped). */
  readonly permissions: readonly PermissionId[];
}

/** The resolved authorization for one membership. */
export interface EffectiveAuthorization {
  readonly organizationId: string;
  readonly userId: string;
  readonly isOwner: boolean;
  readonly role: { readonly id: string; readonly key: string; readonly name: string } | null;
  readonly permissions: readonly PermissionId[];
  readonly permissionsVersion: number;
}

/** Replace a role's grants wholesale. */
export interface ReplaceRolePermissionsInput {
  readonly organizationId: string;
  readonly roleId: string;
  readonly permissionIds: readonly string[];
}

/** Assign a membership's role and per-user overrides atomically. */
export interface AssignMembershipAuthorizationInput {
  readonly organizationId: string;
  readonly userId: string;
  readonly roleId: string | null;
  readonly allow: readonly string[];
  readonly deny: readonly string[];
}

type Tx = Prisma.TransactionClient;

/** The §10.4-style advisory-lock namespace for one organization's seeding. */
function seedLockKey(organizationId: string): string {
  return `authorization:seed:${organizationId}`;
}

/** The advisory-lock namespace for one role's grants. */
function roleLockKey(roleId: string): string {
  return `authorization:role:${roleId}`;
}

/** The advisory-lock namespace for one membership's role and overrides. */
function membershipLockKey(organizationId: string, userId: string): string {
  return `authorization:membership:${organizationId}:${userId}`;
}

function validationFailed(diagnostic: string, field: string, messages: readonly string[]): DomainError {
  return new DomainError(ERROR_CODES.VALIDATION_FAILED, diagnostic, [{ field, messages }]);
}

/**
 * Validates one permission id for a write.
 *
 * @param ownerRole whether the target role is the Owner role; only then may an
 *   owner-exclusive id be stored, since the Owner structurally holds every permission.
 */
function assertStorablePermission(id: string, ownerRole: boolean, field: string): PermissionId {
  if (!isPermissionId(id)) {
    throw validationFailed(`unknown permission id: ${id}`, field, [`"${id}" is not a permission this server knows`]);
  }
  if (isOwnerExclusivePermission(id) && !ownerRole) {
    throw validationFailed(`owner-exclusive permission refused for a non-owner role: ${id}`, field, [
      `"${id}" is reserved for the organization owner and cannot be granted`,
    ]);
  }
  return id;
}

/**
 * Increments `permissions_version` for the given users, in the caller's transaction.
 *
 * A single `UPDATE ... SET permissions_version = permissions_version + 1` is
 * atomic per row, so concurrent bumps cannot lose an increment and the value can
 * never go negative (§10.3, AC-14). An empty set is a no-op.
 */
async function bumpPermissionsVersion(tx: Tx, userIds: readonly string[]): Promise<void> {
  if (userIds.length === 0) {
    return;
  }
  await tx.user.updateMany({
    where: { id: { in: [...new Set(userIds)] } },
    data: { permissionsVersion: { increment: 1 } },
  });
}

/** The tenancy-context authorization service. One instance per application. */
export class AuthorizationService {
  constructor(private readonly host: PrismaHost) {}

  /**
   * The §35.4 idempotent backfill: materializes any missing preset role and its
   * grants, and assigns the Owner role to the organization's owner membership.
   *
   * Exposed for an operator or a composition root that wants an eager seed; the
   * resolution and administration paths call the same seeding transactionally.
   */
  async ensureOrganizationRoles(organizationId: string): Promise<void> {
    return withTenantTransaction(this.host, organizationId, (tx) => this.seedRoles(tx, organizationId));
  }

  /**
   * Resolves the effective permissions of one membership.
   *
   * Seeds first (the lazy §35.4 upgrade), then reads the membership, its role's
   * grants, and its overrides, and resolves. A missing membership is refused
   * `ORGANIZATION_FORBIDDEN` — the caller's guard turns that into the §9.3 response
   * and records the security event; this context has no logger bound to it.
   *
   * M2-S4: the whole read runs inside the trusted tenant transaction (§8.2),
   * so a role or grant of any other tenant is invisible even if the resolver
   * were fed a cross-tenant id — the database, not only the guard, refuses it.
   */
  async resolveForMembership(organizationId: string, userId: string): Promise<EffectiveAuthorization> {
    return withTenantTransaction(this.host, organizationId, async (tx) => {
      await this.seedRoles(tx, organizationId);
      return this.readEffective(tx, organizationId, userId);
    });
  }

  /**
   * The transaction-scoped half of the resolver (Master Plan §9.4, M2-S4): the
   * same §11 resolution rules as `resolveForMembership`, run inside **a caller's
   * transaction** instead of opening one.
   *
   * This is what the offline-mutation ingress validator uses, so the
   * membership-and-permission read and the mutation's effect share exactly one
   * transaction and cannot disagree. No seeding happens here: the caller's
   * transaction is the mutation's ledger transaction, and the lazy seed for the
   * organization ran (or runs) at its authorization touch; an unseeded tenant
   * yields an empty permission set, which fails closed (§9.4).
   */
  readEffectiveInTransaction(tx: Tx, organizationId: string, userId: string): Promise<EffectiveAuthorization> {
    return this.readEffective(tx, organizationId, userId);
  }

  /** Lists an organization's roles with their stored grants, in catalog order. */
  async listRoles(organizationId: string): Promise<readonly RoleView[]> {
    return withTenantTransaction(this.host, organizationId, async (tx) => {
      await this.seedRoles(tx, organizationId);
      const roles = await tx.role.findMany({
        where: { organizationId },
        select: {
          id: true,
          key: true,
          name: true,
          isSystem: true,
          isOwner: true,
          permissions: { select: { permissionId: true } },
        },
        orderBy: { key: 'asc' },
      });
      return roles.map((role) => ({
        id: role.id,
        key: role.key,
        name: role.name,
        isSystem: role.isSystem,
        isOwner: role.isOwner,
        permissions: orderPermissionIds(role.permissions.map((grant) => grant.permissionId)),
      }));
    });
  }

  /**
   * Replaces a role's grants wholesale and invalidates every holder of the role.
   *
   * The Owner role is refused: its set is the catalog by structure, so an edit could
   * only make the stored state disagree with the resolution. An unknown id and an
   * owner-exclusive id for a non-owner role are both refused (§11.2, AC-11). Every
   * non-owner membership holding the role gets one `permissions_version` increment
   * in the same transaction (AC-12).
   */
  async replaceRolePermissions(input: ReplaceRolePermissionsInput): Promise<RoleView> {
    return withTenantTransaction(this.host, input.organizationId, async (tx) => {
      await this.seedRoles(tx, input.organizationId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${roleLockKey(input.roleId)}, 0))`;

      const role = await tx.role.findUnique({
        where: { id: input.roleId },
        select: { id: true, key: true, name: true, isSystem: true, isOwner: true, organizationId: true },
      });
      if (role === null || role.organizationId !== input.organizationId) {
        // ADR-029: a role of another organization is 404, not 403, so its existence
        // is not leaked.
        throw new DomainError(ERROR_CODES.NOT_FOUND, 'no such role in this organization');
      }
      if (role.isOwner) {
        throw validationFailed('the owner role holds every permission by structure and cannot be edited', 'roleId', [
          'the owner role always holds every permission and its grants are not editable',
        ]);
      }

      const wanted = [...new Set(input.permissionIds)];
      const validated = wanted.map((id) => assertStorablePermission(id, false, 'permissionIds'));

      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      if (validated.length > 0) {
        await tx.rolePermission.createMany({
          data: validated.map((permissionId) => ({
            organizationId: role.organizationId,
            roleId: role.id,
            permissionId,
          })),
          skipDuplicates: true,
        });
      }

      const holders = await tx.organizationMembership.findMany({
        where: { organizationId: role.organizationId, roleId: role.id },
        select: { userId: true },
      });
      await bumpPermissionsVersion(
        tx,
        holders.map((holder) => holder.userId),
      );

      return {
        id: role.id,
        key: role.key,
        name: role.name,
        isSystem: role.isSystem,
        isOwner: false,
        permissions: orderPermissionIds(validated),
      };
    });
  }

  /**
   * Assigns a membership's role and per-user overrides atomically, then invalidates
   * that user.
   *
   * The whole override set is replaced (delete then insert) so the operation is
   * "set", not "merge". The owner membership is refused: it holds every permission by
   * structure, so a role change or an override there could only disagree with the
   * resolution. An `ALLOW` for an owner-exclusive id is refused, and an id that
   * appears in both `allow` and `deny` is refused as a contradiction.
   */
  async assignMembershipAuthorization(input: AssignMembershipAuthorizationInput): Promise<EffectiveAuthorization> {
    return withTenantTransaction(this.host, input.organizationId, async (tx) => {
      await this.seedRoles(tx, input.organizationId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${membershipLockKey(
        input.organizationId,
        input.userId,
      )}, 0))`;

      const membership = await tx.organizationMembership.findUnique({
        where: { organizationId_userId: { organizationId: input.organizationId, userId: input.userId } },
        select: { isOwner: true },
      });
      if (membership === null) {
        throw new DomainError(ERROR_CODES.ORGANIZATION_FORBIDDEN, 'no such membership in this organization');
      }
      if (membership.isOwner) {
        throw validationFailed(
          'the owner membership holds every permission by structure; its role and overrides cannot be changed',
          'userId',
          ['the organization owner always holds every permission and accepts no override'],
        );
      }

      if (input.roleId !== null) {
        const role = await tx.role.findUnique({
          where: { id: input.roleId },
          select: { id: true, organizationId: true },
        });
        if (role === null || role.organizationId !== input.organizationId) {
          throw new DomainError(ERROR_CODES.NOT_FOUND, 'no such role in this organization');
        }
      }

      const allow = [...new Set(input.allow)];
      const deny = [...new Set(input.deny)];
      for (const id of allow) {
        assertStorablePermission(id, false, 'allow');
      }
      for (const id of deny) {
        if (!isPermissionId(id)) {
          throw validationFailed(`unknown permission id: ${id}`, 'deny', [
            `"${id}" is not a permission this server knows`,
          ]);
        }
      }
      const overlap = allow.find((id) => deny.includes(id));
      if (overlap !== undefined) {
        throw validationFailed(`permission appears in both allow and deny: ${overlap}`, 'allow', [
          `"${overlap}" cannot be both allowed and denied`,
        ]);
      }

      await tx.permissionOverride.deleteMany({
        where: { organizationId: input.organizationId, userId: input.userId },
      });
      const rows: { readonly permissionId: string; readonly effect: PermissionEffect }[] = [
        ...allow.map((permissionId) => ({ permissionId, effect: PermissionEffect.ALLOW })),
        ...deny.map((permissionId) => ({ permissionId, effect: PermissionEffect.DENY })),
      ];
      if (rows.length > 0) {
        await tx.permissionOverride.createMany({
          data: rows.map((row) => ({
            organizationId: input.organizationId,
            userId: input.userId,
            permissionId: row.permissionId,
            effect: row.effect,
          })),
        });
      }

      await tx.organizationMembership.update({
        where: { organizationId_userId: { organizationId: input.organizationId, userId: input.userId } },
        data: { roleId: input.roleId },
      });

      await bumpPermissionsVersion(tx, [input.userId]);

      return this.readEffective(tx, input.organizationId, input.userId);
    });
  }

  /**
   * Reads and resolves one membership's effective authorization.
   *
   * Assumes the organization is already seeded (the callers seed first in the same
   * transaction). A missing membership is refused, never defaulted to a permission.
   */
  private async readEffective(tx: Tx, organizationId: string, userId: string): Promise<EffectiveAuthorization> {
    const membership = await tx.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { isOwner: true, roleId: true },
    });
    if (membership === null) {
      throw new DomainError(ERROR_CODES.ORGANIZATION_FORBIDDEN, 'no such membership in this organization');
    }

    const role =
      membership.roleId === null
        ? null
        : await tx.role.findUnique({
            where: { id: membership.roleId },
            select: { id: true, key: true, name: true },
          });

    const rolePermissionIds =
      membership.roleId === null
        ? null
        : (
            await tx.rolePermission.findMany({
              where: { roleId: membership.roleId },
              select: { permissionId: true },
            })
          ).map((grant) => grant.permissionId);

    const overrides = await tx.permissionOverride.findMany({
      where: { organizationId, userId },
      select: { permissionId: true, effect: true },
    });

    const permissions = resolveEffectivePermissions({
      isOwner: membership.isOwner,
      rolePermissionIds,
      overrides: overrides.map((override) => ({
        permissionId: override.permissionId,
        effect: override.effect,
      })),
    });

    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { permissionsVersion: true },
    });

    return {
      organizationId,
      userId,
      isOwner: membership.isOwner,
      role,
      permissions,
      permissionsVersion: user.permissionsVersion,
    };
  }

  /**
   * Materializes the presets for one organization in the caller's transaction.
   *
   * Insert-only and idempotent (§35.4). A fast read of the six preset keys avoids the
   * advisory lock on every resolution; the slow path takes a per-organization lock
   * (so two racing first-touches cannot both insert) and re-reads under it, then
   * creates only what is missing. The Owner role is assigned to the owner membership
   * in the same transaction, so an organization is never left half-seeded.
   *
   * Seeding never bumps `permissions_version`: it establishes the baseline and does
   * not change any effective set (the owner already held every permission; a
   * membership with no role still holds nothing until an explicit assignment).
   */
  private async seedRoles(tx: Tx, organizationId: string): Promise<void> {
    const presetKeys = [...ROLE_PRESET_KEYS];
    const found = await tx.role.findMany({
      where: { organizationId, key: { in: presetKeys } },
      select: { id: true, key: true },
    });
    if (found.length === presetKeys.length) {
      return;
    }

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${seedLockKey(organizationId)}, 0))`;

    const recheck = await tx.role.findMany({
      where: { organizationId, key: { in: presetKeys } },
      select: { id: true, key: true },
    });
    const roleIdByKey = new Map(recheck.map((role) => [role.key, role.id]));

    for (const preset of ROLE_PRESETS) {
      if (roleIdByKey.has(preset.key)) {
        continue;
      }
      const created = await tx.role.create({
        data: {
          organizationId,
          key: preset.key,
          name: preset.name,
          isSystem: true,
          isOwner: preset.isOwner,
        },
        select: { id: true },
      });
      roleIdByKey.set(preset.key, created.id);

      if (preset.permissions.length > 0) {
        await tx.rolePermission.createMany({
          data: preset.permissions.map((permissionId) => ({
            organizationId,
            roleId: created.id,
            permissionId,
          })),
          skipDuplicates: true,
        });
      }
    }

    const ownerRoleId = roleIdByKey.get(OWNER_ROLE_KEY);
    if (ownerRoleId !== undefined) {
      await tx.organizationMembership.updateMany({
        where: { organizationId, isOwner: true, roleId: null },
        data: { roleId: ownerRoleId },
      });
    }
  }
}
