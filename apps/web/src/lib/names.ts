// SPDX-License-Identifier: AGPL-3.0-or-later
import { displayName as sharedDisplayName, displaySurname as sharedDisplaySurname } from '@kinship/shared';
import type { Gender, NameParts, SurnameChoice } from '@kinship/shared';
import { t } from '../i18n.js';
import { getDisplay } from './display.js';

/**
 * A person's name as THIS account sees it: given name, surname, second surname, or the married surname when it is set
 * and the account chose it. The one place the account's surname choice is read; every screen calls this.
 */
export function displayName(
  person: NameParts & { isPlaceholder?: boolean; gender?: Gender | null },
  choice: SurnameChoice = getDisplay().surnameChoice,
): string {
  if (person.isPlaceholder) return placeholderName(person);
  return sharedDisplayName(person, choice);
}

/** The surname part of `displayName`. */
export function displaySurname(person: NameParts, choice: SurnameChoice = getDisplay().surnameChoice): string {
  return sharedDisplaySurname(person, choice);
}

/** "Unknown father" or "Unknown mother". The stored gender only picks which; it is never shown as a sex. */
export function placeholderName(person: { gender?: Gender | null }): string {
  return person.gender === 'female' ? t('person.unknownMother') : t('person.unknownFather');
}
