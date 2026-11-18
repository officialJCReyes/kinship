-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- 0015: placeholder people (expand only; no data changes).
--
-- A placeholder is a real people row that stands for an unknown parent ("Unknown father", "Unknown mother") so a
-- person with no recorded parents can get a brother or sister. It has no name, no dates and no facts. Naming it
-- (Edit details) clears the flag and it becomes an ordinary person. See ADR 0019.
--
--   * people.is_placeholder  boolean NOT NULL DEFAULT false: every existing row is a real person.
--   * the two name checks become "is_placeholder OR (...)", so only a placeholder may have empty names
--   * people_placeholder_is_blank: a placeholder has no dates, no deceased flag and no other surnames.
--     Its gender (male for the father, female for the mother) only labels it; it is never drawn as a sex.
--   * the app role may write the flag (admin-only in the API; row-level security is unchanged: the people_*
--     policies already decide who may insert, change and delete a row).

ALTER TABLE people ADD COLUMN is_placeholder boolean NOT NULL DEFAULT false;

ALTER TABLE people DROP CONSTRAINT people_given_name_check;
ALTER TABLE people DROP CONSTRAINT people_surname_check;
ALTER TABLE people ADD CONSTRAINT people_given_name_check
  CHECK (is_placeholder OR (given_name = btrim(given_name) AND length(given_name) BETWEEN 1 AND 100));
ALTER TABLE people ADD CONSTRAINT people_surname_check
  CHECK (is_placeholder OR (surname = btrim(surname) AND length(surname) BETWEEN 1 AND 100));
ALTER TABLE people ADD CONSTRAINT people_placeholder_is_blank
  CHECK (NOT is_placeholder OR (
    given_name = '' AND surname = '' AND second_surname IS NULL AND married_surname IS NULL
    AND birth_date IS NULL AND NOT deceased AND death_date IS NULL
    AND gender IN ('male', 'female')));

DO $$
DECLARE
  app_role text := current_setting('kinship.app_role', true);
BEGIN
  IF app_role IS NULL OR app_role = '' THEN
    RAISE EXCEPTION 'kinship.app_role is not set; run migrations through the KinShip migration runner';
  END IF;
  EXECUTE format('GRANT INSERT (is_placeholder) ON people TO %I', app_role);
  EXECUTE format('GRANT UPDATE (is_placeholder) ON people TO %I', app_role);
END
$$;
