-- §10.3 / §11 / §40.6 M2-S2 — the permission-generation column on `users`.
--
-- M2-S2 mints the `perms_version` access-token claim and compares it on every
-- authenticated request, so a permissions change invalidates an outstanding
-- access token (`TOKEN_STALE`). M2-S2 reads the column; M2-S3 owns the writer
-- that increments it when a role or override changes.
--
-- Forward-only and additive (§35.1): an added column with a default, so every
-- existing row is valid, and an added CHECK. It is a separate migration from
-- `0005_identity_auth` because `0005` was committed before this column was
-- specified, and a committed migration is never rewritten (§37.3 G-6) — the
-- additive step is a new migration, which is exactly what forward-only means.
--
-- Prisma does not model CHECK constraints, so this one is appended by hand and
-- re-verified by the acceptance suite's `prisma migrate diff --exit-code`,
-- exactly as `0003`'s, `0004`'s, and `0005`'s CHECKs are.

ALTER TABLE "users" ADD COLUMN "permissions_version" INTEGER NOT NULL DEFAULT 0;

-- §10.3 / §11: a permission generation never goes backwards.
ALTER TABLE "users"
  ADD CONSTRAINT "chk_users_permissions_version_non_negative"
  CHECK ("permissions_version" >= 0);
