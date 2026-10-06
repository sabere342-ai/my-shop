# MY SHOP — M1-S3 SLICE RECORD: PRISMA BOOTSTRAP

**Master plan:** `docs/governance/MY_SHOP_MASTER_PLAN.md` v1.1.0 — §40.4 (M1-S3), §40.1 (slice governance)
**Slice:** M1-S3
**Branch:** `codex/my-shop-m1-s3-prisma-bootstrap`
**Predecessor:** `dcca491120df30cfb6961d80ee0f8e6cc9db6144` — M1-S2, branch `codex/my-shop-m1-s2-backend-skeleton`, pushed, no PR yet (`gh` unavailable)
**Declaration version:** 1.0.0 (declared before implementation work, per §40.1)

---

## 1. Predecessor state, verified not assumed

| Check | Value | Result |
|---|---|---|
| Repository root | `C:/dev/my-shop` | pass |
| Local `main` | `53f6aaa9aded2ec2218cec3f8987675a824b70db` | pass |
| `origin/main` | `53f6aaa9aded2ec2218cec3f8987675a824b70db` | pass — identical, no divergence |
| Direct remote | `https://github.com/sabere342-ai/my-shop.git` | pass |
| M0-P1 | `701255fe1ec8d54096ed0d571450f0e8cfdefc4e`, PR #1 head, open | pass |
| M0-P2 | `0d25bd35878e4f19b2408c6d783e3c2810f80c20`, PR #2 head, open | pass |
| M1-S1 | `bcc853dc304ac591be00fc423a8c35c24e2febb9`, pushed, no PR | pass |
| Predecessor M1-S2 | `dcca491120df30cfb6961d80ee0f8e6cc9db6144`, 0/0 vs origin | pass — in sync |
| Predecessor ancestry | `bcc853d` is an ancestor of `dcca4911` | pass — correctly stacked |
| Working tree at start | clean | pass |
| Stash | empty | pass |
| Active git operations | none | pass |

**Predecessor discipline (§7 of the authorization).** The work chain is a stack of unmerged
branches. This slice branches from `dcca4911` (M1-S2), **not** from `main`; `main` carries only
the M0-era state and none of the M1 work, so starting there would discard it.

**Merge policy (§8).** No merge is performed by this slice. PR #1 and PR #2 remain open, and the
M1 branches are pushed without PRs because `gh` is not installed on this host. Gate **G-12** and
CI gate **G-4** both require an explicit, separate owner authorization that this slice does not
have.

---

## 2. Declaration

### 2.1 `scope`

| # | Outcome |
|---|---|
| S-1 | Prisma 6 is installed in `services/api`, pinned exact, with a schema skeleton (`datasource` + `generator`, **no models**) and `prisma generate` wired into `postinstall` |
| S-2 | One forward-only initial migration exists and applies from an **empty** database with `prisma migrate deploy`, idempotently on re-run (§8.3, §35.1) |
| S-3 | Two database roles exist with least privilege: `my_shop_migrator` (DDL only, `NOCREATEDB`/`NOBYPASSRLS`) and `my_shop_app` (DML only), created idempotently from committed static SQL (`prisma/roles.sql`) per §13.4 |
| S-4 | Role separation is enforced at configuration time: identical identity in `DATABASE_URL` and `MIGRATION_DATABASE_URL` refuses startup with exit 78, naming both variables and §13.4, never values |
| S-5 | A `PrismaService` registers a `database` readiness check **before** connecting, so an outage yields `/readyz` 503 with the safe reason `unavailable` (§13.1, §37.4) and graceful shutdown stays quiet during that outage |
| S-6 | Database maintenance exists as one operator entry point (`scripts/db.mjs`: `deploy`/`dev`/`status`/`bootstrap`/`test-setup`/`test-drop`) with a guard that refuses any database except the fixed `my_shop_test` for the test paths (§36.1 T-5) |
| S-7 | A database acceptance suite runs against **real PostgreSQL 18**: migration workflow, role separation (live `pg_roles` evidence), and readiness positive/negative — no silent skips |
| S-8 | Documentation updated: root README state table and a "Local database" section; this slice record |

### 2.2 `non_scope`

Named explicitly, per §40.1.

| Not touched | Reason |
|---|---|
| Any business/domain table or model | §40.4 non-scope; domain schema arrives after the bootstrap slices |
| Domain modules, endpoints, use cases | M1-S4+; §2.4 anti-scope rule |
| RLS policies | M2-S4; §13.3 |
| CI workflow definitions | M1-S4 |
| Flutter/Drift local schema | M1-S5 / M1b; §40.5 |
| Contract generation and drift gate | M1-S6 |
| Role password wiring / secret-manager integration | No secret manager exists yet; §13.6 forbids inventing one here |
| Seeding, fixtures, production deployment | Not in §40.4 M1-S3 |
| Any edit to the Master Plan | §43.4 — no decision changed |
| Merging anything to `main` | G-12, G-4 |

### 2.3 `allowed_paths`

```
.env.example
README.md
package.json
package-lock.json
services/api/**
docs/governance/MY_SHOP_M1_S3_PRISMA_BOOTSTRAP_SLICE_RECORD.md
```

Nothing outside this list is modified. `docs/governance/MY_SHOP_MASTER_PLAN.md` and the existing
M0/M1 records are **read-only** for this slice.

### 2.4 `tests`

| Level | Requirement |
|---|---|
| Static analysis | `tsc --noEmit`/`tsc --build` clean across every TypeScript workspace |
| Lint / format | `eslint` and `prettier --check` clean |
| Unit | Jest suite passes (config validation, `PrismaService` lifecycle/probe) |
| Database acceptance | Jest `database` project passes against real PostgreSQL 18 — no skips |
| Migration workflow | `migrate deploy` from an empty database, then idempotent re-run |
| Role separation | Live assertions on `pg_roles`, `current_user`, granted privileges, refused DDL |
| Readiness | `/readyz` 200 with `database` check when up; 503 safe reason when unreachable |
| Guard negative | Same-role configuration refuses startup with exit 78 |
| Security | `npm audit` has **0 high** findings (R-8/§36.5); secret scan of the diff |

### 2.5 `acceptance_criteria`

Binary and checkable.

| # | Criterion |
|---|---|
| AC-1 | `node scripts/db.mjs test-setup` creates the empty database, applies roles, and `prisma migrate deploy` applies the initial migration from empty; a second deploy applies nothing |
| AC-2 | After deploy, the only user table is `_prisma_migrations`; no business table exists |
| AC-3 | `my_shop_migrator` exists with `rolcanlogin` true and `rolsuper`/`rolcreatedb`/`rolcreaterole`/`rolbypassrls`/`rolreplication` all false; it can `CREATE TABLE` |
| AC-4 | `my_shop_app` has the same five negative flags, sees `current_user = my_shop_app`, can `INSERT` into a migrator-created table (default privileges incl. its sequence), and is **refused** `ALTER`/`CREATE` with the object left absent |
| AC-5 | `prisma/roles.sql` is idempotent: a second bootstrap succeeds and re-pins the flags |
| AC-6 | Identical app-role identity in `DATABASE_URL` and `MIGRATION_DATABASE_URL` exits **78** with a message naming both variables and §13.4, containing no URL, password, or host value |
| AC-7 | With the database reachable: `/readyz` → 200 `{"ready":true,"checks":{"database":{"ok":true}}}` and the runtime DB user is `my_shop_app`. With the database unreachable: `/readyz` → 503 `{"ok":false,...,"reason":"unavailable"}` with no role/host/port leakage, while `/healthz` stays 200 |
| AC-8 | The test paths refuse to run when the configured URLs do not name the fixed `my_shop_test` database (guard test present and passing) |
| AC-9 | `npm run verify:node` and `npm run build` pass; `npm audit --audit-level=high` exits 0 (0 high, the 20 moderates pre-dating this slice) |
| AC-10 | No credential or live connection string committed; `.env.example` carries placeholders only |
| AC-11 | No file outside `allowed_paths` is modified |
| AC-12 | The Master Plan is byte-identical to its M1-S2 state |

### 2.6 `migration_impact`

**Yes, as declared.** One initial, comment-only skeleton migration plus committed static role/grant
SQL. Forward-only (§35.1); no destructive operation; nothing touches a production database — §8.3
keeps `migrate deploy` as the only deployment-path command, and migration authoring (`db:dev`) is
refused when `NODE_ENV=production`.

### 2.7 `security_impact`

New local database roles at least privilege (§13.4, G-9: no `GRANT ALL`, no `SECURITY DEFINER`,
no `BYPASSRLS`, migrator never the app's owner); no passwords stored or logged (§13.6, §42.6);
role identity deliberately excludes the password so rotation is not an identity change; no new
network endpoint or permission. Dependency audit stays at 0 high (R-8).

### 2.8 `rollback`

Delete the branch. The slice is additive at the repository level; its database artifacts exist
only in local development databases that the test harness drops after itself. Reverting the single
commit is equally sufficient. `main` is untouched at `53f6aaa9`.

### 2.9 `publication_gate`

| Field | Value |
|---|---|
| PR target | `codex/my-shop-m1-s2-backend-skeleton` (the open stack head) |
| Required checks | stages 1–18 of §37.2 as far as they are defined at this slice |
| Merge | **Owner only.** G-12 and G-4 apply. No automated merge exists |

---

## 3. Topic — how the bootstrap is built

### 3.1 Prisma as the migration engine, pinned to 6.12.0

ADR-005 fixes Prisma on PostgreSQL 18 and NestJS 11. The `prisma` and `@prisma/client` packages
are pinned to exact `6.12.0`: the 6.19.x line reports three high-severity advisories, and §36.5
plus R-8 make an open high finding a gate failure. The CLI is driven through its supported Node
entry (`prisma/build/index.js` from the workspace dependency), so no global install is assumed.

The datasource URL is `env("DATABASE_URL")` — the application role by default — and the wrapper
in `scripts/db.mjs` rebinds it to `MIGRATION_DATABASE_URL` for every migration command, which is
how one schema file serves both roles without duplication.

### 3.2 An empty migration is the honest first migration

`0001_schema_skeleton` contains only a comment. That is not a placeholder dodge: it makes the
migration history **drift-protected from the first commit** — `migrate deploy` from empty creates
`_prisma_migrations`, records the entry, and any later schema change must arrive as a real,
reviewable migration (§35.1). Domain tables are explicitly out of scope (§40.4), so a fabricated
"real" table here would violate the declaration.

### 3.3 Two roles, static SQL, no passwords in the repository

`roles.sql` is committed, static, idempotent PL/pgSQL (`DO $$` blocks that `CREATE ROLE` if absent
and `ALTER ROLE` to re-pin flags on every run). The migrator gets `USAGE, CREATE` on the schema and
nothing else; the app gets `USAGE` on the schema, DML on all tables/sequences via
`ALTER DEFAULT PRIVILEGES FOR ROLE my_shop_migrator`, and **no** DDL capability. Neither role gets
a password in the repository — connections rely on local `trust` for development, and real
credentials belong to the secret manager the plan calls for later (§13.6).

The `NOCREATEDB` pin is not decoration: a manual deploy against a non-existent database was
observed failing with `permission denied to create database`, which is exactly the refusal §13.4
asks for. Database creation is therefore an administrative act (the `bootstrap`/`test-setup` paths
use `ADMIN_DATABASE_URL`), and the README says so.

### 3.4 Configuration refuses role collapse before anything connects

`app.config.ts` validates both URLs as postgres schemes and compares a **role identity** of
`username|hostname|port|pathname` — password deliberately excluded, so a rotated password on the
same role is still one identity (unit-tested). A violation joins the existing violation list and
exits 78 with a message that names the variables and §13.4 and never echoes a value.

### 3.5 Readiness before connection, and a shutdown that survives outages

`PrismaService` is a plain class provided by a global `DatabaseModule.forRoot(config)`. It
registers the `database` check **before** `$connect()`, so an unreachable database produces a
503 with the safe reason `unavailable` (never the dependency's name or host, §13.1) while
`/healthz` stays 200 (§37.4).

The negative acceptance test surfaced a real failure worth recording: Prisma emits an **internal,
unobservable rejection** when `$disconnect()` aborts a probe query that is still in flight — which
is precisely the state an outage leaves behind. The process died during graceful shutdown of the
very scenario readiness exists for. Isolated reproductions confirmed the mechanism (query settling
on its own: clean; disconnect mid-flight: unhandled rejection; query settled first, then
disconnect: clean). The fix: the service tracks in-flight probes and `onModuleDestroy` awaits
their settlement — bounded by Prisma's own connection timeout — before disconnecting. A unit test
locks the ordering in.

### 3.6 One operator entry point, guarded

`scripts/db.mjs` subcommands all funnel through the same script the acceptance suite itself uses,
so what the tests exercise is what operators run. `test-setup`/`test-drop` hard-refuse any
configured database that is not the fixed `my_shop_test`, refuse an admin URL that names the same
database as the app URL, and never print a connection string (§36.1 T-5 — no silent skips, no
accidental drops).

---

## 4. Results

### 4.1 Acceptance criteria

| # | Criterion | Evidence | Result |
|---|---|---|---|
| AC-1 | Deploy from empty, then idempotent | `test-setup` output: `Applying migration 0001_schema_skeleton` on a freshly created database; second deploy: `No pending migrations to apply` | **PASS** |
| AC-2 | Only `_prisma_migrations` exists | database suite workflow block asserts no other user table | **PASS** |
| AC-3 | Migrator flags + DDL | live `pg_roles` query: all five negatives false, login true; `CREATE TABLE` succeeds, owner = `my_shop_migrator` | **PASS** |
| AC-4 | App DML yes, DDL no | `INSERT DEFAULT VALUES` succeeds (default privileges + sequence); `CREATE TABLE`/`ALTER TABLE` refused by Postgres, object absent afterwards; `current_user` = `my_shop_app` | **PASS** |
| AC-5 | roles.sql idempotent | second `db:bootstrap` run exits 0 and re-pins flags | **PASS** |
| AC-6 | Config refusal, exit 78 | `node dist/main.js` with both URLs = app role: `Configuration is invalid; refusing to start.` — `database: DATABASE_URL and MIGRATION_DATABASE_URL identify the same role, host, and database; Master Plan section 13.4...`, exit **78**, no values leaked | **PASS** |
| AC-7 | Readiness both directions | positive: `READYZ 200 {"ready":true,"checks":{"database":{"ok":true}}}`; negative (suite): 503 `unavailable`, body contains no role/host/port, `/healthz` 200; runtime boot on port 3100 in `NODE_ENV=production` served both | **PASS** |
| AC-8 | Fixed-database guard | suite `requireTestUrls()` tests + the observed refusal semantics: URLs naming anything but `my_shop_test` are rejected before any statement runs | **PASS** |
| AC-9 | Gates + audit | `npm run verify:node` exit 0; `npm run build` exit 0; `npm audit --audit-level=high` exit 0 — **0 high / 20 moderate** (baseline unchanged) | **PASS** |
| AC-10 | No committed secret | full-diff scan: only `<…password>` placeholders in `.env.example` and deliberate unit-test fixtures (`old-password`, `do-not-log-this`) | **PASS** |
| AC-11 | Paths within allow-list | `git status`: 9 modified files + 4 new directories, all under `.env.example`, `README.md`, root `package.json`/`package-lock.json`, `services/api/**`, `docs/governance/<this record>` | **PASS** |
| AC-12 | Master Plan untouched | `git status` shows no change to `MY_SHOP_MASTER_PLAN.md` | **PASS** |

### 4.2 Gates G-1 to G-13

| Gate | Result |
|---|---|
| G-1 acceptance criteria verified and recorded | PASS — §4.1 |
| G-2 declared tests exist and pass | PASS — §4.3 |
| G-3 applicable §36.4 invariants | **Not applicable.** No business rule exists yet to violate; domain data is out of scope |
| G-4 all CI stages pass | **Partial.** Satisfied locally by `npm run verify:node`; **CI itself does not exist** — M1-S4. Recorded as a gap, not as a pass |
| G-5 no file outside `allowed_paths` | PASS |
| G-6 `non_scope` verifiably untouched | PASS — no domain tables, no RLS, no CI, no Flutter, no Master Plan edit |
| G-7 migration impact as declared | PASS — one comment-only skeleton migration + role SQL, forward-only |
| G-8 security impact as declared | PASS — no new endpoint/permission; roles least-privilege; no committed secret |
| G-9 migration audit | **PASS.** Static SQL only (no interpolation, §8.3); forward-only (§35.1); no `GRANT ALL`, no `SECURITY DEFINER`, no `BYPASSRLS`; migrator is not the app's owner; `db:dev` refused under `NODE_ENV=production` |
| G-10 rollback defined and feasible | PASS — delete the branch; `main` untouched at `53f6aaa9` |
| G-11 documentation updated | PASS — README state table + Local database section; this record |
| G-12 owner authorized the merge | **NOT SATISFIED.** No merge performed, by design |
| G-13 offline path walkthrough | **Not applicable.** No offline code touched |

### 4.3 Tests

| Suite | Command | Result |
|---|---|---|
| Toolchain | `npm run toolchain:verify` | PASS |
| Format | `npm run format:check` | PASS — 3 of 3 workspaces |
| Lint | `npm run lint` | PASS — 3 of 3 workspaces |
| Typecheck | `npm run typecheck` | PASS — 3 of 3 workspaces |
| API unit + integration | `jest --selectProjects unit integration` (within `npm test`) | PASS |
| API database acceptance | `jest --selectProjects database` (real PostgreSQL 18) | PASS — workflow, role separation, readiness (+ new shutdown-ordering unit test) |
| Contracts | `jest` | PASS — 4 tests |
| Testkit | `jest` | PASS — 5 tests |
| **Total** | `npm run verify:node` | **PASS — 134 tests (125 API / 4 contracts / 5 testkit), 0 failures, exit 0** |
| Build | `npm run build` | PASS — `tsc --build`, 3 of 3 workspaces |
| Audit | `npm audit --audit-level=high` | PASS — 0 high (20 moderate pre-existing) |

The readiness-negative path was verified beyond green: the failure it initially produced (Prisma
internal rejection on disconnect-with-pending-probe) was reproduced in isolation, root-caused,
fixed, and pinned by a unit test. A test that only ever passed would not have proven that.

### 4.4 Deviations and decisions taken

| # | Deviation | Reason |
|---|---|---|
| D-1 | The initial migration is **comment-only** | §40.4 puts domain tables out of scope; an empty-but-recorded migration still gives §35.1 drift protection from commit one. Fabricating a table to make the migration look busy would violate the declaration |
| D-2 | Multi-statement SQL is split into single-statement `prisma db execute` calls | Prisma wraps `db execute` in a transaction; `DROP DATABASE` inside a transaction fails with `cannot run inside a transaction block`. Splitting is the only working form, and single statements are also safer |
| D-3 | `PrismaService` is a plain class; `DatabaseModule.forRoot(config)` provides its own `APP_CONFIG`/`APP_LOGGER` | A global module cannot see the root module's providers, and Nest would resolve a second `APP_CONFIG` token instance if it imported them. The module constructs the same validated config from `process.env` and creates its own logger instance — the pattern the bootstrap file already uses |
| D-4 | Jest gains a third project (`database`, `**/*.db-spec.ts`, 120 s timeout) | Database acceptance must not run inside the unit project's default 5 s budget, and its absence from `npm test` would make G-2 a lie |
| D-5 | The app role **can** read `_prisma_migrations` | It is born from migrator-created default privileges, so app DML privileges cover it too. Preventing that would need a schema the app cannot see — beyond this slice's declaration. Recorded as K-3 rather than hidden |
| D-6 | In-flight probes are awaited before `$disconnect()` | Disconnecting mid-probe made Prisma reject an internal promise nothing observes — an unhandled rejection during graceful shutdown of an outage. Reproduced, root-caused, fixed (§3.5) |
| D-7 | Root `db:migrate` forwards arguments through a trailing `--` | `npm run db:migrate -- dev` must reach `scripts/db.mjs dev` intact across two npm script layers |
| D-8 | Role identity excludes the password from the equality check | Same role, same host, same database is one credential whichever password it carries; otherwise every routine password rotation would refuse startup (unit-tested) |

### 4.5 Known diagnostics

| # | Diagnostic | Severity | Disposition |
|---|---|---|---|
| K-1 | No CI pipeline exists | High | **By design.** M1-S4. G-4 and the §37.2 stages are local-only until then |
| K-2 | No PR exists for M1-S1, M1-S2, or this slice | Medium | `gh` is not installed (K-6 of the M1-S1 record). Branches are pushed and verified with `git ls-remote`; the README says "no PR yet" rather than claiming one |
| K-3 | `my_shop_app` can `SELECT` from `_prisma_migrations` | Low | Default-privilege artifact of one schema (D-5). No data, no secret; revisit with the domain schema |
| K-4 | Role passwords are unwired (`trust` locally) | Medium | §13.6: credentials belong to a secret manager that does not exist yet. Recorded, not papered over |
| K-5 | `npm audit` reports 20 moderate (jest/ts-jest transitive) | Low | Pre-dates this slice; 0 high satisfies R-8. M1-S4 gets the automated audit gate |
| K-6 | `prisma` prints an 8.0.0-rc update banner on CLI runs | Low | Pinned by ADR-005 and D-8; adopting an RC is an owner decision |
| K-7 | README previously claimed "PR open" for M1-S1 | Low | **Corrected**: remote has no `refs/pull/*` for the M1 branches. The table now states the verified fact |
| K-8 | Local PostgreSQL is configured with `trust` for `127.0.0.1`/`::1` | Medium | Host-level development setting outside the repository's allow-list; production credentials are a deployment concern (§37.4) |

### 4.6 Next slice

**M1-S4 — backend CI.** The §37.2 pipeline stages, the automated audit gate, and the offline-path
checks, turning this slice's local-only G-4 into a real one. Predecessor: this commit.
Non-scope: domain schema, Flutter, contract codegen (M1-S5/M1-S6).

### 4.7 Rollback

`git branch -D codex/my-shop-m1-s3-prisma-bootstrap`. The slice changes no protected history, no
`main`, and no production database; local databases it created are dropped by its own test
harness or by `scripts/db.mjs test-drop`.

---

*End of M1-S3 slice record.*
