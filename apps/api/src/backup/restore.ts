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
import { readMigrationFiles } from '../migrations/files.js';
import { runMigrations } from '../migrations/runner.js';
import { compareVersionText } from '@kinship/shared';
import { BACKUP_LOCK_KEY, createBackup, freeBytes, majorOf, openArchive, preRestoreName } from './archive.js';
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
}

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
  IF pg_catalog.to_regclass('public.account_links') IS NOT NULL THEN
    UPDATE public.account_links SET revoked_at = pg_catalog.now() WHERE accepted_at IS NULL AND revoked_at IS NULL;
  END IF;
END`)};`,
    );
  }
  out.push(
    `DO ${dollar(`BEGIN EXECUTE pg_catalog.format('GRANT CONNECT ON DATABASE %I TO %I', pg_catalog.current_database(), ${`'${appRole.replace(/'/g, "''")}'`}); END`)};`,
    'COMMIT;',
    '',
  );
  return out.join('\n');
}

const FAIL_SQL = `DO ${dollar("BEGIN RAISE EXCEPTION 'the dump inside the backup could not be read; nothing was changed'; END")};\n`;

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
    stdio: ['pipe', 'ignore', 'pipe'],
  }) as Pipe;
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
  void restoreDone
    .then(() => {
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
    const [tarCode, restoreCode] = await Promise.all([tarDone, restoreDone]);
    if (tarCode !== 0 || restoreCode !== 0) {
      await write(FAIL_SQL);
      input.end();
      await psqlDone;
      throw new ToolError('pg_restore', restoreCode ?? tarCode, clean(`${restoreError()} ${tarError()}`, secrets));
    }
    await write(suffixSql(archive.manifest, config.db.appUser, options));
    input.end();
  } catch (error) {
    input.destroy();
    await psqlDone.catch(() => undefined);
    throw error;
  }
  const code = await psqlDone;
  if (code !== 0) throw new ToolError('psql', code, clean(withoutNotices(psqlError()), secrets));
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
  // STEP 37 MUST DELETE THIS GUARD (issue "extend restore to media files"). restore replays the database only: the archive's
  // files/ entries are not put back, so a backup that carries files would be restored WITHOUT them, silently. Until restore
  // handles them, refuse. (Nothing can carry files before the release that adds uploads.)
  if (manifest.files.included || manifest.files.count > 0) {
    refuse(
      'This backup carries uploaded files, and this version of KinShip cannot restore files yet, only the database. Nothing was changed.',
    );
  }
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
  const size = Number(
    (await sql<{ n: string }>`select pg_database_size(current_database())::text as n`.execute(conn)).rows[0]?.n,
  );
  // Twice the database: the safety copy of what is there now, and the decrypted copy of the backup (a tar about the size of
  // its dump) that is unpacked into the backups folder while the restore runs.
  const need = size * 2;
  const free = (ctx.freeBytes ?? freeBytes)(config.backup.dir);
  if (free < need) {
    throw new BackupError(
      'disk_space',
      `Not enough free space in the backups folder for a restore: ${need} bytes are needed (twice the database, which is ${size} bytes: a safety copy and the unpacked backup) and ${free} are available.`,
    );
  }
  const newerApp = compareVersionText(manifest.appVersion, ctx.appVersion);
  return {
    manifest,
    appVersion: archive.header.appVersion,
    createdAt: manifest.createdAt,
    pendingMigrations: files.filter((f) => f.number > manifest.schema).length,
    newerApp: newerApp !== null && newerApp > 0,
    accounts: manifest.tables['users']?.rows ?? 0,
  };
}

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
  const db = createDb<AnySchema>(config.db, config.db.ownerUser, config.db.ownerPassword, 4);
  try {
    return await db.connection().execute(async (conn) => {
      const lock = await sql<{ ok: boolean }>`select pg_try_advisory_lock(${BACKUP_LOCK_KEY}) as ok`.execute(conn);
      if (!lock.rows[0]?.ok) throw new BackupError('busy', 'A backup or restore is already running.');
      try {
        await preflight(ctx, archive, conn, { appConnections: true });
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
          const made = await createBackup(ctx, {
            kind: 'pre-restore',
            name: preRestoreName(ctx.now?.() ?? new Date(), true),
            lockHeld: true,
            db,
          });
          safetyCopy = made.name;
          hooks.progress(`Safety copy: ${made.name}`);
        } else {
          hooks.progress('The database is empty: no safety copy to make.');
        }

        hooks.phase?.('replacing');
        hooks.progress('Replacing the database in one transaction (nothing changes unless every check passes)...');
        await applyArchive(ctx, archive, config.db.name, { resetState: true });

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
