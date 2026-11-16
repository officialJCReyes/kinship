// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Applies the account's color scheme and theme BEFORE the first paint, on every page including /login and /setup.
// It is a plain same-origin script (the nginx Content-Security-Policy has no inline scripts) loaded synchronously in
// <head>. It reads {colorScheme, theme} from the browser's mirror of the account's settings, resolves "device" to
// light or dark with matchMedia, sets data-scheme and data-theme on <html> (styles.css does the rest), follows the
// device while the page is open, and keeps the theme-color meta in step with the scheme's accent.
//
// The ACCOUNT is the source of truth: the app calls window.kinshipTheme.apply(settings, true) whenever it learns the
// account's settings (sign-in, /api/auth/me, a save), which rewrites the mirror. The mirror survives sign-out so the
// login page keeps the look. It holds two cosmetic words and nothing private.
/* global window, document */
(function () {
  'use strict';
  var KEY = 'kinship.display';
  var SCHEMES = ['forest', 'sand', 'slate', 'graphite'];
  var THEMES = ['device', 'light', 'dark'];
  // The accent of each scheme in light and dark (for theme-color). test/theme.test.ts checks these against styles.css.
  var ACCENT = {
    forest: { light: '#1e4d4a', dark: '#8cc488' },
    sand: { light: '#1e4d4a', dark: '#7fc1b8' },
    slate: { light: '#2f4b7c', dark: '#8fb0e8' },
    graphite: { light: '#2a2e35', dark: '#c9ccd2' },
  };
  var root = document.documentElement;
  var current = { colorScheme: 'forest', theme: 'device' };
  var query = null;

  function readMirror() {
    try {
      var saved = JSON.parse(window.localStorage.getItem(KEY) || 'null');
      return saved && typeof saved === 'object' ? saved : {};
    } catch {
      return {};
    }
  }

  function writeMirror() {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(current));
    } catch {
      // Private window, or storage blocked: the account still decides on the next load.
    }
  }

  function deviceIsDark() {
    return Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function resolved() {
    if (current.theme === 'light' || current.theme === 'dark') return current.theme;
    return deviceIsDark() ? 'dark' : 'light';
  }

  function paint() {
    var mode = resolved();
    root.setAttribute('data-scheme', current.colorScheme);
    root.setAttribute('data-theme', mode);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', ACCENT[current.colorScheme][mode]);
  }

  function follow() {
    if (!window.matchMedia) return;
    if (!query) {
      query = window.matchMedia('(prefers-color-scheme: dark)');
      var onChange = function () {
        if (current.theme === 'device') paint();
      };
      if (query.addEventListener) query.addEventListener('change', onChange);
      else if (query.addListener) query.addListener(onChange);
    }
  }

  function apply(settings, persist) {
    var next = settings || {};
    if (SCHEMES.indexOf(next.colorScheme) !== -1) current.colorScheme = next.colorScheme;
    if (THEMES.indexOf(next.theme) !== -1) current.theme = next.theme;
    paint();
    follow();
    if (persist) writeMirror();
  }

  window.kinshipTheme = {
    apply: apply,
    current: function () {
      return { colorScheme: current.colorScheme, theme: current.theme };
    },
  };
  apply(readMirror(), false);
})();
