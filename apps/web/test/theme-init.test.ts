// SPDX-License-Identifier: AGPL-3.0-or-later
//
// public/theme-init.js, the script that sets the color scheme and theme before the first paint, run the way the browser
// runs it (a classic script, before React).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SCRIPT = readFileSync(join(import.meta.dirname, '../public/theme-init.js'), 'utf8');
const KEY = 'kinship.display';
const root = document.documentElement;

interface Device {
  dark: boolean;
  listeners: Array<() => void>;
}
let device: Device;

function installMatchMedia() {
  device = { dark: false, listeners: [] };
  window.matchMedia = vi.fn(() => ({
    get matches() {
      return device.dark;
    },
    addEventListener: (_type: string, listener: () => void) => device.listeners.push(listener),
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}
/** Runs the script once, as the browser does when it meets <script src="/theme-init.js"> in <head>. */
function run() {
  new Function(SCRIPT)();
}
const attrs = () => [root.getAttribute('data-scheme'), root.getAttribute('data-theme')];
const meta = () => document.querySelector('meta[name="theme-color"]')?.getAttribute('content');

beforeEach(() => {
  window.localStorage.clear();
  root.removeAttribute('data-scheme');
  root.removeAttribute('data-theme');
  document.head.innerHTML = '<meta name="theme-color" content="#1E4D4A" />';
  installMatchMedia();
});
afterEach(() => {
  window.localStorage.clear();
  delete (window as { matchMedia?: unknown }).matchMedia;
  run(); // leave the page as the other tests expect it: defaults
});

describe('theme-init.js', () => {
  it('uses Forest, following the device, when the browser has no mirror yet', () => {
    run();
    expect(attrs()).toEqual(['forest', 'light']);
    device.dark = true;
    root.removeAttribute('data-theme');
    run();
    expect(attrs()).toEqual(['forest', 'dark']);
  });

  it('applies the mirror of the account’s settings at once', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ colorScheme: 'slate', theme: 'dark' }));
    run();
    expect(attrs()).toEqual(['slate', 'dark']);
    expect(window.kinshipTheme?.current()).toEqual({ colorScheme: 'slate', theme: 'dark' });
  });

  it('resolves Device with the device, and an explicit Light or Dark beats the device', () => {
    device.dark = true;
    window.localStorage.setItem(KEY, JSON.stringify({ colorScheme: 'sand', theme: 'device' }));
    run();
    expect(attrs()).toEqual(['sand', 'dark']);
    window.localStorage.setItem(KEY, JSON.stringify({ colorScheme: 'sand', theme: 'light' }));
    run();
    expect(attrs()).toEqual(['sand', 'light']);
  });

  it('follows the device while the page is open, but only for Device', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ colorScheme: 'graphite', theme: 'device' }));
    run();
    expect(attrs()[1]).toBe('light');
    device.dark = true;
    for (const listener of device.listeners) listener();
    expect(attrs()[1]).toBe('dark');
    window.kinshipTheme?.apply({ theme: 'light' }, false);
    device.dark = false;
    device.dark = true;
    for (const listener of device.listeners) listener();
    expect(attrs()[1]).toBe('light');
  });

  it('ignores a mirror that is not what it should be, and a browser that blocks storage', () => {
    for (const bad of ['not json', '[1,2]', 'null', '{"colorScheme":"neon","theme":"sepia"}', '{"colorScheme":5}']) {
      window.localStorage.setItem(KEY, bad);
      root.removeAttribute('data-scheme');
      expect(() => run(), bad).not.toThrow();
      expect(attrs(), bad).toEqual(['forest', 'light']);
    }
    const blocked = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => run()).not.toThrow();
    expect(attrs()).toEqual(['forest', 'light']);
    const blockedSet = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => window.kinshipTheme?.apply({ colorScheme: 'slate' }, true)).not.toThrow();
    expect(attrs()[0]).toBe('slate');
    blocked.mockRestore();
    blockedSet.mockRestore();
  });

  it('rewrites the mirror only when asked to (the account is the source of truth), and keeps what it was not told', () => {
    run();
    window.kinshipTheme?.apply({ colorScheme: 'slate', theme: 'dark' }, false);
    expect(window.localStorage.getItem(KEY)).toBeNull();
    window.kinshipTheme?.apply({ colorScheme: 'sand', theme: 'dark' }, true);
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual({ colorScheme: 'sand', theme: 'dark' });
    window.kinshipTheme?.apply({ theme: 'light' }, true);
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual({ colorScheme: 'sand', theme: 'light' });
    window.kinshipTheme?.apply({ colorScheme: 'neon', theme: 'sepia' }, true);
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual({ colorScheme: 'sand', theme: 'light' });
  });

  it('sets the theme-color meta to the scheme’s accent for the resolved theme', () => {
    window.kinshipTheme?.apply({ colorScheme: 'slate', theme: 'light' }, false);
    expect(meta()).toBe('#2f4b7c');
    window.kinshipTheme?.apply({ colorScheme: 'slate', theme: 'dark' }, false);
    expect(meta()).toBe('#8fb0e8');
    window.kinshipTheme?.apply({ colorScheme: 'sand', theme: 'dark' }, false);
    expect(meta()).toBe('#7fc1b8');
  });

  it('works where matchMedia does not exist', () => {
    delete (window as { matchMedia?: unknown }).matchMedia;
    expect(() => run()).not.toThrow();
    expect(attrs()).toEqual(['forest', 'light']);
  });
});

describe('how the page loads the script', () => {
  const page = new DOMParser().parseFromString(
    readFileSync(join(import.meta.dirname, '../index.html'), 'utf8'),
    'text/html',
  );

  it('loads it from <head>, synchronously, from the same origin, before the app', () => {
    const tag = page.head.querySelector('script[src="/theme-init.js"]');
    expect(tag, 'a <script src="/theme-init.js"> in <head>').not.toBeNull();
    // Plain and blocking: nothing but src, so it runs before the first paint.
    expect([...tag!.attributes].map((a) => a.name)).toEqual(['src']);
    const app = page.querySelector('script[type="module"]');
    expect(app?.getAttribute('src')).toBe('/src/main.tsx');
    expect(tag!.compareDocumentPosition(app!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('has no inline script anywhere (the CSP allows only same-origin scripts)', () => {
    const scripts = [...page.querySelectorAll('script')];
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) {
      expect(script.getAttribute('src'), 'every script has a src').toMatch(/^\//);
      expect(script.textContent?.trim(), 'and no body').toBe('');
    }
  });
});
