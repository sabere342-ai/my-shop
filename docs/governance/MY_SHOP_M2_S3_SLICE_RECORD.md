# MY SHOP - M2-S3 SLICE RECORD: PERMISSION CATALOG, ROLE PRESETS, OVERRIDES, SIGNED SNAPSHOT

**Slice:** M2-S3 (Master Plan §40.6, row "M2-S3").
**Branch:** `codex/my-shop-m2-s3-rbac-permissions`.
**Base:** `e825d05` - the locked M2-S2 head on
`codex/my-shop-m2-s2-identity-auth`; PR #18, open and unmerged.
**Status:** DECLARED before implementation; evidence sections are completed in the
implementation and record commits that follow (see §19).

This record follows the same governance shape as
`MY_SHOP_M2_S1_SLICE_RECORD.md` and `MY_SHOP_M2_S2_SLICE_RECORD.md`. It is written
before the code so the scope, non-scope, allowed paths, acceptance criteria, migration
impact, security impact, and rollback are fixed and reviewable before anything is built.

---

## 1. Predecessor state

### 1.1 Entry state, verified not assumed

- The base commit is the **locked** M2-S2 head, `e825d05`, which is also `origin`'s head
  of `codex/my-shop-m2-s2-identity-auth`. M2-S2 is declared green on both CI events at
  its implementation and record heads (§19 of its record).
- M2-S2 deliberately left this slice the pieces M2-S3 builds on:
  - `users.permissions_version INTEGER NOT NULL DEFAULT 0` with CHECK
    `chk_users_permissions_version_non_negative` exists (migration `0006`) and is
    **compared** on every authenticated request (`TOKEN_STALE`); M2-S3 owns the writer
    that increments it (M2-S2 N-2, D-5).
  - `organization_memberships` carries `is_owner` and the partial unique index
    `uq_organizations_single_owner`; ownership exists in exactly one place.
  - `organization_memberships` has **no** role column, and no `roles`,
    `role_permissions`, or `permission_overrides` table exists: migration `0003`
    states "roles arrive with M2-S3 in their own migration".
  - The access token already carries `perms_version`, so this slice needs **no
    token-format change**.
- The migration history ends at `0006_users_permissions_version`, so M2-S3's migration
  is `0007_authorization_roles` (generated from the actual latest migration, never a
  hardcoded number).
- The identity context exposes the seam this slice consumes: `AuthService`
  (`authenticate`), `JwtAuthGuard`, `ACCESS_TOKEN_SERVICE`, and `SECURITY_EVENT_SINK`
  are exported from `IdentityModule`, and the module graph deduplicates a repeated
  `IdentityModule.forRoot(config)` (NestJS 11 `DeepHashedModuleOpaqueKeyFactory` hashes
  the dynamic metadata by value), so a second import in the composition layer is the
  **same** instance.

### 1.2 Predecessor findings (carried, not re-opened)

M2-S1's F-1..F-4 and M2-S2's D-1..D-5 are resolved and recorded; they are not
re-opened. M2-S3 inherits their consequences:

- `common/architecture/import-boundary.spec.ts` enforces §39.3 D-1: `tenancy` and
  `identity` are mutually independent, and `bootstrap` is the neutral composition root.
  M2-S3 adds a third neutral composition layer (`common/authorization/`) rather than
  create a `tenancy -> identity` edge for the bearer guard.
- The database is the last line of defence: every rule the service enforces is also a
  CHECK, an FK, or a unique index wherever PostgreSQL can express it (F-3 discipline).
- Merged migrations are immutable (`0001`..`0006` are byte-identical to the base).

### 1.3 Authoritative scope text (read before implementation)

- §40.6, row **M2-S3** - outcome: "Permission catalog, role presets, per-user overrides,
  effective-permission resolution, signed snapshot issuance"; non-scope: "Role
  management UI"; key acceptance: "Owner-exclusive permissions are structurally
  ungrantable".
- §11.1 - RBAC with a versioned permission catalog, data-driven role presets, per-user
  overrides; the legacy hardcoded `UserRole` enum is **not** copied.
- §11.2 - permissions are strings in a **versioned catalog**, never a database enum, so
  the catalog grows without a schema migration. Each entry declares id, category,
  description, and an `ownerExclusive` flag making it structurally ungrantable to
  non-owners. The catalog table names 36 permission ids across nine category rows.
- §11.3 - roles are data, not an enum. A built-in `Owner` role is **unique per
  organization** and **always holds every permission**. Seeded presets: Owner, Manager,
  Cashier, Salesperson, Stockkeeper, Accountant. The legacy `salesOnly` idea survives as
  the minimal `Salesperson` preset.
- §11.4 - per-user `allow`/`deny` sets, evaluated **after** the role; `ownerExclusive`
  is a structural rule enforced in the service layer.
- §8.4 / §39.2 - the `tenancy` context owns `roles`, `role_permissions`,
  `permission_overrides` **and permission resolution**; `identity` owns users,
  credentials, sessions.
- §9.3 - the requested organization comes from a **verified source** (a route
  parameter) and is looked up in the token's allowed organization set; absence yields
  `403 ORGANIZATION_FORBIDDEN` **and** a security audit event. A request body never
  names a tenant.
- §38.16.3 / §38.17 - the offline session carries a **signed** authorization snapshot:
  the effective permission set, `permissions_version`, the organization id, the
  device id, the issued-at time, and the grace expiry; it is validated against the
  stored signature before use, the server is the only permission authority, and an
  offline snapshot **can never** grant an owner-exclusive permission.
- §13.1/§13.4/§13.6 - no stack, SQL or internal identifier in a response; role
  separation unchanged (`my_shop_migrator` DDL / `my_shop_app` DML-only, no
  `BYPASSRLS`, no `SECURITY DEFINER`); keys are environment-only.
- §34.1-§34.3 - `/api/v1` namespace; one global validation pipe; RFC 7807 problem
  documents with a stable `code` from the closed vocabulary.
- §35.1/§35.4 - migrations are forward-only and additive; **tenant** data (not schema)
  is seeded by **idempotent application code**, not by SQL migration.
- §36.1 T-2/T-5 - database acceptance runs against real PostgreSQL and fails fast when
  its environment is absent (no silent skip); Flutter's T-O6 skip stays
  `DEFERRED_BY_PLAN`.

**Discrepancy with the engine brief (documented, plan wins).** The brief describes "34
permission IDs across 8 categories". The Master Plan's authoritative §11.2 catalog
lists **36** ids across **nine** category rows (catalog, inventory, sales, pricing,
customers, suppliers, treasury, accounting, administration) - the brief's own
parenthetical enumerates nine names. §43.4 makes the plan the source of truth, so the
catalog is the plan's 36 across nine. The discrepancy is recorded in §12.

---

## 2. Declaration

### 2.1 `scope`

| ID   | Scope item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-1  | Migration `0007_authorization_roles` (forward-only, additive): table `roles` (org-scoped, `key`, `name`, `is_system`, timestamps; unique `(organization_id, key)`; partial unique index making the `owner` role unique per organization; CHECKs for key/name shape); table `role_permissions` (`organization_id`, `role_id`, `permission_id` text; PK `(role_id, permission_id)`; **composite FK** `(role_id, organization_id) -> roles (id, organization_id)`; CHECK for the permission-id grammar); table `permission_overrides` (`organization_id`, `user_id`, `permission_id`, `effect IN ('ALLOW','DENY')`, timestamps; UNIQUE `(organization_id, user_id, permission_id)`; composite FK to `organization_memberships (organization_id, user_id)`); and the additive column `organization_memberships.role_id` with its composite FK. |
| S-2  | `schema.prisma` gains `Role`, `RolePermission`, `PermissionOverride`, the `PermissionEffect` enum, and `OrganizationMembership.roleId`, whose desired state matches the migration (verified by `prisma migrate diff --exit-code` in the database suite).                                                                                                                                                                                                                                                                                                                              |
| S-3  | `src/common/tenancy/authorization/permission-catalog.ts` - the versioned catalog (`PERMISSION_CATALOG_VERSION`, 36 entries across nine categories, each `{ id, category, description, ownerExclusive }`), with lookup/validation helpers. Exactly one entry is `ownerExclusive` (`accounting.journal.post`, §11.2).                                                                                                                                                                                                                                                                     |
| S-4  | `src/common/tenancy/authorization/role-presets.ts` - the six seeded presets (Owner, Manager, Cashier, Salesperson, Stockkeeper, Accountant) as data over catalog ids, each with a stated rationale. Owner holds every id; non-Owner presets hold no owner-exclusive id; Manager deliberately lacks `sales.viewAll` (§42.1 O-8).                                                                                                                                                                                                                                                       |
| S-5  | `src/common/tenancy/authorization/effective-permissions.ts` - the pure resolver: role -> overrides -> structural restrictions. Owner holds every permission; non-owners never acquire an owner-exclusive permission; `DENY` beats a role grant and beats an `ALLOW`; unknown ids are ignored (fail closed); a missing role yields the empty set.                                                                                                                                                                                                                                     |
| S-6  | `src/common/tenancy/authorization/authorization.service.ts` - the DB-backed surface: idempotent preset seeding (`ensureOrganizationRoles`, the §35.4 application-code backfill that also upgrades organizations created before `0007`), effective-permission resolution, role listing, role-permission replacement, membership role/override assignment, and the **atomic `users.permissions_version` bump** on every committed authorization change (role edit -> every holder of the role; membership/override change -> that user). |
| S-7  | `src/common/tenancy/authorization/authorization-snapshot.ts` - the signed authorization snapshot (§38.16.3, §38.17): a compact RS256 JWS over `{ sub, org, role, owner, perms, perms_version, catalog_version, iss, aud, iat, exp }`, minted from the identity key material, validated strictly (three segments, pinned `alg`, signature, issuer, audience, expiry, **catalog version**, and the structural rule that a non-owner snapshot carries no owner-exclusive id). No device id is present: device binding is M2-S5, and no endpoint accepts a caller-supplied device id. |
| S-8  | `src/common/authorization/authorization.guard.ts` - the bearer + tenant + permission guard: authenticates through the exported `AuthService`, takes the organization from the **route parameter** and checks it against the token's membership set (§9.3), refuses a missing membership with `ORGANIZATION_FORBIDDEN` **and** a security event, attaches the trusted context, and (when a handler declares `@RequirePermission(...)`) resolves the effective set and refuses with `PERMISSION_DENIED`. Plus `@AuthorizedContext()` and `@RequirePermission()`. |
| S-9  | `src/common/authorization/authorization.contract.ts` and `authorization.controller.ts` - five org-scoped routes under `/api/v1`: `GET /organizations/:organizationId/authorization/me`, `POST /organizations/:organizationId/authorization/snapshot`, `GET /organizations/:organizationId/roles` (`roles.manage`), `PUT /organizations/:organizationId/roles/:roleId/permissions` (`roles.manage`), and `PUT /organizations/:organizationId/memberships/:userId/authorization` (`users.manage`). |
| S-10 | `src/common/authorization/authorization.module.ts` - the neutral composition module (it may import both `identity` and `tenancy`; neither may import it), wired into `AppModule.forRoot`, reusing the deduplicated `IdentityModule` instance.                                                                                                                                                                                                                                                                                                                                          |
| S-11 | `src/common/architecture/import-boundary.spec.ts` gains the new direction rules (neither `identity` nor `tenancy` may import `authorization`; `authorization` may not import `bootstrap`), so the composition layer is enforced by the same machine gate.                                                                                                                                                                                                                                                                                                                            |
| S-12 | Contract regeneration: `packages/contracts/openapi.json` and `packages/contracts/src/generated/schemas.ts` gain the five authorization routes and their schemas via `contracts:generate`; `contracts:check` stays byte-stable.                                                                                                                                                                                                                                                                                                                                                        |
| S-13 | Tests: unit (`src/common/tenancy/authorization/*.spec.ts`, `src/common/authorization/*.spec.ts`), integration end-to-end request (`test/authorization/authorization.e2e-spec.ts`, DB-independent), and the database acceptance block in `test/database/postgres.db-spec.ts` (real PostgreSQL: fresh and upgrade paths, drift, resolution, overrides, invalidation, cross-tenant refusal, snapshot tampering).                                                                                                          |
| S-14 | `README.md` documents the authorization surface and the permission model (placeholders only where a secret is implied; none is introduced).                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| S-15 | Governance: this record.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

### 2.2 `non_scope`

| ID   | Not in this slice                                                                   | Owning slice / authority |
| ---- | ----------------------------------------------------------------------------------- | ------------------------ |
| N-1  | Role-management UI and any Flutter surface                                          | §40.6 M2-S3 "non-scope"; M2-S7 |
| N-2  | Row-level security policies and `SET LOCAL` (the database tenant policy)             | §9.3, §40.6 M2-S4        |
| N-3  | Device registration, installation identity, and snapshot **device binding**          | §12, §40.6 M2-S5         |
| N-4  | Durable `security_events` / `audit_events` tables (the security port stays the seam) | §32, §40.6 M2-S6         |
| N-5  | The offline mutation ingress and re-authorization pipeline (§9.4, §38.16.4)          | §40.6 M2-S4              |
| N-6  | Organization settings and `offline_grace_duration` as an owner-controlled setting    | §22.4, §40.6 M3          |
| N-7  | Permission enforcement on business endpoints (none exists yet)                       | §40.6 M3+                |
| N-8  | Governed repair tools, sync console, and the `sync.view` destination                 | §38.30, §40.6 M8b        |
| N-9  | Custom role creation/deletion API (presets + edits only in this slice)               | later slices             |
| N-10 | Any change to token format, refresh rotation, or session semantics                   | M2-S2 (locked)           |

### 2.3 `allowed_paths`

Only these paths may change in the slice. Anything else is a scope violation (G-05),
verified by the branch diff:

- `docs/governance/MY_SHOP_M2_S3_SLICE_RECORD.md`
- `services/api/prisma/schema.prisma`
- `services/api/prisma/migrations/0007_authorization_roles/migration.sql`
- `services/api/src/common/tenancy/authorization/**` (new context files and their units)
- `services/api/src/common/authorization/**` (new composition layer and its units)
- `services/api/src/common/architecture/import-boundary.spec.ts`
- `services/api/src/app.module.ts`
- `services/api/test/authorization/**` (integration end-to-end and support)
- `services/api/test/database/postgres.db-spec.ts` (the acceptance block and the
  migration/table list assertions)
- `packages/contracts/openapi.json`, `packages/contracts/src/generated/schemas.ts`
- `README.md`

Explicitly **not** touched: `prisma/roles.sql`, `.github/workflows/**`, `tool/ci/**`,
`services/api/jest.config.mjs`, `0001`-`0006` migration files, `common/identity/**`
(consumed as an exported seam, never edited), any Master Plan or ADR text.

### 2.4 `tests`

| Suite       | Location                                        | What it proves                                                                                                  |
| ----------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Unit        | `src/common/tenancy/authorization/*.spec.ts`    | Catalog integrity (36 ids, nine categories, uniqueness, one owner-exclusive, no stock-guard bypass); preset integrity (Owner=all, Manager lacks `sales.viewAll`, no non-Owner owner-exclusive); resolver precedence (`DENY` beats grant and `ALLOW`, `ALLOW` cannot grant owner-exclusive, unknown ids fail closed); snapshot sign/verify and every rejection matrix |
| Unit        | `src/common/authorization/*.spec.ts`            | Guard decisions: missing/foreign organization, missing membership, absent/unknown required permission, fail-closed refusal                                                          |
| Integration | `test/authorization/*.e2e-spec.ts` (Supertest)  | Full request through routing, the global pipe/filter, and the guard chain with no database: 401 for a missing bearer, 400 for a malformed body, 503 while the identity surface fails closed, 404 for unknown routes |
| Database    | `test/database/postgres.db-spec.ts` (M2-S3)     | Migration `0007` from empty, drift `--exit-code`, table/constraint rejections, fresh **and upgrade** preset seeding, owner/Manager resolution, override precedence, `permissions_version` invalidation against real PostgreSQL, cross-tenant refusal, snapshot tampering |

§36.1 T-2 forbids an in-memory substitute for the database assertions; the database
suite fails fast when its environment is absent (no silent skip, T-5).

### 2.5 `acceptance_criteria`

| ID    | Criterion                                                                                                                                          | Source        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| AC-01 | `prisma migrate deploy` from empty applies `0001`-`0007`, each exactly once, none rolled back                                                       | §3.4          |
| AC-02 | Exactly the authorized tables exist: the eleven M1b/M2-S1/M2-S2 tables plus `roles`, `role_permissions`, `permission_overrides`                      | §39.5         |
| AC-03 | Re-running `prisma migrate deploy` applies nothing and succeeds                                                                                     | §3.4          |
| AC-04 | `schema.prisma` and the migration history agree (`migrate diff --exit-code` exits 0 in-suite)                                                       | §3.4          |
| AC-05 | An organization created by the bootstrap command has all six preset roles, and its owner membership carries the Owner role                          | §11.3, §40.6  |
| AC-06 | The Owner role holds every catalog permission and is unique per organization (a second owner role is refused by the partial unique index)           | §11.3         |
| AC-07 | A user assigned the Manager preset holds **no** owner-exclusive permission and **not** `sales.viewAll`                                              | O-8, §11.2    |
| AC-08 | An `ALLOW` override grants an extra non-owner-exclusive permission and a `DENY` override removes a role-granted permission                          | §11.4         |
| AC-09 | `DENY` beats both the role grant and a same-permission `ALLOW`                                                                                      | §11.4         |
| AC-10 | An `ALLOW` override for an owner-exclusive permission cannot make a non-owner hold it                                                               | §11.2, §38.17 |
| AC-11 | A role-permission edit is refused if it names an unknown permission id, and refused if it would grant an owner-exclusive id to a non-Owner role     | §11.2         |
| AC-12 | A role-permission edit increments `permissions_version` for **every** user holding that role, and their outstanding access token becomes `TOKEN_STALE` | §10.3, §11   |
| AC-13 | A membership role or override change increments `permissions_version` for that user atomically with the change                                      | §10.3, §11   |
| AC-14 | No authorization path ever decrements or leaves `permissions_version` unchanged on a committed change; the value never goes negative                | §10.3, §11   |
| AC-15 | Resolving for a user with no membership in the requested organization is refused; the organization is taken from the route and checked against the token's membership set, never from a body | §9.3 |
| AC-16 | A role or override of organization A can never be applied to a membership of organization B (composite foreign keys)                                | §9.2, §9.4   |
| AC-17 | The signed snapshot verifies against the public key and carries the permission set, `permissions_version`, organization id, issued-at and expiry    | §38.16.3     |
| AC-18 | Snapshot verification rejects a tampered payload, a foreign signature, `alg: none`/`HS256`, an expired snapshot, and a wrong issuer/audience        | §13.1, §38.17 |
| AC-19 | Snapshot verification rejects a snapshot whose `catalog_version` is not the catalog this build serves                                               | §11.2        |
| AC-20 | A non-owner snapshot that carries an owner-exclusive permission is refused at verification, and the issuer never mints one                          | §38.17       |
| AC-21 | No endpoint accepts a caller-supplied device id; the snapshot carries none (device binding is M2-S5)                                                | §38.16.2     |
| AC-22 | `GET /authorization/me` requires a valid bearer token and returns the effective set for the requested organization only                             | §34.3, §9.3  |
| AC-23 | A request without the permission a handler declares is refused `PERMISSION_DENIED`; an unknown permission id in a declaration fails closed           | §13.1, §34.3 |
| AC-24 | No response, log, or CLI output carries a token, a signature, or a driver error; the whole problem vocabulary is the existing closed set            | §13.1, §13.6 |
| AC-25 | Role separation is unchanged: the new tables are migrator-owned; the application role gains no DDL; `roles.sql` is untouched                        | §13.4        |
| AC-26 | An organization that existed before `0007` is upgraded by idempotent application code, not by a SQL data migration                                  | §35.4         |
| AC-27 | `contracts:check` reports the five new routes in sync after regeneration                                                                            | §7.1 G-7      |
| AC-28 | M1b, M2-S1 and M2-S2 regressions pass; the T-O6 offline skip is still `DEFERRED_BY_PLAN`                                                            | §3.1, §3.4    |
| AC-29 | Flutter regression passes (`flutter analyze --fatal-infos` clean, `flutter test` green)                                                             | §3.1          |
| AC-30 | Exact-SHA remote CI: all seven required checks green on the final HEAD for both `push` and `pull_request`                                          | §3.6          |

### 2.6 `migration_impact`

- **One** new forward-only, additive migration, `0007_authorization_roles`: it creates
  three tables and adds one nullable column plus its FK to
  `organization_memberships`. It alters no other existing table, drops nothing, and
  rewrites no committed migration.
- The added `role_id` column is nullable by necessity: an organization that existed
  before `0007` has no roles to point at until the idempotent §35.4 seeding runs, and a
  `NOT NULL` column or a CHECK requiring an owner role would refuse the upgrade on
  existing rows (§35.2 expand/contract: add nullable now).
- CHECK constraints are not modelled by Prisma, so they do not create drift - the same
  situation as `0003`'s, `0004`'s, `0005`'s, and `0006`'s hand-added CHECKs.
- No `GRANT`, no `SECURITY DEFINER`, no `BYPASSRLS`, no `search_path` change, no
  string interpolation. The migrator's `ALTER DEFAULT PRIVILEGES` in `prisma/roles.sql`
  already births every new table with the application role's DML, so `roles.sql` is
  untouched.

### 2.7 `security_impact`

- Adds the first **authorization** surface: a permission catalog, role/override
  resolution, and a signed snapshot. New threat surface, and therefore a full
  threat-model walk in §3.8 after implementation.
- New signing use: the snapshot reuses the existing identity key pair (RS256 over
  `node:crypto`). No new secret, no new dependency, and no new environment variable.
- A permission change now invalidates outstanding tokens; the invalidation is the
  M2-S2 `TOKEN_STALE` path, unchanged in shape.
- The resolver is the single decision point: a missing membership, an unknown
  permission, or an inconsistent catalog all yield "no permission", never "allow".
- Owner-exclusivity is structural: it is stripped for non-owners at resolution, refused
  at role-permission write, and refused again at snapshot verification.
- The `my_shop_app` role still cannot run DDL; the new tables are migrator-owned.

### 2.8 `rollback`

- The slice is additive and revertible by a later forward migration that drops the
  column, the three tables, and their constraints, or by not merging the branch.
- The authorization module can be unbound from `AppModule` by reverting one import; the
  process then runs exactly as before M2-S3 (no authorization surface).
- Existing rows are never transformed by the migration: an upgraded organization's
  memberships keep their data and gain `role_id` only when the idempotent seeding runs.
- `roles.sql` and `0001`-`0006` are untouched, so the database-role contract is
  unchanged.

### 2.9 `publication_gate`

- The slice is published as a **new** PR whose base is the M2-S2 branch
  (`codex/my-shop-m2-s2-identity-auth`), never `main`. It is left open and unmerged.
- No merge, no auto-merge, no force-push, no history rewrite, no production deploy, no
  destructive database operation is performed.
- The exact-SHA remote CI evidence is recorded for both events on the final HEAD before
  the verdict is written. Until then the verdict is `BLOCKED_...`, never `PASS_...`.

---

## 3. Execution and evidence

_Completed in the record commit, which carries the implementation head, the local chain,
and the exact-SHA remote lock (§19)._

### 3.1 Local chain

_Pending._

### 3.2 Environment

_Pending._

### 3.3 Implementation notes

_Pending._

### 3.4 Test evidence

_Pending._

### 3.5 Local schema and contract drift

_Pending._

### 3.6 Remote CI

_Pending._

### 3.7 PR

_Pending._

### 3.8 Security threat-model walk

_Pending._

### 3.9 Requirements mapping (§40.6 M2-S3, §11)

_Pending._

---

## 4. Migration acceptance

_Pending._

---

## 5. Security audit - supporting dimensions

_Pending._

---

## 6. Data model and tenant invariants

_Pending._

---

## 7. Idempotency and concurrency contract

_Pending._

---

## 8. Authorization administration contract

_Pending._

---

## 9. Bounded-context ownership and dependency direction

_Pending._

---

## 10. Contract, API, and offline surface

_Pending._

---

## 11. Decisions

_Pending._

---

## 12. Scope-difference report

_Pending._

---

## 13. Acceptance criteria roll-up

_Pending._

---

## 14. Gates

_Pending._

---

## 15. Deviations

_Pending._

---

## 16. Residual risks and stated limits

_Pending._

---

## 17. Rollback

_Pending._

---

## 18. Deferred design notes

_Pending._

---

## 19. Commit ledger, final SHA, and remote lock

_Pending._

---

## 20. Boundary and verdict

_Pending._
