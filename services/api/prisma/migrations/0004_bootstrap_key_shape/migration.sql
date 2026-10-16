-- My Shop — bootstrap key shape (Master Plan §40.6 M2-S1 hardening,
-- migration 0004).
--
-- Finding F-3: the §10.4 bootstrap key's *grammar* was enforced only in the
-- command line and in application validation. Migration 0003 re-checked the
-- key's length and trim in the database
-- (`chk_organizations_bootstrap_key_shape`) but not its character set, so a
-- writer that bypassed both the CLI and the service — a future migration, an
-- operator using `psql`, a direct application statement — could store a key
-- this command would refuse (mixed case, underscores, repeated or edge
-- hyphens, inner whitespace). The database is the last line of defence, so
-- the grammar belongs there too.
--
-- Forward-only and additive per §35.1: `0003` (and everything before it) is
-- untouched, and the existing constraint is kept. This migration adds one
-- CHECK that restates the CLI's exact contract:
--
--     ^[a-z0-9]+(-[a-z0-9]+)*$
--
-- which is lowercase-kebab-case with single hyphens, no leading/trailing
-- hyphen, no consecutive hyphens, and no characters outside `[a-z0-9-]`. The
-- 3..64 length bound stays in `chk_organizations_bootstrap_key_shape`.
--
-- Prisma does not model CHECK constraints, so `schema.prisma` is unchanged and
-- the acceptance suite's `prisma migrate diff --exit-code` drift gate is
-- unaffected (exactly as `0003`'s three CHECKs already were).
--
-- Audit rules honoured (§8.3, gate G-9): no GRANT, no SECURITY DEFINER, no
-- BYPASSRLS, no search_path change, no string interpolation — the pattern is a
-- literal. A validated CHECK is safe to add: the CLI and service are the only
-- writers this table has ever had, and both enforce the same grammar, so no
-- existing row can fail it. Adding it validated (not `NOT VALID`) is the
-- stronger guarantee and keeps the invariant non-deferrable.

ALTER TABLE organizations
  ADD CONSTRAINT chk_organizations_bootstrap_key_kebab
  CHECK (bootstrap_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
