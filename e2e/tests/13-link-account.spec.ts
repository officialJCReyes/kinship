// SPDX-License-Identifier: AGPL-3.0-or-later
// Journey 13: an admin links an existing account that has no person to a person (#8), changes the link, and removes it, all
// through Admin > Users. The "Visiting User" is a User account made over the API (an invitation with no person, accepted
// by the helper), the way an account upgraded from an alpha may have no person. Adds no sign-in. Fictional Hale-style data only.
import { createAccount } from '../support/accounts.js';
import { createPerson } from '../support/api.js';
import { surname, uniq } from '../support/data.js';
import { expect, test } from '../support/fixtures.js';
import { apiLog, BASE_URL } from '../support/stack.js';
import { request } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const family = surname('Hale');
const email = `visiting-${uniq()}@hale.example`;
let account: Awaited<ReturnType<typeof createAccount>>;

test('link an account with no person, see what it changes, and the account is that person at once', async ({
  adminPage: page,
  adminApi,
}) => {
  await createPerson(page.request, { givenName: 'Eleanor', surname: family, gender: 'female', birth: '1957' });
  await createPerson(page.request, { givenName: 'Ruth', surname: family, gender: 'female', birth: '1987' });
  account = await createAccount(adminApi, { email, role: 'user', displayName: 'Visiting User' });

  await page.goto('/admin/users');
  const row = page.getByRole('row', { name: new RegExp(email) });
  await expect(row).toContainText('Not linked to a person');
  await row.getByRole('button', { name: 'Link Visiting User to a person' }).click();

  const dialog = page.getByRole('dialog', { name: 'Link Visiting User to a person' });
  const confirm = dialog.getByRole('button', { name: 'Link account' });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole('combobox', { name: 'Person' }).fill(`Eleanor ${family}`);
  await dialog.getByRole('option', { name: new RegExp(`Eleanor ${family}`) }).click();
  await expect(dialog.getByRole('note')).toContainText('does not change what they may edit');
  await confirm.click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(`Visiting User is now linked to Eleanor ${family}.`)).toBeVisible();
  await expect(row.getByRole('link', { name: `Eleanor ${family}` })).toBeVisible();
  // Focus is back on the row's button, which now says Change.
  await expect(row.getByRole('button', { name: 'Change the person linked to Visiting User' })).toBeFocused();

  // The account itself is that person, with no new sign-in: its own session reads /me.
  const visitor = await request.newContext({
    baseURL: BASE_URL,
    storageState: { cookies: account.cookies as never, origins: [] },
  });
  try {
    const me = (await (await visitor.get('/api/auth/me')).json()) as { user: { personId: string | null } };
    expect(me.user.personId).toEqual(expect.any(String));
  } finally {
    await visitor.dispose();
  }

  // One log line, ids only.
  const lines = apiLog()
    .split('\n')
    .filter((line) => line.includes('account_person_linked'));
  expect(lines).toHaveLength(1);
  expect(lines[0]).not.toContain(email);
  expect(lines[0]).not.toContain('Eleanor');
});

test('change the link to another person, then unlink', async ({ adminPage: page }) => {
  await page.goto('/admin/users');
  const row = page.getByRole('row', { name: new RegExp(email) });
  await row.getByRole('button', { name: 'Change the person linked to Visiting User' }).click();
  const dialog = page.getByRole('dialog', { name: 'Change the person linked to Visiting User' });
  await dialog.getByRole('combobox', { name: 'Person' }).fill(`Ruth ${family}`);
  await dialog.getByRole('option', { name: new RegExp(`Ruth ${family}`) }).click();
  await dialog.getByRole('button', { name: 'Change link' }).click();
  await expect(row.getByRole('link', { name: `Ruth ${family}` })).toBeVisible();

  // Eleanor now has no account, so she can be chosen again (not Ruth, who has one).
  await row.getByRole('button', { name: 'Change the person linked to Visiting User' }).click();
  const again = page.getByRole('dialog', { name: 'Change the person linked to Visiting User' });
  await again.getByRole('combobox', { name: 'Person' }).fill(family);
  await expect(again.getByRole('option', { name: new RegExp(`Eleanor ${family}`) })).toBeVisible();
  await expect(again.getByRole('option', { name: new RegExp(`Ruth ${family}`) })).toHaveCount(0);
  await again.getByRole('button', { name: 'Cancel' }).click();

  await row.getByRole('button', { name: `Unlink Visiting User from Ruth ${family}` }).click();
  const confirm = page.getByRole('dialog', { name: 'Unlink Visiting User?' });
  await expect(confirm).toContainText(`will no longer be linked to Ruth ${family}`);
  await confirm.getByRole('button', { name: 'Unlink account' }).click();
  await expect(page.getByText('Visiting User is no longer linked to a person.')).toBeVisible();
  await expect(row).toContainText('Not linked to a person');
  await expect(row.getByRole('button', { name: 'Link Visiting User to a person' })).toBeFocused();

  const lines = apiLog()
    .split('\n')
    .filter((line) => line.includes('account_person_'));
  expect(lines.map((l) => /account_person_(linked|unlinked)/.exec(l)?.[0])).toEqual([
    'account_person_linked',
    'account_person_linked',
    'account_person_unlinked',
  ]);
});
