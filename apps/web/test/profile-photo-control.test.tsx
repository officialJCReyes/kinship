// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The one way to set a profile photo from an avatar (step 41): the camera button's menu (upload a new photo, or choose one of the
// person's own photos), where it appears, who sees it, and that every avatar updates afterwards without a reload.
import type { MediaListItem } from '@kinship/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, detailFor, haleRoutes, MEMBER, READER } from './family.js';
import type { MockRoute } from './helpers.js';
import { calls, mockApi, renderApp } from './helpers.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const ITEM = (id: string): MediaListItem => ({
  id,
  mime: 'image/jpeg',
  width: 800,
  height: 600,
  takenOn: null,
  createdAt: '2026-01-01T00:00:00Z',
  uploadedBy: 'u-admin',
  people: ['ben'],
  permissions: { edit: true, delete: true },
  shows: [],
});

/** Ben's detail with a profile photo (or none), and the routes a test adds. */
function benRoutes(me = ADMIN, photoMediaId: string | null = null, extra: Record<string, MockRoute> = {}) {
  const detail = detailFor(me, 'ben');
  return haleRoutes(me, {
    'GET /api/people/ben': { status: 200, body: { ...detail, person: { ...detail.person, photoMediaId } } },
    ...extra,
  });
}

async function openProfile(routes: Record<string, MockRoute>) {
  const fetchMock = mockApi(routes);
  renderApp('/people/ben');
  await screen.findByRole('heading', { name: 'Ben Hale' });
  return fetchMock;
}

const camera = (name: string | RegExp = /profile photo$/) => screen.getByRole('button', { name });
const openMenu = (name?: string | RegExp) => {
  fireEvent.click(camera(name));
  return screen.getByRole('menu');
};

describe('the camera button’s menu', () => {
  it('is a menu button with the two ways, and asks for the photos only when it is opened', async () => {
    const fetchMock = await openProfile(
      benRoutes(ADMIN, null, { 'GET /api/media?person=ben': { status: 200, body: { items: [], nextCursor: null } } }),
    );
    const button = camera('Add profile photo');
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(calls(fetchMock)).not.toContain('GET /api/media?person=ben');
    const menu = openMenu('Add profile photo');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Upload a new photo', expect.stringMatching(/^Choose from their photos/)]);
    await waitFor(() => expect(calls(fetchMock)).toContain('GET /api/media?person=ben'));
  });

  it('greys out "Choose from their photos" with a hint when the person has no photos', async () => {
    await openProfile(
      benRoutes(ADMIN, null, { 'GET /api/media?person=ben': { status: 200, body: { items: [], nextCursor: null } } }),
    );
    const menu = openMenu();
    const choose = within(menu).getByRole('menuitem', { name: /Choose from their photos/ });
    await waitFor(() => expect(choose.textContent).toContain('There are no photos of Ben Hale yet.'));
    expect(choose.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(choose);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is keyboard operable: Down opens it on the first item, arrows move, Escape gives focus back', async () => {
    await openProfile(
      benRoutes(ADMIN, null, { 'GET /api/media?person=ben': { status: 200, body: { items: [], nextCursor: null } } }),
    );
    const button = camera();
    button.focus();
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    const menu = screen.getByRole('menu');
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Upload a new photo'));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toMatch(/^Choose from their photos/);
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});

describe('Upload a new photo', () => {
  it('uses the Photos card’s upload, makes it the profile photo, then asks for the date taken', async () => {
    const detail = detailFor(ADMIN, 'ben');
    const fetchMock = await openProfile(
      benRoutes(ADMIN, null, {
        'GET /api/media?person=ben': { status: 200, body: { items: [], nextCursor: null } },
        'POST /api/people/ben/photos': { status: 201, body: { photo: ITEM('new1'), suggestedTakenOn: '2019-07-04' } },
        'PATCH /api/people/ben': { status: 200, body: { person: detail.person, warnings: [] } },
      }),
    );
    const menu = openMenu();
    const input = screen.getByLabelText('Add profile photo', { selector: 'input[type=file]' }) as HTMLInputElement;
    const opened = vi.spyOn(input, 'click');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Upload a new photo' }));
    expect(opened).toHaveBeenCalled();
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(1)], 'a.jpg', { type: 'image/jpeg' })] } });
    await screen.findByRole('dialog', { name: 'Photo added' });
    const all = calls(fetchMock);
    expect(all.indexOf('POST /api/people/ben/photos')).toBeLessThan(all.indexOf('PATCH /api/people/ben'));
    expect(screen.getByText('The photo says it was taken on', { exact: false })).toBeTruthy();
  });

  it('refuses a wrong file before sending it, and shows the same 503 message as the Photos card', async () => {
    const fetchMock = await openProfile(
      benRoutes(ADMIN, null, {
        'GET /api/media?person=ben': { status: 200, body: { items: [], nextCursor: null } },
        'POST /api/people/ben/photos': { status: 503, body: { error: 'files_unavailable', reason: 'key_missing' } },
      }),
    );
    const input = () => screen.getByLabelText('Add profile photo', { selector: 'input[type=file]' });
    fireEvent.change(input(), { target: { files: [new File(['x'], 'a.gif', { type: 'image/gif' })] } });
    expect((await screen.findByRole('alert')).textContent).toMatch(/Only JPEG, PNG and WebP/);
    expect(calls(fetchMock)).not.toContain('POST /api/people/ben/photos');
    fireEvent.change(input(), { target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/key/i));
  });
});

describe('Choose from their photos', () => {
  const twoPages = (): Record<string, MockRoute> => ({
    'GET /api/media?person=ben': { status: 200, body: { items: [ITEM('p1'), ITEM('p2')], nextCursor: 'p2' } },
    'GET /api/media?person=ben&cursor=p2': { status: 200, body: { items: [ITEM('p3')], nextCursor: null } },
  });

  it('shows their photos (small variants), marks the current one, and loads more', async () => {
    const fetchMock = await openProfile(benRoutes(ADMIN, 'p2', twoPages()));
    const menu = openMenu('Change profile photo');
    const choose = within(menu).getByRole('menuitem', { name: /Choose from their photos/ });
    await waitFor(() => expect(choose.getAttribute('aria-disabled')).toBeNull());
    fireEvent.click(choose);
    const dialog = await screen.findByRole('dialog', { name: 'Choose a profile photo for Ben Hale' });
    const tiles = within(dialog).getAllByRole('button', { name: /^(Use photo|Photo \d)/ });
    expect(tiles.map((tile) => tile.getAttribute('aria-label'))).toEqual([
      'Use photo 1 as the profile photo',
      'Photo 2, the profile photo now',
    ]);
    expect(tiles[1]!.getAttribute('aria-current')).toBe('true');
    expect(tiles[0]!.querySelector('img')!.getAttribute('src')).toBe('/api/media/p1/avatar');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(calls(fetchMock)).toContain('GET /api/media?person=ben&cursor=p2'));
    expect(await within(dialog).findByRole('button', { name: 'Use photo 3 as the profile photo' })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('sets the one picked with PATCH {photoMediaId}, says so, and refreshes the avatars without a reload', async () => {
    let photo = 'p2';
    const detail = detailFor(ADMIN, 'ben');
    const fetchMock = await openProfile({
      ...benRoutes(ADMIN, null, twoPages()),
      'GET /api/people/ben': () => ({
        status: 200,
        body: { ...detail, person: { ...detail.person, photoMediaId: photo } },
      }),
      'PATCH /api/people/ben': () => {
        photo = 'p1';
        return { status: 200, body: { person: { ...detail.person, photoMediaId: 'p1' }, warnings: [] } };
      },
    });
    expect(document.querySelector('.profile-avatar img')!.getAttribute('src')).toBe('/api/media/p2/avatar');
    const loads = () => calls(fetchMock).filter((c) => c === 'GET /api/people/ben').length;
    const before = loads();
    const menu = openMenu('Change profile photo');
    const choose = within(menu).getByRole('menuitem', { name: /Choose from their photos/ });
    await waitFor(() => expect(choose.getAttribute('aria-disabled')).toBeNull());
    fireEvent.click(choose);
    const dialog = await screen.findByRole('dialog', { name: 'Choose a profile photo for Ben Hale' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use photo 1 as the profile photo' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const patch = [...fetchMock.mock.calls].find(
      ([input, init]) => String(input) === '/api/people/ben' && init?.method === 'PATCH',
    );
    expect(JSON.parse(String(patch![1]!.body))).toEqual({ photoMediaId: 'p1' });
    expect(await screen.findByText('Profile photo changed.')).toBeTruthy();
    expect(loads()).toBeGreaterThan(before);
    await waitFor(() =>
      expect(document.querySelector('.profile-avatar img')!.getAttribute('src')).toBe('/api/media/p1/avatar'),
    );
  });

  it('closes without a request when the current photo is picked', async () => {
    const fetchMock = await openProfile(benRoutes(ADMIN, 'p2', twoPages()));
    const menu = openMenu('Change profile photo');
    const choose = within(menu).getByRole('menuitem', { name: /Choose from their photos/ });
    await waitFor(() => expect(choose.getAttribute('aria-disabled')).toBeNull());
    fireEvent.click(choose);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Photo 2, the profile photo now' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls(fetchMock)).not.toContain('PATCH /api/people/ben');
  });
});

describe('Remove profile photo (backlog 8)', () => {
  const media = { 'GET /api/media?person=ben': { status: 200, body: { items: [ITEM('p2')], nextCursor: null } } };

  it('is offered only while there is a profile photo', async () => {
    await openProfile(benRoutes(ADMIN, null, media));
    const items = () =>
      within(screen.getByRole('menu'))
        .getAllByRole('menuitem')
        .map((item) => item.textContent);
    openMenu('Add profile photo');
    expect(items()).not.toContain('Remove profile photo');
    cleanup();
    vi.unstubAllGlobals();
    await openProfile(benRoutes(ADMIN, 'p2', media));
    openMenu('Change profile photo');
    expect(items()).toContain('Remove profile photo');
  });

  it('asks first; Cancel sends nothing', async () => {
    const fetchMock = await openProfile(benRoutes(ADMIN, 'p2', media));
    fireEvent.click(within(openMenu('Change profile photo')).getByRole('menuitem', { name: 'Remove profile photo' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove Ben Hale’s profile photo?' });
    expect(dialog.textContent).toContain('The photo stays in Ben Hale’s photos and on the Media page.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls(fetchMock)).not.toContain('PATCH /api/people/ben');
  });

  it('unsets only the profile photo with PATCH {photoMediaId: null}; the avatar goes back to initials, nothing is deleted', async () => {
    let photo: string | null = 'p2';
    const detail = detailFor(ADMIN, 'ben');
    const fetchMock = await openProfile({
      ...benRoutes(ADMIN, 'p2', media),
      'GET /api/people/ben': () => ({
        status: 200,
        body: { ...detail, person: { ...detail.person, photoMediaId: photo } },
      }),
      'PATCH /api/people/ben': () => {
        photo = null;
        return { status: 200, body: { person: { ...detail.person, photoMediaId: null }, warnings: [] } };
      },
    });
    expect(document.querySelector('.profile-avatar img')).not.toBeNull();
    fireEvent.click(within(openMenu('Change profile photo')).getByRole('menuitem', { name: 'Remove profile photo' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove profile photo' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const patch = [...fetchMock.mock.calls].find(
      ([input, init]) => String(input) === '/api/people/ben' && init?.method === 'PATCH',
    );
    expect(JSON.parse(String(patch![1]!.body))).toEqual({ photoMediaId: null });
    expect(await screen.findByText('Profile photo removed. The photo is still in their photos.')).toBeTruthy();
    await waitFor(() => expect(document.querySelector('.profile-avatar img')).toBeNull());
    expect(camera('Add profile photo')).toBeTruthy();
    // Not unlinked from the person and not deleted.
    expect(calls(fetchMock).some((c) => c.startsWith('DELETE '))).toBe(false);
  });

  it('is on the tree’s person panel too, and a User never sees it', async () => {
    mockApi(benRoutes(ADMIN, 'p2', media));
    renderApp('/tree/ben');
    const panel = await screen.findByRole('complementary', { name: 'Selected person' });
    const button = await within(panel).findByRole('button', { name: 'Change profile photo' });
    fireEvent.click(button);
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Remove profile photo' })).toBeTruthy();
    cleanup();
    vi.unstubAllGlobals();
    await openProfile(benRoutes(READER, 'p2', media));
    expect(screen.queryByRole('button', { name: /profile photo$/ })).toBeNull();
  });
});

describe('where the camera is, and who sees it', () => {
  it('is on the tree’s person panel, on the large avatar', async () => {
    mockApi(benRoutes(ADMIN));
    renderApp('/tree/ben');
    const panel = await screen.findByRole('complementary', { name: 'Selected person' });
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Add profile photo' })).toBeTruthy());
    expect(within(panel).getByRole('button', { name: 'Add profile photo' }).closest('.profile-avatar')).not.toBeNull();
  });

  it('a User sees no camera, on the profile or on the panel', async () => {
    await openProfile(benRoutes(READER));
    expect(screen.queryByRole('button', { name: /profile photo$/ })).toBeNull();
    cleanup();
    mockApi(benRoutes(READER));
    renderApp('/tree/ben');
    const panel = await screen.findByRole('complementary', { name: 'Selected person' });
    await screen.findAllByRole('button', { name: /^Ben Hale/ });
    expect(within(panel).queryByRole('button', { name: /profile photo$/ })).toBeNull();
  });

  it('a Member sees it for the person they may edit (their own), and not for someone else', async () => {
    mockApi(haleRoutes(MEMBER));
    renderApp('/people/marcus');
    await screen.findByRole('heading', { name: 'Marcus Hale' });
    expect(camera()).toBeTruthy();
    cleanup();
    await openProfile(benRoutes(MEMBER));
    expect(screen.queryByRole('button', { name: /profile photo$/ })).toBeNull();
  });
});
