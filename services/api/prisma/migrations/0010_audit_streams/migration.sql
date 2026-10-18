-- My Shop — audit streams (Master Plan §32, §32.2A, §32.5, §32.6, §40.6 slice M2-S6;
-- §9.3 trusted context, §8.2 RLS contract, invariants T-1–T-8).
--
-- One slice, two streams, one law:
--
-- 1. `audit_events` — the §32.1 **business history**. "Why does this number look
--    like this, and who did it?" Retained indefinitely as part of the financial
--    record; readable under `audit.view`.
-- 2. `security_events` — the §32.1 **security history**. "Who tried to get in,
--    and did we stop them?" Never part of any ledger, never posted; owner-only
--    access at the application layer; minimum 400-day retention obligation.
-- 3. One law both streams obey (§32.5): they are append-only. The application
--    role holds **INSERT** and **SELECT**, and *nothing else*: no general-purpose
--    UPDATE, no DELETE. This migration shapes that fact against PostgreSQL's own
--    privilege resolution rather than trusting application discipline — see the
--    grant paragraph below.
--
-- Ordering and tamper evidence (§32.5, the M2-S6 key acceptance):
--
--   (stream, scope)  the audit-stream head (`audit_stream_heads`) carries the
--                    last *committed* sequence and the last row's `event_hash`.
--                    Allocation takes a `pg_advisory_xact_lock` keyed by
--                    `<stream>:<scope>` and locks the head row (`FOR UPDATE`)
--                    before reading `last_sequence` + 1 — never an unsafe free
--                    read of `MAX(sequence)` — so concurrent writers serialize
--                    and a rolled-back allocation leaves **no gap** (the next
--                    committed append reuses the same next value).
--   sequence         unique per (scope, stream) scope partition; integrity of
--                    the *committed* series is therefore structural: a
--                    missing mid-series value is a deletion, because rollback
--                    cannot produce one and the UPDATE/DELETE privileges do
--                    not exist for the application role.
--   event_hash       SHA-256 hex over the row's canonical invariant fields
--                    (computed by the application's canonical serializer;
--                    shape and linkage below).
--   prev_event_hash  the *previous committed row's* `event_hash` in the same
--                    scope, so the committed rows of one stream in one scope
--                    form one chain: deletion, modification, reordering, or
--                    sequence substitution breaks at least one linkage —
--                    detected by the executable verifier, which re-walks the
--                    chain read-only.
--
-- Honest limitation, documented by design: the hash is computed by the
-- application, and the verifier re-walks stored rows. Every principal whose
-- privileges PostgreSQL lawfully constrains — the application role above all —
-- is detectably tampering. A superuser connection can rewrite the table and
-- recompute an entire chain; no in-database mechanism can prevent that. §32.5
-- is delivered exactly as far as PostgreSQL's privilege resolution reaches,
-- and the verifier's guarantees are stated in those terms.
--
-- Scopes. The AUDIT stream is tenant-owned only. The SECURITY stream has two
-- verified partitions (see the slice record, point 9):
--
--   TENANT   `organization_id IS NOT NULL` — events whose tenant context is a
--            server-verified fact (device lifecycle, organization-scoped
--            refusals, sync boundary refusals). Full tenant isolation.
--   GLOBAL   `organization_id IS NULL` — pre-authentication and per-identity
--            security telemetry (failed logins, throttles, refresh reuse,
--            unknown-token refusals). Manufacturing a tenant id from an
--            unverified email would fabricate attribution, so none is made:
--            these rows carry no tenant fact, are classified per-identity the
--            same way the five intentionally global identity tables are
--            (`0008`), and their allocation head uses the documented global
--            sentinel scope `00000000-0000-0000-0000-000000000000`.
--            Identity attempts record `actor_kind = 'UNVERIFIED'` plus — as
--            labelled *claims*, never verified facts — the attempted e-mail
--            and/or the account the attempt was aimed at.
--
-- Actor accountability (§32.6): every row carries `actor_kind`, for which no
-- value means "nobody": USER (verified), DEVICE/TRANSPORT attribution columns
-- are filled from server-resolved facts, SYSTEM names its documented principal
-- string, UNVERIFIED is the labelled unverified attempt. CHECK constraints keep
-- the combination internally consistent.
--
-- Referential posture: audit history survives the documents it observes, so
-- the streams carry **value references only** — no foreign keys to mutable
-- identity/lifecycle rows — matching the deliberate FK-free posture of the
-- `mutation_ledger` the §32.2A rows copy their facts from. Tenant isolation of
-- the value-referenced tenant column is enforced by RLS, exactly as for the
-- sync infrastructure tables since `0002`/`0008`.
--
-- Grants, deliberately shaped in this migration (§32.5 — the one legitimately
-- grant-shaped statement of the slice): `prisma/roles.sql` default privileges
-- grant `my_shop_app` `SELECT, INSERT, UPDATE, DELETE` on every table, which
-- would hand the application role UPDATE and DELETE on histories the plan
-- forbids modifying. This migration therefore revokes the two forbidden
-- privileges on these three tables and leaves INSERT + SELECT standing. No
-- `GRANT` is issued (no `GRANT ALL`, the G-9 gate's concern), no role is
-- created or altered, no SECURITY DEFINER function exists here, and —
-- continuing the discipline of `0003`–`0009` — every name and literal below is
-- a constant, with no `search_path` change and no interpolation.

-- ---------------------------------------------------------------------------
-- 1. The business history (§32.1, §32.2, §32.2A server half).
-- ---------------------------------------------------------------------------
CREATE TABLE "audit_events" (
    -- Per-organization ordering. The PK makes duplicate ordering
    -- unrepresentable; the head allocation makes gaps unrepresentable for any
    -- committed series.
    "organization_id"        UUID NOT NULL,
    "sequence"               BIGINT NOT NULL,

    "occurred_at"            TIMESTAMPTZ(6) NOT NULL,
    -- §32.2A: the device-local event time, when the event carries one
    -- (offline provenance). Always server-recorded `occurred_at` beside it.
    "local_occurred_at"      TIMESTAMPTZ(6),

    -- Closed grammar; the authoritative vocabulary lives in code (§11.2
    -- discipline) and grows by schema decision.
    "event_type"             VARCHAR(80) NOT NULL,

    -- §32.6 actor accountability, CHECK-consistent below.
    "actor_kind"             VARCHAR(16) NOT NULL,
    "actor_user_id"          UUID,
    "actor_device_id"        UUID,
    "actor_principal"        VARCHAR(100),

    -- Target and provenance references (by value; see the header).
    "target_type"            VARCHAR(64),
    "target_id"              VARCHAR(64),
    "document_ref"           VARCHAR(100),
    "mutation_id"            UUID,
    "device_local_sequence"  BIGINT,

    -- §15 of the slice record: an allow-listed payload schema per event type
    -- produces this; the database only restates "an object, if present".
    "payload"                JSONB,

    -- The integrity chain (§32.5).
    "prev_event_hash"        CHAR(64) NOT NULL,
    "event_hash"             CHAR(64) NOT NULL,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("organization_id", "sequence")
);

-- §32.2A server acceptance: one canonical ACCEPTED row per accepted mutation,
-- ever — defence in depth beside the ledger's own idempotency, enforced by the
-- database. Retries and rejections are separate event types and free.
CREATE UNIQUE INDEX "uq_audit_events_accepted_per_mutation"
  ON "audit_events" ("organization_id", "mutation_id")
  WHERE "event_type" = 'SYNC_MUTATION_ACCEPTED';

CREATE INDEX "audit_events_organization_id_occurred_at_idx"
  ON "audit_events" ("organization_id", "occurred_at" DESC);
CREATE INDEX "audit_events_organization_id_event_type_idx"
  ON "audit_events" ("organization_id", "event_type");
CREATE INDEX "audit_events_organization_id_target_idx"
  ON "audit_events" ("organization_id", "target_type", "target_id");

-- ---------------------------------------------------------------------------
-- 2. The security history (§32.1, §32.3; §38.27's tampering signal).
-- ---------------------------------------------------------------------------
CREATE TABLE "security_events" (
    -- A security row's identity is its own: an id, one per durable fact.
    "id"                     UUID NOT NULL DEFAULT gen_random_uuid(),

    -- TENANT rows are tenant-owned; GLOBAL rows are the documented
    -- pre-authentication / per-identity partition of point 9.
    "partition_kind"         VARCHAR(16) NOT NULL,
    "organization_id"        UUID,

    -- The per-partition chain position (tenant rows chain per organization;
    -- global rows chain in one stream). Gapless-committed, head-allocated.
    "sequence"               BIGINT NOT NULL,

    "occurred_at"            TIMESTAMPTZ(6) NOT NULL,
    "event_type"             VARCHAR(80) NOT NULL,

    -- §32.6 attribution, including the labelled UNVERIFIED attempt.
    "actor_kind"             VARCHAR(16) NOT NULL,
    "actor_user_id"          UUID,
    "actor_device_id"        UUID,
    "actor_principal"        VARCHAR(100),
    "claimed_user_id"        UUID,
    "claimed_email"          VARCHAR(320),

    -- Server-resolved device (never a client assertion), and a bounded,
    -- rate-scope-only client address ("never authority").
    "device_id"              UUID,
    "reason_code"            VARCHAR(64),
    "client_address"         VARCHAR(64),

    "payload"                JSONB,

    "prev_event_hash"        CHAR(64) NOT NULL,
    "event_hash"             CHAR(64) NOT NULL,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- One chain position per scope partition: tenant rows chain per organization;
-- global rows chain in one stream under the documented sentinel scope.
CREATE UNIQUE INDEX "uq_security_events_scope_sequence"
  ON "security_events" ((COALESCE("organization_id", '00000000-0000-0000-0000-000000000000'::uuid)), "sequence");

CREATE INDEX "security_events_organization_id_occurred_at_idx"
  ON "security_events" ("organization_id", "occurred_at" DESC);
CREATE INDEX "security_events_occurred_at_idx"
  ON "security_events" ("occurred_at" DESC);

-- ---------------------------------------------------------------------------
-- 3. The allocation heads (sequence + chain anchors).
-- ---------------------------------------------------------------------------
CREATE TABLE "audit_stream_heads" (
    "stream"           VARCHAR(16) NOT NULL,
    "scope"            UUID NOT NULL,

    "last_sequence"    BIGINT NOT NULL DEFAULT 0,
    "last_event_hash"  CHAR(64) NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
    "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_stream_heads_pkey" PRIMARY KEY ("stream", "scope")
);

-- ---------------------------------------------------------------------------
-- CHECK constraints (Prisma does not model these; the migration carries the
-- authoritative database posture, exactly as `0004`–`0009`'s CHECKs do).
-- ---------------------------------------------------------------------------

-- Closed stream vocabulary: AUDIT, SECURITY. Extension = a schema decision.
ALTER TABLE "audit_stream_heads"
  ADD CONSTRAINT "chk_audit_stream_heads_stream"
  CHECK ("stream" IN ('AUDIT', 'SECURITY'));

-- The AUDIT stream is tenant-scoped only: its scope is a real organization,
-- never the global sentinel.
ALTER TABLE "audit_stream_heads"
  ADD CONSTRAINT "chk_audit_stream_heads_audit_scope_tenant"
  CHECK (NOT ("stream" = 'AUDIT'
              AND "scope" = '00000000-0000-0000-0000-000000000000'::uuid));

-- ---------------------------------------------------------------------------
ALTER TABLE "audit_events"
  ADD CONSTRAINT "chk_audit_events_event_hash_shape"
  CHECK ("event_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "audit_events"
  ADD CONSTRAINT "chk_audit_events_prev_hash_shape"
  CHECK ("prev_event_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "audit_events"
  ADD CONSTRAINT "chk_audit_events_sequence_positive"
  CHECK ("sequence" >= 1);

ALTER TABLE "security_events"
  ADD CONSTRAINT "chk_security_events_event_hash_shape"
  CHECK ("event_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "security_events"
  ADD CONSTRAINT "chk_security_events_prev_hash_shape"
  CHECK ("prev_event_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "security_events"
  ADD CONSTRAINT "chk_security_events_sequence_positive"
  CHECK ("sequence" >= 1);

ALTER TABLE "audit_stream_heads"
  ADD CONSTRAINT "chk_audit_stream_heads_sequence_nonnegative"
  CHECK ("last_sequence" >= 0);
ALTER TABLE "audit_stream_heads"
  ADD CONSTRAINT "chk_audit_stream_heads_hash_shape"
  CHECK ("last_event_hash" ~ '^[0-9a-f]{64}$');

-- Event grammar (both streams): uppercase identifier, at least 4 characters —
-- the canonical form every versioned vocabulary in code uses.
ALTER TABLE "audit_events"
  ADD CONSTRAINT "chk_audit_events_event_type_grammar"
  CHECK ("event_type" ~ '^[A-Z][A-Z0-9_]{3,79}$');
ALTER TABLE "security_events"
  ADD CONSTRAINT "chk_security_events_event_type_grammar"
  CHECK ("event_type" ~ '^[A-Z][A-Z0-9_]{3,79}$');

-- Payloads, when present, are objects — allow-listed constructors in the
-- service never produce arrays or scalars here.
ALTER TABLE "audit_events"
  ADD CONSTRAINT "chk_audit_events_payload_object"
  CHECK ("payload" IS NULL OR jsonb_typeof("payload") = 'object');
ALTER TABLE "security_events"
  ADD CONSTRAINT "chk_security_events_payload_object"
  CHECK ("payload" IS NULL OR jsonb_typeof("payload") = 'object');

-- §32.6 actor accountability, enforced pairwise:
--   USER      names a verified user; the principal string stays empty.
--   DEVICE    device attribution is present for device-anchored rows; nothing
--             forbids a USER row also carrying its verified device.
--   SYSTEM    names its documented principal string and carries no user id.
--   UNVERIFIED (security only) is the labelled attempt: the claimed identity
--             columns are its home, and it must not claim a verified actor.
ALTER TABLE "audit_events"
  ADD CONSTRAINT "chk_audit_events_actor_shape"
  CHECK (
    ("actor_kind" = 'USER' AND "actor_user_id" IS NOT NULL AND "actor_principal" IS NULL)
    OR ("actor_kind" = 'DEVICE' AND "actor_device_id" IS NOT NULL AND "actor_principal" IS NULL)
    OR ("actor_kind" = 'SYSTEM' AND "actor_user_id" IS NULL AND "actor_device_id" IS NULL AND "actor_principal" IS NOT NULL)
  );

ALTER TABLE "security_events"
  ADD CONSTRAINT "chk_security_events_actor_shape"
  CHECK (
    ("actor_kind" = 'USER' AND "actor_user_id" IS NOT NULL AND "actor_principal" IS NULL)
    OR ("actor_kind" = 'DEVICE' AND "actor_user_id" IS NULL AND "actor_device_id" IS NOT NULL AND "actor_principal" IS NULL)
    OR ("actor_kind" = 'SYSTEM' AND "actor_user_id" IS NULL AND "actor_device_id" IS NULL AND "actor_principal" IS NOT NULL)
    OR ("actor_kind" = 'UNVERIFIED')
  );

-- Partition shape: GLOBAL = no organization; TENANT = a real organization id.
ALTER TABLE "security_events"
  ADD CONSTRAINT "chk_security_events_partition_shape"
  CHECK (
    ("partition_kind" = 'GLOBAL' AND "organization_id" IS NULL)
    OR ("partition_kind" = 'TENANT' AND "organization_id" IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- §32.5 effective grants against PostgreSQL itself: the application role keeps
-- INSERT and SELECT on the audit streams and holds no UPDATE and no DELETE.
-- The migrator keeps its full DML for the columns it owns.
-- ---------------------------------------------------------------------------
REVOKE UPDATE, DELETE ON TABLE "audit_events", "security_events", "audit_stream_heads" FROM my_shop_app;

-- ---------------------------------------------------------------------------
-- Forced row-level security (§8.2), the identical posture every tenant-owned
-- table carries since `0008` — plus the two documented, deliberate exceptions:
-- the GLOBAL `security_events` partition and the sentinel head row.
-- `NULLIF(current_setting(...), '')` keeps absent and empty contexts the same
-- fail-closed case on pooled sessions; a context-free statement can never see
-- or write a tenant row, and still sees exactly the tenant-neutral global rows
-- its per-identity classification admits.
-- ---------------------------------------------------------------------------
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "audit_events"
  FOR ALL
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

ALTER TABLE "security_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "security_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY "scope_isolation" ON "security_events"
  FOR ALL
  USING (
    "organization_id" IS NULL
    OR "organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
  )
  WITH CHECK (
    "organization_id" IS NULL
    OR "organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
  );

ALTER TABLE "audit_stream_heads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_stream_heads" FORCE ROW LEVEL SECURITY;

CREATE POLICY "scope_isolation" ON "audit_stream_heads"
  FOR ALL
  USING (
    "scope" = '00000000-0000-0000-0000-000000000000'::uuid
    OR "scope" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
  )
  WITH CHECK (
    "scope" = '00000000-0000-0000-0000-000000000000'::uuid
    OR "scope" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
  );
