-- Migration 0015 — the §30 moving-average costing column (§40.8 row M4-S3).
--
-- M4-S2 deliberately left every financial member of the inventory absent (`status`
-- comment, migration 0014): `stock_movements.unit_cost_minor` existed as the final
-- movement identity's NULL placeholder — "M4-S3's moving-average engine (§30.2) is
-- the only producer" — and `stock_levels` carried quantity only, because no cost
-- authority existed yet. This migration gives the derived level its one financial
-- member: the **perpetual moving weighted average** the plan fixes as V1's costing
-- method (§30.2, ADR register row ADR-017 analog).
--
--   `stock_levels.average_cost_minor`  the moving average cost per base unit, in
--                                      integer minor units (§30.1), maintained
--                                      by the costing engine inside the movement
--                                      transaction by the §30.3 formula. NULL is
--                                      an honest state: no cost basis has ever
--                                      been recorded for this stock (no costing
--                                      movement has ever carried a cost). It is
--                                      never zero by fabrication — a zero average
--                                      arrives only from zero-cost receipts the
--                                      caller explicitly offered.
--
-- What this migration deliberately does NOT create:
--   - no new table. §30.2's storage decision is "average_cost_minor per (product,
--     location)" and the derived level row *is* the (variant, location) record the
--     quantity engine already maintains behind the same row lock the costing fold
--     serializes on. One row, one average, one transaction — no second ledger that
--     could disagree with the accepted one (plan §15.4: the level is the cache).
--   - no change to `stock_movements`. Its `unit_cost_minor` column is the §30.2
--     "cost used, snapshotted" member, already bounded by
--     `chk_inventory_movement_cost_bounds`; M4-S3's producer starts filling it and
--     no column change is needed.
--   - no change to any earlier migration, policy, grant, or constraint beyond the
--     two additive CHECKs below: RLS posture, privileges, and identities are
--     exactly migration 0014's. The application role's default privileges cover
--     the new column of a table it already holds SELECT/UPDATE on (stock_levels,
--     unlike stock_movements, is mutable — the derived cache the service folds).
--
-- The CHECKs restate the costing invariants last-line-of-defence style (M4-S2's
-- discipline), so even a writer bypassing the service cannot store cost state the
-- engine's own rules refuse:
--
--   chk_inventory_level_cost_bounds     the average is within the same bounded
--                                       12-digit minor-unit width every money
--                                       member of the plan carries (§30.1), or
--                                       NULL.
--   chk_inventory_level_cost_with_stock the pair invariant: quantity above zero
--                                       and no average is a state the engine
--                                       refuses to produce — every engine path
--                                       that creates stock (§30.3 receipts, the
--                                       cost-bearing adjustment) records a cost
--                                       basis in the same transaction. A level
--                                       may carry the *stale* average of stock
--                                       that fully left (quantity 0, §30.4 keeps
--                                       the last average), but never uncosted
--                                       stock.

ALTER TABLE "stock_levels" ADD COLUMN "average_cost_minor" bigint;

COMMENT ON COLUMN "stock_levels"."average_cost_minor" IS 'A30.2 perpetual moving weighted average per base unit, minor units (M4-S3); NULL until a costing movement records a basis';

ALTER TABLE "stock_levels"
  ADD CONSTRAINT "chk_inventory_level_cost_bounds"
  CHECK ("average_cost_minor" IS NULL
         OR ("average_cost_minor" >= 0 AND "average_cost_minor" <= 999999999999));

ALTER TABLE "stock_levels"
  ADD CONSTRAINT "chk_inventory_level_cost_with_stock"
  CHECK ("quantity" = 0 OR "average_cost_minor" IS NOT NULL);

-- `catalog.cost.edit`-gated reads (M4-S3's valuation surface) answer one level
-- per (variant, location) plus org-wide aggregates; the scan is by organization.
CREATE INDEX "stock_levels_organization_id_variant_idx"
  ON "stock_levels" ("organization_id", "variant_id");
