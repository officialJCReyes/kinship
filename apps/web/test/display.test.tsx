// SPDX-License-Identifier: AGPL-3.0-or-later
import { DATE_FORMATS, formatPartialDate } from '@kinship/shared';
import type { DateFormat, DatePrecision } from '@kinship/shared';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDate } from '../src/lib/dates.js';
import { DEFAULT_DISPLAY, setDisplay } from '../src/lib/display.js';
import { displayName } from '../src/lib/names.js';
import { t } from '../src/i18n.js';
import { initials } from '../src/tree/family.js';
import { ADMIN, haleRoutes, PEOPLE } from './family.js';
import { mockApi, renderApp } from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
  setDisplay(DEFAULT_DISPLAY);
  restore();
});

describe('formatPartialDate: 7 formats x 3 lengths x 4 precisions', () => {
  // Written out by hand, not computed: a day with a two-digit month and a one-digit day, a month, and a year.
  const EXPECTED: Record<DateFormat, { day: string; month: string }> = {
    mdy: { day: 'Nov 2, 1955', month: 'Nov 1955' },
    dmy: { day: '2 Nov, 1955', month: 'Nov 1955' },
    dmy2: { day: '2 Nov 1955', month: 'Nov 1955' },
    long: { day: 'November 2, 1955', month: 'November 1955' },
    iso: { day: '1955-11-02', month: '1955-11' },
    us: { day: '11/02/1955', month: '11/1955' },
    eu: { day: '02/11/1955', month: '11/1955' },
  };
  const PRECISIONS: DatePrecision[] = ['exactly', 'about', 'before', 'after'];
  const words = (precision: DatePrecision, text: string) => (precision === 'exactly' ? text : `${precision} ${text}`);

  it('lists exactly the seven formats', () => {
    expect([...DATE_FORMATS].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const format of DATE_FORMATS) {
    for (const precision of PRECISIONS) {
      it(`${format}, ${precision}`, () => {
        const show = (value: string) => formatPartialDate({ value, precision }, format, t);
        expect(show('1955-11-02')).toBe(words(precision, EXPECTED[format].day));
        expect(show('1955-11')).toBe(words(precision, EXPECTED[format].month));
        // A bare year stays a year in every format.
        expect(show('1955')).toBe(words(precision, '1955'));
      });
    }
  }

  it('treats a missing precision as exactly, and pads and unpads the way each format does', () => {
    expect(formatPartialDate({ value: '2026-01-05' }, 'mdy', t)).toBe('Jan 5, 2026');
    expect(formatPartialDate({ value: '2026-01-05' }, 'us', t)).toBe('01/05/2026');
    expect(formatPartialDate({ value: '2026-12-25' }, 'eu', t)).toBe('25/12/2026');
    expect(formatPartialDate({ value: '2026-12-25' }, 'dmy2', t)).toBe('25 Dec 2026');
  });

  it('gives nothing for empty input, and shows what is not a date as written instead of hiding it', () => {
    for (const empty of [null, undefined, { value: '' }, { value: '   ' }]) {
      expect(formatPartialDate(empty, 'mdy', t)).toBe('');
    }
    for (const bad of ['abc', '1955-13', '1955-00', '1955-11-00', '1955-11-32', '1955-1', '55', '1955-11-02-01']) {
      expect(formatPartialDate({ value: bad }, 'iso', t), bad).toBe(bad);
    }
  });

  it('never changes the stored text it is given', () => {
    const stored = { value: '1955-11-02', precision: 'about' as const };
    formatPartialDate(stored, 'long', t);
    expect(stored).toEqual({ value: '1955-11-02', precision: 'about' });
  });

  it('follows the account’s format through formatDate, and goes back to the default', () => {
    const date = { value: '1998-03-09', precision: 'exactly' as const };
    expect(formatDate(date)).toBe('Mar 9, 1998');
    setDisplay({ ...DEFAULT_DISPLAY, dateFormat: 'iso' });
    expect(formatDate(date)).toBe('1998-03-09');
    setDisplay({ ...DEFAULT_DISPLAY, dateFormat: 'long' });
    expect(formatDate(date)).toBe('March 9, 1998');
  });
});

// The test family is shared, so a test that gives somebody a second or married surname puts it back after.
let saved: Array<() => void> = [];
function restore() {
  for (const undo of saved) undo();
  saved = [];
}
function withNames(id: string, names: { secondSurname?: string | null; marriedSurname?: string | null }) {
  const person = PEOPLE.find((p) => p.id === id)!;
  const before = { secondSurname: person.secondSurname, marriedSurname: person.marriedSurname };
  Object.assign(person, names);
  saved.push(() => Object.assign(person, before));
}

describe('the account’s surname choice, on every screen', () => {
  const birth = { ...ADMIN, surnameChoice: 'birth' as const };
  const elena = () => PEOPLE.find((p) => p.id === 'elena')!;

  it('married: the married surname replaces both surnames; birth: the surname and the second surname', () => {
    withNames('elena', { secondSurname: 'Vega', marriedSurname: 'Ruiz Hale' });
    expect(displayName(elena())).toBe('Elena Ruiz Hale');
    setDisplay({ ...DEFAULT_DISPLAY, surnameChoice: 'birth' });
    expect(displayName(elena())).toBe('Elena Ruiz Vega');
  });

  it('is the same under both choices for a person with no married surname, and for one with only a second surname', () => {
    withNames('marcus', { secondSurname: 'Okafor' });
    const marcus = PEOPLE.find((p) => p.id === 'marcus')!;
    const daniel = PEOPLE.find((p) => p.id === 'daniel')!;
    for (const surnameChoice of ['married', 'birth'] as const) {
      setDisplay({ ...DEFAULT_DISPLAY, surnameChoice });
      expect(displayName(daniel), surnameChoice).toBe('Daniel Hale');
      expect(displayName(marcus), surnameChoice).toBe('Marcus Hale Okafor');
    }
  });

  it('initials follow the surname that shows', () => {
    withNames('elena', { marriedSurname: 'Hale' });
    expect(initials(elena())).toBe('EH');
    setDisplay({ ...DEFAULT_DISPLAY, surnameChoice: 'birth' });
    expect(initials(elena())).toBe('ER');
  });

  it('the profile, the list, a chart node and the picker show the choice', async () => {
    withNames('elena', { secondSurname: 'Vega', marriedSurname: 'Ruiz Hale' });

    // Married (the default): profile heading and the people list.
    mockApi(haleRoutes(ADMIN));
    renderApp('/people/elena');
    expect(await screen.findByRole('heading', { name: 'Elena Ruiz Hale' })).toBeTruthy();
    cleanup();
    vi.unstubAllGlobals();
    mockApi(haleRoutes(ADMIN));
    renderApp('/people');
    expect(await screen.findByRole('link', { name: 'Elena Ruiz Hale' })).toBeTruthy();
    cleanup();

    // Birth names: the same screens, and the chart and the picker too.
    vi.unstubAllGlobals();
    mockApi(haleRoutes(birth));
    renderApp('/people/elena');
    expect(await screen.findByRole('heading', { name: 'Elena Ruiz Vega' })).toBeTruthy();
    cleanup();
    vi.unstubAllGlobals();
    mockApi(haleRoutes(birth));
    renderApp('/people');
    expect(await screen.findByRole('link', { name: 'Elena Ruiz Vega' })).toBeTruthy();
    cleanup();
    vi.unstubAllGlobals();
    mockApi(haleRoutes(birth));
    renderApp('/tree/daniel');
    expect(await screen.findByRole('button', { name: /^Elena Ruiz Vega/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Elena Ruiz Hale/ })).toBeNull();
    cleanup();
    vi.unstubAllGlobals();
    mockApi(
      haleRoutes(birth, { '/api/people?q=el&limit=8': { status: 200, body: { items: [elena()], nextCursor: null } } }),
    );
    renderApp('/people/ben');
    await screen.findByRole('heading', { name: 'Ben Hale' });
    fireEvent.click(screen.getByRole('button', { name: 'Add relative' }));
    fireEvent.click(screen.getByRole('button', { name: /^Add partner/ }));
    fireEvent.click(screen.getByLabelText('Someone already on the tree'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Find them by name' }), { target: { value: 'el' } });
    const option = await screen.findByRole('option', { name: /Elena/ });
    expect(within(option).getByText(/Elena Ruiz Vega/)).toBeTruthy();
  });

  it('a change of choice reaches a page that is already open (the page is remounted once)', async () => {
    withNames('elena', { secondSurname: 'Vega', marriedSurname: 'Ruiz Hale' });
    mockApi(haleRoutes(ADMIN));
    const { client } = renderApp('/people/elena');
    expect(await screen.findByRole('heading', { name: 'Elena Ruiz Hale' })).toBeTruthy();
    client.setQueryData(['auth', 'me'], { user: birth, treeName: 'Hale Family' });
    expect(await screen.findByRole('heading', { name: 'Elena Ruiz Vega' })).toBeTruthy();
  });
});
