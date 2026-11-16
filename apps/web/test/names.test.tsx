// SPDX-License-Identifier: AGPL-3.0-or-later
import { displayName, displaySurname } from '@kinship/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, haleRoutes, MEMBER, PEOPLE } from './family.js';
import { calls, mockApi, renderApp } from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
  restore();
});

// The test family is shared, so a test that gives somebody a second or married surname puts it back after.
let saved: Array<() => void> = [];
function restore() {
  for (const undo of saved) undo();
  saved = [];
}
function withNames(id: string, names: { secondSurname?: string | null; marriedSurname?: string | null }) {
  const person = PEOPLE.find((p) => p.id === id)!;
  const before = { secondSurname: person.secondSurname, marriedSurname: person.marriedSurname };
  Object.assign(person, names);
  saved.push(() => Object.assign(person, before));
}

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

describe('displayName', () => {
  const rosa = { givenName: 'Rosa', surname: 'Mendez', secondSurname: 'Ortiz', marriedSurname: 'Mendez Hale' };

  it('is the given name, the surname, then the second surname when there is one', () => {
    expect(displayName({ givenName: 'Daniel', surname: 'Hale' })).toBe('Daniel Hale');
    expect(displayName({ givenName: 'Lucia', surname: 'Ortiz', secondSurname: 'Vega', marriedSurname: null })).toBe(
      'Lucia Ortiz Vega',
    );
  });

  it('lets a married surname that is set replace both surnames, by default', () => {
    expect(displayName(rosa)).toBe('Rosa Mendez Hale');
    expect(displaySurname(rosa)).toBe('Mendez Hale');
  });

  it('keeps the birth surnames when the viewer chooses them, or when no married surname is set', () => {
    expect(displayName(rosa, 'birth')).toBe('Rosa Mendez Ortiz');
    expect(displayName({ ...rosa, marriedSurname: null })).toBe('Rosa Mendez Ortiz');
    expect(displayName({ ...rosa, marriedSurname: '' })).toBe('Rosa Mendez Ortiz');
  });
});

describe('names on screen', () => {
  it('shows the married surname in the heading, and all three surnames on Facts, each labelled', async () => {
    withNames('elena', { secondSurname: 'Vega', marriedSurname: 'Ruiz Hale' });
    mockApi(haleRoutes(ADMIN));
    renderApp('/people/elena');
    expect(await screen.findByRole('heading', { name: 'Elena Ruiz Hale' })).toBeTruthy();
    const facts = screen.getAllByRole('term').map((el) => el.textContent);
    expect(facts).toEqual(expect.arrayContaining(['Birth surname', 'Second surname', 'Married surname']));
    const term = (name: string) => screen.getAllByRole('term').find((el) => el.textContent === name)!;
    expect(term('Birth surname').nextElementSibling?.textContent).toBe('Ruiz');
    expect(term('Second surname').nextElementSibling?.textContent).toBe('Vega');
    expect(term('Married surname').nextElementSibling?.textContent).toBe('Ruiz Hale');
  });

  it('shows only the birth surname when the others are not set', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/people/elena');
    await screen.findByRole('heading', { name: 'Elena Ruiz' });
    const terms = screen.getAllByRole('term').map((el) => el.textContent);
    expect(terms).toContain('Birth surname');
    expect(terms).not.toContain('Second surname');
    expect(terms).not.toContain('Married surname');
  });
});

describe('edit details: surnames', () => {
  it('always offers the second and married surname, and sends them (blank as null)', async () => {
    const fetchMock = mockApi(
      haleRoutes(ADMIN, { 'PATCH /api/people/elena': { status: 200, body: { person: PEOPLE[3], warnings: [] } } }),
    );
    renderApp('/people/elena');
    await screen.findByRole('heading', { name: 'Elena Ruiz' });
    click('Edit details');
    type('Second surname', 'Vega');
    type('Married surname', 'Ruiz Hale');
    click('Save');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bodyOf(fetchMock, 'PATCH /api/people/elena')).toMatchObject({
      surname: 'Ruiz',
      secondSurname: 'Vega',
      marriedSurname: 'Ruiz Hale',
    });
  });
});

describe('relationship editor: surnames at marriage', () => {
  const open = async () => {
    renderApp('/people/daniel');
    const card = await screen.findByRole('article', { name: 'Relationship with Elena Ruiz' });
    fireEvent.click(within(card).getByRole('button', { name: 'Edit relationship' }));
    return screen.getByRole('dialog', { name: 'Relationship: Daniel Hale and Elena Ruiz' });
  };

  it('asks for each partner’s married surname while Married or Widowed, and keeps what was typed', async () => {
    mockApi(haleRoutes(ADMIN));
    const dialog = await open();
    expect(within(dialog).getByLabelText('Married surname: Daniel Hale')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Married surname: Elena Ruiz'), { target: { value: 'Ruiz Hale' } });
    fireEvent.change(within(dialog).getByLabelText('Relationship status'), { target: { value: 'divorced' } });
    expect(within(dialog).queryByLabelText('Married surname: Elena Ruiz')).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Relationship status'), { target: { value: 'widowed' } });
    expect((within(dialog).getByLabelText('Married surname: Elena Ruiz') as HTMLInputElement).value).toBe('Ruiz Hale');
  });

  it('saves the relationship, then the married surname of only the partner who changed', async () => {
    const fetchMock = mockApi(
      haleRoutes(ADMIN, {
        'PATCH /api/unions/u1': { status: 200, body: { union: {} } },
        'PATCH /api/people/elena': { status: 200, body: { person: PEOPLE[3], warnings: [] } },
      }),
    );
    const dialog = await open();
    fireEvent.change(within(dialog).getByLabelText('Married surname: Elena Ruiz'), {
      target: { value: ' Ruiz Hale ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls(fetchMock).filter((c) => c.startsWith('PATCH'))).toEqual([
      'PATCH /api/unions/u1',
      'PATCH /api/people/elena',
    ]);
    expect(bodyOf(fetchMock, 'PATCH /api/people/elena')).toEqual({ marriedSurname: 'Ruiz Hale' });
  });

  it('does not save a married surname when the status no longer asks for one', async () => {
    const fetchMock = mockApi(haleRoutes(ADMIN, { 'PATCH /api/unions/u1': { status: 200, body: { union: {} } } }));
    const dialog = await open();
    fireEvent.change(within(dialog).getByLabelText('Married surname: Elena Ruiz'), { target: { value: 'Ruiz Hale' } });
    fireEvent.change(within(dialog).getByLabelText('Relationship status'), { target: { value: 'divorced' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls(fetchMock).filter((c) => c.startsWith('PATCH'))).toEqual(['PATCH /api/unions/u1']);
  });

  it('offers a Member only the surname of their own person', async () => {
    mockApi(haleRoutes({ ...MEMBER, personId: 'elena' }));
    const dialog = await open();
    expect(within(dialog).getByLabelText('Married surname: Elena Ruiz')).toBeTruthy();
    expect(within(dialog).queryByLabelText('Married surname: Daniel Hale')).toBeNull();
  });
});

describe('add relative: a partner’s surnames', () => {
  it('shows the new partner’s married surname only while the status is Married or Widowed, and sends it', async () => {
    const created = { ...PEOPLE[9]!, id: 'newpartner', givenName: 'Nia', surname: 'Okoro' };
    const fetchMock = mockApi(
      haleRoutes(ADMIN, {
        'POST /api/people': { status: 201, body: { person: created, warnings: [] } },
        'POST /api/unions': { status: 201, body: { union: {} } },
        'PATCH /api/people/marcus': { status: 200, body: { person: PEOPLE[5], warnings: [] } },
      }),
    );
    renderApp('/people/marcus');
    await screen.findByRole('heading', { name: 'Marcus Hale' });
    click('Add relative');
    click(/^Add partner/);
    expect(screen.getByLabelText('Married surname')).toBeTruthy(); // the new partner (Married is the default)
    expect(screen.getByLabelText('Married surname: Marcus Hale')).toBeTruthy(); // the person themselves
    fireEvent.change(screen.getByLabelText('Relationship status'), { target: { value: 'friends' } });
    expect(screen.queryByLabelText('Married surname')).toBeNull();
    expect(screen.queryByLabelText('Married surname: Marcus Hale')).toBeNull();
    fireEvent.change(screen.getByLabelText('Relationship status'), { target: { value: 'married' } });
    type('Given name', 'Nia');
    type('Surname', 'Okoro');
    type('Second surname', 'Eze');
    type('Married surname', 'Okoro Hale');
    type('Married surname: Marcus Hale', 'Hale Okoro');
    click('Save');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bodyOf(fetchMock, 'POST /api/people')).toMatchObject({
      givenName: 'Nia',
      surname: 'Okoro',
      secondSurname: 'Eze',
      marriedSurname: 'Okoro Hale',
    });
    expect(bodyOf(fetchMock, 'PATCH /api/people/marcus')).toEqual({ marriedSurname: 'Hale Okoro' });
  });
});
