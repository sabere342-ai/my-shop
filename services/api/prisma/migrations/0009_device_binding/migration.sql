-- My Shop — device binding (Master Plan §12, §40.6 slice M2-S5, §38.16.2, §9.4).
--
-- One slice, two facts:
--
-- 1. `devices` — the §12.1 installation record, registered on first successful
--    authentication, organization-scoped, and carrying the §12.5 sync metadata
--    the server can honestly maintain. §12.2 fixes the status vocabulary at
--    exactly two states, ACTIVE and REVOKED: there is no approval step, and the
--    `status` column is the reserved extension point for one.
-- 2. `sessions.device_id` — the §12.4 binding that makes "revoking a device
--    immediately revokes its sessions" a single UPDATE: the revocation write
--    and the session-family revocation commit in one transaction, and the
--    closed `revoked_reason` vocabulary gains its one new value
--    `DEVICE_REVOKED`.
--
-- Identity is layered and none of the layers is alone sufficient:
--
--   devices.id                       server-issued device identity — the value
--                                    the access token's `did` claim carries
--                                    and the only device id any authorized
--                                    decision is read from (§12.3: never a
--                                    client-supplied fingerprint).
--   (organization_id, installation_id)  the client's keystore-backed install
--                                    handle, unique per organization (§9.2
--                                    T-7), which turns re-registration into a
--                                    lookup instead of a duplicate.
--   installation_secret_hash         one server-stored SHA-256 digest of the
--                                    keystore-held installation secret. The
--                                    secret itself exists only on the device
--                                    keystore; a lost keystore cannot be
--                                    re-claimed on the old identity — re-
--                                    installation mints a new installation.
--
-- Trust boundary (§5 of the slice record): the devices table is tenant-owned
-- data and receives the same forced-RLS posture every other tenant table
-- carries (`0008`): ENABLE + FORCE + the identical `tenant_isolation` policy,
-- so a device of another organization is invisible and unwritable through the
-- application role no matter which code path forgot its predicate.
--
-- Revocation semantics (§12.4, §12.5) this migration makes expressible:
--
--   - A revoked device's rows are kept forever. Re-registration against a
--     REVOKED row is a refusal, and a *new* installation re-enrolls as a *new*
--     device — the old identity stays revoked with its quarantined history.
--   - Revoking a device revokes its sessions in the same transaction
--     (`sessions.device_id`), so refresh dies immediately; live access tokens
--     expire within the §10.3 TTL, exactly as the plan states.
--   - The offline sync kill is enforced in code at the sync boundary (the
--     device-bound authenticator re-reads the live status inside a tenant
--     transaction); this migration only supplies the state that check reads.
--
-- Audit rules honoured (§8.3, gate G-9), continuing the discipline of
-- `0003`–`0008` and `prisma/roles.sql`: no GRANT, no REVOKE, no role change,
-- no SECURITY DEFINER, no BYPASSRLS, no search_path change, no interpolation
-- — every name and literal below is a constant. The table is created by the
-- migrator and owned by it; the application role gains its default
-- privileges from `roles.sql`'s default-privilege grants, exactly like every
-- table before it.

CREATE TABLE "devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "installation_id" VARCHAR(64) NOT NULL,
    -- Exactly one 64-hex SHA-256 digest; `LIKE` restates the shape so a writer
    -- that bypasses the service cannot store a foreign form (the F-3
    -- discipline of `0004`/`0005`).
    "installation_secret_hash" CHAR(64) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "platform" VARCHAR(32) NOT NULL,
    "os_version" VARCHAR(64),
    "app_version" VARCHAR(32),
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "registered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_authenticated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    -- §12.5 sync metadata, server-maintained subset. The per-device pending
    -- counts, the offline grace expiry, and the clock anchor arrive with the
    -- slices that own their inputs (M3 settings, the grace window, the sync
    -- console) — speculative columns are deliberately deferred.
    "last_push_at" TIMESTAMPTZ(6),
    "last_pull_at" TIMESTAMPTZ(6),
    "last_sync_at" TIMESTAMPTZ(6),
    "client_schema_version" INTEGER,
    "client_app_version" VARCHAR(32),

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- §9.2 T-7: uniqueness scoped by organization, never global — a global
-- installation unique would leak another tenant's existence through a
-- uniqueness violation, the exact legacy defect `DO_NOT_COPY` forbids.
-- The index name is Prisma's `@@unique([organizationId, installationId])`
-- derived name so the drift gate sees schema and migration as one fact.
CREATE UNIQUE INDEX "devices_organization_id_installation_id_key" ON "devices"("organization_id", "installation_id");
CREATE INDEX "devices_organization_id_status_idx" ON "devices"("organization_id", "status");

ALTER TABLE "devices" ADD CONSTRAINT "devices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sessions" ADD COLUMN "device_id" UUID;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The revocation write revokes sessions by device; the partial index keeps
-- that lookup narrow. The column above exists by the time this runs.
CREATE INDEX "sessions_device_id_idx" ON "sessions"("device_id") WHERE "device_id" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- CHECK constraints (Prisma does not model these; they do not affect the drift
-- gate, exactly as `0003`–`0007`'s CHECKs do not). Each restates an invariant
-- the service enforces, so a writer that bypasses the service cannot store a
-- foreign shape.
-- ---------------------------------------------------------------------------

-- Platform: the §12.1 closed vocabulary. A new platform is a schema decision.
ALTER TABLE "devices"
  ADD CONSTRAINT "chk_devices_platform"
  CHECK ("platform" IN ('windows', 'android'));

-- §12.2: exactly two trust states. Extension = explicit schema decision.
ALTER TABLE "devices"
  ADD CONSTRAINT "chk_devices_status"
  CHECK ("status" IN ('ACTIVE', 'REVOKED'));

-- A revoke timestamp exists exactly when the row is REVOKED; the prefix form
-- keeps a NULL `revoked_at` satisfied on an ACTIVE row.
ALTER TABLE "devices"
  ADD CONSTRAINT "chk_devices_revocation_shape"
  CHECK (
    ("status" = 'ACTIVE' AND "revoked_at" IS NULL)
    OR ("status" = 'REVOKED' AND "revoked_at" IS NOT NULL)
  );

-- The stored digest is the SHA-256 hex form the token hashing path produces.
ALTER TABLE "devices"
  ADD CONSTRAINT "chk_devices_installation_secret_hash_shape"
  CHECK ("installation_secret_hash" ~ '^[0-9a-f]{64}$');

-- Label grammar: present, bounded, never whitespace-only.
ALTER TABLE "devices"
  ADD CONSTRAINT "chk_devices_label_shape"
  CHECK (length(btrim("label")) >= 1 AND length(btrim("label")) <= 100);

-- Installation handle grammar: a UUID-shaped identifier the client keystore
-- holds. Shape only — the value carries no authority (§12.3).
ALTER TABLE "devices"
  ADD CONSTRAINT "chk_devices_installation_id_shape"
  CHECK ("installation_id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

-- Sync metadata sanity: a schema version, when reported, is positive.
ALTER TABLE "devices"
  ADD CONSTRAINT "chk_devices_client_schema_version"
  CHECK ("client_schema_version" IS NULL OR "client_schema_version" >= 1);

-- `sessions.revoked_reason` closed vocabulary gains its one new value. The
-- existing constraint (`0005`) is replaced, not edited: a merged migration is
-- immutable (§35.1), so the replacement is a new file's statement.
ALTER TABLE "sessions" DROP CONSTRAINT "chk_sessions_revocation_shape";
ALTER TABLE "sessions"
  ADD CONSTRAINT "chk_sessions_revocation_shape"
  CHECK (
    ("revoked_at" IS NULL AND "revoked_reason" IS NULL)
    OR (
      "revoked_at" IS NOT NULL
      AND "revoked_reason" IS NOT NULL
      AND "revoked_reason" IN ('LOGOUT', 'REUSE_DETECTED', 'ADMIN', 'DEVICE_REVOKED')
    )
  );

-- ---------------------------------------------------------------------------
-- Forced row-level security (§8.2), the identical posture every tenant-owned
-- table carries since `0008`. `NULLIF(current_setting(...), '')` keeps absent
-- and empty contexts the same fail-closed case on pooled sessions.
-- ---------------------------------------------------------------------------
ALTER TABLE "devices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "devices" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "devices"
  FOR ALL
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
