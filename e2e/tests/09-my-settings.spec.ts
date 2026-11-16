// SPDX-License-Identifier: AGPL-3.0-or-later
// Journey 9: My settings. The SuperAdmin chooses Slate blue, Dark, ISO dates and birth names; the page, a profile date and
// a name follow at once, survive a reload, and show up in a second browser that has never seen the account; a Member's
// changes never touch the admin's; the login page keeps the look after sign-out. Fictional Hale-style data only.
import type { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test';
import { createPerson } from '../support/api.js';
import type { Made } from '../support/api.js';
import { surname, uniq } from '../support/data.js';
import { expect, test } from '../support/fixtures.js';
import { createAccount } from '../support/accounts.js';
import { BASE_URL } from '../support/stack.js';

test.describe.configure({ mode: 'serial' });

const mendez = surname('Mendez');
const married = `${mendez} Hale`;
let rosa: Made;
let admin: Page;
let adminContext: BrowserContext;

/** The attributes the page has when the HTML has been parsed, before anything else runs: the no-flash proxy. */
const RECORD_ATTRIBUTES_AT_DOMCONTENTLOADED = () => {
  document.addEventListener('DOMContentLoaded', () => {
    (window as unknown as { __atDcl: string[] }).__atDcl = [
      document.documentElement.getAttribute('data-scheme') ?? '',
      document.documentElement.getAttribute('data-theme') ?? '',
    ];
  });
};
const attributes = (page: Page) =>
  page.evaluate(() => [
    document.documentElement.getAttribute('data-scheme'),
    document.documentElement.getAttribute('data-theme'),
  ]);

test.beforeAll(async ({ browser, adminCookies }) => {
  adminContext = await browser.newContext({ baseURL: BASE_URL });
  await adminContext.addCookies(adminCookies);
  admin = await adminContext.newPage();
  await admin.addInitScript(RECORD_ATTRIBUTES_AT_DOMCONTENTLOADED);
});
test.afterAll(async () => {
  // Leave the admin's settings as they were, for anything that runs after this file.
  await admin.request.patch('/api/auth/me', {
    headers: { 'X-KinShip-Request': '1', Origin: BASE_URL },
    data: { colorScheme: 'forest', theme: 'device', dateFormat: 'mdy', surnameChoice: 'married' },
  });
  await adminContext.close();
});

test('Rosa has a birth surname and a married surname, and the defaults show the married one and "Jun 4, 1934"', async () => {
  rosa = await createPerson(admin.request, {
    givenName: 'Rosa',
    surname: mendez,
    marriedSurname: married,
    gender: 'female',
    birth: '1934-06-04',
  });
  await admin.goto(`/people/${rosa.id}`);
  await expect(admin.getByRole('heading', { level: 1, name: `Rosa ${married}` })).toBeVisible();
  await expect(admin.getByText('Jun 4, 1934', { exact: true })).toBeVisible();
  expect(await attributes(admin)).toEqual(['forest', expect.stringMatching(/^(light|dark)$/)]);
});

test('choosing Slate blue, Dark, ISO and birth names in My settings changes the page, a date and a name at once', async () => {
  const page = admin;
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'My settings' }).click();
  await expect(page.getByRole('heading', { name: 'My settings' })).toBeVisible();

  await page.getByRole('radio', { name: 'Slate blue' }).click();
  await page.getByLabel('Theme').selectOption('dark');
  await page.getByLabel('Date format').selectOption('iso');
  await page.getByLabel('Which surname shows').selectOption('birth');
  await expect(page.getByRole('radio', { name: 'Slate blue' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText(/Example: 2026-03-09\./)).toBeVisible();
  await expect.poll(() => attributes(page)).toEqual(['slate', 'dark']);

  await page.goto(`/people/${rosa.id}`);
  await expect(page.getByRole('heading', { level: 1, name: `Rosa ${mendez}` })).toBeVisible();
  await expect(page.getByText('1934-06-04', { exact: true })).toBeVisible();
  await expect(page.getByText('Jun 4, 1934')).toHaveCount(0);
});

test('a reload keeps all of it, and the scheme was on the page before anything else ran', async () => {
  const page = admin;
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: `Rosa ${mendez}` })).toBeVisible();
  await expect(page.getByText('1934-06-04', { exact: true })).toBeVisible();
  expect(await attributes(page)).toEqual(['slate', 'dark']);
  // No-flash proxy: at DOMContentLoaded, before the app has started, the attributes were already the account's.
  expect(await page.evaluate(() => (window as unknown as { __atDcl: string[] }).__atDcl)).toEqual(['slate', 'dark']);
  // And the page is really drawn in Slate dark (its page color is #0f1520).
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(15, 21, 32)');
});

test('a second browser that has never seen the account gets the same settings from the account', async ({
  browser,
  adminCookies,
}) => {
  const other = await browser.newContext({ baseURL: BASE_URL });
  await other.addCookies(adminCookies);
  const page = await other.newPage();
  await page.goto(`/people/${rosa.id}`);
  await expect(page.getByRole('heading', { level: 1, name: `Rosa ${mendez}` })).toBeVisible();
  await expect(page.getByText('1934-06-04', { exact: true })).toBeVisible();
  await expect.poll(() => attributes(page)).toEqual(['slate', 'dark']);
  // Its browser mirror was written from the account.
  expect(await page.evaluate(() => window.localStorage.getItem('kinship.display'))).toBe(
    JSON.stringify({ colorScheme: 'slate', theme: 'dark' }),
  );
  await other.close();
});

async function signInAsMember(browser: Browser, adminApi: APIRequestContext) {
  // Invited by the admin and accepted over the API; the accepted link signs the account in.
  const account = await createAccount(adminApi, {
    email: `settings-${uniq()}@hale.example`,
    role: 'member',
    displayName: 'Mara Settings',
  });
  const context = await browser.newContext({ baseURL: BASE_URL });
  await context.addCookies(account.cookies);
  const page = await context.newPage();
  await page.addInitScript(RECORD_ATTRIBUTES_AT_DOMCONTENTLOADED);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome, Mara Settings' })).toBeVisible();
  return { context, page };
}

test('a Member changes only their own settings; the admin keeps theirs; the login page keeps the Member’s look after sign-out', async ({
  browser,
  adminApi,
}) => {
  const { context, page } = await signInAsMember(browser, adminApi);
  // A new account starts with the defaults.
  expect((await attributes(page))[0]).toBe('forest');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'My settings' }).click();
  await page.getByRole('radio', { name: 'Graphite' }).click();
  await page.getByLabel('Theme').selectOption('light');
  await page.getByLabel('Date format').selectOption('long');
  await expect.poll(() => attributes(page)).toEqual(['graphite', 'light']);

  // The admin's own account is untouched, in the page and on the server.
  const me = await admin.request.get('/api/auth/me');
  expect((await me.json()).user).toMatchObject({
    colorScheme: 'slate',
    theme: 'dark',
    dateFormat: 'iso',
    surnameChoice: 'birth',
  });
  await admin.reload();
  expect(await attributes(admin)).toEqual(['slate', 'dark']);

  // Signing out keeps the Member's look on the login page, from the first moment the page exists.
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect(await attributes(page)).toEqual(['graphite', 'light']);
  await page.reload();
  expect(await page.evaluate(() => (window as unknown as { __atDcl: string[] }).__atDcl)).toEqual([
    'graphite',
    'light',
  ]);
  await context.close();
});
