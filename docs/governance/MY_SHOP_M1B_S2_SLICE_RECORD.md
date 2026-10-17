# MY SHOP - M1b-S2 SLICE RECORD: SYNC CONTRACTS

**Master plan:** `docs/governance/MY_SHOP_MASTER_PLAN.md` v1.1.0 — §40.5 (M1b-S2), §38.8.1 (mutation journal columns), §38.13 (sync state machine), §38.10.1 (batch and per-mutation outcomes), §34.3 / §34.3.1 (error contract), §36.2 (contract test row), §37.2 (stage 16 - contract generation and drift check), ADR-001
**Slice:** M1b-S2
**Branch:** `codex/my-shop-m1b-s2-sync-contracts`
**Predecessor:** `4d9b595` - M1b-S1, branch `codex/my-shop-m1b-s1-local-persistence`
**Repair commit:** `afc1ec4` (predecessor defects, in-branch, before slice work)
**Final SHA:** `0c824fd`
**Declaration status:** `PASS_MY_SHOP_M1B_S2_REMOTE_LOCKED`

---

## 1. Predecessor state and repair

### 1.1 Entry state, verified not assumed

| Check                  | Value                                                                                   | Result                              |
| ---------------------- | --------------------------------------------------------------------------------------- | ----------------------------------- |
| Repository root        | `C:/dev/my-shop`                                                                        | pass                                |
| Branch / HEAD at entry | `codex/my-shop-m1b-s1-local-persistence` @ `4d9b595`                                    | pass - equals canonical M1b-S1 head |
| Ancestry               | `4d9b595` (M1b-S1) -> `bbf669e` (M1b-S1) -> `3836ac7` (M1-S6) -> ... -> `main` ancestor | pass - stacked ancestry intact      |
| `origin/main`          | unchanged by this slice                                                                 | pass                                |
| Worktree at start      | clean                                                                                   | pass                                |

### 1.2 Predecessor defects (found, not assumed)

M1b-S1 was declared `PASS_MY_SHOP_M1B_S1_LOCAL_PERSISTENCE_REMOTE_LOCKED` but its remote CI was red on **both** runs:

| Run         | SHA       | Result      | Detail                                                                        |
| ----------- | --------- | ----------- | ----------------------------------------------------------------------------- |
| 37624783169 | `bbf669e` | **failure** | `fast-checks` failed at the **Flutter packages** step; all other jobs skipped |
| 37625486868 | `4d9b595` | **failure** | same - `fast-checks` failed at the Flutter packages step                      |

Root causes in the committed tree:

1. `apps/desktop/pubspec.yaml` / `pubspec.lock` were downgraded to the stale host SDK's stack (`intl ^0.19.0`, `sdk ^3.5.0`, `riverpod 2.x`, `analyzer ^6.5.0`), inconsistent with the pinned Flutter `3.47.5` / Dart `3.13` SDK - `flutter pub get` failed.
2. `apps/desktop/lib/core/offline/db/app_database.dart` declared `class AppDatabase extends _` - the generated part `app_database.g.dart` was never generated or committed, so the file did not compile.

### 1.3 Repair (commit `afc1ec4`, in-branch, authorized by owner)

| Fix                | Detail                                                                                                                                                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Toolchain restored | `apps/desktop/pubspec.{yaml,lock}` restored to the CI-proven M1-S5 dependency set, keeping M1b-S1's Drift additions; `drift` / `drift_dev` resolve to `2.35.1` so `drift_dev` matches the analyzer 13-15 line (`2.28.x` caps analyzer `<9` and cannot compile under the `14.4.0` override) |
| Superclass fixed   | `extends _` -> `extends _$AppDatabase`                                                                                                                                                                                                                                                     |
| Part committed     | `app_database.g.dart` (371 lines) generated with `build_runner` under the pinned SDK and committed                                                                                                                                                                                         |

Repair evidence: `flutter analyze --fatal-infos` - no issues; `flutter test` - 20 passed. The `Flutter packages` step that failed remotely now succeeds, proven by green CI on `0c824fd` (§3.6).

---

## 2. Declaration

### 2.1 `scope`

Per Master Plan §40.5 row M1b-S2: "Sync contracts: mutation payload schema, `mutation_id`, sync state enum, error codes, contract generation and drift gate. Non-scope: Push/pull transport. Key acceptance: Contract is generated; drift fails CI."

| #    | Outcome                                                                                                                                                                                                                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-1  | `MutationPayload` (decorated class) carrying the 13 wire fields of §38.8.1 in column order: `mutationId`, `organizationId`, `deviceId`, `actorUserId`, `actorRoleSnapshot`, `aggregateType`, `aggregateId`, `operationType`, `payload`, `payloadVersion`, `deviceLocalSequence`, `localCreatedAt`, `deviceIdempotencyKey` |
| S-2  | `mutation_id` published as a named `MutationId` component behind a `$ref`; each wire field description cites its §38.8.1 column                                                                                                                                                                                           |
| S-3  | `operationType` closed to `CREATE` / `VOID` / `RETURN` / `REVERSE`; `aggregateType` kept open (the §38.8.1 column text carries an ellipsis, i.e. an extensible list)                                                                                                                                                      |
| S-4  | `SyncState` published as a standalone component with the seven states of §38.13 (`LOCAL_ONLY`, `PENDING`, `SYNCING`, `SYNCED`, `RETRYABLE_ERROR`, `CONFLICT`, `PERMANENT_REJECTED`)                                                                                                                                       |
| S-5  | Error codes: the sync-era codes (`REPLAY`, `MUTATION_CONTRADICTION`, `INVENTORY_CONFLICT`, `OFFLINE_GRACE_EXPIRED`, `DEVICE_REVOKED`) remain published in the generated `ProblemDocument` code enum - verified present in both drift artifacts                                                                            |
| S-6  | Single decorated source: `openapi.ts` registers the class via `SwaggerModule.createDocument(app, options, { extraModels: [MutationPayload] })` and composes `syncContractSchemas()` into `components.schemas` - no hand-maintained JSON                                                                                   |
| S-7  | Emitter growth (`packages/contracts/src/codegen/emit.ts`): top-level **enum** -> union, top-level **primitive** -> alias; anything else throws (`unsupported top-level schema`) rather than emitting `any`                                                                                                                |
| S-8  | `CONTRACT_VERSION` `0.2.0` -> `0.3.0`; both committed drift artifacts regenerated (`packages/contracts/openapi.json`, `packages/contracts/src/generated/schemas.ts`); stage-16 drift gate stays the single byte-for-byte check                                                                                            |
| S-9  | Tests: sync-contract specs, document-builder assertion of the full `MutationPayload` shape, emitter union/alias/throw specs, index re-export + version spec                                                                                                                                                               |
| S-10 | `tool/ci/offline-guards.mjs` exempts build-generated `*.g.dart` companions (declared, see §4.4)                                                                                                                                                                                                                           |

### 2.2 `non_scope`

| Not touched                                                                                                 | Reason                                                                                                    |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Push/pull transport, batch envelope shape, per-mutation outcome stream (§38.10.1)                           | Explicitly outside §40.5 M1b-S2 - M1b-S3                                                                  |
| `CLIENT_TOO_OLD` and other future error codes                                                               | Not in §38.13's published set; deferred to M1b-S5 (decision, §4.5)                                        |
| Local bookkeeping columns (`sync_state`, `attempt_count`, `last_error_code`, `last_attempt_at`) on the wire | §38.8.1 local columns; they belong to the device's outbox row, not the transport payload (decision, §4.1) |
| Flutter `core/api` client, Dart consumption, `apps/desktop/lib/**` beyond the M1b-S1 repair                 | Not in the M1b-S2 row; the committed contract is what a later client consumes                             |
| Any new endpoint or response-behaviour change                                                               | The document's endpoint surface is unchanged; only `components.schemas` grows                             |
| `MY_SHOP_MASTER_PLAN.md`, predecessor records                                                               | No decision changed; left byte-identical                                                                  |
| `.github/workflows/**`, branch protection, required checks                                                  | M1-S4 owns the CI platform; no CI change needed                                                           |
| Merging PR #7, auto-merge, force push, history rewrite                                                      | Owner boundary; G-12, G-4                                                                                 |

### 2.3 `allowed_paths`

```
packages/contracts/openapi.json
packages/contracts/src/codegen/emit.ts
packages/contracts/src/codegen/emit.spec.ts
packages/contracts/src/generated/schemas.ts
packages/contracts/src/index.ts
packages/contracts/src/index.spec.ts
services/api/src/common/openapi/openapi.ts
services/api/src/common/openapi/openapi.spec.ts
services/api/src/common/sync/**
tool/ci/offline-guards.mjs
docs/governance/MY_SHOP_M1B_S2_SLICE_RECORD.md
```

`tool/ci/offline-guards.mjs` is inside the slice's repair/consumption surface because the M1b-S1 `app_database.g.dart` commit (repair `afc1ec4`) is exactly what the stage 23-24 guard flagged; the exemption is justified in §4.4. Nothing else outside this list is modified.

### 2.4 `tests`

| Level                   | Requirement                                                                                                                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Gate positives          | `npm run gates` (stages 1, 2, 11-15, 23-24, G-6), `format:check`, `lint`, `typecheck` all pass                                                                                                                                                                                 |
| Drift positive          | `npm run contracts:check` exits 0; `contracts:generate` idempotent                                                                                                                                                                                                             |
| Drift negatives (local) | (a) perturbed byte in committed `openapi.json` -> `contracts:check` exits non-zero naming the file, restored byte-identically; (b) emitter throws on an unrenderable top-level schema (permanent test)                                                                         |
| Unit (api)              | `sync.contract.spec.ts`: exact 13-field list and order, §38.8.1 citation on every description, `$ref` metadata, closed/open enum checks, `SyncState` vocabulary, fresh schema objects; `openapi.spec.ts` asserts the full document shape and the absence of bookkeeping fields |
| Unit (contracts)        | emitter union, scalar alias, and throw specs; index version + generated-type compile assertions                                                                                                                                                                                |
| Full local chain        | `npm run verify` (incl. real PostgreSQL and Flutter)                                                                                                                                                                                                                           |
| Remote negative demo    | A deliberately drifting branch fails **only** the `contract-drift` job; run and job captured; demo branch deleted                                                                                                                                                              |
| Remote acceptance       | All seven required checks green on the exact final SHA, on both push and pull_request events                                                                                                                                                                                   |

### 2.5 `acceptance_criteria`

| #     | Criterion                                                                          | Evidence                    |
| ----- | ---------------------------------------------------------------------------------- | --------------------------- |
| AC-1  | The sync contract is generated from one decorated source (no hand-maintained JSON) | §3.2, §3.3                  |
| AC-2  | `mutation_id` is a named `$ref` component                                          | §3.3                        |
| AC-3  | Sync state enum published with the seven §38.13 states                             | §3.3                        |
| AC-4  | Sync error codes present in `ProblemDocument`                                      | §3.3                        |
| AC-5  | Contract drift fails CI                                                            | §3.4 (local), §3.6 (remote) |
| AC-6  | Full local `npm run verify` green                                                  | §3.1                        |
| AC-7  | All seven required checks green on the final SHA                                   | §3.6                        |
| AC-8  | Predecessor defects repaired with evidence                                         | §1.3, §3.7                  |
| AC-9  | PR stacked on M1b-S1, open, unmerged                                               | §3.8                        |
| AC-10 | Boundary: M1b-S3 not authorized                                                    | §6                          |

---

## 3. Execution and evidence

### 3.1 Local full chain

`npm run verify` - **exit 0**. Toolchain pin PASS; gates PASS; `format:check` PASS; `lint` PASS; `typecheck` PASS; `contracts:check` "contracts are in sync"; tests green; `flutter analyze --fatal-infos` "No issues found"; `flutter test` green.

Test totals: **163** - api **141** (incl. the real-PostgreSQL database suite, 9 tests, and the integration suite), contracts **17**, testkit **5**. The database suite was run with the three CI URLs against the local trust-authenticated PostgreSQL 18 (`npm run db:bootstrap`), proving the stage-5 suites locally as well as in CI.

`npm audit --audit-level=high` - **exit 0**.

### 3.2 Generation

`npm run build && npm run contracts:generate` -> "regenerated openapi.json (drifted)", "regenerated schemas.ts (drifted)"; `npm run contracts:check` -> "contracts are in sync".

### 3.3 Artifact content (verified)

Generated `packages/contracts/src/generated/schemas.ts` (sorted, Prettier-formatted) contains: `ProblemFieldError`, `ProblemDocument`, `LivenessReport`, `ReadinessDetail`, `ReadinessReport`, `MutationPayload`, `MutationId`, `SyncState`; `export type MutationId = string;`; the `MutationPayload` interface with `readonly mutationId: MutationId;` and `readonly operationType: 'CREATE' | 'VOID' | 'RETURN' | 'REVERSE';`. `ProblemDocument` retains the sync error codes (`REPLAY`, `MUTATION_CONTRADICTION`, `INVENTORY_CONFLICT`, `OFFLINE_GRACE_EXPIRED`, `DEVICE_REVOKED`). `packages/contracts/openapi.json` is compact `JSON.stringify`, genuine UTF-8, no BOM.

### 3.4 Local drift negatives (G-7 non-vacuous)

| #   | Action                                          | Result                                                                 |
| --- | ----------------------------------------------- | ---------------------------------------------------------------------- |
| N-1 | Perturb one byte of committed `openapi.json`    | `contract drift detected: openapi.json: drifted`, exit 1               |
| S-1 | Regenerate from source                          | "contracts are in sync", exit 0                                        |
| N-2 | Emitter fed a top-level schema it cannot render | throws `unsupported top-level schema` (permanent test, `emit.spec.ts`) |

### 3.5 Encoding

Committed `openapi.json`: no BOM, first bytes `7B 22 6F 70`, 39 `§`, 4 em-dash, 1 curly apostrophe - genuine UTF-8, byte-stable across regeneration.

### 3.6 Remote CI

| Run         | Event          | SHA       | Result      | Jobs                                         |
| ----------- | -------------- | --------- | ----------- | -------------------------------------------- |
| 37651177026 | push           | `0c824fd` | **success** | all 7 required checks success                |
| 37651436887 | pull_request   | `0c824fd` | **success** | all 7 success                                |
| 37651821256 | push (negdemo) | `a8ccdb1` | **failure** | 6 success, **`contract-drift` failure** only |

The seven required checks: `fast-checks`, `backend-unit`, `backend-integration-database`, `contract-drift`, `dependency-audit`, `flutter-build-windows`, `flutter-build-android`.

Remote negative demo: branch `negdemo/m1b-s2-sync-contract-drift` at `a8ccdb1` perturbed a byte in committed `openapi.json`; run 37651821256 failed **only** at the `contract-drift` job step "Stage 16b - contract drift gate, committed OpenAPI and generated types must match the backend byte-for-byte". This is the literal "drift fails CI" proof. The demo branch was then deleted from remote and local.

### 3.7 Predecessor repair proof

The predecessor's failing step was `fast-checks` -> "Flutter packages" (runs 37624783169, 37625486868). On `0c824fd`, `fast-checks` is green on both push and pull_request runs (§3.6), so the repair is proven remotely, not just locally.

### 3.8 PR

PR #7, head `codex/my-shop-m1b-s2-sync-contracts`, base `codex/my-shop-m1b-s1-local-persistence` (stacked on the unmerged M1b-S1 branch). Open, not merged. `origin/main` untouched; PRs #1-#6 untouched.

### 3.9 Repository state at declaration

HEAD = `0c824fd` = `origin/codex/my-shop-m1b-s2-sync-contracts`, ahead/behind `0/0`, worktree clean. Stacked ancestry: `0c824fd` -> `afc1ec4` -> `4d9b595` -> `bbf669e` -> `3836ac7` -> ... -> `main`.

---

## 4. Decisions

| #   | Decision                                                               | Rationale                                                                                                                                                                                                                                                                                                                    |
| --- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | The four local bookkeeping columns are **not** on the wire             | §38.8.1 labels them device/outbox-local; the transport payload is the wire contract, and a client must never be able to assert another device's sync state                                                                                                                                                                   |
| D-2 | Wire fields use the repository's established camelCase JSON convention | The API's existing published JSON uses camelCase (`traceId`); a mixed-case contract would be a lasting inconsistency                                                                                                                                                                                                         |
| D-3 | `mutation_id` is a `$ref` to a named `MutationId` component            | One uuid definition behind every use; `@nestjs/swagger`'s option types omit `$ref` although the schema factory preserves it, so a `// @ts-expect-error --` directive documents the gap and turns a future type change into a build error in the right direction (the document test proves the reference survives generation) |
| D-4 | `operationType` closed, `aggregateType` open                           | §38.8.1 lists operation types explicitly but gives `aggregate_type` an ellipsis; closing an open list would be a false constraint                                                                                                                                                                                            |
| D-5 | Emitter throws on unrenderable top-level schemas                       | Consistent with the M1-S6 "never emit `any`" rule; no current consumer needs a top-level `object`/array schema                                                                                                                                                                                                               |
| D-6 | Stage 23-24 guard exempts `*.g.dart`                                   | Generated companions are committed only so a fresh clone compiles; a hand edit would be erased by regeneration, and the guard steers authored code - a finding there could never be fixed by an author, so it would only train the gate to be ignored. Declared in the header comment and reported in the status line        |
| D-7 | `CLIENT_TOO_OLD` not added to the sync error set now                   | It is not among the §38.13 published states; its owner slice is M1b-S5                                                                                                                                                                                                                                                       |

---

## 5. Deviations

None from the declared scope. The single path beyond the M1-S6-era contract surface, `tool/ci/offline-guards.mjs`, is declared in §2.3 and justified in D-6; the repair commit `afc1ec4` touches only `apps/desktop/pubspec.{yaml,lock}`, `app_database.dart`, and `app_database.g.dart`, all within the predecessor-repair authorization.

---

## 6. Boundary

The next slice is **M1b-S3** (push/pull transport and per-mutation outcomes, §40.5). It is **NOT AUTHORIZED** by this record.

```
M1b-S3 NOT AUTHORIZED
PASS_MY_SHOP_M1B_S2_REMOTE_LOCKED
```
