-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- 0007: second and married surnames, name search over all of them, and the automatic Widowed status.
--
-- Runs as the owner role. The app role's name arrives in "kinship.app_role" (see 0001).
-- Everything here is additive (expand only). 0.1.0 is the baseline for the data promise.
--
--   * people.second_surname   the second (maternal) surname, optional.
--   * people.married_surname  the surname taken at marriage, optional. It replaces BOTH surnames in a
--                             display name when the viewer chooses "married when set" (web app).
--   * people.search_names     a new generated search column over the given name and all three surnames.
--                             The old people.search_name stays for now and is dropped in a later release
--                             (expand, then contract): nothing reads it after this release.
--   * unions.status_auto      true when the DATABASE set the status to Widowed (a person was marked deceased,
--                             or a Married relationship was saved with a deceased partner).
--
-- Automatic Widowed, in rules (the triggers below are the only place they live, so no code path can skip them):
--   1. A person becomes deceased: each of their Married relationships becomes Widowed, status_auto = true.
--      Engaged, Partner, Separated, Divorced and the rest never change.
--   2. A person becomes living again: a relationship reverts to Married only when it is Widowed AND status_auto
--      AND neither partner is still deceased. A status chosen by hand (status_auto = false) is kept.
--   3. A relationship saved as Married while a partner is deceased becomes Widowed, status_auto = true.
--   4. Any change of status by hand sets status_auto = false. The app role cannot write status_auto, so a
--      change to that column can only come from these functions.

-- ---------------------------------------------------------------------------
-- Names
-- ---------------------------------------------------------------------------
ALTER TABLE people
  ADD COLUMN second_surname text
    CHECK (second_surname = btrim(second_surname) AND length(second_surname) BETWEEN 1 AND 100),
  ADD COLUMN married_surname text
    CHECK (married_surname = btrim(married_surname) AND length(married_surname) BETWEEN 1 AND 100);

-- Lower-cased, accent-free "given surname second_surname married_surname", for search. (|| and coalesce are
-- immutable; concat_ws is not, so it cannot be used in a generated column.)
ALTER TABLE people
  ADD COLUMN search_names text GENERATED ALWAYS AS (
    lower(public.kinship_unaccent(
      given_name || ' ' || surname || coalesce(' ' || second_surname, '') || coalesce(' ' || married_surname, '')
    ))
  ) STORED;

-- The list is sorted by surname, then second surname (none sorts first), then given name.
CREATE INDEX people_name_order_v2_idx ON people (surname, (coalesce(second_surname, '')), given_name, id);

DO $$
DECLARE
  app_role text := current_setting('kinship.app_role', true);
BEGIN
  IF app_role IS NULL OR app_role = '' THEN
    RAISE EXCEPTION 'kinship.app_role is not set; run migrations through the KinShip migration runner';
  END IF;
  EXECUTE format('GRANT INSERT (second_surname, married_surname) ON people TO %I', app_role);
  EXECUTE format('GRANT UPDATE (second_surname, married_surname) ON people TO %I', app_role);
END
$$;

-- ---------------------------------------------------------------------------
-- Automatic Widowed
-- ---------------------------------------------------------------------------
-- No GRANT for status_auto: the app role can read it (table-level SELECT) but never write it.
ALTER TABLE unions ADD COLUMN status_auto boolean NOT NULL DEFAULT false;

-- Row-level security is FORCED on people and unions, which applies to the owner role too, and the policies of
-- 0005 let a Member change only the unions they are in. The functions below run as the owner (SECURITY DEFINER)
-- and must reach every union of a person whoever marked them deceased, so the owner gets three narrow policies.
-- Each one only opens while a function below has set kinship.widow_internal = 'on' inside its own
-- transaction; outside those functions the owner sees exactly what it saw before. The app role is not the owner
-- and is not a member of it, so none of this applies to it.
DO $$
DECLARE
  owner_role text := current_user;
BEGIN
  EXECUTE format(
    'CREATE POLICY people_select_widowed_internal ON people FOR SELECT TO %I USING (current_setting(''kinship.widow_internal'', true) = ''on'')',
    owner_role);
  EXECUTE format(
    'CREATE POLICY unions_select_widowed_internal ON unions FOR SELECT TO %I USING (current_setting(''kinship.widow_internal'', true) = ''on'')',
    owner_role);
  EXECUTE format(
    'CREATE POLICY unions_update_widowed_internal ON unions FOR UPDATE TO %I USING (current_setting(''kinship.widow_internal'', true) = ''on'') WITH CHECK (current_setting(''kinship.widow_internal'', true) = ''on'')',
    owner_role);
END
$$;

-- BEFORE INSERT OR UPDATE on unions: rules 3 and 4. Reads people as the owner (see the policies above).
CREATE FUNCTION public.kinship_unions_widowed_rule() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_prev text := coalesce(current_setting('kinship.widow_internal', true), 'off');
  v_gone boolean;
BEGIN
  -- Rule 4. A change of status_auto itself means a function below wrote the row (the app role cannot), so
  -- only a status change with status_auto untouched is a status chosen by hand.
  IF TG_OP = 'UPDATE'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status_auto IS NOT DISTINCT FROM OLD.status_auto THEN
    NEW.status_auto := false;
  END IF;

  -- Rule 3.
  IF NEW.status = 'married' THEN
    PERFORM set_config('kinship.widow_internal', 'on', true);
    SELECT EXISTS (
      SELECT 1 FROM public.people p WHERE p.deceased AND p.id IN (NEW.partner_a_id, NEW.partner_b_id)
    ) INTO v_gone;
    PERFORM set_config('kinship.widow_internal', v_prev, true);
    IF v_gone THEN
      NEW.status := 'widowed';
      NEW.status_auto := true;
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER unions_widowed_rule BEFORE INSERT OR UPDATE ON unions
  FOR EACH ROW EXECUTE FUNCTION public.kinship_unions_widowed_rule();

-- AFTER UPDATE of people.deceased: rules 1 and 2. AFTER, so the person row already holds the new value when
-- the relationship rule above (and the NOT EXISTS below) reads it.
CREATE FUNCTION public.kinship_people_deceased_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_prev text := coalesce(current_setting('kinship.widow_internal', true), 'off');
BEGIN
  PERFORM set_config('kinship.widow_internal', 'on', true);
  IF NEW.deceased THEN
    UPDATE public.unions
       SET status = 'widowed', status_auto = true
     WHERE status = 'married' AND (partner_a_id = NEW.id OR partner_b_id = NEW.id);
  ELSE
    UPDATE public.unions u
       SET status = 'married', status_auto = false
     WHERE u.status = 'widowed' AND u.status_auto
       AND (u.partner_a_id = NEW.id OR u.partner_b_id = NEW.id)
       AND NOT EXISTS (
         SELECT 1 FROM public.people p WHERE p.deceased AND p.id IN (u.partner_a_id, u.partner_b_id)
       );
  END IF;
  PERFORM set_config('kinship.widow_internal', v_prev, true);
  RETURN NULL;
END
$fn$;

CREATE TRIGGER people_deceased_changed AFTER UPDATE OF deceased ON people
  FOR EACH ROW WHEN (OLD.deceased IS DISTINCT FROM NEW.deceased)
  EXECUTE FUNCTION public.kinship_people_deceased_changed();

-- Data from before this release: a Married relationship whose partner is already deceased is Widowed, by rule 3.
-- (The owner sees rows under forced row-level security only while kinship.widow_internal is on.)
SELECT set_config('kinship.widow_internal', 'on', true);
UPDATE unions u
   SET status = 'widowed', status_auto = true
 WHERE u.status = 'married'
   AND EXISTS (SELECT 1 FROM people p WHERE p.deceased AND p.id IN (u.partner_a_id, u.partner_b_id));
SELECT set_config('kinship.widow_internal', 'off', true);
