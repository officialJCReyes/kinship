-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- 0010: an account's own display settings (My settings), saved on the account.
--
--   * color_scheme    forest (default), sand, slate, graphite
--   * theme           device (default: follow the device), light, dark
--   * date_format     mdy (default) "Jan 1, 2026", dmy "1 Jan, 2026", dmy2 "1 Jan 2026", long "January 1, 2026",
--                     iso "2026-01-01", us "01/01/2026" (month first), eu "01/01/2026" (day first). Only how a date is
--                     SHOWN: the stored text stays YYYY, YYYY-MM or YYYY-MM-DD.
--   * surname_choice  married (default: the married surname when someone has one) or birth (birth names)
--   * lineage_view    unchanged (0006)
--
-- Additive only: every existing account gets the defaults. They change nothing for any other account.
-- The columns live on users (not in a separate table) because they are a handful of small choices read with the
-- account on every request; the notification settings of 0.4 are many more and get their own table then.
--
-- Rights: the app role may read and update these four columns, like lineage_view. The users_update_own policy
-- (0006) already keeps an update to the account's own row, and no other column of users is granted, so role, email
-- and the person link stay untouchable.

ALTER TABLE users
  ADD COLUMN color_scheme text NOT NULL DEFAULT 'forest'
    CHECK (color_scheme IN ('forest', 'sand', 'slate', 'graphite')),
  ADD COLUMN theme text NOT NULL DEFAULT 'device'
    CHECK (theme IN ('device', 'light', 'dark')),
  ADD COLUMN date_format text NOT NULL DEFAULT 'mdy'
    CHECK (date_format IN ('mdy', 'dmy', 'dmy2', 'long', 'iso', 'us', 'eu')),
  ADD COLUMN surname_choice text NOT NULL DEFAULT 'married'
    CHECK (surname_choice IN ('married', 'birth'));

DO $$
DECLARE
  app_role text := current_setting('kinship.app_role', true);
BEGIN
  IF app_role IS NULL OR app_role = '' THEN
    RAISE EXCEPTION 'kinship.app_role is not set; run migrations through the KinShip migration runner';
  END IF;
  EXECUTE format(
    'GRANT SELECT (color_scheme, theme, date_format, surname_choice), UPDATE (color_scheme, theme, date_format, surname_choice) ON users TO %I',
    app_role);
END
$$;
