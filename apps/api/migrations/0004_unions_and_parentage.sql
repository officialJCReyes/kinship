-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- 0004: partner relationships ("unions"), who a child's parents are, and the rules that
-- keep that graph sane.
--
-- Naming: the table is called "unions" (not "relationships") on purpose. In the design
-- docs a child "hangs from the union": the line between two partners. "Relationship"
-- is too broad (a parent link is a relationship too).
--
-- Model, in short:
--   * unions: two different people, stored with partner_a_id < partner_b_id so the same
--     couple can never exist twice in two orders. The same two people CAN have several
--     unions over time (they divorce and remarry), so the pair is not unique.
--   * person_parents: ONE row per child, and the row says where the child hangs from:
--       - union_id  set: the child's two parents are that union's two partners, or
--       - parent_id set: the child has one parent on the tree.
--     Exactly one of the two. "At most two parents", "no duplicate parent links" and
--     "a child hangs from one place" hold because a child has one row and a union has
--     two partners; there is nothing to count.
--
-- Same as 0003: row-level security is enabled and forced here and the policies follow in 0005.

CREATE TABLE unions (
  id               uuid        PRIMARY KEY DEFAULT uuidv7(),
  partner_a_id     uuid        NOT NULL REFERENCES people (id) ON DELETE RESTRICT,
  partner_b_id     uuid        NOT NULL REFERENCES people (id) ON DELETE RESTRICT,
  status           text        NOT NULL CHECK (status IN (
                     'married', 'divorced', 'separated', 'widowed', 'engaged',
                     'partner', 'friends', 'annulment', 'unknown', 'other')),
  -- The marriage (or start) date. How precision and x_from / x_to work is explained in 0003.
  start_date       public.partial_date,
  start_precision  text        NOT NULL DEFAULT 'exactly' CHECK (start_precision IN ('exactly', 'about', 'before', 'after')),
  start_from       date        GENERATED ALWAYS AS (public.kinship_date_from(start_date)) STORED,
  start_to         date        GENERATED ALWAYS AS (public.kinship_date_to(start_date)) STORED,
  -- Divorce, separation or annulment date: only those statuses may have one.
  end_date         public.partial_date,
  end_precision    text        NOT NULL DEFAULT 'exactly' CHECK (end_precision IN ('exactly', 'about', 'before', 'after')),
  end_from         date        GENERATED ALWAYS AS (public.kinship_date_from(end_date)) STORED,
  end_to           date        GENERATED ALWAYS AS (public.kinship_date_to(end_date)) STORED,
  created_by       uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unions_partners_differ CHECK (partner_a_id <> partner_b_id),
  CONSTRAINT unions_partners_ordered CHECK (partner_a_id < partner_b_id),
  CONSTRAINT unions_end_date_status CHECK (end_date IS NULL OR status IN ('divorced', 'separated', 'annulment')),
  CONSTRAINT unions_start_precision_needs_date CHECK (start_date IS NOT NULL OR start_precision = 'exactly'),
  CONSTRAINT unions_end_precision_needs_date CHECK (end_date IS NOT NULL OR end_precision = 'exactly')
);
CREATE INDEX unions_partner_a_idx ON unions (partner_a_id);
CREATE INDEX unions_partner_b_idx ON unions (partner_b_id);

CREATE TABLE person_parents (
  child_id    uuid        PRIMARY KEY REFERENCES people (id) ON DELETE CASCADE,
  union_id    uuid        REFERENCES unions (id) ON DELETE RESTRICT,
  parent_id   uuid        REFERENCES people (id) ON DELETE RESTRICT,
  created_by  uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT person_parents_exactly_one CHECK ((union_id IS NULL) <> (parent_id IS NULL))
);
CREATE INDEX person_parents_union_idx ON person_parents (union_id) WHERE union_id IS NOT NULL;
CREATE INDEX person_parents_parent_idx ON person_parents (parent_id) WHERE parent_id IS NOT NULL;

CREATE TRIGGER unions_touch_updated_at BEFORE UPDATE ON unions
  FOR EACH ROW EXECUTE FUNCTION public.kinship_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Who are a person's parents? (Used by the integrity checks below, by the access rules
-- in 0005 and by the API's tree query.) SECURITY DEFINER with a fixed search_path, like
-- the other helpers: the answer must not depend on what the caller may see.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.kinship_parent_ids(p_child uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT pp.parent_id FROM public.person_parents pp WHERE pp.child_id = p_child AND pp.parent_id IS NOT NULL
  UNION ALL
  SELECT u.partner_a_id FROM public.person_parents pp JOIN public.unions u ON u.id = pp.union_id WHERE pp.child_id = p_child
  UNION ALL
  SELECT u.partner_b_id FROM public.person_parents pp JOIN public.unions u ON u.id = pp.union_id WHERE pp.child_id = p_child
$fn$;

-- ---------------------------------------------------------------------------
-- Integrity rules. SQLSTATEs (the API turns them into error codes):
--   KS010 a person added by a Member was never given a place in the tree
--   KS011 a person is their own parent
--   KS012 a child is one of the partners of the union it hangs from
--   KS013 the link would make someone their own ancestor
--   KS014 the partners of a union cannot be changed (delete it and make a new one)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.kinship_check_parentage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_parents uuid[];
  v_a uuid;
  v_b uuid;
BEGIN
  -- One writer at a time: two transactions that each look fine alone (A under B, B under A)
  -- could otherwise commit a cycle together. Parent links are rare writes, so this costs nothing.
  PERFORM pg_advisory_xact_lock(7302041120);

  IF NEW.union_id IS NOT NULL THEN
    SELECT partner_a_id, partner_b_id INTO v_a, v_b FROM public.unions WHERE id = NEW.union_id;
    IF NEW.child_id = v_a OR NEW.child_id = v_b THEN
      RAISE EXCEPTION 'child_is_partner' USING ERRCODE = 'KS012';
    END IF;
    v_parents := ARRAY[v_a, v_b];
  ELSE
    IF NEW.child_id = NEW.parent_id THEN
      RAISE EXCEPTION 'parent_is_self' USING ERRCODE = 'KS011';
    END IF;
    v_parents := ARRAY[NEW.parent_id];
  END IF;

  -- If the child is an ancestor of either parent, this link would close a loop.
  IF EXISTS (
    WITH RECURSIVE up(id) AS (
      SELECT unnest(v_parents)
      UNION
      SELECT x.pid FROM up, LATERAL public.kinship_parent_ids(up.id) AS x(pid)
    )
    SELECT 1 FROM up WHERE id = NEW.child_id
  ) THEN
    RAISE EXCEPTION 'would_create_cycle' USING ERRCODE = 'KS013';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER person_parents_check BEFORE INSERT OR UPDATE ON person_parents
  FOR EACH ROW EXECUTE FUNCTION public.kinship_check_parentage();

CREATE FUNCTION public.kinship_unions_partners_fixed() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.partner_a_id <> OLD.partner_a_id OR NEW.partner_b_id <> OLD.partner_b_id THEN
    RAISE EXCEPTION 'partners_fixed' USING ERRCODE = 'KS014';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER unions_partners_fixed BEFORE UPDATE ON unions
  FOR EACH ROW EXECUTE FUNCTION public.kinship_unions_partners_fixed();

-- When a person is deleted, nobody is left hanging from a union that no longer exists:
--   * a child of a union that included this person keeps the OTHER partner as single parent,
--   * a child of this person alone becomes a child with no parent on the tree,
--   * the person's unions are deleted.
-- Runs with the caller's rights (an admin; the policies in 0005 allow exactly this).
-- The foreign keys above are RESTRICT, so a delete that skipped this would fail loudly.
CREATE FUNCTION public.kinship_before_person_delete() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  UPDATE public.person_parents pp
     SET union_id = NULL,
         parent_id = CASE WHEN u.partner_a_id = OLD.id THEN u.partner_b_id ELSE u.partner_a_id END
    FROM public.unions u
   WHERE pp.union_id = u.id AND (u.partner_a_id = OLD.id OR u.partner_b_id = OLD.id);
  DELETE FROM public.person_parents WHERE parent_id = OLD.id;
  DELETE FROM public.unions WHERE partner_a_id = OLD.id OR partner_b_id = OLD.id;
  RETURN OLD;
END
$fn$;

CREATE TRIGGER people_before_delete BEFORE DELETE ON people
  FOR EACH ROW EXECUTE FUNCTION public.kinship_before_person_delete();

-- A Member may only add people as children (or grandchildren...) of someone in their line.
-- The person row has to exist before the link can, so a policy cannot check the link at
-- insert time. This constraint trigger runs at COMMIT instead: a person created by a Member
-- must have a place in the tree by then, or the whole transaction fails.
CREATE FUNCTION public.kinship_require_member_parentage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF NEW.created_by IS NOT NULL
     AND (SELECT u.role FROM public.users u WHERE u.id = NEW.created_by) = 'member'
     AND EXISTS (SELECT 1 FROM public.people p WHERE p.id = NEW.id)
     AND NOT EXISTS (SELECT 1 FROM public.person_parents pp WHERE pp.child_id = NEW.id)
  THEN
    RAISE EXCEPTION 'member_person_needs_parentage' USING ERRCODE = 'KS010';
  END IF;
  RETURN NULL;
END
$fn$;

CREATE CONSTRAINT TRIGGER people_member_parentage AFTER INSERT ON people
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.kinship_require_member_parentage();

ALTER TABLE unions ENABLE ROW LEVEL SECURITY;
ALTER TABLE unions FORCE ROW LEVEL SECURITY;
ALTER TABLE person_parents ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_parents FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  app_role text := current_setting('kinship.app_role', true);
BEGIN
  IF app_role IS NULL OR app_role = '' THEN
    RAISE EXCEPTION 'kinship.app_role is not set; run migrations through the KinShip migration runner';
  END IF;

  EXECUTE format('REVOKE ALL ON unions, person_parents FROM %I', app_role);
  EXECUTE format('GRANT SELECT, DELETE ON unions, person_parents TO %I', app_role);
  EXECUTE format(
    'GRANT INSERT (partner_a_id, partner_b_id, status, start_date, start_precision, end_date, end_precision, created_by) ON unions TO %I',
    app_role);
  EXECUTE format('GRANT UPDATE (status, start_date, start_precision, end_date, end_precision) ON unions TO %I', app_role);
  EXECUTE format('GRANT INSERT (child_id, union_id, parent_id, created_by) ON person_parents TO %I', app_role);
  EXECUTE format('GRANT UPDATE (union_id, parent_id) ON person_parents TO %I', app_role);
END
$$;
