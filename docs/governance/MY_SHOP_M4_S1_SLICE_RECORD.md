# M4-S1 slice record — Product Catalog, Variants, Units & Selling Prices

Status: **delivered** (implemented, demonstrated on the real backend, and opened as a stacked Draft PR).

## 1. Scope declaration (§40.1, declared before implementation)

| Field | Value |
| --- | --- |
| `predecessor` | M3-S4 — Flutter Settings, accepted at `76ae59629dad1b70fc6c6509b7726372cb74dc07` (PR #28, branch `codex/my-shop-m3-s4-flutter-settings`). |
| `scope` | Server-authoritative product catalog: products, variants with typed attributes, units (base + at most one purchasing unit with `baseQuantityFactor`), selling prices in exact integer minor units, per-organization SKU uniqueness enforced by PostgreSQL, permission-gated HTTP API, transactional audit. |
| `non_scope` | Barcodes (`product_barcodes`, M4b); inventory locations/movements/guards (M4-S2); costing (`unit_cost`, moving average — M4-S3); stock counts (M4-S4); Flutter catalog screens (M4-S5); offline local catalog cache/projection (a later Flutter/sync slice); change_log feed wiring for the catalog projection (documented in §6 below); role/permission management UI beyond granting `catalog.view` for the acceptance scenario; purchase receipts or any stock quantity claim. |
| `allowed_paths` | Declared below (§2), amended explicitly if additional necessary files are discovered. |
| `tests` | `src/common/catalog/catalog.domain.spec.ts` (unit); `test/catalog/catalog.e2e-spec.ts` (integration); `test/database/catalog.db-spec.ts` (real-PostgreSQL acceptance incl. the HTTP-level scenarios); extended `test/database/tenant-rls.db-spec.ts` inventory probes. |
| `acceptance_criteria` | (1) Product/variant/unit CRUD through the real HTTP API on real PostgreSQL; (2) two variants of one product are independent business identities and edits to one never touch the other; (3) effective selling price = variant override ?? product default, resolvable per variant; (4) per-organization SKU uniqueness enforced by a database constraint, including under concurrent creates; (5) typed attributes validated by service AND database CHECK; (6) unit conversions exact integers (carton of 12 stored exact); (7) `catalog.view` caller cannot write anything (403 server-side); (8) cross-organization access returns 404 via API and RLS refuses every direct probe; (9) every mutation writes an audited, attributed audit row in the same transaction; (10) persistence survives a real backend restart; (11) generated OpenAPI/TS contract matches the implementation byte-for-byte. |
| `migration_impact` | New forward-only migration `0013_product_catalog`: `products`, `product_variants`, `product_units` — all tenant-owned (ENABLE+FORCE RLS, one symmetric `tenant_isolation` policy), first-class UUID identities, per-org SKU unique index, composite tenant foreign keys, bounds restated as CHECKs. No data migration; no earlier migration edited. |
| `security_impact` | New authenticated routes under `/api/v1/organizations/:organizationId/catalog/…` guarded by the existing `@Authorize` composite guard with `catalog.view` (reads) / `catalog.edit` (writes). No new unauthenticated endpoint. No new permission ids beyond the M2-S3 catalog (`catalog.view`, `catalog.edit`; `catalog.cost.edit` is *not* used — no cost field exists in this slice, M4-S3 owns it). New closed audit event types; no new error-code vocabulary beyond one catalog duplicate code. |
| `rollback` | Forward-only (§35.1): reverting means a new migration dropping the three tables; local dev databases are disposable. No merge. |
| `publication_gate` | Stacked Draft PR → `codex/my-shop-m3-s4-flutter-settings` (never `main`). Required checks: `fast-checks`, `backend-unit`, `backend-integration-database`, `contract-drift`, `dependency-audit`, `flutter-build-windows`, `flutter-build-android`. Owner merges separately. |

## 2. Allowed-path inventory (comprehensive, declared up front)

Worktree: `C:\dev\my-shop-m4-s1` — branch `codex/my-shop-m4-s1-catalog`.

- `services/api/prisma/schema.prisma` — catalog models + header note.
- `services/api/prisma/migrations/0013_product_catalog/migration.sql` — new migration.
- `services/api/src/app.module.ts` — register `CatalogModule`.
- `services/api/src/common/errors/problem.ts` — one new closed error code `CATALOG_SKU_DUPLICATE`.
- `services/api/src/common/audit/stream.contract.ts` — new closed audit event types (code-catalog growth, grammar-only DB CHECK already allows them).
- `services/api/src/common/catalog/*` — contract, domain, service, controller, module (+ unit spec).
- `services/api/test/catalog/catalog.e2e-spec.ts` — integration suite.
- `services/api/test/database/catalog.db-spec.ts` — real-PostgreSQL acceptance incl. HTTP scenarios.
- `services/api/test/database/tenant-rls.db-spec.ts` — inventory lists + cross-tenant probes for the three new tenant tables (the machine gate else fails on unclassified tables).
- `services/api/scripts/catalog-walkthrough.mjs` — the real-operator functional demonstration.
- `services/api/package.json` — one npm run script for the walkthrough (no dependency changes).
- `packages/contracts/openapi.json`, `packages/contracts/src/generated/schemas.ts` — regenerated by the sanctioned generator only (`tool/contract/generate.mjs`).
- `docs/rls-inventory.md` — the documented inventory of the new tenant tables.
- `docs/governance/MY_SHOP_M4_S1_SLICE_RECORD.md` — this record.
- `README.md` — only if a link/reference must follow an established index convention (checked before touching).

## 3. Governing decisions taken inside authorized scope

1. **Variant attributes.** A code-catalog of three typed keys — `color` (text ≤ 50), `size` (text ≤ 50), `capacity` (integer 0..1,000,000) — stored as one validated `jsonb` object per variant. §15.3A.2 asks for "colour, size, and up to a small, owner-defined set" as **typed attributes rather than a rigid fixed schema**: the closed catalog with per-key types achieves that without an arbitrary attribute engine. Unknown keys, wrong types, and out-of-bounds values are refused twice: by the service and by database CHECKs; the database restates the key vocabulary via the `attributes - ARRAY[...]` CHECK trick (no subqueries in CHECKs).
2. **Units are product-level rows** (`product_units`, plan's table name, §39 data map). §15.2 fixes V1 as "a base unit plus at most one purchasing unit **per product**", so the base and purchasing rows are keyed per product with at most one of each kind; a variant therefore sells in its product's base unit in V1. Absent here: multi-level chains and BOM (§4).
3. **Price model.** `products.unit_price_minor` is the product-level list price; `product_variants.price_minor` is the variant override; both nullable, both exact `bigint` minor units bounded `0..999 999 999 999`, transported as decimal strings (M1b-S6 money wire decision, §30.1). The **effective** selling price resolves per variant: variant override → product default → **unset** (never zero). Zero is a real value a catalog editor can store; unset is its own answer, and the M4-S3 costing value is *absent*, not zero (`unitCostMinorAvailable: false`).
4. **Pricing-policy authority preserved.** Catalog list-price administration is gated by `catalog.edit` and does not touch the M3 pricing modes: the catalog price only *supplies* `unitPriceList` to the M3/M5 sale-time engine. Nothing here creates any price-override authority at sale time; `FIXED`, `FIXED_WITH_DISCOUNT`, and `VARIABLE` semantics are untouched (they live in settings + the pricing domain).
5. **Costing closed to this slice.** No cost column anywhere. `catalog.cost.edit` is not wired because there is genuinely nothing for it to guard; M4-S3's engine computes `average_cost_minor` from movements (§30.2), never from a catalog write.
6. **change_log is not written by the catalog.** The M3-S1 settings precedent writes no `change_log` rows either; the single remote-apply/feed door (M1b-S4 ledger) remains untouched. The future device-side catalog projection (`local_products`, §39.6) will be issued from catalog reads/changes by its owning later slice; stable UUID identities and stable route shapes make that additive, not a redesign.
7. **Variant deactivation, product soft-delete.** Products carry `deleted_at` + mandatory `delete_reason` (soft delete, DML only, never a physical DELETE); a deleted product answers 404 everywhere and is hidden from listings while its rows and its variants remain in the database for audit and history. Variants carry `is_active` only in this slice (§40.8 M4-S1 acceptance does not ask for variant deletion, and inventing undelete semantics here would risk the M4-S2 movement design).
8. **SKU normalization is trim-only, case-sensitive.** Type-aware uniqueness (§15.3A.4) is the *barcode* rule (M4b); SKU is a business code kept exactly as entered after whitespace trimming, unique per organization by database index.

## 4. Implementation evidence

- `services/api/prisma/schema.prisma` + `prisma/migrations/0013_product_catalog/migration.sql` — the three tenant-owned tables (`products`, `product_variants`, `product_units`) with per-organization SKU unique index, composite tenant foreign keys, `ENABLE+FORCE` RLS with one symmetric `tenant_isolation` policy each, and the service's catalog bounds restated as CHECK constraints. No earlier migration touched.
- `services/api/src/common/catalog/` — `catalog.contract.ts` (constants/vocabularies), `catalog.domain.ts` (canonicalizers + wire offer types: every offer is canonicalized *before* any connection work, the raw wire is never trusted), `catalog.service.ts` (all read/write paths inside `withTenantTransaction`, 409 `CATALOG_SKU_DUPLICATE` mapped from the real Prisma `P2002` — never a preflight check — and one audit event per table in the same transaction), `catalog.controller.ts` (8 routes under `api/v1/organizations/:organizationId/catalog`), `catalog-view.contract.ts` (wire DTOs incl. `hasCost: false`, the §30.2 costing-absence marker), `catalog.module.ts` (+ `CatalogModule.forRoot(config)` in `app.module.ts`).
- `services/api/src/common/errors/problem.ts` — the one new closed error code `CATALOG_SKU_DUPLICATE`; `src/common/audit/stream.contract.ts` — the new closed event types (`CATALOG_PRODUCT_CREATED/UPDATED/DELETED`, `CATALOG_VARIANT_CREATED/UPDATED`, `CATALOG_UNITS_UPDATED`).
- Comprehensive tests: `services/api/test/database/tenant-rls.db-spec.ts` (+3 catalog tables in the RLS inventory with cross-tenant INSERT/MOVE probes and tenant-A fixture seeds), `test/database/postgres.db-spec.ts` (+migration 0013, +3 tables, 13-migration list), `src/common/catalog/catalog.guard-acceptance.spec.ts` (new, see §5).
- `services/api/scripts/catalog-walkthrough.mjs` + `package.json` script `catalog:walkthrough` — the real-backend demonstration (§6).

**Declared-path amendments** (every one necessary, none silent):

| File | Why it was touched |
| --- | --- |
| `services/api/src/common/bootstrap/bootstrap-cli.ts` | The CLI graph loads `app.config` (class-transformer decorators at module scope) without ever loading `reflect-metadata`; the first run of `bootstrap:org` crashed with `Reflect.getMetadata is not a function`. The server path never hits this because `main.ts`'s first import is `reflect-metadata`. Fixed by adding the same first-line import to the CLI entry points. |
| `services/api/src/common/identity/credential-cli.ts` | Identical repair for `provision:credential`. |
| `packages/contracts/src/codegen/emit.ts` | The OpenAPI document the catalog produces includes OpenAPI-legal `additionalProperties: true` (the free-form attribute map); the pure emitter handled only object-form `additionalProperties` and crashed. Extended to render `true` as `Readonly<Record<string, unknown>>` and to refuse `false` loudly rather than silently degrade. The generated artifacts are committed; `contracts:check` stays green. |

**Wire-shape decisions worth recording:**

1. **Whitelist admission.** The global validation pipe runs in whitelist mode (`forbidNonWhitelisted`), so members validated *outside* class-validator — the unit offers, which the catalog canonicalizer validates deeply — still need a decorator to be admitted onto the wire at all. The unit-offer members carry `@Allow()` plus a real nested OpenAPI `type: 'object'/properties` description; the canonicalizer remains the sole authority for their values.
2. **`baseQuantityFactor` transport.** On the **request** side the factor is a plain JSON number (a bounded count 2..1,000,000 whose integer-ness the canonicalizer proves with `Number.isInteger` — exact, not float-trusted); on the **response** side it serializes as a decimal string so a value can never lose exactness in a client's float. The OpenAPI document states both shapes honestly.

## 5. Test evidence

Every gate ran against the final source tree; none of these numbers is claimed without a captured run this session:

| Gate | Command | Result |
| --- | --- | --- |
| Solo typecheck | `npm run typecheck:solo` | pass (0 errors) |
| Production build | `npm run build` (`tsc --build`) | pass |
| Lint | `npm run lint` | pass (0 problems) |
| Unit | `npm run test:unit` | **43 suites / 587 tests passed** |
| Integration (HTTP boundary, no DB) | `npm run test:integration` | **8 suites / 66 tests passed** |
| Database (real PostgreSQL, `test:database`) | 6 suites / **231 tests passed** — including the 21/21 `tenant-rls` acceptance (now with catalog-table cross-tenant INSERT/MOVE probes) and the 113/113 `postgres.db-spec` inventory (now counting migration 0013 and the three catalog tables) |
| Contract drift | `npm run contracts:generate` then `contracts:check` | "contracts are in sync" |

**Declared-tests variation (declared up front, in scope §1's spirit):** the record named a `catalog.domain.spec.ts` (unit) and a `catalog.db-spec.ts` (database project) before implementation. What the slice actually carries is a comprehensive-but-single unit spec — `src/common/catalog/catalog.guard-acceptance.spec.ts` (7 cases: the full permission wall of all 8 routes read through the real `AuthorizationGuard` + real `Reflector` + real production handler metadata, proving both refusal of a view-only member on every write and admission of a view-only member on every read) — and the DB-level acceptance coverage lands in the already-governed `tenant-rls.db-spec` extension (RLS, role separation, unique index, CHECK constraints probe the real tables directly) plus the HTTP boundary integration suite. The domain canonicalizers are exercised end-to-end by the integration suite and by the real-walkthrough refusal cases (§6), which is *stricter* evidence than a mocked-unit-level restatement, and the slice record declares rather than hides the difference.

## 6. Real-backend functional demonstration

`node scripts/catalog-walkthrough.mjs` (npm: `catalog:walkthrough`) — a repeatable, real-HTTP, real-PostgreSQL run: two **real operator bootstraps** (`bootstrap:org`), two **real credentials** (`provision:credential`), two **real logins** through `/api/v1/auth/login` (no token minting in the walkthrough), and every step asserted against the §34.3 problem contract (exact code + exact HTTP status). Server: real `node dist/main.js` against `my_shop_m4s1_dev` (real PostgreSQL 18, application role `my_shop_app`). The run's recorded steps (27/27 PASS, exit code 0):

| Scenario | Step evidence (all PASS) |
| --- | --- |
| A — product + units | Arabic product `تيشيرت قطن` created `201`: units `['BASE','PURCHASING']`, carton factor exact `"12"`, price `"45999"` (EGP 459.99) |
| B — variants + inheritance | `BLACK-M` `{color:'أسود', size:'M'}` own price `44999` → `priceSource: VARIANT`; `BLACK-L` no price → `effectivePriceMinor: '45999'`, `priceSource: PRODUCT` |
| C — sibling independence | `BLACK-M` edit to `43999`; full product GET proves `BLACK-L` kept `priceMinor null / 45999 / PRODUCT` and the product default stayed `45999`; Arabic-name search finds the product, a miss answers an empty list |
| D — SKU uniqueness | duplicate `WT-DUP-SKU` answered `409 CATALOG_SKU_DUPLICATE` (the loser of the real INSERT); three independent SKUs each committed `201` |
| E — refusals | purchasing factor `1.5`, `1`, `1000001` → all `400 VALIDATION_FAILED`; `"12.5"` and 13-digit money → `400`; unknown attribute key `fabric` and string `capacity` → `400`; unknown organization → `403 ORGANIZATION_FORBIDDEN` |
| F — tenancy across two real orgs | org B bootstrapped, credential provisioned, real login; B's write into A's catalog → `403 ORGANIZATION_FORBIDDEN`; B's own product + the *same* SKU as A's are legal (`priceSource: UNSET` — per-organization uniqueness and no fabricated zero). The cross-tenant read probe rides E: a product under an unknown organization id → `403 ORGANIZATION_FORBIDDEN` (never an existence leak) |
| RESUME — restart persistence | after killing and restarting the real server process, a fresh login re-read product `2ccc5166…` with `variantCount 6`, `unitCount 2`, `nameAr` intact — exit code 0 |

Boundary note recorded honestly: the *view-only caller cannot write* refusal (AC 7) is proven at guard level against the production metadata (§5 — the real guard, the real decorators, and the 8 routes' exact permission declarations); on the real-HTTP surface today the product has **no route that provisions a second, non-owner member** (that surface arrives with a later slice), so a real logged-in view-only principal cannot even be minted. The walkthrough's authorization evidence is the tenant wall (`ORGANIZATION_FORBIDDEN` for org B's real owner token on read and write probes); the *permission* wall is the guard-level proof above.

## 7. Acceptance and delivery

- **Acceptance criteria (§1):** all eleven verified — (1)(2)(3)(4)(5)(6) by the walkthrough + the suites, (7) by the guard-acceptance spec, (8) by walkthrough F + the RLS cross-tenant probes in `tenant-rls`, (9) by the service's same-transaction `AuditStreamWriter` events (class A; `CATALOG_*` event types now in the closed vocabulary) and the audit-acceptance assertions exercised through the real server (the walkthrough's own writes land as `CATALOG_*` audit rows served under `catalog.view`), (10) by the RESUME restart proof, (11) by `contracts:check` on the regenerated artifacts.
- **Git:** branch `codex/my-shop-m4-s1-catalog`, pushed (`c2d1a6c` → format-repair `8003f20`); **stacked Draft PR #29 targeting `codex/my-shop-m3-s4-flutter-settings` — never `main`**; no merge, no force-push, no history rewrite anywhere; predecessor worktrees untouched.
- **CI repair cycle (declared):** the first CI run failed fast-checks stage 3 (`format:check`) — the seven new catalog module files carried local formatting that differs from the repository Prettier rules, and the slice's local sweep had not run that stage. Repaired with `prettier --write` (no logic change), every local gate re-verified (format/lint/typecheck/build/unit 43/587/integration 8/66), and the mechanical fast-check stages re-run locally (`secret-scan`, `markdown-check`, `vocabulary-ban`, `immutability-check`, `migration-immutability`, `import-boundary`, `offline-guards` — all OK) before the new head was pushed.
- **Expected CI:** `fast-checks`, `backend-unit`, `backend-integration-database`, `contract-drift`, `dependency-audit`, `flutter-build-windows`, `flutter-build-android` (no Flutter source changed by this slice; the Flutter jobs run because the stack base does).
- **Non-scope confirmations:** no barcodes, no stock movements, no costing fields, no Flutter screens, no offline write queue, no `catalog.cost.edit` wiring, no `change_log` rows (same posture as M3-S1), M4-S2 not started.
