// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Running the PostgreSQL command-line tools and tar as short-lived child processes. The database password goes only into the
// child's explicit environment (never argv, never the parent's process.env, never a log line). Every tool is used through
// stdin and stdout only, so the same code works with a binary on the path or with a wrapper that runs it inside the db container.
import { spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import type { DbConfig } from '../config.js';

export interface Tools {
  pgDump: string;
  pgRestore: string;
  psql: string;
  tar: string;
}

/** The tool paths: PG_DUMP, PG_RESTORE, PSQL and TAR override the defaults (the image has them on its path). */
export function toolsFromEnv(env: Record<string, string | undefined> = process.env): Tools {
  return {
    pgDump: env['PG_DUMP'] || 'pg_dump',
    pgRestore: env['PG_RESTORE'] || 'pg_restore',
    psql: env['PSQL'] || 'psql',
    tar: env['TAR'] || 'tar',
  };
}

export interface PgLogin {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/** The owner role's login, for the tools. */
export function ownerLogin(db: DbConfig, database: string = db.name): PgLogin {
  return { host: db.host, port: db.port, database, user: db.ownerUser, password: db.ownerPassword };
}

/** The environment of a tool: only what it needs, nothing inherited from the api (which may hold other secrets). */
export function pgEnv(login: PgLogin): Record<string, string> {
  return {
    PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
    PGHOST: login.host,
    PGPORT: String(login.port),
    PGDATABASE: login.database,
    PGUSER: login.user,
    PGPASSWORD: login.password,
    PGCONNECT_TIMEOUT: '15',
    PGAPPNAME: 'kinship-maintenance',
    LC_ALL: 'C.UTF-8',
  };
}

export class ToolError extends Error {
  override name = 'ToolError';
  constructor(
    readonly tool: string,
    readonly exitCode: number | null,
    /** What the tool said, cleaned (see clean). */
    readonly detail: string,
  ) {
    super(`${tool} failed${exitCode === null ? '' : ` with exit code ${exitCode}`}${detail ? `: ${detail}` : ''}`);
  }
}

/** Keeps the last of a tool's error output, with any secret removed. */
export function clean(text: string, secrets: readonly string[] = []): string {
  let out = text.trim().slice(-2000);
  for (const secret of secrets) {
    if (secret.length >= 4) out = out.split(secret).join('***');
  }
  return out;
}

export interface RunOptions {
  env: Record<string, string>;
  /** Written to the tool's stdin, then closed. */
  stdin?: Readable;
  /** The tool's stdout goes here (and the writable is ended). Otherwise it is collected. */
  stdout?: Writable;
  secrets?: readonly string[];
}

export interface RunResult {
  code: number | null;
  stdout: Buffer;
  stderr: string;
}

/** Runs a program with explicit arguments (never a shell). Resolves with the result; use runChecked to throw on failure. */
export function run(command: string, args: readonly string[], options: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { env: options.env, stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let stderr = '';
    child.stderr.on('data', (part: Buffer) => {
      stderr = (stderr + part.toString('utf8')).slice(-8192);
    });
    if (options.stdout) child.stdout.pipe(options.stdout);
    else child.stdout.on('data', (part: Buffer) => out.push(part));
    if (options.stdin) {
      options.stdin.on('error', () => child.stdin.destroy());
      child.stdin.on('error', () => undefined);
      options.stdin.pipe(child.stdin);
    } else {
      child.stdin.end();
    }
    child.on('error', (error) => reject(new ToolError(command, null, clean(error.message, options.secrets))));
    child.on('close', (code) => {
      resolve({ code, stdout: Buffer.concat(out), stderr: clean(stderr, options.secrets) });
    });
  });
}

export async function runChecked(command: string, args: readonly string[], options: RunOptions): Promise<Buffer> {
  const result = await run(command, args, options);
  if (result.code !== 0) throw new ToolError(command, result.code, result.stderr);
  return result.stdout;
}
