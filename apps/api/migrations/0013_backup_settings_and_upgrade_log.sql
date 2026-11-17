-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- 0013: what built-in backups need from the database (docs/decisions/0014-backup-and-owner-access.md).
--
--   * app_settings   the family's own settings that are not secret: the backup schedule and retention, the time zone, and
--                    the safety copy switch. Only a SuperAdmin reads or writes them (the keys are checked by the api). Step 17
--                    adds the update-check toggle here. Row-level security is enabled but not forced, like users: the
--                    owner role (migrations, the startup safety copy, the CLI) reads it without a user.
--   * upgrade_log    one row per database change or restore: from and to schema number and app version, and the name of the
--                    safety copy that was written (or why there was none). Admins read it; only the owner writes it.
--   * schema_info.app_version   the version of the app that last started, so the next start knows what it came from.
--   * Issue #35: the three owner-only widow policies from 0007 named the role that ran the migration, so a dump could only
--                be restored under that role name. They now test "the current user is a member of the table owner", which
--                means the same thing without a name. The app role is never a member of the owner.
--
-- Additive: no existing data changes.

ALTER TABLE schema_info ADD COLUMN app_version text;

CREATE TABLE app_settings (
  key         text        PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_.]{0,63}$'),
  value       jsonb       NOT NULL,
  updated_by  uuid        REFERENCES users (id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_settings_superadmin ON app_settings FOR ALL
  USING ((SELECT public.kinship_role()) = 'superadmin')
  WITH CHECK ((SELECT public.kinship_role()) = 'superadmin');

CREATE TABLE upgrade_log (
  id            uuid        PRIMARY KEY DEFAULT uuidv7(),
  event         text        NOT NULL CHECK (event IN ('migrate', 'restore')),
  from_schema   integer,
  to_schema     integer     NOT NULL,
  from_version  text,
  to_version    text        NOT NULL,
  -- The file name of the safety copy written before a migration (or of the pre-restore copy), or null.
  safety_copy   text,
  -- Why there is none: 'off', 'fresh_install', 'skipped_no_bypassrls', 'break_glass', or null when there is one.
  safety_note   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE upgrade_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY upgrade_log_admin_read ON upgrade_log FOR SELECT
  USING ((SELECT public.kinship_is_admin()));

DO $$
DECLARE
  app_role text := current_setting('kinship.app_role', true);
BEGIN
  IF app_role IS NULL OR app_role = '' THEN
    RAISE EXCEPTION 'kinship.app_role is not set; run migrations through the KinShip migration runner';
  END IF;
  -- Default privileges gave the app role everything on new tables. The log is written by the owner only.
  EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON upgrade_log FROM %I', app_role);
  -- schema_info.app_version is written by the owner at start; the app only reads it (it already has SELECT).
END
$$;

-- Issue #35. Policies for the owner role only, open only while a trigger function of 0007 has set
-- kinship.widow_internal. "Member of the owner of this table" instead of a hardcoded role name.
DROP POLICY people_select_widowed_internal ON people;
DROP POLICY unions_select_widowed_internal ON unions;
DROP POLICY unions_update_widowed_internal ON unions;

CREATE POLICY people_select_widowed_internal ON people FOR SELECT
  USING (
    current_setting('kinship.widow_internal', true) = 'on'
    AND pg_catalog.pg_has_role(current_user,
          (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.people'::regclass), 'MEMBER')
  );
CREATE POLICY unions_select_widowed_internal ON unions FOR SELECT
  USING (
    current_setting('kinship.widow_internal', true) = 'on'
    AND pg_catalog.pg_has_role(current_user,
          (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.unions'::regclass), 'MEMBER')
  );
CREATE POLICY unions_update_widowed_internal ON unions FOR UPDATE
  USING (
    current_setting('kinship.widow_internal', true) = 'on'
    AND pg_catalog.pg_has_role(current_user,
          (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.unions'::regclass), 'MEMBER')
  )
  WITH CHECK (
    current_setting('kinship.widow_internal', true) = 'on'
    AND pg_catalog.pg_has_role(current_user,
          (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.unions'::regclass), 'MEMBER')
  );
