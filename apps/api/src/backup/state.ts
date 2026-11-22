// SPDX-License-Identifier: AGPL-3.0-or-later
//
// state.json on the backups volume: the history of backups and tests. It lives next to the archives (not in the database) so
// that a restore does not rewind it and the command line can write it with the api stopped. It holds no secret and no family
// data: file names, sizes, times, counts and error sentences.
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  fsyncSync,
} from 'node:fs';
import { join } from 'node:path';
import { EMPTY_BACKUP_STATE } from '@kinship/shared';
import type { BackupRunRecord, BackupState, BackupTestRecord, RestoreRecord } from '@kinship/shared';

const FILE = 'state.json';
const LOCK = 'state.lock';
const KEEP_RUNS = 50;
const KEEP_RESTORES = 20;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The state, or an empty one when the file is missing or cannot be read (it is a log, not a source of truth). */
export function readState(dir: string): BackupState {
  try {
    const value: unknown = JSON.parse(readFileSync(join(dir, FILE), 'utf8'));
    if (!isRecord(value) || value['version'] !== 1 || !Array.isArray(value['runs']))
      return { ...EMPTY_BACKUP_STATE, runs: [], restores: [] };
    return {
      version: 1,
      runs: (value['runs'] as BackupRunRecord[])
        .filter((r) => isRecord(r) && typeof r.finishedAt === 'string')
        .slice(0, KEEP_RUNS),
      lastTest: isRecord(value['lastTest']) ? (value['lastTest'] as unknown as BackupTestRecord) : null,
      // Older files have no restores: an empty list.
      restores: Array.isArray(value['restores'])
        ? (value['restores'] as RestoreRecord[])
            .filter((r) => isRecord(r) && typeof r.id === 'string' && typeof r.startedAt === 'string')
            .slice(0, KEEP_RESTORES)
        : [],
    };
  } catch {
    return { ...EMPTY_BACKUP_STATE, runs: [], restores: [] };
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A short-lived lock file, so the api and the command line do not overwrite each other's update. A stale lock is removed. */
async function withLock<T>(dir: string, work: () => T): Promise<T> {
  const path = join(dir, LOCK);
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      closeSync(openSync(path, 'wx', 0o600));
      break;
    } catch {
      try {
        if (Date.now() - statSync(path).mtimeMs > 30_000) rmSync(path, { force: true });
      } catch {
        /* gone already */
      }
      if (Date.now() > deadline) throw new Error('could not lock the backup history');
      await sleep(15);
    }
  }
  try {
    return work();
  } finally {
    rmSync(path, { force: true });
  }
}

/** Reads, changes and writes the state under the lock. The write is atomic (temp file, then rename), mode 0600. */
export async function updateState(dir: string, change: (state: BackupState) => void): Promise<BackupState> {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return withLock(dir, () => {
    const state = readState(dir);
    change(state);
    state.runs = state.runs.slice(0, KEEP_RUNS);
    state.restores = state.restores.slice(0, KEEP_RESTORES);
    const temp = join(dir, `.state-${process.pid}-${Date.now()}.tmp`);
    writeFileSync(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
    const fd = openSync(temp, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, join(dir, FILE));
    return state;
  });
}

export const recordRun = (dir: string, run: BackupRunRecord) =>
  updateState(dir, (state) => {
    state.runs.unshift(run);
  });

export const recordTest = (dir: string, test: BackupTestRecord) =>
  updateState(dir, (state) => {
    state.lastTest = test;
  });

/** Adds a restore record (newest first). */
export const recordRestoreStart = (dir: string, record: RestoreRecord) =>
  updateState(dir, (state) => {
    state.restores.unshift(record);
  });

/** Changes the record with this id (the started one) into its final form. A missing id is added, so a result is never lost. */
export const recordRestoreEnd = (
  dir: string,
  id: string,
  end: Partial<RestoreRecord> & Pick<RestoreRecord, 'kind'>,
  fallback: RestoreRecord,
) =>
  updateState(dir, (state) => {
    const at = state.restores.findIndex((r) => r.id === id);
    if (at >= 0) state.restores[at] = { ...(state.restores[at] as RestoreRecord), ...end };
    else state.restores.unshift({ ...fallback, ...end });
  });
