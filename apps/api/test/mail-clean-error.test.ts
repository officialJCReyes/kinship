// SPDX-License-Identifier: AGPL-3.0-or-later
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { cleanError, hintFor, MAX_ERROR, secretForms } from '../src/mail/clean-error.js';

describe('cleanError', () => {
  const secrets = secretForms({ key: 're_live_key_ABCDEF123', user: 'tree@hale.example', password: 'smtp-pa55word' });

  it('removes the key, the password and their base64 and AUTH forms', () => {
    const plain = Buffer.from('\u0000tree@hale.example\u0000smtp-pa55word').toString('base64');
    const raw = [
      'key re_live_key_ABCDEF123 refused',
      `password smtp-pa55word`,
      `b64 ${Buffer.from('smtp-pa55word').toString('base64')}`,
      `AUTH PLAIN ${plain}`,
      'Authorization: Bearer abc.def',
      'token re_otherkey_9999999',
    ].join('\n');
    const cleaned = cleanError(raw, secrets);
    for (const leak of ['re_live_key_ABCDEF123', 'smtp-pa55word', plain, 'abc.def', 're_otherkey_9999999']) {
      expect(cleaned).not.toContain(leak);
    }
    expect(cleaned).toContain('[redacted]');
  });

  it('masks every email address but keeps its domain', () => {
    expect(cleanError('550 5.1.1 <daniel.hale@hale.example>: Recipient address rejected', [])).toBe(
      '550 5.1.1 <…@hale.example>: Recipient address rejected',
    );
  });

  it('puts the text on one line and cuts it at 300 characters', () => {
    const cleaned = cleanError(`first\r\nsecond\u0007${'x'.repeat(400)}`, []);
    // eslint-disable-next-line no-control-regex
    expect(cleaned).not.toMatch(/[\r\n\u0007]/);
    expect(cleaned.length).toBe(MAX_ERROR);
    expect(cleaned.endsWith('…')).toBe(true);
  });

  it('says something when the provider said nothing', () => {
    expect(cleanError('  \n ', [])).toBe('The provider gave no reason.');
  });
});

describe('hintFor', () => {
  it.each([
    ['Resend answered 403: validation_error: The hale.example domain is not verified.', 'resend_domain'],
    ['Resend answered 401: validation_error: API key is invalid', 'resend_key'],
    ['Resend answered 403: restricted_api_key: This key can only send', 'resend_key'],
    ['Could not reach Resend: timed out', 'resend_connection'],
    ['SMTP EAUTH 535: Invalid login: 535 5.7.8 Authentication credentials invalid', 'smtp_auth'],
    ['SMTP ESOCKET: self-signed certificate', 'smtp_certificate'],
    ["SMTP ESOCKET: Hostname/IP does not match certificate's altnames", 'smtp_certificate'],
    ['SMTP ETLS 502: Error upgrading connection with STARTTLS', 'smtp_tls'],
    ['SMTP ECONNECTION: connect ECONNREFUSED 127.0.0.1:587', 'smtp_connection'],
    ['SMTP ETIMEDOUT: Connection timeout', 'smtp_connection'],
    ['SMTP EENVELOPE 550: Mailbox unavailable', null],
    ['Resend answered 500: internal_server_error', null],
  ])('%s -> %s', (error, hint) => {
    expect(hintFor(error)).toBe(hint);
  });

  it('gives nothing for nothing', () => {
    expect(hintFor(null)).toBeNull();
    expect(hintFor('')).toBeNull();
  });
});
