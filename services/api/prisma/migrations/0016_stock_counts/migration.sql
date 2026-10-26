-- M4-S4 (Master Plan §15.8, §30.5, §32.2A; §40.8 row M4-S4): the stock-count
-- documents and their lines.
--
-- Posture, identical to migrations 0014/0015 (the accepted predecessor shape a
-- later migration must not deviate from):
--
-- - Tables, columns, and the identities Prisma *can* model are declared in
--   schema.prisma too (`StockCount`, `StockCountLine`); the CHECKs, the partial
--   indexes, the RLS policies, the transition triggers, and the grant refits
--   below are **migration-only** (Prisma shapes none of them, and `migrate diff`
--   compares the un-predicated halves — the drift gate stays exact).
-- - Forward-only, additive. Nothing here rewrites 0001–0015.
--
-- The lifecycle is the §15.8 smallest coherent one: OPEN → POSTED, and
-- OPEN → CANCELLED for an abandoned count. A POSTED count is closed history:
-- its lines are immutable (trigger `stock_count_lines_posted_immutable`), its
-- status can only leave again as the very last resort of an operator decision —
-- nothing here allows one, and the movement pipeline keeps every written
-- quantity fact append-only (§38.14.2: a correction is a new attributed
-- movement, never an edit).
--
-- Every child row is tenant-pinned through the composite foreign keys the
-- 0014/0013 movers already added (`(id, organization_id)` on
-- `inventory_locations`, `product_variants`, `stock_movements`), so a count of
-- another tenant's location, variant, or movement is structurally impossible,
-- not merely forbidden.

-- ---------------------------------------------------------------------------
-- stock_counts
-- ---------------------------------------------------------------------------

CREATE TABLE "stock_counts" (
  "id" uuid NOT NULL DEFAULT "gen_random_uuid"(),
  "organization_id" uuid NOT NULL,
  "location_id" uuid NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'OPEN',
  "actor_user_id" uuid NOT NULL,
  -- The §15.8 document carries the operator's own words; the machine reason
  -- vocabulary stays on the adjustment movements the posting produces.
  "note" varchar(300),
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "posted_at" timestamptz(6),
  "posted_actor_user_id" uuid,
  "cancelled_at" timestamptz(6),
  "cancelled_actor_user_id" uuid,
  CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
) ;

-- The closed lifecycle vocabulary, restated by the service and the trigger.
ALTER TABLE "stock_counts"
  ADD CONSTRAINT "chk_stock_count_status"
  CHECK ("status" IN ('OPEN', 'POSTED', 'CANCELLED'));

-- Posting facts travel together with the POSTED status (and never otherwise).
ALTER TABLE "stock_counts"
  ADD CONSTRAINT "chk_stock_count_posted_shape"
  CHECK (
    ("status" = 'POSTED'
      AND "posted_at" IS NOT NULL
      AND "posted_actor_user_id" IS NOT NULL
      AND "cancelled_at" IS NULL
      AND "cancelled_actor_user_id" IS NULL)
    OR ("status" = 'CANCELLED'
      AND "cancelled_at" IS NOT NULL
      AND "cancelled_actor_user_id" IS NOT NULL
      AND "posted_at" IS NULL
      AND "posted_actor_user_id" IS NULL)
    OR ("status" = 'OPEN'
      AND "posted_at" IS NULL
      AND "posted_actor_user_id" IS NULL
      AND "cancelled_at" IS NULL
      AND "cancelled_actor_user_id" IS NULL)
  );

ALTER TABLE "stock_counts"
  ADD CONSTRAINT "chk_stock_count_note_bounded"
  CHECK ("note" IS NULL OR ("note" ~ '\S.*\S|\S' AND char_length("note") <= 300));

ALTER TABLE "stock_counts"
  ADD CONSTRAINT "stock_counts_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- The composite tenant foreign key: a count line's location is a location
-- *of this organization*, structurally (the same shape stock_movements got).
ALTER TABLE "stock_counts"
  ADD CONSTRAINT "stock_counts_location_id_organization_id_fkey"
  FOREIGN KEY ("location_id", "organization_id")
  REFERENCES "inventory_locations" ("id", "organization_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Per-tenant identity and the deterministic list order the read face answers.
CREATE UNIQUE INDEX "stock_counts_id_organization_id_key"
  ON "stock_counts" ("id", "organization_id");
CREATE INDEX "stock_counts_organization_location_created_idx"
  ON "stock_counts" ("organization_id", "location_id", "created_at");

-- ---------------------------------------------------------------------------
-- stock_count_lines
-- ---------------------------------------------------------------------------

CREATE TABLE "stock_count_lines" (
  "id" uuid NOT NULL DEFAULT "gen_random_uuid"(),
  "organization_id" uuid NOT NULL,
  "count_id" uuid NOT NULL,
  "variant_id" uuid NOT NULL,
  -- The physically observed quantity: zero is a real observation (the shelf is
  -- empty), never a stand-in for "not counted" — an omitted variant simply has
  -- no line, and an omitted line is never interpreted as zero (§15.8).
  "counted_quantity" bigint NOT NULL,
  -- The system quantity captured when the line was recorded — the snapshot the
  -- operator's variance preview was computed from. The *posting* re-verifies
  -- against the locked authoritative level (§15.6), so this column is the
  -- honest record of what the count saw, never the quantity the fold used.
  "expected_quantity" bigint NOT NULL,
  -- The per-line reason code (the O-14 mandatory-reason rule; the count
  -- posting's movements carry it verbatim). NULL before the operator has
  -- chosen; a posting without one anywhere on a differing line is refused.
  "reason_code" varchar(24),
  -- Optional cost basis: only a quantity *increase* on stock with no
  -- authoritative basis may still be posted, and only by an operator holding
  -- the costing authority — the offer is stored, never implied (§30.1: 0 is a
  -- real fact only when offered explicitly).
  "unit_cost_minor" bigint,
  "recorded_at" timestamptz(6) NOT NULL,
  "recorded_by" uuid NOT NULL,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- The posting's result (§15.8): one authoritative movement per differing
  -- line, attached at post time. NULL for a line that matched the system
  -- (delta zero) or a not-yet-posted count.
  "movement_id" uuid,
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id")
) ;

-- A counted quantity is a physical fact: non-negative and inside the same
-- 12-digit magnitude every other inventory quantity carries.
ALTER TABLE "stock_count_lines"
  ADD CONSTRAINT "chk_stock_count_line_counted_bounds"
  CHECK ("counted_quantity" >= 0 AND "counted_quantity" <= 999999999999);

ALTER TABLE "stock_count_lines"
  ADD CONSTRAINT "chk_stock_count_line_expected_bounds"
  CHECK ("expected_quantity" >= 0 AND "expected_quantity" <= 999999999999);

-- The optional cost offer obeys the 0014 movement-cost shape exactly.
ALTER TABLE "stock_count_lines"
  ADD CONSTRAINT "chk_stock_count_line_cost_bounds"
  CHECK ("unit_cost_minor" IS NULL OR ("unit_cost_minor" >= 0 AND "unit_cost_minor" <= 999999999999));

-- A cost offer belongs only to the case that needs one: an increase on stock
-- whose authoritative basis is unknown. A *deduction* never carries a cost (the
-- engine consumes at the current §30.2 average), and the reason vocabulary is
-- the §38.5 closed one.
ALTER TABLE "stock_count_lines"
  ADD CONSTRAINT "chk_stock_count_line_reason_code_vocabulary"
  CHECK ("reason_code" IN ('DAMAGED', 'EXPIRED', 'LOST', 'MISCOUNT', 'RESTOCK', 'OTHER'));

ALTER TABLE "stock_count_lines"
  ADD CONSTRAINT "stock_count_lines_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_count_lines"
  ADD CONSTRAINT "stock_count_lines_count_id_organization_id_fkey"
  FOREIGN KEY ("count_id", "organization_id")
  REFERENCES "stock_counts" ("id", "organization_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_count_lines"
  ADD CONSTRAINT "stock_count_lines_variant_id_organization_id_fkey"
  FOREIGN KEY ("variant_id", "organization_id")
  REFERENCES "product_variants" ("id", "organization_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- The posting result is a movement of this tenant, structurally — a reversal
-- or cross-tenant adaptation of M6/M5 cannot hang a count off a foreign row.
ALTER TABLE "stock_count_lines"
  ADD CONSTRAINT "stock_count_lines_movement_id_organization_id_fkey"
  FOREIGN KEY ("movement_id", "organization_id")
  REFERENCES "stock_movements" ("id", "organization_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Exactly one line per variant per count: a repeated scan is an *edit* of the
-- same observation (§15.8), never a second row.
CREATE UNIQUE INDEX "stock_count_lines_count_variant_key"
  ON "stock_count_lines" ("organization_id", "count_id", "variant_id");

-- One movement per count line, ever (a second post of the same count tries to
-- attach a second movement to the same line and is refused by the database
-- itself — the service never gets that far, because the count status is
-- already POSTED; this unique is the structural backstop). Modelable by the
-- schema (`StockCountLine`'s unique on the same pair, nullable members: the
-- NULL rows are distinct duplicates the moving-null law admits by pairwise
-- comparison), so it is declared a plain unique here, not a partial index.
CREATE UNIQUE INDEX "stock_count_lines_movement_id_organization_key"
  ON "stock_count_lines" ("movement_id", "organization_id");

CREATE UNIQUE INDEX "stock_count_lines_id_organization_id_key"
  ON "stock_count_lines" ("id", "organization_id");
CREATE INDEX "stock_count_lines_organization_count_idx"
  ON "stock_count_lines" ("organization_id", "count_id");

-- ---------------------------------------------------------------------------
-- Row-level security: the exact 0014 shape on both new tables.
-- ---------------------------------------------------------------------------

ALTER TABLE "stock_counts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_counts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "stock_counts" AS PERMISSIVE FOR ALL
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

ALTER TABLE "stock_count_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_count_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "stock_count_lines" AS PERMISSIVE FOR ALL
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Lifecycle discipline (migration-only triggers — Prisma shapes no trigger).
-- ---------------------------------------------------------------------------

-- 1. A posted or cancelled count is closed history: the status, posting facts
--    and note can never change again, and the valid first transitions are
--    OPEN → POSTED / OPEN → CANCELLED with their attribution facts set. The
--    appended audit trail and the movement attachment are the only sanctioned
--    transitions' companions, all inside the posting transaction.
CREATE OR REPLACE FUNCTION "enforce_stock_count_transition"() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'POSTED' OR OLD."status" = 'CANCELLED' THEN
    IF NEW."status" <> OLD."status" OR NEW."note" IS DISTINCT FROM OLD."note"
       OR NEW."location_id" IS DISTINCT FROM OLD."location_id"
       OR NEW."actor_user_id" IS DISTINCT FROM OLD."actor_user_id"
       OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
       OR NEW."posted_at" IS DISTINCT FROM OLD."posted_at"
       OR NEW."posted_actor_user_id" IS DISTINCT FROM OLD."posted_actor_user_id"
       OR NEW."cancelled_at" IS DISTINCT FROM OLD."cancelled_at"
       OR NEW."cancelled_actor_user_id" IS DISTINCT FROM OLD."cancelled_actor_user_id" THEN
      RAISE EXCEPTION 'stock count % is % and is immutable', NEW."id", OLD."status";
    END IF;
  END IF;
  IF OLD."status" = 'OPEN' AND NEW."status" = 'POSTED' THEN
    IF NEW."posted_at" IS NULL OR NEW."posted_actor_user_id" IS NULL THEN
      RAISE EXCEPTION 'a stock count posting must carry its posting facts';
    END IF;
  END IF;
  IF OLD."status" = 'OPEN' AND NEW."status" = 'CANCELLED' THEN
    IF NEW."cancelled_at" IS NULL OR NEW."cancelled_actor_user_id" IS NULL THEN
      RAISE EXCEPTION 'a stock count cancellation must carry its attribution facts';
    END IF;
  END IF;
  IF OLD."status" = 'OPEN' AND NEW."status" = 'OPEN' THEN
    IF NEW."location_id" IS DISTINCT FROM OLD."location_id"
       OR NEW."actor_user_id" IS DISTINCT FROM OLD."actor_user_id"
       OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'an open stock count carries a stable identity';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "stock_counts_transition_guard"
  BEFORE UPDATE ON "stock_counts"
  FOR EACH ROW
  EXECUTE FUNCTION "enforce_stock_count_transition"();

-- 2. Lines are written only while their count is OPEN — a recording write of
--    any kind (a first record, a re-record, or the posting transaction's
--    movement attachment, which runs while the count row still says OPEN in
--    the same window) is refused against a POSTED/CANCELLED count. A posted
--    count's observations are therefore closed history, with the same force
--    the movement ledger's append-only grant carries (§15.8).
CREATE OR REPLACE FUNCTION "enforce_stock_count_line_identity"() RETURNS trigger AS $$
DECLARE
  parent_status varchar;
BEGIN
  SELECT "status" INTO parent_status FROM "stock_counts"
    WHERE "id" = NEW."count_id" AND "organization_id" = NEW."organization_id";
  IF parent_status IS DISTINCT FROM 'OPEN' THEN
    RAISE EXCEPTION 'a stock count line can be written only while the count is OPEN';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."variant_id" IS DISTINCT FROM OLD."variant_id"
       OR NEW."count_id" IS DISTINCT FROM OLD."count_id" THEN
      RAISE EXCEPTION 'a recorded stock count line keeps its identity';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "stock_count_lines_immutable_when_closed"
  BEFORE INSERT OR UPDATE ON "stock_count_lines"
  FOR EACH ROW
  EXECUTE FUNCTION "enforce_stock_count_line_identity"();

-- 3. Lines of an OPEN count can be removed (an operator retracts a wrong
--    observation); lines of a POSTED count's movement attachment are the
--    committed history and can never be deleted.
CREATE OR REPLACE FUNCTION "enforce_stock_count_line_deletion"() RETURNS trigger AS $$
DECLARE
  parent_status varchar;
BEGIN
  SELECT "status" INTO parent_status FROM "stock_counts"
    WHERE "id" = OLD."count_id" AND "organization_id" = OLD."organization_id";
  IF parent_status IS DISTINCT FROM 'OPEN' THEN
    RAISE EXCEPTION 'a stock count line of a closed count cannot be deleted';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "stock_count_lines_delete_guard"
  BEFORE DELETE ON "stock_count_lines"
  FOR EACH ROW
  EXECUTE FUNCTION "enforce_stock_count_line_deletion"();

-- ---------------------------------------------------------------------------
-- Appendix: the truth of the append-only discipline on stock_movements is
-- unchanged (0014's REVOKE UPDATE, DELETE ON stock_movements FROM my_shop_app
-- stays verbatim-effective); stock_counts/stock_count_lines keep the default
-- privileges, because the lifecycle transitions and the movement attachment
-- are sanctioned app writes the *triggers* above bound.
-- ---------------------------------------------------------------------------
