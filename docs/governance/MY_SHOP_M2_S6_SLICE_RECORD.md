# MY SHOP M2-S6 - Slice Record (declaration)

Status: **declared, implementation in progress.** Evidence sections are filled at the end of
the slice; the declaration below is committed before any substantial implementation change
(§43.1 G-1/G-2 discipline).

## 1. Objective

Establish the two durable, tenant-safe, append-only audit streams of Master Plan §32 -
`audit_events` (business history) and `security_events` (security history) - plus the
offline/synchronization event families of §32.2A, replacing the M2-S2/M2-S5 temporary
logging-only `SecurityEventSink` with durable persistence, per-organization (and global
scope) monotonic ordering, and an executable ordering-tamper verifier.

Governing key acceptance (§40.6 row M2-S6): **tampering with event ordering is detectable.**

## 2. Predecessor and base

| Item | Value |
| --- | --- |
| Predecessor slice | M2-S5 device binding |
| Predecessor branch | `codex/my-shop-m2-s5-device-binding` |
| Predecessor HEAD (verified: local == origin/…) | `bf7663880a047c15e8107ac020e3b28785da219b` |
| Predecessor PR | #21 (OPEN, base `codex/my-shop-m2-s4-tenancy-rls`, head `bf76638…`, verified via GitHub API) |
| This slice's branch | `codex/my-shop-m2-s6-audit-streams` (created from the verified M2-S5 head) |
| This PR's base | `codex/my-shop-m2-s5-device-binding` (stacked; never merged by this slice) |

## 3. Architecture assessment (state at declaration)

- M2-S2/M2-S5 emit security events through `SecurityEventSink.record(event): void`
  (`security-event.sink.ts`), served today by `LoggingSecurityEventSink` (a structured,
  `logPayload`-allowlisted log line that never throws). Consumers:
  `AuthService` (login/refresh/logout/authenticate), `AuthorizationGuard`
  (organization/permission refusals), `DeviceService` (register/refusals/bind/refuse/revoke).
- Sync security logging is *not yet* on the sink: `SyncPushService` and
  `MutationLedgerService` log structured `securityEvent:` lines at the device/organization
  mismatch and idempotency-contradiction sites, explicitly deferring durable persistence
  to M2-S6.
- All durable writes in this codebase run inside `withTenantTransaction` /
  `withIdentityTransaction` (transaction-local trusted GUCs: `app.current_organization_id`,
  `app.current_user_id`, `app.current_bootstrap_key`), with forced RLS on every tenant-owned
  table via the one `tenant_isolation` policy (migration 0008, extended by 0009).
- Sequence precedent: `sync_sequences` rows allocated by
  `INSERT … ON CONFLICT (organization_id) DO UPDATE … RETURNING` (`sync_sequences`
  pattern; gaps expected and harmless for the change feed).
- Roles: `my_shop_migrator` (DDL/DML) and `my_shop_app` (DML). Default privileges grant
  the application role `SELECT, INSERT, UPDATE, DELETE` on all tables in the schema
  (`prisma/roles.sql`), which §32.5 forbids for the audit streams; the migration must
  therefore shape the effective grants explicitly (documented as point 7).
- Prisma models in `schema.prisma` are the typed surface every migration declares; the
  migration file carries the RLS/grant/constraint posture that Prisma cannot express.

## 4. Included scope

1. Migration `0010_audit_streams`: `audit_events`, `security_events`,
   `audit_stream_heads` (forward-only; tables, closed-vocabulary CHECKs, chain hash
   metadata, forced RLS, explicit grants matching §32.5).
2. Prisma schema models for the three tables.
3. A new `common/audit` domain: event contracts (closed vocabularies), canonical payload
   serialization, sequence + hash-chain allocation and append, an integrity verifier,
   a transactional audit writer (class A), and a durable security-event sink (class B)
   that keeps the existing `SecurityEventSink` port shape.
4. Integration of durable events at every **existing** execution path that emits or
   logs security/audit facts: identity (login/throttle/refresh/logout/token
   rejections/stale), authorization guard refusals, device
   register/refuse/bind/refuse/revoke, sync push identity assertions, ledger
   acceptance/rejection/replay/contradiction.
5. Audit stream emitting for the §32.2A server-side sync events whose paths exist:
   sync accepted, sync rejected (business / authorization), retry after a stored
   rejection, idempotency contradiction (audit row + the §38.27 security event).
6. `audit_events` business-audit row for device revocation (§32.2 "Device revoked")
   written atomically in the revocation transaction.
7. Authorized read surface for the business audit (`audit.view` permission exists in
   the §11.2 catalog), plus an owner-only service-level capability for security events
   (no HTTP route for security rows in this slice - documented deferral, point 18).
8. Unit, integration, and real-PostgreSQL database acceptance tests (RLS, grants,
   ordering concurrency, tamper detection, rollback behaviour, redaction).
9. Documentation: security architecture, RLS inventory, this record's final evidence.

## 5. Explicit non-scope

- No business actions (§32.2 price/discount/sale/purchase/finance events) - the M2-S6
  non-scope line in §40.6 and §2.4 anti-scope apply. Business modules receive only the
  ready transactional writer contract; **no** business transaction is invented.
- §32.2A *locally generated* offline events (offline sale/void/return/collection/stock
  events, cached-policy/grace-window local events) are client-side facts of the M5-M8
  device features; this slice delivers the server contract and writer, not the
  producers. No event is reported as implemented end-to-end until its producing path
  exists.
- §32.3 events with no execution path yet (password change/reset, permission-escalation
  ceremony, organization switch, cache-policy tampering): vocabulary reserved, no
  fabricated emission.
- The §38.30.2 controlled-repair security event (owner-permissioned wipe) - no repair
  tool exists.
- Security-event read API (HTTP): no owner console exists; service capability only.
- Archive/retention enforcement for the ≥400-day security window: §7.4 forbids a V1
  background worker; no purge/anonymization job lands here. Retention is recorded as a
  documented operator obligation with an explicit extension point (point 18).
- Merge (G-12: owner authorization), deployment, CI workflow changes, PR #21 changes.
- Bootstrap-time owner provisioning audit rows: the bootstrap composition predates a
  tenant scope the Audit event vocabularies assume; deferred to the slice that owns a
  human-owned user lifecycle (recorded below as a ready contract only).

## 6. Proposed paths and justified cross-module changes

New: `services/api/prisma/migrations/0010_audit_streams/`, `src/common/audit/**`,
`test/database/audit-streams.db-spec.ts`, integration/unit suites, docs.

Modified (reasons on file in each commit):

- `prisma/schema.prisma` - the three table models (single source of truth for typed access).
- `src/common/identity/security-event.sink.ts`, `identity.module.ts` - rebind the
  `SECURITY_EVENT_SINK` port from the logging sink to the durable sink (the exact one
  binding change M2-S2 reserved for M2-S6), plus the `LOGIN_THROTTLED` emission the
  vocabulary already names but no site emitted.
- `src/common/identity/auth.service.ts` - class-B emission points stay at their existing
  post-decision positions; establish user context only, no tenant assumption for identity
  events.
- `src/common/devices/device.service.ts` + `device.module.ts` - class-A in-transaction
  rows (registered/revoked), post-rollback refusal rows (class B), and the §32.2
  device-revoked business audit row.
- `src/common/authorization/authorization.guard.ts` - refusal rows via the same sink port
  (no behavioural change beyond durability).
- `src/common/sync/ledger/mutation-ledger.service.ts` (+ module) - class-A rows for
  accepted/rejected/replay/retry/contradiction, passing the rejection classification into
  the durable rows.
- `src/common/sync/push/*` (+ module) - durable rows replacing the temporary
  `securityEvent:` warn logs and contradiction handling.
- `src/common/app.module.ts` - registers the new audit module (controller only).
- `test/database/tenant-rls.db-spec.ts`, `test/database/postgres.db-spec.ts` - the
  machine-enforced table inventories grow by the three new tables.
- `packages/contracts/**` - regenerated contract artifacts for the audit read route.
- `docs/**` - point 21 obligations.

The `common/architecture/import-boundary.spec.ts` gains one rule: `audit` is a leaf
context (may not import identity/tenancy/devices/sync/bootstrap/authorization).

## 7. Database migration impact

`0010_audit_streams` (next in sequence; `0001`–`0009` untouched):

- `audit_events (organization_id, sequence)` PK; per-organization gapless-committed
  ordering; `event_hash`, `prev_event_hash` (SHA-256 hex, CHECK-formed); server
  `occurred_at`; `local_occurred_at`; closed-grammar `event_type`; actor attribution
  (`actor_kind` ∈ USER/DEVICE/SYSTEM + conditional `actor_user_id`/`actor_device_id`/
  `actor_principal` CHECK-consistent); target type/id; `document_ref`, `mutation_id`,
  `device_local_sequence`; allow-listed `payload` JSONB; read indexes; partial unique
  index guaranteeing one canonical `SYNC_MUTATION_ACCEPTED` row per
  `(organization_id, mutation_id)`.
- `security_events (id uuid) PK`, `partition_kind` ∈ TENANT/GLOBAL with the
  tenant/global consistency CHECK, `sequence` per scope, unique
  `((coalesce(organization_id, nil), sequence))`, chain hashes, `event_type`,
  actor fields incl. UNVERIFIED attempts (`claimed_email`/`attempted user id` are
  recorded as *claims*, labelled by `actor_kind`), server-resolved `device_id`,
  `reason_code`, bounded `client_address`, allow-listed payload.
- `audit_stream_heads (stream, scope)`: per-stream/per-scope allocation head
  (`last_sequence`, `last_event_hash`); `scope` = organization id or the documented
  global sentinel (`00000000-0000-0000-0000-000000000000` for the global security
  partition); CHECK forbidding a nil scope on the AUDIT stream.
- RLS: audit_events/security_events/audit_stream_heads `ENABLE` + `FORCE` row-level
  security, `tenant_isolation` policy shape; `security_events` additionally admits its
  GLOBAL partition rows (`organization_id IS NULL` predicate) - the deliberate,
  documented exception (point 9) - and the head table admits the sentinel scope.
- **Effective grants (§32.5):** the migration performs an explicit
  `REVOKE UPDATE, DELETE … FROM my_shop_app` on the three tables. This is the one
  place a grant-shaped statement is needed; the `roles.sql` default privileges would
  otherwise grant the application role full DML on every new table. §32.5 requires
  INSERT + SELECT and nothing else on the streams; the G-9 gate's actual checks
  (no `GRANT ALL`, no `search_path` pinning, no interpolation) remain honoured, and
  the deviation is recorded here rather than silently inheriting a violating default.
- Migration immutability: file is append-only history; verified by `gate:migrations`
  and the fresh-migration database suite.

## 8. Security threat model (tested forms)

Cross-org read/insert (RLS, tested); spoofed organizationId/body tenant naming
(trusted-context re-derivation, unchanged); spoofed actor ids (attribution from verified
principal or trusted context only); unverified pre-authentication context (GLOBAL
partition, labelled claims); unauthorized UPDATE/DELETE (grant revocation verified
against PostgreSQL, not assumed); ordering manipulation (structural impossibility for
non-superuser writers + verifier detection); concurrent allocation (per-scope
serialization, concurrency test); replay-derived duplication (ledger idempotency
unchanged + audit canonical-acceptance uniqueness); suppression after protected changes
(class A rows commit in the protected transaction); post-rejection event loss (class B
writes after the rejected transaction, in their own short transaction); secret leakage
(allow-listed payload schemas, proof tests); device revocation with pending mutations
(quarantine semantics preserved, events record only verified facts); offline
misattribution (mutation attribution travels from device facts - ledger row unchanged;
audit rows copy the ledger's attribution, never the transport actor); unauthorized
security-event reads (no route; service owner-only, tested); retry-storm amplification
(audit writes bounded by the mutation ledger's one-row-per-mutation regime);
PostgreSQL unavailability (class B failures logged, decisions unaffected - documented).

Honest boundary: an event hash is computed by the application; a **superuser** DB
principal can rewrite the table and recompute a whole chain. The mechanism detects all
supported forms of tampering by principals whose privileges the database lawfully
constrains (the application role, and any principal without UPDATE/DELETE/superuser).
This limitation is documented; §32.5's guarantee is delivered exactly as written.

## 9. Pre-authentication / global security events

Failed logins, throttling, and unknown refresh events occur before any trustworthy
organization identity exists, and a login attempt names an *identity*, not a tenant.
Manufacturing `organization_id` from an unverified email would silently fabricate tenant
attribution. Decision: `security_events` carries a deliberate GLOBAL partition
(`organization_id IS NULL`, nil-scope head row) for per-identity security telemetry, the
same classification family the five intentionally global identity tables use (login,
session, throttle state are per-identity, never per-tenant - migration 0008). Global
rows are visible to any application-role connection and to every verified tenant
transaction, carry no tenant facts, and never substitute for tenant-owned rows; tenant
rows remain fully fail-closed under the existing policy shape. Identity attempts are
recorded with an explicit `actor_kind`, so "verified user", "attempted identity"
(existing account the attempt was aimed at), "claimed address", "system", and
"transport" are distinguishable and no NULL-means-nobody exists (§32.6).

## 10. Audit event taxonomy (closed vocabularies, versioned in code)

Security (`security_events`): `LOGIN_SUCCEEDED`, `LOGIN_FAILED`, `LOGIN_THROTTLED`,
`REFRESH_ROTATED`, `REFRESH_REUSE_DETECTED`, `LOGOUT`, `ACCESS_TOKEN_REJECTED`,
`ACCESS_TOKEN_STALE`, `DEVICE_REGISTERED`, `DEVICE_REGISTRATION_REFUSED`,
`DEVICE_REVOKED`, `SYNC_IDENTITY_MISMATCH`, `SYNC_MUTATION_CONTRADICTION`. Grammar is
CHECK-enforced in the database; the TS union is the versioned authoritative vocabulary
(§11.2 pattern: catalog in code, shape in database).

Business/offline (`audit_events`, server paths implemented in this slice):
`SYNC_MUTATION_ACCEPTED`, `SYNC_MUTATION_REJECTED` (rejection classification
`INGRESS`/`BUSINESS` in payload), `SYNC_MUTATION_RETRY`, `SYNC_MUTATION_CONTRADICTION`,
`DEVICE_REVOKED` (§32.2). Reserved, contract-ready, unimplemented (no producing path):
all remaining §32.2 rows and the §32.2A *local* half. Each payload type is an explicit
allow-listed shape; nothing arbitrary is accepted.

## 11. Transaction and concurrency strategy

- Class A (atomic with the protected effect): rows written inside the caller's
  transaction through the transactional writer. Registration, revocation, ledger
  acceptance/rejection/canonical rows. Failure of the audit write rolls the protected
  change back (fail-closed against unaudited effects).
- Class B (after-the-rejection durability): rows written by the durable sink in a short
  dedicated transaction (tenant-context or global) after the protected decision is
  already committed or rejected; never throws into the caller; persistence failures are
  logged (the Pino line always accompanies the attempt, so the forensic record degrades
  to the log rather than to silence).
- Allocation: per `(stream, scope)`, a transaction-scoped advisory lock
  (`pg_advisory_xact_lock(hashtextextended('audit-stream:<stream>:<scope>', 0))`) +
  head-row lock. The head stores the last **committed** sequence and chain hash, so a
  rolled-back allocation leaves no gap (safe `MAX+1` discipline via the locked head row,
  not an unsafe free `MAX(sequence)` read).

## 12. Tenant isolation strategy

All three tables are tenant-owned except the documented GLOBAL `security_events`
partition (point 9) and the head row it uses. Policies mirror 0008's shape with
`NULLIF(current_setting('app.current_organization_id', true), '')::uuid`; client input
cannot override trusted context (attribution inputs are server facts only). The
database suites extend the M2-S4 cross-tenant matrix to the new tables.

## 13. Actor attribution strategy

Every row carries `actor_kind` plus the conditional attribution columns: USER (verified
principal or ledger/documentary actor), DEVICE/transport (device events carry the
server-resolved device; sync rows carry the ledger's device id), SYSTEM (documented
principal string), UNVERIFIED (pre-authentication attempts; attempted email/claimed
account recorded as claims, labelled). The ledger's stored mutation facts (device,
payload actor claims, `actor_role_snapshot` hash input) are copied into §32.2A rows as
**facts of the mutation record**, never re-derived from the pushing session.

## 14. Append-only / integrity strategy

Per scope: gapless-committed sequence + SHA-256 chain (`prev_event_hash` = previous
row's `event_hash`; genesis documented 64-zero hash). Row hash covers the canonical
whole-row invariant fields via sorted-key canonical serialization. Verifier checks
(never writes): sequence continuity (first = 1, then +1 per committed row, with gaps
strongly indicating deletion because rollback cannot produce one), head/chain agreement,
hash-chain linkage, and per-row recomputation. Detection proven under controlled
tampering with the admin test connection only; the application role's tested inability
to UPDATE/DELETE is the mechanism's real boundary.

## 15. Local/offline compatibility strategy

The offline local schema and the Drift client are untouched; the server contract for
§32.2A local events is reserved in code without a wire change. Push/pull, idempotency,
loop prevention, cursors, and the fail-closed applier keep their M1b/M2-S4/M2-S5
behaviour; audit rows are additive within existing transactions (no new round-trips,
no new client-facing states).

## 16. Acceptance criteria

AC-01..AC-20 as fixed in the master execution prompt (§22), each mapped to concrete
test cases in `test/database/audit-streams.db-spec.ts`, integration suites, unit suites,
and the final evidence block of this record. AC-15 regression = full `npm run verify:node`
+ database suite; AC-18 = CI on the exact final SHA for `push` and `pull_request`.

## 17. Required verification

`toolchain:verify`, all nine `gate:*` jobs, `format:check`, `lint`, `typecheck`,
`contracts:generate --check`, backend unit, backend integration (real HTTP +
PostgreSQL), database acceptance (real PostgreSQL 18), and remote CI (`push` +
`pull_request`) on the exact final SHA.

## 18. Forward recovery strategy

Rollback of this slice = a new forward migration dropping the additive tables after
consumers are reverted; no historical migration is touched, no business data exists in
the streams yet, and the default-privilege grant posture can be restored by
re-executing the `roles.sql` default-privilege statements for the three tables.

## 19. Known residual risks

1. Class B rows (post-rejection security rows) have a documented, sub-process-crash
   persistence window; the always-emitted Pino line is the durable fallback.
2. Privileged (superuser/owner-excluded) principals outside the database can rewrite
   history; §32.5 is delivered within PostgreSQL's privilege resolution, stated plainly.
3. Security-event retention/archival is an operator obligation until a governed archive
   slice exists (no background worker in V1).
4. Global security rows are visible to any tenant's owner by design (they carry no
   tenant facts); access is owner-only at the application layer.
5. Bootstrap-time owner provisioning is not yet audited (deferred, point 5/18).

## Final evidence (filled at slice completion)

- Backend unit: _pending_ / Backend integration: _pending_ / Database: _pending_
- Typecheck/Lint/Format/Contract drift: _pending_
- Push CI: _pending_ / PR CI: _pending_ (exact final SHA)
- Commit SHA / PR head / PR base: _pending_
