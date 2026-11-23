// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The fictional Hale sample family: 31 people, as in the design mockup. Used by the relationship finder's tests.
// (apps/web/test/fixtures/hale.ts is a copy for the web tests; keep the two the same.)
import { createRelGraph } from '@kinship/shared';
import type { Gender, RelGraph, UnionStatus } from '@kinship/shared';

export interface HalePerson {
  key: string;
  givenName: string;
  surname: string;
  gender: Gender;
  birth: string;
  death?: string;
  namePrefix?: string;
  nameSuffix?: string;
  nickname?: string;
  marriedSurname?: string;
}

export const HALE_PEOPLE: readonly HalePerson[] = [
  { key: 'joseph', givenName: 'Joseph', surname: 'Hale', gender: 'male', birth: '1902', death: '1980' },
  {
    key: 'anna',
    givenName: 'Anna',
    surname: 'Walsh',
    marriedSurname: 'Hale',
    gender: 'female',
    birth: '1905',
    death: '1990',
  },
  {
    key: 'walter',
    givenName: 'Walter',
    surname: 'Hale',
    nameSuffix: 'Sr.',
    gender: 'male',
    birth: '1931',
    death: '2009',
  },
  { key: 'rosa', givenName: 'Rosa', surname: 'Mendez', marriedSurname: 'Hale', gender: 'female', birth: '1934' },
  {
    key: 'samuel',
    givenName: 'Samuel',
    surname: 'Hale',
    namePrefix: 'Dr.',
    gender: 'male',
    birth: '1936',
    death: '2015',
  },
  { key: 'lucia', givenName: 'Lucia', surname: 'Ortiz', gender: 'female', birth: '1932', death: '2010' },
  { key: 'ines', givenName: 'Ines', surname: 'Hale', gender: 'female', birth: '1952' },
  { key: 'daniel', givenName: 'Daniel', surname: 'Hale', nickname: 'Danny', gender: 'male', birth: '1958' },
  { key: 'elena', givenName: 'Elena', surname: 'Ruiz', marriedSurname: 'Hale', gender: 'female', birth: '1960' },
  { key: 'carla', givenName: 'Carla', surname: 'Hale', gender: 'female', birth: '1962' },
  { key: 'paul', givenName: 'Paul', surname: 'Hale', gender: 'male', birth: '1960' },
  { key: 'beatriz', givenName: 'Beatriz', surname: 'de Navarro', gender: 'female', birth: '1963' },
  { key: 'raymond', givenName: 'Raymond', surname: 'Cole', gender: 'male', birth: '1957' },
  { key: 'anthony', givenName: 'Anthony', surname: 'Brooks', gender: 'male', birth: '1960' },
  { key: 'lucas', givenName: 'Lucas', surname: 'Moreno', gender: 'male', birth: '1978' },
  { key: 'marcus', givenName: 'Marcus', surname: 'Hale', gender: 'male', birth: '1986' },
  { key: 'sofia', givenName: 'Sofia', surname: 'Hale', gender: 'female', birth: '1989' },
  { key: 'naomi', givenName: 'Naomi', surname: 'Brooks', gender: 'female', birth: '1990' },
  { key: 'elise', givenName: 'Elise', surname: 'Hale', gender: 'female', birth: '1988' },
  { key: 'tomas', givenName: 'Tomas', surname: 'Navarro', gender: 'male', birth: '1994' },
  { key: 'gabriel', givenName: 'Gabriel', surname: 'Hale', gender: 'male', birth: '2007' },
  { key: 'hari', givenName: 'Hari', surname: 'Nair', gender: 'male', birth: '1930', death: '2012' },
  { key: 'lakshmi', givenName: 'Lakshmi', surname: 'Nair', gender: 'female', birth: '1934', death: '2019' },
  { key: 'raj', givenName: 'Raj', surname: 'Nair', gender: 'male', birth: '1958' },
  { key: 'meera', givenName: 'Meera', surname: 'Iyer', marriedSurname: 'Nair', gender: 'female', birth: '1961' },
  { key: 'priya', givenName: 'Priya', surname: 'Nair', gender: 'female', birth: '1988' },
  { key: 'arjun', givenName: 'Arjun', surname: 'Nair', gender: 'male', birth: '1991' },
  { key: 'leo', givenName: 'Leo', surname: 'Hale', gender: 'male', birth: '2017' },
  { key: 'mia', givenName: 'Mia', surname: 'Hale', gender: 'female', birth: '2020' },
  { key: 'frank', givenName: 'Frank', surname: 'Doyle', gender: 'male', birth: '1909', death: '1971' },
  { key: 'ruth', givenName: 'Ruth', surname: 'Doyle', gender: 'female', birth: '1913', death: '1988' },
];

export const HALE_UNIONS: ReadonlyArray<{ a: string; b: string; status: UnionStatus }> = [
  { a: 'walter', b: 'rosa', status: 'widowed' },
  { a: 'daniel', b: 'elena', status: 'divorced' },
  { a: 'daniel', b: 'beatriz', status: 'married' },
  { a: 'raymond', b: 'elena', status: 'married' },
  { a: 'carla', b: 'anthony', status: 'separated' },
  { a: 'marcus', b: 'priya', status: 'married' },
  { a: 'walter', b: 'lucia', status: 'divorced' },
  { a: 'joseph', b: 'anna', status: 'widowed' },
  { a: 'hari', b: 'lakshmi', status: 'widowed' },
  { a: 'raj', b: 'meera', status: 'married' },
  { a: 'frank', b: 'ruth', status: 'unknown' },
];

/** Each child's parents. Samuel was adopted by Joseph and Anna in 1938; his birth parents are Frank and Ruth Doyle. */
export const HALE_PARENTS: Readonly<Record<string, { birth?: readonly string[]; adoptive?: readonly string[] }>> = {
  walter: { birth: ['joseph', 'anna'] },
  samuel: { birth: ['frank', 'ruth'], adoptive: ['joseph', 'anna'] },
  ines: { birth: ['walter', 'lucia'] },
  daniel: { birth: ['walter', 'rosa'] },
  carla: { birth: ['walter', 'rosa'] },
  paul: { birth: ['samuel'] },
  lucas: { birth: ['ines'] },
  marcus: { birth: ['daniel', 'elena'] },
  sofia: { birth: ['daniel', 'elena'] },
  naomi: { birth: ['carla', 'anthony'] },
  elise: { birth: ['paul'] },
  tomas: { birth: ['beatriz'] },
  gabriel: { birth: ['daniel', 'beatriz'] },
  raj: { birth: ['hari', 'lakshmi'] },
  priya: { birth: ['raj', 'meera'] },
  arjun: { birth: ['raj', 'meera'] },
  leo: { birth: ['marcus', 'priya'] },
  mia: { birth: ['marcus', 'priya'] },
};

/** The Hale family as the finder's graph, with each person's key as their id. */
export function haleGraph(): RelGraph {
  return createRelGraph({
    people: HALE_PEOPLE.map((p) => ({
      id: p.key,
      gender: p.gender,
      deceased: p.death !== undefined,
      isPlaceholder: false,
    })),
    unions: HALE_UNIONS,
    parents: HALE_PARENTS,
  });
}
