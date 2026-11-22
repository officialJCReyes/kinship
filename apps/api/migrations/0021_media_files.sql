-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- 0021: photos (ADR 0033, ADR 0034).
--
--   * media_files        one row per uploaded photo. The bytes are NOT here: they are encrypted files on the files volume, named by
--                        storage_id (the full-size variant) and avatar_storage_id (the 192 px variant). No file name, no EXIF, no
--                        place: only the facts below. taken_on is the optional "date taken", the same typed partial date as a
--                        person's birth date (YYYY, YYYY-MM or YYYY-MM-DD; empty is allowed).
--   * media_people       which people a photo shows. One person today; the shape allows several later.
--   * people.photo_media_id   the profile photo. A composite foreign key makes the database itself refuse a profile photo that is
--                        not linked to that person, and unlinking (or deleting the photo) clears it.
--
-- Additive only (expand): three new objects and one new nullable column. The previous release never selects it and ignores the
-- tables. Runs as the owner role. The app role's name arrives in "kinship.app_role" (see 0001).
--
-- Who may do what (row-level security, forced; the API checks the same with clearer errors):
--   read          every signed-in account (photos of living people are visible to everyone, by decision).
--   upload        SuperAdmin, Family Admin and Member, recorded as the uploader. Users never.
--   link / unlink whoever may change that person (kinship_can_edit_person): admins; a Member for their own person and people in
--                 their line that they added.
--   date taken    the uploader, or anyone who may change a person the photo is linked to.
--   delete        admins, or the uploader (a Member or admin). The links go with it.

CREATE TABLE media_files (
  id                uuid        PRIMARY KEY DEFAULT uuidv7(),
  -- 128 random bits as 32 hex characters: the file's name under objects/<first two>/.
  storage_id        text        NOT NULL UNIQUE CHECK (storage_id ~ '^[0-9a-f]{32}$'),
  avatar_storage_id text        NOT NULL UNIQUE CHECK (avatar_storage_id ~ '^[0-9a-f]{32}$' AND avatar_storage_id <> storage_id),
  mime              text        NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  -- Bytes of the stored (encrypted) files.
  size              bigint      NOT NULL CHECK (size > 0),
  avatar_size       bigint      NOT NULL CHECK (avatar_size > 0),
  width             integer     NOT NULL CHECK (width BETWEEN 1 AND 100000),
  height            integer     NOT NULL CHECK (height BETWEEN 1 AND 100000),
  taken_on          public.partial_date,
  -- The non-secret id of the key the files were sealed with (16 hex characters).
  key_id            text        NOT NULL CHECK (key_id ~ '^[0-9a-f]{16}$'),
  uploaded_by       uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_files_uploaded_by_idx ON media_files (uploaded_by);
CREATE INDEX media_files_created_idx ON media_files (created_at DESC, id DESC);

CREATE TABLE media_people (
  media_id   uuid NOT NULL REFERENCES media_files (id) ON DELETE CASCADE,
  person_id  uuid NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  PRIMARY KEY (media_id, person_id)
);
CREATE INDEX media_people_person_idx ON media_people (person_id, media_id);

ALTER TABLE people ADD COLUMN photo_media_id uuid;
-- The photo must exist ...
ALTER TABLE people ADD CONSTRAINT people_photo_media_fk
  FOREIGN KEY (photo_media_id) REFERENCES media_files (id) ON DELETE SET NULL (photo_media_id);
-- ... and be linked to this very person. Unlinking it clears the profile photo (a null photo_media_id is not checked).
ALTER TABLE people ADD CONSTRAINT people_photo_linked_fk
  FOREIGN KEY (photo_media_id, id) REFERENCES media_people (media_id, person_id) ON DELETE SET NULL (photo_media_id);
CREATE INDEX people_photo_media_idx ON people (photo_media_id) WHERE photo_media_id IS NOT NULL;

-- May the signed-in account change this person? Same answer as the people UPDATE policy (0005), looked up by id.
CREATE FUNCTION public.kinship_can_edit_person_id(p_person uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT coalesce((SELECT public.kinship_can_edit_person(p.id, p.created_by) FROM public.people p WHERE p.id = p_person), false)
$fn$;

-- Three questions the api asks at start-up and in the sweeper, before anyone is signed in, so row-level security would show it an
-- empty table. They answer only: are there photos, which key ids were they sealed with, and which file names are in use.
CREATE FUNCTION public.kinship_media_exists() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT EXISTS (SELECT 1 FROM public.media_files) $fn$;

CREATE FUNCTION public.kinship_media_key_ids() RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT DISTINCT key_id FROM public.media_files $fn$;

CREATE FUNCTION public.kinship_media_storage_ids() RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT storage_id FROM public.media_files UNION ALL SELECT avatar_storage_id FROM public.media_files $fn$;

ALTER TABLE media_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_files FORCE ROW LEVEL SECURITY;
ALTER TABLE media_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_people FORCE ROW LEVEL SECURITY;

CREATE POLICY media_files_select ON media_files FOR SELECT
  USING ((SELECT public.kinship_role()) IS NOT NULL);
CREATE POLICY media_files_insert ON media_files FOR INSERT
  WITH CHECK (
    uploaded_by = public.kinship_user_id()
    AND (SELECT public.kinship_role()) IN ('superadmin', 'familyadmin', 'member')
  );
CREATE POLICY media_files_update ON media_files FOR UPDATE
  USING (
    (SELECT public.kinship_role()) IN ('superadmin', 'familyadmin', 'member')
    AND (
      uploaded_by = public.kinship_user_id()
      OR EXISTS (SELECT 1 FROM media_people mp WHERE mp.media_id = media_files.id AND public.kinship_can_edit_person_id(mp.person_id))
    )
  )
  WITH CHECK (
    (SELECT public.kinship_role()) IN ('superadmin', 'familyadmin', 'member')
    AND (
      uploaded_by = public.kinship_user_id()
      OR EXISTS (SELECT 1 FROM media_people mp WHERE mp.media_id = media_files.id AND public.kinship_can_edit_person_id(mp.person_id))
    )
  );
CREATE POLICY media_files_delete ON media_files FOR DELETE
  USING (
    (SELECT public.kinship_is_admin())
    OR (uploaded_by = public.kinship_user_id() AND (SELECT public.kinship_role()) = 'member')
  );

CREATE POLICY media_people_select ON media_people FOR SELECT
  USING ((SELECT public.kinship_role()) IS NOT NULL);
CREATE POLICY media_people_insert ON media_people FOR INSERT
  WITH CHECK (public.kinship_can_edit_person_id(person_id));
CREATE POLICY media_people_delete ON media_people FOR DELETE
  USING (public.kinship_can_edit_person_id(person_id));

DO $$
DECLARE
  app_role text := current_setting('kinship.app_role', true);
BEGIN
  IF app_role IS NULL OR app_role = '' THEN
    RAISE EXCEPTION 'kinship.app_role is not set; run migrations through the KinShip migration runner';
  END IF;
  -- New tables start with every privilege for the app role (0001's default privileges); take them back, then give what is needed.
  EXECUTE format('REVOKE ALL ON media_files, media_people FROM %I', app_role);
  EXECUTE format('GRANT SELECT, DELETE ON media_files TO %I', app_role);
  EXECUTE format(
    'GRANT INSERT (storage_id, avatar_storage_id, mime, size, avatar_size, width, height, taken_on, key_id, uploaded_by) ON media_files TO %I',
    app_role);
  EXECUTE format('GRANT UPDATE (taken_on) ON media_files TO %I', app_role);
  EXECUTE format('GRANT SELECT, INSERT, DELETE ON media_people TO %I', app_role);
  -- people uses column grants (0003): the profile photo is one more column the app may change.
  EXECUTE format('GRANT UPDATE (photo_media_id) ON people TO %I', app_role);
  REVOKE ALL ON FUNCTION public.kinship_media_exists(), public.kinship_media_key_ids(), public.kinship_media_storage_ids() FROM PUBLIC;
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION public.kinship_media_exists(), public.kinship_media_key_ids(), public.kinship_media_storage_ids() TO %I',
    app_role);
END
$$;
