// SPDX-License-Identifier: AGPL-3.0-or-later
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ME, calls, mockApi, needsSetup, renderApp } from './helpers.js';
import type { MockRoute } from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const GOOD = 'correct horse battery staple';

function fillAll(overrides: Partial<Record<string, string>> = {}) {
  const values: Record<string, string> = {
    'Setup token': 'tok-123',
    'Your name': 'Marcus Hale',
    Email: 'marcus@example.com',
    Password: GOOD,
    'Confirm password': GOOD,
    'Name your first tree': 'Hale Family',
    ...overrides,
  } as Record<string, string>;
  for (const [label, value] of Object.entries(values)) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
}
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Create account and continue' }));

async function openSetup(extra: Record<string, MockRoute> = {}) {
  const fetchMock = mockApi({ ...needsSetup, ...extra });
  renderApp('/setup');
  await screen.findByRole('heading', { name: 'Welcome to KinShip' });
  return fetchMock;
}

describe('setup page', () => {
  it('asks for the token, name, email, password twice and the tree name, and says where the token is', async () => {
    await openSetup();
    for (const label of ['Setup token', 'Your name', 'Email', 'Password', 'Confirm password', 'Name your first tree']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(screen.getByText(/docker compose logs api/)).toBeTruthy();
    expect(screen.getByLabelText('Password').getAttribute('autocomplete')).toBe('new-password');
    expect(screen.getByText('This screen never appears again once an account exists.')).toBeTruthy();
  });

  it('shows clear messages for a short password, a mismatch and a bad email, and sends nothing', async () => {
    const fetchMock = await openSetup();
    fillAll({ Password: 'short', 'Confirm password': 'different', Email: 'nope' });
    submit();
    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();
    expect(screen.getByText('The password must be at least 12 characters.')).toBeTruthy();
    expect(screen.getByText('The two passwords are not the same.')).toBeTruthy();
    expect(calls(fetchMock).some((c) => c.startsWith('POST'))).toBe(false);
  });

  it('accepts a password of exactly 12 characters', async () => {
    let done = false;
    const fetchMock = await openSetup({
      '/api/setup/status': () => ({ status: 200, body: { needsSetup: !done } }),
      '/api/auth/me': () => (done ? { status: 200, body: ME } : { status: 401, body: {} }),
      'POST /api/setup': () => {
        done = true;
        return { status: 201, body: ME };
      },
    });
    fillAll({ Password: 'aaaaaaaaaaaa', 'Confirm password': 'aaaaaaaaaaaa' });
    submit();
    await screen.findByRole('heading', { name: 'Welcome, Marcus Hale' });
    expect(calls(fetchMock)).toContain('POST /api/setup');
  });

  it('creates the account (with the CSRF header and the right fields) and then shows home', async () => {
    let done = false;
    const fetchMock = await openSetup({
      '/api/setup/status': () => ({ status: 200, body: { needsSetup: !done } }),
      '/api/auth/me': () => (done ? { status: 200, body: ME } : { status: 401, body: {} }),
      'POST /api/setup': () => {
        done = true;
        return { status: 201, body: ME };
      },
    });
    fillAll();
    submit();
    expect(await screen.findByRole('heading', { name: 'Welcome, Marcus Hale' })).toBeTruthy();

    const post = fetchMock.mock.calls.find(([url]) => url === '/api/setup');
    expect((post?.[1]?.headers as Record<string, string>)['X-KinShip-Request']).toBe('1');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      token: 'tok-123',
      displayName: 'Marcus Hale',
      email: 'marcus@example.com',
      password: GOOD,
      treeName: 'Hale Family',
    });
  });

  it('says the token is wrong', async () => {
    await openSetup({ 'POST /api/setup': { status: 403, body: { error: 'invalid_setup_token' } } });
    fillAll();
    submit();
    expect((await screen.findByRole('alert')).textContent).toContain('That setup token is not right');
  });

  it('says setup is already done, with a link to sign in', async () => {
    await openSetup({ 'POST /api/setup': { status: 409, body: { error: 'already_set_up' } } });
    fillAll();
    submit();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('KinShip is already set up');
    expect(screen.getByRole('link', { name: 'Go to sign in' }).getAttribute('href')).toBe('/login');
  });

  it('says how long to wait when rate limited', async () => {
    await openSetup({ 'POST /api/setup': { status: 429, body: { error: 'rate_limited', retryAfterSeconds: 61 } } });
    fillAll();
    submit();
    expect((await screen.findByRole('alert')).textContent).toBe('Too many attempts. Try again in 2 minute(s).');
  });

  it('keeps what was typed when the server says no', async () => {
    await openSetup({ 'POST /api/setup': { status: 403, body: { error: 'invalid_setup_token' } } });
    fillAll();
    submit();
    await screen.findByRole('alert');
    expect((screen.getByLabelText('Your name') as HTMLInputElement).value).toBe('Marcus Hale');
    expect((screen.getByLabelText('Name your first tree') as HTMLInputElement).value).toBe('Hale Family');
  });
});
