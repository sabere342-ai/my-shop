-- My Shop — authorization: roles, role permissions, and per-user overrides
-- (Master Plan §40.6, slice M2-S3; §11.2, §11.3, §11.4, §39.2).
--
-- The RBAC foundation the §11.1 decision needs: a role is *data* (a named set of
-- permission ids scoped to one organization), a role_permissions edge records the
-- grants, and a permission_overrides edge records a per-user allow/deny evaluated
-- after the role. The permission **ids** are deliberately not an enum and not a
-- table ( §11.2: they are strings in a versioned catalog in application code, so
-- the catalog grows without a schema migration); the database stores only the grant
-- edges and constrains their shape.
--
-- Forward-only and additive per §35.1: `0001`-`0006` are untouched. The one existing
-- table altered is `organization_memberships`, which gains a **nullable** `role_id`
-- column: an organization created before this migration has no roles until the
-- idempotent application-code seeding (§35.4) runs, so a `NOT NULL` column or a
-- CHECK requiring an owner role would refuse the upgrade on existing rows
-- (§35.2 expand/contract).
--
-- Audit rules honoured (§8.3, gate G-9): no GRANT (the migrator's
-- `ALTER DEFAULT PRIVILEGES` in prisma/roles.sql already births every table with the
-- application role's DML — `roles.sql` is deliberately untouched), no SECURITY
-- DEFINER, no BYPASSRLS, no search_path change, no string interpolation — every name
-- and literal below is a constant.
--
-- Generated with:
--   prisma migrate diff --from-schema-datamodel <base-schema> \
--     --to-schema-datamodel prisma/schema.prisma --script
-- (the additive delta emitted by the Prisma CLI is reproduced verbatim below; the
-- CHECK constraints and the partial unique index Prisma does not model are appended
-- by hand and re-verified by the acceptance suite's `prisma migrate diff --exit-code`,
-- exactly as `0003`-`0006`'s CHECKs and `0003`'s partial unique index are).

-- §11.4: the closed vocabulary of a per-user override.
CREATE TYPE "permission_effect" AS ENUM ('ALLOW', 'DENY');

-- §11.3: the single role a membership holds, or NULL for a pre-0007 membership the
-- idempotent seeding has not yet classified. The composite foreign key
-- (role_id, organization_id) -> roles (id, organization_id) is added below; it is what
-- makes a role of one organization structurally unappliable in another.
ALTER TABLE "organization_memberships" ADD COLUMN     "role_id" UUID;

-- §11.3: a role is data, not an enum.
--
--   id              server-generated (§39.2: never client-supplied)
--   organization_id tenant scope; the composite-FK target component
--   key             stable machine identity of the role, unique per organization
--   name            display name
--   is_system       a built-in preset (never a custom role, which is a later slice)
--   is_owner        marks the single Owner role (partial unique index below)
--   created_at      server clock
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_owner" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- §11.3: the permission ids a role grants. The PK (role_id, permission_id) makes a
-- duplicate grant impossible; the composite FK keeps the grant inside the role's
-- tenant. `permission_id` is TEXT ( §11.2: the catalog lives in code).
CREATE TABLE "role_permissions" (
    "organization_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission_id" VARCHAR(100) NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- §11.4: one per-user override per (organization, user, permission); the absence of a
-- row means "no override". The composite FK to organization_memberships ties an
-- override to a real membership of the same tenant.
CREATE TABLE "permission_overrides" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "permission_id" VARCHAR(100) NOT NULL,
    "effect" "permission_effect" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permission_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "roles_organization_id_idx" ON "roles"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organization_id_key_key" ON "roles"("organization_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "roles_id_organization_id_key" ON "roles"("id", "organization_id");

-- CreateIndex
CREATE INDEX "role_permissions_organization_id_idx" ON "role_permissions"("organization_id");

-- CreateIndex
CREATE INDEX "permission_overrides_organization_id_idx" ON "permission_overrides"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "permission_overrides_organization_id_user_id_permission_id_key" ON "permission_overrides"("organization_id", "user_id", "permission_id");

-- CreateIndex
CREATE INDEX "organization_memberships_role_id_idx" ON "organization_memberships"("role_id");

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_role_id_organization_id_fkey" FOREIGN KEY ("role_id", "organization_id") REFERENCES "roles"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_organization_id_fkey" FOREIGN KEY ("role_id", "organization_id") REFERENCES "roles"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_overrides" ADD CONSTRAINT "permission_overrides_organization_id_user_id_fkey" FOREIGN KEY ("organization_id", "user_id") REFERENCES "organization_memberships"("organization_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- §11.3: the single Owner role per organization. A partial unique index mirroring
-- `uq_organizations_single_owner` — a second owner role fails in PostgreSQL no matter
-- what the caller believes. Not modelled by Prisma (partial indexes are invisible to
-- the drift gate, exactly as `0003`'s is).
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX uq_roles_single_owner
  ON roles (organization_id)
  WHERE is_owner;

-- ---------------------------------------------------------------------------
-- CHECK constraints (Prisma does not model these; they do not affect the drift gate,
-- exactly as `0003`-`0006`'s CHECKs do not). Each restates an invariant the service
-- enforces so a writer that bypasses the service still cannot store state the service
-- would refuse (the F-3 discipline).
-- ---------------------------------------------------------------------------

-- §11.3: a role key is a trimmed, lowercase snake_case token; a role name is present
-- and trimmed. The varchar(64)/varchar(100) column types cap the upper bound.
ALTER TABLE "roles"
  ADD CONSTRAINT "chk_roles_key_shape"
  CHECK ("key" = btrim("key") AND "key" ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$');

ALTER TABLE "roles"
  ADD CONSTRAINT "chk_roles_name_present"
  CHECK (length(btrim("name")) BETWEEN 1 AND 100);

-- §11.2: a permission id is a dot-separated identifier whose first segment is lower
-- case (e.g. `sales.viewAll`, `accounting.journal.post`). The same grammar the catalog
-- validates in code, restated in the database so a malformed id can never be stored.
ALTER TABLE "role_permissions"
  ADD CONSTRAINT "chk_role_permissions_permission_id_shape"
  CHECK ("permission_id" ~ '^[a-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)*$');

ALTER TABLE "permission_overrides"
  ADD CONSTRAINT "chk_permission_overrides_permission_id_shape"
  CHECK ("permission_id" ~ '^[a-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)*$');
