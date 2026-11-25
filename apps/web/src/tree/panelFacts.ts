// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Born and Died lines of the person panel: "Born Aug 26, 1994 (age 32) · Brooklyn, NY", "Died Aug 11, 1979
// (at age 76) · Ponce". A missing piece is left out (never "unknown" or "?"); with no date and no place there is no line.
// Places come with the Places fields (0.5): until then the panel passes none, and the place parameter is only tested.
import type { Person } from '@kinship/shared';
import { t } from '../i18n.js';
import { formatDate } from '../lib/dates.js';
import { ageBetween, ageNow } from '../lib/life-age.js';
import type { LifeAge } from '../lib/life-age.js';

export interface FactLine {
  /** "Born" or "Died", shown in bold. */
  label: string;
  /** Everything after the label. */
  text: string;
}

/** "32", or "~32" when the age is only the difference of the years. */
export function ageText(age: LifeAge): string {
  return age.approx ? t('age.approx', { n: age.years }) : String(age.years);
}

function line(label: string, date: string, age: string, place: string | null | undefined): FactLine | null {
  const when = [date, age].filter(Boolean).join(' ');
  const where = place?.trim() ?? '';
  const text = when && where ? t('tree.panel.factPlace', { fact: when, place: where }) : when || where;
  return text ? { label, text } : null;
}

/** The Born line. A living person's age on `now` follows the date. */
export function bornLine(
  person: Pick<Person, 'birth' | 'deceased'>,
  now: Date,
  place?: string | null,
): FactLine | null {
  const age = person.deceased ? null : ageNow(person.birth, now);
  return line(
    t('tree.panel.born'),
    formatDate(person.birth),
    age ? t('tree.panel.age', { age: ageText(age) }) : '',
    place,
  );
}

/** The Died line, for a deceased person only, with the age at death. */
export function diedLine(person: Pick<Person, 'birth' | 'death' | 'deceased'>, place?: string | null): FactLine | null {
  if (!person.deceased) return null;
  const age = ageBetween(person.birth, person.death);
  return line(
    t('tree.panel.died'),
    formatDate(person.death),
    age ? t('tree.panel.ageAtDeath', { age: ageText(age) }) : '',
    place,
  );
}
