# MY SHOP M3-S3 - Slice Record (declaration)

Status: **declared** (§43.1 G-1/G-2: this record precedes any feature file touch; the
evidence section is filled when the slice's gauntlet is complete).

## 1. Objective

Deliver the Master Plan §40.7 row M3-S3: **discount policy — types, ceilings,
authority resolution, approval gate — enforced server-side inside the M3-S2
pricing boundary, transactional, authorization-consistent, and
offline-reconcilable.**

Governing key acceptance (§40.7): **a discount ceiling breach returns the
documented error** (`403 DISCOUNT_LIMIT_EXCEEDED`, §18.2).

### 1.1 Authoritative requirements

| Source | What it fixes for this slice |
| --- | --- |
| §18.1 | Three discount types, verbatim: `PERCENTAGE` (a `percentage` 0–100 applied to `unitPriceList`), `FIXED_AMOUNT` (an `amountMinor` subtracted from `unitPriceList`), `FIXED_PRICE` (the applied price is exactly `amountMinor`). Discounts are first-class, permission-controlled, fully snapshotted, and never applied by mutating a stored price. |
| §18.2 | The server-side resolution order is fixed: 1 load the organization discount policy, 2 resolve the actor's effective permissions, 3 ceiling breach → `403 DISCOUNT_LIMIT_EXCEEDED`, 4 beyond authority → `403 DISCOUNT_FORBIDDEN`, 5 above the approval threshold by a non-approver → `403 DISCOUNT_APPROVAL_REQUIRED` (rejection, never a silently pending sale), 6 compute `discountAmount` in minor units with explicit rounding, 7 the line snapshot carries `discountActorUserId` and `discountAuthorizationRef`. |
| §18.3 | `discountActorUserId` and `discountAuthorizationRef` are immutable line facts; an exception approval is an audited action by the approver. |
| §18.4 | `block_discount_below_cost` (default **false**) blocks discounts taking the applied price below `unitCostApplied`; when false the line is permitted and flagged for the gross-margin report. |
| §22.2/§22.3 | `max_discount_percentage` (decimal(5,2), default 0), `max_discount_amount_minor` (bigint, default 0), `discount_approval_threshold_minor` (bigint, nullable, default null), `discount_allowed_for_salesperson` (bool, default false), `block_discount_below_cost` (bool, default false), `pricing_mode` — all already typed columns of the M3-S1 `organization_settings` row, read live inside the deciding transaction, never cached as authority. |
| §17.1–§17.3 | The pricing modes are unchanged. The discount machinery is the derivation rule of `FIXED_WITH_DISCOUNT` ("the applied price is derived from the discount (§18)"); `FIXED` keeps the stored price authoritative and `VARIABLE` keeps free price entry, so a discount offer is meaningful in exactly one mode. |
| §16.2 | The line snapshot's discount facts: `discountType`, `discountValue`, `discountAmount`, `discountActorUserId`, `discountAuthorizationRef` — with `unitPriceList` and `unitPriceApplied` as two distinct recorded values and the identity `discountAmount = unitPriceList − unitPriceApplied` on the same unit basis. |
| §30.1/§30.6 | Money is integer minor units (bigint) end to end, never a float; the percentage computation is a single documented division rounded exactly once under the organization's `rounding_mode` (`HALF_UP` default, `HALF_EVEN` the plan-named alternative). |
| §11.2/§11.4 | `pricing.discount.apply`, `pricing.discount.approve`, `pricing.policy.edit`, `sales.create`, `pricing.override` are catalog permissions resolved from the actor's **effective** set (role grants, then overrides, then owner structure, deny over allow) inside the deciding transaction — never from a client-asserted role name. |
| §38.17–§38.19 | Offline: the device enforces from its signed, versioned cached policy; the server re-validates on sync against the then-current policy; a line the current policy would refuse is **accepted and flagged `PRICING_POLICY_DRIFT`** — never refused, never silently voided, never silently repriced. Structural corruption is still refused. |
| §32.2/§32.5 | The audited **Discount** action (type, value, amount, actor, authorization reference) rides the sale's own class-A transaction (M5); this boundary decides and does not write, and a refused decision leaves settings, versions, and audit heads untouched. |
| §34.3/§34.4 | RFC 7807 with stable codes. §18.2 fixes **403** for the three discount refusals; the registry already maps them so. §34.4's 422 row names "discount above ceiling with approval required" as an example — the specific §18.2 contract wins (recorded in §10 below). |
| §40.7 | M3-S3 scope: discount policy. Non-scope: discount reporting (M8). |

## 2. Predecessor and base

| Item | Value |
| --- | --- |
| Predecessor slice | M3-S2 pricing-mode enforcement (accepted `PASS_MY_SHOP_M3_S2_PRICING_MODE_ENFORCEMENT_REMOTE_LOCKED`) |
| Predecessor branch | `codex/my-shop-m3-s2-pricing-mode-enforcement` |
| Predecessor HEAD verifies as | `bfc92ffbda18f9f2d80745ce9b14d489b0637365` (local worktree == `origin` remote; verified before the first commit) |
| Predecessor PR | #26 (OPEN, base `codex/my-shop-m3-s1-typed-organization-settings`) — kept open and untouched |
| This slice's branch | `codex/my-shop-m3-s3-discount-policy` (created from the verified M3-S2 head in the linked worktree `C:\dev\my-shop-m3-s3`; no rewrite of any accepted history) |
| This PR's base | `codex/my-shop-m3-s2-pricing-mode-enforcement` (stacked; never merged by this slice) |

M2-S8 remains a governance proposal (PR #24), not an implementation base.

## 3. Architecture assessment (state at declaration)

The backend has, from the accepted slices: the M3-S1 typed `organization_settings`
row carrying every §18.2 discount setting (migration `0012`, versioned, audited,
field-gated), the M3-S2 transactional pricing boundary
(`common/pricing/` — contract, pure domain, service) with its two entry points
(`evaluateSaleLinesInTransaction`, `reconcileOfflineSaleLinesInTransaction`) and
the versioned decision contract, the M2-S4 effective-permission resolver with its
in-transaction read seam, the forced-RLS tenant posture, and the class-A audit
writer. The permission catalog already carries `pricing.discount.apply` and
`pricing.discount.approve`; the seeded Cashier preset holds `apply`, the
Salesperson preset deliberately does not (the §18.2 `discount_allowed_for_salesperson`
gate is what opens it), and Manager/Owner hold both.

The M3-S2 boundary refuses **every** reduction below the list price in
`FIXED_WITH_DISCOUNT` — recorded there as the precondition of this slice, not a
gap. There is no discount offer shape, no ceiling evaluation, no approval gate,
and no salesperson-policy composition anywhere. The error registry already
reserves `DISCOUNT_FORBIDDEN`, `DISCOUNT_LIMIT_EXCEEDED`, and
`DISCOUNT_APPROVAL_REQUIRED` (all 403) with no producer.

## 4. Included scope

1. **The discount contract** (additive in `common/pricing/pricing.contract.ts`):
   the closed discount-type vocabulary mirroring §18.1's table, the discount
   **offer** as a discriminated union (`PERCENTAGE` carries a decimal-string
   percentage; `FIXED_AMOUNT`/`FIXED_PRICE` carry decimal-string minor units —
   the 64-bit wire decision), and the per-line **discount decision facts** the
   §16.2 snapshot needs (type, offered value, computed amount, approval
   reference, approval state). The pricing contract version is bumped to **2**:
   the decision shape grows and `FIXED_WITH_DISCOUNT`'s semantics change (the
   reduction path opens for authorized discounts), so a recorded v1 decision is
   never silently reinterpreted.
2. **The pure discount domain** (in `pricing.domain.ts`, no I/O, no framework,
   no clock): one deterministic classifier shared by both entry points —
   - structural validation first: a malformed discount value (wrong grammar,
     negative, percentage outside 0–100, more than two fraction digits) is
     `VALIDATION_FAILED`; a corrupt stored policy value (a non-readable
     `max_discount_percentage`, a negative stored ceiling or threshold) is
     `INTERNAL_ERROR` — the fault owner decides the code;
   - **mode routing**: a discount offer is meaningful only in
     `FIXED_WITH_DISCOUNT` (§17.3 ties the mode's derivation to §18). `FIXED`
     refuses any discount offer with `PRICE_OVERRIDE_FORBIDDEN` — uniform with
     that mode's "the stored price is authoritative" rule, zero value included;
     `VARIABLE` refuses with `DISCOUNT_FORBIDDEN` — the mode already permits
     free price entry under `sales.create`, and a discount offer would create a
     second, competing applied-price source;
   - **server-derived price**: the applied price is computed from the
     authoritative list price and the discount offer — never taken from the
     client. `PERCENTAGE`: `discount = round(list × percentage / 100)` with the
     exact decimal carried as an integer numerator over a fixed scale and
     rounded **exactly once** under the organization's `rounding_mode`;
     `FIXED_AMOUNT`: `discount = amountMinor`, refused `DISCOUNT_LIMIT_EXCEEDED`
     when it exceeds the line's list price (a discount can never exceed the
     price being discounted — the applied price may never go negative);
     `FIXED_PRICE`: `applied = amountMinor`, `discount = list − amountMinor`,
     an `amountMinor` above the list price refused `DISCOUNT_FORBIDDEN` (a
     "fixed price" above the list is a price increase, and the increase path is
     the manual override boundary, not the discount path);
   - **ceilings (§18.2 step 3, unconditional)**: `PERCENTAGE` compares the
     offered percentage against `max_discount_percentage`; `FIXED_AMOUNT`
     compares the offered amount against `max_discount_amount_minor`;
     `FIXED_PRICE` compares the **computed reduction** against
     `max_discount_amount_minor` — the ceiling is on the discount amount, and a
     small final price is never mistaken for a small discount. A breach answers
     `403 DISCOUNT_LIMIT_EXCEEDED` for every actor including the owner and an
     approver: no authority silently bypasses a hard organization ceiling;
   - **authority (§18.2 step 4)**: the actor must hold `pricing.discount.apply`
     — or, when `discount_allowed_for_salesperson` is true, be a member whose
     server-resolved role is the seeded `salesperson` preset **and** have no
     explicit `DENY` override on `pricing.discount.apply` (deny over allow,
     §11.4). A breach answers `403 DISCOUNT_FORBIDDEN`;
   - **approval gate (§18.2 step 5)**: when `discount_approval_threshold_minor`
     is set and the computed discount amount is **strictly above** it, the
     actor must hold `pricing.discount.approve`; a non-approver receives
     `403 DISCOUNT_APPROVAL_REQUIRED`. The default is rejection, never a
     silently pending sale (§18.2's cash-handling hazard). Approval is never a
     client-asserted input: the gate is satisfied only by the authenticated
     actor's own effective authority, resolved inside the deciding transaction,
     so a forged, foreign, or revoked approval cannot even be expressed;
   - **below-cost block (§18.4)**: when `block_discount_below_cost` is true and
     the derived applied price is strictly below a **known** `unitCostApplied`,
     the discount is refused `DISCOUNT_LIMIT_EXCEEDED` (the cost floor is a
     limit on how deep the discount may go). When false, the line is permitted
     and flagged `BELOW_COST` exactly as M3-S2 flags it. An absent or unknown
     cost leaves the comparison unproven: no refusal and no flag is invented
     from nothing. Approval satisfies the threshold gate only — it does not
     bypass the below-cost block;
   - **offline reconciliation (§38.19)**: the same classifier's refusal becomes
     the `PRICING_POLICY_DRIFT` flag — accepted, flagged, never refused for
     policy drift, never silently voided, never silently repriced. The recorded
     snapshot stays exactly as the device recorded it. The §16.2 identity
     (`recorded amount = recorded list − recorded applied`) is checked as
     **structure**: a line violating it is malformed financial data and is
     refused, not drifted.
3. **The transactional service** (extension of `pricing.service.ts`): the two
   entry points gain the discount path, reading the live settings row and the
   actor's effective permissions inside the caller's transaction exactly as
   M3-S2 does, stamping every decision with the `settings_version` it enforced.
   The service composes the §18.2 authority rule from server-resolved facts:
   the effective permission set, the resolver's role key, and — new, additive —
   the resolver's **denied** permission ids, so the salesperson policy cannot
   resurrect a permission an owner explicitly denied. The approval reference is
   **minted by the server** from authenticated facts (approver id, organization,
   settings version, permissions version) when an above-threshold discount is
   decided by an actor holding `pricing.discount.approve`: attributable
   (§18.3), bound to the exact authorization moment, and never client-supplied.
4. **The authorization resolver's additive field**
   (`EffectiveAuthorization.deniedPermissionIds`): the known ids carried by the
   membership's `DENY` overrides, in catalog order. Purely additive — every
   existing consumer keeps its behavior; the discount authority rule is the
   first consumer.
5. **Tests** — the pure-domain acceptance matrix (no database, no framework, no
   clock) and a real-PostgreSQL acceptance suite proving: every type's ceiling,
   authority, approval, and below-cost path through the transactional service;
   the documented 403 codes; Owner/Manager/Cashier/Salesperson/explicit
   allow/explicit deny/unauthorized actors; the owner's live ceiling change
   racing an in-flight evaluation; tenant isolation fail-closed; offline
   reconciliation drift with preserved snapshots; and the M3-S2 regression
   (the manual reduction refusal stands, FIXED and VARIABLE are untouched, a
   refused discount leaves settings/version/audit untouched).
6. **Documentation** — README surface note (the combined pricing-and-discount
   boundary and the exact invocation M5's sale posting must make), this
   record's evidence section.

## 5. Explicit exclusions (non-scope, each with its governing reference)

- **Sale tables, the posting route, and the persisted line snapshot** (§16;
  M5): no sale line is written here, no `discount_*` columns arrive, no HTTP
  route exists. The boundary's decision contract is what M5's entry points must
  invoke; the slice record documents the deferred integration honestly.
- **A separate approval-issuance API or approval persistence table** (§18.2
  step 5's storage; M5): the V1 approval gate is the in-decision authority
  check §18.2 actually specifies. A delegated two-step approval flow (applier
  submits, second actor approves, token binds the decision) needs a persisted
  approval record and a sale to attach to — neither exists before M5; inventing
  one now would be an uncommanded enterprise workflow (§2.4) and the mission's
  "no enterprise multi-level approval chains" bound.
- **Discount reporting** (§33.2; M8): no report, no aggregation.
- **Device-side enforcement and the offline policy cache** (§38.19 device half;
  M3-S4/M1b): zero Flutter changes; the predecessor Flutter suite must remain
  green unchanged.
- **Catalog resolution** (M4): `unitPriceListMinor` and `unitCostAppliedMinor`
  remain server-resolved facts by contract; no product table is read here.
- **Audit rows in the boundary** (§32.5): the boundary decides and does not
  write; the sale's own class-A audit (M5) carries the §32.2 Discount event.
- **Price lists** (§17.5): deferred; `unitPriceList` remains the extension
  point.

## 6. Security and regression invariants (inherited, must survive)

Tenant scope server-derived and forced-RLS-backed; authorization resolved inside
the deciding transaction from the effective set, deny over allow, owner
structural; no cache ever holds policy authority (§22.3); fail closed on unknown
stored mode and on unknown persisted policy values; the client never dictates a
discount amount, an applied price, or an approval; no authority bypasses a hard
ceiling; no manual reduction masquerades as a discount (the M3-S2 refusal stands
for offer-less lines); no double application (a discount offer and a manually
reduced applied price cannot both drive one line); no mutation of the stored
list price; no token or credential material in any payload or log; the M3-S1
settings surface unchanged; migrations `0001`–`0012` byte-untouched (this slice
adds none); the predecessor Flutter suite (403 passed / 1 skipped) remains green
with zero client changes.

## 7. Validation requirements (test matrix)

- **PERCENTAGE**: exact decimal interpretation (no binary float anywhere);
  `0`, `100`, fractional two-decimal values, the ceiling value itself accepted,
  ceiling-plus-one-hundredth refused `DISCOUNT_LIMIT_EXCEEDED`; over 100,
  negative, malformed, three-decimal, and scientific-notation values refused
  `VALIDATION_FAILED`; the rounding identity proven for `HALF_UP` and
  `HALF_EVEN`; 18-digit list prices exact.
- **FIXED_AMOUNT**: zero, one minor unit, exact ceiling, ceiling plus one,
  above the list price; negative and malformed refused.
- **FIXED_PRICE**: final price equal to the list (zero discount), one minor
  unit below, the amount ceiling enforced on the **reduction**, an amount above
  the list refused `DISCOUNT_FORBIDDEN`, zero final price legal.
- **Authority**: Owner, Manager, Cashier (preset grant), Salesperson refused by
  default, Salesperson permitted with `discount_allowed_for_salesperson`,
  Salesperson refused again under an explicit `DENY`, explicit `ALLOW` override,
  unauthorized actor, permission removed mid-flight.
- **Approval**: threshold null (gate off), amount at the threshold (no
  approval), one minor unit above (approval required), non-approver refused
  `DISCOUNT_APPROVAL_REQUIRED`, approver satisfies it with a minted reference,
  approval authority revoked between decisions, cross-organization actor
  refused before any policy question.
- **Below-cost**: above cost, at cost, one minor unit below, unknown cost, zero
  cost, zero applied price, block on and off, approval not bypassing the block.
- **Concurrency (real PostgreSQL)**: the owner tightens and loosens a ceiling
  between two statements of one open transaction — each decision stamped with
  the version it actually enforced; a permission change mid-transaction.
- **Offline (§38.19)**: a previously valid discount under a tightened ceiling
  accepted and flagged, snapshots untouched; an unauthorized offline discount
  flagged; a structurally corrupt recorded line (identity violated) refused;
  determinism between the online refusal and the reconciliation flag proven
  from the shared classifier.
- **M3-S2 regression**: the offer-less manual reduction refusal stands in
  `FIXED_WITH_DISCOUNT`; FIXED and VARIABLE behave exactly as accepted; a
  refused discount leaves the settings row, its version, and the audit chain
  untouched; the in-transaction settings read parity holds.

## 8. CI requirements

Every existing required job must stay green on the final SHA: `fast-checks`,
`backend-unit`, `backend-integration-database` (real PostgreSQL 18),
`contract-drift`, `dependency-audit`, `flutter-build-windows`,
`flutter-build-android`. Push and pull-request events both recorded, on the
exact final SHA.

## 9. Completion criteria

The §40.7 row's acceptance ("a discount ceiling breach returns the documented
error") is demonstrated by the suites above on the final implementation SHA,
all gates green, the PR created stacked on the M3-S2 base with no merge
performed, and the remote CI evidence recorded on the exact final SHA in this
record's evidence section.

## 10. Interpretations recorded (§43.4: the plan wins; gaps resolved smallest-safe)

- **§34.4's 422 row vs §18.2's 403.** §34.4 lists "discount above ceiling with
  approval required" among 422 examples; §18.2 explicitly fixes 403 for all
  three discount refusals and the accepted registry already maps them to 403.
  The specific contract wins (§43.4): all three discount refusals are 403. The
  422 row remains the generic table's example, unchanged.
- **Discount offers are mode-gated to `FIXED_WITH_DISCOUNT`.** §17.3 ties the
  mode's applied-price derivation to §18; §17.1 makes `FIXED`'s price
  authoritative and §17.2 gives `VARIABLE` free price entry. Only this reading
  keeps all three sections mutually consistent; a discount offer in the other
  two modes is refused (FIXED: `PRICE_OVERRIDE_FORBIDDEN`, uniform with that
  mode's alteration rule; VARIABLE: `DISCOUNT_FORBIDDEN`).
- **`FIXED_PRICE`'s ceiling basis is the computed reduction**, per §18.2's
  "hard ceiling for `FIXED_AMOUNT` and `FIXED_PRICE`" expressed in
  `max_discount_amount_minor` — an amount ceiling; a final price is not an
  amount, so the reduction is what compares.
- **The salesperson policy keys on the seeded preset key** (`salesperson`) as
  server-resolved role data, never on a client-asserted role name, and an
  explicit `DENY` of `pricing.discount.apply` beats the policy grant (§11.4).
- **Rounding honors `rounding_mode`.** §18.2 step 6 requires explicit rounding
  and §30.6 names the organization's `rounding_mode` as the rounding rule;
  the percentage division is a single documented rounding point.
- **The approval reference is server-minted from authenticated facts**, since
  §16.2's `discountAuthorizationRef` must be attributable (§18.3) and no
  approval-issuance surface exists before M5. It records the approver, the
  organization, and the settings and permissions versions of the deciding
  transaction — provable from the audit and permission state, never a bearer
  secret, never client-asserted.
