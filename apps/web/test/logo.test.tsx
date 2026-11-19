// SPDX-License-Identifier: AGPL-3.0-or-later
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from '@kinship/shared';
import { mockApi, needsSetup, renderApp, signedIn, signedOut } from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Every logo drawn on the page: all of them are decorative. */
const logos = () => [...document.querySelectorAll('svg.logo')];

describe('the KinShip logo', () => {
  it('is in the header with the translated name "KinShip home", announced once', async () => {
    mockApi(signedIn);
    renderApp('/about');
    await screen.findByRole('heading', { name: 'About KinShip' });
    const home = screen.getByRole('link', { name: en['app.homeLink'] });
    expect(en['app.homeLink']).toBe('KinShip home');
    expect(home.getAttribute('href')).toBe('/');
    expect(home.getAttribute('aria-label')).toBe(en['app.homeLink']);
    // The picture inside the link is hidden from assistive technology and has no text of its own, so the name is read once.
    const svg = home.querySelector('svg.logo')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelector('title, desc')).toBeNull();
    expect(svg.textContent).toBe('');
    expect(home.textContent).toBe('');
    expect(screen.getAllByRole('link', { name: /KinShip/ })).toHaveLength(1);
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    expect(svg.getAttribute('height')).toBe('38');
  });

  it('is in the header when signed out, and on /login at 52 px, decorative, beside the "Sign in" heading', async () => {
    mockApi(signedOut);
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(screen.getByRole('link', { name: 'KinShip home' })).toBeTruthy();
    expect(logos().map((l) => l.getAttribute('height'))).toEqual(['38', '52']);
    expect(logos().every((l) => l.getAttribute('aria-hidden') === 'true')).toBe(true);
  });

  it('is on /setup at 44 px, and only on the first step’s heading', async () => {
    mockApi(needsSetup);
    renderApp('/setup');
    await screen.findByRole('heading', { name: 'Welcome to KinShip' });
    expect(logos().map((l) => l.getAttribute('height'))).toEqual(['38', '44']);
  });

  it('is on the About page at 40 px', async () => {
    mockApi(signedIn);
    renderApp('/about');
    await screen.findByRole('heading', { name: 'About KinShip' });
    expect(logos().map((l) => l.getAttribute('height'))).toEqual(['38', '40']);
  });

  it('uses only theme tokens, never a fixed or scheme color', async () => {
    mockApi(signedIn);
    renderApp('/about');
    await screen.findByRole('heading', { name: 'About KinShip' });
    const svg = logos()[0]!;
    const colors = [...svg.querySelectorAll('*')].flatMap((e) => [e.getAttribute('fill'), e.getAttribute('stroke')]);
    const used = new Set(colors.filter((c) => c && c !== 'none'));
    expect([...used].sort()).toEqual(
      ['var(--amber)', 'var(--logo-detail)', 'var(--logo-ink)', 'var(--logo-sail)', 'var(--logo-word)'].sort(),
    );
  });
});
