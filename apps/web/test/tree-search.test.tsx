// SPDX-License-Identifier: AGPL-3.0-or-later
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, haleRoutes, PEOPLE, treeFor } from './family.js';
import { calls, mockApi, renderApp } from './helpers.js';

let saved: Array<() => void> = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const fn of saved) fn();
  saved = [];
});
function setParts(id: string, parts: Partial<(typeof PEOPLE)[number]>) {
  const person = PEOPLE.find((p) => p.id === id)!;
  const before = { ...person };
  Object.assign(person, parts);
  saved.push(() => Object.assign(person, before));
}
const byId = (id: string) => PEOPLE.find((p) => p.id === id)!;
const lookup = (q: string, items: typeof PEOPLE, nextCursor: string | null = null) => ({
  [`/api/people?q=${encodeURIComponent(q)}&limit=8`]: { status: 200, body: { items, nextCursor } },
});
const box = () => screen.getByRole('combobox', { name: 'Find someone in the tree' });
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });
const key = (k: string) => fireEvent.keyDown(box(), { key: k });
const panelHeading = () =>
  within(screen.getByRole('complementary', { name: 'Selected person' })).getByRole('heading', { level: 2 });

async function openChart(routes = {}) {
  mockApi(haleRoutes(ADMIN, routes));
  renderApp('/tree/marcus');
  await screen.findByRole('button', { name: /^Marcus Hale/ });
}

describe('the chart’s search box and counter', () => {
  it('shows "N of M people": what the chart draws, out of everyone the viewer may see', async () => {
    await openChart();
    const drawn = treeFor('marcus', { collateral: true }).people.filter((p) => !p.isPlaceholder).length;
    expect(screen.getByText(`${drawn} of ${PEOPLE.length} people`)).toBeTruthy();
    expect(drawn).toBeLessThan(PEOPLE.length);
  });

  it('has a labelled box and a closed list, and asks for nothing until something is typed', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus');
    await screen.findByRole('button', { name: /^Marcus Hale/ });
    expect(box().getAttribute('aria-expanded')).toBe('false');
    const fetchMock = mockApi(haleRoutes(ADMIN));
    expect(calls(fetchMock).filter((c) => c.includes('/api/people?q='))).toEqual([]);
  });

  it('shows each result with the viewer’s name and the life years, and Down and Up move the highlight', async () => {
    await openChart(lookup('hale', [byId('walter'), byId('rosa'), byId('daniel')]));
    type('hale');
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(3);
    expect(within(options[0]!).getByText('Walter Hale')).toBeTruthy();
    expect(within(options[0]!).getByText(/1930/)).toBeTruthy();
    expect(options[0]!.getAttribute('aria-selected')).toBe('true');
    key('ArrowDown');
    expect(screen.getAllByRole('option')[1]!.getAttribute('aria-selected')).toBe('true');
    key('ArrowUp');
    expect(screen.getAllByRole('option')[0]!.getAttribute('aria-selected')).toBe('true');
    expect(box().getAttribute('aria-activedescendant')).toBe(options[0]!.id);
  });

  it('Escape closes the list, and typing opens it again', async () => {
    await openChart(lookup('hale', [byId('walter')]));
    type('hale');
    await screen.findByRole('option');
    expect(box().getAttribute('aria-expanded')).toBe('true');
    key('Escape');
    expect(box().getAttribute('aria-expanded')).toBe('false');
    type('hale ');
    expect(box().getAttribute('aria-expanded')).toBe('true');
  });

  it('Enter chooses someone who is drawn: they are selected, the panel shows them, the chart is not re-rooted', async () => {
    await openChart(lookup('sofia', [byId('sofia')]));
    type('sofia');
    await screen.findByRole('option');
    key('Enter');
    await waitFor(() => expect(panelHeading().textContent).toBe('Sofia Hale'));
    // Still Marcus's chart, and the box is empty and closed.
    expect(screen.getByRole('button', { name: /^Marcus Hale/ })).toBeTruthy();
    expect((box() as HTMLInputElement).value).toBe('');
    expect(box().getAttribute('aria-expanded')).toBe('false');
  });

  it('a click or tap on a row chooses it too', async () => {
    await openChart(lookup('ben', [byId('ben')]));
    type('ben');
    fireEvent.click(await screen.findByRole('option'));
    await waitFor(() => expect(panelHeading().textContent).toBe('Ben Hale'));
  });

  it('opens the panel when it was collapsed', async () => {
    window.localStorage.setItem('kinship.tree.panelCollapsed', '1');
    saved.push(() => window.localStorage.removeItem('kinship.tree.panelCollapsed'));
    await openChart(lookup('sofia', [byId('sofia')]));
    expect(screen.queryByRole('complementary', { name: 'Selected person' })?.classList.contains('collapsed')).toBe(
      true,
    );
    type('sofia');
    await screen.findByRole('option');
    key('Enter');
    await waitFor(() => expect(panelHeading().textContent).toBe('Sofia Hale'));
  });

  it('chooses someone who is not drawn by making them the root of the chart, selected', async () => {
    const drawn = new Set(treeFor('marcus', { collateral: true }).people.map((p) => p.id));
    const away = PEOPLE.find((p) => !drawn.has(p.id) && !p.isPlaceholder)!;
    expect(away).toBeTruthy();
    await openChart(lookup('x', [away]));
    type('x');
    await screen.findByRole('option');
    key('Enter');
    await waitFor(() => expect(panelHeading().textContent).toBe(`${away.givenName} ${away.surname}`));
    expect(
      screen.getAllByRole('button', { name: new RegExp(`^${away.givenName} ${away.surname}`) }).length,
    ).toBeGreaterThan(0);
  });

  it('adds the nickname to the detail line only when the match came from the nickname alone', async () => {
    setParts('daniel', { nickname: 'Danny' });
    await openChart({ ...lookup('danny', [byId('daniel')]), ...lookup('daniel', [byId('daniel')]) });
    type('danny');
    const found = await screen.findByRole('option');
    expect(within(found).getByText(/also called Danny/)).toBeTruthy();
    expect(within(found).getByText('Daniel Hale')).toBeTruthy();
    type('daniel');
    await waitFor(() => expect(screen.getByRole('option').textContent).not.toMatch(/also called/));
    // A nickname never becomes part of the name itself.
    expect(screen.getByRole('option').textContent).not.toMatch(/Daniel Danny|Danny Hale/);
  });

  it('shows the name as this viewer sees it: the form, prefix and suffix', async () => {
    setParts('elena', { marriedSurname: 'Ruiz Hale', namePrefix: 'Dr.', nameSuffix: 'Jr.' });
    await openChart(lookup('elena', [byId('elena')]));
    type('elena');
    expect(await screen.findByText('Dr. Elena Ruiz (Hale) Jr.')).toBeTruthy();
  });

  it('says so when the list is cut, and when nobody matches', async () => {
    await openChart({
      ...lookup('hale', [byId('walter')], 'next'),
      ...lookup('zzz', []),
    });
    type('hale');
    expect(await screen.findByText('Keep typing to narrow the list.')).toBeTruthy();
    type('zzz');
    expect(await screen.findByText('Nobody found.')).toBeTruthy();
  });
});
