-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- 0011: invitations and set-password links (account_links), and what an account remembers about itself.
--
-- One table, two kinds of link, both shown once and kept only as a SHA-256 hash:
--   invite  an admin invites an email address to join, with a role and optionally an existing person.
--   reset   an admin lets one account set a new password (the person is locked out of their own).
--
-- Who may do what (checked here, in the functions, and again with clearer errors by the API):
--   invite a role   SuperAdmin: Family Admin, Member, User.   Family Admin: Member, User.   Nobody: SuperAdmin.
--   set-password    SuperAdmin: anyone but themselves.   Family Admin: a Member or a User.
--   touch a link    (make a new one, revoke) only if you could have created it.
--
-- How the app role reaches this: account_links has NO grants for it. Row-level security is enabled with no
-- policy, so even a grant added by mistake would show nothing. It is not FORCED, on purpose: the SECURITY
-- DEFINER functions below run as the owner, and forcing a policy-less table on the owner would lock them out
-- (the same reason users and family_tree are not forced, see 0005). Every read and write goes through the
-- functions in kinship_auth, which have a fixed search_path and are executable by the app role only.
--
-- Additive only. Existing accounts keep working: the new columns are empty (password_changed_via NULL means
-- "unknown": it was set before KinShip recorded how).

-- ---------------------------------------------------------------------------
-- Email is unique ignoring case. The CHECK from 0002 already stores every address in lower case and the
-- unique index users_email_key (0002) is on that column, so a case-only duplicate has never been possible.
-- This index is on lower(email) itself, so the rule survives if the CHECK is ever relaxed. The guard turns a
-- hypothetical conflict into a clear message instead of a bare "could not create unique index".
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_clashes integer;
BEGIN
  SELECT count(*) INTO v_clashes FROM (
    SELECT lower(email) FROM users GROUP BY lower(email) HAVING count(*) > 1
  ) c;
  IF v_clashes > 0 THEN
    RAISE EXCEPTION 'migration 0011: % email address(es) are used by more than one account when case is ignored; give each account its own address and run the migration again', v_clashes;
  END IF;
END
$$;
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));

-- ---------------------------------------------------------------------------
-- What an account remembers about itself.
--   last_sign_in_at        set by create_session (below), so it is the time of the last sign-in or accepted link
--   password_changed_at    when the password last changed; NULL for accounts that predate this column
--   password_changed_via   how: setup, self (the account itself), admin_link (a set-password link from an admin),
--                          cli (the server owner's command), invitation (the password chosen when accepting).
--                          NULL means unknown (set before 0011). The owner of an account sees this on their Account
--                          card, so an admin-made reset is never invisible to the person it was made for.
-- ---------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN last_sign_in_at timestamptz,
  ADD COLUMN password_changed_at timestamptz,
  ADD COLUMN password_changed_via text
    CHECK (password_changed_via IN ('setup', 'self', 'admin_link', 'cli', 'invitation'));

-- Admins read every account (the Users page). The password hash stays out of reach: it has no column grant.
CREATE POLICY users_select_admin ON users FOR SELECT USING ((SELECT public.kinship_is_admin()));

-- ---------------------------------------------------------------------------
-- The table.
-- ---------------------------------------------------------------------------
CREATE TABLE account_links (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text        NOT NULL CHECK (kind IN ('invite', 'reset')),
  -- SHA-256 (hex) of the random token in the link. The token itself is never stored.
  token_hash       text        NOT NULL UNIQUE,
  expires_at       timestamptz NOT NULL,
  created_by       uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  accepted_at      timestamptz,
  revoked_at       timestamptz,
  -- kind = 'invite'
  email            text,
  role             text,
  person_id        uuid        REFERENCES people (id) ON DELETE CASCADE,
  note             text        CHECK (length(note) <= 500),
  accepted_user_id uuid        REFERENCES users (id) ON DELETE SET NULL,
  -- kind = 'reset'
  user_id          uuid        REFERENCES users (id) ON DELETE CASCADE,
  CHECK (
    (kind = 'invite' AND email IS NOT NULL AND email = lower(email) AND length(email) BETWEEN 3 AND 320
       AND role IN ('familyadmin', 'member', 'user') AND user_id IS NULL)
    OR
    (kind = 'reset' AND user_id IS NOT NULL AND email IS NULL AND role IS NULL AND person_id IS NULL
       AND note IS NULL AND accepted_user_id IS NULL)
  ),
  CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);
-- "Open" means not accepted and not revoked. An open link can already be past its expiry; create_invitation and
-- create_reset_link retire such a link first, so an expired link never blocks a new one.
CREATE UNIQUE INDEX account_links_open_email ON account_links (lower(email))
  WHERE kind = 'invite' AND accepted_at IS NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX account_links_open_person ON account_links (person_id)
  WHERE kind = 'invite' AND person_id IS NOT NULL AND accepted_at IS NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX account_links_open_reset ON account_links (user_id)
  WHERE kind = 'reset' AND accepted_at IS NULL AND revoked_at IS NULL;

ALTER TABLE account_links ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- The hierarchy, in one place.
-- ---------------------------------------------------------------------------
CREATE FUNCTION kinship_auth.can_invite_role(p_actor_role text, p_role text) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT (p_actor_role = 'superadmin' AND p_role IN ('familyadmin', 'member', 'user'))
      OR (p_actor_role = 'familyadmin' AND p_role IN ('member', 'user'))
$fn$;

CREATE FUNCTION kinship_auth.can_reset_for(p_actor_id uuid, p_actor_role text, p_target_id uuid, p_target_role text)
RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT p_actor_id IS DISTINCT FROM p_target_id
     AND (p_actor_role = 'superadmin' OR (p_actor_role = 'familyadmin' AND p_target_role IN ('member', 'user')))
$fn$;

-- The signed-in admin's id and role, or KS010 (forbidden). Admin-only functions start with it.
CREATE FUNCTION kinship_auth.require_admin(OUT p_id uuid, OUT p_role text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  p_id := public.kinship_user_id();
  p_role := public.kinship_role();
  IF p_id IS NULL OR p_role IS NULL OR p_role NOT IN ('superadmin', 'familyadmin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'KS010';
  END IF;
END
$fn$;

-- ---------------------------------------------------------------------------
-- Admin functions (they check who is asking themselves).
-- Error codes: KS010 forbidden, KS020 role_not_allowed, KS021 email_taken, KS022 invitation_exists,
-- KS023 person_already_linked, KS024 person_not_found, KS025 account_not_found, KS026 link_not_found,
-- KS027 link_exists. KS030 is the one generic answer of the public functions (invalid_link).
-- ---------------------------------------------------------------------------
CREATE FUNCTION kinship_auth.create_invitation(
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

CREATE FUNCTION kinship_auth.create_reset_link(p_user_id uuid, p_token_hash text)
RETURNS TABLE (id uuid, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  a record;
  v_target_role text;
BEGIN
  SELECT * INTO a FROM kinship_auth.require_admin();
  SELECT u.role INTO v_target_role FROM public.users u WHERE u.id = p_user_id;
  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'KS025';
  END IF;
  IF NOT kinship_auth.can_reset_for(a.p_id, a.p_role, p_user_id, v_target_role) THEN
    RAISE EXCEPTION 'role_not_allowed' USING ERRCODE = 'KS020';
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

-- May this admin touch this (locked) link row? Raises the right error when not.
CREATE FUNCTION kinship_auth.check_can_touch(p_admin_id uuid, p_admin_role text, l public.account_links) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_target_role text;
BEGIN
  IF l.kind = 'invite' THEN
    IF NOT kinship_auth.can_invite_role(p_admin_role, l.role) THEN
      RAISE EXCEPTION 'role_not_allowed' USING ERRCODE = 'KS020';
    END IF;
  ELSE
    SELECT u.role INTO v_target_role FROM public.users u WHERE u.id = l.user_id;
    IF NOT kinship_auth.can_reset_for(p_admin_id, p_admin_role, l.user_id, v_target_role) THEN
      RAISE EXCEPTION 'role_not_allowed' USING ERRCODE = 'KS020';
    END IF;
  END IF;
END
$fn$;

-- A new link in place of an open one: the old token stops working, the role stays, the clock restarts.
CREATE FUNCTION kinship_auth.regenerate_link(p_link_id uuid, p_token_hash text)
RETURNS TABLE (id uuid, expires_at timestamptz, kind text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  a record;
  l public.account_links;
BEGIN
  SELECT * INTO a FROM kinship_auth.require_admin();
  SELECT * INTO l FROM public.account_links x WHERE x.id = p_link_id AND x.accepted_at IS NULL AND x.revoked_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'link_not_found' USING ERRCODE = 'KS026';
  END IF;
  PERFORM kinship_auth.check_can_touch(a.p_id, a.p_role, l);
  RETURN QUERY
    UPDATE public.account_links x
       SET token_hash = p_token_hash,
           expires_at = now() + CASE x.kind WHEN 'invite' THEN interval '7 days' ELSE interval '24 hours' END
     WHERE x.id = l.id
    RETURNING x.id, x.expires_at, x.kind;
END
$fn$;

CREATE FUNCTION kinship_auth.revoke_link(p_link_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  a record;
  l public.account_links;
BEGIN
  SELECT * INTO a FROM kinship_auth.require_admin();
  SELECT * INTO l FROM public.account_links x WHERE x.id = p_link_id AND x.accepted_at IS NULL AND x.revoked_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'link_not_found' USING ERRCODE = 'KS026';
  END IF;
  PERFORM kinship_auth.check_can_touch(a.p_id, a.p_role, l);
  UPDATE public.account_links x SET revoked_at = now() WHERE x.id = l.id;
END
$fn$;

-- Open links (not accepted, not revoked), expired ones included so the page can say "Expired". Never the token.
-- can_manage says whether the asking admin could make a new link or revoke this one.
CREATE FUNCTION kinship_auth.list_open_links() RETURNS TABLE (
  id uuid, kind text, email text, role text, person_id uuid, note text, user_id uuid,
  created_at timestamptz, expires_at timestamptz, expired boolean,
  created_by uuid, created_by_name text, can_manage boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM kinship_auth.require_admin();
  RETURN QUERY
    SELECT l.id, l.kind, l.email, coalesce(l.role, t.role), l.person_id, l.note, l.user_id,
           l.created_at, l.expires_at, l.expires_at <= now(),
           l.created_by, c.display_name,
           CASE l.kind
             WHEN 'invite' THEN kinship_auth.can_invite_role(a.p_role, l.role)
             ELSE kinship_auth.can_reset_for(a.p_id, a.p_role, l.user_id, t.role)
           END
      FROM public.account_links l
      LEFT JOIN public.users c ON c.id = l.created_by
      LEFT JOIN public.users t ON t.id = l.user_id
     WHERE l.accepted_at IS NULL AND l.revoked_at IS NULL
     ORDER BY l.created_at DESC, l.id;
END
$fn$;

-- Who invited each account that was created by accepting an invitation (account_links is invisible to the app).
CREATE FUNCTION kinship_auth.list_inviters() RETURNS TABLE (user_id uuid, invited_by uuid, invited_by_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  PERFORM kinship_auth.require_admin();
  RETURN QUERY
    SELECT l.accepted_user_id, l.created_by, c.display_name
      FROM public.account_links l LEFT JOIN public.users c ON c.id = l.created_by
     WHERE l.kind = 'invite' AND l.accepted_user_id IS NOT NULL;
END
$fn$;

-- ---------------------------------------------------------------------------
-- Public functions (a link is the credential). Unknown, expired, used and revoked links all give the same
-- nothing: one indexed lookup by token_hash, then the conditions on the row it finds.
-- ---------------------------------------------------------------------------
CREATE FUNCTION kinship_auth.lookup_link(p_token_hash text) RETURNS TABLE (
  kind text, tree_name text, email text, role text, person_given_name text, person_surname text,
  note text, invited_by_name text, display_name text, expires_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT l.kind, (SELECT f.name FROM public.family_tree f), l.email, l.role, p.given_name, p.surname, l.note,
         c.display_name, t.display_name, l.expires_at
    FROM public.account_links l
    LEFT JOIN public.people p ON p.id = l.person_id
    LEFT JOIN public.users c ON c.id = l.created_by
    LEFT JOIN public.users t ON t.id = l.user_id
   WHERE l.token_hash = p_token_hash
     AND l.accepted_at IS NULL AND l.revoked_at IS NULL AND l.expires_at > now()
$fn$;

-- Accepts an invitation: one atomic UPDATE claims the link, then the account is created with the invited role,
-- the person link and the default settings. Anything wrong, including a race lost to another account taking the
-- email or the person, is KS030 and changes nothing (the claim is rolled back with the rest).
CREATE FUNCTION kinship_auth.accept_invitation(p_token_hash text, p_display_name text, p_password_hash text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  l public.account_links;
  v_name text;
  v_user_id uuid;
BEGIN
  UPDATE public.account_links x SET accepted_at = now()
   WHERE x.token_hash = p_token_hash AND x.kind = 'invite'
     AND x.accepted_at IS NULL AND x.revoked_at IS NULL AND x.expires_at > now()
  RETURNING x.* INTO l;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_link' USING ERRCODE = 'KS030';
  END IF;
  IF l.person_id IS NOT NULL THEN
    SELECT btrim(p.given_name || ' ' || p.surname) INTO v_name FROM public.people p WHERE p.id = l.person_id;
  END IF;
  v_name := coalesce(nullif(btrim(p_display_name), ''), v_name);
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'invalid_link' USING ERRCODE = 'KS030';
  END IF;
  BEGIN
    INSERT INTO public.users (email, display_name, password_hash, role, person_id, password_changed_at, password_changed_via)
    VALUES (l.email, v_name, p_password_hash, l.role, l.person_id, now(), 'invitation')
    RETURNING id INTO v_user_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'invalid_link' USING ERRCODE = 'KS030';
  END;
  UPDATE public.account_links x SET accepted_user_id = v_user_id WHERE x.id = l.id;
  RETURN v_user_id;
END
$fn$;

-- Accepts a set-password link: claims it, sets the password, records how, and signs the account out everywhere.
CREATE FUNCTION kinship_auth.accept_reset(p_token_hash text, p_password_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  l public.account_links;
BEGIN
  UPDATE public.account_links x SET accepted_at = now()
   WHERE x.token_hash = p_token_hash AND x.kind = 'reset'
     AND x.accepted_at IS NULL AND x.revoked_at IS NULL AND x.expires_at > now()
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
-- Changing your own password. The caller must be the signed-in account and must pass the token hash of the
-- session it is using. Every other session of the account is deleted and the current one gets a new token
-- (same expiry), so a stolen cookie dies with the change. Open set-password links for the account are retired.
-- ---------------------------------------------------------------------------
CREATE FUNCTION kinship_auth.change_password(
  p_user_id uuid, p_password_hash text, p_current_token_hash text, p_new_token_hash text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_user_id IS DISTINCT FROM public.kinship_user_id() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'KS010';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sessions s WHERE s.token_hash = p_current_token_hash AND s.user_id = p_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'KS010';
  END IF;
  UPDATE public.users u
     SET password_hash = p_password_hash, password_changed_at = now(), password_changed_via = 'self',
         updated_at = now()
   WHERE u.id = p_user_id;
  DELETE FROM public.sessions s WHERE s.user_id = p_user_id AND s.token_hash <> p_current_token_hash;
  UPDATE public.sessions s SET token_hash = p_new_token_hash WHERE s.token_hash = p_current_token_hash;
  UPDATE public.account_links l SET revoked_at = now()
   WHERE l.kind = 'reset' AND l.user_id = p_user_id AND l.accepted_at IS NULL AND l.revoked_at IS NULL;
END
$fn$;

-- ---------------------------------------------------------------------------
-- Existing functions that now also keep the account's own record.
-- ---------------------------------------------------------------------------
-- Same as 0002 plus the time of the sign-in on the account.
CREATE OR REPLACE FUNCTION kinship_auth.create_session(
  p_user_id uuid, p_token_hash text, p_idle_seconds integer, p_absolute_seconds integer
) RETURNS TABLE (expires_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH s AS (
    INSERT INTO public.sessions (user_id, token_hash, expires_at, absolute_expires_at)
    VALUES (
      p_user_id, p_token_hash,
      now() + make_interval(secs => LEAST(p_idle_seconds, p_absolute_seconds)),
      now() + make_interval(secs => p_absolute_seconds)
    )
    RETURNING public.sessions.expires_at
  ), u AS (
    UPDATE public.users SET last_sign_in_at = now() WHERE id = p_user_id
  )
  SELECT s.expires_at FROM s
$fn$;

-- Same as 0005 plus the password trace of the first account ('setup').
CREATE OR REPLACE FUNCTION kinship_auth.complete_setup(
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

  INSERT INTO public.users (email, display_name, password_hash, role, password_changed_at, password_changed_via)
    VALUES (lower(p_email), p_display_name, p_password_hash, 'superadmin', now(), 'setup')
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

-- ---------------------------------------------------------------------------
-- Rights. The new functions are executable by the app role only; the table and the three new account columns
-- are the only things it is granted (the columns, read only: they change through the functions above).
-- ---------------------------------------------------------------------------
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA kinship_auth FROM PUBLIC;

DO $$
DECLARE
  app_role text := current_setting('kinship.app_role', true);
BEGIN
  IF app_role IS NULL OR app_role = '' THEN
    RAISE EXCEPTION 'kinship.app_role is not set; run migrations through the KinShip migration runner';
  END IF;
  EXECUTE format('REVOKE ALL ON account_links FROM %I', app_role);
  EXECUTE format('GRANT SELECT (last_sign_in_at, password_changed_at, password_changed_via) ON users TO %I', app_role);
  EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA kinship_auth TO %I', app_role);
END
$$;
