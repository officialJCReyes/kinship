// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Admin > Storage & email (ADR 0041): the Email card (provider, sender, PUBLIC_URL, the outbox counts, the last failure and the
// last test), "Send test to me" with its wait and its result, the Photos and files card (moved here from Backups), and who may
// see the page. Fictional Hale data only.
import type { MailStatus } from '@kinship/shared';
import { MAIL_ROUTES } from '@kinship/shared';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEST_POLL_FOR_MS, TEST_POLL_MS } from '../src/admin/mail.js';
import * as api from '../src/api.js';
import { MAIL_SETUP_URL } from '../src/pages/AdminStoragePage.js';
import { ALICE, ME, calls, mockApi, renderApp, signedIn } from './helpers.js';
import type { MockRoute } from './helpers.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setVisibility('visible');
  cleanup();
});

const FAMILY_ADMIN = { ...ME, user: { ...ALICE, id: 'u2', role: 'familyadmin' } };

const off = (change: Partial<MailStatus> = {}): MailStatus => ({
  provider: 'off',
  from: null,
  smtp: null,
  resend: null,
  publicUrl: 'https://hale.example',
  publicUrlWarning: null,
  queued: 0,
  failedLastWeek: 0,
  lastFailure: null,
  lastTest: null,
  testRecipient: 'marcus@example.com',
  ...change,
});

const smtp = (change: Partial<MailStatus> = {}): MailStatus =>
  off({
    provider: 'smtp',
    from: 'Hale Family Tree <tree@hale.example>',
    smtp: { host: 'smtp.hale.example', port: 587, security: 'starttls', user: 'tree@hale.example', passwordSet: true },
    ...change,
  });

const resend = (change: Partial<MailStatus> = {}): MailStatus =>
  off({ provider: 'resend', from: 'tree@hale.example', resend: { keySet: true }, ...change });

const files = {
  '/api/admin/files': { status: 200, body: { state: 'ready', keyId: '0123456789abcdef', photos: 3, photoBytes: 1024 } },
};

function open(mail: MockRoute, routes: Record<string, MockRoute> = {}, me: unknown = ME) {
  const fetchMock = mockApi({
    ...signedIn,
    '/api/auth/me': { status: 200, body: me },
    // The update banner on every Admin page: quiet when it fails.
    '/api/admin/updates': { status: 503, body: { error: 'unavailable' } },
    ...files,
    'GET /api/admin/mail': mail,
    ...routes,
  });
  renderApp('/admin/storage');
  return fetchMock;
}

const card = () => screen.findByRole('region', { name: 'Email' });
const fact = (region: HTMLElement, term: string) => {
  const dt = within(region).getByText(term, { selector: 'dt' });
  return dt.nextElementSibling as HTMLElement;
};
const mailGets = (fetchMock: ReturnType<typeof mockApi>) =>
  calls(fetchMock).filter((c) => c === 'GET /api/admin/mail').length;

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Answers GET /api/admin/mail from a list, one per call (the last one repeats). */
function sequence(answers: MailStatus[]): MockRoute {
  let i = 0;
  return () => {
    const body = answers[Math.min(i, answers.length - 1)];
    i += 1;
    return { status: 200, body };
  };
}

const tick = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe('Admin > Storage & email: the page and who sees it', () => {
  it('is a SuperAdmin tab, in the mockup order, with the page title and the Photos and files card', async () => {
    open({ status: 200, body: off() });
    expect(await screen.findByRole('heading', { name: 'Storage & email', level: 1 })).toBeTruthy();
    const tabs = screen.getByRole('navigation', { name: 'Admin sections' });
    expect(
      within(tabs)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Users', 'Storage & email', 'Backups', 'Updates']);
    const photos = await screen.findByRole('region', { name: 'Photos and files' });
    expect(within(photos).getByText(/Photos are on/)).toBeTruthy();
    expect(within(photos).getByText('0123456789abcdef')).toBeTruthy();
    expect(within(photos).getByText(/can never be opened again/)).toBeTruthy();
  });

  it('a Family Admin has no tab, gets the not-found page, and the page asks the api for nothing', async () => {
    const fetchMock = open({ status: 403, body: { error: 'forbidden' } }, {}, FAMILY_ADMIN);
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
    cleanup();
    renderApp('/admin/users');
    const tabs = await screen.findByRole('navigation', { name: 'Admin sections' });
    expect(within(tabs).queryByRole('link', { name: 'Storage & email' })).toBeNull();
    expect(calls(fetchMock).filter((c) => c.includes('/api/admin/mail') || c.includes('/api/admin/files'))).toEqual([]);
  });

  it('shows the error state when the status cannot be read, and tries again', async () => {
    let fail = true;
    open(() => (fail ? { status: 500, body: { error: 'internal' } } : { status: 200, body: off() }));
    const retry = await screen.findByRole('button', { name: 'Try again' });
    fail = false;
    fireEvent.click(retry);
    expect(await card()).toBeTruthy();
  });
});

describe('Admin > Storage & email: the Photos and files card', () => {
  it.each([
    ['key_missing', null, /no file encryption key is set\. Add FILE_ENCRYPTION_KEY/],
    ['files_unavailable', '0123456789abcdef', /files folder cannot be used/],
    ['key_mismatch', '0123456789abcdef', /does not match your files/],
  ])('says why photos are not available: %s', async (state, keyId, text) => {
    open(
      { status: 200, body: off() },
      { '/api/admin/files': { status: 200, body: { state, keyId, photos: 0, photoBytes: 0 } } },
    );
    const photos = await screen.findByRole('region', { name: 'Photos and files' });
    expect(within(photos).getByRole('alert').textContent).toMatch(text);
  });

  it('is left out when its status cannot be read, and the Email card still works', async () => {
    open({ status: 200, body: off() }, { '/api/admin/files': { status: 500, body: { error: 'internal' } } });
    expect(await card()).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Photos and files' })).toBeNull();
  });
});

describe('Admin > Storage & email: the Email card', () => {
  it('says "Not set up" with a link to INSTALL.md, and the test button is off with a reason', async () => {
    open({ status: 200, body: off() });
    const email = await card();
    expect(fact(email, 'Provider').textContent).toMatch(/^Not set up/);
    // Its own element, so a reader (and Playwright's exact text match) finds the words on their own.
    expect(within(fact(email, 'Provider')).getByText('Not set up', { exact: true })).toBeTruthy();
    const link = within(email).getByRole('link', { name: 'How to set up email (INSTALL.md)' });
    expect(link.getAttribute('href')).toBe(MAIL_SETUP_URL);
    expect(MAIL_SETUP_URL).toBe('https://github.com/officialJCReyes/kinship/blob/main/INSTALL.md#sending-email');
    const button = within(email).getByRole('button', { name: 'Send test to me' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Set up email first: there is no provider to send through.',
    );
    expect(within(email).queryByText('SMTP user')).toBeNull();
    expect(within(email).queryByText('Sender (MAIL_FROM)')).toBeNull();
    expect(fact(email, 'Last test').textContent).toBe('Never');
    expect(fact(email, 'Last failure').textContent).toBe('None');
  });

  it('shows SMTP as host:port with how it is encrypted, the user, the password only as "set", and the sender', async () => {
    open({ status: 200, body: smtp() });
    const email = await card();
    expect(fact(email, 'Provider').textContent).toBe('SMTP smtp.hale.example:587, STARTTLS');
    expect(fact(email, 'SMTP user').textContent).toBe('tree@hale.example');
    expect(fact(email, 'SMTP password').textContent).toBe('set');
    expect(fact(email, 'Sender (MAIL_FROM)').textContent).toBe('Hale Family Tree <tree@hale.example>');
    expect(fact(email, 'Links start with (PUBLIC_URL)').textContent).toBe('https://hale.example');
    expect(within(email).getByText('The test goes to your own address, marcus@example.com.')).toBeTruthy();
    expect((within(email).getByRole('button', { name: 'Send test to me' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it.each([
    ['tls', 465, 'TLS'],
    ['none', 25, 'not encrypted'],
  ] as const)('names SMTP_SECURE=%s', async (security, port, words) => {
    open({
      status: 200,
      body: smtp({ smtp: { host: 'relay.hale.example', port, security, user: null, passwordSet: false } }),
    });
    const email = await card();
    expect(fact(email, 'Provider').textContent).toBe(`SMTP relay.hale.example:${port}, ${words}`);
    expect(fact(email, 'SMTP user').textContent).toBe('None');
    expect(fact(email, 'SMTP password').textContent).toBe('not set');
  });

  it('shows Resend with its key only as "set"', async () => {
    open({ status: 200, body: resend() });
    const email = await card();
    expect(fact(email, 'Provider').textContent).toBe('Resend');
    expect(fact(email, 'Resend API key').textContent).toBe('set');
    expect(within(email).queryByText('SMTP user')).toBeNull();
  });

  it.each([
    ['http', 'http://family.hale.example', /will not be encrypted/],
    ['default', 'http://localhost:8080', /PUBLIC_URL is not set/],
  ] as const)('warns about PUBLIC_URL (%s)', async (warning, publicUrl, text) => {
    open({ status: 200, body: smtp({ publicUrl, publicUrlWarning: warning }) });
    const email = await card();
    expect(within(fact(email, 'Links start with (PUBLIC_URL)')).getByRole('alert').textContent).toMatch(text);
  });

  it('shows the counts, the last failure with its template, cleaned message and advice, and the last test', async () => {
    open({
      status: 200,
      body: smtp({
        queued: 2,
        failedLastWeek: 1,
        lastFailure: {
          at: '2026-11-26T09:30:00.000Z',
          template: 'test',
          error: '535 5.7.8 Authentication failed',
          final: true,
          hint: 'smtp_auth',
        },
        lastTest: {
          id: 't1',
          status: 'failed',
          at: '2026-11-26T09:29:00.000Z',
          sentAt: null,
          error: '535 5.7.8 Authentication failed',
          hint: 'smtp_auth',
        },
      }),
    });
    const email = await card();
    expect(fact(email, 'Waiting to be sent').textContent).toBe('2');
    expect(fact(email, 'Failed in the last 7 days').textContent).toBe('1');
    const failure = fact(email, 'Last failure');
    expect(failure.textContent).toMatch(/Nov 26, 2026, .*, test email/);
    expect(within(failure).getByText('535 5.7.8 Authentication failed')).toBeTruthy();
    expect(within(failure).getByText(/refused the user name or password/)).toBeTruthy();
    expect(within(failure).getByText('KinShip gave up on this one.')).toBeTruthy();
    const last = fact(email, 'Last test');
    expect(within(last).getByText('Failed')).toBeTruthy();
    expect(within(last).getByText(/refused the user name or password/)).toBeTruthy();
  });

  it('names a template it has no word for by its id, and says a retry is coming', async () => {
    open({
      status: 200,
      body: resend({
        lastFailure: {
          at: '2026-11-26T09:30:00.000Z',
          template: 'invitation',
          error: 'timeout',
          final: false,
          hint: null,
        },
      }),
    });
    const failure = fact(await card(), 'Last failure');
    expect(failure.textContent).toMatch(/, invitation/);
    expect(within(failure).getByText('KinShip will try again.')).toBeTruthy();
  });

  it('shows a key-looking value in the cleaned error exactly as the api returned it, as text and never as HTML', async () => {
    // The api cleans secrets out before it answers (mail-clean-error.test.ts); the page only displays the text it is given.
    const error =
      'Resend 401: API key re_FAKE0000example0000KEY is invalid <b id="injected">bold</b> <img src=x onerror=alert(1)>';
    open({
      status: 200,
      body: resend({
        lastFailure: { at: '2026-11-26T09:30:00.000Z', template: 'test', error, final: true, hint: 'resend_key' },
      }),
    });
    const failure = fact(await card(), 'Last failure');
    expect(within(failure).getByText(error).textContent).toBe(error);
    expect(document.getElementById('injected')).toBeNull();
    expect(failure.querySelector('b, img')).toBeNull();
    expect(within(failure).getByText(/Resend did not accept the API key/)).toBeTruthy();
  });
});

describe('Admin > Storage & email: Send test to me', () => {
  const queued = {
    id: 't9',
    status: 'queued' as const,
    at: '2026-11-27T10:00:00.000Z',
    sentAt: null,
    error: null,
    hint: null,
  };

  it('sends no recipient, then asks for the result every 2 seconds until the test is sent, and stops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = open(
      sequence([
        smtp(),
        smtp({ lastTest: queued }),
        smtp({ lastTest: { ...queued, status: 'sending' } }),
        smtp({ lastTest: { ...queued, status: 'sent', sentAt: '2026-11-27T10:00:04.000Z' } }),
      ]),
      { 'POST /api/admin/mail/test': { status: 202, body: { id: 't9' } } },
    );
    const email = await card();
    fireEvent.click(within(email).getByRole('button', { name: 'Send test to me' }));
    expect((await within(email).findByRole('status')).textContent).toMatch(/Test queued/);
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(post?.[1]?.body).toBeUndefined();
    await tick(TEST_POLL_MS);
    await tick(TEST_POLL_MS);
    await waitFor(() => expect(within(email).getByRole('status').textContent).toMatch(/The test was sent/));
    expect(within(fact(email, 'Last test')).getByText('Sent')).toBeTruthy();
    const after = mailGets(fetchMock);
    await tick(TEST_POLL_MS * 5);
    expect(mailGets(fetchMock)).toBe(after);
  });

  it('shows the failure with its advice when the test fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    open(
      sequence([
        resend(),
        resend({
          lastTest: { ...queued, status: 'failed', error: 'domain is not verified', hint: 'resend_domain' },
        }),
      ]),
      { 'POST /api/admin/mail/test': { status: 202, body: { id: 't9' } } },
    );
    const email = await card();
    fireEvent.click(within(email).getByRole('button', { name: 'Send test to me' }));
    const alert = await within(email).findByRole('alert');
    expect(alert.textContent).toMatch(/The test could not be sent\./);
    expect(within(alert).getByText('domain is not verified')).toBeTruthy();
    expect(within(alert).getByText(/Resend has not verified the domain/)).toBeTruthy();
  });

  it('stops asking after about 30 seconds and says the result will show later', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = open(sequence([smtp(), smtp({ lastTest: queued })]), {
      'POST /api/admin/mail/test': { status: 202, body: { id: 't9' } },
    });
    const email = await card();
    fireEvent.click(within(email).getByRole('button', { name: 'Send test to me' }));
    await within(email).findByRole('status');
    await tick(TEST_POLL_FOR_MS + TEST_POLL_MS);
    await waitFor(() =>
      expect(within(email).getByRole('status').textContent).toMatch(/keeps trying in the background/),
    );
    const gets = mailGets(fetchMock);
    // About 15 polls in 30 seconds, then none.
    expect(gets).toBeGreaterThanOrEqual(12);
    expect(gets).toBeLessThanOrEqual(18);
    await tick(TEST_POLL_MS * 5);
    expect(mailGets(fetchMock)).toBe(gets);
    expect((within(email).getByRole('button', { name: 'Send test to me' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not ask while the page is hidden, and asks again when it is shown', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = open(sequence([smtp(), smtp({ lastTest: queued })]), {
      'POST /api/admin/mail/test': { status: 202, body: { id: 't9' } },
    });
    const email = await card();
    fireEvent.click(within(email).getByRole('button', { name: 'Send test to me' }));
    await within(email).findByRole('status');
    await tick(TEST_POLL_MS);
    act(() => setVisibility('hidden'));
    const hidden = mailGets(fetchMock);
    await tick(TEST_POLL_MS * 5);
    expect(mailGets(fetchMock)).toBe(hidden);
    act(() => setVisibility('visible'));
    await tick(TEST_POLL_MS);
    expect(mailGets(fetchMock)).toBeGreaterThan(hidden);
  });

  it('says how long to wait when the api answers 429', async () => {
    open(
      { status: 200, body: smtp() },
      { 'POST /api/admin/mail/test': { status: 429, body: { error: 'rate_limited', retryAfterSeconds: 42 } } },
    );
    const email = await card();
    fireEvent.click(within(email).getByRole('button', { name: 'Send test to me' }));
    expect((await within(email).findByRole('alert')).textContent).toBe(
      'You sent a test a moment ago. Try again in 42 seconds.',
    );
  });

  it('says why when the api says email is not set up', async () => {
    open(
      { status: 200, body: smtp() },
      { 'POST /api/admin/mail/test': { status: 409, body: { error: 'mail_not_configured' } } },
    );
    const email = await card();
    fireEvent.click(within(email).getByRole('button', { name: 'Send test to me' }));
    expect((await within(email).findByRole('alert')).textContent).toMatch(/^Email is not set up\./);
  });
});

describe('the mail client and the shared route table', () => {
  it('calls only the routes in MAIL_ROUTES, with the CSRF header on the test and no body', async () => {
    const fetchMock = mockApi({
      'GET /api/admin/mail': { status: 200, body: off() },
      'POST /api/admin/mail/test': { status: 202, body: { id: 'x' } },
    });
    await api.fetchMailStatus();
    await api.sendTestMail();
    expect(calls(fetchMock)).toEqual(MAIL_ROUTES.map((r) => `${r.method} ${r.path}`));
    const init = fetchMock.mock.calls[1]?.[1];
    expect((init?.headers as Record<string, string>)['X-KinShip-Request']).toBe('1');
    expect(init?.body).toBeUndefined();
  });
});
