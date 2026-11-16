-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- 0008: saving a status by hand makes an automatic Widowed permanent, even when the status is the same.
--
-- Rule 4 of 0007 ("a status changed by hand sets status_auto = false") could only see a status that differs from
-- the old one. An admin who opens an automatic Widowed relationship and saves "Widowed" again has not changed the
-- value, but has made the choice: from then on it is theirs, and un-marking the deceased partner must not revert it.
--
-- The API signals that with ONE transaction-local setting, kinship.union_status_by_hand, set to 'on' right before
-- the UPDATE of PATCH /api/unions/:id when the body includes a status (and back to 'off' right after), always with
-- set_config(..., true) in the same transaction, never for the session, so it cannot reach another request on a
-- pooled connection. A PATCH without a status (dates) does not set it, so status_auto is left alone.
--
-- The trigger honours it only for an UPDATE in which status_auto itself is not being written. The deceased trigger
-- and rule 3 always write status_auto (to true, or back to false on a revert) themselves, so they ignore it.

CREATE OR REPLACE FUNCTION public.kinship_unions_widowed_rule() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_prev text := coalesce(current_setting('kinship.widow_internal', true), 'off');
  v_gone boolean;
BEGIN
  -- Rule 4. A change of status_auto itself means a function of 0007 wrote the row (the app role cannot), so a row
  -- where status_auto is untouched is a change by hand when the status differs, or when the API says a status was
  -- sent with this update (kinship.union_status_by_hand).
  IF TG_OP = 'UPDATE'
     AND NEW.status_auto IS NOT DISTINCT FROM OLD.status_auto
     AND (NEW.status IS DISTINCT FROM OLD.status
          OR coalesce(current_setting('kinship.union_status_by_hand', true), '') = 'on') THEN
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
