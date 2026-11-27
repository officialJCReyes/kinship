// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Admin -> Storage & email: GET /api/admin/mail and POST /api/admin/mail/test (ADR 0041). SuperAdmin only; nothing secret in
// any answer or log line; the test goes only to the signed-in SuperAdmin's own address; 5 tests per account in 15 minutes and
// 20 an hour for the install.
import { PassThrough } from 'node:stream';
import { MAIL_ROUTES } from '@kinship/shared';
import type { MailStatus } from '@kinship/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MailConfig } from '../src/config.js';
import { createMailService } from '../src/mail/outbox.js';
import type { MailService } from '../src/mail/outbox.js';
import { publicUrlWarning } from '../src/routes/mail-admin.js';
import { cookieHeader, createTestApp, CSRF, login } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';
import { ACCOUNTS, buildFamily, signInAll } from './helpers/family.js';
import type { Family, Who } from './helpers/family.js';
import { memoryTransport, temporary } from './helpers/fake-mail.js';
import type { MemoryTransport } from './helpers/fake-mail.js';

const KEY = 're_secret_resend_key_42';
const PASSWORD = 'smtp-secret-pa55';
const SMTP: MailConfig = {
  provider: 'smtp',
  from: 'Hale Family Tree <tree@hale.example>',
  smtp: { host: 'smtp.hale.example', port: 587, security: 'starttls', user: 'tree@hale.example', password: PASSWORD },
};

interface Setup {
  t: TestApp;
  as: Awaited<ReturnType<typeof signInAll>>;
  family: Family;
  transport: MemoryTransport;
  mail: MailService;
  logText: () => string;
}

async function setup(config: MailConfig, now?: () => number): Promise<Setup> {
  const transport = memoryTransport();
  const holder: { t?: TestApp } = {};
  const mail = createMailService({
    config,
    ownerDb: () => holder.t!.owner,
    transport,
    log: () => undefined,
  });
  const stream = new PassThrough();
  let logged = '';
  stream.on('data', (chunk: Buffer) => (logged += chunk.toString('utf8')));
  const t = await createTestApp({
    mail,
    publicUrl: 'https://tree.hale.example',
    logLevel: 'info',
    logStream: stream,
    ...(now ? { now } : {}),
  });
  holder.t = t;
  const family = await buildFamily(t.owner);
  const as = await signInAll(t.app, family);
  return { t, as, family, transport, mail, logText: () => logged };
}

describe('when mail is not set up', () => {
  let s: Setup;
  beforeAll(async () => {
    s = await setup({ provider: 'off' });
  }, 90_000);
  afterAll(() => s.t.close());

  it('says so, and "Send test to me" answers 409 mail_not_configured', async () => {
    const status = await s.as('superadmin', 'GET', '/api/admin/mail');
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({
      provider: 'off',
      from: null,
      smtp: null,
      resend: null,
      publicUrl: 'https://tree.hale.example',
      publicUrlWarning: null,
      queued: 0,
      failedLastWeek: 0,
      lastFailure: null,
      lastTest: null,
      testRecipient: s.family.account.superadmin.email,
    });
    expect(await s.as('superadmin', 'POST', '/api/admin/mail/test')).toEqual({
      status: 409,
      body: { error: 'mail_not_configured' },
    });
  });

  it('every route is for the SuperAdmin only', async () => {
    for (const route of MAIL_ROUTES) {
      for (const who of ['anonymous', ...ACCOUNTS] as Who[]) {
        if (who === 'superadmin') continue;
        const response = await s.as(who, route.method, route.path);
        expect(response.status, `${who} ${route.method} ${route.path}`).toBe(who === 'anonymous' ? 401 : 403);
      }
    }
  });
});

describe('with SMTP set up', () => {
  let s: Setup;
  beforeAll(async () => {
    s = await setup(SMTP);
  }, 90_000);
  afterAll(() => s.t.close());
  beforeEach(async () => {
    await sql`delete from mail_outbox`.execute(s.t.owner);
  });

  it('shows how mail goes, never the password', async () => {
    const response = await s.as('superadmin', 'GET', '/api/admin/mail');
    const body = response.body as MailStatus;
    expect(body).toMatchObject({
      provider: 'smtp',
      from: 'Hale Family Tree <tree@hale.example>',
      smtp: {
        host: 'smtp.hale.example',
        port: 587,
        security: 'starttls',
        user: 'tree@hale.example',
        passwordSet: true,
      },
      resend: null,
    });
    expect(JSON.stringify(body)).not.toContain(PASSWORD);
  });

  it('sends the test to the signed-in SuperAdmin’s own address, right away', async () => {
    const response = await s.as('superadmin', 'POST', '/api/admin/mail/test');
    expect(response.status).toBe(202);
    const id = (response.body as { id: string }).id;
    await s.mail.idle();
    expect(s.transport.sent).toHaveLength(1);
    expect(s.transport.sent[0]).toMatchObject({
      id,
      to: s.family.account.superadmin.email,
      subject: 'KinShip test email',
    });
    expect(s.transport.sent[0]?.text).toContain('https://tree.hale.example');
    const status = (await s.as('superadmin', 'GET', '/api/admin/mail')).body as MailStatus;
    expect(status.lastTest).toMatchObject({ id, status: 'sent', error: null, hint: null });
    expect(status.lastTest?.sentAt).not.toBeNull();
    s.transport.sent.length = 0;
  });

  it('refuses any recipient (or anything else) in the request, and sends nothing', async () => {
    for (const payload of [
      { to: 'stranger@elsewhere.example' },
      { email: 'stranger@elsewhere.example' },
      { recipient: 'stranger@elsewhere.example' },
      ['stranger@elsewhere.example'],
    ]) {
      const response = await s.as('superadmin', 'POST', '/api/admin/mail/test', payload);
      expect(response).toEqual({ status: 400, body: { error: 'invalid_request' } });
    }
    const viaQuery = await s.t.app.inject({
      method: 'POST',
      url: '/api/admin/mail/test?to=stranger@elsewhere.example',
      headers: { ...CSRF, cookie: cookieHeader(await login(s.t.app, s.family.account.superadmin.email)) },
    });
    expect(viaQuery.statusCode).toBe(202);
    await s.mail.idle();
    expect(s.transport.sent.map((m) => m.to)).toEqual([s.family.account.superadmin.email]);
    s.transport.sent.length = 0;
  });

  it('shows the last failure, cleaned, with a hint, and never logs the password', async () => {
    s.transport.failNext(temporary(`SMTP EAUTH 535: Invalid login for tree@hale.example with ${PASSWORD}`));
    await s.as('superadmin', 'POST', '/api/admin/mail/test');
    await s.mail.idle();
    const status = (await s.as('superadmin', 'GET', '/api/admin/mail')).body as MailStatus;
    expect(status.queued).toBe(1);
    expect(status.lastFailure).toMatchObject({
      template: 'test',
      error: 'SMTP EAUTH 535: Invalid login for …@hale.example with [redacted]',
      final: false,
      hint: 'smtp_auth',
    });
    expect(status.lastTest).toMatchObject({ status: 'queued', hint: 'smtp_auth' });
    expect(JSON.stringify(status)).not.toContain(PASSWORD);
    expect(s.logText()).not.toContain(PASSWORD);
    expect(s.logText()).not.toContain(KEY);
  });
});

describe('limits on "Send test to me"', () => {
  it('allows 5 per account in 15 minutes and 20 an hour for the install', async () => {
    let clock = Date.parse('2026-11-28T12:00:00Z');
    const s = await setup({ provider: 'resend', from: 'tree@hale.example', resendApiKey: KEY }, () => clock);
    try {
      for (let i = 0; i < 5; i++) expect((await s.as('superadmin', 'POST', '/api/admin/mail/test')).status).toBe(202);
      const blocked = await s.as('superadmin', 'POST', '/api/admin/mail/test');
      expect(blocked.status).toBe(429);
      expect(blocked.body).toMatchObject({ error: 'rate_limited' });
      expect((blocked.body as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(14 * 60);
      // After 15 minutes the account may test again, until the install-wide 20 an hour.
      for (let round = 1; round <= 3; round++) {
        clock += 15 * 60_000 + 1000;
        const expected = round < 3 ? 5 : 20 - 15;
        for (let i = 0; i < expected; i++) {
          expect((await s.as('superadmin', 'POST', '/api/admin/mail/test')).status, `round ${round}`).toBe(202);
        }
      }
      expect((await s.as('superadmin', 'POST', '/api/admin/mail/test')).status).toBe(429);
      await s.mail.idle();
      expect(JSON.stringify(s.logText())).not.toContain(KEY);
    } finally {
      await s.t.close();
    }
  }, 90_000);
});

describe('publicUrlWarning', () => {
  it('warns about the default address and about http on a real host, only when mail is set up', () => {
    expect(publicUrlWarning('http://localhost:8080', true)).toBe('default');
    expect(publicUrlWarning('http://tree.hale.example', true)).toBe('http');
    expect(publicUrlWarning('http://localhost:5173', true)).toBeNull();
    expect(publicUrlWarning('https://tree.hale.example', true)).toBeNull();
    expect(publicUrlWarning('http://tree.hale.example', false)).toBeNull();
  });
});
