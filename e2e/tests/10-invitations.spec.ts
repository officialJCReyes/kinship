// SPDX-License-Identifier: AGPL-3.0-or-later
// Journey 10: invitations by copied link, and passwords. The SuperAdmin invites a Member linked to a person and copies the
// link; the invitee opens it in a second browser (no sign-in), accepts, and finds what a Member can and cannot do. The
// Member changes their password and their other browser is signed out. The SuperAdmin then makes a set-password link, and
// the account shows that an admin set it. Fictional Hale-style data only.
import type { BrowserContext, Page } from '@playwright/test';
import { createPerson } from '../support/api.js';
import type { Made } from '../support/api.js';
import { ADMIN, password, surname, uniq } from '../support/data.js';
import { expect, test } from '../support/fixtures.js';
import { apiLog, BASE_URL, webLog } from '../support/stack.js';

test.describe.configure({ mode: 'serial' });

const family = surname('Okafor');
const email = `nina-${uniq()}@hale.example`;
const NEW_PASSWORD = `new-${uniq()}-passphrase-${uniq()}`;
const RESET_PASSWORD = `reset-${uniq()}-passphrase-${uniq()}`;
let otto: Made;
let inviteLink = '';
let resetLink = '';
const tokens = () => [inviteLink, resetLink].filter(Boolean).map((link) => link.split('#')[1] ?? '');

let invitee: BrowserContext;
let invitee2: BrowserContext;

test.afterAll(async () => {
  await invitee?.close();
  await invitee2?.close();
});

async function newBrowser(
  browser: import('@playwright/test').Browser,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  return { context, page: await context.newPage() };
}

test('an admin invites a Member linked to a person, and copies the link', async ({ adminPage: page }) => {
  await createPerson(page.request, { givenName: 'Nina', surname: family, gender: 'female', birth: '1990' });
  otto = await createPerson(page.request, { givenName: 'Otto', surname: family, gender: 'male', birth: '1950' });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE_URL });

  await page.goto('/');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Admin' }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  await expect(page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link')).toHaveText([
    'Users',
    'Backups',
  ]);

  await page.getByRole('button', { name: 'Invite user' }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite a user' });
  await dialog.getByLabel('Email address').fill(email);
  await dialog.getByLabel('Role').selectOption('member');
  // A Member with nobody linked can only read: the dialog says so, and the warning goes once a person is chosen.
  await expect(dialog.getByRole('note')).toContainText('can only read the tree');
  await dialog.getByRole('combobox', { name: 'Link to a person on the tree (optional)' }).fill(`Nina ${family}`);
  await dialog.getByRole('option', { name: new RegExp(`Nina ${family}`) }).click();
  await expect(dialog.getByRole('note')).toHaveCount(0);
  await dialog.getByLabel('Personal note (optional)').fill('Welcome, Nina!');
  await dialog.getByRole('button', { name: 'Create invitation link' }).click();

  const linkDialog = page.getByRole('dialog', { name: `Invitation link for ${email}` });
  inviteLink = await linkDialog.getByLabel('Link').inputValue();
  expect(inviteLink).toMatch(new RegExp(`^${BASE_URL}/invite#[A-Za-z0-9_-]{40,}$`));
  await expect(linkDialog).toContainText('shown only now');
  await linkDialog.getByRole('button', { name: 'Copy link' }).click();
  await expect(linkDialog.getByText('Copied.')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(inviteLink);
  await linkDialog.getByRole('button', { name: 'Done' }).click();

  const row = page.getByRole('row', { name: new RegExp(email) });
  await expect(row).toContainText('Invited');
  await expect(row).toContainText('Note: Welcome, Nina!');
  await expect(row).toContainText(`Nina ${family}`);
  // The link is not on the page any more, and cannot be shown again.
  await expect(page.getByText(inviteLink.split('#')[1] ?? 'x')).toHaveCount(0);
});

test('the invitee opens it in a second browser, accepts, and lands signed in as a Member', async ({ browser }) => {
  const second = await newBrowser(browser);
  invitee = second.context;
  const page = second.page;
  await page.goto(inviteLink);
  // The secret is out of the address bar at once.
  await expect(page.getByRole('heading', { name: 'You are invited to the Hale Family tree' })).toBeVisible();
  expect(page.url()).toBe(`${BASE_URL}/invite`);
  await expect(page.getByText(`${ADMIN.displayName} invited you.`)).toBeVisible();
  await expect(page.getByText('Your role: Member.')).toBeVisible();
  await expect(page.getByText(`linked to Nina ${family} on the tree`)).toBeVisible();
  await expect(page.getByText('Welcome, Nina!')).toBeVisible();
  await expect(page.getByLabel('Your name')).toHaveCount(0);

  await page.getByLabel('Choose a password').fill(password());
  await page.getByLabel('Type the password again').fill(password());
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(page.getByRole('heading', { name: `Welcome, Nina ${family}` })).toBeVisible();

  // What a Member can do: edit their own person, add children under themselves. What they cannot: anyone else, Admin.
  await page.getByRole('link', { name: 'Open my profile' }).click();
  await expect(page.getByRole('button', { name: 'Edit details' })).not.toHaveAttribute('aria-disabled', 'true');
  await page.goto(`/people/${otto.id}`);
  await expect(page.getByRole('button', { name: 'Edit details' })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('button', { name: 'Delete person' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Account menu' }).click();
  await expect(page.getByRole('menuitem', { name: 'Admin' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  expect((await page.request.get('/api/admin/accounts')).status()).toBe(403);

  // Their record: the password was chosen when the invitation was accepted.
  await page.goto('/settings');
  await expect(page.getByText(/Password last changed .*, when the invitation was accepted/)).toBeVisible();
});

test('a used link, and a link made up, show the same screen', async ({ browser }) => {
  const { context, page } = await newBrowser(browser);
  await page.goto(inviteLink);
  await expect(page.getByRole('heading', { name: 'This link does not work' })).toBeVisible();
  expect(page.url()).toBe(`${BASE_URL}/invite`);
  await page.goto(`${BASE_URL}/invite#${'x'.repeat(43)}`);
  await expect(page.getByRole('heading', { name: 'This link does not work' })).toBeVisible();
  await page.goto(`${BASE_URL}/reset`);
  await expect(page.getByRole('heading', { name: 'This link does not work' })).toBeVisible();
  await context.close();
});

test('the admin sees the new account, then the Member changes their password and the other browser is signed out', async ({
  adminPage: admin,
  browser,
}) => {
  await admin.goto('/admin/users');
  const row = admin.getByRole('row', { name: new RegExp(email) });
  await expect(row).toContainText('Active');
  await expect(row).toContainText(`Invited by ${ADMIN.displayName}`);
  await expect(row.getByRole('link', { name: `Nina ${family}` })).toBeVisible();
  await expect(row).not.toContainText('Never');

  // A second browser for the same Member, signed in with the password.
  const second = await newBrowser(browser);
  invitee2 = second.context;
  await second.page.goto('/login');
  await second.page.getByLabel('Email').fill(email);
  await second.page.getByLabel('Password').fill(password());
  await second.page.getByRole('button', { name: 'Sign in' }).click();
  await expect(second.page.getByRole('heading', { name: `Welcome, Nina ${family}` })).toBeVisible();

  const page = invitee.pages()[0] as Page;
  await page.goto('/settings');
  const form = page.getByRole('form', { name: 'Change password' });
  await form.getByLabel('Current password', { exact: true }).fill('not the password');
  await form.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
  await form.getByLabel('Type the new password again').fill(NEW_PASSWORD);
  await form.getByRole('button', { name: 'Change password' }).click();
  await expect(form.getByText('The current password is not right.')).toBeVisible();
  await form.getByLabel('Current password', { exact: true }).fill(password());
  await form.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Your password was changed. Every other device was signed out.')).toBeVisible();
  await expect(page.getByText(/Password last changed .*, by the account owner/)).toBeVisible();

  // This browser stays signed in (on a new session); the other one is signed out.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'My settings' })).toBeVisible();
  await second.page.reload();
  await expect(second.page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await second.page.getByLabel('Email').fill(email);
  await second.page.getByLabel('Password').fill(password());
  await second.page.getByRole('button', { name: 'Sign in' }).click();
  await expect(second.page.getByText('The email or password is not correct.')).toBeVisible();
  await second.page.getByLabel('Password').fill(NEW_PASSWORD);
  await second.page.getByRole('button', { name: 'Sign in' }).click();
  await expect(second.page.getByRole('heading', { name: `Welcome, Nina ${family}` })).toBeVisible();
});

test('a set-password link from an admin: the account is signed out everywhere and shows that an admin set it', async ({
  adminPage: admin,
  browser,
}) => {
  await admin.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE_URL });
  await admin.goto('/admin/users');
  await admin.getByRole('button', { name: `Make a set-password link for Nina ${family}` }).click();
  const dialog = admin.getByRole('dialog', { name: `Set-password link for Nina ${family}` });
  await expect(dialog).toContainText('signed out everywhere, and the account will show that an admin set the password');
  resetLink = await dialog.getByLabel('Link').inputValue();
  expect(resetLink).toMatch(new RegExp(`^${BASE_URL}/reset#`));
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(admin.getByText(/Set-password link open until/)).toBeVisible();
  // Not for yourself, and no button where the rules say no.
  await expect(admin.getByRole('button', { name: `Make a set-password link for ${ADMIN.displayName}` })).toHaveCount(0);

  const third = await newBrowser(browser);
  await third.page.goto(resetLink);
  expect(third.page.url()).toBe(`${BASE_URL}/reset`);
  await expect(third.page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await expect(third.page.getByText(`made this link for Nina ${family}`)).toBeVisible();
  await third.page.getByLabel('Choose a password').fill(RESET_PASSWORD);
  await third.page.getByLabel('Type the password again').fill(RESET_PASSWORD);
  await third.page.getByRole('button', { name: 'Save my new password' }).click();
  await expect(third.page.getByRole('heading', { name: `Welcome, Nina ${family}` })).toBeVisible();

  // Both earlier browsers were signed out by it.
  const old = invitee.pages()[0] as Page;
  await old.reload();
  await expect(old.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  const old2 = invitee2.pages()[0] as Page;
  await old2.reload();
  await expect(old2.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  // The owner of the account can see that an admin set the password.
  await third.page.goto('/settings');
  await expect(third.page.getByText(/Password last changed .*, using a link from an admin/)).toBeVisible();
  await third.context.close();

  // The link works once.
  const again = await newBrowser(browser);
  await again.page.goto(resetLink);
  await expect(again.page.getByRole('heading', { name: 'This link does not work' })).toBeVisible();
  await again.context.close();
});

test('no secret reached a server log: the links were in the address fragment and the request bodies', async () => {
  expect(tokens()).toHaveLength(2);
  const web = webLog();
  const api = apiLog();
  expect(web).toContain('GET /invite');
  expect(web).toContain('POST /api/links/lookup');
  for (const token of tokens()) {
    expect(web, 'the web access log').not.toContain(token);
    expect(api, 'the api log').not.toContain(token);
  }
  for (const secret of [NEW_PASSWORD, RESET_PASSWORD]) {
    expect(web).not.toContain(secret);
    expect(api).not.toContain(secret);
  }
});
