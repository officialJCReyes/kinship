// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NAME_PREFIXES, NAME_SUFFIXES } from '@kinship/shared';
import { OTHER } from '../src/people/AffixField.js';
import { ADMIN, haleRoutes, PEOPLE } from './family.js';
import { mockApi, renderApp } from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
  undo();
});

type Parts = Partial<
  Pick<(typeof PEOPLE)[number], 'namePrefix' | 'nameSuffix' | 'nickname' | 'surname' | 'marriedSurname'>
>;
let saved: Array<() => void> = [];
function undo() {
  for (const fn of saved) fn();
  saved = [];
}
function setParts(id: string, parts: Parts) {
  const person = PEOPLE.find((p) => p.id === id)!;
  const before = { ...person };
  Object.assign(person, parts);
  saved.push(() => Object.assign(person, before));
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const pick = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const bodyOf = (fetchMock: ReturnType<typeof mockApi>, key: string): unknown => {
  const call = [...fetchMock.mock.calls]
    .reverse()
    .find(([input, init]) => `${(init?.method ?? 'GET').toUpperCase()} ${String(input)}` === key);
  return call?.[1]?.body ? JSON.parse(String(call[1].body)) : undefined;
};

describe('Edit details: the three optional name fields', () => {
  it('offers prefix and suffix as drop downs, nickname as a box, with the helper text, in the mockup’s order', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/people/elena');
    await screen.findByRole('heading', { name: 'Elena Ruiz' });
    click('Edit details');
    const dialog = screen.getByRole('dialog');
    const names = Array.from(dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input[name], select[name]'))
      .map((el) => el.name)
      .slice(0, 5);
    expect(names).toEqual(['namePrefix', 'givenName', 'nickname', 'surname', 'nameSuffix']);
    // The particle is part of the surname (ADR 0038): there is no field for it.
    expect(within(dialog).queryByLabelText(/particle/i)).toBeNull();
    expect(within(dialog).getByLabelText('Prefix (optional)').tagName).toBe('SELECT');
    expect(within(dialog).getByLabelText('Suffix (optional)').tagName).toBe('SELECT');
    expect(within(dialog).getByLabelText('Nickname (optional)').getAttribute('placeholder')).toBe('Danny');
    expect(
      within(dialog).getByText(
        'Only given name and surname are required. Prefix and suffix show on the tree and profile unless you turn them off in My settings, Names. All four are searchable.',
      ),
    ).toBeTruthy();
    // Only the given name and the surname are required.
    expect((within(dialog).getByLabelText(/^Given name/) as HTMLInputElement).required).toBe(true);
    expect((within(dialog).getByLabelText('Surname') as HTMLInputElement).required).toBe(true);
    expect((within(dialog).getByLabelText('Prefix (optional)') as HTMLSelectElement).required).toBe(false);
    expect((within(dialog).getByLabelText('Nickname (optional)') as HTMLInputElement).maxLength).toBe(100);
  });

  it('lists None, the shared list in order, and Other… last, as written', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/people/elena');
    await screen.findByRole('heading', { name: 'Elena Ruiz' });
    click('Edit details');
    const options = (label: string) =>
      Array.from((screen.getByLabelText(label) as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options('Prefix (optional)')).toEqual(['None', ...NAME_PREFIXES, 'Other…']);
    expect(options('Suffix (optional)')).toEqual(['None', ...NAME_SUFFIXES, 'Other…']);
    // "Other…" opens the 30-character box; nothing is typed until the box is used.
    expect(screen.queryByLabelText('Prefix, as you write it')).toBeNull();
    pick('Prefix (optional)', OTHER);
    expect((screen.getByLabelText('Prefix, as you write it') as HTMLInputElement).maxLength).toBe(30);
  });

  it('sends a listed choice, a typed Other, and None as null', async () => {
    const fetchMock = mockApi(
      haleRoutes(ADMIN, { 'PATCH /api/people/elena': { status: 200, body: { person: PEOPLE[3], warnings: [] } } }),
    );
    renderApp('/people/elena');
    await screen.findByRole('heading', { name: 'Elena Ruiz' });
    click('Edit details');
    pick('Prefix (optional)', OTHER);
    type('Prefix, as you write it', ' Sgt. ');
    type('Nickname (optional)', 'Ele');
    pick('Suffix (optional)', 'PhD');
    click('Save');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bodyOf(fetchMock, 'PATCH /api/people/elena')).toMatchObject({
      namePrefix: 'Sgt.',
      nickname: 'Ele',
      nameSuffix: 'PhD',
    });
    expect(bodyOf(fetchMock, 'PATCH /api/people/elena')).not.toHaveProperty('surnameParticle');
  });

  it('keeps "Other…" chosen while its box is emptied, and an empty box saves as none', async () => {
    const fetchMock = mockApi(
      haleRoutes(ADMIN, { 'PATCH /api/people/elena': { status: 200, body: { person: PEOPLE[3], warnings: [] } } }),
    );
    setParts('elena', { namePrefix: 'Sgt.' });
    renderApp('/people/elena');
    await screen.findByRole('heading', { name: 'Sgt. Elena Ruiz' });
    click('Edit details');
    type('Prefix, as you write it', '');
    expect((screen.getByLabelText('Prefix (optional)') as HTMLSelectElement).value).toBe(OTHER);
    expect(screen.getByLabelText('Prefix, as you write it')).toBeTruthy();
    pick('Prefix (optional)', '');
    expect(screen.queryByLabelText('Prefix, as you write it')).toBeNull();
    click('Save');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bodyOf(fetchMock, 'PATCH /api/people/elena')).toMatchObject({ namePrefix: null });
  });

  it('fills them from the person when editing: a listed value is chosen, any other shows as Other… with its text', async () => {
    setParts('elena', { namePrefix: 'Dr.', nickname: 'Ele', surname: 'de Ruiz', nameSuffix: 'Ret.' });
    mockApi(haleRoutes(ADMIN));
    renderApp('/people/elena');
    await screen.findByRole('heading', { name: /^Dr\. Elena de Ruiz Ret\.$/ });
    click('Edit details');
    const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;
    expect(value('Prefix (optional)')).toBe('Dr.');
    expect(screen.queryByLabelText('Prefix, as you write it')).toBeNull();
    expect(value('Nickname (optional)')).toBe('Ele');
    expect(value('Surname')).toBe('de Ruiz');
    expect(value('Suffix (optional)')).toBe(OTHER);
    expect(value('Suffix, as you write it')).toBe('Ret.');
  });

  it('never changes a stored value on save, even one that differs from a list entry only in case', async () => {
    const fetchMock = mockApi(
      haleRoutes(ADMIN, { 'PATCH /api/people/elena': { status: 200, body: { person: PEOPLE[3], warnings: [] } } }),
    );
    setParts('elena', { namePrefix: 'dr.', nameSuffix: 'iii' });
    renderApp('/people/elena');
    await screen.findByRole('heading', { name: 'dr. Elena Ruiz iii' });
    click('Edit details');
    expect((screen.getByLabelText('Prefix (optional)') as HTMLSelectElement).value).toBe(OTHER);
    expect((screen.getByLabelText('Prefix, as you write it') as HTMLInputElement).value).toBe('dr.');
    type('Nickname (optional)', 'Ele');
    click('Save');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bodyOf(fetchMock, 'PATCH /api/people/elena')).toMatchObject({ namePrefix: 'dr.', nameSuffix: 'iii' });
  });
});

describe('Add relative: the three optional name fields', () => {
  it('are on the new-person form', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/people/ben');
    await screen.findByRole('heading', { name: 'Ben Hale' });
    click('Add relative');
    click(/^Add partner/);
    for (const label of ['Prefix (optional)', 'Nickname (optional)', 'Suffix (optional)']) {
      expect(screen.getByLabelText(label), label).toBeTruthy();
    }
  });
});

describe('the profile’s Facts', () => {
  it('lists a prefix, nickname and suffix only when they are set', async () => {
    setParts('daniel', { namePrefix: 'Dr.', nickname: 'Danny', surname: 'de Hale', nameSuffix: 'Sr.' });
    mockApi(haleRoutes(ADMIN));
    renderApp('/people/daniel');
    await screen.findByRole('heading', { name: 'Dr. Daniel de Hale Sr.' });
    const terms = screen.getAllByRole('term').map((el) => el.textContent);
    expect(terms.slice(0, 5)).toEqual(['Prefix', 'Given name', 'Nickname', 'Birth surname', 'Suffix']);
    const term = (name: string) => screen.getAllByRole('term').find((el) => el.textContent === name)!;
    expect(term('Prefix').nextElementSibling?.textContent).toBe('Dr.');
    expect(term('Nickname').nextElementSibling?.textContent).toBe('Danny');
    expect(term('Birth surname').nextElementSibling?.textContent).toBe('de Hale');
    expect(term('Suffix').nextElementSibling?.textContent).toBe('Sr.');
    cleanup();
    undo();

    mockApi(haleRoutes(ADMIN));
    renderApp('/people/daniel');
    await screen.findByRole('heading', { name: 'Daniel Hale' });
    const plain = screen.getAllByRole('term').map((el) => el.textContent);
    for (const absent of ['Prefix', 'Nickname', 'Suffix']) expect(plain).not.toContain(absent);
  });
});

describe('where the name is shown', () => {
  it('a card, its accessible name and the people list use prefix, a particle in the surname and suffix, never the nickname', async () => {
    setParts('daniel', { namePrefix: 'Dr.', nickname: 'Danny', surname: 'de Hale', nameSuffix: 'Sr.' });
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/daniel');
    const card = await screen.findByRole('button', { name: /^Dr\. Daniel de Hale Sr\., / });
    expect(card.getAttribute('aria-label')).not.toMatch(/Danny/);
    expect(card.textContent).not.toMatch(/Danny/);
    cleanup();
    vi.unstubAllGlobals();

    mockApi(haleRoutes({ ...ADMIN, showPrefix: false, showSuffix: false }));
    renderApp('/tree/daniel');
    const plain = await screen.findByRole('button', { name: /^Daniel de Hale, / });
    expect(plain.getAttribute('aria-label')).not.toMatch(/Dr\.|Sr\./);
    cleanup();
    vi.unstubAllGlobals();

    mockApi(haleRoutes(ADMIN));
    renderApp('/people');
    expect(await screen.findByRole('link', { name: 'Dr. Daniel de Hale Sr.' })).toBeTruthy();
  });
});
