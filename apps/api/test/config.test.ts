// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, scrubSecretsFromEnv } from '../src/config.js';

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
      buildDate: 'unknown',
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

  it('reads the build stamp (commit and build date) the release build sets', () => {
    const config = loadConfig({ ...good, GIT_COMMIT: 'abc1234', BUILD_DATE: '2026-11-15T19:04:05Z' }, noFiles);
    expect(config).toMatchObject({ gitCommit: 'abc1234', buildDate: '2026-11-15T19:04:05Z' });
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

describe('backup settings', () => {
  it('default to the schedule being on, the local folder, and no passphrase', () => {
    expect(loadConfig(good, noFiles).backup).toEqual({
      enabled: true,
      dir: '/var/lib/kinship/backups',
      passphrase: undefined,
      skipSafetyCopy: false,
    });
  });

  it('read BACKUP_ENABLED, and the passphrase from the variable or from a file', () => {
    expect(loadConfig({ ...good, BACKUP_ENABLED: 'off' }, noFiles).backup.enabled).toBe(false);
    expect(() => loadConfig({ ...good, BACKUP_ENABLED: 'maybe' }, noFiles)).toThrow(ConfigError);
    expect(loadConfig({ ...good, BACKUP_PASSPHRASE: 'a long enough passphrase' }, noFiles).backup.passphrase).toBe(
      'a long enough passphrase',
    );
    const fromFile = loadConfig({ ...good, BACKUP_PASSPHRASE_FILE: '/run/secrets/b' }, () => 'from a file\n');
    expect(fromFile.backup.passphrase).toBe('from a file');
    expect(() => loadConfig({ ...good, BACKUP_PASSPHRASE: 'x', BACKUP_PASSPHRASE_FILE: '/f' }, () => 'y')).toThrow(
      /either BACKUP_PASSPHRASE or BACKUP_PASSPHRASE_FILE/,
    );
    expect(() => loadConfig({ ...good, BACKUP_PASSPHRASE_FILE: '/missing' }, noFiles)).toThrow(/could not be read/);
  });

  it('does not refuse to start for a missing, short or placeholder passphrase (the schedule just stays off)', () => {
    expect(() => loadConfig({ ...good, BACKUP_PASSPHRASE: 'change-me-backup' }, noFiles)).not.toThrow();
    expect(() => loadConfig({ ...good, BACKUP_PASSPHRASE: 'short' }, noFiles)).not.toThrow();
  });

  it('refuses any destination but local, and says S3 comes later', () => {
    expect(() => loadConfig({ ...good, BACKUP_DEST: 's3' }, noFiles)).toThrow(/S3 as a destination arrives in 1\.1/);
    expect(loadConfig({ ...good, BACKUP_DEST: 'local' }, noFiles).backup.dir).toBe('/var/lib/kinship/backups');
  });
});

describe('the safety copy break-glass', () => {
  it('is only ever "skip"', () => {
    expect(loadConfig({ ...good, KINSHIP_SAFETY_COPY: 'skip' }, noFiles).backup.skipSafetyCopy).toBe(true);
    expect(loadConfig({ ...good, KINSHIP_SAFETY_COPY: '' }, noFiles).backup.skipSafetyCopy).toBe(false);
    expect(() => loadConfig({ ...good, KINSHIP_SAFETY_COPY: 'off' }, noFiles)).toThrow(/can only be "skip"/);
  });
});

describe('the file encryption key', () => {
  const bytes = Buffer.alloc(32, 7);
  const b64 = bytes.toString('base64');

  it('is optional: no key, and the default folder', () => {
    expect(loadConfig(good, noFiles).files).toEqual({ dir: '/var/lib/kinship/files', key: undefined });
  });

  it('reads base64, hex, and FILES_DIR', () => {
    expect(loadConfig({ ...good, FILE_ENCRYPTION_KEY: b64, FILES_DIR: '/x' }, noFiles).files).toEqual({
      dir: '/x',
      key: bytes,
    });
    expect(loadConfig({ ...good, FILE_ENCRYPTION_KEY: bytes.toString('hex') }, noFiles).files.key).toEqual(bytes);
  });

  it('reads FILE_ENCRYPTION_KEY_FILE and trims the newline', () => {
    const config = loadConfig({ ...good, FILE_ENCRYPTION_KEY_FILE: '/run/secrets/k' }, () => `${b64}\n`);
    expect(config.files.key).toEqual(bytes);
  });

  it('refuses both ways at once, an unreadable file, the placeholder and a wrong length or format', () => {
    expect(() => loadConfig({ ...good, FILE_ENCRYPTION_KEY: b64, FILE_ENCRYPTION_KEY_FILE: '/k' }, noFiles)).toThrow(
      /either FILE_ENCRYPTION_KEY or FILE_ENCRYPTION_KEY_FILE/,
    );
    expect(() => loadConfig({ ...good, FILE_ENCRYPTION_KEY_FILE: '/missing' }, noFiles)).toThrow(/could not be read/);
    expect(() => loadConfig({ ...good, FILE_ENCRYPTION_KEY: 'change-me-files' }, noFiles)).toThrow(/placeholder/);
    for (const bad of [
      'short',
      Buffer.alloc(16).toString('base64'),
      Buffer.alloc(33).toString('hex'),
      'x'.repeat(64),
    ]) {
      expect(() => loadConfig({ ...good, FILE_ENCRYPTION_KEY: bad }, noFiles), bad).toThrow(ConfigError);
    }
  });

  it('never puts the key in an error message', () => {
    try {
      loadConfig({ ...good, FILE_ENCRYPTION_KEY: 'sekrit-not-a-key' }, noFiles);
    } catch (error) {
      expect((error as Error).message).not.toContain('sekrit');
    }
  });

  it('is scrubbed from the environment with its _FILE variant', () => {
    const env: Record<string, string | undefined> = {
      FILE_ENCRYPTION_KEY: b64,
      FILE_ENCRYPTION_KEY_FILE: '/k',
      FILES_DIR: '/x',
    };
    scrubSecretsFromEnv(env);
    expect(env).toEqual({ FILES_DIR: '/x' });
  });
});

describe('scrubSecretsFromEnv', () => {
  it('removes the passwords and the passphrase (and their _FILE variants) and leaves the rest', () => {
    const env: Record<string, string | undefined> = {
      DB_OWNER_PASSWORD: 'a',
      DB_APP_PASSWORD: 'b',
      BACKUP_PASSPHRASE: 'c',
      DB_OWNER_PASSWORD_FILE: '/x',
      LOG_LEVEL: 'info',
    };
    scrubSecretsFromEnv(env);
    expect(env).toEqual({ LOG_LEVEL: 'info' });
  });
});
