// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The backup commands of the `kinship` command line. They run inside the api container (or from the api image on another
// machine), connect with the owner role from the container's own settings, and are not reachable over HTTP.
import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { ConfigError, loadConfig } from './config.js';
import type { Config } from './config.js';
import { createBackup, decryptToFile, listBackups, openArchive } from './backup/archive.js';
import type { BackupContext, Log } from './backup/archive.js';
import { BackupError } from './backup/errors.js';
import { BackupFormatError } from './backup/format.js';
import { clean, run, toolsFromEnv } from './backup/tools.js';
import type { Tools } from './backup/tools.js';
import { readVersion } from './version.js';

export interface BackupCliDeps {
  /** The full configuration (needs the database settings). Only the commands that use the database call it. */
  config?: () => Config;
  tools?: Tools;
  env?: Record<string, string | undefined>;
  /** Reads a passphrase from the person (hidden input), when none was given. */
  askPassphrase?: () => Promise<string>;
  out: (text: string) => void;
  err: (text: string) => void;
}

export const BACKUP_USAGE = `  kinship backup                                make a backup now (needs BACKUP_PASSPHRASE)
  kinship backup-list                           list the backups in the backups folder
  kinship backup-verify <file>                  decrypt and check a backup (blocks, manifest, dump); changes nothing
  kinship backup-decrypt <file> <out.tar>       decrypt a backup to a plain tar, for disaster recovery`;

const jsonLog: Log = (level, message, fields) =>
  console.error(JSON.stringify({ level, time: Date.now(), msg: message, ...fields }));

/** --passphrase-file, then BACKUP_PASSPHRASE_FILE, then BACKUP_PASSPHRASE, then the person is asked. */
async function passphraseFor(args: string[], deps: BackupCliDeps): Promise<string> {
  const env = deps.env ?? process.env;
  const at = args.indexOf('--passphrase-file');
  const file = at >= 0 ? args[at + 1] : env['BACKUP_PASSPHRASE_FILE'];
  if (at >= 0 && !file) throw new BackupError('passphrase', '--passphrase-file needs a file name.');
  if (file) {
    try {
      return readFileSync(file, 'utf8').replace(/\r?\n$/, '');
    } catch {
      throw new BackupError('passphrase', `The passphrase file ${file} could not be read.`);
    }
  }
  const direct = env['BACKUP_PASSPHRASE'];
  if (direct) return direct;
  if (deps.askPassphrase) return deps.askPassphrase();
  throw new BackupError(
    'passphrase',
    'Give the passphrase in BACKUP_PASSPHRASE, BACKUP_PASSPHRASE_FILE or --passphrase-file.',
  );
}

const positional = (args: string[]) => {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--passphrase-file') i++;
    else if (!args[i]?.startsWith('--')) out.push(args[i] as string);
  }
  return out;
};

const backupDir = (deps: BackupCliDeps) => (deps.env ?? process.env)['BACKUP_DIR'] || '/var/lib/kinship/backups';

/** A bare file name means "in the backups folder"; anything with a slash is a path. */
const locate = (name: string, deps: BackupCliDeps) =>
  isAbsolute(name) || name.includes('/') ? resolve(name) : join(backupDir(deps), name);

function describeError(error: unknown): string {
  if (error instanceof BackupFormatError || error instanceof BackupError) return error.message;
  if (error instanceof ConfigError) return `Configuration error: ${error.message}`;
  return clean(error instanceof Error ? error.message : String(error));
}

const size = (bytes: number) =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export async function runBackupCommand(command: string, args: string[], deps: BackupCliDeps): Promise<number> {
  const tools = deps.tools ?? toolsFromEnv(deps.env);
  try {
    if (command === 'backup') {
      const config = (deps.config ?? loadConfig)();
      const version = readVersion(config.gitCommit, config.buildDate);
      const ctx: BackupContext = { config, tools, log: jsonLog, appVersion: version.version };
      const result = await createBackup(ctx, { kind: 'manual' });
      deps.out(`Backup written: ${result.name} (${size(result.bytes)}) in ${config.backup.dir}`);
      deps.out(
        'Keep BACKUP_PASSPHRASE (and FILE_ENCRYPTION_KEY when files exist) somewhere other than this server: the backup does not contain them.',
      );
      return 0;
    }

    if (command === 'backup-list') {
      const items = listBackups(backupDir(deps));
      if (items.length === 0) {
        deps.out('No backups yet.');
        return 0;
      }
      for (const item of items) {
        const schema = item.header ? `  schema ${item.header.schema}  v${item.header.appVersion}` : '';
        deps.out(
          `${item.name}  ${item.kind}  ${size(item.bytes)}  ${item.modified.toISOString()}${schema}${item.encrypted ? '' : '  (not encrypted)'}`,
        );
      }
      return 0;
    }

    const [file, out] = positional(args);
    if (command === 'backup-verify') {
      if (!file || positional(args).length !== 1) {
        deps.err(`Usage:\n${BACKUP_USAGE}`);
        return 2;
      }
      const passphrase = await passphraseFor(args, deps);
      const archive = await openArchive(locate(file, deps), passphrase, tools, backupDir(deps));
      try {
        const { manifest, header } = archive;
        // The dump must be one pg_restore can read.
        const dumpText = await (async () => {
          const chunks: Buffer[] = [];
          await archive.extract(
            'database.dump',
            new Writable({ write: (c: Buffer, _e, cb) => (chunks.push(c), cb()) }),
          );
          return Buffer.concat(chunks);
        })();
        const list = await run(tools.pgRestore, ['--list'], {
          env: { PATH: process.env['PATH'] ?? '' },
          stdin: Readable.from([dumpText]),
        });
        if (list.code !== 0) throw new BackupError('archive', `pg_restore cannot read the dump: ${list.stderr}`);
        const rows = Object.values(manifest.tables).reduce((sum, t) => sum + t.rows, 0);
        deps.out(`OK: every block authenticated, the manifest and the dump match.`);
        deps.out(
          `  made ${manifest.createdAt} by KinShip ${header.appVersion}, schema ${manifest.schema}, Postgres ${manifest.serverMajor}`,
        );
        deps.out(`  ${Object.keys(manifest.tables).length} tables, ${rows} rows, files: ${manifest.files.count}`);
      } finally {
        archive.cleanup();
      }
      return 0;
    }

    if (command === 'backup-decrypt') {
      if (!file || !out || positional(args).length !== 2) {
        deps.err(`Usage:\n${BACKUP_USAGE}`);
        return 2;
      }
      const passphrase = await passphraseFor(args, deps);
      await decryptToFile(locate(file, deps), resolve(out), passphrase);
      deps.out(`Decrypted to ${out}. Extract it with: tar -xf ${out}`);
      return 0;
    }
    deps.err(`Unknown command: ${command}`);
    return 2;
  } catch (error) {
    deps.err(describeError(error));
    return 1;
  }
}
