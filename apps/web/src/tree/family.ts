// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the Family tree chart does with a tree response besides drawing it: the "family view" of a person
// (the view the spouse's-family leaf flips to) and what each leaf does when it is clicked.
import { displayName, displaySurname } from '../lib/names.js';
import type { LineageView, LinkKind, Parentage, Person, TreePerson, TreeResponse } from '@kinship/shared';
import { t } from '../i18n.js';
import { formatYear } from '../lib/dates.js';

/** The people a parentage points at (a relationship's two partners, or the single parent). */
export function parentsIn(tree: Pick<TreeResponse, 'unions'>, link: Parentage | undefined): string[] {
  if (!link) return [];
  if (link.parentId) return [link.parentId];
  const union = tree.unions.find((u) => u.id === link.unionId);
  return union ? [...union.partnerIds] : [];
}

/** Everyone above `personId` that this response draws (parents, grandparents and so on). */
export function ancestorsIn(tree: Pick<TreeResponse, 'unions' | 'parentage'>, personId: string): Set<string> {
  const seen = new Set<string>();
  const stack = [personId];
  while (stack.length > 0) {
    const next = stack.pop()!;
    for (const parent of parentsIn(tree, tree.parentage[next])) {
      if (!seen.has(parent)) {
        seen.add(parent);
        stack.push(parent);
      }
    }
  }
  return seen;
}

const sameParentage = (a: Parentage | undefined, b: Parentage | undefined): boolean =>
  a !== undefined && b !== undefined && a.unionId === b.unionId && a.parentId === b.parentId;

/**
 * A person's own family, from a response loaded around them with collateral=true: their ancestors, their full
 * brothers and sisters, their partners and the children of those partners. Half-siblings, and everybody else on the
 * main chart, are left out. Someone whose parents are then not drawn keeps `hasParents`, so they get a leaf.
 */
export function familyView(tree: TreeResponse, personId: string): TreeResponse {
  const own = tree.parentage[personId];
  const keep = new Set<string>([personId, ...ancestorsIn(tree, personId)]);
  for (const [child, link] of Object.entries(tree.parentage)) {
    if (child !== personId && sameParentage(link, own)) keep.add(child); // full brothers and sisters
  }
  const myUnions = tree.unions.filter((u) => u.partnerIds.includes(personId));
  for (const u of myUnions) {
    for (const partner of u.partnerIds) keep.add(partner);
  }
  for (const [child, link] of Object.entries(tree.parentage)) {
    const fromMyUnion = link.unionId !== null && myUnions.some((u) => u.id === link.unionId);
    if (fromMyUnion || link.parentId === personId) keep.add(child); // their children
  }

  const unions = tree.unions.filter((u) => keep.has(u.partnerIds[0]) && keep.has(u.partnerIds[1]));
  const unionIds = new Set(unions.map((u) => u.id));
  const parentage: Record<string, Parentage> = {};
  for (const [child, link] of Object.entries(tree.parentage)) {
    if (!keep.has(child)) continue;
    const drawn = link.unionId ? unionIds.has(link.unionId) : link.parentId !== null && keep.has(link.parentId);
    if (drawn) parentage[child] = link;
  }
  const people: TreePerson[] = tree.people
    .filter((p) => keep.has(p.id))
    .map((p) => {
      if (!p.hasParents || parentage[p.id] !== undefined || p.ancestorCount !== undefined) return p;
      // Their parents are in the response but not in this view: count what the response knows of them.
      const known = ancestorsIn(tree, p.id);
      let count = known.size;
      for (const id of known) count += tree.people.find((q) => q.id === id)?.ancestorCount ?? 0;
      return { ...p, ancestorCount: count };
    });
  return { lineage: tree.lineage, focalId: personId, people, unions, parentage };
}

export type LeafTarget =
  /** Flip to this person's family view. `lineage` makes the whole view follow that family (birth or adoptive). */
  | { kind: 'family'; personId: string; lineage?: LineageView }
  /** Flip back to the main chart. */
  | { kind: 'main' }
  /** Make this person the root of the chart. */
  | { kind: 'root'; personId: string };

export interface Leaf {
  personId: string;
  count: number | null;
  target: LeafTarget;
  /** Set on a second leaf: the family it opens ("birth" or "adoptive"). */
  family?: LinkKind;
}

/**
 * The leaves of what is drawn: a person with parents who are not drawn. What a click does:
 *  - on the main chart, a blood ancestor of the root (cut off by the generation limit) re-roots the chart on them,
 *    and anyone else (an in-law) flips to their family;
 *  - in a family view, a person whose parents are drawn on the main chart flips back, and anyone else flips to
 *    their own family.
 */
export function findLeaves(
  shown: TreeResponse,
  rootId: string,
  main: TreeResponse | undefined,
  inFamilyView: boolean,
  /** The lineage the family view was opened with (it carries on through the whole flip), if any. */
  override?: LineageView,
): Leaf[] {
  const leaves: Leaf[] = [];
  const rootLine = inFamilyView ? new Set<string>() : ancestorsIn(shown, rootId);
  for (const person of shown.people) {
    if (!person.hasParents || shown.parentage[person.id] !== undefined) continue;
    let target: LeafTarget;
    if (inFamilyView) {
      target =
        main?.parentage[person.id] !== undefined
          ? { kind: 'main' }
          : { kind: 'family', personId: person.id, ...(override ? { lineage: override } : {}) };
    } else {
      target = rootLine.has(person.id)
        ? { kind: 'root', personId: person.id }
        : { kind: 'family', personId: person.id };
    }
    leaves.push({ personId: person.id, count: person.ancestorCount ?? null, target });
  }
  return leaves;
}

/**
 * The second leaf: a person who has a parent set this chart does not follow (an adopted person's birth family in
 * the adoptive view, or their adoptive family in the birth view). It opens that family. In a family view, if the
 * main chart already follows that family and draws the person's parents, it flips back instead.
 */
export function findOtherLeaves(shown: TreeResponse, main: TreeResponse | undefined, inFamilyView: boolean): Leaf[] {
  const leaves: Leaf[] = [];
  for (const person of shown.people) {
    const other = person.otherFamily;
    if (!other) continue;
    const target: LeafTarget =
      inFamilyView && main?.lineage === other.kind && main.parentage[person.id] !== undefined
        ? { kind: 'main' }
        : { kind: 'family', personId: person.id, lineage: other.kind };
    leaves.push({ personId: person.id, count: other.count, family: other.kind, target });
  }
  return leaves;
}

/** "Show Samuel’s birth family (2 people)". */
export function otherLeafLabel(person: Pick<Person, 'givenName'>, family: LinkKind, count: number): string {
  const name = person.givenName;
  return count === 1 ? t(`tree.other.${family}.one`, { name }) : t(`tree.other.${family}.many`, { name, count });
}

export function leafLabel(person: Pick<Person, 'givenName' | 'surname'>, count: number | null): string {
  const name = person.givenName;
  if (count === null) return t('tree.leaf.unknown', { name });
  return count === 1 ? t('tree.leaf.one', { name }) : t('tree.leaf.many', { name, count });
}

/** "Marcus Hale, born 1988, male" for screen readers and tooltips. */
export function nodeLabel(person: Person): string {
  if (person.isPlaceholder) return t('tree.node.unknownParent', { name: displayName(person) });
  const parts: string[] = [displayName(person)];
  const born = formatYear(person.birth);
  const died = formatYear(person.death);
  if (born) parts.push(t('tree.node.born', { year: born }));
  if (person.deceased) parts.push(died ? t('tree.node.died', { year: died }) : t('tree.node.deceased'));
  parts.push(t(`tree.gender.${person.gender ?? 'unknown'}`));
  return parts.join(t('tree.node.separator'));
}

export function initials(
  person: Pick<Person, 'givenName' | 'surname' | 'secondSurname' | 'marriedSurname'> & {
    surnameParticle?: string | null;
  },
): string {
  const first = Array.from(person.givenName.trim())[0] ?? '';
  // The particle (de, de la, van) is not part of the initial: "Beatriz de la Cruz" is BC.
  let surname = displaySurname(person).trim();
  if (person.surnameParticle && surname.startsWith(`${person.surnameParticle} `)) {
    surname = surname.slice(person.surnameParticle.length + 1);
  }
  const last = Array.from(surname)[0] ?? '';
  return `${first}${last}`.toUpperCase();
}
