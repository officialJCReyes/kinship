-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- 0015: where a relationship began (the marriage place). docs/decisions/0018-relationship-place.md.
--
-- Runs as the owner role. The app role's name arrives in "kinship.app_role" (see 0001).
-- Additive (expand only): one nullable column, so no existing row changes and nothing has to be backfilled.
--
--   * unions.place   free text, optional: "Santo Domingo, Dominican Republic". NULL means none. Trimmed, 1 to 200
--                    characters (the API turns a blank value into NULL). There is no places table yet (Places is planned
--                    for 0.5); when it arrives this column is read into it, and nothing here has to be undone.

ALTER TABLE unions
  ADD COLUMN place text CHECK (place = btrim(place) AND length(place) BETWEEN 1 AND 200);

-- The app role may write it like the other editable columns (status, dates); created_by and the ids stay out of reach.
DO $$
DECLARE
  app_role text := current_setting('kinship.app_role', true);
BEGIN
  IF app_role IS NULL OR app_role = '' THEN
    RAISE EXCEPTION 'kinship.app_role is not set; run migrations through the KinShip migration runner';
  END IF;
  EXECUTE format('GRANT INSERT (place) ON unions TO %I', app_role);
  EXECUTE format('GRANT UPDATE (place) ON unions TO %I', app_role);
END
$$;
