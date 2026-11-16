-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- 0012: the first-run wizard creates the account, the tree and the closest relatives in ONE transaction
-- (docs/decisions/0013-setup-wizard.md).
--
--   * kinship_auth.complete_setup_family(...) is the wizard's single write. It takes the same advisory lock as
--     complete_setup, refuses if an account exists (KS001) or the token is wrong (KS002), then creates, in this order:
--     the account (with its display settings) and the tree, the "you" person (linked on users.person_id), the
--     partner and their relationship, the father and the mother and their relationship, the link from "you" to the
--     parents, the children, and the links from the children. Any failure raises and everything, the account
--     included, rolls back; the setup token is deleted only at the end of the same transaction.
--   * The people are inserted AS the new account (kinship.user_id is set for the transaction, as complete_setup
--     does), so the same row-level security policies, the cycle check and the automatic-Widowed triggers run as for
--     any other write. Nothing is bypassed. The caller (the API) has already cleaned every value; this function
--     trusts its shape but the table constraints still hold.
--   * The old five-argument complete_setup (0002, no caller since alpha.2) is dropped: issue #9. The seven-argument
--     one stays for scripted installs that send `person`; it goes in a later contract step.
--
-- Additive for data: no table changes. Removing an unused function is the only contract here.

DROP FUNCTION kinship_auth.complete_setup(text, text, text, text, text);

-- One person row from the wizard's JSON, inserted as the account. Not executable by anyone but the owner (and so by
-- the SECURITY DEFINER function below).
CREATE FUNCTION kinship_auth.setup_insert_person(p_user uuid, p jsonb) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO public.people (
    given_name, surname, married_surname, gender,
    birth_date, birth_precision, deceased, created_by
  ) VALUES (
    p ->> 'given_name', p ->> 'surname', p ->> 'married_surname', p ->> 'gender',
    (p -> 'birth' ->> 'value')::public.partial_date,
    coalesce(p -> 'birth' ->> 'precision', 'exactly'),
    coalesce((p ->> 'deceased')::boolean, false),
    p_user
  ) RETURNING id
$fn$;

-- One relationship between two people already inserted.
CREATE FUNCTION kinship_auth.setup_insert_union(p_user uuid, p_a uuid, p_b uuid, p_status text) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO public.unions (partner_a_id, partner_b_id, status, created_by)
  VALUES (least(p_a, p_b), greatest(p_a, p_b), p_status, p_user)
  RETURNING id
$fn$;

-- family shape (all values already cleaned by the API):
--   you       { given_name, surname, gender, birth: {value, precision} | null }
--   partner   null | { status, given_name, surname, married_surname, gender, deceased }
--   father, mother   null | { given_name, surname, gender, deceased }
--   parents_status   the relationship between father and mother when both are present
--   children  [ { given_name, surname, gender, birth, other_parent: 'partner' | 'none' } ]
CREATE FUNCTION kinship_auth.complete_setup_family(
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
    lineage_view, color_scheme, theme, date_format, surname_choice
  ) VALUES (
    lower(p_email), p_display_name, p_password_hash, 'superadmin', now(), 'setup',
    coalesce(p_settings ->> 'lineageView', 'adoptive'),
    coalesce(p_settings ->> 'colorScheme', 'forest'),
    coalesce(p_settings ->> 'theme', 'device'),
    coalesce(p_settings ->> 'dateFormat', 'mdy'),
    coalesce(p_settings ->> 'surnameChoice', 'married')
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

DO $$
DECLARE
  app_role text := current_setting('kinship.app_role', true);
BEGIN
  IF app_role IS NULL OR app_role = '' THEN
    RAISE EXCEPTION 'kinship.app_role is not set; run migrations through the KinShip migration runner';
  END IF;
  EXECUTE 'REVOKE ALL ON FUNCTION kinship_auth.setup_insert_person(uuid, jsonb) FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON FUNCTION kinship_auth.setup_insert_union(uuid, uuid, uuid, text) FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON FUNCTION kinship_auth.complete_setup_family(text, text, text, text, text, jsonb, jsonb) FROM PUBLIC';
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION kinship_auth.complete_setup_family(text, text, text, text, text, jsonb, jsonb) TO %I',
    app_role);
END
$$;
