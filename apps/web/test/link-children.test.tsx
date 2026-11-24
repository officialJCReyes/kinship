// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Add relative asks which of the children already on the tree are the new partner's or new parent's too (ADR 0039).
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, haleRoutes, MEMBER, PEOPLE } from './family.js';
import { calls, mockApi, renderApp } from './helpers.js';

afterEach(() => vi.unstubAllGlobals());

type Fetch = ReturnType<typeof mockApi>;
function bodyOf(fetchMock: Fetch, key: string): unknown {
  const call = [...fetchMock.mock.calls]
    .reverse()
    .find(([input, init]) => `${(init?.method ?? 'GET').toUpperCase()} ${String(input)}` === key);
  return call?.[1]?.body ? JSON.parse(String(call[1].body)) : undefined;
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const person = (id: string) => PEOPLE.find((p) => p.id === id)!;
const partnerReply = (who: string) => ({
  status: 201,
  body: { person: person(who), union: { id: 'new', status: 'married', children: [] }, warnings: [] },
});

async function openAddPartner(personId: string, heading: string) {
  renderApp(`/people/${personId}`);
  await screen.findByRole('heading', { name: heading });
  click('Add relative');
  click(/^Add partner/);
}

describe('Add partner: are any of these also their children?', () => {
  it('ticks every child when the person has no other relationship, names the new partner, and sends one call', async () => {
    // Ade has no relationship and one child of his own alone, Femi.
    const fetchMock = mockApi(haleRoutes(ADMIN, { 'POST /api/people/ade/partners': partnerReply('nora') }));
    await openAddPartner('ade', 'Ade Okafor');
    const group = await screen.findByRole('group', { name: 'Are any of these also the new partner’s children?' });
    const femi = within(group).getByRole('checkbox', { name: /Femi Okafor/ }) as HTMLInputElement;
    expect(femi.checked).toBe(true);
    expect(within(group).getByText(/birth child/)).toBeTruthy();
    type('Given (and middle) name', 'Ola');
    type('Surname', 'Okafor');
    expect(screen.getByRole('group', { name: 'Are any of these also Ola’s children?' })).toBeTruthy();
    click('Save');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bodyOf(fetchMock, 'POST /api/people/ade/partners')).toMatchObject({
      partner: { givenName: 'Ola', surname: 'Okafor' },
      union: { status: expect.any(String) },
      linkChildren: ['femi'],
    });
    // Nothing is created or linked with separate calls any more.
    expect(calls(fetchMock).filter((c) => c.startsWith('POST'))).toEqual(['POST /api/people/ade/partners']);
  });

  it('ticks nothing when the person has another relationship, and sends no children when none is ticked', async () => {
    // Daniel has two relationships and Ben, a child of his alone.
    const fetchMock = mockApi(haleRoutes(ADMIN, { 'POST /api/people/daniel/partners': partnerReply('nora') }));
    await openAddPartner('daniel', 'Daniel Hale');
    const group = await screen.findByRole('group', { name: /Are any of these also/ });
    const ben = within(group).getByRole('checkbox', { name: /Ben Hale/ }) as HTMLInputElement;
    expect(ben.checked).toBe(false);
    type('Given (and middle) name', 'Iris');
    type('Surname', 'Vale');
    click('Save');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bodyOf(fetchMock, 'POST /api/people/daniel/partners')).not.toHaveProperty('linkChildren');
  });

  it('asks the server about an existing partner, and links the child ticked', async () => {
    const fetchMock = mockApi(
      haleRoutes(ADMIN, {
        '/api/people?q=nor&limit=8': { status: 200, body: { items: [person('nora')], nextCursor: null } },
        'POST /api/people/daniel/partners': partnerReply('nora'),
      }),
    );
    await openAddPartner('daniel', 'Daniel Hale');
    fireEvent.click(screen.getByLabelText('Someone already on the tree'));
    // No list until a partner is chosen.
    expect(screen.queryByRole('group', { name: /Are any of these also/ })).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Find them by name' }), { target: { value: 'nor' } });
    fireEvent.click(await screen.findByRole('option', { name: /Nora Okafor/ }));
    const group = await screen.findByRole('group', { name: 'Are any of these also Nora Okafor’s children?' });
    expect(calls(fetchMock)).toContain('GET /api/people/daniel/linkable-children?partner=nora');
    fireEvent.click(within(group).getByRole('checkbox', { name: /Ben Hale/ }));
    click('Save');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bodyOf(fetchMock, 'POST /api/people/daniel/partners')).toMatchObject({
      partnerId: 'nora',
      linkChildren: ['ben'],
    });
  });

  it('shows no list for a person with no children of their own alone', async () => {
    mockApi(haleRoutes(ADMIN));
    await openAddPartner('marcus', 'Marcus Hale');
    await waitFor(() =>
      expect(calls(vi.mocked(fetch) as unknown as Fetch)).toContain('GET /api/people/marcus/linkable-children'),
    );
    expect(screen.queryByTestId('link-children')).toBeNull();
  });

  it('says which child was refused and why, saves nothing, and keeps the dialog open', async () => {
    mockApi(
      haleRoutes(ADMIN, {
        'POST /api/people/ade/partners': { status: 409, body: { error: 'would_create_cycle', childId: 'femi' } },
      }),
    );
    await openAddPartner('ade', 'Ade Okafor');
    await screen.findByRole('group', { name: /Are any of these also/ });
    type('Given (and middle) name', 'Ola');
    type('Surname', 'Okafor');
    click('Save');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Femi Okafor could not be linked: That would make someone their own ancestor.');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('is not offered to a Member, who cannot add a partner', async () => {
    const fetchMock = mockApi(haleRoutes(MEMBER));
    renderApp('/people/marcus');
    await screen.findByRole('heading', { name: 'Marcus Hale' });
    click('Add relative');
    expect(
      (screen.getByRole('button', { name: /^Add partner/ }) as HTMLButtonElement).getAttribute('aria-disabled'),
    ).toBe('true');
    expect(calls(fetchMock).some((c) => c.includes('linkable-children'))).toBe(false);
  });
});

describe('Add parent: are any of these brothers and sisters also their children?', () => {
  // Ben hangs from Daniel alone. Two more children of Daniel's alone, for these cases (the server's list is mocked).
  const siblings = {
    status: 200,
    body: {
      children: [
        { child: person('sofia'), kind: 'birth' },
        { child: person('carla'), kind: 'adoptive' },
      ],
    },
  };

  async function openAddMother() {
    renderApp('/people/ben');
    await screen.findByRole('heading', { name: 'Ben Hale' });
    click('Add relative');
    click('Add mother');
  }

  it('lists the existing parent’s other children alone, ticks none, and sends the ticked ones with the new parent', async () => {
    const fetchMock = mockApi(
      haleRoutes(ADMIN, {
        'GET /api/people/daniel/linkable-children?exclude=ben': siblings,
        'POST /api/people/ben/parents': {
          status: 201,
          body: { parentage: { unionId: 'new', parentId: null }, warnings: [], person: person('elena') },
        },
      }),
    );
    await openAddMother();
    const group = await screen.findByRole('group', { name: 'Are any of these also the new parent’s children?' });
    const boxes = within(group).getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([false, false]);
    expect(within(group).getByText(/adopted/)).toBeTruthy();
    type('Given (and middle) name', 'Mina');
    type('Surname', 'Hale');
    fireEvent.click(within(group).getByRole('checkbox', { name: /Sofia Hale/ }));
    click('Save');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bodyOf(fetchMock, 'POST /api/people/ben/parents')).toMatchObject({
      parent: { givenName: 'Mina', surname: 'Hale' },
      kind: 'birth',
      linkChildren: ['sofia'],
    });
    expect(calls(fetchMock).filter((c) => c.startsWith('POST'))).toEqual(['POST /api/people/ben/parents']);
  });

  it('asks again for an existing parent picked by name', async () => {
    const fetchMock = mockApi(
      haleRoutes(ADMIN, {
        '/api/people?q=nor&limit=8': { status: 200, body: { items: [person('nora')], nextCursor: null } },
        'GET /api/people/daniel/linkable-children?partner=nora&exclude=ben': siblings,
        'POST /api/people/ben/parents': {
          status: 201,
          body: { parentage: { unionId: 'x', parentId: null }, warnings: [] },
        },
      }),
    );
    await openAddMother();
    fireEvent.click(screen.getByLabelText('Someone already on the tree'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Find them by name' }), { target: { value: 'nor' } });
    fireEvent.click(await screen.findByRole('option', { name: /Nora Okafor/ }));
    const group = await screen.findByRole('group', { name: 'Are any of these also Nora Okafor’s children?' });
    fireEvent.click(within(group).getByRole('checkbox', { name: /Carla Nair/ }));
    click('Save');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bodyOf(fetchMock, 'POST /api/people/ben/parents')).toMatchObject({
      parentId: 'nora',
      linkChildren: ['carla'],
    });
  });

  it('names a refused brother or sister and saves nothing', async () => {
    mockApi(
      haleRoutes(ADMIN, {
        'GET /api/people/daniel/linkable-children?exclude=ben': siblings,
        'POST /api/people/ben/parents': {
          status: 409,
          body: { error: 'same_person_both_kinds', childId: 'carla' },
        },
      }),
    );
    await openAddMother();
    const group = await screen.findByRole('group', { name: /Are any of these also/ });
    fireEvent.click(within(group).getByRole('checkbox', { name: /Carla Nair/ }));
    type('Given (and middle) name', 'Mina');
    type('Surname', 'Hale');
    click('Save');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/^Carla Nair could not be linked: That person is already a parent of this child/);
  });

  it('asks nothing for a person with no parent yet', async () => {
    const fetchMock = mockApi(haleRoutes(ADMIN));
    renderApp('/people/walter');
    await screen.findByRole('heading', { name: 'Walter Hale' });
    click('Add relative');
    click('Add father');
    expect(screen.queryByTestId('link-children')).toBeNull();
    expect(calls(fetchMock).some((c) => c.includes('linkable-children'))).toBe(false);
  });
});
