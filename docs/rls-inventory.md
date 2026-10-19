# Row-level security inventory — tenant-owned tables (M2-S4, extended by M2-S5/M2-S6; M3-S1)

Master Plan §8.1–§8.3 requires tenant isolation at the **database layer**. This
document is the human-readable inventory of that enforcement; the machine
enforcement is the table-inventory acceptance test
(`test/database/tenant-rls.db-spec.ts`, AC-01/AC-02), which fails when this
inventory and the database disagree.

One mechanism, one invariant: every tenant-owned table carries `ENABLE` +
`FORCE` row-level security and one `FOR ALL` policy named `tenant_isolation`
that compares the row's tenant column against a transaction-local trusted
context. A statement outside that context — wrong tenant, missing scope, a
pooled connection that never saw the caller — sees no rows and can write none:
fail-closed by database predicate, not by application convention.

## The trusted context

`src/common/database/tenant-context.ts` is the only code that sets a tenant
setting. Every entry point takes a value the caller has already verified (a
route organization checked against the token, the authenticated sync trusted
context, a server-resolved account id, the operator bootstrap key); a request
body never reaches any of them. The settings are set through parameterized
`set_config(<name>, <value>, is_local => true)` inside the caller's
transaction — the parameterized equivalent of §8.2's `SET LOCAL`. `is_local =
true` is the whole design: the setting exists only for the transaction that
reads it, is gone at commit, is gone at rollback, and a pooled connection
carries none. There is no session `SET` anywhere and no mutable module state.

| Setting | Decision record | Source | Effect on the policies |
| --- | --- | --- | --- |
| `app.current_organization_id` | §9.3 step 5 | The verified tenant scope (guard-checked route, sync trusted context) | The tenant predicate on every tenant-owned table |
| `app.current_user_id` | D-A (slice record §9) | A server-resolved account record during identity flows | `USING`-only clause showing the caller exactly their own membership edges across organizations (T-4) |
| `app.current_bootstrap_key` | D-B (slice record §9) | The §10.4 operator command's own key | Unlocks exactly its stored tenant root for idempotent classification |

`current_setting(<name>, true)` returns — never raises — NULL when the setting
is absent; NULL keeps the predicate NULL, which filters the row out exactly
like `false`. "No context" is therefore "no rows" for every connection: the
application role mid-flight, an operator `psql`, a stray pooled session.

## Table inventory — migrations `0008_tenant_row_level_security`, `0009_device_binding`, `0010_audit_streams` + `0011_audit_stream_head_grant`, `0012_organization_settings`

### Tenant-owned (forced RLS + `tenant_isolation` policy)

| Table | Tenant column | Policy shape |
| --- | --- | --- |
| `organizations` | `id` (tenant root) | `USING`/`WITH CHECK` tenant clause + bootstrap-key clause (D-B) |
| `organization_memberships` | `organization_id` | `USING` tenant + own-identity clause (D-A); `WITH CHECK` tenant only |
| `roles` | `organization_id` | Symmetric `USING`/`WITH CHECK` tenant clause |
| `role_permissions` | `organization_id` | Symmetric tenant clause |
| `permission_overrides` | `organization_id` | Symmetric tenant clause |
| `mutation_ledger` | `organization_id` | Symmetric tenant clause |
| `change_log` | `organization_id` | Symmetric tenant clause |
| `device_sync_cursors` | `organization_id` | Symmetric tenant clause |
| `sync_sequences` | `organization_id` | Symmetric tenant clause |
| `devices` (M2-S5) | `organization_id` | Symmetric tenant clause — the identical `ENABLE` + `FORCE` + `tenant_isolation` posture, applied by `0009` |
| `organization_settings` (M3-S1) | `organization_id` | Symmetric tenant clause — the §22.2/§22.4 settings singleton (one row per tenant), applied by `0012` |
| `organization_feature_flags` (M3-S1) | `organization_id` | Symmetric tenant clause — the §22.2 typed flag rows, one FK step from the settings singleton, applied by `0012` |

The tenant root needs no `organization_id` — its own `id` is the tenant
column; the eleven others key on `organization_id`.

### Explicitly global (no RLS, classified on purpose)

| Table | Why global |
| --- | --- |
| `users` | Per-identity account data; no `organization_id` |
| `user_credentials` | Per-identity secret data (argon2); no `organization_id` |
| `sessions` | Per-session authentication state; no `organization_id` |
| `refresh_tokens` | Per-session rotation state; no `organization_id` |
| `auth_throttles` | Per-identity throttle state; no `organization_id` |

`sessions` gains `device_id` (M2-S5) — a *reference* to a forced-RLS-protected
`devices` row, not a tenant column: the table-inventory test still pins the
five identity tables as global, and every device read or write that uses the
binding runs inside a tenant transaction scoped to the device's own
organization.

Login, session, and throttle state are per-identity, never per-tenant. The
table-inventory test pins this classification so a future tenant column cannot
silently appear without an explicit decision (and, the other direction, any
future table carrying `organization_id` without forced RLS fails the suite).

### The M2-S6 audit-stream class (forced RLS, scoped on purpose)

| Table | Tenant column | Policy shape |
| --- | --- | --- |
| `audit_events` (M2-S6) | `organization_id` | Symmetric tenant clause; tenant-owned chain rows, no deliberate nil-scope admission |
| `security_events` (M2-S6) | `organization_id` (NULL on the GLOBAL partition) | Tenant clause **plus** the documented GLOBAL admission: a context-free statement still reads/writes `organization_id IS NULL` rows; a tenant context never sees foreign tenant rows |
| `audit_stream_heads` (M2-S6) | `scope` (organization id, or the single GLOBAL sentinel head) | `USING`/`WITH CHECK` on the scope id; the sentinel-scope head row is the one documented nil-scope admittance (fail-open by exactly one singleton, not by predicate absence) |

Grant posture after migrations `0010` + `0011` (§32.5): `my_shop_app` holds
INSERT + SELECT and **no UPDATE and no DELETE** on both event tables — the
top of the table never gets touched by the application at privilege
resolution. `audit_stream_heads` keeps exactly one bounded extra privilege,
its head-row UPDATE: the anchor holds no event data, and the advance of
`(last_sequence, last_event_hash)` inside the append transaction is the
atomic companion of every insert — the gapless-rollback discipline itself.
0011 records the full safety argument (a rewound anchor cannot forge a chain,
collides with the unique indexes instead of double-allocating, and still
carries no DELETE). This grant shape is a database fact asserted by the
privilege-probe acceptance tests, not enforced by code convention.

## Uniqueness and ownership are unchanged

`uq_organizations_single_owner`, `uq_roles_single_owner`, the composite tenant
foreign keys, and the advisory-lock ordering all still say what they said in
migrations `0003`–`0007`. RLS is a *scope* on visibility, never a replacement
for those invariants.

## FORCE and the migrator

`FORCE ROW LEVEL SECURITY` applies the policy to the table **owner** as well —
the migrator role. Nothing in the application graph, present or future, reads
a tenant table outside its transaction. Migrations are unaffected: policy DDL
runs under table ownership before or without the policy.

## Operations

- **Fresh install:** migrations `0001`–`0012` apply from empty (`node
  scripts/db.mjs deploy`); the drift gate (`prisma migrate diff --exit-code`)
  still exits 0 — PostgreSQL policies, CHECK constraints, and grants do not
  appear in Prisma's diff.
- **Upgrade:** `0008`/`0009` change no role, no grant, no owner, and no
  pre-existing data; the upgrade acceptance case (AC-08) seeds full
  predecessor-shaped data on `0001`–`0007`, applies the later migrations, and
  proves every pre-existing row survives byte-identical with RLS in force.
- **Rollback:** forward-only (§35.1) — a *new* migration re-issues correct
  policies. Dropping a policy is an emergency isolation-reduction decision
  requiring owner authorization, never the automatic path.
