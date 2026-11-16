// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Starts and stops the real stack for the end-to-end tests: the production compose.yml and
// .env.example, exactly as shipped, with throwaway passwords, on a private port. The images are
// ghcr.io/officialjcreyes/kinship-{web,api}:e2e (built by CI, or by `pnpm e2e:build-images`).
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  rmSync(WORK_DIR, { recursive: true, force: true });
  mkdirSync(WORK_DIR, { recursive: true });
  copyFileSync(join(REPO_ROOT, 'compose.yml'), join(WORK_DIR, 'compose.yml'));
  const settings: Record<string, string> = {
    KINSHIP_VERSION: IMAGE_VERSION,
    KINSHIP_PORT: String(PORT),
    KINSHIP_BIND: '127.0.0.1',
    PUBLIC_URL: BASE_URL,
    DB_OWNER_PASSWORD: randomBytes(16).toString('hex'),
    DB_APP_PASSWORD: randomBytes(16).toString('hex'),
  };
  let env = readFileSync(join(REPO_ROOT, '.env.example'), 'utf8');
  for (const [key, value] of Object.entries(settings))
    env = env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);
  writeFileSync(join(WORK_DIR, '.env'), env);
  compose(['down', '--volumes', '--remove-orphans'], { allowFailure: true });
  compose(['up', '-d', '--wait', '--wait-timeout', '240']);
}

/** Saves the logs of every service (for the failure artifact) and removes the stack and its data. */
export function stopStack(): void {
  mkdirSync(LOG_DIR, { recursive: true });
  for (const service of ['api', 'web', 'db']) {
    writeFileSync(join(LOG_DIR, `${service}.log`), compose(['logs', '--no-color', service], { allowFailure: true }));
  }
  compose(['down', '--volumes', '--remove-orphans'], { allowFailure: true });
}

/** The one-time setup token the api printed in its log, as a person running the server would read it. */
export function readSetupToken(): string {
  const log = compose(['logs', '--no-color', '--no-log-prefix', 'api']);
  const match = /one-time setup token:\s+(\S+)/.exec(log);
  if (!match?.[1]) throw new Error(`no setup token in the api log:\n${log.slice(-2000)}`);
  return match[1];
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * TEST-ONLY. Inserts an account straight into the database as the owner role, because the app cannot
 * invite members or users yet (that comes with 0.2). The password is set the way a server owner would,
 * with `kinship set-password` inside the api container. Never use this outside the end-to-end stack.
 */
export function insertTestAccount(account: {
  email: string;
  displayName: string;
  role: 'superadmin' | 'familyadmin' | 'member' | 'user';
  password: string;
  personId?: string;
}): void {
  const person = account.personId ? `${sqlString(account.personId)}::uuid` : 'NULL';
  const sql =
    `INSERT INTO users (email, display_name, password_hash, role, person_id) VALUES ` +
    `(${sqlString(account.email)}, ${sqlString(account.displayName)}, 'placeholder', ${sqlString(account.role)}, ${person})`;
  compose(['exec', '-T', 'db', 'psql', '-U', 'kinship', '-d', 'kinship', '-v', 'ON_ERROR_STOP=1', '-c', sql]);
  compose(['exec', '-T', 'api', 'kinship', 'set-password', account.email, '--password-stdin'], {
    input: account.password,
  });
}
