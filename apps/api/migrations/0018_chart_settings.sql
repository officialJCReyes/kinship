-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- 0018: the chart's own display settings, saved on the account (ADR 0027).
--
--   * users.tree_wheel               zoom (default) or scroll: what the mouse wheel does over a chart.
--   * users.tree_default_view        family (default), pedigree, fan or descendants: the chart that opens first from the menu or
--                                    after signing in. A link that names a view always wins.
--   * users.show_extended_relatives  false by default, for new AND existing accounts: aunts, uncles and cousins are not drawn in
--                                    the Family tree until an account turns this on (JC, Nov 18). Siblings, their partners and
--                                    their children are always drawn.
--   * users.show_deceased_mark       true by default: the dagger after the name of someone who has died (today's behaviour).
--
-- Additive only (expand): every existing account takes the defaults, nothing is dropped, and the previous release ignores the new
-- columns. The app role may read and update these four columns, like the settings of 0010 and 0017; users_update_own (0006) keeps an
-- update to the account's own row.
--
-- Runs as the owner role. The app role's name arrives in "kinship.app_role" (see 0001).
ALTER TABLE users
  ADD COLUMN tree_wheel text NOT NULL DEFAULT 'zoom'
    CHECK (tree_wheel IN ('zoom', 'scroll')),
  ADD COLUMN tree_default_view text NOT NULL DEFAULT 'family'
    CHECK (tree_default_view IN ('family', 'pedigree', 'fan', 'descendants')),
  ADD COLUMN show_extended_relatives boolean NOT NULL DEFAULT false,
  ADD COLUMN show_deceased_mark boolean NOT NULL DEFAULT true;

DO $$
DECLARE
  app_role text := current_setting('kinship.app_role', true);
BEGIN
  IF app_role IS NULL OR app_role = '' THEN
    RAISE EXCEPTION 'kinship.app_role is not set; run migrations through the KinShip migration runner';
  END IF;
  EXECUTE format(
    'GRANT SELECT (tree_wheel, tree_default_view, show_extended_relatives, show_deceased_mark), UPDATE (tree_wheel, tree_default_view, show_extended_relatives, show_deceased_mark) ON users TO %I',
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
    lineage_view, color_scheme, theme, date_format, name_form, show_prefix, show_suffix,
    tree_wheel, tree_default_view, show_extended_relatives, show_deceased_mark
  ) VALUES (
    lower(p_email), p_display_name, p_password_hash, 'superadmin', now(), 'setup',
    coalesce(p_settings ->> 'lineageView', 'adoptive'),
    coalesce(p_settings ->> 'colorScheme', 'forest'),
    coalesce(p_settings ->> 'theme', 'device'),
    coalesce(p_settings ->> 'dateFormat', 'mdy'),
    coalesce(p_settings ->> 'nameForm', 'maiden_married'),
    coalesce((p_settings ->> 'showPrefix')::boolean, true),
    coalesce((p_settings ->> 'showSuffix')::boolean, true),
    coalesce(p_settings ->> 'treeWheel', 'zoom'),
    coalesce(p_settings ->> 'treeDefaultView', 'family'),
    coalesce((p_settings ->> 'showExtendedRelatives')::boolean, false),
    coalesce((p_settings ->> 'showDeceasedMark')::boolean, true)
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
