-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- 0002: accounts, sessions and first-run setup.
--
-- How the app role reaches this data (it is not the owner and has no BYPASSRLS):
--   * users and family_tree have row-level security. A signed-in person sees
--     only what a policy allows, decided by the setting "kinship.user_id" that
--     the API sets for each request's transaction.
--   * password_hash, the sessions table and the setup token are not readable by
--     the app role at all. Sign-in, sessions and setup go through the few
--     SECURITY DEFINER functions in schema kinship_auth, which run as the owner
--     and do one narrow job each. Nothing lists password hashes or session tokens.
--   * The app role's name arrives in "kinship.app_role" (set by the runner).

CREATE TABLE users (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text        NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 320),
  display_name  text        NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
  password_hash text        NOT NULL,
  -- The four fixed roles. Their display names can be changed later; the codes cannot.
  role          text        NOT NULL CHECK (role IN ('superadmin', 'familyadmin', 'member', 'user')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (email);

CREATE TABLE sessions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- SHA-256 (hex) of the random token in the cookie. The token itself is never stored.
  token_hash          text        NOT NULL UNIQUE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,  -- idle expiry, slides forward while the session is used
  absolute_expires_at timestamptz NOT NULL,  -- hard cap, never extended
  CHECK (expires_at <= absolute_expires_at)
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

-- At most one row: the hash of the one-time setup token, present only while there are no users.
CREATE TABLE setup_token (
  id         boolean     PRIMARY KEY DEFAULT true CHECK (id),
  token_hash text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The one family tree of this install (exactly one row).
CREATE TABLE family_tree (
  id         boolean     PRIMARY KEY DEFAULT true CHECK (id),
  name       text        NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Who is asking, as set by the API for this transaction. NULL when nobody is signed in.
CREATE FUNCTION public.kinship_user_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
AS $fn$ SELECT nullif(current_setting('kinship.user_id', true), '')::uuid $fn$;

-- Row-level security. (The owner is exempt, as table owners are; the app role is not.)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_select_own ON users FOR SELECT USING (id = public.kinship_user_id());
-- Admin visibility of other accounts arrives with the Users admin page.

ALTER TABLE family_tree ENABLE ROW LEVEL SECURITY;
CREATE POLICY family_tree_select_signed_in ON family_tree FOR SELECT USING (public.kinship_user_id() IS NOT NULL);

-- ---------------------------------------------------------------------------
-- Functions for what must happen before anyone is signed in.
-- ---------------------------------------------------------------------------
CREATE SCHEMA kinship_auth;
REVOKE ALL ON SCHEMA kinship_auth FROM PUBLIC;

-- True while the install has no accounts yet.
CREATE FUNCTION kinship_auth.needs_setup() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT NOT EXISTS (SELECT 1 FROM public.users) $fn$;

-- Remembers the hash of a fresh setup token (replacing any older one). Does nothing once accounts exist.
CREATE FUNCTION kinship_auth.set_setup_token(p_token_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  PERFORM pg_advisory_xact_lock(7302041119);
  IF EXISTS (SELECT 1 FROM public.users) THEN
    DELETE FROM public.setup_token;
    RETURN false;
  END IF;
  INSERT INTO public.setup_token (id, token_hash) VALUES (true, p_token_hash)
    ON CONFLICT (id) DO UPDATE SET token_hash = excluded.token_hash, created_at = now();
  RETURN true;
END
$fn$;

-- Cheap pre-check, so a wrong token is rejected before any password hashing.
CREATE FUNCTION kinship_auth.check_setup_token(p_token_hash text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT NOT EXISTS (SELECT 1 FROM public.users)
     AND EXISTS (SELECT 1 FROM public.setup_token WHERE token_hash = p_token_hash)
$fn$;

-- Creates the first account (a SuperAdmin) and the tree, and removes the token, in one transaction.
-- Fails closed: SQLSTATE KS001 if an account already exists, KS002 if the token is wrong or missing.
-- The advisory lock makes two simultaneous attempts take turns, so only one can win.
CREATE FUNCTION kinship_auth.complete_setup(
  p_token_hash text, p_email text, p_display_name text, p_password_hash text, p_tree_name text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_user_id uuid;
BEGIN
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
  DELETE FROM public.setup_token;
  RETURN v_user_id;
END
$fn$;

-- The stored hash for an email, for sign-in. The only way the app role ever sees a password hash.
CREATE FUNCTION kinship_auth.find_login(p_email text) RETURNS TABLE (user_id uuid, password_hash text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT u.id, u.password_hash FROM public.users u WHERE u.email = lower(p_email) $fn$;

-- Stores a stronger hash after a successful sign-in with an older one.
CREATE FUNCTION kinship_auth.update_password_hash(p_user_id uuid, p_password_hash text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$ UPDATE public.users SET password_hash = p_password_hash, updated_at = now() WHERE id = p_user_id $fn$;

CREATE FUNCTION kinship_auth.create_session(
  p_user_id uuid, p_token_hash text, p_idle_seconds integer, p_absolute_seconds integer
) RETURNS TABLE (expires_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO public.sessions (user_id, token_hash, expires_at, absolute_expires_at)
  VALUES (
    p_user_id, p_token_hash,
    now() + make_interval(secs => LEAST(p_idle_seconds, p_absolute_seconds)),
    now() + make_interval(secs => p_absolute_seconds)
  )
  RETURNING public.sessions.expires_at
$fn$;

-- Finds the person behind a session token hash, if the session is still valid, and slides
-- its idle expiry forward (at most once a minute, so reads do not turn into writes).
CREATE FUNCTION kinship_auth.resolve_session(p_token_hash text, p_idle_seconds integer)
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
    FROM public.users u WHERE u.id = s.user_id;
END
$fn$;

CREATE FUNCTION kinship_auth.delete_session(p_token_hash text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$ DELETE FROM public.sessions WHERE token_hash = p_token_hash $fn$;

CREATE FUNCTION kinship_auth.delete_expired_sessions() RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH gone AS (
    DELETE FROM public.sessions WHERE expires_at <= now() OR absolute_expires_at <= now() RETURNING 1
  ) SELECT count(*)::integer FROM gone
$fn$;

-- ---------------------------------------------------------------------------
-- What the app role may do. It gets the functions above, and column-limited reads.
-- ---------------------------------------------------------------------------
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA kinship_auth FROM PUBLIC;

DO $$
DECLARE
  app_role text := current_setting('kinship.app_role', true);
BEGIN
  IF app_role IS NULL OR app_role = '' THEN
    RAISE EXCEPTION 'kinship.app_role is not set; run migrations through the KinShip migration runner';
  END IF;

  -- New tables get read/write for the app role by default (0001). These hold secrets, so start from nothing.
  EXECUTE format('REVOKE ALL ON users, sessions, setup_token, family_tree FROM %I', app_role);

  -- Everything about an account except its password hash. Row-level security limits the rows.
  EXECUTE format('GRANT SELECT (id, email, display_name, role, created_at, updated_at) ON users TO %I', app_role);
  EXECUTE format('GRANT SELECT (name, created_at) ON family_tree TO %I', app_role);

  EXECUTE format('GRANT USAGE ON SCHEMA kinship_auth TO %I', app_role);
  EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA kinship_auth TO %I', app_role);
END
$$;
