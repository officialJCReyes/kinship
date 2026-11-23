// SPDX-License-Identifier: AGPL-3.0-or-later
//
// "Photo actions" on a thumbnail (step 41): set as profile photo straight from the Media page and a profile's Photos card,
// for the people the account may edit, checked only when the menu opens; keyboard use; the refresh; the "Profile photo" marker.
import type { MediaInfo, MediaListItem, RelPerson } from '@kinship/shared';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, detailFor, haleRoutes, MEMBER, PEOPLE, READER } from './family.js';
import type { MockRoute } from './helpers.js';
import { calls, mockApi, renderApp } from './helpers.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const rel = (id: string, photoMediaId: string | null = null): RelPerson =>
  ({ ...PEOPLE.find((candidate) => candidate.id === id)!, photoMediaId }) as RelPerson;
const INFO = (id: string, people: string[]): MediaInfo => ({
  id,
  mime: 'image/jpeg',
  width: 800,
  height: 600,
  takenOn: null,
  createdAt: '2026-01-01T00:00:00Z',
  uploadedBy: 'u-admin',
  people,
  permissions: { edit: true, delete: true },
});
const ITEM = (id: string, shows: RelPerson[]): MediaListItem => ({
  ...INFO(
    id,
    shows.map((p) => p.id),
  ),
  shows,
});

function media(me = ADMIN, items: MediaListItem[], extra: Record<string, MockRoute> = {}) {
  const fetchMock = mockApi(
    haleRoutes(me, {
      '/api/media': { status: 200, body: { items, nextCursor: null } },
      'PATCH /api/people/ben': { status: 200, body: { person: detailFor(me, 'ben').person, warnings: [] } },
      'PATCH /api/people/walter': { status: 200, body: { person: detailFor(me, 'walter').person, warnings: [] } },
      'PATCH /api/people/marcus': { status: 200, body: { person: detailFor(me, 'marcus').person, warnings: [] } },
      ...extra,
    }),
  );
  renderApp('/media');
  return fetchMock;
}

const actions = async () => {
  const grid = await screen.findByRole('list', { name: 'Media' });
  return within(grid).queryAllByRole('button', { name: 'Photo actions' });
};
const menuItems = async () => {
  const menu = screen.getByRole('menu', { name: 'Photo actions' });
  // Wait for the permission check to end.
  await waitFor(() => expect(within(menu).queryByText('Checking whose profile photo you may change…')).toBeNull());
  return within(menu).getAllByRole('menuitem');
};
const patchBody = (fetchMock: ReturnType<typeof mockApi>, path: string) => {
  const call = [...fetchMock.mock.calls].find(([input, init]) => String(input) === path && init?.method === 'PATCH');
  return call ? JSON.parse(String(call[1]!.body)) : undefined;
};

describe('Photo actions on the Media page', () => {
  it('a photo of one person: one item, "Set as profile photo", with the viewer’s PATCH; a notice names them', async () => {
    const fetchMock = media(ADMIN, [ITEM('a', [rel('ben')])]);
    const [button] = await actions();
    expect(button!.getAttribute('aria-haspopup')).toBe('menu');
    fireEvent.click(button!);
    const items = await menuItems();
    expect(items.map((item) => item.textContent)).toEqual(['Set as profile photo']);
    const mediaLoads = calls(fetchMock).filter((c) => c === 'GET /api/media').length;
    fireEvent.click(items[0]!);
    await waitFor(() => expect(patchBody(fetchMock, '/api/people/ben')).toEqual({ photoMediaId: 'a' }));
    expect(await screen.findByText('Profile photo set for Ben Hale.')).toBeTruthy();
    // Every people query is refreshed (the list, the avatars): no reload.
    await waitFor(() =>
      expect(calls(fetchMock).filter((c) => c === 'GET /api/media').length).toBeGreaterThan(mediaLoads),
    );
  });

  it('a photo of several people: one item per person, "Set as profile photo for <Name>"', async () => {
    const fetchMock = media(ADMIN, [ITEM('b', [rel('ben'), rel('walter')])]);
    fireEvent.click((await actions())[0]!);
    const items = await menuItems();
    expect(items.map((item) => item.textContent)).toEqual([
      'Set as profile photo for Ben Hale',
      'Set as profile photo for Walter Hale',
    ]);
    fireEvent.click(items[1]!);
    await waitFor(() => expect(patchBody(fetchMock, '/api/people/walter')).toEqual({ photoMediaId: 'b' }));
    expect(await screen.findByText('Profile photo set for Walter Hale.')).toBeTruthy();
  });

  it('asks who may be edited only when a menu is opened, never one request per thumbnail', async () => {
    const fetchMock = media(ADMIN, [ITEM('a', [rel('ben')]), ITEM('b', [rel('walter')]), ITEM('c', [rel('marcus')])]);
    expect(await actions()).toHaveLength(3);
    const details = () => calls(fetchMock).filter((c) => /^GET \/api\/people\/[a-z]+$/.test(c));
    expect(details()).toEqual([]);
    fireEvent.click((await actions())[1]!);
    await menuItems();
    expect(details()).toEqual(['GET /api/people/walter']);
  });

  it('a User sees no button at all', async () => {
    media(READER, [ITEM('a', [rel('ben')]), ITEM('b', [rel('ben'), rel('walter')])]);
    await screen.findByRole('button', { name: 'Open photo of Ben Hale' });
    expect(await actions()).toHaveLength(0);
  });

  it('a Member gets items only for the people they may edit, and says so when that is nobody', async () => {
    media(MEMBER, [ITEM('a', [rel('marcus'), rel('ben')]), ITEM('b', [rel('ben')])]);
    const [both, benOnly] = await actions();
    fireEvent.click(both!);
    expect((await menuItems()).map((item) => item.textContent)).toEqual(['Set as profile photo for Marcus Hale']);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.click(benOnly!);
    const [nobody] = await menuItems();
    expect(nobody!.getAttribute('aria-disabled')).toBe('true');
    expect(nobody!.textContent).toContain('You cannot change the profile photo of anyone in this photo.');
  });

  it('is keyboard operable: Down opens it, the first item has focus, Enter chooses', async () => {
    const fetchMock = media(ADMIN, [ITEM('a', [rel('ben')])]);
    const [button] = await actions();
    button!.focus();
    fireEvent.keyDown(button!, { key: 'ArrowDown' });
    await menuItems();
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Set as profile photo'));
    // A menu item is a button: Enter on it is a click.
    fireEvent.click(document.activeElement!);
    await waitFor(() => expect(patchBody(fetchMock, '/api/people/ben')).toEqual({ photoMediaId: 'a' }));
    // Escape on an open menu gives focus back to the button.
    fireEvent.keyDown(button!, { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(document.activeElement).toBe(button);
  });

  it('marks a photo that is someone’s profile photo, and offers nothing new for that person', async () => {
    media(ADMIN, [ITEM('a', [rel('ben', 'a'), rel('walter')]), ITEM('b', [rel('ben', 'a')])], {
      'GET /api/people/ben': {
        status: 200,
        body: { ...detailFor(ADMIN, 'ben'), person: { ...detailFor(ADMIN, 'ben').person, photoMediaId: 'a' } },
      },
    });
    const tile = await screen.findByRole('button', {
      name: 'Open photo of Ben Hale, Walter Hale, the profile photo of Ben Hale',
    });
    expect(tile.querySelector('.photo-badge')!.textContent).toBe('Profile photo');
    expect(screen.getByRole('button', { name: 'Open photo of Ben Hale' }).querySelector('.photo-badge')).toBeNull();
    fireEvent.click((await actions())[0]!);
    const [ben, walter] = await menuItems();
    expect(ben!.getAttribute('aria-disabled')).toBe('true');
    expect(ben!.textContent).toContain('It is already the profile photo.');
    expect(walter!.getAttribute('aria-disabled')).toBeNull();
  });
});

describe('Photo actions on a profile’s Photos card', () => {
  function card(me = ADMIN, items: MediaInfo[], photoMediaId: string | null = null) {
    const detail = detailFor(me, 'ben');
    const fetchMock = mockApi(
      haleRoutes(me, {
        'GET /api/people/ben': { status: 200, body: { ...detail, person: { ...detail.person, photoMediaId } } },
        'GET /api/people/ben/photos': { status: 200, body: { items } },
        'PATCH /api/people/ben': { status: 200, body: { person: detail.person, warnings: [] } },
      }),
    );
    renderApp('/people/ben');
    return fetchMock;
  }
  const cardActions = async () =>
    within(await screen.findByRole('list', { name: 'Photos' })).queryAllByRole('button', { name: 'Photo actions' });

  it('sets the profile photo from the grid, without opening the viewer, and refreshes the avatar', async () => {
    const fetchMock = card(ADMIN, [INFO('p1', ['ben']), INFO('p2', ['ben'])], 'p2');
    const loads = () => calls(fetchMock).filter((c) => c === 'GET /api/people/ben').length;
    const [first] = await cardActions();
    fireEvent.click(first!);
    const items = await menuItems();
    expect(items.map((item) => item.textContent)).toEqual(['Set as profile photo']);
    const before = loads();
    fireEvent.click(items[0]!);
    await waitFor(() => expect(patchBody(fetchMock, '/api/people/ben')).toEqual({ photoMediaId: 'p1' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByText('Profile photo set for Ben Hale.')).toBeTruthy();
    await waitFor(() => expect(loads()).toBeGreaterThan(before));
    // The profile photo's tile keeps its marker.
    expect(
      screen.getByRole('button', { name: 'Open photo 2 of 2, the profile photo' }).querySelector('.photo-badge')!
        .textContent,
    ).toBe('Profile photo');
  });

  it('shows no button to a User, nor to a Member on someone they may not edit', async () => {
    card(READER, [INFO('p1', ['ben'])]);
    expect(await cardActions()).toHaveLength(0);
    cleanup();
    card(MEMBER, [INFO('p1', ['ben'])]);
    expect(await cardActions()).toHaveLength(0);
  });
});

describe('the Photo actions button’s visibility', () => {
  const css = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');

  it('is always shown, and is hidden until hover or keyboard focus only where the device can hover on a wide screen', () => {
    const hoverBlock = /@media \(hover: hover\) and \(min-width: 641px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(hoverBlock).toMatch(/\.photo-actions \{\s*opacity: 0;/);
    expect(hoverBlock).toMatch(/\.photo-grid > li:hover \.photo-actions/);
    expect(hoverBlock).toMatch(/\.photo-grid > li:focus-within \.photo-actions/);
    expect(hoverBlock).toMatch(/\.photo-actions:has\(\[aria-expanded='true'\]\)/);
    // Outside that block nothing hides it.
    expect(css.replace(hoverBlock, '')).not.toMatch(
      /\.photo-actions[^{]*\{[^}]*(opacity: 0|display: none|visibility: hidden)/,
    );
  });
});
