// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Restoring a backup (CLI only in 0.2). Everything that can be checked is checked first with nothing touched; then one
// transaction drops and recreates the schemas, replays the dump and VERIFIES the result (row counts, the protections
// fingerprint) before it commits. If anything fails, or this process dies, the transaction never commits and the database is
// exactly as it was. See docs/decisions/0014 and INSTALL.md.
import { spawn } from 'node:child_process';
import type { ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { sql } from 'kysely';
import { createDb } from '../db.js';
import type { AnySchema, UntypedDb } from '../db.js';
import { ensureAppRole } from '../migrations/roles.js';
import { deriveFileKeys } from '../files/key.js';
import { markerSql } from '../files/restore-marker.js';
import { FILES_FIX_LONG, filesFolderWritable } from '../files/state.js';
import { readMigrationFiles } from '../migrations/files.js';
import { runMigrations } from '../migrations/runner.js';
import { compareVersionText } from '@kinship/shared';
import {
  BACKUP_LOCK_KEY,
  createBackup,
  freeBytes,
  majorOf,
  openArchive,
  preRestoreName,
  readFilesIndex,
} from './archive.js';
import {
  checkRowsCovered,
  discardStaging,
  ensureFilesFolder,
  finishSwap,
  newRestoreId,
  stageFiles,
  writeIntent,
  writeSweepHold,
} from './restore-files.js';
import type { FilesIndex } from './files.js';
import { statSync } from 'node:fs';
import type { BackupContext, OpenArchive } from './archive.js';
import { BackupError } from './errors.js';
import { fingerprintQuery } from './inspect.js';
import type { Manifest } from './manifest.js';
import { clean, ownerLogin, pgEnv, ToolError } from './tools.js';

/** psql's stderr without the NOTICE and DETAIL lines a DROP ... CASCADE writes, so the real error is what is left. */
const withoutNotices = (text: string): string =>
  text
    .split('\n')
    .filter((line) => !/NOTICE:|^DETAIL:\s+drop cascades|^\s+drop cascades|^drop cascades/.test(line))
    .join('\n');

const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/** Dollar-quoted, so nothing inside can end the quote (the tag is not a valid JSON or identifier character sequence). */
const dollar = (text: string, tag = 'kinship_restore'): string => `$${tag}$${text}$${tag}$`;

export interface ApplyOptions {
  /** Delete all sessions and revoke open account links, inside the same transaction (a real restore does; a test does not need to). */
  resetState: boolean;
  /** Set the restore marker (a comment on the public schema) to this id inside the transaction (ADR 0035). */
  restoreId?: string;
  /**
   * Called, BEFORE the commit, with every file name the restored photo rows use (full and avatar). It throws to roll the whole
   * restore back. The transaction stays open while it runs: this is where the photos in the backup are matched to the rows.
   */
  checkFiles?: (storageIds: string[]) => void | Promise<void>;
}

export const IDS_BEGIN = 'KINSHIP-IDS-BEGIN';
export const IDS_END = 'KINSHIP-IDS-END';

/** The SQL that goes before the dump: one transaction, the schemas dropped and recreated. */
export function prefixSql(): string {
  return [
    'BEGIN;',
    "SET LOCAL lock_timeout = '30s';",
    'DROP SCHEMA IF EXISTS kinship_auth CASCADE;',
    'DROP SCHEMA IF EXISTS public CASCADE;',
    'CREATE SCHEMA public;',
    '',
  ].join('\n');
}

/**
 * The SQL that goes after the dump, inside the same transaction. pg_restore leaves an empty search_path, so every name here is
 * schema-qualified. The last statement is the only COMMIT: a script that stops early never commits.
 */
export function suffixSql(manifest: Manifest, appRole: string, options: ApplyOptions): string {
  return `${suffixBefore(manifest, appRole, options)}COMMIT;\n`;
}

/** Everything of the suffix up to, but not including, the COMMIT: the checks, the marker, and (if asked) the list of file names. */
export function suffixBefore(manifest: Manifest, appRole: string, options: ApplyOptions): string {
  const names = Object.keys(manifest.tables);
  const counts = names
    .map(
      (name) =>
        `  IF (SELECT count(*) FROM public.${quoteIdent(name)}) <> ${manifest.tables[name]?.rows ?? 0} THEN ` +
        `RAISE EXCEPTION 'table ${name.replace(/'/g, "''")} does not have the number of rows the backup recorded'; END IF;`,
    )
    .join('\n');
  const list = names.map((name) => `'${name.replace(/'/g, "''")}'`).join(', ') || "''";
  const out = [
    // pg_restore leaves search_path empty, which makes type names print schema-qualified in the fingerprint. The backup's
    // fingerprint was taken with the normal path (public), so the check uses the same.
    'SET LOCAL search_path = public;',
    `DO ${dollar(`BEGIN\n${counts}\n  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> ALL (ARRAY[${list}])) THEN RAISE EXCEPTION 'the restored database has tables the backup does not list'; END IF;\nEND`)};`,
    `DO ${dollar(`DECLARE
  actual jsonb := (SELECT fingerprint FROM (${fingerprintQuery(appRole)}) q);
  expected jsonb := ${dollar(JSON.stringify(manifest.fingerprint), 'kinship_json')}::jsonb;
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'the restored database has different protections (row-level security, grants, functions) than the backup (differs: %)',
      (SELECT string_agg(COALESCE(a.key, e.key) || ' -> ' || COALESCE((SELECT string_agg(x, ' | ') FROM (SELECT jsonb_array_elements_text(a.value) EXCEPT SELECT jsonb_array_elements_text(e.value)) d(x)), '') || ' / ' || COALESCE((SELECT string_agg(x, ' | ') FROM (SELECT jsonb_array_elements_text(e.value) EXCEPT SELECT jsonb_array_elements_text(a.value)) d(x)), ''), '; ')
         FROM jsonb_each(actual) a FULL JOIN jsonb_each(expected) e ON a.key = e.key WHERE a.value IS DISTINCT FROM e.value AND jsonb_typeof(COALESCE(a.value, e.value)) = 'array');
  END IF;
END`)};`,
  ];
  if (options.resetState) {
    out.push(
      `DO ${dollar(`BEGIN
  IF pg_catalog.to_regclass('public.sessions') IS NOT NULL THEN DELETE FROM public.sessions; END IF;
  IF pg_catalog.to_regclass('public.mail_outbox') IS NOT NULL THEN DELETE FROM public.mail_outbox; END IF;
  IF pg_catalog.to_regclass('public.account_links') IS NOT NULL THEN
    UPDATE public.account_links SET revoked_at = pg_catalog.now() WHERE accepted_at IS NULL AND revoked_at IS NULL;
  END IF;
END`)};`,
    );
  }
  if (options.restoreId !== undefined) out.push(markerSql(options.restoreId));
  out.push(
    `DO ${dollar(`BEGIN EXECUTE pg_catalog.format('GRANT CONNECT ON DATABASE %I TO %I', pg_catalog.current_database(), ${`'${appRole.replace(/'/g, "''")}'`}); END`)};`,
  );
  if (options.checkFiles) {
    // The names are printed for the caller to compare with the staged files; the caller then sends COMMIT or ROLLBACK.
    out.push(
      '\\pset tuples_only on',
      '\\pset format unaligned',
      `\\echo ${IDS_BEGIN}`,
      'SELECT storage_id FROM public.media_files UNION ALL SELECT avatar_storage_id FROM public.media_files;',
      `\\echo ${IDS_END}`,
    );
  }
  out.push('');
  return out.join('\n');
}

const FAIL_SQL = `DO ${dollar("BEGIN RAISE EXCEPTION 'the dump inside the backup could not be read; nothing was changed'; END")};\n`;

/**
 * Which step of tar -> pg_restore failed, or null when the dump was read in full. pg_restore's exit code always counts. tar's counts
 * only when tar ended before pg_restore did: once pg_restore has succeeded it had the whole dump (whose checksum was already
 * checked when the archive was opened, and whose content the checks inside the transaction verify), and tar is then stopped while
 * it still reads the rest of the archive, so its code says nothing about the dump (#240).
 */
export function pipelineFailure(
  restoreCode: number | null,
  tar: { code: number | null; endedAfterRestore: boolean },
): 'pg_restore' | 'tar' | null {
  if (restoreCode !== 0) return 'pg_restore';
  if (tar.code !== 0 && !tar.endedAfterRestore) return 'tar';
  return null;
}

type Pipe = ChildProcessByStdio<Writable | null, Readable | null, Readable>;

function exited(child: Pipe): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
}

function collectStderr(child: Pipe): () => string {
  let text = '';
  child.stderr.on('data', (part: Buffer) => {
    text = (text + part.toString('utf8')).slice(-8192);
  });
  return () => text;
}

/**
 * Replays the dump of an opened archive into `database` in ONE transaction, with the checks above inside it. Nothing is
 * committed unless every check passed. The dump is streamed (tar -> pg_restore -> psql), so it needs no extra disk space.
 */
export async function applyArchive(
  ctx: BackupContext,
  archive: OpenArchive,
  database: string,
  options: ApplyOptions,
): Promise<void> {
  const { config, tools } = ctx;
  const secrets = [config.db.ownerPassword, config.backup.passphrase ?? ''];
  const env = pgEnv(ownerLogin(config.db, database));
  const plain = { PATH: process.env['PATH'] ?? '' };

  const tar = spawn(tools.tar, ['-x', '-O', '-f', archive.tarPath, 'database.dump'], {
    env: plain,
    stdio: ['ignore', 'pipe', 'pipe'],
  }) as Pipe;
  const pgRestore = spawn(tools.pgRestore, ['-f', '-', '--no-owner'], { env, stdio: ['pipe', 'pipe', 'pipe'] }) as Pipe;
  const psql = spawn(tools.psql, ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
    env,
    stdio: ['pipe', options.checkFiles ? 'pipe' : 'ignore', 'pipe'],
  }) as unknown as Pipe;
  const tarError = collectStderr(tar);
  const restoreError = collectStderr(pgRestore);
  const psqlError = collectStderr(psql);
  const tarDone = exited(tar);
  const restoreDone = exited(pgRestore);
  const psqlDone = exited(psql);
  for (const stream of [pgRestore.stdin, psql.stdin]) stream?.on('error', () => undefined);
  tar.stdout?.pipe(pgRestore.stdin as Writable);
  // If pg_restore ends before it has read everything (it crashed, or it was refused), tar would block on a pipe nobody reads and the
  // whole restore would hang. Stop it: pg_restore's own exit code already tells the story.
  //
  // tar is also still running when pg_restore ends normally: after writing database.dump it reads the rest of the archive (the
  // photos, files.json, the end blocks) before it exits. Stopped then (or hit by the broken pipe), its exit code is not 0, and that
  // must not fail a restore whose pg_restore succeeded (#240). So whether tar ended before or after pg_restore is recorded here.
  let restoreEnded = false;
  const tarOutcome = tarDone.then((code) => ({ code, endedAfterRestore: restoreEnded }));
  void restoreDone
    .then(() => {
      restoreEnded = true;
      tar.stdout?.unpipe();
      // Drained (not just left alone): the child's 'close' waits for its output to end.
      tar.stdout?.resume();
      tar.kill();
    })
    .catch(() => undefined);

  const input = psql.stdin as Writable;
  // Writes with back-pressure, and stops waiting if psql has already gone (then its exit code tells the story).
  let psqlGone = false;
  void psqlDone.then(() => (psqlGone = true)).catch(() => (psqlGone = true));
  const write = (text: string | Buffer) =>
    new Promise<void>((resolve) => {
      if (psqlGone || input.destroyed || input.write(text)) return resolve();
      const done = () => {
        input.off('drain', done);
        input.off('close', done);
        resolve();
      };
      input.once('drain', done);
      input.once('close', done);
      void psqlDone.then(done, done);
    });

  try {
    await write(prefixSql());
    for await (const chunk of pgRestore.stdout as Readable) await write(chunk as Buffer);
    const [tarEnd, restoreCode] = await Promise.all([tarOutcome, restoreDone]);
    const failed = pipelineFailure(restoreCode, tarEnd);
    if (failed) {
      await write(FAIL_SQL);
      input.end();
      await psqlDone;
      throw new ToolError(
        failed,
        failed === 'pg_restore' ? restoreCode : tarEnd.code,
        clean(`${restoreError()} ${tarError()}`, secrets),
      );
    }
    await write(suffixBefore(archive.manifest, config.db.appUser, options));
    if (options.checkFiles) {
      const ids = await readIds(psql.stdout as Readable);
      if (ids !== null) {
        try {
          await options.checkFiles(ids);
        } catch (error) {
          await write('ROLLBACK;\n');
          input.end();
          await psqlDone.catch(() => undefined);
          throw error;
        }
      }
      // ids === null: psql ended before it printed them (an error in the script); its exit code, below, says why.
    }
    await write('COMMIT;\n');
    input.end();
  } catch (error) {
    input.destroy();
    await psqlDone.catch(() => undefined);
    throw error;
  }
  const code = await psqlDone;
  if (code !== 0) throw new ToolError('psql', code, clean(withoutNotices(psqlError()), secrets));
}

/** Reads psql's output until the end marker; the names between the markers. null when psql ended without printing them. */
function readIds(stream: Readable): Promise<string[] | null> {
  return new Promise((resolve) => {
    let text = '';
    const done = (value: string[] | null) => {
      stream.off('data', onData);
      stream.off('close', onClose);
      resolve(value);
    };
    const onData = (part: Buffer) => {
      text += part.toString('utf8');
      const end = text.indexOf(IDS_END);
      if (end >= 0) {
        const begin = text.indexOf(IDS_BEGIN);
        const body = text.slice(begin + IDS_BEGIN.length, end);
        done(
          body
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line !== ''),
        );
      }
    };
    const onClose = () => done(null);
    stream.on('data', onData);
    stream.on('close', onClose);
  });
}

/** What a restore does at the points a caller may want to show (the in-app maintenance page does). */
export type RestorePhase = 'safety_copy' | 'replacing' | 'migrating';

export interface RestoreHooks {
  /** Told what is about to happen, after every check has passed and before anything changes. Return false to stop. */
  confirm: (details: {
    manifest: Manifest;
    appVersion: string;
    createdAt: string;
    willSafetyCopy: boolean;
  }) => Promise<boolean>;
  progress: (message: string) => void;
  /** Optional: told when a new phase starts. */
  phase?: (phase: RestorePhase) => void;
}

/** What a person is told about a backup before they confirm a restore. Nothing here needs the database to change. */
export interface RestoreFacts {
  manifest: Manifest;
  appVersion: string;
  createdAt: string;
  /** How many newer database changes will be applied after the restore. */
  pendingMigrations: number;
  /** The backup was made by a newer KinShip version than this one (same schema, so it can be read). */
  newerApp: boolean;
  /** Rows in the backup's users table: 0 means the app returns to first-run setup. */
  accounts: number;
  /** The photo files the backup carries (included: false means a database-only backup: the files folder is left as it is). */
  files: { included: boolean; count: number; bytes: number };
}

export interface RestoreReport {
  cancelled: boolean;
  manifest: Manifest;
  safetyCopy: string | null;
  migrationsApplied: string[];
}

/**
 * Everything a restore refuses, before it changes anything. `appConnections: false` leaves out the one test that cannot pass
 * while the app itself is serving (the app role has open connections): the in-app "check" step uses that.
 */
async function preflight(
  ctx: BackupContext,
  archive: OpenArchive,
  conn: UntypedDb,
  options: { appConnections: boolean },
): Promise<RestoreFacts> {
  const { config, tools } = ctx;
  const { manifest } = archive;
  const refuse = (message: string): never => {
    throw new BackupError('refused', message);
  };
  const files = await readMigrationFiles(config.migrationsDir);
  const known = Math.max(0, ...files.map((f) => f.number));
  if (manifest.schema > known) {
    refuse(
      `This backup was made by a newer KinShip (database schema ${manifest.schema}, version ${manifest.appVersion}); this one only knows schema ${known}. Restore it with KinShip ${manifest.appVersion} or newer.`,
    );
  }
  const serverNum = (await sql<{ n: string }>`select current_setting('server_version_num') as n`.execute(conn)).rows[0]
    ?.n;
  const serverMajor = Math.floor(Number(serverNum) / 10000);
  if (manifest.serverMajor > serverMajor) {
    refuse(
      `This backup is from PostgreSQL ${manifest.serverMajor}; the database here is PostgreSQL ${serverMajor}, which cannot read it.`,
    );
  }
  const restoreMajor = await majorOf(tools.pgRestore, pgEnv(ownerLogin(config.db)));
  if (restoreMajor < manifest.pgDumpMajor) {
    refuse(
      `This backup was dumped with PostgreSQL ${manifest.pgDumpMajor} tools; this image has pg_restore ${restoreMajor}. Use a newer KinShip image.`,
    );
  }
  if (manifest.appRole !== config.db.appUser || manifest.ownerRole !== config.db.ownerUser) {
    refuse(
      `The backup was made with the database roles "${manifest.ownerRole}" (owner) and "${manifest.appRole}" (app); this installation uses "${config.db.ownerUser}" and "${config.db.appUser}". Set DB_OWNER_USER and DB_APP_USER in .env to the backup's names (a restore needs the same ones), then try again.`,
    );
  }
  if (options.appConnections) {
    const open = await sql<{ n: string }>`
      select count(*)::text as n from pg_stat_activity
       where datname = current_database() and usename = ${config.db.appUser} and pid <> pg_backend_pid()`.execute(conn);
    if (Number(open.rows[0]?.n) > 0) {
      refuse('KinShip is still running: the app role has open connections. Stop it first: docker compose stop web api');
    }
  }
  if (manifest.files.included) await checkPhotosCanBeRestored(ctx, archive);
  const size = Number(
    (await sql<{ n: string }>`select pg_database_size(current_database())::text as n`.execute(conn)).rows[0]?.n,
  );
  // The backups folder holds the safety copy of what is here now (the database and its photos) and the decrypted copy of the backup
  // (about the size of its dump, plus its photos) that is unpacked while the restore runs: twice the database, plus both sets of
  // photos. The files folder holds the backup's photos once (staged beside the current ones, then swapped in) and a tenth more.
  const present = await sql<{ n: string | null }>`select to_regclass('public.media_files')::text as n`.execute(conn);
  const currentPhotos =
    present.rows[0]?.n == null
      ? 0
      : Number(
          (
            await sql<{
              n: string;
            }>`select coalesce(sum(size + avatar_size), 0)::text as n from public.media_files`.execute(conn)
          ).rows[0]?.n ?? 0,
        );
  const backupPhotos = manifest.files.included ? manifest.files.bytes : 0;
  const filesDir = config.files.dir;
  const filesNeed = manifest.files.included ? Math.ceil(backupPhotos * 1.1) : 0;
  const sameDisk = manifest.files.included && sameDevice(config.backup.dir, filesDir);
  const need = size * 2 + currentPhotos + backupPhotos + (sameDisk ? filesNeed : 0);
  const free = (ctx.freeBytes ?? freeBytes)(config.backup.dir);
  if (free < need) {
    const photos = currentPhotos + backupPhotos > 0;
    throw new BackupError(
      'disk_space',
      photos
        ? `Not enough free space in the backups folder for a restore: ${need} bytes are needed (twice the database, which is ${size} bytes: a safety copy and the unpacked backup; plus the photos: ${currentPhotos} bytes in the safety copy and ${backupPhotos} in the unpacked backup${sameDisk ? `; plus ${filesNeed} for the photos' own folder, which is on the same disk` : ''}) and ${free} are available.`
        : `Not enough free space in the backups folder for a restore: ${need} bytes are needed (twice the database, which is ${size} bytes: a safety copy and the unpacked backup) and ${free} are available.`,
    );
  }
  if (manifest.files.included && !sameDisk) {
    const filesFree = (ctx.freeBytes ?? freeBytes)(filesDir);
    if (filesFree < filesNeed) {
      throw new BackupError(
        'disk_space',
        `Not enough free space in the files folder for a restore: ${filesNeed} bytes are needed (the ${backupPhotos} bytes of photos in the backup, and a tenth more) and ${filesFree} are available.`,
      );
    }
  }
  const newerApp = compareVersionText(manifest.appVersion, ctx.appVersion);
  return {
    manifest,
    appVersion: archive.header.appVersion,
    createdAt: manifest.createdAt,
    pendingMigrations: files.filter((f) => f.number > manifest.schema).length,
    newerApp: newerApp !== null && newerApp > 0,
    accounts: manifest.tables['users']?.rows ?? 0,
    files: { included: manifest.files.included, count: manifest.files.count, bytes: backupPhotos },
  };
}

/** The key must be the one that sealed the backup's photos, and the files folder must be usable. Refusals say what to do. */
async function checkPhotosCanBeRestored(ctx: BackupContext, archive: OpenArchive): Promise<FilesIndex> {
  const refuse = (message: string): never => {
    throw new BackupError('refused', message);
  };
  const index = await readFilesIndex(archive);
  const key = ctx.config.files.key;
  if (!key) {
    return refuse(
      'This backup carries photos, which are encrypted with a file key. This server has no FILE_ENCRYPTION_KEY, so the photos could not be opened afterwards. Set it to the key that was in use when the backup was made (it is not in the backup), then try again. Nothing was changed.',
    );
  }
  const mine = deriveFileKeys(key).keyId.toString('hex');
  const other = index.files.find((f) => f.keyId !== mine);
  if (other) {
    refuse(
      `This backup's photos were encrypted with a different file key (id ${other.keyId}) than this server's (id ${mine}). Restoring them would leave photos nobody can open. Put the original FILE_ENCRYPTION_KEY in .env, then try again. Nothing was changed.`,
    );
  }
  if (!filesFolderWritable(ctx.config.files.dir)) {
    refuse(
      `The files folder ${ctx.config.files.dir} cannot be written to, so the photos could not be put back.\n${FILES_FIX_LONG}`,
    );
  }
  return index;
}

const sameDevice = (a: string, b: string): boolean => {
  try {
    return statSync(a).dev === statSync(b).dev;
  } catch {
    return false;
  }
};

/**
 * The in-app "check" step: opens and verifies the archive and runs every refusal that does not depend on the app being stopped.
 * Changes nothing and holds no lock. The archive is closed again before this returns.
 */
export async function checkRestore(ctx: BackupContext, archivePath: string): Promise<RestoreFacts> {
  const { config } = ctx;
  const passphrase = config.backup.passphrase;
  if (passphrase === undefined) throw new BackupError('passphrase', 'A restore needs the backup passphrase.');
  const archive = await openArchive(archivePath, passphrase, ctx.tools, config.backup.dir);
  const db = createDb<AnySchema>(config.db, config.db.ownerUser, config.db.ownerPassword, 1);
  try {
    return await db.connection().execute((conn) => preflight(ctx, archive, conn, { appConnections: false }));
  } finally {
    archive.cleanup();
    await db.destroy();
  }
}

/**
 * Restores an archive over the current database. `ctx.config.backup.passphrase` is the archive's passphrase.
 * Order: decrypt and check everything, preflight, confirm, the app role, a safety copy of what is there, the atomic replace,
 * migrations if the backup is older, and the record in upgrade_log.
 */
export async function restoreBackup(
  ctx: BackupContext,
  archivePath: string,
  hooks: RestoreHooks,
): Promise<RestoreReport> {
  const { config, log } = ctx;
  const passphrase = config.backup.passphrase;
  if (passphrase === undefined) throw new BackupError('passphrase', 'A restore needs the backup passphrase.');
  hooks.progress('Checking the backup (decrypting and verifying every block)...');
  const archive = await openArchive(archivePath, passphrase, ctx.tools, config.backup.dir);
  // The migrations after an older backup may RAISE NOTICE (0024 names the people it left alone): log them.
  const db = createDb<AnySchema>(config.db, config.db.ownerUser, config.db.ownerPassword, 4, (message) =>
    log('warn', `database notice: ${message}`),
  );
  try {
    return await db.connection().execute(async (conn) => {
      const lock = await sql<{ ok: boolean }>`select pg_try_advisory_lock(${BACKUP_LOCK_KEY}) as ok`.execute(conn);
      if (!lock.rows[0]?.ok) throw new BackupError('busy', 'A backup or restore is already running.');
      try {
        const facts = await preflight(ctx, archive, conn, { appConnections: true });
        // An empty database (a brand-new server) has no schema_info table: nothing to make a safety copy of.
        const present = await sql<{
          present: boolean;
        }>`select to_regclass('public.schema_info') is not null as present`.execute(conn);
        const hasData =
          present.rows[0]?.present === true &&
          (await sql`select 1 from public.schema_info`.execute(conn)).rows.length > 0;
        // The version that is running now, before it is replaced: the upgrade log says "from" this one, so a restore of an older
        // backup reads as the version going down. The column may not exist on a very old database.
        let liveVersion: string | null = null;
        if (hasData) {
          try {
            liveVersion =
              (await sql<{ v: string | null }>`select app_version as v from public.schema_info`.execute(conn)).rows[0]
                ?.v ?? null;
          } catch {
            liveVersion = null;
          }
        }
        const ok = await hooks.confirm({
          manifest: archive.manifest,
          appVersion: archive.header.appVersion,
          createdAt: archive.manifest.createdAt,
          willSafetyCopy: hasData,
        });
        if (!ok) return { cancelled: true, manifest: archive.manifest, safetyCopy: null, migrationsApplied: [] };

        // The app role has to exist before the dump's grants name it. This is what makes a restore onto a brand-new,
        // empty Postgres work (the main disaster-recovery case).
        await ensureAppRole(conn, config.db.appUser, config.db.appPassword);

        let safetyCopy: string | null = null;
        if (hasData) {
          hooks.phase?.('safety_copy');
          hooks.progress('Making a safety copy of the current data first...');
          const name = preRestoreName(ctx.now?.() ?? new Date(), true);
          let made;
          try {
            // The safety copy carries the photos that are here now, so a restore can be undone completely.
            made = await createBackup(ctx, { kind: 'pre-restore', name, lockHeld: true, db, includeFiles: true });
          } catch (error) {
            // Photos in the database but a files folder that is not the one that holds them (a lost mount, the very thing a restore
            // from backup repairs): there are no photos here to copy, so the safety copy is the database alone.
            if (!(error instanceof BackupError) || error.kind !== 'files') throw error;
            hooks.progress('The photo files here cannot be read, so the safety copy holds the database only.');
            made = await createBackup(ctx, { kind: 'pre-restore', name, lockHeld: true, db });
          }
          safetyCopy = made.name;
          hooks.progress(`Safety copy: ${made.name}`);
        } else {
          hooks.progress('The database is empty: no safety copy to make.');
        }

        hooks.phase?.('replacing');
        hooks.progress('Replacing the database in one transaction (nothing changes unless every check passes)...');
        const filesDir = config.files.dir;
        let restoreId: string | undefined;
        let index: FilesIndex | undefined;
        if (facts.files.included) {
          index = await readFilesIndex(archive);
          restoreId = newRestoreId();
          hooks.progress('Unpacking the photos and checking each one...');
          ensureFilesFolder(filesDir);
          const staged = await stageFiles(ctx.tools, archive.tarPath, index, filesDir, restoreId);
          hooks.progress(`${staged.count} photo files are ready.`);
          writeIntent(filesDir, restoreId, ctx.now?.() ?? new Date());
        }
        try {
          await applyArchive(ctx, archive, config.db.name, {
            resetState: true,
            ...(restoreId !== undefined && index !== undefined
              ? { restoreId, checkFiles: (ids: string[]) => checkRowsCovered(ids, index as FilesIndex) }
              : {}),
          });
        } catch (error) {
          // Rolled back: the database is as it was, and so are the photos.
          if (restoreId !== undefined) discardStaging(filesDir, restoreId);
          throw error;
        }
        if (restoreId !== undefined) {
          hooks.progress('Putting the photos in place...');
          try {
            finishSwap(filesDir, restoreId);
          } catch (error) {
            // The database is already restored. The intent stays, and the next start finishes the swap from it.
            log('error', 'the photo files could not be swapped in after the restore; the next start will finish it', {
              reason: clean(String(error), [config.db.ownerPassword]),
            });
            throw new BackupError(
              'archive',
              'The database was restored but the photo files could not be put in place yet. Start KinShip again: it finishes this on its own. If the photos are still missing after that, restore the "Before a restore" copy.',
            );
          }
        } else {
          // A database-only backup leaves the files folder alone. Photos uploaded since have no row now: they are kept for a week.
          writeSweepHold(filesDir, (ctx.now?.() ?? new Date()).getTime());
        }

        hooks.phase?.('migrating');
        hooks.progress('Restored. Checking the migrations...');
        const files = await readMigrationFiles(config.migrationsDir);
        const migrated = await runMigrations(db, {
          dir: config.migrationsDir,
          appRole: config.db.appUser,
          log: (m) => log('info', m),
        });
        const top = Math.max(0, ...files.map((f) => f.number));
        const info = await sql<{ n: number }>`select schema_number as n from schema_info`.execute(conn);
        if (info.rows[0]?.n !== top) {
          throw new BackupError(
            'archive',
            `After the restore the database is at schema ${info.rows[0]?.n}, not ${top}. Your safety copy is ${safetyCopy ?? 'not needed (the database was empty)'}.`,
          );
        }
        const role = await sql<{
          rolsuper: boolean;
          rolbypassrls: boolean;
        }>`select rolsuper, rolbypassrls from pg_roles where rolname = ${config.db.appUser}`.execute(conn);
        if (role.rows[0]?.rolsuper || role.rows[0]?.rolbypassrls) {
          throw new BackupError(
            'archive',
            'After the restore the app role can bypass row-level security. Stop KinShip and check the database roles.',
          );
        }
        try {
          await sql`update schema_info set app_version = ${ctx.appVersion}`.execute(conn);
          await sql`
            insert into upgrade_log (event, from_schema, to_schema, from_version, to_version, backup_version, safety_copy, safety_note)
            values ('restore', ${archive.manifest.schema}, ${top}, ${liveVersion}, ${ctx.appVersion}, ${archive.manifest.appVersion},
                    ${safetyCopy}, ${safetyCopy === null ? 'fresh_install' : null})`.execute(conn);
        } catch (error) {
          log('warn', 'the restore worked but could not be recorded in upgrade_log', {
            reason: clean(String(error), [config.db.ownerPassword]),
          });
        }
        log('info', 'restore finished', {
          from: archive.manifest.appVersion,
          schema: top,
          migrations: migrated.applied.length,
        });
        return { cancelled: false, manifest: archive.manifest, safetyCopy, migrationsApplied: migrated.applied };
      } finally {
        await sql`select pg_advisory_unlock(${BACKUP_LOCK_KEY})`.execute(conn);
      }
    });
  } finally {
    archive.cleanup();
    await db.destroy();
  }
}
