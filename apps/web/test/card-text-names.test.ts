// SPDX-License-Identifier: AGPL-3.0-or-later
import { displayName } from '@kinship/shared';
import { describe, expect, it } from 'vitest';
import { estimateWidth, fitName, MAX_LINES, NAME_SIZE } from '../src/tree/cardText.js';

/** The width the name has on a card: NODE_W 184, less the avatar (48) and a margin (10). */
const WIDTH = 126;

const NAMES = [
  { given: 'Rosa', sur: 'Mendez', married: 'Hale' },
  { given: 'Beatriz', sur: 'de Navarro', second: 'Ortiz', married: 'Hale' },
  { given: 'Beatriz', sur: 'de la Navarro', pre: 'Dra.', suf: 'Jr.' },
  {
    given: 'Beatriz',
    sur: 'de la Navarro',
    second: 'Ortiz',
    married: 'Hernandez-Hale',
    pre: 'Dra.',
    suf: 'Jr.',
  },
  { given: 'Maria Guadalupe', sur: 'de la Villanueva', second: 'Cruz', married: 'Hernandez-Hale' },
];

describe('the card name with the four forms, prefix and suffix', () => {
  it('never needs more than three lines, and never goes under 11 px for the longest realistic names', () => {
    for (const n of NAMES) {
      const name = displayName({
        givenName: n.given,
        surname: n.sur,
        secondSurname: n.second ?? null,
        marriedSurname: n.married ?? null,
        namePrefix: n.pre ?? null,
        nameSuffix: n.suf ?? null,
      });
      for (const dead of [false, true]) {
        // The dagger is attached with a no-break space, so it stays with the last word.
        const fit = fitName(name + (dead ? '\u00a0\u2020' : ''), WIDTH, estimateWidth);
        expect(fit.lines.length, name).toBeLessThanOrEqual(MAX_LINES);
        expect(fit.size, name).toBeGreaterThanOrEqual(11);
        expect(fit.size).toBeLessThanOrEqual(NAME_SIZE);
        expect(
          fit.lines
            .join(' ')
            .replace(/\u00a0/g, ' ')
            .replace(/- /g, '-'),
          name,
        ).toBe((name + (dead ? ' \u2020' : '')).replace(/\u00a0/g, ' '));
      }
    }
  });

  it('keeps the common cases at the normal size', () => {
    for (const name of ['Rosa Mendez (Hale)', 'Dr. Samuel Hale', 'Walter Hale Sr.', 'Beatriz de Navarro (Hale)']) {
      const fit = fitName(name, WIDTH, estimateWidth);
      expect(fit.size, name).toBe(NAME_SIZE);
      expect(fit.lines.length, name).toBeLessThanOrEqual(2);
    }
  });

  it('keeps the dagger with the last word of a wrapped name', () => {
    const fit = fitName('Rosa Mendez (Hale)\u00a0\u2020', WIDTH, estimateWidth);
    expect(fit.lines.at(-1)).toBe('(Hale)\u00a0\u2020');
  });
});
