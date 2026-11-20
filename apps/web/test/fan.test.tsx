// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { estimateWidth } from '../src/tree/cardText.js';
import { FAN_RADIAL_FLOOR, fitRadialName, FAN_RING, layoutFan, shortName } from '../src/tree/fanLayout.js';
import { ADMIN, haleRoutes, PEOPLE, treeFor } from './family.js';
import { calls, mockApi, renderApp } from './helpers.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const blood = (id: string) => treeFor(id, { up: 4, down: 0, collateral: false, lineage: 'birth' });
const person = (id: string) => PEOPLE.find((p) => p.id === id)!;
const LONG = {
  ...person('marcus'),
  givenName: 'Nova Estelle',
  surname: 'Hallworth-Fernandez',
  secondSurname: 'de la Mora',
};
const VERY_LONG = {
  ...LONG,
  givenName: 'Maximiliano Bartholomew Cornelius',
  surname: 'Wolfeschlegelsteinhausenberger',
};

describe('the Fan layout', () => {
  const { layout, ids } = layoutFan(blood('marcus'), 'marcus', 4);
  const wedge = (id: string) => layout.wedges.find((w) => w.id === id)!;

  it('draws the person in the middle and a ring for each generation after them', () => {
    expect([...ids].sort()).toEqual(['daniel', 'elena', 'marcus', 'rosa', 'walter']);
    expect(layout.centre?.id).toBe('marcus');
    expect(layout.rings).toBe(3);
    expect([wedge('daniel').ring, wedge('elena').ring, wedge('walter').ring]).toEqual([1, 1, 2]);
    expect(layoutFan(blood('marcus'), 'marcus', 3).layout.rings).toBe(2);
    expect(layoutFan(blood('marcus'), 'marcus', 5).layout.rings).toBe(4);
  });

  it('puts the father’s side on the left half and the mother’s on the right, missing ancestors as outlines', () => {
    expect([wedge('daniel').side, wedge('elena').side]).toEqual(['father', 'mother']);
    expect([wedge('walter').side, wedge('rosa').side]).toEqual(['father', 'father']); // Daniel's parents
    const missing = layout.wedges.filter((w) => w.id === null);
    // Elena's parents (ring 2, mother's side) and, one ring out, Walter's and Rosa's (father's side).
    expect(missing).toHaveLength(2 + 4);
    expect(missing.filter((w) => w.ring === 2).every((w) => w.side === 'mother')).toBe(true);
    expect(missing.filter((w) => w.ring === 3).every((w) => w.side === 'father')).toBe(true);
    expect(missing.every((w) => w.text === null)).toBe(true);
  });

  it('covers a half circle: ring 1 starts at the left edge and ends at the right edge, one wedge after the other', () => {
    const first = wedge('daniel').path;
    expect(
      first.startsWith(`M${layout.cx - 60} ${layout.cy}`.replace(/\.0$/, '')) ||
        first.startsWith(`M${(layout.cx - 60).toFixed(1)} ${layout.cy.toFixed(1)}`),
    ).toBe(true);
    for (const w of layout.wedges) expect(w.path).toMatch(/^M[-\d. ]+L[-\d. ]+A[-\d. ]+L[-\d. ]+A[-\d. ]+Z$/);
    expect(layout.width).toBe(2 * layout.cx);
    expect(layout.height).toBeGreaterThan(layout.cy);
  });

  it('has horizontal text in the first two rings and text along the radius after that, never upside down', () => {
    const five = layoutFan(blood('marcus'), 'marcus', 5).layout;
    for (const w of five.wedges) {
      if (!w.text) continue;
      if (w.ring <= 2) expect([w.ring, w.text.mode, w.text.rotate]).toEqual([w.ring, 'horizontal', 0]);
      else {
        expect(w.text.mode).toBe('radial');
        expect(Math.abs(w.text.rotate)).toBeLessThanOrEqual(90);
      }
    }
    const ring3 = layout.wedges.filter((w) => w.ring === 3 && w.text);
    expect(ring3).toHaveLength(0); // nobody is known three rings out in this family
  });

  it('keeps the whole name wherever it is horizontal, and in the rings where it fits', () => {
    const tree = blood('marcus');
    const named = {
      ...tree,
      people: tree.people.map((p) => (p.id === 'daniel' ? { ...p, ...LONG, id: 'daniel' } : p)),
    };
    const l = layoutFan(named, 'marcus', 4).layout;
    const lines = l.wedges.find((w) => w.id === 'daniel')!.text!;
    expect(lines.shortened).toBe(false);
    expect(lines.name.lines.join(' ').replace(/- /g, '-')).toBe('Nova Estelle Hallworth-Fernandez de la Mora');
  });

  it('shortens a name along a ring only when it would need less than 9 px, and says so', () => {
    const ok = fitRadialName(person('walter'), FAN_RING - 14, estimateWidth);
    expect(ok.shortened).toBe(false);
    expect(ok.fit.size).toBeGreaterThanOrEqual(FAN_RADIAL_FLOOR);
    const tight = fitRadialName(LONG, FAN_RING - 14, estimateWidth);
    if (!tight.shortened)
      expect(tight.fit.lines.join(' ').replace(/- /g, '-')).toBe('Nova Estelle Hallworth-Fernandez de la Mora');
    const cut = fitRadialName(VERY_LONG, FAN_RING - 14, estimateWidth);
    expect(cut.shortened).toBe(true);
    expect(cut.fit.size).toBeGreaterThanOrEqual(FAN_RADIAL_FLOOR);
    expect(cut.fit.lines.length).toBeLessThanOrEqual(3);
    expect(shortName(LONG)).toBe('Nova H.');
    expect(shortName(VERY_LONG)).toBe('Maximiliano W.');
  });

  it('is the same whatever order the response comes in', () => {
    const tree = blood('marcus');
    const shuffled = {
      ...tree,
      people: [...tree.people].reverse(),
      unions: [...tree.unions].reverse(),
      parentage: Object.fromEntries(Object.entries(tree.parentage).reverse()),
    };
    expect(layoutFan(shuffled, 'marcus', 4).layout.wedges).toEqual(layout.wedges);
  });

  it('moves with the arrow keys: up to the father then the mother, down to the middle, around the ring', () => {
    const go = layout.navigate;
    expect(go('marcus', 'ArrowUp')).toBe('daniel');
    expect(go('marcus', 'ArrowLeft')).toBeUndefined();
    expect(go('daniel', 'ArrowUp')).toBe('walter');
    expect(go('elena', 'ArrowUp')).toBeUndefined(); // no parents drawn
    expect(go('daniel', 'ArrowDown')).toBe('marcus');
    expect(go('walter', 'ArrowDown')).toBe('daniel');
    expect(go('daniel', 'ArrowRight')).toBe('elena');
    expect(go('elena', 'ArrowLeft')).toBe('daniel');
    expect(go('walter', 'ArrowRight')).toBe('rosa');
    expect(go('rosa', 'ArrowRight')).toBeUndefined(); // the rest of the ring is empty
  });

  it('draws a person who is both a father’s and a mother’s ancestor once', () => {
    const tree = blood('marcus');
    const twice = { ...tree, parentage: { ...tree.parentage } };
    // Give Elena Daniel's parents too: Walter and Rosa then appear on both sides.
    twice.parentage['elena'] = { ...tree.parentage['daniel']! };
    const l = layoutFan(twice, 'marcus', 4).layout;
    expect(l.wedges.filter((w) => w.id === 'walter')).toHaveLength(1);
  });
});

describe('the Fan in the app', () => {
  it('asks for blood ancestors, draws the person in the middle and a wedge for each ancestor, and no leaves', async () => {
    const fetchMock = mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus?view=fan');
    await screen.findByRole('button', { name: /^Walter Hale/ });
    expect(calls(fetchMock)).toContain('GET /api/tree/marcus?up=3&down=0&lineage=birth');
    expect(screen.getByRole('button', { name: /^Marcus Hale/ })).toBeTruthy();
    expect(document.querySelector('[data-leaf]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Chart view: Fan' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Legend' }).textContent).toContain('Left half is the father’s side');
  });

  it('names each ring and each wedge, with the side, and leaves out the empty places', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus?view=fan');
    await screen.findByRole('button', { name: /^Walter Hale/ });
    const parents = screen.getByRole('group', { name: 'Parents' });
    expect(within(parents).getByRole('button', { name: /^Daniel Hale.*father’s side$/ })).toBeTruthy();
    expect(within(parents).getByRole('button', { name: /^Elena Ruiz.*mother’s side$/ })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Grandparents' })).toBeTruthy();
    const missing = document.querySelectorAll('.fan-missing');
    expect(missing.length).toBeGreaterThan(0);
    for (const el of missing) expect(el.getAttribute('aria-hidden')).toBe('true');
    const title = within(screen.getByRole('button', { name: /^Walter Hale/ }));
    expect(title).toBeTruthy();
  });

  it('has one tab stop, moves with the arrow keys and makes the person chosen with Enter the new middle', async () => {
    const fetchMock = mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus?view=fan&gen=3');
    await screen.findByRole('button', { name: /^Daniel Hale/ });
    const stops = Array.from(document.querySelectorAll('[data-node]')).filter(
      (n) => n.getAttribute('tabindex') === '0',
    );
    expect(stops).toHaveLength(1);
    const centre = document.querySelector<SVGElement>('[data-node="marcus"]')!;
    centre.focus();
    fireEvent.keyDown(centre, { key: 'ArrowUp' });
    expect(document.activeElement?.getAttribute('data-node')).toBe('daniel');
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    await waitFor(() => expect(calls(fetchMock)).toContain('GET /api/tree/daniel?up=2&down=0&lineage=birth'));
  });

  it('goes back to the Family tree from the switcher, with the person who was in the middle selected', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/daniel?view=fan');
    await screen.findByRole('button', { name: /^Walter Hale/ });
    fireEvent.click(screen.getByRole('button', { name: 'Chart view: Fan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Family tree' }));
    await screen.findByRole('group', { name: 'Family tree chart' });
    expect(screen.getByRole('button', { name: 'Chart view: Family tree' })).toBeTruthy();
  });
});
