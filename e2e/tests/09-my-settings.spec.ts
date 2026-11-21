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
    data: {
      colorScheme: 'forest',
      theme: 'device',
      dateFormat: 'mdy',
      nameForm: 'maiden_married',
      showPrefix: true,
      showSuffix: true,
    },
  });
  await adminContext.close();
});

test('Rosa has a birth surname and a married surname, and the defaults show "Maiden name (Married name)" and "Jun 4, 1934"', async () => {
  rosa = await createPerson(admin.request, {
    givenName: 'Rosa',
    surname: mendez,
    marriedSurname: married,
    gender: 'female',
    birth: '1934-06-04',
  });
  await admin.goto(`/people/${rosa.id}`);
  await expect(admin.getByRole('heading', { level: 1, name: `Rosa ${mendez} (Hale)` })).toBeVisible();
  await expect(admin.getByText('Jun 4, 1934', { exact: true })).toBeVisible();
  expect(await attributes(admin)).toEqual(['forest', expect.stringMatching(/^(light|dark)$/)]);
});

test('choosing Slate blue, Dark, ISO and maiden names in My settings changes the page, a date and a name at once', async () => {
  const page = admin;
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'My settings' }).click();
  await expect(page.getByRole('heading', { name: 'My settings' })).toBeVisible();

  await page.getByRole('radio', { name: 'Slate blue' }).click();
  await page.getByLabel('Theme').selectOption('dark');
  await page.getByLabel('Date format').selectOption('iso');
  await page.getByLabel('How to show married women’s names').selectOption('maiden');
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
    nameForm: 'maiden',
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

test('the Names card: the four forms and the prefix and suffix switches change a name on the profile', async () => {
  const page = admin;
  const patched = await page.request.patch(`/api/people/${rosa.id}`, {
    headers: { 'X-KinShip-Request': '1', Origin: BASE_URL },
    data: { namePrefix: 'Dr.', nameSuffix: 'Jr.' },
  });
  expect(patched.status()).toBe(200);
  const heading = async (name: string) => {
    await page.goto(`/people/${rosa.id}`);
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  };
  const choose = async (form: string) => {
    await page.goto('/settings');
    await page.getByLabel('How to show married women’s names').selectOption(form);
    await expect(page.getByText('Saved.')).toBeAttached();
  };

  await choose('maiden_married');
  await heading(`Dr. Rosa ${mendez} (Hale) Jr.`);
  await choose('married_born');
  await heading(`Dr. Rosa ${married} (born ${mendez}) Jr.`);
  await choose('married');
  await heading(`Dr. Rosa ${married} Jr.`);

  // The switches: prefixes off, then suffixes off.
  await page.goto('/settings');
  await page.getByLabel('Show prefixes (Dr., Sir)').click();
  await expect(page.getByLabel('Show prefixes (Dr., Sir)')).not.toBeChecked();
  await heading(`Rosa ${married} Jr.`);
  await page.goto('/settings');
  await page.getByLabel('Show suffixes (Jr., II)').click();
  await expect(page.getByLabel('Show suffixes (Jr., II)')).not.toBeChecked();
  await heading(`Rosa ${married}`);
  // The profile's Facts still list them: they are the person's data, not a display choice.
  await expect(page.locator('dl.facts').first().getByText('Prefix', { exact: true })).toBeVisible();
  await expect(page.locator('dl.facts').first().getByText('Suffix', { exact: true })).toBeVisible();
});

test('the chart’s gear shows the same Names settings as My settings, and a change in one is seen in the other', async () => {
  const page = admin;
  const api = { headers: { 'X-KinShip-Request': '1', Origin: BASE_URL } };
  try {
    // The test before left the account on "Married name" with prefixes and suffixes off.
    await page.goto(`/tree/${rosa.id}`);
    await page.getByRole('button', { name: 'Chart settings' }).click();
    const panel = page.getByRole('group', { name: 'Chart settings' });
    await panel.getByRole('button', { name: /Names/ }).click();
    await expect(panel.getByRole('radio', { name: 'Married name', exact: true })).toBeChecked();
    await expect(panel.getByRole('switch', { name: 'Show prefixes (Dr., Sir)' })).not.toBeChecked();
    await expect(panel.getByRole('switch', { name: 'Show suffixes (Jr., II)' })).not.toBeChecked();
    // A change in the gear: the panel stays open, and My settings has the same value.
    await panel.getByRole('radio', { name: 'Maiden name', exact: true }).check();
    await panel.getByRole('switch', { name: 'Show suffixes (Jr., II)' }).check();
    await expect(page.getByRole('group', { name: 'Chart settings' })).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(`^Rosa ${mendez} Jr\\.`) })).toBeVisible();
    await page.goto('/settings');
    await expect(page.getByLabel('How to show married women’s names')).toHaveValue('maiden');
    await expect(page.getByLabel('Show suffixes (Jr., II)')).toBeChecked();
    // And the other way: My settings changes what the gear shows.
    await page.getByLabel('How to show married women’s names').selectOption('married_born');
    await expect(page.getByText('Saved.')).toBeAttached();
    await page.goto(`/tree/${rosa.id}`);
    await page.getByRole('button', { name: 'Chart settings' }).click();
    await page.getByRole('group', { name: 'Chart settings' }).getByRole('button', { name: /Names/ }).click();
    await expect(
      page
        .getByRole('group', { name: 'Chart settings' })
        .getByRole('radio', { name: 'Married name (born Maiden name)' }),
    ).toBeChecked();
  } finally {
    // The defaults again, so the journeys after this one start from them.
    const restored = await page.request.patch('/api/auth/me', {
      ...api,
      data: { nameForm: 'maiden_married', showPrefix: true, showSuffix: true },
    });
    expect(restored.status()).toBe(200);
  }
});
