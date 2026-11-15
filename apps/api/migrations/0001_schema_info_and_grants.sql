-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- 0001: schema_info, and what the app role may do.
--
-- Runs as the owner role. The runner puts the app role's name in the
-- transaction-local setting "kinship.app_role" before running a migration, so
-- this file does not hard-code it (and its checksum does not depend on it).
-- The runner also records the schema number in schema_info after each migration.

CREATE TABLE schema_info (
  id            boolean     PRIMARY KEY DEFAULT true CHECK (id),  -- exactly one row
  schema_number integer     NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Nobody but the owner creates objects in the public schema.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

DO $$
DECLARE
  app_role text := current_setting('kinship.app_role', true);
BEGIN
  IF app_role IS NULL OR app_role = '' THEN
    RAISE EXCEPTION 'kinship.app_role is not set; run migrations through the KinShip migration runner';
  END IF;

  EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), app_role);
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', app_role);

  -- Tables and sequences the owner creates from now on are usable by the app
  -- role (row-level security policies, added with each table, do the real
  -- restricting). It never gets CREATE, and no access to the migration
  -- bookkeeping tables, which exist before this runs.
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', app_role);
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', app_role);

  -- schema_info was created above, so the default privileges do not cover it.
  -- The app only reads it.
  EXECUTE format('GRANT SELECT ON schema_info TO %I', app_role);
END
$$;
