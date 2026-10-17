/**
 * Unit acceptance for the versioned permission catalog (§11.2, AC-01.., AC-10, AC-19).
 *
 * The catalog is data, so its integrity is asserted structurally: a stable count, a
 * closed category set, unique ids, a valid grammar, exactly one owner-exclusive id,
 * and the §11.2 table reproduced verbatim. A drift here is what would silently widen
 * every role, so the assertions are exhaustive rather than illustrative.
 */

import {
  findPermission,
  isOwnerExclusivePermission,
  isPermissionId,
  isPermissionIdShape,
  OWNER_EXCLUSIVE_PERMISSION_IDS,
  PERMISSION_CATALOG,
  PERMISSION_CATALOG_VERSION,
  PERMISSION_CATEGORIES,
  PERMISSION_IDS,
} from './permission-catalog';

/** The §11.2 table, transcribed group by group. The catalog must equal this exactly. */
const CATALOG_BY_GROUP: Readonly<Record<string, readonly string[]>> = {
  catalog: ['catalog.view', 'catalog.edit', 'catalog.cost.edit'],
  inventory: ['inventory.view', 'inventory.receive', 'inventory.adjust', 'inventory.count'],
  sales: ['sales.view', 'sales.create', 'sales.viewAll', 'sales.return', 'sales.cancel'],
  pricing: ['pricing.override', 'pricing.discount.apply', 'pricing.discount.approve'],
  customers: ['customers.view', 'customers.edit', 'customers.collect'],
  suppliers: ['suppliers.view', 'suppliers.edit', 'suppliers.pay'],
  treasury: ['treasury.view', 'treasury.transfer', 'treasury.reconcile'],
  accounting: ['accounting.view', 'accounting.journal.read', 'accounting.journal.post', 'accounting.chart.manage'],
  administration: [
    'settings.view',
    'settings.edit',
    'pricing.policy.edit',
    'users.manage',
    'roles.manage',
    'devices.view',
    'devices.revoke',
    'audit.view',
  ],
};

describe('permission catalog (§11.2)', () => {
  it('serves version 1', () => {
    expect(PERMISSION_CATALOG_VERSION).toBe(1);
  });

  it('lists exactly the nine category rows', () => {
    expect([...PERMISSION_CATEGORIES]).toEqual([
      'catalog',
      'inventory',
      'sales',
      'pricing',
      'customers',
      'suppliers',
      'treasury',
      'accounting',
      'administration',
    ]);
  });

  it('reproduces the §11.2 table verbatim: 36 ids across the nine groups', () => {
    const grouped: Record<string, string[]> = {};
    for (const entry of PERMISSION_CATALOG) {
      (grouped[entry.category] ??= []).push(entry.id);
    }

    for (const [category, ids] of Object.entries(CATALOG_BY_GROUP)) {
      expect(grouped[category]).toEqual(ids);
    }
    expect(Object.keys(grouped).sort()).toEqual([...PERMISSION_CATEGORIES].sort());

    const total = Object.values(CATALOG_BY_GROUP).reduce((sum, ids) => sum + ids.length, 0);
    expect(PERMISSION_CATALOG).toHaveLength(36);
    expect(total).toBe(36);
  });

  it('has unique ids and a valid grammar for every entry', () => {
    expect(new Set(PERMISSION_IDS).size).toBe(PERMISSION_IDS.length);
    for (const entry of PERMISSION_CATALOG) {
      expect(isPermissionIdShape(entry.id)).toBe(true);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it('marks exactly one permission owner-exclusive (§11.2, AC-10)', () => {
    expect(OWNER_EXCLUSIVE_PERMISSION_IDS).toEqual(['accounting.journal.post']);
    expect(isOwnerExclusivePermission('accounting.journal.post')).toBe(true);
    expect(isOwnerExclusivePermission('sales.create')).toBe(false);
    expect(isOwnerExclusivePermission('not.in.the.catalog')).toBe(false);
  });

  it('fails closed for an id it does not know', () => {
    expect(isPermissionId('sales.create')).toBe(true);
    expect(isPermissionId('sales.teleport')).toBe(false);
    expect(findPermission('sales.teleport')).toBeUndefined();
  });

  it('accepts the documented grammar and refuses malformed ids', () => {
    // Valid: lower-case first segment, inner capitals allowed, dot-separated.
    expect(isPermissionIdShape('sales.viewAll')).toBe(true);
    expect(isPermissionIdShape('accounting.journal.post')).toBe(true);
    expect(isPermissionIdShape('a.b2c')).toBe(true);
    // Invalid shapes.
    expect(isPermissionIdShape('Sales.view')).toBe(false);
    expect(isPermissionIdShape('sales')).toBe(false);
    expect(isPermissionIdShape('sales.')).toBe(false);
    expect(isPermissionIdShape('.sales')).toBe(false);
    expect(isPermissionIdShape('sales. view')).toBe(false);
    expect(isPermissionIdShape('sales.view_all')).toBe(false);
  });

  it('is frozen so a caller cannot mutate the served catalog', () => {
    expect(Object.isFrozen(PERMISSION_CATALOG)).toBe(true);
    expect(Object.isFrozen(PERMISSION_IDS)).toBe(true);
    expect(Object.isFrozen(OWNER_EXCLUSIVE_PERMISSION_IDS)).toBe(true);
  });
});
