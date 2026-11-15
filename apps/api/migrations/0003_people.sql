-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- 0003: people, partial dates and name search.
--
-- Runs as the owner role. The app role's name arrives in "kinship.app_role" (see 0001).
-- The table is created with row-level security enabled and forced and NO policies, which
-- means "nobody can touch it". The policies arrive in 0005, after every table they refer
-- to exists.

-- ---------------------------------------------------------------------------
-- Dates
-- ---------------------------------------------------------------------------
-- A date is typed as YYYY, YYYY-MM or YYYY-MM-DD, and that text is stored as typed
-- (a "partial date"). Next to it sits a precision: exactly, about, before or after.
--
-- For sorting and range filters every date column also has two generated columns,
-- x_from and x_to: the FIRST and LAST day the typed text can mean.
--
--     text          x_from       x_to
--     1955          1955-01-01   1955-12-31
--     1955-06       1955-06-01   1955-06-30
--     1955-06-04    1955-06-04   1955-06-04
--
-- The precision does NOT change x_from and x_to. It changes how the date is read:
--   exactly  the event happened within [x_from, x_to] (the span is only as wide as the text is vague)
--   about    the event happened near that span; sort by x_from, and do not treat a filter edge as exact
--   before   the event happened before x_from (x_to is not a bound)
--   after    the event happened after x_to (x_from is not a bound)
-- So "before 1950" sorts at 1950-01-01, and a filter must not treat x_from or x_to as an
-- exact bound for 'before', 'after' and 'about' dates. Nothing filters on dates yet; when
-- something does, it applies these rules (and this comment is the place they are written).

CREATE FUNCTION public.kinship_valid_partial_date(t text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $fn$
  SELECT t ~ '^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$'
     AND substr(t, 1, 4)::int >= 1
     AND (length(t) < 7 OR substr(t, 6, 2)::int BETWEEN 1 AND 12)
     AND (length(t) < 10 OR substr(t, 9, 2)::int BETWEEN 1 AND
            extract(day FROM (make_date(substr(t, 1, 4)::int, substr(t, 6, 2)::int, 1)
                              + interval '1 month' - interval '1 day'))::int)
$fn$;

CREATE DOMAIN public.partial_date AS text
  CONSTRAINT partial_date_valid CHECK (public.kinship_valid_partial_date(VALUE));

CREATE FUNCTION public.kinship_date_from(t text) RETURNS date
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $fn$
  SELECT make_date(substr(t, 1, 4)::int,
                   CASE WHEN length(t) >= 7 THEN substr(t, 6, 2)::int ELSE 1 END,
                   CASE WHEN length(t) >= 10 THEN substr(t, 9, 2)::int ELSE 1 END)
$fn$;

CREATE FUNCTION public.kinship_date_to(t text) RETURNS date
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $fn$
  SELECT CASE length(t)
    WHEN 4  THEN make_date(substr(t, 1, 4)::int, 12, 31)
    WHEN 7  THEN (make_date(substr(t, 1, 4)::int, substr(t, 6, 2)::int, 1) + interval '1 month' - interval '1 day')::date
    ELSE make_date(substr(t, 1, 4)::int, substr(t, 6, 2)::int, substr(t, 9, 2)::int)
  END
$fn$;

-- ---------------------------------------------------------------------------
-- Name search
-- ---------------------------------------------------------------------------
-- Accent-insensitive search ("Mendez" finds "Méndez"). unaccent() itself is only STABLE,
-- because it looks up its dictionary through search_path. Naming the dictionary explicitly
-- makes the result depend on nothing else, so the wrapper is honestly IMMUTABLE and can be
-- used in a generated column and an index.
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;

CREATE FUNCTION public.kinship_unaccent(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $fn$ SELECT public.unaccent('public.unaccent'::regdictionary, t) $fn$;

-- Keeps updated_at current, whoever changes the row.
CREATE FUNCTION public.kinship_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$fn$;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
CREATE TABLE people (
  id               uuid        PRIMARY KEY DEFAULT uuidv7(),
  -- surname is the BIRTH (maiden) surname. A married surname is a later, additive column.
  given_name       text        NOT NULL CHECK (given_name = btrim(given_name) AND length(given_name) BETWEEN 1 AND 100),
  surname          text        NOT NULL CHECK (surname = btrim(surname) AND length(surname) BETWEEN 1 AND 100),
  gender           text        CHECK (gender IN ('male', 'female', 'other')),
  birth_date       public.partial_date,
  birth_precision  text        NOT NULL DEFAULT 'exactly' CHECK (birth_precision IN ('exactly', 'about', 'before', 'after')),
  birth_from       date        GENERATED ALWAYS AS (public.kinship_date_from(birth_date)) STORED,
  birth_to         date        GENERATED ALWAYS AS (public.kinship_date_to(birth_date)) STORED,
  -- Deceased is its own fact: someone can be known to have died without knowing when.
  deceased         boolean     NOT NULL DEFAULT false,
  death_date       public.partial_date,
  death_precision  text        NOT NULL DEFAULT 'exactly' CHECK (death_precision IN ('exactly', 'about', 'before', 'after')),
  death_from       date        GENERATED ALWAYS AS (public.kinship_date_from(death_date)) STORED,
  death_to         date        GENERATED ALWAYS AS (public.kinship_date_to(death_date)) STORED,
  -- Lower-cased, accent-free "given surname", for search.
  search_name      text        GENERATED ALWAYS AS (lower(public.kinship_unaccent(given_name || ' ' || surname))) STORED,
  created_by       uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT people_death_needs_deceased CHECK (death_date IS NULL OR deceased),
  CONSTRAINT people_birth_precision_needs_date CHECK (birth_date IS NOT NULL OR birth_precision = 'exactly'),
  CONSTRAINT people_death_precision_needs_date CHECK (death_date IS NOT NULL OR death_precision = 'exactly')
);
CREATE INDEX people_name_order_idx ON people (surname, given_name, id);
CREATE INDEX people_birth_from_idx ON people (birth_from);
CREATE INDEX people_created_by_idx ON people (created_by);

CREATE TRIGGER people_touch_updated_at BEFORE UPDATE ON people
  FOR EACH ROW EXECUTE FUNCTION public.kinship_touch_updated_at();

ALTER TABLE people ENABLE ROW LEVEL SECURITY;
ALTER TABLE people FORCE ROW LEVEL SECURITY;

-- What the app role may do. 0001 gives new tables read/write by default; start from nothing
-- and give back exactly what the API needs. Generated columns are never written. The id,
-- created_by (after insert) and created_at cannot be changed.
DO $$
DECLARE
  app_role text := current_setting('kinship.app_role', true);
BEGIN
  IF app_role IS NULL OR app_role = '' THEN
    RAISE EXCEPTION 'kinship.app_role is not set; run migrations through the KinShip migration runner';
  END IF;

  EXECUTE format('REVOKE ALL ON people FROM %I', app_role);
  EXECUTE format('GRANT SELECT, DELETE ON people TO %I', app_role);
  EXECUTE format(
    'GRANT INSERT (given_name, surname, gender, birth_date, birth_precision, deceased, death_date, death_precision, created_by) ON people TO %I',
    app_role);
  EXECUTE format(
    'GRANT UPDATE (given_name, surname, gender, birth_date, birth_precision, deceased, death_date, death_precision) ON people TO %I',
    app_role);
END
$$;
