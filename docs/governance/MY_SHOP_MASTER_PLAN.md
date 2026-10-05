# MY SHOP — MASTER PLAN

**Status:** Authoritative draft for owner approval
**Governing slice:** M0-P1 (Foundation / Discovery / Master Plan)
**Repository:** `sabere342-ai/my-shop` — `https://github.com/sabere342-ai/my-shop.git`
**Default branch:** `main`
**Canonical entry baseline:** `53f6aaa9aded2ec2218cec3f8987675a824b70db`
**Document version:** 1.0.0 (M0-P1)
**Owning authority:** Repository owner. No slice may begin without explicit written authorization.

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
| 16 | Sales | 38 | Connectivity model |
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
| V1-11 | Sales: cart, immutable line snapshots, gapless invoice numbering | M5 |
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

### 3.1 In scope for V1 as quality, not as features

- Auditability of every money- and stock-moving action.
- Decimal-exact arithmetic (§30.1).
- Idempotent posting (§31.4).
- Offline **read** cache. Offline **mutation** is NOT in V1 (§38).

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
| Client-side outbox sync; drain ships OFF | Server-authoritative online-first (§38) |
| Offline-first local database as source of truth | Local database is a cache only (§38.3) |
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
          money/                    Money value type, minor-unit arithmetic, formatting
          models/                   shared immutable cross-feature models
          settings/                 typed settings accessors
          ui/                       design system: tokens, primitives, layout
          result/                   Result / ResultAsync and failure taxonomy
          telemetry/                structured, redacted diagnostics
        features/
          <feature>/                 one folder per bounded feature (§6.3)
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

Cross-module **reads** are permitted. Cross-module **writes** are a boundary violation, caught
in review and, where practical, by a CI ownership map check.

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

**Consequence.** Revoking a user or a device takes effect within 15 minutes for access tokens
and immediately for refresh, without a per-request session lookup.

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

### 15.7 Negative stock policy — DECISION

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

**Historical invoice truth is NEVER derived from a product's current price or current cost.**
This is a hard architectural invariant with a dedicated test suite (§36.4), because the legacy
application's most consequential defect was the absence of any price or cost history at all.

### 16.3 Sale lifecycle

`POSTED` → partially or fully `RETURNED` (§16.5) → optionally `CANCELLED` **by reversal only**
(§31.3). A posted sale's financial fields are never updated. A posted sale is never deleted.

### 16.4 Invoice numbering — DECISION

Per organization, per year, **gapless and monotonic**, allocated inside the sale transaction
from `document_sequences`. Not epoch-based.

**RATIONALE.** The legacy scheme `'INV-${DateTime.now().millisecondsSinceEpoch}'` could collide
within a single millisecond — and it did so by surfacing an unhandled database exception to the
operator — had no per-organization sequencing, and left gaps with no meaning. Gaplessness is
chosen because a shop that hands a customer invoice *N* must never later find that *N* is
ambiguous.

### 16.5 Payment allocation

A sale MAY be settled by multiple payments across financial accounts (for example EGP 800 cash
plus EGP 200 Vodafone Cash). `sale_payments` records each allocation with its account and its
actor. The sum of payments is validated against the total; the residual becomes a customer
credit (§19) only when organization policy permits a customer on the document (§19.1).

### 16.6 Concurrency

The sale transaction locks the touched stock rows in a deterministic order (sorted by product
id) before applying movements, so two concurrent sales of the same product cannot deadlock and
cannot both observe the same availability.

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

The organizing principle, from the product requirement:

> **Never assume that the person who originally sold an invoice is the person who later
> collects an accounts-receivable payment.**

A sale made by Mohamed on Monday and collected by Yasser on Friday is attributed to Mohamed as
the salesperson, to Yasser as the collector, and the collections figure belongs to Yasser only.
Every future extension of this model follows the same rule: **actor and collector are separate
fields, not one inferred value.**

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
and exactly one journal entry. The legacy application built an elaborate idempotency and
convergence system for its sync layer; that need is eliminated here by the server being
authoritative and idempotent by construction (§38).

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
| 503 | Dependency unavailable. The client offers a cached read (§38.3) and **does not** offer a queued write. |

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

**I-7 and I-12 encode the two product rules that the legacy application violated:** historical
invoice truth must not follow current prices, and choosing not to print must never remove a sale.

### 36.5 Non-functional testing

| Area | Method |
|---|---|
| Concurrency | Parallel sales of a limited-stock product; exactly one succeeds per available unit |
| Deadlock | Lock ordering (§16.6) verified under contention |
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

### 37.4 Deployment

Not in M0–M1. When it arrives, deployment is: migration job → application rollout → smoke
check against `/healthz` and `/readyz`. Migrations run **before** application rollout, never
concurrently, so a rolled-back application is never running against a newer schema it does not
understand.

---

## 38. Connectivity model

### 38.1 RECOMMENDED V1 MODEL — DECISION

**Server-authoritative, online-first.**

| Property | Decision |
|---|---|
| Source of truth | The server, always. |
| Reads | Online by default. A local cache serves **read-only** fallback (§38.3). |
| Writes | **Online only.** No queued mutation, no offline write, no outbox, in V1. |
| Accounting consistency | Immediate. Every posting is synchronous inside the request transaction (§7.4). |
| Stock concurrency | Server-side conditional updates (§15.6). |

### 38.2 RATIONALE — and an explicit anti-inheritance statement

This model is chosen **deliberately against** the legacy architecture, and the inheritance is
explicitly refused.

The legacy application was local-first: a full SQLite database was the source of truth, with a
client-side outbox queue (`sync_queue`, 15 sync files, 12 entity adapters), per-entity conflict
policies, a two-phase legacy-to-cloud migration pipeline with `VACUUM INTO` snapshots, and
override/resolution state machines. Its sync drain **shipped disabled** by default
(`SYNC_DRAIN_ENABLED=false`), so in the delivered configuration the queue accumulated and nothing
ever left the device — making the entire cloud, RLS, and licensing layer speculative while
carrying its full complexity in the product.

My Shop **does not inherit any of that.**

| Reason | Explanation |
|---|---|
| **Accounting integrity** | Deferred writes mean a sale exists on a device and not in the ledger, or worse, in two ledgers. V1 has no eventual consistency in the accounting path (§7.4). |
| **Stock concurrency** | Two devices selling the last unit with deferred reconciliation produces oversell that cannot be reconciled automatically. Server-side conditional updates (§15.6) make oversell impossible. |
| **Multi-device conflict** | Offline-first requires conflict resolution for every entity. The legacy app needed two pages of enums for this. My Shop removes the problem by not creating it. |
| **Attribution integrity** | A deferred sale has no authoritative timestamp or actor context until it syncs. §23 attribution is only trustworthy if the server records it. |
| **Complexity discipline** | "Simple outside, rigorous inside" forbids shipping a distributed-systems problem to a small shop. |
| **The cost was already paid once** | The legacy app built the offline architecture, could not finish the sync, and shipped with it dormant. Repeating it is not a risk worth taking. |

### 38.3 Intermittent connectivity — DECISION

Offline mutation is out of scope (§4). What V1 provides instead:

| Situation | Behaviour |
|---|---|
| No connectivity, user browses catalog | Reads the local cache, clearly labelled **"cached — may be out of date"** with its age. |
| No connectivity, user attempts a sale | The attempt is **blocked** with a clear message: *"The sale cannot be completed without a connection. Nothing has been recorded."* No queue, no partial write, no draft persisted as a business record. |
| No connectivity, owner views a report | Served from cache where the report is cached, labelled as cached with its timestamp. Never presented as current. |
| Connectivity restored | Normal operation resumes. |

**The honesty rule:** a cached value is **always** labelled as cached with its age. Presenting a
stale balance as a current balance is a worse failure than refusing to act, because a shop may
extend credit on it.

### 38.4 POS usability under poor connectivity — acknowledged risk

| Risk | Severity | Mitigation |
|---|---|---|
| A shop with an unreliable line cannot sell at all during an outage | **High** | Documented and accepted for V1. The alternative (offline writes) trades this for correctness risk in the ledger, which is worse. |
| A slow connection makes the POS feel sluggish | Medium | Aggressive request coalescing, prefetch of reference data, optimistic UI on non-financial reads only. Financial submissions show a real pending state. |
| Retry storms from multiple devices | Medium | Idempotent posting (§31.4) plus exponential backoff with jitter and `Retry-After` honouring. |
| Duplicate submission on a flaky network | Low | Idempotency keys (§28.7) make a duplicate a no-op. |

**This risk is stated plainly rather than engineered away.** An owner whose business cannot trade
during an outage needs either a redundant connection or an authorized offline slice. Both are
owner decisions, recorded as O-5 and O-9 in §42.

### 38.5 Future safe offline queue architecture — extension point

Reserved, not implemented. If authorized later, the design constraints are already fixed by the
decisions above:

1. A **server-issued sequence** per organization, not a client clock, so ordering survives clock skew.
2. **Idempotency keys on every mutation**, already mandatory (§28.7).
3. A **closed, monotonic document model** — the ledger posting is derived from the document, so a late-arriving document produces exactly one entry.
4. **No offline financial posting.** Offline mode would queue *drafts* for owner confirmation, never post to the ledger.
5. A **per-organization single-writer election** so two devices never queue conflicting documents.
6. The cache schema is already separated from the server contract, so an outbox can be added without reshaping the client.

---

## 39. Data domain map

### 39.1 Purpose

This map establishes **ownership, boundaries and dependencies**. It is **not** a production
schema and **MUST NOT** be generated as one during M0-P1.

### 39.2 Bounded contexts and entities

| Context | Entities | Owns | Depends on |
|---|---|---|---|
| **identity** | users, credentials, sessions | Authentication, password hashing, token issuance, revocation | tenancy |
| **tenancy** | organizations, organization_memberships, roles, role_permissions, permission_overrides | Tenant boundary, permission resolution | identity |
| **devices** | devices, device_sessions | Registration, labelling, revocation | tenancy, identity |
| **settings** | organization_settings, feature_flags | Typed configuration (§22) | tenancy |
| **catalog** | products, product_units, product_barcodes | Product identity, selling price, unit conversion | tenancy, settings |
| **inventory** | locations, stock_levels, stock_movements, stock_counts, stock_count_lines | Authoritative quantity history, moving average | catalog |
| **parties** | customers, customer_ledger_entries, suppliers, supplier_ledger_entries | Party ledgers, balances, statements | tenancy, treasury |
| **sales** | sales, sale_lines, sale_payments, sale_returns, sale_return_lines | Sale documents, line snapshots, attribution, payment allocation | catalog, inventory, parties, treasury, settings, accounting |
| **purchasing** | purchases, purchase_lines, purchase_payments, purchase_returns, purchase_return_lines | Purchase documents, receipts, payables | catalog, inventory, parties, treasury, accounting |
| **treasury** | financial_accounts, account_opening_balances, account_transfers | Money containers, transfers, opening balances | tenancy, accounting |
| **accounting** | chart_of_accounts, journal_entries, journal_lines, document_sequences | The ledger; account balance truth | tenancy |
| **audit** | audit_events, security_events | Business history, security history | tenancy |

### 39.3 Dependency rules

| Rule | Detail |
|---|---|
| D-1 | `identity` depends on `tenancy`. Never the reverse. |
| D-2 | `accounting` depends on **nothing** except `tenancy`. It is a leaf: no business module writes into it directly; business modules call its posting service (§28.5). This is what keeps the ledger a single choke point. |
| D-3 | `inventory` depends on `catalog`, not the reverse. |
| D-4 | `sales` and `purchasing` depend on `parties`, `treasury`, `inventory`, `settings`, and `accounting`. |
| D-5 | `parties` depends on `treasury` only for reading financial accounts; it writes nothing there. |
| D-6 | `audit` is written by every context and read by none of them except through queries. |
| D-7 | A context **never** writes another context's tables. Cross-context writes go through the owning context's service, inside the same transaction (§31.2). |

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

**No table, column, or enum is created for a reserved capability.** Creating schema for an
unauthorized module is scope inflation by another name.

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
| **M0** | Foundation, discovery, master plan | — |
| **M1** | Platform foundation: repo, toolchain, CI, backend skeleton, app skeleton | M0 |
| **M2** | Organization, identity, users, permissions, devices | M1 |
| **M3** | Settings and pricing policies | M2 |
| **M4** | Products and inventory | M3 |
| **M5** | Sales, customers, credit, invoice behaviour | M4 |
| **M6** | Suppliers, purchases, payables | M5 |
| **M7** | Financial accounts and accounting | M6 |
| **M8** | Reporting | M7 |
| **M9** | Device security, local authentication, output integrations | M5, M8 |
| **M10** | Hardening and release readiness | M8, M9 |

Each phase below is decomposed into slices. **Slices are the unit of authorization.** A phase is
not authorized by authorizing its first slice.

### 40.3 M0 — Foundation, governance, master plan (this slice)

**M0-P1 (complete, this slice).** Repository baseline verification, legacy read-only discovery,
this master plan, the discovery record, and the branch/PR governance model.

**M0-P2 (NOT created by M0-P1; exists only as a roadmap item).** A future slice that may refine
this plan if the owner requests it. It has no defined scope and is not authorized.

### 40.4 M1 — Platform foundation

| Slice | Scope | Non-scope | Key acceptance |
|---|---|---|---|
| M1-S1 | Monorepo skeleton: `apps/desktop`, `services/api`, `packages/contracts`, `packages/testkit`; pinned toolchain files | Any feature, any schema | Repo builds empty; CI green |
| M1-S2 | Backend skeleton: NestJS, strict TS, config validation, health/readiness, error contract, request logging | Domain modules | `/healthz` and `/readyz` respond; problem+json shape verified |
| M1-S3 | Prisma bootstrap: schema skeleton, migration workflow, migrator and application roles | Domain tables | `migrate deploy` works from empty; role separation verified |
| M1-S4 | CI pipeline, all 18 stages (§37.2), branch protection on `main` | — | A deliberately failing check blocks a PR |
| M1-S5 | App skeleton: `go_router`, Riverpod, `core/ui` design system, ARB localization, RTL golden tests | Any business screen | Arabic RTL renders; localization gate passes |
| M1-S6 | Shared contract generation and drift check | — | Drift fails CI |

### 40.5 M2 — Organization, identity, users, permissions, devices

| Slice | Scope | Non-scope | Key acceptance |
|---|---|---|---|
| M2-S1 | Organizations, memberships, operator bootstrap command | Any UI | Bootstrap creates an org and owner idempotently |
| M2-S2 | Identity: users, Argon2id, login, refresh rotation, reuse detection, revocation | App lock, permissions UI | Reuse detection revokes the family; tests prove it |
| M2-S3 | Permission catalog, role presets, per-user overrides, effective-permission resolution | Role management UI | Owner-exclusive permissions are structurally ungrantable |
| M2-S4 | Tenancy enforcement: request context, `SET LOCAL`, RLS on every tenant-owned table | New features | RLS suite passes 100% (§36.2) |
| M2-S5 | Devices: registration, labelling, listing, revocation, security events | Owner approval flow | Revocation kills sessions immediately |
| M2-S6 | Audit streams: `audit_events` and `security_events`, insert-only grants | Business actions | Tampering with ordering is detectable |
| M2-S7 | Flutter auth flow, session store, secure token storage, organization switch | Business screens | Token never written outside secure storage |

### 40.6 M3 — Settings and pricing policies

| Slice | Scope | Non-scope | Key acceptance |
|---|---|---|---|
| M3-S1 | Typed organization settings, all fields in §22.2, validation, audit | Feature flags beyond owner-only | Invalid values rejected; every change audited |
| M3-S2 | Pricing mode enforcement, all three modes, server-side validation | Discounts | FIXED mode rejects an override from an unauthorized actor |
| M3-S3 | Discount policy: types, ceilings, authority resolution, approval gate | Discount reporting (M8) | Ceiling breach returns the documented error |
| M3-S4 | Flutter settings screens, pricing and discount administration | — | Settings drive real behaviour, verified by integration test |

### 40.7 M4 — Products and inventory

| Slice | Scope | Non-scope | Key acceptance |
|---|---|---|---|
| M4-S1 | Catalog: products, units, barcodes, selling price, per-organization uniqueness | Costing engine | Barcode uniqueness is per organization (T-7) |
| M4-S2 | Inventory: locations, stock movements, conditional stock updates, negative-stock policy | Counting UI | Concurrent sales cannot oversell |
| M4-S3 | Moving-average costing engine (§30.3, §30.4) | Purchasing documents | Algorithm proven by unit tests including rounding edges |
| M4-S4 | Stock adjustments and stock counts with audit | Shrinkage reporting (M8) | Adjustment posts movement and audit atomically |
| M4-S5 | Flutter catalog and inventory screens | Barcode hardware integration | — |

### 40.8 M5 — Sales, customers, credit, invoice behaviour

| Slice | Scope | Non-scope | Key acceptance |
|---|---|---|---|
| M5-S1 | Customers, opening balances, customer ledger | Aging (M8) | Ledger is authoritative; cached balance reconciles |
| M5-S2 | Sales: document, line snapshots, gapless numbering, payments | Returns (M5-S5) | I-7 passes: price change does not alter history |
| M5-S3 | Credit sales, receivables derivation | Collections (M5-S4) | Credit sale requires a customer when policy says so |
| M5-S4 | Customer collections, partial, multi-account, collector attribution | — | Collector is distinct from salesperson (I-7 analogue) |
| M5-S5 | Sale returns linked to original lines at snapshotted cost | Purchase returns | Restored cost equals the original line cost |
| M5-S6 | Invoice output: print, save, both, **neither**; default policy | Windows close-during-print hardening (M9) | I-12 passes: an unprinted sale is fully present everywhere |
| M5-S7 | Flutter POS and customer screens | — | Cash sale in ≤ 6 interactions |

### 40.9 M6 — Suppliers, purchases, payables

| Slice | Scope | Non-scope | Key acceptance |
|---|---|---|---|
| M6-S1 | Suppliers, opening balances, supplier ledger | Purchasing UI | Statement reconciles |
| M6-S2 | Purchases: cash and credit, receipt into stock, payable creation | Partial receipt | The §25.2 canonical purchase works with zero accounting input |
| M6-S3 | Purchase payments, partial, multi-account, payer attribution | Approval chains | Payables derive correctly |
| M6-S4 | Purchase returns at original cost | — | Reversal matches the original entry |
| M6-S5 | Flutter purchase and supplier screens | Advanced procurement | — |

### 40.10 M7 — Financial accounts and accounting

| Slice | Scope | Non-scope | Key acceptance |
|---|---|---|---|
| M7-S1 | Chart of Accounts seeding, account rules | Period closing | Seeding is idempotent |
| M7-S2 | Journal engine: entries, lines, balance enforcement, immutability, idempotency | Manual entry UI | I-1, I-8, I-11 pass |
| M7-S3 | Financial accounts: types, opening balances, ledger-derived balances | Reconciliation workflow | I-5 passes |
| M7-S4 | Automatic posting wired to sales, purchases, collections, returns, transfers (§28.5) | Manual journals | Every document posts exactly one balanced entry |
| M7-S5 | Account transfers | — | Transfers never touch revenue or COGS |
| M7-S6 | Journal reversal and manual journals, owner-exclusive | — | No update or delete path exists (CI check) |
| M7-S7 | Flutter accounting screens, permission-gated and marked restricted | Reporting (M8) | Banned terms absent from sales routes (I-10) |

### 40.11 M8 — Reporting

| Slice | Scope | Non-scope | Key acceptance |
|---|---|---|---|
| M8-S1 | Sales reporting incl. salesperson performance (§23.2, §33.2) | Stored aggregates | Every figure derives from transactions |
| M8-S2 | Customer, supplier, purchase, payables reporting | — | Statements reconcile to balances |
| M8-S3 | Inventory valuation and movements, tying to the Inventory account | Slow/fast moving | I-2 passes |
| M8-S4 | Finance reporting: balances, cash movement, transfers | — | I-5 passes |
| M8-S5 | Accounting reports: GL, trial balance, P&L, statement of financial position, drill-down | — | I-1 and I-3 pass |
| M8-S6 | Flutter report screens with drill-down | Charts library | Every report is traceable to entries |

### 40.12 M9 — Device security, local authentication, output integrations

| Slice | Scope | Non-scope | Key acceptance |
|---|---|---|---|
| M9-S1 | App lock via OS device authentication, per device, owner-controlled | Custom PIN (**excluded**) | No My Shop credential is ever created or stored |
| M9-S2 | Windows print-during-close hardening with an integration test | Copying the legacy Win32 hack | No crash; tested on Windows |
| M9-S3 | Output integrations: thermal receipt, share, save locations | — | §21.3 matrix verified per platform |
| M9-S4 | Offline read cache and cached-value labelling (§38.3) | Offline mutation | Every cached value is labelled with its age |

### 40.13 M10 — Hardening and release readiness

| Slice | Scope | Non-scope | Key acceptance |
|---|---|---|---|
| M10-S1 | Security review against §13 and §14; authorization matrix test per permission | New features | No open high or critical finding |
| M10-S2 | Performance: sale latency, report queries, connection pool | — | Stated p95 targets met under stated load |
| M10-S3 | Migration rehearsal against production-shaped data | — | Forward migration succeeds within the declared window |
| M10-S4 | Release packaging: Windows installer, signed Android artifact | Publishing to stores | Artifacts reproduce from a clean clone |
| M10-S5 | Runbooks, operator documentation, backup and restore | — | A fresh operator completes setup unaided |
| M10-S6 | **Costing decision review** (§30.2 revisited with real data) | — | The weighted-average decision is confirmed or an ADR supersedes it |

---

## 41. Architectural decisions register

Each row is an Architecture Decision Record. `docs/adr/` is created in M1-S1; these are the ADRs
that **MUST** exist by the end of M2.

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
| ADR-015 | Per-organization gapless document numbering allocated in-transaction | Accepted | Never |
| ADR-016 | Money is integer minor units end to end; never floating point | Accepted | Never |
| ADR-017 | Perpetual moving weighted average costing; returns at original cost | Accepted | **M10-S6** |
| ADR-018 | Rounding applied exactly once, at the average division | Accepted | M10-S6 |
| ADR-019 | Real double-entry ledger; automatic posting; posted entries immutable | Accepted | Never |
| ADR-020 | Corrections by reversal only; no posted update or delete | Accepted | Never |
| ADR-021 | Idempotent posting via unique `idempotencyKey` | Accepted | Never |
| ADR-022 | Server-authoritative online-first; **no offline mutation in V1** | Accepted | **M10, or on owner request** |
| ADR-023 | Typed organization settings, not a free-form key-value store | Accepted | M10 |
| ADR-024 | Invoice output is separate from sale completion; "neither" is fully durable | Accepted | Never |
| ADR-025 | Two audit streams: business history and security history | Accepted | M10 |
| ADR-026 | Reporting is derived at query time; no maintained aggregates | Accepted | Never |
| ADR-027 | REST `/api/v1`; breaking change requires v2 | Accepted | M10 |
| ADR-028 | RFC 7807 problem+json with a stable machine-readable `code` | Accepted | M10 |
| ADR-029 | 404, not 403, for cross-organization resources | Accepted | Never |
| ADR-030 | Forward-only migrations with expand/contract; no down migrations | Accepted | Never |
| ADR-031 | CI from M1 with 18 stages and mandatory gates | Accepted | M10 |
| ADR-032 | No background worker in V1; posting is synchronous | Accepted | M10 |
| ADR-033 | No code, history, or data is imported from the legacy repository | Accepted | Never |
| ADR-034 | Windows and Android are the only V1 release targets | Accepted | M10 |

---

## 42. Unresolved decisions, risks, and open questions

### 42.1 Open decisions requiring owner input

| # | Question | Default if unanswered | Blocks |
|---|---|---|---|
| O-1 | Currency is assumed EGP with 2 minor digits. Confirm, or name another single currency. | EGP / 2 | M1-S3 |
| O-2 | `allow_negative_stock` default is `false`. Confirm. | `false` | M4-S2 |
| O-3 | Should `discount_allowed_for_salesperson` default to `false`? | `false` | M3-S3 |
| O-4 | Is a customer **mandatory** on any credit sale? Default is `true`. | `true` | M5-S3 |
| O-5 | **Is online-only acceptable for V1 given shop connectivity?** (§38.4 records this as the largest accepted risk.) | Online-only | M10 |
| O-6 | Should the discount approval gate default to reject or hold? Default is **reject**. | Reject | M3-S3 |
| O-7 | Tax / VAT is excluded from V1. Confirm it is not required at launch. | Excluded | M5-S2 |
| O-8 | Should `sales.viewAll` be withheld from Managers by default? | Withheld | M2-S3 |
| O-9 | If O-5 is a problem, is an **authorized offline queue slice** wanted after M10? | Not planned | Post-M10 |
| O-10 | Invoice numbering format: `INV-2026-000123` versus a bare sequence. | `INV-{year}-{seq}` | M5-S2 |
| O-11 | Should opening balances be importable from a spreadsheet for an existing shop, or entered manually? | Manual | M6-S1 |
| O-12 | Is a second currency ever needed? Default: no. | No | — |
| O-13 | Retention period for `security_events` — default 400 days. Confirm. | 400 days | M2-S6 |

### 42.2 Technical risks

| # | Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|---|
| R-1 | RLS policy or `SET LOCAL` mistake leaks cross-tenant data | **Critical** | Low | Forced RLS, CI suite on 100% of tables, migrator/app role split |
| R-2 | A missed rounding step breaks the ledger-to-sub-ledger tie | **Critical** | Medium | One documented rounding point (§30.6); invariant tests I-1 to I-6 |
| R-3 | Double-entry engine scope creep | High | Medium | §2.4 anti-scope rule; §28.5 fixed document map; no new posting without a table row |
| R-4 | Offline-only POS blocks sales during an outage | High | Medium | Accepted and documented (§38.4); O-9 is the escape hatch |
| R-5 | Flutter toolchain on this host is stale (see the discovery record) | Medium | **High** | Pin versions in M1-S1; do not build V1 on a 2024 SDK |
| R-6 | Moving average misstates margin when prices swing sharply | Medium | Medium | Explicit decision with accepted consequences (§30.2); reviewed in M10-S6 with real data |
| R-7 | Windows printing fragility | Medium | Medium | M9-S2 integration test on Windows |
| R-8 | Scope creep from reserved extension points | Medium | Medium | §39.5: no schema is created for an unauthorized capability |
| R-9 | Contract drift between client and server | Medium | Medium | Generated contract, drift gate (G-7) |
| R-10 | Owner-unavailable single point of failure on owner-exclusive permissions | Low | Medium | Documented; `ownerExclusive` is a deliberate safety property, relaxed only by an explicit ADR |
| R-11 | Report performance degrades as the ledger grows | Medium | Medium | Index discipline, period bounds, pagination; revisit at M10-S2 |
| R-12 | Legacy reuse pressure leads to a code copy | Medium | Medium | §5.1 rules, `DO_NOT_COPY` list with reasons, review enforcement |

### 42.3 Explicitly deferred

Tax/VAT, multi-currency, period closing, price lists, reconciliation workflow, dunning, partial
purchase receipt, purchase approval chains, slow/fast-moving analysis, multi-location transfer,
owner device approval, offline mutation, background workers, fixed assets, HR, payroll, and
attendance. See §4.

### 42.4 Dependencies on decisions outside this plan

- **Host toolchain upgrade** (R-5) requires owner authorization; it is not performed in M0-P1.
- **Deployment target** for the backend is unspecified. The plan assumes a managed PostgreSQL
  provider or a single self-hosted instance. The choice affects backup, TLS, and secret
  management, and is an owner decision.
- **Domain name and TLS termination** are unspecified.

### 42.5 What is genuinely uncertain

| Item | Status |
|---|---|
| Whether real shop transaction volumes will make moving average materially inaccurate | Unknown without data. M10-S6 resolves it. |
| Whether the owner will need multi-branch soon | Unknown. Single organization per business is assumed; a user may belong to several. |
| Whether thermal printers need first-class support | Thermal rendering is planned (M9-S3) based on legacy evidence; actual fleet needs are unconfirmed. |
| Whether the shop needs a customer-facing display or receipt kiosk | Not in V1. Unrequested. |

### 42.6 Standing constraints

No secret, credential, connection string, signing key, biometric datum, or personal production
data is ever committed (§13.6). `.env.example` contains placeholders only. CI scans every diff.

---

## 43. Acceptance gates

### 43.1 Per-slice gates

Every slice passes **all** of the following before it is proposed for merge:

| Gate | Condition |
|---|---|
| G-1 | Every declared `acceptance_criteria` item is verified and recorded |
| G-2 | All tests in the declared scope exist and pass |
| G-3 | Every applicable §36.4 invariant test passes |
| G-4 | All 18 CI stages (§37.2) pass |
| G-5 | No file outside `allowed_paths` was modified |
| G-6 | `non_scope` items are verifiably untouched |
| G-7 | Migration impact is as declared; migration files immutable |
| G-8 | Security impact is as declared; no new unauthenticated endpoint |
| G-9 | Migration audit check passes: no `GRANT ALL`, `search_path` pinned on every function, no interpolation |
| G-10 | Rollback is defined and feasible |
| G-11 | Documentation is updated, including this plan if a decision changed |
| G-12 | **Owner has authorized the merge separately.** No automated merge exists |

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

### 43.3 V1 release gate (end of M10)

| Gate | Condition |
|---|---|
| R-1 | All 32 V1 capabilities (§3) implemented and verified |
| R-2 | All 12 invariant tests (§36.4) pass |
| R-3 | RLS suite passes on 100% of tenant-owned tables |
| R-4 | Windows release build installs and runs on a clean machine |
| R-5 | Android release build installs and runs on a physical device |
| R-6 | Printing verified on both platforms, including print-during-close on Windows |
| R-7 | Trial balance balances on production-shaped data |
| R-8 | No open high or critical security finding |
| R-9 | Migration rehearsal succeeds within the declared window |
| R-10 | Backups restore successfully |
| R-11 | Every §2.2 banned term is absent from sales, purchasing, and customer routes |
| R-12 | No offline-mutation code exists anywhere in the client |
| R-13 | A fresh operator completes installation and first sale unaided |
| R-14 | ADR-017 (costing) reviewed with real data and confirmed or superseded |

### 43.4 Governance

This plan is the authority. Where implementation and this document disagree, **this document
wins and the implementation is the defect**. Amending this document requires an owner decision
recorded as an ADR, and every amendment increments the document version.

---

*End of MY_SHOP_MASTER_PLAN.md, version 1.0.0, governing slice M0-P1.*

---

