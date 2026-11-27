// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Admin -> Emails (ADR 0041, 53b): the template routes. SuperAdmin only; a draft is checked and only what differs from the
// default is stored; "Reset to default" removes a field or the whole template; a preview never saves, queues or creates
// anything; a test goes to the signed-in SuperAdmin only, through the same limits as "Send test to me"; and the saved text
// is what an email queued later (step 54) is rendered with, whoever's request queues it.
import { MAIL_RESERVED_TEMPLATE_IDS } from '@kinship/shared';
import type { MailPreview, MailTemplateDetail, MailTemplateSummary } from '@kinship/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MailConfig } from '../src/config.js';
import { enqueueTemplate } from '../src/mail/enqueue.js';
import { createMailService } from '../src/mail/outbox.js';
import type { MailService } from '../src/mail/outbox.js';
import { TEMPLATES } from '../src/mail/templates/index.js';
import { createTestApp } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';
import { ACCOUNTS, buildFamily, signInAll } from './helpers/family.js';
import type { Family, Who } from './helpers/family.js';
import { memoryTransport } from './helpers/fake-mail.js';
import type { MemoryTransport } from './helpers/fake-mail.js';

const PUBLIC_URL = 'https://tree.hale.example';
const SMTP: MailConfig = {
  provider: 'smtp',
  from: 'Hale Family Tree <tree@hale.example>',
  smtp: {
    host: 'smtp.hale.example',
    port: 587,
    security: 'starttls',
    user: 'tree@hale.example',
    password: 'pa55-word',
  },
};
const BASE = '/api/admin/mail/templates';

interface Setup {
  t: TestApp;
  as: Awaited<ReturnType<typeof signInAll>>;
  family: Family;
  transport: MemoryTransport;
  mail: MailService;
}

async function setup(config: MailConfig, now?: () => number): Promise<Setup> {
  const transport = memoryTransport();
  const holder: { t?: TestApp } = {};
  const mail = createMailService({ config, ownerDb: () => holder.t!.owner, transport, log: () => undefined });
  const t = await createTestApp({ mail, publicUrl: PUBLIC_URL, ...(now ? { now } : {}) }, (app) => {
    // What step 54 will do: queue an invitation inside the request's own transaction, as whoever is signed in.
    app.post('/test/queue-invitation', async (request) =>
      request.withTransaction(async (trx) => ({
        id: await enqueueTemplate(trx, mail, PUBLIC_URL, {
          template: 'invitation',
          to: 'sofia@hale.example',
          toUserId: null,
          params: { ...TEMPLATES.invitation.sample(PUBLIC_URL), link: `${PUBLIC_URL}/invite/abc` },
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
        }),
      })),
    );
  });
  holder.t = t;
  const family = await buildFamily(t.owner);
  const as = await signInAll(t.app, family);
  return { t, as, family, transport, mail };
}

async function count(t: TestApp, table: 'mail_outbox' | 'mail_template_overrides' | 'account_links'): Promise<number> {
  const result = await sql<{ n: string }>`select count(*)::text as n from ${sql.table(table)}`.execute(t.owner);
  return Number(result.rows[0]?.n ?? 0);
}

const allDefaults = (detail: MailTemplateDetail) => Object.fromEntries(detail.fields.map((f) => [f.key, f.default]));

describe('the template routes', () => {
  let s: Setup;
  beforeAll(async () => {
    s = await setup(SMTP);
  }, 90_000);
  afterAll(() => s.t.close());
  beforeEach(async () => {
    await sql`delete from mail_template_overrides`.execute(s.t.owner);
    await sql`delete from mail_outbox`.execute(s.t.owner);
    s.transport.sent.length = 0;
  });

  it('are for the SuperAdmin only: 403 for everyone else, 401 when signed out', async () => {
    const calls: ['GET' | 'PUT' | 'DELETE' | 'POST', string, unknown?][] = [
      ['GET', BASE],
      ['GET', `${BASE}/invitation`],
      ['PUT', `${BASE}/invitation`, { fields: { subject: 'Hello' } }],
      ['DELETE', `${BASE}/invitation`],
      ['POST', `${BASE}/invitation/preview`, { fields: {} }],
      ['POST', `${BASE}/invitation/test`],
    ];
    for (const who of ['anonymous', ...ACCOUNTS] as Who[]) {
      if (who === 'superadmin') continue;
      for (const [method, url, body] of calls) {
        const response = await s.as(who, method, url, body);
        expect(response.status, `${who} ${method} ${url}`).toBe(who === 'anonymous' ? 401 : 403);
      }
    }
    expect(await count(s.t, 'mail_template_overrides')).toBe(0);
    expect(await count(s.t, 'mail_outbox')).toBe(0);
  });

  it('are never cached', async () => {
    const response = await s.t.app.inject({ method: 'GET', url: BASE });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('list the templates that ship and the reserved ("Next") ones', async () => {
    const list = (await s.as('superadmin', 'GET', BASE)).body as MailTemplateSummary[];
    expect(list).toEqual([
      { id: 'invitation', editable: true, reserved: false, overridden: false },
      { id: 'password_reset', editable: true, reserved: false, overridden: false },
      { id: 'password_changed', editable: true, reserved: false, overridden: false },
      { id: 'test', editable: false, reserved: false, overridden: false },
      ...MAIL_RESERVED_TEMPLATE_IDS.map((id) => ({ id, editable: false, reserved: true, overridden: false })),
    ]);
  });

  it('describe a template: its fields, defaults, limits and allowed placeholders', async () => {
    const detail = (await s.as('superadmin', 'GET', `${BASE}/invitation`)).body as MailTemplateDetail;
    expect(detail.id).toBe('invitation');
    expect(detail.editable).toBe(true);
    expect(detail.overrides).toEqual({});
    expect(detail.fields.map((f) => f.key)).toEqual([
      'subject',
      'preview',
      'heading',
      'intro',
      'worth_knowing',
      'footer',
    ]);
    expect(detail.fields[0]).toEqual({
      key: 'subject',
      kind: 'subject',
      required: true,
      maxLength: 150,
      placeholders: ['inviter', 'tree'],
      default: '{inviter} invited you to the {tree} tree',
    });
    const fixed = (await s.as('superadmin', 'GET', `${BASE}/test`)).body as MailTemplateDetail;
    expect(fixed.editable).toBe(false);
  });

  it('answer 404 for a reserved template or an unknown id', async () => {
    for (const id of ['weekly_digest', 'birthday_today', 'nope', 'INVITATION']) {
      for (const [method, url] of [
        ['GET', `${BASE}/${id}`],
        ['PUT', `${BASE}/${id}`],
        ['DELETE', `${BASE}/${id}`],
        ['POST', `${BASE}/${id}/preview`],
        ['POST', `${BASE}/${id}/test`],
      ] as const) {
        const response = await s.as('superadmin', method, url, method === 'PUT' ? { fields: {} } : undefined);
        expect(response, `${method} ${url}`).toEqual({ status: 404, body: { error: 'mail_template_not_found' } });
      }
    }
  });

  it('save only the fields that differ from the default, and show them as overrides', async () => {
    const detail = (await s.as('superadmin', 'GET', `${BASE}/invitation`)).body as MailTemplateDetail;
    const draft = {
      ...allDefaults(detail),
      subject: 'Join {inviter} on the {tree} tree',
      intro: 'Hello!\r\n\r\nWelcome.',
    };
    const saved = await s.as('superadmin', 'PUT', `${BASE}/invitation`, { fields: draft });
    expect(saved.status).toBe(200);
    expect((saved.body as MailTemplateDetail).overrides).toEqual({
      subject: 'Join {inviter} on the {tree} tree',
      intro: 'Hello!\n\nWelcome.',
    });
    const row = await sql<{ subject: string; blocks: unknown; updated_by: string }>`
      select subject, blocks, updated_by from mail_template_overrides where template = 'invitation'`.execute(s.t.owner);
    expect(row.rows[0]).toEqual({
      subject: 'Join {inviter} on the {tree} tree',
      blocks: { intro: 'Hello!\n\nWelcome.' },
      updated_by: s.family.account.superadmin.id,
    });
    const list = (await s.as('superadmin', 'GET', BASE)).body as MailTemplateSummary[];
    expect(list.find((t) => t.id === 'invitation')?.overridden).toBe(true);
    // Saving the defaults again removes the row: nothing is overridden.
    await s.as('superadmin', 'PUT', `${BASE}/invitation`, { fields: allDefaults(detail) });
    expect(await count(s.t, 'mail_template_overrides')).toBe(0);
  });

  it('refuse a draft with every reason listed, and save nothing', async () => {
    const response = await s.as('superadmin', 'PUT', `${BASE}/invitation`, {
      fields: {
        subject: `Hello {person}\n${'x'.repeat(150)}`,
        heading: '',
        intro: `Hello { there ${'y'.repeat(1000)}`,
        preview: 'Fine',
        surprise: 'x',
      },
    });
    expect(response).toEqual({
      status: 400,
      body: {
        error: 'invalid_template',
        problems: [
          { field: 'subject', problem: 'too_long', max: 150 },
          { field: 'subject', problem: 'line_break' },
          { field: 'subject', problem: 'unknown_placeholder', placeholder: 'person' },
          { field: 'heading', problem: 'empty' },
          { field: 'intro', problem: 'too_long', max: 1000 },
          { field: 'intro', problem: 'stray_brace' },
          { field: 'surprise', problem: 'unknown_field' },
        ],
      },
    });
    expect(await count(s.t, 'mail_template_overrides')).toBe(0);
    for (const body of [{}, { fields: {}, extra: 1 }, [], 'text']) {
      expect((await s.as('superadmin', 'PUT', `${BASE}/invitation`, body)).body, JSON.stringify(body)).toEqual({
        error: 'invalid_request',
      });
    }
  });

  it('refuse to edit or reset the fixed test email', async () => {
    expect(await s.as('superadmin', 'PUT', `${BASE}/test`, { fields: { subject: 'Changed' } })).toEqual({
      status: 409,
      body: { error: 'mail_template_fixed' },
    });
    expect(await s.as('superadmin', 'DELETE', `${BASE}/test`)).toEqual({
      status: 409,
      body: { error: 'mail_template_fixed' },
    });
  });

  it('reset one field, or the whole template, to the default', async () => {
    await s.as('superadmin', 'PUT', `${BASE}/password_reset`, {
      fields: { subject: 'Your new password', intro: 'Hi {name}.', footer: 'Bye.' },
    });
    const one = await s.as('superadmin', 'DELETE', `${BASE}/password_reset?field=subject`);
    expect((one.body as MailTemplateDetail).overrides).toEqual({ intro: 'Hi {name}.', footer: 'Bye.' });
    const block = await s.as('superadmin', 'DELETE', `${BASE}/password_reset?field=intro`);
    expect((block.body as MailTemplateDetail).overrides).toEqual({ footer: 'Bye.' });
    expect((await s.as('superadmin', 'DELETE', `${BASE}/password_reset?field=nope`)).body).toEqual({
      error: 'invalid_request',
    });
    const all = await s.as('superadmin', 'DELETE', `${BASE}/password_reset`);
    expect((all.body as MailTemplateDetail).overrides).toEqual({});
    expect(await count(s.t, 'mail_template_overrides')).toBe(0);
    // The last field reset removes the row too.
    await s.as('superadmin', 'PUT', `${BASE}/password_reset`, { fields: { footer: 'Bye.' } });
    await s.as('superadmin', 'DELETE', `${BASE}/password_reset?field=footer`);
    expect(await count(s.t, 'mail_template_overrides')).toBe(0);
  });

  it('preview a draft with the Hale sample and a link that goes nowhere, creating nothing', async () => {
    await s.as('superadmin', 'PUT', `${BASE}/invitation`, { fields: { subject: 'Saved subject' } });
    const before = await Promise.all([count(s.t, 'mail_outbox'), count(s.t, 'account_links')]);
    const draft = await s.as('superadmin', 'POST', `${BASE}/invitation/preview`, {
      fields: { subject: 'Draft for {inviter}', intro: 'Draft <b>intro</b>' },
    });
    expect(draft.status).toBe(200);
    const preview = draft.body as MailPreview;
    expect(preview.subject).toBe('Draft for Marcus Hale');
    expect(preview.html).toContain('Draft &lt;b&gt;intro&lt;/b&gt;');
    expect(preview.text).toContain(`Accept invitation: ${PUBLIC_URL}/invite/SAMPLE-not-a-real-link`);
    // The draft was not saved, and nothing was queued or created.
    const saved = (await s.as('superadmin', 'GET', `${BASE}/invitation`)).body as MailTemplateDetail;
    expect(saved.overrides).toEqual({ subject: 'Saved subject' });
    expect(await Promise.all([count(s.t, 'mail_outbox'), count(s.t, 'account_links')])).toEqual(before);
    expect(s.transport.sent).toHaveLength(0);
    // With no body, the saved text.
    const current = (await s.as('superadmin', 'POST', `${BASE}/invitation/preview`)).body as MailPreview;
    expect(current.subject).toBe('Saved subject');
    // A draft that breaks a rule gets the same 400 as a save.
    expect((await s.as('superadmin', 'POST', `${BASE}/invitation/preview`, { fields: { subject: '{' } })).body).toEqual(
      {
        error: 'invalid_template',
        problems: [{ field: 'subject', problem: 'stray_brace' }],
      },
    );
  });

  it('send a test of the saved text to the signed-in SuperAdmin only, never to an address in the request', async () => {
    await s.as('superadmin', 'PUT', `${BASE}/password_reset`, { fields: { heading: 'Saved heading' } });
    const response = await s.as('superadmin', 'POST', `${BASE}/password_reset/test`);
    expect(response.status).toBe(202);
    await s.mail.idle();
    expect(s.transport.sent).toHaveLength(1);
    expect(s.transport.sent[0]).toMatchObject({
      id: (response.body as { id: string }).id,
      to: s.family.account.superadmin.email,
      subject: 'Test: Reset your KinShip password',
    });
    expect(s.transport.sent[0]?.text).toContain('SAVED HEADING');
    expect(s.transport.sent[0]?.text).toContain('/reset/SAMPLE-not-a-real-link');
    const outbox = await sql<{ template: string }>`select template from mail_outbox`.execute(s.t.owner);
    expect(outbox.rows).toEqual([{ template: 'test' }]);
    for (const body of [{ to: 'stranger@elsewhere.example' }, { recipient: 'stranger@elsewhere.example' }]) {
      expect(await s.as('superadmin', 'POST', `${BASE}/invitation/test`, body)).toEqual({
        status: 400,
        body: { error: 'invalid_request' },
      });
    }
    await s.mail.idle();
    expect(s.transport.sent.map((m) => m.to)).toEqual([s.family.account.superadmin.email]);
    const fixed = await s.as('superadmin', 'POST', `${BASE}/test/test`);
    expect(fixed.status).toBe(202);
    await s.mail.idle();
    expect(s.transport.sent[1]?.subject).toBe('KinShip test email');
  });

  it('render an email queued later with the saved text, whoever queues it (a Member here)', async () => {
    await s.as('superadmin', 'PUT', `${BASE}/invitation`, {
      fields: { subject: 'Come and see the {tree} tree', intro: 'Saved intro from {inviter}.' },
    });
    const queued = await s.as('member', 'POST', '/test/queue-invitation');
    expect(queued.status).toBe(200);
    // Step 54 kicks after its commit; here the sender is run directly.
    await s.mail.drain();
    const sent = s.transport.sent.find((m) => m.to === 'sofia@hale.example');
    expect(sent?.subject).toBe('Come and see the Hale Family tree');
    expect(sent?.text).toContain('Saved intro from Marcus Hale.');
    expect(sent?.text).toContain(`Accept invitation: ${PUBLIC_URL}/invite/abc`);
    expect(sent?.html).toContain(`${PUBLIC_URL}/email/logo.png`);
  });
});

describe('when mail is not set up', () => {
  let s: Setup;
  beforeAll(async () => {
    s = await setup({ provider: 'off' });
  }, 90_000);
  afterAll(() => s.t.close());

  it('templates can still be edited and previewed, and a test answers 409 mail_not_configured', async () => {
    expect((await s.as('superadmin', 'PUT', `${BASE}/invitation`, { fields: { subject: 'Hi' } })).status).toBe(200);
    expect((await s.as('superadmin', 'POST', `${BASE}/invitation/preview`)).status).toBe(200);
    expect(await s.as('superadmin', 'POST', `${BASE}/invitation/test`)).toEqual({
      status: 409,
      body: { error: 'mail_not_configured' },
    });
  });
});

describe('limits on a template test', () => {
  it('share the "Send test to me" limits: 5 per account in 15 minutes, 20 an hour for the install', async () => {
    let clock = Date.parse('2026-11-28T12:00:00Z');
    const s = await setup(SMTP, () => clock);
    try {
      // Tests from either route count together.
      for (let i = 0; i < 3; i++) expect((await s.as('superadmin', 'POST', '/api/admin/mail/test')).status).toBe(202);
      for (let i = 0; i < 2; i++)
        expect((await s.as('superadmin', 'POST', `${BASE}/invitation/test`)).status).toBe(202);
      const blocked = await s.as('superadmin', 'POST', `${BASE}/password_reset/test`);
      expect(blocked.status).toBe(429);
      expect(blocked.body).toMatchObject({ error: 'rate_limited' });
      expect((blocked.body as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(14 * 60);
      clock += 15 * 60_000 + 1000;
      expect((await s.as('superadmin', 'POST', `${BASE}/password_reset/test`)).status).toBe(202);
      await s.mail.idle();
    } finally {
      await s.t.close();
    }
  }, 90_000);
});
