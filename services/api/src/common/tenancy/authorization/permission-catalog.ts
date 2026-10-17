/**
 * §11.1/§11.2 / §40.6 M2-S3 — the **versioned permission catalog**.
 *
 * §11.2 is explicit that permissions are **strings in a versioned catalog, never a
 * database enum**, so the catalog can grow without a schema migration. This file is
 * that catalog: the single source of truth for every permission id the server knows,
 * its category, a human description, and the one structural flag the model turns on —
 * `ownerExclusive`.
 *
 * The catalog is the authoritative §11.2 table (36 ids across nine categories). The
 * engine brief that seeded this slice described "34 permission ids across 8
 * categories"; the Master Plan wins (§43.4), and the discrepancy is recorded in the
 * slice record (§12). The brief's own parenthetical already enumerates nine category
 * names, so the count difference is the brief's, not the plan's.
 *
 * **Why a code constant and not a table.** A `permissions` table would make the
 * catalog a deployment artefact and turn every new permission into a migration — the
 * exact coupling §11.2 rejects. The database instead stores only *grant edges*
 * (`role_permissions`, `permission_overrides`) whose `permission_id` is a plain
 * string, constrained by a grammar CHECK but never by a foreign key to a catalog
 * table. An id the code does not know is therefore *inert*: it can be stored by a
 * future writer, but the resolver ignores it (fail closed), so an unknown id grants
 * nothing and denies nothing.
 *
 * `PERMISSION_CATALOG_VERSION` is carried in the signed authorization snapshot
 * (§38.16.3, §38.17) so a snapshot minted against an older catalog is refused rather
 * than silently interpreted under a new meaning. Adding, removing, or re-meaning a
 * permission id is a catalog-version change; this slice pins version 1.
 */

/** The nine §11.2 category rows. A closed set: a new category is a catalog change. */
export const PERMISSION_CATEGORIES = [
  'catalog',
  'inventory',
  'sales',
  'pricing',
  'customers',
  'suppliers',
  'treasury',
  'accounting',
  'administration',
] as const;

/** One of the nine §11.2 categories. */
export type PermissionCategory = (typeof PERMISSION_CATEGORIES)[number];

/**
 * The catalog version carried by a signed snapshot. Bumping it is the whole of the
 * change needed to invalidate outstanding snapshots that were minted against a
 * different catalog shape.
 */
export const PERMISSION_CATALOG_VERSION = 1;

/**
 * A permission id at the type level is still `string`: the catalog is runtime data
 * (§11.2), and a nominal type would only pretend the compiler knows an id the
 * database may hold but this build does not. Every boundary validates with
 * `isPermissionId`.
 */
export type PermissionId = string;

/** One catalog entry. */
export interface PermissionDefinition {
  readonly id: PermissionId;
  readonly category: PermissionCategory;
  /** Human-facing description. Never used for decisions — only documentation. */
  readonly description: string;
  /**
   * §11.2: `ownerExclusive` makes the permission **structurally ungrantable** to a
   * non-owner. It is a property of the permission, not of a role, so no role edit and
   * no `ALLOW` override can confer it on a non-owner (§38.17).
   */
  readonly ownerExclusive: boolean;
}

/**
 * The §11.2 catalog, verbatim.
 *
 * Exactly one entry is `ownerExclusive`: `accounting.journal.post`, the manual-journal
 * authority §25.4/§28.4 reserve for the owner. §22.2/§22.4 make *changing a setting*
 * owner-only too, but that is a policy the M3 settings layer enforces on top of
 * `settings.edit` — it is not a separate catalog permission, so it is not modelled
 * here.
 */
export const PERMISSION_CATALOG: readonly PermissionDefinition[] = Object.freeze([
  // --- Catalog (§11.2) ---
  { id: 'catalog.view', category: 'catalog', description: 'View the product catalog.', ownerExclusive: false },
  { id: 'catalog.edit', category: 'catalog', description: 'Create and edit products.', ownerExclusive: false },
  {
    id: 'catalog.cost.edit',
    category: 'catalog',
    description: 'View and edit product cost prices.',
    ownerExclusive: false,
  },

  // --- Inventory (§11.2) ---
  { id: 'inventory.view', category: 'inventory', description: 'View stock levels.', ownerExclusive: false },
  { id: 'inventory.receive', category: 'inventory', description: 'Receive stock.', ownerExclusive: false },
  {
    id: 'inventory.adjust',
    category: 'inventory',
    description: 'Adjust stock with a reason code.',
    ownerExclusive: false,
  },
  { id: 'inventory.count', category: 'inventory', description: 'Perform stock counts.', ownerExclusive: false },

  // --- Sales (§11.2) ---
  { id: 'sales.view', category: 'sales', description: 'View sales the user made.', ownerExclusive: false },
  { id: 'sales.create', category: 'sales', description: 'Create a sale.', ownerExclusive: false },
  {
    id: 'sales.viewAll',
    category: 'sales',
    description: 'View every sale in the organization, not only the user’s own.',
    ownerExclusive: false,
  },
  { id: 'sales.return', category: 'sales', description: 'Record a return.', ownerExclusive: false },
  { id: 'sales.cancel', category: 'sales', description: 'Cancel a sale.', ownerExclusive: false },

  // --- Pricing (§11.2) ---
  {
    id: 'pricing.override',
    category: 'pricing',
    description: 'Override the list price of a line.',
    ownerExclusive: false,
  },
  {
    id: 'pricing.discount.apply',
    category: 'pricing',
    description: 'Apply a discount within the permitted ceiling.',
    ownerExclusive: false,
  },
  {
    id: 'pricing.discount.approve',
    category: 'pricing',
    description: 'Approve a discount beyond the automatic ceiling.',
    ownerExclusive: false,
  },

  // --- Customers (§11.2) ---
  { id: 'customers.view', category: 'customers', description: 'View customer records.', ownerExclusive: false },
  {
    id: 'customers.edit',
    category: 'customers',
    description: 'Create and edit customer records.',
    ownerExclusive: false,
  },
  { id: 'customers.collect', category: 'customers', description: 'Collect a customer payment.', ownerExclusive: false },

  // --- Suppliers (§11.2) ---
  { id: 'suppliers.view', category: 'suppliers', description: 'View supplier records.', ownerExclusive: false },
  {
    id: 'suppliers.edit',
    category: 'suppliers',
    description: 'Create and edit supplier records.',
    ownerExclusive: false,
  },
  { id: 'suppliers.pay', category: 'suppliers', description: 'Record a supplier payment.', ownerExclusive: false },

  // --- Treasury (§11.2) ---
  {
    id: 'treasury.view',
    category: 'treasury',
    description: 'View treasury balances and movements.',
    ownerExclusive: false,
  },
  {
    id: 'treasury.transfer',
    category: 'treasury',
    description: 'Transfer between treasury accounts.',
    ownerExclusive: false,
  },
  {
    id: 'treasury.reconcile',
    category: 'treasury',
    description: 'Reconcile a treasury account.',
    ownerExclusive: false,
  },

  // --- Accounting (§11.2) ---
  { id: 'accounting.view', category: 'accounting', description: 'View accounting entries.', ownerExclusive: false },
  {
    id: 'accounting.journal.read',
    category: 'accounting',
    description: 'Read the journal.',
    ownerExclusive: false,
  },
  {
    id: 'accounting.journal.post',
    category: 'accounting',
    description: 'Post a manual journal entry (owner-exclusive).',
    ownerExclusive: true,
  },
  {
    id: 'accounting.chart.manage',
    category: 'accounting',
    description: 'Manage the chart of accounts.',
    ownerExclusive: false,
  },

  // --- Administration (§11.2) ---
  {
    id: 'settings.view',
    category: 'administration',
    description: 'View organization settings.',
    ownerExclusive: false,
  },
  {
    id: 'settings.edit',
    category: 'administration',
    description: 'Edit organization settings.',
    ownerExclusive: false,
  },
  {
    id: 'pricing.policy.edit',
    category: 'administration',
    description: 'Edit the pricing and discount policy.',
    ownerExclusive: false,
  },
  {
    id: 'users.manage',
    category: 'administration',
    description: 'Manage organization members.',
    ownerExclusive: false,
  },
  {
    id: 'roles.manage',
    category: 'administration',
    description: 'Manage roles and their permissions.',
    ownerExclusive: false,
  },
  { id: 'devices.view', category: 'administration', description: 'View registered devices.', ownerExclusive: false },
  {
    id: 'devices.revoke',
    category: 'administration',
    description: 'Revoke a registered device.',
    ownerExclusive: false,
  },
  { id: 'audit.view', category: 'administration', description: 'View the audit trail.', ownerExclusive: false },
]);

/** Every catalog id, in catalog order. */
export const PERMISSION_IDS: readonly PermissionId[] = Object.freeze(PERMISSION_CATALOG.map((entry) => entry.id));

/** The ids that are `ownerExclusive` (§11.2). Exactly one today. */
export const OWNER_EXCLUSIVE_PERMISSION_IDS: readonly PermissionId[] = Object.freeze(
  PERMISSION_CATALOG.filter((entry) => entry.ownerExclusive).map((entry) => entry.id),
);

const BY_ID: ReadonlyMap<PermissionId, PermissionDefinition> = new Map(
  PERMISSION_CATALOG.map((entry) => [entry.id, entry]),
);

/**
 * The single grammar every permission id obeys.
 *
 * Mirrored by the `chk_role_permissions_permission_id_shape` and
 * `chk_permission_overrides_permission_id_shape` CHECK constraints in migration
 * `0007`, so an id the service would refuse cannot be stored by a writer that
 * bypasses it either (the F-3 discipline). A leading lower-case segment keeps ids
 * assembly-safe; a later segment may carry an inner capital (`viewAll`).
 */
export const PERMISSION_ID_PATTERN = /^[a-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)*$/;

/** True when `value` is a well-formed permission id, whether or not it is in the catalog. */
export function isPermissionIdShape(value: string): boolean {
  return PERMISSION_ID_PATTERN.test(value);
}

/** The catalog entry for an id, or `undefined` when the id is not in this catalog. */
export function findPermission(id: PermissionId): PermissionDefinition | undefined {
  return BY_ID.get(id);
}

/** True when `id` is a permission this build serves. */
export function isPermissionId(id: PermissionId): boolean {
  return BY_ID.has(id);
}

/** True when `id` is a known `ownerExclusive` permission (§11.2). */
export function isOwnerExclusivePermission(id: PermissionId): boolean {
  return BY_ID.get(id)?.ownerExclusive === true;
}
