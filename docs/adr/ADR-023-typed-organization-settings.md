# ADR-023 — Typed organization settings, not a free-form key-value store

Master Plan §41 (row ADR-023); §22, §22.1–§22.4; §40.7 row M3-S1 (the slice that
implements it). Status: **Accepted**.

## Context

Every organization needs configuration: the currency and minor-unit exponent it
prices in (§17, §22.2), the discount policy its pricing mode composes with (§18),
the invoice output behaviour (§21.2), the offline grace window and the reserved
receipt-number block (§22.4, O-13/O-20, §16.4A.2), and a set of feature flags
(§22.2). The settings must be readable by clients and offline revalidators
alike, they must be versioned so a reader can detect staleness (§38.18), and
they must be changeable only by whoever the §22.2 permission column names.

Before any migration existed, a tempting default was a key-value table: one
`settings(key, value)` pair per setting, or a single untyped JSON column. Both
accept everything and type nothing — the exact posture §22.1 forbids: "typed
columns validated by the service layer", because at the point of sale money
formatting and rounding depend on these values and must not "somehow work" on a
stringified guess.

## Decision

Configuration lives in one **`organization_settings` row per tenant**
(migration `0012`), every setting a **typed column** with its own default, bound,
and database CHECK, plus a second tenant-owned table `organization_feature_flags`
whose row type is `(organization_id, flag_key, enabled)`. Three properties are
part of the decision:

1. **The §38.18 staleness token is a column.** `settings_version` is a
   monotonic bigint that advances by exactly one in the same transaction as
   every accepted write (and for an accepted no-op-equivalent write — D-G) and
   never moves on a refused, conflicting, or failing one. Every response and
   every change-feed consumer can therefore detect staleness from the same
   fingerprint; there is no separate "settings change feed" to miss an update
   with.
2. **The flag vocabulary is a versioned catalog in application code** (the
   §11.2 permission-catalog discipline). The database CHECK restates only the
   key grammar; an unknown key is refused by the service, never invented. No
   flag exists in V1 — the honest state of a fresh organization is zero flag
   rows.
3. **Authorization is a field property, enforced inside the write
   transaction.** The `settings.edit` / `pricing.policy.edit` /
   owner-exclusive column from §22.2/§22.4 is resolved through the M2-S4
   effective-permission read in the same transaction that commits the change,
   per provided field. The PUT route carries no permission of its own; a
   caller who only half-holds authority is refused before any statement, with
   no partial write and no version bump.

Where the value is an existing fact, the settings surface does not duplicate a
column: the organization's display name rides the tenancy seam
(`organizations.name`, §9.2's single source of truth) inside the same
transaction. `app_lock_enabled` is deliberately absent — §22.2 scopes it per
device, and M9 owns wherever it lands. `allow_negative_stock` is not merely
absent but inadmissible: the M0-P2 amendment removes it from the inventory and
§38.4 forbids the behaviour unconditionally.

## Rationale

- **Typed columns make the money-related settings independently checkable.** A
  `MINOR_UNIT_EXPONENT` of `-1` is rejected by a CHECK, not by a client that
  happens to parse it kindly (§22.1's refusal, not coercion). The database is
  the last line of the same three lines of defence the settings service
  implements (§8.3).
- **A per-tenant singleton version (§38.18) is the cheapest honest staleness
  semantics.** Alternative — per-field `updated_at` — would make an offline
  reader compare one field at a time, and a partially-read settings snapshot
  could compose values from two different epochs (currency from one, rounding
  from another). One version per organization photographs the whole inventory.
- **The empty V1 flag catalog is a decision, not a placeholder gap.** It keeps
  the surface closed: refusing every flag until a governing slice defines one
  means no flag can carry business weight without an owner record (§31.2).

## Consequences

- Growing the inventory (a new currency, a new flag) is a governing decision
  plus a migration adding a typed column, never "just another string in the
  bundle"; the three validation layers must agree byte-for-byte on the bound
  (enforced by this slice's acceptance suite, not by promise).
- Every consumer (pricing, printing, offline admission, receipts) reads from
  the snapshot semantics the version provides; §38.18's monotonicity is
  acceptance-tested against real PostgreSQL, including the concurrency
  compromise (a per-organization advisory lock serializing writers, the
  optimistic token classifying the loser).
- A settings write is class-A history: the committed change and its
  `SETTINGS_UPDATED` audit row commit or roll back together (§32.5), so the
  audit stream's gapless chain names every accepted configuration change.

## Rejected alternatives

- **A free-form `key`/`value` or JSON bundle** — each field loses the type,
  bound, and default it must independently carry; an untyped store cannot be
  the "validated by the service layer" §22.1 demands without re-implementing
  per-key typing in every reader, which is where errors live.
- **A `settings` JSON column on `organizations`** — one mutable blob defeats
  the per-field permission column, the CHECK constraints, and the RLS-shape
  (the whole blob moves tenant in an ownership-move attack it must never
  move).
- **Per-field `updated_at` staleness** — rejected above; a cross-field
  invariant (like the discount ceiling and its approval threshold) could
  never be compared from the same epoch.
- **Seeding defaults at first write only (no singleton row at bootstrap)** —
  rejected: bootstrap materializes the row (version 1) in the composition
  root, and the settings service materializes it lazily for an organization
  that predates migration `0012`, so a reader always receives a complete,
  versioned answer rather than absence (§38.18's safe fallback, read from the
  server side).
