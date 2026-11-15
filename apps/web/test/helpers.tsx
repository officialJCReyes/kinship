// SPDX-License-Identifier: AGPL-3.0-or-later
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { App } from '../src/App.js';

/** Answers fetch() by path. A value of 'network-error' makes the request fail like a dead server. */
export function mockApi(routes: Record<string, { status: number; body?: unknown; text?: string } | 'network-error'>) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const path = String(input);
    const route = routes[path];
    if (route === undefined || route === 'network-error') return Promise.reject(new TypeError('Failed to fetch'));
    const payload = route.text ?? JSON.stringify(route.body);
    return Promise.resolve(new Response(payload, { status: route.status }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

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
