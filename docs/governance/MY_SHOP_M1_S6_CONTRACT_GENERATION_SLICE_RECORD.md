# MY SHOP — M1-S6 SLICE RECORD: SHARED CONTRACT GENERATION AND DRIFT CHECK

**Master plan:** `docs/governance/MY_SHOP_MASTER_PLAN.md` v1.1.0 — §40.4 (M1-S6), §6.2 (repository
structure: contract generated once from the backend, consumed as a package), §7.1 (stack: OpenAPI
generated from decorators, published as a CI artifact), §34.1 and §34.3 (versioning and error
contract), §36.2 (contract test row), §37.2 (stage 16 — contract generation and drift check),
§37.3 / §43.1 (gates G-7, G-1…G-13), §40.1 (slice governance), ADR-001
**Slice:** M1-S6
**Branch:** `codex/my-shop-m1-s6-contract-generation`
**Predecessor:** `26b7c14bca0c0e41ebbacd0e203973d5aebc711e` — M1-S5, branch
`codex/my-shop-m1-s5-app-skeleton`, pushed, in sync with remote, PR #5 open (base M1-S4, not merged)
and untouched
**Declaration version:** 1.0.0 (declared before implementation work, per §40.1)

---

## 1. Predecessor state, verified not assumed

| Check | Value | Result |
|---|---|---|
| Repository root | `C:/dev/my-shop` | pass |
| Direct remote | `https://github.com/sabere342-ai/my-shop.git` | pass |
| Entry classification | `CASE_A_CONTINUATION_READY` | pass — clean worktree, empty stash, no active git operations |
| Current branch / HEAD at entry | `codex/my-shop-m1-s5-app-skeleton` @ `26b7c14bca0c0e41ebbacd0e203973d5aebc711e` | pass — equals canonical M1-S5 token commit |
| Remote M1-S5 ref | `26b7c14bca0c0e41ebbacd0e203973d5aebc711e` | pass — unchanged after `git fetch` |
| Predecessor parentage | `26b7c14` → `7b81c6f` (M1-S5) → `3fcff8c` (M1-S4) → `906d0e8` (M1-S4) → `3a95f44` (M1-S3) → `dcca491` (M1-S2) → `bcc853d` (M1-S1) | pass — stacked ancestry intact |
| Local `main` / `origin/main` | `53f6aaa9aded2ec2218cec3f8987675a824b70db` | pass — identical, unchanged, ancestor of the stack |
| Other remote refs at entry | M0-P1 `701255f`, M0-P2 `0d25bd3`, M1-S1 `bcc853d`, M1-S2 `dcca491`, M1-S3 `3a95f44`, M1-S4 `3fcff8c` | pass — all match recorded values |
| Worktree at start | clean (`git status --porcelain` empty) | pass |
| Stash | empty | pass |
| Worktrees | main worktree + two M0 record worktrees under `%TEMP%` (predecessor slices, untouched) | pass |
| Repository visibility | `public`, default branch `main` (owner-authorized in M1-S4, D-15) | pass — unchanged by this slice |
| M1-S5 remote CI on the predecessor SHA | runs `37569514679` (push) and `37569518949` (pull_request), head `26b7c14`, `completed / success` | pass — both runs green on the exact predecessor commit |
| PR #5 | open, base `codex/my-shop-m1-s4-ci-pipeline`, head `codex/my-shop-m1-s5-app-skeleton`, `mergeable=true`, `mergeable_state=clean`, not merged | pass — read only, never modified |
| Branch protection on `main` | required checks = the 7 job names (`fast-checks`, `backend-unit`, `backend-integration-database`, `contract-drift`, `dependency-audit`, `flutter-build-windows`, `flutter-build-android`), `strict=false`, `enforce_admins=true`, 1 approval + code owners, force push refused, deletion refused, conversation resolution required | pass — verified by API before any mutation |
| `gh` CLI | not installed | inherited limitation (M1-S4, M1-S5); the documented fallback (host's stored git credential, used only for API evidence) is used; no tooling is installed |

**Predecessor discipline.** This slice branches from `26b7c14` (M1-S5), **not** from `main` and
**not** from an earlier stack commit. `main` carries only the M0-era state; starting there would
discard the whole M1 stack.

**Merge policy.** No merge is performed. Gate **G-12** (§43.1) and CI gate **G-4** (§37.3)
require an explicit, separate owner authorization that this slice does not have. PR #5 and all
historical PRs remain open and untouched. §40.4's stage coverage and the stacked-branch discipline
recorded in M1-S1 through M1-S5 permit this slice to be built and opened as a PR on top of the
unmerged M1-S5 head.

---

## 2. Declaration

### 2.1 `scope`

| # | Outcome |
|---|---|
| S-1 | Decorator-based OpenAPI generation (§7.1): `@nestjs/swagger` `11.4.7` added to `@my-shop/api` save-exact (peer-compatible with the backend's NestJS `11.2.7`; official `@nestjs/*` family only), plus a document builder under `services/api/src/common/openapi/` that boots the **real** `AppModule` headlessly — no listener, no `app.init()`, therefore no database connection — and returns the OpenAPI document produced from controller and DTO decorators (ADR-001) |
| S-2 | The existing probe surface becomes the first annotated contract (§40.4, §34.3): `/healthz` and `/readyz` carry response/status decorations, and `LivenessReport`, `ReadinessReport`, `ReadinessDetail`, and `ProblemDocument` become decorated **classes** — the single decorated source of truth for their schemas, with structurally identical shapes and unchanged response bytes (M1-S2 behaviour stays green) |
| S-3 | Committed contract artifacts (§6.2 "generated API contract types, single source of truth"): `packages/contracts/openapi.json` (the document) and `packages/contracts/src/generated/schemas.ts` (TypeScript types **derived from that document**) are both generated and committed; `packages/contracts/src/index.ts` re-exports them; `CONTRACT_VERSION` advanced past `0.1.0` per the file's own M1-S6 instruction |
| S-4 | Derivation emitter with zero runtime dependencies: a pure function `packages/contracts/src/codegen/emit.ts` turning the document's schema components into deterministic, alphabetically ordered TypeScript — throwing on any schema construct it does not support rather than ever emitting `any` (ESLint `no-explicit-any` is `error`) — with a Jest spec, and a CLI wrapper that formats the output through the repository's Prettier config resolved against the real committed target path |
| S-5 | Drift gate (§37.2 stage 16, G-7): `tool/contract/generate.mjs` regenerates **both** artifacts into a fresh temporary directory and byte-compares them with the committed files — `--check` exits non-zero naming the drifting file without mutating the tree; the default mode writes the artifacts in place. Root scripts `contracts:generate` and `contracts:check`; the check chains the composite build first (D-5) |
| S-6 | CI stage 16 grows exactly as M1-S4 declared: the `contract-drift` job's stage-16 step runs `npm run contracts:check`, and the generated `openapi.json` is published as a CI artifact (§7.1) via `actions/upload-artifact` pinned to the full commit SHA of its `v7.0.1` tag (D-6). Job names and every other workflow line unchanged |
| S-7 | Tests (§36.2 contract row): document-builder specs (determinism across builds, `/healthz` + `/readyz` present, `ProblemDocument` schema complete with the full `ErrorCode` enum, clean close with no leaked handles); emitter specs including unsupported-schema failure proofs; generated-contract compile/runtime assertions; drift-gate positive and negative proofs (§2.4) |
| S-8 | Local parity for stage 16 (M1-S4 S-12): `verify` and `verify:node` gain `contracts:check`, so the stage CI runs is runnable locally through the same one-command pattern as the other stages |
| S-9 | Documentation: README current-state, CI, and getting-started rows; this slice record |

### 2.2 `non_scope`

Named explicitly, per §40.1.

| Not touched | Reason |
|---|---|
| Flutter `core/api` REST client, Dart consumption layer, `apps/desktop/**` | Not in the §40.4 M1-S6 row ("Shared contract generation and drift check"); the M1-S5 record's loose attribution does not widen the plan's row. The committed document and types are exactly what that layer consumes when a feature slice exists |
| M1b sync contracts — mutation payload schema, `mutation_id`, sync state enum, error codes | M1b-S2 (§40.5) has its own row and key acceptance |
| Any new endpoint, route, request/response behaviour change, or backend business logic | Decorations and type-shape conversion only; `/healthz` and `/readyz` response bytes stay byte-identical and the M1-S2 tests prove it unchanged |
| Schema, migration, seed, Prisma files | None exist for this slice; G-6/G-7 remain vacuously satisfied and historically immutable |
| `freezed` / `json_serializable`, any Dart code generation | §6.7 binds them to immutable domain and DTO Dart types that do not exist yet; `build_runner` remains the client's only code generator |
| Authentication schemes, security requirements, permission and tenant declarations in OpenAPI | No authentication exists until M2; §34.1's per-endpoint declaration requirement applies when endpoints gain permissions. The two probes are unauthenticated by design (M1-S2), and the document will state exactly that |
| `packages/testkit/**`, business modules, `services/api/src/modules` | No bounded context exists in M1 |
| Workflow job names, required checks, branch protection, `.github/workflows/**` beyond the stage-16 step and the artifact upload inside the `contract-drift` job | M1-S4 owns the CI platform; S-6 is the growth M1-S4 explicitly declared for stage 16 |
| `MY_SHOP_MASTER_PLAN.md`, predecessor slice records | §43.4 — no decision changed; byte-identical |
| Merging PR #5 or this slice's PR, auto-merge, force push, history rewrite | Owner boundary; G-12, G-4 |
| Repository visibility | Owner decision D-15 (M1-S4); unchanged |
| Installing `gh` or any global tool | Host limitation handled by the documented fallback, not by mutating the machine |

### 2.3 `allowed_paths`

```
.github/workflows/ci.yml
README.md
package.json
package-lock.json
services/api/package.json
services/api/src/common/errors/problem.ts
services/api/src/common/health/**
services/api/src/common/openapi/**
services/api/scripts/openapi.mjs
packages/contracts/package.json
packages/contracts/src/**
packages/contracts/scripts/**
packages/contracts/openapi.json
tool/contract/**
docs/governance/MY_SHOP_M1_S6_CONTRACT_GENERATION_SLICE_RECORD.md
```

Nothing outside this list is modified. `package-lock.json` changes are limited to the
`@nestjs/swagger` subtree (D-1). `services/api/package.json` carries only that dependency (and,
if useful, a local convenience script); `packages/contracts/package.json` only script entries.
`tool/ci/**`, `tool/verify-toolchain.mjs`, `services/api/src/app.*`, `main.ts`, logging, config,
`prisma/**`, `testkit/**`, `apps/**`, every predecessor record, and `MY_SHOP_MASTER_PLAN.md` are
**read-only** for this slice.

### 2.4 `tests`

| Level | Requirement |
|---|---|
| Gate positives | All nine `tool/ci/*` gates pass against the committed tree with the new sources present (stages 1, 2, 11–15, 23–24, G-6), plus `format:check`, `lint`, `typecheck` over the new TypeScript |
| Drift positive | `npm run contracts:check` exits 0 on the committed tree; `npm run contracts:generate` is idempotent — a second run changes no bytes |
| Drift negatives (local) | (a) a byte perturbed in committed `openapi.json` makes `contracts:check` exit non-zero naming that file, and the file is restored byte-identically; (b) a backend decoration changed without regeneration makes the regenerated document differ from the committed one → exit non-zero, restored → green again. Both prove G-7 non-vacuous |
| Unit (api) | Document builder: two builds are deeply equal; `/healthz` and `/readyz` are present with their response schemas; `components.schemas.ProblemDocument` carries the full `ErrorCode` enum; the builder closes its application context with no leaked handles. Existing problem-shape and health unit tests stay green |
| Unit (contracts) | Emitter: golden emissions for object, enum, array, `$ref`, and optional properties; property order and `required` respected; an unsupported schema construct throws instead of emitting `any`; `index.ts` re-export and `CONTRACT_VERSION` spec |
| Contract row (§36.2) | "Response shape matches the generated contract" — the builder spec asserts the document's schemas *are* the decorated classes the handlers return, at 100% of the existing surface |
| Stage 5 suites | API unit, contracts, and testkit suites exit 0; the database suites are CI-run (§36.1 T-5 — no silent skips, and this host has no `.env` with the three URLs) |
| Static analysis | `flutter analyze --fatal-infos` and `flutter test` exit 0 — Flutter is untouched but cheap to prove (M1-S5 baseline) |
| Audit | `npm audit --audit-level=high` exits 0 after the dependency addition (stage 17) |
| Remote negative demo | A deliberately drifting branch is pushed, the workflow shows a **failed** `contract-drift` run, the run and job are captured, and the demo branch is deleted from remote and local — the literal "Drift fails CI" proof (§40.4 key acceptance; M1-S4 negdemo precedent) |
| Remote acceptance | Workflow green on the exact final M1-S5-successor SHA with all seven required checks; PR stacked on M1-S5 opens and stays unmerged; branch protection unchanged |

### 2.5 `acceptance_criteria`

Binary and checkable.

| # | Criterion |
|---|---|
| AC-1 | §40.4 M1-S6 row delivered: shared contract generation exists (OpenAPI document generated from NestJS decorators + TypeScript types derived from it, both committed) and stage 16 runs the byte-level drift check in CI — no workflow job renamed, added, or removed |
| AC-2 | Key acceptance (§40.4): **drift fails CI** — a pushed commit whose committed contract disagrees with the generated one produces a failed `contract-drift` run (captured with run/job identifiers), and locally `contracts:check` exits non-zero naming the drifting file in both negative scenarios of §2.4 |
| AC-3 | `npm run contracts:check` exits 0 on the committed tree; `npm run contracts:generate` twice over leaves both artifacts byte-identical |
| AC-4 | API unit, contracts, and testkit suites exit 0 locally; `format:check`, `lint`, and `typecheck` exit 0 over the new sources |
| AC-5 | All nine gate scripts exit 0; no gate, workflow job, or required check renamed, disabled, or softened; `flutter analyze --fatal-infos` and `flutter test` exit 0 |
| AC-6 | `MY_SHOP_MASTER_PLAN.md` byte-identical to the M1-S5 predecessor (SHA-256 `E7B50B24B6D5A358FFC2965AED3A7EFAD03B32E34BE0A841A9148B22D7178688`); all predecessor slice records untouched |
| AC-7 | No migration created, modified, or deleted; historical migration bytes unchanged (G-6, G-7) |
| AC-8 | `npm audit --audit-level=high` exits 0; exactly one dependency added — `@nestjs/swagger` `11.4.7`, inside the existing `@nestjs/*` family — and the `package-lock.json` diff is limited to that dependency's subtree |
| AC-9 | No secret, credential, or `.env` in the diff; `.env.example` untouched and placeholder-only |
| AC-10 | No file outside `allowed_paths` modified (G-5) |
| AC-11 | Remote CI green on the **exact** final slice SHA with all seven required checks |
| AC-12 | PR created with base `codex/my-shop-m1-s5-app-skeleton`, head `codex/my-shop-m1-s6-contract-generation`, open and unmerged; PR #5 and all predecessor PRs untouched; branch protection unchanged |
| AC-13 | Remote lock: local HEAD equals `origin/codex/my-shop-m1-s6-contract-generation`, ahead/behind `0/0`, worktree clean; `origin/main` and every predecessor ref unchanged |
| AC-14 | The negative-demo branch produced a red `contract-drift` run and was then deleted from the remote and the local repository |

### 2.6 `migration_impact`

**None.** No schema, no migration, no seed, no Prisma file touched. The document builder runs
without `app.init()`, so Prisma never connects during generation, and the generated artifacts are
consumed by tooling and CI, not by the application at runtime. G-6/G-7 remain vacuously satisfied
and historically immutable.

### 2.7 `security_impact`

One dependency is added: `@nestjs/swagger` `11.4.7`, official `@nestjs/*` family, save-exact,
peer-matched to the already-audited NestJS `11.2.7`, with its transitive tree reviewed by the
stage-17 audit (0 high allowed). No endpoint, permission, data class, or credential is added or
changed: the annotated surface is the two unauthenticated probes and the RFC 7807 problem shape
that already exist (M1-S2). Document generation performs no network I/O, opens no listener, and
connects to no database; generated output contains only the annotated API surface — no secrets
(stage 1 gate remains armed over the whole diff). The workflow keeps `permissions: contents: read`
and SHA-pinned actions only.

### 2.8 `rollback`

Additive slice: delete the branch and its commits to return to `26b7c14`. The dependency is
removed with the lockfile revert; the committed artifacts have no runtime consumer that could
break (the backend never reads `openapi.json`, and `packages/contracts` consumers only gain
exports). `main` stays at `53f6aaa9` throughout; no migration exists to reverse.

### 2.9 `publication_gate`

| Field | Value |
|---|---|
| PR target | `codex/my-shop-m1-s5-app-skeleton` (the stack head — stacked PR, PR #5 stays open) |
| Required checks | the 7 CI job names of the M1-S4 pipeline, unchanged |
| Merge | **Owner only.** G-12 and G-4 apply. No automated merge exists, and this slice does not enable one |
| Negative-demo branch | `negdemo/m1-s6-drift` — pushed solely for AC-2/AC-14 evidence, given no PR, and deleted from remote and local at closeout (M1-S4 `negdemo/m1-s4-checks` precedent) |

---

## 3. Design decisions

**D-1 — `@nestjs/swagger`, version-matched to the backend's Nest major.** §7.1 mandates "OpenAPI
generated from decorators", so a decorator source is in-stack, not a new package family: the
dependency is `@nestjs/swagger` `11.4.7`, save-exact, whose peers (`@nestjs/core ^11.0.1`) are
satisfied by the backend's NestJS `11.2.7`. The latest major (`12.x`) peers `@nestjs/core ^12`
and is therefore rejected as incompatible; no other npm dependency is added, keeping the
"dependency additions stay in an existing package family unless the owner expands the stack"
discipline. `package-lock.json` changes are confined to this dependency's subtree (AC-8).

**D-2 — Decorated classes are the single source of truth.** `ProblemDocument` converts from an
interface to a class with a structurally identical shape, and the readiness/liveness report types
follow. No parallel hand-written DTO is introduced: ADR-001 requires the document to come from
the source the handlers actually use, which is what makes the §36.2 contract row
("response shape matches the generated contract") enforceable rather than decorative.

**D-3 — Headless document build, no lifecycle side effects.** The builder creates the Nest
application context with the validated configuration and calls `SwaggerModule.createDocument`
without `app.init()` or `listen()`: `PrismaService.onModuleInit` never runs, no port opens, no
database is required, and generation works with an empty environment. The CLI flushes its output
synchronously and exits explicitly, so a generation run is bounded on any host and in CI.

**D-4 — Byte-level drift, regenerate into a temp directory.** The gate regenerates both artifacts
into a fresh temporary directory and compares exact bytes with the committed files. Generation is
deterministic — sorted schema names, no timestamps, `JSON.stringify` for the document, and
Prettier with `endOfLine: 'lf'` resolved against the real committed paths so check mode and write
mode produce identical bytes. Any difference is therefore real drift, never line-ending or
formatting noise, and `--check` never mutates the tree (`.gitattributes` `* text=auto eol=lf`
already keeps worktree files LF).

**D-5 — Stage 16 keeps its compile proof.** `contracts:check` chains the composite `tsc --build`
(the ADR-001 compile-time drift proof M1-S4 shipped) before the byte comparison, so the CI step
remains a strict superset of the previous stage 16 and the `contract-drift` job keeps a single
declared command. The job stays out of `gates`/`fast-checks` ordering exactly as at M1-S4; local
parity comes from S-8's `verify` wiring.

**D-6 — Artifact publication, SHA-pinned.** §7.1 requires the OpenAPI document "published as a
CI artifact": the `contract-drift` job uploads `packages/contracts/openapi.json` through
`actions/upload-artifact` pinned to the full commit SHA of the `v7.0.1` tag
(`043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`, resolved via the GitHub git-ref API). This
preserves "official actions only, each pinned to a full commit SHA" and
`permissions: contents: read`.

**D-7 — Scope held at the §40.4 row text.** The M1-S5 record's non-scope table attributed
`core/api` to M1-S6, but the plan's row governs: "Shared contract generation and drift check"
with non-scope `—`. The Flutter consumption layer has no feature to call yet, and M1b-S2 owns the
sync-side contract row; both stay out (§2.2).

---

## 4. Results

_Pending — recorded at closeout before publication._
