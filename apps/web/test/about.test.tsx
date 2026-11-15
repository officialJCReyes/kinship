// SPDX-License-Identifier: AGPL-3.0-or-later
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HEALTH_OK, VERSION, mockApi, renderApp, signedIn } from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('About page (signed in)', () => {
  it('shows the web and api versions, the database schema, the build, the license and the source link', async () => {
    mockApi(signedIn);
    renderApp('/about');

    expect(await screen.findByRole('heading', { name: 'About KinShip' })).toBeTruthy();
    await screen.findByText('abc1234');
    expect(screen.getAllByText('0.0.0')).toHaveLength(2); // web and api
    expect(screen.getByText('Database schema')).toBeTruthy();
    expect(screen.getByText(String(VERSION.schema))).toBeTruthy();
    expect(screen.getByText('AGPL-3.0-or-later')).toBeTruthy();

    const link = screen.getByRole('link', { name: 'github.com/officialJCReyes/kinship' });
    expect(link.getAttribute('href')).toBe('https://github.com/officialJCReyes/kinship');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(screen.getByText(/you must offer them its source code/)).toBeTruthy();
  });

  it('says the API and database are running when health is ok', async () => {
    mockApi(signedIn);
    renderApp('/about');
    expect(await screen.findByText('The API and the database are running.')).toBeTruthy();
  });

  it('says so when the API cannot reach the database (HTTP 503 with a JSON body)', async () => {
    mockApi({
      ...signedIn,
      '/api/health': { status: 503, body: { status: 'unavailable', database: 'unreachable' } },
    });
    renderApp('/about');
    expect(await screen.findByText('The API is running but cannot reach the database.')).toBeTruthy();
  });

  it('says so when the API cannot be reached at all, but still shows the web version', async () => {
    mockApi({
      ...signedIn,
      '/api/version': { status: 502, text: '<html>502 Bad Gateway</html>' },
      '/api/health': { status: 502, text: '<html>502 Bad Gateway</html>' },
    });
    renderApp('/about');
    expect(await screen.findByText('Cannot reach the API.')).toBeTruthy();
    expect(await screen.findByText('Could not load the version of the API.')).toBeTruthy();
    expect(screen.getAllByText('0.0.0').length).toBeGreaterThanOrEqual(1);
  });

  it('shows "unknown" for the schema when the API could not read it', async () => {
    mockApi({ ...signedIn, '/api/version': { status: 200, body: { ...VERSION, schema: null } } });
    renderApp('/about');
    await screen.findByText('abc1234');
    const schemaRow = screen.getByText('Database schema').nextElementSibling;
    expect(schemaRow?.textContent).toBe('unknown');
  });

  it('survives a network error', async () => {
    mockApi({ ...signedIn, '/api/version': 'network-error', '/api/health': 'network-error' });
    renderApp('/about');
    await waitFor(() => expect(screen.getByText('Cannot reach the API.')).toBeTruthy());
  });

  it('keeps health out of the picture when health is fine', async () => {
    mockApi({ ...signedIn, '/api/health': { status: 200, body: HEALTH_OK } });
    renderApp('/about');
    await screen.findByText('The API and the database are running.');
  });
});
