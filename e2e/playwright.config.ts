// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig, devices } from '@playwright/test';
import { BASE_URL } from './support/stack.js';

const ci = Boolean(process.env['CI']);

export default defineConfig({
  testDir: './tests',
  outputDir: './artifacts/test-results',
  // The tests share one stack and one database, so they run one at a time, in file order.
  fullyParallel: false,
  workers: 1,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: ci ? [['list'], ['html', { open: 'never', outputFolder: 'artifacts/report' }]] : 'list',
  globalSetup: './support/global-setup.ts',
  globalTeardown: './support/global-teardown.ts',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // No fixed sleeps anywhere: tests wait for something to become visible.
    actionTimeout: 7_000,
  },
  projects: [
    // First run consumes the one-time setup token, so it never retries and everything else waits for it.
    { name: 'first-run', testMatch: /01-first-run\.spec\.ts/, retries: 0, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'journeys',
      testMatch: /0[2-9]-.*\.spec\.ts/,
      dependencies: ['first-run'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
