# My Shop

**Arabic-first point-of-sale and back-office system for a small independent retail business.**

Simple outside, rigorous inside. The shop owner and the salesperson ring up a sale, take
payment, and move on. Underneath, My Shop maintains a double-entry ledger, immutable
transaction snapshots, and full attribution for every action that moves money or stock.

**The authoritative product and architecture plan is
[`docs/governance/MY_SHOP_MASTER_PLAN.md`](docs/governance/MY_SHOP_MASTER_PLAN.md).**
Where the code and that document disagree, the document wins and the code is the defect.

## Current state

| Phase | Slice | State |
|---|---|---|
| M0 | P1 — Foundation, discovery, master plan | complete, PR open |
| M0 | P2 — Offline-capable POS architecture amendment | complete, PR open |
| M1 | **S1 — Monorepo skeleton and pinned toolchain** | **in progress on this branch** |
| M1 | S2–S6 | not started |

Nothing is deployed. Nothing is released. No PR has been merged — Master Plan gate G-12
and CI gate G-4 require an explicit, separate owner authorization to merge, and there is
no automated merge in this repository.

## The offline requirement

My Shop is an **offline-capable POS**. Selling must not stop when the Internet does.

The cashier never sees a sync engine, a queue, or a conflict class. A sale is durable
**locally, before the success indicator**, in one atomic local transaction, and converges on
the server when connectivity returns. What this buys, and what it honestly does not, is
stated in Master Plan §38 rather than in marketing language:

- Guaranteed per device: no overselling beyond what the device knows it has.
- Guaranteed eventually: convergence, with divergence recorded and attributed.
- **Not** guaranteed: real-time global inventory certainty while two or more devices are
  disconnected. No system provides that without central coordination.

The largest remaining risks are **offline divergence (R-13)** and **bounded stale
authorization (R-14, R-15)** — both consequences of a decision the owner made deliberately,
and both bounded rather than eliminated.

## Hard rule: no negative stock sales

```
AVAILABLE_QTY >= SALE_QTY
```

There is **no bypass at any permission level in V1**: no warning-only sale, no hidden
manager override, no automatic override, no negative-stock setting, no silent correction.
When stock is short the sale is refused. Goods that are present but recorded as zero are
corrected by a separate, permissioned, reason-coded, audited stock adjustment — never by
forcing the sale. Master Plan §38.4, §38.5, ADR-035.

## Repository layout

Locked in by Master Plan §6.2.

```
apps/
  desktop/                Flutter client — one codebase for Windows and Android
    lib/
      app/                 bootstrap, router, theme wiring, DI root
      core/                api, auth, barcode, money, models, settings, ui, offline/...
      features/            one folder per bounded feature: data / domain / presentation
services/
  api/                    NestJS backend — the sole authority for business invariants
packages/
  contracts/              generated API contract types, single source of truth
  testkit/                shared fixtures and builders
docs/
  governance/             the master plan and slice records
  adr/                    architecture decision records
tool/                     pinned-SDK selection and toolchain verification
```

## Getting started

The toolchain is pinned in `.tool-versions` and verified by a guard. **Do not rely on
whatever happens to be on `PATH`** — Master Plan R-5 records that a Flutter SDK over a year
stale was found there.

```bash
npm run toolchain:verify     # node, dart, flutter all match the pin
npm run verify               # toolchain + format + lint + typecheck + tests

./tool/flutterw doctor       # the pinned Flutter SDK
./tool/flutterw analyze --fatal-infos
./tool/flutterw test

npm run typecheck            # every TypeScript workspace
npm run test                 # Jest across every workspace
npm run build                # composite build in dependency order
```

Secrets live in the environment. Only `.env.example`, which contains placeholders, is
committed (Master Plan §13.6, §42.6).

## Governance

| Document | Purpose |
|---|---|
| [`docs/governance/MY_SHOP_MASTER_PLAN.md`](docs/governance/MY_SHOP_MASTER_PLAN.md) | The authority. 43 sections, roadmap in §40, acceptance gates in §43 |
| [`docs/adr/README.md`](docs/adr/README.md) | Architecture decision records |
| `docs/governance/MY_SHOP_*_SLICE_RECORD.md` | One record per slice: scope, non-scope, allow-list, tests, acceptance, rollback |
| [`docs/governance/MY_SHOP_M0_P1_FOUNDATION_DISCOVERY.md`](docs/governance/MY_SHOP_M0_P1_FOUNDATION_DISCOVERY.md) | Read-only legacy analysis. Evidence and reference, **not** a source to copy from |

Each slice is separately authorized (§40.1). A slice declares its `predecessor`, `scope`,
`non_scope`, `allowed_paths`, `tests`, `acceptance_criteria`, `migration_impact`,
`security_impact`, `rollback`, and `publication_gate` **before** any file is touched.

## Legacy code

Master Plan §5.1: **no file, directory, module, or git history is copied** from the legacy
application. Concepts may be re-derived where the implementation is sound and portable;
where tenancy, accounting integrity, or maintainability would suffer, reimplementation is
mandatory. Each reimplemented concept cites a discovery finding. The legacy sync subsystem
is **REIMPLEMENTED in full** (ADR-039) — it was built and shipped with its drain disabled,
paying the full complexity cost and never using it.