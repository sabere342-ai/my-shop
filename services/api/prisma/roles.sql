-- My Shop — database roles (Master Plan section 13.4, slice M1-S3).
--
-- Two roles, and only two, may exist for this application:
--
--   my_shop_migrator  DDL + DML, used exclusively by migration jobs
--   my_shop_app       DML only, subject to forced row-level security, never BYPASSRLS
--
-- The file is idempotent: roles are cluster-wide and created once, attributes are
-- re-pinned on every run so a drifted role converges, and grants are no-ops when
-- already present. `node scripts/db.mjs bootstrap` runs it against the database
-- named by DATABASE_URL using ADMIN_DATABASE_URL for the privileged connection.
--
-- Passwords are never set here (section 13.6, section 42.6). Supply them from a
-- secret manager at provisioning time, for example:
--   ALTER ROLE my_shop_app WITH PASSWORD '<from-secret-manager>';
--
-- Audit rules honoured (section 8.3 migration audit, gate G-9): no GRANT ALL, no
-- SECURITY DEFINER, no search_path change, and no string interpolation — the names
-- below are literal.

-- ---------------------------------------------------------------------------
-- 1. Create each role if it does not exist yet.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'my_shop_migrator') THEN
    CREATE ROLE my_shop_migrator
      WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'my_shop_app') THEN
    CREATE ROLE my_shop_app
      WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Re-pin attributes so an edited or upgraded role converges on the spec.
--    ALTER ROLE ... WITHOUT PASSWORD leaves any supplied password untouched.
-- ---------------------------------------------------------------------------
ALTER ROLE my_shop_migrator
  WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;

ALTER ROLE my_shop_app
  WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;

-- ---------------------------------------------------------------------------
-- 3. Schema-level grants for this database (grants are per-database).
--    The migrator needs CREATE on the schema to run migrations; the application
--    needs USAGE only, so it can reach tables but cannot create anything.
-- ---------------------------------------------------------------------------
GRANT USAGE, CREATE ON SCHEMA public TO my_shop_migrator;
GRANT USAGE ON SCHEMA public TO my_shop_app;

-- ---------------------------------------------------------------------------
-- 4. DML for the application on tables and sequences that already exist.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO my_shop_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO my_shop_app;

-- ---------------------------------------------------------------------------
-- 5. Default privileges: every table and sequence the migrator creates later is
--    born with the application's DML grants. This is what keeps a future
--    migration from having to remember a GRANT, and it is scoped to the migrator
--    as owner so no other role's objects are affected.
-- ---------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE my_shop_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO my_shop_app;

ALTER DEFAULT PRIVILEGES FOR ROLE my_shop_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO my_shop_app;
