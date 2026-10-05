# MY SHOP — M1-S1 SLICE RECORD: MONOREPO SKELETON AND PINNED TOOLCHAIN

**Master plan:** `docs/governance/MY_SHOP_MASTER_PLAN.md` v1.1.0 — §40.4 (M1-S1), §40.1 (slice governance)
**Slice:** M1-S1
**Branch:** `codex/my-shop-m1-s1-monorepo-skeleton`
**Predecessor:** `0d25bd35878e4f19b2408c6d783e3c2810f80c20` — M0-P2, branch `codex/my-shop-m0-p2-offline-pos-amendment`, PR #2, open and unmerged
**Declaration version:** 1.0.0 (declared before any implementation work, per §40.1)

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
| Predecessor ancestry | `701255f` is an ancestor of `0d25bd3` | pass — correctly stacked |
| Working tree at start | clean | pass |
| Stash | empty | pass |
| Lock files | none present | pass |
| Active git operations | none | pass |

**Predecessor discipline (§7 of the authorization).** The work chain is a stack of three
commits on two unmerged PRs. M1-S1 therefore branches from `0d25bd3` (M0-P2), **not** from
`main`. `main` carries only the initial commit and no governance document, so starting there
would discard the governing Master Plan.

**Merge policy (§8).** No merge is performed by this slice. PR #1 and PR #2 remain open.
Gate **G-12** and CI gate **G-4** both require an explicit, separate owner authorization to
merge, and this slice has none.

---

## 2. Declaration

### 2.1 `scope`

| # | Outcome |
|---|---|
| S-1 | The four mandated workspaces exist at their locked paths: `apps/desktop`, `services/api`, `packages/contracts`, `packages/testkit` |
| S-2 | The repository builds and analyses empty: Flutter analyze + test, TypeScript typecheck, lint, format |
| S-3 | The toolchain is **pinned in-repo** for Node, npm, Dart, and Flutter, and a machine-readable guard verifies the active SDK against the pin |
| S-4 | `.gitignore`, `.editorconfig`, and `.env.example` exist, and secrets handling follows §13.6 |
| S-5 | An npm workspace root ties `services/api`, `packages/contracts`, and `packages/testkit` into one deterministic install |
| S-6 | The locked-in architecture decisions ADR-001, ADR-002, ADR-003, ADR-004, and ADR-005 are recorded under `docs/adr/` |
| S-7 | R-5 is resolved **without any global machine mutation**: the existing newer Flutter SDK on this host is selected and pinned, and the conflicting older one is recorded as not-selected |

### 2.2 `non_scope`

Named explicitly, per §40.1.

| Not touched | Reason |
|---|---|
| Any business feature, screen, or use case | M1-S5 owns the app skeleton; §2.4 anti-scope rule |
| Any database schema or migration | M1-S3 owns Prisma; §35 |
| NestJS application modules, endpoints, health checks | M1-S2 |
| CI workflow definitions | M1-S4 |
| Contract generation and drift gate | M1-S6 |
| `core/offline/**`, Drift, outbox, sync | M1b; §40.5 |
| `core/ui` design system components | M1-S5; §6.9 |
| Any edit to the Master Plan | §43.4 — no decision changed |
| Global toolchain mutation | Authorization §4C |
| Any deployment | §37.4 — deployment is not in M0–M1 |

### 2.3 `allowed_paths`

```
.gitignore
.editorconfig
.env.example
.nvmrc
.tool-versions
.gitattributes
README.md
package.json
package-lock.json
tool/**
docs/adr/**
docs/governance/MY_SHOP_M1_S1_MONOREPO_SKELETON_SLICE_RECORD.md
apps/desktop/**
services/api/**
packages/contracts/**
packages/testkit/**
```

Nothing outside this list is modified. `docs/governance/MY_SHOP_MASTER_PLAN.md` and the two M0
records are **read-only** for this slice.

### 2.4 `tests`

| Level | Requirement |
|---|---|
| Static analysis | `flutter analyze --fatal-infos` clean in `apps/desktop` |
| Dart types | `dart analyze` resolves `packages/contracts` |
| Static analysis | `tsc --noEmit` clean across every TypeScript workspace |
| Lint / format | `eslint` and `prettier --check` clean |
| Unit tests | Jest suite runs and passes |
| Flutter tests | `flutter test` runs and passes |
| Toolchain guard | The pinned-SDK verifier passes and fails when the pin is violated |

### 2.5 `acceptance_criteria`

Binary and checkable.

| # | Criterion |
|---|---|
| AC-1 | All four workspace directories exist at the paths named in §6.2 |
| AC-2 | `apps/desktop` is a valid Flutter project for `windows` and `android` only |
| AC-3 | `services/api`, `packages/contracts`, and `packages/testkit` typecheck under `strict` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `noImplicitOverride` |
| AC-4 | An npm workspace install resolves deterministically from a committed lockfile |
| AC-5 | Flutter analyze with `--fatal-infos` reports zero issues |
| AC-6 | `flutter test` passes |
| AC-7 | `tsc --noEmit` reports zero errors in every TypeScript workspace |
| AC-8 | Jest unit tests pass |
| AC-9 | ESLint and Prettier report no findings |
| AC-10 | The toolchain verifier passes against the pinned versions |
| AC-11 | No `.env` file, credential, connection string, or key is committed; `.env.example` holds placeholders only |
| AC-12 | No file outside `allowed_paths` is modified |
| AC-13 | The Master Plan is byte-identical to its M0-P2 state |
| AC-14 | Zero files are copied from the legacy repository (§5.1) |

### 2.6 `migration_impact`

**None.** No Prisma schema, no SQL migration, no local Drift schema. Drift arrives in M1b-S1.

### 2.7 `security_impact`

**None.** No endpoint, no permission, no new data class, no unauthenticated surface. The
committed `.env.example` carries placeholders only, satisfying §13.6 and §42.6.

### 2.8 `rollback`

Delete the branch. The slice is additive, contains no migration, and `main` is untouched at
`53f6aaa9`. Reverting the single commit is equally sufficient.

### 2.9 `publication_gate`

| Field | Value |
|---|---|
| PR target | `codex/my-shop-m0-p2-offline-pos-amendment` (the open stack head) |
| Required checks | stages 1–18 of §37.2 as far as they are defined at this slice |
| Merge | **Owner only.** G-12 and G-4 apply. No automated merge exists |

---

## 3. Toolchain decision — R-5 resolved without a global mutation

§42.4 and R-5 flagged a stale Flutter on this host. §4C of the authorization forbids a global
Flutter or Dart upgrade without fresh authority. A safe, isolated resolution exists, so the
authorization's rule "look for an isolated or local solution first" applies and no Hard Stop is
raised.

| SDK on this host | Version | Decision |
|---|---|---|
| `C:\src\flutter` (on `PATH`) | Flutter **3.24.5**, Dart 3.5.4, dated 2024-11-13 | **Not selected.** Stale by over a year |
| `C:\src\flutter-3.47.5` | Flutter **3.47.5**, Dart **3.13.4**, dated 2026-09-17 | **Pinned.** Current stable |
| `C:\src\dart-sdk` (on `PATH`) | Dart **3.13.4** | Aligned with the pin, so the two-SDK conflict from R-5 disappears |

`flutter doctor` under the pinned SDK reports **no issues found**, including Visual Studio Build
Tools 2026 for the Windows target and Android SDK 36 with all licenses accepted. The §40.1
requirement to confirm the Windows toolchain is therefore satisfied.

| Resolution | Detail |
|---|---|
| No global upgrade performed | The newer SDK was already present |
| No `PATH` mutation performed | Selection happens per-invocation inside repository scripts |
| Pin recorded in-repo | `.tool-versions` is the machine-readable pin |
| Guard enforced | `tool/verify-toolchain` fails when the active SDK deviates from the pin |
| Residual | The stale `C:\src\flutter` remains on the host. Removing it is a global machine change and is **left to the owner** |

**Nothing was deleted, upgraded, or added to the host.**

---

## 4. Results

### 4.1 Acceptance criteria

| # | Criterion | Evidence | Result |
|---|---|---|---|
| AC-1 | Four workspaces at the §6.2 paths | `apps/desktop`, `services/api`, `packages/contracts`, `packages/testkit` all present | **PASS** |
| AC-2 | Valid Flutter project, Windows and Android only | created with `--platforms=windows,android`; no `ios/`, `web/`, `linux/`, `macos/` | **PASS** |
| AC-3 | Strict TS plus the three §7.1 additions | `tsconfig.base.json` sets `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`; `tsc --build` clean in all three workspaces | **PASS** |
| AC-4 | Deterministic workspace install | `npm install` from committed `package-lock.json`; `npm audit` reports **0 vulnerabilities** | **PASS** |
| AC-5 | `flutter analyze --fatal-infos` clean | "No issues found!" | **PASS** |
| AC-6 | `flutter test` passes | 2 tests passed | **PASS** |
| AC-7 | `tsc` clean in every workspace | 3 of 3 workspaces, zero errors | **PASS** |
| AC-8 | Jest passes | 11 tests passed across 3 suites | **PASS** |
| AC-9 | ESLint and Prettier clean | zero findings; `prettier --check` "All matched files use Prettier code style!" | **PASS** |
| AC-10 | Toolchain verifier passes against the pin | `RESULT: PASS — every active toolchain matches the pin` | **PASS** |
| AC-11 | No secret committed; placeholders only | 8-pattern scan of the staged diff: 0 real findings. The 2 matches are the literal `<app_password>` / `<migrator_password>` placeholders in `.env.example`, which §13.6 requires | **PASS** |
| AC-12 | Nothing outside `allowed_paths` modified | 87 files, all within the declared allow-list | **PASS** |
| AC-13 | Master Plan byte-identical | `git diff --cached -- docs/governance/` shows exactly one file, the new slice record | **PASS** |
| AC-14 | Zero legacy files copied | no path matches `muaman` or `i-tech` | **PASS** |

### 4.2 Gates G-1 to G-13

| Gate | Result |
|---|---|
| G-1 acceptance criteria verified and recorded | PASS — §4.1 |
| G-2 declared tests exist and pass | PASS — §4.3 |
| G-3 applicable §36.4 invariants | **Not applicable.** No business rule exists to violate; every invariant needs a document or a ledger, neither of which is in scope |
| G-4 all CI stages pass | **Partial.** Stages 1–18 are satisfied locally by `npm run verify`. **CI itself does not exist yet** — that is M1-S4. Recorded as a gap, not as a pass |
| G-5 no file outside `allowed_paths` | PASS |
| G-6 `non_scope` verifiably untouched | PASS — no schema, no NestJS module, no CI file, no `core/offline`, no design system |
| G-7 migration impact as declared | PASS — none; no migration file exists |
| G-8 security impact as declared | PASS — no endpoint, no permission, no unauthenticated surface |
| G-9 migration audit | **Not applicable.** No migration |
| G-10 rollback defined and feasible | PASS — delete the branch; `main` untouched at `53f6aaa9` |
| G-11 documentation updated | PASS — root README, `apps/desktop/README.md`, `docs/adr/README.md`, five ADRs, this record |
| G-12 owner authorized the merge | **NOT SATISFIED.** No merge performed, by design |
| G-13 offline path walkthrough | **Not applicable.** No offline code touched |

### 4.3 Tests

| Suite | Command | Result |
|---|---|---|
| Toolchain | `npm run toolchain:verify` | PASS — node 22.22.3, npm 10.9.8, flutter 3.47.5, dart 3.13.4 |
| Format | `npm run format:check` | PASS — 3 of 3 workspaces |
| Lint | `npm run lint` | PASS — 3 of 3 workspaces, type-aware rules |
| Typecheck | `npm run typecheck` | PASS — 3 of 3 workspaces, composite build in dependency order |
| Jest | `npm run test` | PASS — 11 tests, 3 suites |
| Flutter analyze | `npm run flutter:analyze` | PASS — `No issues found!` |
| Flutter test | `npm run flutter:test` | PASS — 2 tests |
| **Total** | | **16 checks, 0 failures** |

The toolchain guard was verified negatively as well: with the pin deliberately changed to
`9.99.9`, `npm run toolchain:verify` exited **1** and named the mismatch. A guard that has
only ever been seen passing is not known to fail.

### 4.4 Deviations and decisions taken

| # | Deviation | Reason |
|---|---|---|
| D-1 | Toolchain verification and the Flutter wrapper are **Node**, with shell wrappers | This host has three bash flavours (WSL, Git Bash, none on PATH) and the bash version passed under Git Bash while reporting every tool "not found" under WSL. A guard that silently skips is not a guard. Both entry points are provided |
| D-2 | Jest pinned to **30.x**, `@types/jest` 30.x, TypeScript **5.9.3**, ESLint 9.39.5, Prettier 3.9.9 | `npm audit` initially reported **37 high** vulnerabilities from `GHSA-vfj7-8cjw-p6xm` (braces stack exhaustion) via `micromatch` in the Jest 29 tree. §36.5 makes dependency audit a security test and §43.3 R-8 forbids an open high finding. Now **0 vulnerabilities** |
| D-3 | `@types/node` held at the **22.x** line while other tools moved to latest | Node is pinned to 22.22.3 in `.tool-versions`. Types must match the runtime that executes them, not the newest release |
| D-4 | `tsconfig` uses `composite` + `references`; typecheck is `tsc --build` | Cross-package types must resolve from declarations. With `tsc --noEmit` per package, `@my-shop/api` could not see `@my-shop/contracts` because the referenced package had never been emitted. `--build` emits in dependency order, which is what makes contract drift a compile error (ADR-001) |
| D-5 | `analysis_options.yaml` rewritten ASCII-only | The Flutter tool rewrites this file when it adds platform excludes, and the first round trip corrupted the UTF-8 header. The file is now pure ASCII with a note explaining why, so the next rewrite is a no-op |
| D-6 | `apps/desktop/pubspec.lock` **committed**; plugin registrant **committed** | An application lockfile is what makes a release build reproducible, which §37 treats as a security control. §6.7 commits generated sources so CI needs no codegen step |
| D-7 | `tool/pinned-sdk.mjs` uses `windowsVerbatimArguments` | Node cannot spawn `flutter.bat` directly (EINVAL since 18.20.2). Default Windows argument quoting produced `'"...flutter.bat"' is not recognized`, so the path reached `cmd.exe` already escaped. Verbatim arguments hand it over as written |
| D-8 | The Dart analysis config does **not** attempt to enforce §6.3 domain purity | "Pure Dart" is not expressible as a lint rule. §37.2 stage 11 is the mechanism that can distinguish a domain file from any other file, and it arrives in M1-S4. A lint entry that claimed to enforce it and did not would be worse than an honest gap |

### 4.5 Known diagnostics

| # | Diagnostic | Severity | Disposition |
|---|---|---|---|
| K-1 | `C:\src\flutter` (Flutter 3.24.5, 2024-11-13) remains on `PATH` | Medium | **Owner action.** Removing or upgrading a global SDK is a global machine mutation, forbidden without fresh authority (§4C). The repository no longer depends on it: `tool/` selects 3.47.5 explicitly. Recorded as risk R-5 |
| K-2 | No CI pipeline exists | High | **By design.** M1-S4. Gates G-4 and the §37.2 stages are local-only until then |
| K-3 | No PR merge authorization | — | G-12. PR left open |
| K-4 | `npm audit` clean, but no automated audit gate | Medium | M1-S4 stage 17 |
| K-5 | PostgreSQL 18 service reports `:5432 - rejecting connections` and its log shows `the database system is in recovery mode` | Medium | **Not touched.** M1-S3 owns Prisma and role separation. Starting, reconfiguring, or repairing a local database is outside this slice's allow-list |
| K-6 | `gh` CLI is not installed on this host | Low | Push uses git credentials, which work. Opening a PR through the API needs `gh` or a token; neither is fabricated here (§4F) |
| K-7 | Flutter reports 4 packages with newer versions incompatible with its constraints | Low | Normal for Flutter SDK-pinned transitive packages. No action |

### 4.6 Next slice

**M1-S2 — Backend skeleton.** NestJS 11, configuration validation, `/healthz` and
`/readyz`, the RFC 7807 problem+json error contract (§34.3), and structured request logging
(§13.1). Predecessor: this commit. Non-scope: Prisma and any schema (M1-S3), CI (M1-S4).

### 4.7 Rollback

`git branch -D codex/my-shop-m1-s1-monorepo-skeleton`. The slice is additive, contains no
migration, and `main` is untouched at `53f6aaa9`.

---

*End of M1-S1 slice record.*