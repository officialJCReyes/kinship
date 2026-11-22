// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Putting the photo files back when a backup is restored (ADR 0035). The database and the files folder cannot share one
// transaction, so the order is built to be undone at every step:
//   1. check (the key must be the one that sealed the files; there must be room)
//   2. a safety copy that includes the current files
//   3. unpack the archive's files into staging/<id>/ and verify each one's SHA-256 against the archive's index. `objects/` is untouched
//   4. write the restore intent (<files>/.restore-intent: the restore id)
//   5. the database transaction, which sets the restore marker to that id and, BEFORE it commits, checks that every photo row is
//      covered by the staged files. A mismatch rolls back; the files folder was never touched
//   6. after the commit: objects -> objects.old-<id>, the staged tree -> objects, delete the old one, remove the intent
// A crash after 5 and before 6 is finished at the next start: the database says (through the marker) whether it committed.
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { readFileKeyId } from '../files/crypto.js';
import { MARKER } from '../files/state.js';
import { HOLD_FILE, HOUR_MS } from '../media/sweeper.js';
import { BackupError } from './errors.js';
import type { FilesIndex } from './files.js';
import { run, ToolError } from './tools.js';
import type { Tools } from './tools.js';

export const INTENT_FILE = '.restore-intent';
/** Photos uploaded after a database-only backup are orphans on purpose until this long after the restore. */
export const HOLD_DAYS = 7;

export const newRestoreId = (): string => randomBytes(16).toString('hex');

export const stagingOf = (dir: string, id: string): string => join(dir, 'staging', id);
const treeOf = (dir: string, id: string): string => join(stagingOf(dir, id), 'tree');
const oldOf = (dir: string, id: string): string => join(dir, `objects.old-${id}`);

export interface RestoreIntent {
  version: 1;
  id: string;
  startedAt: string;
}

function writeAtomic(path: string, text: string): void {
  const temp = `${path}.${randomBytes(3).toString('hex')}.tmp`;
  const fd = openSync(temp, 'wx', 0o600);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, path);
}

export function writeIntent(dir: string, id: string, now = new Date()): void {
  const intent: RestoreIntent = { version: 1, id, startedAt: now.toISOString() };
  writeAtomic(join(dir, INTENT_FILE), JSON.stringify(intent));
}

export function readIntent(dir: string): RestoreIntent | null {
  try {
    const value: unknown = JSON.parse(readFileSync(join(dir, INTENT_FILE), 'utf8'));
    if (typeof value === 'object' && value !== null) {
      const v = value as Record<string, unknown>;
      if (v['version'] === 1 && typeof v['id'] === 'string' && /^[0-9a-f]{32}$/.test(v['id'])) {
        return { version: 1, id: v['id'], startedAt: String(v['startedAt'] ?? '') };
      }
    }
  } catch {
    /* no intent, or one that cannot be read: treated as none */
  }
  return null;
}

const removeIntent = (dir: string) => rmSync(join(dir, INTENT_FILE), { force: true });

/** A folder with the marker, objects/, tmp/ and staging/ (a brand-new server restoring onto an empty mount has none of them). */
export function ensureFilesFolder(dir: string): void {
  for (const sub of ['objects', 'tmp', 'staging']) mkdirSync(join(dir, sub), { recursive: true, mode: 0o700 });
  if (!existsSync(join(dir, MARKER))) {
    writeAtomic(join(dir, MARKER), JSON.stringify({ version: 1, id: randomBytes(8).toString('hex') }));
  }
}

/**
 * Unpacks the archive's files into staging/<id>/tree/<2 hex>/<name>, checking each against the index (size, SHA-256, and the key id
 * in its own header). Throws a BackupError and leaves nothing behind when any file is wrong. `objects/` is never touched.
 */
export async function stageFiles(
  tools: Tools,
  tarPath: string,
  index: FilesIndex,
  dir: string,
  id: string,
): Promise<{ count: number; bytes: number }> {
  const staging = stagingOf(dir, id);
  const raw = join(staging, 'raw');
  try {
    mkdirSync(raw, { recursive: true, mode: 0o700 });
    mkdirSync(treeOf(dir, id), { recursive: true, mode: 0o700 });
    if (index.files.length > 0) {
      const result = await run(tools.tar, ['-x', '-f', tarPath, '-C', raw, 'files'], {
        env: { PATH: process.env['PATH'] ?? '' },
      });
      if (result.code !== 0) throw new ToolError('tar', result.code, result.stderr);
    }
    let bytes = 0;
    for (const file of index.files) {
      const from = join(raw, 'files', file.name);
      let data: Buffer;
      try {
        data = readFileSync(from);
      } catch {
        throw new BackupError('archive', 'A photo file listed in the backup is not in it. Nothing was changed.');
      }
      if (data.length !== file.bytes || createHash('sha256').update(data).digest('hex') !== file.sha256) {
        throw new BackupError(
          'archive',
          'A photo file in the backup does not match its checksum. Nothing was changed.',
        );
      }
      let keyId: string;
      try {
        keyId = readFileKeyId(data).toString('hex');
      } catch {
        throw new BackupError('archive', 'A photo file in the backup is not a KinShip file. Nothing was changed.');
      }
      if (keyId !== file.keyId) {
        throw new BackupError(
          'archive',
          'A photo file in the backup was sealed with a different key than its index says. Nothing was changed.',
        );
      }
      const to = join(treeOf(dir, id), file.name.slice(0, 2));
      mkdirSync(to, { recursive: true, mode: 0o700 });
      renameSync(from, join(to, file.name));
      bytes += data.length;
    }
    rmSync(raw, { recursive: true, force: true });
    return { count: index.files.length, bytes };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

/** The check that runs before the commit: every file name the restored rows use is in the staged files (or was already missing). */
export function checkRowsCovered(ids: readonly string[], index: FilesIndex): void {
  const have = new Set([...index.files.map((f) => f.name), ...index.missing]);
  const uncovered = ids.filter((id) => !have.has(id)).length;
  if (uncovered > 0) {
    throw new BackupError(
      'archive',
      `The photos in the backup's database and the photo files in the backup do not match (${uncovered} are not in the backup). Nothing was changed.`,
    );
  }
}

/** Throws the staged files away and forgets the intent. The files folder is exactly as it was. */
export function discardStaging(dir: string, id: string): void {
  rmSync(stagingOf(dir, id), { recursive: true, force: true });
  removeIntent(dir);
}

/**
 * After the database committed: objects -> objects.old-<id>, the staged tree -> objects, delete the old one, remove the staging
 * and the intent. Safe to run again at any point (each step looks at what is there), which is how a crash in the middle is finished.
 */
export function finishSwap(dir: string, id: string): void {
  const objects = join(dir, 'objects');
  const old = oldOf(dir, id);
  const tree = treeOf(dir, id);
  if (existsSync(tree)) {
    if (existsSync(objects)) {
      if (existsSync(old))
        throw new BackupError('archive', 'The files folder is in an unexpected state; it was not changed.');
      renameSync(objects, old);
    }
    renameSync(tree, objects);
  }
  rmSync(old, { recursive: true, force: true });
  rmSync(stagingOf(dir, id), { recursive: true, force: true });
  removeIntent(dir);
  ensureFilesFolder(dir);
  // The photos now match the database: nothing is an orphan on purpose.
  rmSync(join(dir, HOLD_FILE), { force: true });
}

/** After a database-only restore, files uploaded since that backup have no row: keep them for a week before the sweeper may remove them. */
export function writeSweepHold(dir: string, now = Date.now()): void {
  if (!existsSync(dir)) return;
  writeAtomic(join(dir, HOLD_FILE), new Date(now + HOLD_DAYS * 24 * HOUR_MS).toISOString());
}

export type ReconcileResult = { action: 'none' } | { action: 'completed' | 'discarded'; id: string };

/**
 * At start-up: finishes or abandons a restore that was cut short. `readMarker` is the restore id the database carries (the comment
 * the restore transaction sets). The same id as the intent means the database committed, so the files are swapped in; anything
 * else means it did not, so the staged files are discarded. Any other leftover staging folder is removed (nothing is running).
 */
export async function reconcileFiles(dir: string, readMarker: () => Promise<string | null>): Promise<ReconcileResult> {
  if (!existsSync(dir)) return { action: 'none' };
  const intent = readIntent(dir);
  let result: ReconcileResult = { action: 'none' };
  if (intent) {
    const marker = await readMarker();
    if (marker === intent.id) {
      finishSwap(dir, intent.id);
      result = { action: 'completed', id: intent.id };
    } else {
      discardStaging(dir, intent.id);
      result = { action: 'discarded', id: intent.id };
    }
  }
  // Staging that belongs to no restore in progress (a crash while unpacking), and an old objects folder a crash left.
  try {
    for (const name of readdirSync(join(dir, 'staging')))
      rmSync(join(dir, 'staging', name), { recursive: true, force: true });
    for (const name of readdirSync(dir)) {
      if (/^objects\.old-[0-9a-f]{32}$/.test(name) && statSync(join(dir, name)).isDirectory()) {
        // Only when the swap is done (objects exists): then it is the old copy. Otherwise it is the only copy of the photos.
        if (existsSync(join(dir, 'objects'))) rmSync(join(dir, name), { recursive: true, force: true });
      }
    }
  } catch {
    /* a folder that is not there */
  }
  return result;
}
