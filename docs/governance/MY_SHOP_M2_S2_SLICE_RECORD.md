# MY SHOP - M2-S2 SLICE RECORD: IDENTITY, LOGIN, REFRESH ROTATION, REUSE DETECTION

**Slice:** M2-S2 (Master Plan §40.6, row "M2-S2").
**Branch:** `codex/my-shop-m2-s2-identity-auth`.
**Base:** `4cd1933` - the locked M2-S1 head (record commit) on
`codex/my-shop-m2-s1-organizations-bootstrap`; PR #17, open and unmerged.
**Status:** DECLARED before implementation; evidence sections are completed in the
implementation and record commits that follow (see §19).

This record follows the same governance shape as
`MY_SHOP_M2_S1_SLICE_RECORD.md`. It is written before the code so the scope,
non-scope, allowed paths, acceptance criteria, migration impact, security impact,
and rollback are fixed and reviewable before anything is built (§2.4, §39.5).

---

## 1. Predecessor state

### 1.1 Entry state, verified not assumed

- The base commit is the **locked** M2-S1 head. Both CI events (`push`,
  `pull_request`) are green with all seven required jobs on `4cd1933` (the record
  head) and on `a5b070e` (the implementation head). M2-S1 is
  `PASS_MY_SHOP_M2_S1_HARDENED_REMOTE_LOCKED`.
- M2-S1 delivered the tables this slice builds on: `organizations` (tenant root),
  `users` (**credential-free** identity, unique canonical `email`), and
  `organization_memberships`. It deliberately left authentication to M2-S2 (§8.4,
  §40.6; M2-S1 D-4).
- The identity context already exposes the narrow seam M2-S2 reuses:
  `common/identity/user-provisioning.ts` (`canonicalizeEmail`,
  `findOrCreateUserByEmail`, `findUserById`). `users.email` is canonical in the
  column, so login has exactly one spelling per address.
- The migration history is at `0004_bootstrap_key_shape`. M2-S2's migration is
  therefore **`0005_identity_auth`**, generated from the actual latest migration,
  never a hardcoded number.
- The push/pull sync boundary authenticates through a fail-closed port
  (`SYNC_AUTHENTICATOR`) that refuses every request until M2 supplies real token
  verification and **device** binding (§38.16). Device registration is M2-S5, so
  this slice does not unblock the sync boundary (see N-4).

### 1.2 Predecessor findings (carried, not re-opened)

M2-S1's hardening findings F-1..F-4 are resolved and recorded; they are not
re-opened. M2-S2 inherits their consequences:

- Bounded-context ownership is enforced by
  `common/architecture/import-boundary.spec.ts` (§39.3 D-1). M2-S2 must not
  introduce a `tenancy` -> `identity` edge or an `identity` -> `bootstrap` edge.
- The database is the last line of defence: a shape the service enforces is also a
  CHECK constraint wherever the database can express it (F-3 discipline).

### 1.3 Authoritative scope text (read before implementation)

- §40.6, row **M2-S2** - outcome: "Identity: users, Argon2id, login, refresh
  rotation, reuse detection, revocation"; next-slice column: "App lock"; key
  acceptance: "Reuse detection revokes the family".
- §10.1 - email + password, **server-side sessions**, no social login, no
  self-service signup, no public registration endpoint in V1.
- §10.2 - Argon2id via a maintained library; explicit parameters; per-user random
  salt; constant-time verification at the library boundary; **no permanent
  lockout** (failed-attempt counting with exponential backoff plus a security audit
  event; administrative unlock; never silent self-unlock); complexity = minimum
  length plus a breached-password deny-list, **no composition rules**.
- §10.3 - session properties and the access-token claim set (`sub`, `orgs`, `sid`,
  `perms_version`); refresh rotation; reuse detection revokes the entire session
  family.
- §10.4 - the operator-only bootstrap command (M2-S1) creates the owner; M2-S2 adds
  the credential that owner logs in with.
- §13.1/§13.5 - production errors carry no stack, SQL, or internal identifier;
  rate limits are bound per caller; §13.4 - role separation is unchanged.
- §34.1/§34.2/§34.3 - `/api/v1` namespace; one global validation pipe
  (whitelist, forbidNonWhitelisted, transform); RFC 7807 problem documents with a
  stable `code`.
- §39.2/§39.3 - the identity context owns `users`, `credentials`, and `sessions`;
  tenancy depends on identity, never the reverse (D-1).
- §32 - durable `security_events`/`audit_events` tables arrive with M2-S6; this
  slice records security events through a port and documents that dependency.
- §35.1 - migrations are forward-only and additive; merged migrations are never
  rewritten (the immutable `0003`, and now `0004`, are untouched).

---

## 2. Declaration

### 2.1 `scope`

| ID   | Scope item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-1  | Migration `0005_identity_auth` (forward-only, additive): table `user_credentials` (1:1 with `users`; Argon2id PHC `password_hash`, `password_updated_at`); table `sessions` (the server-side session = the refresh-token **family**; `user_id`, `created_at`, `last_used_at`, `absolute_expires_at`, `revoked_at`, `revoked_reason`); table `refresh_tokens` (opaque-token digest `token_hash char(64)` UNIQUE, `session_id`, `issued_at`, `idle_expires_at`, `consumed_at`, `successor_id`); table `auth_throttles` (`key` PK, `failure_count`, `first_failure_at`, `last_failure_at`, `blocked_until`). CHECK constraints (Argon2id prefix; consumed-token-has-successor; positive counters; time-window sanity), FKs, and indexes. A **second** additive migration, `0006_users_permissions_version`, adds the `users.permissions_version` column and its CHECK (§2.6). |
| S-2  | `schema.prisma` gains `UserCredential`, `Session`, `RefreshToken`, and `AuthThrottle` whose desired state matches the migration (verified by `prisma migrate diff --from-url --to-schema-datamodel --exit-code` in the database suite).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| S-3  | `src/common/identity/password.ts` - Argon2id hashing and verification over `@node-rs/argon2` (PHC strings, per-user random salt, memory/time/parallelism read from config, `needsRehash`). Verification is constant-time at the library boundary; no hand-rolled byte comparison exists anywhere in the slice.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| S-4  | `src/common/identity/password-policy.ts` - §10.2 policy: minimum length 12, maximum 128, **no** composition rules, and a breached-password deny-list seam (the deny-list source is injectable; the default is empty and documented).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| S-5  | `src/common/identity/access-token.ts` - RS256 JWT over `node:crypto` (header/payload base64url plus OpenSSL `sign`/`verify`) with the §10.3 claim set (`sub`, `orgs`, `sid`, `perms_version`, plus `iss`, `aud`, `iat`, `exp`); a `sign` and a strict `verify` (fixed algorithm; issuer/audience/expiry/nbf checks).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| S-6  | `src/common/identity/refresh-token.ts` - a 256-bit opaque token whose SHA-256 hex digest is the only stored form; idle and absolute expiry; rotation marks the presented token consumed and links `successor_id` to its replacement.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| S-7  | `src/common/identity/auth.service.ts` - `login`, `refresh`, `logout`, and `me`. Refresh rotates; presenting an already-consumed token is **reuse** and revokes the whole session family; logout revokes the family; login composes the throttle, the credential check, session creation, and the security-event sink in one transaction.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| S-8  | `src/common/identity/auth-throttle.ts` - database-backed failed-attempt counting with **bounded** exponential backoff, reset on success, never permanent (§10.2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| S-9  | `src/common/identity/security-event.sink.ts` - the `SecurityEventSink` port plus a structured-logging implementation; the durable `security_events` table is M2-S6 and that dependency is documented, not silently assumed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| S-10 | `src/common/identity/auth.controller.ts` and `auth.contract.ts` - `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`, and `GET /api/v1/auth/me`, each with a DTO-derived contract class and `@ApiResponse`/`@ApiOperation` decorators.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| S-11 | `src/common/identity/jwt-auth.guard.ts` - a Bearer access-token guard plus a `@VerifiedClaims()` parameter decorator; tenant/organization claims are read from the **verified token**, never from the request body (§9.3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| S-12 | `src/common/identity/identity.module.ts` - the identity module wired into `AppModule.forRoot`, dynamic and fail-closed when identity configuration is absent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| S-13 | `src/common/identity/credential-cli.ts` plus `services/api/scripts/provision-credential.mjs` and an npm script - the operator-only credential-provisioning command that sets or rotates a user's Argon2id credential. The password is read from the **environment only**, never from `argv`, and never printed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| S-14 | `src/common/config/app.config.ts` gains an `identity` configuration group (JWT private/public key, issuer, audience, access-token TTL, refresh idle/absolute TTL, Argon2 parameters, throttle parameters). It is validated for shape when present and is **required in `production`**; outside production it may be absent, in which case the identity module is fail-closed.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| S-15 | `.env.example` and `README.md` document the identity configuration and the provisioning command (placeholders only, §13.6).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| S-16 | Contract regeneration: `packages/contracts/openapi.json` and `packages/contracts/src/generated/schemas.ts` gain the four auth endpoints and their schemas via `contracts:generate`; `contracts:check` stays green (byte-identical on regeneration).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| S-17 | Tests: unit (`src/common/identity/*.spec.ts`), integration end-to-end request (`test/identity/*.e2e-spec.ts`), and the database acceptance block appended to `postgres.db-spec.ts` (including the reuse-detection acceptance against **real PostgreSQL**).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| S-18 | Governance: this record.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

### 2.2 `non_scope`

| ID  | Not in this slice                                                              | Owning slice / authority |
| --- | ------------------------------------------------------------------------------ | ------------------------ |
| N-1 | App Lock                                                                       | §40.6 M2-S2 "next slice" |
| N-2 | Roles, permission catalog, presets, overrides; the writer of `perms_version`    | §11, §40.6 M2-S3         |
| N-3 | Row-level security policies and `SET LOCAL`                                    | §9.3, §40.6 M2-S4        |
| N-4 | Device registration/enrolment; real device binding on the sync boundary        | §38.8.1, §40.6 M2-S5     |
| N-5 | Durable `security_events`/`audit_events` tables                                | §32, §40.6 M2-S6         |
| N-6 | Flutter authentication UI                                                      | §40.6 M2-S7              |
| N-7 | Public registration / self-service signup                                      | §10.1 (forbidden in V1)  |
| N-8 | Password reset by email, MFA, social login                                     | not scheduled            |
| N-9 | Owner-visible session-management UI and administrative unlock UI               | later slices             |
| N-10 | Permission enforcement on business endpoints (none exists yet)                | §40.6 M2-S3+             |

### 2.3 `allowed_paths`

Only these paths may change in the slice. Anything else is a scope violation
(G-05), verified by the branch diff:

- `docs/governance/MY_SHOP_M2_S2_SLICE_RECORD.md`
- `services/api/prisma/schema.prisma`
- `services/api/prisma/migrations/0005_identity_auth/migration.sql`
- `services/api/prisma/migrations/0006_users_permissions_version/migration.sql`
- `services/api/src/common/config/app.config.ts` and
  `services/api/src/common/config/app.config.spec.ts` (the spec necessarily changes
  when the configuration contract changes)
- `services/api/src/common/identity/**` (new: `password.ts`,
  `password-policy.ts`, `access-token.ts`, `refresh-token.ts`,
  `auth-throttle.ts`, `security-event.sink.ts`, `auth.service.ts`,
  `auth.contract.ts`, `auth.controller.ts`, `jwt-auth.guard.ts`,
  `identity.module.ts`, `credential-cli.ts`, and their `*.spec.ts` units)
- `services/api/src/app.module.ts`
- `services/api/scripts/provision-credential.mjs`
- `services/api/package.json`, `package-lock.json` (the Argon2id dependency and the
  provisioning script)
- `services/api/test/identity/**` (integration end-to-end and support)
- `services/api/test/database/postgres.db-spec.ts` (the acceptance block and the
  migration/table list assertions)
- `packages/contracts/openapi.json`, `packages/contracts/src/generated/schemas.ts`
- `.env.example`, `README.md`

Explicitly **not** touched: `prisma/roles.sql`, `.github/workflows/**`,
`tool/ci/**`, `services/api/jest.config.mjs`, `0001`-`0004` migration files, any
Master Plan or ADR text.

### 2.4 `tests`

| Suite       | Location                                    | What it proves                                                                                                    |
| ----------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Unit        | `src/common/identity/*.spec.ts`             | Password policy/hashing contract, access-token sign/verify and rejection matrix, refresh-token digest/rotation, throttle backoff math, auth-service branching, CLI parsing/redaction |
| Integration | `test/identity/*.e2e-spec.ts` (Supertest)   | Full request through routing, the global pipe/filter, the identity service, Prisma, and PostgreSQL: login, refresh, reuse, logout, `me`, refusals |
| Database    | `test/database/postgres.db-spec.ts` (M2-S2) | Migrations `0005`+`0006` from empty, drift `--exit-code`, table/constraint-level rejections, role separation, the **reuse-detection-revokes-family** acceptance against real PostgreSQL |

§36.1 T-2 forbids an in-memory substitute for the database assertions; the
database suite fails fast when its environment is absent (no silent skip, T-5).

### 2.5 `acceptance_criteria`

| ID    | Criterion                                                                                                                                        | Source      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| AC-01 | `prisma migrate deploy` from empty applies `0001`-`0006`, each exactly once, none rolled back                                                     | §3.4        |
| AC-02 | Exactly the authorized tables exist: the seven M1b/M2-S1 tables plus `user_credentials`, `sessions`, `refresh_tokens`, `auth_throttles`            | §39.5       |
| AC-03 | Re-running `prisma migrate deploy` applies nothing and succeeds                                                                                   | §3.4        |
| AC-04 | `schema.prisma` and the migration history agree (`migrate diff --exit-code` exits 0 in-suite)                                                     | §3.4        |
| AC-05 | Login with correct credentials returns an access and a refresh token and creates exactly one session and one refresh-token row                    | §10.3       |
| AC-06 | Login with a wrong password is refused `UNAUTHENTICATED` and creates no session or refresh-token row                                              | §10.2       |
| AC-07 | Login with an unknown email is refused with the same shape as a wrong password (no account enumeration)                                           | §13.1       |
| AC-08 | A stored credential is an Argon2id PHC string (`$argon2id$...`), never plaintext; the database CHECK enforces the prefix                          | §10.2, F-3  |
| AC-09 | Password verification uses the maintained library's constant-time comparison; no hand-rolled byte compare exists                                  | §10.2       |
| AC-10 | The access token is an RS256 JWT carrying `sub`, `orgs`, `sid`, `perms_version`, `iss`, `aud`, `iat`, `exp`, and verifies against the public key   | §10.3       |
| AC-11 | Access-token verification rejects a foreign-key signature, a tampered payload, `alg: none`, and `alg: HS256`                                      | §10.3       |
| AC-12 | Access-token verification rejects expired (`TOKEN_EXPIRED`), wrong-issuer, and wrong-audience tokens                                              | §34.3       |
| AC-13 | Refresh returns a new access token and a new refresh token; the presented token becomes consumed with `successor_id` set to the new token          | §10.3       |
| AC-14 | **Re-presenting a consumed refresh token is refused and revokes the entire session family** (session and all its tokens)                          | §40.6       |
| AC-15 | After family revocation, the newest token in that family is also refused                                                                          | §10.3       |
| AC-16 | An unknown or malformed refresh token is refused `UNAUTHENTICATED`                                                                                | §10.3       |
| AC-17 | A refresh token whose session is revoked is refused                                                                                               | §10.3       |
| AC-18 | An expired refresh token (idle or absolute) is refused                                                                                            | §10.3       |
| AC-19 | Logout revokes the session family; a subsequent refresh is refused                                                                                | §10.3       |
| AC-20 | Failed logins are counted per account and back off exponentially; the backoff is bounded (never permanent) and resets on success                   | §10.2       |
| AC-21 | `GET /api/v1/auth/me` requires a valid Bearer token and returns the verified claims; a missing/invalid token is refused `UNAUTHENTICATED`          | §34.3       |
| AC-22 | Refresh-token material is never stored or logged in clear; only the SHA-256 digest is persisted                                                   | §13.6       |
| AC-23 | No endpoint or log echoes a stored password hash, a refresh token, or a raw driver error                                                          | §13.1       |
| AC-24 | The provisioning CLI reads the password from the environment only, never `argv`; it refuses without it and writes an Argon2id credential            | §10.2, §13.6 |
| AC-25 | No credential or connection string appears in CLI output, test output, logs, or the PR (secret canary)                                            | §13.6       |
| AC-26 | A client can assert no tenant identity: organization claims are read only from the verified token, never from a request body                       | §9.3        |
| AC-27 | Role separation is unchanged; the new tables are migrator-owned; the application role gains no DDL; `roles.sql` is untouched                       | §13.4       |
| AC-28 | `contracts:check` prints "contracts are in sync" after regeneration                                                                               | §7.1 G-7    |
| AC-29 | M1b and M2-S1 regressions pass; the T-O6 offline skip is still `DEFERRED_BY_PLAN`                                                                  | §3.1, §3.4  |
| AC-30 | Flutter regression passes (`flutter analyze --fatal-infos` clean, `flutter test` green)                                                           | §3.1        |
| AC-31 | An invalid identity configuration (bad key encoding, out-of-range TTL) refuses startup; missing keys are permitted only outside `production`      | §7.1, §13.6 |
| AC-32 | With identity configuration absent, the identity surface is fail-closed: no token can be minted or approved                                       | §38.16      |
| AC-33 | Exact-SHA remote CI: all seven required checks green on the final HEAD for both `push` and `pull_request`                                          | §3.6        |

**AC-34 (permission generation).** `users.permissions_version` exists as
`INTEGER NOT NULL DEFAULT 0` with CHECK `chk_users_permissions_version_non_negative`;
a token minted at generation *n* is refused `TOKEN_STALE` once the stored value
differs (proved against real PostgreSQL); M2-S2 never writes the column - the writer
that increments it is M2-S3 (N-2).

### 2.6 `migration_impact`

- **Two** new forward-only, additive migrations:
  - `0005_identity_auth` creates four tables (`user_credentials`, `sessions`,
    `refresh_tokens`, `auth_throttles`) with their constraints and indexes. It
    alters **no** existing table.
  - `0006_users_permissions_version` adds one column to `users`
    (`permissions_version INTEGER NOT NULL DEFAULT 0`) plus its CHECK
    `chk_users_permissions_version_non_negative` (`>= 0`). It creates no table.
    It is a separate migration because `0005` was committed before the column was
    specified and a committed migration is never rewritten (§37.3 G-6); the
    additive step is a new migration, which is what forward-only means. An earlier
    draft folded the column into `0005`; the 0005 bytes were restored to the
    introducing commit `cc154c7` and the column moved to `0006` (§15 D-2).
- `0001`-`0004` are byte-identical to the base commit; `0005` is byte-identical to
  its introducing commit. The immutability gate reports seven migration paths (six
  `migration.sql` files plus `migration_lock.toml`), none rewritten.
- No `GRANT`, no `SECURITY DEFINER`, no `BYPASSRLS`, no `search_path` change, no
  string interpolation (§8.3, G-09). The migrator's `ALTER DEFAULT PRIVILEGES`
  in `prisma/roles.sql` already births every new table with the application
  role's DML, so `roles.sql` is untouched.
- CHECK constraints are not modelled by Prisma, so they do not create drift - the
  same situation as `0003`'s three CHECKs, `0004`'s kebab CHECK, and now `0006`'s
  non-negative CHECK.

### 2.7 `security_impact`

- Adds the first **authentication** surface. New threat surface and therefore a
  full threat-model walk in §3.8 after implementation.
- New secret material: the JWT signing key pair (private key never leaves the
  environment; the public key may be exposed). No key is committed; `.env.example`
  carries placeholders only.
- New dependency: `@node-rs/argon2` (Argon2id, mandated by §10.2; no in-tree or
  `node:crypto` Argon2id exists). JWT signing uses `node:crypto` RS256 rather than
  an ESM-only JWT package, because ADR-005 settles the backend on CommonJS.
- The access token is a bearer credential: it is validated for signature, issuer,
  audience, and expiry, and no business endpoint yet consumes it, so the only
  consumer in this slice is the guard on `GET /api/v1/auth/me`.
- The sync boundary (push/pull) remains fail-closed: it requires a **device**
  binding that is M2-S5's (N-4). This slice does not weaken it.

### 2.8 `rollback`

- The slice is additive and revertible by a later forward migration that drops the
  four tables, or by not merging the branch. No existing migration is rewritten.
- The identity module can be unbound from `AppModule` by reverting one line; the
  process then runs exactly as before M2-S2 (no auth surface).
- No data migration of existing rows occurs, so rollback loses only session and
  credential rows, which would be re-provisioned by the operator command.

### 2.9 `publication_gate`

- The slice is published as a **new** PR whose base is the M2-S1 branch
  (`codex/my-shop-m2-s1-organizations-bootstrap`), never `main`. It is left open
  and unmerged.
- No merge, no auto-merge, no force-push, no history rewrite, no production
  deploy, no destructive database operation is performed.
- The exact-SHA remote CI evidence is recorded for both events on the final HEAD
  before the verdict is written. Until then the verdict is `BLOCKED_...`, never
  `PASS_...`.

---

## 3. Execution and evidence

_Completed in the record commit. The implementation head is
`9f2ca66548f3cf01d6541c2f54e2e877fdd35801`; §19 carries the commit ledger._

### 3.1 Local chain

`npm run verify:node` and `npm run verify:flutter` are the local acceptance chain.
`verify:node` was run to completion **PASS (exit 0)** after the CI-driven fix in
§15 D-3; an earlier attempt (exit 1) surfaced that same flake and is recorded there
rather than hidden.

| Step | Command | Result |
| ---- | ------- | ------ |
| Toolchain pin | `npm run toolchain:verify` | PASS - "every active toolchain matches the pin" (node 22.22.3, flutter 3.47.5, dart 3.13.4) |
| Gates (stage 1, 2, 3, 4, 8-15, 23, 24, G-6) | `npm run gates` | all green (see §14) |
| Format | `npm run format:check` | clean |
| Lint | `npm run lint` | exit 0, no warnings |
| Typecheck (ADR-001 composite) | `npm run typecheck` | exit 0 |
| Contract drift | `npm run contracts:check` | "contracts are in sync" |
| API tests | `npm run test --workspace @my-shop/api` | 33 suites / 433 tests pass |
| Contract tests | `@my-shop/contracts` | 2 suites / 17 tests pass |
| Testkit tests | `@my-shop/testkit` | 1 suite / 5 tests pass |
| Flutter analyze | `npm run flutter:analyze` (pinned 3.47.5) | "No issues found!" |
| Flutter test | `npm run flutter:test` | 364 passed, 1 skipped (T-O6 `DEFERRED_BY_PLAN`) |

The API bug-fix test in §15 D-3 was additionally stress-run 30 times with a fresh
RSA key per run (0 failures), because the original failure depended on the random
key material and would not reproduce on demand.

### 3.2 Environment

- Node 22.22.3, npm 10.9.8; Dart 3.13.4; Flutter **3.47.5** selected per-invocation
  by `tool/flutterw` from `.tool-versions`. The host's PATH `flutter` is the stale
  3.24.5 SDK that R-5 records; the wrapper neither installs nor upgrades it.
- The database project ran against a real PostgreSQL on the fixed `my_shop_test`
  database via `DATABASE_URL` (`my_shop_app`), `MIGRATION_DATABASE_URL`
  (`my_shop_migrator`), and `ADMIN_DATABASE_URL` (admin), mirroring `ci.yml`.
- The `@node-rs/argon2` prebuilt native binary resolved for `win32-x64` locally and
  for `linux-x64` in CI (both the unit job and the database job exercised hashing).

### 3.3 Implementation notes

- **Hashing.** `password.ts` wraps `@node-rs/argon2` (`hash`/`verify`) with explicit,
  config-supplied parameters and per-user random salt; `needsRehash` compares the
  stored parameters to the configured target. There is **no** hand-rolled digest
  comparison anywhere in the slice (§10.2).
- **Access token.** `access-token.ts` signs and verifies RS256 over `node:crypto`
  only. The header is fixed to `alg: RS256`; verification rejects any other header
  before touching the signature, then checks `iss`, `aud`, `exp`, and `nbf`.
- **Refresh token.** `refresh-token.ts` mints 256 random bits and stores only the
  SHA-256 hex digest; `auth.service.ts` rotates by consuming the presented row and
  linking `successor_id` to the new row in one transaction.
- **Ordering guarantee.** `refresh()` commits the outcome first and throws the
  refusal afterwards, so a reuse-triggered family revocation is durable and cannot
  be rolled back by the refusal. Login composes credential check, throttle, session
  creation, and the security-event sit in a single `$transaction`.
- **Fail-closed wiring.** `AppModule.forRoot` binds the identity module only when
  configuration is present; with keys absent the access-token service refuses to
  sign and refuses to approve (`SERVICE_UNAVAILABLE`). Configuration is required in
  `production` (§2.5 AC-32).

### 3.4 Test evidence

| Project | Suites | Tests | Notes |
| ------- | ------ | ----- | ----- |
| Unit (`test:unit`) | 28 | 322 | nine new `src/common/identity/*.spec.ts`; `app.config.spec.ts` extended |
| Integration (`test:integration`) | 4 | 44 | one new: `test/identity/auth.e2e-spec.ts` (HTTP boundary, DB-independent) |
| Database (`test:database`) | 1 | 67 | **15 are the M2-S2 acceptance block** in `postgres.db-spec.ts`, against real PostgreSQL |
| Flutter | - | 364 (+1 skip) | T-O6 skip remains `DEFERRED_BY_PLAN` |
| Contracts | 2 | 17 | generation is byte-stable |
| Testkit | 1 | 5 | unchanged |

The M2-S2 database block proves login, rotation, **reuse-detection-revokes-the-family**,
logout revocation, bounded throttle, `TOKEN_STALE` on a permissions-version
mismatch, and idle/absolute expiry - each with a CHECK-level counterpart where the
database can express the rule (§4).

### 3.5 Local schema and contract drift

- `prisma migrate diff --from-url --to-schema-datamodel --exit-code` exits 0
  in-suite: the migration history and `schema.prisma` agree for both migrations.
- `contracts:check` prints "contracts are in sync"; the four auth endpoints
  (`/api/v1/auth/login`, `/refresh`, `/logout`, `/me`) appear in
  `packages/contracts/openapi.json` and `src/generated/schemas.ts`, and regeneration
  is byte-identical.

### 3.6 Remote CI

Exact-SHA evidence for the **implementation head**
`9f2ca66548f3cf01d6541c2f54e2e877fdd35801`:

| Event | Run | Conclusion | Jobs |
| ----- | --- | ---------- | ---- |
| `push` | `38847227630` | success | all seven green |
| `pull_request` | `38847231347` | success | all seven green |

The seven required checks - `fast-checks`, `backend-unit`,
`backend-integration-database`, `contract-drift`, `dependency-audit`,
`flutter-build-windows`, `flutter-build-android` - are each `success` on both runs.

The **first** push on this slice (`196bd53`, run `38844464918`) failed
`backend-unit`; the parallel `pull_request` run for the *same* commit
(`38845052744`) succeeded, which is how the flake was identified. The fix is
`9f2ca66` (§15 D-3), and the two rows above are that fixed head. The
`pull_request` run for `196bd53` is cited only to document the flake, not as the
final gate.

The record commit that carries this section is documentation-only; its exact head
is verified green on both events after publication and is the value quoted in the
final acceptance report (§19).

### 3.7 PR

PR **#18**, base `codex/my-shop-m2-s1-organizations-bootstrap` (the M2-S1 branch),
head `codex/my-shop-m2-s2-identity-auth`. It is **OPEN** and unmerged; the state
after the fixed head is MERGEABLE with a clean merge status once the checks settle.
No auto-merge is enabled.

### 3.8 Security threat-model walk

§13.7 walked for the first authentication surface. S-01…S-22 are the threats this
slice introduces or touches, and what refuses each.

| ID | Threat | Control | Evidence |
| -- | ------ | ------- | -------- |
| S-01 | Stored credential recovery | Argon2id PHC with per-user salt; never plaintext; `chk_user_credentials_hash_prefix` enforces `$argon2id$` | AC-08, §4 |
| S-02 | Online password guessing | Bounded exponential backoff per account **and** per address; success resets; never permanent | AC-20, §3.4 |
| S-03 | Credential in logs | `password` is not a loggable key; bodies never logged | AC-23, §5 |
| S-04 | Account enumeration | Unknown email takes the same path/code as a wrong password (dummy verify equalizes work) | AC-07 |
| S-05 | Refresh-token replay | Rotation; a consumed token is a reuse signal that revokes the whole family | AC-14, AC-15 |
| S-06 | Refresh-token forgery | 256-bit random; only the SHA-256 digest is stored and compared | AC-22 |
| S-07 | Access-token forgery | RS256 verify against the configured public key; a tampered signature is refused | AC-11 |
| S-08 | `alg` confusion | Header `alg` is pinned; `none`/`HS256` refused before signature work | AC-11 |
| S-09 | Cross-issuer token reuse | `iss` and `aud` are checked against configuration | AC-12 |
| S-10 | Expired / not-yet-valid token | `exp` and `nbf` checked; expired → `TOKEN_EXPIRED` | AC-12 |
| S-11 | Stale authority | `perms_version` in the token is compared to `users.permissions_version`; mismatch → `TOKEN_STALE` | AC-34, §6 |
| S-12 | Token from a revoked session | `revoked_at` is checked on every authenticated request | AC-17 |
| S-13 | Session fixation | `sid` is server-generated; a client cannot supply it | §3.3 |
| S-14 | Tenant spoofing in a body | Organization claims are read only from the verified token | AC-26 |
| S-15 | SQL injection | Prisma parameterized access only; no interpolated SQL in the slice | G-21 |
| S-16 | Secret in logs/output | Sinks log identifiers, never a token or hash; the CLI prints no secret | AC-25 |
| S-17 | Secret committed to the repository | No key material is committed; `.env.example` carries placeholders; `gate:secret-scan` green | G-22 |
| S-18 | Fail-open when unconfigured | The surface mints nothing and approves nothing; required in production | AC-31, AC-32 |
| S-19 | Verification side channel | Constant-time comparison is the library's, not ours | AC-09 |
| S-20 | Hashing as a DoS vector | Argon2 memory floor enforced (>= 8192 KiB); password length capped at 128 | AC-31 |
| S-21 | Lockout as a denial of service on the account | Backoff is bounded and never permanent; administrative unlock is out of scope but the design does not lock | AC-20 |
| S-22 | Driver error / SQL exposure | The problem filter maps to stable codes; no SQL or internal identifier reaches a response | AC-23 |

### 3.9 Requirements mapping (§40.6 M2-S2, §10)

- §40.6 M2-S2 outcome "Identity: users, Argon2id, login, refresh rotation, reuse
  detection, revocation" - §2.1 S-3…S-11 and AC-05…AC-21.
- §40.6 M2-S2 key acceptance "Reuse detection revokes the family" - AC-14/AC-15
  against real PostgreSQL.
- §10.1 email + password, server-side sessions - S-7, S-12, AC-05.
- §10.2 Argon2id, explicit parameters, per-user salt, constant-time verify, **no
  permanent lockout**, minimum length + deny-list seam, no composition rules - S-3,
  S-4, S-8, AC-08…AC-09, AC-20.
- §10.3 claim set and rotation - S-5, S-6, AC-10…AC-19.
- §10.4 operator bootstrap - §8 (this record), S-13, AC-24/AC-25.
- §13.1/§13.6 error and secret discipline - AC-23/AC-25.
- §34.1-§34.3 routing, validation, problem documents - AC-21.

---

## 4. Migration acceptance

- `prisma migrate deploy` from empty applies `0001`…`0006`, each exactly once, none
  rolled back (AC-01); a second deploy applies nothing and succeeds (AC-03).
- Drift: `migrate diff --from-url --to-schema-datamodel --exit-code` exits 0 (AC-04).
- The four new tables exist and only those (AC-02); owners are the migrator, and the
  application role gains no DDL (AC-27).
- Database-enforced rules proved by rejection, wrapped in always-rollback
  transactions: the Argon2id prefix CHECK, `token_hash char(64)` length, the
  consumed-token-has-successor rule, the positive-counter CHECKs, and
  `chk_users_permissions_version_non_negative` (§3.4).
- Legacy db-spec assertions were **strengthened** to include `0005`/`0006` and the
  new tables as exact equalities (AC-29).

---

## 5. Security audit - supporting dimensions

| Dimension | Finding |
| --------- | ------- |
| Authentication | First auth surface; fails closed; no anonymous minting; provisioning is operator-only. |
| Authorization | No business endpoint consumes the guard yet; claims are verified-only. Tenant claims come from the token, never the body. |
| Secrets | Private key env-only; refresh-token digest only; nothing secret in logs, CLI output, tests, or the repository. |
| Injection | Prisma parameterized access only; no interpolated SQL. |
| Crypto | Argon2id via a maintained library; RS256 via `node:crypto`; fixed algorithm; no hand-rolled primitives. |
| Errors | Stable problem codes; no stack, SQL, or internal identifier leaves the process. |
| Dependencies | `npm audit --audit-level=high` exits 0: 0 high, 0 critical (21 moderate, all transitive/dev, unchanged posture). |

---

## 6. Data model and tenant invariants

- Identity owns `user_credentials` (1:1 with `users`), `sessions` (the family),
  `refresh_tokens` (digest chain), and `auth_throttles`.
- `users.permissions_version` (default 0, `>= 0`) is the token-staleness key; M2-S2
  reads it, M2-S3 writes it (N-2).
- Tenant invariants T-1…T-7 are **not** newly enforced here; RLS and `SET LOCAL`
  are M2-S4 (N-3). No policy and no `SET LOCAL` are introduced.
- Referential integrity: every session/credential/refresh row points at an existing
  `users` row; refresh `session_id` points at an existing session. The database, not
  the service, is the last line of defence (F-3 discipline).

---

## 7. Idempotency and concurrency contract

- **Login** performs credential check, throttle update, session insert, refresh-row
  insert, and event emission in one `$transaction`; a failure leaves no partial
  session.
- **Refresh rotation** commits the successor and the consumption of the presented
  row, then links them; the transaction commits before any refusal is thrown, so a
  reuse revocation is never rolled back.
- **Concurrent refresh of one token** is arbitrated in the database: the first
  transaction to consume the row wins; the loser observes the row already consumed
  and is treated as reuse, revoking the family. This is a database outcome, not an
  in-memory flag.
- **Throttle** counters are database rows keyed per account and per address; the
  backoff is computed from stored timestamps, so it is consistent across processes.

---

## 8. Operator credential command contract (§10.2, §10.4)

- `npm run provision:credential` sets or rotates one user's Argon2id credential.
- The password is read from `PROVISION_PASSWORD` **only** - never from `argv` - and
  is never printed or logged. It requires an existing user and refuses otherwise.
- Exit codes: `0` success, `1` an expected refusal (bad/absent input, unknown user),
  `2` an unexpected failure. Output is a single JSON line and never a secret.
- Localization: the command's messages are the operator's, English-only, consistent
  with the existing CLI surface.

---

## 9. Bounded-context ownership and dependency direction

- `identity` owns its four tables and the `users` credential column; `tenancy`
  depends on identity, never the reverse (§39.3 D-1); there is no
  `identity -> bootstrap` edge.
- `common/architecture/import-boundary.spec.ts` enforces the direction and stays
  green (AC-25 analogue; §14 G-23).
- `common/identity/prisma-host.ts` is a structural host so providers depend on a
  narrow interface rather than the concrete service.

---

## 10. Contract, API, and offline surface

- Four new endpoints under `/api/v1/auth`: `login`, `refresh`, `logout`, `me`, with
  DTO-derived contract classes and `@ApiResponse`/`@ApiOperation` decorators.
- The OpenAPI artifact and generated schemas were regenerated and are byte-stable
  (`contracts:check` green, AC-28).
- No global prefix is added; controllers declare full paths, preserving the existing
  convention.
- The offline path is untouched: `gate:offline` is green with no new exemption, and
  the T-O6 Flutter skip remains `DEFERRED_BY_PLAN` (AC-29).

---

## 11. Decisions

- **D-1 Crypto stack.** Argon2id via `@node-rs/argon2` (the only new dependency);
  RS256 over `node:crypto` because ADR-005 fixes CommonJS and the maintained JWT
  libraries ship ESM-only (a documented deviation, §15).
- **D-2 Password policy.** Minimum length 12, maximum 128, no composition rules, a
  breached-password deny-list **seam** (`BreachedPasswordSource`, default empty) - the
  deny-list content is not this slice's, but the enforcement point is.
- **D-3 Session model.** One login = one session = one refresh-token **family**;
  30-day absolute / 7-day idle; the access token is 15 minutes.
- **D-4 Token format.** Refresh material is 256-bit opaque; only its SHA-256 hex is
  stored. The access token carries `sub`, `orgs`, `sid`, `perms_version`, plus
  `iss`/`aud`/`iat`/`exp`.
- **D-5 Refusals.** Missing/invalid/revoked/reused → `UNAUTHENTICATED` (401);
  expired → `TOKEN_EXPIRED` (401); permissions-version mismatch → `TOKEN_STALE`
  (401). Reuse additionally revokes the family as a durable effect.
- **D-6 Throttle.** Per account and per address; first failures free, then the delay
  doubles from 1 s capped at 900 s; success clears. Never permanent.
- **D-7 Provisioning.** Operator-only CLI; environment-only password; requires an
  existing user.
- **D-8 Key encoding.** JWT keys are base64 of PEM in the environment; `loadConfig`
  decodes once; absent keys fail closed and are required in `production`.
- **D-9 DTO wording.** The DTO descriptions avoid the literal word "secret" (an
  `openapi.spec.ts` assertion forbids it) and never imply a value is echoed back.
- **D-10 Migrations.** `0005` creates the identity tables; `0006` adds the
  permission-generation column. `0005` was frozen at its introducing commit when the
  column was specified, so the column moved to a new migration (§15 D-2).

---

## 12. Scope-difference report

1. **A second migration was required.** The plan's §35.1 forward-only rule means a
   committed migration is never rewritten. When `users.permissions_version` was
   specified after `0005` was committed, the column was delivered by `0006` rather
   than by editing `0005`. This is scope-consistent (same slice, additive) and is
   named here so the two-migration shape is not read as two slices.
2. **A CI-discovered test flake was fixed inside the slice.** See §15 D-3; it is a
   test-fidelity fix, not a scope expansion.
3. **`perms_version` is read, not written.** M2-S2 mints and compares the claim; the
   writer is M2-S3 (N-2). This is the plan's split and is kept explicit.

---

## 13. Acceptance criteria roll-up

| # | Criterion | Status | Evidence |
| - | --------- | ------ | -------- |
| AC-01 | `0001`-`0006` apply once from empty | PASS | §3.4, §4 |
| AC-02 | Only the authorized tables exist | PASS | §3.4, §4 |
| AC-03 | Second deploy applies nothing and succeeds | PASS | §3.4, §4 |
| AC-04 | Schema and history agree (drift exit 0) | PASS | §3.5, §4 |
| AC-05 | Correct login returns tokens and one session | PASS | §3.4 |
| AC-06 | Wrong password refused, no rows | PASS | §3.4 |
| AC-07 | Unknown email indistinguishable from wrong password | PASS | §3.4 |
| AC-08 | Stored credential is an Argon2id PHC string; CHECK enforced | PASS | §3.4, §4 |
| AC-09 | Constant-time verification; no hand-rolled compare | PASS | §3.4 |
| AC-10 | Access token is a verifiable RS256 JWT with the claim set | PASS | §3.4 |
| AC-11 | Foreign signature / tampered / `none` / `HS256` refused | PASS | §3.4 |
| AC-12 | Expired / wrong-issuer / wrong-audience refused | PASS | §3.4 |
| AC-13 | Refresh rotates and links `successor_id` | PASS | §3.4 |
| AC-14 | Reuse refused and revokes the family | PASS | §3.4 |
| AC-15 | Newest token of a revoked family is refused | PASS | §3.4 |
| AC-16 | Unknown/malformed refresh refused | PASS | §3.4 |
| AC-17 | Revoked session's token refused | PASS | §3.4 |
| AC-18 | Idle/absolute-expired refresh refused | PASS | §3.4 |
| AC-19 | Logout revokes; later refresh refused | PASS | §3.4 |
| AC-20 | Bounded backoff per account and address; resets on success | PASS | §3.4 |
| AC-21 | `me` requires a valid Bearer token | PASS | §3.4 |
| AC-22 | Only the digest is stored; never logged in clear | PASS | §3.4, §5 |
| AC-23 | No hash/token/driver error echoed | PASS | §5 |
| AC-24 | CLI reads the password from the environment only | PASS | §3.4, §8 |
| AC-25 | No credential in output, logs, tests, or PR | PASS | §5, G-22 |
| AC-26 | Org claims only from the verified token | PASS | §3.4 |
| AC-27 | Role separation unchanged; migrator-owned; app no DDL | PASS | §3.4, §4 |
| AC-28 | `contracts:check` "contracts are in sync" | PASS | §3.1, §3.5 |
| AC-29 | M1b/M2-S1 regressions green; T-O6 still deferred | PASS | §3.1, §3.4 |
| AC-30 | Flutter regression green | PASS | §3.1 |
| AC-31 | Invalid config refuses startup; missing keys allowed only outside production | PASS | §3.4 |
| AC-32 | Absent config is fail-closed | PASS | §3.4 |
| AC-33 | Exact-SHA CI green on both events | PASS | §3.6, §19 |
| AC-34 | `permissions_version` column + CHECK; `TOKEN_STALE` on mismatch | PASS | §3.4, §4, §6 |

---

## 14. Gates

G-01…G-13 are the master plan's per-slice gates (§43.1); G-14…G-34 are this slice's
added gates. Every gate is PASS except **G-12**, which is **NOT SATISFIED** by
design.

| Gate | Condition | Result |
| ---- | --------- | ------ |
| G-01 | Every declared acceptance criterion is verified | PASS - AC-01…AC-34 rolled up in §13 |
| G-02 | All declared tests exist and pass | PASS - §3.4 (unit 322, integration 44, database 67, flutter green) |
| G-03 | Applicable §36.4 invariants pass | PASS - I-1…I-20 belong to later slices; the applicable analogue is the database-enforced single-use/family revocation (§4) |
| G-04 | All CI stages pass | PASS - local chain green (§3.1); seven checks green on the exact head for both events (§3.6, §19) |
| G-05 | No file outside `allowed_paths` modified | PASS - the branch diff is exactly the 37 paths under §2.3 |
| G-06 | `non_scope` untouched | PASS - no RBAC/RLS/device/audit-table/UI change (§2.2) |
| G-07 | Migration impact as declared; files immutable | PASS - `0005`+`0006` additive; `gate:migrations` reports 7 paths, none rewritten |
| G-08 | Security impact as declared; no new anonymous endpoint | PASS - §3.8 S-01…S-22; a session is required for `me` |
| G-09 | No `GRANT ALL`, no `search_path` change, no interpolation | PASS - both migrations literal; no interpolation in the slice |
| G-10 | Rollback defined and feasible | PASS - §17 |
| G-11 | Documentation updated (plan only if a decision changed) | PASS - this record; README; `.env.example`; no plan decision changed |
| G-12 | Owner authorized the merge separately; no automated merge | **NOT SATISFIED** - PR #18 open; no merge performed |
| G-13 | Offline path: T-O tests pass; §13.7 walked | PASS - `gate:offline` green; T-O6 skip preserved; §3.8 walked |
| G-14 | Schema and history agree (non-vacuous drift) | PASS - AC-04 |
| G-15 | Role separation unchanged; app gains no privilege | PASS - AC-27 |
| G-16 | New tables migrator-owned | PASS - AC-27 |
| G-17 | Single-use refresh enforced in the database (no in-memory flag) | PASS - consumed-token/successor + `token_hash` UNIQUE (§7) |
| G-18 | Family revocation is durable despite the refusal | PASS - commit-then-throw ordering (§3.3, §7) |
| G-19 | Referential integrity for credential/session/refresh edges | PASS - FKs; §6 |
| G-20 | Malformed input refused before a connection is opened | PASS - validation pipe; integration suite |
| G-21 | No string-interpolated SQL anywhere in the slice | PASS - Prisma parameterized only |
| G-22 | The credential is environment-only and never printed; secret-scan green | PASS - AC-24/AC-25 |
| G-23 | Bounded-context ownership honoured | PASS - §9; `import-boundary.spec.ts` green |
| G-24 | Tenant invariants mapped (T-1…T-7) with RLS deferred to M2-S4 | PASS - §6; no policy/`SET LOCAL` |
| G-25 | Legacy db-spec assertions strengthened, not weakened | PASS - migration/table lists are exact equalities including `0005`/`0006` |
| G-26 | Real-PostgreSQL acceptance, no mock and no silent skip | PASS - database suite 67/67 |
| G-27 | Documentation and PR consistent; final SHA locked | PASS - §19; PR #18 open with the exact head |
| G-28 | Dependency direction enforced by an automated test, not only documented | PASS - `import-boundary.spec.ts`; §9 |
| G-29 | No secret can reach a response, log, or the CLI | PASS - AC-23/AC-25; sinks log identifiers only |
| G-30 | Access-token verification rejects `alg` confusion before crypto | PASS - §3.3, §3.4 |
| G-31 | A consumed refresh token is a reuse signal, not a retry | PASS - AC-14/AC-15 |
| G-32 | Permission-generation staleness is refused (`TOKEN_STALE`) | PASS - AC-34 |
| G-33 | Fail-closed when identity is unconfigured | PASS - AC-32 |
| G-34 | Password policy is length + deny-list seam, no composition rules | PASS - AC-08/AC-09 |

---

## 15. Deviations

- **D-1 RS256 over `node:crypto` rather than a JWT package.** ADR-005 fixes the
  backend on CommonJS; the maintained JWT libraries with a current release are
  ESM-only and cannot be `require`d by the compiled package or the Jest projects.
  The token format is ~120 lines of a well-specified format over the platform's own
  OpenSSL. No dependency is added for signing.
- **D-2 The identity tables and the permission column are two migrations.** `0005`
  was committed (`cc154c7`) before `users.permissions_version` was specified. Since a
  committed migration is never rewritten (§37.3 G-6), the `0005` bytes were restored
  to `cc154c7` and the column moved into the additive `0006_users_permissions_version`
  (`196bd53`). The immutability gate now reports 7 paths, none rewritten. This is a
  history-hygiene correction, not a history rewrite: `0005`'s introducing commit is
  untouched on the branch.
- **D-3 The tampered-signature token test was flaky and CI caught it.** The first
  push (`196bd53`) failed `backend-unit` on
  `access-token.spec.ts` "refuses a tampered signature": the test flipped the **last**
  base64url character of the RSA signature, but for a 2048-bit signature that
  character carries only two significant bits, so `A`↔`B` decodes to the same byte.
  When it happened to be a no-op (about one run in four, keyed on the random key
  material) the signature still verified and the verifier reported the fixed-`BASE`
  token as `TOKEN_EXPIRED` against the wall clock instead of `UNAUTHENTICATED`. The
  fix flips a whole byte of the signature and verifies at the explicit `BASE` time;
  the foreign-issuer case now signs with the same key pair and only a different
  `iss`/`aud`, so it exercises those checks rather than tripping the signature check
  first. Stress-run 30× with a fresh key per run: 0 failures. This is recorded, not
  hidden: the failing run is cited in §3.6.
- **D-4 The parallel local test run can exceed the effective 5000 ms per-test
  timeout.** As M2-S1 §15 already documented, the database Jest project's per-test
  timeout in effect is 5000 ms. Running all three API projects in one `jest`
  invocation lets the memory-hard Argon2 unit tests starve the database and
  integration workers, so pre-existing (and, once, new) tests can time out locally.
  This is a local-contention artifact: each project passes alone, `jest --runInBand`
  passes 433/433, and CI isolates the projects into separate jobs/steps where they
  pass (§3.6). `jest.config.mjs` is outside `allowed_paths`, so no configuration was
  changed; the authoritative per-project and remote runs are green. The first
  `verify:node` attempt (exit 1) and the clean result (exit 0) are both stated in
  §3.1.
- **D-5 `perms_version` is read, never written, in this slice.** The writer is M2-S3
  (N-2); M2-S2 only mints and compares it (AC-34). Stated so a reader does not expect
  an increment here.
- **No repair commit, no history operation.** The branch was built by ordinary
  commits from `4cd1933`; nothing was force-pushed, rebased, or reset. The only
  correction to a prior commit's content (`0005`) was performed by restoring the
  committed bytes and adding a new migration, not by rewriting the commit.

---

## 16. Residual risks and stated limits

- **No RLS or `SET LOCAL` yet.** Tenant-isolation _enforcement_ arrives with M2-S4;
  this slice adds no policy. Stated, not hidden (N-3).
- **No durable audit table.** Security events go through a port and are logged; the
  durable `security_events`/`audit_events` tables are M2-S6 (N-5). The port is the
  seam, not the table.
- **Permission enforcement does not exist.** `perms_version` is compared, but no
  business endpoint consumes the claim, because none exists yet.
- **The breached-password deny-list is a seam with an empty default.** The enforcement
  point is real and tested; the list content is deliberately out of scope.
- **Device binding is not present.** The sync boundary stays fail-closed and is not
  unblocked by this slice (N-4).
- **Administrative unlock UI is out of scope.** The design never permanently locks, so
  a lockout cannot occur; there is nothing to unlock.
- **Clock trust.** Expiry is enforced against the server clock; no external time
  source is consulted (unchanged from the rest of the system).

---

## 17. Rollback

Revert the slice commits and redeploy the prior head (the identity module unbinds
with one line, and the process then runs exactly as before M2-S2). The migrations
are additive: `0005` and `0006` may be left in place (no code reads them after
revert) or removed by a later forward-only migration that drops the four tables, the
column, and their constraints — with the loss of credential and session rows
acknowledged as the deliberate cost. No data migration of existing rows occurs, so
no existing tenant data is at risk. Should a shared environment ever require
reversal, §35.1's forward-only rule applies: a new migration numbered after `0006`.
`main` stays untouched.

---

## 18. Deferred design notes

- **Roles, permission catalog, presets/overrides, and the writer of
  `perms_version`.** M2-S3 (N-2). The token already carries `perms_version`, so M2-S3
  needs no token-format change.
- **RLS policies and per-request `SET LOCAL`.** M2-S4 (N-3).
- **Device registration/enrolment and real device binding on the sync boundary.**
  M2-S5 (N-4). Until then the sync boundary refuses every request.
- **Durable `security_events`/`audit_events` storage.** M2-S6 (N-5); the
  `SecurityEventSink` port is the integration point.
- **Flutter authentication UI and App Lock.** M2-S7 and the M2-S2 "next slice" (§40.6).
- **Password reset, MFA, social login.** Not scheduled (N-8).

---

## 19. Commit ledger, final SHA, and remote lock

| Commit | Type | Subject |
| ------ | ---- | ------- |
| `58d577e` | `docs(m2-s2)` | declare the identity, refresh-rotation and reuse-detection slice |
| `cc154c7` | `feat(m2-s2)` | add identity credential, session, refresh-token and throttle tables |
| `a635e2a` | `feat(m2-s2)` | Argon2id credentials, sessions, refresh rotation, reuse detection |
| `a13fc6c` | `docs(m2-s2)` | document the identity surface and the credential command |
| `196bd53` | `fix(m2-s2)` | keep `0005` immutable and add `0006` for the permissions column |
| `9f2ca66` | `fix(m2-s2)` | make the tampered-signature token test deterministic (implementation head) |
| _record commit_ | `docs(m2-s2)` | record the execution evidence, threat walk, and remote lock |

**Base:** `4cd1933` (locked M2-S1 head). **Implementation head:**
`9f2ca66548f3cf01d6541c2f54e2e877fdd35801`. **Record head:** the commit that carries
this section (documentation only).

Remote lock: on the exact implementation head `9f2ca66`, all seven required checks
are green on **both** the `push` run `38847227630` and the `pull_request` run
`38847231347` (§3.6). The first push on `196bd53` (`38844464918`) failed
`backend-unit` on the flake fixed by `9f2ca66`; its parallel `pull_request` run
(`38845052744`) succeeded, which localized the flake, and it is superseded. The final
record commit is documentation-only; its head is verified green on both events as
well and is the value reported in the final acceptance report. Owner merge
authorization is required; nothing is merged and no auto-merge is enabled.

---

## 20. Boundary and verdict

The next unit the master plan defines after M2-S2 is **M2-S3** (§40.6 - roles,
permission catalog, presets, overrides, and the writer of `perms_version`). It is
**NOT AUTHORIZED** by this record and is **not** started here. M2-S4 (RLS), M2-S5
(devices), M2-S6 (audit streams), and M2-S7 (Flutter auth) remain later concerns, as
does App Lock (this slice's declared next).

On the acceptance gate: **G-12 is NOT SATISFIED** - PR #18 is left open and no merge
was performed. The merge is the owner's decision, not this slice's.

```
NO MERGE PERFORMED - OWNER MERGE AUTHORIZATION REQUIRED
PASS_MY_SHOP_M2_S2_IDENTITY_REMOTE_LOCKED
```
