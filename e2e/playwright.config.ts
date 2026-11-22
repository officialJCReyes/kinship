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
      // Every journey except 15, which is the Restore and has its own project below.
      testMatch: /(0[2-9]|1[0-4]|1[6-9]|[2-9][0-9])-.*\.spec\.ts/,
      dependencies: ['first-run'],
      use: { ...devices['Desktop Chrome'] },
    },
    // The Restore replaces the database, signs everyone out and restarts the api, so it runs LAST, and never retries: a second
    // attempt would run against a half-restored stack and report a failure that is not the real one.
    {
      name: 'restore',
      testMatch: /15-restore\.spec\.ts/,
      retries: 0,
      dependencies: ['journeys'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
