// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The media rows (migration 0021). Every function takes the request's transaction, so row-level security decides who may do what;
// none of them touches a file. Whoever deletes rows gets the storage ids back and removes the files AFTER the transaction commits
// (a rolled-back delete must not lose a file; a file left behind is only an orphan the sweeper removes).
import type { Transaction } from 'kysely';
import { sql } from 'kysely';
import type { Database, UntypedDb } from '../db.js';

type Trx = Transaction<Database>;

export interface MediaRow {
  id: string;
  storageId: string;
  avatarStorageId: string;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  size: number;
  avatarSize: number;
  width: number;
  height: number;
  /** As typed: YYYY, YYYY-MM or YYYY-MM-DD, or null. */
  takenOn: string | null;
  keyId: string;
  uploadedBy: string | null;
  createdAt: string;
}

export interface NewMedia {
  storageId: string;
  avatarStorageId: string;
  mime: MediaRow['mime'];
  size: number;
  avatarSize: number;
  width: number;
  height: number;
  takenOn: string | null;
  keyId: string;
  uploadedBy: string;
}

type Raw = Database['media_files'];
const COLUMNS = [
  'id',
  'storage_id',
  'avatar_storage_id',
  'mime',
  'size',
  'avatar_size',
  'width',
  'height',
  'taken_on',
  'key_id',
  'uploaded_by',
  'created_at',
] as const;

function toRow(r: {
  [K in (typeof COLUMNS)[number]]: K extends 'id' ? string : K extends 'created_at' ? Date : Raw[K];
}): MediaRow {
  return {
    id: r.id,
    storageId: r.storage_id,
    avatarStorageId: r.avatar_storage_id,
    mime: r.mime,
    size: Number(r.size),
    avatarSize: Number(r.avatar_size),
    width: r.width,
    height: r.height,
    takenOn: r.taken_on,
    keyId: r.key_id,
    uploadedBy: r.uploaded_by,
    createdAt: r.created_at.toISOString(),
  };
}

export async function insertMedia(trx: Trx, media: NewMedia): Promise<MediaRow> {
  const row = await trx
    .insertInto('media_files')
    .values({
      storage_id: media.storageId,
      avatar_storage_id: media.avatarStorageId,
      mime: media.mime,
      size: media.size,
      avatar_size: media.avatarSize,
      width: media.width,
      height: media.height,
      taken_on: media.takenOn,
      key_id: media.keyId,
      uploaded_by: media.uploadedBy,
    })
    .returning([...COLUMNS])
    .executeTakeFirstOrThrow();
  return toRow(row);
}

export async function getMedia(trx: Trx, id: string): Promise<MediaRow | null> {
  const row = await trx
    .selectFrom('media_files')
    .select([...COLUMNS])
    .where('id', '=', id)
    .executeTakeFirst();
  return row ? toRow(row) : null;
}

/** The photos linked to a person, newest first. */
export async function listPersonMedia(trx: Trx, personId: string): Promise<MediaRow[]> {
  const rows = await trx
    .selectFrom('media_files as m')
    .innerJoin('media_people as mp', 'mp.media_id', 'm.id')
    .select(COLUMNS.map((c) => `m.${c}` as `m.${(typeof COLUMNS)[number]}`))
    .where('mp.person_id', '=', personId)
    .orderBy('m.created_at', 'desc')
    .orderBy('m.id', 'desc')
    .execute();
  return rows.map((r) => toRow(r as never));
}

/** The people a photo is linked to. */
export async function mediaPeople(trx: Trx, mediaId: string): Promise<string[]> {
  const rows = await trx.selectFrom('media_people').select('person_id').where('media_id', '=', mediaId).execute();
  return rows.map((r) => r.person_id);
}

export async function linkMedia(trx: Trx, mediaId: string, personId: string): Promise<void> {
  await trx
    .insertInto('media_people')
    .values({ media_id: mediaId, person_id: personId })
    .onConflict((c) => c.doNothing())
    .execute();
}

/** Unlinks a photo from a person (this clears the profile photo when it was that one: the database does it). */
export async function unlinkMedia(trx: Trx, mediaId: string, personId: string): Promise<boolean> {
  const result = await trx
    .deleteFrom('media_people')
    .where('media_id', '=', mediaId)
    .where('person_id', '=', personId)
    .executeTakeFirst();
  return (result.numDeletedRows ?? 0n) > 0n;
}

/** Sets the date taken (typed text or null). True when a row was changed (false: no such photo, or not allowed). */
export async function setTakenOn(trx: Trx, id: string, takenOn: string | null): Promise<boolean> {
  const result = await trx
    .updateTable('media_files')
    .set({ taken_on: takenOn })
    .where('id', '=', id)
    .executeTakeFirst();
  return (result.numUpdatedRows ?? 0n) > 0n;
}

/** Sets or clears the profile photo. The database refuses a photo that is not linked to this person. */
export async function setProfilePhoto(trx: Trx, personId: string, mediaId: string | null): Promise<void> {
  await trx.updateTable('people').set({ photo_media_id: mediaId }).where('id', '=', personId).execute();
}

export interface RemovedFiles {
  storageIds: string[];
}

/** Deletes a photo row (its links go with it) and returns the files to remove after the commit. null when it is not there or not allowed. */
export async function deleteMedia(trx: Trx, id: string): Promise<RemovedFiles | null> {
  const row = await trx
    .deleteFrom('media_files')
    .where('id', '=', id)
    .returning(['storage_id', 'avatar_storage_id'])
    .executeTakeFirst();
  return row ? { storageIds: [row.storage_id, row.avatar_storage_id] } : null;
}

/**
 * Deletes the photos that show this person and nobody else (call it BEFORE deleting the person, whose links then cascade) and
 * returns their files to remove after the commit. A photo that shows someone else too stays.
 */
export async function deleteMediaOnlyOf(trx: Trx, personId: string): Promise<RemovedFiles> {
  const rows = await sql<{ storage_id: string; avatar_storage_id: string }>`
    delete from media_files m
     where exists (select 1 from media_people mp where mp.media_id = m.id and mp.person_id = ${personId}::uuid)
       and not exists (select 1 from media_people mp where mp.media_id = m.id and mp.person_id <> ${personId}::uuid)
    returning m.storage_id, m.avatar_storage_id`.execute(trx);
  return { storageIds: rows.rows.flatMap((r) => [r.storage_id, r.avatar_storage_id]) };
}

// ---- questions asked outside a request (start-up, the sweeper): the database answers them without a signed-in account ----

export async function mediaRowsExist(db: UntypedDb): Promise<boolean> {
  const r = await sql<{ ok: boolean }>`select public.kinship_media_exists() as ok`.execute(db);
  return r.rows[0]?.ok === true;
}

/** The distinct key ids (hex) of the stored photos. */
export async function storedKeyIds(db: UntypedDb): Promise<string[]> {
  const r = await sql<{ id: string }>`select public.kinship_media_key_ids() as id`.execute(db);
  return r.rows.map((row) => row.id);
}

/** Every file name the rows use (full and avatar). */
export async function usedStorageIds(db: UntypedDb): Promise<Set<string>> {
  const r = await sql<{ id: string }>`select public.kinship_media_storage_ids() as id`.execute(db);
  return new Set(r.rows.map((row) => row.id));
}
