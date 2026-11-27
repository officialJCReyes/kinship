// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { parseFileKey } from './files/key.js';

export interface DbConfig {
  host: string;
  port: number;
  name: string;
  ownerUser: string;
  ownerPassword: string;
  appUser: string;
  appPassword: string;
}

/** What Fastify's trustProxy accepts here: off, on (every hop), or the addresses/ranges of trusted proxies. */
export type TrustProxy = boolean | string[];

/** Built-in backups (see docs/decisions/0014). The passphrase is a secret: it is never logged and never in the API. */
export interface BackupConfig {
  /** BACKUP_ENABLED: the master switch for the schedule only. A manual backup needs just a usable passphrase. */
  enabled: boolean;
  /** The folder the archives are written to (the compose volume). */
  dir: string;
  /** The passphrase as configured, or undefined. Use passphraseProblem() before relying on it. */
  passphrase: string | undefined;
  /**
   * KINSHIP_SAFETY_COPY=skip: a one-shot break-glass for an upgrade whose safety copy cannot be made (a very large database,
   * a full disk). Not a setting: it is documented only in the troubleshooting notes, logged loudly and recorded in upgrade_log.
   */
  skipSafetyCopy: boolean;
}

/** Stored files (photos). The key is optional: without it KinShip runs and uploads answer 503 (ADR 0033). */
export interface FilesConfig {
  /** FILES_DIR: the folder the encrypted files live in (the compose volume). */
  dir: string;
  /** The 32 configured key bytes (base64 or hex in the environment), or undefined. Never logged, never in the database. */
  key: Buffer | undefined;
}

/** How mail reaches an SMTP server: STARTTLS required (the default), TLS from the first byte, or no encryption at all. */
export type SmtpSecurity = 'starttls' | 'tls' | 'none';

/**
 * Sending email (ADR 0041). Settings live only in the environment; the key and the password are secrets: never logged, never in
 * the database or the API. `provider: 'off'` is "not set up": the app behaves as before mail existed.
 */
export type MailConfig =
  | { provider: 'off' }
  | { provider: 'resend'; from: string; resendApiKey: string }
  | {
      provider: 'smtp';
      from: string;
      smtp: {
        host: string;
        port: number;
        security: SmtpSecurity;
        user: string | undefined;
        password: string | undefined;
      };
    };

export interface Config {
  /** Public address of the site, used in the first-run setup message. */
  publicUrl: string;
  /** Whether to believe X-Forwarded-For / -Proto / -Host, and from whom. Off unless configured. */
  trustProxy: TrustProxy;
  sessionIdleSeconds: number;
  sessionMaxSeconds: number;
  logLevel: string;
  host: string;
  port: number;
  migrationsDir: string;
  gitCommit: string;
  /** When the image was built (ISO 8601), stamped by the release build; "unknown" from a checkout. */
  buildDate: string;
  db: DbConfig;
  backup: BackupConfig;
  files: FilesConfig;
  mail: MailConfig;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

type Env = Record<string, string | undefined>;
type ReadFile = (path: string) => string;

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];
const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
const PLACEHOLDER_PREFIX = 'change-me';

function str(env: Env, name: string, fallback?: string): string {
  const value = env[name];
  if (value !== undefined && value !== '') return value;
  if (fallback !== undefined) return fallback;
  throw new ConfigError(`${name} is required`);
}

function port(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new ConfigError(`${name} must be a port number between 1 and 65535`);
  }
  return value;
}

/** A secret from NAME, or from the file named by NAME_FILE (Docker secrets). */
function secret(env: Env, name: string, readFile: ReadFile): string {
  const direct = env[name];
  const file = env[`${name}_FILE`];
  if (direct !== undefined && direct !== '' && file !== undefined && file !== '') {
    throw new ConfigError(`Set either ${name} or ${name}_FILE, not both`);
  }
  let value: string;
  if (file !== undefined && file !== '') {
    try {
      value = readFile(file).replace(/\r?\n$/, '');
    } catch {
      throw new ConfigError(`${name}_FILE points to ${file}, which could not be read`);
    }
  } else if (direct !== undefined && direct !== '') {
    value = direct;
  } else {
    throw new ConfigError(`${name} (or ${name}_FILE) is required`);
  }
  if (value === '') throw new ConfigError(`${name} is empty`);
  if (value.startsWith(PLACEHOLDER_PREFIX)) {
    throw new ConfigError(`${name} is still the placeholder from .env.example; set a real value`);
  }
  return value;
}

/** BACKUP_PASSPHRASE or BACKUP_PASSPHRASE_FILE, both optional. Whether it is good enough is checked where it is used. */
function optionalSecret(env: Env, name: string, readFile: ReadFile): string | undefined {
  const direct = env[name];
  const file = env[`${name}_FILE`];
  if (direct !== undefined && direct !== '' && file !== undefined && file !== '') {
    throw new ConfigError(`Set either ${name} or ${name}_FILE, not both`);
  }
  if (file !== undefined && file !== '') {
    try {
      return readFile(file).replace(/\r?\n$/, '');
    } catch {
      throw new ConfigError(`${name}_FILE points to ${file}, which could not be read`);
    }
  }
  return direct !== undefined && direct !== '' ? direct : undefined;
}

function parseSkip(env: Env): boolean {
  const raw = (env.KINSHIP_SAFETY_COPY ?? '').trim();
  if (raw === '') return false;
  if (raw === 'skip') return true;
  throw new ConfigError(
    'KINSHIP_SAFETY_COPY can only be "skip" (or left out); it is a one-time way past a failing safety copy',
  );
}

function backupConfig(env: Env, readFile: ReadFile): BackupConfig {
  const dest = (env.BACKUP_DEST ?? 'local').trim() || 'local';
  if (dest !== 'local') {
    throw new ConfigError(
      `BACKUP_DEST=${dest} is not supported: backups are written to the local folder only. S3 as a destination arrives in 1.1.`,
    );
  }
  const raw = (env.BACKUP_ENABLED ?? 'on').trim().toLowerCase();
  if (!['on', 'off', 'true', 'false', '1', '0', 'yes', 'no'].includes(raw)) {
    throw new ConfigError('BACKUP_ENABLED must be on or off');
  }
  return {
    enabled: ['on', 'true', '1', 'yes'].includes(raw),
    dir: str(env, 'BACKUP_DIR', '/var/lib/kinship/backups'),
    passphrase: optionalSecret(env, 'BACKUP_PASSPHRASE', readFile),
    skipSafetyCopy: parseSkip(env),
  };
}

function filesConfig(env: Env, readFile: ReadFile): FilesConfig {
  const raw = optionalSecret(env, 'FILE_ENCRYPTION_KEY', readFile);
  let key: Buffer | undefined;
  if (raw !== undefined && raw.trim() !== '') {
    if (raw.startsWith(PLACEHOLDER_PREFIX)) {
      throw new ConfigError('FILE_ENCRYPTION_KEY is still the placeholder from .env.example; set a real value');
    }
    const parsed = parseFileKey(raw);
    if (parsed === null) {
      throw new ConfigError(
        'FILE_ENCRYPTION_KEY must be 32 random bytes written as base64 (openssl rand -base64 32) or as 64 hex characters',
      );
    }
    key = parsed;
  }
  return { dir: str(env, 'FILES_DIR', '/var/lib/kinship/files'), key };
}

const set = (env: Env, name: string): boolean => (env[name] ?? '').trim() !== '' || (env[`${name}_FILE`] ?? '') !== '';

/** A From address as MAIL_FROM takes it: "addr@example.com" or "Name <addr@example.com>", one line, nothing else. */
export function parseMailFrom(raw: string): { name: string | null; address: string } | null {
  const value = raw.trim();
  // eslint-disable-next-line no-control-regex
  if (value === '' || value.length > 320 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const angled = /^(.*?)\s*<([^<>\s]+)>$/.exec(value);
  const name = angled ? angled[1]!.trim().replace(/^"(.*)"$/, '$1') : null;
  const address = angled ? angled[2]! : value;
  if (!isMailAddress(address)) return null;
  if (name !== null && (name === '' || /[<>"\\]/.test(name) || name.length > 64)) return null;
  return { name, address };
}

/** One plain address: local@domain, no spaces, commas, quotes, angle brackets or control characters, at most 254 characters. */
export function isMailAddress(value: string): boolean {
  return (
    value.length >= 3 &&
    value.length <= 254 &&
    /^[^\s@,;<>"()[\]\\]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(
      value,
    )
  );
}

function mailConfig(env: Env, readFile: ReadFile): MailConfig {
  const chosen = (env.MAIL_PROVIDER ?? '').trim().toLowerCase();
  if (!['', 'resend', 'smtp', 'off'].includes(chosen)) {
    throw new ConfigError('MAIL_PROVIDER must be resend, smtp or off (or left out)');
  }
  const hasResend = set(env, 'RESEND_API_KEY');
  const hasSmtp = set(env, 'SMTP_HOST');
  if (chosen === '' && hasResend && hasSmtp) {
    throw new ConfigError(
      'Both RESEND_API_KEY and SMTP_HOST are set: choose one with MAIL_PROVIDER=resend or MAIL_PROVIDER=smtp',
    );
  }
  const provider = chosen !== '' ? chosen : hasResend ? 'resend' : hasSmtp ? 'smtp' : 'off';
  if (provider === 'off') return { provider: 'off' };

  const rawFrom = (env.MAIL_FROM ?? '').trim();
  if (rawFrom === '') {
    throw new ConfigError(
      `Email is set up (${provider}) but MAIL_FROM is missing: set the sender, for example MAIL_FROM=KinShip <tree@example.com>`,
    );
  }
  if (parseMailFrom(rawFrom) === null) {
    throw new ConfigError(
      'MAIL_FROM must be one address, or a name and an address like KinShip <tree@example.com>, on one line',
    );
  }

  if (provider === 'resend') {
    const key = optionalSecret(env, 'RESEND_API_KEY', readFile);
    if (key === undefined || key.trim() === '') {
      throw new ConfigError('MAIL_PROVIDER=resend needs RESEND_API_KEY (or RESEND_API_KEY_FILE)');
    }
    if (key.startsWith(PLACEHOLDER_PREFIX)) {
      throw new ConfigError('RESEND_API_KEY is still the placeholder from .env.example; set a real value');
    }
    // eslint-disable-next-line no-control-regex
    if (/[\s\u0000-\u001f]/.test(key.trim())) throw new ConfigError('RESEND_API_KEY must be one word with no spaces');
    return { provider: 'resend', from: rawFrom, resendApiKey: key.trim() };
  }

  const host = (env.SMTP_HOST ?? '').trim();
  if (host === '') throw new ConfigError('MAIL_PROVIDER=smtp needs SMTP_HOST');
  if (/[\s/@]/.test(host) || host.length > 253) {
    throw new ConfigError('SMTP_HOST must be a host name or address only (no scheme, user or path)');
  }
  const rawSecurity = (env.SMTP_SECURE ?? 'starttls').trim().toLowerCase() || 'starttls';
  if (!['starttls', 'tls', 'none'].includes(rawSecurity)) {
    throw new ConfigError('SMTP_SECURE must be starttls (the default), tls or none');
  }
  const security = rawSecurity as SmtpSecurity;
  const user = (env.SMTP_USER ?? '').trim() || undefined;
  const password = optionalSecret(env, 'SMTP_PASSWORD', readFile);
  if (password !== undefined && password.startsWith(PLACEHOLDER_PREFIX)) {
    throw new ConfigError('SMTP_PASSWORD is still the placeholder from .env.example; set a real value');
  }
  if (user !== undefined && (password === undefined || password === '')) {
    throw new ConfigError(
      'SMTP_USER is set but SMTP_PASSWORD (or SMTP_PASSWORD_FILE) is missing: set both, or neither',
    );
  }
  if (user === undefined && password !== undefined && password !== '') {
    throw new ConfigError('SMTP_PASSWORD is set but SMTP_USER is missing: set both, or neither');
  }
  if (security === 'none' && user !== undefined) {
    throw new ConfigError(
      'SMTP_SECURE=none with SMTP_USER would send the password across the network in clear: use starttls or tls',
    );
  }
  return {
    provider: 'smtp',
    from: rawFrom,
    smtp: { host, port: port(env, 'SMTP_PORT', security === 'tls' ? 465 : 587), security, user, password },
  };
}

function trustProxy(env: Env): TrustProxy {
  const raw = (env.TRUST_PROXY ?? '').trim();
  if (raw === '' || raw === 'false') return false;
  if (raw === 'true') return true;
  const list = raw.split(',').map((item) => item.trim());
  if (list.some((item) => item === '' || /\s/.test(item))) {
    throw new ConfigError('TRUST_PROXY must be true, false, or a comma-separated list of addresses or ranges');
  }
  return list;
}

function days(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 3650) {
    throw new ConfigError(`${name} must be a number of days between 0 and 3650`);
  }
  return value;
}

function roleName(env: Env, name: string, fallback: string): string {
  const value = str(env, name, fallback);
  if (!ROLE_NAME.test(value)) {
    throw new ConfigError(
      `${name} must be lowercase letters, digits and underscores, starting with a letter or underscore`,
    );
  }
  return value;
}

export function loadConfig(env: Env = process.env, readFile: ReadFile = (p) => readFileSync(p, 'utf8')): Config {
  const logLevel = str(env, 'LOG_LEVEL', 'info');
  if (!LOG_LEVELS.includes(logLevel)) {
    throw new ConfigError(`LOG_LEVEL must be one of: ${LOG_LEVELS.join(', ')}`);
  }

  const ownerUser = roleName(env, 'DB_OWNER_USER', 'kinship');
  const appUser = roleName(env, 'DB_APP_USER', 'kinship_app');
  if (ownerUser === appUser) {
    throw new ConfigError('DB_OWNER_USER and DB_APP_USER must be different roles');
  }
  const ownerPassword = secret(env, 'DB_OWNER_PASSWORD', readFile);
  const appPassword = secret(env, 'DB_APP_PASSWORD', readFile);
  if (ownerPassword === appPassword) {
    throw new ConfigError('DB_OWNER_PASSWORD and DB_APP_PASSWORD must be different');
  }

  const sessionIdleSeconds = Math.round(days(env, 'SESSION_IDLE_DAYS', 14) * 86_400);
  const sessionMaxSeconds = Math.round(days(env, 'SESSION_MAX_DAYS', 90) * 86_400);
  if (sessionIdleSeconds > sessionMaxSeconds) {
    throw new ConfigError('SESSION_IDLE_DAYS must not be longer than SESSION_MAX_DAYS');
  }

  return {
    publicUrl: str(env, 'PUBLIC_URL', 'http://localhost:8080').replace(/\/+$/, ''),
    trustProxy: trustProxy(env),
    sessionIdleSeconds,
    sessionMaxSeconds,
    logLevel,
    host: str(env, 'API_HOST', '0.0.0.0'),
    port: port(env, 'API_PORT', 3000),
    migrationsDir: str(env, 'MIGRATIONS_DIR', fileURLToPath(new URL('../migrations', import.meta.url))),
    gitCommit: str(env, 'GIT_COMMIT', 'unknown'),
    buildDate: str(env, 'BUILD_DATE', 'unknown'),
    db: {
      host: str(env, 'DB_HOST', 'db'),
      port: port(env, 'DB_PORT', 5432),
      name: str(env, 'DB_NAME', 'kinship'),
      ownerUser,
      ownerPassword,
      appUser,
      appPassword,
    },
    backup: backupConfig(env, readFile),
    files: filesConfig(env, readFile),
    mail: mailConfig(env, readFile),
  };
}

/**
 * Removes the secrets from process.env once they are in the Config, so nothing that reads the environment later (a
 * library, a diagnostic report, a child process that inherits it) can see them. It does not hide them from someone who
 * can already read /proc/<pid>/environ of this process (the same user), which is the container's own start-up
 * environment: code execution in the api exposes the owner password either way (see ADR 0014).
 */
export function scrubSecretsFromEnv(env: Record<string, string | undefined> = process.env): void {
  for (const name of [
    'DB_OWNER_PASSWORD',
    'DB_APP_PASSWORD',
    'BACKUP_PASSPHRASE',
    'FILE_ENCRYPTION_KEY',
    'RESEND_API_KEY',
    'SMTP_PASSWORD',
  ]) {
    delete env[name];
    delete env[`${name}_FILE`];
  }
}
