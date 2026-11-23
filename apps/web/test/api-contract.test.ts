// SPDX-License-Identifier: AGPL-3.0-or-later
import { ACCOUNT_ROUTES, CSRF_HEADER, MEDIA_ROUTES, PEOPLE_ROUTES } from '@kinship/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '../src/api.js';

afterEach(() => vi.unstubAllGlobals());

function matches(route: { method: string; path: string }, method: string, path: string): boolean {
  if (route.method !== method) return false;
  const pattern = new RegExp(`^${route.path.replace(/:[A-Za-z]+/g, '[^/?]+')}$`);
  return pattern.test(path);
}

describe('the web API client and the shared route table', () => {
  it('only calls routes that exist in PEOPLE_ROUTES and ACCOUNT_ROUTES, and sends the CSRF header on every change', async () => {
    const seen: { method: string; path: string; csrf: boolean }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
        const headers = (init.headers ?? {}) as Record<string, string>;
        seen.push({
          method: (init.method ?? 'GET').toUpperCase(),
          path: String(input).split('?')[0] ?? '',
          csrf: CSRF_HEADER in headers,
        });
        return Promise.resolve(
          new Response(init.method === 'DELETE' ? null : '{}', { status: init.method === 'DELETE' ? 204 : 200 }),
        );
      }),
    );
    const person = { givenName: 'A', surname: 'B' };
    await api.listPeople({ q: 'a', cursor: 'c', limit: 5 });
    await api.fetchPerson('p1');
    await api.fetchTree('p1', { up: 1, down: 1, collateral: true });
    await api.createPerson(person);
    await api.updatePerson('p1', person);
    await api.deletePerson('p1', true);
    await api.addChild('p1', { child: person });
    await api.addParent('p1', { parentId: 'p2' });
    await api.removeParent('p1', 'p2');
    await api.updateParentLink('p1', 'adoptive', { link: { value: '1938' } });
    await api.createUnion({ partnerIds: ['a', 'b'], status: 'married' });
    await api.updateUnion('u1', { status: 'divorced' });
    await api.deleteUnion('u1');
    await api.fetchAccounts();
    // The stub answers 200 to everything; these three expect 201 or 204, so the failure is ignored: only the call is checked.
    await api.createInvitation({ email: 'a@b.cc', role: 'user' }).catch(() => undefined);
    await api.regenerateLink('l1');
    await api.revokeLink('l1').catch(() => undefined);
    await api.createSetPasswordLink('u1').catch(() => undefined);

    expect(seen).toHaveLength(18);
    for (const call of seen) {
      expect(
        [...PEOPLE_ROUTES, ...ACCOUNT_ROUTES].some((route) => matches(route, call.method, call.path)),
        `${call.method} ${call.path}`,
      ).toBe(true);
      if (call.method !== 'GET') expect(call.csrf, `${call.method} ${call.path}`).toBe(true);
    }
  });

  it('calls the photo routes MEDIA_ROUTES lists, with the CSRF header on every change', async () => {
    const seen: { method: string; path: string; csrf: boolean }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
        const headers = (init.headers ?? {}) as Record<string, string>;
        seen.push({
          method: (init.method ?? 'GET').toUpperCase(),
          path: String(input).split('?')[0] ?? '',
          csrf: CSRF_HEADER in headers,
        });
        const status = init.method === 'DELETE' ? 204 : init.method === 'POST' ? 201 : 200;
        return Promise.resolve(new Response(status === 204 ? null : '{}', { status }));
      }),
    );
    await api.fetchPersonPhotos('p1');
    await api.fetchMedia({ person: 'p1', cursor: 'c1' });
    await api.uploadPhoto('p1', new Blob(['x'], { type: 'image/png' }));
    await api.removePhotoFromPerson('p1', 'm1');
    await api.updateMedia('m1', { takenOn: '2019' });
    await api.deleteMedia('m1');
    expect(seen).toHaveLength(6);
    for (const call of seen) {
      expect(
        MEDIA_ROUTES.some((route) => matches(route, call.method, call.path)),
        `${call.method} ${call.path}`,
      ).toBe(true);
      if (call.method !== 'GET') expect(call.csrf, `${call.method} ${call.path}`).toBe(true);
    }
  });
});
