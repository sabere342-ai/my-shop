/**
 * The organization-scoped authorization guard (§9.3, §11 / §40.6 M2-S3).
 *
 * It runs after `JwtAuthGuard`, which has already verified the bearer access token
 * and attached the trusted principal (whose `organizations` came from server state
 * at mint time). The guard does three things, each of which is a way the request
 * could otherwise escape tenant or permission scope:
 *
 * 1. Require an authenticated principal — reading it without the bearer guard is a
 *    programming error, not a client error, so it refuses `UNAUTHENTICATED`.
 * 2. Require the route `organizationId` to be in the principal's membership set
 *    (§9.3): a body never names a tenant, and a token for one organization cannot be
 *    replayed against another. A mismatch is `ORGANIZATION_FORBIDDEN` and records a
 *    security event through the identity sink (M2-S6 replaces one binding).
 * 3. When the handler declares `@RequirePermission(id)`, resolve the caller's
 *    **effective** permissions and refuse `PERMISSION_DENIED` when the id is absent.
 *    Resolution is the same rule every read path uses (role grants, then overrides,
 *    then structural restrictions), so the guard and the service cannot disagree.
 *
 * The guard never inspects a device id (device binding is M2-S5) and never trusts a
 * caller-supplied permission or role.
 */

import {
  Inject,
  Injectable,
  SetMetadata,
  UseGuards,
  applyDecorators,
  createParamDecorator,
  type CanActivate,
  type CustomDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { DomainError } from '../errors/domain.error';
import { ERROR_CODES } from '../errors/problem';
import { AuthenticatedRequest, JwtAuthGuard } from '../identity/jwt-auth.guard';
import { SECURITY_EVENT_SINK } from '../identity/identity.module';
import type { SecurityEventSink } from '../identity/security-event.sink';
import type { AuthenticatedPrincipal } from '../identity/auth.service';
import { AuthorizationService } from '../tenancy/authorization/authorization.service';
import { toPermissionSet } from '../tenancy/authorization/effective-permissions';

/** The route parameter every organization-scoped route carries. */
export const ORGANIZATION_ID_PARAM = 'organizationId';

/** The metadata key `@RequirePermission` writes and the guard reads. */
export const PERMISSION_METADATA_KEY = 'authorization:required-permission';

/** A request the authorization guard has admitted, with the resolved tenant. */
export interface AuthenticatedWithOrgRequest extends AuthenticatedRequest {
  organizationId?: string;
}

/** The verified principal, or a programming error when the bearer guard did not run. */
export const AuthorizedContext = createParamDecorator(
  (_: unknown, context: ExecutionContext): AuthenticatedPrincipal => {
    const request = context.switchToHttp().getRequest<AuthenticatedWithOrgRequest>();
    const principal = request.authPrincipal;
    if (principal === undefined) {
      throw new DomainError(ERROR_CODES.UNAUTHENTICATED, 'request is not authenticated');
    }
    return principal;
  },
);

/** The validated `organizationId` route parameter. */
export const OrganizationId = createParamDecorator((_: unknown, context: ExecutionContext): string => {
  const request = context.switchToHttp().getRequest<AuthenticatedWithOrgRequest>();
  const organizationId = request.params?.[ORGANIZATION_ID_PARAM];
  if (typeof organizationId !== 'string' || organizationId.length === 0) {
    throw new DomainError(ERROR_CODES.VALIDATION_FAILED, 'organizationId route parameter is required');
  }
  return organizationId;
});

/** Declare the permission a handler requires; enforced by `AuthorizationGuard`. */
export const RequirePermission = (permission: string): CustomDecorator<string> =>
  SetMetadata(PERMISSION_METADATA_KEY, permission);

/**
 * `@Authorize(permission?)` — the composite route decorator.
 *
 * Applies the bearer guard *before* the authorization guard (order matters: the
 * principal must exist before the organization and permission checks) and stamps
 * the one permission the handler requires, or none when omitted. The guard reads
 * exactly one declared permission (`getAllAndOverride` over a single metadata key),
 * so the decorator accepts exactly one and never a list whose later entries would
 * silently overwrite earlier ones.
 */
export function Authorize(permission?: string): MethodDecorator & ClassDecorator {
  const decorators: Array<ClassDecorator | MethodDecorator | PropertyDecorator> = [
    UseGuards(JwtAuthGuard, AuthorizationGuard),
    ...(permission === undefined ? [] : [RequirePermission(permission)]),
  ];
  return applyDecorators(...decorators);
}

@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authz: AuthorizationService,
    @Inject(SECURITY_EVENT_SINK) private readonly securitySink: SecurityEventSink,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedWithOrgRequest>();
    const principal = request.authPrincipal;
    if (principal === undefined) {
      throw new DomainError(ERROR_CODES.UNAUTHENTICATED, 'request is not authenticated');
    }

    const organizationId = request.params?.[ORGANIZATION_ID_PARAM];
    if (typeof organizationId !== 'string' || organizationId.length === 0) {
      throw new DomainError(ERROR_CODES.VALIDATION_FAILED, 'organizationId route parameter is required');
    }

    if (!principal.organizations.includes(organizationId)) {
      this.recordRefusal(principal, request.ip, ERROR_CODES.ORGANIZATION_FORBIDDEN);
      throw new DomainError(ERROR_CODES.ORGANIZATION_FORBIDDEN, 'no such membership in this organization');
    }

    const required = this.reflector.getAllAndOverride<string | undefined>(PERMISSION_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (required !== undefined) {
      // §11.4: resolve the same effective set every read path uses; the guard and the
      // service therefore cannot disagree about whether a permission is held.
      const effective = await this.authz.resolveForMembership(organizationId, principal.userId);
      if (!toPermissionSet(effective.permissions).has(required)) {
        this.recordRefusal(principal, request.ip, ERROR_CODES.PERMISSION_DENIED);
        throw new DomainError(ERROR_CODES.PERMISSION_DENIED, 'the caller does not hold the required permission');
      }
    }

    request.organizationId = organizationId;
    return true;
  }

  private recordRefusal(
    principal: AuthenticatedPrincipal,
    clientAddress: string | undefined,
    errorCode: typeof ERROR_CODES.ORGANIZATION_FORBIDDEN | typeof ERROR_CODES.PERMISSION_DENIED,
  ): void {
    this.securitySink.record({
      type: 'ACCESS_TOKEN_REJECTED',
      userId: principal.userId,
      errorCode,
      ...(typeof clientAddress === 'string' ? { clientAddress } : {}),
    });
  }
}
