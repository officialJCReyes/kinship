// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

const good = { DB_OWNER_PASSWORD: 'owner-secret', DB_APP_PASSWORD: 'app-secret' };
const noFiles = (path: string): string => {
  throw new Error(`no such file ${path}`);
};

describe('loadConfig', () => {
  it('uses defaults for everything but the passwords', () => {
    const config = loadConfig(good, noFiles);
    expect(config.db).toMatchObject({
      host: 'db',
      port: 5432,
      name: 'kinship',
      ownerUser: 'kinship',
      appUser: 'kinship_app',
    });
    expect(config).toMatchObject({
      port: 3000,
      host: '0.0.0.0',
      logLevel: 'info',
      gitCommit: 'unknown',
      nodeEnv: 'development',
    });
    expect(config.migrationsDir).toMatch(/migrations$/);
  });

  it('reads secrets from NAME_FILE and trims the trailing newline', () => {
    const files: Record<string, string> = { '/run/secrets/owner': 'from-file\n' };
    const config = loadConfig(
      { DB_OWNER_PASSWORD_FILE: '/run/secrets/owner', DB_APP_PASSWORD: 'app-secret' },
      (path) => files[path] ?? noFiles(path),
    );
    expect(config.db.ownerPassword).toBe('from-file');
  });

  it('rejects a secret given both ways, a missing file and a missing secret', () => {
    expect(() => loadConfig({ ...good, DB_OWNER_PASSWORD_FILE: '/x' }, noFiles)).toThrow(
      /either DB_OWNER_PASSWORD or DB_OWNER_PASSWORD_FILE/,
    );
    expect(() => loadConfig({ DB_OWNER_PASSWORD_FILE: '/missing', DB_APP_PASSWORD: 'a' }, noFiles)).toThrow(
      /could not be read/,
    );
    expect(() => loadConfig({ DB_APP_PASSWORD: 'a' }, noFiles)).toThrow(
      /DB_OWNER_PASSWORD \(or DB_OWNER_PASSWORD_FILE\) is required/,
    );
  });

  it('refuses the .env.example placeholders', () => {
    expect(() => loadConfig({ ...good, DB_OWNER_PASSWORD: 'change-me-owner' }, noFiles)).toThrow(/placeholder/);
  });

  it('refuses identical roles or identical passwords for owner and app', () => {
    expect(() => loadConfig({ ...good, DB_APP_USER: 'kinship' }, noFiles)).toThrow(/must be different roles/);
    expect(() => loadConfig({ DB_OWNER_PASSWORD: 'same', DB_APP_PASSWORD: 'same' }, noFiles)).toThrow(
      /must be different/,
    );
  });

  it('validates ports, role names and the log level', () => {
    expect(() => loadConfig({ ...good, DB_PORT: '99999' }, noFiles)).toThrow(ConfigError);
    expect(() => loadConfig({ ...good, API_PORT: 'abc' }, noFiles)).toThrow(/API_PORT/);
    expect(() => loadConfig({ ...good, DB_APP_USER: 'Robert"; drop' }, noFiles)).toThrow(/DB_APP_USER/);
    expect(() => loadConfig({ ...good, LOG_LEVEL: 'loud' }, noFiles)).toThrow(/LOG_LEVEL/);
  });
});
