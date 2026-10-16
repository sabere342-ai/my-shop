/**
 * §10.2 / §40.6 M2-S2 — Argon2id password hashing.
 *
 * The plan names the algorithm and the constraints, and this file is the single
 * place the algorithm exists:
 *
 * - **Argon2id via a maintained library.** `@node-rs/argon2` is a native binding
 *   to the reference Rust implementation. There is no in-tree Argon2id, and
 *   `node:crypto` has none, so "use a maintained library" is the only honest
 *   option that does not mean writing crypto.
 * - **Explicit parameters.** Memory, time, and parallelism come from validated
 *   configuration, never from the library's defaults, so a deployment can raise
 *   cost without a code change and a test can lower it without hashing at full
 *   production cost.
 * - **Per-user random salt.** The library generates a 16-byte salt and encodes it
 *   in the PHC string, so one credential never reveals whether two users chose the
 *   same password. There is no separate salt column to get wrong.
 * - **Constant-time verification at the library boundary.** `verify` compares the
 *   recomputed digest with the stored one in constant time; this module never
 *   compares bytes itself. There is deliberately no hand-rolled comparison
 *   anywhere in the slice.
 *
 * The stored value is the PHC string (`$argon2id$v=19$m=...,t=...,p=...$salt$hash`).
 * That single string carries the algorithm, the parameters, and the salt, which is
 * what lets `needsRehash` decide later whether a stored credential predates the
 * current policy. The database restates the algorithm prefix in a CHECK
 * (`chk_user_credentials_password_hash_argon2id`), so the two layers agree.
 */

import { hash, parseOptions, verify } from '@node-rs/argon2';

/** The Argon2id cost parameters, taken from validated configuration (§10.2). */
export interface Argon2Parameters {
  /** Memory pool per hash, in kibibytes (`m=` in the PHC string). */
  readonly memoryKib: number;
  /** Number of passes (`t=` in the PHC string). */
  readonly timeCost: number;
  /** Degree of parallelism (`p=` in the PHC string). */
  readonly parallelism: number;
}

/**
 * The PHC algorithm identifier.
 *
 * `chk_user_credentials_password_hash_argon2id` enforces the same prefix in the
 * database, so this constant and that CHECK are one contract in two places.
 */
export const ARGON2ID_PHC_PREFIX = '$argon2id$';

/**
 * Argon2 version 19 (`0x13`) appears in the PHC string as `v=19`. The library's
 * default is this version; the prefix assertion below makes "the default is the
 * version we intend" a checked fact rather than an assumption.
 */
const ARGON2ID_PHC_PREFIX_V19 = '$argon2id$v=19$';

/** 32 raw bytes (a 43-character digest once base64-encoded inside the PHC string). */
const OUTPUT_LENGTH_BYTES = 32;

/**
 * Hashes a candidate password.
 *
 * The algorithm and version are the library's documented Argon2id/v19 defaults;
 * only the cost parameters are passed explicitly. The result is asserted to carry
 * the Argon2id prefix, so a library whose default ever changed would fail here
 * rather than silently storing a weaker scheme.
 */
export async function hashPassword(password: string, parameters: Argon2Parameters): Promise<string> {
  const encoded = await hash(password, {
    memoryCost: parameters.memoryKib,
    timeCost: parameters.timeCost,
    parallelism: parameters.parallelism,
    outputLen: OUTPUT_LENGTH_BYTES,
  });

  if (!encoded.startsWith(ARGON2ID_PHC_PREFIX_V19)) {
    throw new Error('password hashing did not produce an Argon2id v19 PHC string');
  }

  return encoded;
}

/**
 * Verifies a candidate against a stored PHC string.
 *
 * A malformed or unparseable stored value returns `false` rather than throwing:
 * a corrupt row must fail closed — the login is refused — and must not be
 * distinguishable from a wrong password by a different error shape (§13.1).
 */
export async function verifyPassword(storedHash: string, candidate: string): Promise<boolean> {
  try {
    return await verify(storedHash, candidate);
  } catch {
    return false;
  }
}

/**
 * True when a stored credential was produced with parameters that differ from the
 * current policy, so it should be re-hashed on the next successful login.
 *
 * The algorithm/version are read from the PHC prefix; the numeric costs come from
 * the library's own parser, so this never re-implements PHC parsing.
 */
export function needsRehash(storedHash: string, parameters: Argon2Parameters): boolean {
  if (!storedHash.startsWith(ARGON2ID_PHC_PREFIX_V19)) {
    return true;
  }

  try {
    const parsed = parseOptions(storedHash);
    return (
      parsed.memoryCost !== parameters.memoryKib ||
      parsed.timeCost !== parameters.timeCost ||
      parsed.parallelism !== parameters.parallelism
    );
  } catch {
    return true;
  }
}

/**
 * The hashing port the auth service depends on.
 *
 * A port rather than three imported functions so the service's unit tests can
 * substitute a trivial hasher and stay fast and deterministic, while production
 * binds the Argon2id implementation below. The *behaviour* that matters (constant
 * time, per-user salt, PHC shape) lives in this file, not behind the port.
 */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(storedHash: string, candidate: string): Promise<boolean>;
  needsRehash(storedHash: string): boolean;
}

/** Binds the port to Argon2id with the configured cost parameters. */
export function createPasswordHasher(parameters: Argon2Parameters): PasswordHasher {
  return {
    hash: (password: string) => hashPassword(password, parameters),
    verify: (storedHash: string, candidate: string) => verifyPassword(storedHash, candidate),
    needsRehash: (storedHash: string) => needsRehash(storedHash, parameters),
  };
}
