-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- 0009: custom relationship labels ("Godmother", "Guardian"): a note between two people that is not a parent
-- or partner link.
--
-- Meaning of a row: to_id IS the label OF from_id. "Carla is Marcus's Godmother" is from_id = Marcus,
-- to_id = Carla, label = 'Godmother', and optionally reverse_label = 'Godchild' (what Marcus is to Carla).
-- One row shows on both profiles; without a reverse label the to side reads "Godmother of Marcus".
--
-- A label is only a label: it never feeds the tree, the cycle checks, the "my line" rule, next of kin or the
-- adoption logic. Nothing in 0004 to 0008 reads this table, and nothing here touches those tables.
--
-- Same row-level security pattern as unions: enabled and forced; any signed-in account reads; only admins write.

CREATE TABLE relationship_labels (
  id             uuid        PRIMARY KEY DEFAULT uuidv7(),
  from_id        uuid        NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  to_id          uuid        NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  label          text        NOT NULL CHECK (label = btrim(label) AND length(label) BETWEEN 1 AND 60),
  reverse_label  text        CHECK (reverse_label = btrim(reverse_label) AND length(reverse_label) BETWEEN 1 AND 60),
  created_by     uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT relationship_labels_people_differ CHECK (from_id <> to_id)
);
-- The same pair can carry several labels, and the reverse direction can carry the same one; only the exact
-- same pair in the same direction with the same label (any case) is a duplicate.
CREATE UNIQUE INDEX relationship_labels_unique ON relationship_labels (from_id, to_id, lower(label));
CREATE INDEX relationship_labels_to_idx ON relationship_labels (to_id);

ALTER TABLE relationship_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationship_labels FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  app_role text := current_setting('kinship.app_role', true);
BEGIN
  IF app_role IS NULL OR app_role = '' THEN
    RAISE EXCEPTION 'kinship.app_role is not set; run migrations through the KinShip migration runner';
  END IF;
  EXECUTE format('REVOKE ALL ON relationship_labels FROM %I', app_role);
  EXECUTE format('GRANT SELECT, DELETE ON relationship_labels TO %I', app_role);
  EXECUTE format('GRANT INSERT (from_id, to_id, label, reverse_label, created_by) ON relationship_labels TO %I', app_role);
  -- The two people of a label never change (delete it and make a new one); only its wording does.
  EXECUTE format('GRANT UPDATE (label, reverse_label) ON relationship_labels TO %I', app_role);
END
$$;

CREATE POLICY relationship_labels_select ON relationship_labels FOR SELECT
  USING ((SELECT public.kinship_role()) IS NOT NULL);
CREATE POLICY relationship_labels_insert ON relationship_labels FOR INSERT
  WITH CHECK ((SELECT public.kinship_is_admin()) AND created_by = public.kinship_user_id());
CREATE POLICY relationship_labels_update ON relationship_labels FOR UPDATE
  USING ((SELECT public.kinship_is_admin()))
  WITH CHECK ((SELECT public.kinship_is_admin()));
CREATE POLICY relationship_labels_delete ON relationship_labels FOR DELETE
  USING ((SELECT public.kinship_is_admin()));
