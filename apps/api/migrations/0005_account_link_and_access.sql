-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- 0005: link an account to one person, who may do what to people and relationships,
-- and first-run setup that can create the first person.
--
-- How a request reaches these rules: the API sets ONE transaction-local setting,
-- kinship.user_id (see request-context.ts). Everything else, the account's role and the
-- person it is linked to, is looked up here in the database, so it cannot disagree with the
-- users table and the API has no second value to get wrong.
--
-- Who may do what (the same rules are checked, with clearer errors, by the API):
--   SuperAdmin, Family Admin  read, add, change and delete everything on the tree.
--   Member                    reads everything; changes the person they are linked to and
--                             people they added who are still their descendants; adds
--                             children under themselves or their descendants (the child's
--                             other parent can only be someone they are already partnered
--                             with); changes the status and dates of their own unions.
--                             Cannot delete, and cannot add parents, partners or siblings.
--   User                      reads everything, changes nothing.

-- ---------------------------------------------------------------------------
-- The link: at most one person per account, and one account per person.
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN person_id uuid UNIQUE REFERENCES people (id) ON DELETE SET NULL;

DO $$
DECLARE
  app_role text := current_setting('kinship.app_role', true);
BEGIN
  IF app_role IS NULL OR app_role = '' THEN
    RAISE EXCEPTION 'kinship.app_role is not set; run migrations through the KinShip migration runner';
  END IF;
  EXECUTE format('GRANT SELECT (person_id) ON users TO %I', app_role);
END
$$;

-- ---------------------------------------------------------------------------
-- Helpers. SECURITY DEFINER with a fixed search_path, so their answers do not depend on
-- what the caller may see (a Member could not otherwise read the users table).
-- They read only the signed-in account's own role and person.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.kinship_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT u.role FROM public.users u WHERE u.id = public.kinship_user_id() $fn$;

CREATE FUNCTION public.kinship_person_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT u.person_id FROM public.users u WHERE u.id = public.kinship_user_id() $fn$;

CREATE FUNCTION public.kinship_is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT coalesce((SELECT u.role IN ('superadmin', 'familyadmin') FROM public.users u WHERE u.id = public.kinship_user_id()), false) $fn$;

-- True when the signed-in account's person is this person or one of their ancestors, that is,
-- when this person is "in my line": me, my children, their children and so on.
-- It walks UP from the candidate, which is a short walk (a person has few ancestors).
CREATE FUNCTION public.kinship_in_my_line(p_person uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_me uuid := public.kinship_person_id();
BEGIN
  IF v_me IS NULL OR p_person IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    WITH RECURSIVE up(id) AS (
      SELECT p_person
      UNION
      SELECT x.pid FROM up, LATERAL public.kinship_parent_ids(up.id) AS x(pid)
    )
    SELECT 1 FROM up WHERE id = v_me
  );
END
$fn$;

-- May the signed-in account change this person's details?
CREATE FUNCTION public.kinship_can_edit_person(p_id uuid, p_created_by uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE public.kinship_role()
    WHEN 'superadmin' THEN true
    WHEN 'familyadmin' THEN true
    WHEN 'member' THEN p_id = public.kinship_person_id()
                       OR (p_created_by IS NOT NULL AND p_created_by = public.kinship_user_id()
                           AND public.kinship_in_my_line(p_id))
    ELSE false
  END
$fn$;

-- May the signed-in account change this union (status and dates)? Admins always; a Member
-- when they are one of the two partners.
CREATE FUNCTION public.kinship_can_edit_union(p_a uuid, p_b uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE public.kinship_role()
    WHEN 'superadmin' THEN true
    WHEN 'familyadmin' THEN true
    WHEN 'member' THEN public.kinship_person_id() IN (p_a, p_b)
    ELSE false
  END
$fn$;

-- May the signed-in account hang this (new) child from a union or a single parent? A Member
-- only for a child they added themselves, under someone in their line.
CREATE FUNCTION public.kinship_can_attach_child(p_child uuid, p_union uuid, p_parent uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_role text := public.kinship_role();
  v_a uuid;
  v_b uuid;
BEGIN
  IF v_role IN ('superadmin', 'familyadmin') THEN
    RETURN true;
  END IF;
  IF v_role IS DISTINCT FROM 'member' THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.people c WHERE c.id = p_child AND c.created_by = public.kinship_user_id()) THEN
    RETURN false;
  END IF;
  IF p_union IS NOT NULL THEN
    SELECT partner_a_id, partner_b_id INTO v_a, v_b FROM public.unions WHERE id = p_union;
    RETURN public.kinship_in_my_line(v_a) OR public.kinship_in_my_line(v_b);
  END IF;
  RETURN public.kinship_in_my_line(p_parent);
END
$fn$;

-- Is an account linked to this person? (The users table is invisible to everyone but its owner.)
CREATE FUNCTION public.kinship_person_has_account(p_person uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT (SELECT public.kinship_role()) IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.users u WHERE u.person_id = p_person)
$fn$;

-- ---------------------------------------------------------------------------
-- Policies. Everyone signed in (with a real account) can read the whole tree; writes follow
-- the rules above. (Medical and DNA data, 0.6 and later, get their own tables and policies.)
-- Wrapping a helper in (SELECT ...) lets Postgres evaluate it once per statement, not per row.
-- ---------------------------------------------------------------------------
CREATE POLICY people_select ON people FOR SELECT
  USING ((SELECT public.kinship_role()) IS NOT NULL);
CREATE POLICY people_insert ON people FOR INSERT
  WITH CHECK (
    created_by = public.kinship_user_id()
    AND (SELECT public.kinship_role()) IN ('superadmin', 'familyadmin', 'member')
  );
CREATE POLICY people_update ON people FOR UPDATE
  USING (public.kinship_can_edit_person(id, created_by))
  WITH CHECK (public.kinship_can_edit_person(id, created_by));
CREATE POLICY people_delete ON people FOR DELETE
  USING ((SELECT public.kinship_is_admin()));

CREATE POLICY unions_select ON unions FOR SELECT
  USING ((SELECT public.kinship_role()) IS NOT NULL);
CREATE POLICY unions_insert ON unions FOR INSERT
  WITH CHECK ((SELECT public.kinship_is_admin()) AND created_by = public.kinship_user_id());
CREATE POLICY unions_update ON unions FOR UPDATE
  USING (public.kinship_can_edit_union(partner_a_id, partner_b_id))
  WITH CHECK (public.kinship_can_edit_union(partner_a_id, partner_b_id));
CREATE POLICY unions_delete ON unions FOR DELETE
  USING ((SELECT public.kinship_is_admin()));

CREATE POLICY person_parents_select ON person_parents FOR SELECT
  USING ((SELECT public.kinship_role()) IS NOT NULL);
CREATE POLICY person_parents_insert ON person_parents FOR INSERT
  WITH CHECK (created_by = public.kinship_user_id() AND public.kinship_can_attach_child(child_id, union_id, parent_id));
CREATE POLICY person_parents_update ON person_parents FOR UPDATE
  USING ((SELECT public.kinship_is_admin()))
  WITH CHECK ((SELECT public.kinship_is_admin()));
CREATE POLICY person_parents_delete ON person_parents FOR DELETE
  USING ((SELECT public.kinship_is_admin()));

-- ---------------------------------------------------------------------------
-- First-run setup, now able to create and link the first person.
-- Same as kinship_auth.complete_setup in 0002 plus an optional person. Both names must be
-- given, or neither. The old five-argument function stays (a later release can drop it, as
-- a contract step); the API uses this one.
--
-- The person is inserted as the new account, by setting kinship.user_id for this
-- transaction, so it passes the same insert policy as every other person (the function runs
-- as the owner, and row-level security is forced on people).
-- ---------------------------------------------------------------------------
CREATE FUNCTION kinship_auth.complete_setup(
  p_token_hash text, p_email text, p_display_name text, p_password_hash text, p_tree_name text,
  p_given_name text, p_surname text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_user_id uuid;
  v_person_id uuid;
  v_previous text;
BEGIN
  IF (p_given_name IS NULL) <> (p_surname IS NULL) THEN
    RAISE EXCEPTION 'given name and surname go together';
  END IF;

  PERFORM pg_advisory_xact_lock(7302041119);
  IF EXISTS (SELECT 1 FROM public.users) THEN
    RAISE EXCEPTION 'setup_already_done' USING ERRCODE = 'KS001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.setup_token WHERE token_hash = p_token_hash) THEN
    RAISE EXCEPTION 'invalid_setup_token' USING ERRCODE = 'KS002';
  END IF;

  INSERT INTO public.users (email, display_name, password_hash, role)
    VALUES (lower(p_email), p_display_name, p_password_hash, 'superadmin')
    RETURNING id INTO v_user_id;
  INSERT INTO public.family_tree (id, name) VALUES (true, p_tree_name);

  IF p_given_name IS NOT NULL THEN
    v_previous := current_setting('kinship.user_id', true);
    PERFORM set_config('kinship.user_id', v_user_id::text, true);
    INSERT INTO public.people (given_name, surname, created_by)
      VALUES (p_given_name, p_surname, v_user_id)
      RETURNING id INTO v_person_id;
    UPDATE public.users SET person_id = v_person_id WHERE id = v_user_id;
    PERFORM set_config('kinship.user_id', coalesce(v_previous, ''), true);
  END IF;

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
  EXECUTE 'REVOKE ALL ON FUNCTION kinship_auth.complete_setup(text, text, text, text, text, text, text) FROM PUBLIC';
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION kinship_auth.complete_setup(text, text, text, text, text, text, text) TO %I', app_role);
END
$$;
