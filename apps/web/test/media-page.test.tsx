// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Media page and its nav tab (step 37e).
import type { MediaListItem, RelPerson } from '@kinship/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, detailFor, haleRoutes, MEMBER, PEOPLE, READER } from './family.js';
import type { MockRoute } from './helpers.js';
import { calls, mockApi, renderApp } from './helpers.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const rel = (id: string): RelPerson => {
  const p = PEOPLE.find((candidate) => candidate.id === id)!;
  return { ...p } as RelPerson;
};
const ITEM = (id: string, people: string[], extra: Partial<MediaListItem> = {}): MediaListItem => ({
  id,
  mime: 'image/jpeg',
  width: 800,
  height: 600,
  takenOn: null,
  createdAt: '2026-01-01T00:00:00Z',
  uploadedBy: 'u-admin',
  people,
  permissions: { edit: true, delete: true },
  shows: people.map(rel),
  ...extra,
});

function open(me = ADMIN, extra: Record<string, MockRoute> = {}) {
  const fetchMock = mockApi(haleRoutes(me, extra));
  renderApp('/media');
  return fetchMock;
}

describe('the Media tab', () => {
  it('is in the main navigation for every role and opens the page', async () => {
    for (const me of [ADMIN, MEMBER, READER]) {
      open(me, { '/api/media': { status: 200, body: { items: [], nextCursor: null } } });
      const nav = await screen.findByRole('navigation', { name: 'Main' });
      const tab = within(nav).getByRole('link', { name: 'Media' });
      expect(tab.getAttribute('href')).toBe('/media');
      expect(await screen.findByRole('heading', { name: 'Media', level: 1 })).toBeTruthy();
      cleanup();
      vi.unstubAllGlobals();
    }
  });
});

describe('the Media page', () => {
  it('shows a grid of small pictures, each named for the people in it, with no captions, and no upload', async () => {
    open(ADMIN, {
      '/api/media': {
        status: 200,
        body: { items: [ITEM('a', ['ben']), ITEM('b', ['ben', 'walter']), ITEM('c', [])], nextCursor: null },
      },
    });
    const grid = await screen.findByRole('list', { name: 'Media' });
    const tiles = within(grid).getAllByRole('button', { name: /^Open photo/ });
    expect(tiles.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Open photo of Ben Hale',
      'Open photo of Ben Hale, Walter Hale',
      'Open photo',
    ]);
    const imgs = grid.querySelectorAll('img');
    expect(imgs[0]!.getAttribute('src')).toBe('/api/media/a/avatar');
    expect(imgs[0]!.getAttribute('loading')).toBe('lazy');
    expect(imgs[0]!.getAttribute('alt')).toBe('');
    expect(screen.queryByRole('button', { name: /add photo|upload/i })).toBeNull();
    expect(document.querySelector('input[type=file]')).toBeNull();
  });

  it('says so when there are no photos', async () => {
    open(ADMIN, { '/api/media': { status: 200, body: { items: [], nextCursor: null } } });
    expect(await screen.findByText('No photos yet. Open a person to add the first one.')).toBeTruthy();
  });

  it('loads more with the cursor, and the button goes away on the last page', async () => {
    const fetchMock = open(ADMIN, {
      '/api/media': { status: 200, body: { items: [ITEM('a', ['ben'])], nextCursor: 'a' } },
      '/api/media?cursor=a': { status: 200, body: { items: [ITEM('b', ['ben'])], nextCursor: null } },
    });
    await screen.findByRole('list', { name: 'Media' });
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('list', { name: 'Media' })).getAllByRole('button', { name: /^Open photo/ }),
      ).toHaveLength(2),
    );
    expect(calls(fetchMock)).toContain('GET /api/media?cursor=a');
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('filters by person with the person picker, and can go back to everyone', async () => {
    const fetchMock = open(ADMIN, {
      '/api/media': { status: 200, body: { items: [ITEM('a', ['ben']), ITEM('b', ['walter'])], nextCursor: null } },
      '/api/media?person=ben': { status: 200, body: { items: [ITEM('a', ['ben'])], nextCursor: null } },
      '/api/people?q=ben&limit=8': {
        status: 200,
        body: { items: [PEOPLE.find((p) => p.id === 'ben')], nextCursor: null },
      },
    });
    await screen.findByRole('list', { name: 'Media' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Show photos of' }), { target: { value: 'ben' } });
    fireEvent.click(await screen.findByRole('option', { name: /Ben Hale/ }));
    await waitFor(() => expect(calls(fetchMock)).toContain('GET /api/media?person=ben'));
    await waitFor(() =>
      expect(
        within(screen.getByRole('list', { name: 'Media' })).getAllByRole('button', { name: /^Open photo/ }),
      ).toHaveLength(1),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(await screen.findByRole('combobox', { name: 'Show photos of' })).toBeTruthy();
  });

  it('a person with no photos gets a polite empty state', async () => {
    open(ADMIN, {
      '/api/media': { status: 200, body: { items: [ITEM('a', ['ben'])], nextCursor: null } },
      '/api/media?person=walter': { status: 200, body: { items: [], nextCursor: null } },
      '/api/people?q=walter&limit=8': {
        status: 200,
        body: { items: [PEOPLE.find((p) => p.id === 'walter')], nextCursor: null },
      },
    });
    await screen.findByRole('list', { name: 'Media' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Show photos of' }), { target: { value: 'walter' } });
    fireEvent.click(await screen.findByRole('option', { name: /Walter Hale/ }));
    expect(await screen.findByText('Walter Hale is not in any photo yet.')).toBeTruthy();
  });
});

describe('the viewer on the Media page', () => {
  const routes = (items: MediaListItem[], me = ADMIN, extra: Record<string, MockRoute> = {}) =>
    open(me, {
      '/api/media': { status: 200, body: { items, nextCursor: null } },
      ...extra,
    });

  it('a photo of one person offers Set as profile photo, Remove from them and Delete, and says who it shows', async () => {
    routes([ITEM('a', ['ben'])]);
    fireEvent.click(await screen.findByRole('button', { name: 'Open photo of Ben Hale' }));
    const dialog = await screen.findByRole('dialog', { name: 'Photo of Ben Hale' });
    expect(within(dialog).getByText(/Shows:/).parentElement!.textContent).toContain('Ben Hale');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Set as profile photo' })).toBeTruthy());
    expect(within(dialog).getByRole('button', { name: 'Remove from Ben Hale' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Delete photo' })).toBeTruthy();
  });

  it('sets the profile photo, removes from the person and deletes, each with the call the profile uses', async () => {
    const fetchMock = routes([ITEM('a', ['ben'])], ADMIN, {
      'PATCH /api/people/ben': { status: 200, body: { person: detailFor(ADMIN, 'ben').person, warnings: [] } },
      'DELETE /api/people/ben/photos/a': { status: 204 },
      'DELETE /api/media/a': { status: 204 },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Open photo of Ben Hale' }));
    let dialog = await screen.findByRole('dialog', { name: 'Photo of Ben Hale' });
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Set as profile photo' }));
    await waitFor(() => expect(calls(fetchMock)).toContain('PATCH /api/people/ben'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(await screen.findByRole('button', { name: 'Open photo of Ben Hale' }));
    dialog = await screen.findByRole('dialog', { name: 'Photo of Ben Hale' });
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Remove from Ben Hale' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: /^Remove this photo/ })).getByRole('button', {
        name: 'Remove from Ben Hale',
      }),
    );
    await waitFor(() => expect(calls(fetchMock)).toContain('DELETE /api/people/ben/photos/a'));

    fireEvent.click(await screen.findByRole('button', { name: 'Open photo of Ben Hale' }));
    dialog = await screen.findByRole('dialog', { name: 'Photo of Ben Hale' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete photo' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Delete this photo?' })).getByRole('button', {
        name: 'Delete photo',
      }),
    );
    await waitFor(() => expect(calls(fetchMock)).toContain('DELETE /api/media/a'));
  });

  it('a photo of two people, opened with no filter, offers only the date and Delete', async () => {
    routes([ITEM('b', ['ben', 'walter'])]);
    fireEvent.click(await screen.findByRole('button', { name: 'Open photo of Ben Hale, Walter Hale' }));
    const dialog = await screen.findByRole('dialog', { name: 'Photo of Ben Hale, Walter Hale' });
    expect(within(dialog).getByRole('button', { name: 'Delete photo' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Change date' })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Set as profile photo' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /^Remove from/ })).toBeNull();
    expect(
      within(dialog)
        .getAllByRole('link')
        .map((l) => l.getAttribute('href')),
    ).toEqual(['/people/ben', '/people/walter']);
  });

  it('shows only what the permissions in the response allow', async () => {
    routes([ITEM('a', ['ben'], { permissions: { edit: false, delete: false } })], READER);
    fireEvent.click(await screen.findByRole('button', { name: 'Open photo of Ben Hale' }));
    const dialog = await screen.findByRole('dialog', { name: 'Photo of Ben Hale' });
    expect(within(dialog).queryByRole('button', { name: 'Delete photo' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Change date' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Set as profile photo' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /^Remove from/ })).toBeNull();
  });
});
