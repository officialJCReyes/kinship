// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Making, listing, opening and checking backup archives (see docs/backup-format.md). Restoring is in restore.ts.
import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  createReadStream,
  createWriteStream,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statfsSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { sql } from 'kysely';
import type { Config } from '../config.js';
import { createOwnerDb } from '../db.js';
import type { UntypedDb } from '../db.js';
import { createDecryptStream, createEncryptStream, passphraseProblem } from './crypto.js';
import { BackupError } from './errors.js';
import { collectFiles, parseFilesIndex, storedFilesBytes } from './files.js';
import type { CollectedFiles, FilesIndex } from './files.js';
import { LEAD_LENGTH, readPreamble } from './format.js';
import type { ArchiveHeader, KdfParams } from './format.js';
import { assertOwnerReadsEverything, fingerprint, tableStats } from './inspect.js';
import { parseManifest } from './manifest.js';
import type { BackupKind, Manifest } from './manifest.js';
import { clean, ownerLogin, pgEnv, run, runChecked, ToolError } from './tools.js';
import type { Tools } from './tools.js';

/** One lock for "a backup or restore is running", across api containers and the CLI. */
export const BACKUP_LOCK_KEY = 7_302_041_121;

export type Log = (level: 'info' | 'warn' | 'error', message: string, fields?: Record<string, unknown>) => void;

export interface BackupContext {
  config: Config;
  tools: Tools;
  log: Log;
  /** The running app's version, written into the header and manifest. */
  appVersion: string;
  /** Only tests lower the KDF cost. */
  kdf?: { N: number; r: number; p: number };
  now?: () => Date;
  /** Free bytes in a folder. Only tests replace it. */
  freeBytes?: (dir: string) => number;
}

// ---- names ----

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** kinship-YYYY-MM-DD-HHMM (UTC), without the extension. */
export function stamp(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
}

const NAME_PATTERNS: Array<{ kind: BackupKind; encrypted: boolean; pattern: RegExp }> = [
  { kind: 'manual', encrypted: true, pattern: /^kinship-\d{4}-\d{2}-\d{2}-\d{4}(-\d{1,3})?\.tar\.enc$/ },
  { kind: 'pre-upgrade', encrypted: true, pattern: /^pre-upgrade-\d{4}-to-\d{4}\.tar\.enc$/ },
  { kind: 'pre-upgrade', encrypted: false, pattern: /^pre-upgrade-\d{4}-to-\d{4}\.sql\.gz$/ },
  { kind: 'pre-restore', encrypted: true, pattern: /^pre-restore-\d{8}-\d{6}\.tar\.enc$/ },
  { kind: 'pre-restore', encrypted: false, pattern: /^pre-restore-\d{8}-\d{6}\.sql\.gz$/ },
];

/** The kind of a file in the backups folder from its name alone, or undefined for anything that is not ours. */
export function classifyName(name: string): { kind: BackupKind; encrypted: boolean } | undefined {
  const found = NAME_PATTERNS.find((entry) => entry.pattern.test(name));
  return found ? { kind: found.kind, encrypted: found.encrypted } : undefined;
}

export function preUpgradeName(from: number, to: number, encrypted: boolean): string {
  return `pre-upgrade-${pad(from, 4)}-to-${pad(to, 4)}.${encrypted ? 'tar.enc' : 'sql.gz'}`;
}

export function preRestoreName(date: Date, encrypted: boolean): string {
  const day = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
  const time = `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
  return `pre-restore-${day}-${time}.${encrypted ? 'tar.enc' : 'sql.gz'}`;
}

// ---- the folder ----

/** The commands that make the backups folder usable, for a message. */
export const FOLDER_FIX =
  'Create it on the host and let the api write to it: "mkdir -p data/backups && sudo chown 1000:1000 data/backups" ' +
  '(Docker Desktop on macOS and Windows does not need the chown), and make sure compose.yml mounts it under api: ' +
  '"volumes: - ./data/backups:/var/lib/kinship/backups".';

/** The same fix, spelled out for a log line at start-up (an upgrade whose compose.yml has no backups volume yet). */
export const FOLDER_FIX_LONG = [
  'Add the backups folder to the api service in compose.yml:',
  '    api:',
  '      volumes:',
  '        - ./data/backups:/var/lib/kinship/backups',
  'then create it on the host and let the api (user 1000) write to it:',
  '    mkdir -p data/backups && sudo chown 1000:1000 data/backups',
  '(Docker Desktop on macOS and Windows does not need the chown.) Then start KinShip again.',
].join('\n');

/** Makes sure the folder exists (mode 0700) and can be written to. Throws a BackupError that says how to fix it. */
export function ensureBackupDir(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const probe = join(dir, `.write-test-${randomBytes(4).toString('hex')}`);
    writeFileSync(probe, '', { mode: 0o600 });
    rmSync(probe);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new BackupError(
      'dir_not_writable',
      `The backups folder ${dir} cannot be written to (${reason}). ${FOLDER_FIX}`,
    );
  }
}

export function freeBytes(dir: string): number {
  const stats = statfsSync(dir);
  return Number(stats.bavail) * Number(stats.bsize);
}

// ---- making an archive ----

export interface BackupResult {
  name: string;
  path: string;
  bytes: number;
  manifest: Manifest;
}

/** Writes to a file and a SHA-256 of what it wrote. */
class HashingFile extends Writable {
  private readonly hash = createHash('sha256');
  private readonly out: Writable;
  bytes = 0;
  constructor(path: string) {
    super();
    this.out = createWriteStream(path, { flags: 'wx', mode: 0o600 });
    this.out.on('error', (error) => this.destroy(error));
  }
  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.hash.update(chunk);
    this.bytes += chunk.length;
    this.out.write(chunk, callback);
  }
  override _final(callback: (error?: Error | null) => void): void {
    this.out.end(callback);
  }
  get sha256(): string {
    return this.hash.copy().digest('hex');
  }
}

export async function majorOf(tool: string, env: Record<string, string>): Promise<number> {
  const out = (await runChecked(tool, ['--version'], { env })).toString('utf8');
  const match = /(\d+)(?:\.\d+)*/.exec(out.replace(/^.*\(PostgreSQL\)\s*/, ''));
  return match ? Number(match[1]) : 0;
}

function uniqueName(dir: string, date: Date): string {
  const base = `kinship-${stamp(date)}`;
  for (let n = 1; n < 1000; n++) {
    const name = n === 1 ? `${base}.tar.enc` : `${base}-${n}.tar.enc`;
    try {
      lstatSync(join(dir, name));
    } catch {
      return name;
    }
  }
  throw new BackupError('archive', 'Too many backups in the same minute.');
}

export interface CreateOptions {
  kind: BackupKind;
  /** The file name; defaults to kinship-YYYY-MM-DD-HHMM.tar.enc (UTC). */
  name?: string;
  /** The caller already holds the backup lock (a restore making its safety copy). */
  lockHeld?: boolean;
  /** An owner connection to use instead of opening one (the caller closes it). */
  db?: UntypedDb;
  /**
   * Carry the stored photo files in the archive. Off by default: a database-only archive (an upgrade's safety copy, or "Include
   * uploaded files" switched off) leaves the files folder alone when it is restored.
   */
  includeFiles?: boolean;
}

/**
 * The free space a backup needs: the database, the photos twice (staged beside the archive, then inside it; Docker's two mounted
 * folders are two disks, so the staging is a copy), and a tenth more.
 */
export const spaceNeeded = (databaseBytes: number, filesBytes: number): number =>
  Math.ceil((databaseBytes + 2 * filesBytes) * 1.1);

/**
 * Makes one encrypted archive of the whole database (and the media files): a pg_dump taken as the owner under an exported
 * snapshot, with row counts and digests taken under the same snapshot, packed with a manifest, tarred and encrypted. It is
 * written to a temporary name and renamed into place, mode 0600. One at a time (Postgres advisory lock).
 */
export async function createBackup(ctx: BackupContext, options: CreateOptions): Promise<BackupResult> {
  const { config, tools, log } = ctx;
  const problem = passphraseProblem(config.backup.passphrase);
  if (problem !== null) {
    throw new BackupError(
      'passphrase',
      `Backups need a usable passphrase: ${problem}. Set BACKUP_PASSPHRASE (or BACKUP_PASSPHRASE_FILE) in .env.`,
    );
  }
  const passphrase = config.backup.passphrase as string;
  const dir = config.backup.dir;
  ensureBackupDir(dir);

  const db = options.db ?? createOwnerDb(config.db);
  const started = Date.now();
  const work = join(dir, `.work-${randomBytes(6).toString('hex')}`);
  let temp: string | undefined;
  try {
    return await db.connection().execute(async (conn) => {
      if (!options.lockHeld) {
        const lock = await sql<{ ok: boolean }>`select pg_try_advisory_lock(${BACKUP_LOCK_KEY}) as ok`.execute(conn);
        if (!lock.rows[0]?.ok) throw new BackupError('busy', 'A backup or restore is already running.');
      }
      try {
        await assertOwnerReadsEverything(conn);

        const size = await sql<{ bytes: string }>`select pg_database_size(current_database())::text as bytes`.execute(
          conn,
        );
        const databaseBytes = Number(size.rows[0]?.bytes ?? 0);
        // A database from before the photo tables (an upgrade's safety copy of an old schema) has no photos to include.
        const hasPhotoTable =
          (await sql<{ n: string | null }>`select to_regclass('public.media_files')::text as n`.execute(conn)).rows[0]
            ?.n != null;
        const wantFiles = options.includeFiles === true && hasPhotoTable;
        const filesBytes = wantFiles ? await storedFilesBytes(conn) : 0;
        const need = spaceNeeded(databaseBytes, filesBytes);
        const free = (ctx.freeBytes ?? freeBytes)(dir);
        if (free < need) {
          throw new BackupError(
            'disk_space',
            `Not enough free space in ${dir}: the database is ${databaseBytes} bytes${
              wantFiles
                ? `, the photos are ${filesBytes} bytes (counted twice: each is staged beside the archive, then packed into it), and a tenth more is needed`
                : ''
            }; ${need} are needed and the folder has ${free} free.`,
          );
        }

        mkdirSync(work, { mode: 0o700 });
        const login = ownerLogin(config.db);
        const env = pgEnv(login);
        const secrets = [config.db.ownerPassword, passphrase];
        const dumpMajor = await majorOf(tools.pgDump, env);

        // Counts, digests and the dump are all taken under one snapshot, so they describe the same moment.
        await sql`begin isolation level repeatable read read only`.execute(conn);
        let manifest: Omit<Manifest, 'dump' | 'files'>;
        let dump: HashingFile;
        let collected: CollectedFiles | undefined;
        try {
          const snapshot = (await sql<{ id: string }>`select pg_export_snapshot() as id`.execute(conn)).rows[0]?.id;
          if (!snapshot) throw new BackupError('tool', 'The database gave no snapshot.');
          const serverNum = (await sql<{ n: string }>`select current_setting('server_version_num') as n`.execute(conn))
            .rows[0]?.n;
          const serverMajor = Math.floor(Number(serverNum) / 10000);
          if (dumpMajor < serverMajor) {
            throw new BackupError(
              'tool',
              `pg_dump is version ${dumpMajor} but the database server is version ${serverMajor}; pg_dump must be the same or newer.`,
            );
          }
          const schema = Number(
            (await sql<{ n: number }>`select schema_number as n from schema_info`.execute(conn)).rows[0]?.n ?? 0,
          );
          const tables = await tableStats(conn);
          const print = await fingerprint(conn, config.db.appUser);
          manifest = {
            format: 1,
            kind: options.kind,
            createdAt: (ctx.now?.() ?? new Date()).toISOString(),
            appVersion: ctx.appVersion,
            schema,
            pgDumpMajor: dumpMajor,
            serverMajor,
            database: config.db.name,
            ownerRole: config.db.ownerUser,
            appRole: config.db.appUser,
            tables,
            fingerprint: print,
          };
          dump = new HashingFile(join(work, 'database.dump'));
          const result = await run(tools.pgDump, ['-Fc', '--no-owner', `--snapshot=${snapshot}`], {
            env,
            stdout: dump,
            secrets,
          });
          await new Promise<void>((resolve) =>
            dump.writableFinished ? resolve() : dump.once('finish', () => resolve()),
          );
          if (result.code !== 0) throw new ToolError('pg_dump', result.code, result.stderr);
          // The photos named by the rows of THIS snapshot (not by whatever is on the disk now).
          if (wantFiles) collected = await collectFiles(conn, config.files.dir, join(work, 'files'));
        } finally {
          await sql`rollback`.execute(conn);
        }

        // The photo files are linked into the work folder so tar can follow them; the index says what each must be.
        // "Included" means there is something to put back: a family with no photos yet makes the same archive as a database-only
        // one, so restoring it leaves the files folder alone (a restore that swapped in an empty folder would delete photos uploaded
        // since, with no way back).
        const included =
          collected !== undefined && (collected.index.files.length > 0 || collected.index.missing.length > 0);
        if (collected && included) {
          mkdirSync(join(work, 'files'), { recursive: true, mode: 0o700 });
          writeFileSync(join(work, 'files.json'), JSON.stringify(collected.index), { mode: 0o600 });
          if (collected.index.missing.length > 0) {
            log('warn', 'some photos have a row but no file; the backup lists them as missing', {
              count: collected.index.missing.length,
            });
          }
        }
        const full: Manifest = {
          ...manifest,
          dump: { file: 'database.dump', sha256: dump.sha256, bytes: dump.bytes },
          files: {
            included,
            count: included ? (collected?.index.files.length ?? 0) : 0,
            bytes: included ? (collected?.bytes ?? 0) : 0,
          },
        };
        writeFileSync(join(work, 'manifest.json'), JSON.stringify(full), { mode: 0o600 });

        const name = options.name ?? uniqueName(dir, ctx.now?.() ?? new Date());
        const target = join(dir, name);
        temp = join(dir, `.tmp-${randomBytes(6).toString('hex')}.tar.enc`);
        const encrypt = await createEncryptStream({
          passphrase,
          appVersion: ctx.appVersion,
          schema: full.schema,
          ...(ctx.kdf ? { kdf: ctx.kdf } : {}),
        });
        const sink = createWriteStream(temp, { flags: 'wx', mode: 0o600 });
        const written = pipeline(encrypt, sink);
        const names = ['manifest.json', 'database.dump', ...(included ? ['files.json', 'files'] : [])];
        const tar = await run(tools.tar, ['-c', '-h', '-f', '-', '-C', work, ...names], {
          env: { PATH: process.env['PATH'] ?? '' },
          stdout: encrypt,
        });
        await written;
        if (tar.code !== 0) throw new ToolError('tar', tar.code, tar.stderr);
        const fd = openSync(temp, 'r');
        try {
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        chmodSync(temp, 0o600);
        renameSync(temp, target);
        temp = undefined;
        const bytes = lstatSync(target).size;
        log('info', 'backup written', { name, kind: options.kind, bytes, ms: Date.now() - started });
        return { name, path: target, bytes, manifest: full };
      } finally {
        if (!options.lockHeld) await sql`select pg_advisory_unlock(${BACKUP_LOCK_KEY})`.execute(conn);
      }
    });
  } catch (error) {
    if (error instanceof BackupError) throw error;
    if (error instanceof ToolError) {
      const message = clean(error.message, [config.db.ownerPassword, passphrase]);
      throw new BackupError(/ENOSPC|No space left/i.test(message) ? 'disk_space' : 'tool', message, { cause: error });
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new BackupError(
      /ENOSPC|No space left/i.test(reason) ? 'disk_space' : 'tool',
      clean(reason, [config.db.ownerPassword, passphrase]),
      { cause: error },
    );
  } finally {
    if (temp) rmSync(temp, { force: true });
    rmSync(work, { recursive: true, force: true });
    if (!options.db) await db.destroy();
  }
}

// ---- listing ----

export interface ListedBackup {
  name: string;
  kind: BackupKind;
  encrypted: boolean;
  bytes: number;
  modified: Date;
  /** From the cleartext header of an encrypted archive. Not trusted until the archive is opened with the passphrase. */
  header?: Pick<ArchiveHeader, 'appVersion' | 'schema' | 'created'>;
}

export function readHeaderOfFile(path: string): ArchiveHeader | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const lead = Buffer.alloc(LEAD_LENGTH + 16 * 1024);
    const got = readSync(fd, lead, 0, lead.length, 0);
    return readPreamble(lead.subarray(0, got)).header;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Our files in the backups folder, newest first. Anything that is not ours, or is a link, is ignored. */
export function listBackups(dir: string): ListedBackup[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: ListedBackup[] = [];
  for (const name of names) {
    const classified = classifyName(name);
    if (!classified) continue;
    const path = join(dir, name);
    const info = lstatSync(path);
    if (!info.isFile()) continue;
    const header = classified.encrypted ? readHeaderOfFile(path) : undefined;
    out.push({
      name,
      kind: classified.kind,
      encrypted: classified.encrypted,
      bytes: info.size,
      modified: info.mtime,
      ...(header ? { header: { appVersion: header.appVersion, schema: header.schema, created: header.created } } : {}),
    });
  }
  return out.sort((a, b) => b.modified.getTime() - a.modified.getTime() || b.name.localeCompare(a.name));
}

// ---- opening an archive ----

const ENTRY = /^(manifest\.json|database\.dump|files\.json|files\/?|files\/[0-9a-f]{32})$/;

/** Throws unless every entry of a tar listing is one we expect and nothing is repeated. */
export function checkEntryNames(names: readonly string[]): void {
  const seen = new Set<string>();
  for (const name of names) {
    if (name === '' || !ENTRY.test(name))
      throw new BackupError('archive', `The backup holds an unexpected entry: ${JSON.stringify(name.slice(0, 80))}.`);
    if (seen.has(name)) throw new BackupError('archive', `The backup lists ${name} twice.`);
    seen.add(name);
  }
  if (!seen.has('manifest.json') || !seen.has('database.dump')) {
    throw new BackupError('archive', 'The backup is missing its manifest or its database dump.');
  }
}

/** The photo index of an archive that carries files, read and checked for shape. */
export async function readFilesIndex(archive: OpenArchive): Promise<FilesIndex> {
  const chunks: Buffer[] = [];
  await archive.extract('files.json', new Writable({ write: (c: Buffer, _e, cb) => (chunks.push(c), cb()) }));
  try {
    return parseFilesIndex(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } catch (error) {
    throw new BackupError('archive', error instanceof Error ? error.message : 'The backup file index cannot be read.');
  }
}

export interface OpenArchive {
  /** The decrypted tar, in the work folder. */
  tarPath: string;
  header: ArchiveHeader;
  manifest: Manifest;
  entries: string[];
  /** Streams one member of the tar to a writable. */
  extract(member: string, to: Writable): Promise<void>;
  cleanup(): void;
}

/**
 * Decrypts a whole archive into a work folder INSIDE the backups folder (not /tmp, which is memory), checks every block, the
 * entry names, the manifest and the SHA-256 of the dump, and returns a handle. Nothing in the database is touched.
 */
export async function openArchive(
  archivePath: string,
  passphrase: string,
  tools: Tools,
  workParent: string,
): Promise<OpenArchive> {
  const work = join(workParent, `.work-${randomBytes(6).toString('hex')}`);
  mkdirSync(work, { recursive: true, mode: 0o700 });
  const cleanup = () => rmSync(work, { recursive: true, force: true });
  try {
    const tarPath = join(work, 'archive.tar');
    let header: ArchiveHeader | undefined;
    await pipeline(
      createReadStream(archivePath),
      createDecryptStream(passphrase, (h) => (header = h)),
      createWriteStream(tarPath, { flags: 'wx', mode: 0o600 }),
    );
    if (!header) throw new BackupError('archive', 'The backup has no header.');
    const env = { PATH: process.env['PATH'] ?? '' };
    const listing = (await runChecked(tools.tar, ['-t', '-f', tarPath], { env })).toString('utf8');
    const entries = listing
      .split('\n')
      .map((line) => line.replace(/^\.\//, ''))
      .filter((line) => line !== '');
    checkEntryNames(entries);
    const extract = async (member: string, to: Writable) => {
      const result = await run(tools.tar, ['-x', '-O', '-f', tarPath, member], { env, stdout: to });
      if (result.code !== 0) throw new ToolError('tar', result.code, result.stderr);
    };
    const chunks: Buffer[] = [];
    await extract('manifest.json', new Writable({ write: (c: Buffer, _e, cb) => (chunks.push(c), cb()) }));
    let manifest: Manifest;
    try {
      manifest = parseManifest(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch (error) {
      throw new BackupError('manifest', error instanceof Error ? error.message : 'The backup manifest cannot be read.');
    }
    if (manifest.schema !== header.schema || manifest.appVersion !== header.appVersion) {
      throw new BackupError('manifest', 'The backup header and its manifest disagree.');
    }
    const hash = createHash('sha256');
    let bytes = 0;
    await extract(
      'database.dump',
      new Writable({
        write: (c: Buffer, _e, cb) => {
          hash.update(c);
          bytes += c.length;
          cb();
        },
      }),
    );
    if (hash.digest('hex') !== manifest.dump.sha256 || bytes !== manifest.dump.bytes) {
      throw new BackupError('archive', 'The database dump inside the backup does not match its manifest.');
    }
    const fileEntries = entries.filter((e) => e.startsWith('files/') && e !== 'files/').length;
    if (fileEntries !== manifest.files.count)
      throw new BackupError('archive', 'The files in the backup do not match its manifest.');
    if (manifest.files.included !== entries.includes('files.json'))
      throw new BackupError('archive', 'The files in the backup do not match its manifest.');
    return { tarPath, header, manifest, entries, extract, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

/** Decrypts an archive to a plain tar file (the disaster-recovery path). Nothing else is checked. */
export async function decryptToFile(archivePath: string, outPath: string, passphrase: string): Promise<void> {
  const temp = `${outPath}.partial-${randomBytes(4).toString('hex')}`;
  try {
    await pipeline(
      createReadStream(archivePath),
      createDecryptStream(passphrase),
      createWriteStream(temp, { flags: 'wx', mode: 0o600 }),
    );
    renameSync(temp, outPath);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

export type { KdfParams };
