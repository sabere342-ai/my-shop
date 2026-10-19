/**
 * The device routes (Master Plan §12, §12.4, §40.6 M2-S5; §34.1).
 *
 * Four thin handlers. Every decision — idempotency classification, credential
 * verification, two-state enforcement, the binding and its re-mint, the atomic
 * revocation — lives in `DeviceService` or the `AuthService` the devices module
 * composes; the controller declares the wire shape so the OpenAPI document and
 * every generated client type come from the same declaration the handler uses
 * (§7.1, ADR-001).
 *
 * Guard order matters (§9.3): `@Authorize` first runs the bearer guard (a
 * verified principal), then the organization check (the route's tenant is in
 * the membership claim), then the declared permission. No handler reads an
 * organization id, a device id, or a caller identity from a request body — the
 * tenant comes from the matched route parameter, the device id from the matched
 * route parameter, the actor from the verified principal.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';

import { Authorize, OrganizationId } from '../authorization/authorization.guard';
import { VerifiedPrincipal } from '../identity/jwt-auth.guard';
import { AuthService, type AuthenticatedPrincipal } from '../identity/auth.service';
import {
  DEVICE_BIND_SESSION_PATH,
  DEVICE_REVOKE_PATH,
  DEVICES_PATH,
  BindSessionRequest,
  BindSessionResponse,
  DeviceResponse,
  RegisterDeviceRequest,
} from './device.contract';
import { DeviceService, type DeviceView } from './device.service';

@Controller('api/v1/organizations/:organizationId/devices')
export class DeviceController {
  constructor(
    private readonly devices: DeviceService,
    private readonly auth: AuthService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @Authorize()
  @ApiOperation({
    summary: 'Register this installation on first successful authentication.',
    description:
      'Idempotent per organization and installation id: the same keystore pair re-verifies against the stored ' +
      'digest and refreshes the reported metadata. A revoked installation is never re-activated (§12.2); ' +
      're-installation enrolls a new installation id. A wrong credential is refused without revealing the device state.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: DeviceResponse, description: 'The registration record.' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'PERMISSION_DENIED or DEVICE_REVOKED.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED.' })
  async register(
    @Body() body: RegisterDeviceRequest,
    @OrganizationId() organizationId: string,
    @VerifiedPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<DeviceResponse> {
    const view = await this.devices.register(
      {
        organizationId,
        installationId: body.installationId,
        installationSecret: body.installationSecret,
        platform: body.platform,
        ...(body.osVersion === undefined ? {} : { osVersion: body.osVersion }),
        ...(body.appVersion === undefined ? {} : { appVersion: body.appVersion }),
        ...(body.label === undefined ? {} : { label: body.label }),
        // §32.6 (M2-S6): the durable registration event records the verified
        // issuer — from the guard's principal, never a body field.
        actorUserId: principal.userId,
      },
      new Date(),
    );
    return toResponse(view);
  }

  @Get()
  @Authorize('devices.view')
  @ApiOperation({
    summary: 'The owner-visible device list.',
    description:
      'Requires `devices.view`. Lists every device registered in the organization — label, platform, versions, ' +
      'trust state, and the sync metadata the server maintains (§12.5). The installation credential and its ' +
      'stored digest are never part of any response.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: DeviceResponse, isArray: true, description: 'The device list.' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'PERMISSION_DENIED or ORGANIZATION_FORBIDDEN.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED.' })
  async list(@OrganizationId() organizationId: string): Promise<DeviceResponse[]> {
    const rows = await this.devices.list(organizationId);
    return rows.map((row) => toResponse(row));
  }

  @Post(':deviceId/bind-session')
  @HttpCode(HttpStatus.OK)
  @Authorize()
  @ApiOperation({
    summary: 'Bind the caller’s current session to this device.',
    description:
      'Any member, with the keystore credential proving this installation (§12.4). One transaction re-proves the ' +
      'device row (RLS-scoped, ACTIVE, digest matching), then writes the binding onto the verified principal’s own ' +
      'session and answers a fresh access token minted for it — the next request carries the `did` device claim, ' +
      'which the device-bound sync boundary requires (§38.16.2). A session binds at most one device: naming a ' +
      'different device afterwards is refused, never silently relinked. No refresh token is rotated by binding.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: BindSessionResponse,
    description: 'A fresh access token for the device-bound session.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'PERMISSION_DENIED (mismatched credential, re-bind) or DEVICE_REVOKED.',
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'NOT_FOUND — no such device in this organization.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED.' })
  async bindSession(
    @Param('deviceId') deviceId: string,
    @OrganizationId() organizationId: string,
    @Body() body: BindSessionRequest,
    @VerifiedPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<BindSessionResponse> {
    await this.devices.bindSession({
      organizationId,
      deviceId,
      sessionId: principal.sessionId,
      sessionUserId: principal.userId,
      installationSecret: body.installationSecret,
    });
    return this.auth.mintAccessTokenForSession(principal.sessionId);
  }

  @Post(':deviceId/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Authorize('devices.revoke')
  @ApiOperation({
    summary: 'Revoke a registered device.',
    description:
      'Requires `devices.revoke`. One transaction sets the device REVOKED and revokes every session family bound ' +
      'to it (§12.4): refresh dies immediately, the device-bound sync boundary refuses the next batch or page, ' +
      'and the queued mutations are quarantined for owner decision, never discarded (§12.5). Idempotent: revoking ' +
      'a revoked device answers 204 again.',
  })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'The device is revoked (or already was).' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'NOT_FOUND — no such device in this organization.' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'PERMISSION_DENIED or ORGANIZATION_FORBIDDEN.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED.' })
  async revoke(
    @Param('deviceId') deviceId: string,
    @OrganizationId() organizationId: string,
    @VerifiedPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<void> {
    await this.devices.revoke(organizationId, deviceId, { actorUserId: principal.userId }, new Date());
  }
}

/** The stable date-to-wire projection; absent timestamps are omitted, not null. */
function toResponse(view: DeviceView): DeviceResponse {
  return {
    deviceId: view.deviceId,
    organizationId: view.organizationId,
    label: view.label,
    platform: view.platform,
    ...(view.osVersion === undefined ? {} : { osVersion: view.osVersion }),
    ...(view.appVersion === undefined ? {} : { appVersion: view.appVersion }),
    status: view.status,
    registeredAt: view.registeredAt.toISOString(),
    lastSeenAt: view.lastSeenAt.toISOString(),
    lastAuthenticatedAt: view.lastAuthenticatedAt.toISOString(),
    ...(view.revokedAt === undefined ? {} : { revokedAt: view.revokedAt.toISOString() }),
    ...(view.lastPushAt === undefined ? {} : { lastPushAt: view.lastPushAt.toISOString() }),
    ...(view.lastPullAt === undefined ? {} : { lastPullAt: view.lastPullAt.toISOString() }),
    ...(view.lastSyncAt === undefined ? {} : { lastSyncAt: view.lastSyncAt.toISOString() }),
    ...(view.clientSchemaVersion === undefined ? {} : { clientSchemaVersion: view.clientSchemaVersion }),
    ...(view.clientAppVersion === undefined ? {} : { clientAppVersion: view.clientAppVersion }),
  };
}

/** Path constants, re-exported so a routing test can assert them without importing the file. */
export { DEVICE_BIND_SESSION_PATH, DEVICE_REVOKE_PATH, DEVICES_PATH };
