/**
 * §11.3 / §40.6 M2-S3 — the six seeded **role presets**.
 *
 * §11.3 makes roles *data, not an enum*: "Seeded presets exist for convenience; a role
 * is a named set of permission ids." This file is that seeded data — the six built-in
 * presets (Owner, Manager, Cashier, Salesperson, Stockkeeper, Accountant) expressed as
 * sets over the §11.2 catalog. The database stores the result; the code owns the
 * source of truth, and `AuthorizationService.ensureOrganizationRoles` materializes
 * these into `roles` + `role_permissions` idempotently (§35.4 — tenant data is seeded
 * by application code, never by a SQL migration).
 *
 * Three invariants hold structurally and are asserted by the unit suite:
 *
 * - **Owner holds every catalog permission** (§11.3) and is the only preset with
 *   `isOwner`, so it is the one role the partial unique index admits per organization.
 * - **No non-Owner preset holds an `ownerExclusive` permission** (§11.2): the sets are
 *   filtered through the catalog's flag, so adding an owner-exclusive permission to the
 *   catalog cannot leak it into a non-Owner preset by accident.
 * - **Manager deliberately omits `sales.viewAll`** — the §42.1 O-8 decision that a
 *   manager may not see every sale in the organization. It is listed as an explicit
 *   exclusion so a future edit cannot quietly re-add it.
 */

import { PERMISSION_CATALOG, PERMISSION_IDS, type PermissionId } from './permission-catalog';

/** The stable machine keys of the six built-in presets. */
export const ROLE_PRESET_KEYS = ['owner', 'manager', 'cashier', 'salesperson', 'stockkeeper', 'accountant'] as const;

/** One of the six built-in preset keys. */
export type RolePresetKey = (typeof ROLE_PRESET_KEYS)[number];

/** The key of the single Owner role (§11.3). */
export const OWNER_ROLE_KEY: RolePresetKey = 'owner';

/** One seeded preset. `permissions` is a set over catalog ids, deterministically ordered. */
export interface RolePreset {
  readonly key: RolePresetKey;
  /** Display name stored in `roles.name`. */
  readonly name: string;
  /** True only for Owner: the role the partial unique index makes unique per organization. */
  readonly isOwner: boolean;
  /** Why the set is what it is. Documentation only; never consulted for a decision. */
  readonly rationale: string;
  readonly permissions: readonly PermissionId[];
}

function ordered(ids: Iterable<PermissionId>): readonly PermissionId[] {
  const wanted = new Set(ids);
  return Object.freeze(PERMISSION_IDS.filter((id) => wanted.has(id)));
}

/** Every id that is **not** owner-exclusive, in catalog order. */
function everyGrantableId(): readonly PermissionId[] {
  return PERMISSION_CATALOG.filter((entry) => !entry.ownerExclusive).map((entry) => entry.id);
}

/**
 * §42.1 O-8: `sales.viewAll` is withheld from the Manager preset. Named as a constant so
 * the exclusion is explicit in the code and asserted by the unit suite.
 */
export const MANAGER_WITHHELD_PERMISSION_IDS: readonly PermissionId[] = Object.freeze(['sales.viewAll']);

const OWNER_PERMISSIONS = Object.freeze([...PERMISSION_IDS]);

const MANAGER_PERMISSIONS = ordered(everyGrantableId().filter((id) => !MANAGER_WITHHELD_PERMISSION_IDS.includes(id)));

const CASHIER_PERMISSIONS = ordered([
  'sales.view',
  'sales.create',
  'catalog.view',
  'inventory.view',
  'customers.view',
  'customers.collect',
  'pricing.discount.apply',
]);

const SALESPERSON_PERMISSIONS = ordered([
  // §11.3: the legacy `salesOnly` role, preserved in spirit — "exactly the minimum
  // needed to sell, and nothing else".
  'sales.view',
  'sales.create',
  'catalog.view',
  'inventory.view',
  'customers.view',
]);

const STOCKKEEPER_PERMISSIONS = ordered([
  'catalog.view',
  'inventory.view',
  'inventory.receive',
  'inventory.adjust',
  'inventory.count',
]);

const ACCOUNTANT_PERMISSIONS = ordered([
  'accounting.view',
  'accounting.journal.read',
  'accounting.chart.manage',
  'treasury.view',
  'treasury.reconcile',
  'customers.view',
  'suppliers.view',
]);

/** The six presets, Owner first. */
export const ROLE_PRESETS: readonly RolePreset[] = Object.freeze([
  {
    key: 'owner',
    name: 'Owner',
    isOwner: true,
    rationale: 'The single owner role; always holds every catalog permission (§11.3).',
    permissions: OWNER_PERMISSIONS,
  },
  {
    key: 'manager',
    name: 'Manager',
    isOwner: false,
    rationale:
      'Broad operational authority short of the owner-exclusive journal post, and deliberately without sales.viewAll (§42.1 O-8).',
    permissions: MANAGER_PERMISSIONS,
  },
  {
    key: 'cashier',
    name: 'Cashier',
    isOwner: false,
    rationale: 'Sell, take customer payments, apply in-ceiling discounts, and read the catalog and stock.',
    permissions: CASHIER_PERMISSIONS,
  },
  {
    key: 'salesperson',
    name: 'Salesperson',
    isOwner: false,
    rationale: 'The legacy salesOnly role: the minimum needed to sell, and nothing else (§11.3).',
    permissions: SALESPERSON_PERMISSIONS,
  },
  {
    key: 'stockkeeper',
    name: 'Stockkeeper',
    isOwner: false,
    rationale: 'Receive, count, and adjust stock, and read the catalog.',
    permissions: STOCKKEEPER_PERMISSIONS,
  },
  {
    key: 'accountant',
    name: 'Accountant',
    isOwner: false,
    rationale:
      'Read the journal and chart, reconcile treasury, and read customer and supplier records — without the owner-exclusive post.',
    permissions: ACCOUNTANT_PERMISSIONS,
  },
]);

const PRESET_BY_KEY: ReadonlyMap<RolePresetKey, RolePreset> = new Map(
  ROLE_PRESETS.map((preset) => [preset.key, preset]),
);

/** The preset for a key, or `undefined`. */
export function findRolePreset(key: RolePresetKey): RolePreset | undefined {
  return PRESET_BY_KEY.get(key);
}
