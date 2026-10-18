/**
 * The device wire contract (Master Plan §12, §12.5, §40.6 M2-S5; §34.1).
 *
 * Four routes under the versioned `/api/v1` namespace, all organization-scoped
 * by the route parameter the authorization guard validates against the access
 * token's membership claim — never by a request body field (§9.3):
 *
 * - `POST /api/v1/organizations/:organizationId/devices`        — register this
 *   installation (any member of the organization; §12.1 registration happens on
 *   first successful authentication).
 * - `GET  /api/v1/organizations/:organizationId/devices`        — the
 *   owner-visible device list (§12.4; requires `devices.view`).
 * - `POST /api/v1/organizations/:organizationId/devices/:deviceId/bind-session`
 *   — bind the caller's current session to a verified device (§12.4); any
 *   member, with the keystore credential proving the installation.
 * - `POST /api/v1/organizations/:organizationId/devices/:deviceId/revoke` —
 *   revoke a device; `devices.revoke`. Revocation revokes the device's session
 *   families in the same database transaction and kills sync at the device-bound
 *   sync boundary (§12.5).
 *
 * The request/response classes are the shapes the handlers return, so the
 * generated OpenAPI document and the runtime response cannot drift (§7.1,
 * ADR-001). No response ever carries the installation credential or its stored
 * digest: the credential exists only in the client keystore, and the digest only
 * in the devices row (§13.6).
 */

import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** The shortest accepted installation secret (192 bits at the base64url ceiling). */
export const MIN_DEVICE_SECRET_LENGTH = 32;

/** The longest installation secret this endpoint will even look at. */
export const MAX_DEVICE_SECRET_LENGTH = 512;

/** §12.1 `platform`: the two V1 targets. A new platform is a schema decision. */
export const DEVICE_PLATFORMS = ['windows', 'android'] as const;

export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

/** The label ceiling the database CHECK also enforces. */
export const MAX_DEVICE_LABEL_LENGTH = 100;

/** `POST …/devices` request: this installation's keystore-backed identity. */
export class RegisterDeviceRequest {
  @ApiProperty({
    description:
      'The stable per-installation identifier from the platform keystore (§12.5 `installation_id`). ' +
      'Unique per organization: re-presenting the same pair is an idempotent re-registration, never a duplicate.',
    format: 'uuid',
  })
  @IsUUID()
  readonly installationId!: string;

  /**
   * The keystore-held installation credential. The server stores only its
   * SHA-256 digest (§12.3); this value is never persisted in a reversible form
   * and never logged. It is the proof that the caller of an idempotent
   * re-registration is the installation that registered the handle — without
   * it, any member could adopt another member's device identity.
   */
  @ApiProperty({
    description:
      'The installation credential from the platform keystore (§12.3). Stored server-side only as a SHA-256 digest.',
    minLength: MIN_DEVICE_SECRET_LENGTH,
    maxLength: MAX_DEVICE_SECRET_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(MIN_DEVICE_SECRET_LENGTH)
  @MaxLength(MAX_DEVICE_SECRET_LENGTH)
  readonly installationSecret!: string;

  @ApiProperty({ description: 'The platform this installation runs on (§12.1).', enum: [...DEVICE_PLATFORMS] })
  @IsIn([...DEVICE_PLATFORMS])
  readonly platform!: DevicePlatform;

  @ApiProperty({ description: 'The operating system version, as reported by the client.', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  readonly osVersion?: string;

  @ApiProperty({ description: 'The client app version (§12.5 `client_app_version`).', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  readonly appVersion?: string;

  @ApiProperty({
    description:
      'The user-editable device label (§12.1). Defaults to the platform name; the owner sees it in the device list.',
    required: false,
    maxLength: MAX_DEVICE_LABEL_LENGTH,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_DEVICE_LABEL_LENGTH)
  readonly label?: string;
}

/**
 * `POST …/devices/:deviceId/bind-session` request (§12.4, §38.16.2).
 *
 * The body carries only the keystore credential that proves this installation
 * is the one whose handle names the path's device id — the same discipline
 * re-registration applies. Everything else is verified material: the principal
 * (bearer guard), the tenant (route parameter vs. membership claim), the device
 * row (RLS-scoped, live status), and the session (the verified principal's
 * own). A session binds at most one device.
 */
export class BindSessionRequest {
  @ApiProperty({
    description:
      'The installation credential from the platform keystore (§12.3). Stored server-side only as a SHA-256 digest.',
    minLength: MIN_DEVICE_SECRET_LENGTH,
    maxLength: MAX_DEVICE_SECRET_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(MIN_DEVICE_SECRET_LENGTH)
  @MaxLength(MAX_DEVICE_SECRET_LENGTH)
  readonly installationSecret!: string;
}

/**
 * `POST …/devices/:deviceId/bind-session` response: a fresh access token minted
 * for the now device-bound session, so the client's next request carries the
 * `did` claim without a second round trip. No refresh token is rotated or
 * re-issued by binding — the family keeps its chain.
 */
export class BindSessionResponse {
  @ApiProperty({ description: 'The fresh RS256 bearer access token, carrying the `did` device claim (§12.4).' })
  readonly accessToken!: string;

  @ApiProperty({ enum: ['Bearer'], description: 'The scheme to send the access token with.' })
  readonly tokenType!: 'Bearer';

  @ApiProperty({ type: 'integer', description: 'The access token lifetime in seconds.' })
  readonly expiresIn!: number;
}

/** `POST …/devices` and `GET …/devices` response shape. */
export class DeviceResponse {
  @ApiProperty({ format: 'uuid', description: 'The server-issued device identity (§12.3).' })
  readonly deviceId!: string;

  @ApiProperty({ format: 'uuid', description: 'The tenant this device belongs to.' })
  readonly organizationId!: string;

  @ApiProperty({ description: 'The user-editable label (§12.1).' })
  readonly label!: string;

  @ApiProperty({ description: 'The platform (§12.1).', enum: [...DEVICE_PLATFORMS] })
  readonly platform!: DevicePlatform;

  @ApiProperty({ required: false, description: 'The operating system version reported at registration or sync.' })
  readonly osVersion?: string;

  @ApiProperty({ required: false, description: 'The client app version (§12.5 `client_app_version`).' })
  readonly appVersion?: string;

  @ApiProperty({ description: 'The §12.2 trust state: ACTIVE or REVOKED — exactly two states in V1.' })
  readonly status!: 'ACTIVE' | 'REVOKED';

  @ApiProperty({ format: 'date-time', description: 'When the device was registered (§12.1 `firstSeenAt`).' })
  readonly registeredAt!: string;

  @ApiProperty({
    format: 'date-time',
    description: 'When the device was last seen by the server (§12.4 `lastSeenAt`).',
  })
  readonly lastSeenAt!: string;

  @ApiProperty({
    format: 'date-time',
    description: 'When the device last completed a successful authentication or sync (§12.1 `lastAuthenticatedAt`).',
  })
  readonly lastAuthenticatedAt!: string;

  @ApiProperty({ format: 'date-time', required: false, description: 'When the device was revoked (§12.5).' })
  readonly revokedAt?: string;

  @ApiProperty({
    format: 'date-time',
    required: false,
    description: '§12.5: the last successful push batch.',
  })
  readonly lastPushAt?: string;

  @ApiProperty({
    format: 'date-time',
    required: false,
    description: '§12.5: the last successful pull page.',
  })
  readonly lastPullAt?: string;

  @ApiProperty({
    format: 'date-time',
    required: false,
    description: '§12.5: the last successful sync in either direction.',
  })
  readonly lastSyncAt?: string;

  @ApiProperty({
    type: 'integer',
    required: false,
    description: '§12.5: the client `local_schema_version` reported at the last sync.',
  })
  readonly clientSchemaVersion?: number;

  @ApiProperty({ required: false, description: '§12.5: the client app version reported at the last sync.' })
  readonly clientAppVersion?: string;
}

/** Path constants, re-exported so a routing test can assert them without importing the file. */
export const DEVICES_PATH = 'api/v1/organizations/:organizationId/devices';
export const DEVICE_BIND_SESSION_PATH = 'api/v1/organizations/:organizationId/devices/:deviceId/bind-session';
export const DEVICE_REVOKE_PATH = 'api/v1/organizations/:organizationId/devices/:deviceId/revoke';
