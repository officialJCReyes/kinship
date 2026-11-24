// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The finder's drawing (backlog 9): where the cards, lines and labels go for each kind of path, on the Hale fixture and on
// small families with unknown parents. Pure layout, no browser.
import { createRelGraph, findWithAdoptionHint, relWord, renderRelName } from '@kinship/shared';
import type { RelGraph, RelationshipResponse } from '@kinship/shared';
import { describe, expect, it } from 'vitest';
import { t } from '../src/i18n.js';
import { estimateWidth } from '../src/tree/cardText.js';
import { CARD_H, CARD_W, layoutPath } from '../src/relationship/diagramLayout.js';
import type { PathLayout } from '../src/relationship/diagramLayout.js';
import { HALE_PEOPLE, haleGraph } from './fixtures/hale.js';

const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** What the API answers for a pair, with every person it names (gender and placeholder are all the layout reads). */
function answer(graph: RelGraph, a: string, b: string): RelationshipResponse {
  const { facts, other } = findWithAdoptionHint(graph, a, b, 'adoptive');
  const ids = new Set<string>([
    a,
    b,
    ...(facts.blood ? [...facts.blood.ancestors, ...facts.blood.lineA, ...facts.blood.lineB] : []),
    ...(facts.chain?.people ?? []),
    ...(facts.chain?.hops ?? []).flatMap((hop) => (hop ? [...hop.ancestors, ...hop.lineA, ...hop.lineB] : [])),
  ]);
  const people: RelationshipResponse['people'] = {};
  for (const id of ids) {
    const facts = graph.person(id);
    people[id] = {
      id,
      givenName: id,
      surname: 'X',
      secondSurname: null,
      marriedSurname: null,
      namePrefix: null,
      nameSuffix: null,
      gender: facts.gender,
      birth: null,
      deceased: facts.deceased,
      death: null,
      isPlaceholder: facts.isPlaceholder,
      photoMediaId: null,
    } as RelationshipResponse['people'][string];
  }
  return { ...facts, lineage: 'adoptive', a, b, other, people, labels: [] };
}

function layout(result: RelationshipResponse): PathLayout {
  const drawn = layoutPath(result, {
    parentLabel: (upper) =>
      upper.length > 1
        ? t('finder.diagram.parents')
        : lower(renderRelName(relWord('parent', result.people[upper[0]!]?.gender ?? null), t)),
    linkLabel: (index) => {
      const name = index < 0 ? result.name : result.chain?.links[index];
      return name ? lower(renderRelName(name, t)) : '';
    },
    measure: estimateWidth,
    drawable: (id) => Boolean(result.people[id]) && !result.people[id]!.isPlaceholder,
    gender: (id) => result.people[id]?.gender ?? null,
  });
  expect(drawn).not.toBeNull();
  return drawn!;
}

const hale = (a: string, b: string) => layout(answer(haleGraph(), a, b));
const card = (l: PathLayout, id: string) => l.cards.find((c) => c.id === id)!;
const texts = (l: PathLayout) => l.labels.map((label) => label.text);

/** No two cards overlap, and everything is inside the drawing. */
function sound(l: PathLayout) {
  for (const c of l.cards) {
    expect(c.x - CARD_W / 2).toBeGreaterThanOrEqual(0);
    expect(c.x + CARD_W / 2).toBeLessThanOrEqual(l.width);
    expect(c.y + CARD_H).toBeLessThanOrEqual(l.height);
  }
  for (const [i, p] of l.cards.entries()) {
    for (const q of l.cards.slice(i + 1)) {
      const apart = Math.abs(p.x - q.x) >= CARD_W || Math.abs(p.y - q.y) >= CARD_H;
      expect(apart, `${p.id} and ${q.id} overlap`).toBe(true);
    }
  }
}

describe('a blood result between the two people (as before: the shared ancestor on top, a line down each side)', () => {
  it('half-brothers: the one shared father centred above both, "father" on each side, no link across', () => {
    const l = hale('marcus', 'gabriel');
    sound(l);
    expect(l.cards.map((c) => c.id).sort()).toEqual(['daniel', 'gabriel', 'marcus']);
    const [m, g, d] = [card(l, 'marcus'), card(l, 'gabriel'), card(l, 'daniel')];
    expect(m.y).toBe(g.y);
    expect(d.y).toBeLessThan(m.y);
    expect(d.x).toBe((m.x + g.x) / 2);
    expect(texts(l)).toEqual(['father', 'father']);
    expect(l.links).toHaveLength(0);
    expect(
      l.cards
        .filter((c) => c.highlight)
        .map((c) => c.id)
        .sort(),
    ).toEqual(['gabriel', 'marcus']);
  });

  it('first cousins: the grandparents as a couple above, a parent under each, "Parents" then "father" and "mother"', () => {
    const l = hale('marcus', 'naomi');
    sound(l);
    const [w, r] = [card(l, 'walter'), card(l, 'rosa')];
    expect(w.y).toBe(r.y);
    expect(card(l, 'daniel').x).toBe(card(l, 'marcus').x);
    expect(card(l, 'carla').x).toBe(card(l, 'naomi').x);
    expect(texts(l).sort()).toEqual(['Parents', 'Parents', 'father', 'mother'].sort());
  });

  it('a grandfather and his great-granddaughter: one column, straight down', () => {
    const l = hale('walter', 'mia');
    sound(l);
    expect(new Set(l.cards.map((c) => c.x)).size).toBe(1);
    expect(l.cards.map((c) => c.id)).toEqual(['walter', 'daniel', 'marcus', 'mia']);
  });
});

describe('a chain: marriages across, blood links through their shared ancestors (backlog 9)', () => {
  it('a wife’s brother: the wife and her brother side by side under their parents, a couple; "wife" and "brother" across', () => {
    const l = hale('marcus', 'arjun');
    sound(l);
    const [m, p, a, raj, meera] = ['marcus', 'priya', 'arjun', 'raj', 'meera'].map((id) => card(l, id));
    expect([m!.y, p!.y, a!.y]).toEqual([m!.y, m!.y, m!.y]);
    expect(m!.x < p!.x && p!.x < a!.x).toBe(true);
    // The parents above the two siblings, as a couple, one over each.
    expect(raj!.y).toBe(meera!.y);
    expect(raj!.y).toBeLessThan(p!.y);
    // Father on the left, mother on the right.
    expect([raj!.x, meera!.x]).toEqual([p!.x, a!.x]);
    expect(texts(l)).toEqual(expect.arrayContaining(['wife', 'brother', 'Parents']));
    expect(l.links).toHaveLength(2);
    expect(
      l.cards
        .filter((c) => c.highlight)
        .map((c) => c.id)
        .sort(),
    ).toEqual(['arjun', 'marcus']);
  });

  it('a father-in-law: the wife across, her father straight above her', () => {
    const l = hale('marcus', 'raj');
    sound(l);
    expect(card(l, 'raj').x).toBe(card(l, 'priya').x);
    expect(card(l, 'raj').y).toBeLessThan(card(l, 'priya').y);
    expect(texts(l)).toEqual(expect.arrayContaining(['wife', 'father']));
    expect(l.links).toHaveLength(1);
  });

  it('a stepbrother: up to the father, across to his wife, down to her son', () => {
    const l = hale('marcus', 'tomas');
    sound(l);
    const [m, d, b, to] = ['marcus', 'daniel', 'beatriz', 'tomas'].map((id) => card(l, id));
    expect(d!.x).toBe(m!.x);
    expect(d!.y).toBeLessThan(m!.y);
    expect(b!.y).toBe(d!.y);
    expect(to!.x).toBe(b!.x);
    expect(to!.y).toBe(m!.y);
    expect(texts(l)).toEqual(expect.arrayContaining(['father', 'wife', 'mother']));
  });

  it('an aunt’s ex-husband: the grandparents above, the aunt a generation up, no link across generations, then "ex-husband"', () => {
    const l = hale('marcus', 'anthony');
    sound(l);
    const [m, d, c, an, w] = ['marcus', 'daniel', 'carla', 'anthony', 'walter'].map((id) => card(l, id));
    expect(d!.x).toBe(m!.x);
    expect(c!.y).toBe(d!.y);
    expect(an!.y).toBe(c!.y);
    expect(w!.y).toBeLessThan(c!.y);
    // One link across (the former partner); the aunt is not on Marcus's row, so no "aunt" link is drawn across.
    expect(l.links).toHaveLength(1);
    expect(texts(l)).toContain('ex-husband');
    expect(texts(l)).not.toContain('aunt');
  });

  it('a brother-in-law the other way: the sister and me under our parents, then her husband across', () => {
    const l = hale('sofia', 'priya');
    sound(l);
    expect(card(l, 'daniel').y).toBe(card(l, 'elena').y);
    expect(card(l, 'priya').y).toBe(card(l, 'sofia').y);
    expect(texts(l)).toEqual(expect.arrayContaining(['brother', 'wife', 'Parents']));
  });
});

describe('unknown parents are never drawn', () => {
  /** Two sisters x and y; x is married to h. Their parents: p (a real father) and q, or two placeholders. */
  function family(knownFather: boolean) {
    const ids = ['x', 'y', 'h', 'p', 'q'];
    return createRelGraph({
      people: ids.map((id) => ({
        id,
        gender: id === 'h' || id === 'p' ? 'male' : 'female',
        deceased: false,
        isPlaceholder: id === 'q' || (!knownFather && id === 'p'),
      })),
      unions: [
        { a: 'x', b: 'h', status: 'married' },
        { a: 'p', b: 'q', status: 'unknown' },
      ],
      parents: { x: { birth: ['p', 'q'] }, y: { birth: ['p', 'q'] } },
    });
  }

  it('an unknown second parent: only the known father is drawn, between the sisters', () => {
    const l = layout(answer(family(true), 'h', 'y'));
    sound(l);
    expect(l.cards.map((c) => c.id).sort()).toEqual(['h', 'p', 'x', 'y']);
    expect(card(l, 'p').x).toBe((card(l, 'x').x + card(l, 'y').x) / 2);
  });

  it('both parents unknown: no ancestor, the sisters joined by a labelled link', () => {
    const l = layout(answer(family(false), 'h', 'y'));
    expect(l.cards.map((c) => c.id).sort()).toEqual(['h', 'x', 'y']);
    expect(texts(l)).toEqual(['wife', 'sister']);
    expect(l.lines).toHaveLength(0);
  });

  it('in a blood result too: sisters through unknown parents are a labelled link, not two dashed cards', () => {
    const l = layout(answer(family(false), 'x', 'y'));
    expect(l.cards.map((c) => c.id).sort()).toEqual(['x', 'y']);
    expect(texts(l)).toEqual(['sister']);
  });
});

describe('every person drawn is one the answer names', () => {
  it('for every pair in the Hale family', () => {
    const graph = haleGraph();
    for (const a of HALE_PEOPLE) {
      for (const b of HALE_PEOPLE) {
        if (a.key === b.key) continue;
        const result = answer(graph, a.key, b.key);
        if (result.kind === 'none') continue;
        const l = layout(result);
        sound(l);
        for (const c of l.cards) expect(result.people[c.id], `${a.key} to ${b.key}: ${c.id}`).toBeDefined();
      }
    }
  });
});
