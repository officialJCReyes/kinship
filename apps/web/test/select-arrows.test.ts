// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Every select draws its own arrow inside its box (step 41). A browser's native arrow ignores the padding (Chrome draws it
// against the right border), so styles.css turns it off once for every select and draws a chevron in a right padding kept free
// for it. These checks keep that in place: one shared rule, and no select rule that wipes the arrow with the background shorthand.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/** Every rule as [selector, body]. Good enough for this flat stylesheet (media queries are unwrapped). */
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1]!.trim(), m[2]!] as const);

describe('select arrows', () => {
  it('one rule for every select turns the native arrow off and draws one inside the padding', () => {
    const base = rules.filter(([selector]) => selector === 'select');
    expect(base).toHaveLength(1);
    const body = base[0]![1];
    expect(body).toMatch(/appearance:\s*none/);
    expect(body).toMatch(/background-image:/);
    expect(body).toMatch(/padding-right:\s*calc\(var\(--chevron-inset\) \+ \d+px\)/);
    expect(body).toMatch(
      /background-position:\s*calc\(100% - var\(--chevron-inset\) - 5px\) 50%,\s*calc\(100% - var\(--chevron-inset\)\) 50%/,
    );
  });

  it('no other rule that styles a select uses the background shorthand or a padding that drops the arrow’s room', () => {
    const selectRules = rules.filter(([selector]) => /(^|[\s,>+~])select\b(?![-\w])/.test(selector));
    expect(selectRules.length).toBeGreaterThan(2);
    for (const [selector, body] of selectRules) {
      expect(body, selector).not.toMatch(/(^|[;\s])background:/);
      expect(body, selector).not.toMatch(/(^|[;\s])appearance:\s*(auto|menulist)/);
      // A rule that sets all four paddings at once must keep the arrow's room on the right.
      const padding = /(?:^|[;\s])padding:\s*([^;]+);/.exec(body)?.[1];
      if (padding && !/^\d+px$/.test(padding.trim()) && selector.split(',').every((s) => /select/.test(s))) {
        expect(padding, selector).toMatch(/--chevron-inset/);
      }
    }
  });
});
