-- My Shop — server mutation ledger (Master Plan §40.5, slice M1b-S4).
--
-- The `sync` context's infrastructure tables: the idempotent mutation ledger
-- (§38.9.1, §38.9.2), the per-organization change feed (§38.11.1), the
-- per-device sync cursors, and the per-organization server-sequence counter
-- that implements §38.11.1's single monotonic sequence.
--
-- Forward-only and additive per §35.1. No historical migration is touched.
-- Ownership is the `sync` context (§8.4, D-8): these are convergence
-- artefacts, never business tables, and none is posted to the accounting
-- ledger (§39.4). The application role receives its DML through the
-- `ALTER DEFAULT PRIVILEGES FOR ROLE my_shop_migrator` grants in
-- prisma/roles.sql, so no hand-written GRANT is needed here.
--
-- Audit rules honoured (§8.3, gate G-9): no GRANT ALL, no SECURITY DEFINER,
-- no search_path change, no string interpolation — every name below is
-- literal.

-- §38.9.1 `status`: APPLIED or REJECTED. A closed vocabulary; adding a value
-- would be a new migration (forward-only, §35.1).
CREATE TYPE mutation_ledger_status AS ENUM ('APPLIED', 'REJECTED');

-- §38.9.1: the server mutation ledger, append-only.
--
--   organization_id           tenant scope (§38.9.1)
--   mutation_id               client-generated UUIDv7; unique with organization_id
--   device_id                 origin device
--   received_at               server clock, distinct from local_created_at (§23.1)
--   payload_hash              SHA-256 of the canonical payload (§38.9.1)
--   result_ref                the business object the mutation produced (§38.9.1)
--   result_hash               hash of the resulting state, distinguishing a real
--                             contradiction from a replay (§38.9.1)
--   server_sequence           the §38.11.1 sequence assigned at acceptance; present
--                             for APPLIED only (a rejected mutation consumes none)
--   status                    APPLIED | REJECTED
--   rejection_code            present when rejected
--
-- The primary key IS the idempotency key: an identical (organization_id,
-- mutation_id) is a lookup, never a second application (§38.9.3). Storing the
-- assigned server_sequence on the ledger row is what lets §38.9.2's replay
-- "return the original stored response" (which includes server_sequence,
-- §38.10.1) without a secondary change_log lookup.
CREATE TABLE mutation_ledger (
  organization_id uuid                  NOT NULL,
  mutation_id     uuid                  NOT NULL,
  device_id       uuid                  NOT NULL,
  received_at     timestamp(6) with time zone NOT NULL,
  payload_hash    varchar(64)           NOT NULL,
  result_ref      text,
  result_hash     varchar(64),
  server_sequence bigint,
  status          mutation_ledger_status NOT NULL,
  rejection_code  text,
  CONSTRAINT mutation_ledger_pkey PRIMARY KEY (organization_id, mutation_id)
);

-- §8.3 index discipline: hot indexes lead with organization_id. Device-scoped
-- audit/reconciliation reads and retention scans both do.
CREATE INDEX mutation_ledger_organization_id_device_id_idx
  ON mutation_ledger (organization_id, device_id);
CREATE INDEX mutation_ledger_organization_id_received_at_idx
  ON mutation_ledger (organization_id, received_at);

-- §38.11.1: the change feed, written in the same transaction as the business
-- change. server_sequence is the cursor key; mutation_id lets a device
-- reconcile its own echo rather than re-apply blindly (§38.11.2).
CREATE TABLE change_log (
  organization_id uuid   NOT NULL,
  server_sequence bigint NOT NULL,
  mutation_id     uuid,
  entity_type     text   NOT NULL,
  entity_id       text   NOT NULL,
  changed_at      timestamp(6) with time zone NOT NULL,
  CONSTRAINT change_log_pkey PRIMARY KEY (organization_id, server_sequence)
);

-- "what changed for this entity, in order" (§38.11.3 change sets).
CREATE INDEX change_log_organization_id_entity_type_entity_id_idx
  ON change_log (organization_id, entity_type, entity_id);

-- Cursors per device (§38.11.2 resume, pull paging). last_pull defaults to 0:
-- a device with no pull history resumes from the start.
CREATE TABLE device_sync_cursors (
  organization_id             uuid NOT NULL,
  device_id                   uuid NOT NULL,
  last_pushed_server_sequence bigint,
  last_pull_server_sequence   bigint NOT NULL DEFAULT 0,
  updated_at                  timestamp(6) with time zone NOT NULL,
  CONSTRAINT device_sync_cursors_pkey PRIMARY KEY (organization_id, device_id)
);

-- One counter row per organization, implementing §38.11.1's single monotonic
-- per-organization sequence. Gaps are expected and harmless (§38.11.1).
CREATE TABLE sync_sequences (
  organization_id uuid   NOT NULL,
  last_sequence   bigint NOT NULL,
  CONSTRAINT sync_sequences_pkey PRIMARY KEY (organization_id)
);