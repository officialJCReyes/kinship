-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- 0006: birth and adoptive parent links, and each viewer's choice of which family the charts follow.
-- See docs/decisions/0007-adoption-parentage.md.
--
--  * A child has up to two sets of parents, one per KIND ('birth' or 'adoptive'). Each set is one row,
--    exactly like before: it hangs from a union (two parents) or from one parent alone. Nothing is overwritten.
--  * Existing rows become 'birth' (the column default), so there is nothing to backfill.
--  * A link has an optional date (the year of the adoption, or the decree date) with a precision.
--  * users.lineage_view is the VIEWER's own display choice. Every query that walks parents for a chart takes
--    it; privacy rules (medical, DNA, identity numbers later) never do. They read link kinds explicitly.

ALTER TABLE person_parents ADD COLUMN kind text NOT NULL DEFAULT 'birth' CHECK (kind IN ('birth', 'adoptive'));
ALTER TABLE person_parents ADD COLUMN link_date public.partial_date;
ALTER TABLE person_parents ADD COLUMN link_precision text NOT NULL DEFAULT 'exactly'
  CHECK (link_precision IN ('exactly', 'about', 'before', 'after'));
ALTER TABLE person_parents ADD CONSTRAINT person_parents_precision_needs_date
  CHECK (link_date IS NOT NULL OR link_precision = 'exactly');
ALTER TABLE person_parents DROP CONSTRAINT person_parents_pkey;
ALTER TABLE person_parents ADD PRIMARY KEY (child_id, kind);

ALTER TABLE users ADD COLUMN lineage_view text NOT NULL DEFAULT 'adoptive' CHECK (lineage_view IN ('adoptive', 'birth'));

DO $$
DECLARE
  app_role text := current_setting('kinship.app_role', true);
BEGIN
  IF app_role IS NULL OR app_role = '' THEN
    RAISE EXCEPTION 'kinship.app_role is not set; run migrations through the KinShip migration runner';
  END IF;
  EXECUTE format('GRANT INSERT (kind, link_date, link_precision) ON person_parents TO %I', app_role);
  EXECUTE format('GRANT UPDATE (link_date, link_precision) ON person_parents TO %I', app_role);
  -- The one thing about an account the app may change: which family the viewer sees. Nothing else on users.
  EXECUTE format('GRANT SELECT (lineage_view), UPDATE (lineage_view) ON users TO %I', app_role);
END
$$;

-- An account may change its own display choice, and only that column (the grant above), only on its own row.
CREATE POLICY users_update_own ON users FOR UPDATE
  USING (id = public.kinship_user_id())
  WITH CHECK (id = public.kinship_user_id());

-- ---------------------------------------------------------------------------
-- Which parents does a child have?
--   kinship_parent_ids(child)               every parent of every kind (integrity checks, "my line")
--   kinship_parent_ids_of_kind(child, kind) one set
--   kinship_birth_parent_ids(child)         the birth set (medical and DNA logic read this, never the view)
--   kinship_effective_kind(child, view)     THE rule for what a chart follows (below)
--   kinship_parent_ids_in(child, view)      the parents a chart follows
--   kinship_legal_parent_ids(child)         adoptive parents if there are any, else birth (identity numbers later)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.kinship_parent_ids_of_kind(p_child uuid, p_kind text) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT pp.parent_id FROM public.person_parents pp
   WHERE pp.child_id = p_child AND pp.kind = p_kind AND pp.parent_id IS NOT NULL
  UNION ALL
  SELECT u.partner_a_id FROM public.person_parents pp JOIN public.unions u ON u.id = pp.union_id
   WHERE pp.child_id = p_child AND pp.kind = p_kind
  UNION ALL
  SELECT u.partner_b_id FROM public.person_parents pp JOIN public.unions u ON u.id = pp.union_id
   WHERE pp.child_id = p_child AND pp.kind = p_kind
$fn$;

-- Every parent of every kind. Written as the two sets so each lookup uses the exact (child_id, kind) key.
CREATE OR REPLACE FUNCTION public.kinship_parent_ids(p_child uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT public.kinship_parent_ids_of_kind(p_child, 'birth')
  UNION ALL
  SELECT public.kinship_parent_ids_of_kind(p_child, 'adoptive')
$fn$;

CREATE FUNCTION public.kinship_birth_parent_ids(p_child uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT public.kinship_parent_ids_of_kind(p_child, 'birth') $fn$;

-- THE rule. In the birth view a child follows their birth set only (an adopted person with no birth set
-- recorded has no parents there: there is no fallback to the adoptive set). In the adoptive view a child follows
-- their adoptive set if they have one, otherwise their birth set. Everything that draws or walks a chart goes
-- through this function, so the views cannot drift apart.
CREATE FUNCTION public.kinship_effective_kind(p_child uuid, p_view text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE
    WHEN p_view = 'birth' THEN 'birth'
    WHEN EXISTS (SELECT 1 FROM public.person_parents pp WHERE pp.child_id = p_child AND pp.kind = 'adoptive') THEN 'adoptive'
    ELSE 'birth'
  END
$fn$;

CREATE FUNCTION public.kinship_parent_ids_in(p_child uuid, p_view text) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT public.kinship_parent_ids_of_kind(p_child, public.kinship_effective_kind(p_child, p_view)) $fn$;

-- A person's legal parents: their adoptive parents if they have any, otherwise their birth parents. Birth
-- relatives of an adopted person are not next of kin. Not used by anything yet (identity numbers, 0.6+).
CREATE FUNCTION public.kinship_legal_parent_ids(p_child uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT public.kinship_parent_ids_in(p_child, 'adoptive') $fn$;

-- The parents in one set (a union's two partners, or the one parent).
CREATE FUNCTION public.kinship_set_parents(p_union uuid, p_parent uuid) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE WHEN p_union IS NOT NULL
              THEN (SELECT ARRAY[u.partner_a_id, u.partner_b_id] FROM public.unions u WHERE u.id = p_union)
              ELSE ARRAY[p_parent] END
$fn$;

-- ---------------------------------------------------------------------------
-- The integrity rules, now across both kinds. KS011 self-parent, KS012 child is a partner, KS013 cycle (the walk
-- uses kinship_parent_ids, which already follows every kind). New: KS015, the same person cannot be a birth parent
-- and an adoptive parent of the same child, EXCEPT a stepparent adoption: the adoptive set is a union of the
-- staying birth parent and the adopting stepparent (exactly one person in both sets, and the adoptive set a union).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.kinship_check_parentage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET jit = off
AS $fn$
DECLARE
  v_parents uuid[];
  v_other uuid[];
  v_other_union uuid;
  v_a uuid;
  v_b uuid;
  v_overlap int;
  v_adoptive_is_union boolean;
BEGIN
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

  SELECT public.kinship_set_parents(o.union_id, o.parent_id), o.union_id INTO v_other, v_other_union
    FROM public.person_parents o WHERE o.child_id = NEW.child_id AND o.kind <> NEW.kind;
  IF v_other IS NOT NULL THEN
    SELECT count(*) INTO v_overlap FROM unnest(v_parents) AS p WHERE p = ANY (v_other);
    IF v_overlap > 0 THEN
      v_adoptive_is_union := CASE WHEN NEW.kind = 'adoptive' THEN NEW.union_id IS NOT NULL ELSE v_other_union IS NOT NULL END;
      IF NOT (v_adoptive_is_union AND v_overlap = 1) THEN
        RAISE EXCEPTION 'same_person_both_kinds' USING ERRCODE = 'KS015';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;

-- Deleting a person: for each set, a child of a union that included them keeps the other partner as single
-- parent; a child of them alone loses that set. One new case: if the remaining partner is also in the child's
-- OTHER set (a stepparent adoption whose adopter is being deleted), the adoptive set would now repeat a birth
-- parent, so that set ends instead.
CREATE OR REPLACE FUNCTION public.kinship_before_person_delete() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  DELETE FROM public.person_parents pp
   USING public.unions u
   WHERE pp.union_id = u.id AND (u.partner_a_id = OLD.id OR u.partner_b_id = OLD.id)
     AND EXISTS (
       SELECT 1 FROM public.person_parents o
        WHERE o.child_id = pp.child_id AND o.kind <> pp.kind
          AND CASE WHEN u.partner_a_id = OLD.id THEN u.partner_b_id ELSE u.partner_a_id END
              = ANY (public.kinship_set_parents(o.union_id, o.parent_id)));
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

-- Who may attach a parent set. Admins any kind. A Member only a BIRTH set, for a person they just added, under
-- themselves or a descendant (adoption links change two families, so they are for admins).
DROP POLICY person_parents_insert ON person_parents;
DROP FUNCTION public.kinship_can_attach_child(uuid, uuid, uuid);
CREATE FUNCTION public.kinship_can_attach_child(p_child uuid, p_union uuid, p_parent uuid, p_kind text) RETURNS boolean
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
  IF v_role IS DISTINCT FROM 'member' OR p_kind <> 'birth' THEN
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
CREATE POLICY person_parents_insert ON person_parents FOR INSERT
  WITH CHECK (created_by = public.kinship_user_id() AND public.kinship_can_attach_child(child_id, union_id, parent_id, kind));
