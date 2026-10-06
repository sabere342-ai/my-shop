# MY SHOP — M1-S4 SLICE RECORD: CI PIPELINE

**Master plan:** `docs/governance/MY_SHOP_MASTER_PLAN.md` v1.1.0 — §40.4 (M1-S4), §37 (CI strategy), §40.1 (slice governance)
**Slice:** M1-S4
**Branch:** `codex/my-shop-m1-s4-ci-pipeline`
**Predecessor:** `3a95f44eff6f39b78bffe9e5d866d2104875888f` — M1-S3, branch `codex/my-shop-m1-s3-prisma-bootstrap`, pushed, in sync with remote, no PR (`gh` unavailable on this host)
**Declaration version:** 1.0.0 (declared before implementation work, per §40.1)

---

## 1. Predecessor state, verified not assumed

| Check | Value | Result |
|---|---|---|
| Repository root | `C:/dev/my-shop` | pass |
| Direct remote | `https://github.com/sabere342-ai/my-shop.git` | pass |
| Entry classification | `CASE_A_CONTINUATION_READY` | pass — clean worktree, empty stash, no active git operations |
| Current branch / HEAD at entry | `codex/my-shop-m1-s3-prisma-bootstrap` @ `3a95f44eff6f39b78bffe9e5d866d2104875888f` | pass — equals canonical M1-S3 token commit |
| Remote M1-S3 ref | `3a95f44eff6f39b78bffe9e5d866d2104875888f` | pass — remote unchanged after `git fetch --prune` |
| Predecessor parentage | `3a95f44` → `dcca491` (M1-S2) → `bcc853d` (M1-S1) | pass — stacked ancestry intact |
| Local `main` / `origin/main` | `53f6aaa9aded2ec2218cec3f8987675a824b70db` | pass — identical, no drift, ancestor of the stack |
| Other remote refs at entry | M0-P1 `701255f`, M0-P2 `0d25bd3`, M1-S1 `bcc853d`, M1-S2 `dcca491` | pass — all match recorded values |
| Worktree at start | clean (`git status --porcelain=v1 -uall` empty) | pass |
| Stash | empty | pass |
| Worktrees | main worktree + two M0 record worktrees under `%TEMP%` (predecessor slices, untouched) | pass |
| Repository visibility | **private**, default branch `main` | note — unauthenticated API cannot observe runs; the host's stored `git` credential for `github.com` (Git Credential Manager, `admin` permission) is used for API evidence only, never printed or committed |
| `gh` CLI | **not installed** | inherited limitation (M1-S1 K-6); the documented fallback is used, and no tooling is installed to bypass it |
| Actions service | enabled, `total_count = 0` at entry | pass — no prior runs exist; every run in §4.6 is fresh |

**Predecessor discipline.** This slice branches from `3a95f44` (M1-S3), **not** from `main`.
`main` carries only the M0-era state; starting there would discard the whole M1 stack.

**Merge policy.** No merge is performed. Gate **G-12** (§43.1) and CI gate **G-4** (§37.3)
require an explicit, separate owner authorization that this slice does not have. The M0 PRs
(#1, #2) remain open and untouched.

---

## 2. Declaration

### 2.1 `scope`

| # | Outcome |
|---|---|
| S-1 | `.github/workflows/ci.yml` exists: a GitHub Actions pipeline covering **§37.2 stages 1–18 as far as they are defined at M1-S4**, plus the mechanical offline-path guards (stages 23–24), triggered naturally by `push`, `pull_request`, and `workflow_dispatch`, with `permissions: contents: read` and every action **pinned to a full commit SHA** |
| S-2 | Stage 1 — a diff secret scan (`tool/ci/secret-scan.mjs`) that fails on credential-shaped additions and on tracked secret-file additions |
| S-3 | Stage 2 — a markdown lint and link check (`tool/ci/markdown-check.mjs`): trailing whitespace, tab indentation, ATX heading form, and **repository-internal link/anchor resolution**, with **zero new npm dependencies** |
| S-4 | Stages 11–15 — mechanical gates: import boundary per §6.3 (`import-boundary.mjs`), vocabulary ban per §2.2 (`vocabulary-ban.mjs`), localization and bidirectional gates per §6.8 (`localization-check.mjs`), design-system gate per §6.9 (`design-system-check.mjs`), journal immutability per §31.1 (`immutability-check.mjs`) |
| S-5 | CI gate **G-6** (§37.3) — migration immutability: a migration that exists at the diff base may not be modified or deleted (`migration-immutability.mjs`) |
| S-6 | Stages 23–24 — offline-path mechanical guards (`offline-guards.mjs`): no outbox delete path outside the outbox module; no local write outside the `applyRemoteWithoutOutbox` entry point (heuristic form, declared in §3.7) |
| S-7 | Stage 5/6/7 — backend unit tests, and integration + database acceptance **against a real PostgreSQL 18 service container** in CI, including the migration-from-empty and idempotent re-run rehearsal |
| S-8 | Stage 16 — contract drift gate **as far as defined at M1-S4**: the composite `tsc --build` compile (ADR-001); the generator itself is M1-S6 |
| S-9 | Stage 17 — the automated dependency audit gate (`npm audit --audit-level=high`), resolving K-4/K-5 of the predecessor records |
| S-10 | Stage 18 — Flutter **release** builds for Windows and Android in CI, on pinned Flutter 3.47.5 |
| S-11 | Branch protection on `main` (**G-1…G-4**, §37.3): every CI job registered as a required status check, required reviews with code owners, no force push, no branch deletion, `enforce_admins`; `.github/CODEOWNERS` names the owner |
| S-12 | Local/CI parity: root `package.json` gains `gates` scripts wired into `verify` and `verify:node`, so every gate that CI runs is runnable locally with one command |
| S-13 | Documentation: README state table and CI section; this slice record |
| S-14 | *(amended into scope during implementation — see D-11)* `tool/pinned-sdk.mjs` parses the JSON report from the first `{` in `flutter --version --machine` output, so a cold clone (every fresh CI runner) can be warmed and pin-verified instead of crashing on bootstrap progress text |

### 2.2 `non_scope`

Named explicitly, per §40.1.

| Not touched | Reason |
|---|---|
| Any business/domain table, model, or RLS policy | M2+; §40.4, §2.4 anti-scope rule |
| Flutter app skeleton, `go_router`, Riverpod, `core/ui` components, ARB catalogs, screens | M1-S5 (§40.4) |
| Contract **generation** and the generated drift gate | M1-S6 (§40.4); stage 16 is compile-time drift only at this slice |
| Drift local schema, outbox, sync transport, T-O behavioural tests | M1b (§40.5); §37.2 **stages 19–22** are declared in the workflow but cannot run before those artifacts exist |
| Coverage **thresholds** in CI (§36.2 / CI gate G-5) | The gated trees (`src/**/domain`, `src/modules`) do not exist yet; jest refuses glob thresholds with no coverage data. CI runs `--coverage` so the numbers are visible; arming the threshold arrives with the first domain/module code |
| Any npm dependency addition or upgrade | This slice needs none; `package-lock.json` must stay byte-identical |
| Any edit to `MY_SHOP_MASTER_PLAN.md` | §43.4 — no decision changed |
| Merge to `main`, PR merges, auto-merge, force push, history rewrite, predecessor commits | Owner boundary; G-12, G-4 |
| Closing or modifying the historical PRs (#1, #2) | Owner boundary |
| Deployment (§37.4), secret managers, branch-protection weakening | Out of M1 entirely |
| Installing `gh` or any global tool | Host limitation is handled by the documented fallback, not by mutating the machine |

### 2.3 `allowed_paths`

```
.github/**
tool/**
package.json
README.md
docs/governance/MY_SHOP_M1_S4_CI_PIPELINE_SLICE_RECORD.md
```

Nothing outside this list is modified. `package-lock.json`, `services/api/**`,
`apps/desktop/**`, `packages/**`, `MY_SHOP_MASTER_PLAN.md`, and every predecessor record are
**read-only** for this slice. (No dependency is added, so the lockfile has no reason to change.)

### 2.4 `tests`

| Level | Requirement |
|---|---|
| Gate positives | Every `tool/ci/*` gate passes against the committed tree |
| Gate negatives | **Every** new gate script is deliberately violated and observed exiting non-zero; a guard never seen failing is not a guard (M1-S1 §4.3 precedent) |
| Static analysis | `tsc --build` clean in all three TypeScript workspaces (stage 4; `--build` is the composite form of §37.2's `tsc --noEmit`, per M1-S1 D-4) |
| Lint / format | `eslint` and `prettier --check` clean (stage 3) |
| Unit | API unit project + contracts + testkit Jest suites pass (stage 5) |
| Integration + database | `integration` and `database` Jest projects pass against a **real PostgreSQL 18** (stages 6, 7) — no skips |
| Flutter | `flutter analyze --fatal-infos` (stage 8), `flutter test` including any golden (stages 9, 10) |
| Release builds | `flutter build windows --release` and `flutter build apk --release` (stage 18), locally and in CI |
| Audit | `npm audit --audit-level=high` exits 0 — 0 high (stage 17); the 20 moderate advisories pre-date this slice |
| Remote acceptance | The workflow runs green on the exact M1-S4 head commit; a deliberately failing commit produces a **red** run; a PR carrying that failing check reports **merge blocked** while branch protection is active |
| Security | No secret in the diff; workflow least-privilege; no unpinned action; no dependency change |

### 2.5 `acceptance_criteria`

Binary and checkable.

| # | Criterion |
|---|---|
| AC-1 | `.github/workflows/ci.yml` maps every §37.2 stage to a job/step or to an explicitly declared not-yet-defined entry (stages 19–22), and maps §37.3 gates G-6 to a real check |
| AC-2 | The workflow runs green (all required jobs) on the exact M1-S4 head commit on the remote — run identity recorded; local PASS is reported separately from remote PASS |
| AC-3 | A deliberately violating commit on a demonstration branch produces a **failed** workflow run (red), proving the gates are not ceremonial |
| AC-4 | With branch protection active on `main`, a PR whose head carries that failing check reports **merge blocked** (`mergeable_state = blocked`) — the §40.4 key acceptance, "a deliberately failing check blocks a PR" |
| AC-5 | Branch protection on `main`: required status checks = every CI job name, `strict: false` (stack branches cannot be rebased), required reviews ≥ 1 with code owners, `enforce_admins: true`, force pushes and deletions refused |
| AC-6 | Fresh local gates all pass: toolchain, gates, format, lint, typecheck, 134+ tests incl. real PostgreSQL, build, flutter analyze/test, both release builds, audit 0 high |
| AC-7 | Each of the nine gate scripts demonstrated failing on a targeted violation (negative evidence recorded in §4.4) |
| AC-8 | `package-lock.json` byte-identical to the predecessor state; zero npm dependencies added |
| AC-9 | No secret, credential, connection URL with a password, or `.env` in the diff; no secret value in the workflow; `permissions: contents: read` |
| AC-10 | No file outside `allowed_paths` is modified |
| AC-11 | The Master Plan is byte-identical to its M1-S3 state |
| AC-12 | Remote lock: local HEAD equals `origin/codex/my-shop-m1-s4-ci-pipeline`, ahead/behind 0/0, worktree clean; M1-S3, M1-S2, and `origin/main` refs unchanged |

### 2.6 `migration_impact`

**None.** No schema, no migration, no seed. G-6 makes existing migrations immutable, which
this slice strengthens rather than changes. Forward-only discipline (§35.1) is unaffected.

### 2.7 `security_impact`

No endpoint, permission, or data class changes. Additions are protective: branch protection on
`main` (G-1…G-4), a code-owner review requirement (G-3), an automated credential scan (stage 1),
and an automated dependency audit (stage 17). Workflow supply chain: only official `actions/*`,
each pinned to a full commit SHA; `permissions: contents: read`; no secrets are provisioned to
the workflow. The host's stored git credential is used only for read/branch-protection/PR API
calls against this repository and is never printed, exported to a file, or committed.

### 2.8 `rollback`

Delete the branch and the two commits (additive only); delete the demonstration artifacts
(already removed); remove the branch-protection rule and `CODEOWNERS` if the owner wants the
pre-slice posture back. `main` stays at `53f6aaa9` throughout; no database object exists.

### 2.9 `publication_gate`

| Field | Value |
|---|---|
| PR target | `codex/my-shop-m1-s3-prisma-bootstrap` (the stack head) |
| Required checks | stages 1–18 of §37.2 as far as they are defined at this slice, plus stages 23–24 and G-6 |
| Merge | **Owner only.** G-12 and G-4 apply. No automated merge exists, and this slice does not enable one |

---

## 3. Design decisions

| # | Decision | Why |
|---|---|---|
| D-1 | One `fast-checks` job carries the ordered fast stages (preamble, 1, 2, 3, 4, 8, 9, 10, 11–15, 23, 24, G-6) as ordered *steps*; the six slower jobs (`backend-unit`, `backend-integration-database`, `contract-drift`, `dependency-audit`, `flutter-build-windows`, `flutter-build-android`) run behind `needs: fast-checks` | §37.2's rule is "later stages are skipped when an earlier one fails" — steps give that for free inside the fast job, `needs` gives it across jobs, and the parallel slow set keeps the pipeline fast |
| D-2 | Every job name is registered as a required status check. A job removed from the workflow stops reporting, and a required check that never reports **blocks** the PR | Fail-closed: deleting or renaming a gate cannot silently become approval |
| D-3 | Diff base: `CI_BASE_REF` (PR base sha, else push's `before` sha, all-zero rejected) → `merge-base origin/main` → `HEAD~1` → empty tree | In CI a gate scans exactly the change under review; locally it scans the whole stacked branch a PR would show; both directions are defined even in a fresh clone |
| D-4 | Gate scripts are hand-written Node ESM under `tool/ci/` with **zero npm dependencies** | AC-8: `package-lock.json` must stay byte-identical. The markdown linter, anchor slugifier, and scanners are small enough to own; a lint dependency would have bought a lockfile change this slice does not want |
| D-5 | The secret scan allows exactly nine named fixture values (`pass`, `password`, `secret`, `hunter2`, `old-password`, `new-password`, `do-not-log-this`, `do-not-log-that`, `do not serialise me`) plus any `<…>` placeholder, and **never prints matched content** | The predecessor suites assert on those literals and are outside this slice's `allowed_paths`; the eventual stack→main PR will scan them. Itemised values keep the allowlist visible; not echoing matches keeps §13.6 true even while failing |
| D-6 | The offline-path and journal-immutability gates strip comments before matching | Prose that *describes* `DELETE FROM outbox` must not be a finding. Stripping can only miss a finding on a pathological line, never invent one — the gate errs toward no false accusation |
| D-7 | A gate whose subject does not exist yet prints "armed (N files scanned)" and exits 0 | M1-S1 precedent: a guard that never ran is not a guard, so vacuity is stated, not hidden. Every vacuous gate still scans something and says what |
| D-8 | Stages 19–22 are absent from the workflow with the reason written into its header; stage 16 is the composite `tsc --build` (ADR-001's drift proof), stage 17 is `npm audit --audit-level=high` | §40.4's contract is "as far as defined at this slice". The M1b artifacts (device provisioning, device tests, golden review, adversarial sync interruption) and the M1-S6 generator do not exist; pretending otherwise would be a decorative stage |
| D-9 | Coverage thresholds (§36.2 / CI gate G-5) are **not** armed. The experiment stands: jest fails glob thresholds when the gated trees have no coverage data, and `src/**/domain` + `src/modules/**` do not exist yet | Arming them now would make every run red for a condition M2 introduces. CI runs `--coverage` when that arrives; the deferral is recorded here rather than lost |
| D-10 | The database job runs `db.mjs test-setup` as an explicit stage-7 prerequisite before stage 6 | A fresh `postgres:18` container has no roles and no `my_shop_test`; `test-setup` is the sanctioned path (drop/create/bootstrap/deploy) and the suite re-runs it itself, so the job state matches a local acceptance run exactly |
| D-11 | `tool/pinned-sdk.mjs` was amended into scope (S-14): cold clones print bootstrap progress on stdout before the JSON report | Discovered by the first `setup-flutter.mjs` run — without the fix every CI job dies at the pin preamble. The change is inside `allowed_paths`, preserves warm-SDK behaviour byte-for-byte, and is the smallest fix that keeps stage-0 honest |
| D-12 | Branch protection: `strict: false`, required reviews ≥ 1 with code owners, `enforce_admins: true`, force push and deletion refused, `contents: read` workflow permission, actions SHA-pinned | The stack branches cannot be rebased (`strict` would demand it), so `strict` stays false — that is a deliberate stack fact, not a weakening. Protection implements §37.3 G-1…G-4, which §40.4 *requires* this slice to add; §11's "do not alter the plan's protections" forbids removing safeguards, not installing the ones the plan mandates |
| D-13 | The negative-verification demo uses a markdown whitespace violation on a temporary branch — never credential-shaped text | A red run must be provable without putting even a fake token into pushed history. Trailing whitespace fails stage 2 exactly as designed and is inert |
| D-14 | Flutter on CI: clone the pinned tag into `~/flutter-<pin>` via `tool/ci/setup-flutter.mjs`, cache keyed on `.tool-versions`, `MY_SHOP_FLUTTER_ROOT` exported through `$GITHUB_ENV` | Mirrors the host's resolution rules (R-5): no PATH mutation, no floating `stable` channel, and a changed pin cannot reuse the old SDK because the directory name and cache key both carry the version |

---

## 4. Results

### 4.1 Implementation inventory (all within `allowed_paths`)

| Path | Role |
|---|---|
| `.github/workflows/ci.yml` | The pipeline (stages 1–18, 23, 24, G-6; 19–22 declared absent) |
| `.github/CODEOWNERS` | Owner for every path (G-3) |
| `tool/ci/shared.mjs` | Diff-base resolution, file walking, comment stripping, verdict printing |
| `tool/ci/secret-scan.mjs` | Stage 1 |
| `tool/ci/markdown-check.mjs` | Stage 2 |
| `tool/ci/import-boundary.mjs` | Stage 11 (§6.3) |
| `tool/ci/vocabulary-ban.mjs` | Stage 12 (§2.2) |
| `tool/ci/localization-check.mjs` | Stage 13 (§6.8) |
| `tool/ci/design-system-check.mjs` | Stage 14 (§6.9) |
| `tool/ci/immutability-check.mjs` | Stage 15 (§31.1) |
| `tool/ci/offline-guards.mjs` | Stages 23–24 (§38.12.1, heuristic v1) |
| `tool/ci/migration-immutability.mjs` | Gate G-6 (three checks: worktree, history rewrite, deletion) |
| `tool/ci/setup-flutter.mjs` | CI SDK bootstrap: clone pinned tag, export, warm, verify |
| `tool/pinned-sdk.mjs` | Parser hardening for cold clones (S-14 / D-11) |
| `package.json` | `gate:*` + `gates`, wired into `verify` and `verify:node` (S-12) |
| `README.md` | State table, Getting started, new "Continuous integration" section |

### 4.2 Negative verification — every gate observed failing (AC-7)

Each row is a deliberate violation, the observed finding, and exit code 1; the worktree was
restored afterwards and re-verified clean (`git status` back to this slice's 17 files).

| Gate | Violation | Observed finding |
|---|---|---|
| `secret-scan` | staged line `ghp_A…` (36×A) in a new file | `negtest-secret.md:1: github-token` |
| `markdown-check` | trailing whitespace; `#nospace`; dead relative link | `:3 trailing-whitespace`, `:4 heading-form`, `:4 dead-link — target missing/nope.md does not exist` |
| `import-boundary` | `lib/features/sales/domain/negtest.dart` importing `package:flutter/material.dart` | `negtest.dart:1: domain-vs-flutter` |
| `vocabulary-ban` | string `'Ledger journal entries'`, then string `'قيود'` | `banned-term-en` on line 1; `banned-term-ar — stem "قيد"` |
| `localization-check` | `Text('Hello world')`; `Alignment.centerLeft`; `EdgeInsets.only(left:, right:)`; `EdgeInsets.fromSTEB` | 5 findings: `hardcoded-text`, `physical-alignment`, `physical-edge-only` ×2, `physical-edge-inset` |
| `design-system-check` | `Colors.red`; `fontSize:`; `Color(0xFF000000)` outside `core/ui` | 3 findings: `raw-colour`, `raw-font-size`, `raw-colour-literal` |
| `immutability-check` | `prisma.journal.update(…)`; `DELETE FROM journal_entries` in a template; `UPDATE journal_entries…` in a comment | `journal-mutation-prisma` line 1, `journal-mutation-sql` line 3 — the *commented* UPDATE on line 2 correctly not flagged (D-6) |
| `offline-guards` | `db.into(db.outbox).insert({})` in `core/offline/`; `outboxTable.delete()` in `features/sales/` | stage 24 `local-write-outside-apply` ×2, stage 23 `outbox-delete-path` ×1 |
| `migration-immutability` (check 1) | appended a line to `0001_schema_skeleton/migration.sql` | `migration-uncommitted-change — git reports status M against HEAD`; restored with `git checkout --`, status clean |
| `migration-immutability` (check 2) | committed the rewrite on local temp branch `negtest-g6` (worktree clean — the CI situation) | `migration-rewritten — bytes differ from the introducing commit 3a95f44eff6f`; branch deleted, HEAD back at `3a95f44` |

### 4.3 Positive local battery (fresh this slice)

| Check | Result |
|---|---|
| `npm run toolchain:verify` | PASS — node 22.22.3, npm 10.9.8, flutter 3.47.5, dart 3.13.4 |
| `npm run gates` | PASS — 9/9 gates |
| `npm run format:check` / `lint` / `typecheck` | PASS / PASS / PASS (three workspaces) |
| `npm run test` | PASS — **134 tests** (api 125 incl. real-PostgreSQL database acceptance, contracts 4, testkit 5) |
| `npm run build` | PASS — composite `tsc --build` in dependency order |
| `npm audit --audit-level=high` | exit 0 — **0 high**, 20 moderate inherited (unchanged from M1-S3: `ts-jest` → `jest` → `sprintf-js` chain) |
| `npm run flutter:analyze` (`--fatal-infos`) | PASS — "No issues found!" |
| `npm run flutter:test` | PASS — 2 tests |
| `flutter build windows --release` | PASS — exit 0, `build\windows\x64\runner\Release\my_shop_desktop.exe` (40.6 s) |
| `flutter build apk --release` | PASS — exit 0, `app-release.apk` 40.7 MB (179.6 s) |
| `package-lock.json` | byte-identical to predecessor (untouched; AC-8) |
| `MY_SHOP_MASTER_PLAN.md` | byte-identical to predecessor (untouched; AC-11) |
| Worktree scope | exactly the 17 files of §4.1, all inside `allowed_paths` (AC-10) |

### 4.4 Remote evidence — runs, protection, demonstration, PR

*Pending: filled in the evidence commit after the remote steps execute. Nothing in this
section may be claimed before it is observed against the API.*

### 4.5 Remote lock

*Pending: final `git status` / `ls-remote` proof, evidence commit.*

---

*Declaration ends here. §3 (design decisions) and §4 (results) are completed as the slice
executes, before commit.*
