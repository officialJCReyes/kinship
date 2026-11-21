// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The path between two people as a list of steps, in the order a person reads it: from the first person up to the
// shared ancestor(s) and down to the second person (or along the chain of an in-law or step result). The visible
// text list is built from this, so the diagram and the words always agree.
import { relWord, renderRelName } from '@kinship/shared';
import type { RelName, RelationshipResponse } from '@kinship/shared';
import { t } from '../i18n.js';

export interface PathStep {
  id: string;
  /** What this person is to `to` ("father"), or null for the first person. */
  relation: RelName | null;
  /** The person (or the two people, a couple) the relation is to. */
  to: string[];
  /** This person is a closest shared ancestor. */
  shared: boolean;
}

export function pathSteps(result: RelationshipResponse): PathStep[] {
  const gender = (id: string) => result.people[id]?.gender ?? null;
  const steps: PathStep[] = [];
  if (result.blood) {
    const { dA, ancestors, lineA, lineB } = result.blood;
    steps.push({ id: result.a, relation: null, to: [], shared: dA === 0 });
    let lower = result.a;
    for (const id of [...lineA].reverse().slice(1)) {
      steps.push({ id, relation: relWord('parent', gender(id)), to: [lower], shared: false });
      lower = id;
    }
    if (dA > 0) {
      for (const id of ancestors) {
        steps.push({ id, relation: relWord('parent', gender(id)), to: [lower], shared: true });
      }
    }
    let upper = ancestors;
    for (const id of lineB) {
      steps.push({ id, relation: relWord('child', gender(id)), to: upper, shared: false });
      upper = [id];
    }
    return steps;
  }
  if (result.chain) {
    result.chain.people.forEach((id, index) => {
      steps.push({
        id,
        relation: index === 0 ? null : (result.chain!.links[index - 1] ?? null),
        to: index === 0 ? [] : [result.chain!.people[index - 1]!],
        shared: false,
      });
    });
  }
  return steps;
}

/** "father", "stepbrother’s son": the name with a lower-case start, for the middle of a sentence. */
export function relationText(name: RelName): string {
  const text = renderRelName(name, t);
  return text.charAt(0).toLowerCase() + text.slice(1);
}
