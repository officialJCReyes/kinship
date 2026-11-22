// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'kysely';
import type { UntypedDb } from '../../src/db.js';
import { deriveFileKeys } from '../../src/files/key.js';
import type { FileKeys } from '../../src/files/key.js';
import { createObjectStore } from '../../src/files/objects.js';
import { MARKER } from '../../src/files/state.js';

export interface TestPhoto {
  id: string;
  storageId: string;
  avatarStorageId: string;
  full: Buffer;
  avatar: Buffer;
}

/** A files folder as the api sets one up (marker, objects/, tmp/, staging/). */
export function setUpFilesFolder(dir: string): void {
  for (const sub of ['objects', 'tmp', 'staging']) mkdirSync(join(dir, sub), { recursive: true });
  writeFileSync(join(dir, MARKER), JSON.stringify({ version: 1, id: 'test' }));
}

/**
 * Adds one "photo" the way an upload would leave it: two encrypted files on disk and a media row (as the owner, so it needs no
 * signed-in account). The bytes are random, not a real picture: nothing here decodes them.
 */
export async function addTestPhoto(
  owner: UntypedDb,
  filesDir: string,
  keys: FileKeys,
  size = 3000,
): Promise<TestPhoto> {
  const store = createObjectStore(filesDir, () => keys);
  const full = randomBytes(size);
  const avatar = randomBytes(Math.max(10, Math.floor(size / 10)));
  const a = store.put(full);
  const b = store.put(avatar);
  const row = await sql<{ id: string }>`
    insert into media_files (storage_id, avatar_storage_id, mime, size, avatar_size, width, height, key_id)
    values (${a.storageId}, ${b.storageId}, 'image/jpeg', ${a.bytes}, ${b.bytes}, 640, 480, ${keys.keyId.toString('hex')})
    returning id`.execute(owner);
  return { id: (row.rows[0] as { id: string }).id, storageId: a.storageId, avatarStorageId: b.storageId, full, avatar };
}

export const testKeys = (): FileKeys => deriveFileKeys(randomBytes(32));
