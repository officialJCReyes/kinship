// SPDX-License-Identifier: AGPL-3.0-or-later
import { stopStack } from './stack.js';

export default function globalTeardown(): void {
  stopStack();
}
