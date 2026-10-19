# MY SHOP M3-S1 - Slice Record (declaration)

Status: **declared** (§43.1 G-1/G-2: this record precedes any feature file touch; the
evidence section is filled when the slice's gauntlet is complete).

## 1. Objective

Deliver the Master Plan §40.7 row M3-S1: **typed organization settings — every field
the plan names in §22.2 (as amended by §22.4), `settings_version`, and
`offline_grace_duration` (§22.4) — with validation and audit.**

Governing key acceptance (§40.7): **invalid values are rejected; every change is
audited.**

### 1.1 Authoritative requirements

| Source | What it fixes for this slice |
| --- | --- |
| §22.1 | Typed columns validated by the service layer, never a key-value table; each setting declares type, default, validation, permission, and audit status |
| §22.2 | The setting inventory (below), with "changing `pricing_mode` or a discount ceiling takes effect on the next transaction and is recorded in the audit trail with actor, old value, and new value" |
| §22.3 | Settings are never cached as authority; the server reads them from the database on every transaction that depends on them |
| §22.4 | The M0-P2 amendment: `offline_grace_duration` (owner-exclusive, default 72 h, max 30 days), `offline_receipt_id_format` (enum, `settings.edit`), `offline_reserved_number_blocks` (bool, `settings.edit`), `reserved_block_size` (int default 1000, owner-exclusive); **`allow_negative_stock` is removed by the amendment** and MUST NOT be implemented |
| §38.18 | Offline settings: `settings_version` is a monotonic per-organization integer; the client only reads; server settings always win; there is no local settings edit that syncs upward |
| §38.16.2 / O-13/O-20 | The offline grace window is the organization setting `offline_grace_duration`, default 72 hours, owner-controlled, maximum 30 days |
| §11.2 / §22.2 note in the M2-S3 catalog | Owner-exclusive settings are a **M3-layer policy enforced on top of `settings.edit`/`pricing.policy.edit`**, not new catalog permission ids |
| §32.2/§32.5 | Every protected mutation's audit event commits in the same transaction as the change (class A failure policy), with actor, old value, and new value; no token/credential material ever enters a payload |
| §8.2/§9.3 | Every settings read/write runs inside the trusted tenant transaction (`withTenantTransaction`) with a server-derived organization id; tenant identity and context are never request fields |

## 2. Predecessor and base

| Item | Value |
| --- | --- |
| Predecessor slice | M2-S7 Flutter authentication & session (accepted `PASS_MY_SHOP_M2_S7_REMOTE_LOCKED`) |
| Predecessor branch | `codex/my-shop-m2-s7-flutter-auth-session` |
| Predecessor HEAD verifies as | `d08a6bbdac611278f4d5c17520206de2fda58b83` (local == remote == origin; push run 39262363810 and PR run 39262372433 both green on that SHA) |
| Predecessor PR | #23 (OPEN, base `codex/my-shop-m2-s6-audit-streams`) |
| This slice's branch | `codex/my-shop-m3-s1-typed-organization-settings` (created from the verified M2-S7 head; no rewrite of any accepted history) |
| This PR's base | `codex/my-shop-m2-s7-flutter-auth-session` (stacked; never merged by this slice) |

M2-S8 does **not** exist as a milestone: its repository record (PR #24,
`docs/governance/MY_SHOP_M2_S8_SCOPE_PROPOSAL.md`) is a governance proposal and is
stated here only to make the stacking explicit. Nothing from that branch is used as
an implementation base.

## 3. Architecture assessment (state at declaration)

The backend has: the tenancy foundation (`organizations`, `organization_memberships`
with the single-owner partial unique), the M2-S2/M2-S3 identity and RBAC surfaces with
the six seeded role presets (Owner: every permission; Manager: every non-owner-exclusive
grant except `sales.viewAll` — so Manager holds `settings.view`, `settings.edit`, and
`pricing.policy.edit`), the M2-S4 enforced tenancy (ENABLE + FORCE RLS, one
`tenant_isolation` policy per tenant table, migration history `0001`–`0011`), the M2-S5
device surface, and the M2-S6 durable audit streams with the class-A transactional
`AuditStreamWriter` (`AUDIT` vocabulary currently limited to the §32.2A sync classes
plus `DEVICE_REVOKED`).

There is **no** settings surface: no `organization_settings` table, no migration, no
module, no contract. The permission catalog contains `settings.view`, `settings.edit`,
and `pricing.policy.edit` with no consumer other than future slices. No existing
endpoint reads or writes these settings.

The `organizations.name` column (VarChar 200, bootstrap-validated) is the typed home of
the `organization_name` setting; `feature_flags` arrives as **typed rows** per §22.2 —
a dedicated table whose flag keys are validated against a versioned, in-code catalog
(the §11.2 discipline: no flag vocabulary exists in the plan yet, so the V1 catalog is
empty and any flag attempt is structurally rejected).

## 4. Included scope

1. **Migration `0012_organization_settings`** — forward-only, additive:
   `organization_settings` (one row per organization, all §22.2/§22.4 typed columns
   below, `settings_version` monotonic non-negative integer) and
   `organization_feature_flags` (typed rows: `organization_id` + `flag_key` + `enabled`
   with the flag-key grammar CHECK). Both tables: ENABLE + FORCE RLS, one
   `tenant_isolation` policy, `ORGANIZATION_ID → organizations(id) ON DELETE RESTRICT`.
   No previously accepted migration byte is edited.
2. **Typed settings surface** — module `common/settings/` owning its tables:
   - `GET /api/v1/organizations/:organizationId/settings` — `settings.view`; returns
     every field plus `settings_version` and the last-write timestamp. For an
     organization that predates `0012`, the read lazily materializes the default row
     (version 1) inside its tenant transaction — upgrade compatibility, never silent
     absence.
   - `PUT /api/v1/organizations/:organizationId/settings` — **field-authorized**
     partial update: body fields are optional (absent = untouched) and each provided
     field is checked against the §22.2/§22.4 permission column *inside* the write
     transaction via the M2-S4 `readEffectiveInTransaction` (role grants + owner
     structure); `expectedSettingsVersion` (the concurrency token) is required and a
     mismatch answers the new `409 SETTINGS_VERSION_CONFLICT`. The changed row, the
     version increment, and the `SETTINGS_UPDATED` audit event commit in **one
     transaction** (class A). A body with no settings field is `VALIDATION_FAILED`; an
     all-equal write is recorded as an update with no effective change — it still
     commits a version bump, because an accepted write must be
     distinguishable from a refused one, and refused writes never bump (decision D-G).
3. **Validation** (all enforced server-side, DB CHECKs restating the bounds):
   the full per-field matrix below; unknown members rejected by the global
   forbid-non-whitelisted pipe; enum values outside the plan vocabularies rejected.
4. **Audit** — new `AUDIT_EVENT_TYPES` entry `SETTINGS_UPDATED` (one per accepted
   write) with `{ changes: [{ field, oldValue, newValue }] }`; actor from the verified
   principal; payload carries business values only.
5. **Bootstrap default row** — the composition root materializes the default settings
   row (version 1) inside the organization-creation transaction, so a fresh tenant is
   never without settings.
6. **Contracts** — OpenAPI regenerated from the controller declarations; the generated
   client schemas and `openapi.json` re-synced through the official scripts; drift gate
   green.
7. **Tests** — unit (validation domain), HTTP-boundary e2e (guard order, contract
   surface), real-PostgreSQL acceptance (migration, defaults, versioning, concurrency,
   audit atomicity, RLS/tenant isolation, upgrade from the predecessor state), plus the
   M2 predecessor suites extended where the new table changes their inventories.
8. **Documentation** — README surface note, `docs/rls-inventory.md` table inventory,
   ADR-007 (this record's decisions), this record's evidence section.

## 5. The typed settings inventory (implemented exactly)

One row per organization in `organization_settings` (columns use snake_case; the wire
and contract use camelCase):

| Setting (wire) | Column | Type / DB type | Default | Validation (server + CHECK) | Changing permission |
| --- | --- | --- | --- | --- | --- |
| `settingsVersion` | `settings_version` | monotonic int (bigint ≥ 1) | 1 (bootstrap) | not writable except by an accepted increment | — (system-owned) |
| — | `updated_at` | timestamptz | now | system | — (system-owned) |
| `organizationName` | `organizations.name` | string (VarChar 200) | bootstrap name | trimmed 1..200 chars; written through the tenancy seam in the same transaction | `settings.edit` |
| `currency` | `currency` | enum `('EGP')` | `EGP` | only `EGP` in V1 | `settings.edit` |
| `minorUnitExponent` | `minor_unit_exponent` | int 0..9 | `2` | range CHECK | **owner** |
| `displayNumerals` | `display_numerals` | enum `('WESTERN','EASTERN_ARABIC')` | `WESTERN` | closed vocabulary | `settings.edit` |
| `pricingMode` | `pricing_mode` | enum `('FIXED','VARIABLE','FIXED_WITH_DISCOUNT')` | `FIXED` | closed vocabulary | `pricing.policy.edit` |
| `maxDiscountPercentage` | `max_discount_percentage` | numeric(5,2) | `0` | 0..100 | `pricing.policy.edit` |
| `maxDiscountAmountMinor` | `max_discount_amount_minor` | bigint ≥ 0 | `0` | range CHECK | `pricing.policy.edit` |
| `discountApprovalThresholdMinor` | `discount_approval_threshold_minor` | bigint ≥ 0, nullable | `null` | number ≥ 0 or explicit `null` (clear); absent = untouched | `pricing.policy.edit` |
| `discountAllowedForSalesperson` | `discount_allowed_for_salesperson` | bool | `false` | boolean | `pricing.policy.edit` |
| `blockDiscountBelowCost` | `block_discount_below_cost` | bool | `false` | boolean | `pricing.policy.edit` |
| `invoiceOutputDefault` | `invoice_output_default` | enum `('ALWAYS_ASK','PRINT_AUTOMATICALLY','NO_AUTOMATIC_OUTPUT')` | `ALWAYS_ASK` | closed vocabulary | `settings.edit` |
| `invoiceFooter` | `invoice_footer` | text ≤ 2000 | `''` | non-empty-or-empty string, bounded | `settings.edit` |
| `invoiceShowLogo` | `invoice_show_logo` | bool | `true` | boolean | `settings.edit` |
| `customerRequiredOnCreditSale` | `customer_required_on_credit_sale` | bool | `true` | boolean | `settings.edit` |
| `roundingMode` | `rounding_mode` | enum `('HALF_UP','HALF_EVEN')` | `HALF_UP` | closed vocabulary (§30.6) | **owner** |
| `receivablesAgingEnabled` | `receivables_aging_enabled` | bool | `true` | boolean | `settings.edit` |
| `offlineGraceDurationSeconds` | `offline_grace_duration_seconds` | bigint 1..2592000 (1 s … 30 days) | `259200` (72 h) | range CHECK; §22.4/O-13/O-20 | **owner** |
| `offlineReceiptIdFormat` | `offline_receipt_id_format` | enum `('ORG-DEV-SEQ')` | `ORG-DEV-SEQ` | only the one V1 format (§16.4A.2) | `settings.edit` |
| `offlineReservedNumberBlocks` | `offline_reserved_number_blocks` | bool | `false` | boolean | `settings.edit` |
| `reservedBlockSize` | `reserved_block_size` | int 1..10000 | `1000` | range CHECK; meaningful only while the blocks are enabled | **owner** |
| `featureFlags` | `organization_feature_flags` rows | typed rows, empty | `[]` | `flag_key` validated against the in-code vocabulary (empty in V1 → no flag may exist) | **owner** |

Decision references embedded above are recorded in ADR-007 with their reasoning
(D-A … D-G).

## 6. Explicit exclusions (non-scope, each with its governing reference)

- **`app_lock_enabled`** (§22.2): a **per-device** boolean, not an organization column;
  it arrives with its producing slice (M9 device security). No organization-level
  column is invented for it now.
- **Feature-flag contents**: the plan defines no flag vocabulary, so beyond the typed
  empty-capable table and owner-gated write path nothing is flag-initializable
  (§22.2: typed rows, empty; §40.7 non-scope: "feature flags beyond owner-only").
- **Enforcement consumers** (M3-S2 pricing enforcement, M3-S3 discount policy): this
  slice stores and validates the values that those slices will enforce; no sale path
  changes here.
- **Flutter settings screens / offline settings cache** (§40.7 M3-S4): the client is
  untouched; the settings contract is server-only in this slice and nothing in the
  client yet reads it. `settings_version`'s pull-supersedes-cached-copy consumer also
  arrives with M3-S4.
- **`offline_grace_duration` consumer rewiring** (M1b-S8 D): the signed grace record's
  window is minted today from the documented constant (`AUTHORIZATION_SNAPSHOT_TTL_SECONDS`,
  72 h) and stays exactly as accepted. The typed setting now exists for the slice that
  owns the mint path to read server-authoritatively — the client can never alter a
  server grace policy by editing local persistence (§38.18), and this slice's
  fail-closed grace behavior is unchanged.
- **Offline settings mutation on the outbox path**: none exists and none is added;
  settings are server-owned read-only for the client (§38.18 "no local settings edit
  that syncs upward").
- **Role/ownership changes, merges, deployments** (G-12 owner-only), CI workflow
  changes.

## 7. Security and regression invariants (inherited, must survive)

Keystore-only token custody; no tokens or credential material in any audit/log payload;
fail-closed session and device verification; revocation stronger than grace; server-side
RBAC with owner-exclusivity structural to the settings layer; forced RLS on the new
tenant tables with cross-tenant refusal proved by the acceptance suite; transactional
audit (class A) — a settings change and its audit row commit or roll back together;
append-only audit streams; migrated history immutable (`0001`–`0011` untouched, `0012`
additive); the T-O6 deferral remains deferred, untouched. The predecessor Flutter
suite (403 passed / 1 skipped) must remain green with zero client changes.

## 8. Validation requirements (test matrix)

- Initial state: fresh organization → exactly the §22.2/§22.4 defaults, version 1.
- Read: owner, manager (`settings.view`), cashier (refused `settings.view`),
  cross-organization (refused), unauthenticated (refused).
- Write: accepted owner write of every field; version increments by exactly one;
  audit row appended in the same transaction (`SETTINGS_UPDATED`, old/new values);
  unauthorized attempts (cashier writes anything, manager writes an owner-exclusive
  field) refused `PERMISSION_DENIED` with **no version bump, no partial write, no
  audit row**.
- Versioning: stale `expectedSettingsVersion` → `409 SETTINGS_VERSION_CONFLICT`, no
  partial write; two concurrent writers serialize (one wins, the other conflicts);
  a write to a missing-version row materializes defaults first.
- Validation: each range/enum/bound refuted at the pipe (400 `VALIDATION_FAILED`) and,
  for service-level rules, with the same code; null/absent distinction for
  `discountApprovalThresholdMinor`; empty-body PUT refused; unknown members refused.
- Database: migration from empty; upgrade from the `0011` state keeps predecessor rows
  and adds defaults lazily; invalid column values (raw SQL) refused by CHECKs; forced
  RLS fail-closed without context, cross-tenant insert/update/delete/move refused;
  concurrent transactions isolated; audit row + version + row commit or roll back as
  one.

## 9. CI requirements

Every existing required job must stay green on the final SHA: `fast-checks`,
`backend-unit`, `backend-integration-database` (real PostgreSQL 18),
`contract-drift`, `dependency-audit`, `flutter-build-windows`,
`flutter-build-android`. Push and pull-request events both recorded.

## 10. Completion criteria

The §40.7 row's acceptance ("invalid values rejected; every change audited") is
demonstrated by the suites above on the final implementation SHA, all gates green,
the PR created stacked on the M2-S7 base with no merge performed, and the remote CI
evidence recorded on the exact final SHA in this record's evidence section.
