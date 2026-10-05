# MY SHOP — MASTER PLAN

**Status:** Authoritative draft for owner approval
**Governing slice:** M0-P1 (Foundation / Discovery / Master Plan)
**Repository:** `sabere342-ai/my-shop` — `https://github.com/sabere342-ai/my-shop.git`
**Default branch:** `main`
**Canonical entry baseline:** `53f6aaa9aded2ec2218cec3f8987675a824b70db`
**Document version:** 1.1.0 (M0-P2 — Offline-capable POS amendment)
**Owning authority:** Repository owner. No slice may begin without explicit written authorization.

> **AMENDMENT NOTICE — version 1.1.0.** The owner superseded open decision O-5. The previous
> server-authoritative online-first model is **replaced** by an offline-capable POS architecture.
> **§38 was rewritten in full.** Sections 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18,
> 19, 21, 22, 23, 27, 28, 30, 31, 32, 36, 37, 39, 40, 41 and 42 were amended for consistency.
> **§38 is the authority for all offline behaviour.** The decision record is §38.1; the amendment
> rationale is `MY_SHOP_M0_P2_OFFLINE_POS_ARCHITECTURE_AMENDMENT.md`.
>
> **Largest remaining risk in the product is no longer "the shop cannot sell during an outage"**
> (R-4 is retired). It is now offline divergence and bounded stale authorization (R-13, R-14).

---

## 0. How to read this document

This document is the authoritative product and architecture plan for My Shop. It replaces
vague intent with explicit decisions. Every decision is stated as a **DECISION**, with its
**RATIONALE**, **CONSEQUENCE**, and **REJECTED ALTERNATIVES**.

Two normative keywords are used throughout:

- **MUST** — binding. Violating it is a defect.
- **SHOULD** — strong default. Deviation requires a recorded decision in §42.

Nothing in this document authorizes implementation. Each roadmap slice (§40) requires
separate owner authorization before any file outside its declared allow-list is touched.

### 0.1 Section index

| § | Subject | § | Subject |
|---|---|---|---|
| 1 | Product vision | 23 | Salesperson reporting |
| 2 | Simplicity principle | 24 | Suppliers |
| 3 | V1 scope | 25 | Purchases |
| 4 | Explicit future scope | 26 | Payables |
| 5 | Legacy reuse policy | 27 | Financial accounts |
| 6 | Flutter architecture | 28 | Double-entry accounting |
| 7 | Backend architecture | 29 | Chart of Accounts |
| 8 | PostgreSQL / Prisma | 30 | Inventory costing |
| 9 | Tenant model | 31 | Journal posting & reversal |
| 10 | Identity model | 32 | Audit |
| 11 | Users & permissions | 33 | Reporting |
| 12 | Device model | 34 | API versioning, validation, errors |
| 13 | Security model | 35 | Migrations |
| 14 | App lock / local auth | 36 | Test strategy |
| 15 | Products & inventory | 37 | CI strategy |
| 16 | Sales | 38 | Connectivity & offline architecture |
| 17 | Pricing modes | 39 | Data domain map |
| 18 | Discounts | 40 | Roadmap & slice boundaries |
| 19 | Customers | 41 | Architectural decisions register |
| 20 | Receivables | 42 | Unresolved decisions & risks |
| 21 | Invoice output behaviour | 43 | Acceptance gates |
| 22 | Settings | | |

---

## 1. Product vision

My Shop is a point-of-sale and back-office system for a small independent retail business,
delivered as a fast Windows desktop application and a fast Android application, Arabic first.

The shop owner and the salesperson open the app, ring up a sale, take payment, and move on.
Everything that makes that possible is fast, forgiving, and requires no accounting knowledge.

Underneath, My Shop maintains a rigorous double-entry ledger, immutable transaction
snapshots, and full attribution for every action that moves money or stock. That rigour is
**invisible** during routine work and **available on demand** to authorized users.

### 1.1 Success criteria for V1

| Criterion | Measure |
|---|---|
| Cash sale completes in ≤ 6 user interactions | Timed usability test on Windows |
| Owner produces a truthful monthly salesperson report with no manual calculation | Report reconciles to the ledger to the piastre |
| Every unit of inventory is accounted for at a stated cost | Stock movement ledger ties to the inventory asset account |
| No cross-tenant data is ever observable | Automated RLS suite covering 100% of tenant-owned tables |
| Ordinary salesperson never meets a debit/credit concept | UI review against the vocabulary ban list (§2.2) |

---

## 2. The simplicity principle

> **Simple outside, rigorous inside.**

This is a constraint, not a slogan. It has three testable components.

### 2.1 Complexity budget

Rigour lives in the backend domain layer. It **MUST NOT** propagate into the routine UI as
concepts, controls, or required decisions. A salesperson completing a cash sale **MUST NOT**
encounter: journal entries, debit, credit, ledger, cost layers, accruals, accounts, tax
computation, or multi-currency.

### 2.2 Vocabulary ban list

The following **MUST NOT** appear in any screen reachable by a user holding only
`sales.create`: قيد، قيود، مدين، دائن، دفتر، حسابات (journal, entries, debit, credit, ledger,
accounts). Advanced accounting screens exist but are permission-gated and explicitly marked
as restricted (§28.8).

### 2.3 Simplicity mechanisms

| Mechanism | Rule |
|---|---|
| Progressive disclosure | Advanced screens are never nested inside routine flows. They are separate, permission-gated destinations. |
| Sensible defaults | Every optional setting has a safe default, so the common path requires no decision. |
| Automatic posting | Sales, purchases, collections, and returns generate ledger entries server-side with no user action. |
| One primary action | Routine screens expose exactly one visually dominant action. |
| Reversal over correction | Users never edit posted financial records. They issue a reversing document (§31.3). |
| **Offline is invisible** | The cashier never sees a sync engine, a queue, or a conflict class. Offline state is one calm line (§38.31). Selling never stops for a sync problem. |

### 2.4 Anti-scope rule

Rigour **MUST NOT** be used to justify scope inflation. V1 is defined by §3 and bounded by §4.
A future module requires an owner decision, a schema reservation note, and a roadmap slice. It
**MUST NOT** be opportunistically implemented.

---

## 3. V1 scope

V1 ships these capabilities and nothing else.

| # | Capability | Phase |
|---|---|---|
| V1-01 | Multi-organization tenancy with enforced isolation | M1–M2 |
| V1-02 | Identity: owner bootstrap, login, sessions, revocation | M1–M2 |
| V1-03 | Users, roles, permission catalog, per-user overrides | M2 |
| V1-04 | Device registration, owner-visible list, revocation | M2 |
| V1-05 | Typed organization settings (§22) | M3 |
| V1-06 | Pricing policy: FIXED / VARIABLE / FIXED_WITH_DISCOUNT | M3 |
| V1-07 | Discount rules with authority limits and optional approval | M3 |
| V1-08 | Products, units, barcodes, cost and selling price | M4 |
| V1-09 | Perpetual weighted-average inventory costing | M4, M7 |
| V1-10 | Stock receipts, movements, adjustments, counts, negative-stock policy | M4 |
| V1-11 | Sales: cart, immutable line snapshots, offline-safe document numbering (§16.4) | M5 |
| V1-12 | Sale payments, split across financial accounts | M5, M7 |
| V1-13 | Customers, opening balance, statement | M5 |
| V1-14 | Receivables, partial collection, read-only aging | M5 |
| V1-15 | Sale returns linked to original sale lines at snapshotted cost | M5 |
| V1-16 | Optional invoice output: print / save / both / neither (§21) | M5, M9 |
| V1-17 | Suppliers, opening balance, statement | M6 |
| V1-18 | Purchases: cash and credit, receipt into stock and payable | M6 |
| V1-19 | Supplier payments, partial, payables | M6 |
| V1-20 | Purchase returns | M6 |
| V1-21 | Financial accounts: cash/treasury, bank, wallets, configurable | M7 |
| V1-22 | Account transfers | M7 |
| V1-23 | Chart of Accounts seeded per organization | M7 |
| V1-24 | Automatic double-entry posting for all V1 documents | M7 |
| V1-25 | Journal reversal workflow, permission-gated | M7 |
| V1-26 | Business audit trail and security audit trail (§32) | M2–M7 |
| V1-27 | Sales reporting incl. salesperson attribution and performance | M8 |
| V1-28 | Purchase, supplier, customer, inventory, finance reporting | M8 |
| V1-29 | Trial balance, P&L, statement of financial position, general ledger | M8 |
| V1-30 | Optional app lock via OS device authentication | M9 |
| V1-31 | Arabic-first RTL UI with English fallback, fully localized | M1 onward |
| V1-32 | CI, explicit migrations, automated tests, release readiness | M1, M10 |
| V1-33 | **Offline-capable POS: durable local transactional persistence** | M1b |
| V1-34 | **Durable outbox with server acknowledgement semantics** | M1b |
| V1-35 | **Server mutation ledger and idempotent replay** | M1b |
| V1-36 | **Push and incremental-pull synchronisation protocol** | M1b |
| V1-37 | **Loop-free remote apply** | M1b |
| V1-38 | **Offline authenticated grace and cached authorisation snapshot** | M2b |
| V1-39 | **Barcode as a first-class offline input capability** | M4b |
| V1-40 | **Offline receipt generation** | M5b |
| V1-41 | **Hard local no-negative-stock guard** | M4b |
| V1-42 | **Sync observability and owner sync console** | M8b |
| V1-43 | **Multi-device reconciliation reporting** | M8b |

### 3.1 In scope for V1 as quality, not as features

- Auditability of every money- and stock-moving action.
- Decimal-exact arithmetic (§30.1).
- Idempotent posting (§31.4).
- **Offline sale completion as a first-class workflow** (§38). Offline mutation is **in V1**, not
  deferred. This supersedes the v1.0.0 statement that offline mutation was not in V1.
- **Local durability before user-visible success** (§38.7).
- **Bounded, honest offline authorization** with an explicit statement of what cannot be
  guaranteed without connectivity (§38.16, §38.17).

---

## 4. Explicit future scope (architecture reserved, not implemented)

These **MUST NOT** be implemented in M0–M10 without new authorization. The architecture
reserves extension points for them (§39.5) and nothing more.

| Reserved for | Reserved extension point |
|---|---|
| HR / HCM, payroll | `users` is not an employee record. A future `hr` schema is separate. |
| Biometric attendance | Distinct from app lock (§14). No attendance events in V1. |
| Fixed assets / depreciation | Future asset register posting depreciation journals. |
| Advanced manufacturing | BOM, work orders, WIP accounts. V1 has no BOM. |
| Complex multi-warehouse logistics | `locationId` dimension on `stock_movements` and `stock_levels`; V1 seeds one default location. |
| AI agent | No agent surface, no tool-calling endpoint, no model data path. |
| Advanced procurement workflows | Approval chains, RFQ, GRN matching. V1 purchase is single-stage. |
| Enterprise approval chains | V1-07 provides a *single optional* discount gate; multi-level chains do not exist. |
| Multi-currency | One active currency per organization. No FX, no rate tables. |
| Tax / VAT | Deliberately excluded from V1. `taxAmount` columns are reserved and always zero. |
| Recurring subscriptions / billing | Not present in any form. |
| **Global real-time inventory certainty while multiple devices are disconnected** | **Not achievable and not claimed.** See §38.15. This is stated as a limitation, not deferred as a feature. |

---

## 5. Legacy reuse policy

The legacy application (**I Tech Store Management**, Dart package `muaman_store`) is an
**evidence and reference source**, not a code base to be forked. Its full inventory is in
`docs/governance/MY_SHOP_M0_P1_FOUNDATION_DISCOVERY.md`.

### 5.1 Policy rules

1. **No wholesale copy.** No file, directory, or module is copied from the legacy repository.
   This is a governance requirement, not a preference.
2. **No git history import.** My Shop's history begins at the canonical entry baseline.
3. **Reuse by re-derivation.** A legacy *concept* may be reimplemented when its implementation
   is sound and the concept is portable.
4. **Prefer REIMPLEMENT.** Where architecture, security, tenant isolation, accounting
   integrity, or maintainability would be compromised, reimplementation is mandatory.
5. **Concept reuse must be cited.** Each reimplemented concept traces to a discovery finding.
6. **No data migration in M0–M10.** Legacy data import is a separate future slice and is not
   assumed by the roadmap.

### 5.2 Reuse posture

Aggregate classification (full matrix in the discovery document):

| Class | Items | Character |
|---|---|---|
| `REUSE_AS_IS` | 1 | A single rendering *principle*, not code (§5.3). |
| `ADAPT` | 4 | Sound concepts, rebuilt against the new architecture. |
| `REIMPLEMENT` | 16 | Must be built or rebuilt to the new model. |
| `DO_NOT_COPY` | 11 | Explicitly forbidden, each with a recorded reason. |

### 5.3 The single `REUSE_AS_IS` item

**The invariant "the printed total is the persisted invoice total, never recomputed by
rendering logic."** The legacy repository builds a read model, delegates rendering, and
asserts `Σ line totals == persisted total` in tests. My Shop adopts this invariant as a design
rule (§21.4) and reimplements it independently. This is a *principle* reuse, not code reuse,
and is recorded as such so no future contributor believes a licence to copy exists.

### 5.4 Legacy defects that MUST NOT be inherited

| Legacy defect | My Shop rule |
|---|---|
| Money as `double` / SQLite `REAL` | Integer minor units, everywhere (§30.1) |
| No product selling price; price typed per line | Selling price is a first-class product field governed by a pricing mode (§17) |
| No ledger of any kind | Real double-entry core (§28, §29) |
| No suppliers, no purchases | First-class from M6 |
| Returns not linked to any sale | Returns reference the original sale line (§16.5) |
| 3,926-line god object | Strict layering with CI-enforced import boundaries (§6.3) |
| 7 global mutable singletons, 4 static mutable seams | Explicit provider-based DI, no service locators (§6.5) |
| 0 `.arb` files, 398 hardcoded user-visible strings | Full ARB localization from M1, CI grep gate (§6.8) |
| No theme file, no spacing scale, 21 scattered hex literals | Central design system (§6.9) |
| Client-side outbox sync; drain ships OFF | Durable outbox that is **on by construction**, server-acknowledged, and 22 mandatory offline tests (§38.8, §38.26) |
| Local-first local database as permanent source of truth | Durable local capture + **server remains authoritative**; the local database is never a competing truth (§38.6.3) |
| XOR "secure store" fallback; PowerShell DPAPI shell-out | Platform keystore only, fail-closed (§13.6, §14.3) |
| Global barcode uniqueness across tenants | Per-organization uniqueness (T-7, §9.2) |
| Hardcoded personal phone number in the binary | No personal data in source or artifacts (§42.6) |

---

## 6. Flutter architecture direction

### 6.1 Target platforms

| Platform | V1 stance | Rationale |
|---|---|---|
| **Windows desktop** | Primary. Ship-quality. | The shop counter workstation. Requires keyboard-first POS ergonomics, native print integration, and durable local caching. |
| **Android** | Primary. Ship-quality. | Owner mobile oversight and small-shop portability. |
| Linux / macOS | Not release targets in V1. | Avoids platform claims without evidence. Code may compile; nothing is promised. |
| Web | Not a target. | No `dart:io`-free requirement is designed for. |

Windows is treated as a first-class requirement, not an afterthought: it is the platform where
release builds, printer configuration, and printing correctness matter most.

### 6.2 Repository structure — LOCKED IN

Monorepo, single repository, both applications plus a shared contract package.

```
my-shop/
  apps/
    desktop/                        Flutter app — Windows + Android, one codebase
      lib/
app/                        bootstrap, router, theme wiring, DI root
        core/
          api/                      generated REST client, interceptors, error mapping
          auth/                     session store, token refresh, secure credential storage
          offline/                  LOCAL-FIRST-OFFLINE SUBSYSTEM (38.6-38.7, 38.31)
            db/                     Drift database, schema, migrations, local_meta version
            outbox/                 durable outbox writer, state machine (38.8, 38.13)
            sync/                   push, pull, retry, backoff, resume (38.10-38.11)
            apply/                  applyRemoteWithoutOutbox - the ONLY remote-apply
                                    entry point, with outbox suppression (38.12)
            grace/                  offline auth grace, cached authz snapshot (38.16-38.17)
            reconcile/              multi-device divergence detection (38.14.2, 38.15)
          barcode/                  scan input, auto-generate, lookup (15.3A, 38.26 T-O14)
          money/                    Money value type, minor-unit arithmetic, formatting
          models/                   shared immutable cross-feature models
          settings/                 typed settings accessors + offline versioned cache (38.18)
          ui/                       design system: tokens, primitives, layout
          result/                   Result / ResultAsync and failure taxonomy
          telemetry/                structured, redacted diagnostics, sync metrics (38.28)
        features/
          <feature>/                 one folder per bounded feature (6.3)
            data/                    DTOs, API client, mappers
            domain/                  entities, value objects, policies, use cases
            presentation/            screens, widgets, controllers
      test/
      integration_test/
  services/
    api/                            NestJS backend
      src/
        common/                     cross-cutting: errors, auth, tenancy, logging, pipes
        modules/
          <module>/                 one per bounded context (§8.4)
            <module>.controller.ts
            <module>.service.ts
            <module>.repository.ts
            dto/
            <module>.spec.ts
      prisma/
        schema.prisma
        migrations/
      test/                         cross-module integration and RLS tests
  packages/
    contracts/                      generated API contract types, single source of truth
    testkit/                        shared fixtures and builders
  docs/
    governance/                     this plan and slice records
    adr/                            architecture decision records
  .github/workflows/                CI definitions (§37)
```

**LOCK-IN DECISION.** Monorepo with `apps/` + `services/` + `packages/`. The API contract is
generated once from the backend and consumed as a package by the Flutter client, so contract
drift becomes a compile-time failure rather than a runtime surprise.

Rejected: two separate repositories (loses atomic refactors across the contract boundary);
Flutter and backend in one language directory (no shared boundary discipline).

### 6.3 Feature-first, layered inside each feature

Vertical slices, not horizontal layers across the whole app.

```
features/sales/
  data/          sales_api.dart, sales_dto.dart, sales_mapper.dart
  domain/        sale.dart, sale_line.dart, sale_policy.dart,
                 create_sale.dart, return_sale_line.dart
  presentation/  sales_screen.dart, cart_screen.dart, sale_controller.dart, widgets/
```

Dependency rules, enforced by custom lint **and** a CI import-boundary check:

```
presentation  ──▶  domain
data           ──▶  domain
presentation  ──▶  data     (only through an injected repository interface)

domain        ──╳  data        FORBIDDEN — domain never imports data
domain        ──╳  flutter     FORBIDDEN — domain is pure Dart
```

**Consequence:** every pricing, discount, attribution, and costing rule in §17, §18, §22, §30
is implemented in pure Dart and unit-testable without a widget tree, a database, or a network.
This is the single highest-leverage decision in the client architecture.

### 6.4 State management — DECISION

**Riverpod 2.x with code generation (`riverpod_generator`), one `AsyncNotifier` controller per
feature screen group.**

| Option | Verdict |
|---|---|
| Riverpod 2 + generator | **Selected.** Async lifecycle, cache invalidation by feature key, no global mutable state, testable by overriding providers. |
| BLoC / Cubit | Rejected for now. Strong isolation, but the per-screen ceremony is disproportionate for a CRUD-and-poster product. Remains acceptable inside a single complex feature later. |
| Provider / ChangeNotifier | Rejected. Invites the mutable-singleton and ad-hoc `isLoading` patterns observed in the legacy application. |
| Legacy `setState` + 7 singletons | Rejected. §5.4. |

Rules:

- No global mutable singleton holds business state. Services are injected.
- All async state is `AsyncValue`. No hand-rolled `bool isLoading` fields.
- Invalidation is by feature key, never a global refresh.

### 6.5 Dependency injection — DECISION

Provider-based, constructor injection everywhere in `domain` and `data`. **No service locator,
no static registration seam, no `X.instance`.** Legacy `DatabaseHelper.instance` and the four
`static` mutable bootstrap callbacks are `DO_NOT_COPY`.

### 6.6 Routing — DECISION

**`go_router`**, declarative, named routes per feature, with a redirect guard that resolves
authentication state and organization context *before* the first screen renders. Typed route
arguments. Direct `Navigator.push(MaterialPageRoute(...))` is forbidden outside the router.

**Consequence:** deep links, a role-driven navigation model, and automated navigation testing
all become possible — none of which the legacy application had.

### 6.7 Models and serialization — DECISION

`freezed` + `json_serializable` for immutable domain and DTO types. `build_runner` is the only
code generator in the client. Generated files are committed so CI needs no codegen step to
analyse the tree.

### 6.8 Localization and RTL — DECISION

- **ARB** message catalogs via `flutter_localizations` + `gen-l10n`. **Zero hardcoded
  user-visible strings in Dart source**, enforced by a CI grep gate over feature and app code.
- `ar` (Egypt) is the default locale; `en` is the fallback locale.
- Directionality derives from the locale. **No manual `Directionality` wrappers anywhere.**
- A bidi CI check rejects `Alignment.centerLeft` / `centerRight` and hardcoded directional
  padding inside `core/ui` and `features/`.
- **Digits — DECISION:** Western digits are the default for amounts and quantities in V1,
  because they are what the legacy customer base reads on receipts and because invoice PDFs
  must be unambiguous. An organization setting may switch to Eastern Arabic numerals for
  on-screen display only; persisted values and PDFs are unaffected.

### 6.9 Design system — DECISION

A single `core/ui` design system, created in M1, containing:

- Colour **roles** (surface, onSurface, primary, success, warning, danger, disabled) — never
  raw colours in feature code.
- A type scale (display, title, body, label, caption) — never ad-hoc font sizes.
- An 8-point spacing scale and a radius scale.
- Components: `AppButton`, `AppTextField`, `AppMoneyField`, `AppDialog`, `AppSheet`,
  `AppDataTable`, `AppEmptyState`, `AppErrorState`, `AppConfirmDialog`, `AppSnackbar`,
  `AppSectionHeader`, `AppPermissionGate`.

A CI check rejects `Colors.*` and `fontSize:` literals outside `core/ui`.

### 6.10 Client state that is legitimately local

| State | Location | Rule |
|---|---|---|
| Session tokens | Platform secure storage | Only. Fail-closed (§13.6). |
| Draft cart | Local, in-memory or local cache | **Not a business record** until submitted. Never synced. |
| Reference data (products, customers, suppliers, accounts) | Local cache | Read-only from the server's perspective (§38.3). |
| UI preferences | Local | Column widths, last screen. |
| App-lock arming flag | Platform secure storage | Never a PIN (§14.1). |

### 6.11 Flutter test strategy

| Level | Tool | Scope |
|---|---|---|
| Unit | `flutter_test` | Domain policies, `Money` arithmetic, mappers. Pure Dart, no I/O. |
| Widget | `flutter_test` | Controllers and screens with faked repositories via provider overrides. |
| Golden | `flutter_test` golden files | Arabic RTL rendering of `core/ui` components. |
| Integration | `integration_test` on Windows and Android | Login → sell → collect; app lock; invoice output; offline-read degradation. |

Coverage gates are in §36.

---

## 7. Backend architecture direction

### 7.1 Stack — DECISION

| Concern | Choice |
|---|---|
| Runtime | Node.js 22 LTS |
| Language | TypeScript `strict: true` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride` |
| Framework | NestJS 11 |
| ORM | Prisma 6 |
| Database | PostgreSQL 18 |
| Transport | REST over JSON, namespace `/api/v1` (§34.1) |
| Auth | Short-lived JWT access token + opaque rotating refresh token (§10.3) |
| Validation | `class-validator` + `class-transformer`, one global pipe (§34.2) |
| Errors | RFC 7807-shaped problem document (§34.3) |
| Testing | Jest; integration tests against a real PostgreSQL instance; Supertest for HTTP |
| API docs | OpenAPI generated from decorators, published as a CI artifact |
| Lint / format | ESLint + Prettier, enforced in CI |

### 7.2 Module boundaries

Each business capability is a NestJS module owning its controller, DTOs, service, repository,
and write paths to its tables. Modules communicate only through exported services or explicit
domain events. **A module never writes another module's tables**; cross-module reads go
through the owning module's repository.

### 7.3 The backend is the only authority

Every business invariant — tenant scope, permission, pricing mode, discount ceiling, stock
sufficiency, ledger balance, posting idempotency — is enforced server-side. Client-side checks
are UX affordances only.

This deliberately combines the strongest and the weakest lessons from the legacy application:
the legacy app *did* enforce authorization in its data layer rather than only in the UI, which
is the right instinct — but because the client held the data, the client was the boundary. In
My Shop the client holds only a token and a cache, so the server is unambiguously the boundary.

### 7.4 No background worker in V1 — DECISION

Deferred. V1 posting is synchronous inside the request transaction, so the accounting path has
**no eventual consistency**. A worker service is reserved (§4) for report materialization and
future integrations. This is a deliberate simplicity decision: a worker would introduce
retry semantics into the one path where correctness must be absolute.

---

## 8. PostgreSQL and Prisma strategy

### 8.1 DECISION — one database, shared schema, enforced RLS

A single PostgreSQL database. Every tenant-owned table carries `organization_id NOT NULL`.
Isolation is enforced **twice**:

1. **Application layer** — every query carries an explicit `organizationId` predicate derived
   from trusted request context (§9.3).
2. **Database layer** — Row Level Security on every tenant-owned table.

Defense in depth is mandatory: a single missed application predicate must not become a
cross-tenant leak.

### 8.2 RLS contract — DECISION

- `ENABLE ROW LEVEL SECURITY` **and** `FORCE ROW LEVEL SECURITY` on every tenant-owned table,
  so the application role is itself subject to the policy.
- Policy predicate: `USING (organization_id = current_setting('app.current_organization_id', true))`.
- The application sets the value per transaction with `SET LOCAL app.current_organization_id = $1`.
  `SET` (session-scoped) is **forbidden**, because it would leak across pooled connections.
- The application role **MUST NOT** hold `BYPASSRLS`.
- Connection-pool reuse is safe only because `SET LOCAL` is transaction-scoped. This invariant
  is asserted in the connection wrapper.
- A CI suite asserts, by direct SQL against every tenant-owned table, that a tenant-scoped
  session can neither read nor write another organization's rows.

### 8.3 Prisma usage rules

| Rule | Detail |
|---|---|
| Migrations | `prisma migrate deploy` in every environment. `prisma db push` and `migrate dev` are **forbidden outside local development**. |
| Immutability | A merged migration file is never edited. Corrections are new migrations. |
| Expand / contract | Breaking change over two releases: add nullable column → backfill → dual-write → enforce. No destructive step in one release. |
| Raw SQL | Permitted only via tagged `Prisma.sql` / `$queryRaw` templates. String-interpolated SQL is a CI failure. |
| Constraints | Every financial invariant is expressed as a `CHECK` constraint in the migration SQL, and declared in the Prisma schema as documentation so drift is reviewable. |
| Money type | Money is `BigInt` minor units (§30.1). Prisma `Decimal` is reserved for non-monetary ratios. |
| Index discipline | Every foreign key indexed. Hot indexes lead with `organization_id`. Unique constraints scoped by `organization_id` (§9.2 T-7). |
| Connection limits | Pinned and monitored; exhaustion is an alert, not a silent queue. |

### 8.4 Schema module ownership

| Module | Owns |
|---|---|
| `identity` | users, sessions, credentials |
| `tenancy` | organizations, organization_memberships, roles, role_permissions, permission_overrides |
| `devices` | devices, device_sessions |
| `settings` | organization_settings, feature_flags |
| `catalog` | products, product_units, product_barcodes |
| `inventory` | locations, stock_levels, stock_movements, stock_counts, stock_count_lines |
| `sales` | sales, sale_lines, sale_payments, sale_returns, sale_return_lines |
| `parties` | customers, customer_ledger_entries, suppliers, supplier_ledger_entries |
| `purchasing` | purchases, purchase_lines, purchase_payments, purchase_returns, purchase_return_lines |
| `treasury` | financial_accounts, account_opening_balances, account_transfers |
| `accounting` | chart_of_accounts, journal_entries, journal_lines, document_sequences |
| `audit` | audit_events, security_events |
| **`sync` (NEW, offline support)** | **mutation_ledger, change_log, device_sync_cursors, sync_conflicts** |

Cross-module **reads** are permitted. Cross-module **writes** are a boundary violation, caught
in review and, where practical, by a CI ownership map check.

**Amendment note — `sync` module.** Added by the M0-P2 offline amendment. `sync` depends on
`tenancy` and `devices` only, and is depended upon by every business context that accepts an
offline mutation. It **owns the mutation ledger and the change log**; it does **not** own business
tables. A business context writes its own tables inside the same transaction that writes the
mutation-ledger row and the change-log row (§38.9.3, §38.11.1). This preserves the single-writer
rule while making convergence possible.

---

## 9. Tenant model

### 9.1 DECISION

`Organization` is the tenant. It is created at owner bootstrap, is the isolation boundary, and
appears on every tenant-owned row. Each business owns its own users, products, inventory,
customers, suppliers, sales, purchases, financial accounts, ledger, settings, devices, and
permissions.

### 9.2 Isolation invariants

| # | Invariant |
|---|---|
| T-1 | Every tenant-owned table has `organization_id NOT NULL` with an index. |
| T-2 | Every query in every repository includes an `organizationId` predicate. |
| T-3 | RLS is enabled and forced on every tenant-owned table (§8.2). |
| T-4 | A user may belong to multiple organizations; the active organization is server-derived per request. |
| T-5 | An organization is never deleted in V1. It is deactivated, preserving financial history. |
| T-6 | No cross-organization foreign keys. All references are intra-organization. |
| T-7 | Unique constraints are scoped by `organization_id`, never global. |

T-7 explicitly corrects a legacy defect: `products.barcode` there carried a **global** unique
constraint deliberately retained across shops. That pattern leaks the existence of another
tenant's products through a uniqueness violation, and is `DO_NOT_COPY`.

### 9.3 Trusted tenant context — DECISION

Client-supplied tenant identifiers are **never** trusted as authorization context. The chain:

1. The access token is verified: signature, algorithm, issuer, audience, `exp`, `nbf`.
2. Verified claims yield `userId` and `allowedOrganizationIds`.
3. The requested organization is taken from a **verified source** — a route parameter — and
   looked up in `allowedOrganizationIds`. Absence yields `403 ORGANIZATION_FORBIDDEN` **and** a
   security audit event.
4. The resolved `organizationId` is placed in request-scoped context.
5. The service layer opens a transaction and issues `SET LOCAL app.current_organization_id`.
6. Repositories read `organizationId` **only** from that context, never from a DTO.

**RATIONALE.** Trusting an `X-Organization-Id` header, or accepting `organizationId` in a
request body, is the canonical multi-tenant vulnerability. The value must be *derived* from a
verified credential, never *asserted* by the caller.

**Consequence.** The client may never switch organization by changing a field; switching is a
server-validated action against the membership set.

### 9.4 Tenant isolation under offline mutation — DECISION (added by M0-P2)

Offline mutation does **not** weaken tenant isolation. It relocates *when* the check happens.

| # | Rule |
|---|---|
| T-8 | An offline mutation's `organization_id` comes from the **device binding** (§38.16.2), which was established by a prior verified server session. It is never user-editable on the device. |
| T-9 | The server re-validates on acceptance that `device_id` belongs to `organization_id` and that the actor is a member. A device-organization mismatch is rejected and raises a security event. |
| T-10 | RLS (§8.2) applies unchanged. An offline mutation is inserted inside the ordinary transaction with `SET LOCAL app.current_organization_id`, so the database policy is the enforcement point exactly as for an online request. |
| T-11 | A device bound to organization A **cannot** queue a mutation for organization B. Switching organization offline is not supported; it requires connectivity. |
| T-12 | The change log (§38.11.1) is written in the same transaction, so a cross-tenant write is impossible via the sync path for the same reason it is impossible via the REST path. |

**RATIONALE.** The offline path is an *additional ingress*, not a weaker one. It reuses the same
transaction, the same RLS policy, and the same authorization resolution as any other write.

---

## 10. Identity model

### 10.1 DECISION

Email + password with server-side sessions. No social login, no self-service signup, and no
public registration endpoint in V1.

### 10.2 Password storage

- **Argon2id** via a maintained library. Parameters are explicit configuration, reviewed
  against current OWASP guidance at each M10 hardening slice. Per-user random salt.
- Verification **MUST** be constant-time at the library boundary. The legacy hand-rolled
  PBKDF2 comparison used an early-return byte compare and is `DO_NOT_COPY`.
- **No permanent lockout.** Failed-attempt counting with exponential backoff, plus a security
  audit event. Administrative unlock; never silent self-unlock.
- Complexity policy: minimum length plus a breached-password deny-list. No composition rules.

### 10.3 Sessions — DECISION

| Property | Value |
|---|---|
| Access token | JWT, asymmetric algorithm, **15-minute** lifetime. Claims: `sub`, `orgs`, `sid`, `perms_version`. |
| Refresh token | Opaque 256-bit random value, **SHA-256 hashed at rest**, rotated on every use. 30-day absolute / 7-day idle expiry. |
| Reuse detection | Presenting a refresh token whose successor is unknown revokes the entire session family. |
| Revocation | `sessions.revoked_at`, checked on every refresh. Access tokens are short-lived by design. |
| Concurrency | Multiple concurrent sessions per user, each a distinct `session_id`, owner-visible. |
| Permission freshness | `perms_version` increments on any permission change. A stale token yields `401 TOKEN_STALE`; the client refreshes and retries once. |

**Consequence while online.** Revoking a user or a device takes effect within 15 minutes for
access tokens and immediately for refresh, without a per-request session lookup.

### 10.3.1 Sessions under offline operation — DECISION (added by M0-P2)

An offline device has no server to talk to, so session lifetime is governed by the **offline
authenticated grace window** rather than by token expiry alone.

| Property | Decision |
|---|---|
| Access token while offline | May expire freely. It is **not** the offline authorization; the signed grace record is (§38.16.3). |
| Refresh token while offline | Cannot be rotated (no server). Stored only in the platform secure store, never in plaintext (§38.29). |
| Offline grace duration | Organization setting `offline_grace_duration`, **default 72 hours**, max 30 days. Owner-controlled. Owner decision O-13. |
| Grace start | On the last successful server authentication or sync, not on app start. Restarting the app does **not** extend the window. |
| Grace expiry behaviour | Mutations refused; reads allowed; **committed sales remain committed and still sync** (§38.16.2). Nothing is deleted on expiry. |
| Revocation while offline | **Cannot be known** until the device reconnects. Bounded by the grace window. This is a stated limitation, not a solved problem — §38.16.4, risk R-14. |

**Anti-replay rule.** Every grace record carries the `mutation_id` namespace of the device. A
grace record copied to another device fails the device-binding check (§38.16.2) and the
signature check (§38.16.3).

**The device remains accountable offline.** App lock (§14) plus device binding (§12) plus the
local audit trail (§38.30) together mean an offline till is *more* traceable than an unlocked
browser session, not less.

### 10.4 Bootstrap — DECISION

The first organization and its owner are created by an **operator-run bootstrap command** using
server-side credentials, not by a public "create first owner" endpoint. This closes the legacy
race in which any fresh device reaching an unconfigured app could claim ownership of a shop.

---

## 11. User and permission model

### 11.1 DECISION

**RBAC with a versioned permission catalog, data-driven role presets, and per-user overrides.**

The legacy model is not copied. A hardcoded three-value `UserRole` enum is rejected because it
turns every future role change into a code change and a migration.

### 11.2 Permission catalog

Permissions are **strings in a versioned catalog** (`sales.create`, `pricing.override`, …),
never a database enum, so the catalog can grow without a schema migration. Each entry declares:
id, category, description, and an `ownerExclusive` flag making it structurally ungrantable to
non-owners.

| Group | Representative permissions |
|---|---|
| Catalog | `catalog.view`, `catalog.edit`, `catalog.cost.edit` |
| Inventory | `inventory.view`, `inventory.receive`, `inventory.adjust`, `inventory.count` |
| Sales | `sales.view`, `sales.create`, `sales.viewAll`, `sales.return`, `sales.cancel` |
| Pricing | `pricing.override`, `pricing.discount.apply`, `pricing.discount.approve` |
| Customers | `customers.view`, `customers.edit`, `customers.collect` |
| Suppliers | `suppliers.view`, `suppliers.edit`, `suppliers.pay` |
| Treasury | `treasury.view`, `treasury.transfer`, `treasury.reconcile` |
| Accounting | `accounting.view`, `accounting.journal.read`, `accounting.journal.post` (owner-exclusive), `accounting.chart.manage` |
| Administration | `settings.view`, `settings.edit`, `pricing.policy.edit`, `users.manage`, `roles.manage`, `devices.view`, `devices.revoke`, `audit.view` |

### 11.3 Role presets — DECISION

Roles are **data, not enum**. Seeded presets exist for convenience; a role is a named set of
permission ids. A built-in `Owner` role is unique per organization and always holds every
permission.

Seeded presets: **Owner, Manager, Cashier, Salesperson, Stockkeeper, Accountant.**

The legacy `salesOnly` role is preserved in spirit as the `Salesperson` preset: exactly the
minimum needed to sell, and nothing else.

### 11.4 Overrides

Per-user `allow` / `deny` sets, evaluated **after** the role. This lets an owner grant one extra
permission to one person and lock one dangerous permission away from another, without inventing
a new role. The legacy `ownerExclusive` concept is preserved as a structural rule enforced in
the service layer, not as a hardcoded set in the UI.

### 11.5 Authorization and attribution are different things

`createdByUserId` is written on every business row regardless of permission. Authorization
answers *"may this happen?"*; attribution answers *"who did it?"* Both are always recorded, as
distinct columns with distinct semantics. Conflating them is a design error.

---

## 12. Device model

### 12.1 DECISION

A `device` is an **installation**, not a browser session. It is registered on first successful
authentication and is organization-scoped.

Fields: `id`, `organizationId`, `label` (user-editable, defaulting to a platform-derived name),
`platform` (`windows` | `android`), `osVersion`, `appVersion`, `firstSeenAt`, `lastSeenAt`,
`lastAuthenticatedAt`, `status`.

**Amendment note.** The device gains an additional role in the M0-P2 architecture: it is the
**origin and identity of offline mutations** (§38.8.1). `device_id` is now present on every
mutation, every stock movement, and every locally committed sale, which makes per-terminal
accountability a first-class query rather than an inference.

### 12.2 Trust states — DECISION

**V1 has exactly two states: `ACTIVE` and `REVOKED`.**

There is deliberately **no** `PENDING_APPROVAL`. An owner-approval device flow is deferred
(§4) because it inserts an approval step into the most security-sensitive path (login) to
address a threat model the owner has not requested. The extension point is the `status` column.

A **closed status vocabulary** is a hard rule: new states require an explicit schema decision
and an accounting/authorization review.

### 12.3 Device identity — REIMPLEMENT, not copy

The legacy app's Ed25519 per-install keypair and challenge/response device proof is a sound
*concept* and is `ADAPT`ed. Its Windows *implementation* is `DO_NOT_COPY`: it shells out to
`wmic` (removed in Windows 11 24H2) for hardware fingerprinting, and reaches DPAPI by writing
plaintext secrets to `%TEMP%` and invoking PowerShell. My Shop's device identity is
server-issued, keystore-backed, and implemented with maintained libraries.

### 12.4 Device behaviour

- Revoking a device immediately revokes its sessions.
- `lastSeenAt` refreshes on authenticated requests, throttled to bound write amplification.
- The owner sees a device list with label, platform, version, and last seen, and can revoke.
- Every revocation writes a security audit event (§32).

### 12.5 Device sync metadata — DECISION (added by M0-P2)

A device is now also a **sync participant**. Additional recorded fields:

| Field | Purpose |
|---|---|
| `installation_id` | Stable per-installation identifier, bound to the platform keystore. Differs from `id` because it must survive re-registration |
| `last_sync_at` | Last successful sync |
| `last_push_at` / `last_pull_at` | Per-direction, for diagnosing a one-sided failure |
| `pending_mutation_count` | Cached locally, refreshed on sync; surfaced in the sync console (§38.31.1) |
| `oldest_pending_mutation_at` | **The cashier-exposure metric.** How long the oldest un-synced sale has waited |
| `client_schema_version` | Pushed on every sync (§38.7.2) |
| `client_app_version` | Pushed on every sync |
| `offline_grace_expires_at` | The device's grace window, as the server understands it (§38.16.2) |
| `time_anchor_offset_ms` | The server-issued clock offset applied to the device clock (§38.16.5) |

| Rule | Detail |
|---|---|
| Revocation kills sync too | A revoked device cannot push. Its queued mutations are **not** accepted and are **not** discarded — they are quarantined for owner decision (§38.30.2), because they represent real physical sales. |
| A revoked device's sales are still real | This is a deliberate, humane decision. Revoking a device stops future access; it does not pretend the goods were never sold. |
| Device identity change | Requires re-registration. The old identity is revoked, and its quarantined mutations must be resolved by the owner. |

---

## 13. Security model

### 13.1 Backend layers

| Layer | Control |
|---|---|
| Transport | TLS 1.2+ everywhere, HSTS, no plaintext fallback. |
| Password | Argon2id, per-user salt, constant-time verification (§10.2). |
| Sessions | Short-lived access token, rotating hashed refresh token, family revocation (§10.3). |
| Authorization | Server-side, permission catalog, owner-exclusive rules (§11). |
| Tenancy | Derived context plus forced RLS (§9.3, §8.2). |
| Validation | One global pipe: whitelist, forbid non-whitelisted, DTO-only (§34.2). |
| Rate limiting | Per-IP **and** per-user on auth endpoints; per-user on document creation. Configurable, fail-closed. |
| Error safety | No stack traces, SQL, or internal identifiers. Production errors carry a `traceId` only. |
| **Offline mutation authz** | An offline mutation is **re-authorized server-side at acceptance** against current permissions, never trusted from the device snapshot (§38.17, §38.19). |
| **Replay protection** | Every mutation carries `mutation_id`; the ledger is unique on (organization, mutation_id) and returns `REPLAY` for an identical resend (§38.9). |
| Secrets | Environment or secret manager only. Never in source, migration, fixture, or log. |
| Headers | `helmet`: CSP, `X-Content-Type-Options`, `Referrer-Policy`, HSTS. |
| Logging | Structured JSON, redacted by construction. Never logs tokens, passwords, or secret values. |
| Audit | Business history and security history kept separate (§32). |

### 13.2 Injection and query safety

Prisma parameterizes by default. Raw SQL only via tagged templates. The few dynamic
sort-column cases take identifiers from a **server-side allow-list**, never from client strings.

### 13.3 The client is hostile by assumption

The client holds a bearer token and a cache. It is never trusted for tenant identity,
permission, price, cost, balance, or stock availability. Every one of those is server-derived.

### 13.4 Least privilege — DECISION

Two distinct database roles:

- **Migrator** role — DDL + DML, used only by migration jobs, never by the running application.
- **Application** role — DML only, subject to `FORCE ROW LEVEL S`, without `BYPASSRLS`.

The application never connects as the table owner.

### 13.5 Rate-limit and abuse posture

Authentication endpoints are the primary abuse target. Limits bind per-IP **and** per-user, with
the tighter of the two applying. Limit responses are `429` with `Retry-After`, and limit events
write a security audit event.

### 13.6 Secrets handling — DECISION

Secrets live in the deployment environment or a secret manager. `.env` files are git-ignored;
only `.env.example` containing safe placeholders is committed. CI fails on a secret-scanner
finding in any diff.

**Client-side secret storage is fail-closed.** If the platform secure store is unavailable, the
app refuses to persist the token rather than falling back to plaintext. The legacy XOR
obfuscation fallback is `DO_NOT_COPY` by name.

### 13.7 Threat model under offline operation — DECISION (added by M0-P2)

Offline capability introduces a device that holds unsynced business records. This section states
the new threats and their planned mitigations. **Nothing here is implemented.**

| Threat | Planned mitigation | Residual risk |
|---|---|---|
| **Cashier manipulates offline state** to hide or inflate sales | Local audit log is append-only; server re-derives everything from immutable events (§38.24.1); mutation payloads are never rewritable (§38.8.2); outbox has no cashier-facing delete (§38.30.1) | A cashier with local database write access can still tamper with rows, **but** the server's derived ledger and the device-attributed mutation ledger expose the divergence on sync. Detection is high, prevention on-device is not absolute. |
| **Duplicate replay** of a mutation to create value | Server mutation ledger, unique on (organization, mutation_id), returns `REPLAY` (§38.9). Ten replays, one effect. | None material. |
| **Idempotency bypass** — reuse a `mutation_id` with a different payload | `payload_hash` comparison yields `409 MUTATION_CONTRADICTION` plus a security event (§38.9.2, §38.27) | Requires the attacker to control the device. Detected, not prevented. |
| **Local database tampering** before sync | Server re-derives accounting from the event (§38.24); per-line snapshots carry `device_unit_cost_minor` beside the server's figure so divergence is visible (§38.24.3) | Tampering is **detected on sync**, not prevented on-device. Encryption at rest (O-18) raises the bar. |
| **Timestamp manipulation** | Business date derives from a server-issued time offset, not the raw device clock (§38.16.5); backward jumps blocked by a monotonic guard; forward jumps beyond tolerance require online re-validation | A device with a deliberately offset clock inside the tolerance window can misdate a sale by hours. Bounded and documented. |
| **Database file copied to another device** | Offline session is bound to `installation_id` and fails the device-binding and signature checks (§38.16.2, §38.16.3) | The **data** remains readable if the file is not encrypted. This is the strongest argument for O-18. |
| **Stolen device** | App lock (§14), OS device credential, device revocable remotely (§12.5) | Offline sales committed before revocation remain committed. Bounded by the grace window. |
| **Stale permissions** used offline | Snapshot is signed and versioned; server re-authorizes at acceptance (§38.17, §38.19); drift flagged | **A revoked permission can still be used offline for up to the grace window.** Accepted, bounded risk R-15. No offline system can do better. |
| **Revoked user or device keeps selling** offline | Cannot be detected without connectivity. Bounded by grace expiry and by immediate effect on reconnect (§38.16.4) | Accepted, bounded risk R-14. Stated plainly rather than papered over. |
| **Mutation forging** — crafting a plausible sale payload | Server re-validates the stock guard, the pricing mode, discount ceilings, and permissions against current server state (§38.19); a forged oversell is rejected or flagged | A device can forge *plausible* sales. That is inherent to offline operation: the cashier physically controls the goods. Accountability is the control, not prevention. |
| **Barcode spoof or mistype** | Barcode resolves to a sellable variant; the stock guard still applies; auto-generated internal barcodes are collision-protected (§15.3A); a wrong scan produces a wrong but **audited** sale | A mistyped barcode selling the wrong item is a **training** problem, mitigated by variant naming and the scan-then-confirm flow. Not a security hole. |
| **Stock-correction abuse** — adjusting stock up to sell beyond the guard | Adjustments require permission, are reason-coded, actor-attributed, and immutable; a spike in adjustments is reported (§38.5, §38.31.1) | An authorized user can adjust stock. That is the legitimate mechanism (§38.5); the control is audit and visibility, not prohibition. |
| **Queue deletion** to erase a sale | No delete path exists in the UI or API; governed repair requires owner-exclusive permission, exports first, and emits a `security_event` (§38.30.2) | A determined user with database access could still delete rows. Server-side divergence detection exposes it on sync. |
| **Sync-storm / resource exhaustion** | Batching (§38.10.1), bounded page sizes (§38.11.2), backoff with jitter, `Retry-After`, `change_log` retention window, outbox compaction with a retained audit floor (§38.25 F-17) | A permanently failing device retries indefinitely at bounded rate. Owner-visible via the console. |
| **Pull poisoning** — a malicious server response | The client trusts the server's TLS-authenticated responses; a `server_sequence` regression is discarded (§38.12.1) | Out of threat scope: compromising the server compromises everything. |

**Statement of limits.** Offline POS means the device is briefly a trusted participant. This plan
does **not** claim to prevent a compromised device from attempting fraud; it claims to make every
such attempt **attributable, bounded in time, and detectable on reconciliation**. That is the
honest achievable goal.

---

## 14. App lock and local authentication model

### 14.1 DECISION

Optional per-device app lock, enabled by the Owner, using **operating-system device
authentication**. My Shop stores **no** credential of its own.

| Rule | Detail |
|---|---|
| Mechanism | Platform device-authentication API (for example `local_auth`). |
| **No custom PIN** | **No My Shop PIN, pattern, or password is created or stored in V1.** |
| **No biometric templates** | **No biometric template is ever stored by My Shop, directly or via a third party.** |
| **No transmission** | **Biometric results and device PINs/passwords are NEVER sent to the backend.** |
| Delegation | Authentication is performed entirely by the OS secure APIs. My Shop receives only a success/failure boolean. |
| Fallback | OS device credential (PIN / pattern / password) where biometrics are unavailable or unenrolled. |
| Degradation | If the OS cannot perform device authentication, app lock **MUST NOT** silently disable itself; the owner sees an explicit error. |
| Storage | A local arming flag in platform secure storage. |

**What the backend learns:** only that device *X* is active and was last seen at time *T* —
which it already infers from authenticated traffic. No new information crosses the network, so
there is no biometric-derived secret to protect in transit or at rest.

### 14.2 Threat boundaries — stated honestly

| Protects | Does **not** protect |
|---|---|
| Casual access to an unattended, already-running device. | A determined attacker with the unlocked OS session and a debugger. |
| Casual disclosure of business data on a shared counter PC. | Malicious software already running as the same OS user. |
| Daily fingerprint / face convenience. | Server compromise, or anyone holding the OS credentials. |

**Stated limitation:** app lock is a convenience and casual-deterrent control. It is **not** a
security boundary against a hostile OS user, and it is not a substitute for §13. Documenting
this honestly prevents app lock from being mistaken for a compensating control during a
security review.

### 14.3 Client secret storage

Tokens live in the platform secure store: Android Keystore-backed encrypted preferences;
Windows DPAPI through a maintained plugin or a compiled native helper — **never** a PowerShell
shell-out. Fail-closed per §13.6.

---

## 15. Products and inventory

### 15.1 Product model — DECISION

A product carries: identity (`organizationId`, `sku`, `nameAr`, `nameEn`), a selling unit
(§15.2), a **selling price** (§17), a **cost** maintained by the costing engine (§30), quantity
per location, an active flag, and a soft-delete with a recorded reason.

The legacy absence of any product selling price is treated as a **defect**, not a starting
point: prices were typed by the operator on every cart line, defaulting to zero.

### 15.2 Units — DECISION

`ProductUnit` carries a code, a name, and a `baseQuantityFactor` for purchasing units (a carton
of 12 has factor 12). Sales and stock are held in **base units**; purchase units convert on
receipt. V1 supports a base unit plus at most one purchasing unit per product. Bills of
materials and multi-level conversions are deferred (§4).

### 15.3 Barcodes

Multiple barcodes per product (`product_barcodes`), **unique per organization** (§9.2 T-7).
Scanning resolves to a product within the active organization. An unknown barcode creates a new
product only with `catalog.edit`.

**Superseded and expanded by §15.3A**, which is the governing barcode and variant model.

### 15.3A Product, variant, SKU and barcode model — DECISION (added by M0-P2)

The M0-P1 barcode model was a single barcode attached to a product. That is **insufficient for
physical retail**, where the sellable and stock-tracked unit is often a variant. §15.3A is
governing; §15.3 is retained above as the superseded statement.

#### 15.3A.1 The four concepts, kept distinct

| Concept | Definition | Owns | Cardinality |
|---|---|---|---|
| **Product** | The conceptual item: *"T-Shirt"*. A grouping and naming entity. | Name, category, brand, images, description | 1 product → many variants |
| **Variant** (also the **sellable unit**) | A specific stock-tracked combination: *Black / XL*. **This is what is scanned, sold, and counted.** | SKU, barcode list, selling price, cost, stock, unit | 1 variant → many barcodes |
| **SKU** | The variant's stock-keeping code. **A business identifier, unique per organization.** Not a barcode and not a primary key. | — | 1:1 with the variant |
| **Barcode** | A **searchable identifier**, attached to a variant | Scan value, symbology, source | many:1 |

**Barcode is NOT the product primary key.** The product and the variant each carry an internal
UUID. This is a deliberate decision, not a preference:

| Reason | Detail |
|---|---|
| A barcode can change | Reprint, supplier change, damage, re-packaging |
| One variant can have several barcodes | Manufacturer, internal, legacy, case, shelf |
| Packaging differs | A case barcode and a unit barcode refer to different quantities |
| Variants differ | `T-Shirt / Black / XL` and `T-Shirt / Black / L` are different stock and must not share a balance |
| An internal barcode may be added later | To an existing variant that already has a manufacturer code |

#### 15.3A.2 Variant model — DECISION

| Rule | Detail |
|---|---|
| Stock is tracked per **variant**, never per product | A shop cannot hold "3 T-shirts" when the sizes differ. Collapsing them into one balance is how physical retail loses stock. |
| Every variant is independently sellable, priced, costed, and counted | §16.2 snapshots the variant, not the product |
| Optional attributes | Colour, size, and up to a small, owner-defined set. Kept as **typed attributes** on the variant rather than a rigid fixed schema, so a shoe shop and a grocery shop can both use it |
| Simple products | A product with exactly one sellable variant. The POS and the UI never require the user to think about variants when there is only one. |
| Non-stock-tracked variants | **Not in V1.** Every variant is stock-tracked. Services and untracked goods are future scope (§4). |
| Price and cost inheritance | A variant inherits the product's price and cost unless it overrides them. Set at the variant where the shop needs it. |

#### 15.3A.3 `product_barcodes` — the separate table, kept — DECISION

**Decision: yes, keep `product_barcodes` as a separate table rather than a single column on the
variant row.**

| Why | Detail |
|---|---|
| Multiple barcodes per variant | Manufacturer code, internal code, legacy code imported from a spreadsheet, case barcode, shelf barcode |
| Symbology | EAN-13, UPC-A, Code-128, and an internal format need different validation. A single string column cannot validate them. |
| Provenance | A barcode has a **source**: `MANUFACTURER`, `INTERNAL`, `LEGACY_IMPORT`, `CASE`, `CUSTOM`. Knowing which is which resolves most "which code do I scan?" confusion. |
| Collision policy | Uniqueness is **scoped and type-aware**: a manufacturer barcode and an internal barcode may legitimately share digits, so uniqueness is per (organization, symbology, normalized value). §15.3A.4. |
| Variant attachment | `product_barcodes.variant_id` — **not** `product_id`. This is the change that makes the clothing case correct. |

#### 15.3A.4 Barcode uniqueness and collision protection — DECISION

| Rule | Detail |
|---|---|
| Uniqueness scope | `(organizationId, symbology, normalizedValue)`. Per organization, per T-7. Never global. |
| Normalisation | Digits only for numeric symbologies; case-folded and trimmed for alphanumeric ones. Stored both raw and normalised so a scan of the printed value still matches. |
| No silent overwrite | A duplicate is rejected with a specific error naming the conflicting variant. **Never** silently reassigned, because reassignment would silently move stock between variants. |
| Collision protection | An index enforces uniqueness in the database, not only in the application. A CI test asserts the constraint exists (§36.4, I-16). |

#### 15.3A.5 Barcode input — four methods, all offline-capable — DECISION

| # | Method | Decision | Offline |
|---|---|---|---|
| 1 | **Auto-generated internal barcode** | Generated by the system for variants with no manufacturer code. | **Yes** — generation is local and deterministic (§15.3A.6). |
| 2 | **Phone camera scan** | Platform camera via a maintained scanning package. | **Yes** — decoding is entirely local. |
| 3 | **Hardware barcode scanner** | **Keyboard-wedge / HID input.** The scanner types the digits and presses Enter; the app treats that as a submit. | **Yes** — no vendor SDK, no driver, no network. |
| 4 | **Manual entry** | Typed digits, validated against the symbology. | **Yes** |

**Vendor independence is a hard requirement.** Method 3 **MUST NOT** depend on any single scanner
vendor's SDK or driver. A keyboard-wedge scanner works with the app because it is a keyboard, not
because of an integration. Any future vendor-specific SDK is additive and optional; the wedge path
is the baseline and can never be removed.

#### 15.3A.6 Auto-generated internal barcode — DECISION

| Property | Decision |
|---|---|
| Deterministic | **Yes**, for the offline guarantee. Derived from `organizationId` + `variantId` through a keyed hash, so the same variant always yields the same internal barcode on any device. A counter-based scheme would not be offline-safe. |
| Format | A documented internal prefix plus a fixed-width encoded payload, chosen so it does not collide with a real manufacturer symbology. The prefix makes a mis-scan obvious rather than silent. |
| Collision protected | Uniqueness is enforced by the same index as §15.3A.4. A generated collision is retried with a salt, and the event is audited. |
| Organization-scoped | The payload encodes the organization, so a barcode from one shop cannot resolve in another. This is the concrete fix for the legacy global-barcode defect (§5.4, D-9). |
| Changeability | Regeneration is possible for an internal barcode. A manufacturer barcode is never modified. |
| Printed | Printable on a shelf label or hang tag from the product screen, offline. |

#### 15.3A.7 Barcode resolution — DECISION

| Situation | Behaviour |
|---|---|
| Scan matches exactly one active barcode | The variant is added to the cart. The common path: one action. |
| Scan matches a case barcode | Adds the **case** quantity, using `baseQuantityFactor` (§15.2). |
| Scan matches nothing | **Refused by default** with a clear message. Creating a product requires `catalog.edit` and is an explicit action, never a side effect of a mis-scan. |
| Offline with no local copy of the variant | The scan is refused. The device cannot invent a variant it has never seen, and it does not defer the scan. The cashier uses manual entry or waits for sync. |
| Ambiguous match | Refused with both candidates named. Never resolved by guessing. |

**Barcode resolution requires no network** (§38.23.2, V1-39). A till that cannot scan because the
shop has no Internet is not a usable till.

### 15.4 Stock — DECISION, and an inversion of the legacy model

- `stock_levels` is a **derived, cacheable** quantity per (product, location).
- `stock_movements` is the **authoritative, append-only record** of every quantity change, with
  cause, actor, unit cost, and a reference to the originating document.

The legacy application stored quantity as a formula recomputed across six separate code paths
on the product row. That duplication is `DO_NOT_COPY`. In My Shop there is exactly one
authoritative quantity history, and the fast cached level is a pure function of it.

### 15.5 Stock movement causes — closed vocabulary

`SALE`, `SALE_RETURN`, `PURCHASE_RECEIPT`, `PURCHASE_RETURN`, `STOCK_COUNT_ADJUSTMENT`,
`MANUAL_ADJUSTMENT`, `OPENING_BALANCE`, `SHRINKAGE`, `TRANSFER_IN`, `TRANSFER_OUT`,
`REVALUATION`.

A new cause requires an explicit schema decision **and** an accounting mapping (§28.3). No
cause may be added without knowing which journal lines it produces.

### 15.6 Concurrency — DECISION

Every stock mutation is conditional, inside the document transaction:
`UPDATE ... WHERE organization_id = $1 AND product_id = $2 AND quantity >= $3`, with the
affected-row count checked. A zero-row result yields `409 INSUFFICIENT_STOCK`. Row `version`
optimistic locking covers read-modify-write spans.

This generalizes a pattern the legacy application already used correctly — conditional stock
decrement inside the invoice transaction — and the change is that it becomes the *only*
supported path.

### 15.6A The two stock guards — DECISION (added by M0-P2)

There are now **two** conditional stock guards, and they guard different things. This is the
single most important clarification in the amendment.

| Guard | Where | Guards against | Cannot guard against |
|---|---|---|---|
| **Local guard** (§38.4) | The device, inside the local transaction | The cashier selling more than **this device knows** it has | Another device having already sold the same units |
| **Server guard** (§15.6) | The database, inside the acceptance transaction | The authoritative quantity going negative **after** convergence | Anything at all while offline |

| Rule | Detail |
|---|---|
| The local guard is mandatory and non-bypassable | No permission, setting, or hidden flag overrides it (§38.4) |
| The server guard remains mandatory | Unchanged. An offline mutation is re-validated against the server's authoritative quantity at acceptance |
| If the server guard fails after convergence | The sale is **accepted** — goods changed hands — and an `INVENTORY_CONFLICT` is raised for reconciliation (§38.14.2). Rejecting it would leave the server holding a sale the shop has already performed, with no way to record it. |
| Neither failure is silent | Either guard failing is recorded, attributed, and owner-visible |

**Why both.** The local guard alone permits oversell during a multi-device outage. The server
guard alone blocks selling during an outage. Together, one prevents local error and the other
converges truth — which is the honest achievable position (§38.15).

### 15.7 Negative stock policy — DECISION

**Superseded by §38.4 and §38.5.** The `allow_negative_stock` organization setting is **removed
from V1**. Negative stock sales are forbidden unconditionally. That setting, which let an
organization permit negative stock, is precisely the "warning-only sale" and "automatic override"
behaviour the owner prohibited.

| Aspect | New decision |
|---|---|
| `allow_negative_stock` | **Deleted.** No setting, and no organization, may enable it. |
| Selling more than known stock | **Always rejected**, locally and on the server (§38.4). |
| Goods present but the system says zero | Correct stock first with a permissioned, audited, reason-coded adjustment (§38.5), then sell. |
| Fixing it through the sale | **Prohibited.** A sale never corrects a stock error. |
| Owner override | **None in V1.** There is deliberately no bypass, at any permission level. |

The remainder of this section is retained for the audit and exception-reporting context it
describes; where it describes permitting negative stock, §38.4 governs.

Organization setting `allow_negative_stock`, **default `false`**. When false, any movement that
would drive quantity below zero is rejected with `409 INSUFFICIENT_STOCK`. When true, the
movement is permitted and the negative quantity is surfaced as an exception in inventory
reporting. The setting is an organization-level pricing-risk decision, so only the Owner may
change it and the change is audited.

### 15.8 Stock counts

A stock count records counted quantities per location; posting it generates
`STOCK_COUNT_ADJUSTMENT` movements, a cost revaluation where applicable (§30.5), and the
corresponding ledger entries. A count is a document with an actor and an approval-free but
audited posting path.

---

## 16. Sales

### 16.1 Document model

`Sale` (header) + `SaleLine` (immutable snapshots) + `SalePayment` (allocation to financial
accounts). A sale is created **posted**. There is no persisted server-side draft sale; a draft
cart is client-local and explicitly not a business record (§6.10).

### 16.2 Line snapshot — DECISION (non-negotiable)

Every sale line persists, permanently:

`productId`, `productName` (as sold), `sku`, `barcode` (as scanned), `quantity`,
`baseQuantity`, `unitPriceList`, `unitPriceApplied`, `discountType`, `discountValue`,
`discountAmount`, `discountActorUserId`, `discountAuthorizationRef`, `lineTotal`,
`unitCostApplied`, `lineCogs`, `taxAmount` (reserved, zero in V1).

**Amendment note — variant identity.** A line snapshots the **variant**, not the product
(§15.3A): `variantId`, `productId`, the variant's attribute summary as sold (for example
"Black / XL"), plus `sku`. Product and variant both keep their internal UUIDs, and the barcode is
recorded as **scanned**, never as an identity (§15.3A.1). This is what makes an offline receipt
legible and a historical line correct when the variant is later renamed.

**Historical invoice truth is NEVER derived from a product's current price or current cost.**
This is a hard architectural invariant with a dedicated test suite (§36.4), because the legacy
application's most consequential defect was the absence of any price or cost history at all.

### 16.3 Sale lifecycle

`POSTED` → partially or fully `RETURNED` (§16.5) → optionally `CANCELLED` **by reversal only**
(§31.3). A posted sale's financial fields are never updated. A posted sale is never deleted.

### 16.4 Invoice numbering — DECISION AMENDED

> **Superseded by §16.4A.** Per-organization **gapless** numbering is **not achievable** when
> devices may sell for an unbounded period without connectivity. Retained below for its rationale,
> which remains valid for online sales.

Per organization, per year, **gapless and monotonic**, allocated inside the sale transaction
from `document_sequences`. Not epoch-based.

**RATIONALE (still valid for the online case).** The legacy scheme
`'INV-${DateTime.now().millisecondsSinceEpoch}'` could collide within a single millisecond — and
it did so by surfacing an unhandled database exception to the operator — had no per-organization
sequencing, and left gaps with no meaning. A shop that hands a customer invoice *N* must never
later find that *N* is ambiguous.

### 16.4A Offline-safe document numbering — DECISION (added by M0-P2)

#### 16.4A.1 The honest problem

**Gapless per-organization numbering cannot be guaranteed together with unbounded offline
availability.** This is stated plainly rather than papered over with a clever scheme.

The impossibility: a gapless sequence requires the server to know, at the moment of printing,
which number is next. Offline, the server cannot know. The shop must choose between:

- **Waiting for the server** before printing — which is exactly the cashier dead-end the owner
  prohibited. **Rejected.**
- **Claiming numbers speculatively** — a gapless sequence with speculative claims produces gaps
  exactly when a reservation is abandoned. The gaplessness guarantee is false by construction.

**Therefore: gaplessness is not a V1 guarantee. Uniqueness, monotonicity, and durability are.**

#### 16.4A.2 Recommended design — reserved number blocks plus a local receipt identity

Two identifiers, each with a clear job. Neither is "the invoice number" alone.

| Identifier | Assigned | Purpose | Visible to customer? |
|---|---|---|---|
| **Offline receipt identity** | **By the device, at commit, offline** | Identifies the transaction on the printed receipt with no server involvement. Fully durable and immediate. | **Yes, on the offline receipt.** |
| **Invoice number** | **By the server, at acceptance** | The legal/accounting document number. Assigned when the mutation is accepted. | On the final invoice if one is issued. |

##### Device-assigned receipt identity

| Property | Decision |
|---|---|
| Format | `{orgShort}-{deviceShort}-{deviceLocalSequence}`, for example `SH-03-000041` |
| Uniqueness | Guaranteed by (organization, device, gap-free per-device sequence) (§38.10.2). Two devices cannot collide because the device component differs. |
| Determinism | Assigned **inside the local transaction**, so a rolled-back sale does not consume a number |
| Business date | Uses the server-issued time offset (§38.16.5) |
| Human-readable | Short enough to print on a thermal receipt and to read aloud over the phone |
| Meaning | *"Till 3, sale 41."* Immediately meaningful to the shop, with no server lookup |

This is what makes an offline receipt **valid and useful on its own** (§38.23.2).

##### Server-assigned invoice number at acceptance

| Property | Decision |
|---|---|
| Assigned | In the acceptance transaction, from `document_sequences`, **only if the organization has no reserved blocks** |
| Never renumbers a printed receipt | If a customer holds `SH-03-000041`, that identity **never changes** |
| Reconciliation | The server holds both: the receipt identity and the invoice number. The mapping is permanent and audited. |
| Customer-facing invoice | If the shop needs a formal invoice, it is issued at acceptance or later, bearing the invoice number, and referencing the receipt identity. **Printing a different number later is a reconciliation event, not a silent rewrite.** |

##### Reserved number blocks — evaluated, and rejected as the primary mechanism

| Aspect | Assessment |
|---|---|
| How it works | The server allocates a range (for example 1000–1999) to a device; the device numbers within it and requests more. |
| Advantage | Offline numbers look like ordinary invoice numbers. |
| **Disadvantage 1** | **Blocks accumulate.** A device that sells 3 items while offline "uses" 3 numbers from its block even though only 1 invoice exists. |
| **Disadvantage 2** | **Reallocation is messy.** Two devices' blocks must be tracked, expired blocks reclaimed, and abandoned tails handled. |
| **Disadvantage 3** | **It fakes the guarantee.** Numbers within a block are locally assigned, so gaplessness was never real — it is only more convincing-looking. |
| **Verdict** | **Rejected as the primary mechanism.** Retained as an optional organization setting for shops whose legal requirements demand an invoice-**looking** number on the offline receipt. When enabled, it is a **presentation** choice layered over the receipt identity, and the underlying uniqueness guarantee is unchanged. |

**Explicitly rejected: renumbering after sync.** Issuing a receipt with number A and replacing it
with number B after sync is rejected outright. A customer who walked away holding A now holds a
document that no longer exists. It destroys customer trust and complicates returns. The receipt
identity is permanent (§16.4A.2).

#### 16.4A.3 Net guarantee statement

| Guaranteed | Not guaranteed |
|---|---|
| **Uniqueness** of every document identity, forever | Gaplessness |
| **Monotonicity** per device and per organization | Continuous availability of an invoice number while offline |
| **Durability** before printing | That a printed receipt bears a number assigned by the server |
| **A permanent, auditable mapping** from receipt identity to invoice number | |
| **No duplicate** and **no reuse**, tested | |

**This is stated as a deliberate, accepted trade: availability for the cashier in exchange for
gaplessness in the accounting sequence.** Given the owner's requirement that the shop must never
stop selling, that trade is correct. Recorded as **ADR-040**.

### 16.5 Payment allocation

A sale MAY be settled by multiple payments across financial accounts (for example EGP 800 cash
plus EGP 200 Vodafone Cash). `sale_payments` records each allocation with its account and its
actor. The sum of payments is validated against the total; the residual becomes a customer
credit (§19) only when organization policy permits a customer on the document (§19.1).

### 16.6 Concurrency

The sale transaction locks the touched stock rows in a deterministic order (sorted by variant id)
before applying movements, so two concurrent sales of the same variant cannot deadlock and cannot
both observe the same availability.

### 16.7 Void, return, reversal — DECISION (added by M0-P2)

Offline capability makes it tempting to allow a sale to be "un-done" locally. The rules are
strict, because a completed sale is a **business event**, not a UI state.

| Correction | When allowed | Mechanism | Deleted? |
|---|---|---|---|
| **Void** | **Only before finalization** — while the sale is still local and uncommitted | Discard the local transaction. No business record was ever created, so there is nothing to reverse. Nothing enters the outbox. | Nothing existed |
| **Return** | After finalization, for goods coming back | `sale_return` document, reversing stock at the original cost (§30.4), reversing the ledger via a new posting (§31.3) | **Never** |
| **Reversal** | For a financial correction | A reversing journal entry referencing the original (§31.3) | **Never** |
| **Corrective document** | For anything else | A new, attributed, reason-coded document | **Never** |

| Rule | Detail |
|---|---|
| **DELETE is prohibited** as an accounting correction | Unchanged (§31.3, §16.3). A completed sale is never deleted, online or offline. |
| Offline void boundary | A sale that has been committed locally and shown to the cashier is **finalized** and can only be returned. "Uncommitted" means the local transaction has not yet committed (§38.7). |
| Offline return boundary | Permitted only with an identified original sale locally (§38.23.1) |
| Reason code | Every void, return, and reversal carries one, and every one is audited (§38.28) |
| Attribution | The correcting actor is recorded **separately** from the original actor (§23.1), so "who sold it" and "who took it back" are never conflated |
| Stock effect | A return always restores stock at the original line's cost. A void never touches stock, because it never touched it. |

**The cashier cannot delete a finalized sale.** There is no UI affordance and no API for it
(§38.30.1). This is the offline equivalent of the M0-P1 immutability rule, and it is enforced by
the same discipline.

---

## 17. Pricing modes — DECISION

Organization-level setting `pricing_mode`, one active value per organization, read from typed
settings **on the server** (§22).

### 17.1 `FIXED`

- The product selling price is authoritative.
- A user without `pricing.override` **MUST NOT** be able to alter the unit price. The client
  renders a read-only field with no spinner.
- The server rejects any `unitPriceApplied` differing from `unitPriceList` when the actor lacks
  `pricing.override`, returning `403 PRICE_OVERRIDE_FORBIDDEN`.

### 17.2 `VARIABLE`

- Any user holding `sales.create` may enter a price.
- `unitPriceList` still snapshots the product price; `unitPriceApplied` records what was charged.
- Selling below cost is permitted but **flagged**, and the flag is reported in salesperson
  reporting (§23). Optional organization setting: warn only, or require `pricing.override`.

### 17.3 `FIXED_WITH_DISCOUNT`

- The base price stays fixed; the applied price is derived from the discount (§18).
- A user without discount authority cannot reduce the effective price at all.

### 17.4 Enforcement — DECISION

The server recomputes and validates the effective price from the stored product price, the
pricing mode, and the actor's permissions. The client's computed price is an untrusted hint and
is never the basis of a financial value.

**Amendment note.** Offline, the enforcement point moves to the device, using the **signed,
versioned cached settings** (§38.19). The server re-validates on sync. Availability is preserved:
a stale price never blocks a completed physical sale — it produces a flagged exception instead.

### 17.5 Future price lists

Price lists, tiers, and time-based pricing are deferred (§4). The `unitPriceList` snapshot field
is the extension point: a future price-list engine changes only how `unitPriceList` is
*resolved*, never how it is *recorded*.

---

## 18. Discounts

### 18.1 DECISION

Discounts are first-class, permission-controlled, fully snapshotted, and never applied by
mutating a stored price.

| Type | Value field | Semantics |
|---|---|---|
| `PERCENTAGE` | `percentage` (0–100) | Applied to `unitPriceList`. |
| `FIXED_AMOUNT` | `amountMinor` | Subtracted from `unitPriceList`. |
| `FIXED_PRICE` | `amountMinor` | The applied price is exactly `amountMinor`. |

### 18.2 Authority — DECISION

Organization settings define the policy:

| Setting | Meaning |
|---|---|
| `max_discount_percentage` | Hard ceiling for `PERCENTAGE`. |
| `max_discount_amount_minor` | Hard ceiling for `FIXED_AMOUNT` and `FIXED_PRICE`. |
| `discount_approval_threshold_minor` | Optional: discounts above this require an approver. |
| `discount_allowed_for_salesperson` | Whether the `Salesperson` preset may apply any discount. |

Server-side resolution order:

1. Load the organization discount policy.
2. Resolve the actor's effective permissions (role, then overrides).
3. Discount above the organization ceiling → `403 DISCOUNT_LIMIT_EXCEEDED`.
4. Discount beyond the actor's authority → `403 DISCOUNT_FORBIDDEN`.
5. Discount above the approval threshold, by a non-approver → **rejected** with
   `403 DISCOUNT_APPROVAL_REQUIRED`. The default is rejection, **not** a silently pending sale:
   a pending cash sale is a cash-handling hazard.
6. Compute `discountAmount` in minor units with explicit rounding (§30.2).
7. Persist `discountActorUserId` and `discountAuthorizationRef` on the line (§16.2).

### 18.3 Auditability

`discountActorUserId` and `discountAuthorizationRef` are immutable line fields, surfaced in the
discount report (§33.2). An exception approval, when an organization enables the gate, is itself
an audited action by the approver.

### 18.4 Discount above cost

An organization setting `block_discount_below_cost` (default **false**) blocks discounts that
would take the applied price below `unitCostApplied`. When false, such lines are permitted and
flagged for the gross-margin report (§33.2).

---

## 19. Customers

### 19.1 Customer on a sale — DECISION

Organization setting `customer_required_on_credit_sale` (default **true**) makes an identified
customer **mandatory** whenever a sale is not fully settled at the point of sale. For a fully
settled cash sale, the customer is **optional** — which is the common case and must stay fast.

A fully settled cash sale with no customer creates no receivable and no party record.

### 19.2 Customer ledger — DECISION

A customer has an `opening_balance` set at creation, expressed as a signed minor-unit amount
with a documented sign convention (debit-positive = owed to the business).

The **authoritative** balance is the sum of `customer_ledger_entries`: an append-only ledger of
every document and settlement affecting the customer. A cached `balance` column exists for
read performance and **MUST** be recomputed from the ledger, never maintained by an independent
mutation path.

This is a direct rejection of the legacy absence of any customer balance or history.

### 19.3 Transactions affecting a customer

| Event | Effect |
|---|---|
| Sale with customer, unpaid portion | Debit: amount receivable |
| Sale with customer, fully settled | No receivable effect |
| Customer collection | Credit: reduces receivable |
| Sale return | Credit: reduces receivable (or reverses against the original invoice) |
| Opening balance | Debit or credit as configured |
| Write-off (if enabled) | Credit, `sales.write_off` permission required |

**No mutable total without a transaction history** is a hard rule. A balance that cannot be
explained line by line is a defect.

---

## 20. Receivables

### 20.1 DECISION

Receivables are a **derived view of the customer ledger**, never an independently maintained
table. `receivables` in reports is `SUM(debit − credit)` grouped by customer, filtered to
unsettled invoices.

### 20.2 Aging

Aging buckets (current, 1–30, 31–60, 61–90, 90+) are computed from the invoice's due date,
grouped by the **invoice**, then summed per customer. Aging is **read-only in V1** — no dunning
workflow, no automated reminders, no credit holds. Those are future scope (§4).

### 20.3 Ledger is authoritative

If the customer ledger and any cached total ever disagree, the ledger wins and the cached total
is rebuilt. A reconciliation test asserts equality after every test-suite fixture run.

---

## 21. Invoice output behaviour

### 21.1 DECISION — output is separate from completion

A sale is durable the moment it is committed. Producing an external document is a **separate,
optional** step:
| Option | Effect |
|---|---|
| Print | Opens the platform print flow. |
| Save / export | Writes a file to a user-chosen location, or invokes the platform share sheet on Android. |
| Both | Print and save. |
| **Neither** | **The sale is still fully durable and still affects everything.** |

**Choosing "neither" MUST NOT mean the sale disappears.** It remains stored and continues to
affect inventory, customer balance, financial accounts, accounting, reports, and audit history
without exception.

### 21.2 Default behaviour — DECISION

Organization setting `invoice_output_default`, one of `ALWAYS_ASK`, `PRINT_AUTOMATICALLY`,
`NO_AUTOMATIC_OUTPUT`. Default `ALWAYS_ASK`.

Explicitly: the default governs **presentation**, never durability. There is no organization
setting, and no configuration of any kind, under which failing to print discards or defers a
sale.

### 21.2A Offline invoice output — DECISION (added by M0-P2)

**Output behaviour is unchanged by offline operation.** The M0-P1 separation of completion from
output is preserved exactly, because it is what makes offline selling safe.

| Requirement | Offline behaviour |
|---|---|
| The sale completes offline | Yes (§38.7) |
| Print, when a printer is available | **Yes. Printing never depended on connectivity and still does not.** |
| Save a local copy | Yes, written in the same local transaction (§38.7.1) |
| Choose "neither" | Yes, when `invoice_output_default` allows. **The sale is still fully durable** (§21.1). |
| Printer unavailable | The sale is unaffected. The "neither" path applies, or the receipt is saved locally for later printing. |
| Reprint a receipt | Always available from the local database, offline (§38.22 Tier 1) |
| **Printed total = persisted sale total** | **Unchanged and enforced offline** (§21.4). Both come from the same committed local transaction, so they cannot disagree. |
| Receipt identity | Uses the device-assigned receipt identity (§16.4A.2), not a server invoice number |

**The invariant is stronger offline, not weaker.** Online, a print failure could in principle
leave the screen and the document disagreeing. Offline, both are read from one committed
transaction, and `printed total == persisted total` is asserted by test (§38.26 T-O9).

### 21.3 Platform reality

| Action | Windows | Android |
|---|---|---|
| Print | Native print dialog. | Native print dialog. |
| Save to file | Native save dialog to a chosen path. | Platform share sheet. |
| Share | Platform share sheet. | Platform share sheet. |

**DECISION, recorded for later slices:** on Windows, printing while the app window is closing
requires explicit handling of the window-close / print-dialog interaction. A naive
implementation risks destroying the platform channel while a print call is in flight. This is
known from the legacy application's custom `WM_CLOSE` workaround. My Shop **MUST** solve this
with maintained plugin behaviour and an integration test on Windows, **not** by copying a Win32
hack from the legacy `windows/runner/` directory.

### 21.4 The rendering invariant — DECISION (reused principle, §5.3)

**The printed total is the persisted document total. Rendering logic never recomputes a
financial total.** Any recomputation is permitted only in an explicit invariant assertion:
`Σ lineTotals == documentTotal`. A rounding or presentation difference between the screen, the
PDF, and the thermal receipt is a defect.

### 21.5 Invoice content

Organization name and logo, sequential invoice number and date (§16.4), customer when present,
line snapshot data (§16.2), subtotal, discount, total, payment allocation summary, and a
footer from organization settings. Arabic-first RTL rendering. Optional tax block is reserved
and hidden in V1.

---

## 22. Organization settings — DECISION

### 22.1 Typed, not key-value

Settings are **typed columns or typed rows validated by the service layer**, not a free-form
key-value table. Critical financial behaviour **MUST NOT** depend on unvalidated string keys.

Each setting declares: type, default, validation rule, which permission changes it, and whether
changing it is audited.

### 22.2 Setting inventory

| Setting | Type | Default | Permission |
|---|---|---|---|
| `organization_name` | string | required | `settings.edit` |
| `currency` | enum (V1: `EGP` only) | `EGP` | `settings.edit` |
| `minor_unit_exponent` | int | `2` | owner-exclusive |
| `display_numerals` | enum | `WESTERN` | `settings.edit` |
| `pricing_mode` | enum | `FIXED` | `pricing.policy.edit` |
| `max_discount_percentage` | decimal(5,2) | `0` | `pricing.policy.edit` |
| `max_discount_amount_minor` | bigint | `0` | `pricing.policy.edit` |
| `discount_approval_threshold_minor` | bigint, nullable | `null` | `pricing.policy.edit` |
| `discount_allowed_for_salesperson` | bool | `false` | `pricing.policy.edit` |
| `block_discount_below_cost` | bool | `false` | `pricing.policy.edit` |
| `invoice_output_default` | enum | `ALWAYS_ASK` | `settings.edit` |
| `invoice_footer` | text | empty | `settings.edit` |
| `invoice_show_logo` | bool | `true` | `settings.edit` |
| `customer_required_on_credit_sale` | bool | `true` | `settings.edit` |
| `allow_negative_stock` | bool | `false` | owner-exclusive, audited |
| `rounding_mode` | enum | `HALF_UP` | owner-exclusive |
| `app_lock_enabled` | bool, per device | `false` | owner, per device |
| `receivables_aging_enabled` | bool | `true` | `settings.edit` |
| `feature_flags` | typed rows | empty | owner-exclusive |

**Consequence:** changing `pricing_mode` or a discount ceiling takes effect on the next
transaction and is recorded in the audit trail with actor, old value, and new value.

### 22.3 Settings are never cached as authority

The client caches settings for rendering speed, but the server reads them from the database on
every transaction that depends on them. A stale client setting can produce a stale *affordance*,
never a stale *posted value*.

**Amendment note.** Offline, this becomes "cached but versioned and bounded" rather than "cached
for speed". See §38.18: settings carry `settings_version`, the client may only **read** them, a
stale policy never blocks a completed sale, and a device with no cached settings at all must not
sell.

### 22.4 Settings added or changed by the M0-P2 amendment

| Setting | Type | Default | Permission | Purpose |
|---|---|---|---|---|
| `offline_grace_duration` | duration | **72 hours** | owner-exclusive | Maximum offline mutation window (§38.16.2). Max 30 days |
| `offline_receipt_id_format` | enum | `ORG-DEV-SEQ` | `settings.edit` | Presentation format of the device receipt identity (§16.4A.2) |
| `offline_reserved_number_blocks` | bool | `false` | `settings.edit` | Optional invoice-**looking** numbers offline. Rejected as a primary mechanism (§16.4A.2) |
| `reserved_block_size` | int | `1000` | owner-exclusive | Only meaningful when the above is enabled |

**Removed by the M0-P2 amendment:** `allow_negative_stock` (§15.7). Negative stock sales are
unconditionally forbidden (§38.4).

`offline_grace_duration` is **owner-exclusive** because an unbounded offline window is a direct
authorization-bypass vector (§38.16.4).

---

## 23. Sales attribution and salesperson reporting

### 23.1 Attribution fields — DECISION

Every sale, sale line, and sale payment carries its own actor column. They are **not** assumed
to be the same person.

| Field | Meaning |
|---|---|
| `sales.createdByUserId` | The **salesperson / sale creator**. |
| `sale_payments.collectedByUserId` | The **cashier / payment collector**. |
| `sale_returns.createdByUserId` | The user creating the **return**. |
| `sale_lines.discountActorUserId` | The user **granting the discount**. |
| `settings.updatedByUserId` | The user **changing controlled settings**. |
| **`sales.deviceId`** | **Which terminal** performed the sale (§38.30). |
| **`sales.originatedOffline`** | Whether the sale committed with no connectivity. |
| **`sales.localCreatedAt`** | Device event time, with the server time offset applied (§38.16.5). |
| **`sales.deviceLocalSequence`** | Gap-free per-device ordering (§38.10.2). |
| **`sales.serverReceivedAt`** | Server clock, set at acceptance. **Null while unsynced.** |
| **`sales.syncState`** | The sync lifecycle state (§38.13). |

The organizing principle, from the product requirement:

> **Never assume that the person who originally sold an invoice is the person who later
> collects an accounts-receivable payment.**

A sale made by Mohamed on Monday and collected by Yasser on Friday is attributed to Mohamed as
the salesperson, to Yasser as the collector, and the collections figure belongs to Yasser only.
Every future extension of this model follows the same rule: **actor and collector are separate
fields, not one inferred value.**

#### 23.1.1 Offline attribution — DECISION (added by M0-P2)

Offline **MUST NOT** reduce accountability. It increases it, because the device now records more
than the server ever could have inferred.

| # | Requirement | Satisfied by |
|---|---|---|
| 1 | The sale knows its organization | Device binding, re-validated server-side (§9.4 T-9) |
| 2 | The sale knows its device | `sales.deviceId`, from the installation, not user input |
| 3 | The sale knows its cashier | `createdByUserId` from the signed grace record (§38.16.3) |
| 4 | Salesperson and collector remain separate if distinct | Unchanged (§23.1) |
| 5 | The sale carries a local timestamp | `localCreatedAt`, server-offset corrected (§38.16.5) |
| 6 | The sale carries a server-received timestamp | `serverReceivedAt`, set at acceptance |
| 7 | The sale carries its sync state | §38.13 |
| 8 | The sale records that it originated offline | `originatedOffline` |
| 9 | Corrections link back to the original | `reversesSaleId`, `reversesMutationId` (§16.7) |
| 10 | The cashier cannot edit any of the above | §38.30.1 |

**The excuse "there was no network" is eliminated as a category.** The record exists on the
device, attributed and timestamped, before the receipt prints. The sync state tells the owner how
long it has been unsynced; it never questions whether it happened.

#### 23.1.2 The cashier-exposure metric

`oldest_pending_mutation_at` (§12.5) answers the only operational question that matters during an
outage: *how long has the shop been trading on unsynced records?* It is the first tile in the sync
console (§38.31.1) and the primary alert target.

### 23.2 Salesperson report — DECISION

The Owner can produce a monthly salesperson report of the form *"Mohamed sold EGP 100,000 this
month."* The detailed report shows, per user, over a selectable period:

| Metric | Definition | Source |
|---|---|---|
| Gross sales | `SUM(lineTotal)` before discount | `sale_lines` |
| Invoice count | `COUNT(DISTINCT sales.id)` | `sales` |
| Returns value | `SUM(sale_return_lines.lineTotal)` by return actor | `sale_return_lines` |
| Discounts | `SUM(discountAmount)`, broken down by actor | `sale_lines` |
| Net sales | Gross − returns | derived |
| Cash collected | `SUM(sale_payments.amountMinor)` by **collector** | `sale_payments` |
| Credit sales | `SUM(amountDue)` | `sales` |
| **Collections (AR)** | `SUM(customer_ledger_entries.amountMinor)` by **collector**, credit-side | `customer_ledger_entries` |
| Average ticket | Net sales ÷ invoice count | derived |
| Gross profit / margin | `SUM(lineCogs)` vs `SUM(lineTotal)` — **only** with `accounting.view` | `sale_lines` |

**Cash collected and credit sales are reported by collector; gross sales, returns and discounts
are reported by salesperson.** These are separate, separately filtered columns — never one
combined figure.

### 23.3 Authorization

Viewing another user's figures requires `sales.viewAll`. Gross profit and margin additionally
require `accounting.view`. A salesperson may always see their own figures.

### 23.4 Derived, not maintained

**Every metric above is derived from transaction and ledger rows at query time.** No dashboard
total, materialized summary, or stored KPI is authoritative. Reporting is a read model over
`salps`, `sale_lines`, `sale_payments`, and `customer_ledger_entries`, so it cannot drift from
the transactions it describes.

---

## 24. Suppliers

### 24.1 DECISION

A supplier has: identity, contact details, an `opening_balance` with a documented sign
convention (credit-positive = the business owes the supplier), an active flag, and a
`supplier_ledger_entries` append-only ledger. A cached balance column is derived and
reconcilable, exactly as for customers (§19.2).

### 24.2 Operations

| Operation | Permission |
|---|---|
| Create / edit supplier | `suppliers.edit` |
| Set opening balance | `suppliers.edit`, audited |
| View statement | `suppliers.view` |
| Pay supplier | `suppliers.pay` |

### 24.3 Statement

A statement lists every purchase, payment, return, and opening balance affecting the supplier in
date order, with a running balance and a closing balance. It is a direct projection of the
ledger, never a separately maintained figure.

---

## 25. Purchases

### 25.1 DECISION

Purchases mirror sales in structure but stay deliberately simpler. A purchase is one
document, received once. There is no purchase order workflow, no goods-receipt matching, and no
multi-level approval in V1 (§4).

### 25.2 The canonical simple purchase

The product requirement, end to end:

> Purchase inventory for EGP 20,000. Pay EGP 5,000 from Treasury. Leave EGP 15,000 payable.

The user performs **two** operations and never sees a debit or a credit:

1. **Record the purchase** — EGP 20,000 from Supplier X, received into stock. The system
   automatically: increases stock, adds to inventory cost at the new weighted average (§30.3),
   credits Accounts Payable EGP 20,000, and debits Inventory EGP 20,000.
2. **Pay the supplier** — EGP 5,000 from Treasury. The system automatically: debits Accounts
   Payable EGP 5,000, credits Treasury EGP 5,000.

Payables now stand at EGP 15,000, derived from the ledger.

### 25.3 Why this matters

**The user MUST NOT be required to create or understand accounting entries for a routine
operation.** The system generates them. This is the concrete mechanism by which §2.1 is
enforced rather than merely stated.

### 25.4 Purchase lines — DECISION

`purchase_lines` snapshots, per line: `productId`, product name, quantity in base units, unit
cost applied, line total, and the resulting moving-average cost after receipt (§30.3). Cost is
snapshotted because historical purchase cost is audit evidence, and because the moving average
changes on every receipt.

### 25.5 Receipt into stock

Receiving a purchase line creates `PURCHASE_RECEIPT` stock movements, updates the moving
average (§30.3), and posts the ledger lines (§28.3). Partial receipt is **not** supported in V1;
a purchase is received in full at the moment it is recorded.

### 25.6 Purchase payments

`purchase_payments` allocates a payment from one or more financial accounts against the
supplier payable, carrying `createdByUserId` (the payer) and an optional
`approvedByUserId` when organization policy requires approval above a threshold. Partial
payments are first-class.

### 25.7 Purchase returns

`purchase_returns` reduce stock (`PURCHASE_RETURN`) and reduce the payable, at the cost recorded
on the original purchase line (§30.4). Where the original line cannot be identified, the return
requires an explicit cost and `inventory.adjust` permission, and is audited as a variance.

---

## 26. Payables

### 26.1 DECISION

Payables are a **derived view of the supplier ledger**, exactly as receivables are of the
customer ledger (§20.1). No independently maintained payable table exists.

A purchase increases the payable by its unpaid amount; a payment decreases it; a purchase
return decreases it; an opening balance sets it. Outstanding payables per supplier are
`SUM(credit − debit)` over unsettled purchases, grouped by supplier.

**Amendment note — offline.** Purchases and supplier payments are **Tier 3, online only**
(§38.22). This is a deliberate limitation with a specific reason: a purchase receipt changes the
**moving weighted average** (§30.2), a cumulative shared calculation. Allowing devices to compute
it independently and reconcile afterwards would put costing integrity at risk. Raised for the
owner as O-17.

---

## 27. Financial accounts

### 27.1 DECISION — first class, configurable

Financial accounts are treasury-side containers for money. V1 seeds:

| Account | Type | Notes |
|---|---|---|
| Cash / Treasury | `CASH` | Seeded automatically at organization creation. |
| Bank | `BANK` | One or more, user-created. |
| Vodafone Cash | `WALLET` | Wallet type; provider is a label, not a code path. |
| InstaPay | `WALLET` | Wallet type. |
| Other wallets | `WALLET` | User-created, arbitrary label. |

`financial_account_type` is a **closed vocabulary**: `CASH`, `BANK`, `WALLET`. New providers are
new accounts of an existing type, not new types.

### 27.2 Operations and permissions

| Operation | Permission |
|---|---|
| Create / edit / archive account | `treasury.view` + owner for `CASH` seed changes |
| View account history | `treasury.view` |
| Record receipt or payment | The permission of the originating operation (sale, purchase, collection) |
| Transfer between accounts | `treasury.transfer` |
| Reconcile | `treasury.reconcile` |

### 27.3 Balances are ledger-derived — DECISION

An account balance is **computed from the ledger**: the sum of journal lines posted to the
account mapped to that financial account. A cached `current_balance` column exists for read
performance and **MUST** equal the ledger-derived balance; a CI test asserts equality across the
entire test corpus.

The legacy application stored financial-account balances as a `SUM()` over a single-purpose
opening-balance table with no general ledger behind it, and its only accounts UI was
unreachable dead code. Both are `DO_NOT_COPY`.

### 27.4 Transfers — DECISION

A transfer moves value between two financial accounts. It is posted as a single balanced
transaction: debit the destination-linked account, credit the source-linked account, with the
same amount and currency by construction. A transfer is **not** a sale, a purchase, or an
expense, and never appears in revenue or COGS.

`TRANSFER_IN` / `TRANSFER_OUT` stock causes are reserved for internal location transfers and are
distinct from financial-account transfers (§15.5). Internal location transfer is out of V1
scope (§4) but the vocabulary is reserved.

### 27.5 Reconciliation-oriented history

Every account exposes a dated, running-balance history derived from the ledger, so an owner can
compare it against a bank statement. V1 provides **viewing**; a reconciliation *workflow*
(matching, discrepancies, adjustments) is future scope (§4).

### 27.6 Financial accounts under offline operation — DECISION (added by M0-P2)

Offline, money in the drawer and money in a wallet is **already physically moved**. The system
records it; it does not authorise it.

| Aspect | Offline decision |
|---|---|
| Sale payment recorded | Yes, in the local sale transaction (§38.7.1) |
| Cached balance displayed | **Always labelled** with its `server_sequence` and age (§38.31.2) |
| Remote balance consulted | **No.** A remote balance would be stale and would imply a certainty that does not exist |
| Cached balance going negative | **Permitted**, if the stock guard passes. The cash is physically in the drawer. Flagged for review, not blocked at the till |
| Authoritative negative-balance control | Server-side, applied at acceptance (§27.3), producing a reconciliation flag |
| Account transfer | **Tier 3, online only** — it needs both current balances to be correct |
| Auditability | Every movement is attributed, immutable, and carries both local and server timestamps (§23.1, §38.30) |

**The principle:** at the till, My Shop **records physical reality** rather than policing it.
Financial-account discipline is enforced centrally and reconciled, because blocking a sale at the
counter over a stale bank balance would stop the shop trading — which is precisely what the owner
prohibited.

---

## 28. Double-entry accounting

### 28.1 DECISION — a real ledger

My Shop maintains a genuine double-entry ledger. Its complexity is hidden from shop-floor
workflows by automatic posting (§2.1, §25.3) and permission-gated screens (§28.4).

### 28.2 Structure

| Entity | Fields |
|---|---|
| `journal_entries` | `id`, `organizationId`, `entryNumber` (per-org sequence), `entryDate`, `postingStatus`, `sourceType`, `sourceId`, `description`, `reversesEntryId` (nullable), `idempotencyKey` (unique), `createdByUserId`, `createdAt` |
| `journal_lines` | `id`, `entryId`, `organizationId`, `lineNo`, `accountId`, `debitMinor`, `creditMinor`, `description`, `partyType` + `partyId` (nullable, for sub-ledger analysis) |

### 28.3 Balance enforcement — DECISION

| Rule | Enforcement |
|---|---|
| Every entry has ≥ 2 lines | Application + `CHECK` trigger |
| `SUM(debit) == SUM(credit)` per entry | Application assertion **and** a database constraint trigger — a deferred constraint that rejects an unbalanced insert at commit time |
| `debitMinor >= 0` and `creditMinor >= 0` | `CHECK` |
| A line carries a debit **or** a credit, never both | `CHECK (NOT (debit_minor > 0 AND credit_minor > 0))` |
| `entryDate` is a business date, independent of `createdAt` | Separate columns |

The deferred balance trigger is the last line of defence. Even a direct SQL insert that bypasses
the service layer cannot produce an unbalanced entry.

### 28.4 Posting lifecycle

```
DRAFT ──▶ POSTED ──▶ REVERSED
```

| State | Meaning |
|---|---|
| `DRAFT` | Under construction, balance not yet guaranteed. Never visible to reports. |
| `POSTED` | Immutable. Included in all reports and balances. |
| `REVERSED` | Has been cancelled by a compensating entry (§31.3). The original remains readable. |

A `POSTED` entry is **never updated or deleted** — only reversed. Reports read `POSTED` and
`REVERSED` entries as posted (a reversal is itself posted, so the pair nets to zero) and ignore
`DRAFT`.

### 28.5 Automatic posting — the document map

Normal operations post automatically. This table is the single source of truth for automatic
posting; adding an operation **MUST** add or amend a row here.

| Document | Debit | Credit |
|---|---|---|
| **Sale, cash/settled** | Cash/Bank/Wallet (per payment) | Sales Revenue |
| **Sale, credit** | Accounts Receivable | Sales Revenue |
| **Sale** | Cost of Goods Sold | Inventory |
| **Sale with discount** | *(no separate entry — the discount reduces the revenue credited)* | — |
| **Sale return** | Sales Revenue (or the original invoice's revenue effect) | Cash/Bank/Wallet (if refunded) or Accounts Receivable |
| **Sale return** | Inventory | Cost of Goods Sold |
| **Purchase** | Inventory | Accounts Payable (credit portion) |
| **Purchase** | Accounts Payable (cash portion) | Cash/Bank/Wallet |
| **Purchase payment** | Accounts Payable | Cash/Bank/Wallet |
| **Purchase return** | Accounts Payable | Inventory |
| **Customer collection** | Cash/Bank/Wallet | Accounts Receivable |
| **Customer write-off** | Bad Debt Expense | Accounts Receivable |
| **Account transfer** | Destination account | Source account |
| **Stock adjustment (increase)** | Inventory | Adjustment account (per cause) |
| **Stock adjustment (decrease)** | Adjustment account (per cause) | Inventory |
| **Opening balance** | Asset accounts | Liability, Equity (Capital) |
| **Manual journal** | Operator-specified | Operator-specified (owner-exclusive permission) |

### 28.6 Source document references — DECISION

Every entry carries `sourceType` + `sourceId` pointing at the originating business document, and
every business document carries its resulting `journalEntryId`. This bidirectional link makes
"show me the accounting for this invoice" a single indexed lookup.

### 28.7 Idempotent posting — DECISION

Every automatic posting carries a deterministic `idempotencyKey` — for example
`sale:{saleId}` or `customer-collection:{collectionId}` — with a **unique** constraint.

Re-posting an existing document **cannot** duplicate an entry: the insert is an
`INSERT ... ON CONFLICT (idempotency_key) DO NOTHING` inside the same transaction as the business
write. This means a client retry, a double-tap, or a network replay produces exactly one sale
and exactly one journal entry.

**Amendment note — offline makes this load-bearing.** With offline mutation, idempotency is no
longer a nicety; it is the mechanism that makes offline selling *safe*. A device that cannot reach
the server will retry. A device that never received a response will retry again. Both are normal
operation, not exceptions. The posting key becomes **`sourceDocumentId` + `postingType`** (§38.24.4)
and is protected by the server mutation ledger (§38.9.1), which returns `REPLAY` for an identical
resend. Recorded as **ADR-041**.

**Double-entry is not reopened by offline support.** The ledger remains server-only, balanced,
immutable, and reversal-corrected. The client stores business *events*; the server derives
postings (§38.24.1). Offline adapted to accounting, not the reverse.

The legacy application built an elaborate idempotency and
convergence system for its sync layer; its *need* is eliminated here because the server is
authoritative and idempotent by construction, and its *code* is not reused (§38.32).

### 28.8 Ordinary users never see accounting

Sale, purchase, and collection screens show business language only. Accounting screens —
general ledger, trial balance, journal entry, chart of accounts — are separate destinations,
each gated on `accounting.view` or `accounting.journal.read`, each visually marked as a
restricted area. The vocabulary ban list (§2.2) is enforced by a CI check over the sales,
purchasing, and customers feature trees.

---

## 29. Chart of Accounts

### 29.1 DECISION — seeded per organization, editable within limits

Each organization gets its own `chart_of_accounts`, seeded at organization creation from a
versioned template. Seeding is idempotent and keyed by a stable `code`, so re-running it never
duplicates an account.

### 29.2 Default template

| Group | Code | Account |
|---|---|---|
| **Assets** | 1000 | Cash |
| | 1010 | Bank |
| | 1020 | Wallets (Vodafone Cash, InstaPay, other) — one account per wallet |
| | 1100 | Accounts Receivable |
| | 1200 | Inventory |
| | 1300 | Other Current Assets |
| | 1500 | Fixed Assets (reserved; unused in V1) |
| **Liabilities** | 2000 | Accounts Payable |
| | 2010 | Credit Card / Wallet Payable (reserved) |
| | 2100 | Other Current Liabilities |
| | 2500 | Long-term Liabilities (reserved) |
| **Equity** | 3000 | Capital |
| | 3010 | Drawings |
| | 3100 | Retained Earnings (computed from P&L closure) |
| **Revenue** | 4000 | Sales |
| | 4010 | Sales Discounts (contra-revenue, used when configured) |
| | 4900 | Other Income |
| **Expenses** | 5000 | Cost of Goods Sold |
| | 6000 | Operating Expenses |
| | 6100 | Rent |
| | 6200 | Salaries (manual entry only in V1; no payroll module) |
| | 6300 | Utilities |
| | 6900 | Other Expenses |
| | 7000 | Bad Debt Expense |
| | 7100 | Inventory Adjustment (per cause where needed) |

### 29.3 Rules

| Rule | Detail |
|---|---|
| Codes are stable identifiers | Never reused, never renumbered, even if an account is archived. |
| Account type is fixed at creation | `ASSET`, `LIABILITY`, `EQUITY`, `REVENUE`, `EXPENSE`. Changing it invalidates history. |
| Normal balance | Debit for assets/expenses; credit for liabilities/equity/revenue. Enforced by a `CHECK`. |
| System accounts cannot be deleted | Only archived. Archiving an account with a non-zero balance is refused. |
| Users may add accounts | With `accounting.chart.manage`. Required for reporting by natural category. |
| Users may not change the semantics of system accounts | Reserved codes cannot be redefined. |

### 29.4 Retained earnings

Retained earnings (3100) is the P&L of prior closed periods. V1 does not implement period
closing; 3100 stays at zero and P&L is reported for the period. A period-closing feature is
future scope (§4). This is stated explicitly so the account's presence is not mistaken for a
closed-period engine.

---

## 30. Inventory costing

### 30.1 DECISION — money is integer minor units, everywhere

**Money MUST NOT rely on binary floating-point semantics.** Money is stored, transported, and
computed as an integer count of minor units.

| Rule | Detail |
|---|---|
| Storage | `BigInt` minor units. Never `float`, never `double`, never a decimal string. |
| Transport | JSON integer expressed as a **string**, to survive JavaScript's 53-bit safe-integer limit. |
| Client type | A `Money` value type wrapping the integer plus the currency; arithmetic returns `Money`. No raw `double` in any money path. |
| Database type | `BigInt`. `NUMERIC` is reserved for non-monetary ratios. |
| Arithmetic | Integer addition and multiplication only. Division, for averages, uses explicit integer division with a documented rounding rule. |
| Currency exponent | `minor_unit_exponent` = 2 for EGP. |

**RATIONALE.** The legacy application stored money as SQLite `REAL` and Dart `double`, summed it
with float folds, and relied on a whole-pound display (`toStringAsFixed(0)`) to hide the drift.
Its cloud path used `NUMERIC(12,2)`, so the two representations disagreed and converted lossily
through `.toDouble()`. Minor-unit integers eliminate the entire class of defect: there is no
rounding at rest, so there is nothing to reconcile.

### 30.2 DECISION — perpetual weighted average (moving average)

**V1 uses perpetual weighted-average costing.** This is evaluated and adopted explicitly here,
not silently defaulted.

| Property | Value |
|---|---|
| Method | Perpetual moving weighted average. |
| Recalculation point | On every stock-receiving movement: purchase receipt, return receipt, stock-count increase. |
| Sale cost | The moving average **at the moment of the sale**, snapshotted onto the line as `unitCostApplied`. |
| Historical integrity | Snapshotted cost never changes. A later cost change never restates past COGS. |
| Storage | `average_cost_minor` per (product, location), updated atomically within the movement transaction. |

**Rationale.**

- **Suitability for small retail.** Retail purchases arrive in mixed lots at changing prices.
  Moving average matches how a shop owner actually thinks about what an item cost them, without
  requiring lot tracking.
- **Simplicity, which is a product principle.** FIFO layers imply cost-layer tables, layer
  consumption ordering, and partial-layer returns. Moving average is one number per product.
- **Returns are tractable.** A return restores stock at the cost recorded on the original sale
  line (§30.4), which is exact and needs no layer lookup.
- **It is auditable.** Every movement carries the unit cost used, so any valuation point can be
  reconstructed from the movement ledger.

**Consequences accepted.**

| Consequence | Mitigation |
|---|---|
| COGS is an approximation when prices vary within a period | Acceptable at retail scale. Exact FIFO layers are future scope (§4). |
| A retroactive cost change requires an explicit revaluation | It posts a `REVALUATION` movement and a documented adjustment entry. It never silently restates history (§30.5). |
| A cost change alone does not restate historical gross profit | Correct by design, and covered by a dedicated test (§16.2). |
| A stock count revealing a cost difference posts an adjustment | Documented in §30.5. |

**Rejected alternatives.**

| Alternative | Why rejected |
|---|---|
| FIFO / LIFO cost layers | More machinery, no benefit at retail scale, materially complicates returns and partial receipts. |
| Manual single cost price (the legacy model) | Not a costing method at all: it cannot reflect actual purchase prices (§5.4). |
| Standard costing | Requires periodic variance analysis; disproportionate for V1. |

This is a decision, not a default. It is recorded in the ADR register (§41) and is revisited at
M10 hardening, where real transaction data rather than assumption should confirm it.

**Amendment note — the offline hazard is named here, not buried.** The moving average is a
**cumulative shared calculation**. Two devices computing it independently and reconciling later is
materially harder than selling offline, and it would put costing integrity at risk. Three
consequences follow, and each is a deliberate decision:

| Consequence | Decision |
|---|---|
| Purchases are Tier 3, online only | Receiving stock is what changes the average, so it cannot be deferred (§38.22, O-17) |
| An offline sale's cost basis is the **device's** average | Snapshotted as `device_unit_cost_minor` so the sale is auditable offline (§38.24.3) |
| The **server** recomputes authoritative COGS at acceptance | Where the two differ, the server's figure is used, the sale is accepted, and `COST_BASIS_DIVERGENCE` is raised for review (§38.24.3) |

**Cost history is never silently rewritten.** Both figures are retained and visible, and any
correction is an explicit revaluation (§30.5). The inaccuracy is a bounded, reported risk (R-16),
not a hidden degradation.

### 30.3 Purchase receipt algorithm — DECISION

```
new_qty   = old_qty + received_base_qty
new_value = (old_qty * old_avg) + (received_base_qty * received_unit_cost)
new_avg   = new_qty == 0
              ? received_unit_cost
              : round_half_up(new_value / new_qty, minor_unit_exponent)
```

All quantities are base units (§15.2); purchase-unit costs convert on receipt. The division is
integer division with explicit `HALF_UP` rounding to the minor-unit exponent (§30.6), and the
resulting `new_avg` is stored atomically with the movement.

### 30.4 Sale and return algorithm

| Event | Rule |
|---|---|
| Sale | `lineCogs = round_half_up(quantity * current_avg)`. The exact `unitCostApplied` is snapshotted on the line and drives the COGS journal line (§28.5). Quantity decreases; the average is unchanged. |
| Sale return | Stock returns to inventory at the `unitCostApplied` recorded on the **original sale line**, not at the current average. `returnedCogs` mirrors the original `lineCogs`. The average is recomputed by the §30.3 formula using the restored quantity and restored value. |
| Return with no identified sale line | Requires `inventory.adjust` and an explicit cost; audited as a variance; posted as an inventory movement at the specified cost. |

**RATIONALE for returning at original cost.** A return reverses the original transaction. Costed
at today's average, the reversal would not match the original entry and the ledger would carry an
unexplained variance. The legacy application costed returns at the *current* product cost, which
can disagree with the sale it reverses. That is `DO_NOT_COPY`.

### 30.5 Stock corrections

| Case | Rule |
|---|---|
| Quantity correction | Movement at the current average; inventory value adjusts by the same average. |
| Cost correction on the product master | A master cost change **MUST NOT** silently rewrite `average_cost_minor`. It creates a `REVALUATION` movement plus a documented adjustment journal entry, or is deferred to the next receipt. The owner's choice is explicit. |
| Shrinkage | `SHRINKAGE` movement at the current average, posting to the shrinkage expense account (§15.5, §28.5). |
| Count-driven difference | `STOCK_COUNT_ADJUSTMENT` at the current average, posting to the inventory adjustment account. |

This corrects the legacy behaviour where changing a product cost silently changed total inventory
value with **no journal entry at all**, there being no ledger to post to.

### 30.6 Rounding rules — DECISION

| Rule | Value |
|---|---|
| Organization setting | `rounding_mode`, default `HALF_UP`. Alternative: `HALF_EVEN`. |
| Applied to | The moving-average division result (§30.3). |
| Not applied to | Line totals, invoice totals, payments, ledger amounts. These are integer products and sums of already-rounded minor units and need no rounding. |
| Rounding is applied exactly once | At the average division, and it propagates explicitly into every derived value. |
| Invariant test | The sum of sale-line COGS equals the sum of COGS journal lines for every period, asserted in CI. |

**Consequence:** because rounding occurs exactly once, at one documented point, the ledger ties
to the sub-ledgers exactly. There is no unreconciled rounding difference.

### 30.7 Precision

Quantities are `Decimal(18,4)` in base units, so fractional stock by weight or length is
supported without floating point. Costs are integer minor units per base unit. Where a per-unit
cost is finer than the currency's minor unit allows, it is carried at higher precision in
`unit_cost_minor_scaled` and rounded exactly once at the line level, under the same §30.6 rule.

### 30.8 Costing under offline operation — DECISION (added by M0-P2)

| Event | Who computes | What is authoritative | What happens on divergence |
|---|---|---|---|
| **Purchase receipt** | Server only. Tier 3 (§38.22) | Server average, recomputed by §30.3 | Not applicable — never computed offline |
| **Sale COGS** | Device records; **server recomputes** at acceptance | The **server's** average at acceptance time | Sale accepted; server figure used; `COST_BASIS_DIVERGENCE` raised for owner review (§38.24.3). Both figures retained: `device_unit_cost_minor` and `unitCostApplied`. |
| **Sale return** | Device records; server recomputes | The **original sale line's** server-authoritative `unitCostApplied` (§30.4) | Return accepted; restored at the server's recorded cost; divergence flagged |
| **Delayed sync** | n/a | The server's average, at acceptance, which may be hours after the physical sale | This is the accuracy gap. Bounded by sync frequency, measured by the divergence report, and reviewed at M10-S6 |
| **Stock count / adjustment** | Device records the count; the cost basis is **server-side** | The server's average at acceptance | Adjustment accepted; cost effect computed by the server; divergence flagged |
| **Revaluation** | **Server only** | Server | Prohibited offline (§38.33). A revaluation is a costing act, not a till act. |

| Rule | Detail |
|---|---|
| The device never computes a moving average | It may only **read** its cached `average_cost_minor` and **write** the value it used as a snapshot. It never recalculates. This is what keeps the cumulative calculation single-writer. |
| No silent restatement | A divergence never rewrites history. It produces a flag and a report entry (§38.24.3, §38.31.1). |
| Rounding unchanged | The single rounding point of §30.6 remains on the **server**. The device performs no division that affects a monetary value. |
| Money model unchanged | Integer minor units end to end, including offline (§30.1). No float appears anywhere in this path. |

---

## 31. Journal posting and reversal rules

### 31.1 DECISION — immutability

A `POSTED` journal entry is **immutable**. There is no update path and no delete path in the
service layer, the repository, or the application role's grants. This is enforced by code review
plus a CI check that no `journal_entries.update` or `journal_entries.delete` call exists anywhere
in the backend source.

### 31.2 Posting atomicity — DECISION

The business document write, the stock movements, the ledger entry, and the audit event commit in
**one database transaction**. There is no window in which a sale exists without its ledger entry,
and none in which a ledger entry exists without its source document.

### 31.3 Correction strategy — DECISION, reversal only

Corrections are made by **reversal**, never by editing.

1. A correcting document is created: a sale return, a purchase return, or a reversing entry.
2. A new journal entry posts with the **opposite** debit/credit lines, referencing the original
   through `reversesEntryId`.
3. The original entry remains readable and posted. The pair nets to zero.

The legacy application deleted sales and returns as a data operation, with manual quantity
reversion and no ledger concept at all. That approach is `DO_NOT_COPY`. In My Shop `sales.cancel`
exists, and it is implemented as a reversing document rather than a row deletion.

### 31.4 Idempotency — DECISION

Per §28.7: `idempotencyKey` is unique per organization, and re-submitting an already-posted
source document is a no-op that returns the existing entry rather than creating a duplicate. A
client retry, a double tap, or a network replay therefore produces exactly one sale and exactly
one journal entry.

**Amendment note.** Offline turns this from a convenience into a correctness requirement, because
retry is the normal case rather than the exception. The guarantee is now layered:

| Layer | Mechanism | Guarantee |
|---|---|---|
| Transport | `mutation_id` + the mutation ledger (§38.9.1) | A resent mutation returns `REPLAY` with the original response |
| Posting | `sourceDocumentId` + `postingType`, unique (§38.24.4) | A replayed sale produces exactly one journal entry |
| Transaction | The ledger row and the posting commit together (§38.9.3) | A crash can never leave a mutation recorded but unposted, or posted but unrecorded |

Ten retries, from ten devices, over a day, produce one sale and one journal entry. This is
verified by test T-O3 and T-O12 (§38.26).

### 31.5 Auditability

Every entry records `createdByUserId`, `createdAt`, `sourceType`, `sourceId`, and the
`idempotencyKey`. A reversal additionally records `reversesEntryId` and its own actor. The full
chain from invoice to journal line to stock movement to audit event is traversable by index.

### 31.6 What is not allowed

| Forbidden | Reason |
|---|---|
| Editing a posted entry | Breaks the audit chain and makes reports non-reproducible. |
| Deleting a posted entry | Same. |
| A client-writable journal endpoint | Only services post. There is no direct journal write API. |
| Unbalanced entries | Enforced by a database constraint trigger (§28.3). |
| Posting to a non-leaf account | Only leaf accounts accept lines. |
| A `DRAFT` entry surviving indefinitely | A `DRAFT` older than 24 hours is reported as a defect by a reconciliation check. |

---

## 32. Audit model

### 32.1 Two distinct histories — DECISION

My Shop keeps **two separate, purpose-built streams**. Conflating them makes both useless.

| Stream | Table | Answers | Retention | Access |
|---|---|---|---|---|
| **Business history** | `audit_events` | "Why does this number look like this, and who did it?" | Indefinite, part of the financial record | `audit.view` |
| **Security history** | `security_events` | "Who tried to get in, and did we stop them?" | 400 days minimum, then archived | Owner only |

Business history is referenced from financial documents and survives them. Security history is
operational telemetry about access, never part of the ledger, and never posted to.

### 32.2 Audited business actions

Every one of the following writes an `audit_events` row in the same transaction as the business
effect, capturing actor, action, target type and id, before/after values for the changed fields,
and the originating document id:

| Action | Additional captured data |
|---|---|
| Price override | Base price, applied price, delta, actor, authorization |
| Discount | Type, value, amount, actor, authorization reference (§18.2) |
| Sale created | Full line snapshot reference, total, payment allocation, salesperson, collector |
| Sale return | Original sale line, returned quantity, restored cost, actor |
| Sale cancelled | Reason, reversing entry id |
| Stock adjustment | Before/after quantity, unit cost used, cause, actor |
| Stock count posted | Count id, variance total, actor |
| Purchase recorded | Supplier, total, payable created, actor |
| Purchase return | Original purchase line, quantity, cost |
| Supplier payment | Supplier, amount, accounts used, payer, approver if any |
| Customer collection | Customer, amount, accounts used, **collector**, invoice(s) settled |
| Account transfer | Source, destination, amount, actor |
| Opening balance set | Account, before, after, actor |
| **Manual journal entry** | Full before/after lines, reason, actor |
| **Journal reversal** | Original entry, reversing entry, reason, actor |
| Settings changed | Setting key, old value, new value, actor |
| Pricing policy changed | Old mode/policy, new mode/policy, actor |
| Permissions or role changed | Target user or role, old set, new set, actor |
| User created, disabled | Target user, role assigned, actor |
| Device revoked | Device id, label, actor |

### 32.2A Offline and synchronisation audit events — DECISION (added by M0-P2)

Every one of the following is recorded, with **both** a local event timestamp and, where
applicable, a server-received timestamp (§AQ).

**Local, at commit — written inside the business transaction (§38.7.1):**

| Event | Captured |
|---|---|
| Offline sale created | Mutation id, device, actor, device sequence, local time, sync state, `originatedOffline`, line count, total, payment allocation, salesperson and collector |
| Offline void (pre-finalization) | Mutation id, actor, reason code, local time. Nothing was a business record, so no reversal is needed (§16.7) |
| Offline return | Mutation id, original sale line, quantity, restored cost, actor, reason |
| Offline inventory adjustment | Mutation id, variant, before/after quantity, reason code, actor, local time |
| Offline stock count posted | Mutation id, count id, variance total, actor |
| Offline collection | Mutation id, customer, amount, accounts used, collector, actor |
| Grace window used | First offline mutation after expiry-of-fresh-session, device, actor, grace issued-at |
| Cached-policy sale | The `settings_version` in force, so the server can audit **what the device believed** (§38.17) |

**Server, at acceptance:**

| Event | Captured |
|---|---|
| Sync accepted | Mutation id, device, server time, result reference, server sequence |
| Sync rejected — business | Mutation id, rejection code, business context |
| Sync rejected — authorization | Mutation id, rejection code, the device's believed permissions vs current. **Highest-severity offline class.** |
| Sync rejected — idempotency contradiction | Mutation id, payload hashes. Possible tampering (§38.9.2) |
| Retry | Mutation id, attempt number, error class |
| Inventory conflict detected | Mutation id, device, expected vs actual quantity, resolution status |
| Cost basis divergence | Mutation id, device cost vs server cost, delta |
| Policy drift accepted | Mutation id, cached `settings_version` vs current, discount delta |
| Grace expired / device read-only | Device, actor, expiry time |
| Device revoked with pending mutations | Device, count of quarantined mutations |

**Never recorded, in either stream:** tokens, passwords, session state, biometric data (§32.4).

**Attribution survives sync.** A locally recorded sale carries its local actor and device to the
server unchanged. The server never re-attributes an offline sale to "whoever pushed it" — the
push is a transport event, not an authorship event. This is the concrete meaning of cashier
accountability (§38.30).

### 32.3 Audited security actions

`security_events`: login succeeded, login failed (with reason), refresh token reuse detected,
session revoked, session family revoked, password changed, password reset, device registered,
device revoked, permission escalation refused, organization switch refused, rate limit exceeded,
cross-organization access refused (§9.3).

### 32.4 What is never recorded

| Never | Reason |
|---|---|
| Passwords or password hashes | §13.6 |
| Session or refresh token values | A breach of the log must not yield a usable credential. |
| Biometric data or device PINs | Never collected (§14.1). |
| Card or wallet credentials | Never collected. |
| Full card numbers | Never collected. |

Fields that are *sensitive but necessary* — a price, a cost, a balance — **are** recorded. The
redaction rule targets credentials, not business data.

### 32.5 Immutability and integrity

`audit_events` and `security_events` are append-only: insert-only grants, no update, no delete.
Each row carries a monotonic per-organization sequence number so tampering with ordering is
detectable. The application role holds `INSERT` and `SELECT` on these tables and nothing else.

### 32.6 Actor identity is recorded even when irrelevant

Every event records `actorUserId` and `actorDeviceId` where available. For system-generated
events, the actor is a documented system principal, never `NULL`, so "nobody did this" is
distinguishable from "the system did this".

---

## 33. Reporting roadmap

### 33.1 Principle — DECISION

**Every reported figure is derived at query time from trustworthy source transactions and ledger
data.** No dashboard total, materialized summary, cached aggregate, or manually maintained KPI is
authoritative. This is a direct rejection of the legacy model, where profit was computed by four
independent `SUM()` queries wrapped in a fail-closed `complete` flag that suppressed the "net
profit" label when any input was unproven.

If a figure cannot be derived from transactions and the ledger in V1, it is not reported in V1.

### 33.2 Sales reporting

| Report | Content | Permission |
|---|---|---|
| Daily / monthly sales totals | Gross, discounts, returns, net, invoice count | `sales.view` |
| **Salesperson performance** | Full metric set of §23.2 | `sales.viewAll` |
| Product performance | Quantity, net revenue, COGS, margin, rank | `sales.viewAll` |
| Discount report | Every discount with amount, actor, authorization, and resulting margin | `sales.viewAll` |
| Returns report | Returns by actor, product, and value, with restored cost | `sales.viewAll` |
| Gross profit / margin | Only where `accounting.view` also holds | `accounting.view` |

### 33.3 Purchase and supplier reporting

| Report | Content | Permission |
|---|---|---|
| Supplier purchases | Period totals per supplier and product | `suppliers.view` |
| Supplier payments | Allocations by account, payer, approver | `suppliers.view` |
| Outstanding payables | Per supplier, aged from due date | `suppliers.view` |
| Supplier statement | Full ledger projection (§24.3) | `suppliers.view` |

### 33.4 Customer reporting

| Report | Content | Permission |
|---|---|---|
| Receivables | Outstanding per customer, aged from due date (§20.2) | `customers.view` |
| Collections | By collector, by account, by customer | `customers.view` |
| Customer statement | Full ledger projection with running balance | `customers.view` |

### 33.5 Inventory reporting

| Report | Content | Permission |
|---|---|---|
| Current stock | Quantity per product and location, valued at moving average | `inventory.view` |
| Stock movements | Filtered movement ledger by cause, date, actor, document | `inventory.view` |
| Inventory valuation | Quantity × moving average, tying to the Inventory account | `inventory.view` |
| Variance and shrinkage | Adjustment totals by cause, with actors | `inventory.view` |
| Slow / fast moving | Future scope (§4) | — |

Inventory valuation **MUST** reconcile to the Inventory asset account balance. This
reconciliation is asserted in CI (§36.4).

### 33.6 Finance reporting

| Report | Content | Permission |
|---|---|---|
| Account balances | Per financial account, ledger-derived | `treasury.view` |
| Cash movement | Receipts and payments per account over a period | `treasury.view` |
| Transfers | All transfers with source, destination, actor | `treasury.view` |
| Statement of cash position | All account balances at a date | `treasury.view` |

### 33.7 Accounting reporting

| Report | Content | Permission |
|---|---|---|
| General ledger | All journal lines for an account over a period, with running balance | `accounting.journal.read` |
| Trial balance | All leaf accounts, debit and credit columns, **proved to balance** | `accounting.view` |
| Profit and loss | Revenue, COGS, gross profit, operating expenses, net result for a period | `accounting.view` |
| Statement of financial position | Assets, liabilities, equity at a date | `accounting.view` |
| Entry drill-down | From any figure to the contributing journal entries and source documents | `accounting.journal.read` |

Every accounting report **MUST** offer drill-down from the figure to the underlying entry. A
number an owner cannot trace is a number they cannot trust.

### 33.8 Report integrity requirements

| # | Requirement |
|---|---|
| R-1 | Reports read only `POSTED` and `REVERSED` journal entries; `DRAFT` is never included. |
| R-2 | The trial balance always balances. An unbalanced result is a defect surfaced as an error, never as a number. |
| R-3 | Opening plus movement equals closing for every account and period. |
| R-4 | Inventory valuation equals the Inventory account balance. |
| R-5 | Customer and supplier statement closing balances equal the cached balance columns (§19.2). |
| R-6 | Report period boundaries are half-open `[start, end)` on a business date, so no transaction is counted twice or omitted at a boundary. |
| R-7 | Currency and minor-unit exponent are taken from organization settings, never hardcoded (§30.1). |
| **R-8** | **Unsynced sales are excluded from every report and are shown separately**, never silently included and never silently missing. A report covering a period with unsynced activity states that coverage is incomplete. |
| **R-9** | Every figure in an offline-affected period remains traceable to its device, actor, and sync state (§23.1). |

### 33.9 Offline reporting posture — DECISION (added by M0-P2)

Reporting remains **server-derived** (§33.1). Offline, reports are served from cache where
available and are **always labelled as cached** with their `server_sequence` and age (§38.31.2).

| Rule | Detail |
|---|---|
| Ledger reports require connectivity | Tier 3 (§38.22). There is no local ledger (§38.24.1), so there is nothing truthful to show offline |
| Sales reports may be shown from cache | Labelled as cached, with an explicit "coverage may be incomplete" notice |
| **Never** present an unsynced sale as absent | R-8. A sale the cashier made is shown as *pending sync*, not omitted. Omitting it would be a lie in the dangerous direction. |
| The sync console is the offline reporting surface | §38.31.1 |

---

## 34. API versioning, validation and errors

### 34.1 API versioning — DECISION

- Namespace: `/api/v1`. The version is in the path, not a header, so it is visible in logs,
  firewall rules, and client configuration.
- **A breaking change requires `/api/v2`.** Adding an optional field, a new endpoint, or a new
  enum value that existing clients ignore is not a breaking change.
- Additive changes ship within v1. Removing a field, renaming a field, tightening validation, or
  changing a default requires v2.
- v1 is supported until a stated end-of-life, communicated in the OpenAPI description.
- Every endpoint declares its required permissions and its tenant-scoping in OpenAPI.

### 34.2 Validation — DECISION

- One global `ValidationPipe`: `whitelist: true`, `forbidNonWhitelisted: true`,
  `transform: true`. An unknown property in a request body is a `400`, not a silent ignore.
- DTOs are the only accepted input shape. No raw body, no dynamic object passthrough.
- Domain invariants that are not expressible as type constraints are enforced in the service
  layer and surface as typed errors, following the legacy application's one genuinely good
  practice: the data layer, not the UI, is where authorization and invariants are enforced.
- Pagination is mandatory on every list endpoint: a bounded `limit` with a maximum, and
  cursor-based `after` pagination. No unbounded list endpoint exists.
- Every `organizationId` in a path parameter is validated against the verified claim set (§9.3).

### 34.3 Error contract — DECISION

RFC 7807 `application/problem+json`. One shape, everywhere.

```json
{
  "type": "https://docs.my-shop/errors/INSUFFICIENT_STOCK",
  "title": "Insufficient stock",
  "status": 409,
  "code": "INSUFFICIENT_STOCK",
  "detail": "Product SKU-1042 has 3 available, 5 requested.",
  "traceId": "01JB8Z3K4M2N...",
  "errors": [
    { "field": "lines[0].quantity", "code": "INSUFFICIENT_STOCK" }
  ]
}
```

| Rule | Detail |
|---|---|
| `code` is stable and machine-readable | The client branches on `code`, never on `detail`. |
| `type` is a stable documentation URI | One page per error code. |
| `traceId` is always present | Correlates the client report with the server log. |
| `detail` is safe | Never a stack trace, SQL fragment, internal id, or file path. |
| Validation errors populate `errors` | Field-level, with per-field codes. |
| Money values appear as strings | Because they are minor-unit integers (§30.1). |

### 34.4 Standard status codes

| Status | Meaning in My Shop |
|---|---|
| 400 | Validation failure, unknown property, malformed minor-unit string |
| 401 | Missing, invalid, or stale access token; refresh reuse detected |
| 403 | Authenticated but lacking permission, or cross-organization access refused |
| 404 | Not found **within the caller's organization** (never a cross-tenant 403 that confirms existence) |
| 409 | Business conflict: insufficient stock, unbalanced entry, sequence conflict, duplicate idempotency key with differing payload |
| 422 | Semantically invalid but well-formed: discount above ceiling with approval required, archived account referenced |
| 429 | Rate limited, with `Retry-After` |
| 500 | Unexpected. Generic message plus `traceId`. |
| 503 | Dependency unavailable. The client **queues the mutation to the durable outbox and continues selling offline** (§38.8). This is the intended response to a 5xx or a network failure, not an error state. |
| **409** `MUTATION_CONTRADICTION` | Same `mutation_id`, different payload. Possible tampering (§38.9.2). Security event, owner review. |

**Amendment note.** The `503` semantics changed materially. In v1.0.0 a `503` meant "the client
offers a cached read and does not offer a queued write." Under the offline amendment, a `503` is
the **normal trigger for offline operation**: the mutation is written to the durable outbox and
the sale continues (§38.8). A dependency failure is no longer a reason a cashier cannot sell.

**Note on 404 versus 403:** a resource in another organization returns `404`, not `403`, so the
API never confirms the existence of another tenant's data.

### 34.5 Pagination and filtering

Cursor-based with a stable sort key plus a unique tiebreaker. Filter whitelists per endpoint;
there is no generic "filter by any field" query builder on tenant-owned data.

---

## 35. Migrations

### 35.1 DECISION

- `prisma migrate deploy` in every environment except local development.
- Migration files are committed, reviewed, and immutable once merged.
- Every migration is **forward-only**. There are no down migrations, because a down migration for
  a destructive financial change is itself a data-loss risk. Rollback is a new forward migration.
- A migration touching a financial table **MUST** preserve existing data and **MUST NOT** weaken
  or drop a `CHECK` constraint on a financial column.

### 35.2 Expand / contract

Breaking changes span two releases:

1. **Expand** — add the new nullable column or the new table. Backfill in batches. Dual-write.
2. **Contract** — once every reader and writer is on the new shape, enforce `NOT NULL`, drop the
   old column.

No release both expands and contracts. This is the discipline that allows a rollback at any point.

### 35.3 Data migrations

A migration that transforms business data **MUST** also emit the corresponding ledger effect if
one is implied. A migration that silently changes a financial value without a journal entry is
forbidden. This is the specific discipline the legacy application could not have, having no
ledger.

### 35.4 Seeding

Chart of Accounts and financial accounts are seeded by **idempotent application code** at
organization creation, not by SQL migration, because they are tenant data rather than schema.

### 35.5 Client-side schema migrations — DECISION (added by M0-P2)

The client now has a governed local schema (§38.6.2). Its migration discipline **mirrors** the
server's, deliberately, so there is one set of rules to learn and one set of habits to keep.

| Rule | Server | Client |
|---|---|---|
| Direction | Forward-only (§35.1) | Forward-only |
| Destructive changes | Expand/contract over two releases (§35.2) | Identical |
| Merged migration edited | Forbidden (§37.3 G-6) | Forbidden, same CI gate |
| Backfill | Batched | Batched, with a progress guard |
| Pre-migration backup | Server backup procedure | Local file copy, retained one version (§38.6.2) |
| Minimum supported version | Published | Published by the server; enforced at acceptance (§38.7.2) |
| Verification | Post-migration invariants (§35.5) | Local invariants re-checked after migration |

| Additional client rule | Detail |
|---|---|
| The client never migrates a financial value silently | A local migration that would change a committed sale's totals is forbidden. Committed local sales are immutable (§16.7). |
| Migrations run before the UI needs the new shape | A failed migration leaves the app on the previous schema, read-only, with a clear message. It never half-migrates. |
| Migration is tested from the previous version with real-shaped data | §38.6.6 |

### 35.5 Pre-deployment verification

| Check | Purpose |
|---|---|
| Migration applies cleanly to a copy of production-shaped data | No surprise lock or rewrite |
| Post-migration invariant query | Trial balance still balances; inventory valuation still ties |
| Estimated duration measured | Acceptable downtime window declared |
| Backup verified restorable beforehand | Rollback of last resort |

---

## 36. Test strategy

### 36.1 Principles

| # | Principle |
|---|---|
| T-1 | Every business rule in this document has at least one test that fails if the rule is removed. |
| T-2 | Financial invariants are tested against a **real PostgreSQL instance**, never a mock or in-memory substitute. |
| T-3 | Money arithmetic is tested with adversarial values, not round numbers. |
| T-4 | Tenant isolation is tested by direct SQL, not only through the API. |
| T-5 | Tests assert **ledger outcomes**, not implementation details. |
| T-6 | No test depends on execution order, wall-clock time, or the host locale. |
| **T-7** | **Offline behaviour is tested, not assumed.** No offline code path is merged without a test that exercises a real disconnection, restart, and duplicate replay (§38.26). |
| **T-8** | **A sync engine bug is a data-loss bug.** Sync tests assert durable outcomes — sale, stock, payment, journal — not that a method was called. |

### 36.2 Backend tests

| Level | Tool | Scope | Gate |
|---|---|---|---|
| Unit | Jest | Pure domain policies: pricing modes, discount authority, rounding, costing, permission resolution, document mapping | 90% on `src/**/domain` |
| Integration | Jest + real Postgres + Supertest | Full request through routing, validation, service, repository, Prisma, and the DB | 80% on `src/modules` |
| RLS | Jest + `psql` direct | Every tenant-owned table, cross-tenant read and write denial | 100% of tenant-owned tables |
| Ledger invariant | Jest + real Postgres | Trial balance balances; period continuity; inventory ties; statement ties | 100% pass, no threshold |
| Migration | Jest | Apply each migration forward against a prior-version fixture | Every migration |
| Contract | Jest | Response shape matches the generated contract | 100% |

### 36.3 Flutter tests

| Level | Tool | Scope | Gate |
|---|---|---|---|
| Unit | `flutter_test` | `Money`, domain policies, mappers — pure Dart, no Flutter binding | 90% on `core` and `features/**/domain` |
| Widget | `flutter_test` + provider overrides | Controllers and screens against faked repositories | 75% on `features/**/presentation` |
| Golden | golden files | `core/ui` components in Arabic RTL | All components |
| Integration | `integration_test` | Login, sell, collect, return, purchase, app lock, invoice output, offline read degradation | All critical flows |
| **Offline integration** | `integration_test` + network control | **Full offline matrix T-O1…T-O22** (§38.26): disconnected sale, restart durability, duplicate push, pull resume, loop prevention, negative-stock rejection, multi-device convergence, grace expiry, corruption recovery, schema mismatch | **Every one of T-O1…T-O22. Release-blocking.** |
| **Crash simulation** | Dedicated test harness | Process kill at each defined point inside the local transaction | All points, no half-sale |

### 36.4 Mandatory invariant tests — DECISION

These are not optional coverage targets; they are release-blocking:

| # | Invariant |
|---|---|
| I-1 | The trial balance balances after every scenario in the test corpus. |
| I-2 | Inventory valuation equals the Inventory account balance. |
| I-3 | A customer statement closing balance equals the cached customer balance. |
| I-4 | A supplier statement closing balance equals the cached supplier balance. |
| I-5 | A financial account's cached balance equals its ledger-derived balance. |
| I-6 | `Σ sale_lines.lineCogs` equals `Σ COGS journal lines` per period. |
| I-7 | A historical invoice's printed total and line detail are **unchanged** after the product's price and cost are altered. |
| I-8 | Re-posting a document with the same idempotency key creates no second journal entry. |
| I-9 | A tenant-scoped session cannot read or write another organization's rows on **any** tenant-owned table. |
| I-10 | No route reachable with only `sales.create` contains a banned accounting term (§2.2). |
| I-11 | Every journal entry has equal debit and credit totals. |
| I-12 | A sale with no printed invoice is fully present in inventory, receivables, treasury, and reports. |
| **I-13** | A process or power kill at **any** point inside the local transaction yields either a complete sale or no sale. Never a partial one (§38.7.1). |
| **I-14** | A mutation replayed 10 times produces exactly one sale, one stock effect, and one journal entry (§38.9). |
| **I-15** | Applying any remote change set leaves the outbox count unchanged (§38.12). |
| **I-16** | A barcode duplicate on (organization, symbology, normalized value) is rejected by a **database** constraint, not only in application code (§15.3A.4). |
| **I-17** | Selling more than locally known available stock creates **no** sale, **no** stock movement, and **no** outbox record (§38.4). |
| **I-18** | Every committed offline sale eventually reaches `SYNCED` or `PERMANENT_REJECTED`. No third terminal state is possible (§38.13). |
| **I-19** | An offline-printed receipt's total equals the locally persisted sale total (§21.4, §38.23.2). |
| **I-20** | After multi-device convergence, `Σ` accepted movements equals the authoritative stock quantity, with every divergence resolved by an attributed movement (§38.14.2). |

**I-7 and I-12 encode the two product rules that the legacy application violated:** historical
invoice truth must not follow current prices, and choosing not to print must never remove a sale.

**I-13 through I-20 are the offline correctness gate.** I-13, I-14, and I-15 are the three that
would cause irreversible damage if violated, and they are therefore the three that get the
strongest scrutiny in review.

### 36.5 Non-functional testing

| Area | Method |
|---|---|
| Concurrency | Parallel sales of a limited-stock **variant**; exactly one succeeds per available unit |
| Deadlock | Lock ordering (§16.6) verified under contention |
| **Offline endurance** | Sustained disconnection with continuous selling; assert bounded memory, bounded storage, and no outbox corruption (§38.25 F-17) |
| **Recovery** | Kill and restart at every transaction boundary; corruption injection; disk-full simulation |
| **Sync soak** | Repeated connect/disconnect cycles; assert no duplicate effect and no unbounded growth |
| Performance | Sale creation p95 under a stated load; report queries under a stated row count |
| Migration rehearsal | Restore a production-shaped backup into CI and migrate forward |
| Security | Dependency audit, static analysis, secret scan, authorization matrix test per permission |

### 36.6 Legacy testing lessons applied

| Legacy strength | Applied to My Shop |
|---|---|
| 144 test files, more test code than production code, with per-version schema migration tests | Keep per-migration tests and heavy invariant coverage (§36.4). |
| A test that audits the SQL migration files for `SECURITY DEFINER`, `search_path`, and `GRANT ALL` | Keep this pattern for My Shop migrations (§43 gate G-9). |
| Fail-closed `complete` flag when a report input is unproven | Keep the instinct, but replace it with derivation from the ledger (§33.1), so the situation cannot arise. |
| 12 of 144 test files testing the build pipeline instead of the app | My Shop forbids build-pipeline tests from counting toward coverage gates (§36.2). |

---

## 37. CI strategy

### 37.1 DECISION

Continuous integration is set up in **M1**, before the first feature, and is a merge blocker
from that point. A pipeline that starts after the code does not start.

### 37.2 Pipeline stages

Every pull request runs, in order, with later stages skipped if an earlier one fails:

| # | Stage | Blocking |
|---|---|---|
| 1 | Secret scan of the diff | Yes |
| 2 | Markdown lint and link check | Yes |
| 3 | Backend lint and format (`eslint`, `prettier --check`) | Yes |
| 4 | Backend type check (`tsc --noEmit`) | Yes |
| 5 | Backend unit tests | Yes |
| 6 | Backend integration + RLS + ledger invariant tests against a real PostgreSQL service | Yes |
| 7 | Migration rehearsal on a prior-schema database | Yes |
| 8 | Flutter analyze (`flutter analyze --fatal-infos`) | Yes |
| 9 | Flutter unit and widget tests | Yes |
| 10 | Flutter golden tests | Yes |
| 11 | Import-boundary and layering check (§6.3) | Yes |
| 12 | Vocabulary ban check over sales/purchasing/customers features (§2.2) | Yes |
| 13 | Localization check: no user-visible hardcoded strings (§6.8) | Yes |
| 14 | Design-system check: no raw colours or font sizes outside `core/ui` (§6.9) | Yes |
| 15 | Immutability check: no journal update or delete call (§31.1) | Yes |
| 16 | Contract generation and drift check | Yes |
| 17 | Dependency audit and static analysis | Yes |
| 18 | Flutter build for Windows and Android (release) | Yes |
| **19** | **Local migration test: every Drift migration forward from the previous version** (§38.6.2) | Yes |
| **20** | **Sync unit and integration tests: idempotency, ordering, and retry** (§38.9, §38.10) | Yes |
| **21** | **Offline invariant tests: T-O1…T-O22** (§38.26) | Yes |
| **22** | **Loop-prevention check: applying a remote change set leaves the outbox unchanged** (§38.12) | Yes |
| **23** | **No outbox delete path in feature code** — the cashier cannot delete a pending mutation (§38.30.1) | Yes |
| **24** | **No local write outside `applyRemoteWithoutOutbox` for remote applies** (§38.12.1) | Yes |

Stages 1-4 and 8-15 are **fast checks** that run in under five minutes combined. The slow
stages run in parallel jobs.

**Stage 24 deserves emphasis.** It is a *mechanical* check, not a behavioural one: a lint-style
rule forbids any code path from writing locally in response to a remote change except through the
single guarded entry point. A single unguarded path would create an infinite replication loop
that is nearly impossible to diagnose in the field and would corrupt a shop's data. Making it
structurally impossible is far cheaper than debugging it.

Stages 1–4 and 8–15 are **fast checks** that run in under five minutes combined. The slow
stages run in parallel jobs.

### 37.3 Required CI gates

| Gate | Rule |
|---|---|
| G-1 | No pull request merges with a failing required check. |
| G-2 | Branch protection on `main`: required checks, no force push, no direct push. |
| G-3 | Every pull request requires owner review. There is no self-merge. |
| G-4 | No pull request merges without an explicit owner authorization step. M0-P1 established this for itself; the rule generalizes. |
| G-5 | Coverage thresholds are enforced as CI failures, not advisory reports (§36.2). |
| G-6 | Migration files are immutable: CI fails if a migration already present on `main` is modified. |
| G-7 | Contract drift fails CI (§7.1). |
| **G-8** | **Local schema migrations are immutable**, exactly like server migrations (§35.5). |
| **G-9** | **An offline invariant test failure blocks the merge.** There is no "flaky, retry" allowance for T-O1…T-O22. |

### 37.4 Deployment

Not in M0–M1. When it arrives, deployment is: migration job → application rollout → smoke
check against `/healthz` and `/readyz`. Migrations run **before** application rollout, never
concurrently, so a rolled-back application is never running against a newer schema it does not
understand.

---

## 38. Connectivity and offline architecture

> **Amendment 1.0 (M0-P2).** This section was rewritten in full. The previous
> server-authoritative online-first model is **superseded**. See §38.1.

### 38.1 Superseded decision record — MANDATORY

| Field | Value |
|---|---|
| **O-5 PREVIOUS** | `ONLINE-FIRST / OFFLINE SALES NOT SUPPORTED` — offline mutation explicitly excluded from V1 |
| **O-5 NEW OWNER DECISION** | `OFFLINE-CAPABLE POS REQUIRED IN V1` |
| **Reason** | Business continuity during Internet outages and cashier accountability |
| **Authority** | Repository owner |
| **Supersedes** | ADR-022, §38.1–§38.5 of Master Plan v1.0.0, O-5 and O-9 in §42.1, risk R-4 in §42.2, V1 scope statement in §3.1, and the "cached reads only" rows in §5.4 and §39.5 |
| **Effective** | Immediately, for all planning. Implementation still requires separate authorization. |

**This amendment supersedes any conflicting wording anywhere in this document.** Where an older
sentence contradicts §38, §38 governs. The remaining sections have been amended for consistency;
§38 is the authority for offline behaviour.

### 38.0 The eighteen architectural principles of offline POS — DECISION

These are the governing principles of the amended plan. Every later subsection serves one of them,
and a change that violates any of them is a defect regardless of how well it works.

| # | Principle | Enforced by |
|---|---|---|
| 1 | **Offline sale is a first-class V1 workflow**, not a degraded mode | §3, §38.22 Tier 1 |
| 2 | **Local durability before user-visible success** | §38.7 |
| 3 | **Atomic local business transaction** — sale, lines, payments, stock, credit, outbox, audit commit together or not at all | §38.7.1, invariant I-13 |
| 4 | **Durable outbox**, never deleted on send, only on trusted server acknowledgement | §38.8 |
| 5 | **Idempotent server mutations** — ten replays, one effect | §38.9, ADR-041 |
| 6 | **Push plus incremental pull** over a monotonic server sequence | §38.10, §38.11 |
| 7 | **Loop-free remote apply** through one guarded entry point | §38.12, ADR-038 |
| 8 | **Hard local no-negative-stock guard** — `AVAILABLE_QTY >= SALE_QTY`, no bypass at any permission level | §38.4, ADR-035 |
| 9 | **Inventory movement auditability** — quantity is always a fold over movements | §38.14.1 |
| 10 | **Immutable completed sales** — void only pre-finalization, then return or reversal; never DELETE | §16.7 |
| 11 | **Offline-capable receipt generation** that never depends on connectivity | §38.23.2 |
| 12 | **Cached but bounded authorization** — signed, versioned, expiring, never authoritative forever | §38.16, §38.17, ADR-044 |
| 13 | **Device identity** as the origin and accountability unit of every offline mutation | §12, §12.5 |
| 14 | **Server convergence after reconnect**, with visible divergence | §38.14.2 |
| 15 | **Double-entry remains deterministic and idempotent** — Option B, server-derived | §38.24, ADR-041 |
| 16 | **Barcode works without Internet** — all four input methods, vendor-independent | §15.3A.5, ADR-042 |
| 17 | **No fake global stock certainty** while multiple devices are disconnected | §38.15 |
| 18 | **Clear reconciliation instead of silent overwrite** | §38.14.2 |

### 38.2 The business requirement, stated in the owner's terms

Selling must not be disabled by an Internet outage. The cashier must never have to say *"I
couldn't record the sale because there was no network."* Every real sale must enter the system at
the moment it happens, **including during an outage**.

| # | Requirement | Consequence in this plan |
|---|---|---|
| 1 | No fake success | The client never reports success for a sale it did not durably commit (§38.7) |
| 2 | No silently lost transaction | Durable local commit before user-visible success (§38.7) |
| 3 | No partially existing sale | One atomic local transaction covers sale, lines, payments, stock, credit, outbox (§38.7) |
| 4 | No reliance on cashier memory | The record exists on the device before the receipt is printed (§38.7, §16.7) |

### 38.3 The physical POS model — DECISION

My Shop is **not** an e-commerce system. It sells goods physically present at the till.

| Setting | Behaviour |
|---|---|
| Supermarket | The cashier scans items physically in the customer's basket. |
| Clothing store | The cashier scans the specific garment in hand, with its own size and colour. |
| General retail | The goods are already at the point of sale. |

**Therefore the offline design is not an online reservation system, and no stock-conflict
"reservation" concept is introduced.** There is no cart reservation, no hold, no expiry.

What the design *must* still do is prevent a cashier from recording more units than the system
knows exist (§38.4), while never claiming that a disconnected device has global real-time
certainty (§38.15).

### 38.4 Hard local no-negative-stock guard — DECISION, NON-NEGOTIABLE

**Invariant:** `AVAILABLE_QTY >= SALE_QTY` at the moment of the sale attempt.

If the device's known available quantity is `5` and the cashier attempts to sell `6`, **the
operation MUST be rejected.**

| Forbidden | Detail |
|---|---|
| Silent negative inventory | Never permitted. |
| Warning-only sale | Never permitted. |
| Automatic override | Never permitted. |
| Hidden manager bypass | Never permitted. An override, if it ever exists, is an explicit, permissioned, audited action — and V1 has none. |
| Silent correction | Never permitted. |

| Property | Decision |
|---|---|
| Guard lives in | **The local transaction, on the device** (§38.7). This is what makes offline selling safe. |
| Guard also lives in | The server, as the authoritative conditional update (§15.6). Defence in depth. |
| Rejection | `409 INSUFFICIENT_STOCK` locally, with the available quantity and the product identifier named. |
| Over-selling is never "fixed" by allowing it | Fixing it means correcting stock first (§38.5). |

### 38.5 Stock mismatch with physical reality — DECISION

If the system says `stock = 0` but the garment is physically in the cashier's hands, **it is not
sold by ignoring inventory.**

The required sequence is:

1. **Inventory Adjustment / Stock Correction** by a user holding the appropriate permission
   (`inventory.adjust`, plus `catalog.cost.edit` when a cost is involved).
2. The adjustment is **audited**, **actor-attributed**, **timestamped**, and
   **reason-coded**.
3. It is **immutable**, or corrected only by reversal.
4. **Then** the sale is permitted.

**The sale is never used to correct a stock error.** A sale is a business event; an adjustment is
a correction of fact. Mixing them destroys both the audit trail and the costing.

Offline behaviour of adjustments is tiered in §38.22 and is an owner decision (O-14).

### 38.6 Local persistence — DECISION

The client gains durable relational local persistence. It is a **first-class, governed
subsystem**, not a cache.

| Concern | Decision |
|---|---|
| Technology | **SQLite via Drift**, with generated schema and generated queries. Chosen over hand-written SQL because a client-side schema now exists in its own right and must have real migrations, real transactions, and real type safety. Rationale and rejected alternatives in §38.6.1. |
| Client ORM boundary | Drift is **client-local only**. It is never used to talk to PostgreSQL. The server contract is generated from OpenAPI (§6.2). |
| Schema ownership | The **server** owns the business contract. The local schema is a client-owned projection with an explicit `local_schema_version` (§38.7.2). A local table is never a second source of business truth (§38.6.3). |
| Migrations | Forward-only, versioned, generated by Drift, committed. §38.7.2. |
| Transaction boundaries | One transaction per business operation. §38.7.1. |
| Indexing | Indexed on every column used by a guard, an outbox scan, or a sync cursor. |
| Durability | `PRAGMA journal_mode = WAL`, `PRAGMA synchronous = FULL` for the outbox and business tables, `PRAGMA foreign_keys = ON`. See §38.6.4. |
| Corruption / recovery | §38.6.5. |
| Test strategy | §38.6.6. |

#### 38.6.1 Technology rationale

| Option | Verdict |
|---|---|
| **Drift over SQLite** | **Selected.** Compile-time type safety, real migrations, real transactions, testable in memory, and no hand-written SQL scattered through feature code. |
| `sqflite` + hand-written SQL | Rejected. The legacy application used exactly this and produced a 3,926-line hand-written SQL file with hand-migrated schema and a hand-copied test schema that would drift. §5.4. |
| `drift` sync/daemon layer for the whole client | Rejected. It would put a local database in the path of every read, blurring the server/local boundary the whole design depends on. Drift is used **only** for the offline subsystem and reference cache. |
| Isar / Hive / sembast | Rejected. No relational transactions of the required strength, and no migration story comparable to Drift's. |

#### 38.6.2 Migrations and schema versioning

| Rule | Detail |
|---|---|
| `local_schema_version` | A single integer in a `local_meta` table, advanced by Drift. |
| Migration rules | Forward-only, additive-first, exactly as the server (§35.1). No destructive step in the same release that stops writing the old shape. |
| Minimum supported client schema | Published by the server. A client below it is refused service (§38.7.2). |
| Safe migration tests | Every migration applied to a fixture at the previous version; data preserved; invariants re-checked. |
| Local backup before migration | The local database is copied to a timestamped file before any migration that is not purely additive, retained for one version. |

#### 38.6.3 What the local database is and is not

| It IS | It is NOT |
|---|---|
| The durable record of what this device has accepted responsibility for, while disconnected | A competing source of business truth |
| A working queue for convergence | An accounting ledger |
| A read cache for reference data | A mirror the client may reconcile against on its own authority |
| Fully auditable, with every mutation attributed | Something the client may edit to change a number |

**The server remains the single accounting authority** (§28). The client stores business
*events*, and the server derives accounting from them (§38.24).

#### 38.6.4 Durability expectations

The client's durability promise is stated precisely, because it is what the whole design rests on:

| Guarantee | Level |
|---|---|
| Committed sale survives application crash | **Yes** — transactional commit before acknowledgement |
| Committed sale survives OS kill | **Yes** |
| Committed sale survives power loss | **Yes, on modern hardware**, via `synchronous = FULL`. Not guaranteed against physical media failure. |
| Committed sale survives device loss before sync | **No** — see §38.25. Mitigated by device-bound encrypted sync backup (O-15). |
| Local database is encrypted at rest | **Planned, not yet decided** — §38.29. Not a V1 guarantee until the owner confirms (O-16). |

#### 38.6.5 Corruption and recovery

| Situation | Behaviour |
|---|---|
| Integrity check fails on startup | The app refuses to sell, reports corruption, and offers restore. It **never** silently recreates the database, because that would lose committed sales. |
| Automatic restore | From the newest local pre-migration backup that passes `PRAGMA integrity_check`. |
| No valid backup | The device is placed in a **read-only quarantine**: catalog readable, no sales. An explicit, permissioned re-initialization tool (§38.30) is the only way forward, and it exports the corrupt file for the owner first. |
| Partial write during power loss | Recovered by SQLite's WAL. A sale is either fully present or fully absent; there is no half-sale. This is enforced by test (§36.4, I-13). |

#### 38.6.6 Local persistence test strategy

| Level | Scope |
|---|---|
| Unit | Drift DAO behaviour, guard predicates, outbox state transitions, money arithmetic in minor units |
| Migration | Every migration applied forward from the previous version with data preserved |
| Crash simulation | Kill the process at each defined point inside the local transaction; assert no half-sale (§38.7, I-13) |
| Corruption | Truncate and corrupt a copy; assert the refusal-and-restore path |
| Concurrency | Two sales of the last unit in the same process and across simulated processes |

### 38.7 The atomic local business transaction — DECISION

**Local durability precedes user-visible success.** The success indicator is shown only after the
local transaction has committed.

#### 38.7.1 Transaction boundary — one transaction, one sale

A single local transaction writes **all** of the following, or **none**:

| # | Written in the same transaction | Table |
|---|---|---|
| 1 | Sale header, including device-local sequence and local timestamp | `local_sales` |
| 2 | Every sale line with its full financial snapshot (§16.2) | `local_sale_lines` |
| 3 | Every payment allocation | `local_sale_payments` |
| 4 | The stock guard check **and** the resulting stock movements | `local_stock_movements`, `local_stock_levels` |
| 5 | The local cost snapshot used for the sale (§38.24) | `local_stock_levels.average_cost_minor` |
| 6 | The customer credit effect, when the sale is on credit (§38.19) | `local_customer_ledger_entries` |
| 7 | The outbox record | `outbox` |
| 8 | The local audit event | `local_audit_events` |
| 9 | Sync metadata | `sync_state` |

**The following states are structurally impossible, by construction:**

| Forbidden state | Why it cannot occur |
|---|---|
| Sale saved but stock not decremented | Same transaction |
| Stock decremented but invoice not saved | Same transaction |
| Payment saved but sale not saved | Same transaction |
| Accounting duplicated after sync | Server-side idempotency (§38.8, §28.7) |

#### 38.7.2 Local schema version and refusal

The client publishes its `local_schema_version` on every push. The server compares it to the
minimum it supports. A client below the minimum receives a structured `CLIENT_TOO_OLD` response,
which places the device in a **read-only state with a clear upgrade prompt** — it does not
attempt a sale it cannot guarantee. See §38.25 for the server-schema-mismatch case.

### 38.8 Durable outbox — DECISION

Every syncable mutation writes an outbox record **inside** the business transaction (§38.7.1), so
a committed sale always has a queued record.

#### 38.8.1 Required outbox fields

| Field | Type | Purpose |
|---|---|---|
| `mutation_id` | UUIDv7 (client-generated) | Primary identity. Time-ordered, collision-resistant |
| `organization_id` | UUID | Tenant scope, from device binding (§38.16), never from user input |
| `device_id` | UUID | Which installation produced it |
| `actor_user_id` | UUID | Who performed it — attribution (§23) |
| `actor_role_snapshot` | JSON | Effective permissions at the time, for offline authorization audit (§38.17) |
| `aggregate_type` | enum | `SALE`, `SALE_PAYMENT`, `RETURN`, `CUSTOMER_COLLECTION`, `INVENTORY_ADJUSTMENT`, … |
| `aggregate_id` | UUID | The local identity of the business object |
| `operation_type` | enum | `CREATE`, `VOID`, `RETURN`, `REVERSE` |
| `payload` | JSON | The complete immutable business event (§38.24) |
| `payload_version` | integer | Contract version of the payload |
| `device_local_sequence` | monotonic integer, per device | Total order within the device, independent of clock |
| `local_created_at` | timestamp with monotonic guard | Device wall clock, plus a monotonic tiebreak |
| `sync_state` | enum | §38.13 |
| `attempt_count` | integer | Retry accounting |
| `last_error_code` | nullable | Last rejection or failure classification |
| `last_attempt_at` | nullable | Diagnostics |
| `device_idempotency_key` | string | `mutation_id`, duplicated into the server payload so the server key is derivable offline |

#### 38.8.2 Outbox rules — non-negotiable

| Rule | Detail |
|---|---|
| **Never delete on send** | A record is deleted only after a **trusted server acknowledgement** (§38.9.2). Sending is not acknowledgement. |
| **Never delete on timeout** | A timeout is ambiguous. The record stays and is retried; idempotency makes the retry safe. |
| **Append-only payload** | `payload` is never rewritten after commit. A changed business intent is a new mutation. |
| **Never edited by the cashier** | No update or delete path exists in the UI or the API surface (§38.30). |
| **Bounded retries, then escalation** | Retryable failures back off and retry (§38.10.4). A permanent rejection goes to `PERMANENT_REJECTED` and raises an owner-visible alert (§38.13). It is never silently dropped. |

### 38.9 Idempotency — DECISION

#### 38.9.1 The mutation ledger

The server owns an append-only `mutation_ledger` table:

| Column | Detail |
|---|---|
| `organization_id` | Tenant scope |
| `mutation_id` | The client-generated UUIDv7 — **unique with `organization_id`** |
| `device_id` | Origin device |
| `received_at` | **Server** clock. Distinct from `local_created_at` (§23.1) |
| `payload_hash` | SHA-256 of the canonical payload |
| `result_ref` | The business object the mutation produced |
| `result_hash` | Hash of the resulting state, used to detect a genuine contradiction |
| `status` | `APPLIED`, `REJECTED` |
| `rejection_code` | Present when rejected |

#### 38.9.2 Acknowledgement semantics

| Rule | Detail |
|---|---|
| Success means | The server transaction committed **and** the response was durably written by the client. |
| `APPLIED` | First time seen: the mutation is applied in one transaction with the ledger row. |
| `REPLAY` | Seen again with an **identical** `payload_hash`: the server returns the **original stored response** and applies nothing. Ten replays produce one effect. |
| `CONTRADICTION` | Seen again with a **different** `payload_hash`: rejected `409 MUTATION_CONTRADICTION`, flagged for owner review, and recorded as a security event. This is the idempotency-bypass alarm (§38.28). |
| Partial batch | A batch is **not** atomic. Each mutation is independently applied or rejected, and the response reports per-mutation outcomes (§38.10.3). |

#### 38.9.3 Retry safety

Every mutation is safe to send any number of times because the ledger row is inserted in the
**same transaction** as the business effect. A crash between the two is impossible; a crash before
commit leaves no trace and the retry simply applies once.

### 38.10 Push protocol — DECISION

#### 38.10.1 Shape

`POST /api/v1/sync/push`

| Element | Decision |
|---|---|
| Batch size | 1–50 mutations per request, oldest `device_local_sequence` first |
| Ordering | Ascending `device_local_sequence`. Order within a device is preserved; order **across** devices is not guaranteed and is not relied upon |
| Auth | Bearer access token (§38.16) plus the device identity assertion |
| Content | Complete immutable payloads. The server never partially trusts a delta |
| Response | Per-mutation outcome: `mutation_id`, status, `result_ref`, `server_sequence`, `received_at`, or a structured error |

#### 38.10.2 Ordering within a device

Because one cashier's sales must read in the order they happened, `device_local_sequence` is a
gap-free per-device counter allocated **inside** the local transaction. It is the ordering key for
attribution and audit, and it is what makes an out-of-order or clock-skewed device still produce a
coherent history.

#### 38.10.3 Partial batch behaviour

A batch containing one bad mutation **must not** fail the others. The response is per-mutation, so
a permanently rejected mutation (§38.13) does not block the sales queued behind it. This is a
deliberate departure from all-or-nothing batching: an offline till cannot be held hostage by one
bad row.

#### 38.10.4 Retry

| Failure | Behaviour |
|---|---|
| Network error, DNS failure, timeout | Exponential backoff with jitter, honouring `Retry-After`. Record stays `PENDING`. |
| `429` | Honour `Retry-After`. |
| `5xx` | Backoff and retry. The mutation may or may not have applied; idempotency makes retry safe. |
| `4xx` permanent | `PERMANENT_REJECTED` with the code recorded, and an owner-visible alert. Never retried, never dropped. |
| `401` / `403` | Authorization failure. The device is flagged; offline grace is re-evaluated (§38.16.4). |

#### 38.10.5 Resume

The client resumes from its local cursor, never from memory. Because the outbox is durable and
ordered, resuming is simply "send everything not yet acknowledged".

### 38.11 Pull protocol and the server change sequence — DECISION

#### 38.11.1 The server sequence

The server exposes a single **monotonic per-organization sequence** over the authoritative change
set. Every tenant-owned mutation that alters a record another device may read assigns the next
value.

| Property | Decision |
|---|---|
| Scope | Per organization |
| Monotonic | Strictly increasing, never reused, never reordered |
| Gapless | **Not** guaranteed. A rolled-back transaction consumes a value. Gaps are expected and harmless |
| Source of truth for "what changed" | A `change_log` table, written **in the same transaction** as the business change |
| Retention | Retained for a stated window (default 90 days). A client whose cursor is older than retention performs a full re-baseline rather than a partial pull |

#### 38.11.2 Shape

`GET /api/v1/sync/pull?after={server_sequence}&limit={n}`

| Element | Decision |
|---|---|
| Paging | Cursor-based on `server_sequence`. `limit` bounded, default 200, hard maximum 1000 |
| Resume | The client stores `last_server_sequence` **only after** the batch is applied locally |
| Interruption | Disconnecting mid-pull loses nothing: the cursor advances only on success, and the next pull re-fetches |
| Consistency | Each page is a snapshot at a sequence. The client may observe a newer value overwritten by an older page, so **the server sequence guards application order** (§38.12.1) |
| Own-echo suppression | A change the server itself produced from this device's mutation is still returned, but carries the originating `mutation_id`, letting the client reconcile rather than re-apply blindly |

#### 38.11.3 What is pulled

| Change set | Pushed to other devices |
|---|---|
| Product and variant changes | Yes |
| Price and settings changes | Yes |
| Stock movements | Yes — so a second till converges |
| Sales, once server-accepted | Yes, so the owner sees central activity |
| Other devices' **un-synced** offline sales | **No** — and the plan never claims otherwise (§38.15) |

### 38.12 Loop prevention — DECISION, TESTED

#### 38.12.1 The rule

**Applying a remote change MUST NOT create an outgoing mutation.** Every remote apply path goes
through a single explicit entry point:

```
applyRemoteWithoutOutbox(change)
```

| Rule | Detail |
|---|---|
| Single entry point | One function, in one module, is the only code permitted to write locally on behalf of the server. |
| Outbox suppression is structural | Remote applies run inside a suppression context; the outbox writer throws if invoked while it is active. This is a **crash-on-violation**, not a flag to be remembered. |
| Sequence guard | A local write is discarded if the incoming `server_sequence` is **older** than the record's last-applied sequence. Stale pages cannot undo newer state. |
| Verified by test | A dedicated test asserts the outbox count is unchanged after applying an arbitrary remote change set (§38.26). |

#### 38.12.2 Why this is a hard rule

A single unguarded remote-apply path creates an infinite replication loop that is extremely hard
to diagnose in the field and destroys a shop's data. It is therefore made structurally impossible
and independently tested, not merely documented.

### 38.13 Sync state machine — DECISION

**There is no `isSynced` boolean.** Sync state is an explicit lifecycle with a recorded history.

| State | Meaning | Next |
|---|---|---|
| `LOCAL_ONLY` | Committed locally, not yet eligible to push — for example within the same tick as creation | → `PENDING` |
| `PENDING` | Eligible to push. The normal resting state of an offline sale | → `SYNCING` |
| `SYNCING` | In flight | → `SYNCED`, `RETRYABLE_ERROR`, or back to `PENDING` |
| `SYNCED` | **Server acknowledged.** Terminal for that mutation | — |
| `RETRYABLE_ERROR` | Transient failure; scheduled retry with backoff | → `PENDING` |
| `CONFLICT` | Applied locally and server-side, but the server state differs in a way needing review | → owner resolution |
| `PERMANENT_REJECTED` | Server refused permanently. **Never silently dropped** | → owner resolution |

Each transition is timestamped and written to the local audit log (§38.28). An owner-visible screen
lists counts by state (§38.31).

### 38.14 Inventory conflict policy — DECISION

**Last-write-wins is forbidden for inventory.** Stock is governed by movements (§15.4), never by
overwriting a total.

#### 38.14.1 Movement identity

Every stock movement, local or server, carries a stable identity:

| Field | Purpose |
|---|---|
| `movement_id` | UUIDv7, primary identity |
| `origin_mutation_id` | The outbox mutation that produced it, when device-originated |
| `device_id` + `device_local_sequence` | Per-device ordering |
| `server_sequence` | Assigned when the server accepts it |
| `cause` | The closed vocabulary of §15.5 |
| `quantity_delta` | Signed |
| `unit_cost_minor` | The cost used, snapshotted |
| `reverses_movement_id` | For corrections |

Movement causes across the offline boundary:

| Cause | Origin |
|---|---|
| `SALE` | Device, possibly offline |
| `SALE_RETURN` | Device, possibly offline |
| `INVENTORY_ADJUSTMENT` | Device or server |
| `STOCK_COUNT_ADJUSTMENT` | Device or server |
| `PURCHASE_RECEIPT` | Server only in V1 (§38.22) |
| `PURCHASE_RETURN` | Server only in V1 |
| `OPENING_BALANCE` | Server only |
| `SHRINKAGE` | Device or server |
| `REVALUATION` | Server only — it is a costing act (§38.24.3) |
| `OFFLINE_SALE_VOID` | Device, before finalization (§38.17) |

#### 38.14.2 Reconciliation, never overwrite

When a device reconnects, its movements are applied as **events**. The server's quantity is a fold
over accepted movements. A device's local quantity is a fold over its own local movements plus
last-pulled server movements.

When those two folds disagree, the outcome is **a reconciliation record, never a silent
overwrite**:

| Step | Action |
|---|---|
| 1 | Both movement sets are retained. Neither is discarded |
| 2 | The server computes the divergence per product: expected versus actual |
| 3 | The divergence is written to a reconciliation record with full attribution |
| 4 | Resolution is a **new, attributed, reason-coded movement** (`MANUAL_ADJUSTMENT` or `STOCK_COUNT_ADJUSTMENT`) — never an edit |
| 5 | If the divergence was caused by the same physical units being sold on two disconnected devices, the shop has a real business problem. The system surfaces it prominently (§38.15 and §38.31.1) and does **not** paper over it |

**The current quantity is always derived from movements.** No path writes a stock total directly.

### 38.15 Multi-device reality — stated honestly

| Situation | What is true |
|---|---|
| All devices online | The server serialises stock mutations (§15.6). One authoritative quantity. |
| One device offline | It sells against its own known quantity. The server's view is stale until it syncs. |
| Two or more devices offline | **There is no global real-time inventory certainty, and My Shop never claims there is.** Two tills can each believe they hold the last unit. |

#### 38.15.1 The three distinct concepts

| Concept | Definition | Enforced by |
|---|---|---|
| **Local guard** | This device will not sell more than the quantity it knows it has | §38.4, inside the local transaction |
| **Physical reality** | The goods are in front of the cashier | Human reality; captured by an adjustment when it disagrees (§38.5) |
| **Synchronisation reconciliation** | Divergence between devices is detected and explained when connectivity returns | §38.14.2 |

#### 38.15.2 Why offline is not abandoned for this

Global certainty during a multi-device outage is **impossible without either central
coordination or physical locking of the goods**. Refusing to sell does not create certainty; it
creates lost sales and an angry queue. The honest engineering answer is:

> Guarantee **per-device** correctness absolutely, guarantee **per-device** accountability
> absolutely, guarantee **eventual convergence** and **visible reconciliation**, and state
> plainly that global certainty during a multi-device outage is unavailable.

This is a deliberate, bounded, documented limitation — not an oversight.

### 38.16 Offline authentication — DECISION

#### 38.16.1 The problem

Requiring a server round-trip to start the app would make an offline till unusable, which defeats
the entire purpose. But an indefinitely cached credential is unacceptable.

#### 38.16.2 Offline authenticated grace — bounded

| Property | Decision |
|---|---|
| Who | **Only a previously authenticated user** on a **previously registered and not-revoked device**. There is no offline first-run, no offline enrolment, no offline password check. |
| Binding | The local session is bound to the **device installation id** and to the user id. Moving the local database to another machine does not yield a working offline session (§38.29). |
| Storage | Encrypted at rest, keyed by the platform keystore (§38.29). |
| Grace window | Organization setting `offline_grace_duration`, **default 72 hours**, owner-controlled, maximum 30 days. See O-13. |
| Expiry | At expiry the device goes read-only for mutations. It does not delete anything. Sales already committed remain committed and still sync. |
| Recovery | Re-authentication online restores the window. An owner can also extend it, with an audit event. |

#### 38.16.3 Cached authorisation snapshot

The offline session carries a signed snapshot: the user's permissions, `permissions_version`, the
organization id, the device id, the issued-at time, and the grace expiry. It is validated locally
against the stored signature before use.

#### 38.16.4 Revocation — the honest limitation

| Case | What happens | Delay |
|---|---|---|
| User revoked | The device **cannot know** while offline. It continues within its grace window, then goes read-only at expiry or at first successful sync, whichever is sooner. | Up to the grace window |
| Device revoked | Same. | Up to the grace window |
| `permissions_version` changed | Same. The stale snapshot is used until sync. | Up to the grace window |
| Password changed by the user | The local session is invalidated immediately on that device, because the password change is a local security action. | Immediate, on that device |

**This is stated as a bounded, accepted risk (R-14), not presented as a solved problem.** No
offline system can revoke a credential it cannot hear about. The mitigation is a **short,
owner-controlled grace window**, not a claim of instant revocation.

#### 38.16.5 Entitlement and clock tampering

| Concern | Decision |
|---|---|
| Entitlement expiry | If the organization is on a time-limited plan, offline sales stop at entitlement expiry and the device goes read-only. An expired entitlement cannot be extended offline. |
| Clock tampering — backward | A monotonic counter plus a persisted high-water mark. A clock that moves backwards does not re-issue receipts or re-open an expired window. |
| Clock tampering — forward | **Detected and rejected**: forward jumps beyond a stated tolerance require online re-validation. Recorded as a security event. |
| Clock tampering — general | Business dates derive from a **server-issued time offset** applied to the device clock, not the raw device clock, so an offline receipt carries a defensible date (§16.4A.2). |
| Signed time anchor | The server issues a signed time anchor on every successful sync; the client stores the last one. |

### 38.17 Offline permissions — DECISION

| Property | Decision |
|---|---|
| Authority | The **server** is the permission authority. A cached snapshot is **bounded and never authoritative forever**. |
| Snapshot contents | Effective permission set, `permissions_version`, issued-at, expiry, signature |
| Validation | Signature verified locally before every privileged action |
| On change while offline | **Cannot be detected.** Documented as accepted bounded risk R-15. |
| On reconnect | Snapshot replaced. If `permissions_version` dropped, the device immediately loses the affected permissions and any action attempted with them is refused |
| Owner-exclusive | Unchanged (§11.2). An offline snapshot can never grant an owner-exclusive permission, because the server never issues one to a non-owner |
| Recording | The snapshot in force is recorded on every offline mutation (`actor_role_snapshot` in the outbox), so the server can audit **what the device believed** at the time |

### 38.18 Offline settings — DECISION

Settings that affect selling are cached with explicit versioning.

| Setting group | Cached | Behaviour when stale |
|---|---|---|
| Pricing mode, discount ceilings, approval threshold | Yes | Selling continues with the cached policy. Every affected line is flagged and appears in the stale-policy exception report |
| Invoice output default, footer | Yes | Cosmetic; continues |
| Customer-required-on-credit | Yes | Continues with cached policy |
| Negative-stock policy | Yes | Always the strict setting (§38.4) |
| Currency, minor-unit exponent | Yes | **Never changes mid-grace.** Changing currency requires online reconnection |
| Roles, permissions, device settings | Yes | §38.17 |
| Accounting chart, posting rules | Not cached, not needed locally | The client does not post (§38.24) |

| Rule | Detail |
|---|---|
| `settings_version` | A monotonic integer per organization. The cached copy carries the version it was fetched at. |
| Stale detection | `settings_version` from a pull newer than the cached copy supersedes it. |
| Safe fallback | If settings are **missing entirely** on a fresh offline device, mutations are refused — the device must fetch settings once before it may sell. Selling without knowing the pricing mode is not safe. |
| Conflict handling | Server settings always win. There is no local settings edit that syncs upward. Settings are **server-owned, read-only on the client**. |

### 38.19 Offline pricing and discount — DECISION

The three pricing modes are unchanged (§17). What changes is that enforcement now has two
enforcement points.

| Rule | Detail |
|---|---|
| Cached policy is trusted for enforcement | The device enforces the pricing mode and discount ceilings from its **signed, versioned** cached settings |
| Stale prices | An offline sale uses the cached selling price. The applied price and the list price are **both snapshotted** onto the line (§16.2), so the sale is internally consistent |
| Server re-validation | On sync the server re-validates the discount against the **then-current** ceilings. |
| If the ceiling has since tightened | The mutation is **accepted** — the sale physically happened and goods changed hands — but flagged `PRICING_POLICY_DRIFT` and surfaced to the owner. **It is never silently voided.** |
| If the ceiling has since loosened | No effect. |
| Unauthorized override offline | Impossible: the device enforces the same `pricing.override` rule from the signed snapshot, and the server re-checks on sync. A forged override is caught server-side and flagged. |
| Availability preserved | A stale price never blocks a sale. Staleness is reported, not enforced as a hard failure. |

**Why not block?** Because refusing a completed physical sale over a policy change would create
exactly the cashier dead-end the owner prohibited.

### 38.20 Offline customer credit — DECISION

| Aspect | Decision |
|---|---|
| Credit sale offline | **Permitted.** A local `customer_ledger_entry` is written in the same transaction (§38.7.1) |
| Cached balance semantics | The device displays a **cached** balance, always labelled with its `server_sequence` and age (§38.21) |
| Cross-device certainty | **Not claimed.** If another till took a collection while this one was offline, this device's balance is stale until sync |
| Over-credit | Not blocked locally beyond the credit limit policy; the local cached balance plus the limit is the guard |
| Duplicate prevention | Server-side idempotency (§38.9) plus the customer's ledger structure. A duplicate collection replayed ten times applies once |
| Reconciliation | After sync the client's cached balance is replaced by the server's ledger-derived balance. If they differ, the difference is explained by the incoming movements — the client never edits its balance to match |

**The customer ledger remains server-authoritative** (§19.2). The local ledger entry is a queued
business event, not a competing balance.

### 38.21 Offline treasury — DECISION

| Aspect | Decision |
|---|---|
| Cash, bank, wallet payment | Recorded locally in the sale transaction (§38.7.1) and pushed as part of the sale |
| Current balance while offline | **Displayed as cached**, with its `server_sequence` and age. Never presented as current |
| Remote current balance | **Not consulted** while offline. A remote balance would be stale and would suggest a certainty that does not exist |
| Auditability | Every movement is attributed and immutable, locally and on the server |
| Overdraft | The device may allow a sale that takes a cached treasury balance negative if the stock guard passes. Real financial-account negative balances are a **server-side** control (§27.3), applied on sync. This is flagged in the reconciliation report rather than blocked at the till, because the cash is physically in the drawer |

### 38.22 Offline operations tiering — DECISION

**Not every module becomes offline.** Over-applying offline support is how offline systems become
unreliable. Operations are tiered explicitly.

#### Tier 1 — MUST work offline

| Operation | Notes |
|---|---|
| POS sale, including credit | §38.7 atomic local transaction |
| Sale payments across accounts | Same transaction |
| Local stock decrement | Inside the same transaction, behind the hard guard (§38.4) |
| Receipt / invoice output | §38.23 |
| Barcode scanning, all four input methods (§38.25) | Camera and hardware scanner work with no network |
| Catalog and stock lookup | From the local cache |
| Reprint of a locally held receipt | From the local database |

#### Tier 2 — STRONGLY DESIRABLE offline

| Operation | Recommendation | Rationale |
|---|---|---|
| **Inventory adjustment / stock count** | **Recommended: allow offline**, with `inventory.adjust` from the signed snapshot and mandatory reason code. This is **required** to make §38.5 workable while disconnected. | Without it, a physical-goods mismatch cannot be resolved during an outage — the exact scenario the owner cares about. Owner decision O-14. |
| **Sale return** | **Recommended: allow offline only when the original sale is locally known or reliably cached** (§38.23). Otherwise refuse and require online processing. | Prevents anonymous stock inflation and refunds that cannot be reconciled. Owner decision O-15. |
| **Customer collection** | **Recommended: allow offline.** It is cash movement with strong accountability and a clean ledger. | Owner decision O-16. |

#### Tier 3 — ONLINE ONLY in V1

| Operation | Rationale |
|---|---|
| User administration, invitations | Authorization must not be granted from a stale snapshot |
| Role and permission changes | Same, and `ownerExclusive` (§11.2) must never be grantable offline |
| Device revocation | Self-revocation from an offline device is incoherent |
| Purchases and purchase returns | Receiving stock changes the **moving average cost** (§38.24.3), which is a costing act. See the warning below. |
| Customer and supplier creation, statement generation | Ledger-owned data |
| Manual journals, reversals | Accounting is server-derived (§38.24) |
| Settings changes to pricing, discount, or currency | Settings are server-owned (§38.18) |
| Financial account transfer | Needs both current balances |
| Any report requiring the ledger | §38.31 |

**Warning recorded deliberately.** Purchases being Tier 3 is a real operational cost: a shop
cannot receive a delivery while offline. The reason is specific and important — **the moving
average cost is a shared, cumulative calculation.** Allowing two devices to compute a moving
average independently and reconcile later is a materially harder problem than selling, and it
would put costing integrity at risk for a benefit the owner did not request. This is stated as a
limitation with a rationale, not hidden. It is raised for the owner as O-17.

### 38.23 Offline returns and receipts

#### 38.23.1 Sale returns offline — DECISION

| Case | Behaviour |
|---|---|
| Original sale is held locally on this device | **Return permitted offline.** Restores stock at the **original line's snapshotted cost** (§30.4), creates a `SALE_RETURN` movement, and queues the mutation |
| Original sale is in the local cache with a reliable server reference | **Return permitted offline**, restoring at the snapshotted cost from the cached line |
| Original sale unknown to the device | **Refused offline** with a clear message: *"This sale is not on this device. Connect to process the return."* |
| Refund exceeds the original paid amount | Refused. A return can never create money |
| Anonymous stock inflation | Structurally impossible — a return requires an identified original line, so stock always decreases by exactly the returned quantity |

#### 38.23.2 Receipts remain valid offline — DECISION

| Requirement | Decision |
|---|---|
| Complete the sale | Yes, offline (§38.7) |
| Print, if a printer is available | Yes. Printing has **never** depended on connectivity and still does not |
| Save a local copy | Yes, written in the same transaction |
| Produce no invoice | Yes, when policy allows (§21.2) |
| **Invariant** | **Printed total = persisted sale total** (§21.4). Unchanged, and it holds offline because both come from the same local transaction |
| Receipt identity offline | Uses the offline receipt identity (§38.24.1), not a server invoice number |

### 38.24 Accounting under offline — DECISION, Option B selected

#### 38.24.1 Option selection

| Option | Description | Verdict |
|---|---|---|
| **Option A** | The client computes and stores an accounting event locally; the server verifies it | **Rejected** |
| **Option B** | The client stores an **immutable business event**; the server **deterministically derives** the accounting posting | **Selected** |
| Option C | The client posts to a local ledger, later consolidated | **Rejected** |

**Why Option A is rejected:** the client would need the chart of accounts, the cost basis, the
pricing policy, and the rounding rule to be exactly right offline. Any divergence is a silent
accounting error discovered days later. It also duplicates the posting rules in a second
implementation, which guarantees drift.

**Why Option B is selected:** the client already stores everything the posting needs (§16.2,
§38.7.1). The server derives the posting from the immutable event using the single posting map
(§28.5). There is exactly **one** implementation of the posting rules, and it is the server's.

**Double-entry remains locked** (§28). This adapts accounting to offline; it does not adapt
accounting to the client. The ledger remains server-only, balanced, immutable, and
reversal-corrected.

#### 38.24.2 What the client stores

The outbox payload is an **immutable business event** containing everything required to post:

| Element | Source |
|---|---|
| Sale header: organization, device, actor, local timestamp, device sequence, business date | §38.8.1 |
| Every line's full financial snapshot | §16.2 |
| Every payment allocation with financial account | §16.5 |
| Customer and supplier references where applicable | §19, §24 |
| The device-recorded cost basis per line | §38.24.3 |
| Discount actor and authorization reference | §18.2 |

#### 38.24.3 Cost basis, and the delayed-sync hazard

| Aspect | Decision |
|---|---|
| Device-recorded cost | Each offline line snapshots the device's `average_cost_minor` as `unitCostApplied`. This is what makes the sale auditable offline |
| Authoritative COGS | The **server** recomputes COGS from its own authoritative average at acceptance time, where the two differ |
| Divergence policy | The sale is **accepted** — goods changed hands. The server uses its own authoritative COGS and raises `COST_BASIS_DIVERGENCE` for owner review. It never silently accepts a device-invented cost |
| Silent history rewriting | **Prohibited.** The device's recorded cost is retained on the line as `device_unit_cost_minor`, alongside the server's `unitCostApplied`. Both are visible. History is corrected by an explicit revaluation (§30.5), never by a quiet overwrite |
| The hazard, stated plainly | Between a device's last sync and its next one, its moving average can be stale. Offline COGS therefore approximates the authoritative figure. **This is a real accuracy risk (R-16) and is the direct price of offline selling.** It is bounded by frequent sync and surfaced by the divergence report |

#### 38.24.4 Idempotent posting under retry — non-negotiable

| Rule | Detail |
|---|---|
| Posting key | `sourceDocumentId` + `postingType`, unique per organization. Equivalent to the existing `idempotencyKey` of §28.7 |
| Retry safety | Re-pushing a sale, ten times or once a year later, produces **exactly one** journal entry |
| Mechanism | The posting is written in the **same transaction** as the mutation-ledger row, so a replay can never double-post |
| No client-driven posting | There is no client-writable journal endpoint (§31.6). Unchanged |

### 38.25 Failure model — DECISION

The complete failure surface, with defined behaviour. **A happy path is not a specification.**

| # | Failure | Behaviour | User-visible outcome |
|---|---|---|---|
| F-1 | Server unreachable | Continue in offline mode for Tier 1 and 2 | Normal sale; sync indicator shows offline |
| F-2 | DNS failure | Same as F-1 | Same |
| F-3 | Request timeout | Mutation stays `PENDING`; backoff retry | Sale already committed locally; no user action |
| F-4 | Application killed mid-sale | Local transaction rolls back; nothing partial exists | The sale simply did not happen; the cashier restarts it |
| F-5 | Power loss mid-sale | WAL recovery yields all-or-nothing | Same |
| F-6 | Local database write failure | Transaction aborts; **no** success shown | Explicit error; the sale is not recorded and the cashier is told so |
| F-7 | Local database corrupted | Refuse to sell; restore path (§38.6.5) | Device quarantined, owner alerted |
| F-8 | Access token expired, offline | Grace window governs (§38.16.2) | Selling continues until grace expiry |
| F-9 | Grace window expired | Mutations refused; reads allowed | Clear message: connect to continue |
| F-10 | Device revoked while offline | **Cannot be known** until sync | Documented, bounded by grace (R-14) |
| F-11 | Stale permissions | Snapshot used; flagged | Selling continues; divergence reported |
| F-12 | Sync permanently rejected | `PERMANENT_REJECTED`; owner alert; record retained | The cashier's sale is safe locally; the owner is told |
| F-13 | Duplicate mutation pushed | Server ledger returns `REPLAY` | No second effect; the client marks `SYNCED` |
| F-14 | Mutation replay with a different payload | `409 MUTATION_CONTRADICTION`; security event | Owner investigation; possible tampering |
| F-15 | Server schema newer than client understands | `CLIENT_TOO_OLD`; device read-only with an upgrade prompt | Cannot sell until updated |
| F-16 | Client schema newer than server | Push refused with the local version; client remains functional offline | Cannot sync; owner alerted |
| F-17 | Outbox grows without bound | Background compaction of `SYNCED` records only, with a hard floor retained for audit | Storage guard; never unbounded |
| F-18 | Battery or storage exhaustion | Device warns before refusing; **no partial writes** | Explicit error |
| F-19 | Barcode scanner disconnected | Fallback to camera or manual entry (§38.26) | Sale continues |
| F-20 | Printer unavailable | `invoice_output_default` honoured; the sale is unaffected (§21.1) | "Neither" path; sale fully durable |
| F-21 | Clock jumps forward | Detected beyond tolerance; online re-validation required | Possible read-only until revalidated |
| F-22 | Clock jumps backward | Monotonic guard and high-water mark prevent re-issuing numbers | Transparent |

### 38.26 Offline test matrix — DECISION

Mandatory, release-blocking. Each is a named test, not a hope.

| # | Test | Assertion |
|---|---|---|
| T-O1 | **Local transaction atomicity** | Kill the process at each defined point inside the local transaction. Assert no half-sale, no stock-without-sale, no payment-without-sale |
| T-O2 | **Outbox durability** | Complete a sale with the app closed immediately after. Restart. Assert the sale **and** the outbox record both survive |
| T-O3 | **Idempotent replay** | Push the same mutation 10 times. Assert exactly one business object and exactly one journal entry |
| T-O4 | **Partial network failure** | Server applies the request, response is lost. Assert the retry yields `REPLAY` and one effect |
| T-O5 | **Duplicate push** | Same mutation pushed from two client instances. Assert one effect |
| T-O6 | **Pull resume** | Disconnect mid-pull. Assert the cursor did not advance and the resumed pull is complete and correct |
| T-O7 | **Sync loop prevention** | Apply an arbitrary remote change set. Assert the outbox count is **unchanged**. Repeat with a stale page and assert no rollback |
| T-O8 | **Negative stock prevention** | Sell more than local available. Assert rejection, no stock movement, no outbox record, no sale |
| T-O9 | **Offline sale, network disabled** | Complete a full sale with networking fully disabled. Assert local durability, stock decrement, payment record, receipt render |
| T-O10 | **Offline restart** | Kill and restart. Assert the sale, its snapshot, and the receipt are intact |
| T-O11 | **Multi-device convergence** | Two devices, both offline, both selling. Reconnect. Assert every movement is retained, the divergence is recorded, and resolution is an attributed adjustment rather than an overwrite |
| T-O12 | **Accounting duplicate prevention** | Retry a sale push 10 times. Assert the trial balance still balances and COGS appears once |
| T-O13 | **Invoice number behaviour** | Move repeatedly between online and offline. Assert no duplicate, no reuse, and a monotonic client-visible sequence |
| T-O14 | **Barcode uniqueness** | Force a collision on auto-generated and manual entry. Assert rejection with a clear error and no data corruption |
| T-O15 | **Offline auth grace** | Expire the grace window. Assert mutations are refused, reads continue, and committed sales still sync |
| T-O16 | **Revocation after reconnect** | Revoke the device and the user online while a device is offline. Assert that on sync the device immediately loses privileges and subsequent privileged actions are refused |
| T-O17 | **Grace expiry** | Assert a mutation attempted after expiry creates no local business record |
| T-O18 | **Corruption recovery** | Corrupt the local database. Assert refusal to sell, successful restore from backup, and that the corrupt file is preserved |
| T-O19 | **Local migration safety** | Apply every local migration forward from the prior version with data preserved |
| T-O20 | **Permanent rejection** | Force a `PERMANENT_REJECTED`. Assert the record is retained, alerted, and **never** silently dropped |
| T-O21 | **Outbox queue-deletion attack** | Attempt to delete or mark-synced an outbox record through any non-governed path. Assert it is impossible or audited |
| T-O22 | **Schema version mismatch** | Simulate old client and new server, and new client and old server. Assert defined read-only behaviour, not corruption |

### 38.27 Conflict classification — DECISION

**One generic conflict handler is forbidden.** Conflicts are classified, and each class has its own
resolution.

| Class | Definition | Resolution | Owner action |
|---|---|---|---|
| **Business conflict** | The mutation is well-formed but violates a business rule — insufficient server-side stock, discount ceiling now tighter | Accept the physical sale; apply the authoritative value; flag for review | Review the exception report |
| **Authorization conflict** | The device's permission snapshot is stale, or the user was revoked | Apply if still permitted under the **then-current** permissions; otherwise quarantine the mutation | **Immediate review.** Possible revocation abuse |
| **Version conflict** | An entity changed on the server after the device's base version | Never last-write-wins. The mutation is rejected for explicit resolution | Owner resolves |
| **Inventory reconciliation issue** | Movement folds disagree | §38.14.2. New attributed adjustment | Owner resolution, prominently surfaced |
| **Deleted entity dependency** | The mutation references a product, customer, or account that no longer exists | Reject with a specific code. **Never** silently create the missing entity | Owner resolves |
| **Stale settings** | Cached policy older than the server's | Accept; apply the authoritative policy; flag `PRICING_POLICY_DRIFT` | Review the drift report |
| **Unsupported client version** | Client below the server's minimum | Read-only; upgrade prompt | Deploy a new client |
| **Idempotency contradiction** | Same `mutation_id`, different payload | Reject; security event | **Investigate as possible tampering** |
| **Cost basis divergence** | Device cost differs from the server's authoritative average | Accept the sale; use the authoritative cost; flag | Review; feeds the M10-S6 costing review |

### 38.28 Observability — DECISION

#### 38.28.1 Correlation

Every sync-relevant entity carries an identifier:

| Identifier | Purpose |
|---|---|
| `mutation_id` | One business mutation |
| `device_local_sequence` | Ordering within a device |
| `server_sequence` | Ordering within an organization |
| `device_id` | Which installation |
| `sync_batch_id` | One push request |
| `trace_id` | One request, end to end, client and server |
| `mutation_id` on the resulting journal entry | Ties an accounting entry back to its originating device event |

#### 38.28.2 Metrics

| Metric | Type |
|---|---|
| Pending outbox depth, by sync state | Gauge |
| Sync latency, push and pull | Histogram |
| Retry attempts, by error class | Counter |
| Conflicts, by conflict class (§38.27) | Counter |
| Permanent rejections | Counter |
| Divergence events per device | Counter |
| Cost basis divergences | Counter |
| Push success rate | Gauge |
| Mean time from local commit to server acknowledgement | Histogram — **the single most important operational metric**, because it measures cashier-exposure duration |

#### 38.28.3 Logs and redaction

| Rule | Detail |
|---|---|
| Structured | JSON, on both client and server |
| Redaction by construction | Never log tokens, passwords, session state, or biometric data. Payload bodies are logged by reference (`mutation_id`), not by content |
| Business data | Prices, costs, and balances are legitimate log content; credentials are not |
| Crash dumps | Must not contain the local database or session state (§38.29) |

### 38.29 Security of local data — DECISION, PLANNED NOT YET BUILT

Stated explicitly: **none of this is implemented. This is the plan.**

| Asset | Requirement |
|---|---|
| Local database file | **Encryption at rest is planned.** Scope: whole-file encryption of the Drift SQLite file via SQLCipher, or an equivalent. **Owner decision O-18**, because it has a performance cost on a low-end counter PC |
| Refresh and access tokens | **Never stored in plaintext.** Kept in the platform secure store (§13.6, §14.3). The offline session record is encrypted and device-bound |
| Offline authorization snapshot | Encrypted and **integrity-protected** by signature (§38.16.3) |
| Windows storage | In the user profile, excluded from backup by default, with restrictive ACLs |
| Android storage | In app-private storage, excluded from auto-backup, `EncryptedSharedPreferences` for the secure store |
| Backup leakage | An exported or backed-up local database **contains committed sales that may not yet be on the server.** Backup handling is therefore an owner-visible, permissioned, audited action. A backup is treated as sensitive business data |
| Logs | No credentials, no session state, no database contents (§38.28.3) |
| Crash dumps | Excluded from local database and session state |
| Database copied to another device | The offline session is bound to the device installation id, so a copied database **yields no working offline session** (§38.16.2). Its data is still readable if the file is not encrypted, which is precisely why O-18 matters |

### 38.30 Cashier accountability and controlled repair — DECISION

Offline capability **MUST NOT** reduce accountability. Every sale knows, permanently:

| Field | Source |
|---|---|
| Organization | Device binding (§38.16.2) |
| Device | Device installation id |
| Cashier / sale creator | `actor_user_id` (§23.1) |
| Salesperson, if separate | §23.1 |
| Collector, if separate | §23.1 |
| Local event timestamp | Device clock with the server offset applied (§38.16.5) |
| Device local sequence | Gap-free per device (§38.10.2) |
| Server received timestamp | `received_at` (§38.9.1) |
| Sync state | §38.13 |
| Originated offline | Boolean, set when the sale committed with no connectivity |
| Permission snapshot in force | `actor_role_snapshot` (§38.8.1) |
| Correction / reversal linkage | `reverses_mutation_id`, `reverses_sale_id` |

**The excuse "there was no network" does not exist.** The record exists on the device, attributed
and timestamped, before the receipt is printed.

#### 38.30.1 The cashier cannot control sync

| Forbidden | Enforcement |
|---|---|
| Delete a pending mutation | No UI path exists; the outbox has no delete API |
| Mark a mutation as synced | Only a server acknowledgement sets `SYNCED` (§38.8.2) |
| Reset or wipe the sync database | Requires `audit.view` plus owner-exclusive permission, is audited, and **exports the pending records first** |
| Clear failed sales | Same as reset |
| Change the device identity | Server-registered; a change requires re-registration and revokes the old identity |
| Edit a local timestamp | No UI path; timestamps are written inside the transaction |
| Manipulate the sequence | The sequence is a database-generated counter, not a client value |

#### 38.30.2 Governed repair tools

Any administrative repair is a **permissioned, audited** operation: export the outbox and audit
log before acting; record actor, reason code, and before/after counts; and never silently discard
a committed sale. A repair that would drop a committed sale requires `ownerExclusive` permission
and produces a `security_event`.

### 38.31 Offline user experience — DECISION

**The cashier never interacts with the sync engine.**

| Context | Indicator |
|---|---|
| Offline, selling | A single calm line: **"غير متصل — المبيعات محفوظة على الجهاز وسيتم مزامنتها تلقائيًا"** (Offline — sales are saved on the device and will sync automatically) |
| Offline, with pending sales | The same line plus a count: *"… 12 pending sales"* |
| Syncing | No modal, no spinner blocking input. A quiet background indicator |
| Sync failed | Nothing alarming on the shop floor. The owner sees it in the sync console |
| Online | No indicator at all |

**Explicitly forbidden:** alarming modals, "are you sure?" dialogs about connectivity, technical
error text during a sale, or any prompt that could make a cashier hesitate to sell.

The **salesperson never sees** sync states, queue depths, conflict classes, or sequence numbers.

#### 38.31.1 Owner sync console

A separate, permission-gated destination (`sync.view`, default owner) showing:

| Panel | Content |
|---|---|
| Device status | Label, platform, app version, last seen, sync state, device status |
| Pending | Count by state, oldest pending age, time since last successful sync |
| Failures | Permanently rejected and retryable items with their error codes |
| Conflicts | By class (§38.27), with links to resolution |
| Reconciliation | Inventory divergence per product and device |
| Policy drift | Sales accepted against a stale pricing policy |
| Cost divergence | Cost basis divergences (§38.24.3) |
| Exposure | Oldest un-synced sale age — **the operational health indicator** |

#### 38.31.2 Cached values are always labelled

Any value served from local state — a customer balance, a treasury balance, a price — is
displayed with its `server_sequence` and age. The honesty rule from M0-P1 is **retained and
strengthened**: it now applies to values a cashier may act on financially, not just to reads.

### 38.32 Legacy lessons — studied, deliberately not copied — DECISION

The legacy repository (`C:\dev\muaman.worktrees\i-tech-next-roadmap-freeze`, **READ ONLY**) built
an offline architecture and **shipped with its sync drain disabled**. Its outbox accumulated and
nothing left the device. M0-P1 recorded this in the discovery document.

#### 38.32.1 What was studied and what it teaches

| Legacy element | Lesson extracted | My Shop treatment |
|---|---|---|
| `sync_queue` outbox table | A durable outbox is the right shape | **Reimplemented** with a stronger field set (§38.8.1) and, critically, records that are never deleted on send (§38.8.2) — the legacy design permitted queue-row lifecycle management |
| `writer_snapshot` column | Recording the writer's state is necessary for convergence | **Reimplemented** as `actor_role_snapshot` (§38.8.1), giving an auditable offline authorization record |
| Per-entity `isEventLike` / `serverAuthoritative` classification | Some entities must never be last-write-wins | **Reimplemented** as movement-based inventory (§38.14), where last-write-wins is structurally impossible |
| Retry backoff ladder `5s, 30s, 2min, 10min`, max 5 | Bounded retry with backoff is correct | **Reimplemented** with jitter, `Retry-After`, and permanent-rejection escalation rather than silent exhaustion |
| Conflict lifecycle `REVIEW_REQUIRED → RESOLUTION_PENDING → RESOLVED` | Conflicts need an explicit owner resolution path | **Reimplemented** as the nine conflict classes with distinct resolutions (§38.27) |
| Two-page conflict enums | Conflict *taxonomy* explodes when handled generically | **Reimplemented** as a bounded, classified taxonomy (§38.27) |
| The drain shipping **OFF** | An offline architecture that is never switched on is pure liability | **Directly addressed**: offline capability is now a **required, tested V1 workflow** (§38.26), not an optional seam |
| Local-first SQLite as source of truth | A local database must never outrank the server | **Rejected.** The server remains authoritative (§38.6.3) |
| Hand-written SQL, hand-migrated schema, hand-copied test schema | Client persistence needs real migrations and real types | **Rejected** in favour of Drift (§38.6.1) |
| No CI at all | An untested sync engine is a liability, not a feature | **Addressed**: 22 mandatory offline tests (§38.26), CI stages (§37.2) |

#### 38.32.2 Reuse classification for the legacy sync layer

**Classification: `REIMPLEMENT` in full.** Not one line of the legacy sync subsystem is copied —
not the outbox table, not the adapters, not the backoff ladder, not the conflict enums, not the
migration orchestrator. Recorded as **ADR-039**, consistent with §5.1 and the standing
`DO_NOT_COPY` list (§5.4).

| Rule | Detail |
|---|---|
| Concepts may be studied | Patterns, lessons, and failure modes are legitimate inputs (§38.32.1) |
| Code may not be copied | No file, function, table definition, or enum is reproduced |
| The failure mode must be designed out | An offline capability that ships disabled, as the legacy drain did, is worse than no offline capability at all. My Shop's is release-gated on 22 passing tests (§38.26). |
| Every legacy element mapped | §38.32.1 accounts for each one: adopted as concept, rejected, or reimplemented |

### 38.33 What remains NOT implemented offline — DECISION

Stated explicitly so the offline scope is not over-claimed:

| Not implemented offline | Note |
|---|---|
| Multi-device offline global stock certainty | Impossible and not claimed (§38.15) |
| Offline purchases and purchase receipts | Tier 3; moving-average hazard (§38.22) |
| Offline account transfers | Needs two current balances |
| Offline manual journals and reversals | Server-derived (§38.24) |
| Offline role, permission, or user administration | Authorization must not be granted from a stale snapshot |
| Offline settings changes | Settings are server-owned (§38.18) |
| Offline ledger reports | The ledger is server-side |
| Automatic background sync with no user-visible state | A quiet indicator only (§38.31) |
| Encryption at rest | **Planned, not built**; owner decision O-18 |
| Offline-first data model for reporting | Reports remain server-derived (§33.1) |

---

## 39. Data domain map

### 39.1 Purpose

This map establishes **ownership, boundaries and dependencies**. It is **not** a production
schema and **MUST NOT** be generated as one during planning.

### 39.2 Bounded contexts and entities

| Context | Entities | Owns | Depends on |
|---|---|---|---|
| **identity** | users, credentials, sessions | Authentication, password hashing, token issuance, revocation | tenancy |
| **tenancy** | organizations, organization_memberships, roles, role_permissions, permission_overrides | Tenant boundary, permission resolution | identity |
| **devices** | devices, device_sessions, installation identity | Registration, labelling, revocation, sync metadata | tenancy, identity |
| **settings** | organization_settings, feature_flags | Typed configuration (§22), `settings_version` | tenancy |
| **catalog** | products, variants, product_units, product_barcodes | Product and variant identity, selling price, unit conversion | tenancy, settings |
| **inventory** | locations, stock_levels, stock_movements, stock_counts, stock_count_lines | Authoritative quantity history, moving average | catalog |
| **parties** | customers, customer_ledger_entries, suppliers, supplier_ledger_entries | Party ledgers, balances, statements | tenancy, treasury |
| **sales** | sales, sale_lines, sale_payments, sale_returns, sale_return_lines | Sale documents, line snapshots, attribution, payment allocation | catalog, inventory, parties, treasury, settings, accounting, **sync** |
| **purchasing** | purchases, purchase_lines, purchase_payments, purchase_returns, purchase_return_lines | Purchase documents, receipts, payables | catalog, inventory, parties, treasury, accounting |
| **treasury** | financial_accounts, account_opening_balances, account_transfers | Money containers, transfers, opening balances | tenancy, accounting |
| **accounting** | chart_of_accounts, journal_entries, journal_lines, document_sequences | The ledger; account balance truth | tenancy, **sync** |
| **audit** | audit_events, security_events | Business history, security history | tenancy, **sync** |
| **`sync` (added by M0-P2)** | mutation_ledger, change_log, device_sync_cursors, sync_conflicts | Mutation idempotency, convergence feed, conflict records | tenancy, devices |

### 39.3 Dependency rules

| Rule | Detail |
|---|---|
| D-1 | `identity` depends on `tenancy`. Never the reverse. |
| D-2 | `accounting` depends on **nothing** except `tenancy` and `sync`. It is a leaf: no business module writes into it directly; business modules call its posting service (§28.5). This keeps the ledger a single choke point. |
| D-3 | `inventory` depends on `catalog`, not the reverse. |
| D-4 | `sales` and `purchasing` depend on `parties`, `treasury`, `inventory`, `settings`, `accounting`, and `sync`. |
| D-5 | `parties` depends on `treasury` only for reading financial accounts; it writes nothing there. |
| D-6 | `audit` is written by every context and read by none of them except through queries. |
| D-7 | A context **never** writes another context's tables. Cross-context writes go through the owning context's service, inside the same transaction (§31.2). |
| **D-8** | **`sync` is a leaf-ish infrastructure context.** It owns the mutation ledger and the change log and depends only on `tenancy` and `devices`. It must never contain business rules. It is the convergence mechanism, not a domain. |

### 39.4 Entity-to-accounting ownership

| Entity | Owning context | Ledger effect |
|---|---|---|
| sale / sale_line | sales | Revenue + COGS + cash or receivable |
| sale_payment | sales | Cash or bank or wallet credit, receivable offset |
| sale_return / sale_return_line | sales | Revenue reversal + inventory reversal |
| purchase / purchase_line | purchasing | Inventory debit + payable or cash |
| purchase_payment | purchasing | Payable debit + cash credit |
| purchase_return | purchasing | Payable credit + inventory credit |
| customer_ledger_entry | parties | Receivable movement |
| supplier_ledger_entry | parties | Payable movement |
| financial_account / account_opening_balance | treasury | Cash or bank or wallet opening |
| account_transfer | treasury | Account to account |
| stock_movement | inventory | Inventory movement, adjustment account for non-sale causes |
| journal_entry / journal_line | accounting | The ledger itself |
| **mutation_ledger** | **sync** | **None. A convergence artefact, never posted.** |

### 39.5 Extension points reserved without implementation

| Future capability | Reserved extension point |
|---|---|
| Fixed assets | A `FIXED_ASSET` asset class in inventory plus a depreciation service posting to `accounting`. No table created. |
| Multiple locations | `stock_movements.locationId` and `stock_levels` are already keyed by location; V1 seeds one. |
| Payroll | Expenses post to account 6200 through the ordinary expense path. No employee entity. |
| Period closing | `chart_of_accounts` code 3100 exists; no closing engine. |
| Price lists | `unitPriceList` snapshot field; resolution strategy is the only thing that would change. |
| Multi-currency | `financial_accounts` could gain a currency; V1 has one per organization. |
| Background jobs | The `services/worker` directory is reserved and not created. |
| Approval chains | The discount approval gate (§18.2) is a single-level gate by design. |
| **Variant attribute sets** | Variant attributes are typed and owner-extensible (§15.3A.2), so a shoe shop and a grocery shop share one model. No new table per attribute type. |
| **Sync beyond the device** | `change_log` is a generic convergence feed. A future subscriber type consumes it without a schema change. |
| **Encrypted local storage** | The local database is addressed through one Drift accessor, so whole-file encryption swaps in behind it (§38.29, O-18). |

**No table, column, or enum is created for a reserved capability.** Creating schema for an
unauthorized module is scope inflation by another name.

### 39.6 The local client schema — DECISION (added by M0-P2)

The client has its own governed schema (§38.6). It is **not** a mirror of the server schema and
**not** a business source of truth (§38.6.3).

| Local table | Holds | Relationship to the server |
|---|---|---|
| `local_meta` | `local_schema_version`, time anchor, device identity | Client-only |
| `local_products` / `local_variants` / `local_barcodes` | Reference data for offline lookup and scanning | **Projection** of server `catalog`. Client-read-only |
| `local_stock_levels` | Quantity and `average_cost_minor` per variant | **Local working state.** Authoritative quantity is the server's fold over movements (§38.14) |
| `local_stock_movements` | Every local movement, pending or synced | Client record; server assigns `server_sequence` |
| `local_sales` / `local_sale_lines` / `local_sale_payments` | Committed sales awaiting sync, then historical cache | **Business events awaiting acceptance** (§38.24.1) |
| `local_customer_ledger_entries` | Queued credit effects | Projection of server `parties` |
| `outbox` | The durable mutation queue (§38.8.1) | Client-only |
| `sync_state` / `device_sync_cursor` | Lifecycle state and pull cursor (§38.13, §38.11.2) | Client-only |
| `local_audit_events` | Append-only local audit (§32.2A) | Mirrored to server `audit_events` |
| `cached_settings` | Versioned settings snapshot (§38.18) | **Read-only projection.** Never written upward |
| `cached_authz` | Signed offline authorization snapshot (§38.16.3) | Client-only, signed by the server |

| Rule | Detail |
|---|---|
| No local `journal_entries` / `journal_lines` | The ledger is server-only (§38.24.1). A local ledger would create a second accounting truth. |
| No local `chart_of_accounts` | The client does not post (§38.24.1). |
| Reference data is **read-only locally** | The client never edits a product locally. Catalog edits are Tier 3 (§38.22). |
| The local schema is versioned independently | `local_schema_version`, with its own migration chain (§38.6.2) |
| Local sales are immutable once committed | §16.7. Only a void before finalization or a return may follow. |

---

## 40. Roadmap and slice boundaries

### 40.1 Governance rules for every slice

No slice may begin without explicit owner authorization. Each authorized slice MUST declare, before
work starts:

| Field | Requirement |
|---|---|
| `predecessor` | The slice that must be complete and released |
| `scope` | What is being built, stated as verifiable outcomes |
| `non_scope` | What is explicitly **not** being touched, named explicitly |
| `allowed_paths` | The file and directory allow-list. Anything outside is out of bounds |
| `tests` | The tests that must exist and pass |
| `acceptance_criteria` | Binary, checkable conditions |
| `migration_impact` | Schema and data impact, or "none" |
| `security_impact` | New endpoints, permissions, data classes touched |
| `rollback` | How the slice is reverted if it is wrong. Forward-only migrations mean rollback is a new forward migration (§35.1) |
| `publication_gate` | The PR target, required checks, and the explicit owner merge step |

### 40.2 Phase overview

| Phase | Objective | Depends on |
|---|---|---|
| **M0** | Foundation, governance, master plan | — |
| **M1** | Platform foundation: repo, toolchain, CI, backend skeleton, app skeleton | M0 |
| **M1b** | **Offline platform foundation: local DB, outbox, mutation ledger, sync protocol, offline auth grace** | M1 |
| **M2** | Organization, identity, users, permissions, devices | M1b |
| **M3** | Settings and pricing policies | M2 |
| **M4** | Products, **variants**, barcodes, inventory | M3 |
| **M5** | Sales, customers, credit, invoice behaviour | M4 |
| **M6** | Suppliers, purchases, payables | M5 |
| **M7** | Financial accounts and accounting | M6 |
| **M8** | Reporting, **sync console**, reconciliation reporting | M7 |
| **M9** | Device security, local authentication, output integrations | M5, M8 |
| **M10** | Hardening and release readiness | M8, M9 |

**Amendment note — M1b was inserted by M0-P2.** Offline capability is a **platform** concern, not
a feature bolted onto sales. The durable outbox, the mutation ledger, the idempotency contract,
the local schema, and the offline auth grace must exist **before** any business module, because
every business module must write through them. Building them inside M5 would mean retrofitting
idempotency into a sales flow that already assumed a synchronous server — the exact mistake that
produced the legacy application's abandoned sync layer (§38.32).

Each phase below is decomposed into slices. **Slices are the unit of authorization.** A phase is
not authorized by authorizing its first slice.

### 40.3 M0 — Foundation, governance, master plan

**M0-P1 (complete).** Repository baseline verification, legacy read-only discovery, the master
plan, and the discovery record, on branch `codex/my-shop-m0-p1-foundation-master-plan`, PR #1.

**M0-P2 (this slice).** Offline-capable POS architecture amendment, superseding O-5, on branch
`codex/my-shop-m0-p2-offline-pos-amendment`.

### 40.4 M1 — Platform foundation

| Slice | Scope | Non-scope | Key acceptance |
|---|---|---|---|
| M1-S1 | Monorepo skeleton: `apps/desktop`, `services/api`, `packages/contracts`, `packages/testkit`; pinned toolchain files | Any feature, any schema | Repo builds empty; CI green |
| M1-S2 | Backend skeleton: NestJS, strict TS, config validation, health/readiness, error contract, request logging | Domain modules | `/healthz` and `/readyz` respond; problem+json shape verified |
| M1-S3 | Prisma bootstrap: schema skeleton, migration workflow, migrator and application roles | Domain tables | `migrate deploy` works from empty; role separation verified |
| M1-S4 | CI pipeline, all stages (§37.2), branch protection on `main` | — | A deliberately failing check blocks a PR |
| M1-S5 | App skeleton: `go_router`, Riverpod, `core/ui` design system, ARB localization, RTL golden tests | Any business screen | Arabic RTL renders; localization gate passes |
| M1-S6 | Shared contract generation and drift check | — | Drift fails CI |

### 40.5 M1b — Offline platform foundation (NEW, added by M0-P2)

This phase exists because offline correctness cannot be retrofitted. Every slice here is a
**platform** capability with no business dependency.

| Slice | Scope | Non-scope | Key acceptance |
|---|---|---|---|
| **M1b-S1** | **Local persistence foundation**: Drift schema, `local_meta`, versioning, migrations, durability pragmas, integrity check, backup-before-migration | Any business entity | Migration applies from prior version; corruption detected and refused (§38.6.5) |
| **M1b-S2** | **Sync contracts**: mutation payload schema, `mutation_id`, sync state enum, error codes, contract generation and drift gate | Push/pull transport | Contract is generated; drift fails CI |
| **M1b-S3** | **Durable outbox**: writer, state machine (§38.13), ordering, attempt tracking, compaction with an audit floor | Sync transport | Outbox survives kill/restart (T-O2) |
| **M1b-S4** | **Server mutation ledger**: `mutation_ledger`, `change_log`, `device_sync_cursors`, sequence allocation, `REPLAY` / `CONTRADICTION` semantics | Business module acceptance | 10 replays produce one effect (T-O3, T-O5) |
| **M1b-S5** | **Push endpoint**: batching, per-mutation outcomes, partial-batch semantics, backoff with jitter, `Retry-After` | Pull | One bad mutation does not block the batch (§38.10.3) |
| **M1b-S6** | **Pull endpoint**: cursor paging, bounded limits, retention window, resume after interruption | Conflict resolution UI | Disconnect mid-pull loses nothing (T-O6) |
| **M1b-S7** | **Loop prevention**: `applyRemoteWithoutOutbox` as the single remote-apply entry point, outbox suppression that crashes on violation, `server_sequence` guard | Business features | Outbox count unchanged after any remote apply (T-O7, stage 24) |
| **M1b-S8** | **Offline auth grace**: signed grace record, device binding, grace window setting, expiry behaviour, cached authz snapshot, clock-tamper handling | App lock (M9) | Grace expiry blocks mutations; committed sales still sync (T-O15, T-O17) |
| **M1b-S9** | **Connectivity monitor and backoff scheduler**: online/offline detection, retry ladder, offline indicator state | UI presentation | No busy-loop; `Retry-After` honoured |
| **M1b-S10** | **Offline observability plumbing**: `mutation_id` / `device_id` / `sync_batch_id` / `trace_id` propagation, structured redacted logs, metrics emission | Sync console UI (M8b) | No secret appears in any log (§38.28.3) |

### 40.6 M2 — Organization, identity, users, permissions, devices

| Slice | Scope | Non-scope | Key acceptance |
|---|---|---|---|
| M2-S1 | Organizations, memberships, operator bootstrap command | Any UI | Bootstrap creates an org and owner idempotently |
| M2-S2 | Identity: users, Argon2id, login, refresh rotation, reuse detection, revocation | App lock | Reuse detection revokes the family |
| M2-S3 | Permission catalog, role presets, per-user overrides, effective-permission resolution, signed snapshot issuance | Role management UI | Owner-exclusive permissions are structurally ungrantable |
| M2-S4 | Tenancy enforcement: request context, `SET LOCAL`, RLS on every tenant-owned table, **plus offline ingress re-validation (§9.4)** | New features | RLS suite passes 100%; cross-org offline mutation rejected |
| M2-S5 | Devices: registration, installation identity, labelling, listing, revocation, sync metadata (§12.5), security events | Owner approval flow | Revocation kills sessions **and** sync; queued mutations quarantined, not discarded |
| M2-S6 | Audit streams: `audit_events`, `security_events`, **plus the offline/sync events of §32.2A** | Business actions | Tampering with ordering is detectable |
| M2-S7 | Flutter auth flow, session store, secure token storage, **grace-window UX on start** | Business screens | Token never written outside secure storage |

### 40.7 M3 — Settings and pricing policies

| Slice | Scope | Non-scope | Key acceptance |
|---|---|---|---|
| M3-S1 | Typed organization settings, all fields in §22.2, **`settings_version`**, **`offline_grace_duration` (§22.4)**, validation, audit | Feature flags beyond owner-only | Invalid values rejected; every change audited |
| M3-S2 | Pricing mode enforcement, all three modes, server-side validation | Discounts | FIXED mode rejects an unauthorized override |
| M3-S3 | Discount policy: types, ceilings, authority resolution, approval gate | Discount reporting (M8) | Ceiling breach returns the documented error |
| M3-S4 | Flutter settings screens, pricing and discount administration, **offline settings cache display** | — | Settings drive real behaviour online; cache is versioned offline |

### 40.8 M4 — Products, variants, barcodes, inventory

| Slice | Scope | Non-scope | Key acceptance |
|---|---|---|---|
| M4-S1 | Catalog: products, **variants with typed attributes**, units, selling price, per-organization uniqueness | Barcode (M4b) | Two variants of one product hold independent stock |
| M4-S2 | Inventory: locations, stock movements, **two guards (§15.6A)**, movement identity (§38.14.1) | Counting UI | Concurrent sales cannot oversell; offline guard rejects locally |
| M4-S3 | Moving-average costing engine (§30.3, §30.4), **server-only computation (§30.8)** | Purchasing documents | Algorithm proven including rounding edges; device never recomputes |
| M4-S4 | Stock adjustments and stock counts with audit, **offline-capable (Tier 2, §38.22)** | Shrinkage reporting (M8) | Adjustment posts movement and audit atomically |
| M4-S5 | Flutter catalog and inventory screens | Barcode input (M4b) | — |
| **M4b-S1** | **Barcode model**: `product_barcodes` attached to **variant**, symbology, provenance, normalization, **type-aware uniqueness with a DB constraint** | Camera and hardware (M4b-S2) | Duplicate rejected by the database, not only the app (§15.3A.4) |
| **M4b-S2** | **Barcode input**: auto-generated internal (deterministic, §15.3A.6), **camera scan**, **keyboard-wedge hardware scanner**, manual entry — **all offline** | Vendor SDKs (optional later) | All four methods work with networking fully disabled |
| **M4b-S3** | **Barcode resolution and printing**: exact/case/ambiguous/unknown handling, shelf-label printing offline | — | Vendor-independent wedge path is the baseline and is tested |

### 40.9 M5 — Sales, customers, credit, invoice behaviour

| Slice | Scope | Non-scope | Key acceptance |
|---|---|---|---|
| M5-S1 | Customers, opening balances, customer ledger | Aging (M8) | Ledger is authoritative; cached balance reconciles |
| M5-S2 | Sales: document, line snapshots, **offline-safe numbering (§16.4A)**, payments | Returns (M5-S5) | I-7 passes: price change does not alter history |
| M5-S3 | Credit sales, receivables derivation | Collections (M5-S4) | Credit sale requires a customer when policy says so |
| M5-S4 | Customer collections, partial, multi-account, collector attribution, **offline-capable (Tier 2)** | — | Collector is distinct from salesperson |
| M5-S5 | Sale returns linked to original lines at snapshotted cost, **offline with identified original (§38.23.1)** | Anonymous stock inflation | Restored cost equals the original line cost; unknown original refused offline |
| M5-S6 | Invoice output: print, save, both, **neither**; default policy; **offline output (§21.2A)** | Windows close-during-print hardening (M9) | I-12 and I-19 pass |
| M5-S7 | Flutter POS and customer screens | — | Cash sale in ≤ 6 interactions, **online and offline** |
| **M5b-S1** | **Offline sale transaction**: the atomic local business transaction of §38.7.1, wired end to end to the M1b outbox | Sync transport (exists) | T-O1, T-O8, T-O9, T-O10 pass; no half-sale under kill |
| **M5b-S2** | **Offline receipt**: rendering from the local transaction, receipt identity, reprint | — | Printed total = persisted total, offline (T-O9) |
| **M5b-S3** | **Void / return / reversal discipline offline** (§16.7): void only pre-finalization; no DELETE path | — | A finalized sale cannot be deleted by any path |

### 40.10 M6 — Suppliers, purchases, payables

| Slice | Scope | Non-scope | Key acceptance |
|---|---|---|---|
| M6-S1 | Suppliers, opening balances, supplier ledger | Purchasing UI | Statement reconciles |
| M6-S2 | Purchases: cash and credit, receipt into stock, payable creation | Partial receipt; **offline (Tier 3, §38.22)** | The §25.2 canonical purchase works with zero accounting input |
| M6-S3 | Purchase payments, partial, multi-account, payer attribution | Approval chains | Payables derive correctly |
| M6-S4 | Purchase returns at original cost | Offline | Reversal matches the original entry |
| M6-S5 | Flutter purchase and supplier screens | Advanced procurement | — |

### 40.11 M7 — Financial accounts and accounting

| Slice | Scope | Non-scope | Key acceptance |
|---|---|---|---|
| M7-S1 | Chart of Accounts seeding, account rules | Period closing | Seeding is idempotent |
| M7-S2 | Journal engine: entries, lines, balance enforcement, immutability, **Option B derivation from business events (§38.24.1)**, posting idempotency (§38.24.4) | Manual entry UI | I-1, I-8, I-11, I-14 pass |
| M7-S3 | Financial accounts: types, opening balances, ledger-derived balances, **offline cached display (§27.6)** | Reconciliation workflow | I-5 passes |
| M7-S4 | Automatic posting wired to sales, purchases, collections, returns, transfers (§28.5), **including offline-accepted mutations** | Manual journals | Every document posts exactly one balanced entry |
| M7-S5 | Account transfers | **Offline (Tier 3)** | Transfers never touch revenue or COGS |
| M7-S6 | Journal reversal and manual journals, owner-exclusive | **Offline (Tier 3)** | No update or delete path exists (CI check) |
| M7-S7 | Flutter accounting screens, permission-gated and marked restricted | Reporting (M8) | Banned terms absent from sales routes (I-10) |

### 40.12 M8 — Reporting, sync console, reconciliation

| Slice | Scope | Non-scope | Key acceptance |
|---|---|---|---|
| M8-S1 | Sales reporting incl. salesperson performance (§23.2, §33.2), **device dimension (§23.1)** | Stored aggregates | Every figure derives from transactions |
| M8-S2 | Customer, supplier, purchase, payables reporting | — | Statements reconcile to balances |
| M8-S3 | Inventory valuation and movements, tying to the Inventory account | Slow/fast moving | I-2 passes |
| M8-S4 | Finance reporting: balances, cash movement, transfers | — | I-5 passes |
| M8-S5 | Accounting reports: GL, trial balance, P&L, statement of financial position, drill-down | — | I-1 and I-3 pass |
| M8-S6 | Flutter report screens with drill-down | Charts library | Every report is traceable to entries |
| **M8b-S1** | **Sync console** (§38.31.1): device status, pending by state, failures, conflicts by class, exposure metric | Repair tools (M10-S5) | Permission-gated; cashier has no access |
| **M8b-S2** | **Reconciliation reporting** (§38.14.2): inventory divergence per variant and device, cost-basis divergence, policy drift | — | I-20 passes; resolution is an attributed adjustment |
| **M8b-S3** | **Offline-aware report labelling** (§33.9): cached labelling, unsynced sales shown as pending, never omitted | — | R-8 passes |
| **M8b-S4** | **Governed repair tools** (§38.30.2): export-before-act, reason codes, owner-exclusive destructive operations | — | Every repair is audited; pending records never silently dropped |

### 40.13 M9 — Device security, local authentication, output integrations

| Slice | Scope | Non-scope | Key acceptance |
|---|---|---|---|
| M9-S1 | App lock via OS device authentication, per device, owner-controlled | Custom PIN (**excluded**) | No My Shop credential is ever created or stored |
| M9-S2 | Windows print-during-close hardening with an integration test | Copying the legacy Win32 hack | No crash; tested on Windows |
| M9-S3 | Output integrations: thermal receipt, share, save locations, **offline receipt paths (§38.23.2)** | — | §21.3 matrix verified per platform |
| M9-S4 | **Local data protection**: encryption-at-rest decision (O-18), secure-store integration, backup handling, crash-dump exclusion | Implementing O-18 if declined | No credential in plaintext anywhere (§38.29) |

### 40.14 M10 — Hardening and release readiness

| Slice | Scope | Non-scope | Key acceptance |
|---|---|---|---|
| M10-S1 | Security review against §13, §14, and **§38.29**; authorization matrix test per permission; **offline threat model walkthrough (§13.7)** | New features | No open high or critical finding |
| M10-S2 | Performance: sale latency **offline and online**, sync throughput, report queries, connection pool | — | Stated p95 targets met under stated load |
| M10-S3 | Migration rehearsal against production-shaped data, **server and local** | — | Forward migration succeeds within the declared window |
| M10-S4 | Release packaging: Windows installer, signed Android artifact | Publishing to stores | Artifacts reproduce from a clean clone |
| M10-S5 | Runbooks, operator documentation, backup and restore, **sync-runbook for an outage** | — | A fresh operator completes setup unaided |
| M10-S6 | **Costing decision review** (§30.2 revisited with real data, **including offline divergence data §30.8**) | — | The weighted-average decision is confirmed or an ADR supersedes it |
| **M10-S7** | **Offline endurance and chaos review**: sustained disconnection, crash injection, multi-device convergence soak, outbox growth bounds | — | T-O1…T-O22 all green; no unbounded growth; no data loss |

---

## 41. Architectural decisions register

Each row is an Architecture Decision Record. `docs/adr/` is created in M1-S1; these are the ADRs
that **MUST** exist by the end of M2b.

| # | Decision | Status | Revisit at |
|---|---|---|---|
| ADR-001 | Monorepo with `apps/`, `services/`, `packages/` and a generated contract | Accepted | M10 |
| ADR-002 | Feature-first layering with CI-enforced import boundaries; domain is pure Dart | Accepted | M10 |
| ADR-003 | Riverpod with generated providers; no global mutable singletons | Accepted | M10 |
| ADR-004 | `go_router` with an auth/organization redirect guard | Accepted | M10 |
| ADR-005 | NestJS, strict TypeScript, PostgreSQL 18, Prisma 6 | Accepted | M10 |
| ADR-006 | Shared schema, `organization_id` on every tenant-owned table, forced RLS | Accepted | Never |
| ADR-007 | Tenant context is derived from verified claims, never client-asserted | Accepted | Never |
| ADR-008 | Argon2id; short-lived JWT plus rotating opaque refresh with family revocation | Accepted | M10 |
| ADR-009 | RBAC with a string permission catalog, data-driven roles, per-user overrides | Accepted | M10 |
| ADR-010 | Device trust is `ACTIVE`/`REVOKED` only; no owner-approval flow in V1 | Accepted | M10 |
| ADR-011 | App lock delegates entirely to the OS; no custom PIN, no biometric storage or transmission | Accepted | Never |
| ADR-012 | Platform keystore only, fail-closed; no plaintext or obfuscation fallback | Accepted | Never |
| ADR-013 | Stock movements are authoritative; stock levels are a derived cache | Accepted | M10 |
| ADR-014 | Sale lines snapshot all financial values; history never follows current prices | Accepted | Never |
| ~~ADR-015~~ | ~~Per-organization gapless document numbering allocated in-transaction~~ | **SUPERSEDED by ADR-040** | — |
| ADR-016 | Money is integer minor units end to end; never floating point | Accepted | Never |
| ADR-017 | Perpetual moving weighted average costing; returns at original cost; **server-only computation** | Accepted | **M10-S6** |
| ADR-018 | Rounding applied exactly once, at the average division, on the server | Accepted | M10-S6 |
| ADR-019 | Real double-entry ledger; automatic posting; posted entries immutable | Accepted | Never |
| ADR-020 | Corrections by reversal only; no posted update or delete | Accepted | Never |
| ADR-021 | Idempotent posting via unique `idempotencyKey` | Accepted | Never |
| ~~ADR-022~~ | ~~Server-authoritative online-first; no offline mutation in V1~~ | **SUPERSEDED by ADR-037** | — |
| ADR-023 | Typed organization settings, not a free-form key-value store | Accepted | M10 |
| ADR-024 | Invoice output is separate from sale completion; "neither" is fully durable | Accepted | Never |
| ADR-025 | Two audit streams: business history and security history | Accepted | M10 |
| ADR-026 | Reporting is derived at query time; no maintained aggregates | Accepted | Never |
| ADR-027 | REST `/api/v1`; breaking change requires v2 | Accepted | M10 |
| ADR-028 | RFC 7807 problem+json with a stable machine-readable `code` | Accepted | M10 |
| ADR-029 | 404, not 403, for cross-organization resources | Accepted | Never |
| ADR-030 | Forward-only migrations with expand/contract; no down migrations | Accepted | Never |
| ADR-031 | CI from M1 with blocking gates | Accepted | M10 |
| ADR-032 | No background worker in V1; posting is synchronous | Accepted | M10 |
| ADR-033 | No code, history, or data is imported from the legacy repository | Accepted | Never |
| ADR-034 | Windows and Android are the only V1 release targets | Accepted | M10 |
| **ADR-035** | **Hard no-negative-stock guard on the device; `allow_negative_stock` removed; stock mismatch resolved by audited adjustment, never by the sale** | **Accepted** | Never |
| **ADR-036** | **Local relational persistence via Drift; local schema versioned independently; the local database is never a competing source of truth** | **Accepted** | M10 |
| **ADR-037** | **Server-authoritative with offline-capable POS. The client owns durable local capture; the server remains the sole authority after sync. Supersedes ADR-022** | **Accepted** | M10 |
| **ADR-038** | **Loop-free remote apply through a single `applyRemoteWithoutOutbox` entry point with structural outbox suppression** | **Accepted** | Never |
| **ADR-039** | **The legacy sync subsystem is REIMPLEMENTED in full. No line is copied** | **Accepted** | Never |
| **ADR-040** | **Offline-safe numbering: device receipt identity plus server invoice number. Gaplessness is NOT a V1 guarantee; uniqueness, monotonicity, durability are** | **Accepted** | Never |
| **ADR-041** | **Accounting Option B: the client stores an immutable business event; the server deterministically derives the posting, keyed on `sourceDocumentId` + `postingType`** | **Accepted** | Never |
| **ADR-042** | **Barcode is a searchable identifier on a variant, never a product primary key; `product_barcodes` stays a separate table; hardware input is keyboard-wedge and vendor-independent** | **Accepted** | M10 |
| **ADR-043** | **Offline operations are tiered. Tier 1 must work offline, Tier 2 strongly desirable, Tier 3 online only. Purchases are Tier 3 because the moving average is cumulative** | **Accepted** | **Owner: O-17** |
| **ADR-044** | **Offline authorization is bounded, not absolute: a short owner-controlled grace window with a signed cached snapshot, and revocation that cannot be known until reconnect** | **Accepted** | Never |
| **ADR-045** | **Sync state is an explicit lifecycle, never an `isSynced` boolean; permanent rejection is never silently dropped** | **Accepted** | Never |

### 41.1 Superseded decisions — explicit record

| Superseded | Superseded by | Reason |
|---|---|---|
| ADR-015 — gapless per-organization numbering | **ADR-040** | Gaplessness is unachievable together with unbounded offline availability. The owner's continuity requirement takes precedence. |
| ADR-022 — online-first, no offline mutation | **ADR-037** | Owner decision O-5: `OFFLINE-CAPABLE POS REQUIRED IN V1`. Business continuity and cashier accountability. |
| §38.1–§38.5 of v1.0.0 (cached-reads-only model) | **§38.2–§38.33 of v1.1.0** | Same reason. |
| §15.7 — `allow_negative_stock` setting | **§38.4, ADR-035** | Negative stock sales are forbidden unconditionally. |
| `503` semantics: "cached read, no queued write" | **§34.4** | A dependency failure now triggers offline operation rather than blocking a sale. |

---

## 42. Unresolved decisions, risks, and open questions

### 42.1 Open decisions requiring owner input

| # | Question | Recommendation | Default if unanswered | Blocks |
|---|---|---|---|---|
| O-1 | Currency is assumed EGP with 2 minor digits. Confirm, or name another single currency. | EGP / 2 | EGP / 2 | M1-S3 |
| ~~O-2~~ | ~~`allow_negative_stock` default~~ | **RESOLVED — removed.** Negative stock sales are unconditionally forbidden (§38.4, ADR-035) | n/a | Closed |
| O-3 | Should `discount_allowed_for_salesperson` default to `false`? | `false` | `false` | M3-S3 |
| O-4 | Is a customer **mandatory** on any credit sale? Default is `true`. | `true` | `true` | M5-S3 |
| ~~O-5~~ | ~~Is online-only acceptable for V1?~~ | **RESOLVED by owner: `OFFLINE-CAPABLE POS REQUIRED IN V1`.** See §38.1 and ADR-037 | n/a | Closed |
| O-6 | Should the discount approval gate default to reject or hold? | **Reject** | Reject | M3-S3 |
| O-7 | Tax / VAT is excluded from V1. Confirm it is not required at launch. | Excluded | Excluded | M5-S2 |
| O-8 | Should `sales.viewAll` be withheld from Managers by default? | Withheld | Withheld | M2-S3 |
| ~~O-9~~ | ~~If O-5 is a problem, is an offline queue slice wanted after M10?~~ | **RESOLVED — offline is in V1, not post-M10** | n/a | Closed |
| O-10 | Invoice numbering format for the **online** invoice number, distinct from the offline receipt identity (§16.4A.2). | `INV-{year}-{seq}` | `INV-{year}-{seq}` | M5-S2 |
| O-11 | Should opening balances be importable from a spreadsheet, or entered manually? | Manual in V1 | Manual | M6-S1 |
| O-12 | Is a second currency ever needed? | No | No | — |
| O-13 | Retention period for `security_events` — default 400 days. Confirm. | 400 days | 400 days | M2-S6 |
| **O-14** | **Should inventory adjustment and stock count work offline?** | **Yes, Tier 2** — with permission, mandatory reason code, and full audit. Required to make §38.5 workable while disconnected | Yes | M4-S4 |
| **O-15** | **Should sale returns work offline?** | **Yes, Tier 2, but only when the original sale is locally known** (§38.23.1). Unknown originals are refused offline | Yes, with the restriction | M5-S5 |
| **O-16** | **Should customer collections work offline?** | **Yes, Tier 2** — cash movement with strong accountability and a clean ledger | Yes | M5-S4 |
| **O-17** | **Should purchases work offline?** | **No, Tier 3.** Receiving stock changes the cumulative moving average; independent device-side computation would risk costing integrity. **This is the one offline capability I recommend against** | No | M6-S2 |
| **O-18** | **Encrypt the local database at rest?** | **Yes**, if the performance cost on a low-end counter PC is acceptable. The strongest defence against a stolen or copied device (§13.7) | Defer to M9-S4 measurement | M9-S4 |
| **O-19** | **Are multiple terminals expected in V1?** | **Plan for 2–5.** The architecture supports it; multi-device reconciliation reporting (M8b-S2) is what makes it *manageable*. If the answer is one terminal, M8b-S2 can be deferred | Plan for 2–5 | M8b-S2 |
| **O-20** | **`offline_grace_duration` default.** | **72 hours**, max 30 days, owner-exclusive (§22.4). Long enough for a weekend outage, short enough to bound revocation exposure | 72 hours | M1b-S8, M3-S1 |
| **O-21** | **`change_log` retention — 90 days?** | Yes. A client older than the window performs a full re-baseline rather than a partial pull (§38.11.1) | 90 days | M1b-S6 |
| **O-22** | **Enable optional offline reserved number blocks?** | **No.** Rejected as a primary mechanism (§16.4A.2). Enable only if Egyptian retail practice requires an invoice-**looking** number on the offline receipt | Off | M5-S2 |

**None of O-14 through O-22 blocks the start of M1-S1.** Each is answerable at the phase named,
and each carries a stated recommendation so work is never blocked waiting for an answer.

### 42.2 Technical risks

| # | Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|---|
| R-1 | RLS policy or `SET LOCAL` mistake leaks cross-tenant data | **Critical** | Low | Forced RLS, CI suite on 100% of tables, migrator/app role split, offline ingress re-validation (§9.4 T-9) |
| R-2 | A missed rounding step breaks the ledger-to-sub-ledger tie | **Critical** | Medium | One documented rounding point on the **server** (§30.6, §30.8); invariants I-1 to I-6 |
| R-3 | Double-entry engine scope creep | High | Medium | §2.4 anti-scope rule; §28.5 fixed document map; no new posting without a table row |
| ~~R-4~~ | ~~Offline-only POS blocks sales during an outage~~ | — | — | **RETIRED by owner decision O-5.** Offline selling is now a required V1 capability (§38). This risk no longer exists and is replaced by R-13 through R-17. |
| R-5 | Flutter toolchain on this host is stale (see the discovery record) | Medium | **High** | Pin versions in M1-S1; do not build V1 on a 2024 SDK |
| R-6 | Moving average misstates margin when prices swing sharply | Medium | Medium | Explicit decision with accepted consequences (§30.2); reviewed in M10-S6 with real data |
| R-7 | Windows printing fragility | Medium | Medium | M9-S2 integration test on Windows |
| R-8 | Scope creep from reserved extension points | Medium | Medium | §39.5: no schema is created for an unauthorized capability |
| R-9 | Contract drift between client and server | Medium | Medium | Generated contract, drift gate (G-7) |
| R-10 | Owner-unavailable single point of failure on owner-exclusive permissions | Low | Medium | Documented; relaxed only by an explicit ADR |
| R-11 | Report performance degrades as the ledger grows | Medium | Medium | Index discipline, period bounds, pagination; revisit at M10-S2 |
| R-12 | Legacy reuse pressure leads to a code copy | Medium | Medium | §5.1 rules, `DO_NOT_COPY` list with reasons, **ADR-039 reimplement-in-full for sync**, review enforcement |
| **R-13** | **Offline divergence between devices** — two tills each sell the same physical unit believing they hold it | **High** | **High** | Two guards (§15.6A); movement-based truth (§38.14); reconciliation record and owner resolution (§38.14.2); **accepted and stated, not eliminated** (§38.15). This is the defining trade of offline POS. |
| **R-14** | **Revoked user or device keeps selling until it reconnects** | **High** | Medium | Bounded by a short owner-controlled grace window (O-20); immediate effect on reconnect (§38.16.4); T-O16 verifies it. **Not solvable while offline** and not claimed to be. |
| **R-15** | **Stale authorization used offline** — a permission revoked during an outage still works | High | Medium | Signed versioned snapshot; server re-authorizes at acceptance; drift reported (§38.17, §38.19). Same bound as R-14. |
| **R-16** | **Offline COGS approximates the authoritative cost basis** between syncs | Medium | **High** | Device cost snapshotted for audit; server recomputes authoritatively; divergence raised and retained (§30.8, §38.24.3); reported in the sync console; feeds M10-S6 |
| **R-17** | **Device lost before sync** — committed sales exist only on the lost device | **High** | Low | Bounded by grace window and sync frequency; the cashier-exposure metric (§23.1.2) makes it visible; **no automatic device-side backup exists in V1** — stated as a limitation |
| **R-18** | **Local database corruption** loses committed sales | **High** | Low | WAL + `synchronous = FULL`; integrity check on start; refusal to sell; restore path (§38.6.5); T-O18. **Never** silently recreates. |
| **R-19** | **Sync loop from an unguarded remote-apply path** destroys data | **Critical** | Low | Structurally impossible: single entry point with crash-on-violation suppression (§38.12.1); CI stage 24; I-15 |
| **R-20** | **Invoice numbering complexity confuses staff or customers** | Medium | Medium | A short, meaningful receipt identity (§16.4A.2); permanent mapping; **no renumbering after printing** |
| **R-21** | **Delayed central visibility** — the owner cannot see live activity during an outage | Medium | **High** | Accepted and inherent. Mitigated by the exposure metric and a bounded grace window. The owner sees *that* the device is offline, not the transactions until sync. |
| **R-22** | **Outbox growth** exhausts device storage during a long outage | Medium | Medium | Compaction of `SYNCED` only with a retained audit floor; storage guard warning before refusing (§38.25 F-17, F-18) |
| **R-23** | **Encryption-at-rest cost** degrades sale latency on low-end hardware | Medium | Medium | Measured at M9-S4 before commitment (O-18); encryption applied behind a single Drift accessor so it is reversible |
| **R-24** | **Barcode mistype or spoof** sells the wrong item | Medium | Medium | Audit-visible sale; variant naming; scan-then-confirm; the stock guard still applies. Mitigated as a **training** problem, not a security hole (§13.7) |

**The risk profile has genuinely shifted.** M0-P1's largest risk was *"the shop cannot sell during
an outage."* That is retired. The new largest risks are **offline divergence (R-13)** and
**bounded stale authorization (R-14, R-15)** — both consequences of a decision the owner made
deliberately, and both bounded rather than eliminated.

### 42.3 Explicitly deferred

Tax/VAT, multi-currency, period closing, price lists, reconciliation workflow, dunning, partial
purchase receipt, purchase approval chains, slow/fast-moving analysis, multi-location transfer,
owner device approval, background workers, fixed assets, HR, payroll, and attendance. See §4.

**Removed from the deferred list by M0-P2:** offline mutation, offline sales, and offline
receipts. These are now V1 requirements (§3, §38).

**Still explicitly not implemented offline** (§38.33): multi-device global stock certainty,
offline purchases, offline account transfers, offline manual journals, offline user and permission
administration, offline settings changes, offline ledger reports, and encryption at rest (pending
O-18).

### 42.4 Dependencies on decisions outside this plan

- **Host toolchain upgrade** (R-5) requires owner authorization; it was not performed in M0-P1 or
  M0-P2.
- **Deployment target** for the backend is unspecified. The plan assumes a managed PostgreSQL
  provider or a single self-hosted instance. The choice affects backup, TLS, and secret
  management, and is an owner decision.
- **Domain name and TLS termination** are unspecified.
- **Physical POS hardware** — scanner models, receipt printers, and counter PC specifications —
  are unconfirmed. §15.3A.5 requires vendor independence precisely because this is unknown.

### 42.5 What is genuinely uncertain

| Item | Status |
|---|---|
| Whether real shop transaction volumes will make moving average materially inaccurate | Unknown without data. M10-S6 resolves it, now including offline divergence data (§30.8) |
| Whether the owner will need multi-branch soon | Unknown. Single organization per business; a user may belong to several. **O-19** |
| How often shops actually lose connectivity, and for how long | **Unknown, and it directly sizes R-13, R-14, and R-21.** The exposure metric (§23.1.2) exists to collect this from real operation |
| Whether multi-terminal reconciliation will be manageable for a small owner | Unknown. If not, O-19 should be answered "one terminal" and M8b-S2 deferred |
| Whether thermal printers need first-class support | Thermal rendering is planned (M9-S3) based on legacy evidence; the actual fleet is unconfirmed |
| Whether the shop needs a customer-facing display or receipt kiosk | Not in V1. Unrequested |
| Whether encryption-at-rest is affordable on the target hardware | Measured at M9-S4 (O-18, R-23) |

### 42.6 Standing constraints

No secret, credential, connection string, signing key, biometric datum, or personal production
data is ever committed (§13.6). `.env.example` contains placeholders only. CI scans every diff.

**Extended by M0-P2:** no offline payload, log line, crash dump, or exported backup may contain a
token, password, session state, or biometric datum (§38.28.3, §38.29). An exported local database
is treated as **sensitive business data** because it may contain unsynced sales.

---

## 43. Acceptance gates

### 43.1 Per-slice gates

Every slice passes **all** of the following before it is proposed for merge:

| Gate | Condition |
|---|---|
| G-1 | Every declared `acceptance_criteria` item is verified and recorded |
| G-2 | All tests in the declared scope exist and pass |
| G-3 | Every applicable §36.4 invariant test passes |
| G-4 | All CI stages (§37.2) pass |
| G-5 | No file outside `allowed_paths` was modified |
| G-6 | `non_scope` items are verifiably untouched |
| G-7 | Migration impact is as declared; migration files immutable (server **and** local, §35.5) |
| G-8 | Security impact is as declared; no new unauthenticated endpoint |
| G-9 | Migration audit check passes: no `GRANT ALL`, `search_path` pinned on every function, no interpolation |
| G-10 | Rollback is defined and feasible |
| G-11 | Documentation is updated, including this plan if a decision changed |
| G-12 | **Owner has authorized the merge separately.** No automated merge exists |
| **G-13** | **For any slice touching the offline path: the applicable T-O tests pass, and the offline threat model (§13.7) has been walked for the change** |

### 43.2 Phase gates

A phase is complete only when:

| Gate | Condition |
|---|---|
| P-1 | Every slice in the phase is merged and released |
| P-2 | Every §36.4 invariant test passes on production-shaped data |
| P-3 | The trial balance balances and inventory valuation ties, verified on that data |
| P-4 | Security review of the phase's endpoints and permissions is complete |
| P-5 | The next phase's open decisions (§42.1) are answered by the owner |
| P-6 | This master plan is updated to reflect what was actually built |
| **P-7** | **For M1b and every later phase: the full offline matrix T-O1…T-O22 passes** |

### 43.3 V1 release gate (end of M10)

| Gate | Condition |
|---|---|
| R-1 | All V1 capabilities (§3, including V1-33…V1-43) implemented and verified |
| R-2 | All 20 invariant tests (§36.4) pass |
| R-3 | RLS suite passes on 100% of tenant-owned tables |
| R-4 | Windows release build installs and runs on a clean machine |
| R-5 | Android release build installs and runs on a physical device |
| R-6 | Printing verified on both platforms, including print-during-close on Windows |
| R-7 | Trial balance balances on production-shaped data |
| R-8 | No open high or critical security finding |
| R-9 | Migration rehearsal succeeds within the declared window, server and local |
| R-10 | Backups restore successfully |
| R-11 | Every §2.2 banned term is absent from sales, purchasing, and customer routes |
| R-12 | **A full offline sale completes with networking fully disabled, survives a restart, and converges on reconnect with exactly one sale and one journal entry** |
| R-13 | A fresh operator completes installation and first sale unaided |
| R-14 | ADR-017 (costing) reviewed with real data and confirmed or superseded |
| **R-15** | **All four barcode input methods work with networking disabled, including a keyboard-wedge scanner** |
| **R-16** | **Two simulated devices, both offline, both selling, converge on reconnect with every movement retained and every divergence resolved by an attributed adjustment** |
| **R-17** | **The offline threat model (§13.7) has been reviewed end to end, and every residual risk in §42.2 R-13…R-24 is either mitigated or explicitly accepted by the owner** |

### 43.4 Governance

This plan is the authority. Where implementation and this document disagree, **this document wins
and the implementation is the defect**. Amending this document requires an owner decision recorded
as an ADR, and every amendment increments the document version.

**Amendment precedence.** Owner decisions recorded in an amendment session **supersede any
conflicting earlier wording in this document**. Where a v1.0.0 sentence contradicts §38, §38
governs. The superseded statements are retained only where they carry still-valid rationale, and
each is explicitly marked as superseded.

---

*End of MY_SHOP_MASTER_PLAN.md, version 1.1.0, governing amendment M0-P2 — Offline-capable POS.*
