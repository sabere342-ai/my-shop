/**
 * The device service (Master Plan §12, §12.5, §40.6 M2-S5).
 *
 * Everything the slice's three routes decide lives here.
 * Four structural rules shape every path:
 *
 * 1. **Tenant scope is server-derived.** Every read and write runs inside the
 *    trusted tenant transaction (§8.2 `withTenantTransaction`) with an
 *    organization id the caller already proved — the route parameter the
 *    authorization guard matched against the token's membership claim, or the
 *    organization id the sync trusted context carries. A request body never
 *    names a tenant into existence (§9.3).
 * 2. **The client's installation pair is a credential, never authority**
 *    (§12.3, §13.3). The keystore-backed `(installation_id, installation_secret)`
 *    decides *which* row is claimed; the decision itself is the server's: live
 *    status, live membership, live secret digest, inside the transaction that
 *    will commit the effect.
 * 3. **A revoked device stays revoked.** §12.2's closed two-state vocabulary is
 *    enforced by never writing `ACTIVE` over a `REVOKED` row and by refusing
 *    re-registration of a revoked installation. Re-installation enrolls a *new*
 *    installation id; the old identity and its quarantined history remain (§12.5).
 * 4. **Revocation is one atomic outcome.** Setting `REVOKED` and revoking every
 *    bound session family happen in the one transaction (§12.4), so the refresh
 *    path dies at the same instant the device does; the §40.6 key acceptance is a
 *    single UPDATE's reach, not two writes hoping to meet.
 *
 * Registration concurrency is settled by the database: the unique
 * `(organization_id, installation_id)` index is the arbiter, so two racing
 * registrations converge on one row and the loser classifies against the stored
 * secret — application checks never stand alone (§8.3).
 */

import type { Prisma } from '@prisma/client';
import type { Logger as PinoLogger } from 'pino';
import { DomainError } from '../errors/domain.error';
import { ERROR_CODES } from '../errors/problem';
import { withTenantTransaction } from '../database/tenant-context';
import type { SecurityEventSink } from '../identity/security-event.sink';
import type { PrismaHost } from '../identity/prisma-host';
import { deviceSecretMatches, hashDeviceSecret } from './device-secret';
import type { AuditStreamWriter } from '../audit/audit-stream-writer';
import { type DevicePlatform } from './device.contract';

/**
 * The label a device that registered without one carries (§12.1: platform-derived).
 */
const DEFAULT_LABEL_BY_PLATFORM: Readonly<Record<DevicePlatform, string>> = {
  windows: 'Windows',
  android: 'Android',
};

/** The device status column's literal type at the service boundary. */
export type DeviceStatus = 'ACTIVE' | 'REVOKED';

/** One registration attempt (§12.1). */
export interface RegisterDeviceInput {
  readonly organizationId: string;
  readonly installationId: string;
  readonly installationSecret: string;
  readonly platform: DevicePlatform;
  readonly osVersion?: string;
  readonly appVersion?: string;
  readonly label?: string;
  readonly clientAddress?: string;
  /**
   * M2-S6 (§32.6): the verified principal performing the registration,
   * supplied by the route from the bearer guard — never a body field. The
   * durable registration event names this actor.
   */
  readonly actorUserId?: string;
}

/** The sync metadata a completed batch or page records (§12.5). */
export interface SyncMetadataInput {
  readonly organizationId: string;
  readonly deviceId: string;
  readonly clientSchemaVersion?: number;
  readonly clientAppVersion?: string;
}

/** A device as the registration and list routes answer it. */
export interface DeviceView {
  readonly deviceId: string;
  readonly organizationId: string;
  readonly label: string;
  readonly platform: DevicePlatform;
  readonly osVersion?: string;
  readonly appVersion?: string;
  readonly status: DeviceStatus;
  readonly registeredAt: Date;
  readonly lastSeenAt: Date;
  readonly lastAuthenticatedAt: Date;
  readonly revokedAt?: Date;
  readonly lastPushAt?: Date;
  readonly lastPullAt?: Date;
  readonly lastSyncAt?: Date;
  readonly clientSchemaVersion?: number;
  readonly clientAppVersion?: string;
}

/** A device row as `device.findUnique` reads it back. */
type DeviceRow = Prisma.DeviceGetPayload<Record<string, never>>;

export class DeviceService {
  constructor(
    private readonly host: PrismaHost,
    private readonly securitySink: SecurityEventSink,
    private readonly logger?: PinoLogger,
    /**
     * M2-S6: the transactional audit writer (§32.5's class-A failure policy).
     * The production wiring always supplies it; a narrow unit construction
     * without one keeps the class-B sink emissions of the earlier slices.
     */
    private readonly audit?: AuditStreamWriter,
  ) {}

  /**
   * Registers this installation in the caller's organization (§12.1).
   *
   * Idempotent per `(organization_id, installation_id)`: the same pair
   * re-verifies against the stored secret digest and refreshes the reported
   * metadata; a new installation id enrolls a new device; a *revoked*
   * installation is never re-activated (§12.2). A secret that does not match is
   * refused like any other credential failure, with a security event.
   */
  async register(input: RegisterDeviceInput, now: Date = new Date()): Promise<DeviceView> {
    return withTenantTransaction(this.host, input.organizationId, async (tx) => {
      try {
        return await this.tryRegister(tx, input, now);
      } catch (error) {
        // Two racing registrations of the same installation converge on the
        // unique index; the loser re-reads and classifies against the stored
        // row instead of surfacing an internal constraint failure (§8.3).
        if (isUniqueViolation(error)) {
          const stored = await tx.device.findUnique({
            where: {
              organizationId_installationId: {
                organizationId: input.organizationId,
                installationId: input.installationId,
              },
            },
          });
          if (stored !== null) {
            return this.classifyStored(tx, stored, input, now, { updateMetadata: true });
          }
        }
        throw error;
      }
    });
  }

  private async tryRegister(tx: Prisma.TransactionClient, input: RegisterDeviceInput, now: Date): Promise<DeviceView> {
    const existing = await tx.device.findUnique({
      where: {
        organizationId_installationId: {
          organizationId: input.organizationId,
          installationId: input.installationId,
        },
      },
    });

    if (existing !== null) {
      return this.classifyStored(tx, existing, input, now, { updateMetadata: true });
    }

    // A brand-new installation enrolls with the keystore secret's digest. The
    // device id is minted by the database default — server-issued identity
    // (§12.3) — and the label defaults to the platform name (§12.1).
    const created = await tx.device.create({
      data: {
        organizationId: input.organizationId,
        installationId: input.installationId,
        installationSecretHash: hashDeviceSecret(input.installationSecret),
        label: input.label ?? DEFAULT_LABEL_BY_PLATFORM[input.platform],
        platform: input.platform,
        ...(input.osVersion === undefined ? {} : { osVersion: input.osVersion }),
        ...(input.appVersion === undefined ? {} : { appVersion: input.appVersion }),
      },
    });

    // M2-S6: the registration event is class A — it commits with the
    // registration row itself (§32.5: a protected state change and its audit
    // event live or die together). A narrow unit construction without the
    // writer falls back to the class-B sink port, exactly as before.
    if (this.audit === undefined) {
      this.securitySink.record({
        type: 'DEVICE_REGISTERED',
        organizationId: input.organizationId,
        deviceId: created.id,
        ...(input.actorUserId === undefined ? {} : { userId: input.actorUserId }),
        ...(input.clientAddress === undefined ? {} : { clientAddress: input.clientAddress }),
      });
    } else {
      await this.audit.appendSecurityEvent(tx, {
        eventType: 'DEVICE_REGISTERED',
        organizationId: input.organizationId,
        actor:
          input.actorUserId === undefined
            ? { kind: 'DEVICE', deviceId: created.id }
            : { kind: 'USER', userId: input.actorUserId, deviceId: created.id },
        deviceId: created.id,
        occurredAt: now,
        ...(input.clientAddress === undefined ? {} : { clientAddress: input.clientAddress }),
      });
    }

    return toView(created);
  }

  /**
   * Classifies a stored installation row for a re-registration attempt.
   *
   * Order matters and is the same in both callers: the secret first (the wrong
   * credential is refused without revealing the device's state), then status.
   */
  private async classifyStored(
    tx: Prisma.TransactionClient,
    stored: DeviceRow,
    input: RegisterDeviceInput,
    now: Date,
    deal: { readonly updateMetadata: boolean },
  ): Promise<DeviceView> {
    if (!deviceSecretMatches(hashDeviceSecret(input.installationSecret), stored.installationSecretHash)) {
      this.securitySink.record({
        type: 'DEVICE_REGISTRATION_REFUSED',
        organizationId: input.organizationId,
        deviceId: stored.id,
        errorCode: ERROR_CODES.PERMISSION_DENIED,
      });
      throw new DomainError(
        ERROR_CODES.PERMISSION_DENIED,
        'the installation credential does not match the registration record for this device',
      );
    }

    if (stored.status !== 'ACTIVE') {
      // §12.5: a revoked device stops being usable, permanently. Re-presenting
      // the same installation after revocation — a stale client retry, or an
      // attacker probing — cannot resurrect it.
      this.securitySink.record({
        type: 'DEVICE_REGISTRATION_REFUSED',
        organizationId: input.organizationId,
        deviceId: stored.id,
        errorCode: ERROR_CODES.DEVICE_REVOKED,
      });
      throw new DomainError(ERROR_CODES.DEVICE_REVOKED, 'this device has been revoked');
    }

    if (!deal.updateMetadata) {
      return toView(stored);
    }

    // The metadata refresh runs in the same tenant transaction the
    // classification proved itself in: under forced RLS a host-level write
    // would be a silent no-op, not an update (§8.2).
    const updated = await tx.device.update({
      where: { id: stored.id },
      data: {
        lastSeenAt: now,
        lastAuthenticatedAt: now,
        ...(input.osVersion === undefined ? {} : { osVersion: input.osVersion }),
        ...(input.appVersion === undefined ? {} : { appVersion: input.appVersion }),
        ...(input.label === undefined ? {} : { label: input.label }),
      },
    });
    return toView(updated);
  }

  /**
   * Binds a verified device onto an existing, active session (§12.4, §38.16.2).
   *
   * The route is authenticated in the ordinary way (bearer guard, membership
   * match), so the binding decision runs against a verified principal and a
   * matched tenant — never from a request body. One transaction: the device row
   * is re-proven (visible under the tenant context, ACTIVE, secret digest
   * matching), and the caller's session gains its `device_id`.
   *
   * A session binds **at most one device**: re-binding the same device is
   * idempotent; naming a different device afterwards is refused as a
   * session/device mismatch rather than silently relinking (§38.16.2), because a
   * session that could hop devices would make per-device revocation advisory.
   *
   * The caller re-mints its access token afterwards (`AuthService.
   * mintAccessTokenForSession`), so the client's next token carries the `did`
   * claim without any second registration round.
   */
  async bindSession(
    input: {
      readonly organizationId: string;
      readonly deviceId: string;
      readonly sessionId: string;
      readonly sessionUserId: string;
      readonly installationSecret: string;
    },
    now: Date = new Date(),
  ): Promise<void> {
    return withTenantTransaction(this.host, input.organizationId, async (tx) => {
      const device = await tx.device.findUnique({ where: { id: input.deviceId } });
      if (device === null) {
        // Invisible or nonexistent: one answer either way, no existence leak
        // (§9.2). A foreign tenant's device is never even seen here.
        throw new DomainError(ERROR_CODES.NOT_FOUND, 'no such device in this organization');
      }

      if (device.status !== 'ACTIVE') {
        this.securitySink.record({
          type: 'DEVICE_REGISTRATION_REFUSED',
          organizationId: device.organizationId,
          deviceId: device.id,
          errorCode: ERROR_CODES.DEVICE_REVOKED,
        });
        throw new DomainError(ERROR_CODES.DEVICE_REVOKED, 'this device has been revoked');
      }

      if (!deviceSecretMatches(hashDeviceSecret(input.installationSecret), device.installationSecretHash)) {
        this.securitySink.record({
          type: 'DEVICE_REGISTRATION_REFUSED',
          organizationId: device.organizationId,
          deviceId: device.id,
          errorCode: ERROR_CODES.PERMISSION_DENIED,
        });
        throw new DomainError(
          ERROR_CODES.PERMISSION_DENIED,
          'the installation credential does not match the registration record for this device',
        );
      }

      const session = await tx.session.findUnique({
        where: { id: input.sessionId },
        select: { userId: true, deviceId: true, revokedAt: true },
      });
      if (session === null || session.revokedAt !== null) {
        throw new DomainError(ERROR_CODES.UNAUTHENTICATED, 'the session is not active');
      }
      if (session.userId !== input.sessionUserId) {
        // A programming error the transaction refuses: the binding would not be
        // the principal's session. Fail closed rather than relink.
        throw new DomainError(ERROR_CODES.UNAUTHENTICATED, 'the session is not active');
      }
      if (session.deviceId !== null && session.deviceId !== device.id) {
        this.securitySink.record({
          type: 'DEVICE_REGISTRATION_REFUSED',
          organizationId: device.organizationId,
          deviceId: device.id,
          errorCode: ERROR_CODES.PERMISSION_DENIED,
        });
        throw new DomainError(ERROR_CODES.PERMISSION_DENIED, 'the session is already bound to a different device');
      }

      await tx.session.update({
        where: { id: input.sessionId },
        data: { deviceId: device.id },
      });
      if (session.deviceId !== device.id) {
        // First binding of this session: the device's authentication clock moves.
        await tx.device.update({
          where: { id: device.id },
          data: { lastSeenAt: now, lastAuthenticatedAt: now },
        });
      }
    });
  }

  /**
   * The owner-visible device list (§12.4): tenant-scoped, deterministically
   * ordered, never carrying the secret digest.
   */
  async list(organizationId: string): Promise<readonly DeviceView[]> {
    return withTenantTransaction(this.host, organizationId, async (tx) => {
      const rows = await tx.device.findMany({ orderBy: [{ registeredAt: 'asc' }, { id: 'asc' }] });
      return rows.map((row) => toView(row));
    });
  }

  /**
   * Revokes a device (§12.4, §12.5) — the §40.6 key acceptance.
   *
   * One transaction: the device row becomes `REVOKED` with its revoke
   * timestamp, and every session family bound to it is revoked with the
   * `DEVICE_REVOKED` reason. Refresh therefore dies immediately; live access
   * tokens expire within the §10.3 TTL; the device-bound sync boundary re-reads
   * the live status and refuses the next batch or page outright.
   *
   * Idempotent with the same answer either way (the §10.3 logout discipline).
   * A device of another organization is invisible under the tenant context and
   * answers NOT_FOUND like a nonexistent id — no cross-tenant existence signal
   * (ADR-029).
   */
  async revoke(
    organizationId: string,
    deviceId: string,
    input: { readonly actorUserId: string; readonly clientAddress?: string },
    now: Date = new Date(),
  ): Promise<void> {
    return withTenantTransaction(this.host, organizationId, async (tx) => {
      const device = await tx.device.findUnique({ where: { id: deviceId } });
      if (device === null) {
        throw new DomainError(ERROR_CODES.NOT_FOUND, 'no such device in this organization');
      }

      if (device.status === 'ACTIVE') {
        await tx.device.update({
          where: { id: device.id },
          data: { status: 'REVOKED', revokedAt: now },
        });
        await tx.session.updateMany({
          where: { deviceId: device.id, revokedAt: null },
          data: { revokedAt: now, revokedReason: 'DEVICE_REVOKED' },
        });
        // M2-S6: the revocation is a class-A event pair inside the one
        // transaction — the §32.3 security row and the §32.2 business row
        // ("Device revoked: device id, label, actor") commit with the state
        // change or not at all. Without the transactional writer, the
        // earlier class-B sink record stands, as before.
        if (this.audit === undefined) {
          this.securitySink.record({
            type: 'DEVICE_REVOKED',
            userId: input.actorUserId,
            organizationId: device.organizationId,
            deviceId: device.id,
            ...(input.clientAddress === undefined ? {} : { clientAddress: input.clientAddress }),
          });
        } else {
          await this.audit.appendSecurityEvent(tx, {
            eventType: 'DEVICE_REVOKED',
            organizationId: device.organizationId,
            actor: { kind: 'USER', userId: input.actorUserId, deviceId: device.id },
            deviceId: device.id,
            occurredAt: now,
            ...(input.clientAddress === undefined ? {} : { clientAddress: input.clientAddress }),
          });
          await this.audit.appendAuditEvent(tx, {
            eventType: 'DEVICE_REVOKED',
            organizationId: device.organizationId,
            actor: { kind: 'USER', userId: input.actorUserId, deviceId: device.id },
            occurredAt: now,
            targetType: 'DEVICE',
            targetId: device.id,
            documentRef: `device:${device.id}`,
            payload: { label: device.label },
          });
        }
        this.logger?.info(
          {
            component: 'devices',
            deviceId: device.id,
            organizationId: device.organizationId,
            actorUserId: input.actorUserId,
          },
          'device revoked: bound session families were revoked in the same transaction',
        );
      }
      // Already revoked: the same 204 either way, no second event, no oracle
      // about how the device reached its state.
    });
  }

  /**
   * §12.5: records the push metadata of a completed batch. Best-effort by
   * design — the metadata is owner-console diagnostic (§38.31.1), never an
   * authorization input, so a failure to record it is logged and swallowed
   * rather than turning an accepted batch into a client-facing error.
   */
  async recordPushMetadata(context: SyncMetadataInput, now: Date = new Date()): Promise<void> {
    await this.recordSyncMetadata(context, 'push', now);
  }

  /** §12.5: the pull half — `last_pull_at` / `last_sync_at` / `last_seen_at`. */
  async recordPullMetadata(context: SyncMetadataInput, now: Date = new Date()): Promise<void> {
    await this.recordSyncMetadata(context, 'pull', now);
  }

  private async recordSyncMetadata(context: SyncMetadataInput, direction: 'push' | 'pull', now: Date): Promise<void> {
    try {
      await withTenantTransaction(this.host, context.organizationId, async (tx) => {
        await tx.device.updateMany({
          where: { id: context.deviceId },
          data: {
            lastSeenAt: now,
            // §12.4: the write is once per completed batch or page, never per
            // mutation, so the amplification is bounded by the transport.
            lastAuthenticatedAt: now,
            lastSyncAt: now,
            ...(direction === 'push' ? { lastPushAt: now } : { lastPullAt: now }),
            ...(context.clientSchemaVersion === undefined ? {} : { clientSchemaVersion: context.clientSchemaVersion }),
            ...(context.clientAppVersion === undefined ? {} : { clientAppVersion: context.clientAppVersion }),
          },
        });
      });
    } catch (error) {
      this.logger?.warn(
        {
          component: 'devices',
          deviceId: context.deviceId,
          direction,
          reason: error instanceof Error ? error.name : 'unknown',
        },
        'device sync metadata could not be recorded (diagnostic only; the sync outcome stands)',
      );
    }
  }
}

/** The wire-facing projection of a device row; the secret digest never travels. */
function toView(row: DeviceRow): DeviceView {
  return {
    deviceId: row.id,
    organizationId: row.organizationId,
    label: row.label,
    platform: row.platform as DevicePlatform,
    ...(row.osVersion === null ? {} : { osVersion: row.osVersion }),
    ...(row.appVersion === null ? {} : { appVersion: row.appVersion }),
    status: row.status as DeviceStatus,
    registeredAt: row.registeredAt,
    lastSeenAt: row.lastSeenAt,
    lastAuthenticatedAt: row.lastAuthenticatedAt,
    ...(row.revokedAt === null ? {} : { revokedAt: row.revokedAt }),
    ...(row.lastPushAt === null ? {} : { lastPushAt: row.lastPushAt }),
    ...(row.lastPullAt === null ? {} : { lastPullAt: row.lastPullAt }),
    ...(row.lastSyncAt === null ? {} : { lastSyncAt: row.lastSyncAt }),
    ...(row.clientSchemaVersion === null ? {} : { clientSchemaVersion: row.clientSchemaVersion }),
    ...(row.clientAppVersion === null ? {} : { clientAppVersion: row.clientAppVersion }),
  };
}

/** Prisma's P2002: a unique constraint was violated. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'P2002'
  );
}
