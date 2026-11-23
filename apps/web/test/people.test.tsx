// SPDX-License-Identifier: AGPL-3.0-or-later
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, detailFor, haleRoutes, MEMBER, PEOPLE, READER, treeFor } from './family.js';
import { missingParentCards } from '../src/people/AddRelative.js';
import { calls, mockApi, renderApp } from './helpers.js';

afterEach(() => vi.unstubAllGlobals());

type Fetch = ReturnType<typeof mockApi>;
/** The JSON body of the last call to "METHOD /path". */
function bodyOf(fetchMock: Fetch, key: string): unknown {
  const call = [...fetchMock.mock.calls]
    .reverse()
    .find(([input, init]) => `${(init?.method ?? 'GET').toUpperCase()} ${String(input)}` === key);
  return call?.[1]?.body ? JSON.parse(String(call[1].body)) : undefined;
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const NEW = PEOPLE[0]!;

describe('people list', () => {
  it('lists people, searches by name and loads more pages', async () => {
    const fetchMock = mockApi(
      haleRoutes(ADMIN, {
        '/api/people': { status: 200, body: { items: PEOPLE.slice(0, 2), nextCursor: 'c2' } },
        '/api/people?cursor=c2': { status: 200, body: { items: PEOPLE.slice(2, 3), nextCursor: null } },
        '/api/people?q=nair': {
          status: 200,
          body: { items: PEOPLE.filter((p) => p.surname === 'Nair'), nextCursor: null },
        },
        '/api/people?q=zzz': { status: 200, body: { items: [], nextCursor: null } },
      }),
    );
    renderApp('/people');
    expect(await screen.findByRole('link', { name: 'Walter Hale' })).toBeTruthy();
    expect(screen.getByText('1930 – 2005')).toBeTruthy();
    click('Load more');
    expect(await screen.findByRole('link', { name: 'Daniel Hale' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();

    type('Search by name', 'nair');
    expect(await screen.findByRole('link', { name: 'Priya Nair' })).toBeTruthy();
    expect(calls(fetchMock)).toContain('GET /api/people?q=nair');
    expect(screen.queryByRole('link', { name: 'Walter Hale' })).toBeNull();

    type('Search by name', 'zzz');
    expect(await screen.findByText('Nobody matches “zzz”.')).toBeTruthy();
  });

  it('shows Add person to admins only', async () => {
    mockApi(haleRoutes(MEMBER));
    renderApp('/people');
    await screen.findByRole('link', { name: 'Walter Hale' });
    expect(screen.queryByRole('button', { name: 'Add person' })).toBeNull();
  });

  it('adds a standalone person and opens their profile', async () => {
    const created = { ...NEW, id: 'walter', givenName: 'Walter', surname: 'Hale' };
    const fetchMock = mockApi(
      haleRoutes(ADMIN, { 'POST /api/people': { status: 201, body: { person: created, warnings: [] } } }),
    );
    renderApp('/people');
    await screen.findByRole('link', { name: 'Walter Hale' });
    click('Add person');
    const submit = () =>
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add person' }));
    submit();
    expect(screen.getAllByText('Enter a given name (up to 100 characters).').length).toBe(1);
    type('Given name', 'Walter');
    type('Surname', 'Hale');
    submit();
    expect(await screen.findByRole('heading', { name: 'Walter Hale' })).toBeTruthy();
    expect(bodyOf(fetchMock, 'POST /api/people')).toMatchObject({
      givenName: 'Walter',
      surname: 'Hale',
      gender: null,
      deceased: false,
    });
    expect(screen.getByText('Walter Hale was added.')).toBeTruthy();
  });
});

describe('profile', () => {
  it('shows facts, partners with gendered labels and status, children, parents and siblings', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/people/daniel');
    expect(await screen.findByRole('heading', { name: 'Daniel Hale' })).toBeTruthy();
    const wife = screen.getByRole('article', { name: 'Relationship with Elena Ruiz' });
    expect(within(wife).getByText(/^Wife:/)).toBeTruthy();
    expect(within(wife).getByText('Married')).toBeTruthy();
    expect(within(wife).getByText('May 1985')).toBeTruthy();
    expect(within(wife).getByRole('link', { name: /Marcus Hale/ })).toBeTruthy();
    const ex = screen.getByRole('article', { name: 'Relationship with Priya Nair' });
    expect(within(ex).getByText(/^Ex-wife:/)).toBeTruthy();
    expect(within(ex).getByText('Divorced')).toBeTruthy();
    expect(within(ex).getByText('Divorce date')).toBeTruthy();
    expect(within(ex).getByText('Mar 9, 1998')).toBeTruthy();
    // Children who hang from Daniel alone, and his parents.
    expect(screen.getByText('Children of this person alone')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Ben Hale/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Walter Hale/ })).toBeTruthy();
  });

  it('calls the surviving partner of a deceased spouse a widow and shows the late husband', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/people/rosa');
    const card = await screen.findByRole('article', { name: 'Relationship with Walter Hale' });
    expect(within(card).getByText(/^Late husband:/)).toBeTruthy();
    expect(within(card).getByText('Widowed')).toBeTruthy();
  });

  it('lists full and half siblings separately', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/people/marcus');
    await screen.findByRole('heading', { name: 'Marcus Hale' });
    const full = screen.getByRole('list', { name: 'Full siblings' });
    expect(within(full).getByText(/Sofia Hale/)).toBeTruthy();
    expect(within(full).queryByText(/Carla/)).toBeNull();
    const half = screen.getByRole('list', { name: 'Half-siblings' });
    expect(within(half).getByText(/Carla Nair/)).toBeTruthy();
    expect(within(half).getByText(/Ben Hale/)).toBeTruthy();
  });

  it('follows the permissions: an admin can do everything', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/people/daniel');
    await screen.findByRole('heading', { name: 'Daniel Hale' });
    for (const name of ['Edit details', 'Add relative']) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-disabled')).toBeNull();
    }
    expect(screen.getByRole('button', { name: 'Delete person' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Delete relationship' }).length).toBe(2);
  });

  it('lets a Member change only their own profile, with a tooltip on everyone else', async () => {
    mockApi(haleRoutes(MEMBER));
    renderApp('/people/daniel');
    await screen.findByRole('heading', { name: 'Daniel Hale' });
    for (const name of ['Edit details', 'Add relative']) {
      const button = screen.getByRole('button', { name });
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.getAttribute('title')).toBe('You can only edit your own profile');
    }
    expect(screen.queryByRole('button', { name: 'Delete person' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete relationship' })).toBeNull();
    // Daniel's relationships are not Marcus's.
    for (const button of screen.getAllByRole('button', { name: 'Edit relationship' })) {
      expect(button.getAttribute('aria-disabled')).toBe('true');
    }
  });

  it('shows a Member their own profile as editable, with the You pill', async () => {
    mockApi(haleRoutes(MEMBER));
    renderApp('/people/marcus');
    await screen.findByRole('heading', { name: 'Marcus Hale' });
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit details' }).getAttribute('aria-disabled')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add relative' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('tells a User that only admins and members can edit', async () => {
    mockApi(haleRoutes(READER));
    renderApp('/people/marcus');
    await screen.findByRole('heading', { name: 'Marcus Hale' });
    expect(screen.getByRole('button', { name: 'Edit details' }).getAttribute('title')).toBe(
      'Only admins and members can edit',
    );
    expect(screen.getByRole('button', { name: 'Add relative' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('shows a message for someone who does not exist', async () => {
    mockApi(
      haleRoutes(ADMIN, {
        'GET /api/people/nobody': { status: 404, body: { error: 'person_not_found' } },
        'GET /api/tree/nobody?up=1&down=1&collateral=true': { status: 404, body: { error: 'person_not_found' } },
      }),
    );
    renderApp('/people/nobody');
    expect(await screen.findByText('That person was not found.')).toBeTruthy();
  });
});

describe('edit details', () => {
  it('saves, shows a warning that never blocks, and keeps going', async () => {
    const fetchMock = mockApi(
      haleRoutes(ADMIN, {
        'PATCH /api/people/marcus': {
          status: 200,
          body: {
            person: PEOPLE[5],
            warnings: [{ code: 'parent_too_young', childId: 'marcus', parentId: 'daniel', yearsDifference: 9 }],
          },
        },
      }),
    );
    renderApp('/people/marcus');
    await screen.findByRole('heading', { name: 'Marcus Hale' });
    click('Edit details');
    const dialog = screen.getByRole('dialog', { name: 'Edit details: Marcus Hale' });
    expect((within(dialog).getByLabelText('Given name') as HTMLInputElement).value).toBe('Marcus');
    type('Birth date', '1951-02-30');
    fireEvent.blur(screen.getByLabelText('Birth date'));
    click('Save');
    expect(await screen.findAllByText(/Enter a date as YYYY/)).toBeTruthy();
    expect(calls(fetchMock)).not.toContain('PATCH /api/people/marcus');
    type('Birth date', '1951-02');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'deceased' } });
    type('Date of death', '2020');
    click('Save');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bodyOf(fetchMock, 'PATCH /api/people/marcus')).toEqual({
      givenName: 'Marcus',
      surname: 'Hale',
      secondSurname: null,
      marriedSurname: null,
      namePrefix: null,
      nameSuffix: null,
      nickname: null,
      gender: 'male',
      birth: { value: '1951-02', precision: 'exactly' },
      deceased: true,
      death: { value: '2020', precision: 'exactly' },
    });
    expect(screen.getByText(/only 9 years older/)).toBeTruthy();
  });

  it('shows the API error for a failed save and leaves the dialog open', async () => {
    mockApi(haleRoutes(ADMIN, { 'PATCH /api/people/marcus': { status: 403, body: { error: 'forbidden' } } }));
    renderApp('/people/marcus');
    await screen.findByRole('heading', { name: 'Marcus Hale' });
    click('Edit details');
    click('Save');
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('You are not allowed to do that.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('maps a rate limit to a friendly message', async () => {
    mockApi(
      haleRoutes(ADMIN, {
        'PATCH /api/people/marcus': { status: 429, body: { error: 'rate_limited', retryAfterSeconds: 30 } },
      }),
    );
    renderApp('/people/marcus');
    await screen.findByRole('heading', { name: 'Marcus Hale' });
    click('Edit details');
    click('Save');
    expect(await screen.findByText('Too many requests. Wait about 30 seconds and try again.')).toBeTruthy();
  });
});

describe('add relative', () => {
  it('shows parent cards only for the parents that are missing', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/people/walter');
    await screen.findByRole('heading', { name: 'Walter Hale' });
    click('Add relative');
    expect(screen.getByRole('button', { name: 'Add father' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add mother' })).toBeTruthy();
    // No "Add a parent first" rule any more: a brother or sister can be added to someone with no parents (ADR 0019).
    expect(screen.getByRole('button', { name: 'Add brother' }).getAttribute('title')).toBeNull();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers a Member only the missing birth parent; an admin can also add adoptive parents', async () => {
    const ben = detailFor(ADMIN, 'ben');
    const tree = treeFor('ben', { up: 1, down: 1, collateral: true });
    expect(missingParentCards(ben, tree)).toEqual(['mother']);
    expect(missingParentCards(ben, tree, true)).toEqual(['father', 'mother']);
    mockApi(haleRoutes(ADMIN));
    renderApp('/people/ben');
    await screen.findByRole('heading', { name: 'Ben Hale' });
    click('Add relative');
    expect(screen.getByRole('button', { name: 'Add father' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add mother' })).toBeTruthy();
  });

  it('offers no parent cards when both families are complete', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/people/samuel');
    await screen.findByRole('heading', { name: 'Samuel Hale' });
    click('Add relative');
    expect(screen.queryByTestId('ar-parents')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add brother' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('gives a Member only the son and daughter cards', async () => {
    mockApi(haleRoutes(MEMBER));
    renderApp('/people/marcus');
    await screen.findByRole('heading', { name: 'Marcus Hale' });
    click('Add relative');
    for (const name of ['Add son', 'Add daughter']) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-disabled')).toBeNull();
    }
    for (const name of ['Add brother', 'Add sister', 'Add partner']) {
      const card = screen.getByRole('button', { name: new RegExp(`^${name}`) });
      expect(card.getAttribute('aria-disabled')).toBe('true');
      expect(card.getAttribute('title')).toBe('Ask an admin to add this relative');
    }
    expect(screen.getByText('You can add children here. To add anyone else, ask an admin.')).toBeTruthy();
  });

  it('adds a child from a relationship, and shows the warning without blocking', async () => {
    const child = { ...PEOPLE[8]!, id: 'newkid', givenName: 'Noa', surname: 'Hale' };
    const fetchMock = mockApi(
      haleRoutes(ADMIN, {
        'POST /api/people/daniel/children': {
          status: 201,
          body: {
            person: child,
            parentage: { unionId: 'u2', parentId: null },
            warnings: [{ code: 'parent_too_young', childId: 'newkid', parentId: 'daniel', yearsDifference: 8 }],
          },
        },
      }),
    );
    renderApp('/people/daniel');
    await screen.findByRole('heading', { name: 'Daniel Hale' });
    click('Add relative');
    click('Add son');
    expect(screen.getByRole('dialog', { name: 'Add son to Daniel Hale' })).toBeTruthy();
    const other = screen.getByLabelText('Other parent') as HTMLSelectElement;
    expect(Array.from(other.options).map((o) => o.textContent)).toEqual([
      'Elena Ruiz (Married)',
      'Priya Nair (Divorced)',
      'The other parent is not on the tree',
    ]);
    type('Given name', 'Noa');
    type('Surname', 'Hale');
    fireEvent.change(other, { target: { value: 'u2' } });
    click('Save');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bodyOf(fetchMock, 'POST /api/people/daniel/children')).toMatchObject({
      child: { givenName: 'Noa', surname: 'Hale', gender: 'male' },
      unionId: 'u2',
    });
    expect(screen.getByText(/only 8 years older/)).toBeTruthy();
    expect(screen.getByText('Noa Hale was added to the tree.')).toBeTruthy();
  });

  it('adds a child with the other parent not on the tree: no unionId', async () => {
    const fetchMock = mockApi(
      haleRoutes(MEMBER, {
        'POST /api/people/marcus/children': {
          status: 201,
          body: { person: PEOPLE[8], parentage: { unionId: null, parentId: 'marcus' }, warnings: [] },
        },
      }),
    );
    renderApp('/people/marcus');
    await screen.findByRole('heading', { name: 'Marcus Hale' });
    click('Add relative');
    click('Add daughter');
    expect(screen.queryByRole('option', { name: /Elena/ })).toBeNull();
    type('Given name', 'Ida');
    type('Surname', 'Hale');
    click('Save');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bodyOf(fetchMock, 'POST /api/people/marcus/children')).toEqual({
      child: {
        givenName: 'Ida',
        surname: 'Hale',
        secondSurname: null,
        marriedSurname: null,
        namePrefix: null,
        nameSuffix: null,
        nickname: null,
        gender: 'female',
        birth: null,
        deceased: false,
        death: null,
      },
    });
  });

  it('creates a parent, links them, and says an Unknown relationship will be created', async () => {
    const mother = { ...PEOPLE[3]!, id: 'newmom', givenName: 'Mina', surname: 'Hale' };
    const fetchMock = mockApi(
      haleRoutes(ADMIN, {
        'POST /api/people': { status: 201, body: { person: mother, warnings: [] } },
        'POST /api/people/ben/parents': {
          status: 201,
          body: { parentage: { unionId: 'new', parentId: null }, warnings: [] },
        },
      }),
    );
    renderApp('/people/ben');
    await screen.findByRole('heading', { name: 'Ben Hale' });
    click('Add relative');
    click('Add mother');
    expect(screen.getByText(/a relationship with status Unknown will be created/)).toBeTruthy();
    type('Given name', 'Mina');
    type('Surname', 'Hale');
    click('Save');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls(fetchMock).filter((c) => c.startsWith('POST'))).toEqual([
      'POST /api/people',
      'POST /api/people/ben/parents',
    ]);
    expect(bodyOf(fetchMock, 'POST /api/people/ben/parents')).toEqual({ parentId: 'newmom', kind: 'birth' });
  });

  it('removes the person it just created when linking fails', async () => {
    const fetchMock = mockApi(
      haleRoutes(ADMIN, {
        'POST /api/people': { status: 201, body: { person: { ...PEOPLE[3]!, id: 'newmom' }, warnings: [] } },
        'POST /api/people/ben/parents': { status: 409, body: { error: 'too_many_parents' } },
        'DELETE /api/people/newmom': { status: 204 },
      }),
    );
    renderApp('/people/ben');
    await screen.findByRole('heading', { name: 'Ben Hale' });
    click('Add relative');
    click('Add mother');
    type('Given name', 'Mina');
    type('Surname', 'Hale');
    click('Save');
    expect(await screen.findByText('A person can have at most two parents.')).toBeTruthy();
    expect(calls(fetchMock)).toContain('DELETE /api/people/newmom');
    expect(screen.queryByText(/could not be removed again/)).toBeNull();
  });

  it('says a person was created but not linked when the cleanup fails too, with a link to them', async () => {
    mockApi(
      haleRoutes(ADMIN, {
        'POST /api/people': {
          status: 201,
          body: { person: { ...PEOPLE[3]!, id: 'newmom', givenName: 'Mina', surname: 'Hale' }, warnings: [] },
        },
        'POST /api/people/ben/parents': { status: 500, body: { error: 'internal_error' } },
        'DELETE /api/people/newmom': { status: 500, body: { error: 'internal_error' } },
      }),
    );
    renderApp('/people/ben');
    await screen.findByRole('heading', { name: 'Ben Hale' });
    click('Add relative');
    click('Add mother');
    type('Given name', 'Mina');
    type('Surname', 'Hale');
    click('Save');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Mina Hale was created but could not be linked');
    const link = within(alert).getByRole('link', { name: 'Open their profile' });
    expect(link.getAttribute('href')).toBe('/people/newmom');
  });

  it('adds a partner who is already on the tree, chosen by name, with a status', async () => {
    const fetchMock = mockApi(
      haleRoutes(ADMIN, {
        '/api/people?q=len&limit=8': { status: 200, body: { items: [PEOPLE[9]], nextCursor: null } },
        'POST /api/unions': { status: 201, body: { union: {} } },
      }),
    );
    renderApp('/people/marcus');
    await screen.findByRole('heading', { name: 'Marcus Hale' });
    click('Add relative');
    click(/^Add partner/);
    fireEvent.click(screen.getByLabelText('Someone already on the tree'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Find them by name' }), { target: { value: 'len' } });
    fireEvent.click(await screen.findByRole('option', { name: /Lena Okafor/ }));
    fireEvent.change(screen.getByLabelText('Relationship status'), { target: { value: 'engaged' } });
    type('Marriage or start date', '2026-06');
    click('Save');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bodyOf(fetchMock, 'POST /api/unions')).toEqual({
      status: 'engaged',
      start: { value: '2026-06', precision: 'exactly' },
      end: null,
      partnerIds: ['lena', 'marcus'],
    });
  });

  it('adds a sister with one call, and the server decides which parents she shares', async () => {
    const fetchMock = mockApi(
      haleRoutes(ADMIN, {
        'POST /api/people/marcus/siblings': {
          status: 201,
          body: {
            person: { ...PEOPLE[8]!, id: 'sib' },
            parentage: { unionId: 'u1', parentId: null, kind: 'birth', link: null },
            placeholders: [],
            warnings: [],
          },
        },
      }),
    );
    renderApp('/people/marcus');
    await screen.findByRole('heading', { name: 'Marcus Hale' });
    click('Add relative');
    click('Add sister');
    type('Given name', 'Tess');
    type('Surname', 'Hale');
    click('Save');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const calls = fetchMock.mock.calls
      .filter(([url, init]) => String(url) === '/api/people/marcus/siblings' && init?.method === 'POST')
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ kind: 'birth', sibling: { givenName: 'Tess', surname: 'Hale' } });
    // Nothing else was created or linked from the browser.
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/people')).toBe(false);
  });

  it('tells an admin that unknown parents are added when the person has none', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/people/walter');
    await screen.findByRole('heading', { name: 'Walter Hale' });
    click('Add relative');
    click('Add brother');
    expect(screen.getByTestId('placeholder-note').textContent).toMatch(/unknown father and an unknown mother/);
  });
});

describe('relationships', () => {
  it('shows the end date only for divorce, separation and annulment, and clears it otherwise', async () => {
    const fetchMock = mockApi(haleRoutes(ADMIN, { 'PATCH /api/unions/u2': { status: 200, body: { union: {} } } }));
    renderApp('/people/daniel');
    const card = await screen.findByRole('article', { name: 'Relationship with Priya Nair' });
    fireEvent.click(within(card).getByRole('button', { name: 'Edit relationship' }));
    const dialog = screen.getByRole('dialog', { name: 'Relationship: Daniel Hale and Priya Nair' });
    expect((within(dialog).getByLabelText('Divorce date') as HTMLInputElement).value).toBe('1998-03-09');
    fireEvent.change(within(dialog).getByLabelText('Relationship status'), { target: { value: 'married' } });
    expect(within(dialog).queryByLabelText('Divorce date')).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Relationship status'), { target: { value: 'separated' } });
    expect(within(dialog).getByLabelText('Separation date')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Relationship status'), { target: { value: 'partner' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bodyOf(fetchMock, 'PATCH /api/unions/u2')).toEqual({
      status: 'partner',
      start: { value: '1993', precision: 'exactly' },
      end: null,
    });
  });

  it('lets a Member change a relationship they are in, but not someone else’s', async () => {
    mockApi(haleRoutes({ ...MEMBER, personId: 'elena' }));
    renderApp('/people/daniel');
    const mine = await screen.findByRole('article', { name: 'Relationship with Elena Ruiz' });
    expect(within(mine).getByRole('button', { name: 'Edit relationship' }).getAttribute('aria-disabled')).toBeNull();
    const other = screen.getByRole('article', { name: 'Relationship with Priya Nair' });
    expect(within(other).getByRole('button', { name: 'Edit relationship' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('explains why a relationship with children cannot be deleted', async () => {
    mockApi(haleRoutes(ADMIN, { 'DELETE /api/unions/u1': { status: 409, body: { error: 'union_has_children' } } }));
    renderApp('/people/daniel');
    const card = await screen.findByRole('article', { name: 'Relationship with Elena Ruiz' });
    fireEvent.click(within(card).getByRole('button', { name: 'Delete relationship' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete relationship' }));
    expect(
      await screen.findByText('This relationship has children. Change its status instead of deleting it.'),
    ).toBeTruthy();
  });
});

describe('delete person', () => {
  it('asks again with the counts when the API wants a confirmation, then deletes', async () => {
    const fetchMock = mockApi(
      haleRoutes(ADMIN, {
        'DELETE /api/people/daniel': { status: 409, body: { error: 'confirm_required', unions: 2, children: 4 } },
        'DELETE /api/people/daniel?confirm=true': { status: 204 },
      }),
    );
    renderApp('/people/daniel');
    await screen.findByRole('heading', { name: 'Daniel Hale' });
    click('Delete person');
    const dialog = screen.getByRole('dialog', { name: 'Delete Daniel Hale?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete person' }));
    expect(
      await screen.findByText('This person has 2 relationship(s) and 4 child(ren) that would be affected.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete anyway' }));
    expect(await screen.findByRole('heading', { name: 'People' })).toBeTruthy();
    expect(calls(fetchMock).filter((c) => c.startsWith('DELETE'))).toEqual([
      'DELETE /api/people/daniel',
      'DELETE /api/people/daniel?confirm=true',
    ]);
    expect(screen.getByText('Daniel Hale was deleted.')).toBeTruthy();
  });

  it('says so when an account is linked to the person', async () => {
    mockApi(haleRoutes(ADMIN, { 'DELETE /api/people/sofia': { status: 409, body: { error: 'person_has_account' } } }));
    renderApp('/people/sofia');
    await screen.findByRole('heading', { name: 'Sofia Hale' });
    click('Delete person');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete person' }));
    expect(await screen.findByText('An account is linked to this person. Unlink it first.')).toBeTruthy();
  });
});
