# MY SHOP — M2-S4 slice record — Tenancy Enforcement, Transaction-Scoped RLS, Offline Mutation Ingress Re-validation

Status: **accepted engineering slice (evidence recorded at close), awaiting owner merge authorization (G-12).**

Predecessor: M2-S3 (`codex/my-shop-m2-s3-rbac-permissions`, locked `214b56f0e0e3ef7f148591ace57ae188908e8e7f`, PR #19 `PASS_MY_SHOP_M2_S3_RBAC_REMOTE_LOCKED`).

---

## 1. Objective

Enforce tenant isolation at the **database layer** for every tenant-owned table (Master Plan
§8.1–§8.3, invariants T-1…T-7) through a single trusted, transaction-scoped tenant context
(§9.3), and extend the existing offline mutation ingress with **current, server-side
re-validation** at acceptance (§9.4 T-8…T-12, §38.16.4) — without replacing the M1b sync
foundations, without weakening the fail-closed production sync boundary, and without
pretending that device enrolment (M2-S5) or durable audit streams (M2-S6) exist.

## 2. Scope

In scope (allowed paths and their defensible relationship):

| Area | Paths | Relationship to the slice |
| --- | --- | --- |
| Slice record | `docs/governance/MY_SHOP_M2_S4_SLICE_RECORD.md` | Governance evidence (§43.1). |
| Migration | `services/api/prisma/migrations/0008_tenant_row_level_security/` | The only migration path; `0001`–`0007` immutable (§35.1). |
| Schema comment | `services/api/prisma/schema.prisma` | Documentation of the RLS posture the history carries; no model change. |
| Trusted transaction context | `services/api/src/common/database/tenant-context.ts` (+ spec) | The single transaction-local `SET LOCAL`-equivalent mechanism (§8.2, §9.3). |
| Identity compatibility | `services/api/src/common/identity/auth.service.ts` | Login/refresh must resolve multi-org memberships under the new membership policy (T-4); documented engineering decision §9 below. |
| Tenancy service | `services/api/src/common/tenancy/organization.service.ts` | Bootstrap write path gains a server-supplied organization id so the insert satisfies its own `WITH CHECK`. |
| Bootstrap composition root | `services/api/src/common/bootstrap/organization-bootstrap.service.ts` | Pre-tenant bootstrap key classification must happen under the narrow, credential-gated bootstrap context (§10.4 idempotency preserved). |
| Authorization service | `services/api/src/common/tenancy/authorization/authorization.service.ts` | Every read/write moves inside the tenant transaction; the membership+permission reader becomes reusable by the sync validator without duplicating resolution rules. |
| Sync ledger | `services/api/src/common/sync/ledger/mutation-ledger.service.ts` | T-10: ledger transactions carry the tenant context; pull wraps its reads the same way; optional ingoing revalidation hook inside the same transaction. |
| Sync push | `services/api/src/common/sync/push/*` (`sync-auth.ts`, `sync-push.service.ts`, `ingress-revalidation.ts` + spec, `sync-push.module.ts`) | §9.4 T-8/T-9/T-11: re-validate actor membership and current effective permissions at acceptance, inside the same transaction as the effect, ledger row, feed row, and cursor. |
| Sync pull | `services/api/src/common/sync/pull/*` (module wiring only) | The pull boundary is already context-only; module wiring unchanged except where the ledger service signature ripples. |
| Test fixtures | `services/api/test/sync/test-sync-authenticator.ts`, `test/sync/scripted-mutation-applier.ts` | Test-only verified-fixture set that exercises the admission seam (clearly labelled; not a production device capability). |
| Acceptance suites | `services/api/test/database/tenant-rls.db-spec.ts` (new), regression repairs in `test/database/postgres.db-spec.ts`, `test/sync/push.e2e-spec.ts`, `test/sync/pull.e2e-spec.ts`, affected unit specs | §36.1 T-2: real-PostgreSQL RLS proofs; predecessor suites repaired where M2-S4 legitimately changed behaviour. |
| Jest configuration | `services/api/jest.config.mjs` | The database project runs its suites serially (`maxWorkers: 1`) — resource discipline (§11) and the fixed test database must not race itself. |
| Documentation | `README.md`, `docs/rls-inventory.md`, `docs/security-architecture.md` | Table inventory, transaction ownership, ingress revalidation, migration/recovery notes. |
| Governance evidence | `docs/governance/MY_SHOP_M2_S4_SLICE_RECORD.md` (by close) | Final evidence requirements (§15, §16). |

The OpenAPI contract is **not changed** by this slice: no route, status vocabulary, or
response field changed (`rejectionCode` was already a free string; revalidation codes reuse
the stable §34.3 error codes). `contracts:check` must still pass byte-for-byte.

## 3. Non-scope

- Device registration, installation identity, labelling, listing, revocation, sync metadata — **M2-S5**.
- Durable `security_events` / `audit_events` streams — **M2-S6**.
- Flutter authentication and administrative UI — **M2-S7+**.
- Organization settings, pricing — **M3**.
- Business modules (products, inventory, sales) — M4/M5 — and therefore no real mutation applier beyond the fail-closed default.
- Production rollout, cutover, production database operations of any kind.
- No new service, dependency, or environment variable.

## 4. Engineering assumptions

1. `organizations` is the tenant root; its isolation column is `id` (there is no
   `organization_id` on itself). It is classified **tenant-owned** and receives the §8.2
   policy through that column, plus a *credential-gated* bootstrap-key clause that exists
   solely so the §10.4 operator command can classify its own idempotent retry (§9 below).
2. The identity global tables (`users`, `user_credentials`, `sessions`, `refresh_tokens`,
   `auth_throttles`) are classified **explicitly global**: they carry no `organization_id`
   and are not tenant data. Login and per-session state are per-identity, not per-tenant.
   They receive no RLS; the table-inventory test pins this classification so a future
   tenant column cannot silently appear without an explicit decision.
3. Login and refresh legitimately resolve a **multi-organization membership set** (T-4)
   before any tenant is selected. The letter of §8.2's policy predicate
   (`organization_id = current_setting(...)`) would make that impossible; the smallest
   compliant resolution is a **second trusted setting** (`app.current_user_id`) that makes
   exactly the caller's own membership edges visible, derived at accept time from a
   server-resolved identity (never client input). This is an engineering decision within
   the slice's authority; it is recorded in §9 and the security section.
4. Bootstrap re-classification needs, for the identical-retry read, the **bootstrap key
   itself** as the credential that unlocks exactly one `organizations` row
   (`app.current_bootstrap_key`). Possession of the key is the §10.4 authority; the
   command line already requires it. The composition path re-scopes the transaction to the
   stored organization id — server-derived from the stored row, never from client input —
   before reading the owner membership.
5. The M2-S4 offline-ingress re-validation proves actor membership and current effective
   permissions against **live server state inside the acceptance transaction**. Device
   binding remains an M2-S5 dependency: production stays fail-closed
   (`FailClosedSyncAuthenticator`), the seam is proven with test-only fixtures, and
   production never admits a push this slice. Recorded as an explicit dependency, not an
   invented PASS.

## 5. Architecture and compatibility analysis (pre-implementation)

Verified flows and their transaction boundaries:

1. **Login** (`AuthService.login`): password verification → membership read across the
   user's organizations (pre-tenant, root client) → one transaction writing
   `sessions`+`refresh_tokens`(global) and minting the token with the membership claim.
   *Conflict:* membership read is tenant-owned data.
2. **Refresh** (`AuthService.refresh`): one transaction with a per-session advisory lock;
   reads the user's memberships during rotation. Same conflict.
3. **Authenticate** (`JwtAuthGuard`): global tables only — no conflict.
4. **Authorization guard/service**: per-organization transactions — become tenant-scoped.
5. **Bootstrap**: one transaction; classification read by globally-unique
   `bootstrap_key` (pre-tenant), creation of org+membership. *Conflict:* classification.
6. **Mutation ledger**: one transaction per mutation (advisory lock, idempotency lookup,
   effect, ledger row, change-log row, cursor); pull is two root-client reads. Both become
   tenant-scoped inside their transactions.
7. **Health**: `SELECT 1` — no tenant table — unaffected.
8. The create-path `organization.id` is `dbgenerated(gen_random_uuid())`; the RLS
   `WITH CHECK (id = ctx)` requires the context to already name the inserted row, so the
   bootstrap path now generates the id server-side (`crypto.randomUUID`) and passes it
   explicitly. Idempotent retries and races are unaffected (advisory lock + unique key).

All eight precede or coexist with the new mechanism; no flow is broken by design, and each
repair is asserted by the acceptance suites.

## 6. Acceptance criteria

- **AC-01** — 100% of tenant-owned tables inventoried and covered: `ENABLE` + `FORCE` +
  policy on `organizations`, `organization_memberships`, `roles`, `role_permissions`,
  `permission_overrides`, `mutation_ledger`, `change_log`, `device_sync_cursors`,
  `sync_sequences` (9 tables). Global tables explicitly classified: `users`,
  `user_credentials`, `sessions`, `refresh_tokens`, `auth_throttles`.
- **AC-02** — The table-inventory test detects a future tenant-owned table (any table with
  `organization_id`) that lacks mandatory forced-RLS coverage, and fails.
- **AC-03** — Direct-SQL proofs on the real application role: cross-tenant SELECT, INSERT,
  UPDATE, DELETE, and organization-migration UPDATE are all denied; missing context sees
  nothing; identical tenant contexts succeed.
- **AC-04** — Context is transaction-local: not visible across pooled connections after
  commit/rollback; concurrent transactions for different tenants cannot cross-contaminate.
- **AC-05** — The application role is not a superuser, has no `BYPASSRLS`, does not own
  protected tables, cannot disable RLS, cannot run DDL; the migrator keeps its role.
- **AC-06** — Login, refresh rotation, logout, authenticate, multi-org membership
  resolution, and operator bootstrap idempotency all still work (regressed against the
  real login/authorization suites).
- **AC-07** — Fresh install: `0001`–`0008` apply from empty; migration list is exactly the
  eight paths; drift gate (`migrate diff --exit-code`) still exits 0.
- **AC-08** — Upgrade: real predecessor-shaped data seeded on `0001`–`0007`, then `0008`
  applies; every pre-existing row (identities, role assignments, mutation ledger, change
  feed, cursors, sequences, financial values) survives byte-identical; RLS present after.
- **AC-09** — Cross-tenant offline mutation: an actor whose membership is in another
  organization, an actor with no membership, and an actor that lost the required
  permission are each refused with a recorded per-mutation rejection; no business effect
  commits; the ledger records a REJECTED row that replays identically; a foreign
  rejection never commits tenant-owned state.
- **AC-10** — Replay handling keeps the documented order: authentication (guard) → context
  + advisory lock → idempotency lookup (stored answer returned, side-channel-free:
  lookups are scoped to the authenticated tenant, RLS additionally) → **current**
  re-validation → effect → ledger → feed → cursor, one commit. A permanently rejected
  mutation does not block later mutations in the same batch (§38.10.3 preserved).
- **AC-11** — Pull isolation holds under RLS for both push and pull (§7.5): no foreign
  feed rows, cursors, or sequence information.
- **AC-12** — Production sync remains fail-closed: `FailClosedSyncAuthenticator` refuses
  everything; no client-owned device identity is trusted; test fixtures are labelled
  test-only. M2-S5 device binding is recorded as an explicit dependency/blocker for the
  device-identity acceptance criterion.
- **AC-13** — All applicable predecessor suites pass unchanged in their contracts
  (assertions changed only where M2-S4 legitimately changed behaviour, each noted).

## 7. Threat model (§8 security requirements walk)

| # | Threat | Disposition in this slice |
| --- | --- | --- |
| 1–5 | Cross-tenant SELECT/INSERT/UPDATE/DELETE/ownership-move | Forced RLS + `WITH CHECK`; direct-SQL suite proves denial per table. |
| 6 | Missing tenant context | `missing_ok` NULL → predicate false → zero rows; wrapper refuses to open a tenant transaction with a malformed/blank id (internal invariant, plain error). |
| 7 | Malformed tenant identifiers | Validated as UUID at the wrapper before `set_config`; a malformed value fails closed inside PostgreSQL's uuid cast as defence in depth. |
| 8–9 | Spoofed `X-Organization-Id` / body organization | Context comes only from the verified principal/route or the sync trusted context; payload org fields are assertions checked in `assertIdentity` (unchanged) and now by RLS. |
| 10 | Cross-tenant membership reference | Composite FKs intact; membership policy forbids reading foreign edges (except own-identity clause, §9). |
| 11–13 | Stale access token / stale snapshot / revoked membership | Access tokens unchanged (perms_version); the sync admission re-validates **live** membership and effective permissions in the acceptance transaction — the cached snapshot is never authority. Membership removal arrives with future administration (no removal path exists yet; noted honestly). |
| 14 | Unauthorized offline mutation | Revalidation inside the transaction; membership-less or permission-less actors get recorded per-mutation rejections. |
| 15 | Forged device identity | Cannot happen through M2-S4 code paths: production never authenticates a device (fail-closed); M2-S5 supplies the genuine binding. No fabricated binding exists. |
| 16–17 | Context leakage across pooled connections / failed transactions | Transaction-local `set_config(..., true)`; suite proves a fresh pooled connection and post-rollback see nothing. |
| 18 | Concurrent different-tenant requests | Concurrency test proves isolation. |
| 19 | Cross-tenant idempotency lookup | Ledger lookup keys on the trusted organization; RLS additionally scopes the read. |
| 20 | Cross-tenant pull cursor access | Pull is tenant-scoped end-to-end. |
| 21 | DB error-message leakage | Context identities are server values; no new client-visible error text; RFC 7807 codes reuse the stable set. |
| 22 | SQL injection through tenancy configuration | No string interpolation anywhere: `set_config` with parameters; policies reference fixed settings. |
| 23 | Root-client escape from the scoped transaction | Enforcement is structural: tenant tables return zero rows for context-free statements; tests prove it. |
| 24 | Unsafe migration privilege changes | `0008` changes no role, no grant, no owner; roles.sql untouched. |
| 25 | Partial-batch regressions | §38.10.3 suite re-run; per-mutation outcomes preserved. |
| 26 | Owner-exclusive permission use | Owner exclusivity unchanged (M2-S3 resolver); assignment rules refuse exclusivity on non-owner roles. |
| 27 | Replay after authorization change | Documented order: replay of an already-committed mutation returns the stored outcome without a second effect; revalidation applies to *new* applications only. |
| 28 | Future tenant-owned table missing RLS | AC-02's inventory test enforces the invariant by machine. |

## 8. Database impact

One forward-only migration, `0008_tenant_row_level_security`, applying ENABLE+FORCE+policy
to nine tenant-owned tables, no role change, no grant change, no data transformation.
Rollback (§10 below) is a forward-only drop of the policies — never disabling isolation in
production.

## 9. The two documented engineering decisions (§2 authority mapping)

- **D-A — own-identity membership visibility.** The membership policy adds
  `OR user_id = current_setting('app.current_user_id', true)::uuid`, with
  `app.current_user_id` set only by the identity flows from a server-resolved account
  id, and **only** in `USING` — writes stay strictly tenant-scoped
  (`WITH CHECK organization_id = ctx`). Effect: a verified user reads exactly their own
  membership edges across organizations — the data T-4 grants them — and nothing else.
  No other tenant's row, column, or existence is reachable through it.
- **D-B — bootstrap-key gated tenant-root visibility.** The `organizations` policy adds
  `OR bootstrap_key = current_setting('app.current_bootstrap_key', true)`, set only by
  the operator bootstrap command for the one key the command carries. Possession of the
  §10.4 key is the authority; an unauthenticated database session still sees nothing.

Both decisions are the *smallest compliant resolution* of the conflict between §8.2's
predicate and the plan's own T-4/§10.4 requirements; they widen nothing beyond the
credential the operator or the verified user already supplies.

## 10. Rollback strategy

Forward-only (§35.1): if deployment reveals a defect, a **new** migration after `0008`
re-issues the correct policies. A deliberate drop of the policies (revert commit +
migration) would be an emergency isolation-reduction decision requiring owner
authorization — it is never the automatic path. `main` is untouched.

## 11. CI and evidence

The existing seven-job workflow is unchanged and must pass on the exact implementation
SHA for both `push` and `pull_request`. Final recorded evidence (SHAs, run IDs, job
conclusions) is appended to the governance record by close (§15 of the execution brief).
