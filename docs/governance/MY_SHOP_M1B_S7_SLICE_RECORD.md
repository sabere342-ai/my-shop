# MY SHOP - M1b-S7 SLICE RECORD: LOOP PREVENTION

**Master plan:** `docs/governance/MY_SHOP_MASTER_PLAN.md` v1.1.0 — §40.5 (M1b-S7), §38.12.1–§38.12.2 (loop prevention rule and why it is hard), §38.11.1–§38.11.2 (server sequence, descriptor shape), §38.13 (sync state machine, unchanged), §38.15 ("Multi-device reality", for what is *not* claimed), §38.6 (local schema versioning), §36.1 T-2/T-5 (no silent skips), §36.2 (suites), §37.2 (CI stages 23–24), §43.1 (G-1…G-13), ADR-003 (no global mutable singletons), ADR-036 (Drift, versioned local schema), ADR-038 (loop-free remote apply)
**Slice:** M1b-S7
**Branch:** `codex/my-shop-m1b-s7-loop-prevention`
**Predecessor:** `ebc962cc44b63775f30704637041ee84ec58f197` — M1b-S6, branch `codex/my-shop-m1b-s6-pull-endpoint` (PR #12, open, base `codex/my-shop-m1b-s5-push-endpoint`)
**Repair commit:** none required against the predecessor
**Final SHA (implementation head):** `ec711fcf30834fb1f156d9abad1ef0fdaf2a231b`
**Declaration status:** `PASS_MY_SHOP_M1B_S7_LOOP_PREVENTION_REMOTE_LOCKED`

---

## 1. Predecessor state

### 1.1 Entry state, verified not assumed

| Check              | Value                                                                                                                                                | Result                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Repository root    | `C:/dev/my-shop`                                                                                                                                     | pass                                      |
| Branch at entry    | `codex/my-shop-m1b-s6-pull-endpoint` @ `ebc962c`                                                                                                     | pass - equals the accepted M1b-S6 head     |
| Branch created     | `codex/my-shop-m1b-s7-loop-prevention` from `ebc962c`                                                                                                | pass                                      |
| Ancestry           | `ec711fc` (S7) -> `ebc962c` (S6 record) -> `c9c4fec` (S6) -> `e75ba03` (S5) -> … -> `3836ac7` (M1-S6) -> … -> `main` ancestor                      | pass - stacked ancestry intact            |
| `origin/main`      | `53f6aaa`, unchanged by this slice                                                                                                                   | pass                                      |
| Worktree at entry  | clean, no commits on the new branch                                                                                                                  | pass - started clean, not restarted       |
| Predecessor record | `MY_SHOP_M1B_S6_SLICE_RECORD.md` present, declares S7 not authorized by S6                                                                            | read; its §6 boundary is superseded here  |

### 1.2 Predecessor findings (carried, not re-opened)

No blocking defect existed in the committed M1b-S6 tree; it was green on its own head. Two S6 decisions matter to S7 and are honoured rather than re-litigated:

- **The pull feed carries change *descriptors*, not payloads** (§38.11.2). Every `PullChange` is `serverSequence`, `entityType`, `entityId`, optional `mutationId`, `changedAt`. There is therefore no full entity state for S7 to write, and S7 does not invent one (§3.3): the concrete per-entity write is a seam the boundary calls, not a payload it fabricates.
- **The client stores its cursor only after the page is applied** (§38.11.2, T-O6). That is the client *transport/resume* slice's rule; S7 applies a change it is given and does not own the cursor (D-3).

### 1.3 The M1b-S5 record gap (carried from S6, unchanged)

The M1b-S5 branch (`e75ba03`, PR #11) was accepted with no slice record; the M1b-S6 record named this rather than inventing one. S7 does not re-open it: S7 depends only on S5/S6 **code**, both present and green in the stack. No S5 record is fabricated.

---

## 2. Declaration

### 2.1 `scope`

Per Master Plan §40.5 row M1b-S7 — **loop prevention**: `applyRemoteWithoutOutbox` as the single remote-apply entry point, outbox suppression that crashes on violation, and a `server_sequence` guard. The principal invariant is §38.12.1's hard rule: **applying a remote change MUST NOT create an outgoing mutation.** This slice is client-only (Dart/Flutter); it changes no server, Prisma, contract, or schema-of-record.

| #    | Outcome                                                                                                                                                                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S-1  | New module `apps/desktop/lib/core/offline/apply/apply_remote_without_outbox.dart`: `RemoteChange` (descriptor mirror), `RemoteApplyDisposition` (`applied` / `discardedStale`), `RemoteApplyResult`, `RemoteApplyOperation`, and the single entry point `applyRemoteWithoutOutbox(db, change:, apply:)`                                                       |
| S-2  | Sequence guard (§38.12.1, §38.11.1): a per-entity applied high-water `(entity_type, entity_id) -> last_applied_server_sequence`. A change is applied only when its sequence is **strictly newer**; equal or older is `discardedStale` and writes nothing. Sequences are compared and stored as `BigInt` / decimal strings, exact past `2^53`                                              |
| S-3  | The guard is **per entity**, not one global cursor, because the server sequence is global-per-organization and is therefore not `previous + 1` per entity (§38.11.1). A lower sequence on a different entity still applies                                                                                                     |
| S-4  | New module `apps/desktop/lib/core/offline/outbox/remote_apply_scope.dart`: `RemoteApplyScope` — a **Zone-scoped depth counter** (`isActive`, `currentDepth`, `run`) and `OutboxWriteDuringRemoteApplyException`. Ambient (not injected), nesting-safe (depth, not a boolean), and exception-safe (`runZoned`, no cleanup an author can forget) (ADR-003)                                            |
| S-5  | `OutboxRepository.enqueue` refuses to write while `RemoteApplyScope.isActive`, throwing `OutboxWriteDuringRemoteApplyException` as its first, unconditional check — §38.12.1's **crash-on-violation**, not a silent echo. `transition` and every read path are unchanged                            |
| S-6  | **Atomicity** (§38.7.1 by analogy): the caller's local effect and the guard advance commit in one Drift transaction inside the suppression scope. If the effect throws, both roll back, no outgoing mutation exists, and the change stays retryable — a failure can never masquerade as a successful apply                                         |
| S-7  | New `RemoteAppliedChanges` Drift table (`app_database.dart`), local schema **v2 → v3**, forward-only and additive (`m.createTable(remoteAppliedChanges)`); `recordLocalSchemaVersion` stamps `3`. `app_database.g.dart` regenerated by `build_runner`                                                       |
| S-8  | The single entry point is the file CI **stage 24** already exempts (`lib/core/offline/apply/apply_remote_without_outbox.dart`); all apply-side writes live there, so the gate is satisfied without a CI/tool change (§2.2)                                 |
| S-9  | Tests: `remote_apply_scope_test.dart` (context semantics), `remote_apply_loop_prevention_test.dart` (T-O7 matrix), `remote_apply_migration_test.dart` (v2 → v3 in place, fresh v3). `outbox_migration_test.dart` advanced to the current schema version; `sync_transport_deferred_test.dart` notes S7 delivered the local apply                                            |
| S-10 | No server, contract, migration-of-record, CI, or toolchain change; `contracts:check` stays in sync (no artifact moved)                                                                                                                                                              |

### 2.2 `non_scope`

| Not touched                                                                                          | Reason                                                                                                                              |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Authenticated HTTP pull transport and the client resume/apply **orchestration**                       | S8/S9 — the connectivity/identity slices; S7 applies a change it is handed (see §4.2)                                               |
| Own-echo **reconciliation** (a change the server produced from this device's mutation)                | Needs payload-bearing retrieval to reconcile rather than re-apply; the descriptor carries `mutationId` for that later slice (§38.11.2) |
| Full **entity payload retrieval** / writing real `local_products`, `local_sales`, …                    | Descriptor-only pull (S6, §38.11.2); a later business slice. S7 does not fake an entity or call a no-op a successful synchronisation |
| The pull **resume cursor** (`last_server_sequence`)                                                   | S8/S9; deliberately a separate value from the per-entity guard (S-3, D-3)                                                            |
| Push transport, batching, per-mutation outcomes                                                       | M1b-S5; already delivered, unchanged                                                                                                |
| `sync_conflicts` table and conflict-resolution behaviour/UI                                           | Not in §40.5's M1b-S7 column set; `CONFLICT` is a local client state (§38.13)                                                        |
| Offline auth grace, connectivity monitor, observability plumbing                                       | M1b-S8/S9/S10                                                                                                                       |
| Any business module, business table, or business rule                                                  | §39.5 data-domain map; §40.5 business modules remain unauthorized                                                                   |
| Server code, Prisma schema, contracts, CI workflow, root toolchain/lockfile                            | S7 is client-only; no backend or contract decision changes                                                                          |
| Master plan, S1–S6 records, `main`                                                                     | No plan decision changed; the plan is not edited; `main` untouched                                                                  |
| Merging PR #13, auto-merge                                                                             | Owner boundary; not performed, not requested (§4.3 G-12)                                                                            |

### 2.3 `allowed_paths`

```
apps/desktop/lib/core/offline/apply/apply_remote_without_outbox.dart
apps/desktop/lib/core/offline/outbox/remote_apply_scope.dart
apps/desktop/lib/core/offline/outbox/outbox_repository.dart
apps/desktop/lib/core/offline/db/app_database.dart
apps/desktop/lib/core/offline/db/app_database.g.dart
apps/desktop/test/offline/remote_apply_scope_test.dart
apps/desktop/test/offline/remote_apply_loop_prevention_test.dart
apps/desktop/test/offline/remote_apply_migration_test.dart
apps/desktop/test/offline/outbox_migration_test.dart
apps/desktop/test/offline/sync_transport_deferred_test.dart
docs/governance/MY_SHOP_M1B_S7_SLICE_RECORD.md
```

This slice's own commits touch exactly these eleven paths (ten code/artifact files plus this record). `app_database.g.dart` is regenerated by `build_runner`, not hand-edited.

### 2.4 `tests`

| Level                       | Requirement                                                                                                                                                                                                                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gate positives              | All nine `gates`, `format:check`, `lint`, `typecheck`, `contracts:check`, and `npm audit --audit-level=high` green on this host; API unit+integration+database **261**, contracts **17**, testkit **5**                                                                                                    |
| Suppression context         | Inactive at rest; `run` activates (depth 1) and clears on completion; no leak when the body throws; sequential calls do not inherit residue; nested calls raise depth and restore the parent; work registered outside a scope stays unsuppressed (zone-scoped, never global)                               |
| Loop prevention (T-O7)      | A newer change applies, persists the guard, and leaves the outbox byte-identical; duplicate and stale changes are `discardedStale` with the effect re-run **zero** times; an increasing sequence advances the guard including `2^53 + 1`; the guard is per entity; invalid `server_sequence`/identity refused before any write; a failing effect rolls back both the write and the guard and the change is retryable; an enqueue inside the context throws and rolls the apply back; a nested apply is still suppressed; an arbitrary change set applied then re-delivered in full produces one effect and no outgoing mutation |
| Local migration (T-O19)     | v2 upgraded in place to v3 with `local_meta` and the durable outbox intact, guard table created empty; the guard table stores a 64-bit sequence exact as a decimal string; a fresh database stamps `local_schema_version = 3`; a second open does not duplicate the stamp; a v1 database upgrades v1 → v2 → v3; the S3 `v1 → v3` path also exercises the migrated schema accepting new rows                                |
| Remote CI                   | All seven checks green on the implementation head `ec711fc` (§3.6)                                                                                                                                                                                                                                        |

### 2.5 `acceptance_criteria`

| #     | Criterion                                                                                                   | Evidence    |
| ----- | ----------------------------------------------------------------------------------------------------------- | ----------- |
| AC-1  | One remote-apply entry point; it is the file stage 24 exempts (§38.12.1)                                     | §3.3, §3.5  |
| AC-2  | Outbox suppression is structural and crashes on violation (not a remembered flag) (§38.12.1)                | §3.4        |
| AC-3  | T-O7: the outbox count is unchanged after an arbitrary remote change set                                     | §3.4        |
| AC-4  | A duplicate or stale page is discarded; local state never rolls back (§38.12.1, T-O7)                       | §3.4        |
| AC-5  | A 64-bit `server_sequence` (above `2^53`) is compared and stored exactly (§38.11.1)                          | §3.4, §3.5  |
| AC-6  | Apply is atomic: a failed effect rolls back the write and the guard advance; the change stays retryable      | §3.4        |
| AC-7  | The guard is per entity; a change is not compared against another entity's sequence (§38.11.1)               | §3.4        |
| AC-8  | Local schema v2 → v3 is forward-only and additive; prior data survives; the guard table carries no entity payload (T-O19) | §3.5        |
| AC-9  | The descriptor-only boundary is explicit: S7 applies a supplied change and does not fake entity retrieval (`§38.11.2`, §4.2) | §3.3        |
| AC-10 | No server/Prisma/contract/CI change; `contracts:check` green                                                | §3.1, §3.5  |
| AC-11 | All gates and local suites pass                                                                              | §3.1        |
| AC-12 | PR #13 stacked on the M1b-S6 branch, open, not merged                                                        | §3.7        |
| AC-13 | No destructive Git operation; `main` and S1–S6 untouched                                                     | §4.3 G-4/5  |
| AC-14 | The client transport/resume deferral is annotated, not dropped (T-O6, S8/S9)                                  | §3.1        |

---

## 3. Execution and evidence

### 3.1 Local chain

`npm run gates` — secret-scan, markdown, import-boundary, vocabulary, localization, design-system, immutability, **offline (stages 23–24)**, migration-immutability — **all green (exit 0)**. `npm run verify:node` — `toolchain:verify` → nine `gates` → `format:check` → `lint` → `typecheck` (incl. `tsc -p tsconfig.test.json`) → `contracts:check` ("contracts are in sync") → `test` — **all green**. API suites: **261 passed** in one `jest` run across the unit, integration, and real-PostgreSQL `database` projects (run against local PostgreSQL 18.4 with the suite's three URLs, §3.2). `npm run flutter:analyze` prints "No issues found!". `npm run flutter:test` prints **"123 passed, 1 skipped"** — the skip is `DEFERRED_BY_PLAN: T-O6 pull resumes after reconnect without gaps`, whose owning slice is S8/S9 (§3.4). `npm audit --audit-level=high` exits 0 (0 high, 0 critical; 21 moderate remain below the gate).

The stage-24 offline gate reports **"OK — 43 dart file(s); 2 generated *.g.dart exempt; offline module present"**: the single apply entry point is present and no other `lib/core/offline/` file gained a write path.

### 3.2 Environment

Local PostgreSQL **18.4** (service `postgresql-x64-18`, running); the acceptance suite was pointed at it through `DATABASE_URL=postgresql://my_shop_app@…/my_shop_test`, `MIGRATION_DATABASE_URL=postgresql://my_shop_migrator@…/my_shop_test`, `ADMIN_DATABASE_URL=postgresql://postgres@…/postgres` (trust auth) — the same role separation the workflow's service uses. The `database` project provisions its own fixed test database via `scripts/db.mjs test-setup`; it deliberately fails fast rather than skipping when the environment is absent (T-2). CI runs the same suite against the workflow's PostgreSQL 18 service (§3.6).

### 3.3 Implementation notes

Three details carry the slice's weight:

1. **The suppression context travels in the Zone, not a field.** `applyRemoteWithoutOutbox` wraps its whole transaction in `RemoteApplyScope.run`, which is `runZoned(body, zoneValues: {key: depth})`. Any `OutboxRepository` code path — including a second instance a caller might construct — sees `RemoteApplyScope.isActive` without a constructor argument it could omit. Depth is an integer, so a nested remote apply cannot clear its parent's suppression on completion; `runZoned` tears the context down on success, throw, or invariant violation alike. This is the opposite of a global mutable singleton (ADR-003): the context is per-call and gone when the call returns.
2. **The caller supplies the local effect; the boundary owns the guards.** §38.12.1 names one function as "the only code permitted to write locally on behalf of the server", but S6's pull carries descriptors, not payloads. `applyRemoteWithoutOutbox` therefore takes a `RemoteApplyOperation` — the per-entity write a later retrieval slice will supply — and runs it **inside** the boundary's transaction and suppression scope, so the operation cannot bypass either. Until that slice exists there is no business entity to write, and the boundary does not invent one, storage it, or call a no-op a successful synchronisation (AC-9).
3. **Sequences never round-trip through `double`.** `serverSequence` is a decimal `String`; it is parsed and compared as `BigInt`, and the guard stores `last_applied_server_sequence` as a decimal `TEXT`. The test that crosses `2^53 + 1` exists because a `double` comparison would mis-round exactly there and could let a stale change through (§38.11.1).

The apply transaction is `db.transaction`, which in Drift 2.35 runs in a child zone that inherits the parent's `zoneValues`, so the outer suppression remains visible to every write inside — verified by the enqueue-in-context test (§3.4).

### 3.4 Test evidence

| Suite                                   | Result                                                                                                                                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `remote_apply_scope_test.dart`          | inactive at rest; activation/depth; no leak on throw; no stale residue; nested depth restore; work outside a scope unsuppressed — all green                                                                                                   |
| `remote_apply_loop_prevention_test.dart`| T-O7 outbox-unchanged (with a pre-existing mutation as sentinel); duplicate and stale discard; `2^53 + 1` increase; per-entity guard; invalid sequence/identity refused with no write; failure+retry atomicity; enqueue-in-context throws + full rollback; nested suppression; arbitrary set + full re-delivery → one effect, no outgoing mutation — all green |
| `remote_apply_migration_test.dart`      | v2 → v3 in place with data intact and guard table empty; 64-bit value stored exact; fresh v3 stamps `3`; second open non-duplicating; v1 → v3 both steps — all green                                                                          |
| `outbox_migration_test.dart` (S3, advanced) | v1 → **v3** upgrade with `local_meta` intact, outbox/audit/guard empty, migrated schema accepts new rows; fresh stamp `3`; second open non-duplicating — all green                                                                            |
| Flutter                                 | `flutter analyze --fatal-infos` "No issues found!"; `flutter test` **123 passed, 1 skipped** (`DEFERRED_BY_PLAN`, S8/S9)                                                                                                                      |
| `dependency-audit`                      | `npm audit --audit-level=high` exit 0; 0 high, 0 critical, 21 moderate below the gate                                                                                                                                                        |

### 3.5 Local schema migration and contract drift

S7 raises the local schema to **v3**. This is the first local schema change since M1b-S3 created v2, and it is forward-only and additive: `onUpgrade` gains a `from < 3 && to >= 3` step that only `createTable(remoteAppliedChanges)` and rewrites the single `local_schema_version` row. No existing column or row is altered, so the backup-before-migration rule (§38.6.2) does not apply, exactly as it did not for v1 → v2. `app_database.g.dart` was regenerated by `node tool/flutterw.mjs pub run build_runner build`; its diff is purely additive (565 insertions, 0 deletions).

This slice **does not change the server contract**: no `schema.prisma`, no OpenAPI, no generated TypeScript. `npm run contracts:check` prints "contracts are in sync". The `gate:migrations` (G-6) job is green with three migration paths in history, none rewritten.

The S3 `outbox_migration_test.dart` asserted the then-current schema version (`user_version == 2`, `local_schema_version == '2'`); because S7 legitimately advances the version, that test was advanced to v3 rather than left failing. It still owns the **v1 → current** path and still asserts data preservation; S7's own file owns the **v2 → v3** path. This is the only prior test changed (§5).

### 3.6 Remote CI

All runs on the implementation head `ec711fc` (G-4 exact-SHA discipline; no earlier run is offered as a substitute).

| Run         | Event        | SHA       | Result  | Jobs                                          |
| ----------- | ------------ | --------- | ------- | --------------------------------------------- |
| 38552000054 | push         | `ec711fc` | success | all 7 required checks green                   |
| 38552230646 | pull_request | `ec711fc` | success | all 7 required checks green                   |

The seven required checks: `fast-checks`, `backend-unit`, `backend-integration-database`, `contract-drift`, `dependency-audit`, `flutter-build-windows`, `flutter-build-android`. On **both** events all seven are green on `ec711fc`, including `fast-checks` (which runs this slice's Dart on the pinned SDK: `flutter analyze` and the **123-passing** `flutter test`), `backend-integration-database` (real PostgreSQL 18, unaffected by this client-only slice), and `flutter-build-windows`/`flutter-build-android` (which compile the new `lib/core/offline/apply` module into release artifacts).

The record commit that follows the implementation head is documentation-only; its head is verified green as well and reported with this slice.

### 3.7 PR

PR #13, head `codex/my-shop-m1b-s7-loop-prevention`, base `codex/my-shop-m1b-s6-pull-endpoint` (stacked on the unmerged M1b-S6 branch, PR #12, itself stacked on M1b-S5 PR #11 → M1b-S4 PR #9). Open, not merged. `origin/main` untouched; PRs #1–#12 untouched.

### 3.8 Offline/idempotency threat-model walk (gate G-13)

§13.7 walked for this slice — the client half of T-O7 and the loop threat R-19:

| Threat row                                  | What this slice does / does not do                                                                                                                                          |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sync loop (a remote change echoed back)     | Structurally impossible: the apply runs in `RemoteApplyScope`, and `OutboxRepository.enqueue` throws `OutboxWriteDuringRemoteApplyException`; CI stage 24 allows the write only through the one entry point (R-19, §38.12.1) |
| Stale / out-of-order page rolls state back  | The per-entity sequence guard discards any change not strictly newer; the effect is not even invoked (T-O7)                                                                  |
| Re-delivery / duplicate change re-applies   | Equal sequence is `discardedStale`; a full re-delivery of an identical page changes nothing (§3.4)                                                                          |
| Partial / failed apply masquerading as success | The local effect and the guard advance share one transaction; a throw rolls back both and the change stays retryable (AC-6)                                              |
| Suppression that leaks past one apply       | Zone-scoped and depth-counted; `runZoned` guarantees teardown on every exit path, so a later ordinary mutation is unaffected (§3.4)                                          |
| 64-bit sequence precision loss              | Decimal string on the wire and in storage; `BigInt` comparisons; the `2^53 + 1` case is tested                                                                              |
| Own-echo double-apply                       | The descriptor carries `mutationId`; reconciliation (rather than re-apply) is deferred to the payload slice that can see full state (§2.2). S7 does not claim to reconcile |
| Cross-tenant entity collision in the guard  | The guard is keyed `(entity_type, entity_id)` inside a single-org, device-bound local database; tenant scope is enforced upstream by the authenticated org-scoped pull (§38.16, §9.3). S7 introduces no cross-tenant path |
| Large / unbounded apply                     | Out of scope: S7 applies one change it is given; page size and its bounds are S6's contract (§38.11.2)                                                                       |

**What this slice does not do:** it does not fetch a page, own the resume cursor, reconcile an own-echo, or write a real business entity — those are the transport slice and the business slices (§2.2). It applies.

---

## 4. Decisions, scope difference, gates

### 4.1 Decisions

| #    | Decision                                                                                          | Reason                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| D-1  | `applyRemoteWithoutOutbox` takes a caller-supplied `RemoteApplyOperation`                          | S6 carries descriptors, not payloads; the boundary owns the guards, the future retrieval slice owns the entity write (§38.11.2)    |
| D-2  | Suppression context is **Zone-scoped depth**, not injected and not a boolean                       | Ambient so no second outbox instance can bypass it; depth so a nested apply cannot clear its parent; `runZoned` for exit-safety (ADR-003) |
| D-3  | Guard state is a per-entity high-water table, **not** the pull resume cursor                       | §38.12.1 guards "the record's last-applied sequence"; the cursor is the client transport's `last_server_sequence` (S8/S9)          |
| D-4  | Sequences are `BigInt` / decimal `TEXT` end to end                                                 | A 64-bit sequence must be exact past `2^53`; a `double` is not (§38.11.1)                                                           |
| D-5  | Only `enqueue` is guarded                                                                          | It is the sole outgoing-mutation creation path; `transition` and reads create nothing to echo                                      |
| D-6  | On violation the exception propagates and rolls the apply back, rather than being caught           | §38.12.1 makes it a crash, not a recoverable business error; swallowing it would re-open the loop silently (R-19)                   |
| D-7  | Local schema v2 → v3, forward-only additive                                                         | §38.6.2; no existing row changes, so no backup gate; the guard table is new                                                        |
| D-8  | The `v1 → v2` S3 migration test was advanced to `v1 → v3`                                           | The target version moved; leaving it asserting `2` would be a stale test, not a preserved one (§5)                                 |
| D-9  | No CI/tool change; the existing stage-24 exemption already names this exact apply path              | §37.2; the gate declared the door before the slice existed, so S7 walks through it rather than widening it                          |
| D-10 | Own-echo reconciliation deliberately deferred                                                       | It needs payload-bearing retrieval to distinguish "already mine" from "apply"; S7 records the deferral rather than a guess          |

### 4.2 Scope-difference report

Three differences are named rather than silently crossed:

1. **"Apply logic" appears in two places in S6's record.** S6's non-scope table listed "Flutter client transport, resume, or apply logic — S8/S9", while the same record's §6 forecast and the Master Plan's §40.5 M1b-S7 row assign **loop prevention / `applyRemoteWithoutOutbox` / the `server_sequence` apply guard** to **M1b-S7**. The plan row is the authority for a slice's mandate: S7 delivers the **local apply boundary** (guarding a change the client already has) and leaves the **transport and resume orchestration** to S8/S9. The two are separable — "apply this descriptor" versus "fetch, in order, and advance a cursor" — and only the former is S7's.
2. **§38.15 is "Multi-device reality", not "entity retrieval".** S6's record cites §38.15 loosely for full-entity delivery. The plan's §38.15 states the multi-device honesty limits (per-device correctness, eventual convergence, no global certainty during an outage) and does not describe entity retrieval at all. The real gap is between §38.11.2's **descriptor-only** pull and a business slice that can materialise an entity. S7 leaves that gap explicit (D-1) instead of pretending §38.15 covers it.
3. **No `sync_conflicts` and no conflict resolution.** As in S6, the plan's §40.5 M1b-S7 column set does not include them and §38.13's `CONFLICT` is a local client state; this slice adds neither.

### 4.3 Gates G-1…G-13

| Gate | Condition                                                             | Result                                                                                                                                    |
| ---- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| G-1  | no business table outside the plan's data domain map                   | PASS - one guard table, not a business table; it carries a sequence, no entity payload (§3.3)                                              |
| G-2  | contract files updated from the declaration and drift-clean            | PASS - no contract change; `contracts:check` in sync (§3.5)                                                                                |
| G-3  | schema/migration unchanged (no server migration this slice)            | PASS - no `schema.prisma`/server migration edit; the local Drift schema is versioned independently (ADR-036); `migration-immutability` green |
| G-4  | all CI stages pass; no history rewrite                                 | PASS - all 7 checks green on `ec711fc` for both events (§3.6); ordinary commits, no force push, no rebase                                  |
| G-5  | no file outside `allowed_paths` modified                               | PASS - the slice diff is confined to §2.3                                                                                                  |
| G-6  | `non_scope` verifiably untouched                                       | PASS - no transport/resume, no own-echo, no business module, no plan/CI/server edit (§2.2)                                                  |
| G-7  | migration impact as declared; migrations immutable; drift non-vacuous  | PASS - local schema v2 → v3 declared and additive (§3.5); no server migration; `migration-immutability` green                              |
| G-8  | security impact as declared                                            | PASS - no new route, permission, secret, or tenant path; the guard operates inside the existing device-bound local database (§3.8)          |
| G-9  | migration audit: no `GRANT ALL`, no interpolation                      | PASS - no server migration; the Drift migration is Dart `createTable` with no SQL interpolation                                             |
| G-10 | rollback defined and feasible                                          | PASS - drop the branch and PR #13; `main` untouched; the change is client-local and additive                                               |
| G-11 | documentation updated                                                  | PASS - this record; the Dart deferral comment updated; no decision changed the master plan                                                  |
| G-12 | owner authorized the merge                                             | NOT SATISFIED for PR #13 - no merge performed, by design (left open)                                                                       |
| G-13 | offline path: threat model walked and tests                           | PASS - T-O7 client half; §3.8                                                                                                              |

---

## 5. Deviations

- **One S3 test was advanced to the current schema version.** `outbox_migration_test.dart` asserted `user_version == 2` because v2 was current at M1b-S3; S7 advances the current version to v3, so the test now asserts v1 → v3 with data intact. This is the minimal, honest change: the test's subject (a v1 database upgrades with data preserved) is unchanged, and S7's own file adds the v2 → v3 case. No other prior test was modified.
- **The S6 record's §2.2 lumped "apply logic" with S8/S9.** Named and resolved in §4.2 by the plan's §40.5 row; S7 delivers the local apply boundary, S8/S9 the transport.
- **Own-echo reconciliation is deferred, not implemented.** It needs payload-bearing retrieval; the descriptor's `mutationId` is carried for that slice (§2.2, D-10).
- **No repair commit, no history operation.** This branch was created by ordinary commits from `ebc962c`; nothing was force-pushed, reset, or rebased.

---

## 6. Boundary

The next slice is **M1b-S8** (offline connectivity/`DEFERRED` client transport per §40.5, which owns the authenticated HTTP pull transport and cursor resume). It is **NOT AUTHORIZED** by this record. Own-echo reconciliation and full entity retrieval remain later concerns. Business modules remain unauthorized.

```
M1b-S8 NOT AUTHORIZED
PASS_MY_SHOP_M1B_S7_LOOP_PREVENTION_REMOTE_LOCKED
```
