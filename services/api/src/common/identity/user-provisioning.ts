/**
 * §8.4 / §40.6 M2-S1 — the identity-context writer for `users`.
 *
 * This is the whole of the identity context in this slice: one canonical
 * email seam and one transactional writer. Two properties make it safe to be
 * the narrow dependency M2-S2 (authentication) will later reuse:
 *
 * - **Canonical by construction.** `canonicalizeEmail` is trim + lowercase +
 *   shape, so `Owner@Example.COM ` and `owner@example.com` are one identity.
 *   The column's CHECK constraint (`email = lower(email) = btrim(email)`) is
 *   the database's copy of the same rule: a writer that bypasses this seam
 *   still cannot store a second spelling of one address.
 * - **Credential-free.** Nothing here reads, writes, or accepts a password,
 *   token, or role. `users` gains credential columns only with M2-S2's own
 *   migration (§40.6), never by extending this file.
 *
 * `findOrCreateUserByEmail` runs inside the *caller's* transaction (§8.4: the
 * identity writer owns no commit of its own) and takes a per-email advisory
 * lock *after* the caller has taken its own lock, in the fixed order the
 * tenancy service documents — key, then email — so no two bootstrap
 * transactions can deadlock against each other (a cycle would require one of
 * them to take the email first).
 */

import type { Prisma, User } from '@prisma/client';

/** RFC 5321's mailbox limit; the column is wider only to fail on length, not truncation. */
export const MAX_EMAIL_LENGTH = 254;

/** The longest local part RFC 5321 allows on the wire. */
const MAX_LOCAL_LENGTH = 64;

/** RFC 5321's domain length limit. */
const MAX_DOMAIN_LENGTH = 253;

/**
 * RFC 5321 `atext` atoms separated by single dots: no leading, trailing, or
 * consecutive dot, and — because the input was lowercased — no uppercase left
 * to normalize again.
 */
const LOCAL_PATTERN = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;

/** LDH labels (`a-z0-9-`, no edge hyphens), dot-separated. */
const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/** Why an address was refused; every reason is a shape reason, never a lookup result. */
export type EmailShapeReason = 'EMPTY' | 'TOO_LONG' | 'MALFORMED';

/** The address is not a mailbox this slice will store (thrown, never logged with a fix attached). */
export class EmailShapeError extends Error {
  readonly code = 'EMAIL_INVALID' as const;

  constructor(readonly reason: EmailShapeReason) {
    super(`owner email is not a valid mailbox (${reason})`);
    this.name = 'EmailShapeError';
  }
}

/**
 * The canonical identity key: trimmed, lowercased, shape-checked.
 *
 * The seam M2-S2 will reuse for login, because two spellings of one address
 * must resolve to one row whether they arrive from an operator's bootstrap
 * command or a customer's sign-in attempt. Throws `EmailShapeError` rather
 * than returning a partial result: a normalized-but-invalid address is still
 * invalid, and the caller must decide (the CLI answers exit 2).
 */
export function canonicalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();

  if (email.length === 0) throw new EmailShapeError('EMPTY');
  if (email.length > MAX_EMAIL_LENGTH) throw new EmailShapeError('TOO_LONG');

  const separator = email.indexOf('@');
  if (separator <= 0 || separator !== email.lastIndexOf('@')) throw new EmailShapeError('MALFORMED');

  const local = email.slice(0, separator);
  const domain = email.slice(separator + 1);

  if (local.length > MAX_LOCAL_LENGTH) throw new EmailShapeError('TOO_LONG');
  if (domain.length > MAX_DOMAIN_LENGTH) throw new EmailShapeError('TOO_LONG');
  if (!LOCAL_PATTERN.test(local)) throw new EmailShapeError('MALFORMED');
  if (!DOMAIN_PATTERN.test(domain)) throw new EmailShapeError('MALFORMED');

  return email;
}

/** What the identity writer answered: the row, and whether this call created it. */
export interface ProvisionedUser {
  readonly user: User;
  readonly created: boolean;
}

/**
 * The advisory-lock namespace for one canonical email.
 *
 * Distinct from the tenancy service's `bootstrap_key` namespace, so the two
 * locks can never collide into an accidental cross-domain serialization (and,
 * more importantly, never into a lock ordering that differs from key-then-email).
 */
function emailLockKey(email: string): string {
  return `identity:user-email:${email}`;
}

/**
 * Finds the user with this canonical email, creating it when absent.
 *
 * Contract:
 *
 * - runs inside the caller's transaction — every write here commits or rolls
 *   back with the caller's (§8.4);
 * - takes a per-email advisory transaction lock *before* the lookup, so two
 *   racing callers for one address serialize instead of racing the unique
 *   constraint (AC-03's sibling rule for identities);
 * - never updates an existing row: a stored email is an identity fact, not a
 *   request parameter;
 * - never swallows a failure. In particular this function deliberately does
 *   **not** recover from a unique violation in place: PostgreSQL aborts the
 *   whole transaction on the error, so a "retry the read here" would fail
 *   with `current transaction is aborted` anyway. Translation belongs to the
 *   caller, after the transaction has ended.
 */
export async function findOrCreateUserByEmail(
  tx: Prisma.TransactionClient,
  rawEmail: string,
): Promise<ProvisionedUser> {
  const email = canonicalizeEmail(rawEmail);

  // `pg_advisory_xact_lock` returns the Postgres type `void`, which `$queryRaw`
  // cannot deserialize — a statement, so it belongs in `$executeRaw`.
  const lockKey = emailLockKey(email);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

  const existing = await tx.user.findUnique({ where: { email } });
  if (existing !== null) {
    return { user: existing, created: false };
  }

  const user = await tx.user.create({ data: { email } });
  return { user, created: true };
}
