-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- 0016: an admin links an existing account to a person (#8), changes the link, or removes it. Additive: no table, no
-- column and no data changes. See ADR 0020.
--
-- Why functions: the app role has no UPDATE on users.person_id (0002, 0005) and the policies on users let an account
-- change only its own row, so a column grant would let an account link ITSELF to anyone. Each function below checks who
-- is asking (an admin, and the hierarchy) before it writes.
--
--   kinship_auth.can_link_for(...)           the hierarchy, in one place (like can_invite_role, can_reset_for in 0011)
--   kinship_auth.check_link(user, person)    every rule for linking, no write; raises on the first one that fails
--   kinship_auth.link_account_person(...)    link or change the link; returns the person it was linked to before
--   kinship_auth.unlink_account_person(...)  remove the link; returns the person it was linked to
--   kinship_auth.link_preview(...)           advice for the admin before saving: what the account may edit afterwards
--
-- Who may link whom: a SuperAdmin links any account; a Family Admin links Member and User accounts; anyone who may
-- manage accounts may link their own account.
--
-- Error codes (SQLSTATE; the API turns them into answers): KS010 forbidden, KS020 role_not_allowed, KS023
-- person_already_linked (another account has the person), KS024 person_not_found, KS025 account_not_found,
-- KS040 account_already_linked (the account's link is not what the caller thought it was), KS041 person_is_placeholder,
-- KS042 person_has_open_invitation, KS043 account_not_linked.
--
-- Also here, a fix: create_invitation (0011) accepted a placeholder ("Unknown father") as the person to link. It is
-- replaced below, same signature, with the placeholder check (KS041).
--
-- people has FORCE row-level security: these functions run as the owner but see people through the signed-in
-- admin's kinship.user_id, which is still set while they run (the same way create_invitation reads people).

CREATE FUNCTION kinship_auth.can_link_for(p_actor_id uuid, p_actor_role text, p_target_id uuid, p_target_role text)
RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT p_actor_id = p_target_id
      OR p_actor_role = 'superadmin'
      OR (p_actor_role = 'familyadmin' AND p_target_role IN ('member', 'user'))
$fn$;

-- Every rule for linking this account to this person, in this order. Returns the account's role and current person.
CREATE FUNCTION kinship_auth.check_link(p_user_id uuid, p_person_id uuid)
RETURNS TABLE (account_role text, current_person_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  a record;
  v_role text;
  v_current uuid;
  v_placeholder boolean;
BEGIN
  SELECT * INTO a FROM kinship_auth.require_admin();
  SELECT u.role, u.person_id INTO v_role, v_current FROM public.users u WHERE u.id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'KS025';
  END IF;
  IF NOT kinship_auth.can_link_for(a.p_id, a.p_role, p_user_id, v_role) THEN
    RAISE EXCEPTION 'role_not_allowed' USING ERRCODE = 'KS020';
  END IF;
  SELECT p.is_placeholder INTO v_placeholder FROM public.people p WHERE p.id = p_person_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'person_not_found' USING ERRCODE = 'KS024';
  END IF;
  IF v_placeholder THEN
    RAISE EXCEPTION 'person_is_placeholder' USING ERRCODE = 'KS041';
  END IF;
  IF EXISTS (SELECT 1 FROM public.users u WHERE u.person_id = p_person_id AND u.id <> p_user_id) THEN
    RAISE EXCEPTION 'person_already_linked' USING ERRCODE = 'KS023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.account_links l
     WHERE l.kind = 'invite' AND l.person_id = p_person_id
       AND l.accepted_at IS NULL AND l.revoked_at IS NULL AND l.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'person_has_open_invitation' USING ERRCODE = 'KS042';
  END IF;
  RETURN QUERY SELECT v_role, v_current;
END
$fn$;

-- Links the account to the person (or changes its link). p_expected is the person the caller believes the account is
-- linked to now (NULL for none); if the account changed since, KS040 and nothing is written. Returns the previous person.
CREATE FUNCTION kinship_auth.link_account_person(p_user_id uuid, p_person_id uuid, p_expected uuid)
RETURNS TABLE (previous_person_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  c record;
BEGIN
  -- Two admins acting on the same account take turns.
  PERFORM 1 FROM public.users u WHERE u.id = p_user_id FOR UPDATE;
  SELECT * INTO c FROM kinship_auth.check_link(p_user_id, p_person_id);
  IF c.current_person_id IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'account_already_linked' USING ERRCODE = 'KS040';
  END IF;
  IF c.current_person_id IS DISTINCT FROM p_person_id THEN
    BEGIN
      UPDATE public.users u SET person_id = p_person_id, updated_at = now() WHERE u.id = p_user_id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'person_already_linked' USING ERRCODE = 'KS023';
    END;
  END IF;
  RETURN QUERY SELECT c.current_person_id;
END
$fn$;

CREATE FUNCTION kinship_auth.unlink_account_person(p_user_id uuid, p_expected uuid)
RETURNS TABLE (previous_person_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  a record;
  v_role text;
  v_current uuid;
BEGIN
  SELECT * INTO a FROM kinship_auth.require_admin();
  SELECT u.role, u.person_id INTO v_role, v_current FROM public.users u WHERE u.id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'KS025';
  END IF;
  IF NOT kinship_auth.can_link_for(a.p_id, a.p_role, p_user_id, v_role) THEN
    RAISE EXCEPTION 'role_not_allowed' USING ERRCODE = 'KS020';
  END IF;
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'account_not_linked' USING ERRCODE = 'KS043';
  END IF;
  IF v_current IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'account_already_linked' USING ERRCODE = 'KS040';
  END IF;
  UPDATE public.users u SET person_id = NULL, updated_at = now() WHERE u.id = p_user_id;
  RETURN QUERY SELECT v_current;
END
$fn$;

-- Advice, never a decision: the same rules as linking (so a refusal shows before saving), then what the account could
-- edit afterwards. Only a Member's edit rights depend on the link (0005): their own person, and the people they added
-- (created_by) who are that person's descendants. Other roles answer zeros.
--   descendants_in_line         everyone below the person (children, theirs and so on)
--   created_by_account_in_line  of those, the ones this account added: it may edit these afterwards
--   loses_edit                  people it may edit now through its current link and would not after the change
CREATE FUNCTION kinship_auth.link_preview(p_user_id uuid, p_person_id uuid)
RETURNS TABLE (account_role text, current_person_id uuid, descendants_in_line integer,
               created_by_account_in_line integer, loses_edit integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET jit = off
AS $fn$
#variable_conflict use_column
DECLARE
  c record;
  v_desc integer := 0;
  v_created integer := 0;
  v_loses integer := 0;
BEGIN
  SELECT * INTO c FROM kinship_auth.check_link(p_user_id, p_person_id);
  IF c.account_role = 'member' THEN
    WITH RECURSIVE below(root, id) AS (
      SELECT r, r FROM unnest(ARRAY[p_person_id, c.current_person_id]) AS r WHERE r IS NOT NULL
      UNION
      SELECT b.root, x.cid
        FROM below b,
        LATERAL (
          SELECT pp.child_id AS cid FROM public.person_parents pp WHERE pp.parent_id = b.id
          UNION
          SELECT pp.child_id FROM public.unions un JOIN public.person_parents pp ON pp.union_id = un.id
           WHERE b.id IN (un.partner_a_id, un.partner_b_id)
        ) x
    ),
    editable AS (
      SELECT b.root, b.id FROM below b
       WHERE b.id = b.root
          OR EXISTS (SELECT 1 FROM public.people p WHERE p.id = b.id AND p.created_by = p_user_id)
    )
    SELECT
      (SELECT count(*) FROM below b WHERE b.root = p_person_id AND b.id <> p_person_id),
      (SELECT count(*) FROM editable e WHERE e.root = p_person_id AND e.id <> p_person_id),
      CASE WHEN c.current_person_id IS NULL OR c.current_person_id = p_person_id THEN 0 ELSE
        (SELECT count(*) FROM editable cur WHERE cur.root = c.current_person_id
            AND NOT EXISTS (SELECT 1 FROM editable nw WHERE nw.root = p_person_id AND nw.id = cur.id))
      END
    INTO v_desc, v_created, v_loses;
  END IF;
  RETURN QUERY SELECT c.account_role, c.current_person_id, v_desc, v_created, v_loses;
END
$fn$;

-- ---------------------------------------------------------------------------
-- The fix. 0011's create_invitation, unchanged except for the placeholder check after "person exists".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kinship_auth.create_invitation(
  p_email text, p_role text, p_person_id uuid, p_note text, p_token_hash text
) RETURNS TABLE (id uuid, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  a record;
  v_email text := lower(btrim(p_email));
BEGIN
  SELECT * INTO a FROM kinship_auth.require_admin();
  IF NOT kinship_auth.can_invite_role(a.p_role, p_role) THEN
    RAISE EXCEPTION 'role_not_allowed' USING ERRCODE = 'KS020';
  END IF;
  IF EXISTS (SELECT 1 FROM public.users u WHERE lower(u.email) = v_email) THEN
    RAISE EXCEPTION 'email_taken' USING ERRCODE = 'KS021';
  END IF;
  IF p_person_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.people p WHERE p.id = p_person_id) THEN
      RAISE EXCEPTION 'person_not_found' USING ERRCODE = 'KS024';
    END IF;
    IF EXISTS (SELECT 1 FROM public.people p WHERE p.id = p_person_id AND p.is_placeholder) THEN
      RAISE EXCEPTION 'person_is_placeholder' USING ERRCODE = 'KS041';
    END IF;
    IF EXISTS (SELECT 1 FROM public.users u WHERE u.person_id = p_person_id) THEN
      RAISE EXCEPTION 'person_already_linked' USING ERRCODE = 'KS023';
    END IF;
  END IF;
  -- An invitation that ran out of time is not "open" any more: retire it so it cannot block this one.
  UPDATE public.account_links l SET revoked_at = now()
   WHERE l.kind = 'invite' AND l.accepted_at IS NULL AND l.revoked_at IS NULL AND l.expires_at <= now()
     AND (lower(l.email) = v_email OR (p_person_id IS NOT NULL AND l.person_id = p_person_id));
  BEGIN
    RETURN QUERY
      INSERT INTO public.account_links (kind, token_hash, expires_at, created_by, email, role, person_id, note)
      VALUES ('invite', p_token_hash, now() + interval '7 days', a.p_id, v_email, p_role, p_person_id,
              nullif(btrim(p_note), ''))
      RETURNING public.account_links.id, public.account_links.expires_at;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'invitation_exists' USING ERRCODE = 'KS022';
  END;
END
$fn$;

-- ---------------------------------------------------------------------------
-- Rights, as in 0011: nothing for PUBLIC, execute for the app role.
-- ---------------------------------------------------------------------------
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA kinship_auth FROM PUBLIC;

DO $$
DECLARE
  app_role text := current_setting('kinship.app_role', true);
BEGIN
  IF app_role IS NULL OR app_role = '' THEN
    RAISE EXCEPTION 'kinship.app_role is not set; run migrations through the KinShip migration runner';
  END IF;
  EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA kinship_auth TO %I', app_role);
END
$$;
