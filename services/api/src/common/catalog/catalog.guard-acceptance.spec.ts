/**
 * Guard-level acceptance for the catalog surface's permission wall (§40.8 M4-S1;
 * acceptance item 7 — "`catalog.view` caller cannot write anything").
 *
 * These cases run the **real** `AuthorizationGuard` with the **real** `Reflector`
 * against the **real** `CatalogController` handler metadata — the same decorators
 * and the same metadata key the production HTTP request passes through. The only
 * substituted collaborator is the authorization resolver, so the question answered
 * here is exactly the security question: does a principal whose effective
 * permission set lacks `catalog.edit` pass the write wall, and does a principal
 * without `catalog.view` pass a read route? The guard decides; nothing else may.
 *
 * Why a unit-level proof for the permission branch: minting a second, non-owner
 * member through the product's real surfaces is impossible today (no membership-
 * creation route exists yet — it arrives with a later slice), so a real-HTTP run
 * cannot carry a real logged-in view-only principal. The walkthrough demonstrates
 * the tenant wall at HTTP level (ORGANIZATION_FORBIDDEN); the permission wall is
 * proven here against the production metadata, which is the same decision the
 * production request would reach.
 */

import { Reflector } from '@nestjs/core';

import { PERMISSION_METADATA_KEY, AuthorizationGuard } from '../authorization/authorization.guard';
import { ERROR_CODES } from '../errors/problem';
import type { AuthenticatedPrincipal } from '../identity/auth.service';
import type { AuthorizationService, EffectiveAuthorization } from '../tenancy/authorization/authorization.service';
import { CatalogController } from './catalog.controller';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = '22222222-2222-4222-8222-222222222222';

const PRINCIPAL: AuthenticatedPrincipal = {
  userId: USER_ID,
  email: 'viewer@example.com',
  organizations: [ORG_ID],
  sessionId: '44444444-4444-4444-8444-444444444444',
  permissionsVersion: 1,
  expiresAt: new Date('2026-01-01T00:15:00.000Z'),
};

/** One resolved authorization, holding exactly the ids handed in. */
function effective(permissions: readonly string[]): EffectiveAuthorization {
  return {
    organizationId: ORG_ID,
    userId: USER_ID,
    isOwner: false,
    role: { id: '55555555-5555-4555-8555-555555555555', key: 'manager', name: 'Manager' },
    permissions,
    deniedPermissionIds: [],
    permissionsVersion: 1,
  };
}

/** The declared permission of one real catalog handler, read from the real metadata. */
export type CatalogRoute = Exclude<keyof CatalogController, 'catalog'>;

/** The declared permission of one real catalog handler, read from the real metadata. */
function declaredPermission(route: CatalogRoute): string {
  return new Reflector().getAllAndOverride<string>(
    PERMISSION_METADATA_KEY,
    [CatalogController.prototype[route], CatalogController],
  );
}

/** Build the real guard with only the collaborators substituted. */
function guardFor(resolved: EffectiveAuthorization): AuthorizationGuard {
  const resolve = jest.fn((): Promise<EffectiveAuthorization> => Promise.resolve(resolved));
  return new AuthorizationGuard(
    new Reflector(),
    { resolveForMembership: resolve } as unknown as AuthorizationService,
    { record: jest.fn() },
  );
}

/** An execution context carrying the real handler metadata and a member principal. */
function contextFor(route: CatalogRoute): {
  switchToHttp: () => { getRequest: () => object };
  getHandler: () => unknown;
  getClass: () => object;
} {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        authPrincipal: PRINCIPAL,
        params: { organizationId: ORG_ID },
        ip: '203.0.113.7',
      }),
    }),
    // The prototype method carries the production decorators; the class bound is
    // the real controller class, exactly as Nest resolves them at runtime.
    getHandler: () => CatalogController.prototype[route],
    getClass: () => CatalogController,
  };
}

describe('the catalog permission wall (AC-7: a view-only caller cannot write)', () => {
  it('declares catalog.view on every read route and catalog.edit on every write route', () => {
    expect(declaredPermission('list')).toBe('catalog.view');
    expect(declaredPermission('get')).toBe('catalog.view');
    expect(declaredPermission('create')).toBe('catalog.edit');
    expect(declaredPermission('update')).toBe('catalog.edit');
    expect(declaredPermission('softDelete')).toBe('catalog.edit');
    expect(declaredPermission('updateUnits')).toBe('catalog.edit');
    expect(declaredPermission('createVariant')).toBe('catalog.edit');
    expect(declaredPermission('updateVariant')).toBe('catalog.edit');
  });

  it('refuses a variant write to a member holding only catalog.view', async () => {
    const guard = guardFor(effective(['catalog.view', 'sales.create', 'settings.view']));

    await expect(guard.canActivate(contextFor('createVariant') as never)).rejects.toMatchObject({
      code: ERROR_CODES.PERMISSION_DENIED,
    });
  });

  it('refuses the units rewrite to an unclassified member with no grants at all', async () => {
    const guard = guardFor(effective([]));

    await expect(guard.canActivate(contextFor('updateUnits') as never)).rejects.toMatchObject({
      code: ERROR_CODES.PERMISSION_DENIED,
    });
  });

  it('refuses a product soft-delete to a member whose catalog grants stop at view', async () => {
    const guard = guardFor(effective(['catalog.view']));

    await expect(guard.canActivate(contextFor('softDelete') as never)).rejects.toMatchObject({
      code: ERROR_CODES.PERMISSION_DENIED,
    });
  });

  it('refuses every write route for a view-only member (the whole wall, one decision)', async () => {
    const guard = guardFor(effective(['catalog.view']));

    for (const route of ['create', 'update', 'softDelete', 'updateUnits', 'createVariant', 'updateVariant'] as const) {
      await expect(guard.canActivate(contextFor(route) as never)).rejects.toMatchObject({
        code: ERROR_CODES.PERMISSION_DENIED,
      });
    }
  });

  it('admits a view-only member through every read route — view is exactly view', async () => {
    const guard = guardFor(effective(['catalog.view']));

    for (const route of ['list', 'get'] as const) {
      await expect(guard.canActivate(contextFor(route) as never)).resolves.toBe(true);
    }
  });

  it('admits a member holding catalog.edit through a write route — the gate is a permission, not a role', async () => {
    const guard = guardFor(effective(['catalog.view', 'catalog.edit']));

    await expect(guard.canActivate(contextFor('create') as never)).resolves.toBe(true);
  });
});
