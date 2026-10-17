/**
 * The trusted tenant-scoped database transaction (Master Plan §8.2, §9.3, §40.6 M2-S4).
 *
 * One mechanism, one invariant: **every tenant-owned database operation runs inside a
 * transaction whose tenant context was established from verified server-side
 * authorization, never caller-supplied input.** That invariant is enforced twice, in
 * two different ways:
 *
 * 1. **Application layer.** The only code that sets a tenant setting is in this file.
 *    Every entry point takes a value the caller has already verified — a route
 *    organization the authorization guard checked against the token, a sync trusted
 *    context the guard authenticated, a server-resolved account id during identity
 *    flows, or the operator bootstrap key the composition root carries. A request body
 *    never reaches any of them.
 * 2. **Database layer.** The §8.2 policies (`0008`) compare each table's tenant column
 *    against the transaction-local setting, so a missing — or wrong — context makes
 *    every tenant row invisible. Context-free statements are quiet no-returns, which
 *    is exactly the fail-closed behaviour the RLS acceptance suite asserts.
 *
 * §8.2 semantics say `SET LOCAL app.current_organization_id`. PostgreSQL cannot bind a
 * client parameter into every `SET` statement form, so this module uses the
 * parameterized equivalent — `set_config(<setting>, <value>, is_local => true)` inside
 * the caller's transaction. `is_local = true` is the whole point: the setting exists
 * only for the transaction that consumes it, is cleared on commit, cleared on rollback,
 * and a pooled connection never inherits a previous tenant. A session-scoped `SET` is
 * forbidden and none exists here; there is no mutable module state at all.
 *
 * The value is parameterized (`${uuid}::uuid`), never interpolated: a malformed tenant
 * identifier fails closed at PostgreSQL's cast (defence in depth beyond the wrapper's
 * own shape check), and no identifier is ever concatenated into SQL.
 */

import type { Prisma, PrismaClient } from '@prisma/client';

/** The §8.2 setting the database policies read. Fixed, typed, never client input. */
export const TENANT_CONTEXT_SETTING = 'app.current_organization_id';

/** The identity-flow setting (§9 of the M2-S4 record, decision D-A): own membership edges only. */
export const USER_CONTEXT_SETTING = 'app.current_user_id';

/** The bootstrap setting (decision D-B): the §10.4 key gates exactly its own tenant root. */
export const BOOTSTRAP_CONTEXT_SETTING = 'app.current_bootstrap_key';

/** The canonical 36-character lower-hex UUID shape a tenant or user identifier must have. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The minimal client surface the context helpers need. Both transaction clients match it. */
export type ContextClient = Pick<Prisma.TransactionClient, '$queryRaw'>;

/** The minimal host surface the transaction entry points need. `PrismaService` matches it. */
export type ContextHost = { readonly prisma: PrismaClient };

/**
 * Fails fast when a caller reaches for a context entry point with a shape the database
 * could never accept. These values are server-authored (an internal invariant, not a
 * client contract), so the failure is the caller's bug: a plain error, thrown before a
 * transaction (or its connection) is ever opened.
 */
function assertUuidShape(name: string, value: string): void {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error(`a trusted transaction context requires a canonical UUID ${name}, got a different shape`);
  }
}

/**
 * Establishes the tenant context for the caller's transaction — the §9.3 step 5 "issue
 * `SET LOCAL`" equivalent. The PostgreSQL cast re-proves the shape inside the database,
 * so a value that slipped past the wrapper's check can only fail closed, never execute.
 *
 * Re-issuing the call inside one transaction is allowed and meaningful: the bootstrap
 * composition root re-scopes from the bootstrap-key visibility to the stored tenant id
 * after that id becomes a server-derived fact. The value is always server-derived here
 * — never admittable from a request.
 */
export async function establishTenantContext(tx: ContextClient, organizationId: string): Promise<void> {
  assertUuidShape('organization id', organizationId);
  await tx.$queryRaw`SELECT set_config(${TENANT_CONTEXT_SETTING}, ${organizationId}::uuid::text, true)`;
}

/**
 * Establishes the identity context (decision D-A) for a pre-tenant transaction such as
 * login or refresh rotation: the membership policy then shows the caller exactly their
 * own membership edges, which is the same data the signed token already carries.
 *
 * The id must come from a resolved, verified account record, never a request body.
 */
export async function establishUserContext(tx: ContextClient, userId: string): Promise<void> {
  assertUuidShape('user id', userId);
  await tx.$queryRaw`SELECT set_config(${USER_CONTEXT_SETTING}, ${userId}::uuid::text, true)`;
}

/**
 * Establishes the bootstrap-key context (decision D-B): the §10.4 key is the credential
 * that may see its own stored tenant root for idempotent classification. The key shape
 * (kebab-case, 3..64) was proven by the composition root's `normalizeBootstrapRequest`
 * before any connection was opened, so nothing more is validated here.
 */
export async function establishBootstrapKeyContext(tx: ContextClient, bootstrapKey: string): Promise<void> {
  if (typeof bootstrapKey !== 'string' || bootstrapKey.length === 0 || bootstrapKey.length > 64) {
    throw new Error('the bootstrap context requires the normalized §10.4 key');
  }
  await tx.$queryRaw`SELECT set_config(${BOOTSTRAP_CONTEXT_SETTING}, ${bootstrapKey}, true)`;
}

/**
 * The tenant transaction entry point: validate, open, establish, run, and commit —
 * where `fn` receives the transaction client and every tenant-owned statement inside it
 * sees the tenant context. On throw the transaction (and its context) rolls back
 * together; on success both commit together.
 *
 * Callers pass a value **they** have already verified: the route-checked organization
 * (authorization guard), the authenticated sync context, the server-resolved
 * membership's organization. The shape assertion is a precondition, not the security
 * boundary — the policies are.
 */
export async function withTenantTransaction<T>(
  host: ContextHost,
  organizationId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  assertUuidShape('organization id', organizationId);
  return host.prisma.$transaction(async (tx) => {
    await establishTenantContext(tx, organizationId);
    return fn(tx);
  });
}

/**
 * The identity transaction entry point (decision D-A): one transaction with the
 * caller's own membership edges visible, for the pre-tenant identity flows. The id is a
 * server-resolved account record, never a request body.
 */
export async function withIdentityTransaction<T>(
  host: ContextHost,
  userId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  assertUuidShape('user id', userId);
  return host.prisma.$transaction(async (tx) => {
    await establishUserContext(tx, userId);
    return fn(tx);
  });
}
