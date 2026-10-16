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
| S-1  | Migration `0005_identity_auth` (forward-only, additive): table `user_credentials` (1:1 with `users`; Argon2id PHC `password_hash`, `password_updated_at`); table `sessions` (the server-side session = the refresh-token **family**; `user_id`, `created_at`, `last_used_at`, `absolute_expires_at`, `revoked_at`, `revoked_reason`); table `refresh_tokens` (opaque-token digest `token_hash char(64)` UNIQUE, `session_id`, `issued_at`, `idle_expires_at`, `consumed_at`, `successor_id`); table `auth_throttles` (`key` PK, `failure_count`, `first_failure_at`, `last_failure_at`, `blocked_until`). CHECK constraints (Argon2id prefix; consumed-token-has-successor; positive counters; time-window sanity), FKs, and indexes. |
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
- `services/api/src/common/config/app.config.ts`
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
| Database    | `test/database/postgres.db-spec.ts` (M2-S2) | Migration `0005` from empty, drift `--exit-code`, table/constraint-level rejections, role separation, the **reuse-detection-revokes-family** acceptance against real PostgreSQL |

§36.1 T-2 forbids an in-memory substitute for the database assertions; the
database suite fails fast when its environment is absent (no silent skip, T-5).

### 2.5 `acceptance_criteria`

| ID    | Criterion                                                                                                                                        | Source      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| AC-01 | `prisma migrate deploy` from empty applies `0001`-`0005`, each exactly once, none rolled back                                                     | §3.4        |
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

### 2.6 `migration_impact`

- **One** new forward-only, additive migration: `0005_identity_auth`. It creates
  four tables and their constraints and indexes. It alters **no** existing table.
- `0001`-`0004` are byte-identical to the base commit; the immutability gate is
  expected to report one more migration path than M2-S1's five.
- No `GRANT`, no `SECURITY DEFINER`, no `BYPASSRLS`, no `search_path` change, no
  string interpolation (§8.3, G-09). The migrator's `ALTER DEFAULT PRIVILEGES`
  in `prisma/roles.sql` already births every new table with the application
  role's DML, so `roles.sql` is untouched.
- CHECK constraints are not modelled by Prisma, so they do not create drift - the
  same situation as `0003`'s three CHECKs and `0004`'s kebab CHECK.

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

_To be completed after implementation, in the record commit._

### 3.1 Local chain

### 3.2 Environment

### 3.3 Implementation notes

### 3.4 Test evidence

### 3.5 Local schema and contract drift

### 3.6 Remote CI

### 3.7 PR

### 3.8 Security threat-model walk

### 3.9 Requirements mapping (§40.6 M2-S2, §10)

---

## 4. Migration acceptance

---

## 5. Security audit - supporting dimensions

---

## 6. Data model and tenant invariants

---

## 7. Idempotency and concurrency contract

---

## 8. Operator credential command contract (§10.2, §10.4)

---

## 9. Bounded-context ownership and dependency direction

---

## 10. Contract, API, and offline surface

---

## 11. Decisions

---

## 12. Scope-difference report

---

## 13. Acceptance criteria roll-up

---

## 14. Gates

---

## 15. Deviations

---

## 16. Residual risks and stated limits

---

## 17. Rollback

---

## 18. Deferred design notes

---

## 19. Commit ledger, final SHA, and remote lock

---

## 20. Boundary and verdict
