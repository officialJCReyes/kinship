// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Every family the layout tests go through: the named ones and the Hale sample as the app draws it.
import { familyView } from '../src/tree/family.js';
import type { Layout, LayoutInput } from '../src/tree/layout.js';
import { family, NAMED_FAMILIES } from './layout-fixtures.js';
import { treeFor } from './family.js';

const asInput = (tree: ReturnType<typeof treeFor>): LayoutInput => ({
  focalId: tree.focalId,
  people: tree.people,
  unions: tree.unions,
  parentage: tree.parentage,
});

export function layoutInputs(): Record<string, LayoutInput> {
  const marcus = treeFor('marcus', { up: 3, down: 2, collateral: true });
  const sofia = treeFor('sofia', { up: 3, down: 1, collateral: true });
  return {
    ...Object.fromEntries(Object.entries(NAMED_FAMILIES).map(([name, spec]) => [name, family(spec)])),
    'HALE chart of Marcus': asInput(marcus),
    'HALE chart of Sofia': asInput(treeFor('sofia', { up: 3, down: 2, collateral: true })),
    'HALE family view of Marcus': asInput(
      familyView(treeFor('marcus', { up: 3, down: 1, collateral: true }), 'marcus'),
    ),
    'HALE family view of Sofia': asInput(familyView(sofia, 'sofia')),
  };
}

/** A layout as plain, rounded data: what "byte for byte" compares. */
export function snapshot(layout: Layout) {
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return {
    width: round(layout.width),
    height: round(layout.height),
    nodes: [...layout.nodes].sort((a, b) => (a.id < b.id ? -1 : 1)).map((n) => [n.id, round(n.x), round(n.y), n.row]),
    couples: [...layout.couples]
      .sort((a, b) => (a.unionId < b.unionId ? -1 : 1))
      .map((c) => [c.unionId, round(c.x1), round(c.x2), round(c.y), c.bracket, c.d, round(c.hangX), round(c.hangY)]),
    links: [...layout.links].sort((a, b) => (a.key < b.key ? -1 : 1)).map((l) => [l.key, l.d, l.childIds]),
    rows: layout.rows,
  };
}
