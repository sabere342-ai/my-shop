/**
 * §40.6 M2-S1 / §10.4 — the operator-only organization bootstrap.
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
 * The host is the `PrismaHost` seam shared with the mutation ledger: the
 * service never constructs a client and never reads configuration, so the
 * OpenAPI build boots with no `DATABASE_URL` and the acceptance suite can
 * drive the same code against real PostgreSQL as the application role.
 */

import type { Organization, OrganizationMembership, Prisma, User } from '@prisma/client';
import type { Logger as PinoLogger } from 'pino';
import { canonicalizeEmail, EmailShapeError, findOrCreateUserByEmail } from '../identity/user-provisioning';
import type { PrismaHost } from '../sync/ledger/mutation-ledger.service';
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

/** The `organization` read shape used by both the transaction and the retry classifier. */
type BootstrapReader = Pick<Prisma.TransactionClient, 'organization'>;

/** One organization with its owner membership (the partial unique index makes it at most one). */
interface StoredOwnerMembership extends OrganizationMembership {
  readonly user: User;
}

interface StoredOrganization extends Organization {
  readonly memberships: readonly StoredOwnerMembership[];
}

/** The §10.4 advisory-lock namespace for one bootstrap key. */
function bootstrapLockKey(bootstrapKey: string): string {
  return `tenancy:bootstrap-key:${bootstrapKey}`;
}

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

  /** One interactive transaction: lock, classify-or-create, optional probe, commit. */
  private async runInTransaction(
    tx: Prisma.TransactionClient,
    request: NormalizedBootstrapRequest,
  ): Promise<BootstrapResult> {
    // Before the lookup, not after: two racing identical requests serialize
    // here, so the second one classifies instead of inserting (AC-03).
    const lockKey = bootstrapLockKey(request.bootstrapKey);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

    const stored = await this.findStored(tx, request.bootstrapKey);
    if (stored !== null) {
      return this.classify(stored, request);
    }

    // Fixed lock order — bootstrap_key (just taken), then the identity
    // writer's per-email lock. Every bootstrap path acquires them in this
    // order, so the waits form a chain and never a cycle.
    const { user } = await findOrCreateUserByEmail(tx, request.email);

    const organization = await tx.organization.create({
      data: { name: request.name, bootstrapKey: request.bootstrapKey },
    });
    const membership = await tx.organizationMembership.create({
      data: { organizationId: organization.id, userId: user.id, isOwner: true },
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

  /** The stored result for a key: organization plus its single owner, if any. */
  private async findStored(reader: BootstrapReader, bootstrapKey: string): Promise<StoredOrganization | null> {
    return reader.organization.findUnique({
      where: { bootstrapKey },
      include: { memberships: { where: { isOwner: true }, include: { user: true } } },
    });
  }

  /**
   * The whole idempotency contract: identical parameters answer
   * `ALREADY_BOOTSTRAPPED`, different parameters are refused, and a stored row
   * the schema says cannot exist is reported as an anomaly rather than
   * "repaired" by adoption.
   */
  private classify(stored: StoredOrganization, request: NormalizedBootstrapRequest): BootstrapResult {
    const [owner] = stored.memberships;
    if (owner === undefined) {
      throw new BootstrapStateAnomalyError('OWNER_MEMBERSHIP_MISSING', request.bootstrapKey);
    }

    if (stored.name !== request.name) {
      this.warnConflict(request, 'NAME_MISMATCH');
      throw new BootstrapConflictError('NAME_MISMATCH', request.bootstrapKey);
    }
    if (owner.user.email !== request.email) {
      this.warnConflict(request, 'OWNER_EMAIL_MISMATCH');
      throw new BootstrapConflictError('OWNER_EMAIL_MISMATCH', request.bootstrapKey);
    }

    return {
      status: 'ALREADY_BOOTSTRAPPED',
      bootstrapKey: request.bootstrapKey,
      organizationId: stored.id,
      userId: owner.user.id,
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
   */
  private async classifyAfterUniqueViolation(
    request: NormalizedBootstrapRequest,
    error: unknown,
  ): Promise<BootstrapResult | null> {
    if (!isUniqueConstraintViolation(error)) return null;

    const stored = await this.findStored(this.host.prisma, request.bootstrapKey);
    if (stored === null) return null;

    return this.classify(stored, request);
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
