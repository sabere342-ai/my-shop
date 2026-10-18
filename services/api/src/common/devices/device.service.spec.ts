/**
 * Device service tests (Master Plan §12, §12.5, §40.6 M2-S5).
 *
 * The service is the slice's whole decision surface — registration
 * classification, session binding, revocation, and §12.5 sync metadata — and
 * every decision it makes is transacted against the tenant context. What lives
 * here (and is asserted here) is the service's own rules, against a recording
 * transaction double:
 *
 * - the credential, never authority: a wrong installation credential is
 *   refused without revealing the device's state (§12.3, §13.3);
 * - two-state vocabulary: a REVOKED row is never re-activated (§12.2);
 * - one binding per session: re-binding is idempotent, re-linking is refused
 *   (§38.16.2);
 * - atomic revocation: the device UPDATE and the session-family revocation
 *   happen in the one transaction (§12.4).
 *
 * The database's own enforcement of the same rules (RLS scope, the unique
 * index, the CHECK constraints) is acceptance-tested against real PostgreSQL
 * in `test/database/postgres.db-spec.ts`, exactly as §36.1 T-2 demands.
 */

import type { Prisma } from '@prisma/client';
import type { Logger as PinoLogger } from 'pino';
import type { SecurityEvent, SecurityEventSink } from '../identity/security-event.sink';
import { ERROR_CODES } from '../errors/problem';
import { hashDeviceSecret } from './device-secret';
import { DeviceService } from './device.service';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const DEVICE_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_DEVICE_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const USER_ID = '55555555-5555-4555-8555-555555555555';

/** One unit creates its own installation credential so fixtures never collide. */
const CREDENTIAL = 'device-service-unit-installation-credential-padding';
const CREDENTIAL_DIGEST = hashDeviceSecret(CREDENTIAL);

/** A device row as the generated client reads it, with the happy defaults. */
function storedDevice(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const now = new Date('2026-02-01T00:00:00.000Z');
  return {
    id: DEVICE_ID,
    organizationId: ORGANIZATION_ID,
    installationId: '99999999-9999-4999-8999-999999999999',
    installationSecretHash: CREDENTIAL_DIGEST,
    label: 'Windows',
    platform: 'windows',
    osVersion: null,
    appVersion: null,
    status: 'ACTIVE',
    registeredAt: now,
    lastSeenAt: now,
    lastAuthenticatedAt: now,
    revokedAt: null,
    lastPushAt: null,
    lastPullAt: null,
    lastSyncAt: null,
    clientSchemaVersion: null,
    clientAppVersion: null,
    ...overrides,
  };
}

/** One security-event recording double: every event this service raised. */
function securitySinkDouble(): { sink: SecurityEventSink; events: SecurityEvent[] } {
  const events: SecurityEvent[] = [];
  return { sink: { record: (event) => events.push(event) }, events };
}

/** A `PinoLogger` double that keeps the lines the service logged. */
function loggerDouble(): PinoLogger & { lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  const stub = {
    info: (payload: Record<string, unknown>) => lines.push(payload),
    warn: (payload: Record<string, unknown>) => lines.push(payload),
  };
  return { ...stub, lines } as unknown as PinoLogger & { lines: Record<string, unknown>[] };
}

/**
 * The transaction double the service is exercised against: typed model doubles
 * the caller scripts per case, one raw-context hook (the real
 * `establishTenantContext` needs it), and every statement recorded.
 */
interface TxScript {
  readonly device: {
    readonly findUnique: jest.Mock;
    readonly findMany: jest.Mock;
    readonly create: jest.Mock;
    readonly update: jest.Mock;
    readonly updateMany: jest.Mock;
  };
  readonly session: {
    readonly findUnique: jest.Mock;
    readonly update: jest.Mock;
    readonly updateMany: jest.Mock;
  };
}

function runningHost(script: TxScript): Prisma.TransactionClient {
  // The tenant transaction entry point sets the §8.2 context through the raw
  // client; the double answers it and leaves the proof to the acceptance suite.
  const rawQuery: jest.Mock = jest.fn().mockResolvedValue([]);
  const tx = {
    ...script,
    $queryRaw: rawQuery,
  } as unknown as Prisma.TransactionClient;
  return tx;
}

/** A `PrismaHost` double running the scripted transaction, recording commits. */
function hostDouble(script: TxScript): { host: { readonly prisma: unknown }; commits: number } {
  let commits = 0;
  return {
    host: {
      prisma: {
        $transaction: async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>): Promise<unknown> => {
          commits += 1;
          return fn(runningHost(script));
        },
        // The host shape the service reads `prisma` through at call time;
        // nothing else on it is exercised.
        device: script.device,
      },
    },
    commits,
  };
}

const input = (overrides: Partial<Record<string, unknown>> = {}): RegisterWire =>
  ({
    organizationId: ORGANIZATION_ID,
    installationId: '99999999-9999-4999-8999-999999999999',
    installationSecret: CREDENTIAL,
    platform: 'windows',
    ...overrides,
  }) as unknown as RegisterWire;

/** The §12.1 registration input, shaped for the double's literal. */
type RegisterWire = Parameters<DeviceService['register']>[0];

describe('DeviceService — registration (§12.1, §12.2, §12.3)', () => {
  it('a new installation enrolls with the digest, the default label, and a security event', async () => {
    const created = storedDevice({ id: DEVICE_ID, label: 'Windows', installationSecretHash: CREDENTIAL_DIGEST });
    const script: TxScript = {
      device: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn(),
        create: jest.fn().mockResolvedValue(created),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      session: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    };
    const { sink, events } = securitySinkDouble();
    const service = new DeviceService(hostDouble(script).host as never, sink);

    const view = await service.register(input());

    // The digest is stored; the credential itself never is, in any form.
    const data = script.device.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(data.data.installationSecretHash).toBe(CREDENTIAL_DIGEST);
    expect(JSON.stringify(data.data)).not.toContain(CREDENTIAL);
    expect(data.data.label).toBe('Windows');

    // The view is the wire projection: identity and metadata, never a digest.
    expect(view).toMatchObject({ deviceId: DEVICE_ID, organizationId: ORGANIZATION_ID, status: 'ACTIVE' });
    expect(JSON.stringify(view)).not.toContain('installationSecretHash');
    expect(JSON.stringify(view)).not.toContain(CREDENTIAL_DIGEST);

    expect(events.map((event) => event.type)).toEqual(['DEVICE_REGISTERED']);
  });

  it('a caller-supplied label wins over the platform default', async () => {
    const script = newScript();
    script.device.findUnique.mockResolvedValue(null);
    script.device.create.mockResolvedValue(storedDevice({ label: 'Front counter' }));
    const service = new DeviceService(hostDouble(script).host as never, securitySinkDouble().sink);

    await service.register(input({ label: 'Front counter' }));

    expect((script.device.create.mock.calls[0]?.[0] as { data: { label: string } }).data.label).toBe('Front counter');
  });

  it('the same pair re-verifies the digest, refreshes metadata, and never duplicates', async () => {
    const row = storedDevice();
    const script = newScript();
    script.device.findUnique.mockResolvedValue(row);
    // `classifyStored` refreshes metadata through the host-level client.
    script.device.update.mockResolvedValue(row);
    const { sink, events } = securitySinkDouble();
    const service = new DeviceService(hostDouble(script).host as never, sink);
    const now = new Date('2026-03-01T00:00:00.000Z');
    const register = input({ appVersion: '1.2.3' });

    const view = await service.register(register, now);

    expect(script.device.create).not.toHaveBeenCalled();
    const update = script.device.update.mock.calls[0]?.[0] as { where: { id: string }; data: Record<string, unknown> };
    expect(update.where.id).toBe(DEVICE_ID);
    expect(update.data).toMatchObject({ lastSeenAt: now, lastAuthenticatedAt: now, appVersion: '1.2.3' });
    expect(view.deviceId).toBe(DEVICE_ID);
    expect(events).toEqual([]);
  });

  it('a wrong installation credential is refused without revealing the device state', async () => {
    const script = newScript();
    script.device.findUnique.mockResolvedValue(storedDevice());
    const { sink, events } = securitySinkDouble();
    const service = new DeviceService(hostDouble(script).host as never, sink);

    await expect(service.register(input({ installationSecret: `${CREDENTIAL}-wrong` }))).rejects.toMatchObject({
      code: ERROR_CODES.PERMISSION_DENIED,
    });
    expect(script.device.update).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(['DEVICE_REGISTRATION_REFUSED']);
    // The refusal names the row the caller tried to claim — never its state.
    expect(events[0]?.deviceId).toBe(DEVICE_ID);
  });

  it('a revoked installation is never re-activated (§12.2)', async () => {
    const script = newScript();
    script.device.findUnique.mockResolvedValue(
      storedDevice({ status: 'REVOKED', revokedAt: new Date('2026-02-02T00:00:00.000Z') }),
    );
    const { sink, events } = securitySinkDouble();
    const service = new DeviceService(hostDouble(script).host as never, sink);

    await expect(service.register(input())).rejects.toMatchObject({ code: ERROR_CODES.DEVICE_REVOKED });
    expect(script.device.update).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(['DEVICE_REGISTRATION_REFUSED']);
    expect(events[0]?.errorCode).toBe(ERROR_CODES.DEVICE_REVOKED);
  });

  it('two racing registrations converge: the unique-index loser classifies the stored row', async () => {
    // First read: nothing stored. The create hits the unique index (P2002).
    // The raced re-read: the winner's row, with the same credential.
    const script = newScript();
    script.device.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(storedDevice({ appVersion: '1.0.0' }));
    script.device.create.mockRejectedValue({ code: 'P2002' });
    script.device.update.mockResolvedValue(storedDevice({ appVersion: '1.2.3' }));
    const service = new DeviceService(hostDouble(script).host as never, securitySinkDouble().sink);

    const view = await service.register(input({ appVersion: '1.2.3' }));

    expect(script.device.findUnique).toHaveBeenCalledTimes(2);
    expect(view.deviceId).toBe(DEVICE_ID);
    expect(view.appVersion).toBe('1.2.3');
  });

  function newScript(): TxScript {
    return {
      device: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      session: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    };
  }
});

describe('DeviceService — session binding (§12.4, §38.16.2)', () => {
  const bindInput = {
    organizationId: ORGANIZATION_ID,
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    sessionUserId: USER_ID,
    installationSecret: CREDENTIAL,
  };

  function bindScript(device: Record<string, unknown> | null, session: Record<string, unknown> | null): TxScript {
    const script: TxScript = {
      device: {
        findUnique: jest.fn().mockResolvedValue(device),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue(device ?? storedDevice()),
        updateMany: jest.fn(),
      },
      session: {
        findUnique: jest.fn().mockResolvedValue(session),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn(),
      },
    };
    return script;
  }

  it('binds the verified device onto the same-session active principal and moves the authentication clock', async () => {
    const now = new Date('2026-03-01T00:00:00.000Z');
    const script = bindScript(storedDevice(), storedSession());
    const service = new DeviceService(hostDouble(script).host as never, securitySinkDouble().sink);

    await service.bindSession(bindInput, now);

    expect(
      (script.session.update.mock.calls[0]?.[0] as { where: { id: string }; data: { deviceId: string } }).data,
    ).toEqual({ deviceId: DEVICE_ID });
    const deviceUpdate = script.device.update.mock.calls[0]?.[0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(deviceUpdate.where.id).toBe(DEVICE_ID);
    expect(deviceUpdate.data).toMatchObject({ lastSeenAt: now, lastAuthenticatedAt: now });
  });

  it('re-binding the same device is idempotent and does not move the clock twice', async () => {
    const script = bindScript(storedDevice(), storedSession({ deviceId: DEVICE_ID }));
    const service = new DeviceService(hostDouble(script).host as never, securitySinkDouble().sink);

    await service.bindSession(bindInput, new Date('2026-03-01T00:00:00.000Z'));

    expect(script.session.update).toHaveBeenCalledTimes(1);
    // The session was already bound to this device: no second metadata write.
    expect(script.device.update).not.toHaveBeenCalled();
  });

  it('a session already bound to a different device is refused, never re-linked (§38.16.2)', async () => {
    const script = bindScript(storedDevice(), storedSession({ deviceId: OTHER_DEVICE_ID }));
    const { sink, events } = securitySinkDouble();
    const service = new DeviceService(hostDouble(script).host as never, sink);

    await expect(service.bindSession(bindInput)).rejects.toMatchObject({ code: ERROR_CODES.PERMISSION_DENIED });
    expect(script.session.update).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(['DEVICE_REGISTRATION_REFUSED']);
  });

  it('a bound session naming an unknown or foreign device is NOT_FOUND, one answer either way', async () => {
    const script = bindScript(null, storedSession());
    const service = new DeviceService(hostDouble(script).host as never, securitySinkDouble().sink);

    await expect(service.bindSession(bindInput)).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
    expect(script.session.update).not.toHaveBeenCalled();
  });

  it('a revoked device refuses binding before the credential is even consulted (§12.5)', async () => {
    const script = bindScript(
      storedDevice({ status: 'REVOKED', revokedAt: new Date('2026-02-02T00:00:00.000Z') }),
      storedSession(),
    );
    const { sink, events } = securitySinkDouble();
    const service = new DeviceService(hostDouble(script).host as never, sink);

    await expect(service.bindSession(bindInput)).rejects.toMatchObject({ code: ERROR_CODES.DEVICE_REVOKED });
    expect(script.session.update).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(['DEVICE_REGISTRATION_REFUSED']);
    expect(script.session.findUnique).not.toHaveBeenCalled();
  });

  it('a mismatched installation credential is refused like any credential failure', async () => {
    const script = bindScript(storedDevice(), storedSession());
    const { sink, events } = securitySinkDouble();
    const service = new DeviceService(hostDouble(script).host as never, sink);

    await expect(
      service.bindSession({ ...bindInput, installationSecret: `${CREDENTIAL}-wrong` }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.PERMISSION_DENIED,
    });
    expect(script.session.update).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(['DEVICE_REGISTRATION_REFUSED']);
  });

  it.each([
    ['a revoked', storedSession({ revokedAt: new Date('2026-02-02T00:00:00.000Z'), revokedReason: 'LOGOUT' })],
    ['a missing', null],
    ['a foreign', storedSession({ userId: '66666666-6666-4666-8666-666666666666' })],
  ])('%s session is answered with the same UNAUTHENTICATED refusal', async (_name, session) => {
    const script = bindScript(storedDevice(), session);
    const service = new DeviceService(hostDouble(script).host as never, securitySinkDouble().sink);

    await expect(service.bindSession(bindInput)).rejects.toMatchObject({ code: ERROR_CODES.UNAUTHENTICATED });
    expect(script.session.update).not.toHaveBeenCalled();
  });

  function storedSession(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
    return { userId: USER_ID, deviceId: null, revokedAt: null, ...overrides };
  }
});

describe('DeviceService — list and revocation (§12.4, §12.5)', () => {
  it('lists every device in registration order, and the digest never travels', async () => {
    const rows = [storedDevice(), storedDevice({ id: OTHER_DEVICE_ID, label: 'Second' })];
    const script = listScript();
    script.device.findMany.mockResolvedValue(rows);
    const service = new DeviceService(hostDouble(script).host as never, securitySinkDouble().sink);

    const views = await service.list(ORGANIZATION_ID);

    const args = script.device.findMany.mock.calls[0]?.[0] as { orderBy: unknown };
    expect(args.orderBy).toEqual([{ registeredAt: 'asc' }, { id: 'asc' }]);
    expect(views.map((view) => view.deviceId)).toEqual([DEVICE_ID, OTHER_DEVICE_ID]);
    expect(JSON.stringify(views)).not.toContain(CREDENTIAL_DIGEST);
  });

  it('revoking carries no body changes from the caller: the device and its sessions die in one transaction', async () => {
    const now = new Date('2026-03-01T00:00:00.000Z');
    const script = listScript({ deviceFindUnique: jest.fn().mockResolvedValue(storedDevice()) });
    const { sink, events } = securitySinkDouble();
    const service = new DeviceService(hostDouble(script).host as never, sink);

    await service.revoke(ORGANIZATION_ID, DEVICE_ID, { actorUserId: USER_ID }, now);

    const deviceUpdate = script.device.update.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(deviceUpdate.data).toEqual({ status: 'REVOKED', revokedAt: now });
    const sessions = script.session.updateMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(sessions.where).toEqual({ deviceId: DEVICE_ID, revokedAt: null });
    expect(sessions.data).toEqual({ revokedAt: now, revokedReason: 'DEVICE_REVOKED' });
    expect(events.map((event) => event.type)).toEqual(['DEVICE_REVOKED']);
  });

  it('a revoked device revoking again is the same 204 answer: no second write, no second event', async () => {
    const script = listScript({
      deviceFindUnique: jest
        .fn()
        .mockResolvedValue(storedDevice({ status: 'REVOKED', revokedAt: new Date('2026-02-02T00:00:00.000Z') })),
    });
    const { sink, events } = securitySinkDouble();
    const service = new DeviceService(hostDouble(script).host as never, sink);

    await service.revoke(ORGANIZATION_ID, DEVICE_ID, { actorUserId: USER_ID }, new Date());

    expect(script.device.update).not.toHaveBeenCalled();
    expect(script.session.updateMany).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('a device of another organization is NOT_FOUND, like a nonexistent id (no cross-tenant oracle)', async () => {
    const script = listScript({ deviceFindUnique: jest.fn().mockResolvedValue(null) });
    const service = new DeviceService(hostDouble(script).host as never, securitySinkDouble().sink);

    await expect(service.revoke(ORGANIZATION_ID, DEVICE_ID, { actorUserId: USER_ID })).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
  });

  function listScript(overrides: Partial<{ deviceFindUnique: jest.Mock }> = {}): TxScript {
    return {
      device: {
        findUnique: overrides.deviceFindUnique ?? jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue(storedDevice({ status: 'REVOKED' })),
        updateMany: jest.fn(),
      },
      session: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
  }
});

describe('DeviceService — §12.5 sync metadata', () => {
  function metadataScript(): TxScript {
    return {
      device: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      session: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    };
  }

  const metadataInput = {
    organizationId: ORGANIZATION_ID,
    deviceId: DEVICE_ID,
    clientSchemaVersion: 3,
    clientAppVersion: '1.2.3',
  };

  it('push records the push timestamp and the client schema version once per batch', async () => {
    const now = new Date('2026-03-01T00:00:00.000Z');
    const script = metadataScript();
    const service = new DeviceService(hostDouble(script).host as never, securitySinkDouble().sink);

    await service.recordPushMetadata(metadataInput, now);

    const call = script.device.updateMany.mock.calls[0]?.[0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(call.where.id).toBe(DEVICE_ID);
    expect(call.data).toMatchObject({
      lastSeenAt: now,
      lastAuthenticatedAt: now,
      lastSyncAt: now,
      lastPushAt: now,
      clientSchemaVersion: 3,
      clientAppVersion: '1.2.3',
    });
    expect(call.data).not.toHaveProperty('lastPullAt');
  });

  it('pull records the pull timestamp; the two directions write distinct columns', async () => {
    const now = new Date('2026-03-01T00:00:00.000Z');
    const script = metadataScript();
    const service = new DeviceService(hostDouble(script).host as never, securitySinkDouble().sink);

    await service.recordPullMetadata(metadataInput, now);

    const data = (script.device.updateMany.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data).toHaveProperty('lastPullAt', now);
    expect(data).not.toHaveProperty('lastPushAt');
  });

  it('a failed metadata write is swallowed with a warning: diagnostic only, never a sync outcome (§12.5)', async () => {
    const script = metadataScript();
    script.device.updateMany.mockRejectedValue(new Error('connection closed'));
    const logger = loggerDouble();
    const service = new DeviceService(hostDouble(script).host as never, securitySinkDouble().sink, logger);

    await expect(service.recordPushMetadata(metadataInput)).resolves.toBeUndefined();
    expect(logger.lines).toHaveLength(1);
    expect(logger.lines[0]).toMatchObject({ component: 'devices', deviceId: DEVICE_ID, direction: 'push' });
  });
});
