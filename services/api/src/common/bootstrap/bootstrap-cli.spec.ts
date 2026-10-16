/**
 * The operator bootstrap command line (M2-S1).
 *
 * Two things are asserted here that the database suite cannot assert cheaply or
 * at all:
 *
 * - **The refusal matrix.** Every usage, input, and configuration refusal is
 *   produced *before* a connection exists. The injected connector factory is a
 *   spy, so "nothing was attempted" is a fact rather than a claim, and the
 *   exit-code contract (0/1/2/3) is pinned without a server.
 * - **Redaction.** Every successful and failing path is checked against a
 *   credential-shaped value placed in the environment: it must never appear in
 *   output. The assertions are boolean (`expect(joined.includes(canary))
 *   .toBe(false)`) on purpose — the shared setup guard in `test-setup.base.ts`
 *   throws when a credential reaches jest's own output, so a failure must not
 *   print the input that failed.
 *
 * The real connector and a real PostgreSQL are exercised in
 * `test/database/postgres.db-spec.ts` (AC-06, AC-08, AC-14).
 */

import { BootstrapConflictError, BootstrapStateAnomalyError } from './organization-bootstrap.errors';
import type { BootstrapConnector, BootstrapConnectorFactory } from './bootstrap-cli';
import { EXIT_CONFLICT, EXIT_RUNTIME, EXIT_SUCCESS, EXIT_USAGE, runBootstrapCli, USAGE } from './bootstrap-cli';
import type { BootstrapResult } from './organization-bootstrap.service';

/**
 * A password the repository's secret-scan already classifies as a permitted
 * fixture by name, used here as the canary that must never be printed. It is
 * inert under the local and CI trust authentication, so the acceptance suite
 * can use the same value in a URL that really connects.
 */
const CANARY = 'do-not-log-this';

/** Two distinct role identities for the same host and database (§13.4). */
const APPLICATION_URL = 'postgresql://my_shop_app@127.0.0.1:5432/my_shop_test';
const OPERATOR_URL = 'postgresql://my_shop_migrator:do-not-log-this@127.0.0.1:5432/my_shop_test';

const VALID_ARGS = ['--bootstrap-key', 'main-shop', '--name', 'Main Shop', '--owner-email', 'owner@example.com'];

interface Captured {
  readonly out: string[];
  readonly err: string[];
  readonly io: { readonly out: (line: string) => void; readonly err: (line: string) => void };
}

function capture(): Captured {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (line) => out.push(line), err: (line) => err.push(line) } };
}

const SUCCESS_RESULT: BootstrapResult = {
  status: 'BOOTSTRAPPED',
  bootstrapKey: 'main-shop',
  organizationId: 'org-1',
  userId: 'user-1',
  membershipId: 'membership-1',
};

/** A connector that answers whatever the case needs; `run` is a spy. */
function connectorReturning(result: BootstrapResult | Error): {
  readonly factory: BootstrapConnectorFactory;
  readonly run: jest.Mock;
  readonly close: jest.Mock;
} {
  const run = jest.fn(() => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)));
  const close = jest.fn(() => Promise.resolve());
  const connector: BootstrapConnector = { run, close };
  return { factory: () => Promise.resolve(connector), run, close };
}

/** The factory spy used when the command must refuse before connecting. */
function forbiddenConnector(): { readonly factory: BootstrapConnectorFactory; readonly calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    factory: (url) => {
      calls.push(url.length);
      return Promise.reject(new Error('the command must not connect for this case'));
    },
  };
}

describe('runBootstrapCli arguments and refusals', () => {
  it('prints usage and succeeds for --help, connecting to nothing', async () => {
    const { io, out } = capture();
    const forbidden = forbiddenConnector();

    const code = await runBootstrapCli(['--help'], {}, io, { connect: forbidden.factory });

    expect(code).toBe(EXIT_SUCCESS);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(USAGE);
    expect(forbidden.calls).toEqual([]);
  });

  it('refuses any invocation without the required flags', async () => {
    const { io, err } = capture();

    const code = await runBootstrapCli([], {}, io);

    expect(code).toBe(EXIT_USAGE);
    expect(err).toHaveLength(1);
    expect(JSON.parse(err[0] ?? '{}')).toMatchObject({ error: 'INVALID_USAGE' });
  });

  it('refuses unknown, duplicated, and value-less flags', async () => {
    for (const argv of [
      [...VALID_ARGS, '--nope', 'value'],
      ['--bootstrap-key', 'main-shop', '--name', 'A', '--name', 'B', '--owner-email', 'a@b.example'],
      ['--bootstrap-key', 'main-shop', '--name'],
      ['--bootstrap-key=main-shop', '--name', 'A', '--owner-email', 'a@b.example'],
      [...VALID_ARGS.slice(0, 4)],
    ]) {
      const { io, err } = capture();
      const code = await runBootstrapCli(argv, {}, io);
      expect(code).toBe(EXIT_USAGE);
      expect(JSON.parse(err[0] ?? '{}')).toMatchObject({ error: 'INVALID_USAGE' });
    }
  });

  it('does not repeat a positional argument back into the output', async () => {
    const { io, err } = capture();
    const secretLooking = 'postgresql://someone:do-not-log-this@127.0.0.1:5432/my_shop_test';

    const code = await runBootstrapCli([secretLooking, ...VALID_ARGS], {}, io);

    expect(code).toBe(EXIT_USAGE);
    expect(err.join('\n').includes(secretLooking)).toBe(false);
    expect(err[0]).toContain('argument');
  });

  it('refuses a malformed key, name, or email as input, before any connection', async () => {
    const cases: readonly { readonly argv: readonly string[]; readonly field: string }[] = [
      { argv: ['--bootstrap-key', 'Main Shop', '--name', 'A', '--owner-email', 'a@b.example'], field: 'bootstrapKey' },
      { argv: ['--bootstrap-key', 'ab', '--name', 'A', '--owner-email', 'a@b.example'], field: 'bootstrapKey' },
      {
        argv: ['--bootstrap-key', 'main-shop', '--name', '   ', '--owner-email', 'a@b.example'],
        field: 'organizationName',
      },
      {
        argv: ['--bootstrap-key', 'main-shop', '--name', 'n'.repeat(201), '--owner-email', 'a@b.example'],
        field: 'organizationName',
      },
      {
        argv: ['--bootstrap-key', 'main-shop', '--name', 'A', '--owner-email', 'not-an-address'],
        field: 'ownerEmail',
      },
    ];

    for (const testCase of cases) {
      const { io, err } = capture();
      const forbidden = forbiddenConnector();

      const code = await runBootstrapCli(testCase.argv, { MIGRATION_DATABASE_URL: OPERATOR_URL }, io, {
        connect: forbidden.factory,
      });

      expect(code).toBe(EXIT_USAGE);
      expect(JSON.parse(err[0] ?? '{}')).toMatchObject({ error: 'BOOTSTRAP_INPUT_INVALID', field: testCase.field });
      expect(forbidden.calls).toEqual([]);
    }
  });

  it('fails closed when MIGRATION_DATABASE_URL is absent, never falling back to DATABASE_URL', async () => {
    const { io, err } = capture();
    const forbidden = forbiddenConnector();

    const code = await runBootstrapCli(VALID_ARGS, { DATABASE_URL: APPLICATION_URL }, io, {
      connect: forbidden.factory,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(JSON.parse(err[0] ?? '{}')).toMatchObject({ error: 'MISSING_CREDENTIAL' });
    expect(forbidden.calls).toEqual([]);
  });

  it('applies the §13.4 role-separation refusal when both URLs are the same identity', async () => {
    const { io, err } = capture();
    const forbidden = forbiddenConnector();

    const code = await runBootstrapCli(
      VALID_ARGS,
      { DATABASE_URL: APPLICATION_URL, MIGRATION_DATABASE_URL: APPLICATION_URL },
      io,
      { connect: forbidden.factory },
    );

    expect(code).toBe(EXIT_USAGE);
    expect(JSON.parse(err[0] ?? '{}')).toMatchObject({ error: 'CONFIGURATION_REFUSED' });
    expect(forbidden.calls).toEqual([]);
  });

  it('refuses when the operator URL is not a connection URL at all', async () => {
    const { io, err } = capture();
    const forbidden = forbiddenConnector();

    const code = await runBootstrapCli(VALID_ARGS, { MIGRATION_DATABASE_URL: 'not-a-url' }, io, {
      connect: forbidden.factory,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(JSON.parse(err[0] ?? '{}')).toMatchObject({ error: 'CONFIGURATION_REFUSED' });
    expect(forbidden.calls).toEqual([]);
  });
});

describe('runBootstrapCli outcomes', () => {
  it('reports a fresh bootstrap as one JSON line on stdout and exits 0', async () => {
    const { io, out, err } = capture();
    const connector = connectorReturning(SUCCESS_RESULT);

    const code = await runBootstrapCli(VALID_ARGS, { MIGRATION_DATABASE_URL: OPERATOR_URL }, io, {
      connect: connector.factory,
    });

    expect(code).toBe(EXIT_SUCCESS);
    expect(err).toEqual([]);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0] ?? '{}')).toEqual({
      status: 'BOOTSTRAPPED',
      bootstrapKey: 'main-shop',
      organizationId: 'org-1',
      userId: 'user-1',
      membershipId: 'membership-1',
    });
    expect(connector.run).toHaveBeenCalledWith({
      bootstrapKey: 'main-shop',
      organizationName: 'Main Shop',
      ownerEmail: 'owner@example.com',
    });
    expect(connector.close).toHaveBeenCalledTimes(1);
  });

  it('reports an idempotent retry as success too', async () => {
    const { io, out } = capture();
    const connector = connectorReturning({ ...SUCCESS_RESULT, status: 'ALREADY_BOOTSTRAPPED' });

    const code = await runBootstrapCli(VALID_ARGS, { MIGRATION_DATABASE_URL: OPERATOR_URL }, io, {
      connect: connector.factory,
    });

    expect(code).toBe(EXIT_SUCCESS);
    expect(JSON.parse(out[0] ?? '{}')).toMatchObject({ status: 'ALREADY_BOOTSTRAPPED' });
  });

  it('exits 3 on a conflicting retry and never prints the stored values', async () => {
    const { io, out, err } = capture();
    // The stored organization is named something the operator did not type;
    // the refusal must not turn the command into a tenant-name oracle.
    const connector = connectorReturning(new BootstrapConflictError('NAME_MISMATCH', 'main-shop'));

    const code = await runBootstrapCli(VALID_ARGS, { MIGRATION_DATABASE_URL: OPERATOR_URL }, io, {
      connect: connector.factory,
    });

    expect(code).toBe(EXIT_CONFLICT);
    expect(out).toEqual([]);
    expect(JSON.parse(err[0] ?? '{}')).toEqual({
      error: 'BOOTSTRAP_CONFLICT',
      reason: 'NAME_MISMATCH',
      bootstrapKey: 'main-shop',
    });
  });

  it('exits 1 on a stored-state anomaly, naming the condition and not the data', async () => {
    const { io, err } = capture();
    const connector = connectorReturning(new BootstrapStateAnomalyError('OWNER_MEMBERSHIP_MISSING', 'main-shop'));

    const code = await runBootstrapCli(VALID_ARGS, { MIGRATION_DATABASE_URL: OPERATOR_URL }, io, {
      connect: connector.factory,
    });

    expect(code).toBe(EXIT_RUNTIME);
    expect(JSON.parse(err[0] ?? '{}')).toMatchObject({ error: 'BOOTSTRAP_STATE_ANOMALY' });
  });

  it('exits 1 with an opaque, honest outcome when the driver error would have carried the credential', async () => {
    const { io, out, err } = capture();
    // The shape a driver error really has: it embeds the connection string.
    const connector = connectorReturning(new Error(`connect ECONNREFUSED for ${OPERATOR_URL}`));

    const code = await runBootstrapCli(VALID_ARGS, { MIGRATION_DATABASE_URL: OPERATOR_URL }, io, {
      connect: connector.factory,
    });

    expect(code).toBe(EXIT_RUNTIME);
    expect(out).toEqual([]);
    const payload = JSON.parse(err[0] ?? '{}') as { error?: string; detail?: string };
    expect(payload.error).toBe('BOOTSTRAP_OUTCOME_UNKNOWN');
    // The commit outcome is genuinely unknown, so the command must not claim
    // that nothing was committed; it must name the idempotent retry instead.
    expect(payload.detail ?? '').not.toMatch(/no state was committed/i);
    expect(payload.detail ?? '').toContain('--bootstrap-key');
    expect(err.join('\n').includes(CANARY)).toBe(false);
    expect(connector.close).toHaveBeenCalledTimes(1);
  });

  it('exits 1 when the connection itself cannot be opened, without echoing why', async () => {
    const { io, err } = capture();
    const factory: BootstrapConnectorFactory = () => Promise.reject(new Error(`cannot reach ${OPERATOR_URL}`));

    const code = await runBootstrapCli(VALID_ARGS, { MIGRATION_DATABASE_URL: OPERATOR_URL }, io, { connect: factory });

    expect(code).toBe(EXIT_RUNTIME);
    expect(JSON.parse(err[0] ?? '{}')).toMatchObject({ error: 'CONNECTION_FAILED' });
    expect(err.join('\n').includes(CANARY)).toBe(false);
  });

  it('never prints the credential on any path', async () => {
    const paths: readonly { readonly argv: readonly string[]; readonly env: Record<string, string> }[] = [
      { argv: [], env: { MIGRATION_DATABASE_URL: OPERATOR_URL } },
      { argv: VALID_ARGS, env: {} },
      { argv: VALID_ARGS, env: { MIGRATION_DATABASE_URL: OPERATOR_URL } },
    ];

    for (const path of paths) {
      const { io, out, err } = capture();
      const connector =
        path.env['MIGRATION_DATABASE_URL'] === undefined
          ? connectorReturning(SUCCESS_RESULT)
          : connectorReturning(new Error(`driver said ${OPERATOR_URL}`));

      await runBootstrapCli(path.argv, path.env, io, { connect: connector.factory });

      expect(out.join('\n').includes(CANARY)).toBe(false);
      expect(err.join('\n').includes(CANARY)).toBe(false);
    }
  });
});
