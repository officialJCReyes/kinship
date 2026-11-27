// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Email settings (ADR 0041): only in the environment; nothing set means "not set up"; a half-set configuration refuses to start
// with a message that says what is missing.
import { describe, expect, it } from 'vitest';
import { ConfigError, isMailAddress, loadConfig, parseMailFrom, scrubSecretsFromEnv } from '../src/config.js';

const base = { DB_OWNER_PASSWORD: 'owner-secret', DB_APP_PASSWORD: 'app-secret' };
const noFiles = (path: string): string => {
  throw new Error(`no such file ${path}`);
};
const load = (env: Record<string, string>, files: Record<string, string> = {}) =>
  loadConfig({ ...base, ...env }, (path) => files[path] ?? noFiles(path));
const refused = (env: Record<string, string>, message: RegExp) => {
  expect(() => load(env)).toThrow(ConfigError);
  expect(() => load(env)).toThrow(message);
};

const FROM = 'Hale Family Tree <tree@hale.example>';

describe('mail settings', () => {
  it('are "not set up" when nothing is set, and when MAIL_PROVIDER=off', () => {
    expect(load({}).mail).toEqual({ provider: 'off' });
    expect(load({ MAIL_PROVIDER: 'off', RESEND_API_KEY: 're_abcdefgh' }).mail).toEqual({ provider: 'off' });
    // MAIL_FROM alone does not set anything up.
    expect(load({ MAIL_FROM: FROM }).mail).toEqual({ provider: 'off' });
  });

  it('infer Resend from RESEND_API_KEY and SMTP from SMTP_HOST', () => {
    expect(load({ RESEND_API_KEY: 're_abcdefgh', MAIL_FROM: FROM }).mail).toEqual({
      provider: 'resend',
      from: FROM,
      resendApiKey: 're_abcdefgh',
    });
    expect(load({ SMTP_HOST: 'smtp.hale.example', MAIL_FROM: FROM }).mail).toEqual({
      provider: 'smtp',
      from: FROM,
      smtp: { host: 'smtp.hale.example', port: 587, security: 'starttls', user: undefined, password: undefined },
    });
  });

  it('take the port from SMTP_SECURE (587 for STARTTLS, 465 for TLS) unless SMTP_PORT is set', () => {
    const tls = load({ SMTP_HOST: 'smtp.hale.example', SMTP_SECURE: 'tls', MAIL_FROM: FROM }).mail;
    expect(tls).toMatchObject({ smtp: { port: 465, security: 'tls' } });
    const custom = load({ SMTP_HOST: 'smtp.hale.example', SMTP_PORT: '2525', MAIL_FROM: FROM }).mail;
    expect(custom).toMatchObject({ smtp: { port: 2525, security: 'starttls' } });
  });

  it('read the key and the password from _FILE (Docker secrets)', () => {
    const files = { '/run/secrets/resend': 're_fromfile1\n', '/run/secrets/smtp': 'smtp-pass\n' };
    expect(load({ RESEND_API_KEY_FILE: '/run/secrets/resend', MAIL_FROM: FROM }, files).mail).toMatchObject({
      provider: 'resend',
      resendApiKey: 're_fromfile1',
    });
    const smtp = load(
      { SMTP_HOST: 'smtp.hale.example', SMTP_USER: 'tree', SMTP_PASSWORD_FILE: '/run/secrets/smtp', MAIL_FROM: FROM },
      files,
    ).mail;
    expect(smtp).toMatchObject({ smtp: { user: 'tree', password: 'smtp-pass' } });
  });

  it('refuse both providers without a choice, and accept the choice', () => {
    refused({ RESEND_API_KEY: 're_abcdefgh', SMTP_HOST: 'smtp.hale.example', MAIL_FROM: FROM }, /choose one/);
    expect(
      load({ MAIL_PROVIDER: 'smtp', RESEND_API_KEY: 're_abcdefgh', SMTP_HOST: 'smtp.hale.example', MAIL_FROM: FROM })
        .mail.provider,
    ).toBe('smtp');
  });

  it('refuse a half-set configuration, saying what is missing', () => {
    refused({ RESEND_API_KEY: 're_abcdefgh' }, /MAIL_FROM is missing/);
    refused({ MAIL_PROVIDER: 'resend', MAIL_FROM: FROM }, /needs RESEND_API_KEY/);
    refused({ MAIL_PROVIDER: 'smtp', MAIL_FROM: FROM }, /needs SMTP_HOST/);
    refused({ SMTP_HOST: 'smtp.hale.example', SMTP_USER: 'tree', MAIL_FROM: FROM }, /SMTP_PASSWORD .*is missing/);
    refused({ SMTP_HOST: 'smtp.hale.example', SMTP_PASSWORD: 'pw-only', MAIL_FROM: FROM }, /SMTP_USER is missing/);
    refused({ MAIL_PROVIDER: 'sendgrid' }, /MAIL_PROVIDER must be/);
    refused({ SMTP_HOST: 'smtp.hale.example', SMTP_SECURE: 'ssl', MAIL_FROM: FROM }, /SMTP_SECURE must be/);
    refused({ SMTP_HOST: 'smtp://smtp.hale.example', MAIL_FROM: FROM }, /host name or address only/);
    refused({ SMTP_HOST: 'smtp.hale.example', SMTP_PORT: '0', MAIL_FROM: FROM }, /SMTP_PORT/);
    refused({ RESEND_API_KEY: 're_abcdefgh', RESEND_API_KEY_FILE: '/x', MAIL_FROM: FROM }, /not both/);
    refused({ RESEND_API_KEY: 'change-me', MAIL_FROM: FROM }, /placeholder/);
  });

  it('refuse a password without encryption, and allow no encryption without credentials (a local relay)', () => {
    refused(
      { SMTP_HOST: 'relay', SMTP_SECURE: 'none', SMTP_USER: 'tree', SMTP_PASSWORD: 'pw', MAIL_FROM: FROM },
      /in clear/,
    );
    expect(load({ SMTP_HOST: 'relay', SMTP_SECURE: 'none', MAIL_FROM: FROM }).mail).toMatchObject({
      smtp: { host: 'relay', port: 587, security: 'none' },
    });
  });

  it('refuse a MAIL_FROM that is not one address on one line', () => {
    for (const from of [
      'not an address',
      'tree@hale.example\r\nBcc: someone@else.example',
      'a@hale.example, b@hale.example',
      'Hale <tree@hale.example',
      '<tree@hale.example>',
      'Hale "Family" <tree@hale.example>',
    ]) {
      refused({ RESEND_API_KEY: 're_abcdefgh', MAIL_FROM: from }, /MAIL_FROM must be/);
    }
  });

  it('remove the key and the password from the environment once read', () => {
    const env: Record<string, string | undefined> = {
      RESEND_API_KEY: 're_abcdefgh',
      SMTP_PASSWORD: 'pw',
      SMTP_PASSWORD_FILE: '/run/secrets/smtp',
      SMTP_USER: 'tree',
    };
    scrubSecretsFromEnv(env);
    expect(env).toEqual({ SMTP_USER: 'tree' });
  });
});

describe('addresses', () => {
  it('parse a From address with or without a name', () => {
    expect(parseMailFrom('tree@hale.example')).toEqual({ name: null, address: 'tree@hale.example' });
    expect(parseMailFrom('Hale Family Tree <tree@hale.example>')).toEqual({
      name: 'Hale Family Tree',
      address: 'tree@hale.example',
    });
    expect(parseMailFrom('"Hale, Family" <tree@hale.example>')).toEqual({
      name: 'Hale, Family',
      address: 'tree@hale.example',
    });
  });

  it('accept one plain address and nothing else', () => {
    expect(isMailAddress('sofia.hale+tree@hale.example')).toBe(true);
    for (const bad of [
      'sofia',
      'sofia@localhost',
      'a b@hale.example',
      'a@hale.example,b@hale.example',
      '<a@hale.example>',
      'a@hale.example\n',
    ]) {
      expect(isMailAddress(bad), bad).toBe(false);
    }
  });
});
