/**
 * §40.6 M2-S1 / §10.4 — the operator-only organization bootstrap, as the
 * **composition root** of the tenancy and identity contexts.
 *
 * One command, one transaction, one durable answer. The invariants this
 * service is responsible for, and how each is enforced **in the database**
 * rather than in the calling code:
 *
 * - **Exactly-once by key (AC-01/AC-02).** `organizations.bootstrap_key` is
 *   UNIQUE, and an identical retry is answered from the stored row
 *   (`ALREADY_BOOTSTRAPPED`) — no second organization, no second user, no
 *   second membership, no adoption of partial state.
 * - **Conflicting retries are refused (AC-04).** A key whose stored name or
 *   owner email differs from the request raises `BootstrapConflictError`;
 *   nothing is overwritten and nothing is adopted.
 * - **Racing invocations converge (AC-03).** A per-`bootstrap_key` advisory
 *   transaction lock is taken *before* the lookup, so the second caller waits,
 *   then classifies the committed result instead of inserting a duplicate.
 *   Lock order is fixed — **bootstrap_key, then the identity writer's
 *   per-email lock** — which makes a deadlock between two bootstraps
 *   structurally impossible.
 * - **Exactly one owner (AC-11).** `uq_organizations_single_owner` is a
 *   partial unique index over `(organization_id) WHERE is_owner`. This service
 *   writes `is_owner = true` for the bootstrap owner; a second owner row fails
 *   in PostgreSQL whatever the caller believes.
 * - **All or nothing (AC-05).** Organization, owner user, and owner membership
 *   are written in one interactive transaction. PostgreSQL makes that
 *   atomic; this service deliberately contains **no in-transaction error
 *   recovery**, because the first error aborts the transaction and any
 *   "handle it here" would run against an aborted transaction. The one error
 *   class worth translating — a unique violation — is therefore translated
 *   *after* `$transaction` returns, from a fresh read outside it.
 *
 * **Why this file lives under `bootstrap/`, not `tenancy/`.** §39.3 D-1 makes
 * the dependency direction one-way: this command must compose a tenancy write
 * (organization + membership) with an identity write (the owner user) in one
 * transaction, which needs *both* contexts. Putting that orchestration in
 * either context would create the `tenancy → identity` (or reverse) edge D-1
 * forbids. So the orchestration is a neutral composition root that imports
 * both, while `common/tenancy/**` and `common/identity/**` import neither each
 * other nor this file — a fact the architectural regression test in
 * `common/architecture/` enforces.
 *
 * The host is the `PrismaHost` seam shared with the mutation ledger: the
 * service never constructs a client and never reads configuration, so the
 * OpenAPI build boots with no `DATABASE_URL` and the acceptance suite can
 * drive the same code against real PostgreSQL as the application role.
 */

import type { Organization, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { Logger as PinoLogger } from 'pino';
import { establishBootstrapKeyContext, establishTenantContext } from '../database/tenant-context';
import type { PrismaHost } from '../sync/ledger/mutation-ledger.service';
import { FIRST_SETTINGS_VERSION } from '../settings/settings.contract';
import {
  canonicalizeEmail,
  EmailShapeError,
  findOrCreateUserByEmail,
  findUserById,
} from '../identity/user-provisioning';
import {
  acquireBootstrapKeyLock,
  createOrganizationWithOwner,
  findOrganizationByBootstrapKey,
  findOwnerMembership,
} from '../tenancy/organization.service';
import {
  BootstrapConflictError,
  BootstrapInputError,
  BootstrapStateAnomalyError,
  isUniqueConstraintViolation,
  type BootstrapConflictReason,
} from './organization-bootstrap.errors';

/** The operator's request, exactly as the command line supplied it. */
export interface BootstrapRequest {
  /** §10.4 idempotency key; unique across every organization ever created. */
  readonly bootstrapKey: string;
  /** Organization display name — deliberately not globally unique (§9.2 T-7). */
  readonly organizationName: string;
  /** Owner mailbox; canonicalized before storage, never echoed back by the CLI. */
  readonly ownerEmail: string;
}

/** A request whose shapes are proven: the only form that may reach a statement. */
export interface NormalizedBootstrapRequest {
  readonly bootstrapKey: string;
  readonly name: string;
  readonly email: string;
}

/** One answer of the command. The ids are the durable facts, not the message. */
export interface BootstrapResult {
  readonly status: 'BOOTSTRAPPED' | 'ALREADY_BOOTSTRAPPED';
  readonly bootstrapKey: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly membershipId: string;
}

/** kebab-case, lowercase, bounded — the §10.4 key shape, enforced before connecting. */
const BOOTSTRAP_KEY_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const BOOTSTRAP_KEY_MIN = 3;
const BOOTSTRAP_KEY_MAX = 64;
const ORGANIZATION_NAME_MAX = 200;

/**
 * Validates and canonicalizes a request, or throws `BootstrapInputError`.
 *
 * Pure and connection-free by design: the CLI calls it *before* it loads
 * configuration or opens a socket, so a malformed request costs nothing and
 * can never be mistaken for a database failure (AC-07, exit code 2).
 *
 * The same `^[a-z0-9]+(-[a-z0-9]+)*$` grammar and 3..64 bound are re-enforced
 * in PostgreSQL by `chk_organizations_bootstrap_key_shape` (length + trim,
 * `0003`) and `chk_organizations_bootstrap_key_kebab` (the kebab grammar,
 * `0004`), so a writer that bypasses this seam still cannot store a key this
 * command would refuse.
 */
export function normalizeBootstrapRequest(request: BootstrapRequest): NormalizedBootstrapRequest {
  const key = request.bootstrapKey;
  if (key.length < BOOTSTRAP_KEY_MIN || key.length > BOOTSTRAP_KEY_MAX) {
    throw new BootstrapInputError('bootstrapKey', `must be ${BOOTSTRAP_KEY_MIN}-${BOOTSTRAP_KEY_MAX} characters`);
  }
  if (!BOOTSTRAP_KEY_PATTERN.test(key)) {
    throw new BootstrapInputError('bootstrapKey', 'must be lowercase kebab-case (a-z, 0-9, single hyphens)');
  }

  const name = request.organizationName.trim();
  if (name.length === 0) {
    throw new BootstrapInputError('organizationName', 'must not be blank');
  }
  if (name.length > ORGANIZATION_NAME_MAX) {
    throw new BootstrapInputError('organizationName', `must be at most ${ORGANIZATION_NAME_MAX} characters`);
  }

  let email: string;
  try {
    email = canonicalizeEmail(request.ownerEmail);
  } catch (error) {
    if (error instanceof EmailShapeError) {
      throw new BootstrapInputError('ownerEmail', `is not a valid mailbox (${error.reason})`);
    }
    throw error;
  }

  return { bootstrapKey: key, name, email };
}

/**
 * The surface a classification read needs: the tenant root, its owner
 * membership, and the owner identity — each from its owning context. Both the
 * in-transaction client and the root client satisfy it.
 */
type ClassificationReader = Pick<Prisma.TransactionClient, 'organization' | 'organizationMembership' | 'user'>;

export interface OrganizationBootstrapOptions {
  /**
   * **Test-only seam.** Called after all three rows are written and before the
   * transaction commits; throwing proves the rollback claim (AC-05) against
   * real PostgreSQL. Production never sets it — see the acceptance suite for
   * the documented uses (the precedent is `ScriptedMutationApplier`).
   */
  readonly failureProbe?: () => void | Promise<void>;

  /** Structured warnings for conflict classification (§13.1: no payload, no PII). */
  readonly logger?: PinoLogger;
}

export class OrganizationBootstrapService {
  constructor(
    private readonly host: PrismaHost,
    private readonly options: OrganizationBootstrapOptions = {},
  ) {}

  /**
   * Runs the command: classify a stored result, or create one atomically.
   *
   * @throws `BootstrapInputError` (malformed request), `BootstrapConflictError`
   *   (key reused with different parameters), `BootstrapStateAnomalyError`
   *   (stored row violates the ownership invariant), or the original driver
   *   error when it is not one this service can classify.
   */
  async bootstrap(request: BootstrapRequest): Promise<BootstrapResult> {
    const normalized = normalizeBootstrapRequest(request);

    try {
      return await this.host.prisma.$transaction((tx) => this.runInTransaction(tx, normalized));
    } catch (error) {
      // The statement that hit the unique constraint already aborted the
      // transaction, so classification cannot happen inside it. Outside, the
      // worst case is a fresh read that finds nothing — then the original
      // error is rethrown untouched rather than papered over.
      const classified = await this.classifyAfterUniqueViolation(normalized, error);
      if (classified !== null) return classified;
      throw error;
    }
  }

  /** One interactive transaction: context, lock, classify-or-create, optional probe, commit. */
  private async runInTransaction(
    tx: Prisma.TransactionClient,
    request: NormalizedBootstrapRequest,
  ): Promise<BootstrapResult> {
    // Decision D-B (§9, M2-S4): the §10.4 key is the credential that unlocks
    // exactly its own tenant root. It is established before the lookup because
    // `organizations` is now a policy-protected table: without the clause the
    // identical-retry classification would see nothing and silently re-insert.
    await establishBootstrapKeyContext(tx, request.bootstrapKey);

    // Before the lookup, not after: two racing identical requests serialize
    // here, so the second one classifies instead of inserting (AC-03).
    //
    // Fixed lock order — bootstrap_key (just taken), then the identity
    // writer's per-email lock. Every bootstrap path acquires them in this
    // order, so the waits form a chain and never a cycle.
    await acquireBootstrapKeyLock(tx, request.bootstrapKey);

    const stored = await findOrganizationByBootstrapKey(tx, request.bootstrapKey);
    if (stored !== null) {
      // Re-scope from the bootstrap-key visibility to the stored tenant id: the
      // id is now a server-derived fact from a row the §10.4 credential named,
      // so the owner-membership read below (tenant-scoped by its own policy)
      // can see exactly that tenant's edge and nothing else.
      await establishTenantContext(tx, stored.id);
      return this.classify(tx, stored, request);
    }

    const { user } = await findOrCreateUserByEmail(tx, request.email);

    // §8.2 / §5.8 of the M2-S4 record: the tenant root id is minted here —
    // server-side, before any insert — and passed explicitly, because the
    // `organizations` policy is `WITH CHECK (id = ctx OR bootstrap_key = key)`
    // and no caller could otherwise satisfy the insert through the application
    // role. Idempotent retries and races are unaffected (advisory lock + unique
    // key + re-classification).
    const { membership, organization } = await createOrganizationWithOwner(tx, {
      organizationId: randomUUID(),
      name: request.name,
      bootstrapKey: request.bootstrapKey,
      ownerUserId: user.id,
    });

    // §22.2 (M3-S1): the settings singleton materializes with the tenant root
    // — version 1, every column at its plan default — in the same bootstrap
    // transaction. The tenant context the organization write established
    // satisfies the row's WITH CHECK; the bootstrap accepted update (§40.7
    // M3-S1) says a *new* organization's settings exist from its first
    // committed transaction, so a later settings read finds the row instead
    // of lazily materializing it.
    await tx.organizationSettings.create({
      data: { organizationId: organization.id, settingsVersion: FIRST_SETTINGS_VERSION },
    });

    // AC-05: everything above exists only if this returns. A throw here must
    // leave zero rows — organization, user, and membership together.
    await this.options.failureProbe?.();

    return {
      status: 'BOOTSTRAPPED',
      bootstrapKey: request.bootstrapKey,
      organizationId: organization.id,
      userId: user.id,
      membershipId: membership.id,
    };
  }

  /**
   * The whole idempotency contract: identical parameters answer
   * `ALREADY_BOOTSTRAPPED`, different parameters are refused, and a stored row
   * the schema says cannot exist is reported as an anomaly rather than
   * "repaired" by adoption.
   *
   * The three reads come from the two owning contexts (tenant root and owner
   * membership from tenancy, the owner identity from identity); the comparison
   * is this composition root's decision.
   */
  private async classify(
    reader: ClassificationReader,
    stored: Organization,
    request: NormalizedBootstrapRequest,
  ): Promise<BootstrapResult> {
    const owner = await findOwnerMembership(reader, stored.id);
    if (owner === null) {
      throw new BootstrapStateAnomalyError('OWNER_MEMBERSHIP_MISSING', request.bootstrapKey);
    }

    const ownerUser = await findUserById(reader, owner.userId);
    if (ownerUser === null) {
      throw new BootstrapStateAnomalyError('OWNER_USER_MISSING', request.bootstrapKey);
    }

    if (stored.name !== request.name) {
      this.warnConflict(request, 'NAME_MISMATCH');
      throw new BootstrapConflictError('NAME_MISMATCH', request.bootstrapKey);
    }
    if (ownerUser.email !== request.email) {
      this.warnConflict(request, 'OWNER_EMAIL_MISMATCH');
      throw new BootstrapConflictError('OWNER_EMAIL_MISMATCH', request.bootstrapKey);
    }

    return {
      status: 'ALREADY_BOOTSTRAPPED',
      bootstrapKey: request.bootstrapKey,
      organizationId: stored.id,
      userId: ownerUser.id,
      membershipId: owner.id,
    };
  }

  /**
   * Translates a unique violation into the same classification, or returns
   * `null` when nothing may be claimed from it.
   *
   * Reached only when a racing writer won a race the advisory locks are
   * supposed to prevent (a lock namespace change, a future writer that skips
   * the lock): the key now names a committed row, and the honest answer is
   * the classification of that row — never a second insert.
   *
   * M2-S4: the read runs in its own transaction, because the violating one is
   * already aborted. The same two contexts are established — the §10.4 key
   * first (the credential that may name its tenant root), then the tenant id
   * derived from the row the key unlocked — and the reads are the same
   * statements the normal path makes.
   */
  private async classifyAfterUniqueViolation(
    request: NormalizedBootstrapRequest,
    error: unknown,
  ): Promise<BootstrapResult | null> {
    if (!isUniqueConstraintViolation(error)) return null;

    return this.host.prisma.$transaction(async (tx) => {
      await establishBootstrapKeyContext(tx, request.bootstrapKey);
      const stored = await findOrganizationByBootstrapKey(tx, request.bootstrapKey);
      if (stored === null) return null;
      await establishTenantContext(tx, stored.id);
      return this.classify(tx, stored, request);
    });
  }

  /** §13.1: a conflict is a security-relevant event; the log carries the key, never the values. */
  private warnConflict(request: NormalizedBootstrapRequest, reason: BootstrapConflictReason): void {
    this.options.logger?.warn(
      {
        component: 'organization-bootstrap',
        securityEvent: 'organization-bootstrap-conflict',
        bootstrapKey: request.bootstrapKey,
        conflict: reason,
      },
      'bootstrap_key reused with different parameters — BOOTSTRAP_CONFLICT, no state adopted',
    );
  }
}
