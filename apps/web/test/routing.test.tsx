// SPDX-License-Identifier: AGPL-3.0-or-later
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { calls, mockApi, needsSetup, renderApp, signedIn, signedOut } from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('route guards', () => {
  it.each(['/', '/about', '/login', '/setup', '/anything'])(
    'sends %s to the setup page while the install has no accounts',
    async (path) => {
      const fetchMock = mockApi(needsSetup);
      renderApp(path);
      if (path === '/anything') {
        // Unknown addresses show not-found; every real page goes to setup.
        expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
        return;
      }
      expect(await screen.findByRole('heading', { name: 'Welcome to KinShip' })).toBeTruthy();
      expect(calls(fetchMock)).not.toContain('GET /api/auth/me'); // no point asking who is signed in
    },
  );

  it('shows the setup page only while setup is needed: afterwards /setup goes to sign-in', async () => {
    mockApi(signedOut);
    renderApp('/setup');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Welcome to KinShip' })).toBeNull();
  });

  it('sends a signed-out visitor from a protected page to sign-in', async () => {
    mockApi(signedOut);
    for (const path of ['/', '/about']) {
      renderApp(path);
      expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
    }
  });

  it('shows no navigation or account bar to a signed-out visitor', async () => {
    mockApi(signedOut);
    renderApp('/about');
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('sends a signed-in person away from /login and /setup, to home', async () => {
    mockApi(signedIn);
    for (const path of ['/login', '/setup']) {
      renderApp(path);
      expect(await screen.findByRole('heading', { name: 'Welcome, Marcus Hale' })).toBeTruthy();
    }
  });

  it('shows the person, the navigation and a sign-out button when signed in', async () => {
    mockApi(signedIn);
    renderApp('/');
    expect(await screen.findByText('Signed in as Marcus Hale')).toBeTruthy();
    expect(screen.getByText('You are signed in to Hale Family.')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('says so when the API cannot be reached at all', async () => {
    mockApi({ '/api/setup/status': 'network-error' });
    renderApp('/');
    expect(await screen.findByText('Cannot reach the server. Check your connection and try again.')).toBeTruthy();
  });

  it('shows a not-found page for an unknown address, with a way back', async () => {
    mockApi(signedIn);
    renderApp('/nothing-here');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to About' }).getAttribute('href')).toBe('/about');
  });

  it('has a skip link and a main landmark', async () => {
    mockApi(signedIn);
    renderApp('/nothing-here');
    await screen.findByRole('heading', { name: 'Page not found' });
    expect(screen.getByRole('link', { name: 'Skip to content' }).getAttribute('href')).toBe('#main');
    expect(screen.getByRole('main').id).toBe('main');
  });
});
