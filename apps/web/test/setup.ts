// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { leaveMaintenance } from '../src/lib/maintenance.js';
import { forgetLegendOpen } from '../src/tree/remember.js';

// The real public/theme-init.js, loaded the way the browser does before React starts (jsdom has no matchMedia, so
// the device counts as light unless a test says otherwise).
new Function(readFileSync(join(import.meta.dirname, '../public/theme-init.js'), 'utf8'))();

afterEach(() => {
  // A test that started a restore leaves the app on the maintenance page: the next test must start on a normal one.
  leaveMaintenance();
  cleanup();
  // The legend's open-or-closed choice is also held in memory (for blocked storage): every test starts from "never chosen".
  forgetLegendOpen();
});
