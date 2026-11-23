-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- 0024: fold the surname particle into the surname (ADR 0038, which amends ADR 0024). DATA ONLY.
--
-- A particle (de, de la, van, von) is just part of the surname. people.surname_particle (0017) only ever shipped in the
-- 0.3.0 release candidates; from this release the app neither reads nor writes it. For each person with a particle:
--   * the surname becomes "<particle> <surname>", unless the surname already is the particle or already starts with the
--     particle and a space (compared without case: "de" + "De la Cruz" stays "De la Cruz"; whole words only, so
--     "van" + "Vandermeer" becomes "van Vandermeer");
--   * the particle becomes NULL.
-- A row whose particle, a space and its surname would pass the 100-character surname limit is left as it is (particle kept)
-- and its id is named in a NOTICE, which the api writes to its log. The contract migration that drops the column must deal
-- with any such row first.
--
-- Nothing else changes now (expand, then contract): the column, the search_names expression, the placeholder CHECK, the
-- column grants and complete_setup_family stay until a later release. search_names already holds the particle before the
-- surname, so the search text of a folded row is the same as before.
--
-- people has FORCE ROW LEVEL SECURITY (0003), which would hide every row from a non-superuser owner with no signed-in
-- user. The force is lifted for this one statement and put back before the transaction that runs the migrations commits.
--
-- Runs as the owner role.

ALTER TABLE people NO FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_kept text;
BEGIN
  SELECT string_agg(id::text, ', ' ORDER BY id) INTO v_kept
  FROM people
  WHERE surname_particle IS NOT NULL
    AND lower(surname) <> lower(surname_particle)
    AND left(lower(surname), length(surname_particle) + 1) <> lower(surname_particle) || ' '
    AND length(surname_particle) + 1 + length(surname) > 100;
  IF v_kept IS NOT NULL THEN
    RAISE NOTICE '0024: the surname particle was kept for these people, because it and the surname together pass 100 characters: %', v_kept;
  END IF;

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
END
$$;

ALTER TABLE people FORCE ROW LEVEL SECURITY;
