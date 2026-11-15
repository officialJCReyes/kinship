// SPDX-License-Identifier: AGPL-3.0-or-later
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderApp } from './helpers.js';

const okVersion = { status: 200, body: { name: 'kinship-api', version: '0.0.0', commit: 'abc1234' } };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('About page', () => {
  it('shows the web and api versions, the build, the license and the source link', async () => {
    mockApi({ '/api/version': okVersion, '/api/health': { status: 200, body: { status: 'ok', database: 'ok' } } });
    renderApp('/about');

    expect(screen.getByRole('heading', { name: 'About KinShip' })).toBeTruthy();
    await screen.findByText('abc1234');
    expect(screen.getAllByText('0.0.0')).toHaveLength(2); // web and api
    expect(screen.getByText('AGPL-3.0-or-later')).toBeTruthy();

    const link = screen.getByRole('link', { name: 'github.com/officialJCReyes/kinship' });
    expect(link.getAttribute('href')).toBe('https://github.com/officialJCReyes/kinship');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(screen.getByText(/you must offer them its source code/)).toBeTruthy();
  });

  it('says the API and database are running when health is ok', async () => {
    mockApi({ '/api/version': okVersion, '/api/health': { status: 200, body: { status: 'ok', database: 'ok' } } });
    renderApp('/about');
    expect(await screen.findByText('The API and the database are running.')).toBeTruthy();
  });

  it('says so when the API cannot reach the database (HTTP 503 with a JSON body)', async () => {
    mockApi({
      '/api/version': okVersion,
      '/api/health': { status: 503, body: { status: 'unavailable', database: 'unreachable' } },
    });
    renderApp('/about');
    expect(await screen.findByText('The API is running but cannot reach the database.')).toBeTruthy();
  });

  it('says so when the API cannot be reached at all (proxy error page, not JSON)', async () => {
    mockApi({
      '/api/version': { status: 502, text: '<html>502 Bad Gateway</html>' },
      '/api/health': { status: 502, text: '<html>502 Bad Gateway</html>' },
    });
    renderApp('/about');
    expect(await screen.findByText('Cannot reach the API.')).toBeTruthy();
    expect(await screen.findByText('Could not load the version of the API.')).toBeTruthy();
  });

  it('survives a network error', async () => {
    mockApi({ '/api/version': 'network-error', '/api/health': 'network-error' });
    renderApp('/about');
    expect(await screen.findByText('Cannot reach the API.')).toBeTruthy();
  });

  it('shows the web version even while the API is unreachable', async () => {
    mockApi({ '/api/version': 'network-error', '/api/health': 'network-error' });
    renderApp('/about');
    await waitFor(() => expect(screen.getByText('Cannot reach the API.')).toBeTruthy());
    expect(screen.getAllByText('0.0.0').length).toBeGreaterThanOrEqual(1);
  });
});
