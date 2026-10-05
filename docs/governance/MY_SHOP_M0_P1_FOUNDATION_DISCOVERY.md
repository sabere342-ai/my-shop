# MY SHOP — M0-P1 FOUNDATION & DISCOVERY RECORD

**Slice:** M0-P1 — Foundation, Discovery, Master Plan
**Repository:** `sabere342-ai/my-shop` — `https://github.com/sabere342-ai/my-shop.git`
**Default branch:** `main`
**Canonical entry baseline:** `53f6aaa9aded2ec2218cec3f8987675a824b70db`
**Working branch:** `codex/my-shop-m0-p1-foundation-master-plan`
**Document version:** 1.0.0
**Outcome:** see §1

This record is the factual evidence base for
[`MY_SHOP_MASTER_PLAN.md`](./MY_SHOP_MASTER_PLAN.md). Every claim here is backed by a command
transcript or a file path.

---

## 1. Outcome

| Item | Result |
|---|---|
| Result token | `PASS_MY_SHOP_M0_P1_FOUNDATION_MASTER_PLAN_REMOTE_LOCKED` |
| Entry classification | `CASE_A_FRESH` |
| Baseline proof | local `main` = tracking `origin/main` = direct remote `main` = `53f6aaa9…` |
| Legacy inspection | Read-only; verified unchanged (§4) |
| Artifacts produced | 2 documents, 1 commit, 1 branch, 1 PR, not merged |
| `main` | Unchanged |

---

## 2. Entry and recovery classification

### 2.1 Pre-inspection state of `C:\dev\my-shop`

| Probe | Result |
|---|---|
| `Test-Path C:\dev\my-shop` | `True` |
| `git rev-parse --show-toplevel` | `fatal: not a git repository (or any of the parent directories): .git` |
| `git rev-parse --is-inside-work-tree` | same fatal error |
| Recursive item count (files, directories, including hidden and system) | **0** |
| Directory attributes | `Directory` (not a reparse point, not a symlink) |

The directory existed and was **completely empty**. It was not a repository, contained no
unexplained files, no `.git`, no stash, no lock files, and no in-progress git operation.

### 2.2 Classification decision

| Criterion | Finding |
|---|---|
| Was it already the correct clone? | No — it was not a repository at all |
| Were there unexplained files? | No — zero items |
| Was any local work at risk? | No — nothing existed |
| Was destructive recovery needed? | No |

**Classification: `CASE_A_FRESH`.**

`CASE_B_RECOVERABLE_EXISTING` did not apply: there was no existing repository, no divergent
branch, no stash, and nothing to recover. `CASE_C_UNSAFE` did not apply: there was no unknown
state to preserve.

### 2.3 Action taken

Because the target directory was verifiably empty, the only safe action was a fresh clone into
that exact location. **No destructive command was executed at any point in M0-P1:**

| Forbidden command | Executed? |
|---|---|
| `git reset --hard` | No |
| `git clean` | No |
| `git checkout` of a legacy branch | No |
| `git stash` | No |
| Deleting an unknown file | No — there were none |
| Force push | No |
| Rewriting `main` | No |
| `git clone` into a non-empty directory | No — the target was empty |

```
$ git clone https://github.com/sabere342-ai/my-shop.git "C:\dev\my-shop"
Cloning into 'C:\dev\my-shop'...
```

### 2.4 Post-clone repository identity

| Property | Value |
|---|---|
| Top level | `C:/dev/my-shop` |
| Branch | `main` |
| HEAD | `53f6aaa9aded2ec2218cec3f8987675a824b70db` |
| `origin` | `https://github.com/sabere342-ai/my-shop.git` (fetch and push) |
| `git status --short` | empty |
| `git status -uall` | `On branch main` / `Your branch is up to date with 'origin/main'.` / `nothing to commit, working tree clean` |
| Stash list | empty |
| Active git operations | none — no `MERGE_HEAD`, no `REBASE-HEAD`, no `rebase-merge`, no `rebase-apply`, no `CHERRY_PICK_HEAD` |
| Git lock files | **0** `*.lock` files anywhere under `.git` |
| Tracked files at baseline | exactly one: `README.md` (mode `100644`, blob `4e621d9a98e3b4d3dc453dee2a82ca3218772579`) |
| Recent log | `53f6aaa (HEAD -> main, origin/main, origin/HEAD) Initial commit` |

### 2.5 GitHub identity

| Probe | Result |
|---|---|
| `gh` on `PATH` | Not found |
| `gh` present on disk | `C:\Users\saber\AppData\Local\CodexTools\GitHubCLI\2.96.0-20260713-193457\bin\gh.exe` |
| `gh --version` | `gh version 2.96.0 (2026-07-02)` |
| Authenticated account | **`sabere342-ai`** — matches the required repository owner |
| Token storage | keyring |
| Git operations protocol | `https` |
| Token scopes | `gist`, `read:org`, `repo`, `workflow` — `repo` and `workflow` are sufficient for branch push and PR creation |

The GitHub CLI is configured as the global credential helper for `https://github.com` in
`%USERPROFILE%\.gitconfig`, so push and PR operations authenticate as `sabere342-ai` without any
credential being written to this repository.

---

## 3. Canonical baseline proof

### 3.1 Three-surface agreement

The canonical entry commit was verified on all three independent surfaces.

| Surface | Command | Result |
|---|---|---|
| Remote listing (pre-clone) | `git ls-remote https://github.com/sabere342-ai/my-shop.git` | `53f6aaa9aded2ec2218cec3f8987675a824b70db  HEAD` and `53f6aaa9aded2ec2218cec3f8987675a824b70db  refs/heads/main` |
| Local `main` | `git -C C:\dev\my-shop rev-parse main` | `53f6aaa9aded2ec2218cec3f8987675a824b70db` |
| Tracking `origin/main` | `git -C C:\dev\my-shop rev-parse origin/main` | `53f6aaa9aded2ec2218cec3f8987675a824b70db` |
| Direct remote `main` (post-clone, re-queried) | `git ls-remote … refs/heads/main` | `53f6aaa9aded2ec2218cec3f8987675a824b70db` |

**All four agree.** No drift was detected, so `BLOCKED_MY_SHOP_M0_P1_REMOTE_BASELINE_DRIFT`
does not apply. The M0-P1 commit was built directly on this baseline with no reconciliation step.

### 3.2 Baseline content

The baseline contained exactly one file, `README.md`, whose entire content was the single line
`# my-shop`. There was no executable content of any kind. Any executable content found in the
repository at M0-P1 time would therefore have been a finding; §7 confirms none was introduced.

---

## 4. Legacy project identity and read-only proof

### 4.1 Identification

The owner supplied `C:\dev\muaman.worktrees\i-tech-next-roadmap-freeze` as a *possible* location,
explicitly instructing not to assume it. It was verified before use.

| Probe | Result |
|---|---|
| `git rev-parse --show-toplevel` | `C:/dev/muaman.worktrees/i-tech-next-roadmap-freeze` |
| Current branch | `codex/i-tech-next-roadmap-freeze` |
| HEAD | `80bfd586535148ae04c2aa661440331551224d31` |
| HEAD subject | `docs: record C4 CD6 R8V closed vocabulary device registration runtime observation, BLOCKED` |
| Remote `github` | `https://github.com/sabere342-ai/muaman.worktrees.git` |
| Remote `origin` | `C:\Users\saber\OneDrive\Desktop\ادارة_محل_مؤمن` |
| Working tree | **dirty on arrival** — 1 modified tracked file, plus untracked paths including a 12.7 MB delivery archive and `supabase/.temp/` |

The application source root is `app/` inside this worktree, not the worktree root. The Dart
package is `muaman_store`, version `1.0.0+3`, `description: "A new Flutter project."` — an
untouched Flutter template description on an application of roughly 40,000 lines.

### 4.2 Identity confidence — resolved, not uncertain

The owner asked that uncertainty be reported if the legacy source could not be confidently
identified. It **was** identified, but with two findings worth recording:

| Finding | Detail |
|---|---|
| `origin` points to a **non-existent path** | `C:\Users\saber\OneDrive\Desktop\ادارة_محل_مؤمن` does not exist. `C:\Users\saber\OneDrive\Desktop` contains only `desktop.ini` and `GitHub.lnk`. |
| Global `safe.directory` entry is **stale** | `%USERPROFILE%\.gitconfig` trusts `C:\Users\saber\OneDrive\Desktop\2_projects\clothing_management`, which also does not exist. |
| There are **25 worktrees of one repository** | `C:\dev\muaman` plus 24 siblings under `C:\dev\muaman.worktrees\`, all `muaman`. |
| Other `C:\dev` projects are unrelated | `makhazen` and `multi-pos\grain-warehouse-erp-lite` are different projects and were **not** inspected as candidates. |

Exactly one I Tech source tree exists on this host. Identity is therefore **confirmed**, and
`BLOCKED_MY_SHOP_M0_P1_LEGACY_IDENTITY_UNCERTAIN` does **not** apply.

**Recommendation recorded, not acted upon:** the legacy repository's `origin` remote and the two
stale `safe.directory` entries should be corrected by the owner. Fixing them was outside M0-P1
authorization and no legacy repository was modified.

### 4.3 Read-only proof

A fingerprint of the legacy repository was taken before inspection and re-verified after all work
completed (§8.3).

| Measure | Before inspection | After all M0-P1 work |
|---|---|---|
| HEAD sha | `80bfd586535148ae04c2aa661440331551224d31` | identical |
| Branch | `codex/i-tech-next-roadmap-freeze` | identical |
| Working tree status line count | 32 | identical |
| `git status --porcelain -uall` SHA-256 | `199f139c873a812f9f6ed923a367ca52841ef4e87000b88e5e6d2476bdda3738` | identical |
| Stash count | 1 | identical |

### 4.4 Read-only discipline actually applied

| Prohibition | Compliance |
|---|---|
| Commit to the legacy repository | No write-capable git command was run against it |
| Switch or rewrite its branches | Not attempted |
| Modify its working tree | Not attempted; the status hash is unchanged, proving it |
| Run code generators that dirty it | Not attempted — no `flutter pub get`, no `build_runner`, no formatter |
| Migrate its database | Not attempted |
| Copy `.git` | Not copied |
| Copy build caches | Not copied |
| Copy secrets | None exist that were read; §5.8 confirms no real credential was present |
| Copy production data | No database file was read or copied |
| Copy signing material | Not read |
| Copy generated Flutter platform artifacts | Not copied |

Inspection used only read operations: directory listing, file reading, content search, and
read-only git queries (`rev-parse`, `status`, `log`, `show`, `remote -v`).

---

## 5. Legacy discovery report

The full evidence is in §5 of this record. This section is the summary; the classification matrix
is §5.9.

### 5.1 Scale

| Measure | Value |
|---|---|
| Dart files under `lib/` | 165 |
| Lines under `lib/` | 40,272 |
| Files under `test/` | 144 |
| Lines under `test/` | 41,243 — **more test code than production code** |
| Governance markdown at repo root | 158 files, 86,989 lines |
| Files under `docs/` | 7,896 files, 2,577,355 lines |
| CI configuration | **None.** No `.github/` directory anywhere |
| Coverage configuration | **None.** No `lcov.info`, no coverage script |

The documentation-to-code ratio is extreme: roughly 2.6 million lines of documentation for 40,000
lines of application. Much of it references an external governance corpus not present in the
repository, so the rationale is unreachable to a new maintainer.

### 5.2 Architecture — the decisive negative findings

There is **no clean layering**. Verified absent: no `domain/` directory, no `Bloc`/`Cubit`, no
use-case classes, no data-source abstraction.

Instead: a 3-bucket flat structure (`screens/` → `database/DatabaseHelper` → SQLite) with a
parallel, almost entirely unwired `services/` + `repositories/cloud/` path.

| Finding | Evidence |
|---|---|
| **God object** | `lib/database/database_helper.dart` is **3,926 lines**, holds the schema, every SQL query, tenant scoping, permission gates, licensing gates, sync enqueue, and cost-history recording. Referenced by **31 of 165** lib files. |
| **No DI** | 7 global mutable singletons via `static final X instance`, plus 4 `static` mutable callback seams registered from a 155-line imperative bootstrap in `main.dart`. |
| **State management** | 3 `ChangeNotifier` classes and 24 `setState` screens. `SessionState` is **prop-drilled as a constructor parameter into all 24 screens**. Zero `provider`, `riverpod`, `bloc`, `getx`. |
| **No routing** | No `go_router`, no `onGenerateRoute`, no Navigator 2.0. 25 hand-written `Navigator.push(MaterialPageRoute(...))`. |
| **Unreachable screens** | `OpeningBalanceScreen`, `ShopSelectorScreen`, `ConflictReviewScreen` are each referenced only inside their own file. The accounting UI is therefore **dead code**. |
| **Cloud layer unwired** | `CloudProductService`, `CloudSalesService`, `CloudExpenseService`, `CloudSettingsService`, `CloudAccountingService` are imported by **zero** lib files — only by tests. |
| **Unused dependencies** | `http` and `cbor` are declared and imported by zero lib files. |

### 5.3 The findings that most directly shape the Master Plan

These six negative findings are the reason My Shop is not an evolution of this codebase.

| # | Finding | Evidence | Master Plan consequence |
|---|---|---|---|
| **F-1** | **No double-entry accounting of any kind.** Zero matches for `journal`, `general_ledger`, `double_entry`, `debit`, `credit` across all 165 files. | `LedgerEntry` is explicitly documented as an **opening-balance-only** append-only record, not a general ledger. Profit is an ad-hoc aggregation of four independent `SUM()` queries wrapped in a fail-closed `complete` flag. | §28, §29 — a real ledger is built from scratch, with a database-level balance constraint |
| **F-2** | **No product selling price.** The `products` table has no price column. | Every cart line starts at `salePrice: 0`; the operator types a price per line into a free-text field. No price list, no price history, no margin hint. | §15.1, §17 — selling price becomes a first-class field governed by a pricing mode |
| **F-3** | **Money is `double` / SQLite `REAL` everywhere.** | Every monetary column is `REAL DEFAULT 0`; every model field is `double`; totals are float folds (`fold(0.0, (sum, i) => sum + i.salePrice * i.quantity)`); display always rounds to 0 decimals via `toStringAsFixed(0)`. The cloud path uses `NUMERIC(12,2)`, so the two representations **disagree and convert lossily** through `.toDouble()`. | §30.1 — integer minor units end to end |
| **F-4** | **No suppliers and no purchases.** Zero matches for `supplier`, `purchase`, `weightedAverage`. | Cost can only be edited by hand; there is no way to record what was actually paid for stock. | §24–§26 — built from scratch |
| **F-5** | **Returns are not linked to any sale.** | The returns screen takes a selected product and a free-text price and writes `costPrice` from the *current* product cost — so a return cannot be reconciled against what was paid. | §16.5, §30.4 — returns reference the original sale line at its snapshotted cost |
| **F-6** | **No inventory costing.** A single flat, manually editable `costPrice` per product. | Changing it silently changes inventory value with **no journal entry**, and never restates historical COGS. A `cost_history` audit table exists but is never read by any screen. | §30 — perpetual weighted average, adopted as an explicit decision with stated consequences |

### 5.4 Pricing behaviour — full detail

This is the most consequential discovery for My Shop's pricing model:

1. The `products` table has **no** `salePrice` column. Only `costPrice` and `totalInventoryCost`.
2. Every cart line is created with `salePrice: 0`.
3. The operator types a price per line into a plain `TextField` with a `ج.م ` prefix. There is no
   price lookup, no last-used price, no price list, no margin hint.
4. Saving is blocked unless every line is `> 0` and not NaN/Infinity.
5. The typed price **is** correctly snapshotted onto `sales.salePrice`, and `costPrice` is
   snapshotted at the same moment — so historical COGS is frozen. **This one behaviour is
   correct and My Shop preserves it.**
6. There is no discount concept, no tax, no shipping, no rounding rule, no multi-currency.

By contrast the product **cost** is editable and audited: a cost change triggers a confirmation
dialog and writes a `cost_history` row inside the same transaction.

### 5.5 Persistence and tenancy

| Aspect | Finding |
|---|---|
| Engine | SQLite via `sqflite`, swapped to `sqflite_common_ffi` on desktop and in tests |
| Schema version | 20, with a real versioned `onUpgrade` ladder |
| Migration quality | **Additive and idempotent from v13 onward, and well tested per version.** However `v1 → v2` is destructive: it drops five tables. |
| DDL style | Hand-written string SQL. No ORM, no codegen, no schema files. |
| Foreign keys | **Declared but never enforced.** `PRAGMA foreign_keys = ON` appears zero times. Integrity is enforced in application code instead. |
| `CHECK` constraints | Only **2** in the entire schema |
| Multi-tenancy | A second orthogonal layer: `shop_id` + `cloud_uuid` + `server_version` + `sync_status` on every tenant table, with a `_TenantPredicate` that returns `denyAll` when no shop is bound |
| Barcode uniqueness | **GLOBAL**, deliberately retained across shops — a cross-tenant information leak through uniqueness violations |
| Backup | `VACUUM INTO` with `PRAGMA integrity_check`, owner-only, hidden on Android |

The tenancy design deserves credit: a `denyAll` fail-closed predicate, a `TenantIsolationGate`
that refuses to arm strict filtering while unattributed rows exist, and explicit
`TenantOwnershipException` instead of silent no-ops. My Shop preserves the intent and replaces the
mechanism with forced RLS (§8.2, §9.3).

### 5.6 Connectivity — the inheritance that is explicitly refused

The legacy application is **local-first**: a full SQLite database is the source of truth, with a
client-side outbox (`sync_queue`), 15 sync files, 12 entity adapters, per-entity conflict
policies, and a two-phase legacy-to-cloud migration pipeline.

**The sync drain ships disabled.** `syncDrainEnabled` defaults to `false`, with a comment stating
it is "the single reviewable switch that activates the runtime drain after the owner decision".
With it off, the queue accumulates and **no rows ever reach the server**.

This is decisive evidence for Master Plan §38: the legacy application paid the full cost of an
offline architecture, could not finish the synchronization, and shipped with it dormant — all
while the queue, the conflict enums, and the observability widgets remained in the product.

### 5.7 Security posture — the genuinely strong part

Credit where due. Four independent authorization layers, documented as such:

| Layer | Implementation |
|---|---|
| UI gating | `sessionState.hasPermission(...)` — explicitly documented as visibility convenience only |
| Data layer | `_requirePermission` / `_requireSalesHistoryAccess` throwing typed exceptions on every sensitive mutation and history read |
| Licensing | `CloudLicensingService.enforceActive()` on every business write |
| Server | RLS plus per-RPC re-authorization |

Also genuinely good: `ownerExclusive` permissions are structurally ungrantable to non-owners;
clean-start requires typing an exact phrase *and* a verified backup; backup/restore are owner-only;
and there is a test that audits the SQL migration files for `SECURITY DEFINER`, `search_path`,
`GRANT ALL`, `EXECUTE IMMEDIATE`, and conflict markers.

Defects found:

| Defect | Detail |
|---|---|
| Non-constant-time password compare | `verifyPassword` returns `false` on the first differing byte. Notably, `secure_store.dart` implements constant-time comparison correctly for its HMAC, so the pattern was known and simply not applied here. |
| No lockout, no rate limit, no attempt counter | Password rule is `length >= 6`, in one screen. |
| Passwords in the business database | `users.passwordHash` lives in the same unencrypted SQLite file that `VACUUM INTO` copies to a user-chosen directory. |
| DPAPI via PowerShell shell-out | Plaintext is written to `%TEMP%\itech_plain_$pid.bin`, then PowerShell invokes `ProtectedData::Protect`. |
| XOR fallback on non-Windows | Self-documented as `NOT secure — for development/testing only`. |
| `wmic` dependency | `wmic` is **deprecated and removed in Windows 11 24H2**. |
| Crash handler is a no-op in release | `AppCrashHandler` redacts secrets into `debugPrint`, which is compiled out of release builds. |
| ~100 silent `catch (_)` blocks | Across 34 files. Several are deliberate fail-closed; many are swallow-and-continue. |

**Biometrics: not used at all.** `local_auth` is absent from the lockfile and
`local_auth|biometric|Biometric` returns **zero** matches across all 165 files. There is no
fingerprint or face unlock anywhere in the legacy application. My Shop's app lock (§14) is
therefore entirely new work, with no legacy code to lean on.

**No hardcoded secrets found.** No service-role key, no Supabase credentials, no JWT, no API keys.
The anon key is compile-time only with a `'your-anon-key'` placeholder. One item worth flagging:
`defaultSupportPhone = '+201014900211'` — a real personal telephone number compiled into the
binary and printed on every invoice footer.

### 5.8 Network and cloud

100% Supabase, 119 references, 47 `.rpc()` calls, zero raw HTTP. All traffic is Postgres RPC
functions; there are no direct client table reads or writes. Endpoints include
`create_cloud_invoice_with_items`, `create_cloud_sale_with_stock`,
`create_cloud_return_with_stock`, and `migration_upsert_chunk`.

Two caveats recorded:

- `supabase/.temp/` is present and untracked, containing a `project-ref` and a docker env file —
  evidence a local Supabase instance was linked at some point.
- Cloud tables are prefixed `cloud_*`, and money precision **diverges** from local (§5.3 F-3).

### 5.9 Reuse classification matrix

Classification per the owner's four categories. **Counts: 1 `REUSE_AS_IS`, 4 `ADAPT`,
16 `REIMPLEMENT`, 11 `DO_NOT_COPY`.**

#### 5.9.1 `REUSE_AS_IS` — 1 item

| Item | Legacy evidence | My Shop treatment |
|---|---|---|
| **"The printed total is the persisted total" invariant** | `InvoiceRepository` builds `InvoiceDocumentData`, delegates rendering, and deliberately never recomputes the total: *"The PDF total is the persisted `Invoice.totalAmount` — never recomputed with different logic."* A `computedLinesTotal` getter exists purely so tests can assert `Σ lines == totalAmount`. | Adopted as Master Plan **§21.4**. **The invariant is reused; the code is not.** Reimplemented independently, and recorded as a principle reuse so no contributor infers a licence to copy. |

This is the only item in the entire legacy codebase classified `REUSE_AS_IS`, and it is a design
principle rather than an implementation.

#### 5.9.2 `ADAPT` — 4 items

| Item | Legacy evidence | Why adapted rather than copied |
|---|---|---|
| **Immutable financial-line cost snapshot** | `costPrice` and `cogs` are snapshotted onto every `sales` and `returns` row at write time, so historical gross profit is stable across later cost changes. Verified correct. | Concept preserved as Master Plan **§16.2**. Reimplemented because the legacy storage is `double` and returns are costed wrongly (§30.4). |
| **Conditional stock decrement inside the transaction** | `UPDATE … WHERE id = ? AND currentQuantity >= ?` inside `insertInvoiceWithItems`, throwing on a zero-row result. | Generalised as Master Plan **§15.6** — it becomes the only supported mutation path, extended to every movement cause. |
| **Per-entity conflict vocabulary / closed state machine** | A disciplined closed vocabulary for device trust states, with an explicit comment that new states must not be introduced casually. | The *discipline* is adopted as Master Plan **§12.2** and **§15.5**. The specific states are not, and the sync conflict vocabulary disappears entirely with the online-first decision (§38). |
| **Ed25519 device identity and challenge/response proof** | Per-install keypair from a keystore-backed seed; Ed25519 challenge/response; server always authoritative. Sound concept, ~260 + 195 lines. | Reimplemented as Master Plan **§12.3**, server-issued and keystore-backed, because the Windows implementation shells out to removed `wmic` and writes plaintext to `%TEMP%`. |

#### 5.9.3 `REIMPLEMENT` — 16 items

| # | Area | Legacy state | My Shop target |
|---|---|---|---|
| R-1 | Domain layering | None — 3,926-line god object | §6.3 feature-first with CI-enforced import boundaries; domain is pure Dart |
| R-2 | State management | 3 `ChangeNotifier`s, 24 `setState` screens, 7 singletons | §6.4 Riverpod with generated providers |
| R-3 | Dependency injection | Manual constructor injection plus 4 `static` mutable seams | §6.5 provider-based, no service locators |
| R-4 | Routing | 25 hand-written pushes, no router | §6.6 `go_router` with auth and organization guards |
| R-5 | Localization | **0** `.arb` files, 398 hardcoded user-visible Arabic strings, manual `Directionality` in 55 places | §6.8 ARB catalogs, CI grep gate, zero manual directionality |
| R-6 | Design system | No theme file, no text theme, no spacing scale, 21 scattered hex literals, 83 `Colors.*` references in one file | §6.9 `core/ui` with role colours, type scale, spacing scale |
| R-7 | Validation | Zero `Form`, `validator:`, or `InputFormatters`; 44 manual throws; 39 hand-rolled dialogs | §6.9 form components, §34.2 one validation contract |
| R-8 | Pricing model | No product price; price typed per line | §15.1, §17 selling price plus three pricing modes |
| R-9 | Discounts | **Absent entirely** | §18 three types, ceilings, authority, approval |
| R-10 | Customers | No balance, no credit limit, no statement, no history | §19 ledger-based balances, §20 receivables |
| R-11 | Returns | Not linked to any sale; free-text price; wrong cost | §16.5, §30.4 linked to original line at original cost |
| R-12 | Suppliers | **Absent entirely** | §24 ledger-based |
| R-13 | Purchases and payables | **Absent entirely** | §25, §26 |
| R-14 | Financial accounts | Schema and data layer exist; the only UI is unreachable dead code; seeded empty per shop | §27 first-class, ledger-derived balances, reachable |
| R-15 | Inventory costing | Single flat editable cost price | §30 perpetual weighted average |
| R-16 | Settings | 22 untyped string keys in one table, shared with the entitlement and permission caches via a `cloud.license.` prefix convention | §22 typed settings |

#### 5.9.4 `DO_NOT_COPY` — 11 items

| # | Item | Reason for prohibition |
|---|---|---|
| D-1 | `DatabaseHelper` and its 3,926 lines | God object violating every boundary; 31 dependents |
| D-2 | `double` / SQLite `REAL` money | Binary floating point in a financial system; the legacy cloud path already diverges from it |
| D-3 | Local-first SQLite as source of truth | Inherits a half-finished offline architecture whose drain ships disabled (§5.6) |
| D-4 | The `sync_queue` outbox, 12 adapters, conflict enums | Solves a problem My Shop does not create by being server-authoritative |
| D-5 | XOR `_simpleObfuscate` secure-store fallback | Self-documented as insecure |
| D-6 | DPAPI via PowerShell with plaintext in `%TEMP%` | Writes plaintext secrets to disk; `LocalMachine` scope is decryptable by any local process |
| D-7 | `wmic`-based hardware fingerprinting | `wmic` removed in Windows 11 24H2 |
| D-8 | Non-constant-time `verifyPassword` | Timing-attack surface, in a codebase that already knows the correct pattern |
| D-9 | Globally unique `products.barcode` | Leaks the existence of another tenant's products via uniqueness violations |
| D-10 | Hardcoded `'+201014900211'` support phone | Personal data compiled into the binary and printed on every invoice |
| D-11 | Custom Win32 `WM_CLOSE` / `PrintDlg` interception in `windows/runner/flutter_window.cpp` | Necessary in its context, but it enumerates all top-level windows by process. Master Plan §21.3 requires the problem be solved with maintained plugin behaviour plus an integration test |

#### 5.9.5 Explicitly absent from the legacy application

Recorded because absence is a finding, and because these are the areas where My Shop has **no**
prior art to lean on:

| Absent capability | Verified by |
|---|---|
| Suppliers | Zero matches for `supplier`, `مورد` |
| Purchases | Zero matches for `purchase`, `شراء`, `متوسط التكلفة` |
| Double-entry accounting | Zero matches for `journal`, `debit`, `credit`, `general_ledger` |
| Discounts | No discount field or concept on any document |
| Credit sales and receivables | No customer debt ledger, no aging |
| Biometrics | Zero matches for `local_auth`, `biometric`, `Biometric` |
| Real localization | Zero `.arb` files; all Arabic is hardcoded |
| CI | No `.github/` directory |
| Coverage measurement | No `lcov.info`, no coverage script |
| A design system | No `theme.dart`, `colors.dart`, `typography.dart`, or `constants.dart` |
| Reusable UI components | Only 4 files in `lib/widgets/`, one of them dead |
| Charting | No charting package and no chart widgets |
| A logger | No `log`/`logger` abstraction; only `debugPrint`, which is stripped in release |

### 5.10 What My Shop inherits positively

Honest credit, because the legacy work informed several good My Shop decisions:

| Legacy strength | Where it informed My Shop |
|---|---|
| Data-layer authorization, not just UI gating | §7.3, §34.2 |
| `ownerExclusive` structurally ungrantable permissions | §11.2, §11.4 |
| Fail-closed tenant predicate (`denyAll`) and arming gate | §9.3 intent, replaced by forced RLS |
| Conditional stock decrement in-transaction | §15.6 |
| Immutable cost snapshot on financial lines | §16.2, §30.4 |
| "Printed total is the persisted total" | §21.4 |
| Real per-version schema migration tests | §35, §36.6 |
| The migration-file security audit test | §43.1 gate G-9 |
| S6/S8 device integrity with server authority | §12.3 |
| Disastrous deletion for a new device being able to claim ownership | §10.4 |
| Offline-write conflict complexity being explicitly bounded | §38.1 |
| Domain comments referencing plan sections | Adopted as a documentation standard |
| Absence of `TODO`/`FIXME`/commented-out cruft in 165 files | The debt is architectural, not cosmetic |

---

## 6. Toolchain discovery

Recorded **without upgrading anything**. No global tool was installed, and no version was
changed, as part of M0-P1.

### 6.1 Detected host versions

| Tool | Detected version | Notes |
|---|---|---|
| Git | `2.55.0.windows.2` | Current and adequate |
| Flutter | **3.24.5 (stable)**, revision `dec2ee5c1f`, dated **2024-11-13** | **Over 1 year old.** Dart SDK 3.5.4 |
| Dart (standalone on `PATH`) | **`3.13.4`** | **Conflicts with the Dart inside Flutter (3.5.4).** Two Dart SDKs are on this host. |
| Java | OpenJDK **21.0.11** LTS (Microsoft build) | `JAVA_HOME` set to `C:\Program Files\Microsoft\jdk-21.0.11.10-hotspot` |
| Node.js | `v22.22.3` | Current LTS line; matches Master Plan §7.1 |
| npm | `10.9.8` | |
| pnpm | **not installed** | |
| Yarn | **not installed** | |
| PostgreSQL client | `psql 18.4` | Matches Master Plan §7.1 target of PostgreSQL 18 |
| Docker | `29.7.2` | Available; useful for a CI-equivalent local database |
| GitHub CLI | `2.96.0` | Not on `PATH`; invoked by absolute path |

### 6.2 Host environment

| Item | Value |
|---|---|
| OS | Microsoft Windows 11 Pro, version 10.0.26200, build 26200 |
| Architecture | `AMD64` |
| PowerShell | 5.1.26100.6584 |
| Visual Studio | **Build Tools 2026**, version 18.6.11806.211, `C:\Program Files (x86)\Microsoft\Studio\18\BuildTools` |
| Android SDK root | `C:\Users\saber\AppData\Local\Android\Sdk` (`ANDROID_HOME` and `ANDROID_SDK_ROOT` both set) |
| Android SDK components | `build-tools`, `cmake`, `cmdline-tools`, `licenses`, `ndk`, `platform-tools`, `platforms`, `system-images` |

### 6.3 Version position: detected vs recommended vs locked

| Tool | Detected | Recommended for M1 | Locked in project | Divergence |
|---|---|---|---|---|
| Git | 2.55.0 | 2.55+ | none yet | None |
| Flutter | 3.24.5 (2024-11-13) | **Current stable** | none yet | **MATERIAL** |
| Dart (via Flutter) | 3.5.4 | Bundled with recommended Flutter | none yet | **MATERIAL** |
| Dart (standalone) | 3.13.4 | Should be removed or aligned | none yet | **CONFLICT** |
| Node.js | 22.22.3 | 22 LTS | none yet | None |
| PostgreSQL | 18.4 client | 18 | none yet | None |
| Java | 21.0.11 LTS | 21 LTS | none yet | None |
| Docker | 29.7.2 | 29+ | none yet | None |

**Nothing is locked.** M0-P1 creates no `pubspec.yaml`, no `package.json`, no toolchain manifest.
Locking versions is **M1-S1** work.

### 6.4 Recommendation — Flutter toolchain must be resolved before M1 feature work

Recorded as risk **R-5** in Master Plan §42.2, severity Medium, likelihood **High**:

| Finding | Consequence |
|---|---|
| Flutter 3.24.5 dates from **2024-11-13**, more than a year before this work. | Building V1 on it means a year of missing platform fixes, and the Windows and Android toolchains it expects have moved. |
| The Dart SDK bundled with Flutter is **3.5.4**, while a standalone Dart **3.13.4** is on `PATH`. | Two Dart SDKs on one host is a live source of confusing resolution failures. Any `dart` command run outside `flutter` will use a different language version than the Flutter toolchain. |
| Visual Studio **Build Tools** is installed rather than full Visual Studio. | Flutter's Windows desktop toolchain checks for specific components. This is usually sufficient for building, but it is not verified and must be confirmed in M1-S1. |
| Android SDK has `platforms`, `build-tools`, `ndk`, and `cmake`. | Likely sufficient for an Android build; specific API levels are not verified in M0-P1. |

**Recommendation:** as part of M1-S1, and only with explicit owner authorization, upgrade Flutter to
a current stable release, pin it via FVM or an equivalent mechanism, and reconcile or remove the
conflicting standalone Dart SDK. **M0-P1 performed no upgrade**, per the authorization boundary in
§8.2.

### 6.5 PostgreSQL and Docker availability

`psql 18.4` and `docker 29.7.2` are both available, which means a CI-equivalent PostgreSQL 18
instance can be run locally for the migration-rehearsal and invariant test suites (Master Plan
§36.5) without provisioning an external service. **No container was started and no database was
created during M0-P1.**

---

## 7. M0-P1 validation evidence

Validation was repository-integrity focused, as appropriate for a planning slice. No application
tests were invented, because no application exists.

| # | Check | Method | Result |
|---|---|---|---|
| V-1 | Repository identity | `git rev-parse --show-toplevel` | `C:/dev/my-shop` — pass |
| V-2 | Baseline SHA | `git rev-parse main`, `origin/main`, `ls-remote` | All four equal `53f6aaa9…` — pass |
| V-3 | Branch ancestry | `git log`, `git merge-base` | M0-P1 commit parent is `53f6aaa9…` — pass |
| V-4 | Clean intended diff | `git status --short`, `git diff --stat` | Only the two authorized documents — pass |
| V-5 | No unintended binaries or build artifacts | `git ls-files` and file-type inspection | Markdown only; zero binaries — pass |
| V-6 | No secrets | Pattern scan of the diff for keys, tokens, passwords, connection strings | No findings — pass |
| V-7 | No `.env` committed | File listing | None — pass |
| V-8 | Documentation paths exist | `Test-Path` on both documents | Both present — pass |
| V-9 | Master Plan mandated sections | Programmatic heading check against the 43 required subjects (§9) | All 43 present — pass |
| V-10 | No accidental legacy changes | Legacy status hash re-verified after all work | Identical to the pre-work fingerprint — pass |
| V-11 | Legacy inspection remained read-only | Command audit, plus unchanged HEAD, branch, status hash, and stash count | Identical to the pre-work fingerprint — pass |
| V-12 | No unexpected executable content | Baseline had only `README.md`; M0-P1 adds only `.md` files | Pass |
| V-13 | `main` unchanged | `main` SHA re-verified after push | Still `53f6aaa9…` — pass |
| V-14 | Markdown well-formed | Heading hierarchy, table integrity, fenced-block balance | Pass |
| V-15 | Slice scope respected | File list equals the two authorized documents | Pass — see §8.3 |

---

## 8. Slice scope and non-scope preservation

### 8.1 Files changed in M0-P1

| Path | Change | Purpose |
|---|---|---|
| `docs/governance/MY_SHOP_MASTER_PLAN.md` | **Added** | The authoritative plan (§AA) |
| `docs/governance/MY_SHOP_M0_P1_FOUNDATION_DISCOVERY.md` | **Added** | This discovery and evidence record (§AF) |
| `README.md` | **Unchanged** | See §8.2 |

### 8.2 On `README.md`

The authorization permits updating `README.md` "only if needed to establish clear project identity
and safe developer entry instructions."

**Decision: not changed in M0-P1.**

Reasoning: at this moment the repository contains no code, no toolchain, and no runnable entry
point. Any developer-entry text written now would be aspirational, and Master Plan §40.4 defines
the concrete developer entry as M1-S1. Writing a README describing a structure that does not yet
exist would be exactly the vague aspirational content §AA prohibits. The plan locks the structure
in §6.2; the README follows reality at M1-S1.

### 8.3 Non-scope preservation — explicit confirmations

| Prohibited by the authorization | Confirmed |
|---|---|
| Merge the PR | **Not merged.** PR opened and left open |
| Enable auto-merge | **Not enabled** |
| Start M1 | **Not started.** No application scaffold, no schema, no module |
| Implement Flutter screens | **None.** No `apps/` directory exists |
| Implement NestJS modules | **None.** No `services/` directory exists |
| Create a production PostgreSQL schema | **None.** No Prisma schema, no migration |
| Implement auth | **None** |
| Implement sales, purchases, customers, suppliers, accounting | **None** |
| Implement biometric security | **None.** Planned in §14 only, as a decision |
| Import legacy source code wholesale | **None.** Zero files copied |
| Create speculative files | **None.** Exactly two documents created |
| Modify the legacy repository | **None.** Status hash unchanged |
| Install or upgrade global tooling | **None.** Recorded only |
| Commit secrets | **None** |
| Push to `main` | **No.** Only the feature branch was pushed |
| Create M0-P2 | **Not created.** It exists only as a roadmap line in §40.3 |

---

## 9. Mandated Master Plan section coverage

Verified programmatically against the section list mandated for `MY_SHOP_MASTER_PLAN.md`.

| # | Mandated subject | Master Plan section |
|---|---|---|
| 1 | Product vision | §1 |
| 2 | Simplicity principle | §2 |
| 3 | V1 scope | §3 |
| 4 | Explicit future scope | §4 |
| 5 | Legacy reuse policy | §5 |
| 6 | Flutter architecture direction | §6 |
| 7 | Backend architecture direction | §7 |
| 8 | PostgreSQL / Prisma strategy | §8 |
| 9 | Tenant model | §9 |
| 10 | Identity model | §10 |
| 11 | User / permission model | §11 |
| 12 | Device model | §12 |
| 13 | Security model | §13 |
| 14 | App-lock / local-auth model | §14 |
| 15 | Products / inventory | §15 |
| 16 | Pricing modes | §17 |
| 17 | Discounts | §18 |
| 18 | Sales | §16 |
| 19 | Customers | §19 |
| 20 | Receivables | §20 |
| 21 | Invoice print/save/none behaviour | §21 |
| 22 | Sales attribution | §23.1 |
| 23 | Salesperson reporting | §23.2 |
| 24 | Suppliers | §24 |
| 25 | Purchases | §25 |
| 26 | Payables | §26 |
| 27 | Financial accounts | §27 |
| 28 | Double-entry accounting | §28 |
| 29 | Chart of Accounts | §29 |
| 30 | Inventory costing | §30 |
| 31 | Journal posting / reversal rules | §31 |
| 32 | Audit | §32 |
| 33 | Reporting | §33 |
| 34 | API versioning | §34.1 |
| 35 | Validation / errors | §34.2, §34.3, §34.4 |
| 36 | Migrations | §35 |
| 37 | Test strategy | §36 |
| 38 | CI strategy | §37 |
| 39 | Connectivity model | §38 |
| 40 | Roadmap and slice boundaries | §40 |
| 41 | Explicit architectural decisions | §41 (34 ADRs) |
| 42 | Unresolved decisions / risks | §42 |
| 43 | Acceptance gates | §43 |

Additionally covered as required by the authorization: **settings** (§22), **data domain map**
(§39), and **organization settings inventory** (§22.2).

---

## 10. Publication and governance record

| Item | Value |
|---|---|
| Branch | `codex/my-shop-m0-p1-foundation-master-plan` |
| Parent commit | `53f6aaa9aded2ec2218cec3f8987675a824b70db` (the verified canonical baseline) |
| Merge mode | Worktree-isolated; `main` was never checked out for modification |
| Commit message | `docs(my-shop): establish governed foundation and master plan` |
| Push target | `origin` = `https://github.com/sabere342-ai/my-shop.git`, branch only |
| PR target | `main` |
| Merge status | **Open, not merged.** Auto-merge **not** enabled |
| `main` after publication | Unchanged at `53f6aaa9aded2ec2218cec3f8987675a824b70db` |

Exact post-push SHAs, ahead/behind counts, and PR verification are reported in the M0-P1 final
report to the owner rather than restated here, so that this document cannot drift from the
verified remote state.

---

## 11. Next authorization required

M0-P1 is complete. **No further work is authorized.** The owner must separately authorize the
next slice.

### 11.1 Decisions the owner should resolve first

These are the highest-impact open items from Master Plan §42.1, because they affect schema and
therefore cannot be deferred past M3 without a migration.

| # | Decision | Why it cannot wait |
|---|---|---|
| O-1 | Confirm currency (assumed EGP, 2 minor digits) | Determines money representation across the whole system |
| O-5 | **Confirm that online-only POS is acceptable** for V1 | The largest accepted risk (§38.4). If not acceptable, an offline slice must be planned and it changes the architecture |
| O-7 | Confirm tax/VAT is not required at launch | Determines whether documents carry tax fields in V1 |
| O-2 | Confirm `allow_negative_stock` default `false` | Affects stock mutation behaviour |
| O-4 | Confirm a customer is mandatory on credit sales | Affects the sale form's required fields |
| O-11 | Opening balances by spreadsheet import or manual entry | Affects M6 scope |

### 11.2 Recommended next slice

**M1-S1 (monorepo skeleton and pinned toolchain)**, once authorized, should additionally resolve:

1. The Flutter version divergence (§6.4, risk R-5) — **requires owner authorization to upgrade a
   global tool**, which M0-P1 did not perform.
2. The conflicting standalone Dart 3.13.4 versus Flutter's bundled Dart 3.5.4.
3. Confirmation that Visual Studio Build Tools 2026 satisfies the Flutter Windows toolchain check.

### 11.3 Explicitly not proposed

No slice beyond M1-S1 is proposed for authorization. M1-S2 onward follows only after M1-S1 is
complete and reviewed, per the predecessor rule in Master Plan §40.1.

---

*End of MY_SHOP_M0_P1_FOUNDATION_DISCOVERY.md, version 1.0.0.*
