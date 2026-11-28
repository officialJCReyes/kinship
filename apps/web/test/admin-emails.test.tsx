// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Admin > Emails (ADR 0041, 53b): who sees it, the list (with the reserved "Next" templates that cannot be opened), the
// editor (placeholders, the live errors from the preview answer, Save, Reset to default with its confirm, Send test to me),
// the preview in a sandboxed frame or as plain text at desktop or phone width, and the client's routes. Fictional Hale data.
import type { MailStatus, MailTemplateDetail, MailTemplateSummary } from '@kinship/shared';
import { MAIL_ROUTES } from '@kinship/shared';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '../src/api.js';
import { ALICE, ME, calls, mockApi, renderApp, signedIn } from './helpers.js';
import type { MockRoute } from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const FAMILY_ADMIN = { ...ME, user: { ...ALICE, id: 'u2', role: 'familyadmin' } };
const MEMBER = { ...ME, user: { ...ALICE, id: 'u3', role: 'member' } };

const LIST: MailTemplateSummary[] = [
  { id: 'invitation', editable: true, reserved: false, overridden: true },
  { id: 'password_reset', editable: true, reserved: false, overridden: false },
  { id: 'password_changed', editable: true, reserved: false, overridden: false },
  { id: 'test', editable: false, reserved: false, overridden: false },
  { id: 'birthday_today', editable: false, reserved: true, overridden: false },
  { id: 'birthday_tomorrow', editable: false, reserved: true, overridden: false },
  { id: 'birthday_week', editable: false, reserved: true, overridden: false },
  { id: 'weekly_digest', editable: false, reserved: true, overridden: false },
  { id: 'medical_edit', editable: false, reserved: true, overridden: false },
];

const INVITATION: MailTemplateDetail = {
  id: 'invitation',
  editable: true,
  fields: [
    {
      key: 'subject',
      kind: 'subject',
      required: true,
      maxLength: 150,
      placeholders: ['inviter', 'tree'],
      default: '{inviter} invited you to the {tree} tree',
    },
    {
      key: 'preview',
      kind: 'preview',
      required: false,
      maxLength: 150,
      placeholders: ['inviter', 'tree', 'role', 'expires'],
      default: 'Accept your invitation. The link works for {expires}.',
    },
    {
      key: 'intro',
      kind: 'text',
      required: false,
      maxLength: 1000,
      placeholders: ['inviter', 'tree'],
      default: '{inviter} has invited you to join the {tree} tree on KinShip.',
    },
    {
      key: 'worth_knowing',
      kind: 'list',
      required: false,
      maxLength: 1000,
      placeholders: [],
      default: 'You choose which reminders you get in My settings.',
    },
  ],
  overrides: {},
};

const TEST_TEMPLATE: MailTemplateDetail = {
  id: 'test',
  editable: false,
  fields: [
    { key: 'subject', kind: 'subject', required: true, maxLength: 150, placeholders: [], default: 'KinShip test' },
  ],
  overrides: {},
};

const PREVIEW = {
  subject: 'Marcus Hale invited you to the Hale Family tree',
  html: '<!doctype html><html><body><table><tr><td>Hello Sofia</td></tr></table></body></html>',
  text: 'YOU’RE INVITED TO THE HALE FAMILY TREE\n\nMarcus Hale has invited you.',
};

const mailStatus = (provider: 'off' | 'smtp'): MailStatus => ({
  provider,
  from: provider === 'off' ? null : 'tree@hale.example',
  smtp:
    provider === 'off'
      ? null
      : { host: 'smtp.hale.example', port: 587, security: 'starttls', user: null, passwordSet: true },
  resend: null,
  publicUrl: 'https://hale.example',
  publicUrlWarning: null,
  queued: 0,
  failedLastWeek: 0,
  lastFailure: null,
  lastTest: null,
  testRecipient: 'marcus@example.com',
});

const T = '/api/admin/mail/templates';

function open(path = '/admin/emails/invitation', routes: Record<string, MockRoute> = {}, me: unknown = ME) {
  const fetchMock = mockApi({
    ...signedIn,
    '/api/auth/me': { status: 200, body: me },
    // The update banner on every Admin page: quiet when it fails.
    '/api/admin/updates': { status: 503, body: { error: 'unavailable' } },
    'GET /api/admin/mail': { status: 200, body: mailStatus('smtp') },
    [`GET ${T}`]: { status: 200, body: LIST },
    [`GET ${T}/invitation`]: { status: 200, body: INVITATION },
    [`GET ${T}/test`]: { status: 200, body: TEST_TEMPLATE },
    [`POST ${T}/invitation/preview`]: { status: 200, body: PREVIEW },
    [`POST ${T}/test/preview`]: { status: 200, body: PREVIEW },
    ...routes,
  });
  renderApp(path);
  return fetchMock;
}

const editor = () => screen.findByRole('region', { name: 'Invitation' });
const box = (name: string) => screen.getByRole('textbox', { name }) as HTMLTextAreaElement;
const bodyOf = (fetchMock: ReturnType<typeof mockApi>, call: string) => {
  const index = calls(fetchMock).lastIndexOf(call);
  const init = fetchMock.mock.calls[index]?.[1];
  return init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as unknown);
};
const frame = () => screen.findByTitle('Email preview');

describe('Admin > Emails: the page and who sees it', () => {
  it('is a SuperAdmin tab right after Storage & email, and opens on the invitation', async () => {
    open('/admin/emails');
    expect(await screen.findByRole('heading', { name: 'Emails', level: 1 })).toBeTruthy();
    const tabs = screen.getByRole('navigation', { name: 'Admin sections' });
    expect(
      within(tabs)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Users', 'Storage & email', 'Emails', 'Backups', 'Updates']);
    expect(await editor()).toBeTruthy();
  });

  it.each([
    ['a Family Admin', FAMILY_ADMIN],
    ['a Member', MEMBER],
  ])('%s gets the not-found page and no tab, and the page asks the api for nothing', async (_who, me) => {
    const fetchMock = open('/admin/emails/invitation', {}, me);
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
    expect(calls(fetchMock).filter((c) => c.includes('/api/admin/mail'))).toEqual([]);
    expect(screen.queryByRole('link', { name: 'Emails' })).toBeNull();
  });

  it.each(['birthday_today', 'weekly_digest', 'not_a_template'])('%s cannot be opened', async (id) => {
    const fetchMock = open(`/admin/emails/${id}`);
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
    expect(calls(fetchMock).filter((c) => c.includes(`/templates/${id}`))).toEqual([]);
  });

  it('shows the error state when the list cannot be read, and tries again', async () => {
    let fail = true;
    open('/admin/emails/invitation', {
      [`GET ${T}`]: () => (fail ? { status: 500, body: { error: 'internal' } } : { status: 200, body: LIST }),
    });
    const retry = await screen.findByRole('button', { name: 'Try again' });
    fail = false;
    fireEvent.click(retry);
    expect(await editor()).toBeTruthy();
  });
});

describe('Admin > Emails: the list', () => {
  it('names every template, marks the changed and the fixed ones, and lists the reserved ones as Next, not as links', async () => {
    open();
    const list = await screen.findByRole('region', { name: 'Email templates' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(9);
    expect(items.map((item) => item.querySelector('.email-list-name')?.textContent)).toEqual([
      'Invitation',
      'Password reset',
      'Password changed',
      'Test email',
      'Birthday, on the day',
      'Birthday, 1 day before',
      'Birthday, 1 week before',
      'Weekly digest',
      'An admin edited your medical record',
    ]);
    const links = within(list).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/admin/emails/invitation',
      '/admin/emails/password_reset',
      '/admin/emails/password_changed',
      '/admin/emails/test',
    ]);
    expect(links[0]?.getAttribute('aria-current')).toBe('page');
    expect(within(links[0]!).getByText('Changed')).toBeTruthy();
    expect(within(links[1]!).queryByText('Changed')).toBeNull();
    expect(within(links[3]!).getByText('Fixed text')).toBeTruthy();
    for (const item of items.slice(4)) {
      expect(within(item).queryByRole('link')).toBeNull();
      expect(within(item).getByText('Next')).toBeTruthy();
    }
  });

  it('the fixed test email has no fields to edit, only its preview and the test button', async () => {
    open('/admin/emails/test');
    const region = await screen.findByRole('region', { name: 'Test email' });
    expect(within(region).getByText(/The text of this email is fixed/)).toBeTruthy();
    expect(within(region).queryAllByRole('textbox')).toHaveLength(0);
    expect(within(region).queryByRole('button', { name: 'Save' })).toBeNull();
    expect(within(region).getByRole('button', { name: 'Send test to me' })).toBeTruthy();
    expect(await frame()).toBeTruthy();
  });
});

describe('Admin > Emails: the editor', () => {
  it('shows each field as a textarea with its text, its rules and its placeholders, and says it uses the defaults', async () => {
    open();
    await editor();
    expect(box('Subject').tagName).toBe('TEXTAREA');
    expect(box('Subject').value).toBe('{inviter} invited you to the {tree} tree');
    expect(box('Subject').required).toBe(true);
    expect(box('Opening').value).toBe('{inviter} has invited you to join the {tree} tree on KinShip.');
    expect(screen.getByText('One line, up to 150 characters.')).toBeTruthy();
    expect(screen.getByText('A blank line starts a new paragraph.')).toBeTruthy();
    expect(screen.getByText(/Added after KinShip’s two privacy lines/)).toBeTruthy();
    expect(screen.getByText('Curly braces are only for placeholders. Any other { or } is refused.')).toBeTruthy();
    const group = screen.getByRole('group', { name: 'Placeholders for Subject' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['{inviter}', '{tree}']);
    // A field with no placeholders shows no group.
    expect(screen.queryByRole('group', { name: 'Placeholders for More things worth knowing' })).toBeNull();
    expect(screen.getByText('Uses KinShip’s default text.', { selector: '.email-status' })).toBeTruthy();
  });

  it('says when the family changed the text', async () => {
    open('/admin/emails/invitation', {
      [`GET ${T}/invitation`]: {
        status: 200,
        body: { ...INVITATION, overrides: { subject: 'Join the {tree} tree' } },
      },
    });
    await editor();
    expect(box('Subject').value).toBe('Join the {tree} tree');
    expect(screen.getByText('Uses your family’s text.', { selector: '.email-status' })).toBeTruthy();
  });

  it('a placeholder button puts the placeholder where the cursor is', async () => {
    open();
    await editor();
    const subject = box('Subject');
    subject.focus();
    subject.setSelectionRange(0, 0);
    fireEvent.click(screen.getByRole('button', { name: 'Insert {tree} into Subject' }));
    expect(box('Subject').value).toBe('{tree}{inviter} invited you to the {tree} tree');
    expect(screen.getByText('Unsaved changes.', { selector: '.email-status' })).toBeTruthy();
  });

  it('asks for a preview of the draft once typing pauses, and shows the subject and the email in a sandboxed frame', async () => {
    const fetchMock = open();
    await editor();
    const iframe = (await frame()) as HTMLIFrameElement;
    expect(iframe.getAttribute('sandbox')).toBe('');
    expect(iframe.getAttribute('srcdoc')).toBe(PREVIEW.html);
    expect(screen.getByText(PREVIEW.subject)).toBeTruthy();
    fireEvent.change(box('Subject'), { target: { value: 'Come and join the {tree} tree' } });
    await waitFor(() =>
      expect(bodyOf(fetchMock, `POST ${T}/invitation/preview`)).toEqual({
        fields: {
          subject: 'Come and join the {tree} tree',
          preview: INVITATION.fields[1]!.default,
          intro: INVITATION.fields[2]!.default,
          worth_knowing: INVITATION.fields[3]!.default,
        },
      }),
    );
    // Nothing was saved.
    expect(calls(fetchMock).filter((c) => c.startsWith('PUT '))).toEqual([]);
  });

  it('shows the live errors under the field they belong to, and keeps the last good preview', async () => {
    open('/admin/emails/invitation', {
      [`POST ${T}/invitation/preview`]: (init) => {
        const body = JSON.parse(String(init.body)) as { fields: Record<string, string> };
        return body.fields.subject?.includes('{name}')
          ? {
              status: 400,
              body: {
                error: 'invalid_template',
                problems: [
                  { field: 'subject', problem: 'unknown_placeholder', placeholder: 'name' },
                  { field: 'intro', problem: 'stray_brace' },
                ],
              },
            }
          : { status: 200, body: PREVIEW };
      },
    });
    await editor();
    await frame();
    fireEvent.change(box('Subject'), { target: { value: 'Hello {name}' } });
    expect(await screen.findByText('{name} is not a placeholder this field can use.')).toBeTruthy();
    expect(box('Subject').getAttribute('aria-invalid')).toBe('true');
    expect(box('Opening').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Curly braces are only for placeholders. Remove the other { or }.')).toBeTruthy();
    expect(box('Preview text').getAttribute('aria-invalid')).toBeNull();
    expect(screen.getByText('The preview shows the last text without mistakes.')).toBeTruthy();
    expect(((await frame()) as HTMLIFrameElement).getAttribute('srcdoc')).toBe(PREVIEW.html);
    // Fixed: the errors go.
    fireEvent.change(box('Subject'), { target: { value: 'Hello {inviter}' } });
    await waitFor(() => expect(screen.queryByText('{name} is not a placeholder this field can use.')).toBeNull());
    expect(box('Subject').getAttribute('aria-invalid')).toBeNull();
  });

  it.each([
    [{ field: 'subject', problem: 'too_long', max: 150 }, 'This is longer than 150 characters.'],
    [{ field: 'subject', problem: 'line_break' }, 'This must be one line.'],
    [{ field: 'subject', problem: 'empty' }, 'This cannot be empty.'],
  ])('says what is wrong: %o', async (problem, text) => {
    open('/admin/emails/invitation', {
      [`POST ${T}/invitation/preview`]: { status: 400, body: { error: 'invalid_template', problems: [problem] } },
    });
    await editor();
    expect(await screen.findByText(text)).toBeTruthy();
  });

  it('saves the whole draft with the CSRF header, then says so and uses the answer', async () => {
    const saved = { ...INVITATION, overrides: { subject: 'Join the {tree} tree' } };
    const fetchMock = open('/admin/emails/invitation', { [`PUT ${T}/invitation`]: { status: 200, body: saved } });
    await editor();
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(box('Subject'), { target: { value: 'Join the {tree} tree' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(await screen.findByText('Saved. New emails use this text.')).toBeTruthy();
    expect(screen.getByText('Saved. New emails use this text.').getAttribute('role')).toBe('status');
    expect(screen.getByText('Uses your family’s text.', { selector: '.email-status' })).toBeTruthy();
    expect(bodyOf(fetchMock, `PUT ${T}/invitation`)).toMatchObject({ fields: { subject: 'Join the {tree} tree' } });
    const index = calls(fetchMock).indexOf(`PUT ${T}/invitation`);
    const headers = fetchMock.mock.calls[index]?.[1]?.headers as Record<string, string>;
    expect(headers['X-KinShip-Request']).toBe('1');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a refused save shows its banner and marks the fields', async () => {
    open('/admin/emails/invitation', {
      [`PUT ${T}/invitation`]: {
        status: 400,
        body: { error: 'invalid_template', problems: [{ field: 'intro', problem: 'stray_brace' }] },
      },
    });
    await editor();
    fireEvent.change(box('Subject'), { target: { value: 'Join us' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Not saved. Fix the marked fields first.');
    expect(box('Opening').getAttribute('aria-invalid')).toBe('true');
  });

  it('Reset to default asks first; Cancel changes nothing, and the confirm deletes the overrides', async () => {
    const fetchMock = open('/admin/emails/invitation', {
      [`GET ${T}/invitation`]: {
        status: 200,
        body: { ...INVITATION, overrides: { subject: 'Join the {tree} tree' } },
      },
      [`DELETE ${T}/invitation`]: { status: 200, body: INVITATION },
    });
    await editor();
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    let dialog = screen.getByRole('dialog', { name: 'Reset Invitation to the default?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls(fetchMock).filter((c) => c.startsWith('DELETE '))).toEqual([]);
    expect(box('Subject').value).toBe('Join the {tree} tree');

    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    dialog = screen.getByRole('dialog', { name: 'Reset Invitation to the default?' });
    expect(within(dialog).getByText(/your changes to this email are deleted/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset to default' }));
    expect(await screen.findByText('Reset. New emails use KinShip’s default text.')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls(fetchMock)).toContain(`DELETE ${T}/invitation`);
    expect(box('Subject').value).toBe('{inviter} invited you to the {tree} tree');
    expect(screen.getByText('Uses KinShip’s default text.', { selector: '.email-status' })).toBeTruthy();
  });

  it('Reset to default is off when there is nothing to reset', async () => {
    open();
    await editor();
    expect((screen.getByRole('button', { name: 'Reset to default' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Admin > Emails: Send test to me', () => {
  it('is off with the reason when email is not set up', async () => {
    open('/admin/emails/invitation', { 'GET /api/admin/mail': { status: 200, body: mailStatus('off') } });
    const region = await editor();
    await waitFor(() =>
      expect((within(region).getByRole('button', { name: 'Send test to me' }) as HTMLButtonElement).disabled).toBe(
        true,
      ),
    );
    expect(within(region).getByText('Set up email first: there is no provider to send through.')).toBeTruthy();
  });

  it('sends the saved text to me, with no body, and says the test is queued', async () => {
    const fetchMock = open('/admin/emails/invitation', {
      [`POST ${T}/invitation/test`]: { status: 202, body: { id: 'mail-1' } },
    });
    const region = await editor();
    expect(await within(region).findByText('The test goes to your own address, marcus@example.com.')).toBeTruthy();
    fireEvent.change(box('Subject'), { target: { value: 'Join us' } });
    expect(within(region).getByText('The test uses the saved text. Save first to test your changes.')).toBeTruthy();
    fireEvent.click(within(region).getByRole('button', { name: 'Send test to me' }));
    expect(await within(region).findByText('Test queued. Storage & email shows whether it was sent.')).toBeTruthy();
    const index = calls(fetchMock).indexOf(`POST ${T}/invitation/test`);
    expect(fetchMock.mock.calls[index]?.[1]?.body).toBeUndefined();
  });

  it('says how long to wait when the api answers 429', async () => {
    open('/admin/emails/invitation', {
      [`POST ${T}/invitation/test`]: { status: 429, body: { error: 'rate_limited', retryAfterSeconds: 42 } },
    });
    const region = await editor();
    const button = await within(region).findByRole('button', { name: 'Send test to me' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    expect((await within(region).findByRole('alert')).textContent).toBe(
      'You sent a test a moment ago. Try again in 42 seconds.',
    );
  });
});

describe('Admin > Emails: the preview switches', () => {
  it('shows the plain-text part, and a phone-width frame', async () => {
    open();
    await editor();
    await frame();
    const preview = screen.getByRole('region', { name: 'Preview' });
    const format = within(preview).getByRole('group', { name: 'Format' });
    const width = within(preview).getByRole('group', { name: 'Width' });
    expect(within(format).getByRole('button', { name: 'Email' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(format).getByRole('button', { name: 'Plain text' }));
    expect(within(format).getByRole('button', { name: 'Plain text' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTitle('Email preview')).toBeNull();
    expect(preview.querySelector('pre')?.textContent).toBe(PREVIEW.text);
    fireEvent.click(within(width).getByRole('button', { name: 'Phone' }));
    expect(preview.querySelector('.email-frame')?.classList.contains('phone')).toBe(true);
    fireEvent.click(within(width).getByRole('button', { name: 'Desktop' }));
    expect(preview.querySelector('.email-frame')?.classList.contains('phone')).toBe(false);
    // No "Copy HTML" (decided).
    expect(screen.queryByRole('button', { name: /copy/i })).toBeNull();
  });

  it('keeps the 36 px tap size and one column at phone width (the rules; e2e measures them at 360 px)', () => {
    // jsdom draws no layout, so the rules that hold the sizes are checked here.
    const css = readFileSync(join(import.meta.dirname, '../src/styles.css'), 'utf8');
    expect(css).toMatch(/\.email-editor \.button,\s*\.email-preview \.button \{\s*min-height: 36px;/);
    expect(css).toMatch(
      /@media \(max-width: 800px\) \{\s*\.email-columns \{\s*grid-template-columns: minmax\(0, 1fr\);/,
    );
    expect(css).toMatch(/\.email-frame \{[^}]*max-width: 100%;/);
    expect(css).toMatch(/\.email-list-item \{[^}]*min-height: 44px;/);
    // With Emails the admin tabs are wider than a 360 px phone: they wrap instead of widening the page.
    expect(css).toMatch(/\.tabs \{[^}]*flex-wrap: wrap;/);
  });
});

describe('the template client and the shared route table', () => {
  it('calls exactly the template routes in MAIL_ROUTES, with the CSRF header on every change', async () => {
    const fetchMock = mockApi({
      [`GET ${T}`]: { status: 200, body: LIST },
      [`GET ${T}/invitation`]: { status: 200, body: INVITATION },
      [`PUT ${T}/invitation`]: { status: 200, body: INVITATION },
      [`DELETE ${T}/invitation`]: { status: 200, body: INVITATION },
      [`POST ${T}/invitation/preview`]: { status: 200, body: PREVIEW },
      [`POST ${T}/invitation/test`]: { status: 202, body: { id: 'x' } },
    });
    await api.fetchMailTemplates();
    await api.fetchMailTemplate('invitation');
    await api.saveMailTemplate('invitation', {});
    await api.resetMailTemplate('invitation');
    await api.previewMailTemplate('invitation', {});
    await api.sendTemplateTest('invitation');
    expect(calls(fetchMock).map((c) => c.replace('/invitation', '/:id'))).toEqual(
      MAIL_ROUTES.filter((r) => r.path.includes('/templates')).map((r) => `${r.method} ${r.path}`),
    );
    for (const [index, call] of calls(fetchMock).entries()) {
      const headers = fetchMock.mock.calls[index]?.[1]?.headers as Record<string, string>;
      expect(headers['X-KinShip-Request'], call).toBe(call.startsWith('GET ') ? undefined : '1');
    }
  });
});
