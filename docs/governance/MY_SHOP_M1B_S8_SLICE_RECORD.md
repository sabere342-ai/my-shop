# MY SHOP - M1b-S8 SLICE RECORD: OFFLINE AUTH GRACE

**Master plan:** `docs/governance/MY_SHOP_MASTER_PLAN.md` v1.1.0 — §40.5 (M1b-S8), §38.16.1–§38.16.5 (offline authentication, cached snapshot, revocation limit, entitlement and clock tampering), §38.17 (offline permissions), §10.3.1 (sessions under offline operation), §38.6.2 (local schema change only when genuinely required), §39.6 (the local client schema, `local_meta`), §36.1 T-2 (no silent skips), §36.2 (suites), §37.2 (CI stages 23–24), §43.1 (G-1…G-13), O-13/O-20 (grace duration), ADR-003 (no global mutable singletons), ADR-044
**Slice:** M1b-S8
**Branch:** `codex/my-shop-m1b-s8-offline-auth-grace`
**Predecessor:** `5a2f397abcaaccd729a34f87682ea1ee7488fbf9` — M1b-S7, branch `codex/my-shop-m1b-s7-loop-prevention` (PR #13, open, base `codex/my-shop-m1b-s6-pull-endpoint`)
**Repair commit:** none required against the predecessor
**Final SHA (implementation head):** `556abd29beb6d1115345d3f9b3d9558ff0f899a0`
**Declaration status:** `PASS_MY_SHOP_M1B_S8_OFFLINE_AUTH_GRACE_REMOTE_LOCKED`

---

## 1. Predecessor state

### 1.1 Entry state, verified not assumed

| Check              | Value                                                                                                        | Result                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| Repository root    | `C:/dev/my-shop`                                                                                             | pass                                         |
| Branch at entry    | `codex/my-shop-m1b-s7-loop-prevention` @ `5a2f397`                                                           | pass - equals the accepted M1b-S7 head        |
| Branch created     | `codex/my-shop-m1b-s8-offline-auth-grace` from `5a2f397`                                                     | pass                                         |
| Ancestry           | `556abd2` (S8) -> `5a2f397` (S7 record) -> `ec711fc` (S7) -> `ebc962c` (S6) -> `c9c4fec` (S6) -> … -> `main` | pass - stacked ancestry intact               |
| `origin/main`      | `53f6aaa`, unchanged by this slice                                                                           | pass                                         |
| Worktree at entry  | clean, no commits on the new branch                                                                          | pass - started clean, not restarted          |
| Predecessor record | `MY_SHOP_M1B_S7_SLICE_RECORD.md` present, declares S8 not authorized by S7                                   | read; its §6 boundary is superseded here     |

### 1.2 Predecessor findings (carried, not re-opened)

No blocking defect existed in the committed M1b-S7 tree; it was green on its own head. Three S7 decisions matter to S8 and are honoured rather than re-litigated:

- **`applyRemoteWithoutOutbox` is the single remote-apply door** (§38.12.1), and `OutboxRepository.enqueue` refuses to write while `RemoteApplyScope.isActive`. S8 adds a mutation-admission check to the *same* writer and keeps the suppression check **first**, so the structural loop invariant is not shadowed by the new policy gate (§3.4).
- **Local schema v3 is current** (v1 `local_meta`, v2 outbox, v3 remote-apply guard). S8 adds no table and no migration, so v3 stays the current version (§2.2, §3.5).
- **Per-entity `server_sequence` guard is a `BigInt`/decimal decision.** Unrelated to the offline session, and untouched.

### 1.3 The M1b-S5 record gap (carried from S6/S7, unchanged)

The M1b-S5 branch (`e75ba03`, PR #11) was accepted with no slice record; the M1b-S6 and M1b-S7 records named this rather than inventing one. S8 does not re-open it.

---

## 2. Declaration

### 2.1 `scope`

Per Master Plan §40.5 row **M1b-S8 — offline auth grace**: signed grace record, device binding, grace-window setting, expiry behaviour, cached authorisation snapshot, and clock-tamper handling. The principal invariants are §38.16.2's **bounded** offline session (mutations refused at expiry; reads and committed sales continue) and §38.16.3/§38.17's **locally verified** signed snapshot. This slice is client-only (Dart/Flutter); it changes no server, Prisma, contract, or schema-of-record.

| #    | Outcome                                                                                                                                                                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S-1  | New module `apps/desktop/lib/core/offline/grace/offline_grace_record.dart`: `OfflineGraceRecord` — a value object holding exactly §38.16.3's fields (`userId`, `organizationId`, `deviceId`, `permissions`, `permissionsVersion`, `issuedAt`, `expiresAt`, optional `entitlementExpiresAt`) plus the opaque server `signature`, with a deterministic canonical `signedPayload` (`signature` excluded) and strict `fromJson`                                                     |
| S-2  | New `grace_signature_verifier.dart`: the `GraceSignatureVerifier` port with **no accepting default** — a device that cannot verify refuses the session rather than guessing (§38.16.3, §38.17). The concrete asymmetric verifier and key distribution are M2-S3's (§40.6)                                                          |
| S-3  | New `offline_auth_gate.dart`: the `OfflineAuthGate` port, the `MutationRefusalReason` vocabulary (one value per §38.16.2/§38.16.4/§38.16.5 condition), and `OfflineMutationRefusedException`. Mutations are the only gated half; reads are never gated (§38.16.2)                                                          |
| S-4  | New `clock_integrity_guard.dart`: the backward rule (a persisted high-water clamps a rewound clock so an expired window cannot re-open) and the forward rule (a wall clock outrunning a monotonic source by more than the stated `defaultTolerance` of one hour is a forward jump requiring online re-validation) (§38.16.5, F-21) |
| S-5  | New `offline_grace_store.dart`: durable session state in the existing `local_meta` table — the signed record + the device establishment instant (one atomic JSON value), the clock high-water, the re-validation flag, and a durable tamper count. **No schema change, no migration** (§38.6.2, §39.6)                             |
| S-6  | New `offline_grace_service.dart` (`OfflineGraceService implements OfflineAuthGate`): `establishSession` verifies signature + device/org binding then starts the window at that instant; `requireMutationAllowed` refuses with the exact reason; `status` surfaces the session; `clearSession` invalidates immediately (local password change, §38.16.4)         |
| S-7  | Device binding is re-checked on **every** admission, not only at establishment, so a record copied to another install fails `bindingMismatch` (§38.16.2, §10.3.1 anti-replay)                                                                                                                                          |
| S-8  | `OutboxRepository` gains an optional `authGate`. `enqueue` consults it **after** the S7 suppression check and **before** validation/write; a refusal leaves no outbox row, no audit row, and no allocated sequence (T-O17). Absent, the writer behaves exactly as before S8                                                                                 |
| S-9  | Expiry maps the server-issued window length onto the **device** timeline (establishment instant + `expiresAt - issuedAt`), so the device clock is never mixed with server time (§38.16.5); an entitlement expiry is mapped the same way and closes the device first                                       |
| S-10 | No server, contract, migration-of-record, local-schema, CI-workflow, or toolchain change. The single tool change is the declared stage-24 exemption for the grace store (§2.2)                                                                                                                   |

### 2.2 `non_scope`

| Not touched                                                                                          | Reason                                                                                                                              |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Authenticated HTTP **pull transport** and the client **resume cursor**/orchestration                   | §40.5 assigns M1b-S8 to offline auth grace, not transport; the connectivity slice owns fetch/resume (§1.2)                          |
| Own-echo **reconciliation** and full entity payload retrieval / writing real business tables          | Later business slices; the S7 descriptor boundary is unchanged                                                                       |
| **Connectivity monitor and backoff scheduler**                                                        | M1b-S9 (§40.5); S8 answers "may this device mutate offline", not "is the network up"                                                |
| **Observability plumbing** (`trace_id`/metrics, formal `security_event` emission)                     | M1b-S10 (§38.28); S8 keeps a **durable local** tamper count and states that mirroring it to a `security_event` is S10's              |
| The **concrete asymmetric signature verifier** and server key distribution                            | §40.6 M2-S3 "signed snapshot issuance"; S8 owns the port and the verification *seam*, with no accepting default                      |
| The **server-issued signed time anchor** for the forward rule                                          | Issued by the identity/entitlement slices (M2); S8 corroborates with an in-process monotonic source and states the residual risk    |
| **Grace-window persistence as a synced organization setting** (`offline_grace_duration`, default 72h)  | The window **length** arrives in the signed record, which S8 consumes; the server-side setting/endpoint is §22.4/M3-S1               |
| `sync_conflicts`, conflict UI, business modules, business tables                                       | Not in §40.5's M1b-S8 column set                                                                                                     |
| Server code, Prisma schema, contracts, CI workflow, root toolchain/lockfile                           | S8 is client-only; no backend or contract decision changes                                                                          |
| Master plan, S1–S7 records, `main`                                                                     | No plan decision changed; the plan is not edited; `main` untouched                                                                  |
| Merging PR #14, auto-merge                                                                             | Owner boundary; not performed, not requested (§4.3 G-12)                                                                            |

### 2.3 `allowed_paths`

```
apps/desktop/lib/core/offline/grace/offline_grace_record.dart
apps/desktop/lib/core/offline/grace/grace_signature_verifier.dart
apps/desktop/lib/core/offline/grace/offline_auth_gate.dart
apps/desktop/lib/core/offline/grace/clock_integrity_guard.dart
apps/desktop/lib/core/offline/grace/offline_grace_store.dart
apps/desktop/lib/core/offline/grace/offline_grace_service.dart
apps/desktop/lib/core/offline/outbox/outbox_repository.dart
tool/ci/offline-guards.mjs
apps/desktop/test/offline/grace_test_harness.dart
apps/desktop/test/offline/grace_admission_test.dart
apps/desktop/test/offline/grace_clock_tamper_test.dart
apps/desktop/test/offline/grace_durability_test.dart
apps/desktop/test/offline/outbox_auth_gate_test.dart
apps/desktop/test/offline/sync_transport_deferred_test.dart
docs/governance/MY_SHOP_M1B_S8_SLICE_RECORD.md
```

This slice's own commits touch exactly these fifteen paths (fourteen code/artifact files plus this record). The CI change is a single declared exemption line and its doc comment; no gate logic is weakened (§3.5).

### 2.4 `tests`

| Level                       | Requirement                                                                                                                                                                                                                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gate positives              | All nine `gates`, `format:check`, `lint`, `typecheck`, `contracts:check`, and `npm audit --audit-level=high` green on this host; API unit+integration+database **261**, contracts **17**, testkit **5**                                                                                                    |
| Establishment (T-O17)       | No session refuses mutations; a signed, bound record establishes and permits; a foreign-key-signed record and a field-tampered record are refused and store nothing; a record bound to another device or organization is refused; a session clears immediately on a local password change                     |
| Window admission            | Permitted inside the window and refused **at** the expiry instant; the reported expiry is establishment + the server window; an expired session re-opens only by fresh establishment; an entitlement expiry makes the device read-only first                                                                |
| Clock integrity (F-21)      | Both clocks together is `ok`; a wall clock outrunning the monotonic clock is a forward jump; the tolerance boundary is exact (equal ok, past it a jump); a rewound clock is clamped by the high-water; a persisted future high-water is honoured; a forward jump is refused and flags revalidation; the flag is sticky and cleared only by fresh establishment; a jump within tolerance is accepted; the durable tamper count survives a restart |
| Backward tamper             | A restarted process with the clock wound back to establishment is still expired; a backward jump inside the window neither extends it nor blocks reads                                                                                     |
| Durability (T-O21)          | The record + establishment instant round-trip exactly and share one key; a second save replaces atomically; `clearSession` resets the flag; a malformed stored value is refused, never silently accepted; the high-water only moves forward; the tamper count is durable; **the local schema is unchanged and there is no grace table** |
| Outbox gate                 | Without a gate the writer is unchanged; the remote-apply suppression fires **before** the gate; a refusing gate is consulted before validation; an unexpected gate failure propagates and writes nothing; the gate is consulted for `enqueue` only, never for reads or transitions                         |
| Remote CI                   | All seven checks green on the implementation head `556abd29` (§3.6)                                                                                                                                                                                                                                       |

### 2.5 `acceptance_criteria`

| #     | Criterion                                                                                                   | Evidence    |
| ----- | ----------------------------------------------------------------------------------------------------------- | ----------- |
| AC-1  | The session is established only from a locally verified, device- and org-bound signed record (§38.16.2, §38.16.3) | §3.4        |
| AC-2  | Signature verification is a port with **no accepting default** (§38.16.3, §38.17)                            | §3.3, §3.4  |
| AC-3  | At expiry mutations are refused and the refusal leaves no business record, no audit row, no outbox entry (T-O17) | §3.4        |
| AC-4  | Reads and committed sales are never gated; committed sales still sync after the window closes (T-O15)        | §3.4        |
| AC-5  | A backward clock jump cannot re-open an expired window, across a process restart (§38.16.5)                  | §3.4        |
| AC-6  | A forward jump beyond the stated tolerance forces online re-validation, recorded as a durable security event (§38.16.5, F-21) | §3.4        |
| AC-7  | The session survives a restart with no schema change; state lives in `local_meta` and the local version stays v3 (§38.6.2, §39.6) | §3.5        |
| AC-8  | An entitlement expiry closes the device read-only before the grace window does (§38.16.5)                     | §3.4        |
| AC-9  | The S7 loop invariant is not shadowed: the remote-apply suppression fires before the new gate (§38.12.1)     | §3.4        |
| AC-10 | The forward-jump residual (a jump while the process is stopped) is documented, not hidden (§38.16.5)         | §3.3, §3.8  |
| AC-11 | No server/Prisma/contract/CI-workflow change; `contracts:check` green                                         | §3.1, §3.5  |
| AC-12 | All gates and local suites pass                                                                              | §3.1        |
| AC-13 | PR #14 stacked on the M1b-S7 branch, open, not merged                                                        | §3.7        |
| AC-14 | No destructive Git operation; `main` and S1–S7 untouched                                                     | §4.3 G-4/5  |
| AC-15 | The transport/resume deferral is annotated, not dropped (T-O6, connectivity slice)                            | §3.1        |

---

## 3. Execution and evidence

### 3.1 Local chain

`npm run gates` — secret-scan, markdown, import-boundary, vocabulary, localization, design-system, immutability, **offline (stages 23–24)**, migration-immutability — **all green (exit 0)**. `npm run toolchain:verify` — **PASS** (node 22.22.3, npm 10.9.8, flutter 3.47.5, dart 3.13.4 match the pin). `npm run format:check`, `npm run lint`, `npm run typecheck`, and `npm run contracts:check` ("contracts are in sync") — **all green**. API suites: **261 passed, 20 suites** in one `jest` run across the unit, integration, and real-PostgreSQL `database` projects (run against local PostgreSQL 18 with the suite's three URLs, §3.2). Contracts **17 passed**, testkit **5 passed**. `npm run flutter:analyze` prints "No issues found!". `npm run flutter:test` prints **"167 passed, 1 skipped"** — the skip is `DEFERRED_BY_PLAN: T-O6 pull resumes after reconnect without gaps`, whose owning slice is the connectivity slice, not S8 (§3.4). `npm audit --audit-level=high` exits 0 (0 high, 0 critical; 21 moderate remain below the gate).

The stage-24 offline gate reports **"OK — 49 dart file(s); 2 generated *.g.dart exempt; offline module present"**: the single apply entry point is present, the grace store is the one declared non-apply local-write exemption, and no other `lib/core/offline/` file gained a write path.

### 3.2 Environment

Local PostgreSQL **18.4** (service `postgresql-x64-18`, running); the acceptance suite was pointed at it through `DATABASE_URL=postgresql://my_shop_app@localhost:5432/my_shop_test`, `MIGRATION_DATABASE_URL=postgresql://my_shop_migrator@localhost:5432/my_shop_test`, `ADMIN_DATABASE_URL=postgresql://postgres@localhost:5432/postgres` (trust auth) — the same role separation and posture the workflow's service uses. The `database` project provisions its own fixed test database via `scripts/db.mjs test-setup`; it deliberately fails fast rather than skipping when the environment is absent (T-2). CI runs the same suite against the workflow's PostgreSQL 18 service (§3.6).

### 3.3 Implementation notes

Four details carry the slice's weight:

1. **The window is the server's length, mapped onto the device timeline.** The signed record carries `issuedAt`/`expiresAt` in *server* time, but the window must be evaluated against the *device* clock. S8 stores the device instant at establishment and evaluates expiry as `deviceWallEstablishedAt + (expiresAt - issuedAt)`. Because only a difference is used, the length is offset-invariant and the two clocks are never mixed (§38.16.5). The same mapping is applied to `entitlementExpiresAt`.
2. **Admission is re-derived on every check, not cached.** `requireMutationAllowed` reads the stored session and re-verifies the signature and the device/org binding each time, so a database edited under a running process — or a record copied from another install — is caught at the next attempt rather than only at establishment (§38.16.2, §38.16.3).
3. **The forward rule is honest about what a client can see.** The plan anchors it to a *server-issued signed time anchor*, which does not exist until M2. Until then `ClockIntegrityGuard` corroborates the wall clock against a monotonic source **inside one process**: a wall clock that outruns it by more than the stated one-hour tolerance is a jump. A jump performed while the process is **not running** is not observable locally, so it is stated as a residual risk bounded by the grace window (AC-10) — not claimed as detected. The **backward** half is durable and needs no server: the persisted high-water clamps a rewound clock across restarts.
4. **The outbox gate is a policy seam after the structural one.** `enqueue` orders its checks: (a) the S7 `RemoteApplyScope` suppression throws first, because it guards §38.12.1's structural loop invariant; (b) then the optional `OfflineAuthGate`, a policy decision; (c) then validation and the transactional write. The gate is deliberately **async**, so a future gate that must consult disk/network can, while the suppression stays synchronous and unconditional.

### 3.4 Test evidence

| Suite                                   | Result                                                                                                                                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `grace_admission_test.dart`             | Establishment (no session refused; signed+bound permitted; foreign-signature and tampered-field refused with nothing stored; other-device and other-org refused; password-change clear); window admission (inside ok, at-expiry refused, fresh establishment restarts, entitlement reads-only-first); T-O17 refusal leaves no outbox/audit row and no sequence; a permitted mutation writes as before; **T-O15 committed sale still syncs after expiry**; the gate is consulted for `enqueue` only — all green |
| `grace_clock_tamper_test.dart`          | `ClockIntegrityGuard` unit matrix (ok; forward jump; exact tolerance boundary; rewound clamp; persisted future high-water); forward tamper refuses and flags, flag is sticky, fresh establishment clears it, within-tolerance accepted, durable count survives restart; backward tamper across restart is still expired and does not move the server-issued expiry; the stated residual (jump while stopped) closes by the window, not by detection — all green |
| `grace_durability_test.dart`            | No schema change (schema version still 3, no grace table); session round-trips exactly and shares one key; atomic replace; `clearSession` resets; **malformed stored value refused**; high-water only forward; revalidation flag round-trips; tamper count durable — all green                                                                 |
| `outbox_auth_gate_test.dart`            | No-gate backward compatibility; remote-apply suppression fires before the gate (gate called 0 times); refusing gate precedes validation; valid command still rejected by the gate; unexpected gate error propagates and writes nothing; the gate is consulted once per enqueue and never for reads/transitions — all green |
| Flutter                                 | `flutter analyze --fatal-infos` "No issues found!"; `flutter test` **167 passed, 1 skipped** (`DEFERRED_BY_PLAN`, connectivity slice)                                                                                                          |
| `dependency-audit`                      | `npm audit --audit-level=high` exit 0; 0 high, 0 critical, 21 moderate below the gate                                                                                                                                                        |

### 3.5 Local schema and contract drift

S8 **does not change the local schema**. The current version stays **v3** (v1 `local_meta`, v2 outbox, v3 remote-apply guard). Everything the offline session must remember lives in the existing `local_meta` key/value table under module-owned keys (`offline_grace_session`, `offline_grace_clock_high_water_ms`, `offline_grace_requires_revalidation`, `offline_grace_clock_tamper_count`), which §39.6 already names as the home of the device identity and time anchor. §38.6.2 asks for a local schema change only when one is genuinely required, and none is: the session is device-local key/value state, not a business entity. The `grace_durability_test.dart` asserts this directly (version 3, no `*grace*` table).

Because no schema changed, there is no migration and no backup-before-migration step (§38.6.2). `app_database.g.dart` was not regenerated and does not appear in the diff.

This slice **does not change the server contract**: no `schema.prisma`, no OpenAPI, no generated TypeScript. `npm run contracts:check` prints "contracts are in sync". The `gate:migrations` (G-6) job is green with three migration paths in history, none rewritten.

**The one tool change** is in `tool/ci/offline-guards.mjs` (stage 24): a narrow, declared exemption for exactly `lib/core/offline/grace/offline_grace_store.dart`. Stage 24 keeps local database writes out of `lib/core/offline/` except through the single remote-apply door, because §38.12.1's loop threat is a write made *in response to a remote change*. The grace store writes only device-local session state (the signed record, the clock high-water, the tamper flag), never remote-origin data and never an enqueued mutation, and it is the only writer of that state. The exemption is one named file, not a directory, so every other file under `grace/` is still held to the single-door rule, and the gate reports the same "offline module present" result it did for S7.

### 3.6 Remote CI

All runs on the implementation head `556abd29` (G-4 exact-SHA discipline; no earlier run is offered as a substitute).

| Run         | Event        | SHA       | Result  | Jobs                                          |
| ----------- | ------------ | --------- | ------- | --------------------------------------------- |
| 38561430784 | push         | `556abd29` | success | all 7 required checks green                   |
| 38561634019 | pull_request | `556abd29` | success | all 7 required checks green                   |

The seven required checks: `fast-checks`, `backend-unit`, `backend-integration-database`, `contract-drift`, `dependency-audit`, `flutter-build-windows`, `flutter-build-android`. On **both** events all seven are green on `556abd29`, including `fast-checks` (which runs this slice's Dart on the pinned SDK: `flutter analyze` and the **167-passing** `flutter test`), `backend-integration-database` (real PostgreSQL 18, unaffected by this client-only slice), and `flutter-build-windows`/`flutter-build-android` (which compile the new `lib/core/offline/grace` module into release artifacts).

The record commit that follows the implementation head is documentation-only; its head is verified green as well and reported with this slice.

### 3.7 PR

PR #14, head `codex/my-shop-m1b-s8-offline-auth-grace`, base `codex/my-shop-m1b-s7-loop-prevention` (stacked on the unmerged M1b-S7 branch, PR #13, itself stacked on the M1b-S6 PR #12 → M1b-S5 PR #11 → M1b-S4 PR #9). Open, not merged. `origin/main` untouched; PRs #1–#13 untouched.

### 3.8 Offline/idempotency threat-model walk (gate G-13)

§13.7 walked for this slice — offline authorization and the clock/revocation threats (R-14, R-15, F-21):

| Threat row                                            | What this slice does / does not do                                                                                                                                          |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Offline credential used indefinitely                  | The session is bounded by the server-issued window; at expiry mutations are refused, reads and committed sales continue (§38.16.2, AC-3/AC-4)                                |
| Forged or copied grace record                         | The signature is verified locally before use, and device + organization binding is re-checked on every admission; a record from another device/org fails `bindingMismatch` (§38.16.3, §10.3.1) |
| Tampered signature payload                            | `signedPayload` covers every signed field in a deterministic order; `signature` is excluded and carried separately. The test re-signs a mutated field and observes refusal (§3.4) |
| Clock rewound to re-open an expired window            | The persisted high-water clamps the effective time; a rewound clock never regresses effective time, across a restart (AC-5)                                                  |
| Clock jumped forward to extend/expire the window      | A jump beyond the stated tolerance is detected in-process, refused, and flags online re-validation; the flag is sticky until a fresh establishment (AC-6)                     |
| Clock jumped while the process is stopped             | **Not detectable by any client-local guard** — stated as a residual risk bounded by the grace window; the window, not detection, is what closes (AC-10)                      |
| Entitlement expiry missed because the device is offline | An entitlement expiry is mapped onto the device timeline and closes the device read-only first; an expired entitlement cannot be extended offline (§38.16.5, AC-8)            |
| Revocation (user/device/permissions) while offline    | **Cannot be known** until reconnect; bounded by the window (R-14, R-15). S8 does not claim instant revocation; a fresh online session replaces the snapshot (§38.16.4, §38.17) |
| A refused mutation leaving partial state              | The gate is consulted before validation and before any write; a refusal leaves no business record, no audit row, no allocated sequence (T-O17, AC-3)                          |
| The new gate shadowing the loop invariant             | The remote-apply suppression is the **first** check; the gate runs after it, so §38.12.1 is never bypassed (AC-9)                                                            |
| Offline permission widening                           | The snapshot stores whatever the server signed, never widened locally; an offline snapshot can never grant an owner-exclusive permission (the server never issues one) (§38.17) |
| Session state leaking across devices                  | The session is keyed to the device/org binding and fails closed on mismatch; it lives in the device-local database (§38.16.2)                                                |

**What this slice does not do:** it does not fetch a page, own the pull cursor, detect network state, emit a server-side security event, or ship the concrete signature verifier — those are the connectivity, observability, and M2 identity slices (§2.2). It defines the bounded offline session and enforces it at the mutation boundary.

---

## 4. Decisions, scope difference, gates

### 4.1 Decisions

| #    | Decision                                                                                          | Reason                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| D-1  | The offline session lives in the existing `local_meta` table; **no schema change, no migration**   | §38.6.2 asks for a change only when required; §39.6 names `local_meta` as the home of the device identity and time anchor            |
| D-2  | Signature verification is a **port with no accepting default**                                      | A permissive fallback would make §38.16.3's "validated locally" a comment rather than a control; the concrete verifier is M2-S3      |
| D-3  | Expiry uses the **window length** (`expiresAt - issuedAt`) mapped onto the device establishment     | Server time and device time are different clocks; only the difference is offset-invariant (§38.16.5)                                 |
| D-4  | Binding is re-checked on **every** admission, not only at establishment                             | A database edited or copied under a running process must fail at the next attempt (§38.16.2, §10.3.1)                                |
| D-5  | The forward rule corroborates with an **in-process monotonic source**, and states the residual      | The server signed time anchor is M2; a jump while stopped is not locally observable, so it is declared, not faked (§38.16.5, F-21)   |
| D-6  | Backward tampering is handled by a **persisted high-water**, not by detection/rejection alone       | §38.16.5's backward rule is about not re-opening a window or re-issuing receipts, which clamping achieves durably                     |
| D-7  | The outbox gate is **optional** (`authGate`), defaulting to `null`                                   | Every pre-S8 caller keeps its exact behaviour; the wiring is the app-composition slice's, as with S5–S7                              |
| D-8  | The gate is consulted **after** the S7 suppression check and **before** validation                   | The loop invariant is structural and must not be shadowed; the policy check precedes any write (AC-9, T-O17)                          |
| D-9  | The gate is **async**; the suppression stays synchronous                                             | A future gate that reads disk/network needs a `Future`; the structural check must stay unconditional and unavoidable                 |
| D-10 | A refused mutation leaves **no sequence** allocated                                                  | The gate runs before the transactional write, so refusal is total — no partial state (T-O17)                                          |
| D-11 | A **durable local tamper count** is kept, mirroring to a `security_event` deferred to S10            | §38.16.5 asks for the event to be recorded; the formal observability channel is M1b-S10 (§38.28), and the count keeps it from being lost |
| D-12 | One **declared stage-24 exemption** for the grace store, not a directory                             | The store is the only writer of device-local session state and never writes remote-origin data; a named file keeps every other `grace/` file under the single-door rule |
| D-13 | `sync_transport_deferred_test.dart` comment updated to name the connectivity slice                   | §40.5 assigns M1b-S8 to offline auth grace; the old "S8/S9" note would mis-map the deferral                                         |

### 4.2 Scope-difference report

Three differences are named rather than silently crossed:

1. **S7's record forecast "M1b-S8 = connectivity/`DEFERRED` client transport".** The Master Plan's §40.5 row is the authority for a slice's mandate, and it assigns **Offline auth grace** to M1b-S8 and the **connectivity monitor and backoff scheduler** to M1b-S9; the HTTP pull transport and cursor resume sit with the connectivity slice, not with auth grace. S8 therefore delivers the bounded offline session and leaves transport/resume deferred with its deferral annotated (§3.1, D-13).
2. **§38.16.5's "signed time anchor" is not available at M1b.** The plan's forward-clock rule is anchored to a server-signed anchor issued on every sync; the identity/entitlement slices that issue it are M2. S8 implements the forward rule with an in-process monotonic corroboration and states the residual (a jump while stopped) rather than inventing an anchor (§3.3, AC-10).
3. **No conflict table and no business entity.** As in S6/S7, the §40.5 M1b-S8 column set does not include `sync_conflicts` or business tables; S8 adds neither.

### 4.3 Gates G-1…G-13

| Gate | Condition                                                             | Result                                                                                                                                    |
| ---- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| G-1  | no business table outside the plan's data domain map                   | PASS - no table created at all; the session is `local_meta` key/value state (§3.5)                                                        |
| G-2  | contract files updated from the declaration and drift-clean            | PASS - no contract change; `contracts:check` in sync (§3.5)                                                                                |
| G-3  | schema/migration unchanged (no server migration this slice)            | PASS - no `schema.prisma`/server migration edit; the local Drift schema is unchanged at v3 (ADR-036); `migration-immutability` green      |
| G-4  | all CI stages pass; no history rewrite                                 | PASS - all 7 checks green on `556abd29` for both events (§3.6); ordinary commits, no force push, no rebase                                |
| G-5  | no file outside `allowed_paths` modified                               | PASS - the slice diff is confined to §2.3                                                                                                  |
| G-6  | `non_scope` verifiably untouched                                       | PASS - no transport/resume, no connectivity monitor, no observability plumbing, no business module, no plan/CI-workflow/server edit (§2.2) |
| G-7  | migration impact as declared; migrations immutable; drift non-vacuous  | PASS - **no** local migration this slice (§3.5); no server migration; `migration-immutability` green                                       |
| G-8  | security impact as declared                                            | PASS - this slice *is* offline authorization; it adds no route, permission, or tenant path, refuses rather than widens, and the residual risks are declared (§3.8) |
| G-9  | migration audit: no `GRANT ALL`, no interpolation                      | PASS - no migration at all (§3.5)                                                                                                          |
| G-10 | rollback defined and feasible                                          | PASS - drop the branch and PR #14; `main` untouched; the change is client-local and additive                                               |
| G-11 | documentation updated                                                  | PASS - this record; the Dart deferral comment updated; the offline-gate doc comment updated; no decision changed the master plan             |
| G-12 | owner authorized the merge                                             | NOT SATISFIED for PR #14 - no merge performed, by design (left open)                                                                        |
| G-13 | offline path: threat model walked and tests                           | PASS - offline authorization and clock/revocation threats walked; §3.8                                                                      |

---

## 5. Deviations

- **One tool file changed (`tool/ci/offline-guards.mjs`) with a narrow, declared exemption.** This is the only way the grace store can persist session state without opening a directory. The exemption is one named file, its reason is inline, and the gate's stage-23/24 logic is otherwise unchanged (§3.5). If the owner prefers a different home for this state, the exemption disappears with the store.
- **The S7 record's §6 forecast lumped M1b-S8 with client transport.** Named and resolved in §4.2 by the plan's §40.5 row; S8 delivers offline auth grace, and the transport/resume deferral is annotated rather than dropped.
- **The signed time anchor and the concrete verifier are deferred, not implemented.** Both belong to M2 (identity/entitlement, M2-S3). S8 ships the ports and the in-process forward corroboration with the residual stated (§3.3, AC-10).
- **No repair commit, no history operation.** This branch was created by ordinary commits from `5a2f397`; nothing was force-pushed, reset, or rebased.

---

## 6. Boundary

The next slice is **M1b-S9** (connectivity monitor and backoff scheduler per §40.5, which owns online/offline detection and the retry ladder). It is **NOT AUTHORIZED** by this record. The HTTP pull transport and cursor resume remain with the connectivity slice; own-echo reconciliation and full entity retrieval remain later concerns. Business modules remain unauthorized.

```
M1b-S9 NOT AUTHORIZED
PASS_MY_SHOP_M1B_S8_OFFLINE_AUTH_GRACE_REMOTE_LOCKED
```
