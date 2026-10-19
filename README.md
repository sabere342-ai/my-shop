# My Shop

**Arabic-first point-of-sale and back-office system for a small independent retail business.**

Simple outside, rigorous inside. The shop owner and the salesperson ring up a sale, take
payment, and move on. Underneath, My Shop maintains a double-entry ledger, immutable
transaction snapshots, and full attribution for every action that moves money or stock.

**The authoritative product and architecture plan is
[`docs/governance/MY_SHOP_MASTER_PLAN.md`](docs/governance/MY_SHOP_MASTER_PLAN.md).**
Where the code and that document disagree, the document wins and the code is the defect.

## Current state

| Phase | Slice                                                          | State                                                 |
| ----- | -------------------------------------------------------------- | ----------------------------------------------------- |
| M0    | P1 — Foundation, discovery, master plan                        | complete, PR #1 open                                  |
| M0    | P2 — Offline-capable POS architecture amendment                | complete, PR #2 open                                  |
| M1    | S1 — Monorepo skeleton and pinned toolchain                    | complete, branch pushed; no PR yet (`gh` unavailable) |
| M1    | S2 — Backend skeleton                                          | complete, branch pushed; no PR yet (`gh` unavailable) |
| M1    | S3 — Prisma bootstrap                                          | complete, branch pushed; no PR yet (`gh` unavailable) |
| M1    | S4 — CI pipeline                                               | complete, PR #4 open                                  |
| M1    | **S5 — App skeleton (design system, l10n, router, bootstrap)** | **complete, PR #5 open**                              |
| M1    | **S6 — Shared contract generation and drift check**            | **complete, PR #6 open**                              |

Nothing is deployed. Nothing is released. No PR has been merged — Master Plan gate G-12
and CI gate G-4 require an explicit, separate owner authorization to merge, and there is
no automated merge in this repository.

## The offline requirement

My Shop is an **offline-capable POS**. Selling must not stop when the Internet does.

The cashier never sees a sync engine, a queue, or a conflict class. A sale is durable
**locally, before the success indicator**, in one atomic local transaction, and converges on
the server when connectivity returns. What this buys, and what it honestly does not, is
stated in Master Plan §38 rather than in marketing language:

- Guaranteed per device: no overselling beyond what the device knows it has.
- Guaranteed eventually: convergence, with divergence recorded and attributed.
- **Not** guaranteed: real-time global inventory certainty while two or more devices are
  disconnected. No system provides that without central coordination.

The largest remaining risks are **offline divergence (R-13)** and **bounded stale
authorization (R-14, R-15)** — both consequences of a decision the owner made deliberately,
and both bounded rather than eliminated.

## Hard rule: no negative stock sales

```
AVAILABLE_QTY >= SALE_QTY
```

There is **no bypass at any permission level in V1**: no warning-only sale, no hidden
manager override, no automatic override, no negative-stock setting, no silent correction.
When stock is short the sale is refused. Goods that are present but recorded as zero are
corrected by a separate, permissioned, reason-coded, audited stock adjustment — never by
forcing the sale. Master Plan §38.4, §38.5, ADR-035.

## Repository layout

Locked in by Master Plan §6.2.

```
apps/
  desktop/                Flutter client — one codebase for Windows and Android
    lib/
      app/                 bootstrap, router, theme wiring, DI root
      core/                api, auth, barcode, money, models, settings, ui, offline/...
      features/            one folder per bounded feature: data / domain / presentation
services/
  api/                    NestJS backend — the sole authority for business invariants
packages/
  contracts/              generated API contract types, single source of truth
  testkit/                shared fixtures and builders
docs/
  governance/             the master plan and slice records
  adr/                    architecture decision records
tool/                     pinned-SDK selection and toolchain verification
```

## Getting started

The toolchain is pinned in `.tool-versions` and verified by a guard. **Do not rely on
whatever happens to be on `PATH`** — Master Plan R-5 records that a Flutter SDK over a year
stale was found there.

```bash
npm run toolchain:verify     # node, dart, flutter all match the pin
npm run gates                # every mechanical CI gate, locally
npm run verify               # toolchain + gates + format + lint + typecheck + tests

./tool/flutterw doctor       # the pinned Flutter SDK
./tool/flutterw analyze --fatal-infos
./tool/flutterw test

npm run typecheck            # every TypeScript workspace
npm run contracts:check      # drift gate: committed OpenAPI + generated types match the backend
npm run contracts:generate   # regenerate openapi.json and src/generated/schemas.ts
npm run test                 # Jest across every workspace
npm run build                # composite build in dependency order
```

Secrets live in the environment. Only `.env.example`, which contains placeholders, is
committed (Master Plan §13.6, §42.6).

### Local database

The backend talks to PostgreSQL 18 through Prisma (ADR-005) under two roles
(Master Plan §13.4): `my_shop_migrator` owns DDL and is used only by the migration
workflow, `my_shop_app` owns DML only. With the three URLs from `.env.example` set
in the environment:

```bash
npm run db:bootstrap        # create/refresh both roles and their grants (prisma/roles.sql)
npm run db:migrate          # prisma migrate deploy, as the migrator role
npm run db:migrate -- dev   # create a migration — local development only (§8.3)
```

The one-time organization bootstrap is an **operator command, not an API**
(Master Plan §10.4). It runs as the migrator role and reads its credential from
`MIGRATION_DATABASE_URL` only — never from an argument, never printed, and never
falling back to `DATABASE_URL`:

```bash
npm run bootstrap:org -- --bootstrap-key main-shop --name "Main Shop" --owner-email owner@example.com
```

One transaction creates the organization, its owner user, and the owner
membership. Re-running the identical command is a no-op; reusing
`--bootstrap-key` with different parameters is refused and nothing is adopted.
Exit codes are `0` success (including an idempotent retry), `1` runtime failure,
`2` usage, input, or configuration refused, and `3` conflicting retry, with
exactly one JSON object on stdout (success) or stderr (refusal).

The target database must already exist: neither role may create one (§13.4), so
`db:bootstrap`/`db:migrate` fail with a clear error until it does. Locally,
`node scripts/db.mjs test-setup` (from `services/api`) creates it first.

### Credential provisioning

The organization bootstrap (above) creates the owner **without** a password. Setting
or rotating that owner's password is a second **operator command, not an API**
(Master Plan §10.2, §10.4). It reads the password from `PROVISION_PASSWORD` in the
environment only — never from an argument, never printed, never falling back to
`MIGRATION_DATABASE_URL`:

```bash
PROVISION_PASSWORD='a-sufficiently-long-passphrase' \
  npm run provision:credential -- --email owner@example.com
```

The stored credential is an Argon2id PHC string; the command refuses a password that
fails the §10.2 policy (minimum length, no composition rules) and, by construction,
never lets a password or hash reach stdout, stderr, or a log line. Exit codes match
the bootstrap command: `0` success, `1` runtime failure, `2` usage, input, or
configuration refused, with exactly one JSON object on the matching stream.

The successful login path **cannot** be exercised without a session, and the secret
key pair is required: set `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` (base64 of PEM text) in
the environment before starting the API in any environment where login is expected.
When either is absent outside production, the authentication surface is fail-closed —
no token can be minted or approved, and the affected requests are refused `503`.

### Authentication surface (§10.3)

Once a credential exists and a key pair is configured, the API exposes the four
versioned, unauthenticated-at-the-transport-level endpoints (the bearer requirement
is per route):

| Method | Path                    | Purpose                                                       |
| ------ | ----------------------- | ------------------------------------------------------------- |
| `POST` | `/api/v1/auth/login`    | Exchange an email and password for an access/refresh pair.    |
| `POST` | `/api/v1/auth/refresh`  | Rotate a refresh token; the presented token is consumed.      |
| `POST` | `/api/v1/auth/logout`   | Revoke the session family a refresh token belongs to.         |
| `GET`  | `/api/v1/auth/me`       | The verified identity behind a `Bearer` access token.         |

Refresh rotation records a chain: re-presenting an already-consumed token is a
definite reuse signal and revokes the **entire session family** (Master Plan §40.6,
the slice's key acceptance). The access token is a short-lived RS256 JWT whose
organization and session claims are read from the verified token, never from a
request body.

The root `npm test` runs the database acceptance suite, which drops and recreates a
fixed database named `my_shop_test`. It therefore requires `DATABASE_URL`,
`MIGRATION_DATABASE_URL`, and `ADMIN_DATABASE_URL` to be set **and to name that
database** (the maintenance URL must name another); anything else is refused before
anything is touched (Master Plan §36.1 T-5 — no silent skips).

### Authorization surface (§11)

Roles, permissions, and per-user overrides are the first `tenancy`-owned
authorization surface (Master Plan §11, slice M2-S3):

- **The permission catalog lives in code, not in the database** (§11.2). It is a
  versioned table of 36 permission ids across nine categories, each with a
  description and an `ownerExclusive` flag. Exactly one id is owner-exclusive
  (`accounting.journal.post`): it can never be granted to a non-owner — not by a role
  edit, not by an override, not at snapshot verification.
- **Roles are data, not an enum** (§11.3). Every organization is seeded, by
  idempotent application code and **never by a SQL data migration** (§35.4), with the
  six built-in presets: Owner, Manager, Cashier, Salesperson, Stockkeeper, and
  Accountant. The Owner role alone holds every catalog permission (including the
  owner-exclusive id) and cannot be edited. Seeding runs **lazily** on the first
  authorization touch of an organization, which is also the upgrade path for an
  organization created before migration `0007`. The Manager preset deliberately lacks
  `sales.viewAll` (§42.1 O-8).
- **Overrides are per-user `ALLOW`/`DENY` rows evaluated after the role** (§11.4).
  `DENY` removes a role grant and beats a same-permission `ALLOW`; `ALLOW` never
  confers an owner-exclusive permission on a non-owner; an unknown permission id is
  ignored — resolution fails closed.

The organization-scoped routes, each under
`/api/v1/organizations/:organizationId`:

| Method | Path                          | Required permission | Purpose                                                     |
| ------ | ----------------------------- | ------------------- | ----------------------------------------------------------- |
| `GET`  | `/authorization/me`           | —                   | The caller's effective permissions in this organization.    |
| `POST` | `/authorization/snapshot`     | —                   | Mint a signed authorization snapshot for the offline path.  |
| `GET`  | `/roles`                      | `roles.manage`      | List the roles and their stored grants.                     |
| `PUT`  | `/roles/:roleId/permissions`  | `roles.manage`      | Replace a role's grant set.                                 |
| `PUT`  | `/memberships/:userId/authorization` | `users.manage` | Assign a member's role and `ALLOW`/`DENY` overrides.        |

The organization comes from the **route parameter** and is checked against the access
token's membership set (§9.3); a request body never names a tenant, and a foreign
organization is refused `403 ORGANIZATION_FORBIDDEN` **and** recorded as a security
event. A caller without the required permission is refused `PERMISSION_DENIED`.

Every committed authorization change — a role edit or a membership change — bumps
`users.permissions_version` **in the same transaction** (§10.3), so every outstanding
access token carrying the stale value is refused `TOKEN_STALE` until its holder
re-authenticates.

The snapshot is a compact RS256 JWS (72-hour validity) over the effective permission
set, `permissions_version`, the catalog version, the organization id, and `iat`/`exp`.
It carries **no device id** — device identity rides in the access token's `did`
claim, not in the snapshot — and verification refuses a
tampered payload, a foreign signature, an algorithm downgrade, an expired or
wrong-issuer snapshot, an unknown catalog version, and any non-owner snapshot that
names an owner-exclusive permission (§38.16.3, §38.17).

### Database-enforced tenancy and ingress re-validation (§8–§9.4, slice M2-S4)

Tenancy enforcement now ends at the **database predicate**, not at a guard:

- **Every tenant-owned table** (the tenant root plus the eight
  `organization_id` tables: memberships, roles, grants, overrides, the
  mutation ledger, the change feed, the device cursors, and the per-tenant
  sequence) carries `ENABLE` + `FORCE` row-level security with one
  `tenant_isolation` policy (migration `0008`). The five identity tables —
  users, credentials, sessions, refresh tokens, throttles — are classified
  explicitly global: no RLS, on purpose, pinned by the table-inventory test.
  The exact inventory lives in [`docs/rls-inventory.md`](docs/rls-inventory.md).
- **One trusted transaction context** (`src/common/database/tenant-context.ts`)
  is the only code that names a tenant to the database: `set_config(...,
  is_local => true)` inside the transaction it guards, always from a value the
  caller already verified — never from a request body. The setting is
  transaction-local: gone at commit, gone at rollback, carried by no pooled
  connection. A deleted context is a `NULL` predicate, and `NULL` filters the
  row out exactly like `false` — "no context" is "no rows", for any session,
  including an operator `psql`.
- `FORCE` extends the policy to the table owner (the migrator role), so no
  application code, present or future, reads tenant rows outside a scoped
  transaction. Role attributes, grants, single-owner indexes, and composite
  foreign keys are untouched: RLS is a scope on visibility, not a replacement.

Two narrowly-scoped decisions — **D-A** (a verified user reads exactly their
own membership edges across organizations, in `USING` only, from a
server-resolved account id) and **D-B** (the §10.4 operator bootstrap key
sees exactly its own stored tenant root) — are documented in the slice record
and the architecture page, and each is pinned by a direct-SQL proof.

**Offline mutations are re-validated at acceptance.** A signed token proves
who was online when it was minted; it does not prove what is true days later.
Before a mutation's effect runs, the sync ingress re-validator re-reads the
actor's live membership and current effective permissions **inside the same
transaction the effect commits in**: no verified actor → `UNAUTHENTICATED`;
no live membership → `ORGANIZATION_FORBIDDEN`; a stale or stripped effective
set → `PERMISSION_DENIED`. Refusals are recorded as per-mutation REJECTED
ledger rows, commit nothing, and never block the rest of the batch. What the
validator proved is exactly what the ledger applied.

Production sync is **device-bound** (slice M2-S5): `DeviceBoundSyncAuthenticator`
identifies a sync caller by the bearer token (signature, live session, permission
generation) **and** the server-written session/device binding — a token minted
from an unbound session is refused `UNAUTHENTICATED`, and a caller whose device
row is REVOKED is refused `DEVICE_REVOKED` for the whole request (§12.5). The
depth of this posture, its honest boundaries, and the failure codes are
documented in
[`docs/security-architecture.md`](docs/security-architecture.md).

### Devices: registration, binding, revocation (§12, §12.5, slice M2-S5)

A device is an **installation**, registered by any member of the organization on
first successful authentication (§12.1):

```text
POST /api/v1/organizations/{organizationId}/devices                      # any member
GET  /api/v1/organizations/{organizationId}/devices                      # devices.view
POST /api/v1/organizations/{organizationId}/devices/{deviceId}/bind-session  # any member
POST /api/v1/organizations/{organizationId}/devices/{deviceId}/revoke    # devices.revoke
```

Registration is idempotent per `(organization_id, installation_id)`: the same
keystore pair re-verifies against the stored SHA-256 digest and refreshes the
metadata; a wrong credential is refused without revealing the device's state;
a REVOKED installation is never re-activated — re-installation enrolls a *new*
installation id and the old row stays revoked (§12.2's closed two-state
vocabulary). The server stores only the digest; the installation credential
itself exists only in the client keystore and never appears in a response, a
log line, or a contract document (§13.6).

`bind-session` writes the binding onto the verified principal's own session and
answers a **fresh access token** carrying the `did` device claim — the next
request is device-bound without a second round trip. Pre-binding tokens are
refused for device-bound sync: a session and its token must agree about the
binding, in both directions, on every authenticated request. A session binds
at most one device, and no refresh token is rotated by binding.

Revocation is one transaction: the device row becomes `REVOKED` and every
session family bound to it is revoked with it (new `sessions.revoked_reason`
value `DEVICE_REVOKED`), so refresh dies at the same instant the device does.
At the sync boundary the *live* device row is re-read inside a tenant
transaction — a revoked device is refused `DEVICE_REVOKED` on the next push or
pull regardless of any token still carrying it, and its queued mutations are
quarantined for owner decision, never discarded (§12.5). The owner-visible
device list exposes §12.5's server-maintained sync metadata (last push/pull/
sync, client schema version) so a one-sided failure is diagnosable.

### The client auth flow (§13.6, §38.16, slice M2-S7)

The Flutter client (`apps/desktop`) consumes the surfaces above. Its custody
rule is absolute: **a token is never written outside the platform secure
storage** (§13.6, ADR-006). Access and refresh tokens live in one keystore
record (`auth.access_token`, Windows DPAPI / Android Keystore); a failed read
or write reports the session as unauthenticated, a corrupted record is wiped
and refused, and sign-out wipes the token record, the installation identity,
and the offline grace record locally even if the server logout call fails.
There is no plaintext, preferences, or database fallback anywhere — the test
suite cross-checks every other persistence seam for token material and finds
none.

Two build inputs configure a client binary (`--dart-define`), because a
client is compiled for the deployment it belongs to:

| Define                        | Required | Purpose                                                                    |
| ----------------------------- | -------- | -------------------------------------------------------------------------- |
| `MY_SHOP_API_BASE_URL`        | yes      | The server origin (§34.1). Absent ⇒ composition fails fast naming the define. |
| `MY_SHOP_SNAPSHOT_PUBLIC_KEY` | no       | SPKI public key for verifying the signed authorization snapshot (§38.16.3). Absent ⇒ sign-in works online, but no offline grace session can ever be established — the verifier has no accepting default. |

On start the client reads the keystore before the first frame and routes
honestly: no stored session → `/sign-in`; a stored session without an
organization → `/organization-setup`; a stored session with one → the shell.
Sign-in succeeds only through the server's verified response; a refused login
surfaces the mapped problem code (bad credentials, throttling) and nothing
else. On a fresh authenticated session the client enrolls its installation
idempotently (§12.1), binds the session (receiving the re-minted `did`-bound
token), and mints + stores the signed authorization snapshot. Organization
choices are exactly the memberships `/auth/me` verified — never a
client-asserted tenant id (§9.3).

While offline inside the grace window the shell shows one calm status line
(§38.31): active grace, read-only (expired grace — reads continue, committed
work still syncs, mutations are refused), or honestly neutral (no session, no
grace). The line is driven by the existing `OfflineGraceService` admission
policy, not a re-implementation. A fresh offline device without a minted
record cannot mutate — that is §38.18's safe fallback, not a regression.

### Running the backend

The API reads its configuration from the environment and **refuses to start** on invalid
input rather than falling back to a default — an operator mistake must not be discovered
at the point of sale (Master Plan §22.3).

```bash
npm run build
node services/api/dist/main.js        # honours PORT, LOG_LEVEL, LOG_PRETTY, API_PREFIX

curl -i localhost:3000/healthz        # liveness  — touches no dependency
curl -i localhost:3000/readyz         # readiness — runs registered checks, 503 on failure
```

Both probes are unauthenticated, so neither discloses a version number, a dependency name,
or a connection string. Every other response is an RFC 7807 `application/problem+json`
document with a stable machine-readable `code` (Master Plan §34.3).

### Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push and pull request
(Master Plan §37.2). The `fast-checks` job carries the toolchain pin verification, the
secret scan, the markdown checks, format, lint, typecheck, Flutter analyze and tests, the
mechanical §6/§2.2/§31.1 gates, the offline-path guards (stages 23–24), and migration
immutability (G-6). Parallel jobs behind it run the backend unit suite, integration and
database acceptance against a real PostgreSQL 18 service, the composite build and the
byte-level contract drift gate — regenerating the committed OpenAPI document and generated
client types from the backend and failing on any byte difference, then publishing the
OpenAPI contract as a build artifact (stage 16) — the dependency audit, and the Flutter
release builds for Windows and Android.
Stages 19–22 arrive with M1b, when the artifacts they test exist (§40.5).

Every job name is a required status check on `main`, alongside code-owner review
([`.github/CODEOWNERS`](.github/CODEOWNERS)), `enforce_admins`, and refused force pushes
and deletions (§37.3 G-1…G-4). A deliberately failing check therefore blocks the PR it is
attached to: the check is the gate, not the ceremony. The same gates run locally with
`npm run gates`.

## Governance

| Document                                                                                                         | Purpose                                                                          |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [`docs/governance/MY_SHOP_MASTER_PLAN.md`](docs/governance/MY_SHOP_MASTER_PLAN.md)                               | The authority. 43 sections, roadmap in §40, acceptance gates in §43              |
| [`docs/adr/README.md`](docs/adr/README.md)                                                                       | Architecture decision records                                                    |
| `docs/governance/MY_SHOP_*_SLICE_RECORD.md`                                                                      | One record per slice: scope, non-scope, allow-list, tests, acceptance, rollback  |
| [`docs/governance/MY_SHOP_M0_P1_FOUNDATION_DISCOVERY.md`](docs/governance/MY_SHOP_M0_P1_FOUNDATION_DISCOVERY.md) | Read-only legacy analysis. Evidence and reference, **not** a source to copy from |

Each slice is separately authorized (§40.1). A slice declares its `predecessor`, `scope`,
`non_scope`, `allowed_paths`, `tests`, `acceptance_criteria`, `migration_impact`,
`security_impact`, `rollback`, and `publication_gate` **before** any file is touched.

## Legacy code

Master Plan §5.1: **no file, directory, module, or git history is copied** from the legacy
application. Concepts may be re-derived where the implementation is sound and portable;
where tenancy, accounting integrity, or maintainability would suffer, reimplementation is
mandatory. Each reimplemented concept cites a discovery finding. The legacy sync subsystem
is **REIMPLEMENTED in full** (ADR-039) — it was built and shipped with its drain disabled,
paying the full complexity cost and never using it.
