// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The relationship finder's pure part (ADR 0028): the naming table, every pair the design mockup shows, the
// edge cases, and the properties that must hold for any family.
import {
  createRelGraph,
  createTranslator,
  en,
  findRelationship,
  findWithAdoptionHint,
  renderRelName,
} from '@kinship/shared';
import type { LineageView, RelGraphInput, RelationshipFacts } from '@kinship/shared';
import { describe, expect, it } from 'vitest';
import { HALE_PEOPLE, haleGraph } from './fixtures/hale.js';

const t = createTranslator(en);
const hale = haleGraph();
const name = (facts: RelationshipFacts): string =>
  facts.name ? renderRelName(facts.name, t) : 'No relationship found';
/** What the second person is to the first, as the finder words it. */
const say = (a: string, b: string, view: LineageView = 'adoptive'): string => name(findRelationship(hale, a, b, view));

describe('the Hale family fixture', () => {
  it('has the 31 people of the sample family', () => {
    expect(HALE_PEOPLE).toHaveLength(31);
  });
});

describe('every pair the design mockup shows (from Marcus unless stated)', () => {
  it.each([
    ['marcus', 'naomi', 'First cousin'],
    ['leo', 'naomi', 'First cousin once removed'],
    ['marcus', 'lucas', 'Half first cousin'],
    ['leo', 'lucas', 'Half first cousin once removed'],
    ['marcus', 'elise', 'Second cousin'],
    ['leo', 'elise', 'Second cousin once removed'],
    ['marcus', 'paul', 'First cousin once removed'],
    ['marcus', 'samuel', 'Great-uncle'],
    ['marcus', 'ines', 'Half-aunt'],
    ['marcus', 'gabriel', 'Half-brother'],
    ['marcus', 'tomas', 'Stepbrother'],
    ['marcus', 'raymond', 'Stepfather'],
    ['marcus', 'raj', 'Father-in-law'],
    ['priya', 'sofia', 'Sister-in-law'],
    ['walter', 'mia', 'Great-granddaughter'],
    ['leo', 'beatriz', 'Step-grandmother'],
    ['daniel', 'lucia', 'Father’s ex-wife'],
    ['tomas', 'leo', 'Stepbrother’s son'],
  ])('%s to %s reads %s', (a, b, expected) => {
    expect(say(a, b)).toBe(expected);
  });
});

describe('more names, from either side', () => {
  it.each([
    ['naomi', 'marcus', 'First cousin'],
    ['naomi', 'leo', 'First cousin once removed'],
    ['lucas', 'marcus', 'Half first cousin'],
    ['samuel', 'marcus', 'Grandnephew'],
    ['ines', 'marcus', 'Half-nephew'],
    ['gabriel', 'marcus', 'Half-brother'],
    ['tomas', 'marcus', 'Stepbrother'],
    ['raymond', 'marcus', 'Stepson'],
    ['raj', 'marcus', 'Son-in-law'],
    ['sofia', 'priya', 'Sister-in-law'],
    ['mia', 'walter', 'Great-grandfather'],
    ['beatriz', 'leo', 'Step-grandson'],
    ['marcus', 'daniel', 'Father'],
    ['marcus', 'elena', 'Mother'],
    ['daniel', 'marcus', 'Son'],
    ['marcus', 'sofia', 'Sister'],
    ['marcus', 'walter', 'Grandfather'],
    ['marcus', 'joseph', 'Great-grandfather'],
    ['marcus', 'arjun', 'Brother-in-law'],
    ['marcus', 'priya', 'Wife'],
    ['priya', 'marcus', 'Husband'],
    ['marcus', 'beatriz', 'Stepmother'],
    ['marcus', 'lucia', 'Grandfather’s ex-wife'],
    ['marcus', 'anthony', 'Aunt’s separated husband'],
    ['marcus', 'carla', 'Aunt'],
    ['marcus', 'meera', 'Mother-in-law'],
    ['marcus', 'frank', 'No relationship found'],
  ])('%s to %s reads %s', (a, b, expected) => {
    expect(say(a, b)).toBe(expected);
  });

  it('says Elena is Leo’s grandmother after her divorce from Daniel: descendants find her through blood', () => {
    expect(say('leo', 'elena')).toBe('Grandmother');
    expect(say('elena', 'leo')).toBe('Grandson');
  });

  it('names the direct pair with the partner wording, whatever the status', () => {
    expect(say('daniel', 'elena')).toBe('Ex-wife');
    expect(say('elena', 'daniel')).toBe('Ex-husband');
    expect(say('rosa', 'walter')).toBe('Late husband');
    expect(say('walter', 'rosa')).toBe('Wife (widow)');
    expect(say('carla', 'anthony')).toBe('Husband (separated)');
  });
});

describe('who counts as an in-law or a step relative', () => {
  it('uses only Married and Widowed relationships (Separated gives no in-law or step name)', () => {
    // Anthony is separated from Carla, Marcus’s aunt: not an uncle, and not an in-law
    expect(say('marcus', 'anthony')).toBe('Aunt’s separated husband');
    // Elena divorced Daniel and is now married to Raymond: Raymond is Marcus’s stepfather through the current marriage
    expect(say('marcus', 'raymond')).toBe('Stepfather');
  });

  it('describes a former partner of a blood relative plainly, by how the relationship ended', () => {
    expect(say('daniel', 'lucia')).toBe('Father’s ex-wife');
    expect(say('marcus', 'anthony')).toContain('separated');
  });

  it('never calls a parent through the same relationship a step-parent', () => {
    expect(say('marcus', 'elena')).toBe('Mother');
    expect(say('marcus', 'daniel')).toBe('Father');
  });

  it('stops after one marriage hop: an in-law of an in-law has no name', () => {
    // Priya’s mother Meera is Marcus’s mother-in-law; Meera’s own husband Raj is the father-in-law. Hari (Raj’s father)
    // is Marcus’s wife’s grandfather, a named relative. But Raymond’s relatives are two hops away:
    expect(say('marcus', 'raymond')).toBe('Stepfather');
    // Beatriz’s son Tomas and Priya: Tomas is Marcus’s stepbrother, so Priya is Tomas’s stepbrother’s wife: two hops
    expect(say('tomas', 'priya')).toBe('No relationship found');
    expect(findRelationship(hale, 'tomas', 'priya', 'adoptive').chain).toBeNull();
  });
});

describe('half and full (a missing parent is unknown, not proof of half)', () => {
  it('calls children of one couple full, and of a shared parent with another known parent half', () => {
    expect(say('marcus', 'sofia')).toBe('Sister');
    expect(say('marcus', 'gabriel')).toBe('Half-brother');
    // Gabriel and Tomas share Beatriz; Gabriel also has a known father, so they are half-brothers
    expect(say('gabriel', 'tomas')).toBe('Half-brother');
  });

  it('calls two children of one single recorded parent full, as the profile does', () => {
    const graph = createRelGraph({
      people: [
        { id: 'p', gender: 'female', deceased: false, isPlaceholder: false },
        { id: 'x', gender: 'male', deceased: false, isPlaceholder: false },
        { id: 'y', gender: 'male', deceased: false, isPlaceholder: false },
      ],
      unions: [],
      parents: { x: { birth: ['p'] }, y: { birth: ['p'] } },
    });
    expect(name(findRelationship(graph, 'x', 'y', 'adoptive'))).toBe('Brother');
  });

  it('calls siblings through unknown parents siblings (the placeholders are the hop)', () => {
    const graph = createRelGraph({
      people: [
        { id: 'uf', gender: 'male', deceased: false, isPlaceholder: true },
        { id: 'um', gender: 'female', deceased: false, isPlaceholder: true },
        { id: 'x', gender: 'male', deceased: false, isPlaceholder: false },
        { id: 'y', gender: 'female', deceased: false, isPlaceholder: false },
      ],
      unions: [{ a: 'uf', b: 'um', status: 'unknown' }],
      parents: { x: { birth: ['uf', 'um'] }, y: { birth: ['uf', 'um'] } },
    });
    const facts = findRelationship(graph, 'x', 'y', 'adoptive');
    expect(name(facts)).toBe('Sister');
    expect(facts.blood?.ancestors).toEqual(['uf', 'um']);
  });

  it('does not count an unknown second parent as a known one', () => {
    const graph = createRelGraph({
      people: [
        { id: 'f', gender: 'male', deceased: false, isPlaceholder: false },
        { id: 'um', gender: 'female', deceased: false, isPlaceholder: true },
        { id: 'x', gender: 'male', deceased: false, isPlaceholder: false },
        { id: 'y', gender: 'female', deceased: false, isPlaceholder: false },
      ],
      unions: [{ a: 'f', b: 'um', status: 'unknown' }],
      parents: { x: { birth: ['f', 'um'] }, y: { birth: ['f'] } },
    });
    expect(name(findRelationship(graph, 'x', 'y', 'adoptive'))).toBe('Sister');
  });
});

describe('adoption: Samuel was adopted by Joseph and Anna; his birth parents are Frank and Ruth', () => {
  it('follows the adoptive family in the adoptive view', () => {
    expect(say('marcus', 'samuel', 'adoptive')).toBe('Great-uncle');
    expect(say('walter', 'samuel', 'adoptive')).toBe('Adoptive brother');
    expect(say('samuel', 'joseph', 'adoptive')).toBe('Adoptive father');
    expect(say('joseph', 'samuel', 'adoptive')).toBe('Adopted son');
    expect(say('samuel', 'paul', 'adoptive')).toBe('Son');
  });

  it('follows the birth family in the birth view, and the adoptive relatives drop out', () => {
    expect(say('marcus', 'samuel', 'birth')).toBe('No relationship found');
    expect(say('samuel', 'frank', 'birth')).toBe('Birth father');
    expect(say('frank', 'samuel', 'birth')).toBe('Birth son');
    expect(say('samuel', 'joseph', 'birth')).toBe('No relationship found');
  });

  it('says a relationship exists in the other view when there is none in this one', () => {
    const birth = findWithAdoptionHint(hale, 'marcus', 'samuel', 'birth');
    expect(birth.facts.kind).toBe('none');
    expect(birth.other).toBe('adoption');
    const adoptive = findWithAdoptionHint(hale, 'marcus', 'samuel', 'adoptive');
    expect(adoptive.other).toBeNull();
    // Two people unrelated in both views get no hint
    expect(findWithAdoptionHint(hale, 'marcus', 'frank', 'adoptive').other).toBeNull();
    expect(findWithAdoptionHint(hale, 'marcus', 'frank', 'birth').other).toBeNull();
  });

  it('uses plain names beyond brother, sister, parent and child', () => {
    expect(say('marcus', 'paul', 'adoptive')).toBe('First cousin once removed');
  });
});

describe('edge cases', () => {
  it('says "Same person" for one person', () => {
    const facts = findRelationship(hale, 'marcus', 'marcus', 'adoptive');
    expect(facts.kind).toBe('self');
    expect(name(facts)).toBe('Same person');
  });

  it('gives no relationship to someone with no relatives', () => {
    const lone = createRelGraph({
      people: [
        { id: 'a', gender: 'male', deceased: false, isPlaceholder: false },
        { id: 'b', gender: 'female', deceased: false, isPlaceholder: false },
      ],
      unions: [],
      parents: {},
    });
    const facts = findRelationship(lone, 'a', 'b', 'adoptive');
    expect(facts.kind).toBe('none');
    expect(facts.tooDistant).toBe(false);
  });

  it('returns the shared ancestors and each line down to them', () => {
    const facts = findRelationship(hale, 'marcus', 'naomi', 'adoptive');
    expect(facts.kind).toBe('blood');
    expect(facts.blood).toMatchObject({ dA: 2, dB: 2, half: false, ancestors: ['rosa', 'walter'] });
    expect(facts.blood?.lineA).toEqual(['daniel', 'marcus']);
    expect(facts.blood?.lineB).toEqual(['carla', 'naomi']);
  });

  it('shows a person related two ways by the closest, with the other as "also"', () => {
    // Two first cousins who also married each other
    const graph = createRelGraph({
      people: ['g1', 'g2', 'p1', 'p2', 'c1', 'c2'].map((id) => ({
        id,
        gender: id === 'c1' ? ('male' as const) : ('female' as const),
        deceased: false,
        isPlaceholder: false,
      })),
      unions: [
        { a: 'g1', b: 'g2', status: 'married' },
        { a: 'c1', b: 'c2', status: 'married' },
      ],
      parents: {
        p1: { birth: ['g1', 'g2'] },
        p2: { birth: ['g1', 'g2'] },
        c1: { birth: ['p1'] },
        c2: { birth: ['p2'] },
      },
    });
    const facts = findRelationship(graph, 'c1', 'c2', 'adoptive');
    expect(name(facts)).toBe('First cousin');
    expect(facts.also.map((n) => renderRelName(n, t))).toEqual(['Wife']);
  });

  it('reports "too distant" when the walk reaches its limit before anyone is shared', () => {
    const people = [] as RelGraphInput['people'][number][];
    const parents: Record<string, { birth: string[] }> = {};
    for (let i = 0; i <= 33; i++) {
      people.push({ id: `a${i}`, gender: 'male', deceased: false, isPlaceholder: false });
      people.push({ id: `b${i}`, gender: 'male', deceased: false, isPlaceholder: false });
      if (i > 0) {
        parents[`a${i - 1}`] = { birth: [`a${i}`] };
        parents[`b${i - 1}`] = { birth: [`b${i}`] };
      }
    }
    // The two lines join only at the very top, 34 generations up
    parents['a33'] = { birth: ['top'] };
    parents['b33'] = { birth: ['top'] };
    people.push({ id: 'top', gender: 'male', deceased: false, isPlaceholder: false });
    const facts = findRelationship(createRelGraph({ people, unions: [], parents }), 'a0', 'b0', 'adoptive');
    expect(facts.kind).toBe('none');
    expect(facts.tooDistant).toBe(true);
  });
});

describe('properties, over every pair of the Hale family and both views', () => {
  const ids = HALE_PEOPLE.map((p) => p.key);
  const pairs = ids.flatMap((a) => ids.map((b) => [a, b] as const));

  it('is symmetric: A to B and B to A agree on whether and how they are related', () => {
    for (const view of ['adoptive', 'birth'] as const) {
      for (const [a, b] of pairs) {
        const forward = findRelationship(hale, a, b, view);
        const back = findRelationship(hale, b, a, view);
        // A former partner's relatives are not named from the other side (ADR 0028), so that kind may differ
        if (forward.kind !== 'former' && back.kind !== 'former') {
          expect(forward.kind === 'none', `${a}/${b}/${view}`).toBe(back.kind === 'none');
        }
        if (forward.kind === 'blood') {
          expect(back.kind).toBe('blood');
          expect(back.blood!.dA, `${a}/${b}`).toBe(forward.blood!.dB);
          expect(back.blood!.dB, `${a}/${b}`).toBe(forward.blood!.dA);
          expect(back.blood!.half, `${a}/${b}`).toBe(forward.blood!.half);
          expect(back.blood!.ancestors).toEqual(forward.blood!.ancestors);
        }
        // Step and in-law relatives are mutual too: either both are or neither is
        if (forward.chain && forward.kind !== 'partner' && forward.kind !== 'former') {
          expect(back.chain, `${a}/${b}/${view}`).not.toBeNull();
        }
      }
    }
  });

  it('never has a negative count, and a shared ancestor is never below either person', () => {
    for (const [a, b] of pairs) {
      const blood = findRelationship(hale, a, b, 'adoptive').blood;
      if (!blood) continue;
      expect(blood.dA).toBeGreaterThanOrEqual(0);
      expect(blood.dB).toBeGreaterThanOrEqual(0);
      expect(blood.dA + blood.dB).toBeGreaterThan(0);
      expect(blood.lineA).toHaveLength(blood.dA);
      expect(blood.lineB).toHaveLength(blood.dB);
    }
  });

  it('is "self" only for the same person', () => {
    for (const [a, b] of pairs) {
      const kind = findRelationship(hale, a, b, 'adoptive').kind;
      expect(kind === 'self', `${a}/${b}`).toBe(a === b);
    }
  });

  it('names the removed cousin the same from either side', () => {
    expect(say('leo', 'naomi')).toBe(say('naomi', 'leo'));
    expect(say('leo', 'elise')).toBe(say('elise', 'leo'));
  });
});
