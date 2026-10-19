# MY SHOP M2-S7 - Slice Record (declaration)

Status: **declared, implemented, evidence recorded.** The declaration below was committed
before any substantial implementation change (§43.1 G-1/G-2 discipline); the evidence
section at the end was filled when the slice's gauntlet was complete.

## 1. Objective

Deliver the client's authentication flow to the Master Plan, §40.6 row M2-S7:
**Flutter auth flow, session store, secure token storage, grace-window UX on
start**. Non-scope: business screens. Governing key acceptance: **a token is
never written outside the platform secure storage** (§13.6, §6.10).

This slice also absorbs the deferrals its predecessors recorded against it:

- M2-S5: "Flutter device enrollment, keystore handling, grace-window UX -
  M2-S7."
- M1b-S8: "The concrete asymmetric signature verifier ... M2-S3's signed
  snapshot issuance" - M2-S3 minted the RS256 authorization snapshot
  (`POST /organizations/:organizationId/authorization/snapshot`); the client
  verifier of that signed material has no home yet and lands here.
- M1b-S8: the offline-grace store and admission policy exist but nothing
  produces a signed grace record on a real device. This slice wires the
  producing path from already-existing server endpoints.

## 2. Predecessor and base

| Item | Value |
| --- | --- |
| Predecessor slice | M2-S6 durable audit streams |
| Predecessor branch | `codex/my-shop-m2-s6-audit-streams` |
| Predecessor HEAD (verified: local == origin) | `3d1ce8fd36fb224ecd4bda0a43266541b8e15ec4` |
| Predecessor PR | #22 (OPEN, base `codex/my-shop-m2-s5-device-binding`, head `3d1ce8f…`) |
| This slice's branch | `codex/my-shop-m2-s7-flutter-auth-session` (created from the verified M2-S6 head) |
| This PR's base | `codex/my-shop-m2-s6-audit-streams` (stacked; never merged by this slice) |

## 3. Architecture assessment (state at declaration)

The client (`apps/desktop`) has, from earlier slices: the M1-S5 app skeleton
(router, Riverpod, `core/ui`, Arabic-first ARB localization, RTL goldens), the
M1b offline platform (Drift `app_database`, durable outbox, push scheduler,
connectivity monitor, remote-apply door, offline-grace service/store/verifier
port), and the router guard contract with a `notProvisioned` session value.

It does **not** have: an HTTP client of any kind, an auth module, token or
keystore storage, a sign-in screen, an organization-selection screen, or any
device enrollment. `main.dart` is a bare `runApp(ProviderScope(MyShopApp()))`
and `navigationSessionProvider` returns `notProvisioned` by design.

The server exposes everything this slice needs, and not one line of it changes
here:

- `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`, `POST
  /api/v1/auth/logout`, `GET /api/v1/auth/me` (M2-S2).
- `POST /api/v1/organizations/:organizationId/devices` (idempotent
  registration, keystore digest proof), `POST .../devices/:deviceId/bind-session`
  (binding + re-minted token carrying `did`), `POST
  .../devices/:deviceId/list/revoke` aside - M2-S5 contract as shipped.
- `POST /api/v1/organizations/:organizationId/authorization/snapshot` - the
  signed RS256 authorization snapshot (M2-S3), the §38.16.3 signed material.

Key precedents honored: §9.3 (tenant identity derived from verified
credentials, never asserted by the client), §38.16.2 (grace established only
from real server session; org comes from the device binding), §38.16.3 (the
signed snapshot is validated locally before use), §13.6/§6.10 (tokens live
only in the platform keystore, fail-closed), M1b-S8 D-2 (the signature
verifier has no accepting default), §38.17 (owner-exclusive permission can
never live in a non-owner snapshot).

## 4. Included scope

1. **`core/api`** - the client's transport: a typed HTTP client (timeouts,
   `Bearer` header injection, problem+json RFC 7807 error mapping to a closed
   failure vocabulary), and hand-written wire DTOs that mirror the generated
   OpenAPI contract for the auth, device, and snapshot surfaces (the contract
   itself does not change; drift is a TS-side gate and stays byte-stable).
2. **`core/auth`** - the authentication domain:
   - `SecureTokenStore`: the platform-keystore token store. Every persisted
     token byte goes through it (governing acceptance); read/write failures
     fail closed (the session reports unauthenticated; nothing ever falls
     back to a plaintext or database store).
   - A keystore-backed device **installation identity** (UUID
     `installation_id` + high-entropy `installation_secret`), generated once
     per install, held only in the keystore, presented only as the digest
     proof the device contract requires (§12.3, M2-S5 D-C/D-D).
   - `SessionStore` / session value: immutable boot-time snapshot feeding
     `navigationSessionProvider`, replacing `notProvisioned`.
   - Auth service: login, refresh (rotation + a single stale-retry),
     logout (server revocation **and** local clearing), identity fetch.
   - Enrollment orchestrator: on a fresh authenticated session, register the
     installation idempotently, bind the session (receiving the re-minted
     bound token), record the server-issued device binding in the existing
     outbox-owned `local_meta` keys, and mint + store the signed
     authorization snapshot.
   - `RsaAuthorizationSnapshotVerifier`: the concrete
     `GraceSignatureVerifier` implementing the M1b-S8 port. It pins RS256,
     issuer and audience, re-checks expiry, upholds the owner-exclusivity
     structural rule, and maps the verified claims onto the offline grace
     record. **No accepting default**: without deployed key material it
     refuses every record (test ties this down). The delivered grace-record
     establishment leaves the `deviceId` field carrying exactly the
     server-issued bound device id (never client-invented) and relies on the
     store's existing establish-time and every-admission binding checks, so
     the signature covers the authorization facts (§38.17) while install
     locality is enforced by server-issued identity + the M1b-S8 binding
     rules; the residual is stated, not hidden (point 11).
3. **Offline integration** - a small `binding_store.dart` inside the
   sanctioned outbox module, owning the existing `organization_id` /
   `device_id` `local_meta` keys (OutboxRepository reads through it; no new
   private key spelling, no stage-24 exemption beyond the module's own).
4. **Router and screens** - `/sign-in` and `/organization-setup` registered;
   a real session-driven `navigationSessionProvider` (boot reads the keystore
   before the first frame; `notProvisioned` only for that instant); sign-in
   and organization-selection screens in `features/auth/presentation/` using
   `core/ui` only. The organization choices are **exactly** the ids the
   verified `/auth/me` returns (§9.3: derived, never asserted).
5. **Grace-window UX on start** (M2-S7 row: "grace-window UX on start") - the
   shell's dedicated status region surfaces the §38.31 "one calm line":
   offline-grace state, expiry consequence (read-only for mutations, reads
   continue, committed work still syncs - §38.16.2), never a sync-engine
   retrofit. The startup grace read runs through `OfflineGraceService` -
   the admission policy is not re-implemented.
6. **ARB catalogs + regenerated localizations** for all new user-visible
   copy, Arabic first (ar default, en fallback).
7. **Tests** - unit (secure token store, verifier rejection matrix, session
   transitions, stale-token retry, enrollment binding), widget (sign-in,
   organization setup, shell grace line), and router redirect integration
   over the real `NavigationSession` states.
8. **Documentation** - README auth section, `docs/adr/ADR-006-client-auth-and-key-distribution.md`,
   this record's evidence.

## 5. Explicit non-scope

- Business screens (M2-S7 non-scope; the shell's empty state stays).
- Any backend, schema, migration, or contract change. All consumed endpoints
  exist; the OpenAPI document is untouched and `contracts:check` must remain
  byte-stable.
- App lock (M9), device owner-approval flow (M2-S5 exclusion), device listing
  UI (owner console, later), sync transport (deferred by plan, T-O6), pull
  path, conflict UI (M8b).
- `offline_grace_duration` as a synced organization setting (M3-S1); a fresh
  offline device without a minted record still cannot mutate - honesty, not a
  regression (§38.18 "Safe fallback").
- A server endpoint that mints a grace record at login: not in this slice's
  row, and inventing one would change the backend contract a client-only
  slice must not change. The snapshot mint of M2-S3 (the §38.16.3 signed
  snapshot) plus the bound-session fact is what the client establishes its
  offline session from; §38.16.3's device-id-in-signature refinement is
  recorded as a documented decision with its residual (point 11).
- Merge (G-12: owner authorization), deployment, CI workflow changes,
  changes to PR #21/#22 or earlier branches.

## 6. Proposed paths

New: `apps/desktop/lib/core/api/**`, `apps/desktop/lib/core/auth/**`,
`apps/desktop/lib/features/auth/**` (two screens + controllers),
`apps/desktop/lib/core/offline/outbox/binding_store.dart`,
`docs/adr/ADR-006-*`, new test files under `apps/desktop/test/`.

Modified (reasons on file in each commit):

- `apps/desktop/pubspec.yaml` - new dependencies: `http` (transport),
  `flutter_secure_storage` (platform keystore, §13.6), `pointycastle` +
  `asn1lib` (RS256 verification of the server JWS with a pinned key; pure
  Dart, platform-neutral). No paid or external service is introduced.
- `apps/desktop/lib/app/router/app_router.dart` (+ generated), route paths -
  session-driven, two new routes.
- `apps/desktop/lib/app/my_shop_app.dart`, `lib/main.dart` - composition
  root wiring of the boot-time session read and module construction.
- `apps/desktop/lib/app/router/shell_screen.dart` - the calm status line.
- `apps/desktop/lib/core/offline/outbox/outbox_repository.dart` - delegates
  binding reads to the new store (same keys, same values). *As implemented,
  this file needed no change at all*: the new `DeviceBindingStore` reuses the
  repository's existing **public** key constants (`organizationIdKey`,
  `deviceIdKey`, in place since M1b-S8 `556abd2`) so the writer and the
  enqueue-path reader cannot drift into two spellings of the same fact — a
  smaller diff than declared, for the same guarantee.
- `apps/desktop/lib/l10n/**` - catalog additions + regenerated localizations.
- `README.md` - the client auth surface.

## 7. Acceptance criteria (to be evidenced at completion)

- **AC-1** Governing acceptance: every token write and read goes to the
  keystore port; a database, file, preferences, or plain-key cross-check finds
  **no** token material outside it, including on failure paths (fail-closed).
- **AC-2** First run with no stored session resolves to `/sign-in`; a stored,
  valid session resolves to the shell (with org) or `/organization-setup`
  (without one); no fabricated authenticated state.
- **AC-3** Login succeeds only through the server's verified response; a
  refused login (bad credentials, throttle, validation) surfaces the mapped
  problem code, never a silent retry or a fabricated session.
- **AC-4** Organization selection offers exactly the verified memberships;
  a multi-org session without selection is sent to `/organization-setup`;
  selection is persisted as server-issued ids only.
- **AC-5** Device enrollment proves the keystore credential; a mismatched or
  failed enrollment leaves no binding row folded into the session, and the
  server's privacy posture is preserved (the secret never appears in a log,
  test output, or error).
- **AC-6** The verifier's rejection matrix refuses: tampered payload,
  foreign key, unpinned/absent algorithm, wrong issuer or audience, expired
  snapshot, a non-owner snapshot carrying an owner-exclusive id, and a record
  whose fields disagree with the signed claims.
- **AC-7** Grace status governs the calm line: in-window + offline presents
  one calm line and mutations stay admissible; expired/tampered/revalidation
  presents the read-only line (reads continue per §38.16.2); no session
  presents the honest neutral line.
- **AC-8** Refresh rotation: a 401 on a protected identity call retries once
  after refresh; a second refusal ends the session (revocation semantics
  honored, nothing loops).
- **AC-9** Logout revokes server-side and clears every local token byte in
  the keystore within the same user-visible action.
- **AC-10** Governance builds: `flutter analyze --fatal-infos` clean;
  `npm run gates` green (stages 1-15, 23-24: the outbox module's binding
  writer uses the sanctioned path); toolchain pin verified.
- **AC-11** Stacked lineage: the PR targets `codex/my-shop-m2-s6-audit-streams`
  at the locked M2-S6 head; no predecessor branch, PR, or migration byte is
  touched; no force-push and no history rewrite.
- **AC-12** Exact-SHA remote CI: all seven jobs green on the final HEAD for
  both push and pull_request events.

## 8. Decision register (to be completed with rationale at the record commit)

- R-A - keystore dependency choice; fail-closed posture.
- R-B - key distribution for the snapshot verifier (pinned deployment key) and
  the no-accepting-default refusal.
- R-C - the grace record's device fact sourced from the bound session, with
  the stated residual (the JWS signature does not bind the device id; §38.16.3
  refinement deferred with a recorded decision).
- R-D - organization selection UI as the §9.3-derivable surface, not a new
  backend route.

## 9. Rollback strategy

The slice is additive on a stacked branch. Rollback = discard the branch and
PR; `main` and predecessor branches untouched. No migration exists to revert.
The new keystore state is device-local; a downgraded client simply stops
reading it.

## 10. Decisions recorded (rationale)

The four register entries of §8 are decided and argued in full in
[`docs/adr/ADR-006-client-auth-and-key-distribution.md`](../adr/ADR-006-client-auth-and-key-distribution.md):

- **R-A → ADR-006 D-A**: `flutter_secure_storage` behind the `Keystore` port;
  one JSON envelope record under the single key `auth.access_token`; fail
  closed on read/write failure; a corrupted record is wiped best-effort and
  then refused; sign-out wipes tokens, identity, and grace locally regardless
  of the server logout outcome.
- **R-B → ADR-006 D-B**: the snapshot public key is a build pin
  (`MY_SHOP_SNAPSHOT_PUBLIC_KEY` dart-define); absent ⇒ no offline grace
  session and an honestly neutral grace line — the no-accepting-default rule
  applied at composition. The server origin (`MY_SHOP_API_BASE_URL`) is a
  required define; composition fails fast naming it.
- **R-C → ADR-006 D-C**: the grace record's device fact is the server-issued
  bound device id joined locally with the signature-verified authorization
  facts; the residual (the JWS does not bind the device id) is stated, not
  hidden, and §38.16.3's device-id-in-signature refinement is deferred here.
- **R-D → ADR-006 D-D**: organization selection offers exactly the verified
  `/auth/me` memberships; no new backend route, no client-asserted tenant id.

## Final evidence (filled at slice completion)

Executed locally on branch `codex/my-shop-m2-s7-flutter-auth-session`
(predecessor base M2-S6 HEAD `3d1ce8fd36fb224ecd4bda0a43266541b8e15ec4`;
commits `4275831` deps → `2633808` auth core → `1c31e02` router+UI →
`1bd01ff` fail-closed fixes → `f77d8fc` auth test suites → `f6aab03` widget
suites → docs, in that order):

- Flutter test suite (`./tool/flutterw test`): **403 passed / 1 skipped /
  0 failed**. The single skip is the plan-deferred `DEFERRED_BY_PLAN` T-O6
  transport test (unchanged from M1b). The suite includes this slice's:
  - SecureTokenStore custody suite (AC-1: every write and read through the
    keystore port; the cross-check finds no token material in any Drift
    table, file, or plain map, including on failure paths; corrupted-record
    wipe + refusal).
  - Verifier rejection matrix (AC-6: tampered payload, foreign key, absent
    algorithm, wrong issuer/audience, expired snapshot, non-owner snapshot
    carrying the owner-exclusive id, fields disagreeing with signed claims,
    malformed SPKI bit string).
  - Auth service flow suites (AC-2/3/4/5/8/9: boot resolution, refused
    logins, memberships-only selection, enrollment binding and its failure
    atomicity, refresh rotation with a single stale retry then session end,
    logout wiping locally regardless of server outcome).
  - Widget suites (AC-3/4/7): the Arabic sign-in surface with its
    rate-limited and withheld refusals, the organization-setup chooser with
    verified-memberships-only and missing-session guards, and the shell grace
    line across absent / active / read-only / unavailable states.
  - Router redirect integration over the real `NavigationSession` states
    (AC-2) and the boot fixture proving `bootPending` resolves through the
    keystore read before the first frame.
- Static analysis (`./tool/flutterw analyze --fatal-infos`): **No issues
  found.**
- Root gates (`npm run gates`): all nine green — secret-scan, markdown,
  import-boundary, vocabulary, localization, design-system, immutability,
  offline guards, migration immutability (12 migration paths in history,
  none rewritten — §37.3 G-6).
- Contract drift: `npm run contracts:check` → **"contracts are in sync"** —
  the OpenAPI document and generated types are byte-identical to M2-S6's; a
  client-only slice changed no contract byte.
- Predecessor files untouched: `grace_signature_verifier.dart` and
  `offline_grace_record.dart` are byte-identical to the M2-S6 head (the
  concrete verifier lives beside them; the port is unchanged).
- Push CI and PR CI: verified on the exact final head SHA after the push;
  the run numbers and SHAs are recorded in the remote-lock block that closes
  this record after the push.

## Remote lock (verified after the push)

| Item | Value |
| --- | --- |
| Verifier CI head SHA | `3e74153001eb36ee5fd9f2fd3406c69c9ba74b1f` |
| Push run (`push` event) | run id `39261090659`, workflow **CI**, conclusion **success**, 7/7 jobs green (fast-checks, backend-unit, backend-integration-database, dependency-audit, contract-drift, flutter-build-windows, flutter-build-android), head = the exact SHA above |
| PR run (`pull_request` event) | run id `39261185530`, workflow **CI**, conclusion **success**, same 7/7 green job set, head = the exact SHA above |
| This slice's PR | **#23** — `https://github.com/sabere342-ai/my-shop/pull/23`, state **OPEN**, head branch `codex/my-shop-m2-s7-flutter-auth-session` at the exact SHA above, base branch `codex/my-shop-m2-s6-audit-streams` (primary: never merged by this slice) |
| Predecessor lock | PR **#22** still OPEN, head `3d1ce8fd36fb224ecd4bda0a43266541b8e15ec4`, base `codex/my-shop-m2-s5-device-binding`, unchanged (verified via `git fetch` + `gh` before and after this slice's push) |

The commit that records this block is docs-only; CI was re-verified green on
it for both events after the push, exactly as the M2-S6 record's closing
commit was (its runs are not re-cited here — the substantive head this slice
attests to is the SHA above).
