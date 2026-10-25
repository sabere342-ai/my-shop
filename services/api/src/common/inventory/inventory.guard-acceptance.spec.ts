/**
 * Guard-level acceptance for the inventory surface's permission wall (§40.8
 * M4-S2; §17 — inventory reads and writes are permission decisions, never a
 * side effect of being authenticated).
 *
 * The same proof the catalog's guard-acceptance spec carries: the **real**
 * `AuthorizationGuard` with the **real** `Reflector` against the **real**
 * `InventoryController` handler metadata — the same decorators and the same
 * metadata key the production HTTP request passes through. The only
 * substituted collaborator is the authorization resolver. The question here is
 * exactly the security question: does a principal whose effective permission
 * set lacks `inventory.adjust` pass the movement wall, and does a principal
 * without `inventory.view` pass a read route? The guard decides; nothing else
 * may.
 *
 * Why a unit-level proof for the permission branch: minting a second,
 * non-owner member through the product's real surfaces is impossible today (no
 * membership-creation route exists yet — the same boundary the M4-S1 record
 * declared), so a real-HTTP run cannot carry a real logged-in limited
 * principal. The walkthrough demonstrates the tenant wall at HTTP level
 * (ORGANIZATION_FORBIDDEN); the permission wall is proven here against the
 * production metadata, which is the same decision the production request would
 * reach.
 */

import { Reflector } from '@nestjs/core';

import { PERMISSION_METADATA_KEY, AuthorizationGuard } from '../authorization/authorization.guard';
import { ERROR_CODES } from '../errors/problem';
import type { AuthenticatedPrincipal } from '../identity/auth.service';
import type { AuthorizationService, EffectiveAuthorization } from '../tenancy/authorization/authorization.service';
import { InventoryController, requiredCostingPermissions } from './inventory.controller';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = '22222222-2222-4222-8222-222222222222';

const PRINCIPAL: AuthenticatedPrincipal = {
  userId: USER_ID,
  email: 'stockkeeper@example.com',
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
    role: { id: '55555555-5555-4555-8555-555555555555', key: 'cashier', name: 'Cashier' },
    permissions,
    deniedPermissionIds: [],
    permissionsVersion: 1,
  };
}

/** The declared permission of one real inventory handler, read from the real metadata. */
export type InventoryRoute = Exclude<keyof InventoryController, 'inventory'>;

/** The declared permission of one real inventory handler, read from the real metadata. */
function declaredPermission(route: InventoryRoute): string {
  return new Reflector().getAllAndOverride<string>(PERMISSION_METADATA_KEY, [
    InventoryController.prototype[route],
    InventoryController,
  ]);
}

/** Build the real guard with only the collaborators substituted. */
function guardFor(resolved: EffectiveAuthorization): AuthorizationGuard {
  const resolve = jest.fn((): Promise<EffectiveAuthorization> => Promise.resolve(resolved));
  return new AuthorizationGuard(new Reflector(), { resolveForMembership: resolve } as unknown as AuthorizationService, {
    record: jest.fn(),
  });
}

/** An execution context carrying the real handler metadata and a member principal. */
function contextFor(route: InventoryRoute): {
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
    getHandler: () => InventoryController.prototype[route],
    getClass: () => InventoryController,
  };
}

describe('the inventory permission wall (§17: a viewer cannot move stock)', () => {
  it('declares inventory.view on every quantity read route, inventory.adjust on the movement write, and catalog.cost.edit on the cost reads', () => {
    expect(declaredPermission('listLocations')).toBe('inventory.view');
    expect(declaredPermission('listLevels')).toBe('inventory.view');
    expect(declaredPermission('listMovements')).toBe('inventory.view');
    expect(declaredPermission('submitMovement')).toBe('inventory.adjust');
    // The M4-S3 costing face (§38.5's "when a cost is involved"): the
    // inventory.view quantity reads carry no cost member, so the valuation and
    // the cost snapshots are read only by the cost authority itself.
    expect(declaredPermission('listValuation')).toBe('catalog.cost.edit');
    expect(declaredPermission('listCostSnapshots')).toBe('catalog.cost.edit');
  });

  it('refuses the movement write to a member whose grants stop at inventory.view', async () => {
    const guard = guardFor(effective(['inventory.view', 'catalog.view', 'sales.create']));

    await expect(guard.canActivate(contextFor('submitMovement') as never)).rejects.toMatchObject({
      code: ERROR_CODES.PERMISSION_DENIED,
    });
  });

  it('refuses every route to a member with no inventory grants at all — authenticated is not authorized', async () => {
    const guard = guardFor(effective([]));

    for (const route of ['listLocations', 'listLevels', 'listMovements', 'submitMovement'] as const) {
      await expect(guard.canActivate(contextFor(route) as never)).rejects.toMatchObject({
        code: ERROR_CODES.PERMISSION_DENIED,
      });
    }
  });

  it('refuses the costing reads to a member whose grants stop at inventory.view — cost is not a side effect of viewing stock', async () => {
    const guard = guardFor(effective(['inventory.view']));

    for (const route of ['listValuation', 'listCostSnapshots'] as const) {
      await expect(guard.canActivate(contextFor(route) as never)).rejects.toMatchObject({
        code: ERROR_CODES.PERMISSION_DENIED,
      });
    }
  });

  it('admits a view-only member through every quantity read route — view is exactly view', async () => {
    const guard = guardFor(effective(['inventory.view']));

    for (const route of ['listLocations', 'listLevels', 'listMovements'] as const) {
      await expect(guard.canActivate(contextFor(route) as never)).resolves.toBe(true);
    }
  });

  it('admits a member holding inventory.adjust through the movement write — the gate is a permission, not a role', async () => {
    const guard = guardFor(effective(['inventory.view', 'inventory.adjust']));

    await expect(guard.canActivate(contextFor('submitMovement') as never)).resolves.toBe(true);
  });

  it('admits a member holding only the cost authority through both costing reads — the wall is granular, not bundled', async () => {
    const guard = guardFor(effective(['catalog.cost.edit']));

    for (const route of ['listValuation', 'listCostSnapshots'] as const) {
      await expect(guard.canActivate(contextFor(route) as never)).resolves.toBe(true);
    }
  });
});

describe('the §38.5 cost escalation matrix (the controller’s cause decision)', () => {
  it('demands the receiving authority and the cost authority of a purchase receipt', () => {
    expect(requiredCostingPermissions('PURCHASE_RECEIPT', '100')).toEqual(['inventory.receive', 'catalog.cost.edit']);
  });

  it('demands the cost authority of the cost-imposing causes, regardless of a cost offer', () => {
    expect(requiredCostingPermissions('OPENING_BALANCE', undefined)).toEqual(['catalog.cost.edit']);
    expect(requiredCostingPermissions('REVALUATION', '500')).toEqual(['catalog.cost.edit']);
  });

  it('escalates an adjustment only when its wire carries a cost', () => {
    expect(requiredCostingPermissions('MANUAL_ADJUSTMENT', undefined)).toEqual([]);
    expect(requiredCostingPermissions('MANUAL_ADJUSTMENT', null)).toEqual([]);
    expect(requiredCostingPermissions('MANUAL_ADJUSTMENT', '0')).toEqual(['catalog.cost.edit']);
  });

  it('names no escalation for an unknown cause — the canonicalizer owns that refusal', () => {
    expect(requiredCostingPermissions('SALE', undefined)).toEqual([]);
  });
});
