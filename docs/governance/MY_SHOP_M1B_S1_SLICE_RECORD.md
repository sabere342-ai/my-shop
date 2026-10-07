# MY SHOP — M1b-S1 SLICE RECORD: LOCAL PERSISTENCE FOUNDATION

**Master plan:** docs/governance/MY_SHOP_MASTER_PLAN.md v1.1.0 — §40.5 (M1b-S1), §38.6–§38.7.2, ADR-036, ADR-039
**Slice:** M1b-S1
**Branch:** codex/my-shop-m1b-s1-local-persistence
**Parent SHA:** 3836ac7 (M1-S6)
**Final SHA:** bbf669e
**Declaration status:** PASS_MY_SHOP_M1B_S1_DECLARATION_READY (reconciled per owner instructions)
**Owner clarification:** M1 ends at M1-S6; M1b-S1 is canonical successor; no M1-S7 exists.

## 1. Reconciliation (per instructions)

### A. Business entity scope
- Canonical non-scope: 'Any business entity' (Master Plan §40.5).
- Infrastructure-only. Created structural tables limited to platform/local-meta only (local_meta); no business entity tables (sales/stock/customers etc.). No business workflows/logic/services/UI introduced. Schema limited to persistence foundation per §38.6.

### B. Dependencies / allowlist
- Drift deps added to pps/desktop/pubspec.yaml (drift, sqlite3_flutter_libs, path_provider, path; dev drift_dev) as required. Allowlist includes pps/desktop/pubspec.yaml, pps/desktop/pubspec.lock, generated plugin files. No unrelated upgrades.

### C. SQLite pragma semantics
- Pragmas set at connection/database level in AppDatabase._openConnection() via NativeDatabase.setup: PRAGMA foreign_keys = ON, PRAGMA journal_mode = WAL, PRAGMA synchronous = FULL. Applied at DB connection level (not per-table). Durability invariant per §38.6.

### D. Post-slice boundary
- Corrected boundary: M1b-S2 NOT AUTHORIZED (next is M1b-S2, §40.5). No M1-S7/M1-S8 artifact.

## 2. Scope implemented
- Drift foundation for offline subsystem (infrastructure only). local_meta table with local_schema_version = 1. Versioning via schemaVersion. Forward-only migration strategy (onCreate creates all). Infrastructure code only; no business entities.

## 3. Evidence
- Branch: codex/my-shop-m1b-s1-local-persistence (parent 3836ac7)
- Commit: bbf669e
- Changed files: apps/desktop/lib/core/offline/db/app_database.dart, apps/desktop/lib/core/offline/db/local_meta.drift, apps/desktop/pubspec.lock, apps/desktop/pubspec.yaml, apps/desktop/windows/flutter/generated_plugin_registrant.cc, apps/desktop/windows/flutter/generated_plugins.cmake
- Local/remote: in sync (0/0). Worktree clean post-commit.
- PR: created targeting base codex/my-shop-m1-s6-contract-generation (stacked on M1-S6). Not merged.

## 4. Constraints satisfied
- Parent SHA verified (3836ac7). origin/main untouched. PR #6 remains open/unmerged.
- No business entity implementation. Infrastructure only.
- Pragmas at connection level. Boundary corrected to M1b-S2 NOT AUTHORIZED.

PASS_MY_SHOP_M1B_S1_LOCAL_PERSISTENCE_REMOTE_LOCKED
