-- Migration 0014 — the inventory core (Master Plan §15.4, §15.5, §15.6, §15.6A,
-- §38.14.1; §40.8 row M4-S2).
--
-- Three new tenant-owned tables:
--
--   inventory_locations  the place stock physically sits. V1 seeds exactly one
--                        default location per organization (plan line 203),
--                        created deterministically by the service; the partial
--                        unique index makes "one default" a database guarantee.
--   stock_movements      the §15.4 authoritative, append-only quantity history,
--                        carrying the full §38.14.1 movement identity: the
--                        movement id, the optional outbox mutation origin, the
--                        per-device ordering facts, the per-organization
--                        `server_sequence` the server assigned on acceptance
--                        (allocated from the shared `sync_sequences` counter —
--                        one per-organization acceptance order), the §15.5
--                        closed cause, the signed exact base-unit quantity
--                        delta, the cost snapshot column (NULL until M4-S3
--                        gives it a producer — no cost authority exists yet),
--                        the correction reference, and the adjustment's
--                        reason code and note.
--   stock_levels         the §15.4 derived, cacheable quantity per (variant,
--                        location) — never an authority. The service maintains
--                        it inside the movement transaction behind the §15.6
--                        conditional guard; the CHECK restates the non-negative
--                        invariant so a writer bypassing the service cannot
--                        store negative stock either.
--
-- What this migration deliberately does NOT create:
--   - `stock_counts` / `stock_count_lines` — M4-S4 owns counts (§15.8).
--   - any costing computation — the M4-S3 moving-average engine (§30) is the
--     only producer `unit_cost_minor` may ever have; the column exists so the
--     movement identity is final, and its NULL is honest (no cost authority).
--   - purchase or sale documents — M6/M5 own them; their movements will ride
--     this same table through their owning slices' writers.
--   - no change to any earlier table's columns, policies, or constraints except
--     one additive index: `product_variants` gains the unique
--     `(id, organization_id)` target the composite tenant foreign keys above
--     must reference (the products table's own pair existed from 0013; the
--     variants table's did not, because M4-S1 had no child referencing it by
--     the pair). Nothing prior is edited or rewritten (§35.1).
--   - no GRANT role change, SECURITY
--     DEFINER, BYPASSRLS, or search_path change: every name and literal below
--     is a constant, with no interpolation (§8.3, gate G-9). The application
--     role's SELECT/INSERT/UPDATE/DELETE on the two mutable tables arrives
--     through the migrator schema default privileges 0001 established.
--
-- Append-only by privilege (§32.5 class, extended to the quantity history):
-- the default privileges would hand `my_shop_app` UPDATE and DELETE on
-- `stock_movements`, which the plan forbids — the ledger must never be
-- rewritten, only corrected by reversal (§38.14.2). This migration revokes the
-- two forbidden privileges and leaves INSERT + SELECT standing, the same shape
-- migration 0010 gave the audit histories.
--
-- Quantities (§15.2, §15.6): every delta is a signed exact `bigint` in base
-- units, bounded at ±999 999 999 999 (the money wire's width, restated by the
-- service). The service additionally proves each cause's direction and bounds;
-- the CHECKs below are the last line of defence, not the only line.
--
-- Row-level security: §8.2 migration-`0008` posture extended to the four
-- tables this migration touches — `inventory_locations`, `stock_movements`,
-- `stock_levels` are new tenant tables; `sync_sequences` (M1b-S4) already
-- carries its policy. `ENABLE` + `FORCE` RLS with exactly one symmetric
-- `tenant_isolation` policy each, reading the transaction-local trusted
-- context (`app.current_organization_id`). Referential isolation is
-- structural: `stock_movements` and `stock_levels` carry composite tenant
-- foreign keys to `product_variants` and `inventory_locations`, so a movement
-- or a level cannot point at another tenant's variant or location even where
-- the RI trigger would otherwise bypass the parent's policy.

-- ---------------------------------------------------------------------------
-- 1. inventory_locations (§15.4). One default per organization — the plan's
--    "V1 seeds one default location" — and room for a later multi-location
--    decision that adds non-default rows without a second default (§ line
--    1867: internal transfers are out of V1).
-- ---------------------------------------------------------------------------
CREATE TABLE "inventory_locations" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL,
  "name" varchar(100) NOT NULL,
  "is_default" boolean NOT NULL DEFAULT false,
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY ("id"),
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "chk_inventory_location_name_bounded"
    CHECK ("name" ~ '\S.*\S|\S' AND char_length("name") <= 100)
);

COMMENT ON TABLE "inventory_locations" IS '§15.4 stock location (M4-S2); V1 seeds exactly one default per organization; forced RLS';

-- At most one default location per organization (the partial index is the
-- guarantee the service's deterministic seed relies on).
CREATE UNIQUE INDEX "inventory_locations_single_default"
  ON "inventory_locations" ("organization_id") WHERE "is_default";

CREATE INDEX "inventory_locations_organization_id_is_default_idx"
  ON "inventory_locations" ("organization_id", "is_default");

CREATE UNIQUE INDEX "inventory_locations_id_organization_id_key"
  ON "inventory_locations" ("id", "organization_id");

-- The additive unique index M4-S2's composite foreign keys need: a variant's
-- `(id, organization_id)` pair. M4-S1 created none because no M4-S1 child
-- referenced variants by the pair; this index changes no row, no policy, and
-- no existing constraint.
CREATE UNIQUE INDEX "product_variants_id_organization_id_key"
  ON "product_variants" ("id", "organization_id");

-- ---------------------------------------------------------------------------
-- 2. stock_movements (§15.4, §38.14.1). The authoritative ledger. The full
--    closed §15.5 cause vocabulary is restated by CHECK (the service admits a
--    narrower producer subset — this slice: OPENING_BALANCE and
--    MANUAL_ADJUSTMENT — because a cause needs a producing execution path, and
--    the others arrive with M5/M6/M4-S4; §32.2's discipline for event types
--    applies to causes too).
-- ---------------------------------------------------------------------------
CREATE TABLE "stock_movements" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL,
  "variant_id" uuid NOT NULL,
  "location_id" uuid NOT NULL,
  "cause" varchar(24) NOT NULL,
  "quantity_delta" bigint NOT NULL,
  "unit_cost_minor" bigint,
  "reverses_movement_id" uuid,
  "origin_mutation_id" uuid,
  "device_id" uuid,
  "device_local_sequence" bigint,
  "server_sequence" bigint NOT NULL,
  "reason_code" varchar(24),
  "reason_note" varchar(300),
  "document_ref" varchar(300),
  "occurred_at" timestamptz(6) NOT NULL,
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY ("id"),
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  -- The tenant-pinned composite foreign keys: a movement's organization and
  -- its variant's/location's organization are the same column pair, so a
  -- cross-tenant stock fact is structurally impossible.
  FOREIGN KEY ("variant_id", "organization_id") REFERENCES "product_variants"("id", "organization_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("location_id", "organization_id") REFERENCES "inventory_locations"("id", "organization_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "chk_inventory_movement_cause_vocabulary"
    CHECK ("cause" IN ('SALE', 'SALE_RETURN', 'PURCHASE_RECEIPT', 'PURCHASE_RETURN',
                       'STOCK_COUNT_ADJUSTMENT', 'MANUAL_ADJUSTMENT', 'OPENING_BALANCE',
                       'SHRINKAGE', 'TRANSFER_IN', 'TRANSFER_OUT', 'REVALUATION')),
  CONSTRAINT "chk_inventory_movement_delta_bounded"
    CHECK ("quantity_delta" BETWEEN -999999999999 AND 999999999999),
  CONSTRAINT "chk_inventory_movement_cost_bounds"
    CHECK ("unit_cost_minor" IS NULL
           OR ("unit_cost_minor" >= 0 AND "unit_cost_minor" <= 999999999999)),
  CONSTRAINT "chk_inventory_movement_reason_code_bounded"
    CHECK ("reason_code" IS NULL OR ("reason_code" ~ '\S.*\S|\S' AND char_length("reason_code") <= 24)),
  CONSTRAINT "chk_inventory_movement_reason_note_bounded"
    CHECK ("reason_note" IS NULL OR ("reason_note" ~ '\S.*\S|\S' AND char_length("reason_note") <= 300)),
  CONSTRAINT "chk_inventory_movement_document_ref_bounded"
    CHECK ("document_ref" IS NULL OR ("document_ref" ~ '\S.*\S|\S' AND char_length("document_ref") <= 300)),
  -- The §38.14.1 identity invariants a database can prove without subqueries:
  -- a movement carries a non-negative server sequence, and its cause/delta
  -- direction agreement for the two server-only-opening shapes this slice
  -- produces (an opening balance and a revaluation are non-negative facts —
  -- stock cannot open negative).
  CONSTRAINT "chk_inventory_movement_server_sequence_non_negative"
    CHECK ("server_sequence" >= 0),
  CONSTRAINT "chk_inventory_movement_opening_direction"
    CHECK ("cause" <> 'OPENING_BALANCE' OR "quantity_delta" > 0),
  CONSTRAINT "chk_inventory_movement_opening_single"
    CHECK ("cause" <> 'OPENING_BALANCE'
           OR ("origin_mutation_id" IS NULL AND "device_id" IS NULL AND "device_local_sequence" IS NULL))
);

COMMENT ON TABLE "stock_movements" IS '§15.4/§38.14.1 authoritative append-only stock ledger (M4-S2); forced RLS; INSERT+SELECT only for the app role';

CREATE INDEX "stock_movements_organization_id_variant_created_idx"
  ON "stock_movements" ("organization_id", "variant_id", "created_at");

CREATE INDEX "stock_movements_organization_id_location_created_idx"
  ON "stock_movements" ("organization_id", "location_id", "created_at");

-- The §38.14.1 one-per-mutation outbox origin: a replay of the same mutation
-- cannot produce a second movement, by database fact.
CREATE UNIQUE INDEX "stock_movements_organization_origin_mutation_key"
  ON "stock_movements" ("organization_id", "origin_mutation_id") WHERE "origin_mutation_id" IS NOT NULL;

-- The one opening balance per (variant, location): a second one is a business
-- contradiction the database refuses.
CREATE UNIQUE INDEX "stock_movements_opening_balance_once"
  ON "stock_movements" ("organization_id", "variant_id", "location_id") WHERE "cause" = 'OPENING_BALANCE';

-- The §38.14.1 per-organization acceptance order, unique within the tenant.
CREATE UNIQUE INDEX "stock_movements_organization_server_sequence_key"
  ON "stock_movements" ("organization_id", "server_sequence");

CREATE UNIQUE INDEX "stock_movements_id_organization_id_key"
  ON "stock_movements" ("id", "organization_id");

-- The correction partner FK arrives after its target's unique pair exists
-- (§38.14.2: resolution is a new movement referencing the one it corrects, in
-- the same organization).
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_reverses_movement_id_organization_id_fkey"
  FOREIGN KEY ("reverses_movement_id", "organization_id")
  REFERENCES "stock_movements"("id", "organization_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. stock_levels (§15.4). The derived, cacheable quantity. Exactly one row
--    per (variant, location) per organization; the non-negative CHECK is the
--    §15.6 guard's database backstop.
-- ---------------------------------------------------------------------------
CREATE TABLE "stock_levels" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL,
  "variant_id" uuid NOT NULL,
  "location_id" uuid NOT NULL,
  "quantity" bigint NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY ("id"),
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("variant_id", "organization_id") REFERENCES "product_variants"("id", "organization_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("location_id", "organization_id") REFERENCES "inventory_locations"("id", "organization_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "chk_inventory_level_non_negative" CHECK ("quantity" >= 0),
  CONSTRAINT "chk_inventory_level_version_positive" CHECK ("version" >= 1),
  CONSTRAINT "product_stock_levels_identity_key" UNIQUE ("organization_id", "variant_id", "location_id")
);

COMMENT ON TABLE "stock_levels" IS '§15.4 derived cacheable stock quantity per (variant, location) (M4-S2); non-negative; forced RLS';

CREATE INDEX "stock_levels_organization_id_location_idx"
  ON "stock_levels" ("organization_id", "location_id");

CREATE UNIQUE INDEX "stock_levels_id_organization_id_key"
  ON "stock_levels" ("id", "organization_id");

-- ---------------------------------------------------------------------------
-- 4. Append-only by privilege for the movement history (§32.5 class, the one
--    grant-shaped statement of the slice). Every other new table keeps the
--    default-privileges grants.
-- ---------------------------------------------------------------------------
REVOKE UPDATE, DELETE ON TABLE "stock_movements" FROM my_shop_app;

-- ---------------------------------------------------------------------------
-- 5. Row-level security: migration 0008's posture extended to the three new
--    tables. Symmetric USING / WITH CHECK on the tenant column; the trusted
--    transaction context (`app.current_organization_id`) is the only key that
--    opens them.
-- ---------------------------------------------------------------------------
ALTER TABLE "inventory_locations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_locations" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "inventory_locations"
  FOR ALL
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_movements" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "stock_movements"
  FOR ALL
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

ALTER TABLE "stock_levels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_levels" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "stock_levels"
  FOR ALL
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- No GRANT for `my_shop_app` appears here: the migrator's default privileges
-- (0001/roles.sql) grant the new tables' SELECT/INSERT/UPDATE/DELETE
-- automatically (stock_movements explicitly refitted to INSERT + SELECT
-- above), the same posture every earlier tenant table holds.
