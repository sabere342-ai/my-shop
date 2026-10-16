/**
 * Unit acceptance for the credential provisioning command (§10.2, §10.4, AC-31).
 *
 * The command's contract is its exit codes and its silence: `0` success, `1` a
 * runtime failure, `2` a usage/input/configuration refusal — and in every case
 * nothing on either stream carries the password or the hash. The connector and the
 * hasher are the documented test seams, so this suite pins the contract without a
 * database or a full-cost Argon2id evaluation. The real Prisma connector and the
 * real hasher are exercised end-to-end in the database acceptance suite.
 */

import { runCredentialCli, PASSWORD_ENV_VAR, type CredentialCliIo, type CredentialConnector } from './credential-cli';

const DATABASE_URL = 'postgresql://my_shop_app@127.0.0.1:5432/my_shop_test';
const EMAIL = 'Owner@Example.com';
const CANONICAL = 'owner@example.com';
const PASSPHRASE = 'a-sufficiently-long-passphrase';
const HASH = '$argon2id$v=19$m=8192,t=1,p=1$c2FsdA$aGFzaA';

interface Captured extends CredentialCliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly outLines: string[];
  readonly errLines: string[];
}

function capture(): Captured {
  const outLines: string[] = [];
  const errLines: string[] = [];
  return {
    outLines,
    errLines,
    out: (line) => outLines.push(line),
    err: (line) => errLines.push(line),
  };
}

function parse(line: string | undefined): Record<string, unknown> {
  return JSON.parse(line ?? '{}') as Record<string, unknown>;
}

/** A connector whose two reads are scripted by the caller. */
function connector(overrides: Partial<CredentialConnector> = {}): CredentialConnector {
  return {
    findUserIdByEmail: () => Promise.resolve('user-1'),
    setPassword: () => Promise.resolve('CREATED'),
    close: () => Promise.resolve(),
    ...overrides,
  };
}

const FAST_HASH = (): Promise<string> => Promise.resolve(HASH);

function baseEnv(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return { NODE_ENV: 'test', DATABASE_URL, [PASSWORD_ENV_VAR]: PASSPHRASE, ...extra };
}

describe('credential provisioning command', () => {
  it('prints usage and succeeds on --help', async () => {
    const io = capture();
    const code = await runCredentialCli(['--help'], {}, io);

    expect(code).toBe(0);
    expect(io.errLines).toEqual([]);
    expect(io.outLines.join('\n')).toContain('--email');
    expect(io.outLines.join('\n')).toContain(PASSWORD_ENV_VAR);
  });

  it('refuses an unknown flag and a missing value as usage errors', async () => {
    for (const argv of [['--nope'], ['--email'], []]) {
      const io = capture();
      const code = await runCredentialCli(argv, baseEnv(), io);
      expect(code).toBe(2);
      expect(parse(io.errLines[0]).error).toBe('INVALID_USAGE');
    }
  });

  it('validates the mailbox shape before touching configuration or a connection', async () => {
    const io = capture();
    const connect = jest.fn();
    const code = await runCredentialCli(['--email', 'not-an-email'], {}, io, { connect });

    expect(code).toBe(2);
    expect(parse(io.errLines[0]).error).toBe('INVALID_EMAIL');
    expect(connect).not.toHaveBeenCalled();
  });

  it('refuses when the application URL is absent — it must never fall back to the migrator', async () => {
    const io = capture();
    const code = await runCredentialCli(['--email', EMAIL], { NODE_ENV: 'test', [PASSWORD_ENV_VAR]: PASSPHRASE }, io);

    expect(code).toBe(2);
    expect(parse(io.errLines[0]).error).toBe('MISSING_CREDENTIAL');
  });

  it('refuses when the password environment variable is absent', async () => {
    const io = capture();
    const code = await runCredentialCli(['--email', EMAIL], { NODE_ENV: 'test', DATABASE_URL }, io);

    expect(code).toBe(2);
    expect(parse(io.errLines[0]).error).toBe('MISSING_PASSWORD');
  });

  it('refuses a password that fails the §10.2 policy, naming the rule and never the value', async () => {
    const io = capture();
    const connect = jest.fn();
    const code = await runCredentialCli(['--email', EMAIL], baseEnv({ [PASSWORD_ENV_VAR]: 'short' }), io, {
      connect,
      hash: FAST_HASH,
    });

    expect(code).toBe(2);
    expect(parse(io.errLines[0]).error).toBe('PASSWORD_POLICY_REFUSED');
    expect(parse(io.errLines[0]).violations).toEqual(['TOO_SHORT']);
    expect(io.errLines.join('\n')).not.toContain('short');
    expect(connect).not.toHaveBeenCalled();
  });

  it('creates a credential and prints one JSON line with no password', async () => {
    const io = capture();
    const setPassword = jest.fn().mockResolvedValue('CREATED');
    const close = jest.fn().mockResolvedValue(undefined);
    const connect = jest.fn().mockResolvedValue(connector({ setPassword, close }));

    const code = await runCredentialCli(['--email', EMAIL], baseEnv(), io, { connect, hash: FAST_HASH });

    expect(code).toBe(0);
    expect(io.errLines).toEqual([]);
    expect(parse(io.outLines[0])).toMatchObject({ status: 'CREATED', email: CANONICAL, userId: 'user-1' });
    expect(setPassword).toHaveBeenCalledWith('user-1', HASH, expect.any(Date));
    expect(close).toHaveBeenCalledTimes(1);

    const printed = [...io.outLines, ...io.errLines].join('\n');
    expect(printed).not.toContain(PASSPHRASE);
    expect(printed).not.toContain(HASH);
  });

  it('reports a rotation as ROTATED', async () => {
    const io = capture();
    const connect = jest.fn().mockResolvedValue(connector({ setPassword: () => Promise.resolve('ROTATED') }));

    const code = await runCredentialCli(['--email', EMAIL], baseEnv(), io, { connect, hash: FAST_HASH });

    expect(code).toBe(0);
    expect(parse(io.outLines[0]).status).toBe('ROTATED');
  });

  it('refuses a mailbox with no user, and still closes the connection', async () => {
    const io = capture();
    const close = jest.fn().mockResolvedValue(undefined);
    const connect = jest.fn().mockResolvedValue(connector({ findUserIdByEmail: () => Promise.resolve(null), close }));

    const code = await runCredentialCli(['--email', EMAIL], baseEnv(), io, { connect, hash: FAST_HASH });

    expect(code).toBe(1);
    expect(parse(io.errLines[0]).error).toBe('USER_NOT_FOUND');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('reports a hashing failure without opening a connection', async () => {
    const io = capture();
    const connect = jest.fn();
    const code = await runCredentialCli(['--email', EMAIL], baseEnv(), io, {
      connect,
      hash: () => Promise.reject(new Error('argon2 unavailable')),
    });

    expect(code).toBe(1);
    expect(parse(io.errLines[0]).error).toBe('HASHING_FAILED');
    expect(connect).not.toHaveBeenCalled();
  });

  it('reports a connection failure with an opaque message', async () => {
    const io = capture();
    const connect = jest.fn().mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:5432'));
    const code = await runCredentialCli(['--email', EMAIL], baseEnv(), io, { connect, hash: FAST_HASH });

    expect(code).toBe(1);
    expect(parse(io.errLines[0]).error).toBe('CONNECTION_FAILED');
    expect(io.errLines.join('\n')).not.toContain('127.0.0.1:5432');
  });

  it('reports an unknown write outcome opaquely and never echoes a credential', async () => {
    const io = capture();
    const connect = jest.fn().mockResolvedValue(
      connector({
        setPassword: () => Promise.reject(new Error('connection terminated: postgresql://my_shop_app@127.0.0.1')),
      }),
    );

    const code = await runCredentialCli(['--email', EMAIL], baseEnv(), io, { connect, hash: FAST_HASH });

    expect(code).toBe(1);
    expect(parse(io.errLines[0]).error).toBe('PROVISION_OUTCOME_UNKNOWN');
    expect(io.errLines.join('\n')).not.toContain('postgresql://');
    expect(io.errLines.join('\n')).not.toContain(PASSPHRASE);
  });
});
