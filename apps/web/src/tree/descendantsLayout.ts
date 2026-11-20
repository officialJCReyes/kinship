// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Descendants: everyone below one person, left to right, each person's children grouped under them and the parent
// centred beside the group. Partners are listed on the card, not drawn, and stepchildren (a partner's children from
// another relationship) are not shown. A pure function of the tree response and the number of generations, so the same
// data always gives the same chart (ADR 0026).
import type { TreeResponse, UnionStatus } from '@kinship/shared';
import { t } from '../i18n.js';
import { displayName } from '../lib/names.js';
import { birthKey, MARGIN, NODE_H, NODE_W } from './layout.js';
import type { Layout, NavigationKey, PlacedLink, PlacedNode, PlacedTitle } from './layout.js';
import { parentsIn } from './family.js';

export const DESCENDANTS_COLUMN_GAP = 56;
/** The card is taller than a Family tree card: two more lines (small) under the dates for the partners. */
export const DESCENDANTS_NODE_H = NODE_H + 30;
const ROW_GAP = 12;
const TITLE_ROOM = 34;
const COLUMN_TITLES = [
  'tree.descendants.column.0',
  'tree.descendants.column.1',
  'tree.descendants.column.2',
  'tree.descendants.column.3',
  'tree.descendants.column.4',
] as const;

const PARTNER_KEYS = {
  married: 'tree.descendants.married',
  widowed: 'tree.descendants.married',
  divorced: 'tree.descendants.divorced',
  separated: 'tree.descendants.separated',
  engaged: 'tree.descendants.engaged',
} as const;

function partnerText(status: UnionStatus, name: string): string {
  const key = PARTNER_KEYS[status as keyof typeof PARTNER_KEYS] ?? 'tree.descendants.with';
  return t(key, { name });
}

export interface DescendantsResult {
  layout: Layout;
  /** Everyone drawn: the person and their descendants, `gen` generations. */
  ids: Set<string>;
}

export function layoutDescendants(tree: TreeResponse, rootId: string, gen: number): DescendantsResult {
  const people = new Map(tree.people.map((p) => [p.id, p]));
  const byBirth = (a: string, b: string): number => {
    const pa = people.get(a)!;
    const pb = people.get(b)!;
    const ka = birthKey(pa.birth?.value);
    const kb = birthKey(pb.birth?.value);
    if (ka !== kb) return ka === '' ? 1 : kb === '' ? -1 : ka < kb ? -1 : 1;
    return displayName(pa).localeCompare(displayName(pb)) || (a < b ? -1 : a > b ? 1 : 0);
  };

  // Children of each person: those whose parent (or one of the two partners of their parents' relationship) they are.
  // A child whose only link is to a partner of theirs (a stepchild) is not a child of this person.
  const childrenOf = new Map<string, string[]>();
  for (const child of Object.keys(tree.parentage)) {
    if (!people.has(child)) continue;
    for (const parent of parentsIn(tree, tree.parentage[child])) {
      if (people.has(parent)) childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), child]);
    }
  }
  for (const list of childrenOf.values()) list.sort(byBirth);

  // Partners, listed on the card: each relationship in order of its start (no date last), then id.
  const unionsOf = new Map<string, Array<{ id: string; status: UnionStatus; start: string; other: string }>>();
  for (const u of tree.unions) {
    const [a, b] = u.partnerIds;
    if (!people.has(a) || !people.has(b)) continue;
    const start = birthKey(u.start?.value);
    unionsOf.set(a, [...(unionsOf.get(a) ?? []), { id: u.id, status: u.status, start, other: b }]);
    unionsOf.set(b, [...(unionsOf.get(b) ?? []), { id: u.id, status: u.status, start, other: a }]);
  }
  for (const list of unionsOf.values()) {
    list.sort(
      (x, y) =>
        (x.start === y.start ? 0 : x.start === '' ? 1 : y.start === '' ? -1 : x.start < y.start ? -1 : 1) ||
        (x.id < y.id ? -1 : 1),
    );
  }
  const noteFor = (id: string, depth: number): string => {
    const partners = (unionsOf.get(id) ?? []).map((u) => partnerText(u.status, people.get(u.other)!.givenName));
    const parts = partners.length > 0 ? [partners.join(' · ')] : [t('tree.descendants.noPartner')];
    if (depth + 1 >= gen) {
      const below = childrenOf.get(id)?.length ?? 0;
      if (below > 0)
        parts.push(t(below === 1 ? 'tree.descendants.below.one' : 'tree.descendants.below.many', { n: below }));
    }
    return parts.join(' · ');
  };

  const pitch = DESCENDANTS_NODE_H + ROW_GAP;
  const x = (column: number) => MARGIN + NODE_W / 2 + column * (NODE_W + DESCENDANTS_COLUMN_GAP);
  const nodes: PlacedNode[] = [];
  const links: PlacedLink[] = [];
  const columns: string[][] = Array.from({ length: gen }, () => []);
  const parentOf = new Map<string, string>();
  const ids = new Set<string>();
  let leaf = 0;
  /** Centre line of each card. */
  const middle = new Map<string, number>();

  const walk = (id: string, depth: number): number => {
    ids.add(id);
    const kids = depth + 1 < gen ? (childrenOf.get(id) ?? []).filter((k) => !ids.has(k)) : [];
    let centre: number;
    const drawn: string[] = [];
    if (kids.length === 0) {
      centre = MARGIN + TITLE_ROOM + leaf * pitch + DESCENDANTS_NODE_H / 2;
      leaf += 1;
    } else {
      const centres: number[] = [];
      for (const kid of kids) {
        if (ids.has(kid)) continue; // drawn under their other parent a moment ago
        parentOf.set(kid, id);
        centres.push(walk(kid, depth + 1));
        drawn.push(kid);
      }
      centre = (centres[0]! + centres[centres.length - 1]!) / 2;
    }
    middle.set(id, centre);
    columns[depth]!.push(id);
    nodes.push({ id, x: x(depth), y: centre - DESCENDANTS_NODE_H / 2, row: depth, note: noteFor(id, depth) });
    if (drawn.length > 0) {
      const px = x(depth) + NODE_W / 2;
      const bus = px + DESCENDANTS_COLUMN_GAP / 2;
      const ys = drawn.map((k) => middle.get(k)!);
      links.push({
        key: id,
        d: drawn.map((_, i) => `M${px} ${centre}H${bus}V${ys[i]}H${x(depth + 1) - NODE_W / 2}`).join(''),
        childIds: drawn,
        unionId: null,
        parentId: null,
        bounds: [px, Math.min(centre, ...ys), x(depth + 1) - NODE_W / 2, Math.max(centre, ...ys)],
      });
    }
    return centre;
  };
  if (people.has(rootId)) walk(rootId, 0);

  const titles: PlacedTitle[] = Array.from({ length: gen }, (_, column) => ({
    key: `column-${column}`,
    x: x(column) - NODE_W / 2,
    y: MARGIN + 6,
    text: t(COLUMN_TITLES[column] ?? COLUMN_TITLES[4]),
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const column of columns) column.sort((a, b) => middle.get(a)! - middle.get(b)!);
  const navigate = (id: string, key: NavigationKey): string | undefined => {
    const node = byId.get(id);
    if (!node) return undefined;
    const column = columns[node.row]!;
    const at = column.indexOf(id);
    if (key === 'ArrowUp') return column[at - 1];
    if (key === 'ArrowDown') return column[at + 1];
    if (key === 'ArrowLeft') return parentOf.get(id);
    return links.find((l) => l.key === id)?.childIds[0];
  };
  const width = MARGIN * 2 + gen * NODE_W + (gen - 1) * DESCENDANTS_COLUMN_GAP;
  const height = MARGIN * 2 + TITLE_ROOM + Math.max(leaf, 1) * pitch - ROW_GAP;
  return {
    layout: {
      nodes,
      byId,
      couples: [],
      links,
      width,
      height,
      rows: columns,
      nodeHeight: DESCENDANTS_NODE_H,
      titles,
      navigate,
    },
    ids,
  };
}
