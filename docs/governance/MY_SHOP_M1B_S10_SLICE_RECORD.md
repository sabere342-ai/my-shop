# MY SHOP - M1b-S10 SLICE RECORD: OFFLINE OBSERVABILITY PLUMBING

**Master plan:** `docs/governance/MY_SHOP_MASTER_PLAN.md` v1.1.0 — §40.5 (M1b-S10), §38.28 (observability: §38.28.1 correlation, §38.28.2 metrics, §38.28.3 logs and redaction), §38.10.4 (retry error classes), §38.9.2 (idempotency contradiction as a security event), §38.16.5 (clock-tamper as a security event), §38.9.1 (a mutation is referenced by id), §38.6.2 (local schema change only when genuinely required), §36.1 T-2 (no silent skips), §36.2 (suites), §37.2 (CI stages), §37.4 (`/healthz`), §43.1 (G-1…G-13), ADR-003 (no global mutable singletons)
**Slice:** M1b-S10
**Branch:** `codex/my-shop-m1b-s10-offline-observability`
**Predecessor:** `bbedef5b3bf8b8b12647f731552175c1fd82feb0` — M1b-S9 (record tip), branch `codex/my-shop-m1b-s9-connectivity-backoff` (PR #15, open, base `codex/my-shop-m1b-s8-offline-auth-grace`)
**Repair commit:** none required against the predecessor
**Final SHA (implementation head):** `dfb8f71e77f8b13f39acd55b1edafccdd94b1886`
**Declaration status:** `PASS_MY_SHOP_M1B_S10_REMOTE_LOCKED` (offline observability plumbing delivered and remote-locked)

---

## 1. Predecessor state

### 1.1 Entry state, verified not assumed

| Check              | Value                                                                                                         | Result                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Repository root    | `C:/dev/my-shop`                                                                                              | pass                                          |
| Branch at entry    | `codex/my-shop-m1b-s9-connectivity-backoff` @ `bbedef5`                                                       | pass - equals the accepted M1b-S9 record tip   |
| Branch created     | `codex/my-shop-m1b-s10-offline-observability` from `bbedef5`                                                  | pass                                          |
| Ancestry           | `dfb8f71` (S10) -> `423a75e` (S10 impl) -> `bbedef5` (S9 record) -> `c7efbee` (S9) -> `1fb5db7` (S8 record) -> … -> `main` | pass - stacked ancestry intact (`merge-base --is-ancestor` true) |
| `origin/main`      | `53f6aaa`, unchanged by this slice                                                                            | pass                                          |
| Worktree at entry  | clean, no commits on the new branch                                                                           | pass - started clean, not restarted           |
| Predecessor record | `MY_SHOP_M1B_S9_SLICE_RECORD.md` present, declares M1b-S10 not authorized by S9                                | read; its §6 boundary is superseded here      |

### 1.2 Predecessor findings (carried, not re-opened)

No blocking defect existed in the committed M1b-S9 tree; it was green on its own head. Four S9 decisions matter to S10 and are honoured rather than re-litigated:

- **The outbox is the durable queue and the single remote-apply door is `applyRemoteWithoutOutbox`** (§38.12.1). S10 only *reads* the outbox to count depth and never writes remote-origin data, so the S8 gate and the S7 loop invariant are untouched.
- **Local schema v3 is current** (v1 `local_meta`, v2 outbox, v3 remote-apply guard). S10 adds no table and no migration, so v3 stays the current version (§2.2, §3.5).
- **`PushOrchestrator` owns batching, partial-batch semantics, and the backoff.** S10 adds correlation, records and metrics around that orchestration; it does not fork or reorder the sync mechanics.
- **The `logger` seam S9 introduced was a minimal `void Function(String, dynamic)?`.** S10 replaces that unsafe dynamic `toString()` seam with the structured, redacted `TelemetryLogger`, which is exactly the "observability plumbing" S9's non-scope deferred here.

### 1.3 The M1b-S5 record gap (carried from S6/S7/S8/S9, unchanged)

The M1b-S5 branch (`e75ba03`, PR #11) was accepted with no slice record; the M1b-S6/S7/S8/S9 records named this rather than inventing one. S10 does not re-open it.

---

## 2. Declaration

### 2.1 `scope`

Per Master Plan §40.5 row **M1b-S10 — offline observability plumbing**: `mutation_id` / `device_id` / `sync_batch_id` / `trace_id` propagation, structured redacted logs, and metrics emission. The principal acceptance is §40.5's "**No secret appears in any log**" and §38.28.3's redaction-by-construction. This slice is client-first (Dart/Flutter) with a small, surgical server-side hardening so the same guarantee holds on the server's own caught-error paths. It changes no server contract, Prisma schema, or local schema-of-record.

| #    | Outcome                                                                                                                                                                                                                                                                       |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-1  | New module `apps/desktop/lib/core/telemetry/correlation.dart`: the §38.28.1 correlation vocabulary (`SyncCorrelation`), `isSafeCorrelationId` (mirrors the server's `[A-Za-z0-9._:-]{1,64}` rule), `generateTraceId` (reuses the secure `generateUuidV7`), and `resolveTraceId` (an inbound header is adopted only when safe, otherwise replaced) |
| S-2  | New `error_class.dart`: `errorClassOf(Object?)` returns a bounded runtime type name (`^[A-Za-z_][A-Za-z0-9_]{0,63}$`, else `Object`; `null` -> `null`). The message, the stack, and any cause are never read |
| S-3  | New `structured_log.dart`: the §38.28.3 client mirror of the server's allow-list — `LoggableKeys`, `allowedLogKeys`, `loggableScalar` (bounded `String`/`num`/`bool` only; a control character or an over-long or non-finite value is dropped), `allowlistLogFields`, `TelemetryRecord`, the `TelemetrySink` port, `TelemetryLogger` (allow-lists, writes, then isolates a throwing sink with `return;`), and the `SyncLogEvents` vocabulary |
| S-4  | New `metrics.dart`: §38.28.2's client-authoritative metrics — `TelemetryMetrics`, `MetricKind`, `MetricPoint`, `MetricsSink`, `MetricLabels`, `allowedMetricLabelKeys`, `SyncMetricNames` (emitted plus typed deferred seams), and `validateMetricLabels` (low-cardinality labels only; an identity-shaped label is rejected) |
| S-5  | New `json_sinks.dart`: `JsonLineTelemetrySink` and `JsonLineMetricsSink` — one record, one JSON object, one line. The sink owns serialisation only; redaction already happened when the record was built |
| S-6  | `push_transport.dart`: `PushBatchRequest` gains `traceId` and the `traceHeaderName = 'x-trace-id'` constant. `traceId` is deliberately **not** added to `toJson()`, so the §38.10.1 wire contract and its generated OpenAPI document are unchanged |
| S-7  | `push_orchestrator.dart`: mints one `sync_batch_id` and one `trace_id` per pass, shares them with the request and every record, emits the pass / batch-failure / per-mutation rejection / contradiction records, and push-duration, acknowledgement-latency, retry-by-class, permanent-rejection, conflict and success-ratio metrics. The unexpected-transport path logs the error **class**, and the wrapped diagnostic is `errorClassOf(error)`, never the message |
| S-8  | `sync_scheduler.dart`: the `logger` seam is retyped `void Function(String, dynamic)?` -> `TelemetryLogger?`; a `TelemetryMetrics?` is added. `_hasWork` emits the pending-outbox-depth gauge by state from the authoritative `countsByState`, and its unexpected-pass catch logs by class |
| S-9  | `connectivity_monitor.dart`: the dynamic `error.toString()` probe catch becomes a structured `sync.connectivity.probe.unexpected` record carrying a component and the error class |
| S-10 | `http_health_probe.dart`: the per-probe `HttpClient` is created **inside** the `try` (a throwing factory is an unexpected probe error, not an escaping exception) and is nullable so the `finally` closes a partially-created client; the catch logs by class |
| S-11 | `offline_grace_service.dart`: an optional `TelemetryLogger? telemetry`; a forward clock jump (§38.16.5) emits `sync.security.clock_tamper` with a component and reason only — no clock value, no record, no payload |
| S-12 | Server hardening: a shared `errorNameOf` in `common/logging/logger.ts` (the constructor name only, never the message); `ProblemDetailsFilter` (both `logOutcome` and the filter-failure catch) and `main.ts` (both the shutdown `.catch` and the process-fatal stderr path) stop serialising `err` and log the class instead |
| S-13 | No server contract, Prisma schema, migration-of-record, local-schema, CI-workflow, or root-toolchain change. The new client code lives under `lib/core/telemetry/`, **outside** `lib/core/offline/`, so the stage-24 offline gate is not engaged and no new exemption is requested (§3.5) |

### 2.2 `non_scope`

| Not touched                                                                        | Reason                                                                                                                     |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| The **Sync Console UI** (M8b), any widget, any Arabic/RTL presentation               | §40.5's M1b-S10 non-scope is **Sync console UI (M8b)**; S10 delivers the records and metrics a console will later surface   |
| The concrete authenticated **pull transport** and client **resume cursor/orchestration** | §40.5 keeps fetch/resume with the pull protocol (§38.11); pull latency and divergence metrics are named deferred seams       |
| Business modules and business tables; `sync_conflicts`; conflict-resolution UI       | Not in §40.5's M1b-S10 column set                                                                                           |
| Any change to sync **mechanics** (outbox ordering/durability, idempotency, partial batch, backoff, `Retry-After`, single-flight, grace, loop prevention, server sequence, authz decisions) | Observability is passive evidence and never a source of truth (§38.28); S10 must not perturb them, and preserves them        |
| A local schema change or migration                                                   | §38.6.2 asks for a change only when genuinely required; none is (§3.5)                                                       |
| Server contract, Prisma schema, contracts, CI workflow, root toolchain/lockfile       | S10 changes no wire contract; the server edit is a log-redaction hardening, not an API change                               |
| Master plan, S1–S9 records, `main`                                                    | No plan decision changed; the plan is not edited; `main` untouched                                                          |
| Merging PR #16, auto-merge                                                            | Owner boundary; not performed, not requested (§4.3 G-12)                                                                    |

### 2.3 `allowed_paths`

```
apps/desktop/lib/core/telemetry/correlation.dart
apps/desktop/lib/core/telemetry/error_class.dart
apps/desktop/lib/core/telemetry/json_sinks.dart
apps/desktop/lib/core/telemetry/metrics.dart
apps/desktop/lib/core/telemetry/structured_log.dart
apps/desktop/lib/core/offline/connectivity/connectivity_monitor.dart
apps/desktop/lib/core/offline/connectivity/http_health_probe.dart
apps/desktop/lib/core/offline/grace/offline_grace_service.dart
apps/desktop/lib/core/offline/sync/push_orchestrator.dart
apps/desktop/lib/core/offline/sync/push_transport.dart
apps/desktop/lib/core/offline/sync/sync_scheduler.dart
apps/desktop/test/offline/push_transport_test.dart
apps/desktop/test/offline/sync_observability_test.dart
apps/desktop/test/telemetry/correlation_test.dart
apps/desktop/test/telemetry/error_class_test.dart
apps/desktop/test/telemetry/json_sinks_test.dart
apps/desktop/test/telemetry/metrics_test.dart
apps/desktop/test/telemetry/secret_leak_adversarial_test.dart
apps/desktop/test/telemetry/structured_log_test.dart
apps/desktop/test/telemetry/telemetry_test_harness.dart
services/api/src/common/errors/problem.filter.spec.ts
services/api/src/common/errors/problem.filter.ts
services/api/src/common/logging/logger.spec.ts
services/api/src/common/logging/logger.ts
services/api/src/main.ts
docs/governance/MY_SHOP_M1B_S10_SLICE_RECORD.md
```

This slice's implementation commits touch exactly the first twenty-five paths (five new `lib/core/telemetry/` files, six modified `lib/core/offline/` files, ten test files — eight new plus two modified — and four modified server files); the record commit adds the twenty-sixth. No other path is modified.

### 2.4 `tests`

| Level                        | Requirement                                                                                                                                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Gate positives               | All `gates` (secret-scan, markdown, import-boundary, vocabulary, localization, design-system, immutability, offline stages 23–24, migration-immutability), `format:check`, `lint`, `typecheck`, `contracts:check`, and `npm audit --audit-level=high` green on this host; `flutter analyze --fatal-infos` "No issues found!"; `flutter test` **336 passed, 1 skipped** |
| Correlation (§38.28.1)       | A UUIDv7 trace id is time-ordered and deterministic with injected time/entropy; a safe id is accepted, a non-string/over-long/illegal-character/empty id is refused; an unsafe inbound id is replaced, a safe one adopted; `toLogFields` omits absent and unsafe ids; `withMutation` narrows without losing the pass ids |
| Error class (§38.28.3)       | A normal class yields its name; `null` yields `null`; a non-plain-identifier runtime type (a generic, a collection, a closure) yields `Object`; the name is bounded; and an object whose own `toString()` throws is classified without invoking it, so a message/stack/cause is never read |
| Structured log (§38.28.3)    | `loggableScalar` keeps bounded `String`/`num`/`bool` and drops a `Map`, a `List`, a `DateTime`, a function, `null`, an over-long string, a control-character/newline string, and a `NaN`/infinite `double`; `allowlistLogFields` copies only allow-listed keys, drops a non-scalar under an allow-listed key, drops a `null`, and emits in the declared key order; `TelemetryLogger` redacts, uses the injected clock, isolates a throwing sink, and ignores an empty event; the allow-list itself holds no credential-shaped key |
| Metrics (§38.28.2)           | `validateMetricLabels` keeps an allow-listed low-cardinality value and rejects an identity-shaped or non-string value; `TelemetryMetrics` emits a gauge/counter/histogram, drops an empty name and a `NaN`/infinite value, and isolates a throwing sink; the emitted and deferred metric names are distinct |
| JSON sinks (§38.28.3)        | A record and a metric each serialise to one valid JSON object on one line, with the redacted fields/labels only                                                                                                                             |
| Secret-leak adversarial      | Driven through the **real** seams: the orchestrator's unexpected-transport throw, the connectivity-monitor probe throw, the HTTP-probe factory throw, and the grace-service clock jump; and through the JSON sinks and a throwing writer. A credential-shaped key, a payload-shaped value under an allow-listed key, a credential-shaped scalar, and an injected newline are each dropped; a canary never appears in a serialised record or metric; a throwing destination never escapes the logger or the metrics emitter |
| Orchestrator/scheduler       | One pass shares `device_id`/`sync_batch_id`/`trace_id` across the wire and the log; an applied pass observes duration, acknowledgement latency and success ratio; a rejection and a contradiction are logged by mutation reference (payload and role snapshot never leak); a transient batch failure is classified and its diagnostic never logged; an unexpected transport throw is logged by class; the scheduler emits outbox depth by state with no identity label; and a broken sink changes nothing about a pass |
| Offline regression           | With every sink throwing, a committed mutation still reaches `SYNCED`; the outbox pass result is unchanged - observability is passive (§38.28)                                                                                              |
| Server (log redaction)       | `errorNameOf` returns a class and never a message, reports a non-`Error`/empty/unsafe/long name as `UnknownError`; the problem filter's 5xx path logs `"errorName":"Error"` and never the message, host, or password; a non-`Error` throwable logs `UnknownError` and never its content |
| Deferral (T-O6, §36.1 T-2)   | The one skipped test remains `DEFERRED_BY_PLAN` and is annotated, never silently dropped                                                                                      |
| Remote CI                    | All seven required checks green on the implementation head `dfb8f71` on **both** `push` and `pull_request` events (§3.6)                                                        |

### 2.5 `acceptance_criteria`

| #     | Criterion                                                                                                   | Evidence     |
| ----- | ----------------------------------------------------------------------------------------------------------- | ------------ |
| AC-1  | A sync unit carries `mutation_id` / `device_id` / `sync_batch_id` / `trace_id`, and the same ids reach both the wire and the record (§38.28.1) | §3.9 C1      |
| AC-2  | An id is validated before it is logged or echoed; an unsafe inbound trace id is replaced, never adopted (§38.28.3) | §3.9 C2      |
| AC-3  | Logs are structured JSON on the client, with an allow-list (not a denylist) and bounded scalars only (§38.28.3) | §3.9 C3      |
| AC-4  | No secret can reach a log: a credential-shaped key, a payload body, an injected newline, and a caught error's message are all excluded by construction (§40.5, §38.28.3) | §3.4, §3.8   |
| AC-5  | A caught error is described by its class only — never a message, a `toString()`, a stack, or a cause (§38.28.3) | §3.9 C4      |
| AC-6  | The §38.28.2 client-authoritative metrics are emitted from the authoritative source; the rest are typed named seams, not invented (§38.28.2) | §3.9 C5      |
| AC-7  | Metrics carry low-cardinality labels only; an identity-shaped label is rejected (§38.28.2)                     | §3.9 C6      |
| AC-8  | Observability is passive: a broken sink loses a record, never a mutation, and changes no pass result (§38.28)  | §3.9 C7      |
| AC-9  | Sync mechanics are preserved unchanged (outbox ordering/durability, idempotency, partial batch, backoff, `Retry-After`, single-flight, grace, loop prevention, server sequence, authz) | §3.8         |
| AC-10 | No secret reaches a server log either; `err` serialisation is replaced by a class name on the caught-error paths (§13.1, §38.28.3) | §3.4, §3.8   |
| AC-11 | No local schema change; the local version stays v3 (§38.6.2)                                                   | §3.5         |
| AC-12 | No server-contract change; `contracts:check` green; `trace_id` travels as a header, not a body field           | §3.5         |
| AC-13 | All gates and local suites pass; `flutter analyze --fatal-infos` clean                                         | §3.1         |
| AC-14 | PR #16 stacked on the M1b-S9 branch, open, not merged; all seven checks green on `dfb8f71` for both events     | §3.6, §3.7   |
| AC-15 | No destructive Git operation; `main` and S1–S9 untouched                                                       | §4.3 G-4/G-5 |
| AC-16 | The pull/resume deferral is annotated, not dropped (T-O6)                                                     | §3.1, D-11   |

---

## 3. Execution and evidence

### 3.1 Local chain

`npm run gates` — secret-scan, markdown, import-boundary, vocabulary, localization, design-system, immutability, **offline (stages 23–24)**, migration-immutability — **all green (exit 0)**. `npm run toolchain:verify` — **PASS** (node `22.22.3`, npm `10.9.8`, flutter `3.47.5`, dart `3.13.4` match the pin). `npm run format:check`, `npm run lint`, `npm run typecheck`, and `npm run contracts:check` ("contracts are in sync") — **all green**. `npm run flutter:analyze` (`flutter analyze --fatal-infos`) prints **"No issues found!"**. `npm run flutter:test` prints **"336 passed, 1 skipped"**. `npm audit --audit-level=high` exits 0. Server suites: `test:unit` **196 passed**, `test:integration` **38 passed**.

The stage-24 offline gate reports the offline module present with the existing written exemptions and **no new exemption** for this slice: the new telemetry module lives under `lib/core/telemetry/`, outside `lib/core/offline/`, so the gate never sees it; the six modified offline files add logging/metrics calls only and write no remote-origin data (§3.5). The single skipped test remains `DEFERRED_BY_PLAN: T-O6 pull resumes after reconnect without gaps`.

The server `database` Jest project requires a **real PostgreSQL 18** instance and fails fast when its environment is absent (its own comment says so, §36.1 T-2). This host had no PostgreSQL service and no running Docker daemon, so that project could not run locally; it is green remotely (§3.6, `backend-integration-database`). Every other server project passes locally. This is an environment limitation, not a slice result (§5).

### 3.2 Environment

Windows host, 8 GB RAM; Flutter work was run sequentially through the pinned wrapper `node ./tool/flutterw.mjs` (Flutter `3.47.5` / Dart `3.13.4`), which runs with `cwd=apps/desktop`. The server database is provisioned only in CI for this slice.

### 3.3 Implementation notes

Five details carry the slice's weight:

1. **The client mirror is an allow-list, not a redaction list.** The server already enforces §38.28.3 with `logPayload` over `LOGGABLE_KEYS`; the client cannot reach that TypeScript, so `structured_log.dart` is the client mirror of the same control and is the only place the client builds a record. A field nobody named cannot be logged, a `Map`/`List` (the shape a payload has) is dropped structurally, and a string is bounded and refused if it carries a control character — so "logged by reference" is a property of the code, not a convention about a call site (§3.4, AC-4).
2. **An error is logged by its class, never its value.** `errorClassOf` reads only `runtimeType` and sanitises it to a plain identifier; the server's `errorNameOf` reads only the constructor name. Neither reads a message, a stack, or a cause. This is what replaces the dynamic `error.toString()` seams S9 left, and it is what stops an `ECONNREFUSED 10.0.0.5:5432 password=…` from reaching a log line (AC-5, AC-10).
3. **`trace_id` is correlation metadata, not payload.** It is added to `PushBatchRequest` and sent as the `x-trace-id` header — the same header the server's request logger honours — and is deliberately **absent** from `toJson()`. A body field would be a §38.10.1 contract change and a generated-OpenAPI change this slice must not make; the test asserts both that the id is on the request and that the serialised body omits it (AC-12).
4. **Metrics are emitted only where the client is authoritative.** Outbox depth comes from the one place the queue is counted (`countsByState`); push duration, acknowledgement latency, retry-by-class, permanent rejections, conflicts and success ratio come from the pass that performed them. Pull latency, divergence events, and cost-basis divergences name a typed seam in `SyncMetricNames` with no emitter, because the client is not their source yet (§38.11, §38.14, §38.27) — the seam is visible rather than silently missing (AC-6).
5. **Observability is passive, and that is structural.** Both the logger and the metrics emitter isolate a throwing sink with `return;`, so a broken sink loses a record rather than the business write that produced it. The offline-regression test proves it: with every sink throwing, the pass still applies and the mutation still reaches `SYNCED` (AC-8, §3.4).

### 3.4 Test evidence

| Suite                                | Result                                                                                                                                                                                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `correlation_test.dart`              | UUIDv7 trace generation; the safe/unsafe id matrix; adopt-or-replace of an inbound id; `toLogFields` omission; `withMutation` — all green                                                                                                    |
| `error_class_test.dart`              | Class-only classification; `null` -> `null`; a generic/collection/closure -> `Object`; the emitted name is bounded; an object whose own `toString()` throws is classified without invoking it, and no message/cause is read — all green                                                                                                                     |
| `structured_log_test.dart`           | The scalar accept/drop matrix (map, list, DateTime, function, null, over-long, control char/newline, `NaN`/infinite); allow-list copy; a non-scalar under an allow-listed key dropped; declared field order; injected clock; throwing-sink isolation; empty event ignored — all green |
| `metrics_test.dart`                  | Label accept/reject (low-cardinality vs identity-shaped); gauge/counter/histogram; empty name and `NaN`/infinite dropped; throwing-sink isolation; emitted and deferred names distinct — all green                                              |
| `json_sinks_test.dart`               | One record / one metric -> one valid JSON line carrying only the redacted fields/labels — all green                                                                                                                                          |
| `secret_leak_adversarial_test.dart`  | Credential-shaped key, payload-shaped value, credential-shaped scalar and injected newline dropped; canaries driven through the orchestrator, the monitor, the HTTP probe and the grace service never appear in a serialised record/metric; a throwing writer does not escape the logger — all green |
| `sync_observability_test.dart`       | Correlation shared across the wire and the log; duration/ack-latency/success-ratio observed; rejection and contradiction logged by reference (payload/role snapshot absent); transient failure classified with its diagnostic unlogged; unexpected throw logged by class; scheduler depth-by-state with no identity label; **broken sink changes no pass** — all green |
| `push_transport_test.dart`           | The body carries no `traceId`; the request carries it; `traceHeaderName == 'x-trace-id'` — green                                                                                                                                             |
| `logger.spec.ts` (server)            | `errorNameOf` returns a class, never a message; a non-`Error`/empty/unsafe/long name -> `UnknownError` — green                                                                                                                                |
| `problem.filter.spec.ts` (server)    | A 5xx logs `"errorName":"Error"` and not the message/host/password; a non-`Error` throwable logs `UnknownError` and not its content — green                                                                                                   |
| Flutter                              | `flutter analyze --fatal-infos` "No issues found!"; `flutter test` **336 passed, 1 skipped** (`DEFERRED_BY_PLAN`, T-O6)                                                                                                                       |
| Server                               | `test:unit` **196 passed**; `test:integration` **38 passed**; `test:database` deferred to CI (no live PostgreSQL on this host)                                                                                                                |
| `dependency-audit`                   | `npm audit --audit-level=high` exit 0 (21 moderate, none high/critical)                                                                                                                                                                       |

### 3.5 Local schema and contract drift

S10 **does not change the local schema**. The current version stays **v3** (v1 `local_meta`, v2 outbox, v3 remote-apply guard). S10 adds no table, no column, and no `local_meta` key; it only reads the existing outbox state to count it. §38.6.2 asks for a local schema change only when one is genuinely required, and none is. Because no schema changed, there is no migration and no backup-before-migration step; `app_database.g.dart` was not regenerated and does not appear in the diff.

S10 **does not change the server contract**: no `schema.prisma`, no OpenAPI, no generated TypeScript. The `trace_id` travels as the `x-trace-id` header and is not a body field, so the generated document is unchanged; `npm run contracts:check` prints "contracts are in sync". The server edit is confined to log redaction in `logger.ts`, `problem.filter.ts`, and `main.ts` and changes no route, status, header, or response body.

**No CI-guard or toolchain change.** The new client code lives under `lib/core/telemetry/`, outside the stage-24 offline gate's scope; every modified offline file is pure classification/logging/metrics and writes no remote-origin data, so no gate is weakened and no new exemption is added.

### 3.6 Remote CI

All runs on the implementation head `dfb8f71` (G-4 exact-SHA discipline; no earlier run is offered as a substitute).

| Run         | Event        | SHA       | Result  | Jobs                                          |
| ----------- | ------------ | --------- | ------- | --------------------------------------------- |
| 38622748613 | push         | `dfb8f71` | success | all 7 required checks green                   |
| 38622757850 | pull_request | `dfb8f71` | success | all 7 required checks green                   |

The seven required checks: `fast-checks`, `backend-unit`, `backend-integration-database`, `contract-drift`, `dependency-audit`, `flutter-build-windows`, `flutter-build-android`. On **both** events all seven are green on `dfb8f71`, including `fast-checks` (which runs this slice's Dart on the pinned SDK: `flutter analyze --fatal-infos` and the **336-passing** `flutter test`), `backend-integration-database` (real PostgreSQL 18, exercising the changed server files), and `flutter-build-windows`/`flutter-build-android` (which compile the new `lib/core/telemetry` and modified `lib/core/offline` code into release artifacts).

The earlier implementation commit `423a75e` (before the direct `errorClassOf` test was added) was also green on both events (`38620330959` push, `38620599797` pull_request). The final head `dfb8f71` is the run reported above.

The record commit that follows the implementation head is documentation-only; its head is verified green as well and reported with this slice.

### 3.7 PR

PR #16, head `codex/my-shop-m1b-s10-offline-observability`, base `codex/my-shop-m1b-s9-connectivity-backoff` (stacked on the unmerged M1b-S9 branch, PR #15, itself stacked on PR #14 -> #13 -> #12 -> #11 -> #9). Open, not merged. `origin/main` untouched; PRs #1–#15 untouched. The PR number is GitHub-assigned; #16 is the value GitHub returned for this head.

### 3.8 Offline/idempotency threat-model walk (gate G-13)

§13.7 walked for this slice — the observability threats, and the sync invariants observability must not perturb:

| Threat / failure row                                   | What this slice does / does not do                                                                                                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A credential reaches a log (§13.1, §38.28.3)           | The allow-list is the boundary: a credential-shaped key is never allow-listed, a payload body is dropped as a non-scalar, a scalar string is bounded and refuses a control character, and a caught error is logged by class (AC-3, AC-4, AC-5) |
| A payload body reaches a log (§38.28.3)                | A `Map`/`List` is dropped structurally; a mutation is referenced by `mutation_id`; the rejection/contradiction records carry the id and the code, never the body (AC-1, AC-4) |
| Log injection via a newline (§38.28.3)                 | A string carrying a control character (including `\n`) is refused rather than escaped; JSON-line sinks emit one object per line (AC-3, §3.4)                                 |
| A caught error leaks a connection string (§38.28.3)    | `errorClassOf`/`errorNameOf` read only the class; the message, stack and cause are never read on the client or the server (AC-5, AC-10)                                      |
| A trace id header becomes a reflected-input channel     | An inbound id is validated `[A-Za-z0-9._:-]{1,64}` and replaced when unsafe; a push mints its own trace id rather than adopting one (AC-2)                                    |
| Metric cardinality explodes (§38.28.2)                 | Labels are a bounded class only (`state`, `errorClass`, `errorCode`, `conflictClass`, `outcome`, `operation`, `failureKind`); an identity-shaped label is rejected (AC-7)      |
| Telemetry becomes a source of truth (§38.28)           | It is passive: a broken sink loses a record; the pass result, the outbox transition and `SYNCED` are unchanged. Never a verdict input (AC-8, §3.4)                            |
| Observability perturbs sync mechanics                  | The outbox ordering/durability, idempotency, partial-batch, backoff, `Retry-After`, single-flight, grace, loop prevention, server sequence and authz decisions are untouched; S10 only reads state and emits records (AC-9, §3.3) |
| A metrics/label write is re-entrant or blocks a pass    | Emission is failure-isolated and synchronous-only; a throwing sink returns immediately and never blocks or fails the pass (AC-8)                                              |
| A crash dump carries a secret (§38.29)                 | Untouched and not claimed: crash-dump containment is a later concern; S10 records carry no credential and no local database aside (AC-4)                                      |

**What this slice does not do:** it does not render a console, fetch a pull page, own the pull cursor, or add a conflict table — those are the Sync Console UI (M8b), the pull protocol, and later business slices (§2.2). It emits correlated, redacted records and metrics, and it must not change the sync path it observes.

### 3.9 Requirements mapping (§40.5 M1b-S10, §38.28.1–§38.28.3)

The §40.5 M1b-S10 row names the four correlation ids, structured redacted logs, and metrics emission, with one inviolable: "No secret appears in any log". The criteria below are the concrete, testable reading of that row used throughout this slice.

| #   | Derived criterion (§40.5 M1b-S10)                                                       | §38.28 / plan anchor             | Mechanism                                                                        | Evidence   |
| --- | -------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------- | ---------- |
| C1  | `mutation_id`/`device_id`/`sync_batch_id`/`trace_id` propagate and are shared on the wire and in the log | §38.28.1           | `SyncCorrelation`, `PushBatchRequest.traceId`, `_emitObservability`              | §3.4       |
| C2  | An id is validated before it is logged or echoed; an unsafe inbound id is replaced      | §38.28.3                         | `isSafeCorrelationId`, `resolveTraceId`                                            | §3.4       |
| C3  | Logs are structured JSON, allow-listed, scalar-bounded                                  | §38.28.3                         | `structured_log.dart`, `json_sinks.dart`                                           | §3.4       |
| C4  | A caught error is a class, never a message/`toString`/stack/cause                        | §38.28.3, §13.1                  | `errorClassOf`, `errorNameOf`                                                      | §3.4       |
| C5  | §38.28.2's client-authoritative metrics are emitted; the rest are named seams            | §38.28.2                         | `SyncMetricNames`, `TelemetryMetrics`, `_emitObservability`, `_observeAckLatency`  | §3.4       |
| C6  | Metrics labels are low-cardinality only; an identity label is rejected                   | §38.28.2                         | `MetricLabels`, `validateMetricLabels`                                             | §3.4       |
| C7  | Observability is passive and failure-isolated; sync mechanics are preserved              | §38.28                           | throwing-sink isolation; offline-regression test                                   | §3.4, §3.8 |
| C8  | No local schema change; no contract change; `trace_id` as a header                       | §38.6.2, §38.10.1                | unchanged v3; `traceHeaderName`; `contracts:check`                                 | §3.5       |

---

## 4. Decisions, scope difference, gates

### 4.1 Decisions

| #    | Decision                                                                                              | Reason                                                                                                                              |
| ---- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| D-1  | The telemetry module lives under `lib/core/telemetry/`, **outside** `lib/core/offline/`               | It is not offline persistence; placing it outside keeps the stage-24 offline gate exactly as it was and requests no new exemption (§3.5) |
| D-2  | `trace_id` travels as the `x-trace-id` **header**, not a body field                                     | A body field would change the §38.10.1 wire contract and its generated OpenAPI; correlation metadata is not business payload (AC-12) |
| D-3  | The client uses an **allow-list**, not a denylist                                                       | A denylist is one field behind; an allow-list fails closed for a key nobody anticipated (§38.28.3)                                   |
| D-4  | An error is described by its **class** on both sides                                                    | The message/stack is where a connection string or token arrives; a class name is bounded and developer-authored (AC-5, AC-10)        |
| D-5  | Only client-**authoritative** metrics are emitted; the rest are **named, typed seams**                  | §38.28 forbids inventing a source of truth; pull/divergence/cost-basis belong to §38.11/§38.14/§38.27 (AC-6)                          |
| D-6  | Metric labels are low-cardinality classes only; an identity-shaped label is rejected                    | An unbounded label is how a metrics backend's cardinality and cost explode (§38.28.2, AC-7)                                          |
| D-7  | Logger and metrics **isolate** a throwing sink with `return;`                                           | Telemetry is passive: it must never turn a committed sale or a completed pass into a failure (AC-8)                                  |
| D-8  | The grace service emits `sync.security.clock_tamper` on a forward jump                                  | §38.16.5 names a "security event"; S8 shipped the durable half, and this is the observable half, carrying no clock value (S-11)      |
| D-9  | The HTTP probe's client factory moved **inside** the `try`, and the client is nullable                   | A throwing factory is an unexpected probe error that must map to `unreachable`, not an escaping exception; a nullable client lets `finally` close a partial one (S-10) |
| D-10 | `_observeAckLatency` is observed on `APPLIED` only                                                      | A `REPLAY` acknowledges a mutation already stored; counting it would understate the cashier-exposure duration (§38.28.2)              |
| D-11 | The T-O6 pull/resume deferral is left annotated                                                         | §40.5 keeps pull/resume with the pull protocol; S10 must not silently drop the deferral (§36.1 T-2)                                  |
| D-12 | No local schema change; no server contract change                                                        | §38.6.2 asks for a change only when required; none is, and the emit path reads existing state (§3.5)                                 |

### 4.2 Scope-difference report

Three differences are named rather than silently crossed:

1. **S9's record forecast "M1b-S10 = offline observability plumbing".** That matches §40.5, and S10 delivers exactly that row: the four ids, structured redacted logs, and metrics. The **Sync Console UI (M8b)** is §40.5's declared non-scope and is not built; S10 delivers the records and metrics a console will later surface.
2. **A small server change was in scope.** §40.5 frames the slice as client observability, but the same "no secret in a log" acceptance applies to the server's own caught-error paths, which still serialised `err` (message + stack via Pino). Replacing that with `errorNameOf` is a redaction hardening inside existing files, not a new route or contract, and it is required for the acceptance to hold end to end.
3. **Pull latency and divergence metrics are deferred, not emitted.** They are named as typed seams in `SyncMetricNames`. Emitting them would require a pull transport and reconciliation logic the plan assigns to later slices (§38.11, §38.14).

### 4.3 Gates G-1…G-13

| Gate | Condition                                                             | Result                                                                                                                                    |
| ---- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| G-1  | no business table outside the plan's data domain map                   | PASS - no table created; S10 reads existing outbox state and adds no table (§3.5)                                                         |
| G-2  | contract files updated from the declaration and drift-clean            | PASS - no contract change; `contracts:check` in sync; `trace_id` is a header (§3.5)                                                       |
| G-3  | schema/migration unchanged (no server migration this slice)            | PASS - no `schema.prisma`/server migration edit; the local Drift schema is unchanged at v3 (ADR-036); `migration-immutability` green      |
| G-4  | all CI stages pass; no history rewrite                                 | PASS - all 7 checks green on `dfb8f71` for both events (§3.6); ordinary commits, no force push, no rebase                                |
| G-5  | no file outside `allowed_paths` modified                               | PASS - the slice diff is confined to §2.3                                                                                                  |
| G-6  | `non_scope` verifiably untouched                                       | PASS - no console UI, no pull transport/resume, no business module, no plan/CI-workflow edit (§2.2)                                       |
| G-7  | migration impact as declared; migrations immutable; drift non-vacuous  | PASS - **no** local migration this slice (§3.5); no server migration; `migration-immutability` green                                       |
| G-8  | security impact as declared                                            | PASS - S10 *reduces* the chance of a secret in a log; it adds no route, permission, or tenant path, and it refuses to log a value that is not a bounded scalar or a class; the leak threats are walked (§3.8) |
| G-9  | migration audit: no `GRANT ALL`, no interpolation                      | PASS - no migration at all (§3.5)                                                                                                          |
| G-10 | rollback defined and feasible                                          | PASS - drop the branch and PR #16; `main` untouched; the change is additive (new module plus logging/metrics calls)                        |
| G-11 | documentation updated                                                  | PASS - this record; no decision changed the master plan                                                                                    |
| G-12 | owner authorized the merge                                             | NOT SATISFIED for PR #16 - no merge performed, by design (left open)                                                                        |
| G-13 | offline path: threat model walked and tests                           | PASS - the observability threats and the sync-invariant threats walked; §3.8                                                               |

---

## 5. Deviations

- **The server `database` project could not run locally.** It provisions a real PostgreSQL instance and fails fast when its environment is absent (the project's own comment, §36.1 T-2). This host had no PostgreSQL service and no running Docker daemon, so `npm test` at the workspace root does not complete locally; `test:unit` (196) and `test:integration` (38) do. The project is green remotely on `dfb8f71` (`backend-integration-database`). S10 does not touch the database layer.
- **Two formatting/lint fixes were required, inside the allowed paths.** Two server files needed Prettier; the new `capturingFilter()` helper in `problem.filter.spec.ts` needed `String(chunk)` instead of `chunk.toString()` to satisfy `@typescript-eslint/no-unsafe-argument`/`no-unsafe-call` (the Jest `Writable` chunk is `any`). Neither changes behaviour.
- **The record's §40.5 labels are this slice's derived criteria.** The plan's §40.5 M1b-S10 row states the jobs and the inviolable but does not enumerate C1–C8; §3.9 defines them explicitly so the mapping is self-contained and testable.
- **No repair commit, no history operation.** This branch was created by ordinary commits from `bbedef5`; nothing was force-pushed, reset, or rebased.

---

## 6. Boundary

The next slice is **M1b-S11** per §40.5. It is **NOT AUTHORIZED** by this record. The Sync Console UI (M8b), the concrete authenticated pull transport, cursor resume, and business modules remain later concerns.

On the acceptance gate: **G-12 is NOT SATISFIED** — PR #16 is left open and no merge was performed. The merge is the owner's decision, not this slice's.

```
M1b-S11 NOT AUTHORIZED
NO PR MERGED — OWNER MERGE AUTHORIZATION REQUIRED
PASS_MY_SHOP_M1B_S10_REMOTE_LOCKED
```
