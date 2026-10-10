# MY SHOP - M1b-S4 SLICE RECORD: SERVER MUTATION LEDGER

**Master plan:** `docs/governance/MY_SHOP_MASTER_PLAN.md` v1.1.0 — §40.5 (M1b-S4), §38.9.1–§38.9.3 (server mutation ledger, replay, atomicity), §38.10.1 (per-mutation outcomes), §38.11.1–§38.11.3 (change_log feed, server sequences, cursors), §38.13 (rejection state), §38.24.1 (re-derivation), §34.3 (error codes: `REPLAY`, `MUTATION_CONTRADICTION`), §32.2A / §38.28 (audit/security events), §8.4 D-8 (schema ownership), §39.5 (table authorization), §13.4 (role separation), §36.1 T-5 (no silent skips), §37.4 (readiness), §43.1 (G-1…G-13)
**Slice:** M1b-S4
**Branch:** `codex/my-shop-m1b-s4-ledger`
**Predecessor:** `e3049cb` - M1b-S3, branch `codex/my-shop-m1b-s3-push-pull-transport` (S3 record `a6bbccb` plus the toolchain fix of PR #10)
**Repair commit:** none required against the predecessor; two in-slice fix commits `26ee4b7`, `edb7b84` (§3.3)
**Final SHA (implementation head):** `edb7b84`
**Declaration status:** `PASS_MY_SHOP_M1B_S4_LEDGER_REMOTE_LOCKED`

---

## 1. Predecessor state

### 1.1 Entry state, verified not assumed

| Check                  | Value                                                                                   | Result                              |
| ---------------------- | --------------------------------------------------------------------------------------- | ----------------------------------- |
| Repository root        | `C:/dev/my-shop`                                                                        | pass                                |
| Branch at entry        | `codex/my-shop-m1b-s3-push-pull-transport` @ `a6bbccb`                                  | pass - canonical M1b-S3 record head |
| Branch created         | `codex/my-shop-m1b-s4-ledger` from `a6bbccb`                                            | pass                                |
| Ancestry               | `e3049cb` (S3 + toolchain) -> `a6bbccb` (S3 record) -> `eee9d2f` (S3) -> `3292601` (S2) -> `0c824fd` (S2) -> ... -> `main` ancestor | pass - stacked ancestry intact      |
| Controlled integration | S4 rebased onto `e3049cb` after PR #10 merged into the S3 branch (§1.3)                 | pass - owner authorized, see below  |
| `origin/main`          | `53f6aaa`, unchanged by this slice                                                      | pass                                |
| Worktree at entry       | clean                                                                                   | pass                                |
| Predecessor record     | S3's §6 boundary names M1b-S4 "the ledger and the first half of the mutation path"       | pass - this slice is that row       |

### 1.2 Predecessor findings (carried, not re-opened)

No blocking defect existed in the committed M1b-S3 tree; the S3 branch was declared remote-locked and every S3 gate held on this host. S3's own record documents its scope corrections (as-named/as-planned transport naming, the 16/17-column slip); both are already settled and are **not** repaired here. S3's §3.5 proved `contracts:check` drift detection is non-vacuous; that proof is inherited (G-7, §3.5 below).

### 1.3 Baseline dependency-audit blocker (resolved before S4 could be accepted)

On the untouched lockfile the CI stage `dependency-audit` (`npm audit --audit-level=high`) failed on the **baseline** - present on every stacked branch and not introduced by this slice (S4 adds no dependency). The single critical was `handlebars` (three 2026 advisories: GHSA-xw65-4hp5-5hc7 moderate, GHSA-8r5x-fm3f-whwj CVSS 9.8 critical, GHSA-p8wg-vrv2-v86f critical; range `>=4.0.0 <=4.7.9`), pulled as `ts-jest -> handlebars@4.7.9`.

Owner decision: fix on the stack, owner-controlled integration. The fix is **non-breaking and lockfile-only** - `handlebars 4.7.9 -> 4.7.10` (plus its `minimist` range `^1.2.8`, already resolved at `1.2.8`) - isolated on branch `codex/m1b-toolchain-swag-audit` and integrated by **PR #10** (base: the S3 branch). The `@nestjs/swagger` 11->12 `--force` bump was **not** taken: it addresses only a moderate advisory and is outside the high/critical gate. Scope was tightened to the required fix alone: a targeted `npm update handlebars --package-lock-only` was used instead of `npm audit fix`, so no unrelated package moved. The toolchain change therefore lives in the S4 branch's **base** (`e3049cb`) and was never authored inside this slice (§2.3, §4.3 G-4/G-5).

---

## 2. Declaration

### 2.1 `scope`

Per Master Plan §40.5 row M1b-S4 - the server mutation ledger and the first half of the mutation path: the idempotency gate, the change feed, per-device cursors, and per-organization server sequences, all as **backend** infrastructure with no transport and no business rule. Push (M1b-S5), pull (M1b-S6), the push/pull endpoints, and business modules stay out (§43.4; §2.2).

| #     | Outcome                                                                                                                                                                                                                                                                                 |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-1   | Schema in `schema.prisma`: `mutation_ledger` keyed `(organization_id, mutation_id)` - the idempotency key itself (§38.9.1) - with `device_id`, `received_at`, `payload_hash`, `result_ref`, `result_hash`, `server_sequence`, `status` (`APPLIED\|REJECTED`), `rejection_code`; `change_log` keyed `(organization_id, server_sequence)` with `mutation_id` nullable + `entity_type`/`entity_id` stamp and index `(organization_id, entity_type, entity_id)` (§38.11.1, §39.5); `device_sync_cursors` keyed `(organization_id, device_id)` with `last_pushed_server_sequence`, `last_pull_server_sequence` (default 0), `updated_at` (§40.5); `sync_sequences` keyed `(organization_id)` - the §38.11.1 counter |
| S-2   | Forward-only additive migration `0002_mutation_ledger`: enum + the four tables; `0001_schema_skeleton` untouched (G-6, G-7) |
| S-3   | Canonical `payload_hash`: SHA-256 hex over deterministic canonical JSON (sorted keys, recursive; `undefined`-valued keys dropped; non-JSON values refused) (`payload-hash.ts`), with the pinned test vector |
| S-4   | `MutationLedgerService.applyMutation` in **one** transaction: advisory xact lock keyed `(organization_id, mutation_id)` (§38.9.2 race serialization), idempotency lookup, then replay / contradiction / first-sight |
| S-5   | Replay answers from the stored row - same `serverSequence`, `receivedAt`, `resultRef`/`resultHash` (or stored rejection code) - and never calls the effect (§38.9.2, §38.13) |
| S-6   | A different payload under one `mutation_id` is `409 MUTATION_CONTRADICTION` (F-14) plus a structured security log event `sync-rejected-idempotency-contradiction`; the durable `security_events` table is deferred to M2-S6 (§40.6) and documented (D-7) |
| S-7   | The caller's business effect runs **inside** the ledger's transaction (§38.9.3); an effect failure rolls back ledger row, change-log row, cursor, and the effect's own writes; a `MutationRejectedError(code)` persists a `REJECTED` row that consumes no sequence, writes no feed, and touches no cursor (§38.13) |
| S-8   | `server_sequence` allocated per organization by a single upsert-returning statement (§38.11.1); gaps tolerated; `REJECTED` never consumes one |
| S-9   | `change_log` row written in the same transaction (§38.11.1); `device_sync_cursors` upserted with `GREATEST` so "never backwards" is a database property (§40.5) |
| S-10  | `PrismaHost` abstraction: the module never reads `.prisma` at construction, so the OpenAPI generation boots with no `DATABASE_URL` (§37.4) - `LedgerModule.forRoot(config)` mirrors `DatabaseModule`'s scoping pattern |
| S-11  | Ledger publishes no controller (no endpoint): the OpenAPI document and contract are byte-identical (G-7) |
| S-12  | Tests: unit (`payload-hash`, `mutation-ledger` against an in-memory host) and real-PostgreSQL acceptance (`postgres.db-spec.ts`: `acceptance_probe` table proving "10 replays produce one effect" - T-O3/T-O5) |

### 2.2 `non_scope`

| Not touched                                                                                                              | Reason                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Push/pull transport, batch envelopes, per-mutation outcome stream endpoints (§38.10.1)                                    | §40.5 M1b-S5/S6; deferred by plan (§43.4)                                                        |
| Business rules (sale resolution, stock guards, pricing re-validation §38.19)                                              | Caller-supplied effects only; the ledger owns no business rule (§8.4 D-8)                        |
| `sync_conflicts` table and conflict resolution edges                                                                      | M1b-S6 (per predecessor note), §38.13                                                           |
| Durable `security_events` table                                                                                           | M2-S6 (§40.6); this slice logs the structured security event and records the deferral (D-7)      |
| All Flutter/offline code, `packages/contracts` generated artifacts, `openapi.json` / `schemas.ts`                         | No endpoint changed; contract files are byte-identical (G-7, §3.5)                               |
| `MY_SHOP_MASTER_PLAN.md`, predecessor records                                                                             | No decision changed; left byte-identical                                                         |
| `.github/workflows/**`, branch protection, required checks                                                                | M1-S4 owns the CI platform; no CI change needed                                                  |
| Root `package-lock.json` / toolchain dependencies                                                                         | Out of this slice; owned by PR #10 and inherited via the rebased base (§1.3)                     |
| Merging PR #9, auto-merge                                                                                                 | Owner boundary; G-12, G-4 (the controlled rebase itself was separately authorized, §1.3/§4.3)   |

### 2.3 `allowed_paths`

```
services/api/prisma/schema.prisma
services/api/prisma/migrations/0002_mutation_ledger/migration.sql
services/api/src/app.module.ts
services/api/src/common/sync/ledger/mutation-ledger.errors.ts
services/api/src/common/sync/ledger/mutation-ledger.module.ts
services/api/src/common/sync/ledger/mutation-ledger.service.ts
services/api/src/common/sync/ledger/mutation-ledger.spec.ts
services/api/src/common/sync/ledger/payload-hash.ts
services/api/src/common/sync/ledger/payload-hash.spec.ts
services/api/test/database/postgres.db-spec.ts
docs/governance/MY_SHOP_M1B_S4_SLICE_RECORD.md
```

This slice's own commits (`git diff e3049cb..edb7b84`) touch exactly these eleven paths (ten code files plus this record). The root `package-lock.json` difference visible against the *pre-toolchain* head is the inherited base fix (§1.3), not authored here.

### 2.4 `tests`

| Level                 | Requirement                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Gate positives        | `api:typecheck`, `lint`, `format:check`, all nine `gates`, `contracts:check` green on this host; unit 132 passed, integration 17 passed        |
| Payload hash (§38.9.1)| sorted-key determinism, nested/array/escape cases, `undefined` keys dropped, non-JSON refused, 64-hex form, pinned vector, distinguishes payloads |
| Ledger service (unit) | first-apply records effect+ledger+feed+cursor+sequence; replay applies nothing and returns the stored response; contradiction (both hashes in the alarm); rejection persisted with code and no sequence/feed/cursor; rejection replay answered from store; non-rejection failure records nothing; advisory-lock ordering |
| DB acceptance (M1b-S4)| `acceptance_probe` (migrator-owned) proves one effect across ten replays; contradiction is 409 and never an effect; rejection persists with no sequence/feed/cursor and replays; failed effect rolls back probe+feed+cursor together; 10 racing requests serialize into one effect (T-O5); sequences are per-organization and cursors never move backwards |
| Migration            | applied = 2 (`0001_schema_skeleton`, `0002_mutation_ledger`), each finished, never rolled back; exactly the four sync tables; second deploy no-op |
| DB acceptance local  | run on this host against a local `postgres:18` container - 15 passed                                                                            |
| Remote CI            | all seven checks green on the final implementation head `edb7b84` (§3.6)                                                                      |

### 2.5 `acceptance_criteria`

| #     | Criterion                                                                                  | Evidence                    |
| ----- | ------------------------------------------------------------------------------------------ | --------------------------- |
| AC-1  | Schema in §2.1 S-1, keyed `(organization_id, mutation_id)`                                 | §3.3                        |
| AC-2  | Forward-only additive `0002`; `0001` untouched (G-6/G-7)                                   | §3.3                        |
| AC-3  | Canonical `payload_hash` with pinned vector                                                | §3.4                        |
| AC-4  | Ten replays produce one effect (T-O3)                                                      | §3.4                        |
| AC-5  | Same `mutation_id`, different payload -> `409 MUTATION_CONTRADICTION` + security event (F-14) | §3.4                       |
| AC-6  | Rejection persisted `REJECTED` with code; no sequence/feed/cursor; replay answered from store (§38.13) | §3.4              |
| AC-7  | Effect, feed, and cursor commit or roll back together (§38.9.3)                            | §3.4                            |
| AC-8  | Racing same-mutation requests serialize into one effect (T-O5)                             | §3.4                            |
| AC-9  | Per-organization sequences; a replay never moves a cursor backwards (GREATEST, §40.5)      | §3.4                            |
| AC-10 | No endpoint added: OpenAPI/contract byte-identical; drift gate green (G-7, inherited from S3) | §3.5                         |
| AC-11 | All gates and local suites pass; `dependency-audit` and DB acceptance green in CI (T-5)    | §3.1, §3.6                      |
| AC-12 | PR #9 stacked on the M1b-S3 branch (now including PR #10), open, not merged                | §3.7                            |
| AC-13 | Role separation preserved: schema owned by migrator, ledger traffic runs as `my_shop_app`  | §3.3                            |

---

## 3. Execution and evidence

### 3.1 Local chain

`npm run typecheck` (incl. `tsc -p tsconfig.test.json`), `npm run lint`, `npm run format:check` all pass. All nine `gates` pass - `secret-scan`, `markdown`, `import-boundary`, `vocabulary`, `localization`, `design-system`, `immutability`, `offline`, `migrations` - including `migration-immutability` ("2 migration path(s) ... none rewritten"). Unit suite: **132 passed** (ledger + payload-hash suites included). Integration suite: **17 passed**. `contracts:check` prints "contracts are in sync". The real-PostgreSQL database acceptance also ran green on this host against a local `postgres:18` container: **15 passed**. In CI it runs against the workflow's PostgreSQL 18 service (§3.6).

### 3.2 Environment

Node v22.22.x, npm 10.9.x, `@prisma/client` / `prisma` 6.12.0; schema generated with `prisma generate`. PostgreSQL 18 for the acceptance stage (local Docker container on a non-default host port; CI uses the workflow service).

### 3.3 Schema and service (verified)

`mutation_ledger` PK `(organization_id, mutation_id)`; index on `(organization_id, device_id)` and `(organization_id, received_at)`; enum `MutationLedgerStatus` mapped (`@@map`) to the migration's `mutation_ledger_status`; `change_log` keyed `(organization_id, server_sequence)` with `mutation_id` nullable and the `(organization_id, entity_type, entity_id)` index; `device_sync_cursors` keyed `(organization_id, device_id)`; `sync_sequences` keyed `(organization_id)` - the §38.11.1 counter. The migration workflow reports applied = 2, no rollback, exactly the four sync tables; a second deploy is a no-op. `change_log` and `mutation_ledger` never enter the accounting ledger (§39.4, D-8) - this slice owns no business rule and authored no business table.

The service composes the idempotency gate, the effect, the feed row, and the cursor in **one** transaction. Raw helper statements (`pg_advisory_xact_lock`, the sequence `INSERT ... ON CONFLICT ... RETURNING`, the cursor `GREATEST` upsert) are issued as statements (`$executeRaw`) with explicit `::uuid`/`::bigint` casts, and the sequence counter is read back with `$queryRaw`, because the driver binds string parameters as `text` and `$queryRaw` cannot deserialize a `void` result. Three defects found by the real-PostgreSQL suite are the substance of the two in-slice fix commits (`26ee4b7`, `edb7b84`):

1. `pg_advisory_xact_lock` returns `void` - run as a statement, not a query (the earlier form could not be deserialized).
2. Raw string parameters arrive as `text`; uuid columns need `::uuid` (and the sequence `::bigint`), else `Raw query failed. Code: 42804`.
3. `schema.prisma` declared `enum MutationLedgerStatus` with no `@@map`, while migration `0002` creates `mutation_ledger_status`; Prisma cast to a quoted `"MutationLedgerStatus"` that does not exist (`Code: 42704`). Fixed with `@@map("mutation_ledger_status")`.

### 3.4 Test evidence

| Suite                         | Result                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| `payload-hash.spec.ts`        | determinant/order/recursion/escaping, `undefined`-key drop, non-JSON refusal, 64-hex, pinned vector `d3626ac3...` all green |
| `mutation-ledger.spec.ts`     | first-apply, replay-no-effect, contradiction-with-alarm, rejection-without-sequence, rejection-replay, rollback-on-failure, advisory-order all green |
| DB acceptance (M1b-S4)        | `acceptance_probe` + 6 cases: ten-replays-one-effect (probe row count = 1, feed at seq 1, cursor at 1), contradiction (409 class, one row, hashes match), rejection (REJECTED row, empty `sync_sequences`/feed/cursor, replay answers), failed-effect rollback (probe=0, ledger=0, sequences=0), 10-racing-serialized (one effect), per-org sequences + no-cursor-backwards - **15 passed** against `postgres:18` |
| Migration workflow            | applied = 2, not rolled back; exactly the four sync tables; second deploy no-op             |
| Pre-existing suites           | role separation, /readyz, /healthz, integration (17) all green                              |

### 3.5 Drift negative re-proven / inherited (G-7 non-vacuous)

S3's record proved `npm run contracts:check` fails on a hand-edited `schemas.ts` and passes when restored (SHA-256 verified). That proof is inherited unchanged: this slice adds no controller and no DTO, `mutation_ledger`/`change_log` never enter the accounting ledger (§39.4), no decision changed the master plan, and `contracts:check` is green on this head.

### 3.6 Remote CI

All runs on the implementation head `edb7b84` (G-4 exact-SHA discipline; no earlier run is offered as a substitute).

| Run         | Event        | SHA       | Result    | Jobs                                                                 |
| ----------- | ------------ | --------- | --------- | -------------------------------------------------------------------- |
| 38083457625 | pull_request | `edb7b84` | success   | all 7 required checks green                                          |
| 38083453914 | push         | `edb7b84` | artifact  | `fast-checks` Stage 1 secret-scan only; remaining jobs skipped (note) |

The seven required checks: `fast-checks`, `backend-unit`, `backend-integration-database`, `contract-drift`, `dependency-audit`, `flutter-build-windows`, `flutter-build-android`. On run `38083457625` all seven are green - including `backend-integration-database` (real PostgreSQL 18) and `dependency-audit`, the latter now green because the critical `handlebars` fix is in the rebased base (PR #10): `npm audit --audit-level=high` exits 0 (0 high, 0 critical; 21 moderate remain below the gate).

Push-event note (`38083453914`): the single failure is `fast-checks` Stage 1 secret scan. Its base is taken from the push event's `before` SHA; because this SHA is the result of the controlled integration rebase (§1.3), that `before` is the pre-rebase head `ec1b44e`, which the shallow checkout does not contain (`fatal: bad object ec1b44e...`). It is a base-ref artifact of the authorized history rewrite, not a code or secret result. The pull-request run computes the base correctly and is fully green (table above). The record commit that carries this document is a documentation-only successor of `edb7b84` pushed without force, so its own push event resolves `CI_BASE_REF` to its parent and runs clean.

### 3.7 PR

PR #9, head `codex/my-shop-m1b-s4-ledger`, base `codex/my-shop-m1b-s3-push-pull-transport` (stacked on the unmerged M1b-S3 branch, now at `e3049cb` after PR #10). Open, not merged. PR #10 (toolchain) was **merged** into the S3 branch by the owner (`e3049cb`). `origin/main` untouched; PRs #1-#8 untouched.

### 3.8 Offline/idempotency threat-model walk (gate G-13)

§13.7 walked for this slice - the server one of the two halves of T-O3:

| Threat row                     | What this slice does / does not do                                                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duplicate replay               | The ledger PK **is** the idempotency key; `REPLAY` is a lookup that returns the stored response and never runs the effect a second time (§38.9.2)  |
| Genuine duplication bypass     | A reused `mutation_id` under a different payload is a `MUTATION_CONTRADICTION` security alarm (409 + structured log), not a silent second effect (F-14) |
| Race / at-least-once transport | `pg_advisory_xact_lock` serializes competing same-mutation requests before the lookup, so exactly one effect survives (T-O5)                        |
| Partial visibility             | Effect, ledger row, feed row, and cursor commit as one transaction; a crash before commit leaves nothing, after commit can never double-apply (§38.9.3) |
| Idempotent pull cursor         | `last_pull_server_sequence` is reserved (§38.11.2) and defaults to 0; the push cursor uses `GREATEST` so a late replay cannot rewind it (§40.5)       |
| Audit / contradiction retention| Contradiction and rejection are written to the ledger (append-only) so owner review has durable evidence; the durable `security_events` sink is M2-S6 (D-7) |

**Statement of limits:** the server ledger detects and makes attributable a duplicated or contradictory mutation; it does not validate business rules (those live in the caller's effect, §38.19 backend re-validation is still a business-slice duty) and it does not prevent a compromised device from *attempting* fraud - the ledger records the attempt. No new unauthenticated surface (no controller), no new secret, no new permission (G-8).

---

## 4. Decisions and scope-difference report

### 4.1 Decisions

| #   | Decision                                                                                                              | Rationale                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| D-1 | `payload_hash` stored on the ledger row at first sight; replays compare stored vs recomputed                           | A stored hash lets a replay be a pure PK lookup and makes the contradiction compare durable evidence, §38.9.1 |
| D-2 | `mutation_ledger.server_sequence` column on APPLIED rows                                                                | §38.9.2's "return the original stored response" includes `server_sequence` (§38.10.1); storing it avoids a secondary `change_log` lookup on replay |
| D-3 | Advisory transaction lock keyed `(organization_id, mutation_id)` before the idempotency lookup                         | Two devices racing the same mutation serialize into one effect, §38.9.2 / T-O5                          |
| D-4 | Sequence allocation is one `INSERT ... ON CONFLICT ... RETURNING` statement; gaps tolerated                             | §38.11.1 permits gaps; the counter cannot double-allocate under concurrency                             |
| D-5 | `REJECTED` consumes no sequence, writes no feed, and touches no cursor                                                 | A rejection is not an event in the change stream (§38.13); the sequence is acceptance order, not attempt order |
| D-6 | Cursor advance uses `GREATEST` inside the upsert                                                                       | "Never moved backwards" is a database property, §40.5                                                    |
| D-7 | Durable `security_events` table deferred to M2-S6 (§40.6); this slice emits the structured security event and documents the deferral | The sink is a later slice; the structured event is emitted now (§38.28)                       |
| D-8 | Ledger is backend infrastructure with no transport and no rule; `change_log`/`mutation_ledger` never enter the accounting ledger | §39.4, §8.4 D-8; the accounting ledger stays a separate, double-entry concern             |
| D-9 | Baseline `dependency-audit` fixed on the stack via PR #10 (lockfile-only, non-breaking)             | §1.3; owner-authorized, keeps the slice free of toolchain edits                             |
| D-10| S4 history rebased onto the fixed base (`e3049cb`) with `--force-with-lease` under explicit authorization | Integrate the fix without writing to `main`; force-with-lease with confirmed remote identity  |

### 4.2 Scope-difference report

The slice's scope is exactly §40.5's M1b-S4 row. Two boundaries are named rather than silently crossed: **(a)** the baseline `dependency-audit` failure is a pre-existing repo/toolchain defect, fixed on the stack via PR #10 and pulled in by rebase - it is not part of this slice's authored change (§1.3), and the fix was deliberately narrowed to the one critical package; **(b)** the integration itself used a rebase, which is normally an owner-only history operation, performed only after explicit owner authorization with `--force-with-lease` against a confirmed expected SHA.

### 4.3 Gates G-1…G-13

| Gate | Condition                                                        | Result                                                                                                                                                    |
| ---- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G-1  | no business table outside the plan's data domain map             | PASS - the four tables are the §40.5 ledger set; the plan map is not contradicted (§39.5)                                                                 |
| G-2  | contract files unchanged                                         | PASS - no controller/DTO; `openapi.json`/`schemas.ts` byte-identical (§3.5)                                                                                |
| G-3  | schema/migration additive and correct                            | PASS - `0002` applied, `0001` byte-identical (§3.3)                                                                                                        |
| G-4  | all CI stages pass; no history rewrite after acceptance          | PASS - all 7 checks green on `edb7b84` (§3.6); the controlled rebase was owner-authorized and used `--force-with-lease` before acceptance; no rewrite after  |
| G-5  | no file outside `allowed_paths` modified                         | PASS - slice diff confined to §2.3; the toolchain file is in the base only (§1.3)                                                                          |
| G-6  | `non_scope` verifiably untouched                                 | PASS - no contract artifacts, no Flutter code, no CI, no plan edit (§2.2)                                                                                  |
| G-7  | migration impact as declared; migrations immutable; drift non-vacuous | PASS - additive `0002`; `migration-immutability` green; S3's drift negative proof inherited (§3.5); `contracts:check` green                          |
| G-8  | security impact as declared                                      | PASS - no new endpoint, permission, or secret; contradiction alarm logged (D-7); §13.7 walk (§3.8)                                                          |
| G-9  | migration audit: no `GRANT ALL`, no interpolation                | PASS - additive `0002`; raw helpers are parameterized statements with explicit casts (§3.3)                                                                |
| G-10 | rollback defined and feasible                                    | PASS - drop the branch and migration; `main` untouched                                                                                                     |
| G-11 | documentation updated                                            | PASS - this record; no decision changed the master plan                                                                                                    |
| G-12 | owner authorized the merge                                       | NOT SATISFIED for PR #9 - no merge performed, by design (left open). Integration authority (PR #10 merge, and the S4 rebase) WAS granted and used (§1.3)   |
| G-13 | offline path: threat model walked and tests                            | PASS - T-O3/T-O5 server half; §3.8                                                                                                                         |

---

## 5. Deviations

- **In-slice fixes (2 commits).** The real-PostgreSQL suite surfaced three defects in the freshly written ledger path (advisory-lock `void` result; `text` vs `uuid` binding; enum `@@map`). These are ordinary implementation corrections inside the slice, recorded in §3.3, not predecessor repairs.
- **Baseline toolchain fix via PR #10 + rebase.** The `dependency-audit` gate was red on the untouched baseline. Per owner decision it was fixed on the stack (lockfile-only) and this branch was rebased onto the fixed base `e3049cb` with `--force-with-lease` under explicit authorization. This is the only history operation on this branch and it precedes final acceptance (§1.3, §4.2).

---

## 6. Boundary

The next slices are **M1b-S5** (push transport, the per-mutation outcome stream over the wire) and **M1b-S6** (pull transport, `sync_conflicts`, conflict resolution) - §40.5, §43.4. Business modules remain unauthorized.

```
M1b-S5/M1b-S6 NOT AUTHORIZED
PASS_MY_SHOP_M1B_S4_LEDGER_REMOTE_LOCKED
```
