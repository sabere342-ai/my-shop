/**
 * PrismaService — unit coverage of the wiring decisions, not of Prisma itself.
 *
 * The real connection path is exercised against real PostgreSQL by
 * `test/database/*.db-spec.ts` (§36.1 T-2 forbids a mocked database standing in
 * for that). What belongs here is the behaviour that must hold even when there is
 * no database at all: the service stays inert without `DATABASE_URL`, it never
 * lets a failure escape `onModuleInit`, and neither its logs nor `/readyz` leak a
 * connection string (§13.1, §13.6).
 */

import { PrismaClient } from '@prisma/client';
import type { Logger as PinoLogger } from 'pino';
import { LogLevel, NodeEnvironment, type AppConfigShape } from '../config/app.config';
import { ReadinessRegistry } from '../health/readiness.registry';
import { PrismaService } from './prisma.service';

/**
 * The client stand-in. A plain object of `jest.fn`s rather than a mocked class:
 * `restoreMocks` in the shared config resets mocks before each test, and a
 * constructor implementation set inside the factory would not survive that.
 */
const mockClient = {
  $connect: jest.fn(),
  $disconnect: jest.fn(),
  $queryRaw: jest.fn(),
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => mockClient),
}));

function configWith(database: AppConfigShape['database']): AppConfigShape {
  return {
    nodeEnv: NodeEnvironment.Test,
    http: { port: 3000, apiPrefix: '/api/v1' },
    logging: { level: LogLevel.Silent, prettyPrint: false },
    database,
  };
}

/** Captures calls without asserting Pino's own formatting. */
function loggerStub(): PinoLogger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
    trace: jest.fn(),
    silent: jest.fn(),
    child: jest.fn(() => loggerStub()),
  } as unknown as PinoLogger;
}

describe('PrismaService', () => {
  let registry: ReadinessRegistry;
  let logger: PinoLogger;

  beforeEach(() => {
    registry = new ReadinessRegistry();
    logger = loggerStub();
    (PrismaClient as unknown as jest.Mock).mockImplementation(() => mockClient);
    mockClient.$connect.mockResolvedValue(undefined);
    mockClient.$disconnect.mockResolvedValue(undefined);
    mockClient.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
  });

  it('stays inert when DATABASE_URL is not configured', async () => {
    // The M1-S2 contract: a process with no database dependency reports ready.
    const service = new PrismaService(configWith({}), logger, registry, 25);

    await service.onModuleInit();

    expect(PrismaClient).not.toHaveBeenCalled();
    await expect(registry.report()).resolves.toEqual({ ready: true, checks: {} });
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    expect(() => service.prisma).toThrow(/DATABASE_URL/);
  });

  it('connects with the application URL and reports ready', async () => {
    const applicationUrl = 'postgresql://my_shop_app@localhost:5432/my_shop_test';
    const service = new PrismaService(configWith({ applicationUrl }), logger, registry, 25);

    await service.onModuleInit();

    // Explicit rather than inherited from the ambient environment: §13.4 makes the
    // application role the only credential this process may hold.
    expect(PrismaClient).toHaveBeenCalledWith({ datasourceUrl: applicationUrl });
    expect(mockClient.$connect).toHaveBeenCalledTimes(1);
    await expect(registry.report()).resolves.toEqual({ ready: true, checks: { database: { ok: true } } });

    await service.onModuleDestroy();
    expect(mockClient.$disconnect).toHaveBeenCalledTimes(1);
  });

  it('registers the check and reports unavailable when the first connect fails', async () => {
    // §37.4 orders migrations before rollout: startup during a migration window
    // must continue, with /readyz holding the process back — not crash. The probe
    // fails too, because the database is still unavailable when the connect was.
    const failure = Object.assign(new Error('connect ECONNREFUSED postgres://app:secret@10.0.0.5:5432/myshop'), {
      code: 'P1001',
    });
    mockClient.$connect.mockRejectedValue(failure);
    mockClient.$queryRaw.mockRejectedValue(failure);
    const service = new PrismaService(
      configWith({ applicationUrl: 'postgresql://app@localhost/db' }),
      logger,
      registry,
      25,
    );

    await expect(service.onModuleInit()).resolves.toBeUndefined();

    await expect(registry.report()).resolves.toEqual({
      ready: false,
      checks: { database: { ok: false, reason: 'unavailable' } },
    });
  });

  it('recovers on its own once the database answers again', async () => {
    // The counterpart: readiness tracks the dependency, it does not latch. A
    // process started during the migration window becomes ready without a restart.
    mockClient.$connect.mockRejectedValue(new Error('starting'));
    const service = new PrismaService(
      configWith({ applicationUrl: 'postgresql://app@localhost/db' }),
      logger,
      registry,
      25,
    );
    await service.onModuleInit();

    await expect(registry.report()).resolves.toEqual({ ready: true, checks: { database: { ok: true } } });
  });

  it('logs the class and code of a failed connect, never the message', () => {
    // The message of a connection error can embed the host; older drivers embedded
    // the whole URL. §13.6 keeps both out of the log.
    const failure = Object.assign(new Error('connect ECONNREFUSED postgres://app:secret@10.0.0.5:5432/myshop'), {
      code: 'P1001',
    });
    mockClient.$connect.mockRejectedValue(failure);
    const service = new PrismaService(
      configWith({ applicationUrl: 'postgresql://app@localhost/db' }),
      logger,
      registry,
      25,
    );

    return service.onModuleInit().then(() => {
      const serialized = JSON.stringify((logger.warn as jest.Mock).mock.calls);
      expect(serialized).toContain('Error');
      expect(serialized).toContain('P1001');
      expect(serialized).not.toContain('secret');
      expect(serialized).not.toContain('10.0.0.5');
      expect(serialized).not.toContain('ECONNREFUSED');
    });
  });

  it('reports unavailable when the probe query fails, without leaking why', async () => {
    mockClient.$queryRaw.mockRejectedValue(
      new Error('connection terminated postgres://app:secret@10.0.0.5:5432/myshop'),
    );
    const service = new PrismaService(
      configWith({ applicationUrl: 'postgresql://app@localhost/db' }),
      logger,
      registry,
      25,
    );
    await service.onModuleInit();

    await expect(registry.report()).resolves.toEqual({
      ready: false,
      checks: { database: { ok: false, reason: 'unavailable' } },
    });

    const serialized = JSON.stringify((logger.warn as jest.Mock).mock.calls);
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('10.0.0.5');
  });

  it('gives up on a probe that hangs and still answers unavailable', async () => {
    // /readyz is polled by an orchestrator; a probe bounded by the TCP stack would
    // answer long after the poller gave up. The outcome below can only happen if
    // the timer wins the race.
    mockClient.$queryRaw.mockReturnValue(new Promise(() => undefined));
    const service = new PrismaService(
      configWith({ applicationUrl: 'postgresql://app@localhost/db' }),
      logger,
      registry,
      25,
    );
    await service.onModuleInit();

    await expect(registry.report()).resolves.toEqual({
      ready: false,
      checks: { database: { ok: false, reason: 'unavailable' } },
    });
  });

  it('does not let a probe that loses the race become an unhandled rejection', async () => {
    // During a database outage this is the common case: the timeout answered, the
    // query rejects a moment later, and nothing awaits it any more.
    let rejectProbe: ((reason: Error) => void) | undefined;
    mockClient.$queryRaw.mockReturnValue(
      new Promise<never>((_resolve, reject) => {
        rejectProbe = reject;
      }),
    );
    const service = new PrismaService(
      configWith({ applicationUrl: 'postgresql://app@localhost/db' }),
      logger,
      registry,
      25,
    );
    await service.onModuleInit();

    await expect(registry.report()).resolves.toEqual({
      ready: false,
      checks: { database: { ok: false, reason: 'unavailable' } },
    });

    rejectProbe?.(new Error('late failure'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    // An unhandled rejection would already have failed the test file; reaching
    // this line with the assertions above intact is the proof.
  });

  it('throws a named error when the client is requested without configuration', () => {
    const service = new PrismaService(configWith({}), logger, registry, 25);

    expect(() => service.prisma).toThrow('DATABASE_URL');
  });

  it('waits for an in-flight probe to settle before disconnecting', async () => {
    // Disconnecting a client whose probe is still pending makes Prisma reject an
    // internal future that nothing observes — an unhandled rejection arriving
    // precisely during the outage a graceful shutdown is meant to survive.
    let resolveProbe!: (value: unknown) => void;
    mockClient.$queryRaw.mockReturnValue(new Promise((resolve) => (resolveProbe = resolve)));
    const service = new PrismaService(
      configWith({ applicationUrl: 'postgresql://app@localhost/db' }),
      logger,
      registry,
      25,
    );
    await service.onModuleInit();

    // The probe answers from its own timeout while the query stays in flight.
    await expect(registry.report()).resolves.toEqual({
      ready: false,
      checks: { database: { ok: false, reason: 'unavailable' } },
    });

    const destroy = service.onModuleDestroy();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(mockClient.$disconnect).not.toHaveBeenCalled();

    resolveProbe([{ '?column?': 1 }]);
    await destroy;
    expect(mockClient.$disconnect).toHaveBeenCalledTimes(1);
  });
});
