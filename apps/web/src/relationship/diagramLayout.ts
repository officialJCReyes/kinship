// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Where everything in the relationship finder's diagram goes (backlog 9). Pure: the result in, boxes, lines and labels out,
// so it can be tested without a browser. PathDiagram draws it as one SVG of our own (no diagram library).
//
// The diagram is a grid of generations. Each person on the path gets a column; a marriage, a step-sibling or a former partner
// is a horizontal link on the same row, labelled. A blood link goes through the closest shared ancestors: they are drawn
// above it (a couple side by side with a line between them, or one person between the two columns), with a line down to
// each side and each side's line of people down to the two ends, as MyHeritage does. A link that is a direct line (parent,
// grandparent, child) stays in one column. In a chain, a blood link between two people of the same generation (brother,
// cousin) is also drawn as a labelled horizontal link between them; a blood result between the two people asked about is
// drawn as before, with the ancestors on top and the lines down. Unknown parents (placeholders) are never drawn: a link whose
// shared ancestors are all unknown falls back to a labelled horizontal link.
import type { Gender, HopDetail, RelationshipResponse } from '@kinship/shared';
import { coupleOrder } from './path.js';

/** A card: its centre across, its top, and whether it is one of the two people asked about. */
export interface DiagramCard {
  id: string;
  x: number;
  y: number;
  highlight: boolean;
}

/** A label: `start` sits to the right of a vertical line; `middle` is centred above a horizontal one. */
export interface DiagramLabel {
  x: number;
  y: number;
  text: string;
  anchor: 'start' | 'middle';
}

export interface PathLayout {
  width: number;
  height: number;
  cards: DiagramCard[];
  /** SVG path data for every line (the vertical lines, the couple lines and the brackets). */
  lines: string[];
  /** Horizontal links between two people on the path: the line, and an arrowhead pointing at the next person. */
  links: Array<{ d: string; arrow: string }>;
  labels: DiagramLabel[];
}

export const CARD_W = 160;
/** Room for the avatar, a name on up to two lines and the years under it. */
export const CARD_H = 104;
/** The space between rows, where the vertical lines and their labels are. */
const ROW_GAP = 64;
const MIN_GAP = 40;
const PAD = 8;
const LABEL_SIZE = 12;

export interface LayoutText {
  /** "father", "Parents": what the upper person or couple on a vertical line is to the person below. */
  parentLabel: (upperIds: string[]) => string;
  /** What `links[i]` says ("wife", "sister"). */
  linkLabel: (index: number) => string;
  /** The width of a label in px at 12 px, for the room between two columns. */
  measure: (text: string, size: number) => number;
  /** A person who may be drawn: known to the answer and not an unknown parent. */
  drawable: (id: string) => boolean;
  /** Puts a couple's father on the left and the mother on the right. */
  gender: (id: string) => Gender | null;
}

interface Hop {
  detail: HopDetail | null;
  /** In a chain, draw a labelled horizontal link for a same-generation blood link too. */
  chain: boolean;
}

/** A blood link is drawn through its ancestors only when every person on it may be drawn and at least one ancestor may. */
function usable(detail: HopDetail | null, text: LayoutText): HopDetail | null {
  if (!detail) return null;
  const ancestors = coupleOrder(detail.ancestors.filter(text.drawable), text.gender);
  const drawable = text.drawable;
  if (ancestors.length === 0) return null;
  if (![...detail.lineA, ...detail.lineB].every(drawable)) return null;
  return { ...detail, ancestors };
}

export function layoutPath(result: RelationshipResponse, text: LayoutText): PathLayout | null {
  let people: string[];
  let hops: Hop[];
  if (result.chain) {
    people = result.chain.people;
    hops = people.slice(1).map((_, i) => ({ detail: result.chain!.hops?.[i] ?? null, chain: true }));
  } else if (result.blood) {
    people = [result.a, result.b];
    hops = [{ detail: result.blood, chain: false }];
  } else {
    return null;
  }

  // 1. Grid positions: a column (a half column for a single ancestor between two columns) and a row for each card.
  const pos = new Map<string, { col: number; row: number }>();
  const vertical: Array<{ upper: string[]; lower: string }> = [];
  const horizontal: Array<{ from: string; to: string; label: string }> = [];
  const groups: Array<{ ancestors: string[]; children: string[] }> = [];
  pos.set(people[0]!, { col: 0, row: 0 });
  hops.forEach((hop, i) => {
    const a = people[i]!;
    const b = people[i + 1]!;
    const at = pos.get(a)!;
    const detail = usable(hop.detail, text);
    const label = result.chain ? text.linkLabel(i) : result.name ? text.linkLabel(-1) : '';
    if (!detail) {
      pos.set(b, { col: at.col + 1, row: at.row });
      horizontal.push({ from: a, to: b, label });
      return;
    }
    const { dA, dB, ancestors, lineA, lineB } = detail;
    if (dA === 0) {
      // A is the ancestor: B's line goes straight down under A.
      let upper = [a];
      lineB.forEach((id, k) => {
        pos.set(id, { col: at.col, row: at.row + k + 1 });
        vertical.push({ upper, lower: id });
        upper = [id];
      });
      return;
    }
    if (dB === 0) {
      // B is the ancestor: A's line goes straight up to B.
      const top = at.row - dA;
      pos.set(b, { col: at.col, row: top });
      lineA.forEach((id, k) => {
        if (id !== a) pos.set(id, { col: at.col, row: top + k + 1 });
        vertical.push({ upper: k === 0 ? [b] : [lineA[k - 1]!], lower: id });
      });
      return;
    }
    // Both sides go up to the shared ancestors, drawn above the two columns.
    const top = at.row - dA;
    const bCol = at.col + 1;
    if (ancestors.length >= 2) {
      pos.set(ancestors[0]!, { col: at.col, row: top });
      pos.set(ancestors[1]!, { col: bCol, row: top });
    } else {
      pos.set(ancestors[0]!, { col: at.col + 0.5, row: top });
    }
    lineA.forEach((id, k) => {
      if (id !== a) pos.set(id, { col: at.col, row: top + k + 1 });
      if (k > 0) vertical.push({ upper: [lineA[k - 1]!], lower: id });
    });
    lineB.forEach((id, k) => {
      pos.set(id, { col: bCol, row: top + k + 1 });
      if (k > 0) vertical.push({ upper: [lineB[k - 1]!], lower: id });
    });
    groups.push({ ancestors: ancestors.slice(0, 2), children: [lineA[0]!, lineB[0]!] });
    if (hop.chain && dA === dB) horizontal.push({ from: a, to: b, label });
  });

  // 2. Columns: room between two columns for the label of a horizontal link between them.
  const maxCol = Math.max(...[...pos.values()].map((p) => Math.ceil(p.col)));
  const gaps = new Array<number>(Math.max(0, maxCol)).fill(MIN_GAP);
  for (const link of horizontal) {
    const col = Math.min(pos.get(link.from)!.col, pos.get(link.to)!.col);
    const need = text.measure(link.label, LABEL_SIZE) + 28;
    gaps[col] = Math.max(gaps[col] ?? MIN_GAP, need);
  }
  const colX: number[] = [PAD + CARD_W / 2];
  for (let c = 1; c <= maxCol; c += 1) colX[c] = colX[c - 1]! + CARD_W + gaps[c - 1]!;
  const xOf = (col: number) =>
    Number.isInteger(col) ? colX[col]! : (colX[Math.floor(col)]! + colX[Math.ceil(col)]!) / 2;
  const minRow = Math.min(...[...pos.values()].map((p) => p.row));
  const maxRow = Math.max(...[...pos.values()].map((p) => p.row));
  const yOf = (row: number) => PAD + (row - minRow) * (CARD_H + ROW_GAP);

  const place = (id: string) => {
    const p = pos.get(id)!;
    return { x: xOf(p.col), y: yOf(p.row) };
  };
  const cards: DiagramCard[] = [...pos.keys()].map((id) => ({
    id,
    ...place(id),
    highlight: id === result.a || id === result.b,
  }));

  // 3. Lines and labels.
  const lines: string[] = [];
  const labels: DiagramLabel[] = [];
  const sideLabel = (x: number, y0: number, y1: number, textValue: string) =>
    labels.push({ x: x + 8, y: (y0 + y1) / 2 + LABEL_SIZE * 0.35, text: textValue, anchor: 'start' });
  for (const { upper, lower } of vertical) {
    const from = place(upper[0]!);
    const to = place(lower);
    lines.push(`M${to.x} ${from.y + CARD_H}V${to.y}`);
    sideLabel(to.x, from.y + CARD_H, to.y, text.parentLabel(upper));
  }
  for (const { ancestors, children } of groups) {
    const tops = ancestors.map(place);
    const bottom = tops[0]!.y + CARD_H;
    const bus = bottom + ROW_GAP / 2;
    let dropX: number;
    if (tops.length === 2) {
      // The couple line between the two cards, and the line down from its middle.
      const [left, right] = tops[0]!.x <= tops[1]!.x ? [tops[0]!, tops[1]!] : [tops[1]!, tops[0]!];
      const mid = left.y + CARD_H / 2;
      lines.push(`M${left.x + CARD_W / 2} ${mid}H${right.x - CARD_W / 2}`);
      dropX = (left.x + right.x) / 2;
      lines.push(`M${dropX} ${mid}V${bus}`);
    } else {
      dropX = tops[0]!.x;
      lines.push(`M${dropX} ${bottom}V${bus}`);
    }
    const xs = children.map((id) => place(id).x);
    lines.push(`M${Math.min(dropX, ...xs)} ${bus}H${Math.max(dropX, ...xs)}`);
    for (const id of children) {
      const to = place(id);
      lines.push(`M${to.x} ${bus}V${to.y}`);
      sideLabel(to.x, bus, to.y, text.parentLabel(ancestors));
    }
  }
  const links: PathLayout['links'] = [];
  for (const link of horizontal) {
    const from = place(link.from);
    const to = place(link.to);
    const y = from.y + CARD_H / 2;
    const rightward = to.x >= from.x;
    const x0 = from.x + (rightward ? CARD_W / 2 : -CARD_W / 2);
    const x1 = to.x + (rightward ? -CARD_W / 2 : CARD_W / 2);
    const tip = rightward ? x1 - 2 : x1 + 2;
    const back = rightward ? tip - 7 : tip + 7;
    links.push({ d: `M${x0} ${y}H${tip}`, arrow: `M${back} ${y - 4}L${tip} ${y}L${back} ${y + 4}` });
    if (link.label) labels.push({ x: (x0 + x1) / 2, y: y - 8, text: link.label, anchor: 'middle' });
  }

  const width = colX[maxCol]! + CARD_W / 2 + PAD;
  const height = yOf(maxRow) + CARD_H + PAD;
  return { width, height, cards, lines, links, labels };
}
