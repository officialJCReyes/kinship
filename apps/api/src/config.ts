// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface DbConfig {
  host: string;
  port: number;
  name: string;
  ownerUser: string;
  ownerPassword: string;
  appUser: string;
  appPassword: string;
}

export interface Config {
  /** NODE_ENV; "production" in the published image. */
  nodeEnv: string;
  logLevel: string;
  host: string;
  port: number;
  migrationsDir: string;
  gitCommit: string;
  db: DbConfig;
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

  return {
    nodeEnv: str(env, 'NODE_ENV', 'development'),
    logLevel,
    host: str(env, 'API_HOST', '0.0.0.0'),
    port: port(env, 'API_PORT', 3000),
    migrationsDir: str(env, 'MIGRATIONS_DIR', fileURLToPath(new URL('../migrations', import.meta.url))),
    gitCommit: str(env, 'GIT_COMMIT', 'unknown'),
    db: {
      host: str(env, 'DB_HOST', 'db'),
      port: port(env, 'DB_PORT', 5432),
      name: str(env, 'DB_NAME', 'kinship'),
      ownerUser,
      ownerPassword,
      appUser,
      appPassword,
    },
  };
}
