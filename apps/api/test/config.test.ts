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
      publicUrl: 'http://localhost:8080',
      trustProxy: false,
      sessionIdleSeconds: 14 * 86_400,
      sessionMaxSeconds: 90 * 86_400,
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

  it('reads proxy trust and session lengths', () => {
    expect(loadConfig({ ...good, TRUST_PROXY: 'true' }, noFiles).trustProxy).toBe(true);
    expect(loadConfig({ ...good, TRUST_PROXY: 'false' }, noFiles).trustProxy).toBe(false);
    expect(loadConfig({ ...good, TRUST_PROXY: '10.0.0.0/8, 172.16.0.0/12' }, noFiles).trustProxy).toEqual([
      '10.0.0.0/8',
      '172.16.0.0/12',
    ]);
    const config = loadConfig(
      { ...good, SESSION_IDLE_DAYS: '1', SESSION_MAX_DAYS: '2', PUBLIC_URL: 'https://kin.example/' },
      noFiles,
    );
    expect(config).toMatchObject({
      sessionIdleSeconds: 86_400,
      sessionMaxSeconds: 172_800,
      publicUrl: 'https://kin.example',
    });
  });

  it('rejects odd proxy and session settings', () => {
    expect(() => loadConfig({ ...good, TRUST_PROXY: '10.0.0.1,,10.0.0.2' }, noFiles)).toThrow(/TRUST_PROXY/);
    expect(() => loadConfig({ ...good, SESSION_IDLE_DAYS: '0' }, noFiles)).toThrow(/SESSION_IDLE_DAYS/);
    expect(() => loadConfig({ ...good, SESSION_IDLE_DAYS: '30', SESSION_MAX_DAYS: '7' }, noFiles)).toThrow(
      /must not be longer/,
    );
  });

  it('validates ports, role names and the log level', () => {
    expect(() => loadConfig({ ...good, DB_PORT: '99999' }, noFiles)).toThrow(ConfigError);
    expect(() => loadConfig({ ...good, API_PORT: 'abc' }, noFiles)).toThrow(/API_PORT/);
    expect(() => loadConfig({ ...good, DB_APP_USER: 'Robert"; drop' }, noFiles)).toThrow(/DB_APP_USER/);
    expect(() => loadConfig({ ...good, LOG_LEVEL: 'loud' }, noFiles)).toThrow(/LOG_LEVEL/);
  });
});
