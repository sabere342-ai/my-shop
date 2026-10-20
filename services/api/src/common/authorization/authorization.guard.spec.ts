/**
 * Unit acceptance for the organization-scoped authorization guard (§9.3, §11,
 * §40.6 M2-S3; AC-15, AC-22, AC-23).
 *
 * The guard is a pure boundary that reads three things the request can lie about —
 * the principal, the route organization, and a handler's declared permission — and
 * turns each into a decision that must be fail-closed. Every property asserted here
 * is one of those refusals, and the reason each is a *unit* test rather than an HTTP
 * test is that the refusal has to hold even when no route wires it up: a declaration
 * typo, an unknown permission id, or a missing route parameter must never read as
 * "allow".
 *
 * The `Reflector` is the real Nest implementation and the metadata is written by the
 * production `@RequirePermission` / `@Authorize` decorators, so the suite also proves
 * the declaration key and the guard's read key agree — the failure mode a hand-written
 * metadata key cannot catch.
 */

import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { DomainError } from '../errors/domain.error';
import { ERROR_CODES } from '../errors/problem';
import type { AuthenticatedPrincipal } from '../identity/auth.service';
import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import type { SecurityEventSink } from '../identity/security-event.sink';
import type { AuthorizationService, EffectiveAuthorization } from '../tenancy/authorization/authorization.service';
import {
  AuthorizationGuard,
  Authorize,
  PERMISSION_METADATA_KEY,
  RequirePermission,
  type AuthenticatedWithOrgRequest,
} from './authorization.guard';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = '22222222-2222-4222-8222-222222222222';
const FOREIGN_ORG_ID = '33333333-3333-4333-8333-333333333333';

const PRINCIPAL: AuthenticatedPrincipal = {
  userId: USER_ID,
  email: 'owner@example.com',
  organizations: [ORG_ID],
  sessionId: '44444444-4444-4444-8444-444444444444',
  permissionsVersion: 1,
  expiresAt: new Date('2026-01-01T00:15:00.000Z'),
};

/** One resolved authorization, holding exactly the ids handed in. */
function effective(
  permissions: readonly string[],
  overrides: Partial<EffectiveAuthorization> = {},
): EffectiveAuthorization {
  return {
    organizationId: ORG_ID,
    userId: USER_ID,
    isOwner: false,
    role: { id: '55555555-5555-4555-8555-555555555555', key: 'manager', name: 'Manager' },
    permissions,
    deniedPermissionIds: [],
    permissionsVersion: 1,
    ...overrides,
  };
}

/** Await a refusal and return the `DomainError`, failing if the call resolved. */
async function refusalOf(run: () => Promise<unknown>): Promise<DomainError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    return error as DomainError;
  }
  throw new Error('expected a DomainError, but the call resolved');
}

/** A minimal `ExecutionContext` whose handler and class carry the metadata a case needs. */
function contextFor(
  request: AuthenticatedWithOrgRequest,
  handler: (...args: unknown[]) => unknown = () => undefined,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => class TestController {},
  } as unknown as ExecutionContext;
}

/** A request carrying the verified principal and the route parameters under test. */
function requestFor(overrides: Partial<AuthenticatedWithOrgRequest> = {}): AuthenticatedWithOrgRequest {
  return {
    authPrincipal: PRINCIPAL,
    params: { organizationId: ORG_ID },
    ip: '203.0.113.7',
    ...overrides,
  } as AuthenticatedWithOrgRequest;
}

/** Build a guard over the given collaborator mocks, with the real `Reflector`. */
function guardWith(authz: Partial<AuthorizationService>, sink: Partial<SecurityEventSink>): AuthorizationGuard {
  return new AuthorizationGuard(new Reflector(), authz as AuthorizationService, sink as SecurityEventSink);
}

describe('RequirePermission / Authorize metadata', () => {
  it('records the declared permission where the guard reads it', () => {
    const handler = (): void => undefined;
    RequirePermission('roles.manage')(handler);

    expect(new Reflector().getAllAndOverride(PERMISSION_METADATA_KEY, [handler, class TestController {}])).toBe(
      'roles.manage',
    );
  });

  it('Authorize applies the bearer guard before the authorization guard and stamps the permission', () => {
    const handler = (): void => undefined;
    Authorize('roles.manage')(handler);

    const guards = Reflect.getMetadata('__guards__', handler) as unknown[];
    expect(guards).toEqual([JwtAuthGuard, AuthorizationGuard]);
    expect(new Reflector().getAllAndOverride(PERMISSION_METADATA_KEY, [handler, class TestController {}])).toBe(
      'roles.manage',
    );
  });
});

describe('AuthorizationGuard', () => {
  it('refuses an unauthenticated request rather than treating it as a member', async () => {
    const resolve = jest.fn();
    const guard = guardWith({ resolveForMembership: resolve }, {});
    const request = requestFor();
    // `exactOptionalPropertyTypes` forbids writing `undefined`; delete instead.
    delete request.authPrincipal;

    const error = await refusalOf(() => guard.canActivate(contextFor(request)));

    expect(error.code).toBe(ERROR_CODES.UNAUTHENTICATED);
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each([undefined, '', {}])('refuses a route without an organizationId parameter (%p)', async (params) => {
    const resolve = jest.fn();
    const guard = guardWith({ resolveForMembership: resolve }, {});
    const request = requestFor({ params: params as Record<string, string> });

    const error = await refusalOf(() => guard.canActivate(contextFor(request)));

    expect(error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('refuses a token whose membership set excludes the route organization, and records the refusal', async () => {
    const record = jest.fn();
    const resolve = jest.fn();
    const guard = guardWith({ resolveForMembership: resolve }, { record });
    const request = requestFor({ params: { organizationId: FOREIGN_ORG_ID } });

    const error = await refusalOf(() => guard.canActivate(contextFor(request)));

    expect(error.code).toBe(ERROR_CODES.ORGANIZATION_FORBIDDEN);
    // A cross-tenant probe must not resolve permissions at all — there is no
    // membership lookup to do, and consulting the table is the leak §9.3 forbids.
    expect(resolve).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith({
      type: 'ACCESS_TOKEN_REJECTED',
      userId: USER_ID,
      errorCode: ERROR_CODES.ORGANIZATION_FORBIDDEN,
      clientAddress: '203.0.113.7',
    });
    expect(request.organizationId).toBeUndefined();
  });

  it('omits the client address when the request carries none', async () => {
    const record = jest.fn();
    const guard = guardWith({ resolveForMembership: jest.fn() }, { record });
    const request = requestFor({ params: { organizationId: FOREIGN_ORG_ID }, ip: undefined });

    await refusalOf(() => guard.canActivate(contextFor(request)));

    expect(record).toHaveBeenCalledWith({
      type: 'ACCESS_TOKEN_REJECTED',
      userId: USER_ID,
      errorCode: ERROR_CODES.ORGANIZATION_FORBIDDEN,
    });
  });

  it('admits a member when the handler requires no permission, without resolving the set', async () => {
    const resolve = jest.fn();
    const guard = guardWith({ resolveForMembership: resolve }, {});
    const request = requestFor();

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

    expect(resolve).not.toHaveBeenCalled();
    expect(request.organizationId).toBe(ORG_ID);
  });

  it('admits a member who holds the declared permission', async () => {
    const resolve = jest.fn().mockResolvedValue(effective(['roles.manage', 'users.manage']));
    const guard = guardWith({ resolveForMembership: resolve }, {});
    const handler = (): void => undefined;
    RequirePermission('roles.manage')(handler);
    const request = requestFor();

    await expect(guard.canActivate(contextFor(request, handler))).resolves.toBe(true);

    expect(resolve).toHaveBeenCalledWith(ORG_ID, USER_ID);
    expect(request.organizationId).toBe(ORG_ID);
  });

  it('refuses PERMISSION_DENIED and records the refusal when the permission is absent', async () => {
    const record = jest.fn();
    const resolve = jest.fn().mockResolvedValue(effective(['users.manage']));
    const guard = guardWith({ resolveForMembership: resolve }, { record });
    const handler = (): void => undefined;
    RequirePermission('roles.manage')(handler);
    const request = requestFor();

    const error = await refusalOf(() => guard.canActivate(contextFor(request, handler)));

    expect(error.code).toBe(ERROR_CODES.PERMISSION_DENIED);
    expect(record).toHaveBeenCalledWith({
      type: 'ACCESS_TOKEN_REJECTED',
      userId: USER_ID,
      errorCode: ERROR_CODES.PERMISSION_DENIED,
      clientAddress: '203.0.113.7',
    });
    expect(request.organizationId).toBeUndefined();
  });

  it('fails closed when a handler declares an id the catalog does not serve', async () => {
    // The resolver only ever returns known ids, so an unknown declaration can never
    // match; the guard must not fall through to an allow.
    const record = jest.fn();
    const resolve = jest.fn().mockResolvedValue(effective(['roles.manage']));
    const guard = guardWith({ resolveForMembership: resolve }, { record });
    const handler = (): void => undefined;
    RequirePermission('not.a.permission')(handler);

    const error = await refusalOf(() => guard.canActivate(contextFor(requestFor(), handler)));

    expect(error.code).toBe(ERROR_CODES.PERMISSION_DENIED);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ errorCode: ERROR_CODES.PERMISSION_DENIED }));
  });
});
