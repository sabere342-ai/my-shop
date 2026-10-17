/**
 * Unit acceptance for the §10.2 password policy (AC-06).
 *
 * §10.2's point is what the policy does *not* do: there are no complexity rules, and
 * length plus a breached-deny-list seam are the whole policy. These cases pin that —
 * in particular that a long lowercase passphrase is accepted while a short one is not,
 * which a composition rule would invert.
 */

import {
  NoBreachedPasswordSource,
  validatePassword,
  type BreachedPasswordSource,
  type PasswordPolicy,
} from './password-policy';

const POLICY: PasswordPolicy = { minLength: 12, maxLength: 128 };
const noBreach: BreachedPasswordSource = new NoBreachedPasswordSource();

/** A source that reports one chosen password as breached. */
class OneBreached implements BreachedPasswordSource {
  readonly seen: string[] = [];

  constructor(private readonly breached: string) {}

  isBreached(password: string): Promise<boolean> {
    this.seen.push(password);
    return Promise.resolve(password === this.breached);
  }
}

describe('password policy', () => {
  it('accepts a long lowercase passphrase — composition is deliberately not the mechanism', async () => {
    await expect(validatePassword('correcthorsebatterystaple', POLICY, noBreach)).resolves.toEqual([]);
  });

  it('refuses a short password', async () => {
    await expect(validatePassword('short', POLICY, noBreach)).resolves.toEqual(['TOO_SHORT']);
  });

  it('refuses an over-long password', async () => {
    await expect(validatePassword('a'.repeat(129), POLICY, noBreach)).resolves.toEqual(['TOO_LONG']);
  });

  it('counts length as exactly the boundary: min is accepted, min-1 is not', async () => {
    await expect(validatePassword('a'.repeat(12), POLICY, noBreach)).resolves.toEqual([]);
    await expect(validatePassword('a'.repeat(11), POLICY, noBreach)).resolves.toEqual(['TOO_SHORT']);
  });

  it('refuses a breached password through the seam', async () => {
    await expect(validatePassword('passwordpassword', POLICY, new OneBreached('passwordpassword'))).resolves.toEqual([
      'BREACHED',
    ]);
  });

  it('reports every violation rather than only the first', async () => {
    const breaches = new OneBreached('short');
    await expect(validatePassword('short', POLICY, breaches)).resolves.toEqual(['TOO_SHORT', 'BREACHED']);
  });

  it('consults the source with the candidate password and nothing else', async () => {
    const breaches = new OneBreached('never-matches');
    await validatePassword('correcthorsebatterystaple', POLICY, breaches);
    expect(breaches.seen).toEqual(['correcthorsebatterystaple']);
  });

  it('the default source knows of no breach, which is the honest state of this slice', async () => {
    await expect(noBreach.isBreached('any-password-at-all')).resolves.toBe(false);
  });
});
