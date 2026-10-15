/**
 * §40.6 M2-S1 — the typed failure surface of the operator bootstrap command
 * (§10.4).
 *
 * Three failures are distinguishable because the operator must answer three
 * different questions, and an exit code is only honest if it reflects which
 * one happened (§10.4's command contract):
 *
 * - `BootstrapInputError`      the request itself is malformed — nothing was
 *                              attempted, nothing was connected to (exit 2).
 * - `BootstrapConflictError`   the `bootstrap_key` already names a *different*
 *                              durable result — no state was adopted or
 *                              overwritten (exit 3, AC-04).
 * - `BootstrapStateAnomalyError` the database contradicts its own invariants —
 *                              a stored organization without a single owner.
 *                              This cannot be produced by this slice's writer,
 *                              so it is an integrity alarm, not a conflict
 *                              (exit 1).
 *
 * No error carries a connection string, a credential, or raw driver text:
 * every `message` below is written by this file and names values the operator
 * supplied themselves (§13.6, §42.6). The driver error, if one occurs, never
 * leaves the service — `OrganizationBootstrapService` translates the one class
 * it understands and the CLI reports the rest as an opaque runtime failure.
 */

/** Which request field failed validation, for the exit-2 JSON object. */
export type BootstrapInputField = 'bootstrapKey' | 'organizationName' | 'ownerEmail';

/**
 * Why a stored result cannot be accepted as the answer to this request.
 *
 * `NAME_MISMATCH` and `OWNER_EMAIL_MISMATCH` are the two parameters a retry
 * may differ in; matching both is what makes a retry *identical* (AC-02), and
 * differing in either is what makes it *conflicting* (AC-04).
 */
export type BootstrapConflictReason = 'NAME_MISMATCH' | 'OWNER_EMAIL_MISMATCH';

/** Why the stored shape is impossible rather than merely conflicting. */
export type BootstrapAnomalyReason = 'OWNER_MEMBERSHIP_MISSING';

/** The request was refused before any statement ran (exit code 2). */
export class BootstrapInputError extends Error {
  readonly code = 'BOOTSTRAP_INPUT_INVALID' as const;

  constructor(
    readonly field: BootstrapInputField,
    readonly reason: string,
  ) {
    super(`invalid ${field}: ${reason}`);
    this.name = 'BootstrapInputError';
  }
}

/**
 * The `bootstrap_key` already names a durable result with different
 * parameters (exit code 3). Deliberately carries no stored values: reporting
 * "this key belongs to an organization named X" would turn the command into
 * an oracle for tenant names, and the operator already knows what they typed.
 */
export class BootstrapConflictError extends Error {
  readonly code = 'BOOTSTRAP_CONFLICT' as const;

  constructor(
    readonly reason: BootstrapConflictReason,
    readonly bootstrapKey: string,
  ) {
    super(`bootstrap_key "${bootstrapKey}" already names a different result (${reason})`);
    this.name = 'BootstrapConflictError';
  }
}

/**
 * The stored row contradicts the invariants the schema enforces: an
 * organization whose owner membership does not exist (AC-11 makes exactly one
 * owner possible, so zero owners means an out-of-band write or a partial
 * legacy state — never something this command may quietly "fix" by adopting).
 */
export class BootstrapStateAnomalyError extends Error {
  readonly code = 'BOOTSTRAP_STATE_ANOMALY' as const;

  constructor(
    readonly reason: BootstrapAnomalyReason,
    readonly bootstrapKey: string,
  ) {
    super(`stored organization for bootstrap_key "${bootstrapKey}" is inconsistent (${reason})`);
    this.name = 'BootstrapStateAnomalyError';
  }
}

/**
 * Recognises a PostgreSQL unique-constraint violation as Prisma reports it.
 *
 * Structural on purpose: the acceptance suite and the unit suites raise the
 * same shape without importing a driver error class, and the check is only a
 * **classification** step — a false positive can never be destructive, because
 * the translation path is a fresh read that either classifies a real stored
 * row or rethrows the original error untouched.
 *
 * A unique violation is also the one error PostgreSQL raises *outside* the
 * transaction's control: the statement aborts the transaction, so nothing may
 * be retried inside it. Translation therefore happens after `$transaction`
 * returns, never within.
 */
export function isUniqueConstraintViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  return code === 'P2002';
}
