# MY SHOP M3-S4 - Slice Record (declaration + execution record)

Status: **executed** (§43.1 G-1/G-2: declared before any feature file touch at
the commit recorded in §1.2 below; the evidence section was filled when the
slice's gauntlet completed).

## 1. Objective

Deliver the Master Plan §40.7 row M3-S4: **Flutter settings screens, pricing
and discount administration, and offline settings cache display — a
permission-aware, responsive Windows/Android settings experience connected to
the real backend.**

Governing key acceptance (§40.7): **settings drive real behaviour online;
the cache is versioned offline.**

### 1.1 Authoritative requirements

| Source | What it fixes for this slice |
| --- | --- |
| §22.1–§22.4 | Typed settings, not key-value: each setting's type, default, governing permission, and audit status are fixed; per-device `app_lock_enabled` is device-owned (M9) and per-organization `feature_flags` are owner-exclusive typed rows (the V1 catalog is empty — no administration surface may be invented). |
| §22.3/§38.18 | Settings are **server-owned and read-only on the client**. A cached snapshot carries `settings_version`, is superseded only by a newer version, never edits upward, never fabricates a save, and a device with no cached settings at all shows the honest empty state. |
| §17.1–§17.4 | The three pricing modes (`FIXED`, `VARIABLE`, `FIXED_WITH_DISCOUNT`) render with understandable explanations; the server is the enforcement point, so a settings change takes effect on the server's next authoritative decision (proven by the existing M3-S2/S3 suites, which read this very row). |
| §18.1–§18.4, §30 | The five typed discount-policy fields — `max_discount_percentage` (0–100, ≤2dp), `max_discount_amount_minor` (64-bit minor units, decimal-string wire), `discount_approval_threshold_minor` (nullable), `discount_allowed_for_salesperson`, `block_discount_below_cost` — are administered against the accepted M3-S3 contract (`PRICING_POLICY_CONTRACT_VERSION = 2`); no competing arithmetic enters the client; presentation estimates never override server answers. |
| §11.1–§11.4 | Client gating reads the **effective** permission set (role + overrides + owner structure, deny over allow) from `GET authorization/me`, never a role name; owner-exclusive fields are disabled for non-owners with a caption; the server's authorization remains the only authority (UI gating is affordance, never enforcement). |
| §9.3/§13.7 | Tenant scope comes from the verified session, never a request body; the offline cache is keyed by organization and is displayed only for a matching signed-in session; no token or session material enters any payload or log. |
| §6.4–§6.11 | Riverpod `AsyncValue` state (no `bool isLoading`), feature-first layering, `go_router`-registered routes behind the existing redirect guard, ARB catalogs with zero hardcoded user strings, design-token-only visuals, logical (bidi-safe) layout. |
| §38.12.1 | A remote data write on the client never creates an outgoing mutation; the settings cache is written only from server GET responses, never enqueued, never deleting outbox rows. |
| §35.5 | Local Drift schema migrations from v3→v4 are forward-only and additive, tested with data preserved. |
| §40.7 | M3-S4 scope: Flutter settings screens, pricing and discount administration, offline settings cache display. Non-scope: none declared for the row. |
| §43.1 G-13 | The slice touches the offline path: the applicable T-O tests (T-O7 analogue for cache writes) and the §13.7 walk are recorded. |

### 1.2 Branch ancestry (emphasised)

- Branch `codex/my-shop-m3-s4-flutter-settings` was created **from the exact
  accepted M3-S3 SHA `1b674f950e627b7b3178bd752db3da16fc518ef0`** in a linked
  worktree `C:\dev\my-shop-m3-s4`; no accepted history is rewritten.
- This slice's PR targets `codex/my-shop-m3-s3-discount-policy` (stacked).
  Predecessor PR #27 (M3-S3, OPEN, MERGEABLE at `1b674f9`) is untouched; no
  merge of any predecessor or of this PR is performed by this slice.

## 2. Architecture assessment (state at declaration)

The backend is complete for this slice out of the accepted M3-S1/S2/S3
surfaces: `GET/PUT api/v1/organizations/:organizationId/settings` (field-level
permission gates inside the write transaction, owner exclusivity, the §38.18
`settingsVersion` body token with `409 SETTINGS_VERSION_CONFLICT`, class-A
audit), `GET …/authorization/me` (effective permissions + `isOwner`), the
transactional pricing boundary reading the live settings row (stamping every
decision with the `settings_version` it enforced), and the forced-RLS tenant
posture. **No backend route or schema change is needed to make M3-S4
functional**, so the OpenAPI contract and every migration journal remain
untouched; the contract-drift gate must pass without regeneration noise.

The client has the accepted M1b/M2 infrastructure: the single HTTP door
(`ApiClient`, honest transport-vs-server-decision failure taxonomy), the
platform-keystore session, the Drift outbox machinery with its single
remote-apply door, the offline-grace service, the semantic design system and
its twelve components, and ARB localization. What does not exist yet:

1. any settings feature (screens, models, repository, controllers);
2. a `SettingsApi` or an `AuthorizationApi` wire surface;
3. effective-permission plumbing the settings UI can read;
4. any settings snapshot cache (the local schema is at v3 and has no
   settings table);
5. the client-side `SETTINGS_VERSION_CONFLICT` (409) mapping in the failure
   vocabulary — an additive client defect to repair in this slice (the
   backend registry and wire contract are unchanged).

## 3. Included scope

1. **The typed settings model** (`features/settings/models/`): strict
   parsing of the canonical `OrganizationSettingsResponse` — every §22.2/§22.4
   field typed exactly as the wire declares, 64-bit money as decimal strings,
   the percentage as a bounded ≤2dp value, closed enums mirrored from the
   server vocabulary, invalid or corporately unknown shapes refused. The
   server's returned values are the only values the UI ever displays as live
   truth.
2. **The settings + authorization wire surfaces** (`core/api/`):
   `settings_api.dart` (GET/PUT settings) and `authorization_api.dart`
   (GET `authorization/me`) over the existing `ApiClient`; the additive
   `SETTINGS_VERSION_CONFLICT` client mapping.
3. **Effective-permission plumbing**: a feature-level provider reading
   `authorization/me` for the signed-in organization session, exposing the
   permission set and `isOwner`; per-field affordance derived from the
   server-published §22.2 gate column (client mirror used for presentation
   only — the server re-checks everything).
4. **The screens** (§5–§6 of the mission): a settings hub, the general
   settings editor (identity, currency & display numerals, invoice defaults,
   footer & logo visibility, customer-required-on-credit, receivables aging,
   the offline receipt presentation fields), and the pricing & discount
   editor (mode with per-mode explanation, the five discount policy fields,
   nullable-threshold handling, conditional emphasis per mode). Owner-only
   fields are always visible but disabled for non-owners with a caption.
   Responsive two-column layout on wide Windows surfaces, single column on
   narrow; loading/empty/error/denied states; unsaved-changes indication;
   confirmation for material policy changes; keyboard, mouse, touch, and
   semantic accessibility; retry without duplicate operations; every visible
   string from the ARB catalogs.
5. **The versioned offline settings cache** (§38.18; local Drift schema v4,
   additive): a per-organization snapshot store holding the authoritative GET
   response, its `settings_version`, `fetchedAt`, and `fetchedByUserId`. Newer
   versions only replace older ones (a stale response never overwrites a newer
   cache); corrupted or structurally invalid payloads are refused (cached >
   gone); cross-tenant display is structurally impossible (org-keyed reads,
   session-organization gating); nothing is enqueued to the outbox;
   a network loss after caching displays the cached settings with the actual
   version and last-sync time; server mutations are disabled while the live
   fetch/save path is unreachable; a transport failure is never presented as
   save-success; a save that lost its response conserves the draft and
   reconciles through a fresh authoritative read.
6. **Repository + controllers**: the live-vs-cached distinction as one
   closed outcome type; version-conflict handling preserving the draft and
   offering reload/reconcile; authorization-failure vs network-withholding
   distinction end to end; cache refresh on reconnect with a newer server
   version accepted; **no upward synchronization path exists in the code**.
7. **A declared, narrow `gate:offline` stage-24 exemption** for the settings
   snapshot store (exactly one named file), reasons recorded in the guard:
   the store writes server-authorized GET replicas keyed by a monotonic
   settings_version, never enqueues, and discards version regressions — the
   M1b-S8 grace-store precedent, not a widening of the single remote-apply
   door (§38.12.1, whose T-O7 proof remains owned by its slice).
8. **Tests** — the acceptance matrix below, at unit, widget, cache-lifecycle
   (the §7 offline scenarios of the mission), migration (v3→v4 additive with
   data preserved, T-O19 style), and a real-backend gated integration suite.
9. **Documentation** — the README surface note and this record's evidence.

## 4. Explicit exclusions (non-scope, each with its governing reference)

- **Offline sales operationalization** (§38.19 device half; M5): no sale is
  written here; the cached policy is displayed and versioned, not consumed by
  a sale pipeline. No M5 offline sales acceptance is claimed.
- **The approval workflow table / approval issuance API** (§18.2 step 5
  storage; M5, recorded in the M3-S3 record §5): unchanged.
- **Device app-lock settings UI** (§14/§22.2 per-device ownership; M9): not
  an organization setting; no control is fabricated for it here.
- **Feature-flag administration** (§22.2): the catalog is `[]` (version 1);
  an empty read-only list is the honest surface, no invented administration.
- **Discount reporting** (§33.2; M8), **invoice output/printing** (§21;
  M9), **remote applied-change business entities** (§38.15; later slice).
- **Backend changes**: none declared. Admin pricing stays a transactional
  service (M3-S2); no new endpoint, no migration, no contract regeneration
  unless a defect discovered during integration forces the smallest governed
  addition.
- **Merging**: no predecessor, and not this PR either (§43.1 G-12).

## 5. Security and regression invariants (inherited, must survive)

Server-derived tenant scope over forced-RLS storage; effective-permission
authorization resolved server-side inside the write transaction (deny over
allow, owner receipt of exclusive fields, non-owners refused per field); no
new unauthenticated endpoint; no competing client authority for prices,
ceilings, or versions; tokens only in the platform keystore; no credential or
session material in payloads, logs, or the local settings cache; the cache is
per-organization, session-gated, structurally validated, and never displayed
cross-tenant; outbox rows are untouchable by this feature (deletion or
enqueue); migrations `0001`–`0012` (server) byte-untouched and untouched in
content; the local migration journal honours §35.5 forward-only additive
steps only; the predecessor suites (M3-S1/S2/S3 backend counts 580/60/231 at
M3-S3 acceptance, plus the full Flutter suite, 403 passed / 1 skipped at the
M3-S3 record) stay green and are re-run, not assumed.

## 6. Validation requirements (acceptance matrix at declaration)

| # | Mission requirement (§12/§40.7/mission §5–§10) | Implementation | Executable evidence |
| --- | --- | --- | --- |
| A1 | Organization settings screens for §§22.2/§22.4 fields incl. owner exclusivity | General editor + model + repository + gates | Widget: general screen renders all fields; owner-only disabled/enabled by `authorization/me` |
| A2 | Three pricing modes with explanations, server-authoritative values | Pricing editor + balanced l10n explanations | Widget: mode selection renders per-mode explanation |
| A3 | Five typed discount fields, nullable threshold, minor-unit money | Pricing editor + draft model | Widget + unit: field grammar, nullable threshold handling, validation errors |
| A4 | Settings drive real behaviour online | GET/PUT round-trip, server canonical values, version token, refresh of consumers | Unit: repository; integration (gated): real backend persist → read |
| A5 | Versioned offline cache display | Drift v4 snapshot store + cached view | Unit: store semantics (versions, corruption, cross-tenant); widget: cached banner read-only |
| A6 | No offline mutation authority / no false success | Save disabled while unreachable; transport failure ≠ success | Unit + widget: offline save attempt honest message, draft kept |
| A7 | Distinguish network refusal from HTTP authorization/validation failure | Failure taxonomy end-to-end | Unit: repository outcomes; widget: denied vs unavailable states |
| A8 | Concurrency: stale version never overwrites newer authoritative state | 409 → draft preserved → reload/reconcile path | Unit: conflict outcome; widget: conflict dialog keeps draft |
| A9 | Permissions matrix: owner / authorized non-owner / cashier / salesperson / DENY overrides / cross-org | `authorization/me` plumbing + server enforcement assumed by contract + backend suites unchanged | Unit: permission provider logic; backend e2e/db suites re-run green |
| A10 | Money precision (§30) | Decimal-string minor units, ≤2dp percentage, no float authority | Unit: parser boundaries (zero, max, negative refused, 18-digit, rounding-edge percentages) |
| A11 | Local migration v3→v4 forward-only additive with data preserved | Drift v4 + migration step + journal | Unit: T-O19-style replication of the migration |
| A12 | No outbox effect from cache writes | Cache store exempted & outbox-untouched | Unit: outbox count unchanged across cache lifecycle (T-O7 analogue) |
| A13 | Cache lifecycle (mission §7's fourteen scenarios) | Store + repository outcomes | Unit: first load, loss after cache, restart offline, version persistence, multiple versions, reconnect-newer, unauthorized save refusal, corruption, missing cache, no auth context, org switch, loss during save, repeated refresh, no outbox mutation |
| A14 | Localized strings, tokens-only visuals, bidi layout | ARB keys both languages; no raw colors/sizes; logical alignment | CI gates `gate:localization`, `gate:design-system` green |

Aggregate acceptance: every row truly executed on the final recorded SHA; CI
both `push` and `pull_request`, all seven required jobs green on the exact
final SHA (`fast-checks`, `backend-unit`, `backend-integration-database`,
`contract-drift`, `dependency-audit`, `flutter-build-windows`,
`flutter-build-android`).

## 7. Migration impact, rollback, and offline threat-model walk

- **Server**: none. Migrations `0001`–`0012` byte-untouched.
- **Local**: Drift schema v3 → v4, additive table only, forward-only, journal
  steps recorded; a T-O19-style test re-applies the step from a v3-shaped
  database with pre-existing data, asserting preservation.
- **Rollback**: delete the branch; the v4 table left behind by a stale binary
  is inert (additive, unused by older code); no business data is touched —
  the outbox, grace, and audit tables are schema-and-data untouched.
- **§13.7 walk for the change**: the cache introduces no new mutation path
  (no upward sync, no outbox enqueue); a copied/foreign database file yields
  at most read-only cached settings for the *device's own* organization, only
  to a valid signed-in session for that organization (§38.29 posture
  unchanged); a revoked user's cache display expires with the session; stale
  permissions remain a bounded, server-rechecked risk per §38.17/R-15. No new
  residual threat beyond the plan's stated acceptances is introduced.

## 8. Execution record (evidence, §43.1/G-13)

### 8.1 The gauntlet, run and green locally (Windows, local PostgreSQL 18)

| Gate | Result |
| --- | --- |
| `flutter analyze --fatal-infos` | **No issues found** (pinned 3.47.5 / dart 3.13.4) |
| Full Flutter suite | **484 passed / ~1 skipped / 0 failed** on the branch head (predecessor M3-S3 record: 403 passed / 1 skipped — 81 new tests, predecessor suites untouched in semantics) |
| Settings/offline unit + cache + migration tests | 71 green: the strict `OrganizationSettings` parser matrix, `SettingsApi`/`AuthorizationApi` wire surfaces, `SettingsSnapshotCache` versioned semantics (older-refused / equal-refresh / newer-accepted, corruption named not served, org-keyed reads), the T-O19-style v3→v4 additive migration with data preserved, and the T-O7-analogue outbox-count-unchanged assertions |
| Widget suites (`test/settings/settings_surfaces_test.dart`) | 13 green across hub/general/pricing: live and denied hub states, offline-with-no-cache honesty, cached banner with version metadata, owner/viewer affordance gating from `authorization/me`, unsaved-changes indication, save crossing only touched fields with the version token, explicit material-save confirmation, §38.18 conflict → keep draft → reload reconcile, refused saves keep the draft, cached editors locked read-only |
| `node tool/ci/offline-guards.mjs` | OK — 94 dart files scanned, 2 generated `*.g.dart` exempt; stage-23 outbox-deletion and stage-24 single-remote-apply-door guards armed with the declared M3-S4 settings-store exemption |
| Backend `test:unit` | **580/580** tests, 42/42 suites (backend sources byte-unchanged in this slice — re-run, not assumed) |
| Backend `test:integration` | **60/60** tests, 7/7 suites |
| Backend `test:database` (real PostgreSQL) | **231/231** tests, 6/6 suites, on the fixed `my_shop_test` database recreated via the supported `node scripts/db.mjs test-setup` flow (`ADMIN_DATABASE_URL` privilege separation, roles from `prisma/roles.sql`, migrator-role deploys) |
| Backend `typecheck` / `lint` / `format:check` | pass (root workspaces) |
| `npm run contracts:check` | contracts are in sync — no regeneration noise, contract-drift clean by construction |
| Dependency audit posture | client-only changes (one Flutter dev-dep `sqlite3` for the native test runner); the npm dependency-audit gate is unaffected |

### 8.2 Real-backend gated integration (A4's online-posture proof)

An env-gated suite, `apps/desktop/test/settings/real_backend_settings_test.dart`,
drives the **real client stack** (AuthApi → AuthorizationApi → SettingsApi →
SettingsRepository → SettingsSnapshotCache over a memory Drift database)
against the **real NestJS server** on local PostgreSQL, with no scripted
server anywhere. It runs only when `MY_SHOP_E2E_URL`, `MY_SHOP_E2E_EMAIL`, and
`MY_SHOP_E2E_PASSWORD` name a live local API and is skipped honestly
otherwise, so CI and ordinary runs never depend on a server process.

Local run (server built from this branch, started with the required
`DATABASE_URL` / separated `MIGRATION_DATABASE_URL` / base64 PEM
`JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY`; owner seeded through the supported
`bootstrap:org` + `provision:credential` operator commands, ≥12-char password):

- login → token pair; `POST /auth/me` answers the session's organization
  (§9.3 derivation);
- `GET …/authorization/me` → `isOwner: true` for the seeded owner;
- `GET …/settings` → the typed §22.2 inventory, strictly parsed client-side,
  and the cache records the verbatim payload at its version;
- `PUT …/settings {organizationName, settingsVersion}` → 200 with
  `settings_version` advanced 1 → 2, `changedFields: ["organizationName"]`
  audited server-side; a fresh authoritative re-read answers the new name;
- a stale version token PUT → **`409 SETTINGS_VERSION_CONFLICT`**, classified
  client-side as the §38.18 conflict, never softened into an offline or
  refused state;
- the versioned cache afterwards holds exactly the saved snapshot (name,
  version, fetched-by answered by the server's canonical write);
- the original name is restored (version 3), leaving the database as found.

One honest environment note: the very first invocation classified a login as a
transport withholding at the client's 20 s budget while the server itself
logged `LOGIN_SUCCEEDED` (a cold-path timing artifact this machine produced
once); the suite now provisions a 60 s local-API budget and the re-run passed
cleanly end to end. The run is repeatable by following §8.2's provisioning
description against a local Postgres.

### 8.3 Remote CI on the exact implementation head

Filled in the record commit below, after the acceptance push; the slice is
locked only when both the `push` and the `pull_request` events show the seven
required jobs green on the exact final SHA.
