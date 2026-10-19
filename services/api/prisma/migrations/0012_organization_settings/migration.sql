-- Migration 0012 — the typed organization settings (Master Plan §22, §22.4,
-- §38.18; §40.7 row M3-S1).
--
-- Two new tenant-owned tables, exactly one row per organization of typed
-- configuration and the typed feature-flag rows beside it:
--
--   organization_settings       the §22.2/§22.4 column per setting, with the
--                               plan's default, the plan's bound, and a
--                               `settings_version` monotonic integer;
--   organization_feature_flags  the §22.2 `feature_flags` row type: one row is
--                               `(organization_id, flag_key, enabled)`.
--
-- What this migration deliberately does NOT create: a `allow_negative_stock`
-- column (removed by the M0-P2 amendment §22.4 — negative stock is
-- unconditionally forbidden §38.4, and re-adding the column would be a
-- governing decision, not a migration); nor `app_lock_enabled` (§22.2 scopes
-- it per device; M9 owns where it lands). Absence is the recorded answer, so
-- a settings consumer cannot silently ship the amendment away.
--
-- Every column CHECK restates the bound the settings service enforces
-- (§22.1: "typed columns validated by the service layer"). The database CHECK
-- is the last line of defence for a writer that bypasses that service; its
-- bounds are byte-identical to the service constants' contract
-- (`settings.contract.ts`), and the acceptance suite refutes raw SQL writes
-- outside each bound.
--
-- `settings_version` (§38.18) starts at 1 everywhere an organization's
-- configuration first exists — created in the bootstrap transaction by the
-- composition root, or lazily by the settings service for an organization
-- that predates this migration. A tenant whose settings nobody has touched
-- yet may therefore carry no row at all; the service materializes it (with
-- `settings_version = 1`) on first read or write inside its tenant
-- transaction.
--
-- Concurrency (§38.18's monotonic version): `settings_version` advances by
-- exactly one per accepted settings-update transaction and in the same
-- transaction as the change it belongs to. The enforcement is the service's
-- per-organization advisory lock plus the row's locked read (no lost
-- updates), never a free MAX read; the CHECK below only forbids a zero or a
-- negative version existing in any row.
--
-- Row-level security (§8.2, extending migration `0008`'s posture to the
-- tables this migration creates): both tables are ENABLE + FORCE RLS with
-- exactly one policy named `tenant_isolation`, symmetric USING / WITH CHECK
-- on the tenant column, reading the transaction-local trusted context.
-- `FORCE` applies to the migrator as owner too, so no session at all —
-- application or migration — moves these rows outside a tenant context. The
-- fail-closed shapes are the acceptance suite's facts, not this comment's.
--
-- Audit rules honoured (§8.3, gate G-9), continuing the discipline of
-- `0009`–`0011`: no GRANT, no REVOKE, no role change, no SECURITY DEFINER, no
-- BYPASSRLS, no search_path change, no interpolation — every name and literal
-- below is a constant. The application role's DML on the new tables arrives
-- through the migrator-schema default privileges `0001` established
-- (`ALTER DEFAULT PRIVILEGES ... GRANT ... ON TABLES`), exactly as every
-- earlier tenant table did.
-- Removed by the M0-P2 amendment means exactly what §22.4 says: negative stock
-- is unconditionally forbidden, and the settings surface carries no column
-- that could soften that verdict.

-- ---------------------------------------------------------------------------
-- 1. The settings singleton (§22.1: typed columns, never a key-value table).
-- ---------------------------------------------------------------------------
CREATE TABLE "organization_settings" (
  "organization_id" uuid NOT NULL,
  "settings_version" bigint NOT NULL DEFAULT 1,
  -- §22.2 `currency`: enum, V1 ships exactly `EGP`. Grown by a governing
  -- decision, never by accepting a foreign value.
  "currency" varchar(3) NOT NULL DEFAULT 'EGP',
  -- §22.2 `minor_unit_exponent`: int, owner-exclusive. Bounded 0..9: a money
  -- format with more than 9 minor decimals (or a negative one) has no honest
  -- rendering in any currency the plan names.
  "minor_unit_exponent" integer NOT NULL DEFAULT 2,
  -- §22.2 `display_numerals` / §6.8: WESTERN default; the allowed alternative
  -- is Eastern Arabic numerals for on-screen display only.
  "display_numerals" varchar(16) NOT NULL DEFAULT 'WESTERN',
  -- §17: the three pricing modes, one active value per organization.
  "pricing_mode" varchar(24) NOT NULL DEFAULT 'FIXED',
  -- §18: discount ceilings. Percentage bounded to its numeric(5,2) scale and
  -- its 0..100 space; amounts bounded non-negative in minor units.
  "max_discount_percentage" numeric(5, 2) NOT NULL DEFAULT 0,
  "max_discount_amount_minor" bigint NOT NULL DEFAULT 0,
  -- §18: the approval gate. `NULL` means "no approval gate" and is the
  -- plan default; a present value is non-negative.
  "discount_approval_threshold_minor" bigint,
  "discount_allowed_for_salesperson" boolean NOT NULL DEFAULT false,
  "block_discount_below_cost" boolean NOT NULL DEFAULT false,
  -- §21.2: one of three enum values, default ALWAYS_ASK.
  "invoice_output_default" varchar(24) NOT NULL DEFAULT 'ALWAYS_ASK',
  -- §22.2 `invoice_footer`: bounded presentation text, empty by default —
  -- never a blank-safe assumption that it exists.
  "invoice_footer" text NOT NULL DEFAULT '',
  "invoice_show_logo" boolean NOT NULL DEFAULT true,
  "customer_required_on_credit_sale" boolean NOT NULL DEFAULT true,
  -- §30.6: HALF_UP default, HALF_EVEN the plan-named alternative.
  "rounding_mode" varchar(16) NOT NULL DEFAULT 'HALF_UP',
  "receivables_aging_enabled" boolean NOT NULL DEFAULT true,
  -- §22.4 / O-13/O-20: 72 hours default, maximum 30 days. Seconds are the
  -- store unit: exact at every bound, immune to minutes/millisecond drift.
  -- Lower bound 1 s: a non-positive window is not a grace window (a zero
  -- would silently disable the documented offline capability rather than
  -- record a configuration), never emitted by the service.
  "offline_grace_duration_seconds" bigint NOT NULL DEFAULT 259200,
  -- §22.4 / §16.4A.2: the one V1 presentation format for a device receipt.
  "offline_receipt_id_format" varchar(32) NOT NULL DEFAULT 'ORG-DEV-SEQ',
  "offline_reserved_number_blocks" boolean NOT NULL DEFAULT false,
  -- §22.4: only meaningful while `offline_reserved_number_blocks` stands
  -- enabled; the plan fixes the default 1000. 1..10000 keeps a block small
  -- enough that the documented fairness argument (blocks accumulate, §16.4A.2)
  -- stays honest.
  "reserved_block_size" integer NOT NULL DEFAULT 1000,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY ("organization_id"),
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "chk_org_settings_version_positive"
    CHECK ("settings_version" >= 1),
  CONSTRAINT "chk_org_settings_currency_v1"
    CHECK ("currency" IN ('EGP')),
  CONSTRAINT "chk_org_settings_minor_unit_exponent_range"
    CHECK ("minor_unit_exponent" BETWEEN 0 AND 9),
  CONSTRAINT "chk_org_settings_display_numerals_v1"
    CHECK ("display_numerals" IN ('WESTERN', 'EASTERN_ARABIC')),
  CONSTRAINT "chk_org_settings_pricing_mode_v1"
    CHECK ("pricing_mode" IN ('FIXED', 'VARIABLE', 'FIXED_WITH_DISCOUNT')),
  CONSTRAINT "chk_org_settings_max_discount_percentage_range"
    CHECK ("max_discount_percentage" >= 0 AND "max_discount_percentage" <= 100),
  CONSTRAINT "chk_org_settings_max_discount_amount_nonnegative"
    CHECK ("max_discount_amount_minor" >= 0),
  CONSTRAINT "chk_org_settings_approval_threshold_nonnegative"
    CHECK ("discount_approval_threshold_minor" IS NULL
           OR "discount_approval_threshold_minor" >= 0),
  CONSTRAINT "chk_org_settings_invoice_output_default_v1"
    CHECK ("invoice_output_default" IN ('ALWAYS_ASK', 'PRINT_AUTOMATICALLY', 'NO_AUTOMATIC_OUTPUT')),
  CONSTRAINT "chk_org_settings_invoice_footer_bounded"
    CHECK (char_length("invoice_footer") <= 2000),
  CONSTRAINT "chk_org_settings_rounding_mode_v1"
    CHECK ("rounding_mode" IN ('HALF_UP', 'HALF_EVEN')),
  CONSTRAINT "chk_org_settings_offline_grace_duration_bounds"
    CHECK ("offline_grace_duration_seconds" >= 1
           AND "offline_grace_duration_seconds" <= 2592000),
  CONSTRAINT "chk_org_settings_offline_receipt_id_format_v1"
    CHECK ("offline_receipt_id_format" IN ('ORG-DEV-SEQ')),
  CONSTRAINT "chk_org_settings_reserved_block_size_range"
    CHECK ("reserved_block_size" BETWEEN 1 AND 10000)
);

COMMENT ON TABLE "organization_settings" IS '§22 typed organization settings (M3-S1); one row per tenant; CHECKs restate the service bounds; forced RLS';

-- ---------------------------------------------------------------------------
-- 2. The §22.2 `feature_flags` typed rows. The flag vocabulary is a versioned
--    catalog in application code (§11.2 discipline), so the plan's V1 state
--    ("typed rows, empty") holds: an organization without flags carries zero
--    rows, and no unknown key can enter the table through the service. The
--    CHECK restates only the key *grammar* a catalog entry would follow.
-- ---------------------------------------------------------------------------
CREATE TABLE "organization_feature_flags" (
  "organization_id" uuid NOT NULL,
  "flag_key" varchar(64) NOT NULL,
  "enabled" boolean NOT NULL,
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY ("organization_id", "flag_key"),
  FOREIGN KEY ("organization_id") REFERENCES "organization_settings"("organization_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "chk_org_feature_flag_key_grammar"
    CHECK ("flag_key" ~ '^[A-Z][A-Z0-9_]{2,63}$')
);

COMMENT ON TABLE "organization_feature_flags" IS '§22.2 feature_flags as typed rows (M3-S1); flag vocabulary lives in the code catalog; forced RLS';

-- ---------------------------------------------------------------------------
-- 3. Row-level security: migration 0008's posture extended to the two tables
--    this migration creates. Symmetric USING / WITH CHECK on the tenant
--    column; the trusted transaction context (`app.current_organization_id`)
--    is the only key that opens them.
-- ---------------------------------------------------------------------------
ALTER TABLE "organization_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization_settings" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "organization_settings"
  FOR ALL
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

ALTER TABLE "organization_feature_flags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization_feature_flags" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "organization_feature_flags"
  FOR ALL
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- The application role's SELECT/INSERT/UPDATE/DELETE on the new tables is
-- granted by the migrator's default privileges (0001/roles.sql), so no GRANT
-- for `my_shop_app` appears here — the posture every earlier tenant table
-- already holds, unchanged.
