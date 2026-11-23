// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The photos inside a backup (ADR 0033, ADR 0035). The archive carries every stored file as it is on disk, still encrypted with
// the file key (a backup never holds the key), as `files/<storage_id>`, and an index `files.json` that says what each one must be:
// its size, its SHA-256 and the id of the key it was sealed with. The list of files comes from the database under the SAME
// exported snapshot as the dump, never from a listing of the folder afterwards: a file uploaded after the snapshot has no row in
// the dump and is left out; a file whose row is in the dump is in the archive, or named in `missing`.
import { createHash } from 'node:crypto';
import { copyFileSync, linkSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'kysely';
import type { UntypedDb } from '../db.js';
import { readFileKeyId } from '../files/crypto.js';
import { STORAGE_ID } from '../files/objects.js';
import { MARKER } from '../files/state.js';
import { BackupError } from './errors.js';

export interface IndexedFile {
  /** The storage id: 32 lowercase hex characters, the entry's name under files/. */
  name: string;
  /** Bytes of the stored (encrypted) file. */
  bytes: number;
  sha256: string;
  /** The key id (16 hex) in the file's own header. */
  keyId: string;
}

/** files.json */
export interface FilesIndex {
  version: 1;
  files: IndexedFile[];
  /** Rows that were in the database but whose file was not on disk (a damaged install). Restore accepts them; the photo shows a placeholder. */
  missing: string[];
}

export interface CollectedFiles {
  index: FilesIndex;
  /** Where each file is on this machine (not written into the archive). */
  paths: Map<string, string>;
  bytes: number;
}

export const objectPath = (filesDir: string, storageId: string): string =>
  join(filesDir, 'objects', storageId.slice(0, 2), storageId);

/** Bytes of the stored files the database knows about (both variants), for the free-space rule. */
export async function storedFilesBytes(conn: UntypedDb | { executeQuery: unknown }): Promise<number> {
  const result = await sql<{
    n: string;
  }>`select coalesce(sum(size + avatar_size), 0)::text as n from media_files`.execute(conn as UntypedDb);
  return Number(result.rows[0]?.n ?? 0);
}

/**
 * Reads the list of files from the open snapshot transaction on `conn`, then each file from `filesDir`. Throws a BackupError when
 * there are photos in the database but the files folder is not the one that holds them (no marker): a backup that quietly leaves
 * every photo out would be worse than one that fails and says why.
 *
 * With `stageDir`, each file is put there (a hard link when the two folders share a disk, else a copy) AT ONCE, while it is read.
 * A photo deleted a moment later (someone removes it while the backup runs) then cannot make the archive fail: the backup holds
 * the file as it was at the snapshot. A file that is gone by the time it is staged is listed as missing, like one that was never there.
 */
export async function collectFiles(conn: UntypedDb, filesDir: string, stageDir?: string): Promise<CollectedFiles> {
  const rows = await sql<{ id: string }>`
    select storage_id as id from media_files union all select avatar_storage_id from media_files order by 1`.execute(
    conn,
  );
  const ids = rows.rows.map((r) => r.id);
  const index: FilesIndex = { version: 1, files: [], missing: [] };
  const paths = new Map<string, string>();
  if (ids.length === 0) return { index, paths, bytes: 0 };
  try {
    readFileSync(join(filesDir, MARKER));
  } catch {
    throw new BackupError(
      'files',
      `There are photos in the database but the files folder ${filesDir} is not usable (it is not mounted, or it is not the folder that holds them), so a backup with files cannot be made. Fix the mount (see Admin > Backups), or switch off "Include uploaded files" to back up the database alone.`,
    );
  }
  let bytes = 0;
  for (const name of ids) {
    if (!STORAGE_ID.test(name)) throw new BackupError('archive', 'A photo has an unsafe file name.');
    const path = objectPath(filesDir, name);
    let data: Buffer;
    try {
      data = readFileSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        index.missing.push(name);
        continue;
      }
      throw error;
    }
    let keyId: string;
    try {
      keyId = readFileKeyId(data).toString('hex');
    } catch {
      throw new BackupError(
        'archive',
        `A stored photo file (${name.slice(0, 8)}…) is not a KinShip file, so it cannot be backed up.`,
      );
    }
    let kept = path;
    if (stageDir) {
      mkdirSync(stageDir, { recursive: true, mode: 0o700 });
      kept = join(stageDir, name);
      try {
        linkSync(path, kept);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          index.missing.push(name);
          continue;
        }
        // Another disk (the usual case in Docker: two mounted folders), or a file system that cannot link: copy it.
        try {
          copyFileSync(path, kept);
        } catch (copyError) {
          if ((copyError as NodeJS.ErrnoException).code === 'ENOENT') {
            index.missing.push(name);
            continue;
          }
          throw copyError;
        }
      }
    }
    index.files.push({ name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), keyId });
    paths.set(name, kept);
    bytes += data.length;
  }
  return { index, paths, bytes };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Checks the shape of a files.json read from an archive. Throws an Error with a plain message. */
export function parseFilesIndex(value: unknown): FilesIndex {
  const fail = (what: string): never => {
    throw new Error(`The backup's file index is not valid (${what}).`);
  };
  if (!isRecord(value) || value['version'] !== 1) return fail('version');
  if (!Array.isArray(value['files']) || !Array.isArray(value['missing'])) return fail('lists');
  const seen = new Set<string>();
  for (const f of value['files'] as unknown[]) {
    if (!isRecord(f)) return fail('entry');
    if (typeof f['name'] !== 'string' || !STORAGE_ID.test(f['name'])) return fail('name');
    if (seen.has(f['name'])) return fail('repeated name');
    seen.add(f['name']);
    if (!Number.isInteger(f['bytes']) || (f['bytes'] as number) < 0) return fail('bytes');
    if (typeof f['sha256'] !== 'string' || !/^[0-9a-f]{64}$/.test(f['sha256'])) return fail('sha256');
    if (typeof f['keyId'] !== 'string' || !/^[0-9a-f]{16}$/.test(f['keyId'])) return fail('keyId');
  }
  for (const m of value['missing'] as unknown[]) {
    if (typeof m !== 'string' || !STORAGE_ID.test(m) || seen.has(m)) return fail('missing');
  }
  return value as unknown as FilesIndex;
}
