// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALICE, mockApi, needsSetup, renderApp, signedIn, signedOut } from './helpers.js';

const KEY = 'kinship.display';
const root = document.documentElement;
const attrs = () => [root.getAttribute('data-scheme'), root.getAttribute('data-theme')];
const mirror = () => JSON.parse(window.localStorage.getItem(KEY) ?? 'null');
const slateDark = { user: { ...ALICE, colorScheme: 'slate', theme: 'dark' }, treeName: 'Hale Family' };

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.kinshipTheme?.apply({ colorScheme: 'forest', theme: 'light' }, false);
});

describe('the theme in the app', () => {
  it('is already on the page from the mirror before React renders, on the login page too', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ colorScheme: 'sand', theme: 'dark' }));
    new Function(readFileSync(join(import.meta.dirname, '../public/theme-init.js'), 'utf8'))();
    expect(attrs()).toEqual(['sand', 'dark']); // nothing has rendered yet
    mockApi(signedOut);
    renderApp('/login');
    await screen.findByRole('button', { name: /sign in/i });
    expect(attrs()).toEqual(['sand', 'dark']); // the signed-out page does not reset it
  });

  it('keeps the look on /setup for a first run', async () => {
    window.kinshipTheme?.apply({ colorScheme: 'graphite', theme: 'dark' }, true);
    mockApi(needsSetup);
    renderApp('/setup');
    await screen.findByLabelText(/setup token/i);
    expect(attrs()).toEqual(['graphite', 'dark']);
  });

  it('takes the account’s settings when they are learned, and rewrites the mirror from them', async () => {
    window.kinshipTheme?.apply({ colorScheme: 'sand', theme: 'light' }, true); // a stale mirror
    mockApi({ ...signedIn, '/api/auth/me': { status: 200, body: slateDark } });
    renderApp('/about');
    await waitFor(() => expect(attrs()).toEqual(['slate', 'dark']));
    expect(mirror()).toEqual({ colorScheme: 'slate', theme: 'dark' });
  });

  it('applies them at sign-in, and keeps the mirror after sign-out', async () => {
    mockApi({
      ...signedOut,
      'POST /api/auth/login': { status: 200, body: slateDark },
      'POST /api/auth/logout': { status: 204 },
    });
    renderApp('/login');
    fireEvent.change(await screen.findByLabelText(/email/i), { target: { value: 'marcus@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'a long enough password' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(attrs()).toEqual(['slate', 'dark']));
    expect(mirror()).toEqual({ colorScheme: 'slate', theme: 'dark' });
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await screen.findByRole('button', { name: /sign in/i });
    expect(mirror()).toEqual({ colorScheme: 'slate', theme: 'dark' });
    expect(attrs()).toEqual(['slate', 'dark']);
    cleanup();
  });

  it('keeps the account’s defaults when the account has never chosen: Forest, following the device', async () => {
    mockApi(signedIn);
    renderApp('/about');
    await waitFor(() => expect(mirror()).toEqual({ colorScheme: 'forest', theme: 'device' }));
    expect(attrs()).toEqual(['forest', 'light']);
  });
});
