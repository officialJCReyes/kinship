// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Photos in the web (step 37d): the Avatar, the Photos card, uploading with a clear message for each failure, date taken, the
// viewer's actions, and the photo count in the delete-person dialog.
import type { MediaInfo } from '@kinship/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Avatar } from '../src/components/Avatar.js';
import { ADMIN, detailFor, haleRoutes, MEMBER, READER } from './family.js';
import type { MockRoute } from './helpers.js';
import { calls, mockApi, renderApp } from './helpers.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PHOTO = (id: string, extra: Partial<MediaInfo> = {}): MediaInfo => ({
  id,
  mime: 'image/jpeg',
  width: 800,
  height: 600,
  takenOn: null,
  createdAt: '2026-01-01T00:00:00Z',
  uploadedBy: 'u-admin',
  people: ['ben'],
  permissions: { edit: true, delete: true },
  ...extra,
});

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const file = (type = 'image/jpeg', size = 1000, name = 'a.jpg') => {
  const f = new File([new Uint8Array(1)], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};
const choose = (label: string | RegExp, f: File) =>
  fireEvent.change(screen.getByLabelText(label, { selector: 'input[type=file]' }), { target: { files: [f] } });

async function profile(
  extra: Record<string, MockRoute> = {},
  items: MediaInfo[] = [],
  me = ADMIN,
  personExtra: Record<string, unknown> = {},
) {
  const detail = detailFor(me, 'ben');
  const fetchMock = mockApi(
    haleRoutes(me, {
      'GET /api/people/ben': { status: 200, body: { ...detail, person: { ...detail.person, ...personExtra } } },
      'GET /api/people/ben/photos': { status: 200, body: { items } },
      ...extra,
    }),
  );
  renderApp('/people/ben');
  await screen.findByRole('heading', { name: 'Ben Hale' });
  return fetchMock;
}

const lastBody = (fetchMock: ReturnType<typeof mockApi>, key: string) => {
  const call = [...fetchMock.mock.calls]
    .reverse()
    .find(([input, init]) => `${(init?.method ?? 'GET').toUpperCase()} ${String(input)}` === key);
  return call?.[1];
};

describe('Avatar', () => {
  it('shows initials with no photo, and a picture with alt="" over them when there is one', () => {
    const { container, rerender } = render(<Avatar photoMediaId={null} initials="BH" />);
    expect(container.textContent).toBe('BH');
    expect(container.querySelector('img')).toBeNull();
    rerender(<Avatar photoMediaId="m1" initials="BH" />);
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('/api/media/m1/avatar');
    expect(img.getAttribute('alt')).toBe('');
    // Decoration only: the name is always written beside it.
    expect(container.firstElementChild!.getAttribute('aria-hidden')).toBe('true');
  });

  it('falls back to the initials when the picture cannot be loaded, and tries a different photo again', () => {
    const { container, rerender } = render(<Avatar photoMediaId="m1" initials="BH" />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('BH');
    rerender(<Avatar photoMediaId="m2" initials="BH" />);
    expect(container.querySelector('img')!.getAttribute('src')).toBe('/api/media/m2/avatar');
  });
});

describe('where avatars show', () => {
  it('the profile head, the account button and the People list carry the photo', async () => {
    const detail = detailFor(ADMIN, 'ben');
    mockApi(
      haleRoutes(ADMIN, {
        'GET /api/people/ben': { status: 200, body: { ...detail, person: { ...detail.person, photoMediaId: 'pm1' } } },
        'GET /api/people/ben/photos': { status: 200, body: { items: [PHOTO('pm1')] } },
      }),
    );
    renderApp('/people/ben');
    await screen.findByRole('heading', { name: 'Ben Hale' });
    const head = document.querySelector('.profile-avatar')!;
    expect(head.querySelector('img')!.getAttribute('src')).toBe('/api/media/pm1/avatar');
    expect(head.querySelector('img')!.getAttribute('alt')).toBe('');
  });

  it('a person with no photo shows initials on the profile', async () => {
    await profile();
    expect(document.querySelector('.profile-avatar .ava')!.textContent).toBe('BH');
    expect(document.querySelector('.profile-avatar img')).toBeNull();
  });
});

describe('the Photos card', () => {
  it('lists the photos as buttons, marks the profile photo, and is empty politely', async () => {
    await profile({}, [PHOTO('a'), PHOTO('b')], ADMIN, { photoMediaId: 'b' });
    const grid = await screen.findByRole('list', { name: 'Photos' });
    const tiles = within(grid).getAllByRole('button');
    expect(tiles.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Open photo 1 of 2',
      'Open photo 2 of 2, the profile photo',
    ]);
    expect(grid.querySelectorAll('img').length).toBe(2);
    cleanup();
    vi.unstubAllGlobals();
    await profile();
    expect(await screen.findByText('No photos yet. Add the first one.')).toBeTruthy();
  });

  it('someone who may not change the person sees the photos but no way to add one', async () => {
    await profile({}, [PHOTO('a', { permissions: { edit: false, delete: false } })], READER);
    await screen.findByRole('list', { name: 'Photos' });
    expect(screen.queryByRole('button', { name: 'Add photo' })).toBeNull();
    expect(document.querySelector('input[type=file]')).toBeNull();
  });

  it('the file input accepts exactly JPEG, PNG and WebP', async () => {
    await profile();
    await screen.findByRole('button', { name: 'Add photo' });
    const inputs = document.querySelectorAll<HTMLInputElement>('input[type=file]');
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) expect(input.getAttribute('accept')).toBe('image/jpeg,image/png,image/webp');
  });
});

describe('uploading', () => {
  const OK = (id = 'new1', suggested: string | null = null): MockRoute => ({
    status: 201,
    body: { photo: PHOTO(id), suggestedTakenOn: suggested },
  });

  it('sends the file itself with its type, then asks for the date taken with what the picture said filled in', async () => {
    const fetchMock = await profile({
      'POST /api/people/ben/photos': OK('new1', '2019-07-04'),
      'PATCH /api/media/new1': { status: 200, body: PHOTO('new1', { takenOn: '2019-07-04' }) },
    });
    const f = file('image/png', 2000, 'x.png');
    choose('Choose a photo (JPEG, PNG or WebP, up to 10 MB)', f);
    const dialog = await screen.findByRole('dialog', { name: 'Photo added' });
    const init = lastBody(fetchMock, 'POST /api/people/ben/photos')!;
    expect(init.body).toBe(f);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('image/png');
    const field = within(dialog).getByLabelText('Date taken') as HTMLInputElement;
    expect(field.value).toBe('2019-07-04');
    expect(within(dialog).getByText(/The photo says it was taken on/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save date' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(JSON.parse(String(lastBody(fetchMock, 'PATCH /api/media/new1')!.body))).toEqual({ takenOn: '2019-07-04' });
  });

  it('leaving the date empty saves nothing, and an invalid date is refused in the form', async () => {
    const fetchMock = await profile({ 'POST /api/people/ben/photos': OK('new2', null) });
    choose('Choose a photo (JPEG, PNG or WebP, up to 10 MB)', file());
    const dialog = await screen.findByRole('dialog', { name: 'Photo added' });
    fireEvent.change(within(dialog).getByLabelText('Date taken'), { target: { value: '2019-13' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save date' }));
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(calls(fetchMock).some((c) => c.startsWith('PATCH /api/media'))).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Leave it empty' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls(fetchMock).some((c) => c.startsWith('PATCH /api/media'))).toBe(false);
  });

  it('the profile picture button uploads and makes it the profile photo', async () => {
    const fetchMock = await profile({
      'POST /api/people/ben/photos': OK('new3'),
      'PATCH /api/people/ben': { status: 200, body: { person: detailFor(ADMIN, 'ben').person, warnings: [] } },
    });
    choose('Add profile photo', file());
    await screen.findByRole('dialog', { name: 'Photo added' });
    expect(JSON.parse(String(lastBody(fetchMock, 'PATCH /api/people/ben')!.body))).toEqual({ photoMediaId: 'new3' });
    const all = calls(fetchMock);
    expect(all.indexOf('POST /api/people/ben/photos')).toBeLessThan(all.indexOf('PATCH /api/people/ben'));
  });

  const failures: Array<[string, MockRoute, RegExp]> = [
    ['too big (413 from the api)', { status: 413, body: { error: 'image_too_large' } }, /larger than 10 MB/],
    ['too big (413 from nginx, a page)', { status: 413, text: '<html>413</html>' }, /larger than 10 MB/],
    ['too many pixels', { status: 413, body: { error: 'image_too_many_pixels' } }, /larger than 50 megapixels/],
    ['unsupported (415)', { status: 415, body: { error: 'unsupported_image' } }, /Only JPEG, PNG and WebP/],
    ['damaged', { status: 400, body: { error: 'invalid_image' } }, /could not be read as a picture/],
    [
      'too many uploads (429)',
      { status: 429, body: { error: 'rate_limited', retryAfterSeconds: 42 } },
      /about 42 seconds/,
    ],
    [
      'no key (503)',
      { status: 503, body: { error: 'files_unavailable', reason: 'key_missing' } },
      /no file encryption key is set/,
    ],
    [
      'no folder (503)',
      { status: 503, body: { error: 'files_unavailable', reason: 'files_unavailable' } },
      /files folder cannot be used/,
    ],
    [
      'key mismatch (503)',
      { status: 503, body: { error: 'files_unavailable', reason: 'key_mismatch' } },
      /not the one the stored photos were encrypted with/,
    ],
  ];
  for (const [name, reply, text] of failures) {
    it(`says it clearly when it is ${name}`, async () => {
      await profile({ 'POST /api/people/ben/photos': reply });
      choose('Choose a photo (JPEG, PNG or WebP, up to 10 MB)', file());
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toMatch(text);
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  }

  it('a file of the wrong type, or over 10 MB, is refused before anything is sent', async () => {
    const fetchMock = await profile();
    choose('Choose a photo (JPEG, PNG or WebP, up to 10 MB)', file('image/gif', 1000, 'a.gif'));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Only JPEG, PNG and WebP/);
    choose('Choose a photo (JPEG, PNG or WebP, up to 10 MB)', file('image/jpeg', 11 * 1024 * 1024));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/larger than 10 MB/));
    expect(calls(fetchMock).some((c) => c.startsWith('POST /api/people/ben/photos'))).toBe(false);
  });
});

describe('one photo', () => {
  async function open(items: MediaInfo[], me = ADMIN, extra: Record<string, MockRoute> = {}, personExtra = {}) {
    const fetchMock = await profile(extra, items, me, personExtra);
    fireEvent.click(await screen.findByRole('button', { name: /^Open photo 1 of/ }));
    return { fetchMock, dialog: await screen.findByRole('dialog', { name: 'Photo of Ben Hale' }) };
  }

  it('shows it full size with the date taken in the viewer’s format, decorative alt, and the actions the account may use', async () => {
    const { dialog } = await open([PHOTO('a', { takenOn: '2019-07-04' })]);
    expect(dialog.querySelector('img')!.getAttribute('src')).toBe('/api/media/a/full');
    expect(dialog.querySelector('img')!.getAttribute('alt')).toBe('');
    expect(within(dialog).getByText(/Date taken:/).parentElement!.textContent).toMatch(/2019/);
    for (const name of ['Set as profile photo', 'Remove from Ben Hale', 'Delete photo', 'Done'])
      expect(within(dialog).getByRole('button', { name })).toBeTruthy();
  });

  it('hides what the account may not do', async () => {
    const { dialog } = await open([PHOTO('a', { permissions: { edit: false, delete: false } })], READER);
    expect(within(dialog).queryByRole('button', { name: 'Delete photo' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Change date' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Set as profile photo' })).toBeNull();
  });

  it('a Member who uploaded it can delete it; the profile photo is not offered twice', async () => {
    const { dialog } = await open([PHOTO('a')], MEMBER, {}, { photoMediaId: 'a' });
    expect(within(dialog).queryByRole('button', { name: 'Set as profile photo' })).toBeNull();
    expect(within(dialog).getByText('This is the profile photo.')).toBeTruthy();
  });

  it('sets the profile photo', async () => {
    const { fetchMock, dialog } = await open([PHOTO('a')], ADMIN, {
      'PATCH /api/people/ben': { status: 200, body: { person: detailFor(ADMIN, 'ben').person, warnings: [] } },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Set as profile photo' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(JSON.parse(String(lastBody(fetchMock, 'PATCH /api/people/ben')!.body))).toEqual({ photoMediaId: 'a' });
  });

  it('changes the date taken, and shows the server’s refusal', async () => {
    const { fetchMock, dialog } = await open([PHOTO('a')], ADMIN, {
      'PATCH /api/media/a': { status: 200, body: PHOTO('a', { takenOn: '2001' }) },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change date' }));
    fireEvent.change(within(dialog).getByLabelText('Date taken'), { target: { value: '2001' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save date' }));
    await waitFor(() => expect(calls(fetchMock)).toContain('PATCH /api/media/a'));
    expect(JSON.parse(String(lastBody(fetchMock, 'PATCH /api/media/a')!.body))).toEqual({ takenOn: '2001' });
  });

  it('removing from the person asks first, then unlinks only', async () => {
    const { fetchMock, dialog } = await open([PHOTO('a')], ADMIN, {
      'DELETE /api/people/ben/photos/a': { status: 204 },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove from Ben Hale' }));
    const confirm = await screen.findByRole('dialog', { name: 'Remove this photo from Ben Hale?' });
    expect(calls(fetchMock)).not.toContain('DELETE /api/people/ben/photos/a');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove from Ben Hale' }));
    await waitFor(() => expect(calls(fetchMock)).toContain('DELETE /api/people/ben/photos/a'));
    expect(calls(fetchMock)).not.toContain('DELETE /api/media/a');
  });

  it('deleting asks first, says it is for everyone, then deletes the photo', async () => {
    const { fetchMock, dialog } = await open([PHOTO('a')], ADMIN, { 'DELETE /api/media/a': { status: 204 } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete photo' }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete this photo?' });
    expect(within(confirm).getByText(/deleted for everyone/)).toBeTruthy();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete photo' }));
    await waitFor(() => expect(calls(fetchMock)).toContain('DELETE /api/media/a'));
  });

  it('a failed delete says why and keeps the dialog', async () => {
    const { dialog } = await open([PHOTO('a')], ADMIN, {
      'DELETE /api/media/a': { status: 403, body: { error: 'forbidden' } },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete photo' }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete this photo?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete photo' }));
    expect((await within(confirm).findByRole('alert')).textContent).toMatch(/not allowed to change this photo/);
  });
});

describe('deleting a person says what happens to their photos', () => {
  it('counts the photos that show only them, before anything is asked', async () => {
    await profile({}, [
      PHOTO('a', { people: ['ben'] }),
      PHOTO('b', { people: ['ben'] }),
      PHOTO('c', { people: ['ben', 'walter'] }),
    ]);
    await screen.findByRole('list', { name: 'Photos' });
    click('Delete person');
    const dialog = await screen.findByRole('dialog', { name: /^Delete Ben Hale/ });
    expect(
      await within(dialog).findByText('2 photos that show only this person will be deleted with them.'),
    ).toBeTruthy();
  });

  it('says one photo in the singular, and nothing when there are none', async () => {
    await profile({}, [PHOTO('a', { people: ['ben'] })]);
    await screen.findByRole('list', { name: 'Photos' });
    click('Delete person');
    expect(await screen.findByText('1 photo that shows only this person will be deleted with them.')).toBeTruthy();
    cleanup();
    vi.unstubAllGlobals();
    await profile({}, [PHOTO('c', { people: ['ben', 'walter'] })]);
    await screen.findByRole('list', { name: 'Photos' });
    click('Delete person');
    const dialog = await screen.findByRole('dialog', { name: /^Delete Ben Hale/ });
    expect(within(dialog).queryByText(/photo/)).toBeNull();
  });

  it('after the confirmation the count comes from the server’s preview', async () => {
    await profile(
      {
        'DELETE /api/people/ben': {
          status: 409,
          body: { error: 'confirm_required', unions: 1, children: 2, photos: 3 },
        },
      },
      [],
    );
    click('Delete person');
    const dialog = await screen.findByRole('dialog', { name: /^Delete Ben Hale/ });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete person' }));
    expect(
      await within(dialog).findByText('3 photos that show only this person will be deleted with them.'),
    ).toBeTruthy();
  });
});

describe('the same picture everywhere a person is drawn', () => {
  const withPhoto = (personId: string) =>
    ({
      [`GET /api/people/${personId}`]: {
        status: 200,
        body: (() => {
          const detail = detailFor(ADMIN, personId);
          return { ...detail, person: { ...detail.person, photoMediaId: 'pm9' } };
        })(),
      },
    }) as Record<string, MockRoute>;

  it('a tree card draws the photo inside its circle, and keeps the initials under it', async () => {
    mockApi(
      haleRoutes(ADMIN, {
        'GET /api/tree/*': (_init, path) => {
          const original = haleRoutes(ADMIN)['GET /api/tree/*'] as (i: RequestInit, p: string) => unknown;
          const reply = original(_init, path) as { status: number; body: { people: Array<Record<string, unknown>> } };
          for (const p of reply.body.people) if (p['id'] === 'marcus') p['photoMediaId'] = 'pm9';
          return reply;
        },
      }),
    );
    renderApp('/tree/marcus');
    const card = (await screen.findByRole('button', { name: /^Marcus Hale/ })) as unknown as SVGElement;
    const image = card.querySelector('image')!;
    expect(image.getAttribute('href')).toBe('/api/media/pm9/avatar');
    expect(card.querySelector('.ini')!.textContent).toBe('MH');
    expect(card.querySelector('clipPath circle')).toBeTruthy();
    fireEvent.error(image);
    expect(card.querySelector('image')).toBeNull();
  });

  it('the People list shows the photo or the initials in front of each name', async () => {
    mockApi(
      haleRoutes(ADMIN, {
        '/api/people': {
          status: 200,
          body: {
            items: [
              { ...detailFor(ADMIN, 'ben').person, photoMediaId: 'pm9' },
              { ...detailFor(ADMIN, 'walter').person, photoMediaId: null },
            ],
            nextCursor: null,
          },
        },
      }),
    );
    renderApp('/people');
    const list = await screen.findByRole('list', { name: 'People' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]!.querySelector('img')!.getAttribute('src')).toBe('/api/media/pm9/avatar');
    expect(rows[1]!.querySelector('img')).toBeNull();
    expect(rows[1]!.querySelector('.ava')!.textContent).toBe('WH');
  });

  it('the account button shows the profile photo of the person the account is linked to', async () => {
    const linked = { ...MEMBER, displayName: 'Ben Hale' };
    mockApi(haleRoutes(linked, withPhoto(linked.personId!)));
    renderApp('/people');
    const button = await screen.findByRole('button', { name: /account/i });
    await waitFor(() => expect(button.querySelector('img')?.getAttribute('src')).toBe('/api/media/pm9/avatar'));
    expect(button.querySelector('img')!.getAttribute('alt')).toBe('');
  });
});
