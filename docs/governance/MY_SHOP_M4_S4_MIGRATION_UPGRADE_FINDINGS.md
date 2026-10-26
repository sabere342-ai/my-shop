# M4-S4 migration upgrade findings — `0015_inventory_costing` on a pre-costing database

Status: **delivered** (empirically proven on real PostgreSQL 18 databases this slice; every claim below is an observed exit code, not an inference).

## 1. Why this exists

M4-S3 shipped migration `0015_inventory_costing` with `chk_inventory_level_cost_with_stock` — the CHECK that says a `stock_levels` row may hold stock without a cost basis **only at quantity zero**. Every database this repository had ever upgraded before that migration was an *M4-S2-shaped* database: a database that could legally hold positive stock with `average_cost_minor IS NULL`. The question this slice had to answer before M4-S4 could safely assume a deployable fleet:

> **What actually happens when 0015 meets such a database — and what is the sanctioned recovery?**

The answer is scripted, repeatable, and non-destructive: `scripts/migration-upgrade-probe.mjs` (scenarios A–G) and `scripts/migration-upgrade-remediate.mjs` (the recovery). Both run against disposable, clearly-named scratch databases; neither touches `my_shop_test` or any dev database of a live slice.

## 2. The proven verdicts (scenarios A–G, all PASS, probe exit 0)

| Scenario | Verdict |
| --- | --- |
| **A — clean install** | PASS. An empty database takes the whole chain `0001 → 0016` without intervention; 0015 has no requirement on pre-existing data when there is none. |
| **B — the upgrade BLOCKER, reproduced** | PASS (reproduced honestly). An M4-S2-shaped database — positive quantity, no basis — **refuses 0015** at `0015_inventory_costing.sql:68`: `check constraint "chk_inventory_level_cost_with_stock" is violated by some row`. Because the deployer is transactional, the refusal rolls the whole migration back: the database is left at the **exact 0014 shape** (no column, no CHECKs, no index), every pre-existing row untouched. The failure is loud, atomic, and lossless. |
| **C — zero-quantity levels upgrade safely** | PASS. A level with `quantity = 0` and a NULL basis satisfies the CHECK by design; it survives 0015 with an honest NULL, exactly the §30.1 "uncosted at zero" state. |
| **D — multi-tenant remediation is per-tenant and isolated** | PASS. With two tenants each holding unbased positive stock, remediation backfills **each tenant from its own movement ledger only** (tenant A's proposal is never tenant B's snapshot); every write re-asserts identity, tenant, `quantity > 0`, and basis-NULL in the same UPDATE. RLS isolation holds throughout — proven on the real policy set. |
| **E/F — an unknown historical cost refuses the WHOLE apply** | PASS. When a positive-quantity unbased level has **no** movement-recorded cost to propose (provenance-only or unknown), remediation refuses **everything**: exit 1, the database stays at the failed-upgrade shape, and a re-run of 0015 refuses as before. A cost is never fabricated, never defaulted to zero. |
| **G — remediation completes 0015's own artifacts** | PASS. On an approved plan, remediation creates exactly what 0015 would have: the `average_cost_minor` column, its comment, the two CHECKs, and the index — each **existence-guarded** (a partially-applied state converges), inside **one transaction**, idempotent across re-runs. The chain then continues without ever replaying the 0015 file. |

## 3. The sanctioned recovery procedure (operator contract)

1. A production deploy of 0015 fails (scenario B). **Do nothing reactive** — the transactional rollback has already restored the 0014 shape whole.
2. Run `node scripts/migration-upgrade-remediate.mjs` with the **admin-plane** connection (`ADMIN_DATABASE_URL`). The admin plane is mandatory: `stock_levels` is `FORCE ROW LEVEL SECURITY`, so even the non-bypass `my_shop_migrator` role sees nothing across tenants — remediation reads and writes as the table owner with tenant-by-tenant context handling of its own.
3. Remediation either (a) refuses whole with exit 1 because some level's historical cost is unknowable — the operator must then decide the costing question *as data* (this is a business decision, not a migration concern), or (b) applies 0015's own artifacts idempotently and exits 0.
4. **Bookkeeping, by the operator, never by the script:** `npx prisma migrate resolve --applied 0015_inventory_costing`, then continue the deploy chain. The migration is marked resolved because remediation — not the migration file — performed its work.
5. **Never replay the 0015 file.** Unguarded replay cannot converge: it would re-apply non-idempotent statements against artifacts that already exist. The remediation's existence guards are what make recovery convergent; the migration file itself is forward-only, exactly as the M4-S2 immutability gate demands.

## 4. Standing laws recorded for every future costing-bearing migration

1. **A CHECK on pre-existing data is an upgrade-safety question, not just a correctness question.** 0015's CHECK is *correct* for all data the service can produce after M4-S3 and *unsafe* for data produced before it. Both facts are true; the probe proves both.
2. **Nothing in a later migration can fix an earlier one's failure.** 0016 is not involved in 0015 recovery — a failed 0015 leaves the database at 0014 shape, and any 0016+ artifact assumes 0015 applied. Recovery must complete the failed migration's own artifacts (or roll back the release).
3. **FORCE RLS makes the application plane unusable for cross-tenant remediation — by design.** The admin plane (`ADMIN_DATABASE_URL`) is the only sanctioned writer for tenant-spanning backfills; it is never the API's connection and its URL is never printed or logged.
4. **The refusal ordering is: unknown cost → refuse whole.** A partial backfill that leaves some rows unbased would simply re-trip the same CHECK on the next upgrade attempt, with less information available. All-or-nothing is the only honest shape.
5. **Scratch databases are disposable; evidence is not.** Every probe run creates, uses, and drops its own `my_shop_m4s4_*` database — the probe suite is safe to re-run forever, which is what makes its verdicts re-provable rather than anecdotal.
