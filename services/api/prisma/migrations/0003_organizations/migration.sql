-- My Shop — organizations, identities and memberships (Master Plan §40.6,
-- slice M2-S1).
--
-- The tenancy foundation: the `organizations` tenant root aggregate (§9.2
-- T-1/T-6), the credential-free `users` identity table (§8.4 context
-- ownership — identity is M2-S1's table, authentication is M2-S2's column set),
-- and the `organization_memberships` edge that carries the single ownership
-- source of truth (§9.2 T-2/T-5) and multi-organization membership (T-4).
--
-- Forward-only and additive per §35.1: `0001`/`0002` are untouched, and the
-- sync tables' bare `organization_id` columns intentionally gain no foreign key
-- here (adding one would rewrite merged history; §35.1 forbids it).
--
-- Audit rules honoured (§8.3, gate G-9): no GRANT (the migrator's
-- `ALTER DEFAULT PRIVILEGES` in prisma/roles.sql already births every table
-- with the application role's DML), no SECURITY DEFINER, no BYPASSRLS, no
-- search_path change, no string interpolation — every name below is literal.
--
-- Generated with:
--   prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
-- (then hand-reviewed for the CHECK constraints, the partial unique index and
-- the §8.3 comment discipline Prisma does not emit; re-verified by
-- `prisma migrate diff --from-migrations --to-schema-datamodel --exit-code`,
-- which the acceptance suite runs as its drift gate.)

-- §40.6 lifecycle state of a tenant root. Closed vocabulary (§35.1): a new
-- value means a new migration. Only the *state* exists in M2-S1 — no
-- deactivation workflow, no member-invitation flow.
CREATE TYPE organization_status AS ENUM ('ACTIVE', 'DEACTIVATED');

-- §9.2 T-1/T-6: the tenant root aggregate.
--
--   id            UUID primary key, server-generated (§39.2: a tenant
--                 identifier is never client-supplied)
--   name          display name; deliberately NOT globally unique (§9.2 T-7 —
--                 a global name unique would leak another tenant's existence
--                 through a uniqueness violation)
--   status        ACTIVE | DEACTIVATED
--   bootstrap_key the §10.4 idempotency key of the operator-only bootstrap
--                 command: exactly one organization may ever carry a key, so
--                 an identical retry is a lookup and a conflicting retry fails
--                 on the constraint instead of adopting the stored row
--   created_at    server clock (§23.1)
CREATE TABLE organizations (
  id            uuid                  NOT NULL DEFAULT gen_random_uuid(),
  name          varchar(200)          NOT NULL,
  status        organization_status   NOT NULL DEFAULT 'ACTIVE',
  bootstrap_key varchar(64)           NOT NULL,
  created_at    timestamp(3)          NOT NULL DEFAULT now(),
  CONSTRAINT organizations_pkey PRIMARY KEY (id),
  CONSTRAINT organizations_bootstrap_key_key UNIQUE (bootstrap_key),
  CONSTRAINT chk_organizations_name_present
    CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT chk_organizations_bootstrap_key_shape
    CHECK (length(bootstrap_key) BETWEEN 3 AND 64
           AND bootstrap_key = btrim(bootstrap_key))
);

-- §8.4 identity foundation: credential-free by design. Password material,
-- sessions and roles arrive with M2-S2/M2-S3 in their own migrations.
--
--   id         UUID primary key, server-generated
--   email      canonical form enforced in the column: trimmed, lowercase,
--              bounded at RFC 5321's 254-octalet mailbox limit — the seam
--              M2-S2 reuses for login, and never echoed back by M2-S1
--   created_at server clock
CREATE TABLE users (
  id         uuid         NOT NULL DEFAULT gen_random_uuid(),
  email      varchar(320) NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT now(),
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_email_key UNIQUE (email),
  CONSTRAINT chk_users_email_canonical
    CHECK (email = btrim(email)
           AND email = lower(email)
           AND length(email) BETWEEN 3 AND 254)
);

-- §9.2 T-2/T-5 and T-4: the membership edge.
--
--   organization_id  tenant scope; indexed leading column for M2-S4 RLS
--   user_id          identity scope (a user may belong to several
--                    organizations — T-4)
--   is_owner         NOT NULL: every row written by the bootstrap command is
--                    explicitly classified; defaults to false only so the
--                    column can never be omitted silently
--   created_at       server clock
--
-- ON DELETE RESTRICT / ON UPDATE CASCADE: tenant history is referentially
-- stable — an organization or user with memberships can never be deleted out
-- from under them, and a key refresh cascades to the edges that point at it.
CREATE TABLE organization_memberships (
  id              uuid         NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid         NOT NULL,
  user_id         uuid         NOT NULL,
  is_owner        boolean      NOT NULL DEFAULT false,
  created_at      timestamp(3) NOT NULL DEFAULT now(),
  CONSTRAINT organization_memberships_pkey PRIMARY KEY (id),
  CONSTRAINT organization_memberships_organization_id_user_id_key
    UNIQUE (organization_id, user_id),
  CONSTRAINT organization_memberships_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES organizations (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT organization_memberships_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
);

-- §9.2 T-2/T-5: the single ownership source of truth. At most one row per
-- organization may be an owner — a partial unique index, enforced by
-- PostgreSQL itself, so no application-level race can mint a second owner.
CREATE UNIQUE INDEX uq_organizations_single_owner
  ON organization_memberships (organization_id)
  WHERE is_owner;

-- Reverse edge: "which organizations does this user belong to" (T-4) and the
-- per-email lookup the identity writer does under its advisory lock.
CREATE INDEX organization_memberships_user_id_idx
  ON organization_memberships (user_id);
