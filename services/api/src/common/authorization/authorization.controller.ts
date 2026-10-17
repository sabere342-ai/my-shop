/**
 * The authorization routes (Master Plan §40.6 M2-S3; §9.3, §11, §38.16.3).
 *
 * Five organization-scoped handlers, each behind `JwtAuthGuard` (a verified bearer
 * principal) and `AuthorizationGuard` (the route `organizationId` must be in the
 * token's membership set). The handlers are thin: resolution, seeding, role edits,
 * override assignment, and snapshot minting live in `AuthorizationService` and
 * `AuthorizationSnapshotService`; the controller declares the wire shape so the
 * OpenAPI document and every generated client type come from the same declaration
 * the handler uses (§7.1, ADR-001).
 *
 * Tenant scope is never read from a body: `organizationId` is a route parameter,
 * checked against the signed token, and passed to the service (§9.3).
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { AuthorizationGuard, AuthorizedContext, OrganizationId, RequirePermission } from './authorization.guard';
import {
  AUTHORIZATION_BASE_PATH,
  AUTHORIZATION_ME_PATH,
  AUTHORIZATION_MEMBERSHIP_PATH,
  AUTHORIZATION_ROLE_PERMISSIONS_PATH,
  AUTHORIZATION_ROLES_PATH,
  AUTHORIZATION_SNAPSHOT_PATH,
  AssignMembershipAuthorizationRequest,
  AuthorizationMeResponse,
  ReplaceRolePermissionsRequest,
  RoleResponse,
  RolesListResponse,
  SnapshotResponse,
} from './authorization.contract';
import { AUTHORIZATION_SNAPSHOT_SERVICE } from './authorization.tokens';
import {
  AuthorizationService,
  type EffectiveAuthorization,
  type RoleView,
} from '../tenancy/authorization/authorization.service';
import {
  AUTHORIZATION_SNAPSHOT_TTL_SECONDS,
  type AuthorizationSnapshotService,
} from '../tenancy/authorization/authorization-snapshot';
import type { AuthenticatedPrincipal } from '../identity/auth.service';

/** RFC 7807 responses the filter can produce for these routes, as a schema `$ref`. */
const PROBLEM_CONTENT = {
  'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDocument' } },
} as const;

function mapRoleView(view: RoleView): RoleResponse {
  return {
    id: view.id,
    key: view.key,
    name: view.name,
    isSystem: view.isSystem,
    isOwner: view.isOwner,
    permissions: [...view.permissions],
  };
}

function mapEffective(auth: EffectiveAuthorization): AuthorizationMeResponse {
  return {
    organizationId: auth.organizationId,
    userId: auth.userId,
    isOwner: auth.isOwner,
    roleId: auth.role?.id ?? null,
    roleKey: auth.role?.key ?? null,
    permissionsVersion: auth.permissionsVersion,
    permissions: [...auth.permissions],
  };
}

@ApiTags('Authorization')
@ApiBearerAuth()
@ApiParam({
  name: 'organizationId',
  type: 'string',
  format: 'uuid',
  description: 'The organization the request is scoped to.',
})
@UseGuards(JwtAuthGuard, AuthorizationGuard)
@Controller(AUTHORIZATION_BASE_PATH)
export class AuthorizationController {
  constructor(
    private readonly authz: AuthorizationService,
    @Inject(AUTHORIZATION_SNAPSHOT_SERVICE) private readonly snapshotService: AuthorizationSnapshotService,
  ) {}

  @Get(AUTHORIZATION_ME_PATH)
  @ApiOperation({
    summary: "The caller's effective permissions in this organization.",
    description:
      "Resolves the membership's role grants, then its allow/deny overrides, then the structural restrictions " +
      '(the Owner holds every permission; a non-owner never holds an owner-exclusive permission). A missing ' +
      'membership is refused ORGANIZATION_FORBIDDEN (§9.3, §11.2, §11.4).',
  })
  @ApiResponse({ status: HttpStatus.OK, type: AuthorizationMeResponse, description: 'The effective permission set.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED.', content: PROBLEM_CONTENT })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'ORGANIZATION_FORBIDDEN: no membership in this organization.',
    content: PROBLEM_CONTENT,
  })
  async me(
    @OrganizationId() organizationId: string,
    @AuthorizedContext() principal: AuthenticatedPrincipal,
  ): Promise<AuthorizationMeResponse> {
    return mapEffective(await this.authz.resolveForMembership(organizationId, principal.userId));
  }

  @Post(AUTHORIZATION_SNAPSHOT_PATH)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mint a signed authorization snapshot for the caller.',
    description:
      'Mints an RS256 JWS carrying the effective permission set, the permissions_version, and the catalog ' +
      'version, with a 72-hour expiry. It reuses the identity key material and a distinct audience; no device ' +
      'identifier is bound here (that is M2-S5). The snapshot is never logged.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: SnapshotResponse, description: 'The signed snapshot and its expiry.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED.', content: PROBLEM_CONTENT })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'ORGANIZATION_FORBIDDEN: no membership in this organization.',
    content: PROBLEM_CONTENT,
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: 'SERVICE_UNAVAILABLE: identity key material is not configured; the surface fails closed.',
    content: PROBLEM_CONTENT,
  })
  async mintSnapshot(
    @OrganizationId() organizationId: string,
    @AuthorizedContext() principal: AuthenticatedPrincipal,
  ): Promise<SnapshotResponse> {
    const auth = await this.authz.resolveForMembership(organizationId, principal.userId);
    const now = new Date();
    const snapshot = this.snapshotService.mint(
      {
        userId: auth.userId,
        organizationId: auth.organizationId,
        roleId: auth.role?.id ?? null,
        roleKey: auth.role?.key ?? null,
        isOwner: auth.isOwner,
        permissions: auth.permissions,
        permissionsVersion: auth.permissionsVersion,
        issuedAtSeconds: Math.floor(now.getTime() / 1000),
      },
      now,
    );
    return {
      snapshot,
      expiresAt: new Date(now.getTime() + AUTHORIZATION_SNAPSHOT_TTL_SECONDS * 1000).toISOString(),
    };
  }

  @RequirePermission('roles.manage')
  @Get(AUTHORIZATION_ROLES_PATH)
  @ApiOperation({
    summary: "List the organization's roles and their grants.",
    description: 'Requires `roles.manage`. The six seeded presets are materialized lazily on first touch (§11.3).',
  })
  @ApiResponse({ status: HttpStatus.OK, type: RolesListResponse, description: 'The roles, in key order.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED.', content: PROBLEM_CONTENT })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'ORGANIZATION_FORBIDDEN.', content: PROBLEM_CONTENT })
  async listRoles(@OrganizationId() organizationId: string): Promise<RolesListResponse> {
    const roles = await this.authz.listRoles(organizationId);
    return { roles: roles.map(mapRoleView) };
  }

  @RequirePermission('roles.manage')
  @Put(AUTHORIZATION_ROLE_PERMISSIONS_PATH)
  @ApiOperation({
    summary: "Replace a role's grants wholesale.",
    description:
      'Requires `roles.manage`. The Owner role is not editable; an unknown id and an owner-exclusive id for a ' +
      'non-owner role are refused VALIDATION_FAILED. Every non-owner holder is invalidated in the same ' +
      'transaction (§11.2, §11.4).',
  })
  @ApiParam({ name: 'roleId', type: 'string', format: 'uuid', description: 'The role to edit.' })
  @ApiResponse({ status: HttpStatus.OK, type: RoleResponse, description: 'The role after the replacement.' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'VALIDATION_FAILED.', content: PROBLEM_CONTENT })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED.', content: PROBLEM_CONTENT })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'ORGANIZATION_FORBIDDEN.', content: PROBLEM_CONTENT })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'NOT_FOUND: no such role.', content: PROBLEM_CONTENT })
  async replaceRolePermissions(
    @OrganizationId() organizationId: string,
    @Param('roleId') roleId: string,
    @Body() body: ReplaceRolePermissionsRequest,
  ): Promise<RoleResponse> {
    return mapRoleView(
      await this.authz.replaceRolePermissions({
        organizationId,
        roleId,
        permissionIds: body.permissions.map((permission) => permission.permissionId),
      }),
    );
  }

  @RequirePermission('users.manage')
  @Put(AUTHORIZATION_MEMBERSHIP_PATH)
  @ApiOperation({
    summary: "Assign a membership's role and per-user overrides.",
    description:
      'Requires `users.manage`. The owner membership is refused (it holds every permission by structure); a ' +
      'contradiction (an id in both allow and deny) and an unknown id are refused. The user is invalidated in ' +
      'the same transaction (§11.4, §10.3).',
  })
  @ApiParam({ name: 'userId', type: 'string', format: 'uuid', description: 'The membership user to update.' })
  @ApiResponse({ status: HttpStatus.OK, type: AuthorizationMeResponse, description: 'The effective authorization.' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'VALIDATION_FAILED.', content: PROBLEM_CONTENT })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED.', content: PROBLEM_CONTENT })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'ORGANIZATION_FORBIDDEN.', content: PROBLEM_CONTENT })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'NOT_FOUND: no such role.', content: PROBLEM_CONTENT })
  async assignMembershipAuthorization(
    @OrganizationId() organizationId: string,
    @Param('userId') userId: string,
    @Body() body: AssignMembershipAuthorizationRequest,
  ): Promise<AuthorizationMeResponse> {
    return mapEffective(
      await this.authz.assignMembershipAuthorization({
        organizationId,
        userId,
        roleId: body.roleId,
        allow: body.allow.map((override) => override.permissionId),
        deny: body.deny.map((override) => override.permissionId),
      }),
    );
  }
}
