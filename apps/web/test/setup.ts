// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// The real public/theme-init.js, loaded the way the browser does before React starts (jsdom has no matchMedia, so
// the device counts as light unless a test says otherwise).
new Function(readFileSync(join(import.meta.dirname, '../public/theme-init.js'), 'utf8'))();

afterEach(() => {
  cleanup();
});
