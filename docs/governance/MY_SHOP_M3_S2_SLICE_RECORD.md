# MY SHOP M3-S2 - Slice Record (declaration)

Status: **declared** (§43.1 G-1/G-2: this record precedes any feature file touch; the
evidence section is filled when the slice's gauntlet is complete).

## 1. Objective

Deliver the Master Plan §40.7 row M3-S2: **pricing mode enforcement — all three
modes (`FIXED`, `VARIABLE`, `FIXED_WITH_DISCOUNT`), enforced server-side — with the
enforcement point transactional, authorization-consistent, and offline-reconcilable.**

Governing key acceptance (§40.7): **FIXED mode rejects an unauthorized override.**

### 1.1 Authoritative requirements

| Source | What it fixes for this slice |
| --- | --- |
| §17.1 | `FIXED`: the stored selling price is authoritative; the server rejects any `unitPriceApplied` differing from `unitPriceList` when the actor lacks `pricing.override`, returning `403 PRICE_OVERRIDE_FORBIDDEN` |
| §17.2 | `VARIABLE`: any user holding `sales.create` may enter a price; `unitPriceList` still snapshots the product price and `unitPriceApplied` records what was charged (§16.2 — two distinct values, never one overwritten field); selling below cost is permitted but **flagged** |
| §17.3 | `FIXED_WITH_DISCOUNT`: the base price stays fixed; the applied price is derived from the discount (§18); a user without discount authority cannot reduce the effective price at all — and in this slice (non-scope: discounts) no manual reduction path exists at all, for any actor |
| §17.4 | The server **recomputes and validates** the effective price from the stored product price, the pricing mode, and the actor's permissions; the client's computed price is an untrusted hint and is never the basis of a financial value |
| §22.2/§22.3 | `pricing_mode` is an organization-scoped typed setting changed under `pricing.policy.edit`; the server reads settings **from the database on every transaction that depends on them** — never a cache; a change takes effect on the next transaction and is audited with actor, old value, new value |
| §38.19 | Two enforcement points, one rule set: the device enforces from its signed, versioned cached settings; the server **re-validates on sync against the then-current policy**; a line the current policy would refuse is **accepted and flagged `PRICING_POLICY_DRIFT`** — never refused (a completed physical sale must never block), never silently voided; a forged override is caught server-side |
| §30.1 / ADR-016 | Money is integer **minor units (bigint)** end to end; never a float, never a JSON number |
| §16.2 | The line snapshot carries list and applied as two recorded values; history never follows current prices |
| §11.2/§11.4 | Permissions resolved from the actor's **effective** set (role grants + owner structure + overrides), read inside the deciding transaction |
| §8.2/§9.3 | Every decision runs inside the trusted tenant transaction with a **server-derived** organization id; a request body never names a tenant; forced RLS refuses a foreign read before a policy can be applied |
| §2.4/§40.1 | Anti-scope rule: the plan's inventory defines no setting that makes below-cost *selling* refuse (the only below-cost refuser is `block_discount_below_cost`, §18.4 — the M3-S3 discount boundary), so none is invented here |

## 2. Predecessor and base

| Item | Value |
| --- | --- |
| Predecessor slice | M3-S1 typed organization settings (accepted `PASS_MY_SHOP_M3_S1_TYPED_SETTINGS_REMOTE_LOCKED`) |
| Predecessor branch | `codex/my-shop-m3-s1-typed-organization-settings` |
| Predecessor HEAD verifies as | `d64db8f7` (local == remote == origin; push run and PR run both green on that SHA per the M3-S1 record's remote lock) |
| Predecessor PR | #25 (OPEN, base `codex/my-shop-m2-s7-flutter-auth-session`) |
| This slice's branch | `codex/my-shop-m3-s2-pricing-mode-enforcement` (created from the verified M3-S1 head; no rewrite of any accepted history) |
| This PR's base | `codex/my-shop-m3-s1-typed-organization-settings` (stacked; never merged by this slice) |

M2-S8 is a governance proposal (PR #24), not an implementation base; the M3-S1
record already states that explicitly and this slice inherits it.

## 3. Architecture assessment (state at declaration)

The backend has: the M3-S1 typed `organization_settings` row (migration `0012`,
versioned, audited, field-authorized), the M2-S4 effective-permission resolver with
its in-transaction read seam (`readEffectiveInTransaction`), the forced-RLS tenant
posture, and the class-A audit writer. The permission catalog already carries
`pricing.override` and `sales.create` (§11.2) with no consumer yet.

There is **no** pricing surface: no pricing module, no domain, no decision type.
No existing endpoint evaluates a pricing policy, and no sale tables exist yet —
M4 owns the catalog (the stored product price) and M5 owns the sale posting that
will call this boundary. The settings service exposes only its standalone
tenant-transaction read (`get`); nothing reads settings **inside a caller's
already-open transaction**, which §22.3's "on every transaction that depends on
them" requires for any consumer that itself runs inside one.

## 4. Included scope

1. **The pricing contract** (`common/pricing/pricing.contract.ts`): the closed
   mode vocabulary single-sourced from the §22.2 settings inventory, the closed
   flag vocabulary (`BELOW_COST`, `PRICING_POLICY_DRIFT`), the line offer shape
   with **bigint minor units**, and a versioned contract
   (`PRICING_POLICY_CONTRACT_VERSION`) so a recorded decision is never silently
   reinterpreted (§38.19's "versioned, deterministic contract").
2. **The pure pricing domain** (`pricing.domain.ts`): no I/O, no framework, no
   clock — one deterministic classifier per mode shared by both entry points:
   - structural validation first (§30.1): negative applied money →
     `VALIDATION_FAILED` (client fault); negative stored list price or negative
     snapshotted cost → `INTERNAL_ERROR` (server corruption) — three distinct
     refusals for three distinct fault owners;
   - `FIXED` (§17.1): any applied≠list alteration without `pricing.override` →
     `403 PRICE_OVERRIDE_FORBIDDEN`, in both directions;
   - `VARIABLE` (§17.2): entering an applied price requires `sales.create`
     (`403 PERMISSION_DENIED` without it); list and applied stay distinct;
     applied < known cost flags `BELOW_COST` (warn-only; no refusing setting
     exists — anti-scope);
   - `FIXED_WITH_DISCOUNT` (§17.3): a reduction below the list price is refused
     to **every** actor in this slice (the reduction path is the §18 discount
     machinery, M3-S3 — a manual cut here would silently implement M3-S3's
     ceiling bypass); an increase requires `pricing.override`;
   - below-cost comparison is strict (applied < cost), only against a **known**
     cost, and never invents a flag from an absent or unknown cost;
   - offline reconciliation (§38.19): the shared classifier's refusal becomes the
     `PRICING_POLICY_DRIFT` flag — accepted, flagged, never refused for policy
     drift, never silently voided; structural corruption is still refused.
3. **The transactional service** (`pricing.service.ts`): `evaluateSaleLines…InTransaction`
   (online, §17.4 — throws so the caller's transaction rolls back before any line
   is written) and `reconcileOfflineSaleLinesInTransaction` (sync, §38.19 — never
   refuses for drift, reports the drift count). Both read the **live**
   `organization_settings` row and the actor's **effective** permissions inside
   the **caller's own transaction** (no second snapshot, no cache — §22.3), fail
   closed on an unknown stored mode (`INTERNAL_ERROR`), stamp every decision with
   the `settings_version` it decided under (§38.18's fingerprint), and answer a
   foreign actor with the same `ORGANIZATION_FORBIDDEN` refusal the guards answer
   with.
4. **The settings in-transaction read seam** (`SettingsService.readInTransaction`):
   the M3-S1 `get` read, materialized inside the caller's transaction — the same
   defaults rule (a row-less organization receives its version-1 defaults, never
   a missing answer) at the exact moment the decision needs it.
5. **Module wiring**: `common/pricing/pricing.module.ts` exporting the service for
   the future M5 sale entry points and the sync ingress, importing the settings
   and authorization modules — no new HTTP route (§40.7's M3-S2 row has no
   surface of its own; inventing a route with no sale domain behind it would be a
   placeholder success path).
6. **Tests** — the pure-domain acceptance matrix (no database, no framework, no
   clock) and the real-PostgreSQL acceptance suite proving: every mode's refusal
   and permission path, live policy reads and version stamping, the owner
   settings update racing an in-flight sale evaluation (seen at statement time,
   each decision stamped with its own enforced version), in-transaction
   permission overrides (allow → deny beats allow → remove), tenant isolation
   fail-closed, offline reconciliation drift flagging, and the M3-S1 regression
   (settings read parity, refused decisions leave settings/version/audit
   untouched).
7. **Documentation** — README surface note (the boundary and its invocation
   contract), this record's evidence section.

## 5. Explicit exclusions (non-scope, each with its governing reference)

- **Discounts** (§40.7 M3-S2 non-scope; §18; M3-S3): no discount types, ceilings,
  approval gate, or `block_discount_below_cost` enforcement. `FIXED_WITH_DISCOUNT`
  refuses manual reductions outright in this slice — the discount path arrives in
  M3-S3 and this refusal is its precondition, not a gap.
- **Sale tables and the posting route** (§16; M5): no sale line is written here,
  no `unit_price_*` columns arrive, no HTTP surface exists. The boundary's
  contract is what M5's entry points must invoke.
- **Catalog resolution** (M4): `unitPriceListMinor` and `unitCostAppliedMinor` are
  server-resolved facts by contract; no product table is read here.
- **Device-side enforcement and the offline settings cache** (§38.19 device half;
  M3-S4/M1b): the client cache and the device rule are later slices; this slice
  ships the server side and the versioned contract the cached copy must match.
- **Price lists** (§17.5): deferred; `unitPriceList` is the recorded extension
  point.
- **Audit rows in the boundary** (§32.5): the boundary decides and does not write;
  the sale's own class-A audit (M5) carries the snapshot the decision permitted,
  with its flags.
- **Flutter** (§40.7 M3-S4): zero client changes; the predecessor Flutter suite
  must remain green unchanged.

## 6. Security and regression invariants (inherited, must survive)

Tenant scope server-derived and forced-RLS-backed (a foreign-context read refuses
at the database); authorization resolved inside the deciding transaction from the
effective set, deny beats allow; no cache ever holds policy authority (§22.3);
fail closed on unknown stored mode and on structural corruption; no token or
credential material in any payload or log; the M3-S1 settings surface — its
version discipline, its audit atomicity, its route guards — unchanged; migrations
`0001`–`0012` byte-untouched (this slice adds none); the predecessor Flutter suite
(403 passed / 1 skipped) remains green with zero client changes.

## 7. Validation requirements (test matrix)

- **FIXED**: equal applied price accepted for an unauthorized actor; differing
  (up and down, and by one minor unit) refused `PRICE_OVERRIDE_FORBIDDEN` without
  `pricing.override`; the same alteration accepted with it; below-cost flagged
  under an authorized override.
- **VARIABLE**: any applied price accepted with `sales.create`; list/applied stay
  distinct; refused `PERMISSION_DENIED` without it (even for an equal price);
  below-cost flagged strictly (at-cost unflagged, one unit below flagged, unknown
  cost unflagged, zero cost unflagged, free line with real cost flagged).
- **FIXED_WITH_DISCOUNT**: reduction refused to every actor including the owner;
  increase refused without `pricing.override` and accepted with it; below-cost
  still flagged.
- **Structural**: negative applied → `VALIDATION_FAILED` naming the field;
  negative list/cost → `INTERNAL_ERROR`; corruption refused before policy logic in
  every mode; 18-digit money compared exactly; zero/zero is the legal degenerate
  line; an empty evaluation refused.
- **Live policy (§22.3)**: decision stamps the committed `settings_version`; a
  committed `pricing_mode` change takes effect on the next transaction; an owner
  update committed *between two pricing statements of one open transaction* is
  seen at the second statement, each result stamped with the version it enforced;
  the audit event rides the settings write transaction (M3-S1 regression).
- **Authorization (§11.4)**: an `ALLOW` override grants; `DENY` of the same id
  takes it back; removal refuses again; a foreign actor answers
  `ORGANIZATION_FORBIDDEN`.
- **Tenant isolation**: a decision scoped to a foreign organization id produces
  no outcome inside this tenant's transaction.
- **Offline reconciliation (§38.19)**: a refused-policy line accepted and flagged
  `PRICING_POLICY_DRIFT`, drift count reported, snapshots untouched; a permitted
  line silent; a forged override flagged; structural corruption still refused;
  determinism pinned by a shared-classifier test.
- **M3-S1 regression**: the in-transaction read answers exactly what the
  standalone read answers; a refused pricing decision leaves the settings row,
  its version, and the audit chain untouched.

## 8. CI requirements

Every existing required job must stay green on the final SHA: `fast-checks`,
`backend-unit`, `backend-integration-database` (real PostgreSQL 18),
`contract-drift`, `dependency-audit`, `flutter-build-windows`,
`flutter-build-android`. Push and pull-request events both recorded.

## 9. Completion criteria

The §40.7 row's acceptance ("FIXED mode rejects an unauthorized override") is
demonstrated by the suites above on the final implementation SHA, all gates
green, the PR created stacked on the M3-S1 base with no merge performed, and the
remote CI evidence recorded on the exact final SHA in this record's evidence
section.

## Final evidence (filled at slice completion)

(to be filled on completion)

## Remote lock (verified after the push)

(to be filled on completion)
