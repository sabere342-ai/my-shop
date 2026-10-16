/**
 * Unit acceptance for the authorization service's decisions (§11, AC-05..AC-14).
 *
 * The database acceptance suite proves the real transactions and constraints; this
 * suite proves the **decisions** without a database, using a small in-memory
 * transaction client. It is the fast feedback loop for the rules a reviewer reads:
 * seeding is idempotent, the Owner is structural, an unknown or owner-exclusive id is
 * refused, and a committed change bumps `permissions_version`.
 *
 * The fake implements only the delegates the service calls; it is cast to
 * `PrismaClient` at the constructor, which is deliberate — the point is to exercise
 * the service's branch logic, not to re-implement PostgreSQL.
 */

import type { PrismaClient } from '@prisma/client';

import { DomainError } from '../../errors/domain.error';
import { ERROR_CODES, type ErrorCode } from '../../errors/problem';
import { PERMISSION_IDS } from './permission-catalog';
import { AuthorizationService } from './authorization.service';

interface RoleRow {
  id: string;
  organizationId: string;
  key: string;
  name: string;
  isSystem: boolean;
  isOwner: boolean;
}
interface GrantRow {
  organizationId: string;
  roleId: string;
  permissionId: string;
}
interface OverrideRow {
  organizationId: string;
  userId: string;
  permissionId: string;
  effect: 'ALLOW' | 'DENY';
}
interface MembershipRow {
  organizationId: string;
  userId: string;
  isOwner: boolean;
  roleId: string | null;
}
interface UserRow {
  id: string;
  permissionsVersion: number;
}

const ORG = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';

/** A minimal transaction client: enough of each delegate for the service's calls. */
class FakeDb {
  roles: RoleRow[] = [];
  grants: GrantRow[] = [];
  overrides: OverrideRow[] = [];
  memberships: MembershipRow[] = [];
  users: UserRow[] = [];
  private seq = 0;

  private nextId(): string {
    this.seq += 1;
    return `00000000-0000-4000-8000-${String(this.seq).padStart(12, '0')}`;
  }

  // The service reads `host.prisma.$transaction`; `prisma` is this instance.
  get prisma(): this {
    return this;
  }

  $executeRaw = (): Promise<number> => Promise.resolve(1);

  $transaction = <T>(run: (tx: FakeDb) => Promise<T>): Promise<T> => run(this);

  role = {
    findMany: (args: { where: { organizationId: string; key: { in: string[] } }; select: unknown }) =>
      this.roles.filter(
        (role) => role.organizationId === args.where.organizationId && args.where.key.in.includes(role.key),
      ),
    create: (args: { data: Omit<RoleRow, 'id'>; select: unknown }) => {
      const row: RoleRow = { id: this.nextId(), ...args.data };
      this.roles.push(row);
      return { id: row.id };
    },
    findUnique: (args: { where: { id: string } }): RoleRow | null =>
      this.roles.find((role) => role.id === args.where.id) ?? null,
  };

  rolePermission = {
    createMany: (args: { data: GrantRow[] }) => {
      for (const row of args.data) {
        if (!this.grants.some((grant) => grant.roleId === row.roleId && grant.permissionId === row.permissionId)) {
          this.grants.push({ ...row });
        }
      }
      return { count: args.data.length };
    },
    deleteMany: (args: { where: { roleId: string } }) => {
      const before = this.grants.length;
      this.grants = this.grants.filter((grant) => grant.roleId !== args.where.roleId);
      return { count: before - this.grants.length };
    },
    findMany: (args: { where: { roleId: string } }): { permissionId: string }[] =>
      this.grants
        .filter((grant) => grant.roleId === args.where.roleId)
        .map((grant) => ({ permissionId: grant.permissionId })),
  };

  permissionOverride = {
    findMany: (args: { where: { organizationId: string; userId: string } }): OverrideRow[] =>
      this.overrides.filter((o) => o.organizationId === args.where.organizationId && o.userId === args.where.userId),
    deleteMany: (args: { where: { organizationId: string; userId: string } }) => {
      const before = this.overrides.length;
      this.overrides = this.overrides.filter(
        (o) => !(o.organizationId === args.where.organizationId && o.userId === args.where.userId),
      );
      return { count: before - this.overrides.length };
    },
    createMany: (args: { data: OverrideRow[] }) => {
      this.overrides.push(...args.data.map((row) => ({ ...row })));
      return { count: args.data.length };
    },
  };

  organizationMembership = {
    findUnique: (args: {
      where: { organizationId_userId: { organizationId: string; userId: string } };
    }): MembershipRow | null => {
      const { organizationId, userId } = args.where.organizationId_userId;
      return this.memberships.find((m) => m.organizationId === organizationId && m.userId === userId) ?? null;
    },
    findMany: (args: { where: { organizationId: string; roleId: string } }): { userId: string }[] =>
      this.memberships
        .filter((m) => m.organizationId === args.where.organizationId && m.roleId === args.where.roleId)
        .map((m) => ({ userId: m.userId })),
    update: (args: {
      where: { organizationId_userId: { organizationId: string; userId: string } };
      data: { roleId: string | null };
    }) => {
      const { organizationId, userId } = args.where.organizationId_userId;
      const found = this.memberships.find((m) => m.organizationId === organizationId && m.userId === userId);
      if (found === undefined) throw new Error('membership not found');
      found.roleId = args.data.roleId;
      return found;
    },
    updateMany: (args: {
      where: { organizationId: string; isOwner: boolean; roleId: null };
      data: { roleId: string };
    }) => {
      let count = 0;
      for (const m of this.memberships) {
        if (
          m.organizationId === args.where.organizationId &&
          m.isOwner === args.where.isOwner &&
          m.roleId === args.where.roleId
        ) {
          m.roleId = args.data.roleId;
          count += 1;
        }
      }
      return { count };
    },
  };

  user = {
    findUniqueOrThrow: (args: { where: { id: string } }): { permissionsVersion: number } => {
      const found = this.users.find((u) => u.id === args.where.id);
      if (found === undefined) throw new Error('user not found');
      return { permissionsVersion: found.permissionsVersion };
    },
    updateMany: (args: { where: { id: { in: string[] } }; data: { permissionsVersion: { increment: number } } }) => {
      let count = 0;
      for (const u of this.users) {
        if (args.where.id.in.includes(u.id)) {
          u.permissionsVersion += args.data.permissionsVersion.increment;
          count += 1;
        }
      }
      return { count };
    },
  };
}

function serviceOver(db: FakeDb): AuthorizationService {
  return new AuthorizationService({ prisma: db as unknown as PrismaClient });
}

/** Unwraps a fixture lookup, failing the test loudly rather than asserting non-null. */
function must<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('expected the fake database to hold the fixture value');
  }
  return value;
}

function seedOrg(db: FakeDb): void {
  db.memberships.push({ organizationId: ORG, userId: OWNER, isOwner: true, roleId: null });
  db.memberships.push({ organizationId: ORG, userId: MEMBER, isOwner: false, roleId: null });
  db.users.push({ id: OWNER, permissionsVersion: 0 });
  db.users.push({ id: MEMBER, permissionsVersion: 0 });
}

function expectDomainError(run: () => Promise<unknown>, code: ErrorCode): Promise<void> {
  return run().then(
    () => {
      throw new Error(`expected a DomainError with code ${code}, but nothing was thrown`);
    },
    (error: unknown) => {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe(code);
    },
  );
}

describe('AuthorizationService', () => {
  it('seeds the six presets idempotently and assigns the Owner role (AC-05, AC-06, AC-26)', async () => {
    const db = new FakeDb();
    seedOrg(db);
    const service = serviceOver(db);

    await service.ensureOrganizationRoles(ORG);
    expect(db.roles).toHaveLength(6);
    const ownerRole = db.roles.find((role) => role.key === 'owner');
    expect(ownerRole?.isOwner).toBe(true);
    expect(db.grants.filter((g) => g.roleId === ownerRole?.id).map((g) => g.permissionId)).toHaveLength(
      PERMISSION_IDS.length,
    );
    expect(db.memberships.find((m) => m.userId === OWNER)?.roleId).toBe(ownerRole?.id);

    const before = db.roles.length;
    await service.ensureOrganizationRoles(ORG);
    expect(db.roles).toHaveLength(before);
  });

  it('resolves the whole catalog for the Owner and nothing for an unclassified member', async () => {
    const db = new FakeDb();
    seedOrg(db);
    const service = serviceOver(db);

    const owner = await service.resolveForMembership(ORG, OWNER);
    expect(owner.isOwner).toBe(true);
    expect(owner.permissions).toEqual(PERMISSION_IDS);

    const member = await service.resolveForMembership(ORG, MEMBER);
    expect(member.isOwner).toBe(false);
    expect(member.role).toBeNull();
    expect(member.permissions).toEqual([]);
  });

  it('refuses to resolve for a non-member', async () => {
    const db = new FakeDb();
    seedOrg(db);
    const service = serviceOver(db);
    await expectDomainError(
      () => service.resolveForMembership(ORG, '44444444-4444-4444-8444-444444444444'),
      ERROR_CODES.ORGANIZATION_FORBIDDEN,
    );
  });

  it('replaces a role’s grants and bumps every holder (AC-12)', async () => {
    const db = new FakeDb();
    seedOrg(db);
    const service = serviceOver(db);
    await service.ensureOrganizationRoles(ORG);
    const manager = must(db.roles.find((role) => role.key === 'manager'));
    must(db.memberships.find((m) => m.userId === MEMBER)).roleId = manager.id;

    const view = await service.replaceRolePermissions({
      organizationId: ORG,
      roleId: manager.id,
      permissionIds: ['sales.create', 'sales.view'],
    });
    expect(view.permissions).toEqual(['sales.view', 'sales.create']);
    expect(db.users.find((u) => u.id === MEMBER)?.permissionsVersion).toBe(1);
    // The Owner never holds this role, so its version is untouched.
    expect(db.users.find((u) => u.id === OWNER)?.permissionsVersion).toBe(0);
  });

  it('refuses an unknown permission id and an owner-exclusive id for a non-owner role (AC-11)', async () => {
    const db = new FakeDb();
    seedOrg(db);
    const service = serviceOver(db);
    await service.ensureOrganizationRoles(ORG);
    const manager = must(db.roles.find((role) => role.key === 'manager'));

    await expectDomainError(
      () =>
        service.replaceRolePermissions({ organizationId: ORG, roleId: manager.id, permissionIds: ['sales.teleport'] }),
      ERROR_CODES.VALIDATION_FAILED,
    );
    await expectDomainError(
      () =>
        service.replaceRolePermissions({
          organizationId: ORG,
          roleId: manager.id,
          permissionIds: ['accounting.journal.post'],
        }),
      ERROR_CODES.VALIDATION_FAILED,
    );
  });

  it('refuses to edit the Owner role (structural)', async () => {
    const db = new FakeDb();
    seedOrg(db);
    const service = serviceOver(db);
    await service.ensureOrganizationRoles(ORG);
    const ownerRole = must(db.roles.find((role) => role.key === 'owner'));
    await expectDomainError(
      () =>
        service.replaceRolePermissions({ organizationId: ORG, roleId: ownerRole.id, permissionIds: ['sales.view'] }),
      ERROR_CODES.VALIDATION_FAILED,
    );
  });

  it('assigns overrides: ALLOW adds and DENY removes, and bumps the user (AC-08, AC-13)', async () => {
    const db = new FakeDb();
    seedOrg(db);
    const service = serviceOver(db);
    await service.ensureOrganizationRoles(ORG);
    const cashier = must(db.roles.find((role) => role.key === 'cashier'));

    const result = await service.assignMembershipAuthorization({
      organizationId: ORG,
      userId: MEMBER,
      roleId: cashier.id,
      allow: ['pricing.override'],
      deny: ['sales.create'],
    });
    expect(result.permissions).toContain('pricing.override');
    expect(result.permissions).not.toContain('sales.create');
    expect(db.users.find((u) => u.id === MEMBER)?.permissionsVersion).toBe(1);
  });

  it('refuses an override for the owner membership, an owner-exclusive ALLOW, and an allow/deny overlap', async () => {
    const db = new FakeDb();
    seedOrg(db);
    const service = serviceOver(db);
    await service.ensureOrganizationRoles(ORG);

    await expectDomainError(
      () =>
        service.assignMembershipAuthorization({
          organizationId: ORG,
          userId: OWNER,
          roleId: null,
          allow: [],
          deny: [],
        }),
      ERROR_CODES.VALIDATION_FAILED,
    );
    await expectDomainError(
      () =>
        service.assignMembershipAuthorization({
          organizationId: ORG,
          userId: MEMBER,
          roleId: null,
          allow: ['accounting.journal.post'],
          deny: [],
        }),
      ERROR_CODES.VALIDATION_FAILED,
    );
    await expectDomainError(
      () =>
        service.assignMembershipAuthorization({
          organizationId: ORG,
          userId: MEMBER,
          roleId: null,
          allow: ['sales.create'],
          deny: ['sales.create'],
        }),
      ERROR_CODES.VALIDATION_FAILED,
    );
  });

  it('refuses an unknown role and a role of another organization', async () => {
    const db = new FakeDb();
    seedOrg(db);
    const service = serviceOver(db);
    await service.ensureOrganizationRoles(ORG);
    await expectDomainError(
      () =>
        service.assignMembershipAuthorization({
          organizationId: ORG,
          userId: MEMBER,
          roleId: '00000000-0000-4000-8000-999999999999',
          allow: [],
          deny: [],
        }),
      ERROR_CODES.NOT_FOUND,
    );
  });
});
