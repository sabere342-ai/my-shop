# MY SHOP - M1b-S6 SLICE RECORD: PULL ENDPOINT

**Master plan:** `docs/governance/MY_SHOP_MASTER_PLAN.md` v1.1.0 — §40.5 (M1b-S6), §38.11.1–§38.11.3 (change_log feed, server sequences, per-device cursors), §38.12.1 (sequence guard), §38.15 (entity retrieval, deferred), §38.16 (authentication), §34.3 (error contract), §36.1 T-2/T-5 (real PostgreSQL, no silent skips), §36.2 (suites), §37.2 (contract generation and drift gate), §37.4 (readiness), §22.1/§22.4 (organization setting, owner-exclusive O-21), §43.1 (G-1…G-13)
**Slice:** M1b-S6
**Branch:** `codex/my-shop-m1b-s6-pull-endpoint`
**Predecessor:** `e75ba03` - M1b-S5, branch `codex/my-shop-m1b-s5-push-endpoint` (PR #11, open, base `codex/my-shop-m1b-s4-ledger`)
**Repair commit:** none required against the predecessor
**Final SHA (implementation head):** `c9c4fec996d7cb84a481d2ce52e3d973ae96bbac`
**Declaration status:** `PASS_MY_SHOP_M1B_S6_PULL_ENDPOINT_REMOTE_LOCKED`

---

## 1. Predecessor state

### 1.1 Entry state, verified not assumed

| Check               | Value                                                                                                                                                | Result                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Repository root     | `C:/dev/my-shop`                                                                                                                                     | pass                                          |
| Branch at entry     | `codex/my-shop-m1b-s5-push-endpoint` @ `e75ba03`                                                                                                     | pass - equals the accepted M1b-S5 head         |
| Branch created      | `codex/my-shop-m1b-s6-pull-endpoint` from `e75ba03`                                                                                                  | pass                                          |
| Ancestry            | `c9c4fec` (S6) -> `e75ba03` (S5) -> `fe4a000` (S5) -> `da32b1d` (S4 record) -> `edb7b84` (S4) -> … -> `3836ac7` (M1-S6) -> … -> `main` ancestor | pass - stacked ancestry intact      |
| `origin/main`       | `53f6aaa`, unchanged by this slice                                                                                                   | pass                                |
| Worktree at entry   | recovered untracked S6 work present, no commits on the branch                                                                        | pass - continued, not restarted     |
| Predecessor record  | **none committed** - the M1b-S5 branch carries no slice record (§1.3)                                                                | named, not silently ignored         |

### 1.2 Predecessor findings (carried, not re-opened)

No blocking defect existed in the committed M1b-S5 tree. The recovered untracked S6 files were a mechanical clone of the push module (a push body guard, a push authenticator token, a mutation applier) that did not describe a pull at all; they were **rebuilt** rather than patched, because a pull is a `GET` read of the `change_log` feed with no body, no applier, and no tenant field to assert (§2.1). No S5 code, contract, or test was changed.

### 1.3 The M1b-S5 record gap

The Master Plan and every M1b predecessor treat each slice as producing a slice record (`MY_SHOP_M1B_S1…S4_SLICE_RECORD.md`). The M1b-S5 branch (`e75ba03`, PR #11) was accepted with **no** `MY_SHOP_M1B_S5_SLICE_RECORD.md`; `git log e3049cb..e75ba03 -- docs` shows only a prettier commit, no documentation. This record names that gap honestly rather than inventing an S5 record. Its effect on S6 is bounded: S6 stacks on `e75ba03` unchanged and depends only on the S5 **code** (the push boundary, the shared ledger's `change_log`), both of which are present and green in CI on `c9c4fec` (§3.6).

---

## 2. Declaration

### 2.1 `scope`

Per Master Plan §40.5 row M1b-S6 — the **pull endpoint**: cursor paging, bounded limits, retention window, resume after interruption. It is the egress counterpart of M1b-S5's ingress: `GET /api/v1/sync/pull?after={server_sequence}&limit={n}` reads one page of the M1b-S4 `change_log` feed (§38.11.1), org-scoped and authenticated (§38.16), and adds no business rule.

| #    | Outcome                                                                                                                                                                                                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S-1  | New module `services/api/src/common/sync/pull/`: `SyncPullController` publishes the single route `GET /api/v1/sync/pull` (§38.11.2); `PullModule.forRoot(config)` mirrors `LedgerModule`'s scoping and imports the ledger as the one door to the feed (§38.11.1)                                                          |
| S-2  | Cursor query contract `PullQuery` (§38.11.2): `after` is a non-negative decimal **string** (64-bit `server_sequence`); `limit` is an integer `1…1000`, default `200`. Both are optional. There is no `page`/`offset` and no `organizationId` parameter                                                                     |
| S-3  | Response contract `PullPageResponse`: `changes[]`, `nextAfter` (decimal string), `hasMore`, `rebaselineRequired`, optional `retentionFloor`; each `PullChange` is a descriptor — `serverSequence` (decimal string), `entityType`, `entityId`, optional `mutationId`, `changedAt` (ISO-8601)                              |
| S-4  | Ledger read `MutationLedgerService.pullChanges` on `change_log`, scoped `organizationId`, `serverSequence > after`, ordered ascending, `take limit + 1` so `hasMore` is a fact rather than a guess (§38.11.2)                                                                                                              |
| S-5  | Retention window O-21 (90 days) (§38.11.1): `retentionFloor = 1 + max(server_sequence where changed_at < now() − 90d)`, else `null`; when `after + 1 < retentionFloor` the page is empty, `nextAfter` is the request cursor unchanged, `hasMore` is false, and `retentionFloor` is returned — a re-baseline, never a partial feed |
| S-6  | The read is **pure**: `pullChanges` never writes `device_sync_cursors`, because §38.11.2 makes the client store its cursor only after the page is applied locally, so an interrupted pull re-fetches rather than losing changes (T-O6)                                                                                      |
| S-7  | Auth boundary (`sync-auth.ts`): a `SYNC_AUTHENTICATOR` port with a **fail-closed** production default (`FailClosedSyncAuthenticator` → `UNAUTHENTICATED`); the guard (`SyncAuthGuard`) is the only place identity is acquired, and `@SyncContext()` refuses to proceed without it. The token is distinct from push's, so a test cannot authorize both by accident (§38.16, §9.3) |
| S-8  | The controller declares the 200 page plus the RFC 7807 `400`/`401`/`500` responses as `ProblemDocument` `$ref`s, so the OpenAPI document is produced from the same declaration the handler uses (§7.1, ADR-001)                                                                                                          |
| S-9  | `AppModule` wires `PullModule.forRoot(config)` beside `PushModule.forRoot(config)`; the ledger is reused, not re-implemented (`PullModule` imports `LedgerModule.forRoot`)                                                                                                                                                |
| S-10 | OpenAPI `extraModels` gains `PullChange` and `PullPageResponse`; `packages/contracts/openapi.json` and `src/generated/schemas.ts` are regenerated and the drift gate is green (G-2, G-7)                                                                                                                                  |
| S-11 | Tests: `pull.contract.spec.ts` (cursor grammar, bounds, offset/identity refused via the real pipe config), `sync-pull.service.spec.ts` (defaults, tenant scope, wire mapping, re-baseline advisory), a `mutation-ledger.spec.ts` feed block (paging, `hasMore`, null `mutationId`, re-baseline, decimal-string floor, no cursor writes), `test/sync/pull.e2e-spec.ts` (fail-closed 401, 400s, trace echo, no leak), and real-PostgreSQL acceptance in `postgres.db-spec.ts` |
| S-12 | Flutter `sync_transport_deferred_test.dart` comment updated: the server pull endpoint is delivered; the client transport/resume stays `DEFERRED_BY_PLAN` for S8/S9. No Dart behaviour changed                                                                                                                              |

### 2.2 `non_scope`

| Not touched                                                                                       | Reason                                                                                                              |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Entity **payload** retrieval / record delivery (§38.15)                                           | Pull returns change descriptors, not full objects; §38.15 entity retrieval is a later business concern              |
| Push transport, batching, per-mutation outcomes                                                   | M1b-S5; already delivered, unchanged                                                                                 |
| `sync_conflicts` table and conflict-resolution behaviour/UI                                       | Not in §40.5's M1b-S6 column set; CONFLICT is a local client state (§38.13). Named as a scope difference (§4.2)      |
| Loop prevention / `applyRemoteWithoutOutbox` / `server_sequence` apply guard                      | M1b-S7 (§40.5)                                                                                                       |
| Offline auth grace, connectivity monitor, observability plumbing                                  | M1b-S8/S9/S10                                                                                                        |
| Any business module, table, or rule                                                               | §39.5 data-domain map; §40.5 business modules remain unauthorized                                                    |
| Flutter client transport, resume, or apply logic                                                  | S8/S9; the Dart test stays an annotated deferral (§2.1 S-12)                                                         |
| CI workflow, branch protection, root toolchain/lockfile                                           | M1-S4 owns the CI platform; S6 adds no dependency and needs no CI change                                             |
| Master plan, S1–S5 records, `main`                                                                | No decision changed the plan; the plan is not edited; `main` untouched                                               |
| Merging PR #12, auto-merge                                                                        | Owner boundary; not performed, not requested (§4.3 G-12)                                                             |

### 2.3 `allowed_paths`

```
services/api/src/common/sync/pull/pull.contract.ts
services/api/src/common/sync/pull/pull.contract.spec.ts
services/api/src/common/sync/pull/sync-auth.ts
services/api/src/common/sync/pull/sync-pull.guard.ts
services/api/src/common/sync/pull/sync-pull.service.ts
services/api/src/common/sync/pull/sync-pull.service.spec.ts
services/api/src/common/sync/pull/sync-pull.controller.ts
services/api/src/common/sync/pull/sync-pull.module.ts
services/api/src/common/sync/ledger/mutation-ledger.service.ts
services/api/src/common/sync/ledger/mutation-ledger.spec.ts
services/api/src/common/openapi/openapi.ts
services/api/src/app.module.ts
services/api/test/sync/pull.e2e-spec.ts
services/api/test/database/postgres.db-spec.ts
packages/contracts/openapi.json
packages/contracts/src/generated/schemas.ts
apps/desktop/test/offline/sync_transport_deferred_test.dart
docs/governance/MY_SHOP_M1B_S6_SLICE_RECORD.md
```

This slice's own commits touch exactly these eighteen paths (seventeen code/artifact files plus this record). The contracts artifacts are regenerated by `npm run contracts:generate`, not hand-edited.

### 2.4 `tests`

| Level                       | Requirement                                                                                                                                                                                                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gate positives              | All nine `gates`, `format:check`, `lint`, `typecheck`, `contracts:check`, `npm audit --audit-level=high` green on this host; unit **190**, integration **38**, database **33** |
| Pull contract               | Pinned page bounds (200/1000) and retention (90); empty query accepted; decimal-string and leading-zero cursors accepted; negative/fractional/signed/non-numeric cursors refused; `limit` outside 1–1000 and non-integer refused; numeric-string `limit` coerced; `offset`/`page` forbidden; `organizationId` forbidden |
| Pull service (unit)         | Empty query reads from `0` at the default size; explicit cursor/limit passed through; tenant scope comes from the context; sequences rendered as decimal strings and instants as ISO-8601 (incl. a value at `2^53`); `mutationId` omitted for a server change; empty page returns the request cursor; re-baseline surfaces `rebaselineRequired` + floor and logs an advisory; floor omitted when no re-baseline is due |
| Ledger feed (unit)          | Empty page from the beginning; strict lower bound + ascending + `take limit + 1`; truncation with truthful `hasMore`; `mutationId` only for device changes; re-baseline with no page query executed; floor comparison boundary; `null` and decimal-string `max_aged_out`; **no cursor write** |
| HTTP boundary (no DB)       | Production default refuses every pull `401 UNAUTHENTICATED` (with `traceId`); auth runs before validation; `400 VALIDATION_FAILED` for bad `after`, out-of-range `limit`, `offset`, `organizationId`; the offending field is named; no internal detail leaks; inbound `traceId` echoed |
| DB acceptance (M1b-S6)      | Cursor paging ascends and is bounded with truthful `hasMore`; the hard maximum is accepted; a caught-up cursor yields an empty page with the request cursor; T-O6 re-fetch is byte-identical and resuming drains every change once; a pull leaves `device_sync_cursors` byte-identical (sentinel); tenant isolation under shared sequences; empty feed; retention re-baseline with the floor and normal paging from the floor |
| Remote CI                   | All seven checks green on the implementation head `c9c4fec` (§3.6)                                                                                                                                                                                                          |

### 2.5 `acceptance_criteria`

| #     | Criterion                                                                                            | Evidence   |
| ----- | ---------------------------------------------------------------------------------------------------- | ---------- |
| AC-1  | Cursor query contract (§2.1 S-2); `offset`/`page` and `organizationId` refused (§38.11.2)            | §3.4       |
| AC-2  | Org-scoped feed, ascending, bounded, truthful `hasMore` (§38.11.1/§38.11.2)                          | §3.4       |
| AC-3  | T-O6: a read never advances a stored cursor; an interrupted pull re-fetches losslessly               | §3.4       |
| AC-4  | Retention window O-21: a stale cursor re-baselines with the floor, never a partial feed              | §3.4       |
| AC-5  | Fail-closed production default; identity only from the guarded context, never the query (§38.16)     | §3.4       |
| AC-6  | Descriptors only; 64-bit sequences as decimal strings (§38.11.2)                                     | §3.4       |
| AC-7  | Tenant isolation: another organization's changes are never returned (§9.3)                           | §3.4       |
| AC-8  | OpenAPI/contract updated from the declaration; drift gate green (G-2, G-7)                           | §3.5       |
| AC-9  | All gates and local suites pass; DB acceptance and `dependency-audit` green in CI (T-2, T-5)         | §3.1, §3.6 |
| AC-10 | PR #12 stacked on the M1b-S5 branch, open, not merged                                                | §3.7       |
| AC-11 | No destructive Git operation; `main` and S1–S5 untouched                                             | §4.3 G-4, G-5 |
| AC-12 | Flutter suite green; the T-O6 client deferral is annotated, not dropped                              | §3.1       |

---

## 3. Execution and evidence

### 3.1 Local chain

`npm run verify:node` = `toolchain:verify` → nine `gates` → `format:check` → `lint` → `typecheck` (incl. `tsc -p tsconfig.test.json`) → `contracts:check` → `test`, **all green (exit 0)**. API suites: unit **190 passed**, integration **38 passed**, and the real-PostgreSQL `database` project **33 passed** (run on this host against local PostgreSQL 18.4 with the suite's three URLs, §3.2). `npm run flutter:analyze` prints "No issues found!". `npm run flutter:test` prints **"102 passed, 1 skipped"** — the skip is `DEFERRED_BY_PLAN: T-O6 pull resumes after reconnect without gaps`, whose owning slice is S8/S9. `npm audit --audit-level=high` exits 0 (0 high, 0 critical; 21 moderate remain below the gate).

### 3.2 Environment

Local PostgreSQL **18.4**; the acceptance suite was pointed at it through `DATABASE_URL=postgresql://my_shop_app@…/my_shop_test`, `MIGRATION_DATABASE_URL=postgresql://my_shop_migrator@…/my_shop_test`, `ADMIN_DATABASE_URL=postgresql://postgres@…/postgres` (trust auth), i.e. the same role separation the workflow's service uses. CI runs the same suite against the workflow's PostgreSQL 18 service (§3.6).

### 3.3 Implementation notes (the substance of the recovered rewrite)

The recovered files described a push-shaped mutation, so they were replaced by a read boundary. Three details are worth recording:

1. **Cursor, not offset, is structural.** The global pipe runs with `forbidNonWhitelisted`, so an `offset`/`page`/`organizationId` in the query is a `400` before any handler can honour it (§2.1 S-2; §3.4). The contract spec asserts this through the same `class-validator` metadata the pipe runs.
2. **Sequences never round-trip through `Number`.** Request `after` is `@Matches(/^\d+$/ )` on a string; response sequences are `BigInt`→`toString()`; the retention floor is read through `$queryRaw` and normalised by the ledger's `toBigInt` (int8 may arrive as a decimal string), so the floor comparison is exact at `2^53` and beyond (§38.11.2).
3. **Retention is a policy boundary, not a purge.** `retentionFloor` is computed from the feed's own `changed_at` with `make_interval(days => ${retentionDays}::int)` and an explicit `organization_id = ${organizationId}::uuid` cast; no rows are deleted at M1b-S6, so "what is retained" is exactly the window the endpoint enforces (§2.1 S-5). A later purge job does not change the definition.

The read is a single `changeLog.findMany` plus one aggregate `$queryRaw`; it issues no write of any kind (§2.1 S-6).

### 3.4 Test evidence

| Suite                           | Result                                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pull.contract.spec.ts`         | bounds/retention/path pinned; empty query; decimal and leading-zero cursors; negative/fractional/signed/non-numeric refused; `limit` 0/negative/1001/non-integer refused; numeric-string coerced; `offset`/`page` refused; `organizationId` refused — all green |
| `sync-pull.service.spec.ts`     | defaults, tenant scope, decimal-string/ISO-8601 wire mapping (incl. `9007199254740993`), omitted `mutationId`, empty-page cursor, re-baseline advisory + omitted floor — all green |
| `mutation-ledger.spec.ts` (feed) | empty page; strict bound + ascending + `take limit+1`; truncation with `hasMore`; device-only `mutationId`; re-baseline with no page query; floor boundary; `null` and decimal-string floor; no cursor write — all green |
| `pull.e2e-spec.ts` (no DB)      | fail-closed `401` with `traceId`; auth before validation; `400` for bad `after`/`limit`/`offset`/`organizationId`; offending field named; no internal leak; trace echo — all green |
| DB acceptance (M1b-S6)          | paging/ordering/bounded + truthful `hasMore`; hard maximum; catch-up empty page; T-O6 re-fetch byte-identical and lossless resume; cursor sentinel unchanged; tenant isolation; empty feed; retention/re-baseline — **33 passed** in the `database` project against `postgres:18` |
| Flutter                         | `flutter analyze --fatal-infos` "No issues found!"; `flutter test` **102 passed, 1 skipped** (`DEFERRED_BY_PLAN`, S8/S9) |
| `dependency-audit`              | `npm audit --audit-level=high` exit 0; 0 high, 0 critical, 21 moderate below the gate |

### 3.5 Contract drift (G-7)

Unlike M1b-S4, this slice **does** change the contract: it adds the `/api/v1/sync/pull` path and the `PullChange`/`PullPageResponse` schemas. `packages/contracts/openapi.json` and `packages/contracts/src/generated/schemas.ts` were regenerated from the backend by `npm run contracts:generate` and committed; `npm run contracts:check` prints **"contracts are in sync"** on this head. The drift gate's non-vacuity was proven in S3's §3.5 and is inherited; the added path and schemas visible in §2.1 S-10 are the drift-clean artifacts the gate compares.

### 3.6 Remote CI

All runs on the implementation head `c9c4fec` (G-4 exact-SHA discipline; no earlier run is offered as a substitute).

| Run         | Event        | SHA       | Result  | Jobs                                          |
| ----------- | ------------ | --------- | ------- | --------------------------------------------- |
| 38494947656 | pull_request | `c9c4fec` | success | all 7 required checks green                   |
| 38494926315 | push         | `c9c4fec` | success | all 7 required checks green                   |

The seven required checks: `fast-checks`, `backend-unit`, `backend-integration-database`, `contract-drift`, `dependency-audit`, `flutter-build-windows`, `flutter-build-android`. On **both** events all seven are green on `c9c4fec`, including `backend-integration-database` (real PostgreSQL 18, the pull acceptance block) and `contract-drift` (the regenerated `openapi.json`/`schemas.ts`). The push event is clean here — unlike M1b-S4's authorized-rebase artifact, this branch was created by ordinary commits from `e75ba03`, so its `before` SHA is present in the shallow checkout.

### 3.7 PR

PR #12, head `codex/my-shop-m1b-s6-pull-endpoint`, base `codex/my-shop-m1b-s5-push-endpoint` (stacked on the unmerged M1b-S5 branch, PR #11, itself stacked on M1b-S4 PR #9). Open, not merged. `origin/main` untouched; PRs #1–#11 untouched.

### 3.8 Offline/idempotency threat-model walk (gate G-13)

§13.7 walked for this slice — the **server half** of T-O6 ("disconnect mid-pull loses nothing"):

| Threat row                       | What this slice does / does not do                                                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Disconnect mid-pull              | The read never advances a stored cursor (§38.11.2); a re-fetch from the client-held cursor returns the identical page, and resuming drains each change exactly once (T-O6) |
| Partial / torn page              | A page is a snapshot at a sequence; paging is a strict cursor, and an offset (which would skip or repeat under concurrent inserts) is refused at the pipe (§38.11.2) |
| Aged-out prefix silently dropped | A cursor older than the 90-day window is answered `rebaselineRequired` with an empty page and the floor, never a partial feed (§38.11.1, O-21)          |
| Cross-tenant read                | The feed is filtered by the authenticated `organizationId`; the request has no organization field, so a caller cannot name another tenant (§38.16, §9.3) |
| Anonymous feed exposure          | Production fails closed (`UNAUTHENTICATED`) until M2 supplies token/device verification; the trusting authenticator lives under `test/` only (§38.16)   |
| Large-response / DoS             | `limit` is bounded at 1000; a device cannot ask the server to stream a whole feed in one response (§38.11.2)                                           |
| Own-echo double-apply            | `mutationId` is carried on a change descriptor so the originating device can reconcile its echo; the actual apply/suppression is M1b-S7 (§38.11.2)     |

**What this slice does not do:** it does not apply changes, order-guard the local apply, or resolve conflicts — those are M1b-S7 and later (§2.2). It reads.

---

## 4. Decisions, scope difference, gates

### 4.1 Decisions

| #    | Decision                                                                                        | Reason                                                                                                        |
| ---- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| D-1  | Pull returns change **descriptors**, not payloads                                                | §38.15 entity retrieval is a later concern; proving the transport needs only "what changed, in what order"     |
| D-2  | Cursor is exclusive and client-owned; the server never writes a cursor on a read                | §38.11.2 makes the client store `nextAfter` only after local apply; T-O6 follows                              |
| D-3  | `limit` default 200 / max 1000 as shared contract constants                                     | The compiled client default and the server refusal threshold cannot drift apart (§38.11.2)                     |
| D-4  | Sequences travel as decimal strings in both directions                                          | A 64-bit `server_sequence` must survive JSON without floating-point loss (§38.11.2)                            |
| D-5  | Retention is derived from the feed's clock; no purge at M1b-S6                                   | O-21 defines "retained"; a purge job is a later operational slice and does not change the definition           |
| D-6  | Re-baseline is a normal operational advisory (`warn`), not a security event                     | A stale cursor is a client that was offline too long, not an attack (§38.11.1)                                 |
| D-7  | A separate `SYNC_AUTHENTICATOR` token from push's                                             | The two transports are separate boundaries; a test that authorizes one cannot authorize the other (§38.16)     |
| D-8  | No request body and no tenant parameter                                                         | A read must not be able to assert tenant identity at all; scope comes from the credential (§38.16, §9.3)       |
| D-9  | `PullModule.forRoot(config)` mirrors `LedgerModule`; it imports the ledger rather than re-reading `prisma` | §37.4: OpenAPI generation boots with no `DATABASE_URL`; §38.11.1: one door to the feed            |
| D-10 | Contracts regenerated and committed (this slice changes the contract)                            | §37.2 / ADR-001; the drift gate compares the committed artifacts byte-for-byte (§3.5)                          |
| D-11 | No `sync_conflicts` table added                                                                 | Outside §40.5's M1b-S6 column set; named in §4.2                                                              |

### 4.2 Scope-difference report

The slice's scope is exactly §40.5's M1b-S6 row: "cursor paging, bounded limits, retention window, resume after interruption", key acceptance "disconnect mid-pull loses nothing (T-O6)". One difference is named rather than silently crossed: the **M1b-S4 record's §6 boundary** forecast `sync_conflicts`/conflict resolution as part of M1b-S6, but the **Master Plan's** §40.5 M1b-S6 row lists "Conflict resolution UI" as **non-scope** and its §39.5 data domain for M1b is the change feed, not a conflict table; §38.13's `CONFLICT` is a **local client** sync state. This record therefore delivers the plan's declared row and deliberately adds **no** `sync_conflicts` table or conflict-resolution behaviour (D-11). If a later slice requires server-side conflict records, the plan row is the authority and this is the boundary where it was named rather than crossed. The second named difference is §1.3: the missing M1b-S5 slice record is reported, not fabricated.

### 4.3 Gates G-1…G-13

| Gate | Condition                                                             | Result                                                                                                                                    |
| ---- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| G-1  | no business table outside the plan's data domain map                   | PASS - this slice adds no table; it reads `change_log` (§39.5)                                                                            |
| G-2  | contract files updated from the declaration and drift-clean            | PASS - regenerated `openapi.json`/`schemas.ts`; `contracts:check` in sync (§3.5)                                                          |
| G-3  | schema/migration unchanged (no migration this slice)                   | PASS - no `schema.prisma`/migration edit; `migration-immutability` gate green                                                             |
| G-4  | all CI stages pass; no history rewrite                                 | PASS - all 7 checks green on `c9c4fec` for both events (§3.6); ordinary commits, no force push, no rebase                                 |
| G-5  | no file outside `allowed_paths` modified                               | PASS - the slice diff is confined to §2.3                                                                                                 |
| G-6  | `non_scope` verifiably untouched                                       | PASS - no business module, no `sync_conflicts`, no plan/CI/toolchain edit (§2.2)                                                          |
| G-7  | migration impact as declared; migrations immutable; drift non-vacuous  | PASS - no migration; `migration-immutability` green; drift gate green and non-vacuous (S3 proof inherited, §3.5)                          |
| G-8  | security impact as declared                                            | PASS - one guarded read route, fail-closed by default; no new permission/secret; tenant scope from the credential (§3.8)                  |
| G-9  | migration audit: no `GRANT ALL`, no interpolation                      | PASS - no migration; the retention `$queryRaw` is parameterized with explicit `::uuid`/`::int` casts (§3.3)                               |
| G-10 | rollback defined and feasible                                          | PASS - drop the branch and PR #12; `main` untouched                                                                                       |
| G-11 | documentation updated                                                  | PASS - this record; the Dart deferral comment updated; no decision changed the master plan                                                |
| G-12 | owner authorized the merge                                             | NOT SATISFIED for PR #12 - no merge performed, by design (left open)                                                                      |
| G-13 | offline path: threat model walked and tests                           | PASS - T-O6 server half; §3.8                                                                                                             |

---

## 5. Deviations

- **Recovered work was rebuilt, not patched.** The untracked S6 files were a push-shaped clone; they were replaced by a read boundary (§1.2). No committed S1–S5 file was changed except the ledger (an additive `pullChanges` read), the OpenAPI `extraModels` list, `AppModule`, the regenerated contracts, and the Dart deferral comment — all inside §2.3.
- **The M1b-S5 slice record does not exist.** Named in §1.3 rather than silently invented; it does not affect S6's correctness or stack, which are green on `c9c4fec`.
- **No repair commit, no history operation.** This branch was created by ordinary commits from `e75ba03`; nothing was force-pushed, reset, or rebased.

---

## 6. Boundary

The next slice is **M1b-S7** (loop prevention: `applyRemoteWithoutOutbox` as the single remote-apply entry point, outbox suppression that crashes on violation, `server_sequence` guard — §40.5). It is **NOT AUTHORIZED** by this record. Business modules remain unauthorized.

```
M1b-S7 NOT AUTHORIZED
PASS_MY_SHOP_M1B_S6_PULL_ENDPOINT_REMOTE_LOCKED
```
