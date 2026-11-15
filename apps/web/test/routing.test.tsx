// SPDX-License-Identifier: AGPL-3.0-or-later
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderApp } from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('routing and layout', () => {
  it('sends / to the About page', async () => {
    mockApi({ '/api/version': 'network-error', '/api/health': 'network-error' });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'About KinShip' })).toBeTruthy();
  });

  it('shows a not-found page for an unknown address, with a way back', () => {
    mockApi({});
    renderApp('/nothing-here');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to About' }).getAttribute('href')).toBe('/about');
  });

  it('has a skip link, a main landmark and a labelled navigation', () => {
    mockApi({});
    renderApp('/nothing-here');
    expect(screen.getByRole('link', { name: 'Skip to content' }).getAttribute('href')).toBe('#main');
    expect(screen.getByRole('main').id).toBe('main');
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
  });
});
