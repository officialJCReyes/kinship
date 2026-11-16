// SPDX-License-Identifier: AGPL-3.0-or-later
// Journey 1: a fresh install. The first test only looks at the setup form (so it does not use up the
// one-time token); the second finishes setup; the rest run on the installed stack.
import { createAccount } from '../support/accounts.js';
import { ADMIN, password, uniq } from '../support/data.js';
import { expect, test } from '../support/fixtures.js';

test.describe.configure({ mode: 'serial' });

async function fillAccount(page: import('@playwright/test').Page) {
  await page.goto('/');
  // A fresh install sends everyone to the setup page.
  await expect(page.getByRole('heading', { name: 'Welcome to KinShip' })).toBeVisible();
  await expect(page.getByText('Step 1 of 7 · Account')).toBeVisible();
  await page.getByLabel('Setup token').fill(process.env['E2E_SETUP_TOKEN'] ?? '');
  await page.getByLabel('Your name', { exact: true }).fill(ADMIN.displayName);
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(password());
  await page.getByLabel('Confirm password').fill(password());
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Name your first tree' })).toBeVisible();
  await expect(page.getByLabel('Tree name')).toHaveValue('Hale Family');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Start with you' })).toBeVisible();
}

test('setup checks each step before it moves on, and asks for both of your names', async ({ page }) => {
  await fillAccount(page);
  // The names are prefilled from the account name; both are required.
  await expect(page.getByLabel('Given name')).toHaveValue('Marcus');
  await expect(page.getByLabel('Surname')).toHaveValue('Hale');
  await page.getByLabel('Surname').fill('');
  await page.getByRole('button', { name: 'Next' }).click();
  const surname = page.getByLabel('Surname');
  await expect(page.getByText('Enter a surname (up to 100 characters).')).toBeVisible();
  await expect(surname).toHaveAttribute('aria-invalid', 'true');
  await expect(surname).toBeFocused();
  // Nothing was created: still in the wizard, on step 3 of 7.
  await expect(page.getByText('Step 3 of 7 · You')).toBeVisible();
});

test('setup creates the tree, signs in and opens you; then sign out, sign in and see the linked profile', async ({
  page,
}) => {
  await fillAccount(page);
  await page.getByRole('button', { name: 'Next' }).click();
  // Partner, Parents and Children can each be skipped.
  for (const title of ['Add your spouse or partner', 'Add your parents', 'Add your children']) {
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await page.getByRole('button', { name: 'Skip this step' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Check your tree' })).toBeVisible();
  // The update-check note (it names Admin → Updates, which arrives in step 17).
  await expect(
    page.getByText(
      'Once a day KinShip reads the public release list on GitHub and tells the SuperAdmin when a new version is out. It sends nothing about your install. Turn it off any time in Admin → Updates.',
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Create my tree' }).click();

  // Setup signs the new SuperAdmin in and opens their own place on the tree.
  await expect(page).toHaveURL(/\/tree\/[0-9a-f-]+$/);
  await expect(page.getByRole('button', { name: 'Account menu' })).toContainText('Marcus Hale');

  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  // The setup page never comes back.
  await page.goto('/setup');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(password());
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, Marcus Hale' })).toBeVisible();

  await page.getByRole('link', { name: 'Open my profile' }).click();
  await expect(page.getByRole('heading', { name: 'Marcus Hale' })).toBeVisible();
  await expect(page.getByText('You', { exact: true })).toBeVisible();
  await expect(page.getByText('Linked', { exact: true })).toBeVisible();
  // My profile is in the account menu, not in the top navigation.
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'My profile' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Account menu' }).click();
  await expect(page.getByRole('menuitem', { name: 'My profile' })).toBeVisible();
});

test('an account that is not linked to a person has no profile to open', async ({ page, adminApi }) => {
  // Invited by the SuperAdmin and accepted over the API; the accepted link signs the account in.
  const account = await createAccount(adminApi, {
    email: `unlinked-${uniq()}@hale.example`,
    role: 'familyadmin',
    displayName: 'Una Linked',
  });
  await page.context().addCookies(account.cookies);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome, Una Linked' })).toBeVisible();
  await expect(page.getByText('Your account is not linked to a person on the tree yet.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open my profile' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Account menu' }).click();
  await expect(page.getByRole('menuitem', { name: 'My settings' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'My profile' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Browse people' }).click();
  await expect(page.getByRole('link', { name: 'Marcus Hale' })).toBeVisible();
});
