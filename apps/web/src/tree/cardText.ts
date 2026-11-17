// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The name on a tree card. SVG text does not wrap, so the card wraps it here: the full name, never cut and never
// ended with an ellipsis, on up to three lines. If three lines are not enough at the normal size, the size steps down
// (for that card only) until the name fits. Pure functions, with the text measurer passed in, so the tests do not need
// a browser's fonts.

/** The size names start at, in px (the same as `.tnode .name` in styles.css). */
export const NAME_SIZE = 13;
/** How far the size steps down each time a name does not fit. */
export const SIZE_STEP = 0.5;
/** The size never goes below this: a name that still does not fit here is broken by letter, never cut. */
export const SIZE_FLOOR = 3;
export const MAX_LINES = 3;
/** Line height as a multiple of the font size. */
export const LINE_RATIO = 1.2;

export type Measure = (text: string, size: number) => number;

export interface NameFit {
  lines: string[];
  /** Font size in px. */
  size: number;
  /** Distance between lines in px. */
  lineHeight: number;
}

/** A width guess for when no browser is there to measure: wide capitals and digits, narrow i, l, t and punctuation. */
export const estimateWidth: Measure = (text, size) => {
  let em = 0;
  for (const ch of text) {
    if (/[ilj.,'’"“”:;!|\u00a0]/.test(ch)) em += 0.3;
    else if (/[ftrI()-]/.test(ch)) em += 0.4;
    else if (/[mwMW]/.test(ch)) em += 0.85;
    else if (/[A-Z0-9]/.test(ch)) em += 0.66;
    else if (ch === '†') em += 0.6;
    else em += 0.56;
  }
  return em * size;
};

let canvas: CanvasRenderingContext2D | null | undefined;
let family = '';

/**
 * Measures with the browser's own font (the semibold body font of the cards), plus 3 % so a different renderer never
 * pushes a letter past the edge. Falls back to the estimate where there is no canvas (tests, very old browsers).
 */
export const measureText: Measure = (text, size) => {
  if (canvas === undefined) {
    canvas = null;
    try {
      if (typeof document !== 'undefined' && !/jsdom/i.test(navigator.userAgent)) {
        canvas = document.createElement('canvas').getContext('2d');
        family =
          getComputedStyle(document.documentElement).getPropertyValue('--body').trim() || 'system-ui, sans-serif';
      }
    } catch {
      canvas = null;
    }
  }
  if (!canvas) return estimateWidth(text, size);
  canvas.font = `600 ${size}px ${family}`;
  return canvas.measureText(text).width * 1.03;
};

/** Words, then the pieces of a hyphenated word, each with whether a space comes before it. */
function pieces(text: string): Array<{ text: string; space: boolean }> {
  const out: Array<{ text: string; space: boolean }> = [];
  for (const word of text.split(' ').filter((w) => w !== '')) {
    word.split(/(?<=-)(?=.)/).forEach((part, index) => out.push({ text: part, space: index === 0 && out.length > 0 }));
  }
  return out;
}

/** One try at one size: the lines, however many it takes (a word wider than a line is broken by letter). */
function wrap(text: string, width: number, size: number, measure: Measure): string[] {
  const lines: string[] = [];
  let line = '';
  for (const piece of pieces(text)) {
    const joined = line === '' ? piece.text : `${line}${piece.space ? ' ' : ''}${piece.text}`;
    if (measure(joined, size) <= width) {
      line = joined;
      continue;
    }
    if (line !== '') lines.push(line);
    let rest = piece.text;
    while (measure(rest, size) > width && Array.from(rest).length > 1) {
      // the longest start of the word that fits (at least one letter, so this always ends)
      const chars = Array.from(rest);
      let take = chars.length - 1;
      while (take > 1 && measure(chars.slice(0, take).join(''), size) > width) take -= 1;
      lines.push(chars.slice(0, take).join(''));
      rest = chars.slice(take).join('');
    }
    line = rest;
  }
  if (line !== '') lines.push(line);
  return lines.length > 0 ? lines : [''];
}

/**
 * The name as lines of at most `width` px, on at most `maxLines` lines, at the biggest size from `start` down that
 * makes it fit. The result always holds the whole name.
 */
export function fitName(
  text: string,
  width: number,
  measure: Measure = measureText,
  maxLines = MAX_LINES,
  start = NAME_SIZE,
): NameFit {
  let size = start;
  for (;;) {
    const lines = wrap(text, width, size, measure);
    if (lines.length <= maxLines || size <= SIZE_FLOOR) {
      return { lines, size, lineHeight: Math.round(size * LINE_RATIO * 10) / 10 };
    }
    size = Math.max(SIZE_FLOOR, size - SIZE_STEP);
  }
}
