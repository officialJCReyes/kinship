// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The crossing metric (ADR 0025) on the families the layout work is measured on. These numbers are the layout
// as it stands; a change that improves a family updates its line here and says so in the pull request.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assignLanes, EXTRA_LAYOUTS, LANE_PITCH, layoutTree } from '../src/tree/layout.js';
import { defects, measureLayout } from '../src/tree/layoutMetrics.js';
import { bigFamily, bigFamilyWithCousins, family, FIVE_IN_LAW_FAMILIES, NAMED_FAMILIES } from './layout-fixtures.js';
import { layoutInputs, snapshot } from './layout-inputs.js';

// The tests run from apps/web (pnpm test, and vitest in this folder).
const GOLDEN = resolve(process.cwd(), 'test/layout-golden.json');

/** The layout with the new options on: crossings, overlaps, throughCards, length. */
const PINNED: Record<string, [number, number, number, number]> = {
  HALE: [0, 0, 0, 1580],
  SIBLINGS: [0, 0, 0, 3616],
  REMARRIAGE: [0, 0, 0, 3179],
  COUSINS: [0, 0, 0, 2968],
  WIDOW: [0, 0, 0, 1612],
  THREE_UNIONS: [1, 0, 0, 3578],
  GENERATIONS: [2, 0, 1, 2526],
  TWO_COUSIN_MARRIAGES: [1, 0, 0, 2208],
  'HALE chart of Marcus': [0, 0, 0, 1964],
  'HALE chart of Sofia': [0, 0, 0, 1964],
  'HALE family view of Marcus': [0, 0, 0, 604],
  'HALE family view of Sofia': [0, 0, 0, 604],
};

/** Today's layout: what both options off must give, byte for byte. */
const OFF = { busLanes: false, reduceCrossings: false };

describe('the layout metric', () => {
  const inputs = layoutInputs();

  it('covers every named family and the Hale sample', () => {
    expect(Object.keys(inputs).sort()).toEqual(Object.keys(PINNED).sort());
    expect(Object.keys(NAMED_FAMILIES).length).toBe(8);
  });

  for (const [name, [crossings, overlaps, throughCards, length]] of Object.entries(PINNED)) {
    it(`${name}: ${crossings} crossings, ${overlaps} overlaps, ${throughCards} through cards, length ${length}`, () => {
      const m = measureLayout(layoutTree(inputs[name]!));
      expect({ crossings: m.crossings, overlaps: m.overlaps, throughCards: m.throughCards, length: m.length }).toEqual({
        crossings,
        overlaps,
        throughCards,
        length,
      });
    });
  }

  it('counts a simple crossing, an overlap and a line through a card', () => {
    const tree = layoutTree(family({ people: [['a'], ['b']], unions: [['u', 'a', 'b']] }));
    expect(defects(measureLayout(tree))).toBe(0);
    const bent = { ...tree, links: [{ ...tree.links[0] }] } as unknown as typeof tree;
    // A hand-made line: a vertical through the first card, and a bus crossing it.
    const a = tree.byId.get('a')!;
    bent.links = [
      { key: 'x', d: `M${a.x} ${a.y - 10}V${a.y + 20}`, childIds: [], unionId: null, parentId: null },
      { key: 'y', d: `M${a.x - 20} ${a.y + 5}H${a.x + 20}`, childIds: [], unionId: null, parentId: null },
      { key: 'z', d: `M${a.x - 30} ${a.y + 5}H${a.x + 30}`, childIds: [], unionId: null, parentId: null },
    ];
    const m = measureLayout(bent);
    expect(m.crossings).toBe(2); // x crosses y and z
    expect(m.overlaps).toBe(1); // y and z share a stretch of the same y
    expect(m.throughCards).toBe(1); // x is inside the card of a
  });
});

describe('the layout of every family is the same today (the "off" path of the new options)', () => {
  const inputs = layoutInputs();
  const golden = (): Record<string, unknown> => JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, unknown>;

  if (process.env.UPDATE_LAYOUT_GOLDEN) {
    it('writes the golden file', () => {
      const out: Record<string, unknown> = {};
      for (const [name, input] of Object.entries(inputs)) out[name] = snapshot(layoutTree(input, OFF));
      writeFileSync(GOLDEN, `${JSON.stringify(out, null, 1)}\n`);
    });
  }

  for (const name of Object.keys(PINNED)) {
    it(`${name}`, () => {
      expect(snapshot(layoutTree(inputs[name]!, OFF))).toEqual(golden()[name]);
    });
  }
});

describe('bus lanes', () => {
  const inputs = layoutInputs();
  const heightOf = (name: string, options: Parameters<typeof layoutTree>[1]) =>
    layoutTree(inputs[name]!, options).height;

  it('leave a family whose children lines do not run along each other exactly as it was', () => {
    for (const name of [
      'HALE',
      'SIBLINGS',
      'REMARRIAGE',
      'WIDOW',
      'HALE chart of Marcus',
      'HALE family view of Marcus',
    ]) {
      expect(snapshot(layoutTree(inputs[name]!, { reduceCrossings: false }))).toEqual(
        snapshot(layoutTree(inputs[name]!, OFF)),
      );
    }
  });

  it('turn an overlap into a line of its own, in a gap of the same height (cousin marriages)', () => {
    for (const name of ['COUSINS', 'TWO_COUSIN_MARRIAGES']) {
      const before = measureLayout(layoutTree(inputs[name]!, OFF));
      const after = measureLayout(layoutTree(inputs[name]!, { reduceCrossings: false }));
      expect(before.overlaps).toBe(1);
      expect(after.overlaps).toBe(0);
      expect(heightOf(name, { reduceCrossings: false })).toBe(heightOf(name, OFF));
    }
  });

  it('give each of five overlapping lines its own lane and make the gap taller only past three', () => {
    const input = family(FIVE_IN_LAW_FAMILIES);
    const off = layoutTree(input, OFF);
    const on = layoutTree(input, { reduceCrossings: false });
    expect(measureLayout(off).overlaps).toBeGreaterThan(0);
    expect(measureLayout(on).overlaps).toBe(0);
    expect(on.height).toBe(off.height + 2 * LANE_PITCH); // five lanes, three are free
    expect(on.nodes.length).toBe(off.nodes.length);
    // Rows keep their order and are pushed down, never sideways.
    for (const node of off.nodes) expect(on.byId.get(node.id)!.x).toBe(node.x);
  });

  it('assignLanes: a lone bus stays on the middle line; overlapping ones get different lanes, the same every time', () => {
    const bus = (key: string, lo: number, hi: number) => ({ key, hx: lo, xs: [hi], lo, hi });
    expect(assignLanes([bus('a', 0, 100)]).get('a')).toEqual({ lane: 0, lanes: 1 });
    const two = assignLanes([bus('b', 50, 200), bus('a', 0, 100), bus('c', 300, 400)]);
    expect(two.get('a')!.lane).not.toBe(two.get('b')!.lane);
    expect(two.get('c')).toEqual({ lane: 0, lanes: 1 });
    expect([...assignLanes([bus('a', 0, 100), bus('b', 50, 200)])]).toEqual(
      [...assignLanes([bus('b', 50, 200), bus('a', 0, 100)])].sort(([x], [y]) => (x < y ? -1 : 1)),
    );
  });
});

describe('cousin marriages', () => {
  const inputs = layoutInputs();
  const lanesOnly = { reduceCrossings: false };
  const orderOf = (layout: ReturnType<typeof layoutTree>, ids: string[]) =>
    [...ids].sort((a, b) => layout.byId.get(a)!.x - layout.byId.get(b)!.x);

  it('take a brother or sister out of birth order when that removes a defect (COUSINS: Sofia before Marcus)', () => {
    const before = layoutTree(inputs['COUSINS']!, lanesOnly);
    const after = layoutTree(inputs['COUSINS']!);
    expect(orderOf(before, ['marcus', 'sofia'])).toEqual(['marcus', 'sofia']); // birth order
    expect(orderOf(after, ['marcus', 'sofia'])).toEqual(['sofia', 'marcus']);
    expect(defects(measureLayout(before))).toBe(1);
    expect(defects(measureLayout(after))).toBe(0);
    expect(measureLayout(after).length).toBeLessThan(measureLayout(before).length);
  });

  it('never change a family that has nothing to remove, and never raise the defects of any', () => {
    for (const [name, input] of Object.entries(inputs)) {
      const plain = layoutTree(input, lanesOnly);
      const reduced = layoutTree(input);
      expect(defects(measureLayout(reduced)), name).toBeLessThanOrEqual(defects(measureLayout(plain)));
      if (defects(measureLayout(plain)) === 0) expect(snapshot(reduced), name).toEqual(snapshot(plain));
    }
  });

  it('leave two cousin marriages and the cross-generation family as the plan documents (known limits)', () => {
    expect(defects(measureLayout(layoutTree(inputs['TWO_COUSIN_MARRIAGES']!)))).toBe(1);
    expect(defects(measureLayout(layoutTree(inputs['GENERATIONS']!)))).toBe(3);
    expect(defects(measureLayout(layoutTree(inputs['THREE_UNIONS']!)))).toBe(1);
  });

  it('try at most EXTRA_LAYOUTS orders: 20 cousin marriages leave 20 minus that many defects', () => {
    const m = measureLayout(layoutTree(bigFamilyWithCousins(2000, 20)));
    expect(m.crossings + m.overlaps + m.throughCards).toBe(20 - EXTRA_LAYOUTS);
  });

  it('give the same positions whatever order the people, relationships and links arrive in', () => {
    for (const [name, input] of Object.entries(inputs)) {
      const shuffled = {
        ...input,
        people: [...input.people].reverse(),
        unions: [...input.unions].reverse(),
        parentage: Object.fromEntries(Object.entries(input.parentage).reverse()),
      };
      expect(snapshot(layoutTree(shuffled)).nodes, name).toEqual(snapshot(layoutTree(input)).nodes);
      expect(snapshot(layoutTree(shuffled)).links, name).toEqual(snapshot(layoutTree(input)).links);
    }
  });

  it('keep couples side by side with the children centred under the couple line', () => {
    const layout = layoutTree(inputs['COUSINS']!);
    for (const c of layout.couples) {
      const row = layout.rows[layout.byId.get(c.left)!.row]!;
      expect(row.indexOf(c.right) - row.indexOf(c.left)).toBe(1);
      expect(c.hangX).toBeCloseTo((c.x1 + c.x2) / 2, 3);
    }
    for (const link of layout.links) {
      if (!link.unionId) continue;
      const xs = link.childIds.map((id) => layout.byId.get(id)!.x);
      const couple = layout.couples.find((c) => c.unionId === link.unionId)!;
      // A partner with parents on two sides can sit off the middle; the others are centred.
      if (link.childIds.every((id) => !['priya'].includes(id))) {
        expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(couple.hangX, 0);
      }
    }
  });
});

describe('scale, with and without cousin marriages', () => {
  const time = (input: Parameters<typeof layoutTree>[0]) => {
    const started = performance.now();
    layoutTree(input);
    return performance.now() - started;
  };
  it('lays out 2,000 people', () => {
    const ms = time(bigFamily(2000));
    console.log(`layout of 2000 people: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(1000);
  });
  it('lays out 2,000 people with 20 cousin marriages', () => {
    const input = bigFamilyWithCousins(2000, 20);
    const ms = time(input);
    const m = measureLayout(layoutTree(input));
    console.log(`layout of ${input.people.length} people with 20 cousin marriages: ${ms.toFixed(1)} ms`, m);
    expect(ms).toBeLessThan(1000);
  });
});
