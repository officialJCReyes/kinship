// SPDX-License-Identifier: AGPL-3.0-or-later
// Journey 1: a fresh install. The first test only looks at the setup form (so it does not use up the
// one-time token); the second finishes setup; the rest run on the installed stack.
import { expect, test } from '@playwright/test';
import { insertTestAccount } from '../support/stack.js';
import { ADMIN, password, uniq } from '../support/data.js';

test.describe.configure({ mode: 'serial' });

async function fillAccount(page: import('@playwright/test').Page, fields: { given?: string; surname?: string }) {
  await page.goto('/');
  // A fresh install sends everyone to the setup page.
  await expect(page.getByRole('heading', { name: 'Welcome to KinShip' })).toBeVisible();
  await page.getByLabel('Setup token').fill(process.env['E2E_SETUP_TOKEN'] ?? '');
  await page.getByLabel('Your name', { exact: true }).fill(ADMIN.displayName);
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(password());
  await page.getByLabel('Confirm password').fill(password());
  await page.getByLabel('Name your first tree').fill('Hale Family');
  if (fields.given) await page.getByLabel('Your given name').fill(fields.given);
  if (fields.surname) await page.getByLabel('Your surname').fill(fields.surname);
}

test('setup asks for both names of the first person, or neither', async ({ page }) => {
  await fillAccount(page, { given: ADMIN.givenName });
  await page.getByRole('button', { name: 'Create account and continue' }).click();
  const surname = page.getByLabel('Your surname');
  await expect(page.getByText('Enter a surname (up to 100 characters).')).toBeVisible();
  await expect(surname).toHaveAttribute('aria-invalid', 'true');
  // Nothing was created: still on the setup page.
  await expect(page.getByRole('heading', { name: 'Welcome to KinShip' })).toBeVisible();
});

test('setup with the You names, then sign out, sign in and see the linked profile', async ({ page }) => {
  await fillAccount(page, { given: ADMIN.givenName, surname: ADMIN.surname });
  await page.getByRole('button', { name: 'Create account and continue' }).click();

  // Setup signs the new SuperAdmin in.
  await expect(page.getByRole('heading', { name: 'Welcome, Marcus Hale' })).toBeVisible();
  await expect(page.getByText('Signed in as Marcus Hale')).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
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
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'My profile' })).toBeVisible();
});

test('an account that is not linked to a person has no profile to open', async ({ page }) => {
  const email = `unlinked-${uniq()}@hale.example`;
  // TEST-ONLY: there is no way to make a second account in the app yet.
  insertTestAccount({ email, displayName: 'Una Linked', role: 'familyadmin', password: password() });
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password());
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, Una Linked' })).toBeVisible();
  await expect(page.getByText('Your account is not linked to a person on the tree yet.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open my profile' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'My profile' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Browse people' }).click();
  await expect(page.getByRole('link', { name: 'Marcus Hale' })).toBeVisible();
});
