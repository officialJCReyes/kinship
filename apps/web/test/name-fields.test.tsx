// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, haleRoutes, PEOPLE } from './family.js';
import { mockApi, renderApp } from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
  undo();
});

type Parts = Partial<
  Pick<(typeof PEOPLE)[number], 'namePrefix' | 'nameSuffix' | 'nickname' | 'surnameParticle' | 'marriedSurname'>
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
const bodyOf = (fetchMock: ReturnType<typeof mockApi>, key: string): unknown => {
  const call = [...fetchMock.mock.calls]
    .reverse()
    .find(([input, init]) => `${(init?.method ?? 'GET').toUpperCase()} ${String(input)}` === key);
  return call?.[1]?.body ? JSON.parse(String(call[1].body)) : undefined;
};

describe('Edit details: the four new name fields', () => {
  it('offers them with the mockup’s labels, placeholders and helper text, in its order', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/people/elena');
    await screen.findByRole('heading', { name: 'Elena Ruiz' });
    click('Edit details');
    const dialog = screen.getByRole('dialog');
    const labels = within(dialog)
      .getAllByRole('textbox')
      .map((el) => (el as HTMLInputElement).name)
      .slice(0, 6);
    expect(labels).toEqual(['namePrefix', 'givenName', 'nickname', 'surnameParticle', 'surname', 'nameSuffix']);
    expect(within(dialog).getByLabelText('Prefix (optional)').getAttribute('placeholder')).toBe('Dr., Sir, Rev.');
    expect(within(dialog).getByLabelText('Nickname (optional)').getAttribute('placeholder')).toBe('Danny');
    expect(within(dialog).getByLabelText('Surname particle (optional)').getAttribute('placeholder')).toBe(
      'de, de la, van',
    );
    expect(within(dialog).getByLabelText('Suffix (optional)').getAttribute('placeholder')).toBe('Jr., Sr., II');
    expect(
      within(dialog).getByText(
        'Only given name and surname are required. Prefix and suffix show on the tree and profile unless you turn them off in My settings, Names. All four are searchable.',
      ),
    ).toBeTruthy();
    // Only the given name and the surname are required.
    expect((within(dialog).getByLabelText(/^Given name/) as HTMLInputElement).required).toBe(true);
    expect((within(dialog).getByLabelText('Surname') as HTMLInputElement).required).toBe(true);
    expect((within(dialog).getByLabelText('Prefix (optional)') as HTMLInputElement).required).toBe(false);
    expect((within(dialog).getByLabelText('Prefix (optional)') as HTMLInputElement).maxLength).toBe(30);
    expect((within(dialog).getByLabelText('Nickname (optional)') as HTMLInputElement).maxLength).toBe(100);
  });

  it('sends the four values, trimmed, and blank as null', async () => {
    const fetchMock = mockApi(
      haleRoutes(ADMIN, { 'PATCH /api/people/elena': { status: 200, body: { person: PEOPLE[3], warnings: [] } } }),
    );
    renderApp('/people/elena');
    await screen.findByRole('heading', { name: 'Elena Ruiz' });
    click('Edit details');
    type('Prefix (optional)', ' Dra. ');
    type('Nickname (optional)', 'Ele');
    type('Surname particle (optional)', 'de la');
    type('Suffix (optional)', '');
    click('Save');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bodyOf(fetchMock, 'PATCH /api/people/elena')).toMatchObject({
      namePrefix: 'Dra.',
      nickname: 'Ele',
      surnameParticle: 'de la',
      nameSuffix: null,
    });
  });

  it('fills them from the person when editing', async () => {
    setParts('elena', { namePrefix: 'Dr.', nickname: 'Ele', surnameParticle: 'de', nameSuffix: 'III' });
    mockApi(haleRoutes(ADMIN));
    renderApp('/people/elena');
    await screen.findByRole('heading', { name: /^Dr\. Elena de Ruiz III$/ });
    click('Edit details');
    const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;
    expect(value('Prefix (optional)')).toBe('Dr.');
    expect(value('Nickname (optional)')).toBe('Ele');
    expect(value('Surname particle (optional)')).toBe('de');
    expect(value('Suffix (optional)')).toBe('III');
  });
});

describe('Add relative: the four new name fields', () => {
  it('are on the new-person form', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/people/ben');
    await screen.findByRole('heading', { name: 'Ben Hale' });
    click('Add relative');
    click(/^Add partner/);
    for (const label of [
      'Prefix (optional)',
      'Nickname (optional)',
      'Surname particle (optional)',
      'Suffix (optional)',
    ]) {
      expect(screen.getByLabelText(label), label).toBeTruthy();
    }
  });
});

describe('the profile’s Facts', () => {
  it('lists a prefix, nickname, particle and suffix only when they are set', async () => {
    setParts('daniel', { namePrefix: 'Dr.', nickname: 'Danny', surnameParticle: 'de', nameSuffix: 'Sr.' });
    mockApi(haleRoutes(ADMIN));
    renderApp('/people/daniel');
    await screen.findByRole('heading', { name: 'Dr. Daniel de Hale Sr.' });
    const terms = screen.getAllByRole('term').map((el) => el.textContent);
    expect(terms.slice(0, 6)).toEqual([
      'Prefix',
      'Given name',
      'Nickname',
      'Surname particle',
      'Birth surname',
      'Suffix',
    ]);
    const term = (name: string) => screen.getAllByRole('term').find((el) => el.textContent === name)!;
    expect(term('Prefix').nextElementSibling?.textContent).toBe('Dr.');
    expect(term('Nickname').nextElementSibling?.textContent).toBe('Danny');
    expect(term('Surname particle').nextElementSibling?.textContent).toBe('de');
    expect(term('Suffix').nextElementSibling?.textContent).toBe('Sr.');
    cleanup();
    undo();

    mockApi(haleRoutes(ADMIN));
    renderApp('/people/daniel');
    await screen.findByRole('heading', { name: 'Daniel Hale' });
    const plain = screen.getAllByRole('term').map((el) => el.textContent);
    for (const absent of ['Prefix', 'Nickname', 'Surname particle', 'Suffix']) expect(plain).not.toContain(absent);
  });
});

describe('where the name is shown', () => {
  it('a card, its accessible name and the people list use prefix, particle and suffix, never the nickname', async () => {
    setParts('daniel', { namePrefix: 'Dr.', nickname: 'Danny', surnameParticle: 'de', nameSuffix: 'Sr.' });
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
