// SPDX-License-Identifier: AGPL-3.0-or-later
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { App } from '../src/App.js';

export type MockReply = { status: number; body?: unknown; text?: string } | 'network-error' | 'never';
export type MockRoute = MockReply | ((init: RequestInit, path: string) => MockReply);

export const ALICE = {
  id: 'u1',
  email: 'marcus@example.com',
  displayName: 'Marcus Hale',
  role: 'superadmin',
  personId: null,
} as const;
export const ME = { user: ALICE, treeName: 'Hale Family' };
/** The version the web app was built with (vite.config.ts reads it from package.json). */
export const WEB_VERSION = __WEB_VERSION__;
export const VERSION = {
  name: 'kinship-api',
  version: WEB_VERSION,
  commit: 'abc1234',
  buildDate: '2026-11-15T19:04:05Z',
  schema: 2,
};
export const HEALTH_OK = { status: 'ok', database: 'ok' };

/**
 * Answers fetch() by "METHOD /path", or by "/path" for any method. 'network-error' fails like a dead
 * server, 'never' hangs (to look at "in progress" states). Returns the mock, to inspect calls.
 */
export function mockApi(routes: Record<string, MockRoute>) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    // A key ending in * matches any path with that start (for example "GET /api/tree/*").
    const wildcard = Object.keys(routes).find(
      (key) => key.endsWith('*') && `${method} ${path}`.startsWith(key.slice(0, -1)),
    );
    const route = routes[`${method} ${path}`] ?? routes[path] ?? (wildcard ? routes[wildcard] : undefined);
    const reply = typeof route === 'function' ? route(init, path) : route;
    if (reply === undefined || reply === 'network-error') return Promise.reject(new TypeError('Failed to fetch'));
    if (reply === 'never') return new Promise<Response>(() => undefined);
    if (reply.status === 204) return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(new Response(reply.text ?? JSON.stringify(reply.body), { status: reply.status }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The calls made so far, as "METHOD /path". */
export function calls(fetchMock: ReturnType<typeof mockApi>): string[] {
  return fetchMock.mock.calls.map(([input, init]) => `${(init?.method ?? 'GET').toUpperCase()} ${String(input)}`);
}

/** A normal installation with Marcus signed in. */
export const signedIn: Record<string, MockRoute> = {
  '/api/setup/status': { status: 200, body: { needsSetup: false } },
  '/api/auth/me': { status: 200, body: ME },
  '/api/version': { status: 200, body: VERSION },
  '/api/health': { status: 200, body: HEALTH_OK },
};

/** A normal installation where nobody is signed in. */
export const signedOut: Record<string, MockRoute> = {
  ...signedIn,
  '/api/auth/me': { status: 401, body: { error: 'unauthenticated' } },
};

/** A fresh install that needs its first-run setup. */
export const needsSetup: Record<string, MockRoute> = {
  ...signedOut,
  '/api/setup/status': { status: 200, body: { needsSetup: true } },
};

export function renderApp(path: string) {
  // No retries and no caching between tests, so errors show up at once.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
