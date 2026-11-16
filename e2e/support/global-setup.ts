// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomBytes } from 'node:crypto';
import { readSetupToken, startStack } from './stack.js';

export default function globalSetup(): void {
  startStack();
  // Passed to the tests through the environment. Throwaway: made fresh for every run.
  process.env['E2E_SETUP_TOKEN'] = readSetupToken();
  process.env['E2E_PASSWORD'] = `e2e-${randomBytes(12).toString('hex')}`;
}
