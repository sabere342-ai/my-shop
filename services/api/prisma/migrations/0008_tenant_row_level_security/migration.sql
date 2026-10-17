-- My Shop — tenant row-level security (Master Plan §8.1–§8.3, §9.3–§9.4,
-- §40.6 slice M2-S4; invariants T-1…T-7).
--
-- One mechanism, one invariant: every tenant-owned table is protected by
-- ENABLE + FORCE row-level security with a policy that compares the row's
-- tenant column against a transaction-local trusted context. A statement
-- outside that context — wrong tenant, missing scope, a pooled connection
-- that never saw the caller — sees no rows and can write none:
-- fail-closed by database predicate, not by application convention.
--
-- The trusted context (services/api/src/common/database/tenant-context.ts):
-- the application role sets the three settings through parameterized
-- `set_config(<name>, <value>, is_local => true)` inside its transactions.
-- `is_local = true` is the whole design: a setting exists only for the
-- transaction that reads it, is gone at commit, is gone at rollback, and a
-- pooled connection carries none. There is no session `SET` anywhere.
--
-- The three settings, each server-derived (never client input):
--
--   app.current_organization_id  the §9.3 step-5 tenant scope; validated as a
--                                canonical UUID by the application wrapper
--    before `set_config`, and re-proven by this cast as defence in depth
--   app.current_user_id          decision D-A (record §9): the verified
--                                account id during §10 identity flows, which
--                                makes exactly the caller's own membership
--                                edges visible (T-4), in USING only
--   app.current_bootstrap_key    decision D-B (record §9): the §10.4
--                                operator command's own key, which unlocks
--                                exactly its tenant root for idempotent
--                                classification
--
-- `current_setting(<name>, true)` never raises when the setting is absent:
-- it returns NULL, the cast keeps it NULL, the predicate is NULL — not false,
-- NULL — and NULL in a policy filters the row out exactly like false does.
-- So "no context" is "no rows", whether the connection is the application
-- role mid-flight, an operator psql, or a stray pooled session.
--
-- One PostgreSQL semantic is normalized here on purpose: a placeholder GUC a
-- transaction set with `set_config(..., is_local => true)` keeps its *name*
-- defined on that pooled session after COMMIT — with an empty value — so the
-- next context-free statement on the same session reads an empty string, not
-- NULL. `NULLIF(current_setting(...), '')` makes absent and empty the same
-- case before any cast: both become NULL, both predicates become NULL, and
-- both filter the row out. This normalizes nothing into the open direction —
-- a real organization id and a real user id are canonical UUIDs (asserted by
-- the wrapper before any `set_config`), and a real bootstrap key is never
-- empty (§10.4 grammar) — it only keeps "no context" fail-closed on every
-- pooled session, no matter what earlier transactions did on it.
--
-- Table classification (record §4, pinned by the table-inventory
-- acceptance test):
--
--   Tenant-owned (this migration): organizations (tenant column: `id`),
--     organization_memberships, roles, role_permissions,
--     permission_overrides, mutation_ledger, change_log,
--     device_sync_cursors, sync_sequences.
--   Explicitly global — no RLS and no tenant column, classified on purpose:
--     users, user_credentials, sessions, refresh_tokens, auth_throttles.
--     Login, session, and throttle state are per-identity, never per-tenant.
--
-- Policy shapes per table:
--
--   tenants            every column set: tenant + (identity, bootstrap) clause
--   membership edges   USING tenant + own-identity clause (D-A);
--                      WITH CHECK tenant only — writes stay strictly
--                      organization-scoped, so identity flows can read their
--                      own edges but never write another tenant's
--   everything else    symmetric USING / WITH CHECK on the tenant column,
--                      a policy named `tenant_isolation` on every table
--
-- Uniqueness and ownership are unchanged: `uq_organizations_single_owner`,
-- `uq_roles_single_owner`, the composite tenant foreign keys, and the
-- advisory-lock ordering all still say what they said in `0003`–`0007` — RLS
-- is a *scope* on visibility, never a replacement for those invariants.
--
-- Audit rules honoured (§8.3, gate G-9), continuing the discipline of
-- `0003`–`0007` and `prisma/roles.sql`: no GRANT, no REVOKE, no role change,
-- no SECURITY DEFINER, no BYPASSRLS, no search_path change, no
-- interpolation — every name and literal below is a constant. `FORCE` applies
-- the policy to the migrator as owner too, so nothing in the application
-- graph, present or future, reads a tenant table outside its transaction.

-- ---------------------------------------------------------------------------
-- 1. The tenant root (§9.2 T-1/T-6): its own isolation column is `id`.
--    WITH CHECK admits an insert through the application role only when the
--    row matches the transaction's tenant scope. The bootstrap composition
--    root satisfies the tenant clause by minting the id server-side and
--    re-scoping the transaction before the membership write
--    (organization.service.ts, createOrganizationWithOwner); the
--    bootstrap-key clause (D-B) is the §10.4 classification credential.
-- ---------------------------------------------------------------------------
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organizations" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "organizations"
  FOR ALL
  USING (
    "id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
    OR "bootstrap_key" = NULLIF(current_setting('app.current_bootstrap_key', true), '')
  )
  WITH CHECK (
    "id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
    OR "bootstrap_key" = NULLIF(current_setting('app.current_bootstrap_key', true), '')
  );

-- ---------------------------------------------------------------------------
-- 2. The membership edge (§9.2 T-2/T-4/T-11). USING also admits the caller's
--    own rows across organizations (decision D-A) — the same data the signed
--    access token's organizations claim carries, re-resolvable at login and
--    rotation without exposing any other tenant's row, column, or existence.
--    WITH CHECK is the tenant clause alone: identity flows read their own
--    edges; every write to the edge table is still organization-scoped.
-- ---------------------------------------------------------------------------
ALTER TABLE "organization_memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization_memberships" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "organization_memberships"
  FOR ALL
  USING (
    "organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
    OR "user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  )
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- 3. The §11 RBAC surface (0007): role data and its grant/override edges are
--    tenant data. The composite (id, organization_id) foreign keys and the
--    unique-per-tenant keys already forbid cross-tenant reference; the policy
--    makes the rows themselves invisible outside the tenant transaction, so
--    even a resolver fed a foreign id falls into the same `null` branch as a
--    missing row (fail-closed, no existence leak).
-- ---------------------------------------------------------------------------
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "roles"
  FOR ALL
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "role_permissions"
  FOR ALL
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

ALTER TABLE "permission_overrides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "permission_overrides" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "permission_overrides"
  FOR ALL
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- 4. The offline-mutation surface (§38.8–§38.11): the per-mutation ledger,
--    the feed, the per-device cursors, and the per-organization sequence. These
--    are the tables the M2-S4 acceptance transactions run inside — the
--    mutation ledger's advisory-lock → idempotency → re-validation → effect →
--    cursor ordering is unchanged from `0002`; the policy now scopes every
--    statement in that order to the tenant the trusted context named, making
--    the cross-tenant idempotency lookup and cross-tenant pull of §38.16.4
--    unrepresentable at the database layer as well.
-- ---------------------------------------------------------------------------
ALTER TABLE "mutation_ledger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mutation_ledger" FORCE ROW LEVEL SECURITY;

ALTER TABLE "change_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "change_log" FORCE ROW LEVEL SECURITY;

ALTER TABLE "device_sync_cursors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "device_sync_cursors" FORCE ROW LEVEL SECURITY;

ALTER TABLE "sync_sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sync_sequences" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "mutation_ledger"
  FOR ALL
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

CREATE POLICY "tenant_isolation" ON "change_log"
  FOR ALL
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

CREATE POLICY "tenant_isolation" ON "device_sync_cursors"
  FOR ALL
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

CREATE POLICY "tenant_isolation" ON "sync_sequences"
  FOR ALL
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
