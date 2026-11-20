-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- 0017: name prefix, suffix, nickname and surname particle on people; how a married woman's name is shown, and
-- whether prefixes and suffixes are shown, on accounts (ADR 0024).
--
--   * people.name_prefix       Dr., Sir, Dra.              optional, 1 to 30 characters
--   * people.name_suffix       Jr., II                     optional, 1 to 30 characters
--   * people.nickname          Danny                       optional, 1 to 100 characters
--   * people.surname_particle  de, de la, van              optional, 1 to 30 characters. `surname` stays the bare surname
--                              ("Cruz"), so sorting ignores the particle.
--   * users.name_form          maiden_married (default), married_born, married or maiden. Replaces surname_choice, which
--                              stays for now (expand, then contract) and is no longer read.
--   * users.show_prefix, show_suffix   true by default, for new AND existing accounts.
--   * people.search_names      the same column, a new formula that also holds the nickname, particle, prefix and suffix.
--
-- Data rule (JC, Nov 20): an account on surname_choice 'married' (the default for everyone who never changed it) moves to
-- maiden_married; an account on 'birth' (always a choice) moves to 'maiden'. Every other account gets the defaults.
--
-- Runs as the owner role. The app role's name arrives in "kinship.app_role" (see 0001).

ALTER TABLE people
  ADD COLUMN name_prefix text
    CHECK (name_prefix = btrim(name_prefix) AND length(name_prefix) BETWEEN 1 AND 30),
  ADD COLUMN name_suffix text
    CHECK (name_suffix = btrim(name_suffix) AND length(name_suffix) BETWEEN 1 AND 30),
  ADD COLUMN nickname text
    CHECK (nickname = btrim(nickname) AND length(nickname) BETWEEN 1 AND 100),
  ADD COLUMN surname_particle text
    CHECK (surname_particle = btrim(surname_particle) AND length(surname_particle) BETWEEN 1 AND 30);

-- A placeholder ("Unknown father") has no name at all (0015): the new fields too.
ALTER TABLE people DROP CONSTRAINT people_placeholder_is_blank;
ALTER TABLE people ADD CONSTRAINT people_placeholder_is_blank
  CHECK (NOT is_placeholder OR (
    given_name = '' AND surname = '' AND second_surname IS NULL AND married_surname IS NULL
    AND name_prefix IS NULL AND name_suffix IS NULL AND nickname IS NULL AND surname_particle IS NULL
    AND birth_date IS NULL AND NOT deceased AND death_date IS NULL
    AND gender IN ('male', 'female')));

-- The search text: every part of a name, lower-cased and accent-free. SET EXPRESSION rewrites the stored column in
-- place (PostgreSQL 17 and later). It is not strictly expand-then-contract: the old code only reads the column and
-- the new text is a superset of the old, so the previous release still searches correctly (ADR 0024). Nothing is
-- built on the column (no index, view or other generated column); if there were, PostgreSQL would refuse this statement.
ALTER TABLE people ALTER COLUMN search_names SET EXPRESSION AS (
  lower(public.kinship_unaccent(
    coalesce(name_prefix || ' ', '') || given_name || coalesce(' ' || nickname, '') ||
    coalesce(' ' || surname_particle, '') || ' ' || surname || coalesce(' ' || second_surname, '') ||
    coalesce(' ' || married_surname, '') || coalesce(' ' || name_suffix, '')
  ))
);

ALTER TABLE users
  ADD COLUMN name_form text NOT NULL DEFAULT 'maiden_married'
    CHECK (name_form IN ('maiden_married', 'married_born', 'married', 'maiden')),
  ADD COLUMN show_prefix boolean NOT NULL DEFAULT true,
  ADD COLUMN show_suffix boolean NOT NULL DEFAULT true;

UPDATE users SET name_form = 'maiden' WHERE surname_choice = 'birth';

DO $$
DECLARE
  app_role text := current_setting('kinship.app_role', true);
BEGIN
  IF app_role IS NULL OR app_role = '' THEN
    RAISE EXCEPTION 'kinship.app_role is not set; run migrations through the KinShip migration runner';
  END IF;
  EXECUTE format('GRANT INSERT (name_prefix, name_suffix, nickname, surname_particle) ON people TO %I', app_role);
  EXECUTE format('GRANT UPDATE (name_prefix, name_suffix, nickname, surname_particle) ON people TO %I', app_role);
  EXECUTE format(
    'GRANT SELECT (name_form, show_prefix, show_suffix), UPDATE (name_form, show_prefix, show_suffix) ON users TO %I',
    app_role);
END
$$;

-- The first-run wizard's one write takes the new settings (CREATE OR REPLACE keeps the grants of 0012).
CREATE OR REPLACE FUNCTION kinship_auth.complete_setup_family(
  p_token_hash text, p_email text, p_display_name text, p_password_hash text, p_tree_name text,
  p_settings jsonb, p_family jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_user_id uuid;
  v_previous text;
  v_you uuid;
  v_partner uuid;
  v_partner_union uuid;
  v_father uuid;
  v_mother uuid;
  v_parents_union uuid;
  v_child uuid;
  v_child_json jsonb;
  v_children uuid[] := ARRAY[]::uuid[];
BEGIN
  PERFORM pg_advisory_xact_lock(7302041119);
  IF EXISTS (SELECT 1 FROM public.users) THEN
    RAISE EXCEPTION 'setup_already_done' USING ERRCODE = 'KS001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.setup_token WHERE token_hash = p_token_hash) THEN
    RAISE EXCEPTION 'invalid_setup_token' USING ERRCODE = 'KS002';
  END IF;

  INSERT INTO public.users (
    email, display_name, password_hash, role, password_changed_at, password_changed_via,
    lineage_view, color_scheme, theme, date_format, name_form, show_prefix, show_suffix
  ) VALUES (
    lower(p_email), p_display_name, p_password_hash, 'superadmin', now(), 'setup',
    coalesce(p_settings ->> 'lineageView', 'adoptive'),
    coalesce(p_settings ->> 'colorScheme', 'forest'),
    coalesce(p_settings ->> 'theme', 'device'),
    coalesce(p_settings ->> 'dateFormat', 'mdy'),
    coalesce(p_settings ->> 'nameForm', 'maiden_married'),
    coalesce((p_settings ->> 'showPrefix')::boolean, true),
    coalesce((p_settings ->> 'showSuffix')::boolean, true)
  ) RETURNING id INTO v_user_id;
  INSERT INTO public.family_tree (id, name) VALUES (true, p_tree_name);

  -- From here on everything is written as the new account (row-level security applies as usual).
  v_previous := current_setting('kinship.user_id', true);
  PERFORM set_config('kinship.user_id', v_user_id::text, true);

  -- You, linked to the account.
  v_you := kinship_auth.setup_insert_person(v_user_id, p_family -> 'you');
  UPDATE public.users SET person_id = v_you WHERE id = v_user_id;

  -- The partner and the one relationship between you.
  IF jsonb_typeof(p_family -> 'partner') = 'object' THEN
    v_partner := kinship_auth.setup_insert_person(v_user_id, p_family -> 'partner');
    v_partner_union := kinship_auth.setup_insert_union(v_user_id, v_you, v_partner, p_family -> 'partner' ->> 'status');
  END IF;

  -- The parents, and their relationship when both are entered.
  IF jsonb_typeof(p_family -> 'father') = 'object' THEN
    v_father := kinship_auth.setup_insert_person(v_user_id, p_family -> 'father');
  END IF;
  IF jsonb_typeof(p_family -> 'mother') = 'object' THEN
    v_mother := kinship_auth.setup_insert_person(v_user_id, p_family -> 'mother');
  END IF;
  IF v_father IS NOT NULL AND v_mother IS NOT NULL THEN
    v_parents_union := kinship_auth.setup_insert_union(v_user_id, v_father, v_mother, p_family ->> 'parents_status');
  END IF;

  -- You hang from your parents (their relationship, or the one parent alone).
  IF v_parents_union IS NOT NULL THEN
    INSERT INTO public.person_parents (child_id, union_id, kind, created_by)
      VALUES (v_you, v_parents_union, 'birth', v_user_id);
  ELSIF coalesce(v_father, v_mother) IS NOT NULL THEN
    INSERT INTO public.person_parents (child_id, parent_id, kind, created_by)
      VALUES (v_you, coalesce(v_father, v_mother), 'birth', v_user_id);
  END IF;

  -- The children, then their links.
  FOR v_child_json IN SELECT value FROM jsonb_array_elements(coalesce(p_family -> 'children', '[]'::jsonb)) LOOP
    v_children := v_children || kinship_auth.setup_insert_person(v_user_id, v_child_json);
  END LOOP;
  FOR i IN 1 .. coalesce(array_length(v_children, 1), 0) LOOP
    v_child_json := p_family -> 'children' -> (i - 1);
    IF v_child_json ->> 'other_parent' = 'partner' THEN
      IF v_partner_union IS NULL THEN
        RAISE EXCEPTION 'a child of the partner needs a partner';
      END IF;
      INSERT INTO public.person_parents (child_id, union_id, kind, created_by)
        VALUES (v_children[i], v_partner_union, 'birth', v_user_id);
    ELSE
      INSERT INTO public.person_parents (child_id, parent_id, kind, created_by)
        VALUES (v_children[i], v_you, 'birth', v_user_id);
    END IF;
  END LOOP;

  PERFORM set_config('kinship.user_id', coalesce(v_previous, ''), true);
  DELETE FROM public.setup_token;
  RETURN v_user_id;
END
$fn$;
