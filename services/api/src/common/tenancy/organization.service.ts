/**
 * §8.4 / §40.6 M2-S1 — the tenancy-context reader/writer for `organizations`
 * and `organization_memberships`.
 *
 * This module owns every statement against its own two tables (D-7) and
 * **imports nothing from the identity context**, so the `tenancy → identity`
 * edge that §39.3 D-1 forbids never appears in the source graph (see the
 * architectural regression test under `common/architecture/`). The bootstrap
 * composition root (`common/bootstrap/`) orchestrates this module together
 * with the identity writer; neither context knows about the other.
 *
 * Every function runs inside the *caller's* transaction (§8.4: a context
 * writer owns no commit of its own) and is a thin, typed statement — the
 * invariants (uniqueness, single owner, referential integrity) are the
 * database's, and the composition layer is what decides their meaning.
 */

import type { Organization, OrganizationMembership, Prisma } from '@prisma/client';

/**
 * The tenancy surface a reader needs. Both `Prisma.TransactionClient` and the
 * root `PrismaClient` satisfy it, so the same classification code serves the
 * in-transaction lookup and the post-transaction retry read.
 */
export type TenancyReader = Pick<Prisma.TransactionClient, 'organization' | 'organizationMembership'>;

/** The placing of the §10.4 advisory lock needs only the raw-statement surface. */
export type AdvisoryLockClient = Pick<Prisma.TransactionClient, '$executeRaw'>;

/**
 * The §10.4 advisory-lock namespace for one bootstrap key.
 *
 * @param bootstrapKey the already-normalized key; the namespace keeps it
 *   distinct from the identity writer's per-email namespace so the two locks
 *   can never collide into an accidental cross-domain serialization.
 */
function bootstrapLockKey(bootstrapKey: string): string {
  return `tenancy:bootstrap-key:${bootstrapKey}`;
}

/**
 * Takes the per-`bootstrap_key` advisory transaction lock.
 *
 * Called *before* the lookup by the composition service, so racing identical
 * requests serialize here and the second one classifies instead of inserting
 * (AC-03). `pg_advisory_xact_lock` returns `void`, which `$queryRaw` cannot
 * deserialize — it is a statement, so it belongs in `$executeRaw`.
 */
export async function acquireBootstrapKeyLock(tx: AdvisoryLockClient, bootstrapKey: string): Promise<void> {
  const lockKey = bootstrapLockKey(bootstrapKey);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
}

/** The tenant root named by a bootstrap key, or `null` when the key is unseen. */
export async function findOrganizationByBootstrapKey(
  reader: Pick<TenancyReader, 'organization'>,
  bootstrapKey: string,
): Promise<Organization | null> {
  return reader.organization.findUnique({ where: { bootstrapKey } });
}

/**
 * The single owner membership of an organization, or `null`.
 *
 * `uq_organizations_single_owner` makes at most one row possible, so
 * `findFirst` is exact rather than a sample; a `null` answer therefore means
 * *zero* owners, which the composition service reports as an integrity anomaly.
 */
export async function findOwnerMembership(
  reader: Pick<TenancyReader, 'organizationMembership'>,
  organizationId: string,
): Promise<OrganizationMembership | null> {
  return reader.organizationMembership.findFirst({ where: { organizationId, isOwner: true } });
}

/** The three facts the §10.4 creation writes in one transaction. */
export interface NewOrganizationWithOwner {
  readonly name: string;
  /** The §10.4 idempotency key; `organizations.bootstrap_key` is UNIQUE. */
  readonly bootstrapKey: string;
  /** The owner identity, created or resolved by the identity context. */
  readonly ownerUserId: string;
}

/**
 * Creates the tenant root and its owner membership in the caller's
 * transaction.
 *
 * Split from the identity write on purpose: this function never touches
 * `users`. The composition service calls the identity writer for the user id
 * first, then this, so both writes commit or roll back together (§31.2) while
 * each context still writes only its own tables (D-7).
 */
export async function createOrganizationWithOwner(
  tx: TenancyReader,
  input: NewOrganizationWithOwner,
): Promise<{ organization: Organization; membership: OrganizationMembership }> {
  const organization = await tx.organization.create({
    data: { name: input.name, bootstrapKey: input.bootstrapKey },
  });
  const membership = await tx.organizationMembership.create({
    data: { organizationId: organization.id, userId: input.ownerUserId, isOwner: true },
  });
  return { organization, membership };
}
