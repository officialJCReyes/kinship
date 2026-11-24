// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The path between two people as a list of steps, in the order a person reads it: from the first person up to the
// shared ancestor(s) and down to the second person (or along the chain of an in-law or step result). The visible
// text list is built from this, so the diagram and the words always agree.
import { relWord, renderRelName } from '@kinship/shared';
import type { Gender, HopDetail, RelName, RelationshipResponse } from '@kinship/shared';
import { t } from '../i18n.js';

export interface PathStep {
  id: string;
  /** What this person is to `to` ("father"), or null for the first person. */
  relation: RelName | null;
  /** The person (or the two people, a couple) the relation is to. */
  to: string[];
  /** This person is a closest shared ancestor. */
  shared: boolean;
  /**
   * In a chain, a blood link goes through other people (the shared ancestors, and anyone between): they are listed under the
   * step, in the order the drawing shows them, so the words say what the drawing does (backlog 9).
   */
  via?: ViaStep[];
}

/** One line under a chain step: one person, or a couple of shared ancestors, and what they are to whom. */
export interface ViaStep {
  ids: string[];
  /** What they are to `to`; `parents` for a couple. */
  relation: RelName | 'parents';
  to: string[];
  shared: boolean;
}

/** A couple in a stable order, as MyHeritage shows one: the father (or a man) first, then the mother; else as given. */
export function coupleOrder(ids: readonly string[], gender: (id: string) => Gender | null): string[] {
  const rank = (id: string) => (gender(id) === 'male' ? 0 : gender(id) === 'female' ? 1 : 2);
  return [...ids].sort((x, y) => rank(x) - rank(y));
}

/** The people between two people on a chain, through their shared ancestors, top-down after the climb up. */
export function viaSteps(hop: HopDetail, gender: (id: string) => Gender | null): ViaStep[] {
  const { dA, dB, ancestors, lineA, lineB } = hop;
  const steps: ViaStep[] = [];
  // Up from the first person: everyone above them on their line, each the parent of the one below.
  const up = lineA.slice(0, -1);
  for (let k = up.length - 1; k >= 0; k -= 1) {
    steps.push({ ids: [up[k]!], relation: relWord('parent', gender(up[k]!)), to: [lineA[k + 1]!], shared: false });
  }
  if (dA > 0 && dB > 0) {
    steps.push({
      ids: coupleOrder(ancestors, gender),
      relation: ancestors.length > 1 ? 'parents' : relWord('parent', gender(ancestors[0]!)),
      to: [lineA[0]!, lineB[0]!],
      shared: true,
    });
  }
  // Down to the second person: everyone above them on their line, each the child of the one above.
  let upper = ancestors;
  for (const id of lineB.slice(0, -1)) {
    steps.push({ ids: [id], relation: relWord('child', gender(id)), to: upper, shared: false });
    upper = [id];
  }
  return steps;
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
      const hop = index === 0 ? null : (result.chain!.hops?.[index - 1] ?? null);
      const via = hop ? viaSteps(hop, gender) : [];
      steps.push({
        id,
        relation: index === 0 ? null : (result.chain!.links[index - 1] ?? null),
        to: index === 0 ? [] : [result.chain!.people[index - 1]!],
        shared: false,
        ...(via.length > 0 ? { via } : {}),
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
