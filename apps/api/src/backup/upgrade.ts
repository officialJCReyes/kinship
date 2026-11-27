// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Starting the database up: the safety copy before a migration, then the migration, then the record of what happened.
// When the api starts and finds migrations it has not applied to a database that already has data, it first writes a copy of
// the database to the backups folder (encrypted with the backup passphrase when there is one) and only then migrates. It is a
// net under the SuperAdmin's own backup, not a replacement: same server, no media files. A real failure to make it stops the
// upgrade; an owner role that cannot read every row skips it, loudly and on the record.
import { randomBytes } from 'node:crypto';
import { closeSync, createWriteStream, fsyncSync, lstatSync, openSync, renameSync, rmSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { sql } from 'kysely';
import type { Config } from '../config.js';
import { createDb } from '../db.js';
import type { AnySchema, UntypedDb } from '../db.js';
import { readMigrationFiles } from '../migrations/files.js';
import { ensureAppRole } from '../migrations/roles.js';
import { runMigrations } from '../migrations/runner.js';
import {
  FOLDER_FIX_LONG,
  createBackup,
  ensureBackupDir,
  freeBytes,
  listBackups,
  openArchive,
  preUpgradeName,
} from './archive.js';
import type { Log } from './archive.js';
import { passphraseProblem } from './crypto.js';
import { BackupError } from './errors.js';
import { DUMP_EXCLUDE_ARGS, ownerReadsEverything } from './inspect.js';
import { KEEP_SAFETY_COPIES } from './retention.js';
import { readSafetyCopySetting } from './settings.js';
import { clean, ownerLogin, pgEnv, run, ToolError } from './tools.js';
import type { Tools } from './tools.js';

/** Serializes "look at what is pending, copy, migrate" across api containers that start together. */
export const MIGRATE_LOCK_KEY = 7_302_041_122;

/** Why there is no safety copy, as recorded in upgrade_log.safety_note. */
export type SafetyNote = 'off' | 'fresh_install' | 'skipped_no_bypassrls' | 'break_glass';

export class SafetyCopyError extends Error {
  override name = 'SafetyCopyError';
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

export interface UpgradeContext {
  config: Config;
  tools: Tools;
  log: Log;
  appVersion: string;
  /** Only tests lower the KDF cost. */
  kdf?: { N: number; r: number; p: number };
  now?: () => Date;
  freeBytes?: (dir: string) => number;
}

export interface UpgradeResult {
  applied: string[];
  safetyCopy: string | null;
  safetyNote: SafetyNote | null;
  fromSchema: number | null;
  toSchema: number;
}

/** The break-glass paragraph that ends every refusal. */
const BREAK_GLASS =
  'If you cannot fix it and accept upgrading without this copy (take your own backup first!), start once with ' +
  'KINSHIP_SAFETY_COPY=skip in the api environment; it is recorded in the upgrade log.';

/** Keeps the newest three safety copies of one kind; deletes only our own pre-* files. */
export function trimSafetyCopies(dir: string, kind: 'pre-upgrade' | 'pre-restore'): string[] {
  const items = listBackups(dir)
    .filter((i) => i.kind === kind)
    .sort((a, b) => b.modified.getTime() - a.modified.getTime() || b.name.localeCompare(a.name));
  const removed: string[] = [];
  for (const item of items.slice(KEEP_SAFETY_COPIES)) {
    const path = join(dir, item.name);
    try {
      if (lstatSync(path).isFile()) {
        rmSync(path);
        removed.push(item.name);
      }
    } catch {
      /* gone already */
    }
  }
  return removed;
}

/** A plain, gzip-compressed SQL dump, mode 0600, checked by reading it back. Used when there is no usable passphrase. */
async function writePlainCopy(ctx: UpgradeContext, name: string): Promise<void> {
  const { config, tools } = ctx;
  const dir = config.backup.dir;
  const temp = join(dir, `.tmp-${randomBytes(6).toString('hex')}.sql.gz`);
  try {
    const gzip = createGzip();
    const written = pipeline(gzip, createWriteStream(temp, { flags: 'wx', mode: 0o600 }));
    const result = await run(tools.pgDump, ['--format=plain', '--no-owner', ...DUMP_EXCLUDE_ARGS], {
      env: pgEnv(ownerLogin(config.db)),
      stdout: gzip,
      secrets: [config.db.ownerPassword],
    });
    await written;
    if (result.code !== 0) throw new ToolError('pg_dump', result.code, result.stderr);
    // Read it back: it must decompress, and a finished pg_dump ends with this line.
    let tail = '';
    await pipeline(
      createReadStream(temp),
      createGunzip(),
      new Writable({
        write(chunk: Buffer, _e, cb) {
          tail = (tail + chunk.toString('utf8')).slice(-2048);
          cb();
        },
      }),
    );
    if (!tail.includes('PostgreSQL database dump complete')) {
      throw new SafetyCopyError('the safety copy was written but does not end like a finished dump');
    }
    const fd = openSync(temp, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, join(dir, name));
  } finally {
    rmSync(temp, { force: true });
  }
}

/**
 * Makes the safety copy of the database as it is NOW (before the pending migrations). Returns the file name.
 * Throws SafetyCopyError with the cause, the fix and the break-glass.
 */
async function makeSafetyCopy(ctx: UpgradeContext, conn: UntypedDb, from: number, to: number): Promise<string> {
  const { config, log } = ctx;
  const dir = config.backup.dir;
  const fail = (what: string, fix: string, cause?: unknown): never => {
    throw new SafetyCopyError(
      `The safety copy before the database upgrade could not be made, so the upgrade did not start and your data is untouched. ` +
        `Cause: ${what} Fix: ${fix} ${BREAK_GLASS}`,
      cause === undefined ? undefined : { cause },
    );
  };
  try {
    ensureBackupDir(dir);
  } catch (error) {
    return fail(
      error instanceof BackupError
        ? (error.message.split(' Create it')[0] ?? 'The backups folder cannot be written to.')
        : 'The backups folder cannot be written to.',
      `\n${FOLDER_FIX_LONG}\n`,
      error,
    );
  }
  const size = Number(
    (await sql<{ n: string }>`select pg_database_size(current_database())::text as n`.execute(conn)).rows[0]?.n,
  );
  const free = (ctx.freeBytes ?? freeBytes)(dir);
  if (free < size) {
    return fail(
      `there is not enough free space in ${dir} (the database is ${size} bytes, ${free} are free).`,
      'free some space on that disk (move older backups off the server), or put the folder on a bigger disk.',
    );
  }

  const encrypted = passphraseProblem(config.backup.passphrase) === null;
  const name = preUpgradeName(from, to, encrypted);
  try {
    if (encrypted) {
      const made = await createBackup(
        {
          config,
          tools: ctx.tools,
          log,
          appVersion: ctx.appVersion,
          ...(ctx.kdf ? { kdf: ctx.kdf } : {}),
          ...(ctx.now ? { now: ctx.now } : {}),
          ...(ctx.freeBytes ? { freeBytes: ctx.freeBytes } : {}),
        },
        { kind: 'pre-upgrade', name },
      );
      // Prove it opens before relying on it.
      const archive = await openArchive(made.path, config.backup.passphrase as string, ctx.tools, dir);
      archive.cleanup();
    } else {
      log(
        'warn',
        'the safety copy is NOT encrypted (no usable BACKUP_PASSPHRASE); it is mode 0600 on the backups volume. Set a passphrase in .env.',
        { file: name },
      );
      await writePlainCopy(ctx, name);
    }
  } catch (error) {
    const reason =
      error instanceof Error
        ? clean(error.message, [config.db.ownerPassword, config.backup.passphrase ?? ''])
        : 'unknown error';
    rmSync(join(dir, name), { force: true });
    return fail(
      reason,
      error instanceof BackupError && error.kind === 'owner_cannot_read_all'
        ? 'see the message above.'
        : 'read the api log for the details, fix the cause, and start KinShip again.',
      error,
    );
  }
  trimSafetyCopies(dir, 'pre-upgrade');
  return name;
}

/**
 * The whole start-up database step, as the owner: make sure the app role exists, then (under one lock shared by every api
 * container) look at what is pending, make the safety copy when it applies, migrate, and record it in upgrade_log.
 */
export async function migrateWithSafetyCopy(ctx: UpgradeContext): Promise<UpgradeResult> {
  const { config, log } = ctx;
  // A migration's RAISE NOTICE (0024 names the people it left alone) goes to the log, not nowhere.
  const db = createDb<AnySchema>(config.db, config.db.ownerUser, config.db.ownerPassword, 4, (message) =>
    log('warn', `database notice: ${message}`, {}),
  );
  try {
    return await db.connection().execute(async (conn) => {
      await sql`select pg_advisory_lock(${MIGRATE_LOCK_KEY})`.execute(conn);
      try {
        // Under the lock: two containers starting together must not both rewrite the role.
        await ensureAppRole(conn, config.db.appUser, config.db.appPassword);
        const files = await readMigrationFiles(config.migrationsDir);
        const top = Math.max(0, ...files.map((f) => f.number));
        const hasTable =
          (await sql<{ p: boolean }>`select to_regclass('public.kysely_migration') is not null as p`.execute(conn))
            .rows[0]?.p === true;
        const applied = hasTable
          ? (await sql<{ name: string }>`select name from public.kysely_migration`.execute(conn)).rows.map(
              (r) => r.name,
            )
          : [];
        const pending = files.filter((f) => !applied.includes(f.name));
        const fresh = applied.length === 0;

        let fromSchema: number | null = null;
        let fromVersion: string | null = null;
        if (!fresh) {
          fromSchema = Number(
            (await sql<{ n: number }>`select schema_number as n from public.schema_info`.execute(conn)).rows[0]?.n ?? 0,
          );
          const hasVersion =
            (
              await sql<{
                p: boolean;
              }>`select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'schema_info' and column_name = 'app_version') as p`.execute(
                conn,
              )
            ).rows[0]?.p === true;
          if (hasVersion)
            fromVersion =
              (await sql<{ v: string | null }>`select app_version as v from public.schema_info`.execute(conn)).rows[0]
                ?.v ?? null;
        }

        let safetyCopy: string | null = null;
        let safetyNote: SafetyNote | null = null;
        if (pending.length > 0) {
          if (fresh) {
            safetyNote = 'fresh_install';
          } else if (config.backup.skipSafetyCopy) {
            safetyNote = 'break_glass';
            log(
              'warn',
              'KINSHIP_SAFETY_COPY=skip is set: upgrading WITHOUT a safety copy. Remove it from the environment after this start.',
              { pending: pending.length },
            );
          } else if (!(await readSafetyCopySetting(conn))) {
            safetyNote = 'off';
            log('warn', 'the safety copy before a database change is switched off in Admin; upgrading without one', {
              pending: pending.length,
            });
          } else if (!(await ownerReadsEverything(conn))) {
            safetyNote = 'skipped_no_bypassrls';
            log(
              'error',
              `NO SAFETY COPY: the database owner role "${config.db.ownerUser}" cannot read every row (it is not a superuser and lacks BYPASSRLS), so a dump would miss data. The upgrade goes on without one. Take your own backup first, and ask a superuser to run: ALTER ROLE "${config.db.ownerUser}" BYPASSRLS;`,
              { pending: pending.length },
            );
          } else {
            log('info', `making a safety copy before ${pending.length} database change(s)`, {
              from: fromSchema,
              to: top,
            });
            safetyCopy = await makeSafetyCopy(ctx, conn, fromSchema ?? 0, top);
            log('info', `safety copy written: ${safetyCopy}`, {});
          }
        }

        const migrated = await runMigrations(db, {
          dir: config.migrationsDir,
          appRole: config.db.appUser,
          log: (m) => log('info', m),
        });
        const schema = Number(
          (await sql<{ n: number }>`select schema_number as n from public.schema_info`.execute(conn)).rows[0]?.n ?? 0,
        );
        await sql`update public.schema_info set app_version = ${ctx.appVersion}`.execute(conn);
        if (migrated.applied.length > 0) {
          await sql`
            insert into public.upgrade_log (event, from_schema, to_schema, from_version, to_version, safety_copy, safety_note)
            values ('migrate', ${fromSchema}, ${schema}, ${fromVersion}, ${ctx.appVersion}, ${safetyCopy}, ${safetyNote})`.execute(
            conn,
          );
        }
        return { applied: migrated.applied, safetyCopy, safetyNote, fromSchema, toSchema: schema };
      } finally {
        await sql`select pg_advisory_unlock(${MIGRATE_LOCK_KEY})`.execute(conn);
      }
    });
  } finally {
    await db.destroy();
  }
}
