// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test as base } from '@playwright/test';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { signIn } from './api.js';
import { ADMIN, password } from './data.js';
import { BASE_URL } from './stack.js';

export { expect };

type Cookies = Parameters<BrowserContext['addCookies']>[0];

export const test = base.extend<{ adminPage: Page }, { adminCookies: Cookies }>({
  /**
   * The SuperAdmin's session cookies, signed in ONCE per worker. The sign-in route allows 30 requests a minute for
   * the whole run, and a sign-in per test used to bring the suite close to that.
   */
  adminCookies: [
    async ({ browser }, use) => {
      const context = await browser.newContext({ baseURL: BASE_URL });
      await signIn(await context.newPage(), ADMIN.email, password());
      const cookies = await context.cookies();
      await context.close();
      await use(cookies);
    },
    { scope: 'worker' },
  ],
  /** A page signed in as the SuperAdmin made by the first-run journey. */
  adminPage: async ({ page, adminCookies }, use) => {
    await page.context().addCookies(adminCookies);
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
