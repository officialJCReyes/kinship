// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Pedigree: the blood ancestors of one person, left to right, one column for each generation, the father above and
// the mother below. A pure function of the tree response and the number of generations, so the same data always gives
// the same chart (ADR 0026).
import type { Parentage, Person, TreePerson, TreeResponse } from '@kinship/shared';
import { t } from '../i18n.js';
import { parentsIn } from './family.js';
import { MARGIN, NODE_H, NODE_W } from './layout.js';
import type { Layout, NavigationKey, PlacedLink, PlacedNode, PlacedSlot, PlacedTitle } from './layout.js';

/** Between two columns: the line runs in it. */
export const PEDIGREE_COLUMN_GAP = 56;
/** One slot (a card and the space under it); the last column has one slot for each ancestor it can hold. */
export const PEDIGREE_SLOT = NODE_H + 14;
const TITLE_ROOM = 34;
const COLUMN_TITLES = [
  'tree.pedigree.column.0',
  'tree.pedigree.column.1',
  'tree.pedigree.column.2',
  'tree.pedigree.column.3',
  'tree.pedigree.column.4',
] as const;

const birthKey = (p: Pick<Person, 'birth'>): string => p.birth?.value ?? '';

/**
 * The two places for a person's parents: the father's above, the mother's below. A man goes first, a woman second;
 * somebody of another or no recorded sex takes the first free place; two of the same sex are told apart by birth date,
 * then id. A place with nobody is null.
 */
export function parentSlots(parents: readonly Person[]): [Person | null, Person | null] {
  const rank = (p: Person) => (p.gender === 'male' ? 0 : p.gender === 'female' ? 2 : 1);
  const sorted = [...parents].sort(
    (a, b) => rank(a) - rank(b) || birthKey(a).localeCompare(birthKey(b)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  if (sorted.length >= 2) return [sorted[0]!, sorted[1]!];
  const only = sorted[0];
  if (!only) return [null, null];
  return only.gender === 'female' ? [null, only] : [only, null];
}

export interface PedigreeResult {
  layout: Layout;
  /** Everyone drawn: the person and their blood ancestors, `gen` generations. */
  ids: Set<string>;
}

export function layoutPedigree(tree: TreeResponse, rootId: string, gen: number): PedigreeResult {
  const people = new Map<string, TreePerson>(tree.people.map((p) => [p.id, p]));
  const parentsOf = (id: string): Person[] =>
    parentsIn(tree, tree.parentage[id as keyof typeof tree.parentage] as Parentage | undefined)
      .map((p) => people.get(p))
      .filter((p): p is TreePerson => p !== undefined);

  const x = (column: number) => MARGIN + NODE_W / 2 + column * (NODE_W + PEDIGREE_COLUMN_GAP);
  /** Top of the card in a column's slot `index`: the first column has one slot as tall as the whole chart. */
  const top = (column: number, index: number) =>
    MARGIN + TITLE_ROOM + (index + 0.5) * 2 ** (gen - 1 - column) * PEDIGREE_SLOT - NODE_H / 2;

  const nodes: PlacedNode[] = [];
  const links: PlacedLink[] = [];
  const slots: PlacedSlot[] = [];
  const columns: Array<Array<{ id: string; index: number }>> = Array.from({ length: gen }, () => []);
  const seat = new Map<string, { column: number; index: number }>();
  const ids = new Set<string>();

  const place = (person: Person, column: number, index: number) => {
    const first = !ids.has(person.id);
    if (first) {
      ids.add(person.id);
      nodes.push({ id: person.id, x: x(column), y: top(column, index), row: column });
      seat.set(person.id, { column, index });
      columns[column]!.push({ id: person.id, index });
    }
    if (column + 1 >= gen) return;
    const [father, mother] = parentSlots(parentsOf(person.id));
    [father, mother].forEach((parent, j) => {
      const childIndex = 2 * index + j;
      const px = x(column + 1) - NODE_W / 2;
      const py = top(column + 1, childIndex) + NODE_H / 2;
      const cx = x(column) + NODE_W / 2;
      const cy = top(column, index) + NODE_H / 2;
      links.push({
        key: `${person.id}>${j}`,
        d: `M${cx} ${cy}H${cx + PEDIGREE_COLUMN_GAP / 2}V${py}H${px}`,
        childIds: parent ? [parent.id] : [],
        unionId: null,
        parentId: null,
        bounds: [cx, Math.min(cy, py), px, Math.max(cy, py)],
      });
      if (parent) place(parent, column + 1, childIndex);
      else {
        slots.push({
          key: `${person.id}:${j}`,
          x: x(column + 1) - NODE_W / 2,
          y: top(column + 1, childIndex),
          label: t(j === 0 ? 'tree.pedigree.fatherMissing' : 'tree.pedigree.motherMissing'),
        });
      }
    });
  };
  const root = people.get(rootId);
  if (root) place(root, 0, 0);

  const titles: PlacedTitle[] = Array.from({ length: gen }, (_, column) => ({
    key: `column-${column}`,
    x: x(column) - NODE_W / 2,
    y: MARGIN + 6,
    text: t(COLUMN_TITLES[column] ?? COLUMN_TITLES[4]),
  }));

  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const column of columns) column.sort((a, b) => a.index - b.index);
  const rows = columns.map((column) => column.map((c) => c.id));
  const navigate = (id: string, key: NavigationKey): string | undefined => {
    const at = seat.get(id);
    if (!at) return undefined;
    const column = columns[at.column]!;
    const position = column.findIndex((c) => c.id === id);
    if (key === 'ArrowUp') return column[position - 1]?.id;
    if (key === 'ArrowDown') return column[position + 1]?.id;
    if (key === 'ArrowLeft') {
      // Back to the child this person is a parent of.
      return columns[at.column - 1]?.find((c) => c.index === Math.floor(at.index / 2))?.id;
    }
    // To the father, or to the mother when there is no father drawn.
    const next = columns[at.column + 1];
    return (next?.find((c) => c.index === 2 * at.index) ?? next?.find((c) => c.index === 2 * at.index + 1))?.id;
  };

  const width = MARGIN * 2 + gen * NODE_W + (gen - 1) * PEDIGREE_COLUMN_GAP;
  const height = MARGIN * 2 + TITLE_ROOM + 2 ** (gen - 1) * PEDIGREE_SLOT;
  return {
    layout: { nodes, byId, couples: [], links, width, height, rows, titles, slots, navigate },
    ids,
  };
}
