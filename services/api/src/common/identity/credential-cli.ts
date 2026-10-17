/**
 * §10.2 / §40.6 M2-S2 — the operator-only credential provisioning command.
 *
 * `npm run provision:credential -- --email <email>`
 *
 * This is a *server-side operator tool*, not an API (§39.2, §10.4). The M2-S1
 * organisation bootstrap creates the owner user; this command is what gives that
 * user a password, because nothing in the API may set one (there is no
 * self-service registration in the Master Plan). It is deliberately the only way
 * a password enters the system.
 *
 * Fail-closed properties, following `bootstrap-cli.ts`:
 *
 * - **The password is read from the environment only** (`PROVISION_PASSWORD`),
 *   never from an argument. An argument is visible to every process on the host
 *   through the process table; the environment is not. The value is never
 *   printed, never echoed in a refusal, and never written to a log.
 * - **The database credential is the application role**, read from `DATABASE_URL`
 *   and nowhere else. `user_credentials` is an application table, so provisioning
 *   it is not a migration concern and must not run as the migrator (§8.3, §13.4).
 * - **`loadConfig` is reused**, so the §13.4 role-separation refusal applies here
 *   exactly as it does at startup, and the §10.2 password policy is the same one
 *   the configuration carries.
 * - **Input is validated before a socket is opened**, so a malformed address is
 *   never mistaken for a database failure.
 *
 * Output contract: exactly one JSON line on stdout for success, exactly one JSON
 * object on stderr for a refusal. Exit codes: `0` success, `1` runtime failure,
 * `2` usage/input/configuration. Nothing here writes a password or a hash.
 */

import { PrismaClient } from '@prisma/client';

import { ConfigurationError, loadConfig } from '../config/app.config';
import { DomainError } from '../errors/domain.error';
import { hashPassword, type Argon2Parameters } from './password';
import { NoBreachedPasswordSource, validatePassword } from './password-policy';
import { canonicalizeEmail, EmailShapeError } from './user-provisioning';

/** Success: the credential was created or rotated. */
export const EXIT_SUCCESS = 0;
/** The command could not complete for a reason that is not the input's fault. */
export const EXIT_RUNTIME = 1;
/** Usage, input shape, or configuration — nothing was attempted. */
export const EXIT_USAGE = 2;

/** The environment variable the password is read from. Never an argument. */
export const PASSWORD_ENV_VAR = 'PROVISION_PASSWORD';

/** Where the command writes. Injected so a suite can assert on output. */
export interface CredentialCliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/** What the command needs from a live connection. */
export interface CredentialConnector {
  findUserIdByEmail(email: string): Promise<string | null>;
  setPassword(userId: string, passwordHash: string, now: Date): Promise<'CREATED' | 'ROTATED'>;
  close(): Promise<void>;
}

/** Builds a connector for an application URL. The default one is Prisma. */
export type CredentialConnectorFactory = (applicationUrl: string) => Promise<CredentialConnector>;

export interface CredentialCliOptions {
  /** **Test-only seam.** Substituted to pin exit codes without a database. */
  readonly connect?: CredentialConnectorFactory;
  /** **Test-only seam.** Substituted so a unit test does not pay Argon2id cost. */
  readonly hash?: (password: string, parameters: Argon2Parameters) => Promise<string>;
}

export const USAGE = `Usage: npm run provision:credential -- --email <email>

Operator-only credential provisioning (Master Plan section 10.2, slice M2-S2).
Sets (or rotates) the password for an existing user, addressed by mailbox. The
user must already exist — created by "npm run bootstrap:org".

  --email <email>   the existing user's mailbox; canonicalized before lookup
  -h, --help        print this message

The new password is read from the environment variable ${PASSWORD_ENV_VAR} and
from nowhere else: it is never an argument and never printed. The database
credential is read from DATABASE_URL (the application role). Exit codes: 0
success, 1 runtime failure, 2 usage, input, or configuration refused.
`;

/** A usage failure: exit code 2, never a driver or environment value. */
class UsageError extends Error {}

interface ParsedArguments {
  readonly help: boolean;
  readonly email?: string;
}

/** Renders an argument token safely: only a recognised flag name is ever echoed. */
function describeToken(token: string): string {
  const match = /^--?([a-z][a-z0-9-]*)(?:=.*)?$/.exec(token);
  return match?.[1] === undefined ? 'argument' : `--${match[1]}`;
}

/** Exact-flag parsing: unknown flags and a missing value are refused, never guessed. */
function parseArguments(argv: readonly string[]): ParsedArguments {
  let email: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;

    if (token === '--help' || token === '-h') {
      return { help: true };
    }

    if (token !== '--email') {
      throw new UsageError(
        token.startsWith('--') ? `unknown flag ${describeToken(token)}` : 'every argument must be a named flag',
      );
    }
    if (email !== undefined) {
      throw new UsageError('flag --email was given more than once');
    }

    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new UsageError('flag --email is missing its value');
    }

    email = value;
    index += 1;
  }

  if (email === undefined) {
    throw new UsageError('missing required flag: --email');
  }

  return { help: false, email };
}

/** Prisma is the only production connector; it connects eagerly so failures are unambiguous. */
const prismaConnector: CredentialConnectorFactory = async (applicationUrl) => {
  const client = new PrismaClient({ datasourceUrl: applicationUrl });
  await client.$connect();

  return {
    async findUserIdByEmail(email) {
      const user = await client.user.findUnique({ where: { email }, select: { id: true } });
      return user === null ? null : user.id;
    },
    async setPassword(userId, passwordHash, now) {
      const existing = await client.userCredential.findUnique({ where: { userId }, select: { userId: true } });
      await client.userCredential.upsert({
        where: { userId },
        create: { userId, passwordHash, passwordUpdatedAt: now },
        update: { passwordHash, passwordUpdatedAt: now },
      });
      return existing === null ? 'CREATED' : 'ROTATED';
    },
    close: () => client.$disconnect(),
  };
};

function jsonLine(payload: Record<string, unknown>): string {
  return JSON.stringify(payload);
}

/**
 * Runs the command in-process and answers with its exit code.
 *
 * In-process so a suite exercises the real parser, the real policy, and the real
 * hasher against real PostgreSQL; `scripts/provision-credential.mjs` is the
 * operator-facing shim that loads the built output.
 */
export async function runCredentialCli(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  io: CredentialCliIo,
  options: CredentialCliOptions = {},
): Promise<number> {
  // 1. Arguments. Nothing here touches configuration or a socket.
  let parsed: ParsedArguments;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    io.err(jsonLine({ error: 'INVALID_USAGE', detail: error instanceof Error ? error.message : 'invalid usage' }));
    return EXIT_USAGE;
  }

  if (parsed.help) {
    io.out(USAGE);
    return EXIT_SUCCESS;
  }
  if (parsed.email === undefined) {
    io.err(jsonLine({ error: 'INVALID_USAGE', detail: 'missing required flag: --email' }));
    return EXIT_USAGE;
  }

  // 2. Address shape, before configuration: a malformed address costs nothing and
  //    is never a database failure.
  let email: string;
  try {
    email = canonicalizeEmail(parsed.email);
  } catch (error) {
    if (error instanceof EmailShapeError) {
      io.err(jsonLine({ error: 'INVALID_EMAIL', detail: 'the --email value is not a mailbox address' }));
      return EXIT_USAGE;
    }
    throw error;
  }

  // 3. Configuration, through the same validator the process uses.
  let applicationUrl: string;
  let argon2: Argon2Parameters;
  let policy: { readonly minLength: number; readonly maxLength: number };
  try {
    const config = loadConfig(env);
    if (config.database.applicationUrl === undefined) {
      io.err(
        jsonLine({
          error: 'MISSING_CREDENTIAL',
          detail:
            'DATABASE_URL is not set; credential provisioning writes an application table and runs as the application role (section 13.4)',
        }),
      );
      return EXIT_USAGE;
    }
    applicationUrl = config.database.applicationUrl;
    argon2 = {
      memoryKib: config.identity?.argon2MemoryKib ?? 19_456,
      timeCost: config.identity?.argon2TimeCost ?? 2,
      parallelism: config.identity?.argon2Parallelism ?? 1,
    };
    policy = {
      minLength: config.identity?.passwordMinLength ?? 12,
      maxLength: config.identity?.passwordMaxLength ?? 128,
    };
  } catch (error) {
    if (error instanceof ConfigurationError) {
      // The violation list is value-free by construction: it names variables and
      // rules, never values.
      io.err(jsonLine({ error: 'CONFIGURATION_REFUSED', violations: error.violations }));
      return EXIT_USAGE;
    }
    throw error;
  }

  // 4. The password, from the environment only, and the §10.2 policy.
  const password = env[PASSWORD_ENV_VAR];
  if (password === undefined || password.length === 0) {
    io.err(
      jsonLine({
        error: 'MISSING_PASSWORD',
        detail: `${PASSWORD_ENV_VAR} is not set; the password is read from the environment and never from an argument`,
      }),
    );
    return EXIT_USAGE;
  }

  const violations = await validatePassword(password, policy, new NoBreachedPasswordSource());
  if (violations.length > 0) {
    // The refusal names the rule, never the value.
    io.err(jsonLine({ error: 'PASSWORD_POLICY_REFUSED', violations }));
    return EXIT_USAGE;
  }

  const hash = options.hash ?? hashPassword;
  let passwordHash: string;
  try {
    passwordHash = await hash(password, argon2);
  } catch {
    io.err(jsonLine({ error: 'HASHING_FAILED', detail: 'the password could not be hashed; nothing was written' }));
    return EXIT_RUNTIME;
  }

  // 5. Connect, resolve the user, write the credential, close.
  const connect = options.connect ?? prismaConnector;
  let connector: CredentialConnector;
  try {
    connector = await connect(applicationUrl);
  } catch {
    io.err(jsonLine({ error: 'CONNECTION_FAILED', detail: 'could not open the operator database connection' }));
    return EXIT_RUNTIME;
  }

  try {
    const userId = await connector.findUserIdByEmail(email);
    if (userId === null) {
      io.err(
        jsonLine({
          error: 'USER_NOT_FOUND',
          detail: 'no user has that mailbox; create the user with "npm run bootstrap:org" first',
          email,
        }),
      );
      return EXIT_RUNTIME;
    }

    const status = await connector.setPassword(userId, passwordHash, new Date());
    io.out(jsonLine({ status, email, userId }));
    return EXIT_SUCCESS;
  } catch (error) {
    if (error instanceof DomainError) {
      io.err(jsonLine({ error: 'CREDENTIAL_REFUSED', code: error.code }));
      return EXIT_RUNTIME;
    }
    // Deliberately opaque: a driver message can carry the host, the role, and the
    // URL. The outcome is also honestly unknown — the connection opened and the
    // upsert did not report a decisive result.
    io.err(
      jsonLine({
        error: 'PROVISION_OUTCOME_UNKNOWN',
        detail:
          'the credential write did not report a definitive result, so whether it committed is unknown. Re-run the same command: the provision is an upsert, so a retry either creates or rotates the same credential. No password is printed here',
      }),
    );
    return EXIT_RUNTIME;
  } finally {
    try {
      await connector.close();
    } catch {
      /* closing is best-effort; the write's outcome is already decided */
    }
  }
}
