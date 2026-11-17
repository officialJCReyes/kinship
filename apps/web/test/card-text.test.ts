// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { estimateWidth, fitName, MAX_LINES, NAME_SIZE, SIZE_FLOOR } from '../src/tree/cardText.js';
import type { Measure } from '../src/tree/cardText.js';

// A fixed measurer, so the result does not depend on any font: every letter is 0.6 of the font size wide.
const fixed: Measure = (text, size) => Array.from(text).length * size * 0.6;
const WIDTH = 126; // the room a name has on a card (NODE_W - 48 - 10)

// Fictional stand-ins shaped like the longest real names (a quoted nickname; a double surname with particles).
const NICKNAME = 'Rafael Octavio "Tavo" Brandt Santori';
const LONG = 'Nova Estelle Hallworth-Fernandez de la Mora';

const text = (lines: string[]) => lines.join(' ').replace(/- /g, '-');

describe('fitName', () => {
  it('keeps a short name on one line at the normal size', () => {
    expect(fitName('Marcus Hale', WIDTH, fixed)).toEqual({ lines: ['Marcus Hale'], size: NAME_SIZE, lineHeight: 15.6 });
  });

  it('wraps a longer name on words, up to three lines, without changing the size when that is enough', () => {
    const fit = fitName('Daniel Eduardo Hale Mendez', WIDTH, fixed);
    expect(fit.lines.length).toBeGreaterThan(1);
    expect(fit.lines.length).toBeLessThanOrEqual(MAX_LINES);
    expect(fit.lines.join(' ')).toBe('Daniel Eduardo Hale Mendez');
    expect(fit.size).toBe(NAME_SIZE);
  });

  it('steps the size down, not the text, when three lines are not enough', () => {
    const wide: Measure = (t, size) => Array.from(t).length * size * 0.8; // wide letters: three lines are too few at 13 px
    const fit = fitName(NICKNAME, WIDTH, wide);
    expect(fit.lines.length).toBeLessThanOrEqual(MAX_LINES);
    expect(fit.lines.join(' ')).toBe(NICKNAME);
    expect(fit.size).toBeLessThan(NAME_SIZE);
    for (const line of fit.lines) expect(wide(line, fit.size)).toBeLessThanOrEqual(WIDTH);
  });

  it('never cuts, never adds an ellipsis, and breaks a hyphenated surname after the hyphen', () => {
    const fit = fitName(LONG, WIDTH, fixed);
    expect(fit.lines.length).toBeLessThanOrEqual(MAX_LINES);
    expect(fit.lines.join('')).not.toContain('…');
    expect(text(fit.lines)).toBe(LONG);
    for (const line of fit.lines) expect(fixed(line, fit.size)).toBeLessThanOrEqual(WIDTH);
  });

  it('keeps the deceased mark with the last word', () => {
    const fit = fitName('Walter Hale\u00a0†', WIDTH, fixed);
    expect(fit.lines.at(-1)).toMatch(/Hale\u00a0†$/);
  });

  it('breaks a single word wider than the card by letter, so nothing is lost', () => {
    const word = 'Abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz';
    const fit = fitName(word, WIDTH, fixed);
    expect(fit.lines.join('')).toBe(word);
    for (const line of fit.lines) expect(fixed(line, fit.size)).toBeLessThanOrEqual(WIDTH);
  });

  it('holds the whole name even for the longest allowed one, and never goes below the floor', () => {
    const name = Array.from({ length: 12 }, (_, i) => `Namesurname${i}abcdefgh`).join(' ');
    const fit = fitName(name, WIDTH, fixed);
    expect(fit.size).toBeGreaterThanOrEqual(SIZE_FLOOR);
    expect(fit.lines.join(' ').replace(/ /g, '')).toBe(name.replace(/ /g, ''));
  });

  it('gives the smallest size the estimate needs for the stress names (reported in the PR)', () => {
    // estimateWidth is the fallback where there is no browser to measure; these are its sizes for the long names.
    const sizes = [NICKNAME, LONG].map((n) => fitName(n, WIDTH, estimateWidth).size);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(9);
  });
});
