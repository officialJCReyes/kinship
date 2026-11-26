// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The person panel's Research link (ADR 0040): a FamilySearch record search for this person, opened in a new tab. It is
// an outbound link only: KinShip calls nothing, and the name and years go to FamilySearch only when someone clicks.
// Pure: "today" is passed in.
import type { Person } from '@kinship/shared';
import { ageNow } from './life-age.js';

export const FAMILYSEARCH_SEARCH = 'https://www.familysearch.org/en/search/record/results';

/** The youngest a living person can be for the link to show (children are never sent anywhere). */
export const RESEARCH_MIN_AGE = 18;

type ResearchFacts = Pick<
  Person,
  'givenName' | 'surname' | 'secondSurname' | 'birth' | 'death' | 'deceased' | 'isPlaceholder'
>;

const yearOf = (date: Person['birth']): string | null => {
  const match = date ? /^(\d{4})/.exec(date.value.trim()) : null;
  return match ? match[1]! : null;
};

/**
 * The search address: given name, surname (the birth surname and the second surname, never the married surname or the
 * nickname), and the birth and death years when known, in FamilySearch's own parameter order. Null without a given
 * name or a surname, and for a placeholder.
 */
export function researchUrl(person: ResearchFacts): string | null {
  if (person.isPlaceholder) return null;
  const given = person.givenName.trim();
  const surname = [person.surname, person.secondSurname ?? '']
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
  if (!given || !surname) return null;
  const query = ['count=20'];
  const born = yearOf(person.birth);
  const died = person.deceased ? yearOf(person.death) : null;
  if (born) query.push(`q.birthLikeDate.from=${born}`);
  if (died) query.push(`q.deathLikeDate.from=${died}`);
  query.push(`q.givenName=${encodeURIComponent(given)}`, `q.surname=${encodeURIComponent(surname)}`);
  return `${FAMILYSEARCH_SEARCH}?${query.join('&')}`;
}

/**
 * Whether the link may show (JC, step 49): always for a deceased person; for a living person only with a known birth
 * year and an age of 18 or more for certain. A birth known only to the year, or "about", counts the youngest the person
 * could be (one year less); "after" has no upper bound, so it never counts.
 */
export function researchAllowed(person: ResearchFacts, now: Date): boolean {
  if (person.isPlaceholder) return false;
  if (person.deceased) return true;
  if (!person.birth || !yearOf(person.birth) || person.birth.precision === 'after') return false;
  const age = ageNow(person.birth, now);
  if (!age) return false;
  return (age.approx ? age.years - 1 : age.years) >= RESEARCH_MIN_AGE;
}

/** The address to show in the panel, or null when there is no link for this person. */
export function researchLink(person: ResearchFacts, now: Date): string | null {
  return researchAllowed(person, now) ? researchUrl(person) : null;
}
