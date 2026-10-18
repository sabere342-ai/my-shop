# MY SHOP — M2-S5 slice record — Device Binding: Registration, Installation Identity, Session/Device Binding, Device-Bound Sync

Status: **accepted engineering slice (evidence recorded at close), awaiting owner merge authorization (G-12).**

Predecessor: M2-S4 (`codex/my-shop-m2-s4-tenancy-rls`, locked `4eb8b4b882193164a7a656e793ee9f133e378b5c`, PR #20 `PASS_MY_SHOP_M2_S4_TENANCY_RLS_OFFLINE_INGRESS_REMOTE_LOCKED`).

---

## 1. Objective

Give the offline sync boundary its **genuine identity source**: the device
(Master Plan §12, §12.2, §12.5, §38.16.2, §40.6 row M2-S5). Concretely, without
touching anything M2-S4 proved:

- a **device** is an installation of this organization, registered by a member,
  with a keystore-backed installation handle and a server-stored digest of the
  installation credential;
- an authenticated **session can bind to a device**, and a token minted from a
  bound session carries the signed `did` claim — never client-advanced;
- **revocation kills sessions and sync in one atomic outcome**, and the sync
  boundary re-reads the *live* device row rather than trusting a token;
- the §12.5 sync metadata the server can honestly maintain is stored and
  surfaced; speculative columns are deferred to the slices that own their
  inputs.

Not done here (deliberately): the Flutter keystore side (M2-S7), durable
security-event streams (M2-S6), grace-window enforcement (M2-S7/M3), and any
real business mutation applier (M4/M5).

## 2. Scope

In scope (allowed paths and their defensible relationship):

| Area | Paths | Relationship to the slice |
| --- | --- | --- |
| Slice record | `docs/governance/MY_SHOP_M2_S5_SLICE_RECORD.md` | Governance evidence (§43.1). |
| Migration | `services/api/prisma/migrations/0009_device_binding/` | The only migration path; `0001`–`0008` immutable (§35.1). |
| Schema | `services/api/prisma/schema.prisma` | The `Device` model and `Session.deviceId`, the Prisma half of the same two facts the migration writes. |
| Device module | `services/api/src/common/devices/*` (contract, controller, service, module, installation-credential hashing, sync authenticator) | §12: the three+one device routes, the service behind them, and the production `DeviceBoundSyncAuthenticator`. |
| Identity claims | `services/api/src/common/identity/access-token.ts`, `auth.service.ts`, `auth.contract.ts`, `auth.controller.ts`, `security-event.sink.ts` | The `did` claim (mint, refresh re-derivation, authenticate-time agreement), the `/auth/me` echo, and the `DEVICE_*` security event types. |
| Sync wiring | `services/api/src/common/sync/push/*`, `pull/*` (modules + services) | Bind `SYNC_AUTHENTICATOR` to the device-bound authenticator; record §12.5 sync metadata on the device row after successful pushes/pulls. |
| Contract | `packages/contracts/openapi.json`, `packages/contracts/src/generated/schemas.ts`, device/sync controller descriptions | **Changed by this slice** (unlike M2-S4): four new routes and schema objects; push/pull 401 descriptions state the real boundary. |
| App composition | `services/api/src/app.module.ts` | `DeviceModule.forRoot(config)` registered once. |
| Tests | `src/common/devices/device.service.spec.ts` (unit), `test/devices/devices.e2e-spec.ts` (boundary), `test/database/postgres.db-spec.ts` (new M2-S5 describe block), `test/database/tenant-rls.db-spec.ts` (extended fixtures for the `devices` row) | Unit, HTTP-boundary, and real-PostgreSQL proofs per §36.1 T-2. |
| Documentation | `README.md`, `docs/rls-inventory.md`, `docs/security-architecture.md` | The operator-facing half of the governance duty (§43). |

## 3. Non-scope

- Owner-approval / `PENDING_APPROVAL` device flow — deferred by §12.2 by design.
- Durable `security_events` / `audit_events` streams — **M2-S6** (this slice's
  device events go through the existing `SECURITY_EVENT_SINK` port, which logs).
- Flutter device enrollment, keystore handling, grace-window UX — **M2-S7**.
- Quarantine workflow for a revoked device's queued mutations — the ledger
  already keeps them (M2-S4, §38.30.2); owner review tooling is M3+.
- Business mutation appliers — M4/M5; `FailClosedMutationApplier` stays bound.
- No new dependency; no new environment variable; no role/grant change.

## 4. Engineering assumptions

1. **Binding is an authenticated route, not a login-time step.** A session
   binds through `POST …/devices/:deviceId/bind-session` on a session the
   bearer guard has already verified. Registration is "first successful
   authentication" (§12.1) — the *device*, not the session, is registered there.
   Binding an existing, separately-verified session keeps the login path
   unchanged, lets an already-open session become device-bound without a
   re-login, and immediately answers a re-minted token that carries `did`.
2. **The installation pair is a credential, never authority.** The
   keystore-backed `(organization_id, installation_id)` handle plus the
   installation credential decides *which* row is claimed; every decision is
   re-proven against live server state (status, digest, membership) inside the
   transaction that commits the effect. The server stores only a SHA-256
   digest (§12.3: server-issued identity; §13.6: no reversibly-stored client
   credential).
3. **A session binds at most one device, and binding is not relinkable.**
   `sessions.device_id` is written once by the server; naming a different
   device afterwards is refused. The claim's presence and value are decided by
   the server at mint time from the stored session row — a refresh can carry
   the binding but never introduce or change it.
4. **The sync boundary reads the live row.** The device-bound authenticator
   re-reads the device row inside a trusted tenant transaction scoped by each
   membership the verified principal claims, and derives the tenant from the
   RLS-visible row itself (§5 below). A token's `did` claim proves intent; the
   row's `status` is the fact (§12.5: revocation kills sync).
5. **Devices are tenant-owned data** and receive the identical forced-RLS
   posture M2-S4 established; `sessions.device_id` is a reference protected by
   that posture, not a new tenant column on a global table.

## 5. Architecture and compatibility analysis (pre-implementation)

1. **Registration** (`DeviceService.register`): guard proves principal +
   membership claim agreement → tenant transaction: lookup by
   `(organization_id, installation_id)` → idempotent re-registration digest
   check, or check-then-insert resolved by the unique index (races converge on
   one row; the loser classifies against the stored digest) → `DEVICE_REGISTERED` event.
2. **Listing** (`DeviceService.list`): `devices.view` inside the tenant
   transaction; no credential material is ever selected into a response.
3. **Bind-session** (`DeviceService.bindSession`, then
   `AuthService.mintAccessTokenForSession`): one transaction re-proves the
   device row (RLS-scoped, `ACTIVE`, digest equality) and writes
   `sessions.device_id`; a *second* transaction mints the fresh access token
   from the stored session row (membership resolution per decision D-A). Two
   transactions because token minting is an identity-flow write, not a device
   write; the window between them can only ever make the binding *more* true,
   never false — the intermediate token (without `did`) is simply the
   still-valid pre-binding token.
4. **Revocation** (`DeviceService.revoke`): one transaction sets `REVOKED`
   (shape-checked) and revokes every session whose `device_id` matches (the
   partial index keeps it narrow), preserving existing reasons; idempotent `204`.
5. **Sync identity** (`DeviceBoundSyncAuthenticator.authenticate`): the exact
   REST authentication path (which now enforces claim↔session agreement) → the
   `did` claim must be present → per claimed membership, an RLS-scoped
   `device.findUnique` → a visible `ACTIVE` row *names the tenant*; anything
   else fails closed (`UNAUTHENTICATED`, or `DEVICE_REVOKED` on a non-active
   row).
6. **Sync metadata** (`SyncPushService`/`SyncPullService`): after a successful
   push/pull the device row's §12.5 timestamps and client-reported versions are
   refreshed inside a tenant transaction — the metadata refresh was designed to
   run **inside the same transaction scope** so forced RLS makes a scope-free
   update a visible no-op rather than a silent miss.

## 6. Acceptance criteria

- **AC-01** — Migration `0009` is forward-only and creates exactly the two
  facts: the `devices` table (§12.1 fields + §12.5 server-maintained metadata,
  digest column shape-checked, platform/status/label/revocation CHECKs, unique
  `(organization_id, installation_id)`) and `sessions.device_id` (+ partial
  index, + the one new `revoked_reason` value `DEVICE_REVOKED` via constraint
  replacement — historical migrations stay immutable). Fresh install is
  `0001`–`0009`; the drift gate stays 0.
- **AC-02** — The `devices` table carries `ENABLE` + `FORCE` RLS with the
  identical `tenant_isolation` policy; the table-inventory test counts it as
  the tenth tenant-owned table; a future tenant-owned table without coverage
  still fails the suite.
- **AC-03** — Registration is idempotent per `(organizationId, installationId)`:
  the same pair re-verifies against the stored digest and refreshes metadata;
  a wrong credential is refused without revealing the device's existence or
  state; membership is proven live inside the transaction; any member may
  register, while listing requires `devices.view`.
- **AC-04** — A device of another organization is invisible to every route of
  this one: the 404 carries no cross-tenant signal, RLS makes the row unreadable
  through any code path, and a device-bound token whose session belongs to a
  foreign device never gains access.
- **AC-05** — `bind-session` proves the digest, requires an `ACTIVE` row via
  RLS, writes `sessions.device_id`, and answers a fresh token carrying `did`;
  a session that already binds a device refuses a different one (never silently
  relinked); the response 404s a foreign device id.
- **AC-06** — The token↔session agreement holds in both directions on every
  authenticated call: a device-bound session is refused with a token whose
  `did` is missing or names another device, and a token asserting a device the
  session never bound is refused, not repaired. Refresh re-derives the claim
  from the stored row. `/auth/me` echoes the binding when present.
- **AC-07** — Revocation is one transaction and permanently irreversible:
  `status` flips to `REVOKED` with `revoked_at`, every bound session family is
  revoked (`DEVICE_REVOKED`), refresh dies at that instant, and a re-registration
  of the revoked installation is refused (a re-installation enrolls a *new*
  installation id); answering the same device id again is idempotent `204`.
- **AC-08** — The sync boundary admits only a bound session over an active
  device: no `did` → `UNAUTHENTICATED`; `did` naming a device no claimed
  membership can see → `UNAUTHENTICATED`; visible-but-revoked → `DEVICE_REVOKED`
  — and this is proven by flipping the **live row's** status, not only the
  token's claim. The tenant of the accepted call is derived from the RLS-visible
  device row.
- **AC-09** — §12.5 sync metadata is maintained: a successful push/pull
  refreshes `last_push_at`/`last_pull_at`/`last_sync_at` and the client-reported
  `client_schema_version`/`client_app_version` on the device row, inside a
  tenant transaction (a scope-free update under forced RLS would be a no-op —
  the service must not have that bug class); the owner-visible list surfaces the
  metadata and never the credential material.
- **AC-10** — Redaction (§13.6): the installation credential appears in no
  response, log line, or contract document; the wire field keeps its accepted
  name, the stored form is only the digest, and the repository's redaction gate
  stays green.
- **AC-11** — Device lifecycle records security events: `DEVICE_REGISTERED`,
  `DEVICE_REGISTRATION_REFUSED`, `DEVICE_REVOKED` through the existing sink,
  carrying only server-resolved ids (never an installation handle or client
  assertion).
- **AC-12** — Contract: the OpenAPI document is regenerated exactly once and
  checked in sync — four routes and their schemas added, `MeResponse.deviceId`
  added, push/pull 401 descriptions updated to the real boundary; no other
  contract surface changed.
- **AC-13** — Predecessor suites pass with their contracts intact: the tenancy,
  identity, and sync acceptances behave as M2-S4 proved them (the only intended
  behavioural change — a push/pull now requires a device binding — is asserted
  by the new sync-boundary cases); orchestration-wide gates (lint, format,
  typecheck, secret scan, migration immutability) stay green.

## 7. Threat model

| # | Threat | Disposition in this slice |
| --- | --- | --- |
| 1 | Cross-tenant device enumeration through register/list/bind/revoke | Forced RLS + route-vs-claim membership agreement; a foreign device 404s with no signal (AC-04); direct suite asserts invisibility for every route. |
| 2 | Member adopting another member's device identity (registration without the credential) | The digest is checked **inside the committing transaction** in both the idempotent and race paths; the pair without the correct credential is refused without revealing state (AC-03). |
| 3 | Binding by possession of only the installation handle | The credential proves the installation at bind time exactly as at registration; the handle alone names nothing. |
| 4 | Client asserting a `did` claim or mutating the binding | The claim rides a signature the server created; refresh re-derives it from the stored row; authenticate refuses claim/session disagreement in both directions (AC-06). |
| 5 | Device-bound sync after revocation (grace-abuse vector, §38.16.4) | The boundary re-reads the **live row** inside a tenant transaction on every push/pull; the claim is not authority (AC-08, the status-flip case). Sessions die in the same commit, so refresh is already dead. |
| 6 | Session/device binding adopted by replaying an old token | Pre-binding tokens remain valid for non-sync routes within their TTL (§10.3 unchanged), but sync requires the re-minted token; revocation kills both paths at once. |
| 7 | Digest exposure or credential logging | Only the SHA-256 hex digest is stored (shape-checked); no response, log line, or contract document carries the credential (AC-10); refusal logs name the code, not the attributed material. |
| 8 | Uniqueness as an oracle (global unique leaking tenant existence) | The unique index is scoped by organization exactly as §9.2 T-7 requires; the migration comment restates the legacy `DO_NOT_COPY` defect it avoids. |
| 9 | A revoked installation re-registered to resurrect its history | Refused explicitly (§12.2 closed vocabulary + service rule); new installation = new id; old row stays revoked with its quarantined history (AC-07). |
| 10 | Bypass-writer storing a foreign shape | CHECK constraints restate every service invariant (platform, status, revocation shape, digest shape, label grammar, installation-handle shape) as the `0003`–`0008` discipline. |
| 11 | Race between two concurrent registrations | The unique `(organization_id, installation_id)` index is the arbiter; the loser re-classifies against the stored digest; application checks never stand alone (§8.3). |
| 12 | Sync metadata refresh silently vanishing under RLS | The refresh runs inside the tenant transaction; a scope-free variant would be an invisible no-op under `FORCE` — the bug class is documented and the suite updates the row through the real service path. |
| 13 | Ahead-of-time binding physics: two transactions on the bind path | The mint re-resolves state from the stored row, so the fresh token cannot assert a state the session does not hold; the intermediate window cannot invalidate the binding, only delay it. |

## 8. Database impact

One forward-only migration, `0009_device_binding`, creating the `devices` table
(server-issued `id` defaulting to `gen_random_uuid()`, organization FK with
`ON DELETE RESTRICT`, an org-scoped unique installation index, an org+status
index, the digest column shape-checked) and `sessions.device_id` (FK with
`RESTRICT`, partial index). The `sessions` revocation-shape CHECK is *replaced
by a new migration file's statements*, never edited in place, so the history
stays immutable and `0009` carries the one new `revoked_reason` value.
Additionally: `ENABLE` + `FORCE` RLS + the identical `tenant_isolation` policy
on `devices`. No role change, no grant change (the application role inherits its
default privileges exactly like every earlier table), no data transformation, no
rollback of anything committed.

## 9. Documented engineering decisions (§2 authority mapping)

- **D-C — bind-session as an authenticated route (§12.4, §40.6).** The plan
  fixes states and effects, not the binding ceremony; the smallest compliant
  reading binds an existing *verified* session through an authenticated route
  and re-mints immediately, so the client's next request carries `did` without
  guessing when the binding took effect. Login stays byte-for-byte what M2-S2
  shipped; the binding can never weaken login-time verification.
- **D-D — identity is layered and no layer is sufficient alone.** `devices.id`
  (server-issued; the value `did` carries and every authorized decision reads)
  + the org-scoped installation handle (the keystore address) + the digest (the
  proof-of-possession credential). Re-registration is a lookup keyed by the
  handle and re-proven by the digest; possession of the handle alone is
  worthless (T-7, §12.3).
- **D-E — sync tenant scope is derived from the row, not the token.** The
  authenticator scans the device id under each claimed membership's trusted
  context; the row it can see *is* the tenant, and a membership set that cannot
  see it sees nothing — indistinguishable from nonexistence (§9.2). The
  distinctive device id bounds the scan to at most one row per membership.
- **D-F — provider wiring by factory for services over `PrismaHost`.** Class
  metadata cannot express the interface-typed ports (`SecurityEventSink`) this
  codebase's identity layer uses; like `MutationLedgerService`, the device
  service and the sync authenticator are wired by factory providers so silent
  `undefined` injection is structurally impossible rather than caught by a boot
  check. Recorded because it is a wiring constraint every future module must
  follow, not a device-specific quirk.
- **D-G — the credential hashing uses the identity layer's existing primitives
  pattern** (constant-time comparison over the SHA-256 hex digest; the digest,
  not the credential, is the stored fact). No new dependency, no new hash
  machinery: the §12.3 requirement is proof-of-possession of a high-entropy
  client-held value, not a password-memory problem, so Argon2id's memory
  hardness would buy nothing here.

## 10. Rollback strategy

Forward-only (§35.1): if deployment reveals a defect, a **new** migration after
`0009` re-issues the correct shape. A deliberate drop of the `devices` table or
of the sync binding would remove the production sync boundary's identity source
and is an emergency isolation-reduction decision requiring owner authorization
— never the automatic path. The fail-closed fallback to
`FailClosedSyncAuthenticator` remains a test-binding change, not a code path
production can fall into silently. `main` is untouched.

## 11. CI and evidence

The existing seven-job workflow (`.github/workflows/ci.yml`) is unchanged and
must pass on the exact implementation SHA for both `push` and `pull_request`.
Final recorded evidence (SHAs, run IDs, job conclusions) is appended to §13 by
close.

## 12. Changed paths and rationale

Every path this slice touches, with its defensible relationship to the declared
scope (the scope table above is the authorization; this is the accounting):

| Path | Change | Rationale |
| --- | --- | --- |
| `services/api/prisma/migrations/0009_device_binding/migration.sql` | **New.** `devices` table + org-scoped unique index + FK; `sessions.device_id` + partial index + constraint replacement (adds `DEVICE_REVOKED`); CHECKs restating service invariants; forced RLS + `tenant_isolation` on `devices` | The slice's only migration path; `0001`–`0008` untouched (§35.1). |
| `services/api/prisma/schema.prisma` | `Device` model and `Session.deviceId?` added | The Prisma half of the same two facts; the drift gate must stay 0 — the index name is the Prisma-derived one. |
| `services/api/src/common/devices/device.contract.ts` | **New.** Route-level contract classes (`RegisterDeviceRequest`, `BindSessionRequest`, `BindSessionResponse`, `DeviceResponse`), path constants, platform/status vocabularies | The shapes the generated OpenAPI and the runtime responses cannot drift from (§7.1, ADR-001). |
| `services/api/src/common/devices/device.controller.ts` | **New.** The four routes under `/api/v1/organizations/:organizationId/devices[...]`, guarded by the composite authorization guard | §12's route surface; tenant scope via the guard-checked route parameter, never a body field. |
| `services/api/src/common/devices/device.service.ts` | **New.** Register (idempotent, digest-classified, tx-scoped), list, bind-session (with `mintAccessTokenForSession`), revoke (one atomic outcome), metadata refresh | Everything the routes decide, inside trusted tenant transactions (§5). |
| `services/api/src/common/devices/device-secret.ts` | **New.** SHA-256 digest hashing and constant-time digest comparison | Proof-of-possession of a high-entropy client-held credential (§12.3, §13.6); no reversible storage. |
| `services/api/src/common/devices/device-sync-authenticator.ts` | **New.** `DeviceBoundSyncAuthenticator`: bearer credential → `did` presence → live RLS-scoped row → derived tenant context | The genuine production binding of the `SYNC_AUTHENTICATOR` port (D-E). |
| `services/api/src/common/devices/device.module.ts` | **New.** `DeviceModule.forRoot`, factory-provided service and authenticator, exports `DEVICE_SYNC_AUTHENTICATOR` | The module composition, including the D-F wiring constraint. |
| `services/api/src/common/devices/device.service.spec.ts` | **New.** Unit suite over the service with doubles for the host, sink, and logger | The register/classify/bind/revoke decisions without a database. |
| `services/api/src/app.module.ts` | `DeviceModule.forRoot(config)` registered; comment updated | The composition root, once. |
| `services/api/src/common/identity/access-token.ts` | Optional `did` claim: minted only for bound sessions; present-but-malformed claim refused; typed payload | AC-06's signed copy (§4.3). |
| `services/api/src/common/identity/auth.service.ts` | Authenticate enforces claim↔session agreement in both directions; refresh re-derives the claim from the stored row; new `mintAccessTokenForSession` | The server-side facts every binding decision re-reads; D-A membership resolution reused, not duplicated. |
| `services/api/src/common/identity/auth.contract.ts`, `auth.controller.ts` | `MeResponse.deviceId` echoed when bound | The client's binding-visibility contract (AC-12). |
| `services/api/src/common/identity/security-event.sink.ts` | `DEVICE_REGISTERED`, `DEVICE_REGISTRATION_REFUSED`, `DEVICE_REVOKED` types; `deviceId`/`organizationId` on events (server-resolved ids only) | §12.4's "every revocation writes a security event"; durable streams remain M2-S6. |
| `services/api/src/common/sync/push/sync-push.module.ts` (+ service) | `SYNC_AUTHENTICATOR` bound via `useExisting` to `DEVICE_SYNC_AUTHENTICATOR`; `DeviceService` injected and wired by factory; §12.5 push metadata refreshed after a successful batch | The device-bound ingress boundary. |
| `services/api/src/common/sync/pull/sync-pull.module.ts` (+ service) | Same authenticator binding; §12.5 pull metadata refreshed after a successful page | The egress mirror of the same boundary. |
| `services/api/prisma/schema.prisma` comment sections, `packages/contracts/openapi.json`, `packages/contracts/src/generated/schemas.ts` | Regenerated from the composed app | AC-12; `contracts:check` stays authoritative. |
| `services/api/test/devices/devices.e2e-spec.ts` | **New.** HTTP boundary suite: missing header 401, garbage token 401, wrong-scheme, guard-before-validation ordering, 503 without identity key material | The route/guard red lines a db-free suite can prove. |
| `services/api/test/database/postgres.db-spec.ts` | **New M2-S5 describe block** (10 cases: registration + redaction, idempotent re-registration, wrong credential, member/list permission boundary, bind/did/refresh-carry, re-bind refusal, foreign-device 404, one-session-one-device, unbound/mismatched/accepted sync with §12.5 metadata, live-row status flip + restore, §40.6 key acceptance incl. refresh death + re-registration refusal + idempotent 204) | §36.1 T-2: these must be database facts on real PostgreSQL, never mock-substituted. |
| `services/api/test/database/tenant-rls.db-spec.ts` | AC-03 fixture gains the tenant-A `devices` row; stale comments renumbered | The RLS proofs must also cover the tenth tenant table. |
| `README.md`, `docs/rls-inventory.md`, `docs/security-architecture.md` | Device sections, inventory updated to `0001`–`0009`, honest-boundary rewrite | §43's operator-facing duty. |

Deliberately untouched: `test/sync/test-*` fixtures (their labels remain
accurate: overrides for tests), `prisma/roles.sql`, `migrations 0001`–`0008`,
the `FailClosedMutationApplier`, the ingress revalidator, and the Flutter
client.

## 13. Commit ledger, local verification, and remote lock

| Commit | Type | Subject |
| ------ | ---- | ------- |
| `4eb8b4b` | locked base | M2-S4 record commit (PR #20 head, `PASS_MY_SHOP_M2_S4_TENANCY_RLS_OFFLINE_INGRESS_REMOTE_LOCKED`) |
| `c19f651` | `docs(m2-s5)` | declare the device-binding slice and its acceptance criteria |
| `373dcea` | `feat(m2-s5)` | devices: registration, binding, revocation, and the device-bound sync boundary |
| `0f7cb97` | `test(m2-s5)` | proof: device unit, route boundary, and database acceptance suites |
| `d1671b0` | `docs(m2-s5)` | document the device surface, the extended RLS inventory, and the device-bound posture |
| _record commit_ | `docs(m2-s5)` | record the changed paths, execution evidence, and the remote lock |

**Base:** `4eb8b4b882193164a7a656e793ee9f133e378b5c` (locked M2-S4 head, PR #20
open). **Implementation head:** `373dcea32280239596d05ce0d325e6426d07d0ee`.
**Record head:** the commit that carries this section (documentation only).
GitHub allocated the pull request number **#21**
(`https://github.com/sabere342-ai/my-shop/pull/21`), targeting the predecessor
branch; nothing is merged, no auto-merge is enabled, and no force push was used.

### Local verification (final tree, before push)

| Gate | Result |
| --- | --- |
| `test:unit` | **432 passed / 432**, 37 suites |
| `test:integration` (HTTP, full app) | **55 passed / 55**, 6 suites |
| `test:database` (real PostgreSQL 18, serial) | **119 passed / 119**, 2 suites — both db acceptance suites, re-run on the final tree |
| `typecheck` (application + test config) | clean, both `tsc` configs |
| `contracts:check` | `contracts are in sync` (regenerated once this slice) |
| `lint`, `format:check` | clean across workspaces |
| mechanical gates (stages 1–24), secret scan, migration immutability (G-6) | OK — gate prints 10 migration path(s) (nine migration files plus the lock file), none rewritten |

### Remote CI on the exact record head

Appended below after publication (§11).

## 14. Boundary and verdict

The next units the master plan defines after M2-S5 are **M2-S6** (durable
`audit_events`/`security_events` streams, including the offline/sync events of
§32.2A) and **M2-S7** (Flutter authentication, session store, secure token
storage). Neither is authorized by this record and neither is started here. M3
settings (including `offline_grace_duration`) and the M4/M5 business surface
that gives the admitted mutations real effects remain later concerns.

On the acceptance gates: the slice's own AC-01…AC-13 are all proven locally and
by the remote database job; **G-12 is NOT SATISFIED** — the pull request is
left open and no merge was performed. The merge is the owner's decision, not
this slice's.

```
NO MERGE PERFORMED — OWNER MERGE AUTHORIZATION REQUIRED
PASS_MY_SHOP_M2_S5_DEVICE_BINDING_REMOTE_LOCKED
```
