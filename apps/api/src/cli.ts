// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The `kinship` command, for whoever runs the server. It is not reachable over
// HTTP: it only exists inside the api container, and it connects to the
// database with the owner role from the container's own settings.
//
//   docker compose exec -it api kinship set-password you@example.com
import { pathToFileURL } from 'node:url';
import { sql } from 'kysely';
import { ConfigError, loadConfig } from './config.js';
import { createOwnerDb } from './db.js';
import type { UntypedDb } from './db.js';
import { hashPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './auth/passwords.js';
import { BACKUP_USAGE, runBackupCommand } from './cli-backup.js';
import type { BackupCliDeps } from './cli-backup.js';

export interface CliDeps {
  /** Opens the owner connection. Called only for commands that need the database. */
  openDb: () => UntypedDb;
  /** Asks for a new password (twice when typed by a person). Never takes it from the command line. */
  readPassword: (options: { fromStdin: boolean }) => Promise<string>;
  out: (text: string) => void;
  err: (text: string) => void;
  /** What the backup commands use (the full configuration, the tools, a way to ask for a passphrase). */
  backup?: Partial<BackupCliDeps>;
}

const USAGE = `Usage:
  kinship set-password <email>                  ask for a new password (typed twice, not shown)
  kinship set-password <email> --password-stdin  read the new password from standard input
${BACKUP_USAGE}

set-password sets a new password for an account, signs it out everywhere and retires its open set-password link. For when
someone is locked out and email recovery is not available.`;

const BACKUP_COMMANDS = ['backup', 'backup-list', 'backup-verify', 'backup-decrypt'];

/** Sets a new password hash and removes all of the account's sessions. Returns false when no such account. */
export async function setUserPassword(db: UntypedDb, email: string, passwordHash: string): Promise<boolean> {
  const result = await sql<{ id: string }>`
    with changed as (
      update users
         set password_hash = ${passwordHash}, password_changed_at = now(), password_changed_via = 'cli',
             updated_at = now()
       where email = lower(${email.trim()})
      returning id
    ), signed_out as (
      delete from sessions where user_id in (select id from changed)
    ), links_retired as (
      update account_links set revoked_at = now()
       where kind = 'reset' and accepted_at is null and revoked_at is null
         and user_id in (select id from changed)
    )
    select id from changed`.execute(db);
  return result.rows.length > 0;
}

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const [command, ...rest] = argv;
  if (command !== undefined && BACKUP_COMMANDS.includes(command)) {
    return runBackupCommand(command, rest, { out: deps.out, err: deps.err, ...deps.backup });
  }
  if (command !== 'set-password') {
    deps.err(
      command === undefined || command === '--help' || command === 'help'
        ? USAGE
        : `Unknown command: ${command}\n\n${USAGE}`,
    );
    return command === '--help' || command === 'help' ? 0 : 2;
  }

  const fromStdin = rest.includes('--password-stdin');
  const positional = rest.filter((arg) => !arg.startsWith('--'));
  const unknownFlags = rest.filter((arg) => arg.startsWith('--') && arg !== '--password-stdin');
  const email = positional[0];
  if (email === undefined || positional.length !== 1 || unknownFlags.length > 0) {
    deps.err(USAGE);
    return 2;
  }

  const password = await deps.readPassword({ fromStdin });
  if (password.length < MIN_PASSWORD_LENGTH) {
    deps.err(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    return 1;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    deps.err(`The password must be at most ${MAX_PASSWORD_LENGTH} characters.`);
    return 1;
  }

  const db = deps.openDb();
  try {
    if (!(await setUserPassword(db, email, await hashPassword(password)))) {
      deps.err(`There is no account with the email ${email}.`);
      return 1;
    }
  } finally {
    await db.destroy();
  }
  deps.out(`Password changed for ${email.trim().toLowerCase()}. That account was signed out everywhere.`);
  return 0;
}

/** Reads a line from a terminal without showing it. */
function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const { stdin, stderr } = process;
    stderr.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\u0003') {
          cleanup();
          reject(new Error('cancelled'));
          return;
        }
        if (char === '\r' || char === '\n' || char === '\u0004') {
          cleanup();
          stderr.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    };
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
    };
    stdin.on('data', onData);
  });
}

async function readStdin(): Promise<string> {
  let data = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) data += chunk as string;
  return data.replace(/\r?\n$/, '');
}

async function main(): Promise<void> {
  const deps: CliDeps = {
    openDb: () => createOwnerDb(loadConfig().db),
    readPassword: async ({ fromStdin }) => {
      if (fromStdin) return readStdin();
      if (!process.stdin.isTTY) {
        throw new Error('No terminal to ask on. Run with -it, or pass --password-stdin and pipe the password in.');
      }
      const first = await readHidden('New password: ');
      const second = await readHidden('Type it again: ');
      if (first !== second) throw new Error('The two passwords are not the same.');
      return first;
    },
    out: (text) => console.log(text),
    err: (text) => console.error(text),
    backup: {
      askPassphrase: async () => {
        if (!process.stdin.isTTY)
          throw new Error('No terminal to ask on. Set BACKUP_PASSPHRASE or use --passphrase-file.');
        return readHidden('Backup passphrase: ');
      },
    },
  };
  try {
    process.exitCode = await runCli(process.argv.slice(2), deps);
  } catch (error) {
    console.error(
      error instanceof ConfigError
        ? `Configuration error: ${error.message}`
        : error instanceof Error
          ? error.message
          : error,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
