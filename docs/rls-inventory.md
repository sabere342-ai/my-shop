# Row-level security inventory — tenant-owned tables (M2-S4)

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

## Table inventory — migration `0008_tenant_row_level_security`

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

The tenant root needs no `organization_id` — its own `id` is the tenant
column; the eight others key on `organization_id`.

### Explicitly global (no RLS, classified on purpose)

| Table | Why global |
| --- | --- |
| `users` | Per-identity account data; no `organization_id` |
| `user_credentials` | Per-identity secret data (argon2); no `organization_id` |
| `sessions` | Per-session authentication state; no `organization_id` |
| `refresh_tokens` | Per-session rotation state; no `organization_id` |
| `auth_throttles` | Per-identity throttle state; no `organization_id` |

Login, session, and throttle state are per-identity, never per-tenant. The
table-inventory test pins this classification so a future tenant column cannot
silently appear without an explicit decision (and, the other direction, any
future table carrying `organization_id` without forced RLS fails the suite).

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

- **Fresh install:** migrations `0001`–`0008` apply from empty (`node
  scripts/db.mjs deploy`); the drift gate (`prisma migrate diff --exit-code`)
  still exits 0 — PostgreSQL policies do not appear in Prisma's diff.
- **Upgrade:** `0008` changes no role, no grant, no owner, and no data; the
  upgrade acceptance case (AC-08) seeds full predecessor-shaped data on
  `0001`–`0007`, applies `0008`, and proves every pre-existing row survives
  byte-identical with RLS in force.
- **Rollback:** forward-only (§35.1) — a *new* migration re-issues correct
  policies. Dropping a policy is an emergency isolation-reduction decision
  requiring owner authorization, never the automatic path.
