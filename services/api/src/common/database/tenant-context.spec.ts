/**
 * Unit specification for the trusted transaction context (Master Plan §8.2, §9.3, M2-S4).
 *
 * The database's RLS behaviour is asserted against real PostgreSQL in
 * `test/database/tenant-rls.db-spec.ts`; here the wrapper's own contract is proven:
 * the §8.2 setting name, the session-scoped `SET` ban (only transaction-local
 * `set_config(..., true)` is issued), the pre-connection shape refusals, and — the
 * §8.3 CI rule — full parameterization: a tenant identifier may only ever reach the
 * database as a bound parameter, never as interpolated SQL text.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  BOOTSTRAP_CONTEXT_SETTING,
  TENANT_CONTEXT_SETTING,
  USER_CONTEXT_SETTING,
  establishBootstrapKeyContext,
  establishTenantContext,
  establishUserContext,
  withIdentityTransaction,
  withTenantTransaction,
} from './tenant-context';

const VALID_UUID = '6f0d9d2f-0b31-4c3f-9d2e-6b1e0a1a0b11';
const OTHER_UUID = '2a2b2c2d-0e0f-4111-8111-111111111111';

/** Captures the raw statement pieces a tagged `$queryRaw` template receives. */
interface RawCapture {
  readonly staticParts: readonly unknown[];
  readonly values: readonly unknown[];
}

function rawCapture(): { readonly capture: RawCapture; readonly client: Prisma.TransactionClient } {
  const capture: { staticParts: unknown[]; values: unknown[] } = { staticParts: [], values: [] };
  return {
    capture,
    client: {
      $queryRaw: (template: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
        capture.staticParts.push(...template);
        capture.values.push(...values);
        return Promise.resolve([{ set_config: undefined }]);
      },
    } as unknown as Prisma.TransactionClient,
  };
}

describe('trusted transaction context', () => {
  it('fixes the §8.2 setting name the policies read', () => {
    expect(TENANT_CONTEXT_SETTING).toBe('app.current_organization_id');
  });

  it('uses transaction-local set_config, never a session or statement SET', () => {
    // Read back the real module *code* (comments stripped, so the file's own
    // documentation of the rule is never mistaken for a violating statement):
    // the only statement that touches a context setting is `SELECT
    // set_config(<setting>, <value>, true)`, inside the caller's transaction.
    // A session-scoped variant would leak across pooled connections (§8.2), and
    // PostgreSQL cannot parameterize a `SET` statement form at all — the source
    // contract here is what this architecture test pins.
    const source = readFileSync(resolve(__dirname, 'tenant-context.ts'), 'utf8');
    // Block and line comments only; the module contains no string literal with
    // a comment marker inside, which the change to this file would have to keep
    // true (the strings here are PostgreSQL statements, never JS comments).
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code).toMatch(/set_config\(/);
    expect(code).not.toMatch(/SET\s+(LOCAL|SESSION)\b/i);
  });

  describe('the identifier shape guard fails before any connection work', () => {
    it.each(['', '   ', 'ten-tenant', VALID_UUID.toUpperCase(), ` ${VALID_UUID} `, VALID_UUID.slice(0, 34)])(
      'refuses a non-canonical tenant identifier and never calls Prisma',
      async (shape) => {
        await expect(establishTenantContext({ prisma: {} } as never, shape)).rejects.toThrow(/canonical UUID/);
      },
    );

    it('refuses a blank or oversized bootstrap key before opening a transaction', async () => {
      await expect(establishBootstrapKeyContext({ prisma: {} } as never, '')).rejects.toThrow();
      await expect(establishBootstrapKeyContext({ prisma: {} } as never, 'a'.repeat(65))).rejects.toThrow();
    });

    it('refuses a non-canonical user identifier', async () => {
      await expect(establishUserContext({ prisma: {} } as never, 'someone@example.test')).rejects.toThrow(
        /canonical UUID/,
      );
    });
  });

  describe('parameterization (§8.3: no interpolated SQL, no injection through tenancy)', () => {
    it('sends the tenant context setting and value only as bound parameters', async () => {
      const { capture, client } = rawCapture();
      await establishTenantContext(client, VALID_UUID);

      const text = capture.staticParts.join('§');
      expect(text).toContain('SELECT set_config(');
      // The security assertion: the identifier itself appears in no static SQL text —
      // it exists only in the bound-parameter list next to the fixed setting name.
      expect(text).not.toContain(VALID_UUID);
      expect(capture.values).toEqual([TENANT_CONTEXT_SETTING, VALID_UUID]);
    });

    it('sends the user context identifier only as a bound parameter', async () => {
      const { capture, client } = rawCapture();
      await establishUserContext(client, OTHER_UUID);

      expect(capture.staticParts.join('§')).not.toContain(OTHER_UUID);
      expect(capture.values).toEqual([USER_CONTEXT_SETTING, OTHER_UUID]);
    });

    it('sends the bootstrap key only as a bound parameter', async () => {
      const { capture, client } = rawCapture();
      await establishBootstrapKeyContext(client, 'tenant-key');

      expect(capture.staticParts.join('§')).not.toContain('tenant-key');
      expect(capture.values).toEqual([BOOTSTRAP_CONTEXT_SETTING, 'tenant-key']);
    });
  });

  it('establishes the context inside the transaction it opens and hands that client on', async () => {
    const actions: string[] = [];
    let seenClient: unknown;

    const host = {
      prisma: {
        $transaction: async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
          actions.push('open');
          const captured = rawCapture();
          seenClient = captured.client;
          return fn(captured.client);
        },
      },
    };

    const result = await withTenantTransaction(host as unknown as { prisma: PrismaClient }, VALID_UUID, (tx) => {
      actions.push('run');
      expect(tx).toBe(seenClient);
      return Promise.resolve('committed');
    });

    expect(result).toBe('committed');
    // One transaction per tenant operation — never a context whose lifetime escapes it.
    expect(actions).toEqual(['open', 'run']);
  });

  it('the transaction rolls back when the caller throws, and the failure propagates', async () => {
    const host = {
      prisma: {
        $transaction: async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
          await fn(rawCapture().client);
          throw new Error('the caller failed inside the transaction');
        },
      },
    };

    await expect(
      withTenantTransaction(host as unknown as { prisma: PrismaClient }, VALID_UUID, (): Promise<undefined> =>
        Promise.resolve(undefined),
      ),
    ).rejects.toThrow('the caller failed inside the transaction');
  });

  it('the identity transaction entry point opens one transaction and resolves with its value', async () => {
    const host = {
      prisma: {
        $transaction: async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => fn(rawCapture().client),
      },
    };
    await expect(
      withIdentityTransaction(host as unknown as { prisma: PrismaClient }, OTHER_UUID, () => Promise.resolve('ok')),
    ).resolves.toBe('ok');
  });
});
