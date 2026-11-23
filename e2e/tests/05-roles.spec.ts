// SPDX-License-Identifier: AGPL-3.0-or-later
// Journey 5: a Member and a User, each linked to a person. They are invited by the SuperAdmin and accept the link over
// the API (support/accounts.ts), so no SQL, no command line and no sign-in is needed to have them.
import { createAccount } from '../support/accounts.js';
import type { Account } from '../support/accounts.js';
import { createPerson } from '../support/api.js';
import { surname, uniq } from '../support/data.js';
import { expect, tabTo, test } from '../support/fixtures.js';

test.describe.configure({ mode: 'serial' });

const family = surname('Hale');
const member = { email: `member-${uniq()}@hale.example`, name: 'Maren' };
const reader = { email: `reader-${uniq()}@hale.example`, name: 'Rae' };
let ids: { member: string; reader: string; other: string };
let accounts: { member: Account; reader: Account };

test('set up a Member and a User, each linked to a person', async ({ adminPage: page, adminApi }) => {
  const m = await createPerson(page.request, {
    givenName: member.name,
    surname: family,
    gender: 'female',
    birth: '1980',
  });
  const r = await createPerson(page.request, {
    givenName: reader.name,
    surname: family,
    gender: 'female',
    birth: '1985',
  });
  const other = await createPerson(page.request, { givenName: 'Otto', surname: family, gender: 'male', birth: '1950' });
  accounts = {
    member: await createAccount(adminApi, {
      email: member.email,
      role: 'member',
      displayName: member.name,
      personId: m.id,
    }),
    reader: await createAccount(adminApi, {
      email: reader.email,
      role: 'user',
      displayName: reader.name,
      personId: r.id,
    }),
  };
  ids = { member: m.id, reader: r.id, other: other.id };
});

test('a Member may add children to themselves, and can do nothing else', async ({ page }) => {
  await page.context().addCookies(accounts.member.cookies);

  // Someone else's profile: everything is disabled, with the reason.
  await page.goto(`/people/${ids.other}`);
  await expect(page.getByRole('heading', { name: `Otto ${family}`, level: 1 })).toBeVisible();
  for (const name of ['Edit details', 'Add relative']) {
    const button = page.getByRole('button', { name });
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).toHaveAttribute('title', 'You can only edit your own profile');
  }
  await expect(page.getByRole('button', { name: 'Delete person' })).toHaveCount(0);
  // Reachable and readable with the keyboard.
  const edit = page.getByRole('button', { name: 'Edit details' });
  await tabTo(page, edit);
  await expect(edit).toHaveAttribute('title', 'You can only edit your own profile');
  // And the People page has no Add person.
  await page.goto('/people');
  await expect(page.getByRole('link', { name: `Otto ${family}` })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add person' })).toHaveCount(0);

  // Their own profile: Add relative offers only Son and Daughter.
  await page.goto(`/people/${ids.member}`);
  await expect(page.getByText('You', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add relative' }).click();
  await expect(page.getByRole('button', { name: 'Add son' })).not.toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('button', { name: 'Add daughter' })).not.toHaveAttribute('aria-disabled', 'true');
  for (const name of ['Add brother', 'Add sister', /^Add partner/]) {
    const card = page.getByRole('button', { name });
    await expect(card).toHaveAttribute('aria-disabled', 'true');
    await expect(card).toHaveAttribute('title', 'Ask an admin to add this relative');
  }
  await expect(page.getByText('You can add children here. To add anyone else, ask an admin.')).toBeVisible();

  // The database lets a Member add a child under themselves: this goes through the real row-level security.
  await page.getByRole('button', { name: 'Add daughter' }).click();
  const dialog = page.getByRole('dialog', { name: `Add daughter to ${member.name} ${family}` });
  await dialog.getByLabel('Given (and middle) name').fill('Ida');
  await dialog.getByLabel('Surname', { exact: true }).fill(family);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('link', { name: new RegExp(`Ida ${family}.*Daughter`) })).toBeVisible();

  // The new child is in their line, so they may edit her.
  await page.getByRole('link', { name: new RegExp(`Ida ${family}`) }).click();
  await expect(page.getByRole('button', { name: 'Edit details' })).not.toHaveAttribute('aria-disabled', 'true');
});

test('a User can read everything and change nothing', async ({ page }) => {
  await page.context().addCookies(accounts.reader.cookies);
  await page.goto(`/people/${ids.reader}`);
  await expect(page.getByRole('heading', { name: `${reader.name} ${family}`, level: 1 })).toBeVisible();
  for (const name of ['Edit details', 'Add relative']) {
    const button = page.getByRole('button', { name });
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).toHaveAttribute('title', 'Only admins and members can edit');
  }
  await expect(page.getByRole('button', { name: 'Delete person' })).toHaveCount(0);
  // Clicking a disabled button opens nothing (force: Playwright would otherwise wait for it to be enabled).
  await page.getByRole('button', { name: 'Edit details' }).click({ force: true });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Reading is fine: another person's profile opens.
  await page.goto(`/people/${ids.other}`);
  await expect(page.getByRole('heading', { name: `Otto ${family}`, level: 1 })).toBeVisible();
  await expect(page.getByText('1950', { exact: true })).toBeVisible();
});
