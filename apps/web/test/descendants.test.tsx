// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { TreeResponse } from '@kinship/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DESCENDANTS_NODE_H, layoutDescendants } from '../src/tree/descendantsLayout.js';
import { ADMIN, haleRoutes, PEOPLE, treeFor } from './family.js';
import { calls, mockApi, renderApp } from './helpers.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const below = (id: string, gen: number, lineage: 'birth' | 'adoptive' = 'adoptive') =>
  treeFor(id, { up: 0, down: gen, collateral: false, lineage });
const note = (layout: ReturnType<typeof layoutDescendants>['layout'], id: string) => layout.byId.get(id)!.note;

describe('the Descendants layout', () => {
  const { layout, ids } = layoutDescendants(below('walter', 5), 'walter', 5);
  const at = (id: string) => layout.byId.get(id)!;
  const centre = (id: string) => at(id).y + DESCENDANTS_NODE_H / 2;

  it('draws the person and everyone below them, one column for each generation, and no stepchildren', () => {
    expect([...ids].sort()).toEqual(['ben', 'carla', 'daniel', 'marcus', 'sofia', 'walter']);
    expect(ids.has('tomas')).toBe(false); // Priya's son from before: Daniel's stepson
    expect([at('walter').row, at('daniel').row, at('marcus').row]).toEqual([0, 1, 2]);
    expect(at('daniel').x).toBeGreaterThan(at('walter').x);
    expect(layout.titles!.map((t) => t.text)).toEqual([
      'Selected person',
      'Children',
      'Grandchildren',
      'Great-grandchildren',
      '2nd great-grandchildren',
    ]);
  });

  it('groups the children under their parent in birth order, with the parent beside the middle of them', () => {
    expect(layout.rows[2]).toEqual(['marcus', 'sofia', 'carla', 'ben']);
    expect(centre('daniel')).toBeCloseTo((centre('marcus') + centre('ben')) / 2, 5);
    expect(centre('walter')).toBeCloseTo(centre('daniel'), 5);
    const link = layout.links.find((l) => l.key === 'daniel')!;
    expect(link.childIds).toEqual(['marcus', 'sofia', 'carla', 'ben']);
  });

  it('lists the partners on the card, in order, and says when there are none', () => {
    expect(note(layout, 'walter')).toBe('m. Rosa');
    expect(note(layout, 'daniel')).toBe('m. Elena · div. Priya');
    expect(note(layout, 'sofia')).toBe('eng. Lena');
    expect(note(layout, 'marcus')).toBe('No partner on record');
  });

  it('says how many children are below a card at the depth limit', () => {
    const limit = layoutDescendants(below('walter', 2), 'walter', 2).layout;
    expect(note(limit, 'daniel')).toBe('m. Elena · div. Priya · 4 children below');
    expect(limit.byId.has('marcus')).toBe(false);
    const one = layoutDescendants(below('daniel', 1), 'daniel', 1).layout;
    expect(note(one, 'daniel')).toContain('4 children below');
    const single = layoutDescendants(below('femi', 1), 'femi', 1).layout;
    expect(note(single, 'femi')).toBe('m. Nora · 1 child below'); // Lena
    const two = layoutDescendants(below('priya', 1), 'priya', 1).layout;
    expect(note(two, 'priya')).toBe('div. Daniel · 2 children below'); // Carla, and Tomas who is hers alone
  });

  it('follows the viewer’s lineage view for an adopted child, and shows him once', () => {
    const adoptive = layoutDescendants(below('joseph', 2, 'adoptive'), 'joseph', 3);
    expect(adoptive.ids.has('samuel')).toBe(true);
    const birth = layoutDescendants(below('joseph', 2, 'birth'), 'joseph', 3);
    expect(birth.ids.has('samuel')).toBe(false);
    const birthOfFrank = layoutDescendants(below('frank', 2, 'birth'), 'frank', 3);
    expect(birthOfFrank.ids.has('samuel')).toBe(true);
    expect(birthOfFrank.layout.nodes.filter((n) => n.id === 'samuel')).toHaveLength(1);
  });

  it('has a taller card, with the cards of a column apart and everything inside the chart', () => {
    expect(layout.nodeHeight).toBe(DESCENDANTS_NODE_H);
    for (const row of layout.rows) {
      for (let i = 1; i < row.length; i += 1) {
        expect(at(row[i]!).y - at(row[i - 1]!).y).toBeGreaterThanOrEqual(DESCENDANTS_NODE_H);
      }
    }
    for (const n of layout.nodes) expect(n.y + DESCENDANTS_NODE_H).toBeLessThanOrEqual(layout.height);
  });

  it('is the same whatever order the response comes in', () => {
    const tree = below('walter', 5);
    const shuffled = {
      ...tree,
      people: [...tree.people].reverse(),
      unions: [...tree.unions].reverse(),
      parentage: Object.fromEntries(Object.entries(tree.parentage).reverse()),
    };
    const flat = (l: typeof layout) =>
      [...l.nodes].sort((x, y) => (x.id < y.id ? -1 : 1)).map((n) => [n.id, n.x, n.y, n.note]);
    expect(flat(layoutDescendants(shuffled, 'walter', 5).layout)).toEqual(flat(layout));
  });

  it('moves with the arrow keys: right to the first child, left to the parent, up and down in a column', () => {
    const go = layout.navigate!;
    expect(go('walter', 'ArrowRight')).toBe('daniel');
    expect(go('daniel', 'ArrowRight')).toBe('marcus');
    expect(go('marcus', 'ArrowLeft')).toBe('daniel');
    expect(go('marcus', 'ArrowDown')).toBe('sofia');
    expect(go('sofia', 'ArrowUp')).toBe('marcus');
    expect(go('marcus', 'ArrowUp')).toBeUndefined();
    expect(go('walter', 'ArrowLeft')).toBeUndefined();
    expect(go('ben', 'ArrowRight')).toBeUndefined();
  });

  it('draws a child of two descendants once, under the first parent', () => {
    // Daniel's children Marcus and Sofia, and a child of both of them (cousins' child stand-in): drawn once.
    const tree: TreeResponse = {
      ...below('daniel', 4),
      unions: [
        ...below('daniel', 4).unions,
        {
          id: 'ux',
          partnerIds: ['marcus', 'sofia'],
          status: 'married',
          start: null,
          end: null,
          statusAuto: false,
          createdAt: '',
          updatedAt: '',
        },
      ],
      parentage: { ...below('daniel', 4).parentage, ben: { unionId: 'ux', parentId: null, kind: 'birth', link: null } },
    };
    const { layout: l } = layoutDescendants(tree, 'daniel', 4);
    expect(l.nodes.filter((n) => n.id === 'ben')).toHaveLength(1);
    expect(l.links.filter((k) => k.childIds.includes('ben'))).toHaveLength(1);
  });
});

describe('the worst case: five generations of a wide family', () => {
  it('lays out 1,555 people (six children each) soundly and quickly', () => {
    const people = [] as TreeResponse['people'];
    const parentage: TreeResponse['parentage'] = {};
    const base = PEOPLE.find((p) => p.id === 'walter')!;
    let n = 0;
    const make = (): string => {
      n += 1;
      const id = `w${String(n).padStart(5, '0')}`;
      people.push({
        ...base,
        id,
        givenName: `G${n}`,
        birth: { value: String(1900 + (n % 90)), precision: 'exactly' },
        hasParents: false,
      });
      return id;
    };
    const root = make();
    let level = [root];
    for (let d = 1; d < 5; d += 1) {
      const next: string[] = [];
      for (const parent of level) {
        for (let k = 0; k < 6; k += 1) {
          const child = make();
          parentage[child] = { unionId: null, parentId: parent, kind: 'birth', link: null };
          next.push(child);
        }
      }
      level = next;
    }
    const tree: TreeResponse = { lineage: 'adoptive', focalId: root, totalPeople: n, people, unions: [], parentage };
    const started = performance.now();
    const { layout } = layoutDescendants(tree, root, 5);
    const ms = performance.now() - started;
    console.log(`descendants layout of ${layout.nodes.length} people over 5 generations: ${ms.toFixed(1)} ms`);
    expect(layout.nodes).toHaveLength(n);
    expect(ms).toBeLessThan(1000);
    for (const row of layout.rows) {
      for (let i = 1; i < row.length; i += 1) {
        expect(layout.byId.get(row[i]!)!.y - layout.byId.get(row[i - 1]!)!.y).toBeGreaterThanOrEqual(
          DESCENDANTS_NODE_H,
        );
      }
    }
  });
});

describe('Descendants in the app', () => {
  it('asks for the viewer’s own lineage, one column for each generation, partners on the cards, no leaves', async () => {
    const fetchMock = mockApi(haleRoutes(ADMIN));
    renderApp('/tree/walter?view=descendants');
    await screen.findByRole('button', { name: /^Marcus Hale/ });
    expect(calls(fetchMock)).toContain('GET /api/tree/walter?up=0&down=5');
    expect(screen.getByText('Grandchildren')).toBeTruthy();
    expect(screen.getByText('m. Elena · div. Priya')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Tomas/ })).toBeNull();
    expect(document.querySelector('[data-leaf]')).toBeNull();
    expect(screen.getByRole('group', { name: 'Legend' }).textContent).toContain('Stepchildren are not shown');
  });

  it('goes to the person clicked, in the same view', async () => {
    const fetchMock = mockApi(haleRoutes(ADMIN));
    renderApp('/tree/walter?view=descendants&gen=3');
    fireEvent.click(await screen.findByRole('button', { name: /^Daniel Hale/ }));
    await waitFor(() => expect(calls(fetchMock)).toContain('GET /api/tree/daniel?up=0&down=3'));
    await screen.findByRole('button', { name: /^Marcus Hale/ });
  });

  it('draws fewer generations when fewer are chosen in the switcher', async () => {
    const fetchMock = mockApi(haleRoutes(ADMIN));
    renderApp('/tree/walter?view=descendants');
    await screen.findByRole('button', { name: /^Marcus Hale/ });
    fireEvent.click(screen.getByRole('button', { name: 'Chart view: Descendants' }));
    fireEvent.click(screen.getByRole('button', { name: '2 generations' }));
    await waitFor(() => expect(calls(fetchMock)).toContain('GET /api/tree/walter?up=0&down=2'));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Marcus Hale/ })).toBeNull());
    expect(screen.getByText(/4 children below/)).toBeTruthy();
  });
});
