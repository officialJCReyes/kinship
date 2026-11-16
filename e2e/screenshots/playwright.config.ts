// SPDX-License-Identifier: AGPL-3.0-or-later
// Takes the README screenshots. Run on demand, never in CI:  pnpm --filter @kinship/e2e screenshots
import { defineConfig, devices } from '@playwright/test';
import { BASE_URL } from '../support/stack.js';

export default defineConfig({
  testDir: '.',
  testMatch: /screenshots\.spec\.ts/,
  outputDir: '../artifacts/screenshot-results',
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  globalSetup: '../support/global-setup.ts',
  globalTeardown: '../support/global-teardown.ts',
  use: {
    baseURL: BASE_URL,
    ...devices['Desktop Chrome'],
    viewport: { width: 1200, height: 760 },
    // Twice the pixels, so names on the chart stay readable when the README scales the picture down.
    deviceScaleFactor: 2,
  },
});
