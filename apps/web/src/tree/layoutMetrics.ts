// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How tidy a Family tree layout is, as numbers (ADR 0025). Pure: a layout in, counts out.
//  - crossings: a horizontal piece of one line strictly crosses a vertical piece of another (a line that only
//    ends on another one does not count);
//  - overlaps: two horizontal pieces of different lines share a stretch of the same y (more than 1 px), so two
//    families' children look like one bus;
//  - throughCards: a vertical piece of a line passes through the inside of somebody's card;
//  - length: the total length of every line, in px.
// `defects` (crossings + overlaps + throughCards) is what the layout tries to reduce; length only reports.
import { NODE_H, NODE_W } from './layout.js';
import type { Layout } from './layout.js';

export interface LayoutMetrics {
  crossings: number;
  overlaps: number;
  throughCards: number;
  length: number;
}

export const defects = (m: LayoutMetrics): number => m.crossings + m.overlaps + m.throughCards;

interface Segment {
  /** The line it belongs to. */
  line: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** The pieces of a path made only of M, H and V commands (every line the layout draws). */
function segmentsOf(line: string, d: string, into: Segment[]): void {
  let x = 0;
  let y = 0;
  for (const m of d.matchAll(/([MHV])(-?[\d.]+)(?: (-?[\d.]+))?/g)) {
    const [, command, a, b] = m;
    if (command === 'M') {
      x = Number(a);
      y = Number(b);
      continue;
    }
    const nx = command === 'H' ? Number(a) : x;
    const ny = command === 'V' ? Number(a) : y;
    into.push({ line, x1: x, y1: y, x2: nx, y2: ny });
    x = nx;
    y = ny;
  }
}

/** First index in a sorted array whose key is greater than `value`. */
function firstAbove(keys: number[], value: number): number {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid]! > value) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export function measureLayout(layout: Layout): LayoutMetrics {
  const all: Segment[] = [];
  for (const link of layout.links) segmentsOf(`l:${link.key}`, link.d, all);
  for (const couple of layout.couples) segmentsOf(`c:${couple.unionId}`, couple.d, all);

  let length = 0;
  const horizontals: Segment[] = [];
  const verticals: Segment[] = [];
  for (const s of all) {
    length += Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1);
    if (s.y1 === s.y2 && s.x1 !== s.x2) horizontals.push(s);
    else if (s.x1 === s.x2 && s.y1 !== s.y2) verticals.push(s);
  }
  for (const h of horizontals) {
    if (h.x1 > h.x2) [h.x1, h.x2] = [h.x2, h.x1];
  }
  for (const v of verticals) {
    if (v.y1 > v.y2) [v.y1, v.y2] = [v.y2, v.y1];
  }
  horizontals.sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
  const ys = horizontals.map((h) => h.y1);

  // Crossings: each vertical against the horizontals strictly between its ends.
  let crossings = 0;
  for (const v of verticals) {
    for (let i = firstAbove(ys, v.y1); i < horizontals.length && horizontals[i]!.y1 < v.y2; i += 1) {
      const h = horizontals[i]!;
      if (h.line !== v.line && v.x1 > h.x1 && v.x1 < h.x2) crossings += 1;
    }
  }

  // Overlaps: horizontals on the same y, sweeping left to right.
  let overlaps = 0;
  for (let i = 0; i < horizontals.length; i += 1) {
    const a = horizontals[i]!;
    for (let j = i + 1; j < horizontals.length; j += 1) {
      const b = horizontals[j]!;
      if (b.y1 !== a.y1 || b.x1 >= a.x2 - 1) break;
      if (a.line !== b.line && Math.min(a.x2, b.x2) - b.x1 > 1) overlaps += 1;
    }
  }

  // Through cards: a vertical inside a card's width whose span covers part of the card's height.
  let throughCards = 0;
  const byRow = new Map<number, Array<{ left: number; right: number; top: number }>>();
  for (const n of layout.nodes) {
    const list = byRow.get(n.row) ?? [];
    list.push({ left: n.x - NODE_W / 2, right: n.x + NODE_W / 2, top: n.y });
    byRow.set(n.row, list);
  }
  for (const v of verticals) {
    for (const row of byRow.values()) {
      const top = row[0]!.top;
      if (!(v.y1 < top + NODE_H && v.y2 > top)) continue;
      for (const card of row) {
        if (v.x1 > card.left && v.x1 < card.right) throughCards += 1;
      }
    }
  }

  return { crossings, overlaps, throughCards, length: Math.round(length) };
}
