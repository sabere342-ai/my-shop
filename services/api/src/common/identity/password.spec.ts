/**
 * Unit acceptance for the Argon2id primitive (§10.2, AC-07, AC-08).
 *
 * The parameters here are deliberately far below the §10.2 production floor: this
 * suite asserts the *shape* and the *behaviour* of the primitive (Argon2id v19, a
 * fresh salt, constant-time refusal, parameter drift), and paying full production
 * cost per case would make the fast suite slow without testing anything more. The
 * production floor is asserted in `app.config.spec.ts`, which is where a policy
 * number belongs.
 */

import {
  ARGON2ID_PHC_PREFIX,
  createPasswordHasher,
  hashPassword,
  needsRehash,
  type Argon2Parameters,
  type PasswordHasher,
  verifyPassword,
} from './password';

const FAST: Argon2Parameters = { memoryKib: 8192, timeCost: 1, parallelism: 1 };
const SLOWER: Argon2Parameters = { memoryKib: 8192, timeCost: 2, parallelism: 1 };

const PASSPHRASE = 'correct horse battery staple';

describe('password hashing', () => {
  it('produces an Argon2id v19 PHC string, which is what the database CHECK admits', async () => {
    const encoded = await hashPassword(PASSPHRASE, FAST);

    expect(encoded.startsWith(ARGON2ID_PHC_PREFIX)).toBe(true);
    expect(encoded.startsWith('$argon2id$v=19$')).toBe(true);
    expect(encoded).toContain('m=8192,t=1,p=1');
  });

  it('salts each hash independently, so equal passwords are not equal rows', async () => {
    const first = await hashPassword(PASSPHRASE, FAST);
    const second = await hashPassword(PASSPHRASE, FAST);

    expect(first).not.toBe(second);
    await expect(verifyPassword(first, PASSPHRASE)).resolves.toBe(true);
    await expect(verifyPassword(second, PASSPHRASE)).resolves.toBe(true);
  });

  it('verifies the right password and refuses a wrong one', async () => {
    const encoded = await hashPassword(PASSPHRASE, FAST);

    await expect(verifyPassword(encoded, PASSPHRASE)).resolves.toBe(true);
    await expect(verifyPassword(encoded, `${PASSPHRASE}!`)).resolves.toBe(false);
  });

  it('fails closed — returns false, never throws — on a malformed stored value (§13.1)', async () => {
    for (const stored of ['', 'not-a-phc-string', '$argon2id$broken', 'plaintext-password']) {
      await expect(verifyPassword(stored, PASSPHRASE)).resolves.toBe(false);
    }
  });

  it('needsRehash is false only for a stored value at the current parameters', async () => {
    const current = await hashPassword(PASSPHRASE, FAST);

    expect(needsRehash(current, FAST)).toBe(false);
    expect(needsRehash(current, SLOWER)).toBe(true);
    expect(needsRehash('plaintext-password', FAST)).toBe(true);
    expect(needsRehash('$argon2i$v=19$m=8192,t=1,p=1$c2FsdA$aGFzaA', FAST)).toBe(true);
  });

  it('the port delegates every operation to the module', async () => {
    const hasher: PasswordHasher = createPasswordHasher(FAST);

    const encoded = await hasher.hash(PASSPHRASE);
    expect(encoded.startsWith('$argon2id$v=19$')).toBe(true);
    await expect(hasher.verify(encoded, PASSPHRASE)).resolves.toBe(true);
    await expect(hasher.verify(encoded, 'wrong')).resolves.toBe(false);
    expect(hasher.needsRehash(encoded)).toBe(false);
    expect(hasher.needsRehash('$argon2i$v=19$m=8192,t=1,p=1$c2FsdA$aGFzaA')).toBe(true);
  });
});
