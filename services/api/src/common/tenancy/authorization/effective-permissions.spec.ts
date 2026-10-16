/**
 * Unit acceptance for the effective-permission resolver (§11.4, AC-07..AC-10).
 *
 * The resolver is the single decision point, so the suite is exhaustive about the
 * order — role, then overrides, then the structural strip — and about failing closed:
 * a `DENY` beats a grant and an `ALLOW`, an `ALLOW` cannot confer an owner-exclusive
 * permission on a non-owner, an unknown id grants nothing, and a missing role yields
 * the empty set.
 */

import { PERMISSION_IDS } from './permission-catalog';
import { holdsPermission, resolveEffectivePermissions, toPermissionSet } from './effective-permissions';

describe('resolveEffectivePermissions (§11.4)', () => {
  it('returns the role grants for a non-owner with no overrides', () => {
    const effective = resolveEffectivePermissions({
      isOwner: false,
      rolePermissionIds: ['sales.create', 'catalog.view'],
      overrides: [],
    });
    expect(effective).toEqual(['catalog.view', 'sales.create']);
  });

  it('returns the grants in catalog order, deduplicated, whatever the input order', () => {
    const effective = resolveEffectivePermissions({
      isOwner: false,
      rolePermissionIds: ['sales.create', 'catalog.view', 'sales.create'],
      overrides: [],
    });
    expect(effective).toEqual(['catalog.view', 'sales.create']);
  });

  it('the Owner holds every catalog permission, ignoring role and override rows (AC-06)', () => {
    expect(resolveEffectivePermissions({ isOwner: true, rolePermissionIds: [], overrides: [] })).toEqual(
      PERMISSION_IDS,
    );

    // Even a DENY cannot shrink an owner's structural set.
    expect(
      resolveEffectivePermissions({
        isOwner: true,
        rolePermissionIds: ['catalog.view'],
        overrides: [{ permissionId: 'accounting.journal.post', effect: 'DENY' }],
      }),
    ).toEqual(PERMISSION_IDS);
  });

  it('an ALLOW override grants an extra non-owner-exclusive permission (AC-08)', () => {
    const effective = resolveEffectivePermissions({
      isOwner: false,
      rolePermissionIds: ['sales.create'],
      overrides: [{ permissionId: 'pricing.override', effect: 'ALLOW' }],
    });
    expect(effective).toContain('pricing.override');
    expect(effective).toContain('sales.create');
  });

  it('a DENY override removes a role-granted permission (AC-08)', () => {
    const effective = resolveEffectivePermissions({
      isOwner: false,
      rolePermissionIds: ['sales.create', 'sales.return'],
      overrides: [{ permissionId: 'sales.return', effect: 'DENY' }],
    });
    expect(effective).toEqual(['sales.create']);
  });

  it('DENY beats a same-permission ALLOW (AC-09)', () => {
    const effective = resolveEffectivePermissions({
      isOwner: false,
      rolePermissionIds: ['sales.create'],
      overrides: [
        { permissionId: 'pricing.override', effect: 'ALLOW' },
        { permissionId: 'pricing.override', effect: 'DENY' },
      ],
    });
    expect(effective).not.toContain('pricing.override');
  });

  it('an ALLOW override cannot confer an owner-exclusive permission on a non-owner (AC-10)', () => {
    const effective = resolveEffectivePermissions({
      isOwner: false,
      rolePermissionIds: ['accounting.view'],
      overrides: [{ permissionId: 'accounting.journal.post', effect: 'ALLOW' }],
    });
    expect(effective).not.toContain('accounting.journal.post');
    expect(effective).toEqual(['accounting.view']);
  });

  it('a role grant of an owner-exclusive permission is stripped for a non-owner (AC-10)', () => {
    const effective = resolveEffectivePermissions({
      isOwner: false,
      rolePermissionIds: ['accounting.journal.post', 'accounting.view'],
      overrides: [],
    });
    expect(effective).toEqual(['accounting.view']);
  });

  it('ignores an unknown permission id in the role and in an override (fail closed)', () => {
    const effective = resolveEffectivePermissions({
      isOwner: false,
      rolePermissionIds: ['sales.create', 'sales.teleport'],
      overrides: [{ permissionId: 'ghost.permission', effect: 'ALLOW' }],
    });
    expect(effective).toEqual(['sales.create']);
  });

  it('a missing role yields the empty set unless an ALLOW override adds to it', () => {
    expect(resolveEffectivePermissions({ isOwner: false, rolePermissionIds: null, overrides: [] })).toEqual([]);
    expect(
      resolveEffectivePermissions({
        isOwner: false,
        rolePermissionIds: null,
        overrides: [{ permissionId: 'sales.create', effect: 'ALLOW' }],
      }),
    ).toEqual(['sales.create']);
  });

  it('returns a frozen array, so a caller cannot mutate a resolved set', () => {
    const effective = resolveEffectivePermissions({
      isOwner: false,
      rolePermissionIds: ['sales.create'],
      overrides: [],
    });
    expect(Object.isFrozen(effective)).toBe(true);
  });

  it('exposes a membership test and a set helper', () => {
    const effective = resolveEffectivePermissions({
      isOwner: false,
      rolePermissionIds: ['sales.create'],
      overrides: [],
    });
    expect(holdsPermission(effective, 'sales.create')).toBe(true);
    expect(holdsPermission(effective, 'sales.return')).toBe(false);
    expect(toPermissionSet(effective).has('sales.create')).toBe(true);
  });
});
