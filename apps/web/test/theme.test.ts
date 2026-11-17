// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The color schemes. styles.css is parsed (no extra dependency) and every scheme in both modes is checked against the
// WCAG contrast ratios for the colors that carry text, and for the rules in design/kinship-color-schemes.md: the status
// colors, the gender colors and the logo-green leaf do not change with the scheme. A pair that fails is reported by
// name; nothing here changes a color.
import { COLOR_SCHEMES } from '@kinship/shared';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(import.meta.dirname, '../src/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

type Tokens = Record<string, string>;
const rules = new Map<string, Tokens>();
for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const name = selector!.trim().replace(/\s+/g, ' ').replace(/"/g, "'");
  if (!name.startsWith(':root')) continue;
  const tokens: Tokens = rules.get(name) ?? {};
  for (const [, key, value] of body!.matchAll(/(--[a-z-]+|color-scheme):\s*([^;]+);/g)) {
    tokens[key!.replace(/^--/, '')] = value!.trim();
  }
  rules.set(name, tokens);
}

const MODES = ['light', 'dark'] as const;
type Mode = (typeof MODES)[number];

/** The tokens in force for a scheme and mode, by the same cascade the page uses. */
function tokensFor(scheme: string, mode: Mode): Tokens {
  const get = (selector: string) => rules.get(selector) ?? {};
  return {
    ...get(':root'),
    ...(mode === 'dark' ? get(":root[data-theme='dark']") : {}),
    ...(scheme !== 'forest' ? get(`:root[data-scheme='${scheme}']`) : {}),
    ...(scheme !== 'forest' && mode === 'dark' ? get(`:root[data-scheme='${scheme}'][data-theme='dark']`) : {}),
  };
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Text pairs: foreground, background, where it is used. All need 4.5 : 1 (WCAG AA for normal text). */
const TEXT_PAIRS: Array<[string, string, string]> = [
  ['ink', 'bg', 'body text on the page'],
  ['ink', 'panel', 'text in cards, the header, dialogs'],
  ['muted', 'bg', 'secondary text on the page'],
  ['muted', 'panel', 'secondary text in cards'],
  ['accent', 'bg', 'links on the page'],
  ['accent', 'panel', 'links in cards, the wordmark'],
  ['accent', 'accent-soft', 'the current navigation item, pills'],
  ['ink', 'accent-soft', 'text on a selected or tinted row'],
  ['muted', 'accent-soft', 'secondary text on a tinted row'],
  ['accent-ink', 'accent', 'text on a primary button'],
  ['crit', 'bg', 'errors on the page'],
  ['crit', 'panel', 'errors and dangerous buttons in cards'],
  ['ok', 'bg', 'good status on the page'],
  ['ok', 'panel', 'good status in cards'],
  ['ok', 'accent-soft', 'a good-status pill (on the accent tint)'],
  ['warn', 'bg', 'warning text on the page'],
  ['warn', 'panel', 'warning text in cards'],
  ['warn', 'warn-soft', 'warning text on its tint'],
  ['crit', 'crit-soft', 'error text on its tint'],
  ['ok', 'ok-soft', 'good-status text on its tint'],
  ['ink', 'amber-soft', 'text in a warning notice'],
  ['ink', 'info-soft', 'text in an information notice'],
  ['muted', 'info-soft', 'secondary text in an information notice'],
];

/**
 * Pairs below 4.5 : 1 that are KNOWN and reported, not changed (the step brief: report a failing pair instead of
 * silently changing a color). Each is listed with the ratio measured when it was found; the test fails if the list is
 * out of date in either direction, so a fix has to remove its line here. All are the good-status pill (--ok text on the
 * accent tint, 13 px semi-bold) in the four light schemes; the dark schemes pass. See the issue linked in the report.
 */
const KNOWN_BELOW_AA: Record<string, number> = {
  'forest light --ok on --accent-soft': 4.4,
  'sand light --ok on --accent-soft': 4.2,
  'slate light --ok on --accent-soft': 4.32,
  'graphite light --ok on --accent-soft': 4.34,
};
const FLOOR = 4.0; // a known pair must not get worse than this

describe('the color schemes in styles.css', () => {
  it('has exactly the four schemes of the shared list, each in light and dark', () => {
    expect(COLOR_SCHEMES).toEqual(['forest', 'sand', 'slate', 'graphite']);
    for (const scheme of COLOR_SCHEMES) {
      for (const mode of MODES) {
        const t = tokensFor(scheme, mode);
        for (const key of ['bg', 'panel', 'ink', 'muted', 'line', 'accent', 'accent-ink', 'accent-soft']) {
          expect(t[key], `${scheme}/${mode} --${key}`).toMatch(/^#[0-9a-f]{6}$/);
        }
      }
    }
    // No scheme in the file that the app does not know.
    const named = [...rules.keys()].flatMap((k) => [...k.matchAll(/data-scheme='([a-z]+)'/g)].map((m) => m[1]));
    expect(new Set(named)).toEqual(new Set(COLOR_SCHEMES.filter((s) => s !== 'forest')));
  });

  it('uses the values of design/kinship-color-schemes.md for each scheme’s page and accent', () => {
    const page = (s: string, m: Mode) => tokensFor(s, m)['bg'];
    expect([page('forest', 'light'), page('forest', 'dark')]).toEqual(['#f6f4ec', '#0e1b19']);
    expect([page('sand', 'light'), page('sand', 'dark')]).toEqual(['#f4efe4', '#1b1812']);
    expect([page('slate', 'light'), page('slate', 'dark')]).toEqual(['#f3f5f9', '#0f1520']);
    expect([page('graphite', 'light'), page('graphite', 'dark')]).toEqual(['#f4f4f2', '#111214']);
    const accent = (s: string, m: Mode) => tokensFor(s, m)['accent'];
    expect([accent('forest', 'light'), accent('forest', 'dark')]).toEqual(['#1e4d4a', '#8cc488']);
    expect([accent('sand', 'light'), accent('sand', 'dark')]).toEqual(['#1e4d4a', '#7fc1b8']);
    expect([accent('slate', 'light'), accent('slate', 'dark')]).toEqual(['#2f4b7c', '#8fb0e8']);
    expect([accent('graphite', 'light'), accent('graphite', 'dark')]).toEqual(['#2a2e35', '#c9ccd2']);
  });

  it('keeps the status colors, the gender colors, the tints and the leaf the same in every scheme', () => {
    const FIXED = [
      'warn',
      'warn-soft',
      'crit',
      'crit-soft',
      'ok',
      'ok-soft',
      'amber',
      'amber-soft',
      'info-soft',
      'leaf',
      'g-male',
      'g-female',
      'g-other',
    ];
    for (const mode of MODES) {
      const forest = tokensFor('forest', mode);
      for (const scheme of COLOR_SCHEMES) {
        const t = tokensFor(scheme, mode);
        for (const key of FIXED) expect(t[key], `${scheme}/${mode} --${key}`).toBe(forest[key]);
      }
    }
  });

  it('draws the leaf in the logo green, light or dark only', () => {
    for (const scheme of COLOR_SCHEMES) {
      expect(tokensFor(scheme, 'light')['leaf']).toBe('#4f8a4b');
      expect(tokensFor(scheme, 'dark')['leaf']).toBe('#8cc488');
    }
  });

  it('sets the CSS color-scheme to the resolved theme', () => {
    expect(tokensFor('forest', 'light')['color-scheme']).toBe('light');
    expect(tokensFor('forest', 'dark')['color-scheme']).toBe('dark');
  });

  it('has no leftover prefers-color-scheme blocks: the theme is data-theme, resolved before the first paint', () => {
    expect(css).not.toMatch(/prefers-color-scheme/);
  });
});

describe('contrast, all 8 scheme and theme combinations', () => {
  for (const scheme of COLOR_SCHEMES) {
    for (const mode of MODES) {
      it(`${scheme} ${mode}: every text pair reaches 4.5 : 1 (apart from the known, reported ones)`, () => {
        const t = tokensFor(scheme, mode);
        const below = TEXT_PAIRS.flatMap(([fg, bg, where]) => {
          const ratio = contrast(t[fg]!, t[bg]!);
          return ratio < 4.5 ? [{ id: `${scheme} ${mode} --${fg} on --${bg}`, ratio, where }] : [];
        });
        const mine = Object.keys(KNOWN_BELOW_AA).filter((id) => id.startsWith(`${scheme} ${mode} `));
        expect(
          below.map((b) => b.id).sort(),
          below.map((b) => `${b.id} (${b.where}): ${b.ratio.toFixed(2)}`).join('\n'),
        ).toEqual(mine.sort());
        for (const b of below) {
          expect(b.ratio, b.id).toBeGreaterThanOrEqual(FLOOR);
          expect(b.ratio, `${b.id} changed: update KNOWN_BELOW_AA`).toBeCloseTo(KNOWN_BELOW_AA[b.id]!, 1);
        }
      });

      it(`${scheme} ${mode}: the focus ring, the gender colors and the leaf reach 3 : 1 as graphics`, () => {
        const t = tokensFor(scheme, mode);
        const failing = (
          [
            ['accent', 'bg'],
            ['accent', 'panel'],
            ['g-male', 'panel'],
            ['g-female', 'panel'],
            ['g-other', 'panel'],
            ['leaf', 'panel'],
            ['leaf', 'bg'],
          ] as const
        ).flatMap(([fg, bg]) => {
          const ratio = contrast(t[fg]!, t[bg]!);
          return ratio < 3 ? [`--${fg} ${t[fg]} on --${bg} ${t[bg]}: ${ratio.toFixed(2)}`] : [];
        });
        expect(failing, failing.join('\n')).toEqual([]);
      });
    }
  }
});

describe('theme-init.js and styles.css agree', () => {
  it('uses each scheme’s own accent for the theme-color meta', () => {
    const script = readFileSync(join(import.meta.dirname, '../public/theme-init.js'), 'utf8');
    const found = [...script.matchAll(/(\w+):\s*\{\s*light:\s*'(#[0-9a-f]{6})',\s*dark:\s*'(#[0-9a-f]{6})'\s*\}/g)];
    expect(found.map((m) => m[1])).toEqual([...COLOR_SCHEMES]);
    for (const [, scheme, light, dark] of found) {
      expect(light, `${scheme} light`).toBe(tokensFor(scheme!, 'light')['accent']);
      expect(dark, `${scheme} dark`).toBe(tokensFor(scheme!, 'dark')['accent']);
    }
  });
});

// The border of a tree card is the only sign of gender (no icon), so the three border colors must tell apart from each
// other, and the selected-state ring (the scheme's accent) from the border it surrounds. Measured as CIEDE2000, the
// usual colour-difference formula: about 10 is "clearly different at a glance", 2 is "only just".
function lab(hex: string): [number, number, number] {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => lin(Number.parseInt(hex.slice(i, i + 2), 16) / 255)) as [
    number,
    number,
    number,
  ];
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
export function deltaE2000(a: string, b: string): number {
  const [L1, a1, b1] = lab(a);
  const [L2, a2, b2] = lab(b);
  const rad = (d: number) => (d * Math.PI) / 180;
  const Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1;
  const ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1);
  const Cp2 = Math.hypot(ap2, b2);
  const hue = (y: number, x: number) => ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  const h1 = hue(b1, ap1);
  const h2 = hue(b2, ap2);
  let dh = h2 - h1;
  if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(rad(dh) / 2);
  const Lb = (L1 + L2) / 2;
  const Cpb = (Cp1 + Cp2) / 2;
  const hb = Math.abs(h1 - h2) > 180 ? (h1 + h2 + (h1 + h2 < 360 ? 360 : -360)) / 2 : (h1 + h2) / 2;
  const T =
    1 -
    0.17 * Math.cos(rad(hb - 30)) +
    0.24 * Math.cos(rad(2 * hb)) +
    0.32 * Math.cos(rad(3 * hb + 6)) -
    0.2 * Math.cos(rad(4 * hb - 63));
  const Rc = 2 * Math.sqrt(Cpb ** 7 / (Cpb ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
  const Sc = 1 + 0.045 * Cpb;
  const Sh = 1 + 0.015 * Cpb * T;
  const Rt = -Math.sin(rad(2 * 30 * Math.exp(-(((hb - 275) / 25) ** 2)))) * Rc;
  const dLs = (L2 - L1) / Sl;
  const dCs = (Cp2 - Cp1) / Sc;
  const dHs = dH / Sh;
  return Math.sqrt(dLs ** 2 + dCs ** 2 + dHs ** 2 + Rt * dCs * dHs);
}

/** The selected ring against the border it surrounds, below 15, found and reported (not changed): see the PR. */
const KNOWN_RING_CLOSE: Record<string, number> = {
  'sand dark ring vs --g-other': 14,
  'slate light ring vs --g-male': 13,
  'slate dark ring vs --g-male': 4,
};

describe('the card border colors in all 8 scheme and theme combinations', () => {
  for (const scheme of COLOR_SCHEMES) {
    for (const mode of MODES) {
      it(`${scheme} ${mode}: male, female and other/unknown differ from each other`, () => {
        const t = tokensFor(scheme, mode);
        for (const [a, b] of [
          ['g-male', 'g-female'],
          ['g-male', 'g-other'],
          ['g-female', 'g-other'],
        ] as const) {
          expect(deltaE2000(t[a]!, t[b]!), `--${a} vs --${b}`).toBeGreaterThanOrEqual(20);
        }
      });

      it(`${scheme} ${mode}: the selected ring differs from each border (apart from the known, reported ones)`, () => {
        const t = tokensFor(scheme, mode);
        const close: Record<string, number> = {};
        for (const border of ['g-male', 'g-female', 'g-other']) {
          const d = deltaE2000(t['accent']!, t[border]!);
          if (d < 15) close[`${scheme} ${mode} ring vs --${border}`] = Math.round(d);
        }
        const mine = Object.fromEntries(
          Object.entries(KNOWN_RING_CLOSE).filter(([id]) => id.startsWith(`${scheme} ${mode} `)),
        );
        expect(close).toEqual(mine);
      });
    }
  }
});
