-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- 0014: what the update check and the "What's new" popup need (docs/decisions/0015-update-check-and-whats-new.md).
--
--   * update_check            one row: the state of the daily check against GitHub's public release list (times, status,
--                             the ETag for conditional requests, the parsed releases). Only a SuperAdmin reads it; only the
--                             owner role (the api's scheduled job and the Check now route) writes it.
--   * users.last_seen_version the version of KinShip this account last saw the "What's new" popup for, and when. A trigger
--     users.last_seen_at      gives every NEW account the version that is running now, so a fresh install and every later
--                             invitation start current and see no popup. An account that already exists gets NULL: it
--                             predates tracking, and the api treats that as 0.1.0-alpha.2.
--   * users.update_dismissed_version, users.update_backup_ack_version
--                             the SuperAdmin's "Dismiss" of the banner for one version, and the tick "I have a backup I can
--                             restore" for one version. Per account, so they follow the person to another device.
--   * upgrade_log.backup_version  for a restore: the version of the backup that was restored. from_version now means the
--                             version that was running before (so "the version went down" can be told from the log).
--
-- Additive: no existing data changes. The three switches live in app_settings (0013) under their own keys.

ALTER TABLE users
  ADD COLUMN last_seen_version text CHECK (length(last_seen_version) BETWEEN 1 AND 64),
  ADD COLUMN last_seen_at timestamptz,
  ADD COLUMN update_dismissed_version text CHECK (length(update_dismissed_version) BETWEEN 1 AND 64),
  ADD COLUMN update_backup_ack_version text CHECK (length(update_backup_ack_version) BETWEEN 1 AND 64);

-- A new account starts at the version that is running. schema_info.app_version is written by the api at every start, before
-- it serves a request, so setup and invitations always see it. Where it is not set yet (a database used only by tests or by
-- the migration runner) the columns stay NULL.
CREATE FUNCTION public.kinship_new_user_last_seen() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.last_seen_version IS NULL THEN
    NEW.last_seen_version := (SELECT app_version FROM public.schema_info LIMIT 1);
    IF NEW.last_seen_version IS NOT NULL AND NEW.last_seen_at IS NULL THEN
      NEW.last_seen_at := now();
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER users_new_last_seen BEFORE INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION public.kinship_new_user_last_seen();

CREATE TABLE update_check (
  id              boolean     PRIMARY KEY DEFAULT true CHECK (id),  -- exactly one row
  status          text        NOT NULL DEFAULT 'never'
                  CHECK (status IN ('never', 'ok', 'unchanged', 'offline', 'rate_limited', 'bad_response')),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  next_check_at   timestamptz,
  -- Failures in a row, for the back-off.
  failures        integer     NOT NULL DEFAULT 0 CHECK (failures >= 0),
  -- GitHub's ETag for the release list (sent back as If-None-Match).
  etag            text        CHECK (length(etag) <= 200),
  -- The parsed releases (the shape of KnownRelease in packages/shared, plus what the check needs to know when to read a
  -- manifest again). Written only by the api after strict checks; capped.
  releases        jsonb       NOT NULL DEFAULT '[]'::jsonb
                  CHECK (jsonb_typeof(releases) = 'array' AND pg_column_size(releases) <= 4194304),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
INSERT INTO update_check (id) VALUES (true);

ALTER TABLE update_check ENABLE ROW LEVEL SECURITY;
CREATE POLICY update_check_superadmin_read ON update_check FOR SELECT
  USING ((SELECT public.kinship_role()) = 'superadmin');

ALTER TABLE upgrade_log ADD COLUMN backup_version text;

DO $$
DECLARE
  app_role text := current_setting('kinship.app_role', true);
BEGIN
  IF app_role IS NULL OR app_role = '' THEN
    RAISE EXCEPTION 'kinship.app_role is not set; run migrations through the KinShip migration runner';
  END IF;
  -- Default privileges gave the app role everything on the new table. The check's state is written by the owner only.
  EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON update_check FROM %I', app_role);
  -- Like the display settings (0010): the account's own row, these columns only (the users_update_own policy keeps it to the row).
  EXECUTE format(
    'GRANT SELECT (last_seen_version, last_seen_at, update_dismissed_version, update_backup_ack_version), '
    'UPDATE (last_seen_version, last_seen_at, update_dismissed_version, update_backup_ack_version) ON users TO %I',
    app_role);
END
$$;
