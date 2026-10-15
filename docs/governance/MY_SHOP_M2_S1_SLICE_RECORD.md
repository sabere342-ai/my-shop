# MY SHOP - M2-S1 SLICE RECORD: ORGANIZATIONS, MEMBERSHIPS, OPERATOR BOOTSTRAP

**Master plan:** `docs/governance/MY_SHOP_MASTER_PLAN.md` v1.1.0 — §40.6 (M2-S1), §8.1–§8.4 (one database, RLS contract, Prisma rules, schema-module ownership), §9.1–§9.2 (tenant model, invariants T-1…T-7), §10.1 and §10.4 (no public registration; operator-run bootstrap command), §11.3–§11.5 (Owner role unique per org; attribution), §34 (API conventions — no new endpoint here), §35 (migrations forward-only; seeding by application code at org creation), §36.1 T-2/T-5 (real PostgreSQL, no silent skips), §37.2 (CI stages), §39.2/§39.3 (bounded contexts; D-1, D-7), §40.1 (slice governance), §43.1 (G-1…G-13), ADR-001 (generated contract), ADR-005 (pinned stack)
**Slice:** M2-S1
**Branch:** `codex/my-shop-m2-s1-organizations-bootstrap`
**Predecessor:** `3993e424b9c701cce3759f72d8b86ac473b53576` — M1b-S10 (security-hardened verdict `PASS_MY_SHOP_M1B_S10_SECURITY_HARDENED_REMOTE_LOCKED`), branch `codex/my-shop-m1b-s10-offline-observability` (PR #16, open, base `codex/my-shop-m1b-s9-connectivity-backoff`, mergeable CLEAN)
**Repair commit:** none required against the predecessor
**Final SHA (implementation head):** _pending — completed by the final record commit; see §17_
**Declaration status:** `DECLARED — owner-authorized execution in progress (§40.1 fields fixed before any implementation file was touched)`

---

## 1. Predecessor state

### 1.1 Entry state, verified not assumed

| Check               | Value                                                                                                       | Result                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Repository root     | `C:/dev/my-shop`                                                                                            | pass                                                       |
| Remote              | `origin` -> `https://github.com/sabere342-ai/my-shop.git`                                                    | pass - repository identity confirmed                       |
| Branch at entry     | `codex/my-shop-m1b-s10-offline-observability` @ `3993e42`                                                   | pass - equals the expected S10 final SHA                   |
| Expected S10 SHA    | `3993e424b9c701cce3759f72d8b86ac473b53576`                                                                   | pass - local HEAD, `origin` S10 head, and PR #16 head agree |
| Branch created      | `codex/my-shop-m2-s1-organizations-bootstrap` from `3993e424`                                               | pass - independent stacked branch, clean worktree          |
| `origin/main`       | `53f6aaa9aded2ec2218cec3f8987675a824b70db` (= historical `53f6aaa`)                                         | pass - read only, unchanged by this slice                  |
| Worktree at entry   | clean (`git status --porcelain` empty)                                                                      | pass - started clean                                       |
| PR #16              | state OPEN, `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`, head `3993e424`, base M1b-S9 branch          | pass - predecessor PR open and unmerged                    |
| S10 final CI        | push run `38637074303` success; pull_request run `38637079573` success                                      | pass - remote reads confirmed                              |
| Prior M2-S1 work    | no `m2-s1` branch on the remote, no slice record, no code reference (repo-wide grep)                        | pass - nothing to resume, nothing to duplicate             |
| GitHub auth         | `gh` CLI authenticated as `sabere342-ai` (`repo`, `workflow` scopes), token never printed                   | pass                                                      |
| Local PostgreSQL    | service `postgresql-x64-18` **running** on `127.0.0.1:5432`; roles `my_shop_migrator` / `my_shop_app` exist  | pass - the database suite can run on this host (contrast §1.2) |

### 1.2 Predecessor findings (carried, not re-opened)

- **No business module exists yet** (`app.module.ts` says so by design, §12): M2-S1 creates the first domain tables and must not register a controller, guard, or route.
- **Four sync tables carry bare `organization_id uuid NOT NULL` with no parent table.** M2-S1 adds the `organizations` parent those columns point at in spirit; it does **not** add foreign keys to the sync tables (that would rewrite merged migrations and is not required by §40.6).
- **`postgres.db-spec.ts` hard-asserts the migration list (`0001`, `0002`), the exact four-table list, and a deploy count of 2.** These assertions are the slice's to update — deliberately and visibly, not weakened.
- **The M1b-S10 record states this host had no PostgreSQL.** That condition has since changed: PostgreSQL 18 is installed and running locally, so the database acceptance suite runs on this host for M2-S1 (documented in §3.1/§3.2 rather than carried forward).
- **The T-O6 pull/resume deferral (`DEFERRED_BY_PLAN`)** stays annotated and untouched (§36.1 T-2).
- **The M1b-S5 record gap** is carried forward unchanged and is not re-opened.

### 1.3 Authoritative scope text (read before implementation)

§40.6 row: `M2-S1 | Organizations, memberships, operator bootstrap command | Any UI | Bootstrap creates an org and owner idempotently`. §10.4: "The first organization and its owner are created by an **operator-run bootstrap command** using server-side credentials, not by a public 'create first owner' endpoint." §8.4 assigns `organizations`/`organization_memberships` to the **tenancy** context and `users`/credentials to **identity**; §39.3 D-1 makes identity depend on tenancy, never the reverse; D-7 forbids a context writing another context's tables except through the owning context's service inside the same transaction.

---

## 2. Declaration

### 2.1 `scope`

Per Master Plan §40.6 row **M2-S1 — Organizations, memberships, operator bootstrap command**. The principal acceptance is §40.6's "**Bootstrap creates an org and owner idempotently**", executed under §10.4's operator-only boundary. This slice is server-side only (Prisma schema, migration, tenancy/identity services, operator CLI, tests); it adds no HTTP surface of any kind.

| #    | Outcome                                                                                                                                                                                                                                                  |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-1  | Migration `0003_organizations` (forward-only, additive): type `organization_status` (`ACTIVE`, `DEACTIVATED`), tables `organizations` (tenant boundary; `id` uuid PK `gen_random_uuid()`, `name`, `status`, `bootstrap_key`, `created_at`), `users` (identity foundation, **credential-free**: `id`, `email`, `created_at`), `organization_memberships` (`id`, `organization_id`, `user_id`, `is_owner`, `created_at`); CHECK constraints for blank/length/canonical-form rules; FKs `ON DELETE RESTRICT ON UPDATE CASCADE`; unique `organizations.bootstrap_key`, unique `users.email`, unique `(organization_id, user_id)`, and a **partial unique index** `… (organization_id) WHERE is_owner` enforcing at most one owner per organization |
| S-2  | `schema.prisma` gains `OrganizationStatus`, `Organization`, `User`, `OrganizationMembership` models whose desired state matches the migration byte-for-byte (verified by `prisma migrate diff --from-url --to-schema-datamodel --exit-code` in the database suite)                       |
| S-3  | `src/common/identity/user-provisioning.ts`: `canonicalizeEmail` (trim + lowercase + shape, the seam M2-S2 reuses for login) and `findOrCreateUserByEmail(tx, email)` — the identity-context writer for `users`, executed inside the caller's transaction under a per-email advisory lock (multi-org per §9.2 T-4) |
| S-4  | `src/common/tenancy/organization-bootstrap.service.ts` (+ `organization-bootstrap.errors.ts`): `OrganizationBootstrapService.bootstrap(request)` on the existing `PrismaHost` seam — one interactive transaction that takes a per-`bootstrap_key` advisory xact lock, classifies an existing committed result (`ALREADY_BOOTSTRAPPED` vs `BOOTSTRAP_CONFLICT`), and otherwise creates organization, owner user, and owner membership atomically (`BOOTSTRAPPED`); outcomes and conflicts are typed; a documented test-only failure probe exists to prove rollback against real PostgreSQL |
| S-5  | `src/common/tenancy/bootstrap-cli.ts`: strict operator CLI — exact-flag parsing (unknown/duplicate/missing-value refused), input validation (key `^[a-z0-9]+(-[a-z0-9]+)*$` 3–64, name trimmed ≤200 non-blank, email canonicalized ≤254), `loadConfig` reuse so the §13.4 role-separation refusal applies, **required `MIGRATION_DATABASE_URL`** (fail-closed), one structured JSON line to stdout on success / one JSON error object to stderr on failure, exit codes `0` success (including idempotent), `1` runtime, `2` usage/input/configuration, `3` conflict — and it never prints a connection string, credential, or raw driver error |
| S-6  | `services/api/scripts/org-bootstrap.mjs` thin process entry (builds `dist`, invokes the CLI runner) plus npm scripts `bootstrap:org` at the workspace and root, documented in `README.md`                                                                                          |
| S-7  | `postgres.db-spec.ts` extended: the three legacy hard assertions updated to include `0003_organizations` and the three new tables (and only those), plus a new **operator bootstrap (M2-S1)** acceptance block covering AC-01…AC-17 incl. concurrency, rollback, upgrade-from-0002 on a scratch database, redeploy, in-suite drift diff, constraint-level duplicate/owner/FK rejections, privilege separation, and a secret canary |
| S-8  | Unit suites (`src/common/**`): CLI parsing/validation/exit-code/redaction matrix; service outcome, conflict-classification, lock-ordering, and error-translation tests against the structural fake-Prisma pattern already used by `mutation-ledger.spec.ts`; email canonicalization and identity-writer behaviour |
| S-9  | Governance: this record (declared before implementation, completed after CI), README operator-command documentation                                                                                                                                          |
| S-10 | No server contract change: no controller, route, DTO, or `extraModels` is added, so `packages/contracts/openapi.json` and `src/generated/schemas.ts` stay byte-identical — `contracts:check` staying green **is** the machine-checkable proof of S-09/S-23 (no unauthorized public endpoint) |

### 2.2 `non_scope`

| Not touched                                                                 | Reason                                                                                                                                                                     |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M2-S2: login, Argon2id, password/credential columns on `users`, JWT, refresh rotation, reuse detection, revocation, sessions | §40.6 assigns identity to M2-S2; M2-S1 creates `users` **without any credential material** and never authenticates anybody                                                  |
| M2-S3: permission catalog, roles tables, role presets, overrides, effective-permission resolution                            | §40.6; M2-S1 records ownership as the membership `is_owner` invariant only and defines no permission                                                                                            |
| M2-S4: request-scoped tenant context, `SET LOCAL`, RLS on tenant tables, offline ingress re-validation                    | §40.6; M2-S1 makes the schema RLS-ready (`organization_id NOT NULL`, org-leading indexes) but enables no policy and adds no session variable                                                |
| M2-S5 devices, M2-S6 audit streams (`audit_events`, `security_events`), M2-S7 Flutter auth UI, **any UI**                 | §40.6 non-scope column; structured security-event persistence remains the documented M2-S6 deferral (precedent: M1b-S4 D-7)                                              |
| Public organization registration, any HTTP endpoint claiming ownership, any authenticated-user organization-creation route   | §10.4 forbids it; the bootstrap command is the only creation path                                                                                                        |
| Chart of Accounts / financial-account seeding at org creation (§35)                                                     | §39.5: no table or seed for an unauthorized module; when the accounting slice arrives it extends org creation with its idempotent application-code seed (documented seam, §7) |
| Organization deactivation workflow, member invitation/management flows, `roles`/`role_permissions`/`permission_overrides` | Not in §40.6's M2-S1 column; only the lifecycle **state** and the membership shape exist after this slice                                                                 |
| Foreign keys from the four existing sync tables to `organizations`                                                      | Would require rewriting merged migrations or an unrelated migration; §40.6 does not ask it; documented as a deferred design note (§16)                                   |
| Master plan, M0–M1b records, CI workflow, branch protection, root toolchain, `package-lock.json`                         | No plan, CI, or toolchain decision changes; no dependency added                                                                                                           |
| `main`, earlier stacked branches/PRs (#1–#16), merges, auto-merge, deployment                                           | Owner-merge boundary (§40.1 G-12/G-4); none performed                                                                                                                     |

### 2.3 `allowed_paths`

```
package.json
README.md
services/api/package.json
services/api/prisma/schema.prisma
services/api/prisma/migrations/0003_organizations/migration.sql
services/api/scripts/org-bootstrap.mjs
services/api/src/common/identity/user-provisioning.spec.ts
services/api/src/common/identity/user-provisioning.ts
services/api/src/common/tenancy/bootstrap-cli.spec.ts
services/api/src/common/tenancy/bootstrap-cli.ts
services/api/src/common/tenancy/organization-bootstrap.errors.ts
services/api/src/common/tenancy/organization-bootstrap.service.spec.ts
services/api/src/common/tenancy/organization-bootstrap.service.ts
services/api/test/database/postgres.db-spec.ts
docs/governance/MY_SHOP_M2_S1_SLICE_RECORD.md
```

Every modified or created path in this slice must appear above; §4.3 G-5 checks the diff against this list.

### 2.4 `tests`

| Level                         | Requirement                                                                                                                                                                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gate positives                | `toolchain:verify`, all nine `gates` (secret-scan, markdown, import-boundary, vocabulary, localization, design-system, immutability, offline 23–24, migration-immutability), `format:check`, `lint`, `typecheck`, `contracts:check`, `npm audit --audit-level=high` — all green on this host |
| Unit (backend)                | Service: fresh-boot path, idempotent-retry classification, name/email conflict classification, incomplete-state anomaly, advisory-lock ordering (key before email), unique-violation translation, failure-probe propagation, canonical email handling; CLI: full flag matrix (help, unknown, duplicate, missing value, bad shapes), exit codes 0/1/2/3, §13.4 refusal, missing-`MIGRATION_DATABASE_URL` refusal, output redaction canary; `test:unit` green |
| Integration (backend)         | Existing suites unchanged and green (`test:integration`), proving no HTTP surface changed                                                                                                                                                       |
| Database (real PostgreSQL 18) | `test:database` green, containing: migration list/table list/deploy-idempotence updates; AC-01 first bootstrap; AC-02 identical retry; AC-03 concurrent identical bootstrap (one durable result); AC-04 conflicting retry; AC-05 injected transaction failure -> zero rows; AC-06 CLI re-run returns same durable ids; AC-07 invalid input; AC-08 unauthorized invocation (no credential) refused fail-closed; AC-09 duplicate membership rejected by the database; AC-10 one user owning two organizations; AC-11 one-owner invariant (partial unique); AC-12 FK violation rejected; AC-13 operator/application role separation + unchanged role attributes; AC-14 secret canary absent from every CLI output; AC-15 empty-database migration; AC-16 upgrade from `0002` with pre-existing M1b rows intact (scratch database); AC-17 redeploy safe; AC-18 `prisma migrate diff` exit 0 in-suite; AC-23 no public endpoint |
| Contracts                     | `contracts:check` green with byte-identical artifacts (AC-19)                                                                                                                                                                                    |
| Offline + Flutter regression  | `gate:offline` green, `flutter analyze --fatal-infos` clean, `flutter test` green, T-O6 skip still `DEFERRED_BY_PLAN` (AC-20, AC-21)                                                                                                             |
| CI builds                     | `flutter-build-windows` and `flutter-build-android` green on the exact final SHA (AC-22)                                                                                                                                                        |
| Remote CI                     | All seven required checks green on the exact final HEAD on both `push` and `pull_request` events (AC-24)                                                                                                                                        |

### 2.5 `acceptance_criteria`

| #      | Criterion                                                                                                                              | Evidence    |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| AC-01  | First operator bootstrap creates organization + owner user + owner membership durably (rows asserted in the database, not by message)  | §3.4        |
| AC-02  | An identical authorized retry creates no duplicate organization, user, or membership and reports `ALREADY_BOOTSTRAPPED`                | §3.4        |
| AC-03  | Concurrent identical bootstrap invocations converge on one durable consistent result                                                   | §3.4        |
| AC-04  | A retry with the same `bootstrap_key` but different parameters fails with an explicit conflict; no adoption or overwrite happens       | §3.4        |
| AC-05  | A failure after organization insert but before commit leaves **zero** committed rows (real rollback, durable assertion)                 | §3.4        |
| AC-06  | Re-running the CLI after a committed success returns the same durable identity ids                                                     | §3.4        |
| AC-07  | Invalid input (bad key/name/email shapes, unknown/duplicate flags, missing values) is rejected with exit 2 before any connection        | §3.4, §3.9  |
| AC-08  | Invocation without `MIGRATION_DATABASE_URL`, or with application-role-identical credentials, is refused fail-closed (§10.4, §13.4)      | §3.4, §3.8  |
| AC-09  | A second membership for the same `(organization_id, user_id)` is rejected by the database                                               | §3.4        |
| AC-10  | One user can be owner of two organizations through two membership rows (multi-org, §9.2 T-4)                                          | §3.4        |
| AC-11  | At most one `is_owner = true` membership per organization, enforced by a partial unique index                                          | §3.4        |
| AC-12  | Membership rows referencing a nonexistent organization or user are rejected by foreign keys                                            | §3.4        |
| AC-13  | Role attributes unchanged (no superuser/BYPASSRLS anywhere); the bootstrap path runs on the operator (migrator) credential; the application role gains no new privilege — `roles.sql` untouched | §3.4, §3.8  |
| AC-14  | No credential, connection string, or raw driver error appears in any CLI output, test output, log, or the PR (secret canary asserted)  | §3.4, §3.8  |
| AC-15  | `prisma migrate deploy` from an empty supported database creates the full schema (`test-setup` path)                                   | §3.4        |
| AC-16  | Upgrade from the preceding schema (`0001`+`0002` applied, M1b fixture rows written, then `0003`) preserves every existing row          | §3.4        |
| AC-17  | Re-running `prisma migrate deploy` after success applies nothing and succeeds                                                          | §3.4        |
| AC-18  | Prisma schema and migration history agree: `prisma migrate diff --from-url … --to-schema-datamodel … --exit-code` exits 0 in-suite      | §3.4        |
| AC-19  | Shared contracts clean: `contracts:check` prints "contracts are in sync" (byte-identical artifacts)                                    | §3.1, §3.5  |
| AC-20  | Existing M1b offline regression passes: `gate:offline` green, sync suites unchanged and green, T-O6 skip still `DEFERRED_BY_PLAN`       | §3.1, §3.4  |
| AC-21  | Existing Flutter regression passes: `flutter analyze --fatal-infos` clean, `flutter test` green                                        | §3.1        |
| AC-22  | Windows and Android CI builds pass on the exact final SHA                                                                              | §3.6        |
| AC-23  | No unauthorized public endpoint: no controller/route/DTO added; OpenAPI byte-identical                                                  | §3.5, §3.8  |
| AC-24  | Exact-SHA remote CI: all seven required checks green on the final HEAD for both `push` and `pull_request`                              | §3.6        |

### 2.6 `migration_impact`

**Yes, as declared.** Exactly one new forward-only migration, `0003_organizations` (§35.1): three additive tables, one enum, CHECK constraints, indexes, and foreign keys. Nothing in `0001`/`0002` is edited (gate G-6/migration-immutability enforces it). Acceptance covers deploy-from-empty (the suite's `test-setup`), upgrade-from-`0002` on a scratch database with M1b rows intact, redeploy idempotence, and `prisma migrate diff` drift. `prisma/roles.sql` is unchanged: default privileges already grant the application role DML on migrator-created tables, so no hand-written `GRANT` appears in the migration (G-9: no `GRANT ALL`, no `SECURITY DEFINER`, no `BYPASSRLS`, no `search_path` change, no string interpolation). No RLS policy and no `SET LOCAL` are introduced — those are M2-S4's by §40.6, and the design keeps `organization_id NOT NULL` with organization-leading indexes so RLS lands without obstruction. Rollback is forward-only: revert by a new forward migration dropping the three objects, or simply drop the branch — no production database is touched by this slice.

### 2.7 `security_impact`

- **No new endpoint, permission, or session surface** (S-09, AC-23): the OpenAPI document stays byte-identical; the only entry point is a server-side command requiring the operator database credential (§10.4).
- **Authorization model:** possession of `MIGRATION_DATABASE_URL` (operator/migrator role) *is* the credential; the command fails closed when it is absent and reuses `loadConfig` so a deployment where migrator and application identities collapse (§13.4) is refused before connecting.
- **Data classes touched:** global identity (`users.email`), tenant boundary (`organizations`), tenant-scoped relationships (`organization_memberships`). No credential material, token, or secret column exists after this slice; `users` deliberately has no password field for M2-S2 to fill later.
- **Uniqueness without cross-tenant leakage:** `users.email` and `organizations.bootstrap_key` are global uniques but are exposed through no endpoint (no endpoint exists); organization **names** are deliberately not unique, so no future API can leak another tenant's name through a uniqueness violation (§9.2 T-7's rationale applied to the boundary table).
- **Threat model S-01…S-12** walked explicitly in §3.8 with per-finding PASS/FIXED/BLOCKED/DEFERRED_BY_PLAN classification.

### 2.8 `rollback`

Delete the branch (and, if opened, the PR). The slice is additive: no existing file is rewritten beyond the three deliberately updated db-spec assertions, `schema.prisma` appends, and npm script additions. Database artifacts exist only in local/CI test databases the harness drops after itself; nothing deploys anywhere. Should `0003` ever need reversal in a shared environment, §35.1's forward-only rule applies: a new migration `0004_…` dropping the three objects (data loss acknowledged as the deliberate cost of a wrong slice). `main` stays untouched.

### 2.9 `publication_gate`

| Field           | Value                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| PR target       | `codex/my-shop-m1b-s10-offline-observability` (the verified predecessor branch, stacked-PR model)                  |
| PR number       | next available number (expected `#17`, confirmed at creation)                                                      |
| Required checks | `fast-checks`, `backend-unit`, `backend-integration-database`, `contract-drift`, `dependency-audit`, `flutter-build-windows`, `flutter-build-android` — on both events, exact final SHA |
| Merge           | **Owner only.** G-12 and G-4 apply. No auto-merge is enabled or requested                                           |
