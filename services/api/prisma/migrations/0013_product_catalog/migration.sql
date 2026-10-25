-- Migration 0013 — the product catalog (Master Plan §15.1, §15.2, §15.3A.1–2,
-- §17, §30.1; §40.8 row M4-S1).
--
-- Three new tenant-owned tables:
--
--   products          the conceptual item ("T-Shirt"): naming, optional
--                     category/brand, the product-level default list price,
--                     active flag, and the soft delete with its recorded
--                     reason (§15.1);
--   product_variants  the sellable and future stock-tracked unit
--                     ("T-Shirt / Black / M"): its own UUID, per-organization
--                     unique SKU by a real unique index, one validated
--                     attributes object, and the optional price override
--                     (§15.3A.1–2). This row's identity is the key M4-S2's
--                     inventory engine will track, so nothing here is free to
--                     change shape later;
--   product_units     the §15.2 typed product-unit rows: one `BASE` selling
--                     unit per product and at most one `PURCHASING` unit,
--                     whose `base_quantity_factor` is an exact `bigint`
--                     (a carton of 12 stores 12 and stays 12 — §15.2).
--
-- What this migration deliberately does NOT create:
--   - `product_barcodes`  — M4b owns the §15.3A.3–4 model and its type-aware
--     uniqueness; a placeholder column would be a second authority.
--   - any cost column     — §30 keeps costing with the M4-S3 engine: the moving
--     average is computed from stock movements, never from a catalog write.
--     A catalog cost field would invent an authority the plan refuses.
--   - any stock/quantity column — quantities are derived (`stock_levels`) from
--     the authoritative `stock_movements` (§15.4); M4-S1 establishes variant
--     identities only, and a shared product-level quantity would re-create the
--     legacy "3 T-shirts across sizes" defect the amendment forbids.
--   - no change to any existing table, and no GRANT, REVOKE, role change,
--     SECURITY DEFINER, BYPASSRLS, search_path change, or interpolation (§8.3,
--     gate G-9): every name and literal below is a constant. The application
--     role's DML on the new tables arrives through the migrator schema default
--     privileges 0001 established (`ALTER DEFAULT PRIVILEGES ... GRANT ... ON
--     TABLES`), exactly as every earlier tenant table did.
--
-- Money (§30.1): both price columns are exact `bigint` minor units, non-negative
-- and bounded at 999 999 999 999 minor units (12 digits; the service restates
-- the same bound). `NULL` on the variant column is inheritance from the product
-- (§15.3A.2); `NULL` on the product column is "unset, resolve at the variant" —
-- a selling price is never silently zero, because zero is a real, enterable
-- value a catalog editor would store deliberately.
--
-- Attributes (§15.3A.2 "typed attributes... a small owner-defined set"):
-- one `jsonb` object per variant validated against a code catalog whose V1
-- keys are `color` (text ≤ 50), `size` (text ≤ 50), and `capacity`
-- (integer 0..1 000 000). The database CHECKs restate the vocabulary and the
-- per-key shapes so a writer bypassing the service cannot store a foreign
-- shape — the unknown-key probe uses the `jsonb` remove-keys operator rather
-- than a subquery, which CHECK constraints cannot contain.
--
-- Row-level security: §8.2 migration-`0008` posture extended to the three
-- tables — `ENABLE` + `FORCE` RLS with exactly one symmetric
-- `USING` / `WITH CHECK` policy named `tenant_isolation`, reading the
-- transaction-local trusted context (`app.current_organization_id`).
-- `FORCE` applies to the migrator as owner too. Referential isolation is
-- structural: `product_variants` and `product_units` carry the composite
-- foreign key (`product_id`, `organization_id`) → products
-- (`id`, `organization_id`), so a child row cannot point at another tenant's
-- parent even where the RI trigger would otherwise bypass the parent's policy.

-- ---------------------------------------------------------------------------
-- 1. products (§15.1). `name_ar` is required (Arabic-first, §6.1) and
--    whitespace-bounded at the ends; `name_en`, `category`, and `brand` are
--    optional text. Prices are nullable-by-decision (unresolved, not zero).
-- ---------------------------------------------------------------------------
CREATE TABLE "products" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL,
  "name_ar" varchar(200) NOT NULL,
  "name_en" varchar(200),
  "category" varchar(100),
  "brand" varchar(100),
  "unit_price_minor" bigint,
  "is_active" boolean NOT NULL DEFAULT true,
  "delete_reason" varchar(300),
  "deleted_at" timestamptz(6),
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY ("id"),
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  -- The composite target the child tables' tenant-pinned foreign keys point at.
  UNIQUE ("id", "organization_id"),
  CONSTRAINT "chk_catalog_products_name_ar_bounded"
    CHECK ("name_ar" ~ '\S.*\S|\S' AND char_length("name_ar") <= 200),
  CONSTRAINT "chk_catalog_products_name_en_bounded"
    CHECK ("name_en" IS NULL OR ("name_en" ~ '\S.*\S|\S' AND char_length("name_en") <= 200)),
  CONSTRAINT "chk_catalog_products_category_bounded"
    CHECK ("category" IS NULL OR ("category" ~ '\S.*\S|\S' AND char_length("category") <= 100)),
  CONSTRAINT "chk_catalog_products_brand_bounded"
    CHECK ("brand" IS NULL OR ("brand" ~ '\S.*\S|\S' AND char_length("brand") <= 100)),
  CONSTRAINT "chk_catalog_products_unit_price_minor_bounds"
    CHECK ("unit_price_minor" IS NULL
           OR ("unit_price_minor" >= 0 AND "unit_price_minor" <= 999999999999)),
  -- §15.1 soft delete: a deleted row always carries a recorded reason.
  CONSTRAINT "chk_catalog_products_delete_reason_required"
    CHECK ("deleted_at" IS NULL
           OR ("delete_reason" IS NOT NULL
               AND "delete_reason" ~ '\S.*\S|\S'
               AND char_length("delete_reason") <= 300))
);

COMMENT ON TABLE "products" IS '§15.1 conceptual product (M4-S1); tenant-owned; forced RLS; soft delete with reason; price in exact bigint minor units';

CREATE INDEX "products_organization_id_deleted_at_idx"
  ON "products" ("organization_id", "deleted_at");

-- ---------------------------------------------------------------------------
-- 2. product_variants (§15.3A.2). The SKU unique index is scoped per
--    organization (§15.3A SKU rule; §9.2 T-7) — never global. `attributes`
--    carries the typed attribute object (§15.3A.2). `price_minor` is the
--    variant's own override over the product default.
-- ---------------------------------------------------------------------------
CREATE TABLE "product_variants" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "sku" varchar(64) NOT NULL,
  "attributes" jsonb NOT NULL DEFAULT '{}',
  "price_minor" bigint,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY ("id"),
  -- The tenant-pinned composite foreign key: a variant's organization and its
  -- parent product's organization are the same column pair, so a cross-tenant
  -- parent is structurally impossible (the RI trigger would refuse it even
  -- where it could bypass a policy).
  FOREIGN KEY ("product_id", "organization_id") REFERENCES "products"("id", "organization_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "product_variants_organization_id_sku_key" UNIQUE ("organization_id", "sku"),
  CONSTRAINT "chk_catalog_variant_sku_bounded"
    CHECK ("sku" ~ '\S.*\S|\S' AND char_length("sku") <= 64),
  CONSTRAINT "chk_catalog_variant_price_minor_bounds"
    CHECK ("price_minor" IS NULL
           OR ("price_minor" >= 0 AND "price_minor" <= 999999999999)),
  -- The attributes object: per-key shape, types, and bounds (§15.3A.2), each
  -- expressed as a plain CHECK expression (no subqueries).
  CONSTRAINT "chk_catalog_variant_attributes_object"
    CHECK (jsonb_typeof("attributes") = 'object'),
  CONSTRAINT "chk_catalog_variant_attribute_keys_known"
    CHECK ("attributes" - ARRAY['color', 'size', 'capacity']::text[] = '{}'::jsonb),
  CONSTRAINT "chk_catalog_variant_attribute_color_shape"
    CHECK (
      NOT ("attributes" ? 'color')
      OR (jsonb_typeof("attributes" -> 'color') = 'string'
          AND char_length("attributes" ->> 'color') BETWEEN 1 AND 50
          AND "attributes" ->> 'color' ~ '\S.*\S|\S')
    ),
  CONSTRAINT "chk_catalog_variant_attribute_size_shape"
    CHECK (
      NOT ("attributes" ? 'size')
      OR (jsonb_typeof("attributes" -> 'size') = 'string'
          AND char_length("attributes" ->> 'size') BETWEEN 1 AND 50
          AND "attributes" ->> 'size' ~ '\S.*\S|\S')
    ),
  CONSTRAINT "chk_catalog_variant_attribute_capacity_shape"
    CHECK (
      NOT ("attributes" ? 'capacity')
      OR (jsonb_typeof("attributes" -> 'capacity') = 'number'
          AND ("attributes" ->> 'capacity') ~ '^-?[0-9]+$'
          AND ("attributes" ->> 'capacity')::numeric BETWEEN 0 AND 1000000)
    )
);

COMMENT ON TABLE "product_variants" IS '§15.3A.2 sellable variant (M4-S1); per-organization SKU uniqueness; typed attributes; forced RLS; the future inventory-tracking key';

CREATE INDEX "product_variants_organization_id_product_id_idx"
  ON "product_variants" ("organization_id", "product_id");

-- ---------------------------------------------------------------------------
-- 3. product_units (§15.2). One `BASE` row at factor exactly 1 and at most one
--    `PURCHASING` row at factor 2..1 000 000 per product — the unique pair is
--    the guarantee, and the CHECK restates the §15.2 semantics.
-- ---------------------------------------------------------------------------
CREATE TABLE "product_units" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "kind" varchar(16) NOT NULL,
  "code" varchar(24) NOT NULL,
  "name" varchar(100) NOT NULL,
  "base_quantity_factor" bigint NOT NULL,
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY ("id"),
  FOREIGN KEY ("product_id", "organization_id") REFERENCES "products"("id", "organization_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  -- At most one BASE and at most one PURCHASING unit per product (V1 rule).
  CONSTRAINT "product_units_product_id_kind_key" UNIQUE ("product_id", "kind"),
  CONSTRAINT "chk_catalog_unit_kind_v1"
    CHECK ("kind" IN ('BASE', 'PURCHASING')),
  CONSTRAINT "chk_catalog_unit_code_bounded"
    CHECK ("code" ~ '\S.*\S|\S' AND char_length("code") <= 24),
  CONSTRAINT "chk_catalog_unit_name_bounded"
    CHECK ("name" ~ '\S.*\S|\S' AND char_length("name") <= 100),
  CONSTRAINT "chk_catalog_unit_factor_rule"
    CHECK (
      ("kind" = 'BASE' AND "base_quantity_factor" = 1)
      OR ("kind" = 'PURCHASING'
          AND "base_quantity_factor" BETWEEN 2 AND 1000000)
    )
);

COMMENT ON TABLE "product_units" IS '§15.2 typed product units (M4-S1); one BASE plus at most one PURCHASING per product; exact bigint factor; forced RLS';

CREATE INDEX "product_units_organization_id_product_id_idx"
  ON "product_units" ("organization_id", "product_id");

-- ---------------------------------------------------------------------------
-- 4. Row-level security: migration 0008's posture extended to the three tables
--    this migration creates. Symmetric USING / WITH CHECK on the tenant
--    column; the trusted transaction context (`app.current_organization_id`)
--    is the only key that opens them.
-- ---------------------------------------------------------------------------
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "products"
  FOR ALL
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

ALTER TABLE "product_variants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_variants" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "product_variants"
  FOR ALL
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

ALTER TABLE "product_units" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_units" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "product_units"
  FOR ALL
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- No GRANT for `my_shop_app` appears here: the migrator's default privileges
-- (0001/roles.sql) grant the new tables' SELECT/INSERT/UPDATE/DELETE
-- automatically, the same posture every earlier tenant table holds.
