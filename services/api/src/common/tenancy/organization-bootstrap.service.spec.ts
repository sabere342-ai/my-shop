/**
 * The organization bootstrap service — the §10.4 idempotency contract as pure
 * logic.
 *
 * The database proves the atomic, concurrent behaviour (`postgres.db-spec.ts`);
 * this suite pins the decisions that must be identical whether or not a lock
 * was contended: what counts as an *identical* retry, what counts as a
 * *conflicting* one, which stored shapes are anomalies rather than conflicts,
 * and that the two advisory locks are always taken in the same order.
 *
 * The in-memory transaction stand-in also rolls back: a probe failure restores
 * the store, so "zero rows after a failure" (AC-05) is asserted here as well as
 * against PostgreSQL — the fake mirrors the property rather than pretending it
 * does not matter.
 */

import type { Prisma } from '@prisma/client';
import type { Logger as PinoLogger } from 'pino';
import { EmailShapeError, canonicalizeEmail } from '../identity/user-provisioning';
import type { PrismaHost } from '../sync/ledger/mutation-ledger.service';
import {
  BootstrapConflictError,
  BootstrapInputError,
  BootstrapStateAnomalyError,
} from './organization-bootstrap.errors';
import {
  normalizeBootstrapRequest,
  OrganizationBootstrapService,
  type BootstrapRequest,
} from './organization-bootstrap.service';

interface StoredOrganizationRow {
  id: string;
  name: string;
  status: 'ACTIVE' | 'DEACTIVATED';
  bootstrapKey: string;
  createdAt: Date;
}

interface StoredUserRow {
  id: string;
  email: string;
  createdAt: Date;
}

interface StoredMembershipRow {
  id: string;
  organizationId: string;
  userId: string;
  isOwner: boolean;
  createdAt: Date;
}

const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');

interface FakeStore {
  organizations: StoredOrganizationRow[];
  users: StoredUserRow[];
  memberships: StoredMembershipRow[];
}

interface FakeBootstrap {
  readonly host: PrismaHost;
  readonly store: FakeStore;
  /** Boundaries in the order the service reached them. */
  readonly calls: string[];
  readonly mocks: {
    readonly organizationCreate: jest.Mock;
    readonly membershipCreate: jest.Mock;
    readonly userCreate: jest.Mock;
    readonly transaction: jest.Mock;
  };
}

/**
 * An in-memory host that mimics the surfaces this service uses, including the
 * `include: { memberships: { where, include } }` read shape and transactional
 * rollback.
 *
 * `transactionReads` exists for the unique-violation cases: with it disabled
 * the transaction's lookup never sees the seed, so the write path runs and the
 * constraint fires — which is exactly the sequence the post-transaction
 * translation exists for. Every other case leaves it on.
 */
function fakeBootstrap(
  options: {
    readonly seed?: Partial<FakeStore>;
    readonly failOrganizationCreate?: Error;
    readonly transactionReads?: boolean;
  } = {},
) {
  const store: FakeStore = {
    organizations: [...(options.seed?.organizations ?? [])],
    users: [...(options.seed?.users ?? [])],
    memberships: [...(options.seed?.memberships ?? [])],
  };
  const calls: string[] = [];
  let sequence = 0;

  const nextId = (prefix: string): string => {
    sequence += 1;
    return `${prefix}-${String(sequence)}`;
  };

  /** The `include`-aware organization read, shared by the transaction and the retry classifier. */
  const findOrganization = jest.fn((args: { where: { bootstrapKey: string } }) => {
    const organization = store.organizations.find((row) => row.bootstrapKey === args.where.bootstrapKey);
    if (organization === undefined) return Promise.resolve(null);
    const memberships = store.memberships
      .filter((row) => row.organizationId === organization.id && row.isOwner)
      .map((row) => ({ ...row, user: store.users.find((user) => user.id === row.userId) }));
    return Promise.resolve({ ...organization, memberships });
  });

  /** The transaction's own view; it can be blinded so the write path is reached. */
  const findOrganizationInTransaction = jest.fn((args: { where: { bootstrapKey: string } }): Promise<unknown> => {
    if (options.transactionReads === false) return Promise.resolve(null);
    return findOrganization(args);
  });

  const organizationCreate = jest.fn((args: { data: { name: string; bootstrapKey: string } }) => {
    if (options.failOrganizationCreate !== undefined) return Promise.reject(options.failOrganizationCreate);
    const organization: StoredOrganizationRow = {
      id: nextId('org'),
      name: args.data.name,
      status: 'ACTIVE',
      bootstrapKey: args.data.bootstrapKey,
      createdAt: CREATED_AT,
    };
    store.organizations.push(organization);
    return Promise.resolve(organization);
  });

  const userCreate = jest.fn((args: { data: { email: string } }) => {
    const user: StoredUserRow = { id: nextId('user'), email: args.data.email, createdAt: CREATED_AT };
    store.users.push(user);
    return Promise.resolve(user);
  });

  const membershipCreate = jest.fn((args: { data: { organizationId: string; userId: string; isOwner: boolean } }) => {
    const membership: StoredMembershipRow = {
      id: nextId('membership'),
      organizationId: args.data.organizationId,
      userId: args.data.userId,
      isOwner: args.data.isOwner,
      createdAt: CREATED_AT,
    };
    store.memberships.push(membership);
    return Promise.resolve(membership);
  });

  const tx = {
    $executeRaw: jest.fn((strings: TemplateStringsArray, ...values: readonly unknown[]) => {
      const sql = strings.join('|').toLowerCase();
      if (sql.includes('pg_advisory_xact_lock')) {
        calls.push(`lock:${String(values[0])}`);
      }
      return Promise.resolve(1);
    }),
    organization: { findUnique: findOrganizationInTransaction, create: organizationCreate },
    user: {
      findUnique: jest.fn((args: { where: { email: string } }) => {
        return Promise.resolve(store.users.find((row) => row.email === args.where.email) ?? null);
      }),
      create: userCreate,
    },
    organizationMembership: { create: membershipCreate },
  };

  /** Snapshot/restore is the fake's rollback: the property PostgreSQL provides. */
  const transaction = jest.fn(async (run: (client: Prisma.TransactionClient) => Promise<unknown>) => {
    const snapshot: FakeStore = {
      organizations: [...store.organizations],
      users: [...store.users],
      memberships: [...store.memberships],
    };
    try {
      return await run(tx as unknown as Prisma.TransactionClient);
    } catch (error) {
      store.organizations = snapshot.organizations;
      store.users = snapshot.users;
      store.memberships = snapshot.memberships;
      throw error;
    }
  });

  const host = {
    prisma: { $transaction: transaction, organization: { findUnique: findOrganization } },
  } as unknown as PrismaHost;

  return {
    host,
    store,
    calls,
    mocks: { organizationCreate, membershipCreate, userCreate, transaction },
  } satisfies FakeBootstrap;
}

function request(overrides: Partial<BootstrapRequest> = {}): BootstrapRequest {
  return { bootstrapKey: 'main-shop', organizationName: 'Main Shop', ownerEmail: 'owner@example.com', ...overrides };
}

function seededIdentical(bootstrapKey = 'main-shop') {
  return {
    organizations: [
      { id: 'org-existing', name: 'Main Shop', status: 'ACTIVE' as const, bootstrapKey, createdAt: CREATED_AT },
    ],
    users: [{ id: 'user-existing', email: 'owner@example.com', createdAt: CREATED_AT }],
    memberships: [
      {
        id: 'membership-existing',
        organizationId: 'org-existing',
        userId: 'user-existing',
        isOwner: true,
        createdAt: CREATED_AT,
      },
    ],
  };
}

function loggerStub(): PinoLogger & { warn: jest.Mock } {
  const warn = jest.fn();
  return { warn } as unknown as PinoLogger & { warn: jest.Mock };
}

describe('OrganizationBootstrapService', () => {
  it('bootstraps organization, owner user, and owner membership in one transaction (AC-01)', async () => {
    const { host, store, calls, mocks } = fakeBootstrap();

    const result = await new OrganizationBootstrapService(host).bootstrap(request());

    expect(result).toEqual({
      status: 'BOOTSTRAPPED',
      bootstrapKey: 'main-shop',
      organizationId: store.organizations[0]?.id,
      userId: store.users[0]?.id,
      membershipId: store.memberships[0]?.id,
    });
    expect(store.organizations).toHaveLength(1);
    expect(store.users).toHaveLength(1);
    expect(store.memberships).toHaveLength(1);
    expect(store.memberships[0]).toMatchObject({ isOwner: true });
    expect(mocks.organizationCreate).toHaveBeenCalledWith({ data: { name: 'Main Shop', bootstrapKey: 'main-shop' } });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    // Lock order is fixed: the bootstrap key, then the identity writer's
    // per-email lock. A cycle would require the reverse, so the order is the
    // deadlock-freedom argument.
    expect(calls).toEqual(['lock:tenancy:bootstrap-key:main-shop', 'lock:identity:user-email:owner@example.com']);
  });

  it('trims the name and canonicalizes the email before writing them', async () => {
    const { host, store } = fakeBootstrap();

    await new OrganizationBootstrapService(host).bootstrap(
      request({ organizationName: '  Main Shop  ', ownerEmail: ' Owner@Example.COM ' }),
    );

    expect(store.organizations[0]?.name).toBe('Main Shop');
    expect(store.users[0]?.email).toBe('owner@example.com');
  });

  it('answers an identical retry ALREADY_BOOTSTRAPPED with the stored ids and no second write (AC-02)', async () => {
    const { host, store, mocks } = fakeBootstrap({ seed: seededIdentical() });

    const first = await new OrganizationBootstrapService(host).bootstrap(request());
    const second = await new OrganizationBootstrapService(host).bootstrap(request());

    expect(first).toEqual({
      status: 'ALREADY_BOOTSTRAPPED',
      bootstrapKey: 'main-shop',
      organizationId: 'org-existing',
      userId: 'user-existing',
      membershipId: 'membership-existing',
    });
    expect(second).toEqual(first);
    expect(store.organizations).toHaveLength(1);
    expect(store.users).toHaveLength(1);
    expect(store.memberships).toHaveLength(1);
    expect(mocks.organizationCreate).not.toHaveBeenCalled();
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.membershipCreate).not.toHaveBeenCalled();
  });

  it('refuses a retry whose name differs, without adopting or overwriting anything (AC-04)', async () => {
    const { host, store, mocks } = fakeBootstrap({ seed: seededIdentical() });
    const logger = loggerStub();

    const service = new OrganizationBootstrapService(host, { logger });

    await expect(service.bootstrap(request({ organizationName: 'Another Name' }))).rejects.toBeInstanceOf(
      BootstrapConflictError,
    );
    await expect(service.bootstrap(request({ organizationName: 'Another Name' }))).rejects.toMatchObject({
      code: 'BOOTSTRAP_CONFLICT',
      reason: 'NAME_MISMATCH',
    });

    expect(store.organizations).toHaveLength(1);
    expect(store.organizations[0]?.name).toBe('Main Shop');
    expect(mocks.organizationCreate).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn.mock.calls[0]?.[0]).toMatchObject({
      securityEvent: 'organization-bootstrap-conflict',
      bootstrapKey: 'main-shop',
      conflict: 'NAME_MISMATCH',
    });
  });

  it('refuses a retry whose owner email differs', async () => {
    const { host, store } = fakeBootstrap({ seed: seededIdentical() });

    await expect(
      new OrganizationBootstrapService(host).bootstrap(request({ ownerEmail: 'someone-else@example.com' })),
    ).rejects.toMatchObject({ code: 'BOOTSTRAP_CONFLICT', reason: 'OWNER_EMAIL_MISMATCH' });

    expect(store.users).toHaveLength(1);
    expect(store.users[0]?.email).toBe('owner@example.com');
  });

  it('reports a stored organization without an owner as an anomaly, never as a conflict or a fix-up', async () => {
    const seed = seededIdentical();
    const { host } = fakeBootstrap({ seed: { organizations: seed.organizations, users: seed.users } });

    await expect(new OrganizationBootstrapService(host).bootstrap(request())).rejects.toBeInstanceOf(
      BootstrapStateAnomalyError,
    );
    await expect(new OrganizationBootstrapService(host).bootstrap(request())).rejects.toMatchObject({
      code: 'BOOTSTRAP_STATE_ANOMALY',
      reason: 'OWNER_MEMBERSHIP_MISSING',
    });
  });

  it('propagates a failure probe and rolls every write back (AC-05)', async () => {
    const { host, store, mocks } = fakeBootstrap();
    const probe = jest.fn(() => {
      throw new Error('injected transaction failure');
    });

    const service = new OrganizationBootstrapService(host, { failureProbe: probe });

    await expect(service.bootstrap(request())).rejects.toThrow('injected transaction failure');

    expect(probe).toHaveBeenCalledTimes(1);
    expect(mocks.organizationCreate).toHaveBeenCalledTimes(1);
    expect(mocks.userCreate).toHaveBeenCalledTimes(1);
    expect(mocks.membershipCreate).toHaveBeenCalledTimes(1);
    // All three rows are invisible: the probe runs after every write and before
    // the commit, so the transaction's atomicity is the only thing that can
    // explain zero rows.
    expect(store.organizations).toEqual([]);
    expect(store.users).toEqual([]);
    expect(store.memberships).toEqual([]);
  });

  it('classifies a unique violation as the stored result, after the transaction has ended', async () => {
    // The race the advisory locks are meant to prevent, reached anyway: the
    // transaction aborts on the constraint, so the translation is a fresh read
    // outside it. An identical request must still answer ALREADY_BOOTSTRAPPED.
    const uniqueViolation = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: ['bootstrap_key'] },
    });
    const { host } = fakeBootstrap({
      seed: seededIdentical(),
      failOrganizationCreate: uniqueViolation,
      transactionReads: false,
    });

    const result = await new OrganizationBootstrapService(host).bootstrap(request());

    expect(result).toMatchObject({ status: 'ALREADY_BOOTSTRAPPED', organizationId: 'org-existing' });
  });

  it('classifies a unique violation as a conflict when the stored parameters differ', async () => {
    const uniqueViolation = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: ['bootstrap_key'] },
    });
    // The transaction cannot see the stored row, so the create is attempted and
    // the constraint fires; only the post-transaction read can classify it.
    const { host } = fakeBootstrap({
      seed: seededIdentical(),
      failOrganizationCreate: uniqueViolation,
      transactionReads: false,
    });

    await expect(
      new OrganizationBootstrapService(host).bootstrap(request({ organizationName: 'Different' })),
    ).rejects.toMatchObject({ code: 'BOOTSTRAP_CONFLICT', reason: 'NAME_MISMATCH' });
  });

  it('rethrows an unclassifiable unique violation rather than inventing a result', async () => {
    const uniqueViolation = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    const { host } = fakeBootstrap({ failOrganizationCreate: uniqueViolation, transactionReads: false });

    await expect(new OrganizationBootstrapService(host).bootstrap(request())).rejects.toBe(uniqueViolation);
  });

  it('propagates a non-unique write failure as-is', async () => {
    const burst = new Error('connection reset');
    const { host, store } = fakeBootstrap({ failOrganizationCreate: burst });

    await expect(new OrganizationBootstrapService(host).bootstrap(request())).rejects.toBe(burst);

    expect(store.organizations).toEqual([]);
    expect(store.users).toEqual([]);
  });

  it('rejects a malformed request before any transaction is opened (AC-07)', async () => {
    const { host, mocks } = fakeBootstrap();
    const service = new OrganizationBootstrapService(host);

    await expect(service.bootstrap(request({ bootstrapKey: 'Main Shop' }))).rejects.toBeInstanceOf(BootstrapInputError);
    await expect(service.bootstrap(request({ bootstrapKey: 'ab' }))).rejects.toMatchObject({ field: 'bootstrapKey' });
    await expect(service.bootstrap(request({ organizationName: '   ' }))).rejects.toMatchObject({
      field: 'organizationName',
    });
    await expect(service.bootstrap(request({ organizationName: 'n'.repeat(201) }))).rejects.toMatchObject({
      field: 'organizationName',
    });
    await expect(service.bootstrap(request({ ownerEmail: 'not-an-address' }))).rejects.toMatchObject({
      field: 'ownerEmail',
    });

    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('runs two identical bootstraps in different organizations for one user (T-4)', async () => {
    const { host, store } = fakeBootstrap();
    const service = new OrganizationBootstrapService(host);

    const first = await service.bootstrap(request({ bootstrapKey: 'first-shop', organizationName: 'First' }));
    const second = await service.bootstrap(request({ bootstrapKey: 'second-shop', organizationName: 'Second' }));

    expect(first.status).toBe('BOOTSTRAPPED');
    expect(second.status).toBe('BOOTSTRAPPED');
    expect(store.organizations).toHaveLength(2);
    expect(store.users).toHaveLength(1);
    expect(store.memberships).toHaveLength(2);
    expect(store.memberships.every((membership) => membership.isOwner)).toBe(true);
  });
});

describe('normalizeBootstrapRequest', () => {
  it('accepts a canonical request and returns its normalized form', () => {
    expect(normalizeBootstrapRequest(request({ organizationName: ' Main  ', ownerEmail: ' A@B.example ' }))).toEqual({
      bootstrapKey: 'main-shop',
      name: 'Main',
      email: 'a@b.example',
    });
  });

  it('accepts the boundary key lengths (3 and 64)', () => {
    expect(normalizeBootstrapRequest(request({ bootstrapKey: 'abc' })).bootstrapKey).toBe('abc');
    expect(normalizeBootstrapRequest(request({ bootstrapKey: 'a'.repeat(64) })).bootstrapKey).toHaveLength(64);
  });

  it('refuses key shapes that are not lowercase kebab-case', () => {
    for (const bootstrapKey of [
      'ab',
      'a'.repeat(65),
      'Main-Shop',
      'main_shop',
      'main shop',
      '-main',
      'main-',
      'main--shop',
    ]) {
      expect(() => normalizeBootstrapRequest(request({ bootstrapKey }))).toThrow(BootstrapInputError);
    }
  });

  it('reports the email failure as an input failure, not as a writer failure', () => {
    try {
      normalizeBootstrapRequest(request({ ownerEmail: 'nope' }));
      throw new Error('expected normalization to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(BootstrapInputError);
      expect((error as BootstrapInputError).field).toBe('ownerEmail');
    }
  });

  it('keeps EmailShapeError as the lower-level reason the caller can distinguish', () => {
    expect(() => normalizeBootstrapRequest(request({ ownerEmail: '' }))).toThrow(BootstrapInputError);
    // The canonicalizer itself still throws its own type: the seam M2-S2 reuses
    // does not depend on the tenancy context's error vocabulary.
    expect(() => canonicalizeEmail('')).toThrow(EmailShapeError);
  });
});
