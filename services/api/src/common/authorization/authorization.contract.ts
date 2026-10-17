/**
 * The authorization API wire contract (§40.6 M2-S3, S-9).
 *
 * Five organization-scoped routes, mounted under
 * `/api/v1/organizations/:organizationId`:
 * - `GET  /authorization/me` — the current user's effective permissions for this org
 * - `POST /authorization/snapshot` — mint a signed authorization snapshot
 * - `GET  /roles` — list roles (`roles.manage`)
 * - `PUT  /roles/:roleId/permissions` — replace role grants (`roles.manage`)
 * - `PUT  /memberships/:userId/authorization` — assign role and overrides (`users.manage`)
 *
 * Organization id is always a route parameter and checked against the token's
 * membership set at the guard boundary (§9.3); no request body names a tenant.
 */

/** The controller base path: every authorization route is organization-scoped. */
export const AUTHORIZATION_BASE_PATH = 'api/v1/organizations/:organizationId';

import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export const PERMISSION_EFFECTS = ['ALLOW', 'DENY'] as const;
export type PermissionEffectWire = (typeof PERMISSION_EFFECTS)[number];

export class PermissionSetResponse {
  @ApiProperty({ type: 'integer', description: 'The permissions_version of the user at mint time.' })
  readonly permissionsVersion!: number;

  @ApiProperty({ isArray: true, type: String, description: 'Effective permission ids in catalog order.' })
  readonly permissions!: readonly string[];
}

export class AuthorizationMeResponse extends PermissionSetResponse {
  @ApiProperty({ format: 'uuid', description: 'The organization id.' })
  readonly organizationId!: string;

  @ApiProperty({ format: 'uuid', description: 'The user id.' })
  readonly userId!: string;

  @ApiProperty({ description: 'True when the membership is the organization owner.' })
  readonly isOwner!: boolean;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'The role id, or null if unclassified.' })
  readonly roleId!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'The role key, or null if unclassified.' })
  readonly roleKey!: string | null;
}

export class SnapshotResponse {
  @ApiProperty({ description: 'The signed authorization snapshot (JWS).' })
  readonly snapshot!: string;

  @ApiProperty({ format: 'date-time', description: 'When the snapshot expires.' })
  readonly expiresAt!: string;
}

export class RolePermissionAssignment {
  @ApiProperty({ description: 'A permission id to grant to the role.' })
  @IsString()
  @IsNotEmpty()
  readonly permissionId!: string;
}

export class ReplaceRolePermissionsRequest {
  @ApiProperty({ isArray: true, type: RolePermissionAssignment, description: 'The grant set to replace.' })
  @IsArray()
  readonly permissions!: readonly RolePermissionAssignment[];
}

export class RoleResponse {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty()
  readonly key!: string;

  @ApiProperty()
  readonly name!: string;

  @IsOptional()
  @ApiProperty({ required: false })
  readonly isSystem?: boolean;

  @IsOptional()
  @ApiProperty({ required: false })
  readonly isOwner?: boolean;

  @ApiProperty({ isArray: true, type: String })
  readonly permissions!: readonly string[];
}

export class RolesListResponse {
  @ApiProperty({ isArray: true, type: () => RoleResponse })
  readonly roles!: readonly RoleResponse[];
}

export class PermissionOverrideWire {
  @ApiProperty({ description: 'The permission id to override.' })
  @IsString()
  @IsNotEmpty()
  readonly permissionId!: string;

  @ApiProperty({ enum: PERMISSION_EFFECTS, description: 'ALLOW or DENY.' })
  @IsIn(PERMISSION_EFFECTS)
  readonly effect!: PermissionEffectWire;
}

export class AssignMembershipAuthorizationRequest {
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'The role id, or null to unclassify.' })
  @IsOptional()
  @IsUUID()
  readonly roleId!: string | null;

  @ApiProperty({ isArray: true, type: () => PermissionOverrideWire })
  @IsArray()
  readonly allow!: readonly PermissionOverrideWire[];

  @ApiProperty({ isArray: true, type: () => PermissionOverrideWire })
  @IsArray()
  readonly deny!: readonly PermissionOverrideWire[];
}

export const AUTHORIZATION_ME_PATH = 'authorization/me';
export const AUTHORIZATION_SNAPSHOT_PATH = 'authorization/snapshot';
export const AUTHORIZATION_ROLES_PATH = 'roles';
export const AUTHORIZATION_ROLE_PERMISSIONS_PATH = 'roles/:roleId/permissions';
export const AUTHORIZATION_MEMBERSHIP_PATH = 'memberships/:userId/authorization';

/** The absolute OpenAPI paths, for tests and clients. */
export const AUTHORIZATION_ME_ABSOLUTE = `/api/v1/organizations/{organizationId}/${AUTHORIZATION_ME_PATH}`;
export const AUTHORIZATION_SNAPSHOT_ABSOLUTE = `/api/v1/organizations/{organizationId}/${AUTHORIZATION_SNAPSHOT_PATH}`;
export const AUTHORIZATION_ROLES_ABSOLUTE = `/api/v1/organizations/{organizationId}/${AUTHORIZATION_ROLES_PATH}`;
export const AUTHORIZATION_ROLE_PERMISSIONS_ABSOLUTE = `/api/v1/organizations/{organizationId}/roles/{roleId}/permissions`;
export const AUTHORIZATION_MEMBERSHIP_ABSOLUTE = `/api/v1/organizations/{organizationId}/memberships/{userId}/authorization`;
