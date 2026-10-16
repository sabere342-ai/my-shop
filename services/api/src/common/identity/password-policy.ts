/**
 * §10.2 / §40.6 M2-S2 — the password policy.
 *
 * §10.2 is explicit about what "strong password" does **not** mean here:
 * complexity rules (mixed case, digits, symbols) are *not* the mechanism, because
 * they push people toward predictable mutations. The policy is:
 *
 * - a minimum length,
 * - a maximum length (a denial-of-service ceiling, not a security one — Argon2id
 *   cost dominates well before this),
 * - and a **breached-password deny-list**.
 *
 * The deny-list is a **seam**, not a bundled corpus: shipping a multi-gigabyte
 * password list inside the API is not a slice's decision, and the eventual source
 * (an offline k-anonymity lookup, an operator-supplied list, or a future slice's
 * service) is not M2-S2's to pick. `BreachedPasswordSource` is that seam, and the
 * default answers "nothing known to be breached", which is honest: this slice does
 * not claim a breach check it does not perform.
 *
 * The policy is applied when a password is *set* (the operator provisioning
 * command), never when one is *verified*. An existing credential that predates a
 * stricter policy must still be usable, or raising the minimum length would lock
 * every existing user out — the opposite of the availability §10.2 protects when it
 * forbids permanent lockout.
 */

/** The length bounds, taken from validated configuration (§10.2). */
export interface PasswordPolicy {
  readonly minLength: number;
  readonly maxLength: number;
}

/** Why a proposed password was refused. A closed, orderable vocabulary. */
export type PasswordPolicyViolation = 'TOO_SHORT' | 'TOO_LONG' | 'BREACHED';

/**
 * The breached-password seam (§10.2).
 *
 * A source answers only whether a password is known-breached. It never sees a
 * user, an organization, or a session, so it cannot become a second identity
 * store by accident.
 */
export interface BreachedPasswordSource {
  isBreached(password: string): Promise<boolean>;
}

/**
 * The default seam: nothing is known to be breached.
 *
 * Named for what it does rather than "null" or "nop", because the absence of a
 * breach check is a real, documented state of this slice (§16 records it as a
 * stated limit) and not an implementation detail to be glossed over.
 */
export class NoBreachedPasswordSource implements BreachedPasswordSource {
  isBreached(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

/**
 * Validates a password against the policy, returning every violation rather than
 * only the first, so an operator fixing a rejected password sees the whole list.
 *
 * Length is counted in UTF-16 code units via `String.prototype.length`. That is a
 * deliberate, documented choice: it is what the client and the tooling agree on,
 * and pinning a grapheme model here would make the server's answer differ from the
 * one an operator sees while typing.
 */
export async function validatePassword(
  password: string,
  policy: PasswordPolicy,
  breached: BreachedPasswordSource,
): Promise<readonly PasswordPolicyViolation[]> {
  const violations: PasswordPolicyViolation[] = [];

  if (password.length < policy.minLength) {
    violations.push('TOO_SHORT');
  }
  if (password.length > policy.maxLength) {
    violations.push('TOO_LONG');
  }
  if (await breached.isBreached(password)) {
    violations.push('BREACHED');
  }

  return violations;
}
