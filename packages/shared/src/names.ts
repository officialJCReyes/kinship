// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How a person's name is shown. The ONE place that decides it, for the web app now and for reports and
// exports later (they will read the parts separately and not use this). The rules are in ADR 0024.

import { DEFAULT_NAME_FORM, DEFAULT_SHOW_PREFIX, DEFAULT_SHOW_SUFFIX } from './settings.js';
import type { NameForm } from './settings.js';

/** The parts of a person that make up their name. Everything except the given name and surname is optional. */
export interface NameParts {
  givenName: string;
  /** The birth surname. A particle (de, de la, van) is part of it ("de la Cruz"; ADR 0038). */
  surname: string;
  secondSurname?: string | null | undefined;
  marriedSurname?: string | null | undefined;
  /** Dr., Sir. */
  namePrefix?: string | null | undefined;
  /** Jr., II. */
  nameSuffix?: string | null | undefined;
  /** Never part of a displayed name; shown on the profile and searched. */
  nickname?: string | null | undefined;
}

/** What one account chooses about names (the `nameForm`, `showPrefix` and `showSuffix` settings). */
export interface NameDisplay {
  nameForm: NameForm;
  showPrefix: boolean;
  showSuffix: boolean;
}

export const DEFAULT_NAME_DISPLAY: NameDisplay = {
  nameForm: DEFAULT_NAME_FORM,
  showPrefix: DEFAULT_SHOW_PREFIX,
  showSuffix: DEFAULT_SHOW_SUFFIX,
};

/** One character without accents and in lower case, for comparing names. */
function fold(char: string): string {
  return char.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * The married surname without a maiden name it starts with: "Mendez Hale" with maiden "Mendez" is "Hale". Ignores case
 * and accents, and only strips a whole word (a space must follow). Returns null when nothing is left, which means the
 * married surname adds nothing to the maiden name.
 */
export function marriedPart(married: string, maiden: string): string | null {
  const target = Array.from(maiden).map(fold).join('');
  const chars = Array.from(married);
  let seen = '';
  for (let i = 0; i < chars.length; i += 1) {
    seen += fold(chars[i] ?? '');
    if (seen.length > target.length) break;
    if (seen === target) {
      const rest = chars.slice(i + 1);
      if (rest.length === 0) return null;
      if (!/^\s/.test(rest[0] ?? '')) break;
      const text = rest.join('').trim();
      return text === '' ? null : text;
    }
  }
  return married;
}

/** The birth name's surname part: the surname, then the second surname ("de la Navarro Ortiz"). */
function maidenName(person: NameParts): string {
  return [person.surname, person.secondSurname].filter(Boolean).join(' ');
}

/**
 * The surname part of a name in the account's chosen form (ADR 0024). A person with no married surname, or one that
 * adds nothing to the birth name, shows the maiden name in every form.
 */
export function displaySurname(person: NameParts, form: NameForm = DEFAULT_NAME_FORM): string {
  const maiden = maidenName(person);
  const married = person.marriedSurname;
  if (!married) return maiden;
  // A married surname that repeats the birth name (with or without the second surname) adds only what follows it.
  const birthOnly = [person.surname, person.secondSurname].filter(Boolean).join(' ');
  let rest: string | null = married;
  for (const candidate of [birthOnly, person.surname]) {
    const stripped = marriedPart(married, candidate);
    if (stripped !== married) {
      rest = stripped;
      break;
    }
  }
  if (rest === null) return maiden;
  const extra = rest;
  switch (form) {
    case 'maiden_married':
      return `${maiden} (${extra})`;
    case 'married_born':
      return `${married} (born ${maiden})`;
    case 'married':
      return married;
    case 'maiden':
      return maiden;
  }
}

/**
 * The name as one account sees it: prefix, given name, surname part, suffix. The prefix and suffix follow the account's
 * switches. The nickname is never part of it.
 */
export function displayName(person: NameParts, display: NameForm | Partial<NameDisplay> = {}): string {
  const options: NameDisplay = {
    ...DEFAULT_NAME_DISPLAY,
    ...(typeof display === 'string' ? { nameForm: display } : display),
  };
  return [
    options.showPrefix ? person.namePrefix : null,
    person.givenName,
    displaySurname(person, options.nameForm),
    options.showSuffix ? person.nameSuffix : null,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * The prefixes offered in the name forms' Prefix list (Add relative, Edit details), in that order. The stored value is
 * plain text: anything else is kept as typed under "Other…". Shown as written in every language, like a name.
 */
export const NAME_PREFIXES = [
  'Mr.',
  'Mrs.',
  'Ms.',
  'Miss',
  'Mx.',
  'Dr.',
  'Dra.',
  'Prof.',
  'Rev.',
  'Fr.',
  'Sr.',
  'Don',
  'Doña',
  'Sra.',
  'Srta.',
  'Lic.',
  'Ing.',
  'Hon.',
  'Capt.',
  'Col.',
  'Sir',
] as const;

/** The suffixes offered in the Suffix list. As for prefixes, anything else is kept as typed under "Other…". */
export const NAME_SUFFIXES = ['Jr.', 'Sr.', 'II', 'III', 'IV', 'V', 'MD', 'DDS', 'PhD', 'Esq.', 'RN', 'CPA'] as const;

/**
 * How a stored prefix or suffix shows in its list: none, one of the list's entries (an exact match, so nothing stored is
 * ever rewritten), or "other" with the text in a box.
 */
export type AffixChoice = { kind: 'none' } | { kind: 'listed'; value: string } | { kind: 'other'; text: string };

export function affixChoice(stored: string | null | undefined, list: readonly string[]): AffixChoice {
  const value = (stored ?? '').trim();
  if (value === '') return { kind: 'none' };
  return list.includes(value) ? { kind: 'listed', value } : { kind: 'other', text: stored ?? '' };
}
