// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetFragmentToken } from '../src/lib/fragment-token.js';
import { ALICE, ME, calls, expectCardHeader, mockApi, renderApp, signedOut } from './helpers.js';
import type { MockRoute } from './helpers.js';

const TOKEN = 'SECRET-link-token_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
const PASSWORD = 'a long new passphrase';

const INVITE = {
  kind: 'invite',
  treeName: 'Hale Family',
  email: 'jordan@hale.example',
  role: 'member',
  person: { name: 'Priya Nair' },
  note: 'Welcome, Priya!',
  invitedBy: 'Marcus Hale',
  expiresAt: '2026-11-23T10:00:00Z',
};
const RESET = { kind: 'reset', treeName: 'Hale Family', displayName: 'Daniel Hale', expiresAt: '2026-11-17T10:00:00Z' };

function open(path: string, fragment = TOKEN) {
  window.history.replaceState(null, '', `${path}${fragment ? `#${fragment}` : ''}`);
}

/** Signed out until the link has been accepted, then signed in (as the real API's cookie would make it). */
function linkRoutes(lookup: MockRoute, accept: MockRoute = { status: 201, body: ME }): Record<string, MockRoute> {
  let accepted = false;
  return {
    ...signedOut,
    '/api/auth/me': () => (accepted ? { status: 200, body: ME } : { status: 401, body: { error: 'unauthenticated' } }),
    'POST /api/links/lookup': lookup,
    'POST /api/links/accept': (init, path) => {
      const reply = typeof accept === 'function' ? accept(init, path) : accept;
      if (typeof reply === 'object' && reply.status === 201) accepted = true;
      return reply;
    },
  };
}

function bodyOf(fetchMock: ReturnType<typeof mockApi>, key: string): Record<string, unknown> | undefined {
  const call = fetchMock.mock.calls.find(
    ([input, init]) => `${(init?.method ?? 'GET').toUpperCase()} ${String(input)}` === key,
  );
  return call?.[1]?.body ? (JSON.parse(String(call[1].body)) as Record<string, unknown>) : undefined;
}

let logs: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
});
afterEach(() => {
  // Nothing the pages did may have logged the token.
  const logged = JSON.stringify(logs.flatMap((spy) => spy.mock.calls));
  expect(logged).not.toContain(TOKEN);
  logs.forEach((spy) => spy.mockRestore());
  vi.unstubAllGlobals();
  cleanup();
  forgetFragmentToken();
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('the invitation page', () => {
  it('removes the token from the address bar at once and sends it only in a POST body', async () => {
    const fetchMock = mockApi(linkRoutes({ status: 200, body: INVITE }));
    open('/invite');
    renderApp('/invite');
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain(TOKEN);
    await screen.findByRole('heading', { name: 'You are invited to the Hale Family tree' });
    expect(bodyOf(fetchMock, 'POST /api/links/lookup')).toEqual({ token: TOKEN });
    expect(calls(fetchMock).join('\n')).not.toContain(TOKEN); // no URL carries it
    expect(JSON.stringify({ ...window.localStorage, ...window.sessionStorage })).not.toContain(TOKEN);
  });

  it('opens the card with the sailboat mark, as the sign-in page does (the header keeps the full logo)', async () => {
    mockApi(linkRoutes({ status: 200, body: RESET }));
    open('/reset');
    renderApp('/reset');
    const heading = await screen.findByRole('heading', { name: 'Choose a new password' });
    const marks = heading.closest('section')!.querySelectorAll('svg.logo');
    expect(marks).toHaveLength(1);
    expect(marks[0]!.getAttribute('height')).toBe('44');
    expect(marks[0]!.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelectorAll('svg.logo')).toHaveLength(2);
    // The same centred header as the sign-in card, and the same centred button.
    expectCardHeader(heading);
    expect(screen.getByRole('button', { name: /password/i }).classList.contains('card-submit')).toBe(true);
  });

  it('shows who invited you, the role, the person, the note and the address, without a signed-in browser', async () => {
    mockApi(linkRoutes({ status: 200, body: INVITE }));
    open('/invite');
    renderApp('/invite');
    await screen.findByRole('heading', { name: 'You are invited to the Hale Family tree' });
    expect(screen.getByText('Marcus Hale invited you.')).toBeTruthy();
    expect(screen.getByText(/Your role: Member\./)).toBeTruthy();
    expect(screen.getByText(/linked to Priya Nair on the tree/)).toBeTruthy();
    expect(screen.getByText('Welcome, Priya!')).toBeTruthy();
    expect(screen.getByText('You will sign in with jordan@hale.example.')).toBeTruthy();
    expect(screen.queryByLabelText('Your name')).toBeNull(); // a person is linked: their name is used
    expect(screen.queryByRole('link', { name: 'Home' })).toBeNull(); // nobody is signed in
  });

  it('asks for a name only when no person is linked', async () => {
    mockApi(linkRoutes({ status: 200, body: { ...INVITE, person: null, role: 'user', note: null } }));
    open('/invite');
    renderApp('/invite');
    expect(await screen.findByLabelText('Your name')).toBeTruthy();
    expect(screen.getByText(/not linked to a person on the tree/)).toBeTruthy();
  });

  it('checks the name and the two passwords before sending anything', async () => {
    const fetchMock = mockApi(linkRoutes({ status: 200, body: { ...INVITE, person: null } }));
    open('/invite');
    renderApp('/invite');
    fireEvent.click(await screen.findByRole('button', { name: 'Create my account' }));
    expect(screen.getByText('Enter your name.')).toBeTruthy();
    expect(screen.getAllByText('At least 12 characters.').length).toBeGreaterThan(1); // help and error
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Jordan Calloway' } });
    fireEvent.change(screen.getByLabelText('Choose a password'), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText('Type the password again'), { target: { value: `${PASSWORD}x` } });
    fireEvent.click(screen.getByRole('button', { name: 'Create my account' }));
    expect(screen.getByText('The two passwords are not the same.')).toBeTruthy();
    expect(calls(fetchMock)).not.toContain('POST /api/links/accept');
  });

  it('accepts, lands signed in on the home page, and forgets the token', async () => {
    const fetchMock = mockApi(linkRoutes({ status: 200, body: { ...INVITE, person: null } }));
    open('/invite');
    const { client } = renderApp('/invite');
    fireEvent.change(await screen.findByLabelText('Your name'), { target: { value: ' Jordan Calloway ' } });
    fireEvent.change(screen.getByLabelText('Choose a password'), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText('Type the password again'), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole('button', { name: 'Create my account' }));
    await screen.findByRole('link', { name: 'Home' });
    expect(bodyOf(fetchMock, 'POST /api/links/accept')).toEqual({
      token: TOKEN,
      password: PASSWORD,
      displayName: 'Jordan Calloway',
    });
    expect(screen.queryByLabelText('Choose a password')).toBeNull();
    expect(
      JSON.stringify(
        client
          .getQueryCache()
          .getAll()
          .map((q) => [q.queryKey, q.state.data]),
      ),
    ).not.toContain(TOKEN);
  });

  it('does not send a name when a person is linked', async () => {
    const fetchMock = mockApi(linkRoutes({ status: 200, body: INVITE }));
    open('/invite');
    renderApp('/invite');
    fireEvent.change(await screen.findByLabelText('Choose a password'), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText('Type the password again'), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole('button', { name: 'Create my account' }));
    await waitFor(() =>
      expect(bodyOf(fetchMock, 'POST /api/links/accept')).toEqual({ token: TOKEN, password: PASSWORD }),
    );
  });

  it('shows one generic screen for any link that does not work, and for a missing link', async () => {
    const generic = 'This link does not work';
    mockApi(linkRoutes({ status: 404, body: { error: 'invalid_link' } }));
    open('/invite');
    renderApp('/invite');
    expect(await screen.findByRole('heading', { name: generic })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to sign in' }).getAttribute('href')).toBe('/login');
    cleanup();
    forgetFragmentToken();
    vi.unstubAllGlobals();

    const fetchMock = mockApi(linkRoutes({ status: 200, body: INVITE }));
    open('/invite', '');
    renderApp('/invite');
    expect(await screen.findByRole('heading', { name: generic })).toBeTruthy();
    expect(calls(fetchMock)).not.toContain('POST /api/links/lookup'); // nothing to look up
  });

  it('switches to the generic screen when the link stops working while you type', async () => {
    mockApi(linkRoutes({ status: 200, body: INVITE }, { status: 404, body: { error: 'invalid_link' } }));
    open('/invite');
    renderApp('/invite');
    fireEvent.change(await screen.findByLabelText('Choose a password'), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText('Type the password again'), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole('button', { name: 'Create my account' }));
    expect(await screen.findByRole('heading', { name: 'This link does not work' })).toBeTruthy();
  });

  it('says so when the server cannot be reached, and when there were too many tries, and lets you try again', async () => {
    mockApi(linkRoutes('network-error'));
    open('/invite');
    renderApp('/invite');
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Cannot reach the server. Check your connection and try again.',
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    cleanup();
    forgetFragmentToken();
    vi.unstubAllGlobals();
    mockApi(linkRoutes({ status: 429, body: { error: 'rate_limited', retryAfterSeconds: 42 } }));
    open('/invite');
    renderApp('/invite');
    expect((await screen.findByRole('alert')).textContent).toContain('42 seconds');
  });
});

describe('the set-password page', () => {
  it('works at /reset, names the account, asks for no name, and lands signed in', async () => {
    const fetchMock = mockApi(linkRoutes({ status: 200, body: RESET }));
    open('/reset');
    renderApp('/reset');
    expect(await screen.findByRole('heading', { name: 'Choose a new password' })).toBeTruthy();
    expect(screen.getByText(/made this link for Daniel Hale/)).toBeTruthy();
    expect(screen.queryByLabelText('Your name')).toBeNull();
    expect(window.location.href).not.toContain(TOKEN);
    fireEvent.change(screen.getByLabelText('Choose a password'), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText('Type the password again'), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole('button', { name: 'Save my new password' }));
    await screen.findByRole('link', { name: 'Home' });
    expect(bodyOf(fetchMock, 'POST /api/links/accept')).toEqual({ token: TOKEN, password: PASSWORD });
    expect(ALICE.email).toBeTruthy();
  });
});
