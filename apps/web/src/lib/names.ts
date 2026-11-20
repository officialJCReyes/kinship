// SPDX-License-Identifier: AGPL-3.0-or-later
import { displayName as sharedDisplayName, displaySurname as sharedDisplaySurname } from '@kinship/shared';
import type { Gender, NameDisplay, NameForm, NameParts } from '@kinship/shared';
import { t } from '../i18n.js';
import { getDisplay } from './display.js';

/**
 * A person's name as THIS account sees it (ADR 0024): prefix, given name, the surname part in the account's chosen form,
 * suffix. The one place the account's name choices are read; every screen calls this. A nickname is never part of it.
 */
export function displayName(
  person: NameParts & { isPlaceholder?: boolean; gender?: Gender | null },
  display: Partial<NameDisplay> = getDisplay(),
): string {
  if (person.isPlaceholder) return placeholderName(person);
  return sharedDisplayName(person, display);
}

/** The surname part of `displayName`. */
export function displaySurname(person: NameParts, form: NameForm = getDisplay().nameForm): string {
  return sharedDisplaySurname(person, form);
}

/** "Unknown father" or "Unknown mother". The stored gender only picks which; it is never shown as a sex. */
export function placeholderName(person: { gender?: Gender | null }): string {
  return person.gender === 'female' ? t('person.unknownMother') : t('person.unknownFather');
}
