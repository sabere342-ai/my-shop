# MY SHOP - M1b-S9 SLICE RECORD: CONNECTIVITY MONITOR AND BACKOFF SCHEDULER

**Master plan:** `docs/governance/MY_SHOP_MASTER_PLAN.md` v1.1.0 — §40.5 (M1b-S9), §38.10.4 (retry: backoff with jitter, honour `Retry-After`, `429`/`5xx` behaviour), §38.10.3 (partial-batch semantics), §38.10.5 (resume from the local cursor), §38.9.3 (a failed attempt is safe because mutations are idempotent), §38.26 T-O9/T-O22, §38.31 (the cashier never interacts with the sync engine), §38.31.1 (owner sync console), §38.28.3 (no secret in a snapshot), §38.6.2 (local schema change only when genuinely required), §39.6 (`local_meta`), §36.1 T-2 (no silent skips), §36.2 (suites), §37.2 (CI stages), §37.4 (`/healthz` liveness contract), §43.1 (G-1…G-13), ADR-003 (no global mutable singletons), ADR-044
**Slice:** M1b-S9
**Branch:** `codex/my-shop-m1b-s9-connectivity-backoff`
**Predecessor:** `1fb5db733afb7f03ddadadabcdf35ba49626ff3a` — M1b-S8 (record tip), branch `codex/my-shop-m1b-s8-offline-auth-grace` (PR #14, open, base `codex/my-shop-m1b-s7-loop-prevention`)
**Repair commit:** none required against the predecessor
**Final SHA (implementation head):** `c7efbee091795539afd89099ae63877ebabe1af1`
**Declaration status:** `PASS_MY_SHOP_M1B_S9_REMOTE_LOCKED` (connectivity monitor and backoff scheduler delivered and remote-locked)

---

## 1. Predecessor state

### 1.1 Entry state, verified not assumed

| Check              | Value                                                                                                         | Result                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Repository root    | `C:/dev/my-shop`                                                                                              | pass                                          |
| Branch at entry    | `codex/my-shop-m1b-s8-offline-auth-grace` @ `1fb5db7`                                                         | pass - equals the accepted M1b-S8 record tip   |
| Branch created     | `codex/my-shop-m1b-s9-connectivity-backoff` from `1fb5db7`                                                    | pass                                          |
| Ancestry           | `c7efbee` (S9) -> `1fb5db7` (S8 record) -> `556abd2` (S8) -> `5a2f397` (S7 record) -> `ec711fc` (S7) -> … -> `main` | pass - stacked ancestry intact (`merge-base --is-ancestor` true) |
| `origin/main`      | `53f6aaa`, unchanged by this slice                                                                            | pass                                          |
| Worktree at entry  | clean, no commits on the new branch                                                                           | pass - started clean, not restarted           |
| Predecessor record | `MY_SHOP_M1B_S8_SLICE_RECORD.md` present, declares M1b-S9 not authorized by S8                                | read; its §6 boundary is superseded here      |

### 1.2 Predecessor findings (carried, not re-opened)

No blocking defect existed in the committed M1b-S8 tree; it was green on its own head. Four S8 decisions matter to S9 and are honoured rather than re-litigated:

- **The outbox is the durable queue and the single remote-apply door is `applyRemoteWithoutOutbox`** (§38.12.1). S9 drives that outbox and never writes remote-origin data, so the S8 gate and the S7 loop invariant are untouched.
- **Local schema v3 is current** (v1 `local_meta`, v2 outbox, v3 remote-apply guard). S9 adds no table and no migration, so v3 stays the current version (§2.2, §3.5).
- **`PushOrchestrator` already owns batching, partial-batch semantics, and the S5 backoff** (§38.10.3, §38.10.4). S9 reuses it and adds only provenance plus the scheduling loop; it does not fork the transport.
- **`authenticationRequired` is a fault, not a block.** S8's bounded offline session remains the authority on whether a mutation may be written; S9 only reflects the auth fault into its indicator/attention state and keeps retrying on the capped ladder (§3.3).

### 1.3 The M1b-S5 record gap (carried from S6/S7/S8, unchanged)

The M1b-S5 branch (`e75ba03`, PR #11) was accepted with no slice record; the M1b-S6/S7/S8 records named this rather than inventing one. S9 does not re-open it.

---

## 2. Declaration

### 2.1 `scope`

Per Master Plan §40.5 row **M1b-S9 — connectivity monitor and backoff scheduler**: online/offline detection, the retry ladder, and the offline indicator state. The principal invariants are §40.5's "No busy-loop; `Retry-After` honoured" and §38.10.4's retry table. This slice is client-only (Dart/Flutter); it changes no server, Prisma, contract, or schema-of-record.

| #    | Outcome                                                                                                                                                                                                                                                                       |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-1  | New module `apps/desktop/lib/core/offline/connectivity/connectivity_state.dart`: the connectivity vocabulary `BackendConnectivity` (`unknown`/`recovering`/`reachable`/`degraded`/`unreachable`), `ReachabilityFailureKind`, `ConnectivityEvidence`, and the immutable `ConnectivitySnapshot`. A network interface is never confused with the backend, and `unknown` is an explicit initial value |
| S-2  | New `connectivity_probe.dart`: the `ConnectivityProbe` port and the pure `ProbeResult`/`ProbeClassification` vocabulary. The port is bounded and non-re-entrant by contract; results carry no URL, header, token, or body (§38.28.3)                                             |
| S-3  | New `http_health_probe.dart`: `HttpHealthProbe` hitting the §37.4 `/healthz` liveness contract (`{ "status": "ok" }`), plus pure classifiers `isLivenessOkBody`, `classifyProbeError`, `classifySocketError`, `classifyHealthResponse`. Bounded timeout, capped body read, per-probe `HttpClient` force-closed; a captive portal returning HTML/`200` is `unexpectedResponse` |
| S-4  | New `connectivity_monitor.dart`: a pure state machine that maps probe results and sync evidence into `ConnectivitySnapshot`, enforces a success-freshness window, tracks consecutive failures through `BackoffPolicy`, honours a probe `Retry-After` (larger wins), coalesces concurrent `checkNow` calls (single-flight), and emits changes without duplicates |
| S-5  | New `retry_after.dart`: `parseRetryAfter` (numeric seconds and HTTP-date; invalid/zero/negative/past fall back; a `defaultRetryAfterCap` of 24h bounds scheduling). Date parsing takes an injected `now`. **Fixes a real bug**: `HttpDate.parse` throws `HttpException` (not `FormatException`) for an invalid date, so both are caught |
| S-6  | New `retry_deadline_store.dart`: the absolute server-directed deadline persists in the existing `local_meta` table under `push_server_retry_deadline_ms`; a corrupt, blank, or sentinel (`<= 0`) value reads as `null`. **No schema change, no migration** (§38.6.2, §39.6) |
| S-7  | `push_orchestrator.dart` gains two provenance fields on `PushRunResult` — `serverRetryAfter` (strictly positive only) and `httpStatus` — so the scheduler persists the exact server directive rather than a jittered ladder value (§40.5 C4). A per-mutation outcome pass reports an implicit `200` |
| S-8  | New `sync_scheduler.dart`: the single-timer scheduler. It gates on connectivity, enforces the persisted server deadline, applies a minimum run spacing (no busy loop), coalesces triggers, blocks on `client-too-old`/`server-unsupported` with a slow recheck (no storm), maps faults to connectivity evidence, persists/clears the deadline, and pauses/resumes/disposes cleanly (§40.5 C3/C6/C8) |
| S-9  | New `scheduler_timer.dart`: the narrow `RetryTimer`/`RetryTimerFactory` ports with a `SystemRetryTimerFactory` production adapter, so scheduling is deterministic in tests (§40.5 C3/C8) |
| S-10 | New `sync_indicator.dart`: `SyncIndicatorState` plus `SyncIndicatorSnapshot.from`, deriving the indicator by an explicit precedence (blocked/auth → review → syncing → retryDelayed → pending → synchronized) for a later UI slice (§40.5 C7, §38.31) |
| S-11 | No server, contract, migration-of-record, local-schema, CI-workflow, or toolchain change. The connectivity module lives under the existing stage-23/24 posture without a new exemption (§3.5) |

### 2.2 `non_scope`

| Not touched                                                                          | Reason                                                                                                                    |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Rendering an actual **UI indicator** (widget, Arabic string §38.31, RTL layout)       | §40.5's M1b-S9 non-scope is **UI presentation**; S9 delivers the *indicator state* a UI will bind to                     |
| The concrete authenticated **pull transport** and client **resume cursor/orchestration** | §40.5 keeps fetch/resume with the pull protocol (§38.11); S9 does detection, scheduling and push retry, not fetch         |
| Own-echo **reconciliation** and full entity payload retrieval / business tables       | Later business slices; the S7 descriptor boundary is unchanged                                                            |
| **Observability plumbing** (`trace_id`/metrics, structured redacted logs)             | M1b-S10 (§38.28); S9 keeps a minimal non-secret `logger` seam and stores no host, URL, header or body (§38.28.3)          |
| **App lock** (M9) and the authenticated session flow                                  | Not in §40.5's M1b-S9 column set; S8's `OfflineAuthGate` remains the mutation authority                                    |
| `sync_conflicts`, conflict UI, business modules, business tables                      | Not in §40.5's M1b-S9 column set                                                                                          |
| Server code, Prisma schema, contracts, CI workflow, root toolchain/lockfile           | S9 is client-only; no backend or contract decision changes                                                                |
| Master plan, S1–S8 records, `main`                                                    | No plan decision changed; the plan is not edited; `main` untouched                                                        |
| Merging PR #15, auto-merge                                                            | Owner boundary; not performed, not requested (§4.3 G-12)                                                                  |

### 2.3 `allowed_paths`

```
apps/desktop/lib/core/offline/connectivity/connectivity_state.dart
apps/desktop/lib/core/offline/connectivity/connectivity_probe.dart
apps/desktop/lib/core/offline/connectivity/http_health_probe.dart
apps/desktop/lib/core/offline/connectivity/connectivity_monitor.dart
apps/desktop/lib/core/offline/outbox/retry_deadline_store.dart
apps/desktop/lib/core/offline/sync/push_orchestrator.dart
apps/desktop/lib/core/offline/sync/retry_after.dart
apps/desktop/lib/core/offline/sync/scheduler_timer.dart
apps/desktop/lib/core/offline/sync/sync_indicator.dart
apps/desktop/lib/core/offline/sync/sync_scheduler.dart
apps/desktop/test/offline/connectivity_monitor_test.dart
apps/desktop/test/offline/connectivity_test_harness.dart
apps/desktop/test/offline/http_health_probe_test.dart
apps/desktop/test/offline/push_retry_provenance_test.dart
apps/desktop/test/offline/push_test_harness.dart
apps/desktop/test/offline/retry_after_test.dart
apps/desktop/test/offline/retry_deadline_store_test.dart
apps/desktop/test/offline/sync_indicator_test.dart
apps/desktop/test/offline/sync_scheduler_test.dart
apps/desktop/test/offline/sync_transport_deferred_test.dart
docs/governance/MY_SHOP_M1B_S9_SLICE_RECORD.md
```

This slice's implementation commit touches exactly the first twenty paths (ten `lib/` files — nine new plus `push_orchestrator.dart` — and ten `test/` files — nine new plus `sync_transport_deferred_test.dart`); the record commit adds the twenty-first. No other path is modified.

### 2.4 `tests`

| Level                       | Requirement                                                                                                                                                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gate positives              | All `gates`, `format:check`, `lint`, `typecheck`, `contracts:check`, and `npm audit --audit-level=high` green on this host; `flutter analyze --fatal-infos` "No issues found!"; `flutter test` **275 passed, 1 skipped**                               |
| Probe (§40.5 C1)            | Liveness body accepts only the exact contract; HTML/other/short bodies are captive-portal `unexpectedResponse`; error/socket classifiers cover DNS/refused/unreachable/timeout/TLS; `5xx` is degraded, `4xx` reachable, redirects unexpected; a live local server is reachable, a `503` degraded, an HTML `200` unreachable, a `429` carries `Retry-After`, a closed port never hangs, a slow server is bounded by the timeout |
| Monitor (§40.5 C1/C2)       | A fresh process is `unknown` but optimistic; a reachable probe records verification and a freshness window; a probe is not repeated inside the window; `force` re-probes; an unreachable probe schedules a laddered backoff; the ladder grows with failures; a larger `Retry-After` is honoured and a shorter one does not shorten the ladder; `5xx` is `degraded`; concurrent `checkNow` coalesces into one probe; an in-flight probe after a failure is `recovering`; sync evidence updates the verdict without a probe; a success clears a prior failure; identical snapshots are not emitted twice; `checkNow` after `dispose` throws; `timeUntilNextProbe` is zero when due |
| Retry-After (§40.5 C4)      | Seconds and HTTP-dates parse; `null`/blank/non-numeric/unparseable-date/`0`/negative/past fall back to `null`; the 24h cap clamps; a date exactly now is past; the injected `now` makes dates deterministic |
| Deadline store (§40.5 C4)   | Empty reads `null`; a written deadline round-trips by epoch milliseconds; `clear` removes it; a later write replaces the earlier; corrupt, blank, zero-sentinel, and negative-sentinel values all fall back to `null` |
| Provenance (§40.5 C4)       | A per-mutation outcome pass is an implicit `200` with no directive; `429` carries the status and the raw `serverRetryAfter`; `503` without `Retry-After` yields a status but no directive; a zero `Retry-After` is not a directive; a network failure has no HTTP status; `426`/`401`/`400` report their statuses                                  |
| Scheduler (§40.5 C3/C6/C8)  | An idle outbox schedules no wakeup and never probes; an unreachable backend waits and recovers on the next probe; a persisted server deadline gates a fresh scheduler (restart); the spacing floor prevents a busy loop; a transient `Retry-After` is persisted as an absolute deadline; `5xx` is degraded with a laddered wait; a network failure is unreachable; `client-too-old` blocks and rechecks slowly; `server-unsupported` blocks and preserves the queue; authentication is attention, not a block; a successful pass clears a stale deadline; concurrent triggers coalesce into a single pass; pause cancels work and resume re-evaluates; `dispose` is idempotent |
| Indicator (§40.5 C7)        | The full precedence matrix: empty -> `idle`; all-synced -> `synchronized`; `PENDING`/`LOCAL_ONLY` -> `pending`; `RETRYABLE_ERROR`, a future deadline, or a future `nextRunAt` -> `retryDelayed`; `SYNCING`/pass-in-flight -> `syncing`; `CONFLICT`/`PERMANENT_REJECTED` -> `reviewRequired`; auth attention -> `authenticationRequired`; blocked -> `upgradeRequired`/`serverUnsupported`; a block outranks review, syncing and retry; review outranks syncing and retry; syncing outranks retry; retry outranks pending; `offlineWithPendingWork` only when unreachable with a queue |
| Deferral (T-O6, §36.1 T-2)  | The one skipped test remains `DEFERRED_BY_PLAN` and its comment names the connectivity/scheduler slice as owner; it is annotated, never silently dropped                                                                                             |
| Remote CI                   | All seven required checks green on the implementation head `c7efbee` (§3.6)                                                                                                                                                                           |

### 2.5 `acceptance_criteria`

| #     | Criterion                                                                                                   | Evidence    |
| ----- | ----------------------------------------------------------------------------------------------------------- | ----------- |
| AC-1  | Reachability is decided against the *configured backend*, not a network interface; the initial state is `unknown` (§40.5) | §3.9 C1     |
| AC-2  | An immutable snapshot exposes classification, last verification, last failure class, next probe, and whether a pass may start (§40.5 C2) | §3.9 C2     |
| AC-3  | The scheduler uses a single timer and never busy-loops: it does not wake while idle and applies a minimum run spacing (§40.5) | §3.9 C3     |
| AC-4  | A server `Retry-After` wins over the local ladder, cannot be shortened, is bounded, and survives a restart (§38.10.4) | §3.9 C4     |
| AC-5  | One pass runs at a time; re-entrant/coincident triggers coalesce instead of stacking (§38.10.3)               | §3.9 C5     |
| AC-6  | `client-too-old` and `server-unsupported` block auto-retry, preserve records, and recheck slowly instead of storming (§40.5) | §3.9 C6     |
| AC-7  | The offline indicator state is derived by an explicit precedence a UI can bind to, without exposing internal sync states to the cashier (§38.31) | §3.9 C7     |
| AC-8  | The probe is bounded, resource-safe, and cancellable in effect; a slow/closed/dead endpoint never hangs or leaks (§40.5) | §3.9 C8     |
| AC-9  | A failed attempt is safe because mutations are idempotent; the scheduler only drives the durable outbox and deletes nothing (§38.9.3, §38.8) | §3.3, §3.8  |
| AC-10 | No server/Prisma/contract/CI-workflow change; `contracts:check` green                                          | §3.1, §3.5  |
| AC-11 | No local schema change; the deadline lives in `local_meta` and the local version stays v3 (§38.6.2, §39.6)     | §3.5        |
| AC-12 | All gates and local suites pass; `flutter analyze --fatal-infos` clean                                         | §3.1        |
| AC-13 | PR #15 stacked on the M1b-S8 branch, open, not merged; all seven checks green on `c7efbee`                     | §3.6, §3.7  |
| AC-14 | No destructive Git operation; `main` and S1–S8 untouched                                                       | §4.3 G-4/G-5 |
| AC-15 | The transport/resume deferral is annotated, not dropped (T-O6)                                                 | §3.1, D-13  |

---

## 3. Execution and evidence

### 3.1 Local chain

`npm run gates` — secret-scan, markdown, import-boundary, vocabulary, localization, design-system, immutability, **offline (stages 23–24)**, migration-immutability — **all green (exit 0)**. `npm run toolchain:verify` — **PASS** (node `22.22.3`, npm `10.9.8`, flutter `3.47.5`, dart `3.13.4` match the pin). `npm run format:check`, `npm run lint`, `npm run typecheck`, and `npm run contracts:check` ("contracts are in sync") — **all green**. `npm run flutter:analyze` (`flutter analyze --fatal-infos`) prints **"No issues found!"**. `npm run flutter:test` prints **"275 passed, 1 skipped"**. `npm audit --audit-level=high` exits 0.

The stage-24 offline gate reports the offline module present with the existing written exemptions and **no new exemption** for this slice: `retry_deadline_store.dart` sits under `lib/core/offline/outbox/`, which the gate already exempts as the outbox module's `local_meta` bookkeeping, so S9 weakens no gate (§3.5). The single skipped test is `DEFERRED_BY_PLAN: T-O6 pull resumes after reconnect without gaps`, whose comment now names the connectivity/scheduler slice as owner, not S8 (§3.1, D-13).

### 3.2 Environment

Windows host, 8 GB RAM; Flutter work was run sequentially through the pinned wrapper `node ./tool/flutterw.mjs` (Flutter `3.47.5` / Dart `3.13.4`), which runs with `cwd=apps/desktop`. The API databases are untouched by this client-only slice.

### 3.3 Implementation notes

Five details carry the slice's weight:

1. **A reachability verdict is evidence, not a guess.** `unknown` is a real initial state, and a sync pass is itself a reachability test: a completed pass feeds `ConnectivityEvidence` back into the monitor, so the verdict stays honest without spending a second request (§40.5, §38.28).
2. **The server directive is persisted as an absolute deadline, not a duration.** `PushRunResult.serverRetryAfter` is strictly positive only; the scheduler writes `now + directive` into `local_meta` and clears it on a pass with no directive. A restart therefore cannot shorten the server's instruction (§38.10.4, §40.5 C4). The scheduler *also* compares the server delay against the local ladder on the transient-fault path and takes the larger.
3. **Two independent no-storm guards.** The scheduler never wakes while the outbox has no work, applies a `minRunSpacing` floor between passes, coalesces multiple triggers into one, and — for `client-too-old`/`server-unsupported` — schedules a slow `blockedRecheckInterval` recheck instead of a backoff ladder that would keep hammering a server that will never accept the client (§40.5 C6).
4. **Blocked states preserve records; auth is attention.** `client-too-old` and `server-unsupported` requeue (the orchestrator moves `SYNCING` rows back to `PENDING`), so nothing is lost; the scheduler surfaces `blocked`. An `authenticationRequired` fault is *not* a block — the queue keeps retrying on the capped ladder while `authAttention` is surfaced for a UI (§3.8).
5. **Real bug fixed in `Retry-After` parsing.** `HttpDate.parse` throws `HttpException`, not `FormatException`, for an invalid date. The first implementation caught only `FormatException`, so a malformed date would have escaped the parser and violated the "invalid falls back to local policy" guarantee; the test suite caught it and `retry_after.dart` now catches both (§3.4, D-14).

### 3.4 Test evidence

| Suite                                | Result                                                                                                                                                                                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `http_health_probe_test.dart`        | Pure classifiers (`isLivenessOkBody`, `classifyProbeError`, `classifySocketError`, `classifyHealthResponse`) plus a live local server: healthy -> reachable, `503` -> degraded, HTML `200` -> unreachable, `429` -> directive carried, closed port -> unreachable without hanging, slow server -> bounded by timeout — all green |
| `connectivity_monitor_test.dart`     | Fresh `unknown`; freshness window; forced re-probe; laddered backoff; `Retry-After` larger honoured / shorter ignored; `5xx` degraded; single-flight coalescing; `recovering` while in flight; evidence without a probe; success clears failure; no duplicate emissions; disposed guard; `timeUntilNextProbe` — all green |
| `retry_after_test.dart`              | Seconds and HTTP-date parsing; the full invalid-input fallback matrix; the 24h cap; exact-now-is-past; injected `now` — all green. **This suite is what caught the `HttpException` bug.** |
| `retry_deadline_store_test.dart`     | Empty/round-trip/clear/replace; corrupt, blank, zero and negative sentinels -> `null` — all green                                                                                                                                             |
| `push_retry_provenance_test.dart`    | `PushRunResult.serverRetryAfter`/`httpStatus` provenance across implicit-`200`, `429`, `503`, zero-directive, network, `426`, `401`, `400` — all green                                                                                         |
| `sync_scheduler_test.dart`           | Idle no-wakeup; unreachable wait-and-recover; persisted-deadline restart gate; spacing floor; `Retry-After` persisted; `5xx` degraded; network unreachable; blocked recheck; queue preserved when unsupported; auth attention; stale deadline cleared; trigger coalescing; pause/resume; idempotent dispose — all green |
| `sync_indicator_test.dart`           | The full §40.5 C7 precedence matrix and `offlineWithPendingWork` — all green                                                                                                                                                                   |
| Flutter                              | `flutter analyze --fatal-infos` "No issues found!"; `flutter test` **275 passed, 1 skipped** (`DEFERRED_BY_PLAN`, transport/resume)                                                                                                             |
| `dependency-audit`                   | `npm audit --audit-level=high` exit 0                                                                                                                                                                                                          |

### 3.5 Local schema and contract drift

S9 **does not change the local schema**. The current version stays **v3** (v1 `local_meta`, v2 outbox, v3 remote-apply guard). The only durable state S9 adds is one `local_meta` key, `push_server_retry_deadline_ms`, holding an absolute epoch-millisecond instant — the same device-local key/value posture §39.6 already names, and the same writer rule the outbox module already has. §38.6.2 asks for a local schema change only when one is genuinely required, and none is. Because no schema changed, there is no migration and no backup-before-migration step; `app_database.g.dart` was not regenerated and does not appear in the diff.

This slice **does not change the server contract**: no `schema.prisma`, no OpenAPI, no generated TypeScript. `npm run contracts:check` prints "contracts are in sync". `gate:migrations` (G-6) is green with the same migration history, none rewritten.

**No tool change.** Unlike S8, S9 changes no CI guard. `retry_deadline_store.dart` lives under `lib/core/offline/outbox/`, which stage 24 already exempts as the outbox module's `local_meta` bookkeeping; every other new file under `connectivity/` and `sync/` is pure classification, scheduling, or persistence-through-the-outbox and writes no remote-origin data.

### 3.6 Remote CI

All runs on the implementation head `c7efbee` (G-4 exact-SHA discipline; no earlier run is offered as a substitute).

| Run         | Event        | SHA       | Result  | Jobs                                          |
| ----------- | ------------ | --------- | ------- | --------------------------------------------- |
| 38605880802 | push         | `c7efbee` | success | all 7 required checks green                   |
| 38607201244 | pull_request | `c7efbee` | success | all 7 required checks green                   |

The seven required checks: `fast-checks`, `backend-unit`, `backend-integration-database`, `contract-drift`, `dependency-audit`, `flutter-build-windows`, `flutter-build-android`. On **both** events all seven are green on `c7efbee`, including `fast-checks` (which runs this slice's Dart on the pinned SDK: `flutter analyze --fatal-infos` and the **275-passing** `flutter test`), `backend-integration-database` (real PostgreSQL 18, unaffected by this client-only slice), and `flutter-build-windows`/`flutter-build-android` (which compile the new `lib/core/offline/connectivity` and `lib/core/offline/sync` code into release artifacts).

The record commit that follows the implementation head is documentation-only; its head is verified green as well and reported with this slice.

### 3.7 PR

PR #15, head `codex/my-shop-m1b-s9-connectivity-backoff`, base `codex/my-shop-m1b-s8-offline-auth-grace` (stacked on the unmerged M1b-S8 branch, PR #14, itself stacked on the M1b-S7 PR #13 -> M1b-S6 PR #12 -> M1b-S5 PR #11 -> M1b-S4 PR #9). Open, not merged. `origin/main` untouched; PRs #1–#14 untouched.

### 3.8 Offline/idempotency threat-model walk (gate G-13)

§13.7 walked for this slice — the connectivity, retry, and storm threats:

| Threat / failure row                                   | What this slice does / does not do                                                                                                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Network error, DNS failure, timeout (§38.10.4)         | The probe and the transport classify the failure; the record stays durable and `PENDING`; the scheduler backs off and retries (AC-1, AC-9)                                    |
| `429` (§38.10.4)                                       | `Retry-After` is honoured, cannot be shortened, is capped at 24h, and is persisted as an absolute deadline so a restart cannot retry early (AC-4, AC-5)                      |
| `5xx` (§38.10.4)                                       | Classified `degraded` (reachable, unhealthy) and ladders; a `5xx` may or may not have applied, and idempotency makes the retry safe (AC-4, AC-9)                             |
| `401`/`403` (§38.10.4)                                 | Surfaced as `authenticationRequired` attention, not a block; the queue keeps retrying on the capped ladder, and S8 re-evaluates grace (AC-6, §3.3)                          |
| A busy-loop / retry storm                              | The scheduler never wakes while idle, applies a minimum run spacing, coalesces triggers to one pass, and rechecks blocked states slowly (AC-3, AC-5, AC-6)                    |
| A client too old / an unsupported server               | Blocked with records preserved (requeued), and a slow recheck instead of a storm (AC-6)                                                                                       |
| A captive portal or interception proxy answering `200` | The probe requires the exact `/healthz` liveness contract; a wrong-shaped `200` is `unexpectedResponse` -> unreachable, never a false "reachable" (AC-1, §3.3)                |
| A hanging or resource-leaking probe                    | The probe is bounded by a timeout, caps the body read, and force-closes its per-probe client; a closed port returns unreachable rather than hanging (AC-8, §3.4)              |
| A false sense of global stock certainty                | Untouched and not claimed: the snapshot is connectivity only; §38.15's no-fake-certainty rule still governs stock (S-1, §2.2)                                                |
| The new scheduling loop shadowing the loop invariant   | The scheduler drives the durable outbox through the existing orchestrator; the S7 single-door and S8 gate are untouched, so §38.12.1 is never bypassed (AC-9, §3.3)           |
| Secret leakage into a snapshot or log                  | The snapshot carries a class, timestamps and counts only; the probe sends no token and stores no URL/header/body; the `logger` seam is non-secret (§38.28.3)                  |

**What this slice does not do:** it does not fetch a page, own the pull cursor, render a widget, emit a server-side security event, or ship the concrete authenticated transport — those are the pull-protocol, UI, observability, and later slices (§2.2). It detects reachability, schedules the push retry, and exposes an offline indicator state.

### 3.9 Requirements mapping (§40.5 C1–C8, §38.10.4)

The §40.5 M1b-S9 row names two jobs (online/offline detection and the retry ladder) and two inviolables ("no busy-loop", "`Retry-After` honoured"). The eight derived criteria below are the concrete, testable reading of that row used throughout this slice; each maps to the §38.10.4 retry table and to an implemented mechanism.

| #   | Derived criterion (§40.5 M1b-S9)                                                        | §38.10.4 / plan anchor                                  | Mechanism                                                                                    | Evidence   |
| --- | --------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------- |
| C1  | Backend reachability is decided explicitly (not a network interface; `unknown` real)     | §38.10.4 network/DNS/timeout; §37.4 `/healthz`          | `connectivity_state.dart`, `connectivity_probe.dart`, `http_health_probe.dart`               | §3.4       |
| C2  | An immutable snapshot exposes classification, verification, failure class, next probe     | §40.5 "offline indicator state"; §38.31                 | `ConnectivitySnapshot`, `ConnectivityMonitor`                                                | §3.4       |
| C3  | A single timer; no busy-loop (idle never wakes; minimum spacing)                          | §40.5 "No busy-loop"                                     | `scheduler_timer.dart`, `SyncScheduler._evaluate`/`_setNextRun`, `minRunSpacing`             | §3.4       |
| C4  | `Retry-After` honoured, cannot be shortened, capped, persisted across restart             | §38.10.4 "honouring `Retry-After`"; `429`                | `parseRetryAfter`, `RetryDeadlineStore`, `PushRunResult.serverRetryAfter`                    | §3.4       |
| C5  | One pass at a time; re-entrant/coincident triggers coalesce                               | §38.10.3 partial batch; §38.10.5 resume                  | `SyncScheduler._rerunRequested`, `_passInFlight`, `connectivity.checkNow` single-flight      | §3.4       |
| C6  | `client-too-old`/`server-unsupported` block without storming; records preserved           | §40.5 "No busy-loop"; §38.10.4 permanent-`4xx` posture   | `SyncBlockedReason`, `blockedRecheckInterval`, requeue-on-fault                              | §3.4       |
| C7  | Offline indicator state derived by explicit precedence for a future UI                    | §40.5 "offline indicator state"; §38.31                  | `SyncIndicatorState`, `SyncIndicatorSnapshot.from`                                           | §3.4       |
| C8  | Probe is bounded/resource-safe; scheduling is deterministic/testable                      | §40.5 "No busy-loop"; §37.4                              | probe timeout + capped read + force-close; `RetryTimerFactory` injection                     | §3.4       |

---

## 4. Decisions, scope difference, gates

### 4.1 Decisions

| #    | Decision                                                                                              | Reason                                                                                                                              |
| ---- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| D-1  | The server `Retry-After` deadline lives in the existing `local_meta` table; **no schema change**        | §38.6.2 asks for a change only when required; §39.6 names `local_meta` as the home of device-local state                            |
| D-2  | The deadline is persisted as an **absolute instant**, not a duration                                   | A duration re-applied after restart could be shortened by elapsed time; an absolute instant freezes the server's instruction (§38.10.4) |
| D-3  | Provenance (`serverRetryAfter`) is added to `PushRunResult` rather than recomputed by the scheduler    | The header is parsed once, where the response exists; a jittered ladder value must never masquerade as the server directive (§40.5 C4) |
| D-4  | A `Retry-After` of zero/negative is treated as **absent**                                              | The past cannot be waited for; treating it as a directive would persist a deadline the scheduler immediately satisfies (§40.5 C4)   |
| D-5  | The scheduler reuses the S5 `BackoffPolicy` and `PushOrchestrator` unchanged in behaviour              | The retry ladder already exists; S9 adds the scheduling loop and provenance, not a second transport (§38.10.4)                      |
| D-6  | A single injectable timer factory; production wraps `Timer`                                            | One timer avoids storms, and injection makes scheduling deterministic with no real sleeps (§40.5 C3/C8, ADR-003)                     |
| D-7  | The scheduler **never wakes while idle** and applies a `minRunSpacing` floor                           | §40.5's "no busy-loop" is enforced structurally, not by convention                                                                  |
| D-8  | Re-entrant triggers **coalesce** into one pending pass                                                 | §38.10.3's per-mutation semantics plus a single durable queue means duplicate concurrent passes are pure waste (§40.5 C5)             |
| D-9  | `client-too-old`/`server-unsupported` block auto-retry with a slow recheck and preserve records        | A server that will never accept the client must not be hammered; the queue must survive (§40.5 C6, §38.10.4)                       |
| D-10 | `authenticationRequired` is **attention, not a block**                                                 | §38.10.4 flags the device and re-evaluates grace; the queue keeps retrying, so surfacing attention without halting is correct (§38.16.4) |
| D-11 | The snapshot and monitor carry **no secret** — classes, timestamps and counts only                      | §38.28.3; a diagnostic classification must never become a credential or a URL                                                        |
| D-12 | The probe requires the **exact** `/healthz` contract, not any `2xx`                                    | A captive portal returning HTML/`200` must not read as "reachable" (§40.5 C1, §37.4)                                                |
| D-13 | `sync_transport_deferred_test.dart` comment updated to name the connectivity/scheduler slice           | §40.5 assigns the connectivity monitor and backoff scheduler to M1b-S9; the old "S8" note would mis-map the deferral (§2.2)         |
| D-14 | `parseRetryAfter` catches **both** `FormatException` and `HttpException`                               | `HttpDate.parse` throws `HttpException` for an invalid date; catching only `FormatException` would let a malformed header escape the "invalid falls back" guarantee (§3.3, §3.4) |

### 4.2 Scope-difference report

Three differences are named rather than silently crossed:

1. **S8's record forecast "M1b-S9 = connectivity monitor and backoff scheduler".** That matches §40.5, and S9 delivers exactly that row. The HTTP pull transport and client resume cursor, however, are the pull protocol's (§38.11) and remain deferred here with the deferral comment updated to name this slice as owner (D-13).
2. **§40.5's non-scope is "UI presentation".** S9 therefore delivers the *indicator state* (`SyncIndicatorState`/`SyncIndicatorSnapshot`) and explicitly does not render a widget or the §38.31 Arabic line; that binding is a later UI slice.
3. **No conflict table and no business entity.** As in S6–S8, the §40.5 M1b-S9 column set does not include `sync_conflicts` or business tables; S9 adds neither.

### 4.3 Gates G-1…G-13

| Gate | Condition                                                             | Result                                                                                                                                    |
| ---- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| G-1  | no business table outside the plan's data domain map                   | PASS - no table created at all; the deadline is `local_meta` key/value state (§3.5)                                                       |
| G-2  | contract files updated from the declaration and drift-clean            | PASS - no contract change; `contracts:check` in sync (§3.5)                                                                                |
| G-3  | schema/migration unchanged (no server migration this slice)            | PASS - no `schema.prisma`/server migration edit; the local Drift schema is unchanged at v3 (ADR-036); `migration-immutability` green      |
| G-4  | all CI stages pass; no history rewrite                                 | PASS - all 7 checks green on `c7efbee` for both events (§3.6); ordinary commits, no force push, no rebase                                |
| G-5  | no file outside `allowed_paths` modified                               | PASS - the slice diff is confined to §2.3                                                                                                  |
| G-6  | `non_scope` verifiably untouched                                       | PASS - no UI widget, no pull transport/resume, no observability plumbing, no business module, no plan/CI-workflow/server edit (§2.2)       |
| G-7  | migration impact as declared; migrations immutable; drift non-vacuous  | PASS - **no** local migration this slice (§3.5); no server migration; `migration-immutability` green                                       |
| G-8  | security impact as declared                                            | PASS - S9 adds no route, permission, or tenant path; it stores no secret and refuses to claim reachability on ambiguity; the storm and retry threats are walked (§3.8) |
| G-9  | migration audit: no `GRANT ALL`, no interpolation                      | PASS - no migration at all (§3.5)                                                                                                          |
| G-10 | rollback defined and feasible                                          | PASS - drop the branch and PR #15; `main` untouched; the change is client-local and additive                                                |
| G-11 | documentation updated                                                  | PASS - this record; the Dart deferral comment updated; no decision changed the master plan                                                    |
| G-12 | owner authorized the merge                                             | NOT SATISFIED for PR #15 - no merge performed, by design (left open)                                                                        |
| G-13 | offline path: threat model walked and tests                           | PASS - the connectivity/retry/storm threats walked; §3.8                                                                                    |

---

## 5. Deviations

- **One real bug was found and fixed during the slice.** `parseRetryAfter` originally caught only `FormatException`; `HttpDate.parse` throws `HttpException` for an invalid date. The test suite caught it, and both are now caught so a malformed header falls back to local policy (§3.3, D-14). This is a fix inside a new file, not a change to prior slices.
- **The record's §40.5 C1–C8 labels are this slice's derived criteria.** The plan's §40.5 M1b-S9 row states the jobs and inviolables but does not enumerate C1–C8; §3.9 defines the eight explicitly so the mapping is self-contained and testable.
- **Persistence was placed under `outbox/`.** The deadline is `local_meta` bookkeeping like the outbox's, so `retry_deadline_store.dart` lives under `lib/core/offline/outbox/` to reuse the existing stage-24 exemption rather than request a new one (S-6, §3.5).
- **No repair commit, no history operation.** This branch was created by ordinary commits from `1fb5db7`; nothing was force-pushed, reset, or rebased.

---

## 6. Boundary

The next slice is **M1b-S10** (offline observability plumbing per §40.5 — `mutation_id`/`device_id`/`sync_batch_id`/`trace_id` propagation, structured redacted logs, and metrics emission). It is **NOT AUTHORIZED** by this record. The UI binding of the offline indicator, the concrete authenticated pull transport, and cursor resume remain later concerns. Business modules remain unauthorized.

```
M1b-S10 NOT AUTHORIZED
PASS_MY_SHOP_M1B_S9_REMOTE_LOCKED
```
