// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { layoutTree, NODE_H, NODE_W, PITCH } from '../src/tree/layout.js';
import type { Layout, LayoutInput } from '../src/tree/layout.js';
import { bigFamily, family, HALE } from './layout-fixtures.js';

/** The checks every layout has to pass. */
function expectSound(layout: Layout, input: LayoutInput) {
  // Everyone is placed exactly once.
  expect(layout.nodes.length).toBe(input.people.length);
  expect(new Set(layout.nodes.map((n) => n.id)).size).toBe(input.people.length);
  // No two boxes in a row overlap.
  for (const row of layout.rows) {
    for (let i = 1; i < row.length; i += 1) {
      const a = layout.byId.get(row[i - 1]!)!;
      const b = layout.byId.get(row[i]!)!;
      expect(b.x - a.x, `${a.id} and ${b.id} overlap`).toBeGreaterThanOrEqual(NODE_W);
    }
  }
  // A child is always below its parents.
  for (const [child, link] of Object.entries(input.parentage)) {
    const parents = link.unionId
      ? (input.unions.find((u) => u.id === link.unionId)?.partnerIds ?? [])
      : [link.parentId!];
    for (const p of parents) expect(layout.byId.get(child)!.row).toBeGreaterThan(layout.byId.get(p)!.row);
  }
  // Partners are on one row.
  for (const u of input.unions) {
    expect(layout.byId.get(u.partnerIds[0])!.row).toBe(layout.byId.get(u.partnerIds[1])!.row);
  }
  // Every number is finite.
  for (const n of layout.nodes) {
    expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
  }
}

/** The children of a relationship are centred under the middle of its couple line. */
function expectCentred(layout: Layout, unionId: string, tolerance = 0.5) {
  const link = layout.links.find((l) => l.unionId === unionId);
  const couple = layout.couples.find((c) => c.unionId === unionId)!;
  expect(link, `children of ${unionId}`).toBeDefined();
  const xs = link!.childIds.map((id) => layout.byId.get(id)!.x);
  const middle = (Math.min(...xs) + Math.max(...xs)) / 2;
  expect(Math.abs(middle - couple.hangX), `${unionId} children middle ${middle} vs hang ${couple.hangX}`).toBeLessThan(
    tolerance,
  );
}

function expectAdjacent(layout: Layout, unionId: string) {
  const c = layout.couples.find((x) => x.unionId === unionId)!;
  expect(c.bracket, `${unionId} is a straight line`).toBe(false);
  expect(c.x2 - c.x1).toBeCloseTo(PITCH * (c.x2 - c.x1 > PITCH * 1.01 ? (c.x2 - c.x1) / PITCH : 1), 0);
  const row = layout.rows[layout.byId.get(c.left)!.row]!;
  expect(row.indexOf(c.right) - row.indexOf(c.left)).toBe(1);
}

const x = (layout: Layout, id: string) => layout.byId.get(id)!.x;

describe('the Hale family', () => {
  const input = family(HALE);
  const layout = layoutTree(input);

  it('is sound', () => expectSound(layout, input));

  it('puts each generation on its own row', () => {
    const row = (id: string) => layout.byId.get(id)!.row;
    expect([row('walter'), row('rosa')]).toEqual([0, 0]);
    expect([row('daniel'), row('elena'), row('beatriz')]).toEqual([1, 1, 1]);
    expect([row('marcus'), row('sofia'), row('gabriel'), row('tomas'), row('priya')]).toEqual([2, 2, 2, 2, 2]);
    expect(row('leo')).toBe(3);
  });

  it('puts a person with two relationships in the middle, the earlier one on the left', () => {
    expect(x(layout, 'elena')).toBeLessThan(x(layout, 'daniel'));
    expect(x(layout, 'daniel')).toBeLessThan(x(layout, 'beatriz'));
    expectAdjacent(layout, 'de');
    expectAdjacent(layout, 'db');
  });

  it('keeps the children of each relationship under its own couple line', () => {
    expectCentred(layout, 'wr');
    expectCentred(layout, 'de');
    expectCentred(layout, 'db');
    expectCentred(layout, 'mp');
    // Previous marriage's children are left of the current marriage's.
    expect(Math.max(x(layout, 'marcus'), x(layout, 'sofia'))).toBeLessThan(x(layout, 'gabriel'));
  });

  it('puts the single-parent child between the relationships, under the parent', () => {
    const link = layout.links.find((l) => l.parentId === 'beatriz')!;
    expect(link.childIds).toEqual(['tomas']);
    expect(x(layout, 'tomas')).toBeGreaterThan(x(layout, 'gabriel'));
    expect(link.d.startsWith(`M${x(layout, 'beatriz')} ${layout.byId.get('beatriz')!.y + NODE_H}`)).toBe(true);
  });

  it("draws a partner's own son from before (Tomas) under her, beside the child of her marriage", () => {
    const link = layout.links.find((l) => l.parentId === 'beatriz')!;
    expect(link.childIds).toEqual(['tomas']);
    expect(layout.byId.get('tomas')!.row).toBe(layout.byId.get('beatriz')!.row + 1);
    expect(Math.abs(x(layout, 'tomas') - x(layout, 'beatriz'))).toBeLessThan(400);
  });

  it('orders siblings by birth', () => {
    expect(x(layout, 'marcus')).toBeLessThan(x(layout, 'sofia'));
  });

  it('puts the partner with drawn parents on the left of a couple', () => {
    expect(x(layout, 'marcus')).toBeLessThan(x(layout, 'priya'));
  });

  it('is the same every time', () => {
    expect(layoutTree(input).nodes).toEqual(layout.nodes);
  });
});

describe('edge cases', () => {
  it('an empty family', () => {
    const layout = layoutTree({ focalId: 'x', people: [], unions: [], parentage: {} });
    expect(layout.nodes).toEqual([]);
  });

  it('one person', () => {
    const input = family({ people: [['solo']] });
    const layout = layoutTree(input);
    expectSound(layout, input);
  });

  it('remarriage: a person with two partners, each with children', () => {
    const input = family({
      people: [
        ['p', '1960'],
        ['a', '1962'],
        ['b', '1970'],
        ['a1', '1985'],
        ['a2', '1988'],
        ['b1', '2000'],
      ],
      unions: [
        ['pa', 'p', 'a', 'divorced', '1984'],
        ['pb', 'p', 'b', 'married', '1998'],
      ],
      kids: { a1: 'pa', a2: 'pa', b1: 'pb' },
    });
    const layout = layoutTree(input);
    expectSound(layout, input);
    expect(x(layout, 'a')).toBeLessThan(x(layout, 'p'));
    expect(x(layout, 'p')).toBeLessThan(x(layout, 'b'));
    expectCentred(layout, 'pa');
    expectCentred(layout, 'pb');
    expectAdjacent(layout, 'pa');
    expectAdjacent(layout, 'pb');
  });

  it('divorced then remarried to the same person (two relationships between the same two)', () => {
    const input = family({
      people: [
        ['m', '1960'],
        ['w', '1962'],
        ['k1', '1985'],
        ['k2', '1995'],
      ],
      unions: [
        ['first', 'm', 'w', 'divorced', '1984'],
        ['second', 'm', 'w', 'married', '1994'],
      ],
      kids: { k1: 'first', k2: 'second' },
    });
    const layout = layoutTree(input);
    expectSound(layout, input);
    expect(layout.couples).toHaveLength(2);
    // Two partners, two relationships: both lines join the same two boxes, and each has its children.
    expect(layout.links.map((l) => l.unionId).sort()).toEqual(['first', 'second']);
    expect(x(layout, 'k1')).toBeLessThan(x(layout, 'k2'));
  });

  it('three relationships: the third goes further right, drawn as a bracket under the one between', () => {
    const input = family({
      people: [
        ['p', '1950'],
        ['a', '1952'],
        ['b', '1960'],
        ['c', '1965'],
        ['kc', '1990'],
      ],
      unions: [
        ['pa', 'p', 'a', 'divorced', '1970'],
        ['pb', 'p', 'b', 'divorced', '1980'],
        ['pc', 'p', 'c', 'married', '1989'],
      ],
      kids: { kc: 'pc' },
    });
    const layout = layoutTree(input);
    expectSound(layout, input);
    expect(x(layout, 'a')).toBeLessThan(x(layout, 'p'));
    expect(x(layout, 'p')).toBeLessThan(x(layout, 'b'));
    expect(x(layout, 'b')).toBeLessThan(x(layout, 'c'));
    expect(layout.couples.find((c) => c.unionId === 'pa')!.bracket).toBe(false);
    expect(layout.couples.find((c) => c.unionId === 'pb')!.bracket).toBe(false);
    expect(layout.couples.find((c) => c.unionId === 'pc')!.bracket).toBe(true);
    expectCentred(layout, 'pc');
  });

  it('30 children of one couple', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `c${String(i).padStart(2, '0')}`);
    const input = family({
      people: [['a', '1950'], ['b', '1952'], ...ids.map((id, i): [string, string] => [id, String(1975 + i)])],
      unions: [['ab', 'a', 'b']],
      kids: Object.fromEntries(ids.map((id) => [id, 'ab'])),
    });
    const layout = layoutTree(input);
    expectSound(layout, input);
    expectCentred(layout, 'ab');
    // In birth order, left to right, in one row.
    expect(layout.rows[1]).toEqual(ids);
    expect(layout.width).toBeGreaterThan(30 * NODE_W);
  });

  it('children with no birth date come last, then by name', () => {
    const input = family({
      people: [['a', '1950'], ['b', '1952'], ['zed'], ['amy'], ['old', '1980']],
      unions: [['ab', 'a', 'b']],
      kids: { zed: 'ab', amy: 'ab', old: 'ab' },
    });
    const layout = layoutTree(input);
    expect(layout.rows[1]).toEqual(['old', 'amy', 'zed']);
  });

  it('an in-law with relationships of their own (earlier marriages) stays one node with the lines to it', () => {
    // Marcus married Priya; Priya was married to X1 and X2 before (not drawn: only Priya is here).
    // X1 is drawn because he is Priya's earlier husband and is also somebody's child here.
    const input = family({
      people: [
        ['gp', '1930'],
        ['gm', '1932'],
        ['m', '1960'],
        ['x1', '1958'],
        ['pri', '1962'],
        ['x2', '1955'],
        ['k', '1990'],
        ['k2', '1995'],
      ],
      unions: [
        ['g', 'gp', 'gm'],
        ['x1pri', 'x1', 'pri', 'divorced', '1985'],
        ['mpri', 'm', 'pri', 'married', '1989'],
        ['x2pri', 'x2', 'pri', 'divorced', '1980'],
      ],
      kids: { m: 'g', k: 'mpri', k2: 'x1pri' },
    });
    const layout = layoutTree(input);
    expectSound(layout, input);
    expect(layout.couples).toHaveLength(4);
    const nodes = layout.nodes.filter((n) => n.id === 'pri');
    expect(nodes).toHaveLength(1);
    expectCentred(layout, 'mpri');
  });

  it('cousins who marry: the couple sits under one family, the other parent link is long', () => {
    const input = family({
      focal: 'kid',
      people: [
        ['gp', '1900'],
        ['gm', '1902'],
        ['a', '1925'],
        ['aw', '1927'],
        ['b', '1928'],
        ['bh', '1929'],
        ['c1', '1950'],
        ['c2', '1952'],
        ['kid', '1980'],
      ],
      unions: [
        ['g', 'gp', 'gm'],
        ['aa', 'a', 'aw'],
        ['bb', 'b', 'bh'],
        ['cc', 'c1', 'c2'],
      ],
      kids: { a: 'g', b: 'g', c1: 'aa', c2: 'bb', kid: 'cc' },
    });
    const layout = layoutTree(input);
    expectSound(layout, input);
    expectCentred(layout, 'cc');
    // Both parents' links are drawn.
    expect(layout.links.find((l) => l.unionId === 'aa')!.childIds).toEqual(['c1']);
    expect(layout.links.find((l) => l.unionId === 'bb')!.childIds).toEqual(['c2']);
  });

  it('single-parent children hang from that parent alone, beside a couple with children', () => {
    const input = family({
      people: [
        ['m', '1960'],
        ['w', '1962'],
        ['k1', '1985'],
        ['solo', '1990'],
      ],
      unions: [['mw', 'm', 'w']],
      kids: { k1: 'mw', solo: 'p:m' },
    });
    const layout = layoutTree(input);
    expectSound(layout, input);
    const solo = layout.links.find((l) => l.parentId === 'm')!;
    expect(solo.childIds).toEqual(['solo']);
    expect(solo.unionId).toBeNull();
    // m is the left partner, so the child hanging from m alone is under m, left of the couple's own child.
    expect(x(layout, 'solo')).toBeLessThan(x(layout, 'k1'));
  });

  it('cut-off ancestors: a person whose parents are not drawn is simply a root, with their partner beside them', () => {
    const input = family({
      people: [
        ['top', '1900'],
        ['spouse', '1902'],
        ['kid', '1930'],
        ['inlaw', '1932'],
        ['gk', '1960'],
      ],
      unions: [
        ['ts', 'top', 'spouse'],
        ['ki', 'kid', 'inlaw'],
      ],
      kids: { kid: 'ts', gk: 'ki' },
    });
    const layout = layoutTree(input);
    expectSound(layout, input);
    expect(layout.byId.get('inlaw')!.row).toBe(1);
    expect(layout.byId.get('top')!.row).toBe(0);
    expectCentred(layout, 'ts');
    expectCentred(layout, 'ki');
  });

  it('two separate families side by side do not overlap', () => {
    const input = family({
      people: [
        ['a', '1950'],
        ['b', '1952'],
        ['c', '1980'],
        ['x', '1951'],
        ['y', '1953'],
        ['z', '1981'],
        ['w', '1982'],
      ],
      unions: [
        ['ab', 'a', 'b'],
        ['xy', 'x', 'y'],
      ],
      kids: { c: 'ab', z: 'xy', w: 'xy' },
    });
    const layout = layoutTree(input);
    expectSound(layout, input);
  });

  it('bad data does not hang or crash: a parent who is also a partner of their own child', () => {
    const input = family({
      people: [
        ['a', '1950'],
        ['b', '1975'],
      ],
      unions: [['ab', 'a', 'b']],
      kids: { b: 'p:a' },
    });
    const layout = layoutTree(input);
    expect(layout.nodes).toHaveLength(2);
    for (const n of layout.nodes) expect(Number.isFinite(n.x)).toBe(true);
  });

  it('ignores a relationship or a parent link that points at somebody who is not drawn', () => {
    const input = family({
      people: [
        ['a', '1950'],
        ['b', '1975'],
      ],
      unions: [],
      kids: { b: 'p:ghost' },
    });
    const layout = layoutTree(input);
    expect(layout.nodes).toHaveLength(2);
    expect(layout.links).toEqual([]);
  });
});

describe('scale', () => {
  for (const size of [161, 2000]) {
    it(`lays out about ${size} people soundly`, () => {
      const input = bigFamily(size);
      const started = performance.now();
      const layout = layoutTree(input);
      const ms = performance.now() - started;
      console.log(
        `layout of ${input.people.length} people: ${ms.toFixed(1)} ms (${layout.width.toFixed(0)} x ${layout.height.toFixed(0)})`,
      );
      expectSound(layout, input);
      expect(ms).toBeLessThan(size === 2000 ? 1000 : 300);
    });
  }
});
