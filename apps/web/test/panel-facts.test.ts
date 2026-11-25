// SPDX-License-Identifier: AGPL-3.0-or-later
import type { DatePrecision, Person } from '@kinship/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { getDisplay, setDisplay } from '../src/lib/display.js';
import { bornLine, diedLine } from '../src/tree/panelFacts.js';

const d = (value: string, precision: DatePrecision = 'exactly') => ({ value, precision });
type Facts = Pick<Person, 'birth' | 'death' | 'deceased'>;
const living = (birth: Facts['birth']): Facts => ({ birth, death: null, deceased: false });
const dead = (birth: Facts['birth'], death: Facts['death']): Facts => ({ birth, death, deceased: true });
const now = new Date(2026, 10, 25);
const initial = getDisplay();

afterEach(() => setDisplay(initial));

describe('the Born line', () => {
  it('gives a living person their age after the date', () => {
    expect(bornLine(living(d('1994-08-26')), now)).toEqual({ label: 'Born', text: 'Aug 26, 1994 (age 32)' });
  });

  it('marks an age worked out from the years alone with a tilde', () => {
    expect(bornLine(living(d('1994')), now)?.text).toBe('1994 (age ~32)');
    expect(bornLine(living(d('1994-08-26', 'about')), now)?.text).toBe('about Aug 26, 1994 (age ~32)');
  });

  it('gives a deceased person no age on the Born line', () => {
    expect(bornLine(dead(d('1903-08-09'), d('1979-08-11')), now)?.text).toBe('Aug 9, 1903');
  });

  it('adds the place after a separator, and only when there is one', () => {
    expect(bornLine(living(d('1994-08-26')), now, 'Brookfield, Example County')?.text).toBe(
      'Aug 26, 1994 (age 32) · Brookfield, Example County',
    );
    expect(bornLine(living(null), now, 'Brookfield')?.text).toBe('Brookfield');
    expect(bornLine(living(d('1994')), now, '   ')?.text).toBe('1994 (age ~32)');
  });

  it('keeps a long place whole (it wraps in the panel; nothing is cut off)', () => {
    const place = 'San Ejemplo de las Colinas Altas, Provincia de Muestra, República Imaginaria del Norte';
    expect(bornLine(living(null), now, place)?.text).toBe(place);
  });

  it('has no line with no date and no place, and never says unknown or ?', () => {
    expect(bornLine(living(null), now)).toBeNull();
    const text = bornLine(dead(null, d('1979')), now, 'Brookfield')?.text ?? '';
    expect(text).not.toMatch(/\?|unknown/i);
  });

  it('follows the account date format and keeps a year alone a year', () => {
    setDisplay({ ...initial, dateFormat: 'iso' });
    expect(bornLine(living(d('1994-08-26')), now)?.text).toBe('1994-08-26 (age 32)');
    setDisplay({ ...initial, dateFormat: 'eu' });
    expect(bornLine(living(d('1994')), now)?.text).toBe('1994 (age ~32)');
  });

  it('shows no age over 130', () => {
    expect(bornLine(living(d('1850')), now)?.text).toBe('1850');
  });
});

describe('the Died line', () => {
  it('gives the age at death, exact when both dates are complete', () => {
    expect(diedLine(dead(d('1903-08-09'), d('1979-08-11')))).toEqual({
      label: 'Died',
      text: 'Aug 11, 1979 (at age 76)',
    });
    expect(diedLine(dead(d('1903'), d('1979-08-11')))?.text).toBe('Aug 11, 1979 (at age ~76)');
  });

  it('is only for deceased people', () => {
    expect(diedLine(living(d('1994')))).toBeNull();
  });

  it('leaves out what is missing, with no stray separator', () => {
    expect(diedLine(dead(null, d('1979')))?.text).toBe('1979');
    expect(diedLine(dead(d('1903'), null), 'Port Example')?.text).toBe('Port Example');
    expect(diedLine(dead(d('1903'), null))).toBeNull();
    expect(diedLine(dead(d('1903-08-09'), d('1979-08-11')), 'Port Example')?.text).toBe(
      'Aug 11, 1979 (at age 76) · Port Example',
    );
  });

  it('shows no age when the death is before the birth', () => {
    expect(diedLine(dead(d('1979'), d('1903')))?.text).toBe('1903');
  });
});
