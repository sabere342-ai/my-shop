/**
 * Unit acceptance for the six seeded role presets (§11.3, O-8, AC-05, AC-06, AC-07).
 *
 * The presets are the seeded data the authorization service materializes per
 * organization, so their invariants must hold before any database is involved:
 * Owner is the whole catalog and the only `isOwner`; no non-Owner preset holds an
 * owner-exclusive id; Manager withholds `sales.viewAll`.
 */

import { isOwnerExclusivePermission, PERMISSION_IDS } from './permission-catalog';
import {
  findRolePreset,
  MANAGER_WITHHELD_PERMISSION_IDS,
  OWNER_ROLE_KEY,
  ROLE_PRESETS,
  ROLE_PRESET_KEYS,
} from './role-presets';

describe('role presets (§11.3)', () => {
  it('seeds exactly the six §11.3 presets, Owner first', () => {
    expect([...ROLE_PRESET_KEYS]).toEqual(['owner', 'manager', 'cashier', 'salesperson', 'stockkeeper', 'accountant']);
    expect(ROLE_PRESETS.map((preset) => preset.key)).toEqual([...ROLE_PRESET_KEYS]);
    expect(OWNER_ROLE_KEY).toBe('owner');
  });

  it('marks only Owner isOwner, so the partial unique index admits one per organization (AC-06)', () => {
    const owners = ROLE_PRESETS.filter((preset) => preset.isOwner);
    expect(owners.map((preset) => preset.key)).toEqual(['owner']);
  });

  it('gives the Owner every catalog permission and nothing outside it (AC-06)', () => {
    const owner = findRolePreset('owner');
    expect(owner?.permissions).toEqual(PERMISSION_IDS);
  });

  it('gives no non-Owner preset an owner-exclusive permission (AC-07, AC-10)', () => {
    for (const preset of ROLE_PRESETS) {
      if (preset.isOwner) continue;
      for (const id of preset.permissions) {
        expect(isOwnerExclusivePermission(id)).toBe(false);
      }
    }
  });

  it('withholds sales.viewAll from Manager (O-8, AC-07)', () => {
    const manager = findRolePreset('manager');
    expect(MANAGER_WITHHELD_PERMISSION_IDS).toEqual(['sales.viewAll']);
    expect(manager?.permissions).not.toContain('sales.viewAll');
    // …while every other non-owner-exclusive permission is present, so the exclusion
    // is the only difference from "all grantable permissions".
    const expected = PERMISSION_IDS.filter((id) => !isOwnerExclusivePermission(id) && id !== 'sales.viewAll');
    expect(manager?.permissions).toEqual(expected);
  });

  it('keeps every preset inside the catalog and free of duplicates', () => {
    for (const preset of ROLE_PRESETS) {
      const known = new Set(PERMISSION_IDS);
      expect(new Set(preset.permissions).size).toBe(preset.permissions.length);
      for (const id of preset.permissions) {
        expect(known.has(id)).toBe(true);
      }
    }
  });

  it('preserves the salesOnly role as the minimal Salesperson preset (§11.3)', () => {
    const salesperson = findRolePreset('salesperson');
    expect(salesperson?.permissions).toEqual([
      'catalog.view',
      'inventory.view',
      'sales.view',
      'sales.create',
      'customers.view',
    ]);
  });

  it('returns undefined for an unknown key', () => {
    expect(findRolePreset('owner')).toBeDefined();
    // @ts-expect-error — an out-of-vocabulary key must not resolve.
    expect(findRolePreset('superuser')).toBeUndefined();
  });
});
