// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Starts and stops the real stack for the end-to-end tests: the production compose.yml and
// .env.example, exactly as shipped, with throwaway passwords, on a private port. The images are
// ghcr.io/officialjcreyes/kinship-{web,api}:e2e (built by CI, or by `pnpm e2e:build-images`).
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const E2E_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = join(E2E_ROOT, '..');
export const WORK_DIR = join(E2E_ROOT, '.stack');
export const LOG_DIR = join(E2E_ROOT, 'artifacts', 'logs');
export const PROJECT = 'kinship-e2e';
export const PORT = Number(process.env['E2E_PORT'] ?? 18090);
export const BASE_URL = `http://127.0.0.1:${PORT}`;
export const IMAGE_VERSION = 'e2e';

function compose(args: string[], options: { input?: string; allowFailure?: boolean } = {}): string {
  const result = spawnSync('docker', ['compose', '--project-name', PROJECT, '--project-directory', WORK_DIR, ...args], {
    encoding: 'utf8',
    ...(options.input !== undefined ? { input: options.input } : {}),
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`docker compose ${args.join(' ')} failed:\n${result.stderr}\n${result.stdout}`);
  }
  return result.stdout + (result.status !== 0 ? result.stderr : '');
}

function imageExists(name: 'api' | 'web'): boolean {
  return (
    spawnSync('docker', ['image', 'inspect', `ghcr.io/officialjcreyes/kinship-${name}:${IMAGE_VERSION}`], {
      stdio: 'ignore',
    }).status === 0
  );
}

function ensureImages(): void {
  for (const name of ['api', 'web'] as const) {
    if (imageExists(name)) continue;
    console.log(`Image kinship-${name}:${IMAGE_VERSION} not found, building it (CI builds it in an earlier step)`);
    const result = spawnSync('node', [join(E2E_ROOT, 'support', 'build-images.mjs'), name], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`could not build the ${name} image`);
  }
}

/** Starts db, api and web from a fresh, throwaway install and waits until every service is healthy. */
export function startStack(): void {
  ensureImages();
  emptyFilesFolder();
  rmSync(WORK_DIR, { recursive: true, force: true });
  mkdirSync(WORK_DIR, { recursive: true });
  copyFileSync(join(REPO_ROOT, 'compose.yml'), join(WORK_DIR, 'compose.yml'));
  // The backups folder INSTALL.md tells people to create. World-writable here so the api's user (1000) can write whoever runs the
  // tests, and so the next run can remove what the container wrote.
  mkdirSync(join(WORK_DIR, 'data', 'backups'), { recursive: true });
  chmodSync(join(WORK_DIR, 'data', 'backups'), 0o777);
  // The photos folder INSTALL.md tells people to create, with the same permissions for the same reason.
  mkdirSync(join(WORK_DIR, 'data', 'files'), { recursive: true });
  chmodSync(join(WORK_DIR, 'data', 'files'), 0o777);
  // The backup passphrase of this throwaway stack, passed to the tests through the environment (to check it never leaks).
  process.env['E2E_BACKUP_PASSPHRASE'] ??= randomBytes(18).toString('hex');
  const settings: Record<string, string> = {
    KINSHIP_VERSION: IMAGE_VERSION,
    KINSHIP_PORT: String(PORT),
    KINSHIP_BIND: '127.0.0.1',
    PUBLIC_URL: BASE_URL,
    DB_OWNER_PASSWORD: randomBytes(16).toString('hex'),
    DB_APP_PASSWORD: randomBytes(16).toString('hex'),
    BACKUP_PASSPHRASE: process.env['E2E_BACKUP_PASSPHRASE'] ?? '',
    FILE_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  };
  let env = readFileSync(join(REPO_ROOT, '.env.example'), 'utf8');
  for (const [key, value] of Object.entries(settings))
    env = env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);
  writeFileSync(join(WORK_DIR, '.env'), env);
  compose(['down', '--volumes', '--remove-orphans'], { allowFailure: true });
  compose(['up', '-d', '--wait', '--wait-timeout', '240']);
  // The tests never talk to GitHub: the daily update check is switched off from the start (the switch is a setting in the
  // database, so it is set the way an admin would set it). Journey 12 plays the other cases by writing what a check would find.
  dbExec(
    `insert into app_settings (key, value) values ('updates.check', 'false'::jsonb) on conflict (key) do update set value = excluded.value`,
  );
}

/**
 * The photo files belong to the api's user (uid 1000) in folders only it can open, so the test user cannot delete them: empty the
 * folder from a container, as root, before the work folder is removed.
 */
function emptyFilesFolder(): void {
  const folder = join(WORK_DIR, 'data', 'files');
  if (!existsSync(folder)) return;
  spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${folder}:/files`,
      '--entrypoint',
      'sh',
      'node:26-alpine',
      '-c',
      'find /files -mindepth 1 -delete',
    ],
    { stdio: 'ignore' },
  );
}

/** The names of the stored photo files (objects/<2 hex>/<32 hex>), read inside the api container. */
export function storedFiles(): string[] {
  const out = compose(
    ['exec', '-T', 'api', 'sh', '-c', 'find /var/lib/kinship/files/objects -type f | sed "s#.*/##" | sort'],
    {
      allowFailure: true,
    },
  );
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Does any stored photo file contain these bytes? (A photo file must never contain a picture's own bytes.) */
export function storedFilesContain(text: string): boolean {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '--project-name',
      PROJECT,
      '--project-directory',
      WORK_DIR,
      'exec',
      '-T',
      'api',
      'sh',
      '-c',
      `grep -rlF -- '${text}' /var/lib/kinship/files/objects`,
    ],
    { encoding: 'utf8' },
  );
  return result.stdout.trim().length > 0;
}

/** Runs one SQL statement in the database container as the owner role (to arrange or read what no screen can). */
export function dbExec(statement: string): string {
  return compose([
    'exec',
    '-T',
    'db',
    'psql',
    '-U',
    'kinship',
    '-d',
    'kinship',
    '-v',
    'ON_ERROR_STOP=1',
    '-q',
    '-t',
    '-A',
    '-c',
    statement,
  ]).trim();
}

/** Saves the logs of every service (for the failure artifact) and removes the stack and its data. */
export function stopStack(): void {
  mkdirSync(LOG_DIR, { recursive: true });
  for (const service of ['api', 'web', 'db']) {
    writeFileSync(join(LOG_DIR, `${service}.log`), compose(['logs', '--no-color', service], { allowFailure: true }));
  }
  compose(['down', '--volumes', '--remove-orphans'], { allowFailure: true });
  emptyFilesFolder();
}

/** The one-time setup token the api printed in its log, as a person running the server would read it. */
export function readSetupToken(): string {
  const log = compose(['logs', '--no-color', '--no-log-prefix', 'api']);
  const match = /one-time setup token:\s+(\S+)/.exec(log);
  if (!match?.[1]) throw new Error(`no setup token in the api log:\n${log.slice(-2000)}`);
  return match[1];
}

/** The web container's log (nginx's access log), for checking that nothing secret reaches a server log. */
export function webLog(): string {
  return compose(['logs', '--no-color', '--no-log-prefix', 'web'], { allowFailure: true });
}

/** The api container's log. */
export function apiLog(): string {
  return compose(['logs', '--no-color', '--no-log-prefix', 'api'], { allowFailure: true });
}

/** Runs a command inside the api container (the `kinship` command line), as a person running the server would. */
export function apiExec(args: string[]): string {
  return compose(['exec', '-T', 'api', ...args], { allowFailure: true });
}
