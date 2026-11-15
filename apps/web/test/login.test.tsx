// SPDX-License-Identifier: AGPL-3.0-or-later
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ME, WEB_VERSION, calls, mockApi, renderApp, signedOut } from './helpers.js';
import type { MockRoute } from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function fill(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
}
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

async function openLogin(extra: Record<string, MockRoute> = {}) {
  const fetchMock = mockApi({ ...signedOut, ...extra });
  renderApp('/login');
  await screen.findByRole('heading', { name: 'Sign in' });
  return fetchMock;
}

describe('login page', () => {
  it('has labelled email and password fields that a password manager understands', async () => {
    await openLogin();
    expect(screen.getByLabelText('Email').getAttribute('autocomplete')).toBe('username');
    expect(screen.getByLabelText('Password').getAttribute('autocomplete')).toBe('current-password');
    expect(screen.getByLabelText('Password').getAttribute('type')).toBe('password');
  });

  it('shows the version and a source link in the footer', async () => {
    await openLogin();
    expect(await screen.findByText(`KinShip ${WEB_VERSION}`, { exact: false })).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Source code' });
    expect(link.getAttribute('href')).toBe('https://github.com/officialJCReyes/kinship');
  });

  it('signs in, sending the CSRF header, and shows home', async () => {
    let signedInNow = false;
    const fetchMock = await openLogin({
      '/api/auth/me': () =>
        signedInNow ? { status: 200, body: ME } : { status: 401, body: { error: 'unauthenticated' } },
      'POST /api/auth/login': () => {
        signedInNow = true;
        return { status: 200, body: ME };
      },
    });
    fill('marcus@example.com', 'correct horse battery staple');
    submit();
    expect(await screen.findByRole('heading', { name: 'Welcome, Marcus Hale' })).toBeTruthy();

    const login = fetchMock.mock.calls.find(([url]) => url === '/api/auth/login');
    expect(login?.[1]?.method).toBe('POST');
    expect((login?.[1]?.headers as Record<string, string>)['X-KinShip-Request']).toBe('1');
    expect(JSON.parse(String(login?.[1]?.body))).toEqual({
      email: 'marcus@example.com',
      password: 'correct horse battery staple',
    });
  });

  it('says the email or password is wrong, without saying which', async () => {
    await openLogin({ 'POST /api/auth/login': { status: 401, body: { error: 'invalid_credentials' } } });
    fill('marcus@example.com', 'wrong wrong wrong');
    submit();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('The email or password is not correct.');
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy(); // still here
  });

  it('says how long to wait when rate limited, in minutes', async () => {
    await openLogin({
      'POST /api/auth/login': { status: 429, body: { error: 'rate_limited', retryAfterSeconds: 540 } },
    });
    fill('marcus@example.com', 'x');
    submit();
    expect((await screen.findByRole('alert')).textContent).toBe('Too many attempts. Try again in 9 minute(s).');
  });

  it('says the server cannot be reached when the request fails', async () => {
    await openLogin({ 'POST /api/auth/login': 'network-error' });
    fill('marcus@example.com', 'x');
    submit();
    expect((await screen.findByRole('alert')).textContent).toContain('Cannot reach the server');
  });

  it('disables the button while signing in, so a double click cannot send twice', async () => {
    const fetchMock = await openLogin({ 'POST /api/auth/login': 'never' });
    fill('marcus@example.com', 'x');
    submit();
    const busy = await screen.findByRole('button', { name: 'Signing in…' });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(busy);
    expect(calls(fetchMock).filter((c) => c === 'POST /api/auth/login')).toHaveLength(1);
  });

  it('never shows a password in the page', async () => {
    await openLogin({ 'POST /api/auth/login': { status: 401, body: { error: 'invalid_credentials' } } });
    fill('marcus@example.com', 'my secret passphrase');
    submit();
    await screen.findByRole('alert');
    expect(document.body.textContent).not.toContain('my secret passphrase');
  });
});

describe('sign out', () => {
  it('ends the session on the server (with the CSRF header) and shows the sign-in page', async () => {
    let signedInNow = true;
    const fetchMock = mockApi({
      ...signedOut,
      '/api/auth/me': () =>
        signedInNow ? { status: 200, body: ME } : { status: 401, body: { error: 'unauthenticated' } },
      'POST /api/auth/logout': () => {
        signedInNow = false;
        return { status: 204 };
      },
    });
    renderApp('/about');
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();

    const logout = fetchMock.mock.calls.find(([url]) => url === '/api/auth/logout');
    expect(logout?.[1]?.method).toBe('POST');
    expect((logout?.[1]?.headers as Record<string, string>)['X-KinShip-Request']).toBe('1');
    expect(screen.queryByText(/Signed in as/)).toBeNull();
  });

  it('shows the sign-in page even if the request to sign out fails', async () => {
    mockApi({ ...signedOut, '/api/auth/me': { status: 200, body: ME }, 'POST /api/auth/logout': 'network-error' });
    renderApp('/about');
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(screen.queryByText(/Signed in as/)).toBeNull());
  });
});
