// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How a person's name is shown. The ONE place that decides it, for the web app now and for reports and
// exports later (they will read both surnames separately and not use this).

import { DEFAULT_SURNAME_CHOICE } from './settings.js';
import type { SurnameChoice } from './settings.js';

/** The parts of a person that make up their name. The second and married surnames may be left out. */
export interface NameParts {
  givenName: string;
  surname: string;
  secondSurname?: string | null | undefined;
  marriedSurname?: string | null | undefined;
}

/**
 * The surname part of a name: the surname, then the second surname when set. When a married surname is set
 * and chosen, it replaces both.
 */
export function displaySurname(person: NameParts, choice: SurnameChoice = DEFAULT_SURNAME_CHOICE): string {
  if (choice === 'married' && person.marriedSurname) return person.marriedSurname;
  return person.secondSurname ? `${person.surname} ${person.secondSurname}` : person.surname;
}

/** The given name, then the surname part: "Rosa Mendez Ortiz", or "Rosa Mendez Hale" with a married surname. */
export function displayName(person: NameParts, choice: SurnameChoice = DEFAULT_SURNAME_CHOICE): string {
  return `${person.givenName} ${displaySurname(person, choice)}`;
}
