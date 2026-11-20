// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NODE_H, NODE_W } from '../src/tree/layout.js';
import { layoutPedigree, parentSlots, PEDIGREE_SLOT } from '../src/tree/pedigreeLayout.js';
import { ADMIN, haleRoutes, PEOPLE, treeFor } from './family.js';
import { calls, mockApi, renderApp } from './helpers.js';
import type { MockReply } from './helpers.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const blood = (id: string) => treeFor(id, { up: 4, down: 0, collateral: false, lineage: 'birth' });
const person = (id: string) => PEOPLE.find((p) => p.id === id)!;

describe('the Pedigree layout', () => {
  const { layout, ids } = layoutPedigree(blood('marcus'), 'marcus', 4);
  const at = (id: string) => layout.byId.get(id)!;

  it('draws the person and their blood ancestors, a column for each generation, left to right', () => {
    expect([...ids].sort()).toEqual(['daniel', 'elena', 'marcus', 'rosa', 'walter']);
    expect(at('marcus').row).toBe(0);
    expect([at('daniel').row, at('elena').row]).toEqual([1, 1]);
    expect([at('walter').row, at('rosa').row]).toEqual([2, 2]);
    expect(at('daniel').x).toBeGreaterThan(at('marcus').x);
    expect(at('walter').x).toBeGreaterThan(at('daniel').x);
  });

  it('puts the father above the mother, and the person in the middle of their parents', () => {
    expect(at('daniel').y).toBeLessThan(at('elena').y);
    expect(at('walter').y).toBeLessThan(at('rosa').y);
    const middle = (at('daniel').y + at('elena').y) / 2;
    expect(at('marcus').y).toBeCloseTo(middle, 5);
    expect(at('elena').y - at('daniel').y).toBe(4 * PEDIGREE_SLOT); // a slot of the second column holds four of the fourth
  });

  it('shows a missing parent as an empty slot with its own label, and titles each column', () => {
    // Elena's parents are not known (two slots), nor are Walter's and Rosa's (four).
    const labels = layout.slots!.map((s) => s.label);
    expect(labels.filter((l) => l === 'Father not on the tree')).toHaveLength(3);
    expect(labels.filter((l) => l === 'Mother not on the tree')).toHaveLength(3);
    expect(layout.titles!.map((t) => t.text)).toEqual([
      'Selected person',
      'Parents',
      'Grandparents',
      'Great-grandparents',
    ]);
  });

  it('has a line from each person to each parent place, and no couples', () => {
    expect(layout.couples).toEqual([]);
    expect(layout.links).toHaveLength(2 + 2 * 2 + 0 + 2 * 2); // Marcus, Daniel and Elena, Walter and Rosa
    for (const link of layout.links) expect(link.bounds![2]).toBeGreaterThan(link.bounds![0]);
  });

  it('draws only the generations asked for', () => {
    const three = layoutPedigree(blood('marcus'), 'marcus', 3);
    expect(three.layout.titles).toHaveLength(3);
    expect(three.layout.slots).toHaveLength(2); // Elena's parents only
    expect(three.layout.nodes).toHaveLength(5);
    const two = layoutPedigree(blood('marcus'), 'marcus', 2);
    expect([...two.ids].sort()).toEqual(['daniel', 'elena', 'marcus']);
  });

  it('puts a lone parent by their sex: a father above with an empty mother, a mother below', () => {
    const tomas = layoutPedigree(treeFor('tomas', { up: 2, down: 0, lineage: 'birth' }), 'tomas', 2);
    expect(tomas.layout.byId.get('priya')!.y).toBeGreaterThan(tomas.layout.byId.get('tomas')!.y);
    expect(tomas.layout.slots!.map((s) => s.label)).toEqual(['Father not on the tree']);
    const femi = layoutPedigree(treeFor('femi', { up: 2, down: 0, lineage: 'birth' }), 'femi', 2);
    expect(femi.layout.byId.get('ade')!.y).toBeLessThan(femi.layout.byId.get('femi')!.y);
    expect(femi.layout.slots!.map((s) => s.label)).toEqual(['Mother not on the tree']);
  });

  it('follows blood parents only, and the viewer’s own lineage setting does not matter', () => {
    const birth = layoutPedigree(treeFor('samuel', { up: 2, down: 0, lineage: 'birth' }), 'samuel', 3);
    expect([...birth.ids].sort()).toEqual(['frank', 'ruth', 'samuel']);
    // Had the response followed the adoptive parents, they would be drawn: the view asks for lineage=birth for this reason.
    const adoptive = layoutPedigree(treeFor('samuel', { up: 2, down: 0, lineage: 'adoptive' }), 'samuel', 3);
    expect([...adoptive.ids].sort()).toEqual(['anna', 'joseph', 'samuel']);
  });

  it('orders two parents of the same sex or none known by birth date, then id', () => {
    const [a, b] = parentSlots([
      { ...person('daniel'), id: 'z', gender: null, birth: { value: '1950', precision: 'exactly' } },
      { ...person('daniel'), id: 'a', gender: null, birth: { value: '1960', precision: 'exactly' } },
    ]);
    expect([a!.id, b!.id]).toEqual(['z', 'a']);
    const [m, w] = parentSlots([person('elena'), person('daniel')]);
    expect([m!.id, w!.id]).toEqual(['daniel', 'elena']);
  });

  it('is the same whatever order the response comes in', () => {
    const tree = blood('marcus');
    const shuffled = {
      ...tree,
      people: [...tree.people].reverse(),
      unions: [...tree.unions].reverse(),
      parentage: Object.fromEntries(Object.entries(tree.parentage).reverse()),
    };
    const a = layoutPedigree(tree, 'marcus', 4).layout;
    const b = layoutPedigree(shuffled, 'marcus', 4).layout;
    const flat = (l: typeof a) => [...l.nodes].sort((x, y) => (x.id < y.id ? -1 : 1)).map((n) => [n.id, n.x, n.y]);
    expect(flat(b)).toEqual(flat(a));
    expect(b.links.map((l) => [l.key, l.d]).sort()).toEqual(a.links.map((l) => [l.key, l.d]).sort());
  });

  it('has cards that do not overlap and a size that holds every card', () => {
    const five = layoutPedigree(blood('marcus'), 'marcus', 5).layout;
    for (const n of five.nodes) {
      expect(n.x + NODE_W / 2).toBeLessThanOrEqual(five.width);
      expect(n.y + NODE_H).toBeLessThanOrEqual(five.height);
    }
    for (const row of five.rows) {
      for (let i = 1; i < row.length; i += 1) {
        expect(five.byId.get(row[i]!)!.y - five.byId.get(row[i - 1]!)!.y).toBeGreaterThanOrEqual(NODE_H);
      }
    }
  });

  it('moves with the arrow keys: right to the father, left to the child, up and down within a column', () => {
    const go = layout.navigate!;
    expect(go('marcus', 'ArrowRight')).toBe('daniel');
    expect(go('daniel', 'ArrowDown')).toBe('elena');
    expect(go('elena', 'ArrowUp')).toBe('daniel');
    expect(go('elena', 'ArrowLeft')).toBe('marcus');
    expect(go('daniel', 'ArrowRight')).toBe('walter');
    expect(go('elena', 'ArrowRight')).toBeUndefined(); // no parents drawn
    expect(go('marcus', 'ArrowLeft')).toBeUndefined();
    expect(go('walter', 'ArrowDown')).toBe('rosa');
  });
});

describe('the Pedigree in the app', () => {
  it('asks for blood ancestors only, draws the columns, the empty slots and the pedigree legend, and no leaves', async () => {
    const fetchMock = mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus?view=pedigree');
    await screen.findByRole('button', { name: /^Walter Hale/ });
    expect(calls(fetchMock)).toContain('GET /api/tree/marcus?up=3&down=0&lineage=birth');
    expect(screen.getByText('Grandparents')).toBeTruthy();
    expect(screen.getAllByText('Father not on the tree').length).toBeGreaterThan(0);
    expect(screen.getByRole('group', { name: 'Legend' }).textContent).toContain('Father above, mother below');
    expect(document.querySelector('[data-leaf]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Chart view: Pedigree' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Priya/ })).toBeNull(); // not a blood ancestor
  });

  it('makes a clicked person the root, and keeps the view and the generations', async () => {
    const fetchMock = mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus?view=pedigree&gen=5');
    fireEvent.click(await screen.findByRole('button', { name: /^Daniel Hale/ }));
    await waitFor(() => expect(calls(fetchMock)).toContain('GET /api/tree/daniel?up=4&down=0&lineage=birth'));
    const panel = await screen.findByRole('complementary', { name: 'Selected person' });
    await within(panel).findByRole('heading', { name: 'Daniel Hale', level: 2 });
    expect(await screen.findByRole('button', { name: /^Walter Hale/ })).toBeTruthy();
  });

  it('keeps the chart on screen until the next one has arrived', async () => {
    const base = haleRoutes(ADMIN)['GET /api/tree/*'] as (init: RequestInit, path: string) => MockReply;
    mockApi(
      haleRoutes(ADMIN, {
        'GET /api/tree/*': (init, path) => (path.includes('/tree/daniel?') ? 'never' : base(init, path)),
      }),
    );
    renderApp('/tree/marcus?view=pedigree');
    fireEvent.click(await screen.findByRole('button', { name: /^Daniel Hale/ }));
    // Daniel's chart never arrives: Marcus's is still there, marked as busy, not replaced by "Loading".
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).not.toBeNull());
    expect(screen.getByRole('button', { name: /^Marcus Hale/ })).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('draws the same cards when the viewer follows the adoptive family: birth parents only', async () => {
    mockApi(haleRoutes({ ...ADMIN, lineageView: 'adoptive' }));
    renderApp('/tree/samuel?view=pedigree&gen=3');
    await screen.findByRole('button', { name: /^Frank Doyle/ });
    expect(screen.queryByRole('button', { name: /^Joseph Hale/ })).toBeNull();
  });

  it('has search and Center on me re-root in the same view', async () => {
    const fetchMock = mockApi(haleRoutes({ ...ADMIN, personId: 'sofia' }));
    renderApp('/tree/marcus?view=pedigree&gen=3');
    await screen.findByRole('button', { name: /^Walter Hale/ });
    fireEvent.click(screen.getByRole('button', { name: 'Center on me' }));
    await waitFor(() => expect(calls(fetchMock)).toContain('GET /api/tree/sofia?up=2&down=0&lineage=birth'));
  });

  it('never moves a card when the panel opens or the keyboard selects', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus?view=pedigree');
    await screen.findByRole('button', { name: /^Walter Hale/ });
    const positions = () =>
      Object.fromEntries(
        Array.from(document.querySelectorAll('[data-node]')).map((n) => [
          n.getAttribute('data-node'),
          n.parentElement?.getAttribute('transform'),
        ]),
      );
    const before = positions();
    const daniel = document.querySelector<SVGElement>('[data-node="daniel"]')!;
    daniel.focus();
    fireEvent.keyDown(daniel, { key: 'ArrowDown' });
    expect(positions()).toEqual(before);
  });
});
