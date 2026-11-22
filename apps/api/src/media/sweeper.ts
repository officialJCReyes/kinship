// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The safety net for files nobody refers to any more: a crash between writing a file and committing its row, a delete whose file
// removal failed, a person deleted by an old process. Every hour it removes an object file that no media row names, but only
// when it is
//   - older than one hour (an upload in progress writes its file a moment before its row commits), and
//   - not inside a hold (after a database-only restore the files uploaded since the backup are orphans on purpose: the restore
//     writes `.sweep-hold` with a time seven days ahead, and nothing is removed until it passes).
// It does nothing while a backup, test or restore holds the backup lock, and nothing at all unless the files folder is ready (a
// missing mount is never an empty folder). It also clears old leftovers in tmp/.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'kysely';
import { BACKUP_LOCK_KEY } from '../backup/archive.js';
import type { UntypedDb } from '../db.js';
import type { ObjectStore } from '../files/objects.js';
import type { FilesService } from '../files/state.js';
import type { Job, JobLog } from '../jobs/runner.js';
import { usedStorageIds } from './store.js';

export const HOUR_MS = 60 * 60 * 1000;
export const HOLD_FILE = '.sweep-hold';

export interface SweepResult {
  /** Why nothing was done, or null when the sweep ran. */
  skipped: 'not_ready' | 'backup_running' | null;
  removed: string[];
  held: boolean;
  tmpRemoved: number;
}

export interface SweeperDeps {
  db: UntypedDb;
  files: Pick<FilesService, 'status' | 'dir'>;
  objects: ObjectStore;
  log: JobLog;
}

/** The end of the hold (ms since the epoch), or 0 when there is none. */
export function holdUntil(dir: string): number {
  try {
    const at = Date.parse(readFileSync(join(dir, HOLD_FILE), 'utf8').trim());
    return Number.isFinite(at) ? at : 0;
  } catch {
    return 0;
  }
}

export async function sweepOrphans(deps: SweeperDeps, now = Date.now()): Promise<SweepResult> {
  const { db, files, objects } = deps;
  const result: SweepResult = { skipped: null, removed: [], held: false, tmpRemoved: 0 };
  if (files.status().state !== 'ready') return { ...result, skipped: 'not_ready' };
  return db.connection().execute(async (conn) => {
    const lock = await sql<{ ok: boolean }>`select pg_try_advisory_lock(${BACKUP_LOCK_KEY}) as ok`.execute(conn);
    if (!lock.rows[0]?.ok) return { ...result, skipped: 'backup_running' as const };
    // Only probed: an in-app restore pauses the job runner, and the command line runs with the api stopped, so nothing else
    // changes the folder while this runs. Holding the lock would only make a scheduled backup find it busy.
    await sql`select pg_advisory_unlock(${BACKUP_LOCK_KEY})`.execute(conn);
    result.tmpRemoved = objects.clearTmp(HOUR_MS, now);
    if (holdUntil(files.dir) > now) return { ...result, held: true };
    const used = await usedStorageIds(db);
    for (const object of objects.list()) {
      if (used.has(object.storageId) || now - object.modifiedMs < HOUR_MS) continue;
      if (objects.remove(object.storageId)) result.removed.push(object.storageId);
    }
    if (result.removed.length > 0)
      deps.log('info', 'removed files no photo refers to', { count: result.removed.length });
    return result;
  });
}

/** The hourly job. */
export function createSweeperJob(deps: SweeperDeps): Job {
  let last = 0;
  return {
    name: 'files-sweep',
    async run(now) {
      if (now.getTime() - last < HOUR_MS) return;
      last = now.getTime();
      await sweepOrphans(deps, now.getTime());
    },
  };
}
