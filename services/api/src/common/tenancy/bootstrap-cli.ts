/**
 * §10.4 / §40.6 M2-S1 — the operator-only bootstrap command line.
 *
 * The command is a *server-side operator tool*, not an API: there is no route,
 * no controller, no DTO, and no permission a client could ever hold (§39.2,
 * AC-23). Its credential is possession of `MIGRATION_DATABASE_URL` — the
 * migrator role — which is why the whole surface is built around failing
 * closed:
 *
 * - The connection URL is read from the environment only. It is never an
 *   argument, never printed, and never embedded in an error message (§13.6,
 *   §42.6): this file contains no code path that writes a URL, a password, or
 *   a raw driver error to the output.
 * - `loadConfig` is reused so the §13.4 role-separation refusal applies here
 *   exactly as it does at startup: a deployment whose migrator and application
 *   credentials have collapsed is refused before a socket is opened.
 * - Missing `MIGRATION_DATABASE_URL` is a refusal, never a fallback to
 *   `DATABASE_URL`. Running this command as the application role would create
 *   tables outside the migration history, which §8.3 forbids.
 * - Input is validated **before** configuration is loaded and before any
 *   connection, so a malformed key, name, or email can never be mistaken for a
 *   database problem (AC-07).
 *
 * Output contract (§10.4): exactly one structured JSON line on stdout for a
 * successful (including idempotent) run, exactly one JSON object on stderr for
 * a refusal. Exit codes: `0` success, `1` runtime failure, `2`
 * usage/input/configuration, `3` conflicting retry.
 */

import { PrismaClient } from '@prisma/client';
import { ConfigurationError, loadConfig } from '../config/app.config';
import {
  BootstrapConflictError,
  BootstrapInputError,
  BootstrapStateAnomalyError,
} from './organization-bootstrap.errors';
import {
  normalizeBootstrapRequest,
  OrganizationBootstrapService,
  type BootstrapRequest,
  type BootstrapResult,
} from './organization-bootstrap.service';

/** Success, including the idempotent `ALREADY_BOOTSTRAPPED` answer. */
export const EXIT_SUCCESS = 0;
/** The command could not complete for a reason that is not the input's fault. */
export const EXIT_RUNTIME = 1;
/** Usage, input shape, or configuration — nothing was attempted. */
export const EXIT_USAGE = 2;
/** The key names a different durable result; nothing was adopted or overwritten. */
export const EXIT_CONFLICT = 3;

/** Where the command writes. Injected so the acceptance suite can assert on output. */
export interface BootstrapCliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/** What the CLI needs from a live connection: run one request, then close. */
export interface BootstrapConnector {
  readonly run: (request: BootstrapRequest) => Promise<BootstrapResult>;
  readonly close: () => Promise<void>;
}

/** Builds a connector for a migrator URL. The default one is Prisma; tests substitute it. */
export type BootstrapConnectorFactory = (migrationUrl: string) => Promise<BootstrapConnector>;

export interface BootstrapCliOptions {
  /**
   * **Test-only seam.** Unit suites substitute the connector to pin exit codes
   * `0`, `1`, and `3` without a database (there is no honest way to make a
   * real server return a conflict on demand); the acceptance suite drives the
   * real Prisma connector end to end. Production always uses the default.
   */
  readonly connect?: BootstrapConnectorFactory;
}

export const USAGE = `Usage: npm run bootstrap:org -- --bootstrap-key <key> --name <name> --owner-email <email>

Operator-only, one-time organization bootstrap (Master Plan section 10.4,
slice M2-S1). Creates one organization, its owner user, and the owner
membership in a single transaction. An identical retry is a no-op; a retry with
different parameters for the same key is refused.

  --bootstrap-key <key>   idempotency key; lowercase kebab-case, 3-64 characters
  --name <name>           organization display name, 1-200 characters
  --owner-email <email>   owner mailbox; stored canonicalized (trim + lowercase)
  -h, --help              print this message

The database credential is read from MIGRATION_DATABASE_URL (the migrator role)
and from nowhere else: it is never an argument and never printed. Exit codes:
0 success (including an idempotent retry), 1 runtime failure, 2 usage, input, or
configuration refused, 3 conflicting retry.
`;

/** A usage failure: reported with exit code 2 and never a driver or environment value. */
class UsageError extends Error {}

interface ParsedArguments {
  readonly help: boolean;
  readonly request?: BootstrapRequest;
}

/**
 * Renders an argument token safely for a usage message.
 *
 * Only a recognised flag shape is ever echoed, and only its name part: an
 * operator who mistypes `--owner-email=secret` gets `--owner-email`, and an
 * accidental paste of a credential as a positional argument is described
 * without being repeated. The output of this command lands in terminals and
 * CI logs (§13.6).
 */
function describeToken(token: string): string {
  const match = /^--?([a-z][a-z0-9-]*)(?:=.*)?$/.exec(token);
  return match?.[1] === undefined ? 'argument' : `--${match[1]}`;
}

/**
 * Parses the flag vector. Exact-flag parsing on purpose: unknown flags,
 * duplicate flags, and a flag missing its value are all refused rather than
 * guessed at — a bootstrap command that accepts "close enough" is a command
 * that can create the wrong tenant.
 */
function parseArguments(argv: readonly string[]): ParsedArguments {
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;

    if (token === '--help' || token === '-h') {
      return { help: true };
    }

    if (!token.startsWith('--')) {
      throw new UsageError(`unexpected ${describeToken(token)}; every argument must be a named flag`);
    }

    if (token.includes('=')) {
      throw new UsageError(`flag ${describeToken(token)} must be given as "${describeToken(token)} <value>"`);
    }

    if (!['--bootstrap-key', '--name', '--owner-email'].includes(token)) {
      throw new UsageError(`unknown flag ${describeToken(token)}`);
    }
    if (values.has(token)) {
      throw new UsageError(`flag ${token} was given more than once`);
    }

    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new UsageError(`flag ${token} is missing its value`);
    }

    values.set(token, value);
    index += 1;
  }

  const bootstrapKey = values.get('--bootstrap-key');
  const organizationName = values.get('--name');
  const ownerEmail = values.get('--owner-email');

  if (bootstrapKey === undefined || organizationName === undefined || ownerEmail === undefined) {
    const missing = [
      ...(bootstrapKey === undefined ? ['--bootstrap-key'] : []),
      ...(organizationName === undefined ? ['--name'] : []),
      ...(ownerEmail === undefined ? ['--owner-email'] : []),
    ];
    throw new UsageError(`missing required flag(s): ${missing.join(', ')}`);
  }

  return { help: false, request: { bootstrapKey, organizationName, ownerEmail } };
}

/** Prisma is the only production connector; it connects eagerly so failures are unambiguous. */
const prismaConnector: BootstrapConnectorFactory = async (migrationUrl) => {
  const client = new PrismaClient({ datasourceUrl: migrationUrl });
  await client.$connect();
  const service = new OrganizationBootstrapService({ prisma: client });
  return { run: (request) => service.bootstrap(request), close: () => client.$disconnect() };
};

/** One JSON object per line; nothing here ever interpolates a value that is not JSON-encoded. */
function jsonLine(payload: Record<string, unknown>): string {
  return JSON.stringify(payload);
}

/**
 * Runs the command in-process and answers with its exit code.
 *
 * In-process rather than spawned so the acceptance suite exercises the real
 * argument parser and the real service against real PostgreSQL without a build
 * step in the test path; `scripts/org-bootstrap.mjs` is the operator-facing
 * shim that loads the built output and forwards `process.argv` and its own exit
 * code.
 */
export async function runBootstrapCli(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  io: BootstrapCliIo,
  options: BootstrapCliOptions = {},
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
  if (parsed.request === undefined) {
    // Unreachable through `parseArguments`; kept so the type is narrowed without
    // asserting, and so a future refactor cannot turn it into a crash.
    io.err(jsonLine({ error: 'INVALID_USAGE', detail: 'missing required flags' }));
    return EXIT_USAGE;
  }

  // 2. Input shapes, before configuration: a malformed request is never a
  //    database failure and must cost nothing (AC-07). The service validates
  //    again inside its own contract; this pre-flight exists so the refusal
  //    happens before any credential is even looked at.
  try {
    normalizeBootstrapRequest(parsed.request);
  } catch (error) {
    if (error instanceof BootstrapInputError) {
      io.err(jsonLine({ error: error.code, field: error.field, reason: error.reason }));
      return EXIT_USAGE;
    }
    throw error;
  }
  const request = parsed.request;

  // 3. Configuration, through the same validator the process uses, so the
  //    §13.4 role-separation refusal applies to this credential too.
  let migrationUrl: string;
  try {
    const config = loadConfig(env);
    if (config.database.migrationUrl === undefined) {
      io.err(
        jsonLine({
          error: 'MISSING_CREDENTIAL',
          detail:
            'MIGRATION_DATABASE_URL is not set; the bootstrap command runs only as the migrator role (section 13.4) and refuses to run as the application',
        }),
      );
      return EXIT_USAGE;
    }
    migrationUrl = config.database.migrationUrl;
  } catch (error) {
    if (error instanceof ConfigurationError) {
      // The violation list is value-free by construction: `app.config.ts` names
      // variables and rules, never URLs.
      io.err(jsonLine({ error: 'CONFIGURATION_REFUSED', violations: error.violations }));
      return EXIT_USAGE;
    }
    throw error;
  }

  // 4. Connect, run, and close. The URL is used here and nowhere else.
  const connect = options.connect ?? prismaConnector;
  let connector: BootstrapConnector;
  try {
    connector = await connect(migrationUrl);
  } catch {
    io.err(jsonLine({ error: 'CONNECTION_FAILED', detail: 'could not open the operator database connection' }));
    return EXIT_RUNTIME;
  }

  try {
    const result = await connector.run(request);
    io.out(
      jsonLine({
        status: result.status,
        bootstrapKey: result.bootstrapKey,
        organizationId: result.organizationId,
        userId: result.userId,
        membershipId: result.membershipId,
      }),
    );
    return EXIT_SUCCESS;
  } catch (error) {
    if (error instanceof BootstrapConflictError) {
      io.err(jsonLine({ error: error.code, reason: error.reason, bootstrapKey: error.bootstrapKey }));
      return EXIT_CONFLICT;
    }
    if (error instanceof BootstrapInputError) {
      io.err(jsonLine({ error: error.code, field: error.field, reason: error.reason }));
      return EXIT_USAGE;
    }
    if (error instanceof BootstrapStateAnomalyError) {
      io.err(jsonLine({ error: error.code, reason: error.reason, bootstrapKey: error.bootstrapKey }));
      return EXIT_RUNTIME;
    }
    // Deliberately opaque: the driver's message can carry the host, the role,
    // and — on some drivers — the URL. The operator gets a code and a lookup,
    // not a credential in a log file.
    io.err(
      jsonLine({
        error: 'BOOTSTRAP_RUNTIME_FAILURE',
        detail:
          'the bootstrap did not complete; no state was committed. Check database availability and logs (no credential is printed here)',
      }),
    );
    return EXIT_RUNTIME;
  } finally {
    // A failed disconnect must not change the exit code and must not throw
    // past the caller: the transaction's outcome is already decided.
    try {
      await connector.close();
    } catch {
      /* closing is best-effort; §10.4 reports the transaction, not the teardown */
    }
  }
}
