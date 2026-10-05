# MY SHOP — M0-P2 OFFLINE POS ARCHITECTURE AMENDMENT

**Slice:** M0-P2 — Offline-capable POS architecture amendment
**Repository:** `sabere342-ai/my-shop` — `https://github.com/sabere342-ai/my-shop.git`
**Amends:** `MY_SHOP_MASTER_PLAN.md` v1.0.0 → **v1.1.0**
**Branch:** `codex/my-shop-m0-p2-offline-pos-amendment`
**Predecessor commit:** `701255fe1ec8d54096ed0d571450f0e8cfdefc4e` (M0-P1, PR #1)
**Document version:** 1.0.0
**Nature:** **Plan and governance only.** No implementation is authorized by this document.

---

## 1. Outcome

| Item | Result |
|---|---|
| Result token | `PASS_MY_SHOP_M0_P2_OFFLINE_POS_MASTER_PLAN_AMENDMENT_REMOTE_LOCKED` |
| Entry classification | `CASE_B_RECOVERABLE_EXISTING` — clean, known-good state, no unexplained local work |
| O-5 status | **CLOSED.** `OFFLINE-CAPABLE POS REQUIRED IN V1` |
| Master Plan | v1.0.0 → **v1.1.0**, 43 sections, §38 rewritten in full |
| New sections | 46 subsections added across 27 existing sections |
| Roadmap | New phase **M1b** plus M4b, M5b, M8b slice families |
| ADRs | 11 new (ADR-035…ADR-045), 2 superseded (ADR-015, ADR-022) |
| Owner decisions | O-5 closed; O-2 closed; 9 new (O-14…O-22) |
| Risks | R-4 retired; R-13…R-24 added |

---

## 2. The superseded decision — mandatory record

Required by authorization §BF.

| Field | Value |
|---|---|
| **O-5 PREVIOUS** | `ONLINE-FIRST / OFFLINE SALES NOT SUPPORTED` |
| **O-5 NEW OWNER DECISION** | `OFFLINE-CAPABLE POS REQUIRED IN V1` |
| **Reason** | `Business continuity during Internet outages and cashier accountability.` |
| **Supersedes** | ADR-022; §38.1–§38.5 of Master Plan v1.0.0; O-5 and O-9 in §42.1; risk R-4 in §42.2; the §3.1 statement that offline mutation was not in V1; the "cached reads only" rows in §5.4; the offline rows in §39.5; the `503` semantics in §34.4 |
| **Precedence** | Owner decisions in an amendment session supersede any conflicting earlier wording. Recorded in Master Plan §38.1 and §43.4 |

### 2.1 The business requirement, in the owner's terms

Selling must not be disabled by an Internet outage. The cashier must never have to say *"I
couldn't record the sale because there was no network."* Every real sale must enter the system at
the moment it happens, **including during an outage.**

| # | Owner requirement | How the plan satisfies it |
|---|---|---|
| 1 | No fake success | Local durability precedes user-visible success (§38.7) |
| 2 | No silently lost transaction | Durable local commit before the success indicator (§38.7) |
| 3 | No partially existing sale | One atomic local transaction (§38.7.1) |
| 4 | No reliance on cashier memory | The record exists on the device before the receipt prints (§38.7, §16.4A.2) |

### 2.2 Why this is a cross-cutting amendment, not an offline section

The owner's framing is correct, and the plan now matches it structurally. Offline POS is not a
feature; it touches **eleven** concerns:

| Concern | Plan section | Nature of the change |
|---|---|---|
| Persistence | §38.6, §39.6, §35.5 | Local relational store becomes a governed subsystem |
| Authentication | §10.3.1, §38.16 | Grace window, device binding, honest revocation limits |
| Devices | §12.5 | Device becomes the origin and identity of mutations |
| Inventory | §15.6A, §38.4, §38.5, §38.14 | Two guards; movement-based truth; reconciliation |
| Sales | §16.4A, §16.7, §38.23 | Offline numbering; void/return discipline |
| Accounting | §28.7, §31.4, §38.24 | Option B; idempotency becomes load-bearing |
| Invoice numbering | §16.4A | Gaplessness traded for availability |
| Security | §13.7, §38.29 | New threat model; local data protection |
| Testing | §36, §38.26, §37.2 | 22 mandatory offline tests; 6 new CI stages |
| Roadmap | §40 | New phase M1b; three new slice families |
| Observability | §38.28 | Correlation ids, metrics, redaction |

Editing one paragraph would have left the plan self-contradictory. Twenty-seven sections were
amended.

---

## 3. Amendment map — exactly what changed

Recorded so a reviewer can verify coverage rather than trust it.

| § | Change |
|---|---|
| Header | Version 1.0.0 → 1.1.0, plus an amendment notice naming the superseded model and the new largest risk |
| §0 | Section index updated; §38 retitled |
| §2.3 | New simplicity mechanism: **offline is invisible** |
| §3 | V1-33…V1-43 added; §3.1 rewritten (offline mutation is now **in V1**) |
| §4 | Added: global multi-device certainty is **not achievable and not claimed** |
| §5.4 | The two outbox/cache rows rewritten — same decision, new stance |
| §6.2 | Repository structure gains `core/offline/{db,outbox,sync,apply,grace,reconcile}` and `core/barcode` |
| §6.10, §6.11 | Client local state and test strategy amended |
| §7.1, §7.3 | Stack row and authority statement amended |
| §8.4 | New `sync` module owning `mutation_ledger`, `change_log`, cursors, conflicts |
| §9.4 | **New.** Tenant isolation under offline mutation (T-8…T-12) |
| §10.3.1 | **New.** Sessions under offline operation; grace duration setting |
| §11 | Offline permission snapshot referenced from §13.7 and §38.17 |
| §12.5 | **New.** Device sync metadata; revocation quarantines rather than discards |
| §13.1 | Two new rows: offline mutation authz, replay protection |
| §13.7 | **New.** Full offline threat model — 15 threats with mitigations and residual risk |
| §14 | Unchanged, as required by §BC and §AS |
| §15.1–§15.3A | **New §15.3A.** Product / Variant / SKU / Barcode model, 7 subsections |
| §15.4 | Movement authority reinforced |
| §15.6A | **New.** The two stock guards |
| §15.7 | `allow_negative_stock` **removed** |
| §16.2 | Variant snapshot amendment |
| §16.4A | **New.** Offline-safe numbering, 3 subsections |
| §16.7 | **New.** Void / return / reversal discipline |
| §17.4 | Enforcement amendment: cached versioned policy offline |
| §18 | Unchanged in substance; drift behaviour in §38.19 |
| §19 | Receivables amendment |
| §21.2A | **New.** Offline invoice output |
| §22.3 | Settings-as-authority amendment |
| §22.4 | **New.** Settings added/removed; `allow_negative_stock` deleted |
| §23.1 | Seven new attribution fields |
| §23.1.1, §23.1.2 | **New.** Offline attribution; the cashier-exposure metric |
| §24, §25 | Supplier/purchase offline tiering referenced |
| §26.1 | Payables offline amendment (Tier 3) |
| §27.6 | **New.** Financial accounts offline |
| §28.7 | Idempotency amendment; ADR-041 |
| §30.2 | Offline costing hazard named |
| §30.8 | **New.** Costing under offline operation |
| §31.4 | Three-layer idempotency guarantee |
| §32.2A | **New.** Offline and sync audit events, local and server |
| §33.8, §33.9 | **New.** R-8, R-9 report rules; offline reporting posture |
| §34.4 | `503` semantics changed; `MUTATION_CONTRADICTION` added |
| §35.5 | **New.** Client-side schema migrations |
| §36.1–§36.5 | T-7, T-8 principles; offline integration and crash-simulation rows; **I-13…I-20**; non-functional additions |
| §37.2, §37.3 | **Six new CI stages** (19–24); G-8, G-9 |
| **§38** | **Rewritten in full.** 33 subsections |
| §39.2–§39.5 | `sync` context; D-8; `mutation_ledger` ownership; new extension points |
| §39.6 | **New.** The local client schema |
| §40.2 | **New phase M1b** |
| §40.5 | **New.** M1b-S1…M1b-S10 |
| §40.8, §40.9, §40.12 | M4b-S1…S3, M5b-S1…S3, M8b-S1…S4 |
| §40.14 | M10-S7 offline chaos review |
| §41 | ADR-035…ADR-045 added; ADR-015 and ADR-022 struck |
| §41.1 | **New.** Superseded-decision table |
| §42.1 | O-2 and O-5 closed; O-14…O-22 added, each with a recommendation |
| §42.2 | **R-4 retired**; R-13…R-24 added |
| §42.3 | Deferred list corrected |
| §42.5 | Genuine uncertainties extended |
| §42.6 | Standing constraints extended to offline payloads |
| §43 | G-13, P-7, and release gates R-12, R-15, R-16, R-17 added |

### 3.1 Deliberately unchanged

Per authorization §BC, these were **not** redesigned. Each was checked for offline impact and
found unaffected or already compatible.

| Decision | Why unchanged |
|---|---|
| Tenancy model and forced RLS | Offline is an additional ingress using the same transaction and policy (§9.4) |
| Argon2id and session primitives | Unaffected; grace is layered on top (§10.3.1) |
| Permission catalog concept, `ownerExclusive` | An offline snapshot can never grant an owner-exclusive permission (§38.17) |
| Double-entry accounting | Offline adapted to accounting, not the reverse (§38.24) |
| Integer money | Holds offline without exception (§30.1, §38.8.1) |
| Weighted-average direction | Retained; its offline behaviour is analysed in §30.8 |
| Invoice output choices | print / save / both / neither — unchanged, now with an offline section (§21.2A) |
| Pricing modes | All three retained; only the enforcement point moves (§17.4) |
| Customer and supplier ledger authority | Server remains authoritative; local entries are queued events (§38.20) |
| Treasury account categories | `CASH` / `BANK` / `WALLET` unchanged |
| App lock | OS-delegated, unchanged (§AS) |
| Localization | Unchanged |
| Audit philosophy | Two streams retained, extended (§32.2A) |

---

## 4. Architectural principles produced

Required by authorization §BI. All eighteen are present in Master Plan §38.

| # | Principle | Where |
|---|---|---|
| 1 | Offline sale is a first-class V1 workflow | §3, §38.22 |
| 2 | Local durability before user-visible success | §38.7 |
| 3 | Atomic local business transaction | §38.7.1 |
| 4 | Durable outbox | §38.8 |
| 5 | Idempotent server mutations | §38.9 |
| 6 | Push + incremental pull | §38.10, §38.11 |
| 7 | Loop-free remote apply | §38.12 |
| 8 | Hard local no-negative-stock guard | §38.4 |
| 9 | Inventory movement auditability | §38.14.1 |
| 10 | Immutable completed sales | §16.7 |
| 11 | Offline-capable receipt generation | §38.23.2 |
| 12 | Cached but bounded authorization | §38.16, §38.17 |
| 13 | Device identity | §12, §12.5 |
| 14 | Server convergence after reconnect | §38.14.2 |
| 15 | Double-entry deterministic and idempotent | §38.24 |
| 16 | Barcode works without Internet | §15.3A.5 |
| 17 | No fake global stock certainty | §38.15 |
| 18 | Clear reconciliation instead of silent overwrite | §38.14.2 |

---

## 5. Decisions recorded as required

### 5.1 Barcode decision (required by §BG)

**Barcode input must support all four methods, all offline-capable:**

| Method | Decision |
|---|---|
| Auto-generated internal barcode | Yes. Deterministic from `organizationId` + `variantId`, so the same variant yields the same code on any device (§15.3A.6) |
| Phone camera scan | Yes. Decoding is entirely local |
| Hardware barcode scanner | Yes. **Keyboard-wedge / HID**, never vendor-SDK-dependent (§15.3A.5) |
| Manual entry | Yes. Validated against symbology |

**And the required properties:**

| Property | Decision |
|---|---|
| Barcode is **not** the Product primary key | Confirmed (§15.3A.1). Barcode is a searchable identifier |
| Barcode may attach to a sellable **variant/SKU** | Confirmed. `product_barcodes.variant_id` |
| Disallowed duplicates are prevented | Type-aware uniqueness on (organization, symbology, normalized value), enforced by a **database** constraint, never silently reassigned (§15.3A.4) |

The clothing case is settled: `T-Shirt / Black / XL` and `T-Shirt / Black / L` are **independent
stock-tracked variants**, each able to hold its own barcode. Collapsing them into one balance is
how physical retail loses stock (§15.3A.2).

### 5.2 Stock decision (required by §BH)

**`NEGATIVE STOCK SALES = FORBIDDEN`** — reason: preventing cashier error.

| Aspect | Decision |
|---|---|
| Invariant | `AVAILABLE_QTY >= SALE_QTY` at the moment of the sale attempt (§38.4) |
| Known 5, attempt 6 | **Rejected** |
| Ordinary cashier override | **Impossible** |
| Silent negative inventory | Prohibited |
| Warning-only sale | Prohibited |
| Automatic override | Prohibited |
| Hidden manager bypass | Prohibited — **no bypass exists at any permission level in V1** |
| Silent correction | Prohibited |
| `allow_negative_stock` setting | **Deleted** (§15.7, §22.4) |
| Goods present, system says 0 | Requires an **inventory adjustment/correction first**, with appropriate permission, audited, actor-attributed, timestamped, reason-coded, immutable-or-reversed (§38.5) |
| Using the sale itself to fix stock | **Prohibited** |

### 5.3 Operations tiering (required by §AM)

Not every module becomes offline. Over-applying offline support is how offline systems become
unreliable.

| Tier | Operations | Decision |
|---|---|---|
| **Tier 1 — must work offline** | POS sale, payments, local stock decrement, receipt output, all four barcode methods, catalog lookup, receipt reprint | **Required** |
| **Tier 2 — strongly desirable** | Inventory adjustment / stock count | **Recommended yes** (O-14). Required to make §38.5 workable while disconnected |
| | Sale return | **Recommended yes, restricted** to a locally-known original sale (O-15) |
| | Customer collection | **Recommended yes** (O-16) |
| **Tier 3 — online only** | User/role administration, device revocation, purchases and purchase returns, account transfers, manual journals, settings changes, ledger reports | **Enforced** |

**The one capability I recommend against is offline purchases (O-17)**, and the reason is
specific rather than convenient: a purchase receipt changes the **moving weighted average**, a
cumulative shared calculation. Two devices computing it independently and reconciling afterwards
is materially harder than selling offline and would put costing integrity at risk. A shop also
cannot receive a delivery while disconnected — a real operational cost, stated plainly.

---

## 6. Honest limitations

The most important part of this amendment. These are stated rather than engineered away.

### 6.1 Global stock certainty is impossible offline

Guaranteed **per device**: no overselling beyond what the device knows it has; complete
attribution; durable local record.

Guaranteed **eventually**: convergence and visible reconciliation.

**Not guaranteed:** global real-time inventory certainty while two or more devices are
disconnected. No system provides this without central coordination or physically locking the
goods. Refusing to sell does not create certainty — it creates lost sales (§38.15).

### 6.2 Revocation cannot be instant offline

A revoked user or device **cannot be stopped** while disconnected. The bound is a short,
owner-controlled grace window (recommended 72 hours). Any claim otherwise would be dishonest
(§38.16.4, R-14, R-15).

### 6.3 Gapless invoice numbering is not achievable

Stated directly rather than solved superficially. Gaplessness requires the server to know the
next number at print time. Offline it cannot. Claiming gaplessness would be claiming something
false.

| Guaranteed | Not guaranteed |
|---|---|
| Uniqueness, forever | Gaplessness |
| Monotonicity per device and per organization | An invoice number available while offline |
| Durability before printing | That a printed receipt bears a server number |
| A permanent, auditable mapping | |

The trade is **availability for the cashier in exchange for gaplessness in the accounting
sequence**. Given the owner's requirement, that trade is correct (§16.4A).

### 6.4 Device loss before sync loses those sales

Committed sales exist on the device until sync. There is no automatic device-side backup in V1.
The cashier-exposure metric (§23.1.2) makes the window visible; the grace window bounds it
(R-17).

### 6.5 Offline COGS approximates the authoritative cost

The device records its cached average; the server recomputes authoritatively. Divergence is
flagged and both figures are retained. History is never silently rewritten (§30.8, R-16).

### 6.6 The cashier can tamper with local data

A user with local database access can modify rows. The server re-derives accounting from immutable
events, so tampering is **detected on sync** rather than prevented on-device. Encryption at rest
(O-18) raises the bar. Making every attempt *attributable, time-bounded, and detectable* is the
honest achievable goal (§13.7).

---

## 7. Legacy position unchanged

Per authorization §AU. The legacy repository remains **READ ONLY** and no code was copied.

| Aspect | Status |
|---|---|
| Repository | `C:\dev\muaman.worktrees\i-tech-next-roadmap-freeze` — not modified; status fingerprint re-verified |
| Legacy sync subsystem | **REIMPLEMENT in full** (ADR-039). Not one line copied |
| What was studied | Outbox shape, writer snapshot, event-like classification, backoff ladder, conflict lifecycle, and the drain-shipping-off failure (§38.32) |
| What was rejected | Local-first as permanent truth, hand-written SQL, hand-migrated schema, no CI, and the drain-off pattern |

The legacy app built an offline architecture and shipped with its drain **disabled** — paying the
full complexity cost and never using it. My Shop treats offline as a required, tested V1 workflow
(ADR-037, §38.32.1).

---

## 8. Files changed in M0-P2

| Path | Change |
|---|---|
| `docs/governance/MY_SHOP_MASTER_PLAN.md` | **Amended** — v1.0.0 → v1.1.0 |
| `docs/governance/MY_SHOP_M0_P2_OFFLINE_POS_ARCHITECTURE_AMENDMENT.md` | **Added** — this record |

Nothing else. No app source, no backend source, no manifest, no migration, no CI file, and no
README change.

---

## 9. Validation evidence

| # | Check | Result |
|---|---|---|
| V-1 | Repository identity | `C:/dev/my-shop`, `main` at `53f6aaa9` — pass |
| V-2 | Predecessor ancestry | Amendment parent = `701255fe…` = M0-P1 commit — pass |
| V-3 | PR #1 state verified, not assumed | **OPEN**, not merged, no auto-merge, head `701255fe…` — pass |
| V-4 | Changed-files allowlist | Exactly the two authorized documents — pass |
| V-5 | No unexplained local work | Clean tree, empty stash, no locks, no active git operations — pass |
| V-6 | Secret scan | 6 credential patterns × both documents, 0 matches — pass |
| V-7 | No `.env` committed | None — pass |
| V-8 | Markdown structural validation | All fences balanced; **0 table defects** — pass |
| V-9 | Internal section references | All `§` references resolve to real headings — pass |
| V-10 | Stale "online-first" assertions | Searched and reconciled (§10.1 below) — pass |
| V-11 | "offline out of scope" contradictions | Searched; only the explicitly-superseded historical statement remains, marked as such — pass |
| V-12 | "sale blocked offline" contradictions | Searched; the blocking statement is superseded and replaced — pass |
| V-13 | "no outbox" contradictions | Searched; replaced with the durable outbox specification — pass |
| V-14 | Duplicate or conflicting O-5 wording | Exactly one O-5 definition, marked RESOLVED, plus the §38.1 supersession record — pass |
| V-15 | Gapless-numbering contradiction | ADR-015 struck and superseded by ADR-040; §16.4 marked superseded — pass |
| V-16 | Negative-stock contradiction | `allow_negative_stock` removed from §15.7 and §22.4 — pass |
| V-17 | Roadmap consistency | M1b precedes every business phase; M4b after M4-S1; M5b after M5-S7; M8b after M8-S6 — pass |
| V-18 | Legacy repository unchanged | Status fingerprint identical before and after — pass |
| V-19 | `main` unchanged | Still `53f6aaa9` locally and on GitHub — pass |
| V-20 | Mandated Master Plan sections | All 45 required subjects still present, 0 failures — pass |

### 9.1 Stale-assertion reconciliation detail

Every online-only assertion identified in the amendment inventory was individually resolved:

| Original assertion | Location | Resolution |
|---|---|---|
| "Offline **mutation** is NOT in V1" | §3.1 | **Replaced** — offline mutation is in V1 |
| "Client-side outbox sync; drain ships OFF → Server-authoritative online-first" | §5.4 | **Replaced** — durable outbox, on by construction |
| "Offline-first local database as source of truth → Local database is a cache only" | §5.4 | **Replaced** — durable capture, server still authoritative |
| "Server-authoritative, online-first" | §38.1 | **Replaced** — the whole section was rewritten |
| "**Online only.** No queued mutation, no offline write, no outbox" | §38.1 | **Replaced** |
| "Offline mutation is out of scope" | §38.3 | **Replaced** |
| "user attempts a sale → **blocked**" | §38.3 | **Replaced** — the sale completes offline |
| "Future safe offline queue architecture — reserved, not implemented" | §38.5 | **Replaced** — implemented in V1 |
| "A shop with an unreliable line cannot sell at all" | §38.4 | **Retired** — risk R-4 |
| "gapless and monotonic" numbering | §16.4 | **Superseded** by §16.4A |
| "offline read degradation" test scope | §6.11, §36.3 | **Replaced** — full offline matrix |
| "`503` … does not offer a queued write" | §34.4 | **Replaced** — a 503 triggers offline mode |
| ADR-022 online-first | §41 | **Struck**, superseded by ADR-037 |
| ADR-015 gapless numbering | §41 | **Struck**, superseded by ADR-040 |
| R-4 "Offline-only POS blocks sales" | §42.2 | **Retired** |
| O-5, O-9 open | §42.1 | **Closed** |
| "offline mutation" in the deferred list | §42.3 | **Removed** from deferred |

---

## 10. Non-scope preservation

| Prohibited | Confirmed |
|---|---|
| Flutter implementation | None. No `apps/` directory |
| NestJS implementation | None. No `services/` directory |
| Prisma or PostgreSQL migrations | None |
| Local DB implementation | None. Drift is specified, not adopted |
| Sync implementation | None. Specified only |
| Authentication implementation | None |
| Barcode implementation | None |
| Screens or packages | None |
| CI implementation | None. Stages specified only |
| M1-S1 start | Not started |
| Merge | **Not merged.** PR left open |
| Deployment | None |
| Legacy repository modification | None |
| Global tooling changes | None |

---

## 11. Next authorization required

**M1-S1 — monorepo skeleton and pinned toolchain**, unchanged in scope but now followed by the
**M1b** phase.

### 11.1 M1-S1 is affected by the offline architecture

| Impact | Detail |
|---|---|
| Toolchain must include **Drift** | A local relational database with generated schema (§38.6.1). This is a new build-time dependency and must be part of the M1-S1 toolchain decision, not added later |
| M1-S1 must resolve the stale Flutter / conflicting Dart | Pre-existing (R-5). **Requires separate owner authorization** to upgrade a global tool |
| M1b must follow M1 | Offline is a platform concern. Building it inside M5 would mean retrofitting idempotency into a flow that already assumed a synchronous server — the legacy mistake (§38.32) |
| CI gains 6 stages | Stages 19–24 (§37.2). M1-S4 should plan for them even though the offline code does not exist yet |

### 11.2 Decisions answerable before M1b

| Decision | Needed by | Blocks nothing before |
|---|---|---|
| **O-20** grace duration | M1b-S8 | M1-S1 |
| **O-21** `change_log` retention | M1b-S6 | M1-S1 |
| **O-17** offline purchases | M6-S2 | M1-S1 |
| **O-14** offline adjustments | M4-S4 | M1-S1 |
| **O-15** offline returns | M5-S5 | M1-S1 |
| **O-16** offline collections | M5-S4 | M1-S1 |
| **O-18** local encryption | M9-S4 | M1-S1 |
| **O-19** terminal count | M8b-S2 | M1-S1 |
| **O-22** reserved number blocks | M5-S2 | M1-S1 |

**No decision blocks the start of M1-S1.** Each carries a stated recommendation (§42.1).

### 11.3 Proposed next slice

**M1-S1 only.** Not M1b, and not M1-S1 plus M1b. Each slice is separately authorized
(§40.1), and the offline phase deserves its own explicit approval after the toolchain is settled.

---

*End of MY_SHOP_M0_P2_OFFLINE_POS_ARCHITECTURE_AMENDMENT.md, version 1.0.0.*
