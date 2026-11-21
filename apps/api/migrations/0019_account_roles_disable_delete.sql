-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- 0019: change an account's role, disable and enable an account, delete an account (#57, #56). See ADR 0029.
-- Additive (expand only): one nullable column, new functions, two triggers, and a few functions replaced with the same
-- signature. No data changes: every existing account stays active.
--
--   users.disabled_at                        NULL means active. A disabled account cannot sign in, has no sessions and no
--                                            open set-password link. Its person link, history and shares are kept.
--   kinship_auth.can_change_role_for(...)    the hierarchy for role changes, in one place (like can_invite_role)
--   kinship_auth.can_disable_for(...)        the hierarchy for disable, enable and delete
--   kinship_auth.lock_superadmins()          one advisory lock, taken before anything is counted
--   kinship_auth.other_active_superadmins()  the guard is a COUNT of the active SuperAdmins that would remain
--   kinship_auth.change_account_role / disable_account / enable_account / delete_account / delete_preview
--   kinship_auth.guard_last_superadmin()     the backstop: two row triggers on users that refuse, whoever runs the SQL
--                                            (an admin action, the CLI, the owner at a psql prompt), to demote, disable or
--                                            delete the last active SuperAdmin
--
-- Order of checks in every admin function: who is asking (KS010), the account exists (KS025), self (KS045), the matrix
-- (KS020), the last-SuperAdmin guard (KS044), then the state of the account (KS046, KS048, KS049). Authorization before state.
--
-- Error codes: KS044 last_superadmin, KS045 self_not_allowed, KS046 account_role_changed (the page was stale),
-- KS047 account_disabled, KS048 account_not_disabled, KS049 confirmation_mismatch. KS010, KS020, KS025 are as before.
--
-- Replaced with the same signature (CREATE OR REPLACE): find_login and resolve_session leave out disabled accounts (so a
-- disabled account gets exactly the answer a wrong password gets), create_session refuses one, create_reset_link refuses
-- one (KS047), accept_reset treats a link for one as invalid (KS030).
--
-- Escape hatch for the triggers, for an owner who really means it: ALTER TABLE users DISABLE TRIGGER users_keep_a_superadmin_update
-- (and ..._delete). TRUNCATE does not fire them.

ALTER TABLE users ADD COLUMN disabled_at timestamptz;

DO $$
DECLARE
  app_role text := current_setting('kinship.app_role', true);
BEGIN
  IF app_role IS NULL OR app_role = '' THEN
    RAISE EXCEPTION 'kinship.app_role is not set; run migrations through the KinShip migration runner';
  END IF;
  -- Read only. Admins read it through users_select_admin; nothing writes it except the functions below.
  EXECUTE format('GRANT SELECT (disabled_at) ON users TO %I', app_role);
END
$$;

-- ---------------------------------------------------------------------------
-- The hierarchy. Self is checked separately (KS045), so these take roles only.
-- ---------------------------------------------------------------------------
-- A SuperAdmin sets Family Admin, Member or User on any account that is not a SuperAdmin; a Family Admin switches a Member
-- or a User between Member and User. Nobody can set SuperAdmin, and in 0.3 a SuperAdmin account is never the target.
CREATE FUNCTION kinship_auth.can_change_role_for(p_actor_role text, p_target_role text, p_new_role text)
RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT p_target_role IN ('familyadmin', 'member', 'user')
     AND p_new_role IN ('familyadmin', 'member', 'user')
     AND (p_actor_role = 'superadmin'
          OR (p_actor_role = 'familyadmin' AND p_target_role IN ('member', 'user') AND p_new_role IN ('member', 'user')))
$fn$;

-- Disable, enable and delete: a SuperAdmin any account, a Family Admin a Member or a User.
CREATE FUNCTION kinship_auth.can_disable_for(p_actor_role text, p_target_role text)
RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT p_actor_role = 'superadmin' OR (p_actor_role = 'familyadmin' AND p_target_role IN ('member', 'user'))
$fn$;

-- ---------------------------------------------------------------------------
-- The last-SuperAdmin guard: a count of the active SuperAdmins that would remain, never "there is only one".
-- ---------------------------------------------------------------------------
CREATE FUNCTION kinship_auth.lock_superadmins() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT pg_advisory_xact_lock(7302041121) $fn$;

CREATE FUNCTION kinship_auth.other_active_superadmins(p_excluding uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT count(*)::integer FROM public.users u
   WHERE u.role = 'superadmin' AND u.disabled_at IS NULL AND u.id <> p_excluding
$fn$;

-- The backstop. Both triggers fire only for an ACTIVE SuperAdmin being made not-a-SuperAdmin, disabled, or deleted, so a
-- normal sign-in or settings change never runs it. It takes the same advisory lock as the functions, so two SuperAdmins
-- cannot remove each other at the same moment. (A WHEN clause cannot read NEW on DELETE, hence two triggers.)
CREATE FUNCTION kinship_auth.guard_last_superadmin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  PERFORM pg_advisory_xact_lock(7302041121);
  IF kinship_auth.other_active_superadmins(OLD.id) = 0 THEN
    RAISE EXCEPTION 'last_superadmin' USING ERRCODE = 'KS044';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER users_keep_a_superadmin_update BEFORE UPDATE ON users
  FOR EACH ROW
  WHEN (OLD.role = 'superadmin' AND OLD.disabled_at IS NULL AND (NEW.role <> 'superadmin' OR NEW.disabled_at IS NOT NULL))
  EXECUTE FUNCTION kinship_auth.guard_last_superadmin();

CREATE TRIGGER users_keep_a_superadmin_delete BEFORE DELETE ON users
  FOR EACH ROW
  WHEN (OLD.role = 'superadmin' AND OLD.disabled_at IS NULL)
  EXECUTE FUNCTION kinship_auth.guard_last_superadmin();

-- ---------------------------------------------------------------------------
-- Role change. p_expected is the role the caller believes the account has (a stale page is KS046 and changes nothing).
-- Setting the role it already has is a no-op. Returns the previous role.
-- ---------------------------------------------------------------------------
CREATE FUNCTION kinship_auth.change_account_role(p_user_id uuid, p_role text, p_expected text)
RETURNS TABLE (previous_role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  a record;
  v_role text;
BEGIN
  SELECT * INTO a FROM kinship_auth.require_admin();
  PERFORM kinship_auth.lock_superadmins();
  SELECT u.role INTO v_role FROM public.users u WHERE u.id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'KS025';
  END IF;
  IF a.p_id = p_user_id THEN
    RAISE EXCEPTION 'self_not_allowed' USING ERRCODE = 'KS045';
  END IF;
  IF NOT kinship_auth.can_change_role_for(a.p_role, v_role, p_role) THEN
    RAISE EXCEPTION 'role_not_allowed' USING ERRCODE = 'KS020';
  END IF;
  IF v_role = 'superadmin' AND p_role <> 'superadmin' AND kinship_auth.other_active_superadmins(p_user_id) = 0 THEN
    RAISE EXCEPTION 'last_superadmin' USING ERRCODE = 'KS044';
  END IF;
  IF v_role IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'account_role_changed' USING ERRCODE = 'KS046';
  END IF;
  IF v_role <> p_role THEN
    UPDATE public.users u SET role = p_role, updated_at = now() WHERE u.id = p_user_id;
  END IF;
  RETURN QUERY SELECT v_role;
END
$fn$;

-- ---------------------------------------------------------------------------
-- Disable and enable. Disable ends the account's sessions and revokes its open set-password link, at once.
-- Both return whether anything changed (an account already in that state is a no-op) and the account's disabled_at.
-- ---------------------------------------------------------------------------
CREATE FUNCTION kinship_auth.disable_account(p_user_id uuid)
RETURNS TABLE (changed boolean, disabled_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  a record;
  v_role text;
  v_disabled timestamptz;
BEGIN
  SELECT * INTO a FROM kinship_auth.require_admin();
  PERFORM kinship_auth.lock_superadmins();
  SELECT u.role, u.disabled_at INTO v_role, v_disabled FROM public.users u WHERE u.id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'KS025';
  END IF;
  IF a.p_id = p_user_id THEN
    RAISE EXCEPTION 'self_not_allowed' USING ERRCODE = 'KS045';
  END IF;
  IF NOT kinship_auth.can_disable_for(a.p_role, v_role) THEN
    RAISE EXCEPTION 'role_not_allowed' USING ERRCODE = 'KS020';
  END IF;
  IF v_disabled IS NOT NULL THEN
    RETURN QUERY SELECT false, v_disabled;
    RETURN;
  END IF;
  IF v_role = 'superadmin' AND kinship_auth.other_active_superadmins(p_user_id) = 0 THEN
    RAISE EXCEPTION 'last_superadmin' USING ERRCODE = 'KS044';
  END IF;
  UPDATE public.users u SET disabled_at = now(), updated_at = now() WHERE u.id = p_user_id RETURNING u.disabled_at INTO v_disabled;
  DELETE FROM public.sessions s WHERE s.user_id = p_user_id;
  UPDATE public.account_links l SET revoked_at = now()
   WHERE l.kind = 'reset' AND l.user_id = p_user_id AND l.accepted_at IS NULL AND l.revoked_at IS NULL;
  RETURN QUERY SELECT true, v_disabled;
END
$fn$;

CREATE FUNCTION kinship_auth.enable_account(p_user_id uuid)
RETURNS TABLE (changed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  a record;
  v_role text;
  v_disabled timestamptz;
BEGIN
  SELECT * INTO a FROM kinship_auth.require_admin();
  SELECT u.role, u.disabled_at INTO v_role, v_disabled FROM public.users u WHERE u.id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'KS025';
  END IF;
  IF a.p_id = p_user_id THEN
    RAISE EXCEPTION 'self_not_allowed' USING ERRCODE = 'KS045';
  END IF;
  IF NOT kinship_auth.can_disable_for(a.p_role, v_role) THEN
    RAISE EXCEPTION 'role_not_allowed' USING ERRCODE = 'KS020';
  END IF;
  IF v_disabled IS NULL THEN
    RETURN QUERY SELECT false;
    RETURN;
  END IF;
  UPDATE public.users u SET disabled_at = NULL, updated_at = now() WHERE u.id = p_user_id;
  RETURN QUERY SELECT true;
END
$fn$;

-- ---------------------------------------------------------------------------
-- Delete. Only an account that is already disabled, with the account's email typed (trim, ignoring case). The linked person
-- and their record are never touched. created_by, updated_by and the inviter's link become NULL (the foreign keys say so);
-- the invitation rows this account accepted hold its email address, so they are deleted with it; its sessions and
-- set-password links go by cascade.
-- ---------------------------------------------------------------------------
CREATE FUNCTION kinship_auth.delete_account(p_user_id uuid, p_confirm_email text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  a record;
  v_role text;
  v_email text;
  v_disabled timestamptz;
BEGIN
  SELECT * INTO a FROM kinship_auth.require_admin();
  PERFORM kinship_auth.lock_superadmins();
  SELECT u.role, u.email, u.disabled_at INTO v_role, v_email, v_disabled FROM public.users u WHERE u.id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'KS025';
  END IF;
  IF a.p_id = p_user_id THEN
    RAISE EXCEPTION 'self_not_allowed' USING ERRCODE = 'KS045';
  END IF;
  IF NOT kinship_auth.can_disable_for(a.p_role, v_role) THEN
    RAISE EXCEPTION 'role_not_allowed' USING ERRCODE = 'KS020';
  END IF;
  IF v_role = 'superadmin' AND v_disabled IS NULL AND kinship_auth.other_active_superadmins(p_user_id) = 0 THEN
    RAISE EXCEPTION 'last_superadmin' USING ERRCODE = 'KS044';
  END IF;
  IF v_disabled IS NULL THEN
    RAISE EXCEPTION 'account_not_disabled' USING ERRCODE = 'KS048';
  END IF;
  IF lower(btrim(coalesce(p_confirm_email, ''))) IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'confirmation_mismatch' USING ERRCODE = 'KS049';
  END IF;
  DELETE FROM public.account_links l WHERE l.accepted_user_id = p_user_id;
  DELETE FROM public.users u WHERE u.id = p_user_id;
END
$fn$;

-- Advice before a delete, not a decision: the same checks as far as the matrix, then how many people this account added
-- (they stay, but only an admin can edit them afterwards) and whether it is disabled yet.
CREATE FUNCTION kinship_auth.delete_preview(p_user_id uuid)
RETURNS TABLE (account_role text, is_disabled boolean, people_added bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  a record;
  v_role text;
  v_disabled timestamptz;
BEGIN
  SELECT * INTO a FROM kinship_auth.require_admin();
  SELECT u.role, u.disabled_at INTO v_role, v_disabled FROM public.users u WHERE u.id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'KS025';
  END IF;
  IF a.p_id = p_user_id THEN
    RAISE EXCEPTION 'self_not_allowed' USING ERRCODE = 'KS045';
  END IF;
  IF NOT kinship_auth.can_disable_for(a.p_role, v_role) THEN
    RAISE EXCEPTION 'role_not_allowed' USING ERRCODE = 'KS020';
  END IF;
  RETURN QUERY
    SELECT v_role, v_disabled IS NOT NULL,
           (SELECT count(*) FROM public.people p WHERE p.created_by = p_user_id AND NOT p.is_placeholder);
END
$fn$;

-- ---------------------------------------------------------------------------
-- Existing functions that now leave out a disabled account (same signatures).
-- ---------------------------------------------------------------------------
-- A disabled account is "no row", so sign-in gives the same answer and takes the same path as a wrong password.
CREATE OR REPLACE FUNCTION kinship_auth.find_login(p_email text) RETURNS TABLE (user_id uuid, password_hash text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT u.id, u.password_hash FROM public.users u WHERE u.email = lower(p_email) AND u.disabled_at IS NULL $fn$;

-- Same as 0011, and no session for a disabled account (a second guard: its sessions are deleted when it is disabled).
CREATE OR REPLACE FUNCTION kinship_auth.create_session(
  p_user_id uuid, p_token_hash text, p_idle_seconds integer, p_absolute_seconds integer
) RETURNS TABLE (expires_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH ok AS (
    SELECT 1 FROM public.users x WHERE x.id = p_user_id AND x.disabled_at IS NULL
  ), s AS (
    INSERT INTO public.sessions (user_id, token_hash, expires_at, absolute_expires_at)
    SELECT p_user_id, p_token_hash,
           now() + make_interval(secs => LEAST(p_idle_seconds, p_absolute_seconds)),
           now() + make_interval(secs => p_absolute_seconds)
      FROM ok
    RETURNING public.sessions.expires_at
  ), u AS (
    UPDATE public.users SET last_sign_in_at = now() WHERE id = p_user_id AND disabled_at IS NULL
  )
  SELECT s.expires_at FROM s
$fn$;

-- Same as 0002, and a session whose account is disabled resolves to nobody.
CREATE OR REPLACE FUNCTION kinship_auth.resolve_session(p_token_hash text, p_idle_seconds integer)
RETURNS TABLE (user_id uuid, email text, display_name text, role text, expires_at timestamptz, renewed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  s public.sessions%ROWTYPE;
  v_renewed boolean := false;
BEGIN
  SELECT * INTO s FROM public.sessions
    WHERE token_hash = p_token_hash AND expires_at > now() AND absolute_expires_at > now();
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF s.last_seen_at < now() - interval '1 minute' THEN
    UPDATE public.sessions
       SET last_seen_at = now(),
           expires_at = LEAST(now() + make_interval(secs => p_idle_seconds), absolute_expires_at)
     WHERE id = s.id
     RETURNING public.sessions.expires_at INTO s.expires_at;
    v_renewed := true;
  END IF;
  RETURN QUERY
    SELECT u.id, u.email, u.display_name, u.role, s.expires_at, v_renewed
    FROM public.users u WHERE u.id = s.user_id AND u.disabled_at IS NULL;
END
$fn$;

-- Same as 0011, and no new set-password link for a disabled account (accepting one would start a session). The matrix is
-- checked first, then the state.
CREATE OR REPLACE FUNCTION kinship_auth.create_reset_link(p_user_id uuid, p_token_hash text)
RETURNS TABLE (id uuid, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  a record;
  v_target_role text;
  v_disabled timestamptz;
BEGIN
  SELECT * INTO a FROM kinship_auth.require_admin();
  SELECT u.role, u.disabled_at INTO v_target_role, v_disabled FROM public.users u WHERE u.id = p_user_id;
  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'KS025';
  END IF;
  IF NOT kinship_auth.can_reset_for(a.p_id, a.p_role, p_user_id, v_target_role) THEN
    RAISE EXCEPTION 'role_not_allowed' USING ERRCODE = 'KS020';
  END IF;
  IF v_disabled IS NOT NULL THEN
    RAISE EXCEPTION 'account_disabled' USING ERRCODE = 'KS047';
  END IF;
  UPDATE public.account_links l SET revoked_at = now()
   WHERE l.kind = 'reset' AND l.user_id = p_user_id AND l.accepted_at IS NULL AND l.revoked_at IS NULL
     AND l.expires_at <= now();
  BEGIN
    RETURN QUERY
      INSERT INTO public.account_links (kind, token_hash, expires_at, created_by, user_id)
      VALUES ('reset', p_token_hash, now() + interval '24 hours', a.p_id, p_user_id)
      RETURNING public.account_links.id, public.account_links.expires_at;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'link_exists' USING ERRCODE = 'KS027';
  END;
END
$fn$;

-- Same as 0011, and a link for a disabled account is just an invalid link (nothing is claimed, no session follows).
CREATE OR REPLACE FUNCTION kinship_auth.accept_reset(p_token_hash text, p_password_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  l public.account_links;
BEGIN
  UPDATE public.account_links x SET accepted_at = now()
   WHERE x.token_hash = p_token_hash AND x.kind = 'reset'
     AND x.accepted_at IS NULL AND x.revoked_at IS NULL AND x.expires_at > now()
     AND EXISTS (SELECT 1 FROM public.users t WHERE t.id = x.user_id AND t.disabled_at IS NULL)
  RETURNING x.* INTO l;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_link' USING ERRCODE = 'KS030';
  END IF;
  UPDATE public.users u
     SET password_hash = p_password_hash, password_changed_at = now(), password_changed_via = 'admin_link',
         updated_at = now()
   WHERE u.id = l.user_id;
  DELETE FROM public.sessions s WHERE s.user_id = l.user_id;
  RETURN l.user_id;
END
$fn$;

-- ---------------------------------------------------------------------------
-- What the app role may run: these by name only. (0011's ALL FUNCTIONS form would also hand it setup_insert_person
-- and setup_insert_union, which 0012 keeps away from it.) The guard, the lock and the count are internal.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  kinship_auth.can_change_role_for(text, text, text),
  kinship_auth.can_disable_for(text, text),
  kinship_auth.lock_superadmins(),
  kinship_auth.other_active_superadmins(uuid),
  kinship_auth.guard_last_superadmin(),
  kinship_auth.change_account_role(uuid, text, text),
  kinship_auth.disable_account(uuid),
  kinship_auth.enable_account(uuid),
  kinship_auth.delete_account(uuid, text),
  kinship_auth.delete_preview(uuid)
FROM PUBLIC;

DO $$
DECLARE
  app_role text := current_setting('kinship.app_role', true);
BEGIN
  IF app_role IS NULL OR app_role = '' THEN
    RAISE EXCEPTION 'kinship.app_role is not set; run migrations through the KinShip migration runner';
  END IF;
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION kinship_auth.change_account_role(uuid, text, text), kinship_auth.disable_account(uuid), '
    'kinship_auth.enable_account(uuid), kinship_auth.delete_account(uuid, text), kinship_auth.delete_preview(uuid) TO %I',
    app_role
  );
END
$$;
