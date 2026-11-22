// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Restoring a backup from the app (ADR 0031). The order, and why:
//
//   1. the record "started" goes to state.json (so a restore cut short is found at the next start);
//   2. the gate goes up (every request but health, version and maintenance answers 503) and the jobs and the scheduler pause;
//   3. wait for the requests and jobs that are already running (at most `drainMs`);
//   4. check the backup again under the gate and look at the backup lock;
//   5. close the app role's database pool (the restore refuses to start while the app role has connections);
//   6. restoreBackup(): safety copy, one transaction that replaces the schemas, migrations, the upgrade_log row;
//   7. write the result to state.json and EXIT, so Docker starts a fresh api (new pool, new jobs, no stale caches).
//
// Failing in steps 1 to 4 leaves nothing changed and nothing closed: the gate comes down and the site goes on. Failing after step 5
// the pool is gone and the gate cannot simply lift, so the process exits with code 1 and Docker restarts it; the result (what the
// data is like, where the safety copy is) is on the maintenance page and in state.json afterwards.
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { sql } from 'kysely';
import type { RestoreRecord, RestoreResultKind } from '@kinship/shared';
import { createOwnerDb } from '../db.js';
import type { Maintenance } from '../maintenance.js';
import { BACKUP_LOCK_KEY, listBackups } from './archive.js';
import type { BackupContext } from './archive.js';
import { passphraseState } from './crypto.js';
import { MigrationError } from '../migrations/runner.js';
import { BackupError } from './errors.js';
import { BackupFormatError } from './format.js';
import { checkRestore, restoreBackup } from './restore.js';
import { ToolError } from './tools.js';
import type { RestoreFacts, RestorePhase } from './restore.js';
import type { Scheduler } from './scheduler.js';
import { readState, recordRestoreEnd, recordRestoreStart, updateState } from './state.js';

export const DRAIN_MS = 30_000;

/** Why a restore did not go ahead, as a short code (never a message: those can hold paths). */
export class RestoreRefused extends Error {
  override name = 'RestoreRefused';
  constructor(
    readonly code: 'busy' | 'not_found' | 'unavailable' | 'drain_timeout',
    message: string,
  ) {
    super(message);
  }
}

export interface RestoreServiceDeps {
  /** The backup context, with the api's own configuration (the passphrase is read from it, never from a request). */
  ctx: BackupContext;
  maintenance: Maintenance;
  scheduler: Scheduler;
  /** Stops the periodic jobs and the session cleanup from starting anything new, and waits for what is running. */
  pause(): Promise<boolean>;
  /** Undoes `pause()`. Only used when the restore gave up before the pool was closed. */
  resume(): void;
  /** Ends the app role's pool. After this the api cannot serve a request, so the process must exit. */
  closePool(): Promise<void>;
  /** Closes idle keep-alive connections so the drain does not wait for them. */
  closeIdle(): void;
  /** Ends the process (the api: process.exit). Docker restarts it. */
  exit(code: number): void;
  drainMs?: number;
  newId?: () => string;
  now?: () => Date;
}

export interface RestoreService {
  /** Opens and verifies a listed archive and says what a restore of it would do. Changes nothing. */
  check(name: string): Promise<RestoreFacts>;
  /** Begins a restore in the background. Resolves when it has been recorded as started; rejects with RestoreRefused or a BackupError. */
  start(request: { name: string; userId: string }): Promise<{ id: string }>;
  readonly running: boolean;
}

const archiveOf = (dir: string, name: string) => {
  // Only a name from our own listing of the folder is ever used: user input is never joined into a path.
  const item = listBackups(dir).find((i) => i.name === name && i.encrypted);
  if (!item) throw new RestoreRefused('not_found', 'There is no such backup.');
  return join(dir, item.name);
};

/** A code for a failure that is safe to keep and show. */
export function errorKindOf(error: unknown): string {
  if (error instanceof BackupFormatError) return error.code;
  if (error instanceof BackupError) return error.kind;
  if (error instanceof RestoreRefused) return error.code;
  if (error instanceof ToolError) return 'tool';
  if (error instanceof MigrationError) return 'migration';
  return 'unknown';
}

/** The message of a failure, only when it is one of ours that never holds a path (a refusal, or the free space). */
export function safeDetail(error: unknown): string | undefined {
  return error instanceof BackupError && (error.kind === 'refused' || error.kind === 'disk_space')
    ? error.message
    : undefined;
}

export function createRestoreService(deps: RestoreServiceDeps): RestoreService {
  const { ctx, maintenance, scheduler } = deps;
  const dir = ctx.config.backup.dir;
  const log = ctx.log;
  const drainMs = deps.drainMs ?? DRAIN_MS;
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => randomBytes(6).toString('hex'));
  let running = false;

  /** Is another process (the command line, a second api) holding the backup lock right now? */
  async function lockIsFree(): Promise<boolean> {
    const db = createOwnerDb(ctx.config.db);
    try {
      return await db.connection().execute(async (conn) => {
        const got = await sql<{ ok: boolean }>`select pg_try_advisory_lock(${BACKUP_LOCK_KEY}) as ok`.execute(conn);
        if (!got.rows[0]?.ok) return false;
        await sql`select pg_advisory_unlock(${BACKUP_LOCK_KEY})`.execute(conn);
        return true;
      });
    } finally {
      await db.destroy();
    }
  }

  async function run(id: string, name: string, userId: string, startedAt: string): Promise<void> {
    const started: RestoreRecord = { id, startedAt, kind: 'started', backup: name, byUserId: userId };
    let poolClosed = false;
    let lastPhase: RestorePhase | null = null;
    const finish = async (kind: RestoreResultKind, extra: Partial<RestoreRecord> = {}): Promise<void> => {
      await recordRestoreEnd(
        dir,
        id,
        { kind, ok: kind === 'restored', finishedAt: now().toISOString(), ...extra },
        started,
      ).catch(() => log('error', 'the result of the restore could not be written to state.json', { restoreId: id }));
    };
    try {
      maintenance.set('pausing');
      log('info', 'restore: the site is paused', { restoreId: id });
      const jobsIdle = await deps.pause();
      scheduler.pause();
      const drained = await maintenance.drain(drainMs);
      if (!drained || !jobsIdle) throw new RestoreRefused('drain_timeout', 'Requests were still running.');
      // Once more, now that nobody is writing: everything that can be refused is refused here, before anything is closed.
      const path = archiveOf(dir, name);
      await checkRestore(ctx, path);
      if (!(await lockIsFree())) throw new RestoreRefused('busy', 'A backup or restore is running elsewhere.');
      deps.closeIdle();
      await deps.closePool();
      poolClosed = true;

      const report = await restoreBackup(ctx, path, {
        confirm: () => Promise.resolve(true),
        progress: () => undefined,
        phase: (phase) => {
          lastPhase = phase;
          maintenance.set(phase);
          log('info', 'restore: phase', { restoreId: id, phase });
        },
      });
      maintenance.set('finishing');
      await finish('restored', report.safetyCopy ? { safetyCopy: report.safetyCopy } : {});
      log('info', 'restore: finished, the api restarts', {
        restoreId: id,
        migrations: report.migrationsApplied.length,
      });
      deps.exit(0);
    } catch (error) {
      const errorKind = errorKindOf(error);
      const detail = safeDetail(error);
      log('error', 'restore failed', {
        restoreId: id,
        errorKind,
        phase: lastPhase ?? maintenance.phase(),
        ...(detail ? { detail } : {}),
      });
      if (!poolClosed) {
        // Nothing was changed and nothing was closed: the site goes on, and no restart is needed.
        scheduler.resume();
        deps.resume();
        maintenance.set('idle');
        running = false;
        await finish('unchanged', { errorKind });
        return;
      }
      // The pool is gone. Docker restarts the api; the result is read from state.json then. Past the replay (migrating) the backup
      // is in place but a later step failed; before it the data is exactly as it was.
      maintenance.set('finishing');
      await finish((lastPhase as RestorePhase | null) === 'migrating' ? 'restored_not_migrated' : 'unchanged', {
        errorKind,
      });
      deps.exit(1);
    }
  }

  return {
    get running() {
      return running;
    },
    async check(name) {
      if (passphraseState(ctx.config.backup.passphrase) !== 'ok') {
        throw new RestoreRefused('unavailable', 'Restoring needs a usable backup passphrase.');
      }
      if (running || maintenance.active()) throw new RestoreRefused('busy', 'A restore is already running.');
      return checkRestore(ctx, archiveOf(dir, name));
    },
    async start({ name, userId }) {
      if (passphraseState(ctx.config.backup.passphrase) !== 'ok') {
        throw new RestoreRefused('unavailable', 'Restoring needs a usable backup passphrase.');
      }
      if (running || maintenance.active()) throw new RestoreRefused('busy', 'A restore is already running.');
      if (scheduler.running) throw new BackupError('busy', 'A backup or test is running.');
      archiveOf(dir, name);
      running = true;
      const id = newId();
      const startedAt = now().toISOString();
      try {
        await recordRestoreStart(dir, { id, startedAt, kind: 'started', backup: name, byUserId: userId });
      } catch (error) {
        running = false;
        throw error;
      }
      log('info', 'restore requested', { restoreId: id, userId, backup: name });
      void run(id, name, userId, startedAt);
      return { id };
    },
  };
}

/**
 * At start-up: a restore that was written as started and never ended was cut short (the api was killed). The data is unchanged
 * (the replacement is one transaction), so say that. Never throws.
 */
export async function reconcileRestores(dir: string, log: BackupContext['log'], now = new Date()): Promise<void> {
  try {
    if (!readState(dir).restores.some((r) => r.kind === 'started')) return;
    await updateState(dir, (state) => {
      state.restores = state.restores.map((r) =>
        r.kind === 'started'
          ? { ...r, kind: 'did_not_finish', ok: false, finishedAt: now.toISOString(), errorKind: 'interrupted' }
          : r,
      );
    });
    log('warn', 'a restore did not finish; the data is unchanged');
  } catch {
    /* a log, not a source of truth */
  }
}

/** How the newest finished restore ended, for the public maintenance endpoint (no ids, no paths). */
export function lastRestoreOf(dir: string) {
  const record = readState(dir).restores.find((r) => r.kind !== 'started');
  if (!record) return undefined;
  return {
    ok: record.ok === true,
    kind: record.kind,
    finishedAt: record.finishedAt ?? record.startedAt,
    ...(record.safetyCopy ? { safetyCopy: record.safetyCopy } : {}),
  };
}
