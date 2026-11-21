// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { PEOPLE, treeFor } from './family.js';
import { ancestorsIn, familyView, findLeaves, initials, leafLabel, nodeLabel } from '../src/tree/family.js';
import { centerOn, clampScale, fitView, initialView, reveal, wheelView, zoomAt } from '../src/tree/viewport.js';

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
  it('starts on the person when the whole chart would be drawn smaller than 0.7', () => {
    const big = initialView({ width: 50_000, height: 800 }, { width: 1000, height: 600 }, { x: 25_000, y: 400 });
    expect(big).toEqual({ k: 0.7, x: 500 - 25_000 * 0.7, y: 300 - 400 * 0.7 });
    // 2000 x 500 in 1000 x 600 fits at 0.484: it used to open whole (limit 0.45), now it opens on the person.
    const wide = initialView({ width: 2000, height: 500 }, { width: 1000, height: 600 }, { x: 1500, y: 250 });
    expect(wide.k).toBe(0.7);
    expect(wide.x).toBeCloseTo(500 - 1500 * 0.7, 6);
    const small = initialView({ width: 800, height: 400 }, { width: 1000, height: 600 }, { x: 0, y: 0 });
    expect(small.k).toBe(1);
  });
  it('opens whole at exactly the limit, and whole when there is nobody to centre on', () => {
    // 1368 wide in 1000: (1000 - 32) / 1368 = 0.7076, just above the limit
    expect(initialView({ width: 1368, height: 300 }, { width: 1000, height: 600 }, { x: 0, y: 0 }).k).toBeCloseTo(
      0.7076,
      3,
    );
    expect(initialView({ width: 50_000, height: 800 }, { width: 1000, height: 600 }, undefined).k).toBe(0.1);
  });
  it('reveals a rectangle with the smallest pan', () => {
    const v = { k: 1, x: 0, y: 0 };
    expect(reveal(v, { x: 100, y: 100, width: 50, height: 50 }, { width: 400, height: 400 })).toEqual(v);
    expect(reveal(v, { x: 500, y: 10, width: 50, height: 50 }, { width: 400, height: 400 }).x).toBe(-174);
  });
});

describe('family view: brothers’ and sisters’ partners and children', () => {
  // The Hale fixture has no married sibling, so build one on top of Marcus: Marcus's sister Sofia gets a husband Hugo
  // (whose parents Gus and Hilda are known) and a daughter Mia; Sofia also has a half-brother and an aunt's family.
  const base = treeFor('marcus', { up: 3, down: 2, collateral: true });
  const person = (id: string, over: Record<string, unknown> = {}) => ({
    ...PEOPLE.find((p) => p.id === 'sofia')!,
    id,
    givenName: id,
    surname: 'Test',
    hasParents: false,
    ...over,
  });
  const tree = {
    ...base,
    people: [
      ...base.people,
      person('hugo', { hasParents: true, ancestorCount: 2 }),
      person('mia'),
      person('sam'), // Daniel's brother (an uncle of Marcus)
      person('sue'), // the uncle's wife
      person('cora'), // a cousin
    ],
    unions: [
      ...base.unions,
      { ...base.unions[0]!, id: 'ux1', partnerIds: ['sofia', 'hugo'] as [string, string] },
      { ...base.unions[0]!, id: 'ux2', partnerIds: ['sam', 'sue'] as [string, string] },
    ],
    parentage: {
      ...base.parentage,
      mia: { unionId: 'ux1', parentId: null, kind: 'birth' as const, link: null },
      sam: { unionId: 'u0', parentId: null, kind: 'birth' as const, link: null },
      cora: { unionId: 'ux2', parentId: null, kind: 'birth' as const, link: null },
    },
  };
  const view = familyView(tree, 'marcus');
  const ids = view.people.map((p) => p.id);

  it('keeps a sibling’s partner and their children', () => {
    expect(ids).toEqual(expect.arrayContaining(['sofia', 'hugo', 'mia']));
    expect(view.unions.map((u) => u.id)).toContain('ux1');
    expect(view.parentage['mia']).toMatchObject({ unionId: 'ux1' });
  });
  it('still drops aunts, uncles, cousins and half-siblings', () => {
    for (const id of ['sam', 'sue', 'cora', 'carla', 'priya', 'ben']) expect(ids).not.toContain(id);
    expect(view.unions.map((u) => u.id)).not.toContain('ux2');
  });
  it('leaves the partner’s parents behind a leaf with their count', () => {
    const hugo = view.people.find((p) => p.id === 'hugo')!;
    expect(view.parentage['hugo']).toBeUndefined();
    expect(hugo.hasParents).toBe(true);
    expect(hugo.ancestorCount).toBe(2);
    expect(findLeaves(view, 'marcus', tree, true).find((l) => l.personId === 'hugo')?.count).toBe(2);
  });
  it('keeps the invariant', () => {
    const drawn = new Set(ids);
    for (const u of view.unions) expect(u.partnerIds.every((p) => drawn.has(p))).toBe(true);
    for (const [child, link] of Object.entries(view.parentage)) {
      expect(drawn.has(child)).toBe(true);
      if (link.parentId) expect(drawn.has(link.parentId)).toBe(true);
      else expect(view.unions.some((u) => u.id === link.unionId)).toBe(true);
    }
  });
  it('Marcus’s view of the Hale family gains Lena, with a leaf for her parents', () => {
    const hale = familyView(treeFor('marcus', { up: 3, down: 1, collateral: true }), 'marcus');
    expect(hale.people.map((p) => p.id).sort()).toEqual([
      'daniel',
      'elena',
      'lena',
      'marcus',
      'rosa',
      'sofia',
      'walter',
    ]);
    expect(hale.people.find((p) => p.id === 'lena')?.ancestorCount).toBe(3);
  });
});

describe('the mouse wheel', () => {
  const view = { k: 1, x: 100, y: 50 };
  const box = { width: 800, height: 600 };
  const at = { x: 400, y: 300 };
  const wheel = (over: Partial<Parameters<typeof wheelView>[1]>) => ({
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ctrlKey: false,
    shiftKey: false,
    ...over,
  });

  it('zooms around the pointer in zoom mode, as it always did (a pinch, with Ctrl, is much faster)', () => {
    const plain = wheelView(view, wheel({ deltaY: -100 }), 'zoom', at, box);
    expect(plain).toEqual(zoomAt(view, Math.exp(100 * 0.0015), 400, 300));
    const pinch = wheelView(view, wheel({ deltaY: -100, ctrlKey: true }), 'zoom', at, box);
    expect(pinch).toEqual(zoomAt(view, Math.exp(100 * 0.01), 400, 300));
    expect(pinch.k).toBeGreaterThan(plain.k);
  });

  it('moves the chart in scroll mode, by deltaX and deltaY, without changing the zoom', () => {
    expect(wheelView(view, wheel({ deltaX: 30, deltaY: 40 }), 'scroll', at, box)).toEqual({ k: 1, x: 70, y: 10 });
    expect(wheelView(view, wheel({ deltaY: -25 }), 'scroll', at, box)).toEqual({ k: 1, x: 100, y: 75 });
    // The pan is not limited.
    expect(wheelView(view, wheel({ deltaX: 100_000 }), 'scroll', at, box).x).toBe(100 - 100_000);
  });

  it('still zooms with Ctrl or a pinch in scroll mode', () => {
    const pinch = wheelView(view, wheel({ deltaY: -50, ctrlKey: true }), 'scroll', at, box);
    expect(pinch).toEqual(zoomAt(view, Math.exp(50 * 0.01), 400, 300));
  });

  it('counts a line as 16 px and a page as the size of the window', () => {
    expect(wheelView(view, wheel({ deltaY: 3, deltaMode: 1 }), 'scroll', at, box)).toEqual({ k: 1, x: 100, y: 2 });
    expect(wheelView(view, wheel({ deltaY: 1, deltaMode: 2 }), 'scroll', at, box)).toEqual({ k: 1, x: 100, y: -550 });
    expect(wheelView(view, wheel({ deltaX: 1, deltaMode: 2 }), 'scroll', at, box)).toEqual({ k: 1, x: -700, y: 50 });
  });

  it('moves sideways with Shift and a vertical wheel, but leaves a sideways wheel alone', () => {
    expect(wheelView(view, wheel({ deltaY: 40, shiftKey: true }), 'scroll', at, box)).toEqual({ k: 1, x: 60, y: 50 });
    expect(wheelView(view, wheel({ deltaX: 40, deltaY: 10, shiftKey: true }), 'scroll', at, box)).toEqual({
      k: 1,
      x: 60,
      y: 40,
    });
  });
});
