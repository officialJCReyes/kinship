// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test as base } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { signIn } from './api.js';
import { ADMIN, password } from './data.js';

export { expect };

export const test = base.extend<{ adminPage: Page }>({
  /** A page signed in as the SuperAdmin made by the first-run journey. */
  adminPage: async ({ page }, use) => {
    await signIn(page, ADMIN.email, password());
    await use(page);
  },
});

/** Presses Tab until the element has focus, as a keyboard user would. Fails after `max` presses. */
export async function tabTo(page: Page, target: Locator, max = 60): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}
