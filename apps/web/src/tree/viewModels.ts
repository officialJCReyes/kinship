// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What a chart needs to be drawn, built from a tree response: the people, the layout, the lines between them and the
// leaves. One model for each view; the page keeps the last one on screen until the next view's data has arrived.
import type { LineageView, Person, TreeResponse, Union } from '@kinship/shared';
import { familyView, findLeaves, findOtherLeaves } from './family.js';
import type { Leaf } from './family.js';
import { layoutTree, relationsOf } from './layout.js';
import type { Layout } from './layout.js';
import { layoutPedigree } from './pedigreeLayout.js';
import type { TreeViewName } from './treeView.js';

export interface ChartModel {
  /** Changes when the chart is a different one (the canvas is remounted, so it fits itself again). */
  key: string;
  view: TreeViewName;
  /** The person the chart is about. */
  focalId: string;
  shown: TreeResponse;
  people: Map<string, Person>;
  layout: Layout;
  parents: Map<string, string[]>;
  children: Map<string, string[]>;
  leaves: Map<string, Leaf>;
  otherLeaves: Map<string, Leaf>;
  unionsById: Map<string, Union>;
}

const peopleOf = (shown: TreeResponse) => new Map(shown.people.map((p) => [p.id, p as Person]));

/** The Family tree, or a spouse's family view of it (`of`). */
export function familyModel(input: {
  id: string;
  of: string | null;
  lineage: LineageView | undefined;
  main: TreeResponse | undefined;
  family: TreeResponse | undefined;
}): ChartModel | null {
  const { id, of, lineage, main, family } = input;
  const shown = of ? (family ? familyView(family, of) : undefined) : main;
  if (!shown) return null;
  const focalId = of ?? id;
  const relations = relationsOf(shown);
  return {
    key: `family|${id}|${of ?? ''}|${lineage ?? ''}`,
    view: 'family',
    focalId,
    shown,
    people: peopleOf(shown),
    layout: layoutTree({ focalId, people: shown.people, unions: shown.unions, parentage: shown.parentage }),
    parents: relations.parents,
    children: relations.children,
    leaves: new Map(
      findLeaves(shown, focalId, main, of !== null, of !== null ? lineage : undefined).map((leaf) => [
        leaf.personId,
        leaf,
      ]),
    ),
    otherLeaves: new Map(findOtherLeaves(shown, main, of !== null).map((leaf) => [leaf.personId, leaf])),
    unionsById: new Map(shown.unions.map((u) => [u.id, u])),
  };
}

/** The people drawn, as a tree response of their own (no relationships between them: the counter and the panel only need the people). */
const justThese = (tree: TreeResponse, ids: ReadonlySet<string>): TreeResponse => ({
  lineage: tree.lineage,
  focalId: tree.focalId,
  totalPeople: tree.totalPeople,
  people: tree.people.filter((p) => ids.has(p.id)),
  unions: [],
  parentage: {},
});

/** The Pedigree: the blood ancestors of a person, `gen` generations, from a response asked for with lineage=birth. */
export function pedigreeModel(tree: TreeResponse, id: string, gen: number): ChartModel {
  const { layout, ids } = layoutPedigree(tree, id, gen);
  const shown = justThese(tree, ids);
  return {
    key: `pedigree|${id}|${gen}`,
    view: 'pedigree',
    focalId: id,
    shown,
    people: peopleOf(shown),
    layout,
    parents: new Map(),
    children: new Map(),
    leaves: new Map(),
    otherLeaves: new Map(),
    unionsById: new Map(),
  };
}
