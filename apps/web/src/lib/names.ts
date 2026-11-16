// SPDX-License-Identifier: AGPL-3.0-or-later
import { displayName as sharedDisplayName, displaySurname as sharedDisplaySurname } from '@kinship/shared';
import type { NameParts, SurnameChoice } from '@kinship/shared';
import { getDisplay } from './display.js';

/**
 * A person's name as THIS account sees it: given name, surname, second surname, or the married surname when it is set
 * and the account chose it. The one place the account's surname choice is read; every screen calls this.
 */
export function displayName(person: NameParts, choice: SurnameChoice = getDisplay().surnameChoice): string {
  return sharedDisplayName(person, choice);
}

/** The surname part of `displayName`. */
export function displaySurname(person: NameParts, choice: SurnameChoice = getDisplay().surnameChoice): string {
  return sharedDisplaySurname(person, choice);
}
