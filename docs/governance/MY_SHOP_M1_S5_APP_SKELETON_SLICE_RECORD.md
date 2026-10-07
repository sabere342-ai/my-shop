# MY SHOP — M1-S5 SLICE RECORD: APP SKELETON

**Master plan:** `docs/governance/MY_SHOP_MASTER_PLAN.md` v1.1.0 — §40.4 (M1-S5), §6 (Flutter
architecture direction: §6.2, §6.4, §6.5, §6.6, §6.7, §6.8, §6.9, §6.11), §36.3 (Flutter tests),
§37.2 (stages 9, 10, 13, 14), §40.1 (slice governance), §43.1 (per-slice gates)
**Slice:** M1-S5
**Branch:** `codex/my-shop-m1-s5-app-skeleton`
**Predecessor:** `3fcff8c1e0ce4f47c9d5b9d65d12ab574406359f` — M1-S4, branch
`codex/my-shop-m1-s4-ci-pipeline`, pushed, in sync with remote, PR #4 open (base M1-S3, not merged)
and untouched
**Declaration version:** 1.0.0 (declared before implementation work, per §40.1)

---

## 1. Predecessor state, verified not assumed

| Check | Value | Result |
|---|---|---|
| Repository root | `C:/dev/my-shop` | pass |
| Direct remote | `https://github.com/sabere342-ai/my-shop.git` | pass |
| Entry classification | `CASE_A_CONTINUATION_READY` | pass — clean worktree, empty stash, no active git operations |
| Current branch / HEAD at entry | `codex/my-shop-m1-s4-ci-pipeline` @ `3fcff8c1e0ce4f47c9d5b9d65d12ab574406359f` | pass — equals canonical M1-S4 token commit |
| Remote M1-S4 ref | `3fcff8c1e0ce4f47c9d5b9d65d12ab574406359f` | pass — unchanged after `git fetch --prune` |
| Predecessor parentage | `3fcff8c` → `906d0e8` (M1-S4) → `3a95f44` (M1-S3) → `dcca491` (M1-S2) → `bcc853d` (M1-S1) | pass — stacked ancestry intact |
| Local `main` / `origin/main` | `53f6aaa9aded2ec2218cec3f8987675a824b70db` | pass — identical, unchanged, ancestor of the stack |
| Other remote refs at entry | M0-P1 `701255f`, M0-P2 `0d25bd3`, M1-S1 `bcc853d`, M1-S2 `dcca491`, M1-S3 `3a95f44` | pass — all match recorded values |
| Stale remote-tracking ref | `origin/negdemo/m1-s4-checks` removed by `fetch --prune` | note — the M1-S4 negative-demo branch was already deleted from the remote at S4 closeout; prune only dropped the local tracking ref, no branch or commit was touched |
| Worktree at start | clean (`git status --porcelain=v1 -uall` empty) | pass |
| Stash | empty | pass |
| Worktrees | main worktree + two M0 record worktrees under `%TEMP%` (predecessor slices, untouched) | pass |
| Repository visibility | `public`, default branch `main` (owner-authorized in M1-S4, D-15) | pass — unchanged by this slice |
| M1-S4 remote CI | runs `37504014039` (push) and `37504020164` (pull_request), head `3fcff8c`, `completed / success` | pass |
| PR #4 | open, base `codex/my-shop-m1-s3-prisma-bootstrap`, head `codex/my-shop-m1-s4-ci-pipeline`, `mergeable=true`, `mergeable_state=clean`, not merged | pass — read only, never modified |
| Branch protection on `main` | required checks = the 7 job names, `strict=false`, `enforce_admins=true`, 1 approval + code owners, force push refused, deletion refused, conversation resolution required | pass — verified by API before any mutation |
| `gh` CLI | not installed | inherited limitation (M1-S4); the documented fallback (host's stored git credential, used only for API evidence) is used; no tooling is installed |

**Predecessor discipline.** This slice branches from `3fcff8c` (M1-S4), **not** from `main` and
**not** from M1-S3. `main` carries only the M0-era state; starting there would discard the whole
M1 stack.

**Merge policy.** No merge is performed. Gate **G-12** (§43.1) and CI gate **G-4** (§37.3)
require an explicit, separate owner authorization that this slice does not have. PR #4 and all
historical PRs remain open and untouched.

---

## 2. Declaration

### 2.1 `scope`

| # | Outcome |
|---|---|
| S-1 | Flutter dependency wiring mandated by the plan: `flutter_riverpod`, `riverpod_annotation` (§6.4, §6.5), `go_router` (§6.6), `flutter_localizations` + `intl` (§6.8), with `riverpod_generator` + `build_runner` as dev dependencies — `build_runner` is the only client code generator (§6.7), and `apps/desktop/pubspec.lock` records the resolved graph. No npm manifest or lockfile change. **Amended before implementation, under explicit owner authorization, from the declared `2.x` set to the current major line** — `flutter_riverpod`/`riverpod` 3.4.3, `riverpod_annotation` 4.0.7, `riverpod_generator` 4.0.9, `build_runner` 2.16.1, plus `dependency_overrides: analyzer: 14.4.0`. Rationale and evidence: §3 D-1, §4 R-1. `MY_SHOP_MASTER_PLAN.md` is unchanged (AC-10) |
| S-2 | ARB localization (§6.8): `l10n.yaml`, `lib/l10n/app_ar.arb` (default catalog, `ar`) and `lib/l10n/app_en.arb` (fallback), `flutter: generate: true`, the generated `AppLocalizations` **committed** (§6.7), and `MaterialApp` wired with `locale: Locale('ar')`, `supportedLocales`, and the localization delegates — directionality derives from the locale, with no manual `Directionality` wrapper |
| S-3 | App bootstrap (§6.2 `app/`): `lib/main.dart` → `ProviderScope` → `MyShopApp` with `MaterialApp.router`; theme wiring composed from `core/ui` tokens only — no `Colors.*`, `Color(0x…)` or `fontSize:` outside `lib/core/ui` (§6.9) |
| S-4 | Routing (§6.6): `lib/app/router/` with `go_router`, named routes and path constants, a **redirect guard** that resolves authentication state and organization context before the first screen renders, session state held in a Riverpod provider (§6.4, §6.5 — no service locator, no static registration), and a catch-all not-found route. Direct `Navigator.push` is not used |
| S-5 | Design-system tokens (§6.9): colour **roles** (surface, onSurface, primary, success, warning, danger, disabled), a type scale (display, title, body, label, caption), an 8-point spacing scale and a radius scale, all defined in `lib/core/ui/`, plus the `ThemeData` composed from them |
| S-6 | Design-system components (§6.9): `AppButton`, `AppTextField`, `AppMoneyField`, `AppDialog`, `AppSheet`, `AppDataTable`, `AppEmptyState`, `AppErrorState`, `AppConfirmDialog`, `AppSnackbar`, `AppSectionHeader`, `AppPermissionGate` — all twelve, with no hardcoded user-visible string inside any of them (§6.8) |
| S-7 | RTL golden tests (§36.3 golden row, §40.4 key acceptance): one golden comparison per §6.9 component rendered in **Arabic RTL**, golden files committed under `apps/desktop/test/` |
| S-8 | Behaviour tests: app bootstrap; directionality and strings derived from `Locale('ar')`; router navigation plus the catch-all route; redirect-guard unit tests covering **every** branch with synthetic sessions; the predecessor placeholder widget tests replaced |
| S-9 | Documentation: README current-state rows for M1-S4/M1-S5, this slice record |

### 2.2 `non_scope`

Named explicitly, per §40.1.

| Not touched | Reason |
|---|---|
| Any business screen, business feature folder content, or use case; `lib/features/` stays empty | §40.4 M1-S5 non-scope: "Any business screen"; §2.4 anti-scope rule |
| Authentication UI, session store, secure token storage, grace-window UX | M2-S7 (§40.6) |
| Permission catalog, role presets, effective-permission resolution | M2-S3 (§40.6); `AppPermissionGate` takes a caller-supplied boolean only and holds no permission logic |
| `core/money` `Money` value type, minor-unit arithmetic, formatting rules | Not in the §40.4 M1-S5 row; `AppMoneyField` is presentational (string in, string out) and defers to `core/money` when that slice declares it |
| `freezed` / `json_serializable` model code generation | §6.7 binds them to "immutable domain and DTO types"; no domain or DTO type exists while every business screen is non-scope. `build_runner` is present and exercised by `riverpod_generator`, so the "only code generator" rule already holds |
| `core/api` REST client, generated contracts, drift gate | M1-S6 (§40.4) |
| Drift local schema, `local_meta`, outbox, sync transport, T-O offline matrix | M1b (§40.5); stages 19–22 stay declared-absent in the workflow |
| Backend, Prisma schema, migrations, roles | M1-S3 owns them; no schema object exists for this slice |
| `.github/workflows/**`, `tool/ci/**`, branch protection, required checks | M1-S4 owns the CI platform; the nine gates run here **unchanged** — this slice changes no gate |
| npm dependency addition/upgrade; `package-lock.json` | Not needed; must stay byte-identical |
| Any edit to `MY_SHOP_MASTER_PLAN.md` | §43.4 — no decision changed |
| Merge to `main`, merging PR #4 or this slice's PR, auto-merge, force push, history rewrite, predecessor commits | Owner boundary; G-12, G-4 |
| Repository visibility | Owner decision D-15 (M1-S4); unchanged |
| Installing `gh` or any global tool | Host limitation handled by the documented fallback, not by mutating the machine |

### 2.3 `allowed_paths`

```
apps/desktop/lib/**
apps/desktop/test/**
apps/desktop/l10n.yaml
apps/desktop/pubspec.yaml
apps/desktop/pubspec.lock
apps/desktop/analysis_options.yaml
README.md
docs/governance/MY_SHOP_M1_S5_APP_SKELETON_SLICE_RECORD.md
```

Nothing outside this list is modified. `apps/desktop/analysis_options.yaml` is listed only because
committed gen-l10n output under `lib/l10n/` may need the same lint exclusion that `**/*.g.dart`
already carries (§6.7 "generated files are committed"); if the generated sources analyse clean, the
file is not touched at all. `package-lock.json`, `services/api/**`, `packages/**`, `.github/**`,
`tool/**`, `MY_SHOP_MASTER_PLAN.md`, and every predecessor record and slice record are
**read-only** for this slice.

### 2.4 `tests`

| Level | Requirement |
|---|---|
| Gate positives | Every `tool/ci/*` gate passes against the committed tree (stages 1, 2, 11–15, 23–24, G-6) with the new Flutter sources present — stages 13 and 14 now scan real code, not a placeholder |
| Golden | One `matchesGoldenFile` comparison per §6.9 component (12) rendered in Arabic RTL from committed golden files (§36.3 golden gate) |
| Widget | App bootstrap in `Locale('ar')`: first frame renders, `TextDirection.rtl` derives from the locale, Arabic catalog strings are on screen, catch-all route renders the error state |
| Unit | Redirect guard: every branch (`notProvisioned` → allow, `unauthenticated` → sign-in, `authenticated` without organization → organization setup, `authenticated` with organization → allow) |
| Negative | A golden comparison is observed failing when a golden is altered, so the golden gate is proven non-vacuous; stages 13 and 14 are re-observed failing on a targeted violation inside the M1-S5 tree and restored |
| Static analysis | `flutter analyze --fatal-infos` clean (stage 8) |
| Lint / format / typecheck / backend unit + integration | `npm run verify:node` — unchanged, no backend file touched (stages 3–7, 16) |
| Release builds | `flutter build windows --release` and `flutter build apk --release` locally (stage 18) |
| Audit | `npm audit --audit-level=high` exits 0 (stage 17); the 20 moderate advisories pre-date M1-S4 |
| Remote acceptance | The workflow runs green (all required jobs) on the exact M1-S5 head commit; PR stacked on M1-S4 stays open and unmerged |

### 2.5 `acceptance_criteria`

Binary and checkable.

| # | Criterion |
|---|---|
| AC-1 | §40.4 M1-S5 row delivered: `go_router`, Riverpod, `core/ui` design system, ARB localization, RTL golden tests — every §6.9 component exists under its specified name |
| AC-2 | Key acceptance (§40.4): Arabic RTL renders — golden files show all twelve components in `ar` RTL, and a widget test proves directionality derives from `Locale('ar')` with zero `Directionality(` wrappers in `apps/desktop/lib` |
| AC-3 | Key acceptance (§40.4): localization gate passes — `npm run gate:localization` exits 0 over the M1-S5 tree, with no hardcoded user-visible string in `lib` |
| AC-4 | `flutter analyze --fatal-infos` exits 0 (stage 8); `flutter test` exits 0 including all golden comparisons (stages 9–10) |
| AC-5 | All nine M1-S4 gate scripts exit 0 on the M1-S5 tree; no gate, workflow job, or required check was renamed, disabled, or softened |
| AC-6 | Release builds pass locally: Windows and Android APK (stage 18) |
| AC-7 | `npm audit --audit-level=high` exits 0 (stage 17); zero npm dependencies added |
| AC-8 | `package-lock.json` byte-identical to the predecessor; `apps/desktop/pubspec.lock` changes are limited to the S-1 additions |
| AC-9 | No file outside `allowed_paths` modified (G-5) |
| AC-10 | `MY_SHOP_MASTER_PLAN.md` byte-identical to the M1-S4 predecessor (SHA-256 `E7B50B24B6D5A358FFC2965AED3A7EFAD03B32E34BE0A841A9148B22D7178688`) |
| AC-11 | No migration created, modified, or deleted; historical migration bytes unchanged (G-6, G-7) |
| AC-12 | No secret, credential, or `.env` in the diff; `.env.example` untouched and placeholder-only |
| AC-13 | Remote CI green on the **exact** final M1-S5 SHA with all seven required checks; PR created with base `codex/my-shop-m1-s4-ci-pipeline`, head `codex/my-shop-m1-s5-app-skeleton`, open and unmerged; branch protection unchanged |
| AC-14 | Remote lock: local HEAD equals `origin/codex/my-shop-m1-s5-app-skeleton`, ahead/behind `0/0`, worktree clean; M1-S4, M1-S3, M1-S2, M1-S1, and `origin/main` refs unchanged |

### 2.6 `migration_impact`

**None.** No schema, no migration, no seed, no Prisma file touched. The client has no database at
this slice (Drift arrives in M1b-S1), so G-6/G-7 remain vacuously satisfied and historically
immutable.

### 2.7 `security_impact`

No endpoint, permission, data class, or credential is added. The client at this slice performs no
network I/O at all: it renders committed ARB catalogs and navigates locally, so the offline-first
posture (§38) and the stage 23–24 offline guards are untouched and remain meaningful. No secret is
read, written, or committed; `.env` stays ignored and `.env.example` is placeholder-only (§13.6).
No dependency outside the Flutter package graph is added, and the workflow keeps
`permissions: contents: read` with SHA-pinned actions.

### 2.8 `rollback`

Delete the branch and its commits (additive only) and, if the owner wants the placeholder shell
back, revert to `3fcff8c`. `apps/desktop/lib` additions are self-contained: no route is registered
outside `lib/app/router/`, no backend or CI file changes, no database object exists, and
`main` stays at `53f6aaa9` throughout.

### 2.9 `publication_gate`

| Field | Value |
|---|---|
| PR target | `codex/my-shop-m1-s4-ci-pipeline` (the stack head — stacked PR) |
| Required checks | the 7 CI job names of the M1-S4 pipeline, unchanged |
| Merge | **Owner only.** G-12 and G-4 apply. No automated merge exists, and this slice does not enable one |

---

## 3. Design decisions

**D-1 — Dependency version amendment (owner-authorized).** The declaration pinned the Riverpod
tooling to the `2.x` line. That line's generator (`riverpod_generator` 2.6.5) caps `analyzer <8`,
forcing `analyzer` 7.6.0 + `_fe_analyzer_shared` 85.0.0; that analyzer crashes on Dart 3.13
dot-shorthand syntax (dart-lang/sdk#61870), and a baseline `build_runner` run stalled past 300 s.
With explicit owner authorization the app moved to the current major line — `flutter_riverpod`/
`riverpod` 3.4.3, `riverpod_annotation` 4.0.7, `riverpod_generator` 4.0.9, `build_runner` 2.16.1 —
plus `dependency_overrides: analyzer: 14.4.0`. The override is required because `build_runner`
2.16.1 declares `analyzer >=13.3.0 <15.0.0` yet assigns `AnalysisOptionsImpl.contextFeatures`, a
setter that analyzer 14.5.0 removed (moved to `AnalysisOptionsBuilder`); 14.4.0 retains it and
`dart pub outdated` reports the chosen set as current latest. The change is confined to
`apps/desktop/pubspec.yaml`/`pubspec.lock`; `MY_SHOP_MASTER_PLAN.md` §6.4 is byte-identical (AC-10)
and no npm dependency changed (AC-7, AC-8). Riverpod 3 removed the provider-family `Ref`
subclasses, so `app_router.dart` annotations were changed from `NavigationSessionRef`/
`AppRouterRef` to the unified `Ref`; provider names and `@Riverpod(keepAlive: true)` are unchanged.

**D-2 — Golden comparator tolerance.** `test/flutter_test_config.dart` installs a
`LocalFileComparator` subclass with `precisionTolerance = 0.01`, scoped to the golden test file, so
sub-1% anti-aliasing differences between the Windows generation host and the ubuntu-latest CI
runner cannot produce false failures while real colour/layout changes still fail (proved
non-vacuous by R-4). This is the Flutter-documented directory-config mechanism.

**D-3 — Deterministic Arabic fixture font.** Goldens load the committed
`test/fonts/NotoSansArabic.ttf` (SIL OFL, `OFL.txt`) through `FontLoader('Roboto')`, the family
`AppTypography` uses, so Arabic glyphs render identically on any host without relying on a system
font. Test-only asset; no production bundle change.

**D-4 — Fixed golden surface.** Each golden renders the component inside a `MaterialApp`
(`AppTheme.light()`, `Locale('ar')`, the localization delegates) at 800×600 @ devicePixelRatio
1.0, with the test view reset in `tearDown`. The snackbar golden drives `AppSnackbar.show`
explicitly before matching the `SnackBar`.

**D-5 — Component correctness fixes surfaced by `--fatal-infos`.** `AppSectionHeader` uses the
Dart 3.13 null-aware element `?trailingWidget`; `AppSnackbar` uses `SnackBar.padding` (not the
non-existent `contentPadding`); the components are fully `const`-correct. No visual behaviour
changed — the goldens were generated from these final sources.

**D-6 — Gate neutrality.** No gate script, workflow job, required check, or
`MY_SHOP_MASTER_PLAN.md` byte was changed. `apps/desktop/analysis_options.yaml` was not modified:
the committed generated sources analyse clean and `**/*.g.dart` is already excluded.

---

## 4. Results

**R-1 — Code generation recovered (blocker cleared).** With the amended graph,
`dart run build_runner build` completed in 74 s and wrote 2 outputs;
`apps/desktop/lib/app/router/app_router.g.dart` exists and a re-run is a no-op (`wrote 0
outputs`). SHA-256 `F2A317E9BE3DDE7B0D565259D48665D3A7EC3A29F8E00E92F1E8BA8B09B28ED2`. The file
is matched by the root `.gitignore` `*.g.dart`; it is force-added at commit per §6.7 without
editing `.gitignore`. Resolved graph: analyzer 14.4.0, _fe_analyzer_shared 108.0.0, build 4.0.11,
build_runner 2.16.1, source_gen 4.3.0, flutter_riverpod/riverpod 3.4.3, riverpod_annotation 4.0.7,
riverpod_generator 4.0.9, dart_style 3.1.13.

**R-2 — Static analysis (stage 8).** `flutter analyze --fatal-infos` → `No issues found!`, exit 0.

**R-3 — Tests (stages 9–10).** `flutter test` → **20 tests pass**: 12 golden comparisons (one per
§6.9 component, Arabic RTL), 6 redirect-guard unit tests covering every branch
(`notProvisioned` → allow any; `unauthenticated` → sign-in; `unauthenticated` at sign-in → allow,
no loop; `authenticated` without organization → organization setup; at setup → allow, no loop;
`authenticated` with organization → allow everywhere), and 2 bootstrap widget tests (RTL derives
from `Locale('ar')` with catalog strings on screen; the catch-all renders the not-found screen).
12 golden PNGs committed under `apps/desktop/test/golden/goldens/`.

**R-4 — Golden gate proven non-vacuous.** Replacing `app_button.png` with a different golden made
the `AppButton` comparison fail (`Some tests failed`, exit 1); the golden was then restored
byte-identically (SHA-256 unchanged).

**R-5 — Gate positives (stages 1, 2, 11–15, 23–24, G-6).** `npm run gates` → **9/9 OK**:
secret-scan; markdown (14 files); import-boundary (29 files); vocabulary (armed); localization
(29 files); design-system (12 files outside `core/ui`); immutability (33 backend files);
offline-guards (29 files, armed); migration-immutability (2 paths, none rewritten).

**R-6 — Gate negatives (stages 13, 14).** A temporary `Text('hardcoded text')` in
`lib/app/router/not_found_screen.dart` made `localization-check` fail (1 finding, exit 1); a
temporary `fontSize: 12` in `lib/app/router/shell_screen.dart` made `design-system-check` fail
(1 finding, exit 1). Both files were restored byte-identically and `npm run gates` returned to
9/9.

**R-7 — Node / tooling (stages 3–7, 16).** `npm run toolchain:verify`, `npm run format:check`,
`npm run lint`, `npm run typecheck`, and `npm run build` (composite, contract drift) all exit 0;
`package-lock.json` is unchanged (AC-8). `npm run test:unit --workspace @my-shop/api` → 99/99
pass. The root `npm test` additionally runs the **database acceptance suite**, which by design
refuses to run without `DATABASE_URL`/`MIGRATION_DATABASE_URL`/`ADMIN_DATABASE_URL` (§36.1 T-5 —
no silent skips); it runs green in CI against the PostgreSQL 18 service and is not runnable on
this host without those URLs.

**R-8 — Audit (stage 17).** `npm audit --audit-level=high` exits 0 — 20 moderate advisories,
pre-existing, none high or critical; zero npm dependencies added.

**R-9 — Release builds (stage 18).** `flutter build windows --release` →
`build\windows\x64\runner\Release\my_shop_desktop.exe`, exit 0. `flutter build apk --release` →
`build\app\outputs\flutter-apk\app-release.apk` (45.6 MB), exit 0.

**R-10 — Remote CI and publication (stages 1–24 in CI).** The branch
`codex/my-shop-m1-s5-app-skeleton` was pushed at implementation SHA
`7b81c6f97516d047bb50b5f9b3b4b6040dfcade9`, and PR **#5** was opened with base
`codex/my-shop-m1-s4-ci-pipeline`, state `OPEN`, `mergeable=MERGEABLE`,
`mergeStateStatus=CLEAN`, not merged. Both workflow runs completed **success**: run
`37568861870` (push) and run `37568876518` (pull_request) — `fast-checks` (including
`flutter analyze` and the full `flutter test` with the goldens on ubuntu-latest),
`backend-unit`, `backend-integration-database`, `contract-drift`, `dependency-audit`,
`flutter-build-windows`, and `flutter-build-android`. The Linux `fast-checks` pass confirms the
committed goldens compare within tolerance across the Windows generation host and the
ubuntu-latest runner (D-2). This record's own commit is documentation-only and re-runs the same
workflow; it changes no source, gate, or test. Local lock after the push: `HEAD` =
`origin/codex/my-shop-m1-s5-app-skeleton`, ahead/behind `0/0`, worktree clean; `origin/main`,
`origin/codex/my-shop-m1-s4-ci-pipeline`, and the earlier stack refs are untouched.

**Acceptance criteria.**

| AC | Result |
|---|---|
| AC-1 | pass — go_router, Riverpod, `core/ui` tokens, ARB l10n, all twelve §6.9 components (R-3) |
| AC-2 | pass — 12 Arabic RTL goldens; bootstrap test derives RTL from `Locale('ar')`; no manual `Directionality(` in `lib` (R-3, R-5) |
| AC-3 | pass — `gate:localization` green over the M1-S5 tree (R-5) |
| AC-4 | pass — analyze and `flutter test` exit 0 (R-2, R-3) |
| AC-5 | pass — 9/9 gates green; no gate renamed, disabled, or softened (R-5, D-6) |
| AC-6 | pass — Windows and Android release builds (R-9) |
| AC-7 | pass — audit exits 0; zero npm deps added (R-8) |
| AC-8 | pass — `package-lock.json` unchanged; `pubspec.lock` change limited to S-1 (R-7, D-1) |
| AC-9 | pass — only `allowed_paths` touched (README, `apps/desktop/**`, this record) |
| AC-10 | pass — `MY_SHOP_MASTER_PLAN.md` byte-identical, SHA-256 `E7B50B24…78688` (§2.5 AC-10; D-1) |
| AC-11 | pass — no migration created/modified/deleted; gate green (R-5) |
| AC-12 | pass — secret-scan green; `.env.example` untouched (R-5) |
| AC-13 | pass — CI green on the M1-S5 implementation SHA and PR #5 open, `CLEAN`, unmerged (R-10) |
| AC-14 | pass — local HEAD = origin, ahead/behind 0/0, clean; predecessor refs unchanged (R-10) |
