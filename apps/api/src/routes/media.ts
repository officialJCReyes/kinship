// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Photos (ADR 0034). Upload is the raw picture as the request body (no multipart): the type comes from its first bytes. Serving
// decrypts the whole file before the first byte is sent, so a damaged file is an error and never a half picture.
import { MEDIA_PAGE_SIZE } from '@kinship/shared';
import type {
  MediaInfo,
  MediaListItem,
  MediaPage,
  MediaPatch,
  PersonPhotos,
  PhotoUploadResponse,
} from '@kinship/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Transaction } from 'kysely';
import type { Database } from '../db.js';
import { ApiError, badRequest, forbidden, notFound } from '../errors.js';
import { FileCryptoError } from '../files/crypto.js';
import { createObjectStore } from '../files/objects.js';
import type { FilesService } from '../files/state.js';
import { isValidPartialDate } from '../people/dates.js';
import { canEditPerson, isAdmin } from '../people/actor.js';
import type { Actor } from '../people/actor.js';
import { withActor } from '../people/run.js';
import { toRelPerson } from '../people/relationship.js';
import { getPerson, isUuid, PERSON_COLUMNS } from '../people/store.js';
import { processImage } from '../media/image.js';
import {
  deleteMedia,
  getMedia,
  insertMedia,
  linkMedia,
  listMedia,
  listPersonMedia,
  mediaPeople,
  setTakenOn,
  unlinkMedia,
} from '../media/store.js';
import type { MediaRow } from '../media/store.js';

type Trx = Transaction<Database>;

/** The request body limit of an upload: the 10 MB picture and a little room (ADR 0034). nginx allows the same. */
export const UPLOAD_BODY_LIMIT = 12 * 1024 * 1024;

export interface MediaRouteOptions {
  files: FilesService | undefined;
  /** Uploads per account in ten minutes. */
  uploadsPer10Minutes: number;
  /** Picture requests per account and minute, one bucket for every photo and avatar (a family tree draws hundreds at once). */
  mediaRequestsPerMinute: number;
}

const uuidParams = (...names: string[]) => ({
  type: 'object',
  required: names,
  properties: Object.fromEntries(names.map((n) => [n, { type: 'string', maxLength: 64 }])),
});

async function mayEdit(trx: Trx, actor: Actor, row: MediaRow, people: string[]): Promise<boolean> {
  if (!isAdmin(actor) && actor.role !== 'member') return false;
  if (isAdmin(actor) || row.uploadedBy === actor.id) return true;
  for (const personId of people) {
    const person = await getPerson(trx, personId);
    if (person && (await canEditPerson(trx, actor, person))) return true;
  }
  return false;
}

async function infoOf(trx: Trx, actor: Actor, row: MediaRow): Promise<MediaInfo> {
  const people = await mediaPeople(trx, row.id);
  return {
    id: row.id,
    mime: row.mime,
    width: row.width,
    height: row.height,
    takenOn: row.takenOn,
    createdAt: row.createdAt,
    uploadedBy: row.uploadedBy,
    people,
    permissions: {
      edit: await mayEdit(trx, actor, row, people),
      delete: isAdmin(actor) || (actor.role === 'member' && row.uploadedBy === actor.id),
    },
  };
}

export function registerMediaRoutes(app: FastifyInstance, options: MediaRouteOptions): void {
  const { files } = options;
  const keyOf = (request: FastifyRequest) => (request.user?.id ?? request.ip) as string;
  const uploadLimit = {
    rateLimit: { max: options.uploadsPer10Minutes, timeWindow: '10 minutes', keyGenerator: keyOf },
  };
  const readLimit = {
    rateLimit: {
      max: options.mediaRequestsPerMinute,
      timeWindow: '1 minute',
      keyGenerator: keyOf,
      groupId: 'media-get',
    },
  };
  const editLimit = { rateLimit: { max: 120, timeWindow: '1 minute', keyGenerator: keyOf } };

  // The raw picture, as a Buffer. Any other content type is refused by Fastify (415).
  app.addContentTypeParser(
    ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'],
    { parseAs: 'buffer', bodyLimit: UPLOAD_BODY_LIMIT },
    (_request, body, done) => done(null, body),
  );

  /** Photos can be used right now? Looks at the folder again before saying no, so fixing a mount needs no restart. */
  const ready = async (forUpload: boolean): Promise<FilesService> => {
    if (!files) throw new ApiError(503, 'files_unavailable', { reason: 'key_missing' });
    const usable = () => (forUpload ? files.acceptsUploads() : files.usable());
    // An upload looks again every time (a key that stopped matching the stored photos must refuse it); showing a picture only
    // looks again after a "no".
    if (forUpload || !usable()) await files.refresh();
    // `reason` says which of the three it is (key_missing, files_unavailable, key_mismatch), so the page can say what to do.
    if (!usable()) throw new ApiError(503, 'files_unavailable', { reason: files.status().state });
    return files;
  };

  // --- every photo of the family, a page at a time ---------------------------
  app.get(
    '/api/media',
    {
      config: editLimit,
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { person: { type: 'string', maxLength: 64 }, cursor: { type: 'string', maxLength: 64 } },
        },
      },
    },
    async (request): Promise<MediaPage> => {
      const query = request.query as { person?: string; cursor?: string };
      if (query.person !== undefined && !isUuid(query.person)) throw notFound('person_not_found');
      if (query.cursor !== undefined && !isUuid(query.cursor)) throw badRequest('invalid_cursor');
      return withActor(request, async (trx, actor) => {
        const rows = await listMedia(trx, {
          ...(query.person ? { personId: query.person } : {}),
          ...(query.cursor ? { after: query.cursor } : {}),
          limit: MEDIA_PAGE_SIZE,
        });
        const page = rows.slice(0, MEDIA_PAGE_SIZE);
        const ids = page.map((row) => row.id);
        // Who each photo shows, with names: one query for the whole page (row-level security still applies).
        const links = ids.length
          ? await trx
              .selectFrom('media_people as mp')
              .innerJoin('people as p', 'p.id', 'mp.person_id')
              .select([...PERSON_COLUMNS.map((c) => `p.${c}` as `p.${(typeof PERSON_COLUMNS)[number]}`), 'mp.media_id'])
              .where('mp.media_id', 'in', ids)
              .execute()
          : [];
        const shows = new Map<string, MediaListItem['shows']>();
        for (const link of links) {
          const list = shows.get(link.media_id) ?? [];
          list.push(toRelPerson(link as never));
          shows.set(link.media_id, list);
        }
        const items: MediaListItem[] = [];
        for (const row of page) items.push({ ...(await infoOf(trx, actor, row)), shows: shows.get(row.id) ?? [] });
        const last = page.at(-1);
        return { items, nextCursor: rows.length > MEDIA_PAGE_SIZE && last ? last.id : null };
      });
    },
  );

  // --- a person's photos ---------------------------------------------------
  app.get(
    '/api/people/:id/photos',
    { config: editLimit, schema: { params: uuidParams('id') } },
    async (request): Promise<PersonPhotos> => {
      const { id } = request.params as { id: string };
      if (!isUuid(id)) throw notFound('person_not_found');
      return withActor(request, async (trx, actor) => {
        if (!(await getPerson(trx, id))) throw notFound('person_not_found');
        const rows = await listPersonMedia(trx, id);
        const items: MediaInfo[] = [];
        for (const row of rows) items.push(await infoOf(trx, actor, row));
        return { items };
      });
    },
  );

  app.post(
    '/api/people/:id/photos',
    { config: uploadLimit, bodyLimit: UPLOAD_BODY_LIMIT, schema: { params: uuidParams('id') } },
    async (request, reply): Promise<PhotoUploadResponse> => {
      const { id } = request.params as { id: string };
      if (!isUuid(id)) throw notFound('person_not_found');
      const store = await ready(true);
      // Who may do this is settled before any CPU is spent on the picture.
      await withActor(request, async (trx, actor) => {
        const person = await getPerson(trx, id);
        if (!person) throw notFound('person_not_found');
        if (!(await canEditPerson(trx, actor, person))) throw forbidden();
      });
      const body = request.body;
      const processed = await processImage(Buffer.isBuffer(body) ? body : Buffer.alloc(0));
      const keys = store.keys();
      if (!keys) throw new ApiError(503, 'files_unavailable', { reason: 'key_missing' });
      const objects = createObjectStore(store.dir, () => keys);
      const written: string[] = [];
      try {
        const full = objects.put(processed.full);
        written.push(full.storageId);
        const avatar = objects.put(processed.avatar);
        written.push(avatar.storageId);
        const result = await withActor(request, async (trx, actor) => {
          const row = await insertMedia(trx, {
            storageId: full.storageId,
            avatarStorageId: avatar.storageId,
            mime: processed.mime,
            size: full.bytes,
            avatarSize: avatar.bytes,
            width: processed.width,
            height: processed.height,
            takenOn: null,
            keyId: keys.keyId.toString('hex'),
            uploadedBy: actor.id,
          });
          await linkMedia(trx, row.id, id);
          return infoOf(trx, actor, row);
        });
        void reply.code(201);
        return { photo: result, suggestedTakenOn: processed.suggestedTakenOn };
      } catch (error) {
        // The row did not commit: the files are nobody's. (If this fails too, the sweeper removes them within the hour.)
        for (const storageId of written) {
          try {
            objects.remove(storageId);
          } catch {
            /* the sweeper will */
          }
        }
        throw error;
      }
    },
  );

  app.delete(
    '/api/people/:id/photos/:mediaId',
    { config: editLimit, schema: { params: uuidParams('id', 'mediaId') } },
    async (request, reply) => {
      const { id, mediaId } = request.params as { id: string; mediaId: string };
      if (!isUuid(id)) throw notFound('person_not_found');
      if (!isUuid(mediaId)) throw notFound('photo_not_found');
      await withActor(request, async (trx, actor) => {
        const person = await getPerson(trx, id);
        if (!person) throw notFound('person_not_found');
        if (!(await canEditPerson(trx, actor, person))) throw forbidden();
        // Unlinking clears the profile photo too, when it was this one (the database does that).
        if (!(await unlinkMedia(trx, mediaId, id))) throw notFound('photo_not_found');
      });
      return reply.code(204).send();
    },
  );

  // --- one photo -----------------------------------------------------------
  app.patch(
    '/api/media/:id',
    {
      config: editLimit,
      schema: {
        params: uuidParams('id'),
        body: {
          type: 'object',
          required: ['takenOn'],
          additionalProperties: false,
          properties: { takenOn: { anyOf: [{ type: 'null' }, { type: 'string', maxLength: 16 }] } },
        },
      },
    },
    async (request): Promise<MediaInfo> => {
      const { id } = request.params as { id: string };
      const { takenOn } = request.body as MediaPatch;
      if (!isUuid(id)) throw notFound('photo_not_found');
      if (takenOn !== null && !isValidPartialDate(takenOn)) throw badRequest('invalid_date');
      return withActor(request, async (trx, actor) => {
        if (!(await getMedia(trx, id))) throw notFound('photo_not_found');
        if (!(await setTakenOn(trx, id, takenOn))) throw forbidden();
        const row = await getMedia(trx, id);
        if (!row) throw notFound('photo_not_found');
        return infoOf(trx, actor, row);
      });
    },
  );

  app.delete('/api/media/:id', { config: editLimit, schema: { params: uuidParams('id') } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!isUuid(id)) throw notFound('photo_not_found');
    const removed = await withActor(request, async (trx) => {
      if (!(await getMedia(trx, id))) throw notFound('photo_not_found');
      const gone = await deleteMedia(trx, id);
      if (!gone) throw forbidden();
      return gone;
    });
    // After the commit: a rolled-back delete never loses a file, and one left behind is only an orphan the sweeper removes.
    removeFiles(request, files, removed.storageIds);
    return reply.code(204).send();
  });

  // --- the picture itself --------------------------------------------------
  // One route for both variants, so every picture a person looks at counts in one bucket.
  app.get(
    '/api/media/:id/:variant',
    { config: readLimit, schema: { params: uuidParams('id', 'variant') } },
    async (request, reply) => {
      const { id, variant } = request.params as { id: string; variant: string };
      if (!isUuid(id) || (variant !== 'avatar' && variant !== 'full')) throw notFound('photo_not_found');
      const service = await ready(false);
      const row = await request.withTransaction((trx) => getMedia(trx, id));
      if (!row) throw notFound('photo_not_found');
      const keys = service.keys();
      if (!keys || row.keyId !== keys.keyId.toString('hex'))
        throw new ApiError(503, 'files_unavailable', { reason: 'key_mismatch' });
      const objects = createObjectStore(service.dir, () => keys);
      let bytes: Buffer;
      try {
        bytes = objects.read(variant === 'avatar' ? row.avatarStorageId : row.storageId);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw notFound('photo_not_found');
        if (error instanceof FileCryptoError) {
          request.log.error({ code: error.code, media: id }, 'a stored photo could not be decrypted');
          throw new ApiError(500, 'internal_error');
        }
        throw error;
      }
      // Whatever the browser is shown, it is only ever shown as a picture: stored type, no sniffing, no scripts, no framing.
      return reply
        .header('Content-Type', row.mime)
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Security-Policy', "default-src 'none'; sandbox")
        .header('Cache-Control', 'private, max-age=31536000, immutable')
        .send(bytes);
    },
  );
}

/** Removes stored files, one by one; a failure is logged and left to the sweeper. */
export function removeFiles(
  request: FastifyRequest,
  files: FilesService | undefined,
  storageIds: readonly string[],
): void {
  if (!files || storageIds.length === 0) return;
  const objects = createObjectStore(files.dir, () => files.keys());
  for (const storageId of storageIds) {
    try {
      objects.remove(storageId);
    } catch (error) {
      request.log.warn({ err: error }, 'a photo file could not be removed; the sweeper will');
    }
  }
}
