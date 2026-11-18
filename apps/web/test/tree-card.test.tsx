// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The tree card: border colour as the only sign of gender, the whole name on up to three lines, one height for every
// card, and the birth surname in the side panel (not on the card). The long names are fictional stand-ins shaped like
// the longest real ones (a quoted nickname; a double surname with particles).
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DISPLAY, setDisplay } from '../src/lib/display.js';
import { NODE_H } from '../src/tree/layout.js';
import { missingParentCards } from '../src/people/AddRelative.js';
import { ADMIN, detailFor, haleRoutes, PEOPLE, treeFor } from './family.js';
import { mockApi, renderApp } from './helpers.js';

const NICKNAME = { givenName: 'Rafael Octavio "Tavo"', surname: 'Brandt', secondSurname: 'Santori' };
const LONG = { givenName: 'Nova Estelle', surname: 'Hallworth-Fernandez', secondSurname: 'de la Mora' };

let undo: Array<() => void> = [];
function change(id: string, patch: Record<string, unknown>) {
  const person = PEOPLE.find((p) => p.id === id)! as unknown as Record<string, unknown>;
  const before = Object.fromEntries(Object.keys(patch).map((key) => [key, person[key]]));
  Object.assign(person, patch);
  undo.push(() => Object.assign(person, before));
}
afterEach(() => {
  vi.unstubAllGlobals();
  setDisplay(DEFAULT_DISPLAY);
  for (const fn of undo) fn();
  undo = [];
});

const card = (id: string) => document.querySelector(`[data-node="${id}"]`)!;
const nameLines = (id: string) => Array.from(card(id).querySelectorAll('.name tspan')).map((n) => n.textContent ?? '');

describe('the card', () => {
  it('has no sex icon, and the border class is the only sign: male, female, and other for other or unknown', async () => {
    change('lena', { gender: null });
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus');
    await screen.findByRole('button', { name: /^Marcus Hale/ });
    expect(document.querySelector('.tnode .glyph')).toBeNull();
    expect(card('marcus').classList.contains('male')).toBe(true);
    expect(card('sofia').classList.contains('female')).toBe(true);
    expect(card('lena').classList.contains('other')).toBe(true); // gender: null
    expect(card('lena').classList.contains('male') || card('lena').classList.contains('female')).toBe(false);
  });

  it('keeps the sex in the accessible name, including unknown', async () => {
    change('lena', { gender: null });
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus');
    await screen.findByRole('button', { name: /^Marcus Hale/ });
    expect(card('marcus').getAttribute('aria-label')).toBe('Marcus Hale, born 1988, male');
    expect(card('sofia').getAttribute('aria-label')).toMatch(/, female$/);
    expect(card('lena').getAttribute('aria-label')).toBe('Lena Okafor, born 1989, unknown');
  });

  it('labels the grey legend entry "Other or unknown"', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus');
    await screen.findByRole('button', { name: /^Marcus Hale/ });
    const legend = within(screen.getByRole('group', { name: 'Legend' }));
    expect(legend.getByText('Other or unknown')).toBeTruthy();
    expect(legend.queryByText('Other')).toBeNull();
  });

  it.each([
    ['a nickname and two surnames', NICKNAME, 'Rafael Octavio "Tavo" Brandt Santori'],
    ['a hyphenated surname with particles', LONG, 'Nova Estelle Hallworth-Fernandez de la Mora'],
  ])('shows the whole name for %s: on up to three lines, never cut, in the tooltip', async (_what, patch, full) => {
    change('marcus', patch);
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus');
    await screen.findByRole('button', { name: new RegExp(`^${full.slice(0, 12)}`) });
    const lines = nameLines('marcus');
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines.join(' ').replace(/- /g, '-')).toBe(full);
    expect(lines.join('')).not.toContain('…');
    expect(card('marcus').querySelector('title')!.textContent).toBe(full);
    expect(card('marcus').getAttribute('aria-label')).toContain(full);
  });

  it('keeps the deceased mark with the name', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus');
    await screen.findByRole('button', { name: /^Walter Hale/ });
    expect(nameLines('walter').join(' ')).toMatch(/Walter Hale\u00a0†$/);
  });

  it('is the same size for every card, with or without a birth date, and leaves the dates line empty', async () => {
    change('sofia', { birth: null });
    change('marcus', LONG);
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus');
    await screen.findByRole('button', { name: /^Nova Estelle/ });
    const heights = new Set(Array.from(document.querySelectorAll('.tnode .box')).map((b) => b.getAttribute('height')));
    expect(heights).toEqual(new Set([String(NODE_H)]));
    expect(card('sofia').querySelector('.years')!.textContent).toBe('');
    expect(card('sofia').querySelector('.name')).toBeTruthy();
    expect(card('sofia').getAttribute('aria-label')).toBe('Sofia Hale, female');
    // the lines of the longest name stay inside the card
    const last = Array.from(card('marcus').querySelectorAll('.name tspan')).at(-1)!;
    expect(Number(last.getAttribute('y'))).toBeLessThan(NODE_H);
  });
});

describe('the side panel and the birth surname', () => {
  const panelFor = async (name: RegExp, user: typeof ADMIN = ADMIN) => {
    mockApi(haleRoutes(user));
    renderApp('/tree/marcus');
    fireEvent.click(await screen.findByRole('button', { name }));
    const panel = screen.getByRole('complementary', { name: 'Selected person' });
    await within(panel).findByRole('heading', { level: 2 });
    return panel;
  };

  it('shows the birth surname when a married surname is the one shown, and not on the card', async () => {
    change('elena', { marriedSurname: 'Hale' });
    const panel = await panelFor(/^Elena Hale/);
    expect(within(panel).getByRole('heading', { name: 'Elena Hale' })).toBeTruthy();
    expect(within(panel).getByText('Birth surname: Ruiz')).toBeTruthy();
    expect(card('elena').textContent).not.toContain('Ruiz');
  });

  it('shows both birth surnames when there is a second one', async () => {
    change('elena', { marriedSurname: 'Hale', secondSurname: 'Vega' });
    const panel = await panelFor(/^Elena Hale/);
    expect(within(panel).getByText('Birth surname: Ruiz Vega')).toBeTruthy();
  });

  it('shows nothing extra when there is no married surname, or when the account shows birth names', async () => {
    const plain = await panelFor(/^Daniel Hale/);
    expect(within(plain).queryByText(/Birth surname/)).toBeNull();
    cleanup();
    vi.unstubAllGlobals();

    change('elena', { marriedSurname: 'Hale' });
    const birth = await panelFor(/^Elena Ruiz/, { ...ADMIN, surnameChoice: 'birth' as const });
    expect(within(birth).getByRole('heading', { name: 'Elena Ruiz' })).toBeTruthy();
    expect(within(birth).queryByText(/Birth surname/)).toBeNull();
  });

  it('shows nothing extra when the married surname is the same as the birth surname', async () => {
    change('elena', { marriedSurname: 'Ruiz' });
    const panel = await panelFor(/^Elena Ruiz/);
    expect(within(panel).queryByText(/Birth surname/)).toBeNull();
  });
});

describe('an unknown parent (placeholder)', () => {
  it('is a dashed, neutral card with a plus, no years, and a name that says nothing about sex', async () => {
    change('lena', { isPlaceholder: true, gender: 'female', givenName: '', surname: '', birth: null });
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus');
    await screen.findByRole('button', { name: /^Marcus Hale/ });
    const lena = card('lena');
    expect(lena.getAttribute('aria-label')).toBe('Unknown mother, add details');
    expect(lena.classList.contains('placeholder')).toBe(true);
    // Neutral: never the female (or male) border, even though the database keeps female for the label.
    expect(
      lena.classList.contains('female') || lena.classList.contains('male') || lena.classList.contains('other'),
    ).toBe(false);
    expect(lena.querySelector('.plus')).not.toBeNull();
    expect(lena.querySelector('.ini')).toBeNull();
    expect(lena.querySelector('.years')?.textContent).toBe('');
    expect(lena.querySelector('.box')?.getAttribute('height')).toBe(String(NODE_H));
    expect(lena.getAttribute('aria-label')).not.toMatch(/female|male|born/);
  });

  it('has a legend row, and the side panel offers Add details and no sex, dates or Add relative', async () => {
    change('lena', { isPlaceholder: true, gender: 'male', givenName: '', surname: '', birth: null });
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus');
    await screen.findByRole('button', { name: /^Marcus Hale/ });
    expect(within(screen.getByRole('group', { name: 'Legend' })).getByText(/unknown parent/i)).toBeTruthy();
    fireEvent.click(card('lena'));
    const panel = await screen.findByRole('complementary', { name: 'Selected person' });
    expect(within(panel).getByRole('heading', { name: 'Unknown father' })).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Add details' })).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: 'Add relative' })).toBeNull();
    expect(panel.textContent).not.toMatch(/Living|male|female/i);
  });

  it('shows on a profile as Unknown father and mother with Add details, and fills the birth parent slots', async () => {
    for (const id of ['walter', 'rosa']) {
      change(id, {
        isPlaceholder: true,
        givenName: '',
        surname: '',
        birth: null,
        death: null,
        deceased: false,
        gender: id === 'walter' ? 'male' : 'female',
      });
    }
    mockApi(haleRoutes(ADMIN));
    renderApp('/people/daniel');
    await screen.findByRole('heading', { name: 'Daniel Hale', level: 1 });
    expect(screen.getAllByRole('button', { name: 'Add details' }).length).toBe(2);
    expect(screen.getAllByText('Unknown father').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unknown mother').length).toBeGreaterThan(0);
    // Unknown parents fill the birth slots, so no birth parent is offered (an admin may still add adoptive parents).
    const tree = treeFor('daniel', { up: 1, down: 0, collateral: false });
    expect(missingParentCards(detailFor(ADMIN, 'daniel'), tree)).toEqual([]);
  });
});
