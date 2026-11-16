// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Gender, Person, PersonDetail, TreeResponse, UnionStatus } from '@kinship/shared';
import { parentIdsOf, peopleById } from './people.js';

/** Only a Married or Widowed relationship gives step titles; a divorced, separated or unmarried one gives none. */
export function givesStepTitles(status: UnionStatus): boolean {
  return status === 'married' || status === 'widowed';
}

export type StepKind = 'stepparent' | 'stepchild';

/** One derived step relative on a profile. `otherId` is the other person of the pair (so a custom label can override it). */
export interface StepRow {
  otherId: string;
  person: Person;
  kind: StepKind;
}

const byName = (a: StepRow, b: StepRow) =>
  a.person.surname.localeCompare(b.person.surname) || a.person.givenName.localeCompare(b.person.givenName);

/**
 * Step-parents: the other partner of a Married or Widowed relationship of one of this person's parents, who is not
 * already one of this person's parents. `tree` is the viewer's own response, so the parents followed are the ones the
 * viewer's lineage view follows (an adopted person's step-parents come through the adoptive set, or through the birth
 * set in the birth view), exactly as half-siblings do.
 */
export function stepParentsOf(tree: TreeResponse | undefined, personId: string): StepRow[] {
  if (!tree) return [];
  const parents = parentIdsOf(tree.parentage[personId], tree.unions);
  if (parents.length === 0) return [];
  const people = peopleById(tree);
  const rows = new Map<string, StepRow>();
  for (const union of tree.unions) {
    if (!givesStepTitles(union.status)) continue;
    const [a, b] = union.partnerIds;
    for (const [parent, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const person = people.get(other);
      if (parents.includes(parent) && !parents.includes(other) && other !== personId && person) {
        rows.set(other, { otherId: other, person, kind: 'stepparent' });
      }
    }
  }
  return [...rows.values()].sort(byName);
}

/**
 * Stepchildren: the children of this person's Married or Widowed partners who do not hang from this person (from the
 * partner alone, or from the partner's relationship with somebody else). They come from `partnerChildren`, which the
 * API follows by the viewer's lineage view.
 */
export function stepChildrenOf(detail: Pick<PersonDetail, 'person' | 'unions' | 'partnerChildren'>): StepRow[] {
  const rows = new Map<string, StepRow>();
  for (const union of detail.unions) {
    if (!givesStepTitles(union.status)) continue;
    const partner = union.partnerIds.find((id) => id !== detail.person.id);
    for (const entry of detail.partnerChildren) {
      if (entry.partnerId === partner)
        rows.set(entry.child.id, { otherId: entry.child.id, person: entry.child, kind: 'stepchild' });
    }
  }
  return [...rows.values()].sort(byName);
}

/** "Stepmother", "Stepson" and so on. */
export function stepTitleKey(
  kind: StepKind,
  gender: Gender | null,
): `relative.${'stepParent' | 'stepChild'}.${'male' | 'female' | 'neutral'}` {
  const side = gender === 'male' || gender === 'female' ? gender : 'neutral';
  return `relative.${kind === 'stepparent' ? 'stepParent' : 'stepChild'}.${side}`;
}
