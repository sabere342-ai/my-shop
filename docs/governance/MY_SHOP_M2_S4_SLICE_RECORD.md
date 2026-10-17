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
| Test fixtures | `services/api/test/sync/test-sync-authenticator.ts`, `test/sync/test-ingress-revalidator.ts` | Test-only verified-fixture set that exercises the admission seam (clearly labelled; not a production device capability). |
| Acceptance suites | `services/api/test/database/tenant-rls.db-spec.ts` (new), regression repairs in `test/database/postgres.db-spec.ts`, affected unit specs (`test/sync/push.e2e-spec.ts` and `test/sync/pull.e2e-spec.ts` were verified and required no edits — every case there is a post-ledger-boundary refusal that the re-validator is never reached by) | §36.1 T-2: real-PostgreSQL RLS proofs; predecessor suites repaired where M2-S4 legitimately changed behaviour. |
| Jest configuration | `services/api/jest.config.mjs` | The database project runs its suites serially (`--runInBand` on the `test:database` entry script) — resource discipline (§11) and the fixed test database must not race itself. |
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
Policies read each context through `NULLIF(current_setting(...), '')`: PostgreSQL keeps a
committed `is_local => true` placeholder *defined* on its pooled session with an empty
value, so absent and empty must both normalize to NULL before the cast — otherwise a
context-free statement on a reused session would raise instead of filtering. Empty and
absent stay the same fail-closed case; no real context value is ever empty (the wrapper
asserts UUID shape; the key is non-empty by grammar). Rollback (§10 below) is a
forward-only drop of the policies — never disabling isolation in production.

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

## 12. Changed paths and rationale

Every path this slice touches, with its defensible relationship to the declared scope
(the scope table above is the authorization; this is the accounting):

| Path | Change | Rationale |
| --- | --- | --- |
| `services/api/prisma/migrations/0008_tenant_row_level_security/migration.sql` | **New.** ENABLE+FORCE RLS + one `tenant_isolation` policy per tenant-owned table (9); explicit no-RLS classification for the five global identity tables is enforced by the inventory test, not the migration | The slice's only migration path; `0001`–`0007` untouched (§35.1). Policies normalize `current_setting` with `NULLIF(..., '')` so a committed transaction-local setting (which PostgreSQL leaves defined-but-empty on its pooled session) also fails closed instead of raising a cast error. |
| `services/api/prisma/schema.prisma` | Comment-only header addition | Documents the RLS posture the migration history carries; no model change, so the drift gate stays 0. |
| `services/api/src/common/database/tenant-context.ts` (+ `tenant-context.spec.ts`) | **New.** The three trusted settings, shape assertions, `establish*Context`, `withTenantTransaction`, `withIdentityTransaction` | The single transaction-local trusted context (§8.2, §9.3); the only code in the application that sets a tenant/identity/bootstrap setting. |
| `services/api/src/common/tenancy/organization.service.ts` | `createOrganizationWithOwner` mints the organization id server-side (`randomUUID`) and re-scopes the transaction before the membership write | The `organizations` policy's `WITH CHECK (id = …)` requires the context to already name the inserted row; the dbgenerated default would insert rows no context names. |
| `services/api/src/common/bootstrap/organization-bootstrap.service.ts` (+ spec) | Classification reads run under `establishBootstrapKeyContext` (D-B); composition re-scopes to the stored id; the post-unique-violation re-classification opens its own transaction with the same scopes | Under FORCE RLS the owner reads no tenant rows outside a scoped transaction; the §10.4 key is the classification credential. |
| `services/api/src/common/identity/auth.service.ts` | Login/refresh membership resolution wrapped in `withIdentityTransaction` (D-A) | T-4 multi-org resolution against a table that is now invisible without a context. |
| `services/api/src/common/tenancy/authorization/authorization.service.ts` (+ spec) | Every membership/permission read/write moved inside tenant transactions; the membership+effective-permission reader factored out as `readEffectiveInTransaction` | The authorization surface is tenant data; the reader is reused by the ingress re-validator instead of duplicating resolution rules. |
| `services/api/src/common/sync/ledger/mutation-ledger.service.ts` (+ spec) | The single mutation transaction, pull reads, and cursor/sequence access wrapped in `withTenantTransaction`; an optional `validateIngress` hook runs inside the same transaction before the effect | T-10 scope; the re-validation must share the effect's transaction and its advisory-lock/idempotency ordering (AC-10). |
| `services/api/src/common/sync/push/sync-auth.ts` | The trusted sync context gains an optional verified `actorUserId` | The re-validator needs a verified *actor*; the client body's `actorUserId` is never consulted (T-8). |
| `services/api/src/common/sync/push/ingress-revalidation.ts` (+ spec) | **New.** `MembershipPermissionRevalidator` (token `SYNC_INGRESS_REVALIDATOR`): actor/membership/effective-permission re-proof, fail-closed aggregate→permission map, DomainError carry-through | §9.4 T-8…T-12 at acceptance, live in the acceptance transaction. |
| `services/api/src/common/sync/push/sync-push.service.ts` (+ spec), `sync-push.module.ts` | A third constructor argument threads `validateIngress` into the ledger; the module imports `AuthorizationModule` and binds the production re-validator | The only production admission path; wiring stays explicit, and no production authenticator changes (fail-closed per M2-S5 dependency). |
| `services/api/test/database/tenant-rls.db-spec.ts` | **New.** AC-01/02 inventory + future-table gate, AC-03 per-table direct-SQL matrix (incl. D-A/D-B), AC-04 transaction-locality, AC-05 role forbiddance, AC-07 fresh install, AC-08 upgrade from predecessor state, AC-11 feed isolation | §36.1 T-2: the RLS proofs must be database facts on real PostgreSQL, never mock-substituted. |
| `services/api/test/database/postgres.db-spec.ts` | Predecessor acceptance suite repaired: tenant contexts around direct tenant-table statements, membership reads under the D-A scope, D-B key scopes for root reads, and the unknown-organization FK probe now mints its non-existent id as the transaction scope | M2-S4 legitimately changed what a context-free statement can see; assertions changed only there (`record §6 AC-13`). |
| `services/api/src/common/sync/ledger/mutation-ledger.spec.ts`, `src/common/sync/push/sync-push.service.spec.ts`, `src/common/bootstrap/organization-bootstrap.service.spec.ts`, `src/common/tenancy/authorization/authorization.service.spec.ts` | Unit specs updated for the new constructor/entry-point shapes (including the ledger hook and the bootstrap scopes) | Contract ripples of the above; no assertion weakened. |
| `services/api/test/sync/test-sync-authenticator.ts`, `test/sync/test-ingress-revalidator.ts` | Test-only fixtures: `MutableSyncAuthenticator`, `PermitAllIngressRevalidator` | The admission seam must be demonstrable without weakening the fail-closed production boundary. |
| `services/api/jest.config.mjs`, `services/api/package.json` | Serial database project enforced via `--runInBand` on the `test:database` script; comment updated | The two suites share one fixed database; CI's resource discipline (§11). |
| `README.md`, `docs/rls-inventory.md` (new), `docs/security-architecture.md` (new) | Documentation of the inventory, transaction ownership, decisions D-A/D-B, ingress re-validation, and operations notes | The operator-facing half of the governance duty (§43). |

Deliberately untouched: `test/sync/push.e2e-spec.ts`, `test/sync/pull.e2e-spec.ts`,
`prisma/roles.sql`, migrations `0001`–`0007`, the OpenAPI document, the Flutter client,
and every fail-closed production boundary (`FailClosedSyncAuthenticator`,
`FailClosedMutationApplier`).

## 13. Commit ledger, local verification, and remote lock

| Commit | Type | Subject |
| ------ | ---- | ------- |
| `214b56f` | locked base | M2-S3 record commit (PR #19 head, `PASS_MY_SHOP_M2_S3_RBAC_REMOTE_LOCKED`) |
| `4eabb82` | `docs(m2-s4)` | declare the tenancy-RLS slice and its acceptance criteria |
| `feba4a0` | `feat(m2-s4)` | enforce tenant isolation with forced row-level security and a trusted transaction context |
| `ebc9d6c` | `test(m2-s4)` | add the tenant-RLS acceptance suite and the ingress re-validation specs |
| `c7df763` | `docs(m2-s4)` | document the RLS inventory, the trusted context, and the ingress re-validation posture |
| _record commit_ | `docs(m2-s4)` | record the changed paths, execution evidence, and the remote lock |

**Base:** `214b56f0e0e3ef7f148591ace57ae188908e8e7f` (locked M2-S3 head, PR #19 open).
**Implementation head:** `c7df763d385b016a24e4fbfa7e95737cc01dd13a`. **Record head:** the
commit that carries this section (documentation only).

### Local verification (final tree, before push)

| Gate | Result |
| --- | --- |
| `test:unit` (real code, no computer substitutes) | **410 passed / 410**, 36 suites |
| `test:integration` (HTTP, full app) | **50 passed / 50**, 5 suites |
| `test:database` (real PostgreSQL 18, serial) | **109 passed / 109**, 2 suites — both db acceptance suites |
| `typecheck` (application + test config) | clean, both `tsc` configs |
| `contracts:check` | `contracts are in sync` — OpenAPI unchanged byte-for-byte |
| `lint`, `format:check` | clean across workspaces |
| mechanical gates, offline guards (stages 23–24), migration immutability (G-6) | OK — 8 migration paths in history, none rewritten |

### Remote CI on the exact implementation head `c7df763`

The workflow (`.github/workflows/ci.yml`) declares exactly seven jobs; all seven are
green on **both** events that ran on that SHA:

| Run | Event | ID | Conclusion | Jobs |
| --- | --- | --- | --- | --- |
| push CI | `push` | `39066223132` | success | fast-checks `117494359183`, dependency-audit `117494872757`, flutter-build-windows `117494872779`, backend-unit `117494872778`, backend-integration-database `117494872793`, contract-drift `117494872845`, flutter-build-android `117494872852` |
| pull-request CI | `pull_request` | `39066240385` | success | fast-checks `117494412699`, dependency-audit `117494951751`, flutter-build-windows `117494951767`, backend-unit `117494951814`, backend-integration-database `117494951720`, contract-drift `117494951824`, flutter-build-android `117494951838` |

The record commit that carries this section is documentation-only; its exact head is
verified green on both events after publication and is the value quoted in the final
acceptance report (same discipline as the M2-S3 record). PR #20 is left open; owner
merge authorization is required, and nothing is merged, no auto-merge is enabled, and
no force push was used.

## 14. Boundary and verdict

The next units the master plan defines after M2-S4 are **M2-S5** (device registration,
installation identity, and the genuine binding that makes `SYNC_AUTHENTICATOR` a
verified actor instead of a test-only one) and **M2-S6** (durable `security_events`
streams). Neither is authorized by this record and neither is started here. M2-S7
(Flutter administration) and the M3 business surface that adopts the re-validated
admission for real mutations (M4/M5 appliers) remain later concerns.

On the acceptance gates: the slice's own AC-01…AC-13 are all proven (locally and by the
remote database job); **G-12 is NOT SATISFIED** — PR #20 is left open and no merge was
performed. The merge is the owner's decision, not this slice's.

```
NO MERGE PERFORMED — OWNER MERGE AUTHORIZATION REQUIRED
PASS_MY_SHOP_M2_S4_TENANCY_RLS_OFFLINE_INGRESS_REMOTE_LOCKED
```
