-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- 0025: drop people.surname_particle and users.surname_choice (the contract half of ADR 0038 and of #220).
--
-- 0024 folded every particle into the surname and the app has neither read nor written the column since; the 0.3.0
-- release ships without it. users.surname_choice has been unread since 0017 (replaced by users.name_form). In order:
--   1. 0024's fold again, for any row that still has a particle (none can be written now, but this makes 0025 safe from any
--      starting point: from 0.3.0-rc.1 or rc.2, 0024 and 0025 run in the same start-up).
--   2. A row still too long to fold (particle, a space and the surname over the 100-character limit) is copied into
--      people_surname_particle_leftover (person id, particle, surname, time) before the drop, so nothing is lost. The
--      NOTICE names the person ids only, never a name. The table is created on every install, even when empty; only the
--      owner role can read it, and nothing in the app does. An admin shortens that person's surname in the app (typing
--      the particle in) and then deletes the row (UPGRADE.md, ADR 0038).
--   3. search_names gets the same formula without the particle. The text is identical for every row whose particle is
--      NULL, which is every row but the leftovers. SET EXPRESSION rewrites the table under an ACCESS EXCLUSIVE lock; at a
--      family tree's size that takes well under a second. It must come before the drop: a column a generated column
--      uses cannot be dropped.
--   4. The placeholder CHECK is made again without the particle. It must come before the drop too: PostgreSQL would
--      otherwise drop the whole constraint silently with the column.
--   5. The two columns are dropped. Their own CHECKs and their column grants to the app role go with them.
-- kinship_auth.complete_setup_family needs no change: its current version (0020) names neither column.
--
-- people has FORCE ROW LEVEL SECURITY (0003), which would hide every row from a non-superuser owner with no signed-in
-- user. As in 0024, the force is lifted here and put back before the transaction that runs the migrations commits.
--
-- Runs as the owner role.

ALTER TABLE people NO FORCE ROW LEVEL SECURITY;

CREATE TABLE people_surname_particle_leftover (
  person_id uuid PRIMARY KEY,
  surname_particle text NOT NULL,
  surname text NOT NULL,
  kept_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE
  app_role text := current_setting('kinship.app_role', true);
  v_kept text;
BEGIN
  IF app_role IS NULL OR app_role = '' THEN
    RAISE EXCEPTION 'kinship.app_role is not set; run migrations through the KinShip migration runner';
  END IF;
  -- 0001's default privileges gave the app role everything on the new table. It is for the owner only.
  EXECUTE format('REVOKE ALL ON people_surname_particle_leftover FROM %I', app_role);
  REVOKE ALL ON people_surname_particle_leftover FROM PUBLIC;

  -- 1. The fold, exactly as 0024.
  UPDATE people
  SET surname = CASE
        WHEN lower(surname) = lower(surname_particle)
          OR left(lower(surname), length(surname_particle) + 1) = lower(surname_particle) || ' '
        THEN surname
        ELSE surname_particle || ' ' || surname
      END,
      surname_particle = NULL
  WHERE surname_particle IS NOT NULL
    AND surname <> ''
    AND (lower(surname) = lower(surname_particle)
      OR left(lower(surname), length(surname_particle) + 1) = lower(surname_particle) || ' '
      OR length(surname_particle) + 1 + length(surname) <= 100);

  -- 2. What is left could not be folded: keep it aside.
  INSERT INTO people_surname_particle_leftover (person_id, surname_particle, surname)
  SELECT id, surname_particle, surname FROM people WHERE surname_particle IS NOT NULL;

  SELECT string_agg(person_id::text, ', ' ORDER BY person_id) INTO v_kept FROM people_surname_particle_leftover;
  IF v_kept IS NOT NULL THEN
    RAISE NOTICE '0025: the surname particle of these people was too long to fold into the surname and was kept in people_surname_particle_leftover: %', v_kept;
  END IF;
END
$$;

-- 3. The search text without the particle.
ALTER TABLE people ALTER COLUMN search_names SET EXPRESSION AS (
  lower(public.kinship_unaccent(
    coalesce(name_prefix || ' ', '') || given_name || coalesce(' ' || nickname, '') ||
    ' ' || surname || coalesce(' ' || second_surname, '') ||
    coalesce(' ' || married_surname, '') || coalesce(' ' || name_suffix, '')
  ))
);

-- 4. A placeholder ("Unknown father") has no name at all: the same rule without the particle.
ALTER TABLE people DROP CONSTRAINT people_placeholder_is_blank;
ALTER TABLE people ADD CONSTRAINT people_placeholder_is_blank
  CHECK (NOT is_placeholder OR (
    given_name = '' AND surname = '' AND second_surname IS NULL AND married_surname IS NULL
    AND name_prefix IS NULL AND name_suffix IS NULL AND nickname IS NULL
    AND birth_date IS NULL AND NOT deceased AND death_date IS NULL
    AND gender IN ('male', 'female')));

-- 5. The columns.
ALTER TABLE people DROP COLUMN surname_particle;
ALTER TABLE users DROP COLUMN surname_choice;

ALTER TABLE people FORCE ROW LEVEL SECURITY;
