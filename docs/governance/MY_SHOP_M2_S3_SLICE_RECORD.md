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

_Completed in the record commit. The implementation content ends at head
`6daf083a2e1a958709f8548c9faf7d439ccb1446`; §19 carries the commit ledger and the
exact-SHA remote lock._

### 3.1 Local chain

| Step | Command | Result |
| ---- | ------- | ------ |
| Toolchain pin | `npm run toolchain:verify` | PASS - "every active toolchain matches the pin" (node 22.22.3, npm 10.9.8, flutter 3.47.5, dart 3.13.4) |
| Gates (§37.2 stages 1-4, 8-15, 23-24, G-6) | `npm run gates` | all nine green (§14) |
| Format | `npm run format:check` | "All matched files use Prettier code style!" in all three workspaces |
| Lint | `npm run lint` | exit 0, no warnings |
| Typecheck (ADR-001 composite) | `npm run typecheck` | exit 0 (build + test trees) |
| Contract drift | `npm run contracts:check` | "contracts are in sync" |
| API unit | `npm run test:unit --workspace @my-shop/api` | 34 suites / 378 tests pass; **56 are the new M2-S3 specs across 6 files** |
| API integration | `npm run test:integration --workspace @my-shop/api` | 5 suites / 50 tests pass; 1 suite is the new `test/authorization/authorization.e2e-spec.ts` |
| API database | `npm run test:database --workspace @my-shop/api` | 1 suite / 84 tests pass; **17 are the M2-S3 acceptance block**, against real PostgreSQL (§3.2) |
| Contract tests | `npm run test --workspace @my-shop/contracts` | 2 suites / 17 tests pass |
| Testkit tests | `npm run test --workspace @my-shop/testkit` | 1 suite / 5 tests pass |
| Composite build | `npm run build` | exit 0 (contracts, testkit, api) |
| Flutter analyze | `npm run flutter:analyze` (pinned 3.47.5) | "No issues found!" |
| Flutter test | `npm run flutter:test` | 364 passed, 1 skipped (T-O6 `DEFERRED_BY_PLAN`), "All tests passed!" |

The three API projects were run **separately** (the way CI isolates them) rather than
in one Jest invocation: M2-S2 §15 D-4 documents that a single local invocation starves
workers and can spuriously time tests out. The per-project runs are the ones CI
replicates, so they are the evidence quoted here.

### 3.2 Environment

- Node 22.22.3, npm 10.9.8; Dart 3.13.4; Flutter **3.47.5** selected per-invocation by
  `tool/flutterw` from `.tool-versions`. The host's PATH `flutter` remains the stale
  SDK that R-5 records; the wrapper neither installs nor upgrades it.
- The database project ran against a real **PostgreSQL 18.4** (`psql` `version()`:
  `PostgreSQL 18.4 on x86_64-windows`) on the fixed `my_shop_test` database via
  `DATABASE_URL` (`my_shop_app`), `MIGRATION_DATABASE_URL` (`my_shop_migrator`), and
  `ADMIN_DATABASE_URL` (admin) - the same role separation as `ci.yml`, and the same
  T-5 refusal when the URLs do not name that database.
- The generated Prisma client resolves and extends from this workspace's own
  `node_modules/.prisma/client`; CI regenerates it through the `postinstall` hook of
  `npm ci`, so the pinned CLI version always owns the generated code.

### 3.3 Implementation notes

- **Catalog.** `permission-catalog.ts` serves `PERMISSION_CATALOG_VERSION` 1 - the
  36 §11.2 ids across the nine categories, each `{ id, category, description,
  ownerExclusive }`, frozen at module load. Exactly one entry is `ownerExclusive`
  (`accounting.journal.post`). `isPermissionId` and
  `isOwnerExclusivePermission` fail closed for any id the catalog does not serve, and
  `PERMISSION_IDS` fixes the deterministic catalog order every response and snapshot
  uses.
- **Presets.** `role-presets.ts` derives six presets from the catalog, not from a
  hand-copied list: Owner holds all 36 ids; the non-Owner presets are filtered through
  the `ownerExclusive` flag (so a future owner-exclusive catalog entry cannot leak
  into a preset by accident), and `MANAGER_WITHHELD_PERMISSION_IDS` names `sales.viewAll`
  as data (§42.1 O-8). The Cashier (7), Salesperson (5 - the §11.3 legacy `salesOnly`),
  Stockkeeper (5), and Accountant (7) sets are literal, minimal, and catalog-ordered.
  Seeded grants total 94 (36 + 34 + 7 + 5 + 5 + 7).
- **Resolver.** `effective-permissions.ts` is pure and returned **frozen**:
  `isOwner` -> the whole catalog; otherwise role grants, then overrides, where a `DENY`
  beats a role grant and a same-permission `ALLOW`, an `ALLOW` never confers an
  owner-exclusive id on a non-owner, and unknown ids are dropped everywhere (fail
  closed). A missing role yields the empty set.
- **Service.** `authorization.service.ts` owns seeding and the writes. Seeding
  (`seedRoles`) is insert-only and idempotent: a fast read of the six preset keys
  short-circuits; the slow path takes a per-organization `pg_advisory_xact_lock`,
  re-reads under the lock, creates only what is missing, and assigns the Owner role to
  the owner membership in the same transaction (§35.4, AC-05/AC-26). Every resolution,
  listing, and administration write seeds first in **its own transaction**, so the
  seeding is lazy and an organization created before `0007` is upgraded at its first
  authorization touch. `replaceRolePermissions` refuses the Owner role, an unknown id,
  and an owner-exclusive id for a non-owner role (AC-11), replaces the grant set (set,
  not merge), and bumps **every holder**; `assignMembershipAuthorization` refuses the
  owner membership, a foreign or unknown role (`NOT_FOUND`, never a 403, per ADR-029),
  an owner-exclusive `ALLOW`, and an id in both `allow` and `deny`, replaces the
  override set, and bumps **exactly that user** (AC-08…AC-13).
- **Invalidation shape.** `bumpPermissionsVersion` is one
  `UPDATE users SET permissions_version = permissions_version + 1 WHERE id IN (...)`
  through `updateMany({ increment })` on the **same interactive transaction** as the
  grant it invalidates - a committed change and its invalidation are never
  separated, concurrent bumps cannot lose an increment, and the value never
  decrements (AC-14; the `0006` CHECK is the database's own backstop). Seeding never
  bumps the version: it establishes the baseline and changes no effective set.
- **Snapshot.** `authorization-snapshot.ts` signs RS256 over `node:crypto` only, using
  the **existing** identity key pair - no new secret, dependency, or environment
  variable. The minted JWS carries `{ sub, org, role, owner, perms, perms_version,
  catalog_version, iss, aud, iat, exp }` (`iss` `my-shop`, `aud`
  `my-shop:authorization-snapshot`, TTL 72 h). Verification pins `alg` before any
  signature work, and refuses a tampered payload, a foreign signature, a malformed
  segment, a wrong issuer/audience, an expired snapshot, an unknown **catalog
  version**, and any non-owner snapshot that names an owner-exclusive id (AC-17…AC-20).
  The mint path refuses the same owner-exclusive case, so the issuer can never produce
  one. No device id exists in the shape or on any endpoint (AC-21).
- **Guard.** `authorization.guard.ts` composes `JwtAuthGuard` and `AuthorizationGuard`
  through `@Authorize(permission?)` - the bearer guard first, so a principal exists
  before any authorization decision. The organization comes from the **route
  parameter** and must be in the token's membership set (§9.3); a mismatch is
  `ORGANIZATION_FORBIDDEN` **and** a security event. When the handler declares
  `@RequirePermission`, the guard resolves the **same** effective set the read paths
  use and refuses `PERMISSION_DENIED` when the id is absent; an unknown declared id
  resolves to nothing and is therefore refused (fail closed, AC-23). `AuthorizedContext`
  exposes the verified principal; `OrganizationId` the validated route parameter.
- **Composition.** `authorization.module.ts` is the neutral third composition layer:
  it imports the deduplicated `IdentityModule.forRoot(config)` and
  `DatabaseModule.forRoot(config)`, provides the guard, the service, and the snapshot
  service, and exports them. `AuthorizationService` is constructed with
  `PrismaService` directly - which satisfies the narrow `PrismaHost` seam the tenancy
  service declares and keeps the graph bootable without a configured database.
  `app.module.ts` adds the single `AuthorizationModule.forRoot(config)` line, and
  `import-boundary.spec.ts` now forbids `identity`/`tenancy` from importing
  `authorization` and forbids `authorization` from importing `bootstrap` (AC-analogue
  of §39.3 D-1).
- **Migration.** `0007_authorization_roles` is exactly as declared in §2.6: the
  additive delta with the three tables, the nullable `role_id`, the composite foreign
  keys, `uq_roles_single_owner`, the shape CHECKs, and no `GRANT`, no `SECURITY DEFINER`,
  no `BYPASSRLS`, no `search_path` change, no interpolation (§4).

### 3.4 Test evidence

| Project | Suites | Tests | Notes |
| ------- | ------ | ----- | ----- |
| Unit (`test:unit`) | 34 | 378 | six new `tenancy/authorization/*.spec.ts` (catalog 8, presets 8, resolver 12, snapshot 7, service 9) and one new `common/authorization/*.spec.ts` (guard 12, including one three-case parameterized table) |
| Integration (`test:integration`) | 5 | 50 | one new: `test/authorization/authorization.e2e-spec.ts` — the HTTP boundary with **no database**: 401 for a missing or non-bearer header on every route, 503 while the surface fails closed without key material, 404 for an unknown route, and 401 for a garbage token **before** validation |
| Database (`test:database`) | 1 | 84 | **17 are the M2-S3 acceptance block** in `postgres.db-spec.ts`, against real PostgreSQL (§3.2); the 67 M2-S1/M2-S2 tests were run in the same invocation untouched |
| Flutter | - | 364 (+1 skip) | T-O6 skip remains `DEFERRED_BY_PLAN` (AC-29) |
| Contracts | 2 | 17 | generation is byte-stable |
| Testkit | 1 | 5 | unchanged |

The M2-S3 database block proves: the eleven predecessor tables **plus exactly the three
RBAC tables** (AC-02); lazy seeding materializing all six presets with exactly the
declared grant sets, the Owner resolving to the whole catalog (AC-05/AC-06/AC-22); a
second owner role refused by the partial unique index (AC-06); migrator ownership with
no application DDL and idempotent re-seeding (AC-25); role-edit refusals and the
every-holder `TOKEN_STALE` invalidation (AC-11/AC-12); the single-user atomic
membership bump (AC-13); `ALLOW`/`DENY` override semantics with the contradiction
refused (AC-08/AC-09); `PERMISSION_DENIED` for a member without the permission
(AC-23); the owner-exclusive leak shut at the service **and** the resolver (AC-10);
the route-organization check (AC-15); cross-tenant refusal through the composite
foreign keys (AC-16); a minted snapshot verified and device-free (AC-17/AC-21); the
full snapshot rejection matrix (AC-18); the catalog-version pin (AC-19); never
minting an owner-exclusive id for a non-owner (AC-20); and a pre-`0007` organization
upgraded by the idempotent application code (AC-26).

### 3.5 Local schema and contract drift

- `prisma migrate diff --exit-code` exits 0 in-suite: `schema.prisma` and the
  migration history `0001`…`0007` agree (AC-04).
- `contracts:check` prints "contracts are in sync": the five authorization routes and
  their schemas appear in `packages/contracts/openapi.json` and
  `packages/contracts/src/generated/schemas.ts`, and regeneration is byte-identical
  (AC-27).

### 3.6 Remote CI

Exact-SHA evidence for the head that carries the complete implementation and its
documentation, `6daf083a2e1a958709f8548c9faf7d439ccb1446`:

| Event | Run | Head | Conclusion | Jobs |
| ----- | --- | ---- | ---------- | ---- |
| `push` | `39054392152` | `6daf083` | success | all seven green |
| `pull_request` | `39054417610` | `6daf083` | success | all seven green |

Both events were confirmed on the exact SHA (`gh run view --json headSha`). The seven
required checks - `fast-checks`, `backend-unit`, `backend-integration-database`,
`contract-drift`, `dependency-audit`, `flutter-build-windows`, `flutter-build-android`
- are each `success` on both runs.

The record commit that carries this section is documentation-only; its exact head is
verified green on both events after publication and is the value quoted in the final
acceptance report (§19).

### 3.7 PR

PR **#19**, base `codex/my-shop-m2-s2-identity-auth` (the locked M2-S2 branch,
PR #18), head `codex/my-shop-m2-s3-rbac-permissions`. It is **OPEN** and unmerged,
stacked on PR #18, with no auto-merge. The merge is the owner's decision (G-12).

### 3.8 Security threat-model walk

§13.7 walked for the first **authorization** surface. S-01…S-22 are the threats this
slice introduces or touches, and what refuses each.

| ID | Threat | Control | Evidence |
| -- | ------ | ------- | -------- |
| S-01 | Privilege escalation through a role edit | Unknown ids and owner-exclusive ids for non-owner roles refused; the Owner role refuses every edit; the id-grammar CHECK restates the rule in the database | AC-11, §4 |
| S-02 | Owner-exclusivity leaked through an override | An owner-exclusive `ALLOW` is refused for a non-owner membership; a row written past the service is stripped by the resolver; verification refuses a non-owner snapshot naming one | AC-10, AC-20 |
| S-03 | Stale authority after a committed change | The `permissions_version` bump and the grant share one transaction; the outstanding token is refused `TOKEN_STALE` | AC-12, AC-13 |
| S-04 | Lost invalidation under concurrency | One atomic `UPDATE ... + 1` per row (an increment can never be lost or go negative); advisory locks serialize edits per role and membership | AC-14, §7 |
| S-05 | Cross-tenant grant injection | The composite foreign keys refuse a grant, an override, or a membership pointer naming another tenant's rows | AC-16, §4 |
| S-06 | Tenant spoofing through the request | The organization comes from the route and must be in the token's membership set; no body names a tenant | AC-15, AC-22 |
| S-07 | Guard-chain escape | `@Authorize` applies the bearer guard first; an absent principal is `UNAUTHENTICATED`, never a member | AC-22, AC-23 |
| S-08 | Validation-before-authentication interrogation | The suite proves a malformed body is `401` without a principal, never `400`, and only `400` once a verified principal exists | §3.4 |
| S-09 | A fail-open permission declaration | A handler declaring an id the catalog does not serve resolves to an absent member test and is refused | AC-23, §3.3 |
| S-10 | Snapshot forgery | RS256 verify against the identity public key; `alg` pinned before signature work; a tampered payload refused | AC-18 |
| S-11 | Snapshot misuse across context | Wrong issuer/audience/expiry refused; the catalog version is pinned to the served catalog | AC-18, AC-19 |
| S-12 | Offline grant amplification | A non-owner snapshot can never carry an owner-exclusive id: the mint refuses it and verification refuses a hand-signed one | AC-20 |
| S-13 | Snapshot replay beyond its window | A 72-hour TTL enforced against the server clock; expired refused `TOKEN_EXPIRED` | AC-18, §10 |
| S-14 | A caller-supplied device id | No endpoint accepts one and the snapshot carries none; device binding is M2-S5 | AC-21, §16 |
| S-15 | The snapshot replacing live authority | The server is the only permission authority; the snapshot is validated against the stored signature before any use (the offline consumer is M2-S4) | §38.17, §16 |
| S-16 | Poisoned stored state | Grants and overrides are tenant-scoped by composite FK, and resolution drops any stored id the catalog does not know (fail closed) | AC-16, §3.3 |
| S-17 | Enumeration through refusals | A foreign role id is `NOT_FOUND` - indistinguishable from a missing one; a scope mismatch is a single `ORGANIZATION_FORBIDDEN` with the event | AC-15, AC-16 |
| S-18 | Secret/token/driver exposure | No response, log, or CLI line carries a token, a signature, a hash, or driver text; the problem vocabulary stays the closed set | AC-24, §5 |
| S-19 | SQL/Prisma injection | Parameterized Prisma and tagged-template raw calls only; `gate` audit finds no interpolation | G-9 |
| S-20 | Role-separation regression | The new tables are migrator-owned and the application gains DML only through the default privileges; `roles.sql` untouched; no DDL for `my_shop_app` | AC-25, §4 |
| S-21 | Two first-touches racing the seed | A per-organization `pg_advisory_xact_lock`, re-read under the lock, insert-only - a seeded or an administrator-edited role is never deleted or overwritten | §7, AC-25 |
| S-22 | DoS via seeding or lock waits | The lock is taken only on the six-keys-miss path, once per organization, creating 6 roles and 94 grants | §3.3, §7 |

### 3.9 Requirements mapping (§40.6 M2-S3, §11)

- §40.6 M2-S3 outcome "Permission catalog, role presets, per-user overrides,
  effective-permission resolution, signed snapshot issuance" - §2.1 S-3…S-9, S-12,
  AC-05…AC-24.
- §40.6 M2-S3 key acceptance "Owner-exclusive permissions are structurally
  ungrantable" - AC-10, AC-11, AC-20 at the service, the resolver, the database CHECKs,
  and snapshot verification.
- §11.1 RBAC with a versioned catalog and presets, and the legacy `UserRole` enum not
  copied - §3.3, §11 D-1/D-3.
- §11.2 the string catalog `ownerExclusive` flag - §3.3, AC-10.
- §11.3 roles as data, the unique built-in Owner, the six presets, `salesOnly` kept as
  Salesperson - §3.3, AC-05…AC-07.
- §11.4 allow/deny evaluated after the role, the structural rule in the service layer
  - §3.3, AC-08…AC-10.
- §8.4/§39.2 tenancy owns the three tables and resolution - §3.3, §9.
- §9.3 the organization from the route, checked against the token, a security event on
  refusal - §3.3, AC-15, AC-22.
- §38.16.3/§38.17 the signed snapshot, strict validation, no owner-exclusive offline
  grant - §3.3, AC-17…AC-21.
- §13.1/§13.4/§13.6 - AC-24, AC-25, §5.
- §34.1-§34.3 - §10.
- §35.1/§35.4 - §4, AC-26.
- §36.1 T-2/T-5 - §3.2, §4.

---

## 4. Migration acceptance

- `prisma migrate deploy` from empty applies `0001`…`0007`, each exactly once, none
  rolled back (AC-01); a second deploy applies nothing and succeeds (AC-03).
- Drift: `migrate diff --exit-code` exits 0 in-suite (AC-04).
- Exactly the authorized tables exist - the eleven predecessor tables plus `roles`,
  `role_permissions`, and `permission_overrides` - and only those (AC-02). Owners are
  the migrator, and the application role keeps DML with no DDL (AC-25);
  `roles.sql` is untouched, so the column grant contract is unchanged.
- Database-enforced rules proved by rejection in always-rollback transactions (the
  `expectDbRejects` helper): a second owner role in one organization (the partial
  unique index `uq_roles_single_owner`), a `role_permissions` grant whose
  `(role_id, organization_id)` names another tenant's role, an override pointing at a
  membership of the wrong tenant, and a membership pointer to another tenant's role -
  the three composite foreign keys (§3.4).
- The `organization_memberships_role_id_organization_id_fkey` constraint is added to
  the M2-S1 structural comparison list as a **strengthening**: the legacy assertions
  remain exact equalities and now include the `0007` constraint (§15 D-4).
- The migration is additive: one nullable column (`role_id`) plus three tables; every
  existing row is untouched (§2.6, §17).

---

## 5. Security audit - supporting dimensions

| Dimension | Finding |
| --------- | ------- |
| Authentication | Nothing new is unauthenticated: every authorization route sits behind the composite `@Authorize` guard, and the integration suite proves 401 without a principal on each. |
| Authorization | The first permission-enforced surface. The tenant comes from the route and is checked against the token; the resolution is fail-closed; owner-exclusivity is refused at write, stripped at resolution, and refused at verification. |
| Secrets | No new secret, dependency, or environment variable: the snapshot reuses the identity key pair, and keys stay environment-only. Nothing secret reaches a response, log, or test. |
| Injection | Parameterized Prisma and tagged-template raw SQL only; no interpolation anywhere in the slice. |
| Crypto | RS256 over `node:crypto`, reusing the M2-S2 key material; the algorithm is pinned before signature work; no new primitive. |
| Errors | Stable problem codes from the closed vocabulary; no stack, SQL, or internal identifier leaves the process. |
| Dependencies | `npm audit --audit-level=high` posture unchanged: the slice adds **no** dependency. |

---

## 6. Data model and tenant invariants

- `tenancy` owns `roles`, `role_permissions`, and `permission_overrides`, and the new
  nullable `organization_memberships.role_id` - the §8.4/§39.2 split is now material:
  `identity` owns users and credentials, `tenancy` owns roles and resolution.
- `(id, organization_id)` on `roles` is the composite target of all three org-scoped
  foreign keys, which is what makes a role of one organization structurally unusable
  in another (AC-16). `(organization_id, key)` unique makes the seeding idempotent.
- The partial unique index `uq_roles_single_owner (organization_id) WHERE is_owner`
  mirrors `uq_organizations_single_owner`: ownership remains exactly one membership,
  and now exactly one role, per organization (AC-06).
- The `0006` `CHECK (permissions_version >= 0)` is the database's backstop for the
  service's increment-only bump (AC-14).
- Tenant invariants T-1…T-7 still wait for M2-S4: **no RLS policy and no `SET LOCAL`**
  is introduced here (N-2). Tenant scope at this slice's boundary is the route check
  plus the tenant-scoped composite foreign keys.

---

## 7. Idempotency and concurrency contract

- **Seeding** is idempotent (AC-05, AC-26): a fast six-keys read skips the lock; the
  slow path takes `pg_advisory_xact_lock` keyed per organization, re-reads under the
  lock, and creates only missing roles and grants, then assigns the Owner role to the
  owner membership. Two racing first-touches converge on one state; seeding never
  overwrites a stored grant and never deletes a role an administrator edited.
- **Role replacement** takes `pg_advisory_xact_lock` keyed by role id: two concurrent
  edits of the same role serialize, so the delete-and-recreate never interleaves, and
  every holder's bump is written by the winner.
- **Membership assignment** takes the same shape keyed by `(organization, user)`,
  which is what makes set-replacement of overrides race-free.
- **The version bump** is one `UPDATE ... permissions_version = permissions_version + 1`
  per row - atomic, monotonic, and never negative (CHECK from `0006`). Concurrent
  bumps both apply; no increment is lost.
- **A change and its invalidation cannot part**: the bump is written through the same
  interactive transaction as the grant it invalidates. A transaction that commits
  without the bump (or vice versa) is not producible by any path in the slice.

---

## 8. Authorization administration contract

No CLI in this slice (the operator commands of M2-S1/M2-S2 are untouched). The
administration surface is exactly the three org-scoped routes under §2.1 S-9, each
behind a permission:

| Route | Permission | Behaviour |
| ----- | ---------- | --------- |
| `GET /roles` | `roles.manage` | Lists the seeded plus edited roles with their stored grants, catalog-ordered. |
| `PUT /roles/:roleId/permissions` | `roles.manage` | **Replaces** the grant set (set, not merge). |
| `PUT /memberships/:userId/authorization` | `users.manage` | **Replaces** the override set and assigns (or clears) the role in one transaction. |

Refusals are stable codes from the closed vocabulary:

| Situation | Response |
| --------- | -------- |
| No bearer token / unverified token | `401 UNAUTHENTICATED` |
| Route organization not in the token | `403 ORGANIZATION_FORBIDDEN` **and** a security event |
| Caller lacks the route's permission | `403 PERMISSION_DENIED` |
| Malformed body, unknown permission id | `400 VALIDATION_FAILED` |
| Owner role edit; owner-membership change; owner-exclusive id for a non-owner role; id in both `allow` and `deny` | `400 VALIDATION_FAILED` |
| Unknown **or foreign** role id | `404 NOT_FOUND` (ADR-029), never a 403 |
| Outstanding token after a committed change | `401 TOKEN_STALE` until re-authentication |

A caller that resolves but is not permitted is never told which ids another tenant
holds; the foreign-role case is deliberately indistinguishable from no such role.

---

## 9. Bounded-context ownership and dependency direction

- `tenancy` owns the authorization tables and resolution; `identity` owns users and
  sessions; `common/authorization/` is the neutral composition layer that stacks on
  both and is imported by neither (§39.3 D-1, extended by S-11).
- `import-boundary.spec.ts` is the machine gate: `tenancy`/`identity` may not import
  `authorization`, and `authorization` may not import `bootstrap` (§3.3). Still no
  `tenancy -> identity` edge: the guard receives the already-verified principal and
  the security-event sink through the composition layer.
- The service depends on the narrow `PrismaHost` seam rather than on a concrete
  provider - the same structural-host pattern `common/identity/prisma-host.ts`
  established.

---

## 10. Contract, API, and offline surface

- Five new org-scoped endpoints under `/api/v1/organizations/:organizationId`:
  `GET /authorization/me`, `POST /authorization/snapshot`, `GET /roles`,
  `PUT /roles/:roleId/permissions`, `PUT /memberships/:userId/authorization` - §2.1
  S-9, with contract classes, `@ApiProperty` metadata, and the global validation pipe
  (§34.1-§34.3).
- The OpenAPI artifact and generated schemas were regenerated and are byte-stable
  (`contracts:check` green, AC-27). No global prefix was added; controllers declare
  full paths, preserving the convention.
- The snapshot TTL is the 72-hour code constant; the issuer/audience pair is
  `my-shop` / `my-shop:authorization-snapshot`. The offline **consumer** of the
  snapshot and the mutation ingress stay fail-closed and are M2-S4 (N-5);
  `gate:offline` is green with no new exemption.
- No endpoint reads a device id (AC-21), and no endpoint other than the five above was
  added or changed.

---

## 11. Decisions

- **D-1 Catalog as code, versioned by a constant.** `PERMISSION_CATALOG_VERSION`
  increments when the entries change; the database stores only grant edges, so the
  catalog grows without a schema migration (§11.2).
- **D-2 Lazy seeding.** The bootstrap composition root is outside this slice's allowed
  paths, so seeding runs on the first authorization touch of an organization - which
  is simultaneously the §35.4 upgrade path for a pre-`0007` organization. Seeding is
  insert-only and never bumps `permissions_version`.
- **D-3 The seeded grant total is 94.** Owner 36, Manager 34 (35 grantable minus
  `sales.viewAll`), Cashier 7, Salesperson 5, Stockkeeper 5, Accountant 7. The sets
  derive from the catalog at load time, not from a hand-copied list.
- **D-4 Resolution order is fixed.** `isOwner` -> whole catalog; otherwise role grants
  minus `DENY` overrides plus non-structural `ALLOW` overrides, in catalog order,
  returned frozen. Unknown ids are dropped wherever they appear (fail closed).
- **D-5 The owner is immutable by write.** The Owner role refuses edits and the owner
  membership refuses role/override changes, so stored state cannot disagree with the
  structural resolution.
- **D-6 Snapshot shape.** RS256 JWS, 72-hour TTL, issuer `my-shop`, audience
  `my-shop:authorization-snapshot`, claims `{ sub, org, role, owner, perms,
  perms_version, catalog_version, iss, aud, iat, exp }`, and **no** device claim
  (device binding is M2-S5; nothing in this slice accepts a device id).
- **D-7 One permission per handler.** `@Authorize(permission?)` stamps a single
  optional permission and the guard reads it with `getAllAndOverride`, so a later
  entry can never silently overwrite an earlier one.
- **D-8 Composition DI.** `PrismaService` satisfies `PrismaHost` directly and is
  passed as is - the client is read at call time through the service's `prisma`
  getter, so the graph boots without a configured database and fails closed on use.
- **D-9 `role_id` is nullable.** Expand/contract (§35.2): the column and its composite
  FK land now; the idempotent application seeding fills the value for organizations
  created before `0007`.

---

## 12. Scope-difference report

1. **The brief's "34 ids across 8 categories" became the plan's 36 across nine.**
   Declared before implementation (§1.3-§2 and §2.5 S-3): §11.2's catalog table is the
   authority (§43.4), the brief's own parenthetical enumerates nine category names, and
   the committed catalog is the plan's 36. Recorded here so the count is not read as an
   implementation overflow.
2. **The integration suite proves a stronger ordering than §2.4 declared.** The
   declaration promised "400 for a malformed body"; the built suite asserts the
   malformed body is refused **401 without a principal and 400 only once a verified
   principal exists** - authentication precedes validation, so an unauthenticated
   caller cannot interrogate the validator. Functions are unchanged; the declared
   refusal remains available to an authenticated caller.
3. **Nothing else.** No allowed path outside §2.3 was touched, and no `non_scope`
   item was reached (G-05, G-06).

---

## 13. Acceptance criteria roll-up

| # | Criterion | Status | Evidence |
| - | --------- | ------ | -------- |
| AC-01 | `0001`-`0007` apply once from empty | PASS | §3.4, §4 |
| AC-02 | Only the authorized tables exist (eleven + three) | PASS | §3.4, §4 |
| AC-03 | Second deploy applies nothing and succeeds | PASS | §3.4, §4 |
| AC-04 | Schema and history agree (drift exit 0) | PASS | §3.5, §4 |
| AC-05 | A bootstrap-created organization has all six presets; the owner carries the Owner role | PASS | §3.4 |
| AC-06 | The Owner holds the whole catalog and is unique per organization | PASS | §3.4 |
| AC-07 | A Manager holds no owner-exclusive permission and not `sales.viewAll` | PASS | §3.4 |
| AC-08 | `ALLOW` grants; `DENY` removes | PASS | §3.4 |
| AC-09 | `DENY` beats the role grant and a same-permission `ALLOW` | PASS | §3.4 |
| AC-10 | Owner-exclusive `ALLOW` cannot reach a non-owner (write refused; stored rows stripped) | PASS | §3.4 |
| AC-11 | Role edit refuses unknown and owner-exclusive ids for non-owner roles | PASS | §3.4 |
| AC-12 | A role edit bumps every holder; outstanding tokens go `TOKEN_STALE` | PASS | §3.4 |
| AC-13 | A membership change bumps exactly that user, atomically | PASS | §3.4 |
| AC-14 | Never decrements; never leaves a committed change unbumped; never negative | PASS | §3.4, §7 |
| AC-15 | Route organization checked against the token; body never names a tenant | PASS | §3.4 |
| AC-16 | Composite foreign keys refuse cross-tenant grants and pointers | PASS | §3.4, §4 |
| AC-17 | Snapshot verifies; carries the set, version, org, and timestamps | PASS | §3.4 |
| AC-18 | Tampered/foreign/`alg` downgrade/expired/wrong issuer or audience refused | PASS | §3.4 |
| AC-19 | A wrong `catalog_version` is refused | PASS | §3.4 |
| AC-20 | Never mints; never verifies an owner-exclusive id for a non-owner | PASS | §3.4 |
| AC-21 | No endpoint accepts a device id; the snapshot carries none | PASS | §3.4 |
| AC-22 | `/me` requires a valid bearer and returns only the requested organization's set | PASS | §3.4 |
| AC-23 | `PERMISSION_DENIED` without the permission; an unknown declared id fails closed | PASS | §3.4 |
| AC-24 | No token/signature/driver error in any response, log, or CLI output; closed vocabulary | PASS | §5, G-22 |
| AC-25 | Role separation unchanged; migrator-owned tables; `roles.sql` untouched | PASS | §3.4, §4 |
| AC-26 | A pre-`0007` organization is upgraded by idempotent application code | PASS | §3.4 |
| AC-27 | `contracts:check` in sync with the five routes | PASS | §3.5 |
| AC-28 | M1b/M2-S1/M2-S2 regressions pass; T-O6 still `DEFERRED_BY_PLAN` | PASS | §3.1, §3.4 |
| AC-29 | Flutter analyze clean and flutter test green | PASS | §3.1 |
| AC-30 | Exact-SHA CI green on both events, final HEAD | PASS | §3.6, §19 |

---

## 14. Gates

G-01…G-13 are the master plan's per-slice gates (§43.1); G-14…G-32 are this slice's
added gates. Every gate is PASS except **G-12**, which is **NOT SATISFIED** by design.

| Gate | Condition | Result |
| ---- | --------- | ------ |
| G-01 | Every declared acceptance criterion is verified | PASS - AC-01…AC-30 rolled up in §13 |
| G-02 | All declared tests exist and pass | PASS - §3.4 (unit 378/34 suites, integration 50/5, database 84/1, flutter green) |
| G-03 | Applicable §36.4 invariants pass | PASS - I-1…I-20 belong to later slices; the applicable analogues are the database-enforced owner uniqueness and tenant-scoped composite FKs (§4) |
| G-04 | All CI stages pass | PASS - local chain green (§3.1); seven checks green on the exact head for both events (§3.6, §19) |
| G-05 | No file outside `allowed_paths` modified | PASS - the branch diff is exactly the paths under §2.3 |
| G-06 | `non_scope` untouched | PASS - no UI, no RLS, no device registration, no audit tables, no token-format change (§2.2) |
| G-07 | Migration impact as declared; files immutable | PASS - `0007` additive; `gate:migrations` reports 8 paths, none rewritten |
| G-08 | Security impact as declared; no new unauthenticated endpoint | PASS - §3.8 S-01…S-22; every route requires a bearer |
| G-09 | No `GRANT`, no `search_path` change, no interpolation | PASS - §4; the migration is literal SQL |
| G-10 | Rollback defined and feasible | PASS - §17 |
| G-11 | Documentation updated (plan only if a decision changed) | PASS - this record; README §3.1-authorization; no plan decision changed |
| G-12 | Owner authorized the merge separately; no automated merge | **NOT SATISFIED** - PR #19 open; no merge performed |
| G-13 | Offline path: applicable T-O tests pass; §13.7 walked | PASS - `gate:offline` green; T-O6 skip preserved; §3.8 walked |
| G-14 | Schema and history agree (non-vacuous drift) | PASS - AC-04 |
| G-15 | Role separation unchanged; application gains no privilege | PASS - AC-25 |
| G-16 | New tables migrator-owned | PASS - AC-25 |
| G-17 | Owner-exclusivity is structural at write, resolution, and verification | PASS - AC-10, AC-11, AC-20 |
| G-18 | A change and its version bump are one transaction | PASS - AC-12, AC-13, §7 |
| G-19 | `permissions_version` is increment-only and never negative | PASS - AC-14 |
| G-20 | Tenant scope from the route, checked against the token | PASS - AC-15, AC-22 |
| G-21 | Cross-tenant references structurally impossible | PASS - AC-16 (composite FKs, proved by rejection) |
| G-22 | Idempotent application-code seeding, pre-`0007` upgrade included | PASS - AC-05, AC-26 |
| G-23 | Snapshot verification fails closed | PASS - AC-17…AC-20 |
| G-24 | No device id accepted or carried | PASS - AC-21 |
| G-25 | Guard and resolver cannot disagree | PASS - the guard resolves through the same service call (§3.3, AC-23) |
| G-26 | Unknown permission ids fail closed everywhere | PASS - catalog helpers, role write, resolver, guard, snapshot |
| G-27 | Bounded-context ownership honoured by an automated gate | PASS - `import-boundary.spec.ts` extended and green (§9) |
| G-28 | Legacy db-spec assertions strengthened, not weakened | PASS - the structural list gained the `0007` constraint as an exact equality (§15 D-4) |
| G-29 | Real-PostgreSQL acceptance, no mock and no silent skip | PASS - database suite 84/84; T-5 refusal preserved |
| G-30 | No secret, token, signature, or driver error in any output | PASS - AC-24; the redaction guard in `test-setup.base.ts` passed |
| G-31 | Contract regenerated byte-stable; five routes in OpenAPI | PASS - AC-27 |
| G-32 | Composition layer cannot create a context-inversion edge | PASS - `authorization` imports `identity`/`tenancy` only; neither imports it |

---

## 15. Deviations

- **D-1 The database project's declared 120 s budget was inert under Jest 30.5.2.**
  `jest-circus` resolves the per-test timeout only from the **global** config's
  `testTimeout`, so the `database` project's `testTimeout: 120_000` in
  `jest.config.mjs` - still shown by `jest --showConfig` - is ignored at run time.
  The budget was made effective where it belongs to the suite, with a file-scoped
  `jest.setTimeout(120_000)` in `postgres.db-spec.ts`. `jest.config.mjs` is outside
  this slice's allowed paths and was **not** changed (G-07). The integration project's
  per-test timeout has the same quirk, but its slowest test finishes well inside the
  5000 ms default, so nothing needed changing there.
- **D-2 AC-26's pre-`0007` organization is inserted by the migrator client, not by**
  **`OrganizationBootstrapService`.** To represent an organization that predates the
  column, the test writes the pre-`0007` shape through raw SQL: the current-schema
  Prisma client would emit `RETURNING role_id` against a `0007` database whose
  organizations row it did not create, and the *upgrade itself* - the part AC-26
  demands - is exercised exactly as declared in both the unit service suite and the
  database block.
- **D-3 The local generated Prisma client was stale.** Two `.prisma/client`
  directories existed locally (root and API workspace); the API workspace's copy,
  generated by the pinned CLI, resolved first. `npx prisma generate` refreshed it.
  This is an environment artifact only: `npm ci` regenerates the client in CI
  (postinstall), and no repository file changed for it.
- **D-4 The M2-S1 structural assertion was strengthened.** The migrated-FK comparison
  list now includes `organization_memberships_role_id_organization_id_fkey` as an
  exact equality - the direction of change is "more assertions", never fewer tests
  or weaker equalities (G-28).
- **No repair commit, no history operation.** The branch was built by ordinary
  commits from `e825d05`; nothing was force-pushed, rebased, or reset, and `main` was
  never touched.

---

## 16. Residual risks and stated limits

- **No RLS and no `SET LOCAL` yet.** Tenant-isolation _enforcement_ at the database
  layer arrives with M2-S4 (N-2). Until then, tenant scope is the route check against
  the token plus the tenant-scoped composite foreign keys - stated, not hidden.
- **No durable audit table.** Refusals and security events flow through the
  `SecurityEventSink` port (logged); the durable `security_events`/`audit_events`
  tables are M2-S6 (N-4).
- **No business endpoint consumes a permission yet.** The guard is exercised by the
  authorization administration surface itself; M3 endpoints adopt `@RequirePermission`
  (N-7).
- **No snapshot consumer exists.** The offline session and its re-authorization
  pipeline are M2-S4 (N-5); the snapshot is issued and verified but not yet carried.
- **Device binding is absent by design.** Nothing binds a snapshot to a device until
  M2-S5 (N-3), and no endpoint accepts one (AC-21).
- **Custom roles are not creatable.** The six presets plus edits of non-owner preset
  roles are the whole administration surface this slice; custom role CRUD is a later
  slice (N-9), and `is_system` already marks the built-ins.
- **The 72-hour TTL is a constant**, not an owner-controlled setting (N-6 - M3 owns
  organization settings).
- **Clock trust.** Snapshot and token expiry are enforced against the server clock; no
  external time source is consulted (unchanged posture).

---

## 17. Rollback

Revert the slice commits and redeploy the prior head: the authorization module unbinds
with the single `AppModule` import line, and the process then runs exactly as before
M2-S3. The migration is additive: `0007` may be left in place (nothing outside the
slice reads it after revert) or removed by a later forward-only migration that drops
the three tables, the `role_id` column, and their constraints - with the loss of role
rows acknowledged as the deliberate cost, and no existing tenant data transformed by
either migration. `roles.sql` and `0001`-`0006` are untouched, so the database-role
contract is unchanged. Should a shared environment ever require reversal, §35.1's
forward-only rule applies: a new migration numbered after `0007`. `main` stays
untouched.

---

## 18. Deferred design notes

- **RLS policies and per-request `SET LOCAL`.** M2-S4 (N-2), which also owns the
  offline mutation ingress and re-authorization (N-5) - the snapshot this slice issues
  and verifies is the input to that boundary.
- **Device registration, installation identity, and snapshot device binding.** M2-S5
  (N-3). Until then the sync boundary refuses every request and no device id exists in
  any surface.
- **Durable `security_events`/`audit_events` storage.** M2-S6 (N-4); the sink port is
  the integration point the guard already writes through.
- **Role management UI and any Flutter surface.** M2-S7 (N-1).
- **Permission enforcement on business endpoints.** M3+ (N-7), adopting the
  `@RequirePermission` guard as is.
- **Custom role creation/deletion.** Later slices (N-9).
- **Owner-controlled `offline_grace_duration` / organization settings.** M3 (N-6).

---

## 19. Commit ledger, final SHA, and remote lock

| Commit | Type | Subject |
| ------ | ---- | ------- |
| `d088e82` | `docs(m2-s3)` | declare the RBAC and permissions slice before implementation |
| `e2dc979` | `feat(m2-s3)` | add the `roles`, `role_permissions`, and `permission_overrides` tables |
| `1b979a2` | `feat(m2-s3)` | add the permission catalog, role presets, and the resolver |
| `523c40a` | `feat(m2-s3)` | add the authorization service and its unit tests |
| `f85f977` | `feat(m2-s3)` | add the signed authorization snapshot and its unit tests |
| `368c845` | `feat(m2-s3)` | add the authorization guard, routes, and module wiring |
| `8a99b67` | `test(m2-s3)` | add the authorization integration suite and the database acceptance block |
| `6daf083` | `docs(m2-s3)` | document the authorization surface and the permission model (implementation head) |
| _record commit_ | `docs(m2-s3)` | record the execution evidence, threat walk, and remote lock |

**Base:** `e825d05a1fe026fccda0a44243a780ca7d72244c` (locked M2-S2 head, PR #18 open).
**Implementation head:** `6daf083a2e1a958709f8548c9faf7d439ccb1446`. **Record head:**
the commit that carries this section (documentation only).

Remote lock: on the exact implementation head `6daf083`, all seven required checks
are green on **both** the `push` run `39054392152` and the `pull_request` run
`39054417610` (both runs were confirmed on that SHA). The record commit that carries
this section is documentation-only; its exact head is verified green on both events
after publication and is the value quoted in the final acceptance report. PR #19 is
left open; owner merge authorization is required, and nothing is merged and no
auto-merge is enabled.

---

## 20. Boundary and verdict

The next unit the master plan defines after M2-S3 is **M2-S4** (§40.6 - row-level
security policies, `SET LOCAL`, and the offline mutation ingress). It is **NOT
AUTHORIZED** by this record and is **not** started here. M2-S5 (device binding), M2-S6
(durable audit streams), and M2-S7 (Flutter role management) remain later concerns, as
does the M3 business surface that adopting `@RequirePermission` at scale implies.

On the acceptance gate: **G-12 is NOT SATISFIED** - PR #19 is left open and no merge
was performed. The merge is the owner's decision, not this slice's.

```
NO MERGE PERFORMED - OWNER MERGE AUTHORIZATION REQUIRED
PASS_MY_SHOP_M2_S3_RBAC_REMOTE_LOCKED
```
