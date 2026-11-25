// SPDX-License-Identifier: AGPL-3.0-or-later
// The FamilySearch research link (ADR 0040). Made-up people only.
import type { DatePrecision } from '@kinship/shared';
import { describe, expect, it } from 'vitest';
import { researchAllowed, researchLink, researchUrl } from '../src/lib/research.js';

const d = (value: string, precision: DatePrecision = 'exactly') => ({ value, precision });
type Facts = Parameters<typeof researchUrl>[0];
const person = (over: Partial<Facts> = {}): Facts => ({
  givenName: 'Eleanor',
  surname: 'Whitcombe',
  secondSurname: null,
  birth: d('1901-03-14'),
  death: d('1968-10-02'),
  deceased: true,
  isPlaceholder: false,
  ...over,
});
const now = new Date(2026, 10, 25, 12);
const BASE = 'https://www.familysearch.org/en/search/record/results?count=20';

describe('the research address', () => {
  it('is exactly FamilySearch’s record search, in its parameter order, with no .to', () => {
    expect(researchUrl(person())).toBe(
      `${BASE}&q.birthLikeDate.from=1901&q.deathLikeDate.from=1968&q.givenName=Eleanor&q.surname=Whitcombe`,
    );
    expect(researchUrl(person())).not.toMatch(/\.to=/);
  });

  it('encodes accents and spaces (a space is %20)', () => {
    expect(researchUrl(person({ givenName: 'José María', surname: 'Núñez', birth: d('1922'), death: d('1990') }))).toBe(
      `${BASE}&q.birthLikeDate.from=1922&q.deathLikeDate.from=1990&q.givenName=Jos%C3%A9%20Mar%C3%ADa&q.surname=N%C3%BA%C3%B1ez`,
    );
  });

  it('joins two surnames with a space, and never uses the married surname or the nickname', () => {
    const two = { surname: 'Núñez', secondSurname: 'Peña' } as const;
    expect(researchUrl(person(two))).toMatch(/&q\.surname=N%C3%BA%C3%B1ez%20Pe%C3%B1a$/);
    const married = { ...person(), marriedSurname: 'Ashdown', nickname: 'Nell' } as Facts;
    expect(researchUrl(married)).toMatch(/q\.givenName=Eleanor&q\.surname=Whitcombe$/);
    expect(researchUrl(married)).not.toMatch(/Ashdown|Nell/);
  });

  it('leaves out a year that is not known', () => {
    expect(researchUrl(person({ death: null }))).toBe(
      `${BASE}&q.birthLikeDate.from=1901&q.givenName=Eleanor&q.surname=Whitcombe`,
    );
    expect(researchUrl(person({ birth: null }))).toBe(
      `${BASE}&q.deathLikeDate.from=1968&q.givenName=Eleanor&q.surname=Whitcombe`,
    );
    expect(researchUrl(person({ birth: null, death: null }))).toBe(`${BASE}&q.givenName=Eleanor&q.surname=Whitcombe`);
    // The year of an "about" or partial date is still the year.
    expect(researchUrl(person({ birth: d('1901-03', 'about'), death: null }))).toMatch(/birthLikeDate\.from=1901&/);
  });

  it('has no death year for a living person', () => {
    expect(researchUrl(person({ deceased: false, death: d('1968') }))).not.toMatch(/deathLikeDate/);
  });

  it('is not made without a given name or a surname, or for a placeholder', () => {
    expect(researchUrl(person({ givenName: '  ' }))).toBeNull();
    expect(researchUrl(person({ surname: '', secondSurname: null }))).toBeNull();
    expect(researchUrl(person({ surname: '', secondSurname: 'Peña' }))).toMatch(/q\.surname=Pe%C3%B1a$/);
    expect(researchUrl(person({ isPlaceholder: true }))).toBeNull();
  });
});

describe('who gets the link', () => {
  const living = (birth: Facts['birth']) => person({ deceased: false, death: null, birth });

  it('every deceased person, with or without dates', () => {
    expect(researchAllowed(person(), now)).toBe(true);
    expect(researchAllowed(person({ birth: null, death: null }), now)).toBe(true);
  });

  it('a living person of 18 or more with a known birth year', () => {
    expect(researchAllowed(living(d('1960')), now)).toBe(true);
    expect(researchAllowed(living(d('2008-11-25')), now)).toBe(true);
    expect(researchAllowed(living(d('2007')), now)).toBe(true);
  });

  it('never a living person under 18', () => {
    expect(researchAllowed(living(d('2008-11-26')), now)).toBe(false);
    expect(researchAllowed(living(d('2015')), now)).toBe(false);
    // A year alone counts the youngest they could be: born in 2008, they may still be 17.
    expect(researchAllowed(living(d('2008')), now)).toBe(false);
    expect(researchAllowed(living(d('2008-01-01', 'about')), now)).toBe(false);
    // "After" has no upper bound, so it never counts as an adult.
    expect(researchAllowed(living(d('1950', 'after')), now)).toBe(false);
  });

  it('never a living person with no birth year', () => {
    expect(researchAllowed(living(null), now)).toBe(false);
    expect(researchLink(living(null), now)).toBeNull();
  });

  it('never a placeholder', () => {
    expect(researchLink(person({ isPlaceholder: true }), now)).toBeNull();
  });
});
