// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Family tree chart's layout. Pure functions: a tree response in, boxes and lines out. It runs again
// only when the data or the root changes, never on pan or zoom.
//
// How it works
//  1. Partners are grouped: everyone connected by a relationship forms one group, and a group is one row.
//  2. A group's row is its parents' row plus one (the deepest, when both partners have drawn parents).
//  3. Inside a group the person with the most relationships sits in the middle, the earliest relationship
//     on their left and the later ones on their right.
//  4. A group with drawn parents hangs under them (its "anchor": the member with drawn parents who is on the
//     focal person's line, then the one with most relationships). A partner with no drawn parents is never a root.
//  5. Groups are placed by a tidy-tree pass: every subtree keeps a contour (left and right edge in each row),
//     siblings are packed with a minimum gap, and a relationship's children are centred under the middle of its
//     couple line, so the children of an earlier marriage stay with that marriage.
//  6. Edges are orthogonal with a bus line.
//
// Accepted limits (kept in docs/decisions/0006-tree-view.md):
//  - A third or later relationship goes further right; its couple line is a bracket below the nodes in between.
//  - If both partners have drawn parents (cousins who married), the couple sits under one family and the other
//    parent link is a long line.
//  - A remarried in-law is one node with a long line; nobody is drawn twice.
//  - A very wide set of siblings does not wrap.
//  - There is no crossing minimisation beyond keeping partners adjacent, siblings contiguous and children in
//    birth order. It is "good enough", not crossing-free.
import { displayName } from '../lib/names.js';
import type { Parentage, TreePerson, Union, UnionStatus } from '@kinship/shared';
import { defects, measureLayout } from './layoutMetrics.js';

export const NODE_W = 184;
/** Fits three lines of name and the dates line (see cardText.ts); every card is this tall. */
export const NODE_H = 80;
/** Gap between two partners' boxes (the couple line runs through it). */
export const COUPLE_GAP = 44;
/** Minimum gap between two subtrees (and between siblings) in the same row. */
export const SUBTREE_GAP = 28;
/** Space between one row's boxes and the next row's boxes (the bus line runs in it). */
export const ROW_GAP = 72;
export const PITCH = NODE_W + COUPLE_GAP;
const BRACKET = 14;
const ROOT_GAP = 64;
export const MARGIN = 40;
/** Two buses of different families that would run along each other get their own line (ADR 0025). */
export const BUS_LANES = true;
/** Sibling order may leave birth order when that removes an overlap or a crossing (ADR 0025). */
export const REDUCE_CROSSINGS = true;
/** Distance between two lanes of buses inside one gap between rows. A gap holds three at its usual height. */
export const LANE_PITCH = 14;
const FREE_LANES = 3;

export interface LayoutOptions {
  busLanes?: boolean;
  reduceCrossings?: boolean;
}

/** What the layout needs from a tree response. */
export interface LayoutInput {
  focalId: string;
  people: ReadonlyArray<
    Pick<TreePerson, 'id' | 'givenName' | 'surname' | 'birth'> &
      Partial<Pick<TreePerson, 'secondSurname' | 'marriedSurname'>>
  >;
  unions: ReadonlyArray<Pick<Union, 'id' | 'partnerIds' | 'status' | 'start'>>;
  parentage: Readonly<Record<string, Parentage>>;
}

export interface PlacedNode {
  id: string;
  /** Centre of the box. */
  x: number;
  /** Top of the box. */
  y: number;
  row: number;
}

export interface PlacedCouple {
  unionId: string;
  status: UnionStatus;
  /** Left and right partner (by position). */
  left: string;
  right: string;
  /** Centres of the two boxes. */
  x1: number;
  x2: number;
  /** y of the line: the middle of the row for a straight line, the bottom of the boxes for a bracket. */
  y: number;
  /** True when other boxes sit between the partners: the line is drawn as a bracket below the boxes. */
  bracket: boolean;
  /** SVG path of the line. */
  d: string;
  /** Where the children hang from. */
  hangX: number;
  hangY: number;
}

export interface PlacedLink {
  key: string;
  /** SVG path: from the hang point down to a bus, across, and down to each child. */
  d: string;
  childIds: string[];
  /** The relationship (or the single parent) the children hang from. */
  unionId: string | null;
  parentId: string | null;
}

export interface Layout {
  nodes: PlacedNode[];
  byId: Map<string, PlacedNode>;
  couples: PlacedCouple[];
  links: PlacedLink[];
  width: number;
  height: number;
  /** Who is left and right of whom in each row, for the keyboard. */
  rows: string[][];
}

// ---------------------------------------------------------------- contours

interface Contour {
  start: number;
  min: number[];
  max: number[];
}

function rowContour(row: number, min: number, max: number): Contour {
  return { start: row, min: [min], max: [max] };
}

function shiftContour(c: Contour, dx: number): Contour {
  return { start: c.start, min: c.min.map((v) => v + dx), max: c.max.map((v) => v + dx) };
}

function mergeContours(a: Contour | null, b: Contour): Contour {
  if (!a) return b;
  const start = Math.min(a.start, b.start);
  const end = Math.max(a.start + a.min.length, b.start + b.min.length);
  const min: number[] = new Array<number>(end - start).fill(Infinity);
  const max: number[] = new Array<number>(end - start).fill(-Infinity);
  for (const c of [a, b]) {
    for (let i = 0; i < c.min.length; i += 1) {
      const at = c.start - start + i;
      min[at] = Math.min(min[at]!, c.min[i]!);
      max[at] = Math.max(max[at]!, c.max[i]!);
    }
  }
  return { start, min, max };
}

/** How far right `right` must move so that it clears `left` by `gap` in every row they share. */
function separation(left: Contour, right: Contour, gap: number): number {
  let need = -Infinity;
  const from = Math.max(left.start, right.start);
  const to = Math.min(left.start + left.min.length, right.start + right.min.length);
  for (let row = from; row < to; row += 1) {
    const l = left.max[row - left.start]!;
    const r = right.min[row - right.start]!;
    if (l === -Infinity || r === Infinity) continue;
    need = Math.max(need, l + gap - r);
  }
  return need;
}

// ---------------------------------------------------------------- helpers

/** "1990" < "1990-05" < "1990-05-12": a sortable key, "" for unknown (sorts last). */
export function birthKey(value: string | null | undefined): string {
  if (!value) return '';
  const [y = '', m = '00', d = '00'] = value.split('-');
  return `${y.padStart(4, '0')}-${m}-${d}`;
}

function compareBirth(a: string, b: string): number {
  if (a === b) return 0;
  if (a === '') return 1;
  if (b === '') return -1;
  return a < b ? -1 : 1;
}

interface Hang {
  key: string;
  unionId: string | null;
  parentId: string | null;
  group: string;
  /** Position along the group's row, in member slots (a couple line is the average of its two partners' slots). */
  slot: number;
  /** Everyone who hangs from it. */
  children: string[];
  /** Child groups placed under it (their anchor is one of the children). */
  anchored: string[];
}

interface Group {
  id: string;
  members: string[];
  /** The people in left-to-right order. */
  seq: string[];
  row: number;
  anchor: string | null;
  parentHang: string | null;
  hangs: Hang[];
}

interface Block {
  group: Group;
  /** x of each member's centre, in this block's own coordinates. */
  x: Map<string, number>;
  packs: Array<{ hang: Hang; shift: number; children: Array<{ block: Block; offset: number }> }>;
  contour: Contour;
  attach: number;
}

// ---------------------------------------------------------------- bus lanes

/** The horizontal piece of one family's children line, and where its verticals leave it. */
interface BusSpec {
  key: string;
  /** Where the line hangs from the parents. */
  hx: number;
  /** Where each child's line leaves it. */
  xs: number[];
  lo: number;
  hi: number;
}

const busesOverlap = (a: BusSpec, b: BusSpec): boolean => Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > 1;

function permutations(n: number): number[][] {
  if (n <= 1) return [[...Array(n).keys()]];
  const out: number[][] = [];
  const walk = (prefix: number[], rest: number[]) => {
    if (rest.length === 0) out.push(prefix);
    for (let i = 0; i < rest.length; i += 1) walk([...prefix, rest[i]!], [...rest.slice(0, i), ...rest.slice(i + 1)]);
  };
  walk([], [...Array(n).keys()]);
  return out;
}

/** Most buses in a component for which every order of colouring is tried. */
const LANE_SEARCH_LIMIT = 6;

/**
 * Lanes for the buses of one gap between rows. Buses that do not share a stretch stay on the middle line, exactly
 * where they always were. A group of buses that overlap (one family's children line passing under another's) is
 * given lanes: first fit in each order of colouring, and the order with the fewest crossings, then the fewest
 * lanes, wins (ties go to the earliest order, so the same data always gives the same lanes).
 */
export function assignLanes(buses: BusSpec[]): Map<string, { lane: number; lanes: number }> {
  const sorted = [...buses].sort((a, b) => a.lo - b.lo || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const result = new Map<string, { lane: number; lanes: number }>();
  let component: BusSpec[] = [];
  let reach = -Infinity;
  const flush = () => {
    if (component.length === 0) return;
    const items = component;
    if (items.length === 1) {
      result.set(items[0]!.key, { lane: 0, lanes: 1 });
      return;
    }
    const overlap = items.map((a) => items.map((b) => a !== b && busesOverlap(a, b)));
    let best: { score: number; lane: number[]; lanes: number } | null = null;
    const orders = items.length <= LANE_SEARCH_LIMIT ? permutations(items.length) : [[...items.keys()]];
    for (const order of orders) {
      const lane: number[] = new Array<number>(items.length).fill(-1);
      for (const i of order) {
        let l = 0;
        while (items.some((_, j) => lane[j] === l && overlap[i]![j])) l += 1;
        lane[i] = l;
      }
      let crossings = 0;
      for (let a = 0; a < items.length; a += 1) {
        for (let b = 0; b < items.length; b += 1) {
          if (a === b || lane[a] === lane[b]) continue;
          const bus = items[b]!;
          // a's line down to its bus passes every bus above it; its children's lines pass every bus below it.
          if (lane[b]! < lane[a]! && items[a]!.hx > bus.lo && items[a]!.hx < bus.hi) crossings += 1;
          if (lane[b]! > lane[a]!) crossings += items[a]!.xs.filter((x) => x > bus.lo && x < bus.hi).length;
        }
      }
      const lanes = Math.max(...lane) + 1;
      const score = crossings * 1000 + lanes;
      if (!best || score < best.score) best = { score, lane, lanes };
    }
    items.forEach((item, i) => result.set(item.key, { lane: best!.lane[i]!, lanes: best!.lanes }));
  };
  for (const bus of sorted) {
    if (component.length > 0 && bus.lo >= reach - 1) {
      flush();
      component = [];
      reach = -Infinity;
    }
    component.push(bus);
    reach = Math.max(reach, bus.hi);
  }
  flush();
  return result;
}

// ---------------------------------------------------------------- the layout

/** Most extra layouts tried to remove a defect by changing the order of some brothers and sisters. */
export const EXTRA_LAYOUTS = 8;

/**
 * A set of brothers and sisters (everyone who hangs from one relationship or parent) in which somebody's partner
 * has parents who are drawn too, so there is a second line to follow.
 */
interface SiblingSet {
  hangKey: string;
  row: number;
  /** The anchors of the groups in the set, in the order they are drawn. */
  order: string[];
  /** For each anchor: the hangs of the parents of the partners in the group (the other families). */
  targets: Map<string, string[]>;
}

/** Where a hang is drawn, from a finished layout (the middle of the couple line, or the parent's own box). */
function hangX(layout: Layout, key: string): number | null {
  if (key.startsWith('u:')) return layout.couples.find((c) => c.unionId === key.slice(2))?.hangX ?? null;
  return layout.byId.get(key.slice(2))?.x ?? null;
}

/**
 * The Family tree layout. Brothers and sisters are in birth order. When a partner's own parents are drawn too (cousins
 * who married) and that leaves a line overlapping or crossing another, the order of those brothers and sisters is
 * tried with the partner's family nearer (the average place of their parents, then birth); an order is kept only if
 * it lowers the defect count of `measureLayout`, and at most EXTRA_LAYOUTS more layouts are made (ADR 0025).
 */
export function layoutTree(input: LayoutInput, options: LayoutOptions = {}): Layout {
  const busLanes = options.busLanes ?? BUS_LANES;
  const reduce = options.reduceCrossings ?? REDUCE_CROSSINGS;
  let best = layoutOnce(input, busLanes, undefined);
  if (!reduce || best.sets.length === 0) return best.layout;
  let score = defects(measureLayout(best.layout));
  const orders = new Map<string, string[]>();
  const tried = new Set<string>();
  let budget = EXTRA_LAYOUTS;
  while (score > 0 && budget > 0) {
    const set = best.sets.find((s) => !tried.has(s.hangKey));
    if (!set) break;
    tried.add(set.hangKey);
    const own = hangX(best.layout, set.hangKey);
    if (own === null) continue;
    const key = (anchor: string): number => {
      const xs = [own, ...(set.targets.get(anchor) ?? []).map((t) => hangX(best.layout, t) ?? own)];
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };
    const next = set.order
      .map((anchor, index) => ({ anchor, index, at: key(anchor) }))
      .sort((a, b) => a.at - b.at || a.index - b.index)
      .map((x) => x.anchor);
    if (next.every((anchor, i) => anchor === set.order[i])) continue;
    const trial = new Map(orders).set(set.hangKey, next);
    const made = layoutOnce(input, busLanes, trial);
    budget -= 1;
    const trialScore = defects(measureLayout(made.layout));
    if (trialScore < score) {
      score = trialScore;
      best = made;
      orders.set(set.hangKey, next);
    }
  }
  return best.layout;
}

function layoutOnce(
  input: LayoutInput,
  busLanes: boolean,
  orders: ReadonlyMap<string, string[]> | undefined,
): { layout: Layout; sets: SiblingSet[] } {
  const people = new Map(input.people.map((p) => [p.id, p]));
  const unionList = input.unions.filter((u) => people.has(u.partnerIds[0]) && people.has(u.partnerIds[1]));
  const unionById = new Map(unionList.map((u) => [u.id, u]));

  // A child's parent link counts only when everything it points at is drawn.
  const parentsOf = new Map<string, string[]>();
  const hangOfChild = new Map<string, string>();
  const hangInfo = new Map<string, { unionId: string | null; parentId: string | null }>();
  for (const [child, link] of Object.entries(input.parentage)) {
    if (!people.has(child)) continue;
    if (link.unionId) {
      const union = unionById.get(link.unionId);
      if (!union) continue;
      parentsOf.set(child, [...union.partnerIds]);
      hangOfChild.set(child, `u:${link.unionId}`);
      hangInfo.set(`u:${link.unionId}`, { unionId: link.unionId, parentId: null });
    } else if (link.parentId && people.has(link.parentId)) {
      parentsOf.set(child, [link.parentId]);
      hangOfChild.set(child, `p:${link.parentId}`);
      hangInfo.set(`p:${link.parentId}`, { unionId: null, parentId: link.parentId });
    }
  }
  const birthOf = (id: string) => birthKey(people.get(id)?.birth?.value);
  const nameOf = (id: string) => {
    const p = people.get(id);
    return p ? displayName(p) : '';
  };
  const byBirth = (a: string, b: string) =>
    compareBirth(birthOf(a), birthOf(b)) || nameOf(a).localeCompare(nameOf(b)) || (a < b ? -1 : a > b ? 1 : 0);

  // The focal person's line: they and everyone above them. Used to decide where a couple hangs.
  const focalLine = new Set<string>();
  {
    const stack = people.has(input.focalId) ? [input.focalId] : [];
    while (stack.length > 0) {
      const next = stack.pop()!;
      if (focalLine.has(next)) continue;
      focalLine.add(next);
      stack.push(...(parentsOf.get(next) ?? []));
    }
  }

  // Relationships of each person, earliest first.
  const childrenOfHang = new Map<string, string[]>();
  for (const [child, key] of hangOfChild) {
    const list = childrenOfHang.get(key) ?? [];
    list.push(child);
    childrenOfHang.set(key, list);
  }
  const unionSortKey = (u: (typeof unionList)[number]): string => {
    if (u.start) return birthKey(u.start.value);
    const kids = (childrenOfHang.get(`u:${u.id}`) ?? []).map(birthOf).filter((v) => v !== '');
    return kids.length > 0 ? kids.sort()[0]! : '';
  };
  const unionsOf = new Map<string, typeof unionList>();
  for (const u of unionList) {
    for (const id of u.partnerIds) unionsOf.set(id, [...(unionsOf.get(id) ?? []), u]);
  }
  for (const list of unionsOf.values()) {
    list.sort((a, b) => compareBirth(unionSortKey(a), unionSortKey(b)) || (a.id < b.id ? -1 : 1));
  }

  // 1. Groups of partners.
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let walk = id;
    while (parent.get(walk) !== root) {
      const next = parent.get(walk)!;
      parent.set(walk, root);
      walk = next;
    }
    return root;
  };
  for (const id of people.keys()) parent.set(id, id);
  for (const u of unionList) {
    const a = find(u.partnerIds[0]);
    const b = find(u.partnerIds[1]);
    if (a !== b) parent.set(b, a);
  }
  const groups = new Map<string, Group>();
  const groupOf = new Map<string, Group>();
  for (const id of people.keys()) {
    const root = find(id);
    let group = groups.get(root);
    if (!group) {
      group = { id: root, members: [], seq: [], row: 0, anchor: null, parentHang: null, hangs: [] };
      groups.set(root, group);
    }
    group.members.push(id);
    groupOf.set(id, group);
  }

  // 2. Order inside each group, and which member anchors it.
  for (const group of groups.values()) {
    const hub = [...group.members].sort(
      (a, b) =>
        (unionsOf.get(b)?.length ?? 0) - (unionsOf.get(a)?.length ?? 0) ||
        Number(parentsOf.has(b)) - Number(parentsOf.has(a)) ||
        byBirth(a, b),
    )[0]!;
    const left: string[] = [];
    const right: string[] = [];
    const seen = new Set([hub]);
    const expand = (person: string, side: 'left' | 'right') => {
      for (const u of unionsOf.get(person) ?? []) {
        const other = u.partnerIds[0] === person ? u.partnerIds[1] : u.partnerIds[0];
        if (seen.has(other)) continue;
        seen.add(other);
        if (side === 'left') left.unshift(other);
        else right.push(other);
        expand(other, side);
      }
    };
    const hubUnions = unionsOf.get(hub) ?? [];
    if (hubUnions.length >= 2) {
      // The earliest relationship goes on the left, the rest on the right.
      const first = hubUnions[0]!;
      const firstOther = first.partnerIds[0] === hub ? first.partnerIds[1] : first.partnerIds[0];
      seen.add(firstOther);
      left.unshift(firstOther);
      expand(firstOther, 'left');
      expand(hub, 'right');
    } else {
      expand(hub, 'right');
    }
    // A member the walk could not reach (cannot happen for a connected group) goes last.
    const rest = group.members.filter((m) => !seen.has(m) && m !== hub);
    group.seq = [...left, hub, ...right, ...rest];

    const candidates = group.members.filter((m) => parentsOf.has(m));
    candidates.sort(
      (a, b) =>
        Number(focalLine.has(b)) - Number(focalLine.has(a)) ||
        (unionsOf.get(b)?.length ?? 0) - (unionsOf.get(a)?.length ?? 0) ||
        byBirth(a, b),
    );
    group.anchor = candidates[0] ?? null;
  }

  // 3. Hangs of each group: one per relationship and one per parent with children of their own.
  const slotOf = (group: Group, id: string) => group.seq.indexOf(id);
  for (const [key, info] of hangInfo) {
    const owner = groupOf.get(info.unionId ? unionById.get(info.unionId)!.partnerIds[0] : info.parentId!)!;
    let slot: number;
    if (info.unionId) {
      const u = unionById.get(info.unionId)!;
      slot = (slotOf(owner, u.partnerIds[0]) + slotOf(owner, u.partnerIds[1])) / 2;
    } else {
      slot = slotOf(owner, info.parentId!);
    }
    owner.hangs.push({
      key,
      unionId: info.unionId,
      parentId: info.parentId,
      group: owner.id,
      slot,
      children: [...(childrenOfHang.get(key) ?? [])].sort(byBirth),
      anchored: [],
    });
  }
  const hangByKey = new Map<string, Hang>();
  for (const group of groups.values()) {
    group.hangs.sort((a, b) => a.slot - b.slot || (a.key < b.key ? -1 : 1));
    for (const h of group.hangs) hangByKey.set(h.key, h);
  }

  // 4. The forest: a group with an anchor hangs under the anchor's parents. Break any cycle (bad data).
  for (const group of groups.values()) {
    if (group.anchor) group.parentHang = hangOfChild.get(group.anchor) ?? null;
  }
  for (const group of groups.values()) {
    let cursor: Group | undefined = group;
    for (let steps = 0; cursor && steps <= groups.size; steps += 1) {
      const hang: Hang | undefined = cursor.parentHang ? hangByKey.get(cursor.parentHang) : undefined;
      cursor = hang ? groups.get(hang.group) : undefined;
      if (cursor === group) {
        group.parentHang = null;
        group.anchor = null;
        break;
      }
    }
  }
  for (const group of groups.values()) {
    if (group.parentHang) hangByKey.get(group.parentHang)!.anchored.push(group.id);
  }

  // 5. Rows: a group is one row below the deepest of its members' parents.
  for (let pass = 0; pass <= groups.size + 1; pass += 1) {
    let changed = false;
    for (const [child, ps] of parentsOf) {
      const g = groupOf.get(child)!;
      for (const p of ps) {
        const pg = groupOf.get(p)!;
        if (pg !== g && g.row < pg.row + 1) {
          g.row = pg.row + 1;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // 6. Blocks, bottom up.
  const sortedAnchored = (hang: Hang): Group[] => {
    const set = hang.anchored.map((id) => groups.get(id)!);
    const order = orders?.get(hang.key);
    const rank = (g: Group) => {
      const at = order ? order.indexOf(g.anchor!) : -1;
      return at < 0 ? Infinity : at;
    };
    return set.sort((a, b) => (order ? rank(a) - rank(b) : 0) || byBirth(a.anchor!, b.anchor!));
  };
  const blocks = new Map<string, Block>();
  const build = (group: Group): Block => {
    const cached = blocks.get(group.id);
    if (cached) return cached;
    const packs: Block['packs'] = [];
    const packInfo: Array<{ hang: Hang; contour: Contour; d: number; kids: Array<{ block: Block; offset: number }> }> =
      [];
    for (const hang of group.hangs) {
      const kids = sortedAnchored(hang);
      if (kids.length === 0) continue;
      let acc: Contour | null = null;
      const placed: Array<{ block: Block; offset: number }> = [];
      for (const kid of kids) {
        const block = build(kid);
        let offset = 0;
        if (acc) offset = Math.max(separation(acc, block.contour, SUBTREE_GAP), -Infinity);
        if (!Number.isFinite(offset)) offset = 0;
        placed.push({ block, offset });
        acc = mergeContours(acc, shiftContour(block.contour, offset));
      }
      const first = placed[0]!;
      const last = placed[placed.length - 1]!;
      const d = (first.offset + first.block.attach + last.offset + last.block.attach) / 2;
      packInfo.push({ hang, contour: acc!, d, kids: placed });
    }

    // Member slots, tight; then place each children pack under its hang, left to right.
    const x = new Map<string, number>();
    group.seq.forEach((id, i) => x.set(id, i * PITCH));
    const slotX = (slot: number) => slot * PITCH;
    let acc: Contour | null = null;
    const hangX = new Map<Hang, number>();
    for (const info of packInfo) {
      let h = slotX(info.hang.slot);
      if (acc) {
        const need = separation(acc, info.contour, SUBTREE_GAP);
        if (Number.isFinite(need)) h = Math.max(h, need + info.d);
      }
      hangX.set(info.hang, h);
      acc = mergeContours(acc, shiftContour(info.contour, h - info.d));
    }
    // Move the members so each hang with children sits where its children are centred.
    const constrained = new Set<string>();
    for (const info of packInfo) {
      if (info.hang.unionId) {
        for (const id of unionById.get(info.hang.unionId)!.partnerIds) constrained.add(id);
      } else {
        constrained.add(info.hang.parentId!);
      }
    }
    const pos = group.seq.map((id) => x.get(id)!);
    const index = (id: string) => group.seq.indexOf(id);
    for (let iteration = 0; iteration < 80; iteration += 1) {
      let moved = 0;
      for (const info of packInfo) {
        const target = hangX.get(info.hang)!;
        if (info.hang.unionId) {
          const [a, b] = unionById.get(info.hang.unionId)!.partnerIds;
          const i = index(a);
          const j = index(b);
          const delta = target - (pos[i]! + pos[j]!) / 2;
          pos[i]! += delta;
          pos[j]! += delta;
          moved += Math.abs(delta);
        } else {
          const i = index(info.hang.parentId!);
          const delta = target - pos[i]!;
          pos[i]! += delta;
          moved += Math.abs(delta);
        }
        // Keep neighbours a pitch apart; the one nobody is holding in place gives way.
        for (let i = 1; i < pos.length; i += 1) {
          const short = PITCH - (pos[i]! - pos[i - 1]!);
          if (short <= 0) continue;
          const holdLeft = constrained.has(group.seq[i - 1]!);
          const holdRight = constrained.has(group.seq[i]!);
          if (holdLeft && !holdRight) pos[i]! += short;
          else if (!holdLeft && holdRight) pos[i - 1]! -= short;
          else {
            pos[i - 1]! -= short / 2;
            pos[i]! += short / 2;
          }
          moved += short;
        }
      }
      if (moved < 0.01) break;
    }
    // A last pass for the members nobody holds: never closer than a pitch.
    for (let i = 1; i < pos.length; i += 1) pos[i]! = Math.max(pos[i]!, pos[i - 1]! + PITCH);
    group.seq.forEach((id, i) => x.set(id, pos[i]!));

    let contour: Contour = rowContour(group.row, Math.min(...pos) - NODE_W / 2, Math.max(...pos) + NODE_W / 2);
    for (const info of packInfo) {
      const shift = hangX.get(info.hang)! - info.d;
      packs.push({ hang: info.hang, shift, children: info.kids });
      contour = mergeContours(contour, shiftContour(info.contour, shift));
    }
    const block: Block = {
      group,
      x,
      packs,
      contour,
      attach: group.anchor ? (x.get(group.anchor) ?? 0) : (x.get(group.seq[0]!) ?? 0),
    };
    blocks.set(group.id, block);
    return block;
  };

  const roots = [...groups.values()]
    .filter((g) => g.parentHang === null)
    .sort(
      (a, b) =>
        a.row - b.row ||
        Number(b.members.some((m) => focalLine.has(m))) - Number(a.members.some((m) => focalLine.has(m))) ||
        byBirth(a.seq[0]!, b.seq[0]!),
    );

  // 7. Absolute positions.
  const nodes: PlacedNode[] = [];
  const byId = new Map<string, PlacedNode>();
  let acc: Contour | null = null;
  const place = (block: Block, dx: number) => {
    for (const [id, bx] of block.x) {
      const node: PlacedNode = { id, x: bx + dx, y: block.group.row * (NODE_H + ROW_GAP), row: block.group.row };
      nodes.push(node);
      byId.set(id, node);
    }
    for (const pack of block.packs) {
      for (const child of pack.children) place(child.block, dx + pack.shift + child.offset);
    }
  };
  for (const group of groups.values()) {
    if (group.parentHang === null) build(group);
  }
  for (const root of roots) {
    const block = blocks.get(root.id)!;
    let offset = 0;
    if (acc) {
      const need = separation(acc, block.contour, ROOT_GAP);
      offset = Number.isFinite(need) ? need : 0;
    }
    acc = mergeContours(acc, shiftContour(block.contour, offset));
    place(block, offset);
  }

  // Everything starts at the margin.
  const minX = nodes.length > 0 ? Math.min(...nodes.map((n) => n.x - NODE_W / 2)) : 0;
  for (const node of nodes) {
    node.x += MARGIN - minX;
    node.y += MARGIN;
  }

  // Bus lanes: where the children lines of one family would run along another's, each gets its own line. The
  // gap between two rows keeps its height unless a group needs more than FREE_LANES lines.
  const hangPoint = (info: { unionId: string | null; parentId: string | null }): number => {
    if (info.unionId) {
      const [a, b] = unionById.get(info.unionId)!.partnerIds;
      return (byId.get(a)!.x + byId.get(b)!.x) / 2;
    }
    return byId.get(info.parentId!)!.x;
  };
  const busRow = (info: { unionId: string | null; parentId: string | null }): number =>
    byId.get(info.unionId ? unionById.get(info.unionId)!.partnerIds[0] : info.parentId!)!.row;
  const laneOf = new Map<string, { lane: number; lanes: number }>();
  const extraBelow: number[] = []; // extra height of the gap under each row
  if (busLanes) {
    const byGap = new Map<number, BusSpec[]>();
    for (const [key, info] of hangInfo) {
      const kids = hangByKey.get(key)!.children.filter((id) => byId.has(id));
      if (kids.length === 0) continue;
      const hx = hangPoint(info);
      const xs = kids.map((id) => byId.get(id)!.x);
      const row = busRow(info);
      const list = byGap.get(row) ?? [];
      list.push({ key, hx, xs, lo: Math.min(hx, ...xs), hi: Math.max(hx, ...xs) });
      byGap.set(row, list);
    }
    for (const [row, buses] of byGap) {
      const lanes = assignLanes(buses);
      let most = 1;
      for (const [key, value] of lanes) {
        laneOf.set(key, value);
        most = Math.max(most, value.lanes);
      }
      extraBelow[row] = Math.max(0, most - FREE_LANES) * LANE_PITCH;
    }
    let pushed = 0;
    const pushOf: number[] = [];
    for (let row = 0; row <= Math.max(...nodes.map((n) => n.row), 0); row += 1) {
      pushOf[row] = pushed;
      pushed += extraBelow[row] ?? 0;
    }
    if (pushed > 0) for (const node of nodes) node.y += pushOf[node.row]!;
  }

  // 8. Lines.
  const rowBottom = (id: string) => byId.get(id)!.y + NODE_H;
  const couples: PlacedCouple[] = [];
  for (const u of unionList) {
    const a = byId.get(u.partnerIds[0])!;
    const b = byId.get(u.partnerIds[1])!;
    const [l, r] = a.x <= b.x ? [a, b] : [b, a];
    const group = groupOf.get(l.id)!;
    const adjacent = Math.abs(slotOf(group, l.id) - slotOf(group, r.id)) === 1;
    const midX = (l.x + r.x) / 2;
    const centerY = l.y + NODE_H / 2;
    const bottom = l.y + NODE_H;
    couples.push({
      unionId: u.id,
      status: u.status,
      left: l.id,
      right: r.id,
      x1: l.x,
      x2: r.x,
      y: adjacent ? centerY : bottom + BRACKET,
      bracket: !adjacent,
      d: adjacent
        ? `M${l.x + NODE_W / 2} ${centerY}H${r.x - NODE_W / 2}`
        : `M${l.x} ${bottom}V${bottom + BRACKET}H${r.x}V${bottom}`,
      hangX: midX,
      hangY: adjacent ? centerY : bottom + BRACKET,
    });
  }
  const coupleById = new Map(couples.map((c) => [c.unionId, c]));

  const links: PlacedLink[] = [];
  for (const [key, info] of hangInfo) {
    const hang = hangByKey.get(key)!;
    const kids = hang.children.filter((id) => byId.has(id));
    if (kids.length === 0) continue;
    let hx: number;
    let hy: number;
    if (info.unionId) {
      const couple = coupleById.get(info.unionId)!;
      hx = couple.hangX;
      hy = couple.hangY;
    } else {
      const p = byId.get(info.parentId!)!;
      hx = p.x;
      hy = p.y + NODE_H;
    }
    const parentBottom = Math.max(
      ...(info.unionId ? unionById.get(info.unionId)!.partnerIds : [info.parentId!]).map(rowBottom),
    );
    const slot = laneOf.get(key);
    const bus = slot
      ? parentBottom + (ROW_GAP + (extraBelow[busRow(info)] ?? 0)) / 2 + (slot.lane - (slot.lanes - 1) / 2) * LANE_PITCH
      : parentBottom + ROW_GAP / 2;
    const xs = kids.map((id) => byId.get(id)!.x);
    let d = `M${hx} ${hy}V${bus}`;
    const lo = Math.min(hx, ...xs);
    const hi = Math.max(hx, ...xs);
    if (hi > lo) d += `M${lo} ${bus}H${hi}`;
    for (const id of kids) {
      const n = byId.get(id)!;
      d += `M${n.x} ${bus}V${n.y}`;
    }
    links.push({ key, d, childIds: kids, unionId: info.unionId, parentId: info.parentId });
  }

  const rows: string[][] = [];
  for (const node of [...nodes].sort((a, b) => a.x - b.x || (a.id < b.id ? -1 : 1))) {
    (rows[node.row] ??= []).push(node.id);
  }
  for (let i = 0; i < rows.length; i += 1) rows[i] ??= [];
  const width = nodes.length > 0 ? Math.max(...nodes.map((n) => n.x + NODE_W / 2)) + MARGIN : MARGIN * 2;
  const height = nodes.length > 0 ? Math.max(...nodes.map((n) => n.y + NODE_H)) + MARGIN : MARGIN * 2;
  // Brothers and sisters with a second family to follow, for the order search.
  const sets: SiblingSet[] = [];
  for (const group of groups.values()) {
    for (const hang of group.hangs) {
      const kids = sortedAnchored(hang);
      if (kids.length < 2) continue;
      const targets = new Map<string, string[]>();
      for (const kid of kids) {
        const other = kid.members
          .filter((m) => m !== kid.anchor && parentsOf.has(m))
          .map((m) => hangOfChild.get(m)!)
          .filter((key) => key !== hang.key);
        if (other.length > 0) targets.set(kid.anchor!, other.sort());
      }
      if (targets.size === 0) continue;
      sets.push({ hangKey: hang.key, row: group.row, order: kids.map((k) => k.anchor!), targets });
    }
  }
  sets.sort((a, b) => a.row - b.row || (a.hangKey < b.hangKey ? -1 : a.hangKey > b.hangKey ? 1 : 0));
  return { layout: { nodes, byId, couples, links, width, height, rows }, sets };
}

/** Parents and children of each person, for keyboard movement. */
export function relationsOf(input: Pick<LayoutInput, 'people' | 'unions' | 'parentage'>): {
  parents: Map<string, string[]>;
  children: Map<string, string[]>;
} {
  const ids = new Set(input.people.map((p) => p.id));
  const unions = new Map(input.unions.map((u) => [u.id, u]));
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const [child, link] of Object.entries(input.parentage)) {
    if (!ids.has(child)) continue;
    const ps = link.unionId ? [...(unions.get(link.unionId)?.partnerIds ?? [])] : link.parentId ? [link.parentId] : [];
    const drawn = ps.filter((p) => ids.has(p));
    if (drawn.length === 0) continue;
    parents.set(child, drawn);
    for (const p of drawn) children.set(p, [...(children.get(p) ?? []), child]);
  }
  return { parents, children };
}
