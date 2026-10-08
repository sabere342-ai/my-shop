# MY SHOP - M1b-S3 SLICE RECORD: DURABLE OUTBOX

**Master plan:** `docs/governance/MY_SHOP_MASTER_PLAN.md` v1.1.0 — §40.5 (M1b-S3), §38.8.1 (outbox columns), §38.8.2 (append-only payload), §38.10.2 (total order), §38.13 (sync state machine), §38.25 F-17 (compaction), §38.6.2 (local schema version), §38.6.6 (testable executor), §43.1 (gates G-1…G-13), §13.7 (offline threat model), §43.4 (transport deferral), §32.5 §32.2A (audit)
**Slice:** M1b-S3
**Branch:** `codex/my-shop-m1b-s3-push-pull-transport`
**Predecessor:** `3292601` - M1b-S2, branch `codex/my-shop-m1b-s2-sync-contracts`
**Repair commit:** none required
**Final SHA (implementation head):** `eee9d2f`
**Declaration status:** `PASS_MY_SHOP_M1B_S3_PUSH_PULL_TRANSPORT_REMOTE_LOCKED`

---

## 1. Predecessor state

### 1.1 Entry state, verified not assumed

| Check                  | Value                                                                                   | Result                              |
| ---------------------- | --------------------------------------------------------------------------------------- | ----------------------------------- |
| Repository root        | `C:/dev/my-shop`                                                                        | pass                                |
| Branch at entry        | `codex/my-shop-m1b-s2-sync-contracts` @ `3292601`                                       | pass - canonical M1b-S2 record head |
| Branch created         | `codex/my-shop-m1b-s3-push-pull-transport` from `3292601`                               | pass                                |
| Ancestry               | `3292601` (M1b-S2 record) -> `0c824fd` (M1b-S2) -> `afc1ec4` -> `4d9b595` (M1b-S1) -> ... -> `main` ancestor | pass - stacked ancestry intact       |
| `origin/main`          | unchanged by this slice                                                                 | pass                                |
| Worktree at start      | clean                                                                                   | pass                                |

### 1.2 Predecessor findings (carried, not re-opened)

No blocking defect existed in the committed M1b-S2 tree; the S2 branch was declared remote-locked and every S2 gate held on this host. Two premise slips are already recorded in S2's own record and are **not** repaired here:

1. S2's §6 boundary text names M1b-S3 as "push/pull transport and per-mutation outcomes". The plan's §40.5 M1b-S3 row is the **durable outbox**; push/pull transport is M1b-S5/S6 and is deferred by plan (§43.4). Corrected in this record's scope-difference report (§4.5).
2. M1b-S2's `MutationPayload` doc comment says "16 columns" while §38.8.1 lists 17. The 17th is `device_idempotency_key`; conserved by this record's schema (§2.1 S-1).

---

## 2. Declaration

### 2.1 `scope`

Per Master Plan §40.5 row M1b-S3: the durable outbox — schema v2, the §38.13 state machine with per-transition local audit, gap-free ordering, and F-17 compaction. Push/pull transport is deferred to M1b-S5/S6 (§43.4).

| #     | Outcome                                                                                                                                                                                                                                                                                                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S-1   | Schema v2 in `app_database.dart`: `outbox` table with one column per §38.8.1 row - all 17 columns (`mutation_id` PK, `organization_id` + `device_id`, `actor_user_id`, `actor_role_snapshot`, `aggregate_type`, `aggregate_id`, `operation_type`, `payload`, `payload_version`, `device_local_sequence`, `local_created_at`, `sync_state`, `attempt_count`, `last_error_code`, `last_attempt_at`, `device_idempotency_key`); unique on `device_local_sequence` and on `device_idempotency_key`; `sync_state` indexed; `local_audit_events` append-only log (id, event_time, mutation_id, from_state, to_state, attempt_count, error_code) |
| S-2   | Forward-only additive migration v1 -> v2: creates exactly the two tables above, leaves every `local_meta` row untouched, records schema version 2 (§38.6.2). Backup-before-migration is not applicable to a purely additive step |
| S-3   | `AppDatabase.forTesting(executor)` so tests control the database (in-memory or on-disk, §38.6.6)                                                                                                                                                                                                              |
| S-4   | `OutboxRepository.enqueue` is transactional (§38.7.1 composition): reads binding, allocates sequence + monotonic now, inserts, promotes `LOCAL_ONLY -> PENDING` in one transaction; rollback undoes the row, the audit row, and the counter |
| S-5   | `organization_id` / `device_id` come from `local_meta` binding and are UUID-validated; there is no enqueue parameter through which a caller could supply them (§38.8.1, §38.16)                                                                                                                               |
| S-6   | Gap-free `device_local_sequence` from a `local_meta` counter and monotonic `local_created_at` with a persisted high-water guard (§38.10.2, §38.16.5 backward-jump rule)                                                                                                                                      |
| S-7   | §38.13 state machine as data (`allowedSyncTransitions`): the seven wire states, edges, `IllegalSyncTransitionException` thrown before any write, `errorCode` required if and only if the target is a failure state |
| S-8   | A transition writes exactly the four bookkeeping columns (`sync_state`, `attempt_count`, `last_attempt_at`, `last_error_code` - retained, never cleared); entering `SYNCING` increments `attempt_count`; every transition appends one `local_audit_events` row (§38.13)                                        |
| S-9   | `SYNCED` is terminal and reachable only from `SYNCING`; there is no mark-synced shortcut and no delete path (§38.8.2, §38.30.1)                                                                                                                                                                               |
| S-10  | `pendingForPush` = `PENDING` rows in ascending `device_local_sequence`, limit 1..50 (`maxPushBatchSize = 50`, §38.10.1); `countsByState` returns all seven states zero-included (§38.31.1)                                                                                                                     |
| S-11  | F-17 compaction: `SYNCED`-only candidates, age from the latest `SYNCED` audit event (fallback `local_created_at`), retention default 90 days, hard audit floor default 1000 - the floor outranks age - deterministic floor cut, audit rows never deleted |
| S-12  | `generateUuidV7` with the variant nibble in the correct (fourth-group-first) byte; `mutation_id` doubles as `device_idempotency_key`                                                                                                                                                                          |
| S-13  | Tests: T-O2 outbox half (writer, state machine, durability, ordering), T-O19 migration, F-17 compaction, T-O21 governance, plus `sync_transport_deferred_test.dart` marking M1b-S5/S6 as `DEFERRED_BY_PLAN`                                                                                                    |

### 2.2 `non_scope`

| Not touched                                                                                                                          | Reason                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Push/pull transport, batch envelope shape, per-mutation outcome stream (§38.10.1)                                                    | §40.5 M1b-S5/S6; deferred by plan (§43.4) and by these tests' `DEFERRED_BY_PLAN` markers                   |
| Server endpoints, mutation ledger, `REPLAY` / `MUTATION_CONTRADICTION` processing                                                     | Backend slices; outbox only prepares the wire rows                                                       |
| Sale resolution UI / domain sale flows                                                                                               | Full T-O2 (sale + outbox) waits for M5b-S1; this slice proves the outbox half                             |
| Owner resolution edges out of `CONFLICT` / `PERMANENT_REJECTED`                                                                       | §38.13 names the next step as owner resolution; the edges arrive with the slice that builds it (D-5)       |
| Wire contract artifacts (`openapi.json`, `schemas.ts`, `sync.contract.ts`) and all `packages/contracts` + `services/api` code         | M1b-S2 owned the contract; outbox rows store the same wire names to stay in lockstep (D-6)                 |
| UI, design system, localization, router changes                                                                                      | No user-visible surface in this slice                                                                     |
| `MY_SHOP_MASTER_PLAN.md`, predecessor records                                                                                        | No decision changed; left byte-identical                                                                  |
| `.github/workflows/**`, branch protection, required checks                                                                           | M1-S4 owns the CI platform; no CI change needed                                                            |
| Merging PR #8, auto-merge, force push, history rewrite                                                                                | Owner boundary; G-12, G-4                                                                                  |

### 2.3 `allowed_paths`

```
apps/desktop/lib/core/offline/db/app_database.dart
apps/desktop/lib/core/offline/db/app_database.g.dart
apps/desktop/lib/core/offline/db/migrations/local_schema_version.dart
apps/desktop/lib/core/offline/outbox/sync_state.dart
apps/desktop/lib/core/offline/outbox/operation_type.dart
apps/desktop/lib/core/offline/outbox/uuid_v7.dart
apps/desktop/lib/core/offline/outbox/outbox_errors.dart
apps/desktop/lib/core/offline/outbox/outbox_repository.dart
apps/desktop/lib/core/offline/outbox/outbox_compactor.dart
apps/desktop/test/offline/**
docs/governance/MY_SHOP_M1B_S3_SLICE_RECORD.md
```

`app_database.g.dart` is the committed build-generated companion (M1b-S2 D-6: generated under the pinned SDK so a fresh clone compiles; regeneration would overwrite any hand edit, so the offline-guard exemption is inherited, cf. `tool/ci/offline-guards.mjs`).

### 2.4 `tests`

| Level                 | Requirement                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Gate positives        | `flutter analyze --fatal-infos` - no issues; `flutter test` - 67 passed, 3 skipped (`DEFERRED_BY_PLAN`, see below)                            |
| Outbox writer         | enqueue rules, argument validation, transactional rollback, binding, monotonic now                                                             |
| State machine (§38.13)| every allowed and denied edge, `IllegalSyncTransitionException`, error-code rules, `countsByState`                                            |
| Durability (T-O2 half)| file-backed close/reopen preserves rows and restarts the sequence gap-free                                                                    |
| Migration (T-O19)     | v1 -> v2 via a seeded on-disk v1 database; schema-version row written; forward-only                                                           |
| Compaction (F-17)     | only `SYNCED` deleted, age rule, audit floor outranks age, audit rows kept, invalid-argument refusal                                            |
| Ordering (§38.10.2)   | ascending `device_local_sequence`, gap-free sequence, deterministic tie-break                                                                  |
| Governance (T-O21)    | `SYNCED` only from `SYNCING`; one audit event per transition; `attempt_count` mirror in the log                                                |
| Deferred (skipped)    | 3 markers: pull/resume is M1b-S6 (T-O3 M1b-S4 ledger is also deferred) - `DEFERRED_BY_PLAN`, never removed wholesale                           |
| Builds                | `flutter build windows --release` PASS; `flutter build apk --debug` PASS (local; CI builds APK `--release`)                                  |
| Remote acceptance     | all seven required checks green on the final SHA on both push and pull_request events                                                        |

### 2.5 `acceptance_criteria`

| #     | Criterion                                                                        | Evidence                    |
| ----- | -------------------------------------------------------------------------------- | --------------------------- |
| AC-1  | Outbox schema carries §38.8.1's 17 columns with PK, two unique keys, indexed state | §3.3                        |
| AC-2  | v1 -> v2 migration is additive and forward-only, versioned                       | §3.3, §3.4                  |
| AC-3  | `enqueue` is transactional; rollback rolls back row + audit + sequence           | §3.3, §3.4                  |
| AC-4  | §38.13 state machine enforced with per-transition audit events                   | §3.3, §3.4 (T-O21)          |
| AC-5  | `SYNCED` terminal, reachable only from `SYNCING`; no delete path                 | §3.3, §3.4 (T-O21)          |
| AC-6  | Ordering gap-free and monotonic                                                 | §3.3, §3.4 (T-O2, ordering) |
| AC-7  | F-17 compaction: `SYNCED`-only, retention, hard audit floor                     | §3.3, §3.4 (F-17)           |
| AC-8  | Contract drift still fails CI on this head (gate G-7 non-vacuous)               | §3.5                        |
| AC-9  | All seven required checks green on the final SHA (push + pull_request)          | §3.6                        |
| AC-10 | Offline threat model walked for the change                                      | §3.8 (G-13)                 |
| AC-11 | PR stacked on M1b-S2, open, unmerged                                            | §3.7                        |
| AC-12 | Transport and sale-half explicitly deferred, not silently dropped               | §2.2, §4.5, §2.4            |

---

## 3. Execution and evidence

### 3.1 Local chain

`npm run flutter:analyze` - "No issues found". `npm run flutter:test` - **67 passed, 3 skipped** (`DEFERRED_BY_PLAN`: pull/resume -> M1b-S6; the outbox commit also leaves T-O3 / M1b-S4-ledger and push / M1b-S5 rows marked). Local builds: `flutter build windows --release` PASS; `flutter build apk --debug` PASS (Android SDK 36 present; `flutter doctor` reports unaccepted-licenses, the build does not depend on them). `npm run verify` passed all gates, `format:check`, `lint`, `typecheck`, and the backend unit suite; the real-PostgreSQL database acceptance refuses to run without `DATABASE_URL` - a pre-existing, CI-only stage (§36.1 T-5), green in CI (§3.6).

### 3.2 Generated code

`app_database.g.dart` regenerated with `build_runner` under the pinned SDK and committed (M1b-S2 D-6 precedent). No generator config changed.

### 3.3 Schema and writer (verified)

`AppDatabase.schemaVersion = 2`; the `outbox` table carries the 17 §38.8.1 columns, `mutation_id` as PK, unique on `device_local_sequence` and `device_idempotency_key`, `sync_state` indexed. `local_audit_events` is append-only (`autoIncrement` id; no update or delete paths). `_allocateSequence` allocates from a `local_meta` counter inside the caller's transaction; a rollback returns the number to the counter. `_allocateLocalNow` refuses any timestamp at or below the persisted high-water mark. `_transitionInTxn` validates the edge, enforces the error-code rule, writes only the four bookkeeping columns, and appends exactly one audit row. `OutboxCompactor` (F-17) sorts `SYNCED` newest-first with `device_local_sequence` as tie-break, keeps the newest `auditFloor`, and deletes only rows whose age is strictly before `cutoff`.

### 3.4 Test evidence

| Suite                         | Result                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| Writer + state machine        | validation, rollback, binding, edges, error-code rules, one-audit-per-transition all green |
| Durability (T-O2 half)        | rows and gap-free sequence survive close/reopen; monotonic guard persists                  |
| Migration (T-O19)             | seeded v1 -> v2 keeps `local_meta` rows, creates both tables, records version 2            |
| Compaction (F-17)             | floor-outranks-age, `SYNCED`-only, audit rows survive, invalid args thrown                 |
| Ordering + counts             | ascending sequence, gap-free, deterministic floor cut, all seven states zero-included      |
| Governance (T-O21)            | `SYNCED` only from `SYNCING`, per-transition audit, `attempt_count` mirror                 |
| Deferred markers              | 3 skips titled `DEFERRED_BY_PLAN` - absent, not faked green                                |

### 3.5 Drift negative re-proven (G-7 non-vacuous)

Adding a marker line to the committed `packages/contracts/src/generated/schemas.ts` made `npm run contracts:check` exit 1 with "contract drift detected: schemas.ts: drifted"; the file was restored byte-identically (SHA-256 verified) and the check passed again. The committed artifacts were not otherwise touched, and the CI `contract-drift` check is green on this head (§3.6).

### 3.6 Remote CI

All runs are on the implementation head `eee9d2f`.

| Run         | Event        | SHA       | Result      | Jobs                                         |
| ----------- | ------------ | --------- | ----------- | -------------------------------------------- |
| 37819363112 | push         | `eee9d2f` | **success** | all 7 required checks success                |
| 37819543154 | pull_request | `eee9d2f` | **success** | all 7 required checks success                |

The seven required checks: `fast-checks`, `backend-unit`, `backend-integration-database`, `contract-drift`, `dependency-audit`, `flutter-build-windows`, `flutter-build-android`. The database acceptance and the dependency audit ran green in CI (PostgreSQL 18 service, `npm audit --audit-level=high`) - the two stages this host cannot run locally.

### 3.7 PR

PR #8, head `codex/my-shop-m1b-s3-push-pull-transport`, base `codex/my-shop-m1b-s2-sync-contracts` (stacked on the unmerged M1b-S2 branch). Open, not merged. `origin/main` untouched; PRs #1-#7 untouched.

### 3.8 Offline threat-model walk (gate G-13)

§13.7 walked for this change:

| Threat row            | What this slice does / does not do                                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cashier manipulates offline state | Outbox has no cashier-facing delete and no update path except the four bookkeeping columns; every transition is mirrored to the append-only `local_audit_events`, and `device_local_sequence` is unique and gap-free so a hand-edited row gaps the audit trail on sync; the server's mutation ledger re-derives everything (§38.24.1) |
| Duplicate replay      | `device_idempotency_key` unique index, populated with the UUIDv7, so a row-level duplicate is impossible locally and the server ledger's `REPLAY` guard gets the key (§38.9) |
| Local database tampering before sync | Payload is encoded once at enqueue and never rewritten (§38.8.2); the audit log is append-only; gap detection on `device_local_sequence` exposes tampering on sync |
| Timestamp manipulation| `local_created_at` is a persisted monotonic high-water guard, not the raw clock (§38.16.5 backward-jump rule); windowed forward-jump re-validation remains a transport-slice duty (M1b-S5/S6) |
| Sync-storm / resource exhaustion | F-17 compaction is `SYNCED`-only with a hard audit floor, so storage is bounded and acknowledgment history survives; backoff/jitter and `Retry-After` remain transport duties |
| Queue deletion        | No delete path exists in the writer or the schema (only the governed compactor deletes `SYNCED`, §38.25, §38.30.1) |
| Mutation forging      | Out of scope here: server-side re-validation of stock guards, pricing, and permissions against current server state (§38.19) is backend work |

**Statement of limits** (unchanged from §13.7): offline means the device is briefly a trusted participant. This slice makes tampering detectable and attributable; it does not prevent a compromised device from attempting fraud, and device-file encryption (O-18) remains an open owner decision. No new unauthenticated surface, no new secret, no new permission (G-8).

---

## 4. Decisions and scope-difference report

### 4.1 Decisions

| #   | Decision                                                                                                | Rationale                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| D-1 | Audit floor default 1000 and retention 90 days mirror the server `change_log` window (§38.11.1)          | F-17 says "hard floor retained for audit"; the concrete numbers are slice decisions, recorded here and in `outbox_compactor.dart` |
| D-2 | `attempt_count` increments on entering `SYNCING`, and `last_attempt_at` is stamped then                 | "Entering SYNCING is the attempt" (writer doc, §38.8.1); retries are then reconstructible from the audit log alone              |
| D-3 | The floor outranks age                                                                                  | §38.25 F-17 "hard floor retained for audit - never unbounded"; with fewer than 1000 `SYNCED` rows, compaction deletes nothing    |
| D-4 | Age is the latest `SYNCED` transition's audit timestamp, falling back to `local_created_at`             | §38.13 timestamps every transition; the fallback covers migrated rows with no audit history                                     |
| D-5 | `CONFLICT` and `PERMANENT_REJECTED` have no outgoing edges yet                                            | §38.13 delegates their next step to owner resolution; the edges arrive with the slice that builds resolution, not before         |
| D-6 | Local columns store the M1b-S2 wire names (`UPPER_SNAKE`)                                               | The local table, the state machine, and `sync.contract.ts` cannot drift apart silently                                           |
| D-7 | UUIDv7 is the `mutation_id` and doubles as `device_idempotency_key`                                      | §38.8.1 duplicates the value; one UUIDv7 gives encoded time-order plus the idempotency guarantee                                 |
| D-8 | Drift 2.35 stores `DateTime` as unix seconds                                                              | Tests assert at second granularity; a deliberately typed (not just compatible) drift mapping is a later slice concern           |
| D-9 | `app_database.g.dart` committed again                                                                    | Inherited M1b-S2 D-6: generated companion committed so a fresh clone compiles; a hand edit is overwritten by regeneration        |
| D-10 | Transport (M1b-S5/S6) and the sale half of T-O2 deferred and marked, not silently dropped               | §40.5 / §43.4 split the milestones; the skipped tests carry `DEFERRED_BY_PLAN` titles that name the owning slice                 |

### 4.2 Scope-difference report

The slice's branch and token are named for the original prompt's M1b-S3 title, "push/pull transport". The **plan** (ML §40.5 row M1b-S3) is `durable outbox`, and push/pull transport is M1b-S5/S6. Per plan §43.4, the milestone name wins: this record delivers the durable outbox and defers the transport to its own slices, exactly as M1b-S2's record forecast and exactly as the prompt's "as-named vs as-planned" framing requires. The slack that once forced S2's `16-column` slip is settled by S-1's explicit 17-column list.

### 4.3 Gates G-1…G-13

| Gate | Condition | Result |
| --- | --- | --- |
| G-1 | acceptance criteria verified and recorded | PASS - §2.5 vs §3 |
| G-2 | declared tests exist and pass | PASS - 67 passed, 3 deferred/skipped (never removed wholesale) |
| G-3 | applicable §36.4 invariant tests | Not applicable - no business rule code yet; the offline invariant half is carried by T-O21 (G-9) |
| G-4 | all CI stages pass | PASS - locally `npm run verify` except the CI-only DB stage; remotely all 7 required checks green on `eee9d2f` |
| G-5 | no file outside `allowed_paths` modified | PASS - commit diff confined to §2.3 |
| G-6 | `non_scope` verifiably untouched | PASS - no contract artifacts, no backend, no UI, no CI, no plan edit |
| G-7 | migration impact as declared; local/server migrations immutable | PASS - additive forward-only v1->v2; no historical migration bytes changed; drift check green (§3.5, §3.6) |
| G-8 | security impact as declared | PASS - no new endpoint, permission, or secret; §13.7 walk (§3.8) |
| G-9 | migration audit: no `GRANT ALL`, no interpolation | Not applicable - no SQL migration file; drift schema is table declarations under the offline guard |
| G-10 | rollback defined and feasible | PASS - delete the branch; `main` untouched |
| G-11 | documentation updated | PASS - this record; no decision changed the master plan |
| G-12 | owner authorized the merge | NOT SATISFIED - no merge performed, by design |
| G-13 | offline path: T-O tests pass and §13.7 walked | PASS - T-O2 (outbox half), T-O19, T-O21 green; §3.8 |

---

## 5. Deviations

**None** from the declared scope. No repair commit was needed (unlike M1b-S2). The only note is §4.2's as-named/as-planned correction, which is a documentation correction of S2's boundary text, not a change of this slice's declared content.

---

## 6. Boundary

The next slice is **M1b-S4** (ledger and the first half of the mutation path, §40.5). Push/pull transport (**M1b-S5/S6**) is deferred by plan (§43.4) and is **NOT AUTHORIZED** by this record.

```
M1b-S4 NOT AUTHORIZED
PASS_MY_SHOP_M1B_S3_PUSH_PULL_TRANSPORT_REMOTE_LOCKED
```