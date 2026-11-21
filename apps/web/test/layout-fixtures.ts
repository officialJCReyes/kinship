// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Families for the layout tests (fictional, Hale-style names). `family` turns a short description into a layout
// input; the named families are the ones the crossing metric is pinned on (ADR 0025).
import type { Parentage, UnionStatus } from '@kinship/shared';
import type { LayoutInput } from '../src/tree/layout.js';

/** A tiny way to write a family down: people by id (with a birth year), relationships, and who hangs from what. */
export interface Spec {
  people: Array<[id: string, birth?: string]>;
  unions?: Array<[id: string, a: string, b: string, status?: UnionStatus, start?: string]>;
  /** child -> 'u1' (a relationship) or 'p:someone' (one parent alone). */
  kids?: Record<string, string>;
  focal?: string;
}

export function family(spec: Spec): LayoutInput {
  const parentage: Record<string, Parentage> = {};
  for (const [child, from] of Object.entries(spec.kids ?? {})) {
    parentage[child] = from.startsWith('p:')
      ? { unionId: null, parentId: from.slice(2), kind: 'birth', link: null }
      : { unionId: from, parentId: null, kind: 'birth', link: null };
  }
  return {
    focalId: spec.focal ?? spec.people[0]![0],
    people: spec.people.map(([id, birth]) => ({
      id,
      givenName: id,
      surname: 'Test',
      birth: birth ? { value: birth, precision: 'exactly' as const } : null,
    })),
    unions: (spec.unions ?? []).map(([id, a, b, status, start]) => ({
      id,
      partnerIds: (a < b ? [a, b] : [b, a]) as [string, string],
      status: status ?? 'married',
      start: start ? { value: start, precision: 'exactly' as const } : null,
    })),
    parentage,
  };
}

/** The Hale family, as in the API tests. */
export const HALE: Spec = {
  focal: 'marcus',
  people: [
    ['walter', '1931'],
    ['rosa', '1934'],
    ['daniel', '1958'],
    ['elena', '1960'],
    ['beatriz', '1965'],
    ['marcus', '1986'],
    ['sofia', '1989'],
    ['gabriel', '2007'],
    ['tomas', '1994'],
    ['priya', '1987'],
    ['leo', '2017'],
  ],
  unions: [
    ['wr', 'walter', 'rosa'],
    ['de', 'daniel', 'elena', 'divorced', '1984'],
    ['db', 'daniel', 'beatriz', 'married', '2006'],
    ['mp', 'marcus', 'priya'],
  ],
  kids: { daniel: 'wr', marcus: 'de', sofia: 'de', gabriel: 'db', tomas: 'p:beatriz', leo: 'mp' },
};

/** Four siblings, three married (with 2, 2 and 3 children), and one grandchild. No crossings today. */
export const SIBLINGS: Spec = {
  focal: 'nico',
  people: [
    ['walter', '1930'],
    ['rosa', '1932'],
    ['daniel', '1958'],
    ['elena', '1960'],
    ['mara', '1960'],
    ['ravi', '1958'],
    ['owen', '1962'],
    ['tess', '1963'],
    ['nico', '1965'],
    ['k1', '1985'],
    ['k2', '1988'],
    ['k3', '1986'],
    ['k4', '1990'],
    ['k5', '1992'],
    ['k6', '1994'],
    ['k7', '1996'],
    ['k1w', '1986'],
    ['gk', '2015'],
  ],
  unions: [
    ['wr', 'walter', 'rosa'],
    ['de', 'daniel', 'elena'],
    ['mr', 'mara', 'ravi'],
    ['ot', 'owen', 'tess'],
    ['k1m', 'k1', 'k1w'],
  ],
  kids: {
    daniel: 'wr',
    mara: 'wr',
    owen: 'wr',
    nico: 'wr',
    k1: 'de',
    k2: 'de',
    k3: 'mr',
    k4: 'mr',
    k5: 'ot',
    k6: 'ot',
    k7: 'ot',
    gk: 'k1m',
  },
};
export const REMARRIAGE: Spec = {
  focal: 'marcus',
  people: [
    ['walter', '1930'],
    ['rosa', '1932'],
    ['daniel', '1958'],
    ['mara', '1960'],
    ['elena', '1960'],
    ['priya', '1965'],
    ['tom', '1958'],
    ['marcus', '1986'],
    ['sofia', '1989'],
    ['carla', '1995'],
    ['ben', '2000'],
    ['zoe', '1996'],
    ['lena', '1989'],
    ['leo', '2015'],
    ['mk1', '1988'],
    ['mk2', '1990'],
    ['ravi', '1958'],
  ],
  unions: [
    ['wr', 'walter', 'rosa'],
    ['de', 'daniel', 'elena', 'divorced', '1985'],
    ['dp', 'daniel', 'priya', 'married', '1993'],
    ['et', 'elena', 'tom', 'married', '1995'],
    ['ml', 'marcus', 'lena'],
    ['mr', 'mara', 'ravi'],
  ],
  kids: {
    daniel: 'wr',
    mara: 'wr',
    marcus: 'de',
    sofia: 'de',
    carla: 'dp',
    ben: 'p:daniel',
    zoe: 'et',
    leo: 'ml',
    mk1: 'mr',
    mk2: 'mr',
  },
};
export const COUSINS: Spec = {
  focal: 'marcus',
  people: [
    ['walter', '1930'],
    ['rosa', '1932'],
    ['daniel', '1958'],
    ['elena', '1960'],
    ['mara', '1960'],
    ['ravi', '1958'],
    ['owen', '1962'],
    ['tess', '1963'],
    ['marcus', '1986'],
    ['sofia', '1989'],
    ['priya', '1987'],
    ['kit', '1990'],
    ['leo', '2015'],
    ['cyn', '1992'],
    ['don', '1988'],
    ['femi', '1988'],
  ],
  unions: [
    ['wr', 'walter', 'rosa'],
    ['de', 'daniel', 'elena'],
    ['mr', 'mara', 'ravi'],
    ['ot', 'owen', 'tess'],
    ['mp', 'marcus', 'priya'],
    ['sf', 'sofia', 'femi'],
  ],
  kids: {
    daniel: 'wr',
    mara: 'wr',
    owen: 'wr',
    marcus: 'de',
    sofia: 'de',
    priya: 'mr',
    kit: 'mr',
    cyn: 'ot',
    don: 'ot',
    leo: 'mp',
  },
};
export const WIDOW: Spec = {
  focal: 'nico',
  people: [
    ['walter', '1930'],
    ['rosa', '1932'],
    ['abe', '1955'],
    ['cal', '1958'],
    ['sue', '1957'],
    ['nico', '1962'],
    ['k1', '1980'],
    ['k2', '1990'],
    ['sib3', '1965'],
    ['w3', '1966'],
    ['k3', '1992'],
  ],
  unions: [
    ['wr', 'walter', 'rosa'],
    ['as', 'abe', 'sue', 'widowed', '1979'],
    ['cs', 'cal', 'sue', 'married', '1988'],
    ['s3', 'sib3', 'w3'],
  ],
  kids: { abe: 'wr', cal: 'wr', nico: 'wr', sib3: 'wr', k1: 'as', k2: 'cs', k3: 's3' },
};

export const THREE_UNIONS: Spec = {
  focal: 'marcus',
  people: [
    ['walter', '1930'],
    ['rosa', '1932'],
    ['daniel', '1958'],
    ['mara', '1960'],
    ['elena', '1960'],
    ['priya', '1965'],
    ['ruth', '1975'],
    ['marcus', '1986'],
    ['sofia', '1989'],
    ['carla', '1995'],
    ['ben', '2000'],
    ['ivy', '2007'],
    ['ravi', '1958'],
    ['mk1', '1988'],
  ],
  unions: [
    ['wr', 'walter', 'rosa'],
    ['de', 'daniel', 'elena', 'divorced', '1985'],
    ['dp', 'daniel', 'priya', 'divorced', '1993'],
    ['dr', 'daniel', 'ruth', 'married', '2005'],
    ['mr', 'mara', 'ravi'],
  ],
  kids: { daniel: 'wr', mara: 'wr', marcus: 'de', sofia: 'de', carla: 'dp', ben: 'p:daniel', ivy: 'dr', mk1: 'mr' },
};
export const GENERATIONS: Spec = {
  focal: 'marcus',
  people: [
    ['walter', '1930'],
    ['rosa', '1932'],
    ['daniel', '1958'],
    ['elena', '1960'],
    ['mara', '1960'],
    ['ravi', '1958'],
    ['owen', '1962'],
    ['zed', '1995'],
    ['marcus', '1986'],
    ['sofia', '1989'],
    ['lena', '1989'],
    ['priya', '1987'],
    ['kit', '1990'],
  ],
  unions: [
    ['wr', 'walter', 'rosa'],
    ['de', 'daniel', 'elena'],
    ['mr', 'mara', 'ravi'],
    ['ml', 'marcus', 'lena'],
    ['oz', 'owen', 'zed'],
  ],
  kids: { daniel: 'wr', mara: 'wr', owen: 'wr', marcus: 'de', sofia: 'de', priya: 'mr', kit: 'mr', zed: 'ml' },
};
export const TWO_COUSIN_MARRIAGES: Spec = {
  focal: 'marcus',
  people: [
    ['walter', '1930'],
    ['rosa', '1932'],
    ['daniel', '1958'],
    ['elena', '1960'],
    ['mara', '1960'],
    ['ravi', '1958'],
    ['marcus', '1986'],
    ['sofia', '1989'],
    ['priya', '1987'],
    ['kit', '1990'],
    ['leo', '2015'],
    ['mia', '2017'],
  ],
  unions: [
    ['wr', 'walter', 'rosa'],
    ['de', 'daniel', 'elena'],
    ['mr', 'mara', 'ravi'],
    ['mp', 'marcus', 'priya'],
    ['sk', 'sofia', 'kit'],
  ],
  kids: { daniel: 'wr', mara: 'wr', marcus: 'de', sofia: 'de', priya: 'mr', kit: 'mr', leo: 'mp', mia: 'sk' },
};

/**
 * Five children of one couple, each married to the only child of a different couple: five children lines that all
 * run along each other (the most lanes any family here needs). Not in NAMED_FAMILIES: the families it measures are
 * the ones in the plan, this one tests how far a gap between rows grows.
 */
export const FIVE_IN_LAW_FAMILIES: Spec = (() => {
  const people: Spec['people'] = [
    ['rt', '1900'],
    ['ru', '1902'],
  ];
  const unions: NonNullable<Spec['unions']> = [['ur', 'rt', 'ru']];
  const kids: Record<string, string> = {};
  for (let i = 1; i <= 5; i += 1) {
    people.push([`c${i}`, String(1930 + i)], [`s${i}`, String(1930 + i)], [`g${i}a`, '1900'], [`g${i}b`, '1901']);
    unions.push([`uc${i}`, `c${i}`, `s${i}`], [`ug${i}`, `g${i}a`, `g${i}b`]);
    kids[`c${i}`] = 'ur';
    kids[`s${i}`] = `ug${i}`;
  }
  return { focal: 'c1', people, unions, kids };
})();

/**
 * A person with an aunt, an uncle (with a partner and a cousin), a great-uncle (with a child), a sister (with a partner and a
 * daughter) and a half-brother: what the chart draws with "Show aunts, uncles and cousins" on (ADR 0027).
 */
export const AUNTS_ALL: Spec = {
  focal: 'focal',
  people: [
    ['ggp1', '1900'],
    ['ggp2', '1902'],
    ['gp', '1928'],
    ['gpp', '1930'],
    ['greatuncle', '1932'],
    ['greatcousin', '1960'],
    ['dad', '1955'],
    ['mum', '1957'],
    ['uncle', '1958'],
    ['unclep', '1959'],
    ['cousin', '1985'],
    ['aunt', '1962'],
    ['focal', '1985'],
    ['sis', '1988'],
    ['sisp', '1987'],
    ['niece', '2015'],
    ['half', '1975'],
    ['dadother', '1952'],
  ],
  unions: [
    ['gg', 'ggp1', 'ggp2'],
    ['gpu', 'gp', 'gpp'],
    ['dm', 'dad', 'mum'],
    ['do', 'dad', 'dadother', 'divorced'],
    ['uu', 'uncle', 'unclep'],
    ['su', 'sis', 'sisp'],
  ],
  kids: {
    gp: 'gg',
    greatuncle: 'gg',
    greatcousin: 'p:greatuncle',
    dad: 'gpu',
    uncle: 'gpu',
    aunt: 'gpu',
    focal: 'dm',
    sis: 'dm',
    half: 'do',
    cousin: 'uu',
    niece: 'su',
  },
};

/** The same family as `collateral=siblings` draws it: no aunt, uncle, cousin, great-uncle or anyone below them. */
export const AUNTS_SIBLINGS: Spec = (() => {
  const hidden = new Set(['greatuncle', 'greatcousin', 'uncle', 'unclep', 'cousin', 'aunt']);
  return {
    focal: AUNTS_ALL.focal!,
    people: AUNTS_ALL.people.filter(([id]) => !hidden.has(id)),
    unions: AUNTS_ALL.unions!.filter(([, a, b]) => !hidden.has(a) && !hidden.has(b)),
    kids: Object.fromEntries(Object.entries(AUNTS_ALL.kids!).filter(([child]) => !hidden.has(child))),
  };
})();

/** All the named families, for tests that go through every one. */
export const NAMED_FAMILIES: Record<string, Spec> = {
  HALE,
  SIBLINGS,
  REMARRIAGE,
  COUSINS,
  WIDOW,
  THREE_UNIONS,
  GENERATIONS,
  TWO_COUSIN_MARRIAGES,
  AUNTS_ALL,
  AUNTS_SIBLINGS,
};

/** Couples with three children each, three generations deep from eight root couples. */
export function bigFamily(target: number): LayoutInput {
  const people: Array<[string, string]> = [];
  const unions: NonNullable<Spec['unions']> = [];
  const kids: Record<string, string> = {};
  let n = 0;
  const person = (year: number): string => {
    n += 1;
    const id = `p${String(n).padStart(5, '0')}`;
    people.push([id, String(year)]);
    return id;
  };
  let couples: Array<[string, string]> = [];
  for (let i = 0; i < 8; i += 1) couples.push([person(1800), person(1801)]);
  let year = 1825;
  while (n < target) {
    const next: Array<[string, string]> = [];
    for (const [a, b] of couples) {
      if (n >= target) break;
      const u = `u${a}`;
      unions.push([u, a, b]);
      for (let k = 0; k < 3 && n < target; k += 1) {
        const child = person(year + k);
        kids[child] = u;
        next.push([child, person(year + k + 1)]);
      }
    }
    couples = next;
    year += 25;
  }
  return family({ people, unions, kids });
}

/** `count` separate families, each with one marriage between first cousins (11 people each). */
export function cousinMarriages(count: number, prefix = 'cm'): Spec {
  const people: Spec['people'] = [];
  const unions: NonNullable<Spec['unions']> = [];
  const kids: Record<string, string> = {};
  for (let i = 0; i < count; i += 1) {
    const id = (name: string) => `${prefix}${i}-${name}`;
    people.push(
      [id('g1'), '1900'],
      [id('g2'), '1902'],
      [id('a'), '1925'],
      [id('aw'), '1926'],
      [id('b'), '1928'],
      [id('bh'), '1927'],
      [id('x'), '1950'],
      [id('x2'), '1953'],
      [id('y'), '1952'],
      [id('y2'), '1955'],
      [id('z'), '1978'],
    );
    unions.push(
      [id('ug'), id('g1'), id('g2')],
      [id('ua'), id('a'), id('aw')],
      [id('ub'), id('b'), id('bh')],
      [id('uxy'), id('x'), id('y')],
    );
    Object.assign(kids, {
      [id('a')]: id('ug'),
      [id('b')]: id('ug'),
      [id('x')]: id('ua'),
      [id('x2')]: id('ua'),
      [id('y')]: id('ub'),
      [id('y2')]: id('ub'),
      [id('z')]: id('uxy'),
    });
  }
  return { people, unions, kids, focal: `${prefix}0-z` };
}

/** A big family with `count` cousin marriages added as separate families beside it. */
export function bigFamilyWithCousins(target: number, count: number): LayoutInput {
  const base = bigFamily(target);
  const extra = family(cousinMarriages(count));
  return {
    focalId: base.focalId,
    people: [...base.people, ...extra.people],
    unions: [...base.unions, ...extra.unions],
    parentage: { ...base.parentage, ...extra.parentage },
  };
}
