// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { PEOPLE, treeFor } from './family.js';
import { ancestorsIn, familyView, findLeaves, initials, leafLabel, nodeLabel } from '../src/tree/family.js';
import { centerOn, clampScale, fitView, initialView, reveal, zoomAt } from '../src/tree/viewport.js';

describe('family view', () => {
  const full = treeFor('sofia', { up: 3, down: 1, collateral: true });
  const view = familyView(full, 'sofia');
  const ids = view.people.map((p) => p.id).sort();

  it('keeps ancestors, full siblings, partners and the partners’ children', () => {
    expect(ids).toEqual(['daniel', 'elena', 'lena', 'marcus', 'rosa', 'sofia', 'walter']);
  });
  it('drops half-siblings, their other parent and their relationships', () => {
    expect(ids).not.toContain('carla');
    expect(ids).not.toContain('priya');
    expect(view.unions.map((u) => u.id).sort()).toEqual(['u0', 'u1', 'u4']);
  });
  it('keeps the invariant: partners drawn, parent links point at drawn people', () => {
    const drawn = new Set(ids);
    for (const u of view.unions) expect(u.partnerIds.every((p) => drawn.has(p))).toBe(true);
    for (const [child, link] of Object.entries(view.parentage)) {
      expect(drawn.has(child)).toBe(true);
      if (link.parentId) expect(drawn.has(link.parentId)).toBe(true);
      else expect(view.unions.some((u) => u.id === link.unionId)).toBe(true);
    }
  });
  it('counts a person whose parents the view hides', () => {
    const lena = familyView(treeFor('sofia', { up: 3, down: 1, collateral: true }), 'sofia').people.find(
      (p) => p.id === 'lena',
    )!;
    expect(lena.ancestorCount).toBe(3);
  });
});

describe('leaves', () => {
  it('on the main chart: an in-law flips to their family, a blood ancestor at the limit re-roots', () => {
    const tree = treeFor('marcus', { up: 1, down: 2, collateral: true });
    const leaves = findLeaves(tree, 'marcus', tree, false);
    const byId = Object.fromEntries(leaves.map((l) => [l.personId, l.target]));
    expect(byId['daniel']).toEqual({ kind: 'root', personId: 'daniel' });
    expect(byId['lena']).toEqual({ kind: 'family', personId: 'lena' });
    expect(byId['marcus']).toBeUndefined();
  });
  it('in a family view: a person whose parents are on the main chart flips back', () => {
    const main = treeFor('marcus', { up: 3, down: 2, collateral: true });
    const view = familyView(treeFor('lena', { up: 3, down: 1, collateral: true }), 'lena');
    const leaves = findLeaves(view, 'lena', main, true);
    expect(leaves.find((l) => l.personId === 'sofia')?.target).toEqual({ kind: 'main' });
  });
  it('labels', () => {
    expect(leafLabel({ givenName: 'Priya', surname: 'Nair' }, 4)).toBe('Show Priya’s family (4 people)');
    expect(leafLabel({ givenName: 'Priya', surname: 'Nair' }, 1)).toBe('Show Priya’s family (1 person)');
    expect(leafLabel({ givenName: 'Priya', surname: 'Nair' }, null)).toBe('Show Priya’s family');
  });
  it('ancestorsIn', () => {
    expect([...ancestorsIn(treeFor('marcus'), 'marcus')].sort()).toEqual(['daniel', 'elena', 'rosa', 'walter']);
  });
});

describe('nodes', () => {
  it('names and initials', () => {
    const marcus = PEOPLE.find((p) => p.id === 'marcus')!;
    expect(nodeLabel(marcus)).toBe('Marcus Hale, born 1988, male');
    expect(nodeLabel(PEOPLE.find((p) => p.id === 'lena')!)).toBe('Lena Okafor, born 1989, other');
    expect(initials(marcus)).toBe('MH');
  });
});

describe('pan and zoom arithmetic', () => {
  it('zooms around a point, keeping it still, within limits', () => {
    const view = zoomAt({ k: 1, x: 0, y: 0 }, 2, 100, 50);
    expect(view).toEqual({ k: 2, x: -100, y: -50 });
    expect(zoomAt({ k: 2.5, x: 0, y: 0 }, 2, 0, 0).k).toBe(2.5);
    expect(clampScale(0.001)).toBe(0.1);
  });
  it('fits and centres', () => {
    const v = fitView({ width: 2000, height: 500 }, { width: 1000, height: 600 });
    expect(v.k).toBeCloseTo(0.484, 2);
    expect(v.x).toBeCloseTo(16, 0);
    expect(centerOn({ x: 100, y: 100 }, 1, { width: 400, height: 200 })).toEqual({ k: 1, x: 100, y: 0 });
  });
  it('starts on the person when the whole chart would be too small to read', () => {
    const big = initialView({ width: 50_000, height: 800 }, { width: 1000, height: 600 }, { x: 25_000, y: 400 });
    expect(big.k).toBe(0.7);
    const small = initialView({ width: 800, height: 400 }, { width: 1000, height: 600 }, { x: 0, y: 0 });
    expect(small.k).toBe(1);
  });
  it('reveals a rectangle with the smallest pan', () => {
    const v = { k: 1, x: 0, y: 0 };
    expect(reveal(v, { x: 100, y: 100, width: 50, height: 50 }, { width: 400, height: 400 })).toEqual(v);
    expect(reveal(v, { x: 500, y: 10, width: 50, height: 50 }, { width: 400, height: 400 }).x).toBe(-174);
  });
});
