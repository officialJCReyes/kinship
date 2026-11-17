// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The backup schedule, inside the api (no extra service). A tick every 60 seconds asks: is a scheduled backup due and not yet
// made? A backup is due when the latest scheduled moment (in the family's time zone) has passed and no successful backup is
// newer than it, so a run missed while the api was stopped is made up shortly after it starts. One run at a time comes from
// the Postgres advisory lock (a second api container and the command line share it). After a failure it waits 15 minutes.
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { lastSuccessfulBackupAt } from '@kinship/shared';
import type { BackupProblem, BackupRunRecord, BackupSettings, BackupStatus } from '@kinship/shared';
import { createDb } from '../db.js';
import type { AnySchema } from '../db.js';
import { createBackup, ensureBackupDir, listBackups } from './archive.js';
import type { BackupContext } from './archive.js';
import { passphraseState } from './crypto.js';
import { BackupError } from './errors.js';
import { listMediaFiles } from './files.js';
import { applyRetention } from './retention.js';
import { latestDue, nextDue } from './schedule-time.js';
import { readBackupSettings } from './settings.js';
import { readState, recordRun, recordTest } from './state.js';
import { sweepVerifyDatabases, verifyBackup } from './verify.js';
import { randomBytes } from 'node:crypto';

export const TICK_MS = 60_000;
export const START_DELAY_MS = 2 * 60_000;
export const RETRY_AFTER_FAILURE_MS = 15 * 60_000;

export interface Scheduler {
  /** One check, as if the clock said `now`. Resolves when any backup it started is finished. */
  tick(now?: Date): Promise<void>;
  /** Starts the timer (the first check after START_DELAY_MS). */
  start(): void;
  stop(): void;
  /** Runs a backup now, for the Admin button. Rejects with a BackupError (busy, passphrase, ...). */
  runNow(): Promise<BackupRunRecord>;
  /** Tests the newest archive now. */
  testLatest(): Promise<void>;
  status(now?: Date): Promise<BackupStatus>;
  readonly running: boolean;
}

const id = () => randomBytes(6).toString('hex');

const sanitized = (error: unknown): { message: string; kind: string } =>
  error instanceof BackupError
    ? { message: error.message, kind: error.kind }
    : { message: 'The backup failed (see the api log).', kind: 'tool' };

/** Removes work and temp files an earlier crash left (older than an hour). */
export function cleanStaleTemp(dir: string, now = Date.now()): string[] {
  const removed: string[] = [];
  try {
    for (const name of readdirSync(dir)) {
      if (!/^\.(work-|tmp-|state-)/.test(name)) continue;
      const path = join(dir, name);
      if (now - statSync(path).mtimeMs > 3_600_000) {
        rmSync(path, { recursive: true, force: true });
        removed.push(name);
      }
    }
  } catch {
    /* the folder may not exist yet */
  }
  return removed;
}

export function createScheduler(
  ctx: BackupContext,
  options: { tickMs?: number; startDelayMs?: number } = {},
): Scheduler {
  const { config, log } = ctx;
  const dir = config.backup.dir;
  const clock = (): Date => ctx.now?.() ?? new Date();
  let timer: NodeJS.Timeout | undefined;
  let first: NodeJS.Timeout | undefined;
  let busy = false;

  const settings = async (): Promise<BackupSettings> => {
    const db = createDb<AnySchema>(config.db, config.db.ownerUser, config.db.ownerPassword, 1);
    try {
      return await readBackupSettings(db);
    } finally {
      await db.destroy();
    }
  };

  const withFiles = (s: BackupSettings): BackupContext => ({
    ...ctx,
    files: s.includeFiles ? (ctx.files ?? listMediaFiles) : () => Promise.resolve([]),
  });

  /** The backup itself, then the test and the retention. Never throws for a failed backup: it is recorded. */
  async function perform(kind: 'scheduled' | 'manual', s: BackupSettings): Promise<BackupRunRecord> {
    const startedAt = clock().toISOString();
    try {
      const made = await createBackup(withFiles(s), { kind });
      const record: BackupRunRecord = {
        id: id(),
        kind,
        startedAt,
        finishedAt: clock().toISOString(),
        ok: true,
        file: made.name,
        bytes: made.bytes,
      };
      await recordRun(dir, record);
      try {
        if (s.testAfterBackup) {
          const result = await verifyBackup(ctx, made.path);
          await recordTest(dir, {
            at: clock().toISOString(),
            file: made.name,
            ok: result.ok,
            mode: result.mode,
            tables: result.tables,
            rows: result.rows,
            ...(result.ok ? {} : { failed: result.checks.filter((c) => !c.ok).map((c) => c.name) }),
            ...(result.note ? { note: result.note } : {}),
          });
          if (!result.ok) log('error', 'the new backup failed its test', { file: made.name });
        }
      } catch (error) {
        log('warn', 'the new backup could not be tested', { file: made.name, reason: sanitized(error).message });
      }
      // Retention runs only after a good new backup, and never touches the newest one or the last tested-good one.
      const state = readState(dir);
      const protect = [made.name, ...(state.lastTest?.ok ? [state.lastTest.file] : [])];
      const result = applyRetention(dir, s, protect);
      if (result.remove.length > 0)
        log('info', 'old backups removed', { removed: result.remove, kept: result.keep.length });
      return record;
    } catch (error) {
      if (error instanceof BackupError && error.kind === 'busy') throw error;
      const { message, kind: errorKind } = sanitized(error);
      const record: BackupRunRecord = {
        id: id(),
        kind,
        startedAt,
        finishedAt: clock().toISOString(),
        ok: false,
        error: message,
        errorKind,
      };
      await recordRun(dir, record).catch(() => undefined);
      log('error', 'backup failed', { kind, errorKind, reason: message });
      return record;
    }
  }

  async function tick(now = new Date()): Promise<void> {
    if (busy) return;
    if (!config.backup.enabled || passphraseState(config.backup.passphrase) !== 'ok') return;
    let s: BackupSettings;
    try {
      s = await settings();
    } catch (error) {
      log('warn', 'could not read the backup settings', { reason: sanitized(error).message });
      return;
    }
    const due = latestDue(now, s);
    if (!due) return;
    const state = readState(dir);
    const lastOk = lastSuccessfulBackupAt(state);
    if (lastOk && new Date(lastOk) >= due) return;
    // After a failure, wait before trying again.
    const lastRun = state.runs[0];
    if (lastRun && !lastRun.ok && now.getTime() - new Date(lastRun.finishedAt).getTime() < RETRY_AFTER_FAILURE_MS)
      return;
    try {
      await perform('scheduled', s);
    } catch (error) {
      // Busy: another api container or the command line is making one. Not a failure.
      log('info', 'scheduled backup skipped', { reason: sanitized(error).message });
    }
  }

  return {
    tick,
    start() {
      first = setTimeout(() => {
        void tick();
        timer = setInterval(() => void tick(), options.tickMs ?? TICK_MS);
        timer.unref();
      }, options.startDelayMs ?? START_DELAY_MS);
      first.unref();
    },
    stop() {
      if (first) clearTimeout(first);
      if (timer) clearInterval(timer);
    },
    async runNow() {
      if (busy) throw new BackupError('busy', 'A backup is already running.');
      busy = true;
      try {
        return await perform('manual', await settings());
      } finally {
        busy = false;
      }
    },
    async testLatest() {
      if (busy) throw new BackupError('busy', 'A backup or test is already running.');
      const newest = listBackups(dir).find((i) => i.kind === 'manual');
      if (!newest) throw new BackupError('archive', 'There is no backup to test yet.');
      busy = true;
      try {
        const result = await verifyBackup(ctx, join(dir, newest.name));
        await recordTest(dir, {
          at: clock().toISOString(),
          file: newest.name,
          ok: result.ok,
          mode: result.mode,
          tables: result.tables,
          rows: result.rows,
          ...(result.ok ? {} : { failed: result.checks.filter((c) => !c.ok).map((c) => c.name) }),
          ...(result.note ? { note: result.note } : {}),
        });
      } finally {
        busy = false;
      }
    },
    async status(now = new Date()): Promise<BackupStatus> {
      const s = await settings().catch(() => ({ ...DEFAULTS }));
      const state = readState(dir);
      const pass = passphraseState(config.backup.passphrase);
      let writable = true;
      try {
        ensureBackupDir(dir);
      } catch {
        writable = false;
      }
      const lastSuccessAt = lastSuccessfulBackupAt(state);
      const lastRun = state.runs[0] ?? null;
      const problems: BackupProblem[] = [];
      if (pass === 'missing') problems.push('passphrase_missing');
      if (pass === 'too_short') problems.push('passphrase_too_short');
      if (pass === 'placeholder') problems.push('passphrase_placeholder');
      if (!writable) problems.push('folder_not_writable');
      if (!config.backup.enabled) problems.push('switched_off');
      else if (s.schedule === 'off') problems.push('schedule_off');
      if (lastRun && !lastRun.ok) problems.push('last_backup_failed');
      if (state.lastTest && !state.lastTest.ok) problems.push('last_test_failed');
      if (!lastSuccessAt) problems.push('never_backed_up');
      else if (config.backup.enabled && s.schedule !== 'off') {
        const interval = s.schedule === 'weekly' ? 9 * 86_400_000 : 36 * 3_600_000;
        if (now.getTime() - new Date(lastSuccessAt).getTime() > interval) problems.push('overdue');
      }
      const failures: BackupProblem[] = [
        'passphrase_missing',
        'passphrase_too_short',
        'passphrase_placeholder',
        'folder_not_writable',
        'last_backup_failed',
        'last_test_failed',
        'overdue',
      ];
      const next = config.backup.enabled && pass === 'ok' ? nextDue(now, s) : null;
      return {
        enabled: config.backup.enabled,
        passphrase: pass,
        folderWritable: writable,
        running: busy,
        settings: s,
        nextRunAt: next ? next.toISOString() : null,
        lastSuccessAt,
        lastRun,
        lastTest: state.lastTest,
        healthy: !problems.some((p) => failures.includes(p)),
        problems,
      };
    },
    get running() {
      return busy;
    },
  };
}

/** Start-up housekeeping: remove stale temp files, drop leftover test databases. Never throws. */
export async function backupHousekeeping(ctx: BackupContext): Promise<void> {
  try {
    const removed = cleanStaleTemp(ctx.config.backup.dir);
    if (removed.length > 0) ctx.log('warn', 'removed leftover temporary backup files', { removed });
    await sweepVerifyDatabases(ctx);
  } catch (error) {
    ctx.log('warn', 'backup housekeeping failed', { reason: sanitized(error).message });
  }
}

import { DEFAULT_BACKUP_SETTINGS as DEFAULTS } from '@kinship/shared';
