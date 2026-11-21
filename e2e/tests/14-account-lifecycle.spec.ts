// SPDX-License-Identifier: AGPL-3.0-or-later
// Journey 14: an admin changes an account's role, disables it, enables it again, and deletes it, all through Admin > Users
// (#56, #57, ADR 0029). The account is a Member made over the API (invitation accepted by the helper) and linked to a
// person; what happens to it is checked with its OWN session cookie, so the whole journey adds no sign-in. A refused
// sign-in for a disabled account is covered by the API tests, not here. Fictional Hale-style data only.
import { request } from '@playwright/test';
import { createAccount } from '../support/accounts.js';
import { createPerson } from '../support/api.js';
import { surname, uniq } from '../support/data.js';
import { expect, test } from '../support/fixtures.js';
import { apiLog, BASE_URL } from '../support/stack.js';

test.describe.configure({ mode: 'serial' });

const family = surname('Hale');
const email = `rowan-${uniq()}@hale.example`;
let account: Awaited<ReturnType<typeof createAccount>>;
let personId: string;

/** The account's own session, as a browser that never signs in again. */
async function ownStatus(): Promise<{ status: number; role: string | null }> {
  const own = await request.newContext({
    baseURL: BASE_URL,
    storageState: { cookies: account.cookies as never, origins: [] },
  });
  try {
    const reply = await own.get('/api/auth/me');
    const body = reply.status() === 200 ? ((await reply.json()) as { user: { role: string } }) : null;
    return { status: reply.status(), role: body?.user.role ?? null };
  } finally {
    await own.dispose();
  }
}

const openMenuFor = async (page: import('@playwright/test').Page, name: string) => {
  const row = page.getByRole('row', { name: new RegExp(email) });
  const button = row.getByRole('button', { name: `Actions for ${name}` });
  await button.click();
  return { row, button, menu: page.getByRole('menu', { name: `Actions for ${name}` }) };
};

test('the row menu works from the keyboard, then change a Member to a User, at once and with no sign-out', async ({
  adminPage: page,
  adminApi,
}) => {
  const made = await createPerson(page.request, { givenName: 'Rowan', surname: family, gender: 'male', birth: '1990' });
  personId = made.id;
  account = await createAccount(adminApi, { email, role: 'member', displayName: 'Rowan', personId });
  const name = `Rowan ${family}`;
  expect(await ownStatus()).toEqual({ status: 200, role: 'member' });

  await page.goto('/admin/users');
  const row = page.getByRole('row', { name: new RegExp(email) });
  const button = row.getByRole('button', { name: `Actions for ${name}` });
  await button.focus();
  await page.keyboard.press('ArrowDown');
  const menu = page.getByRole('menu', { name: `Actions for ${name}` });
  await expect(menu.getByRole('menuitem', { name: 'Change role…' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(button).toBeFocused();

  await button.click();
  await menu.getByRole('menuitem', { name: 'Change role…' }).click();
  const dialog = page.getByRole('dialog', { name: `Change the role of ${name}` });
  const save = dialog.getByRole('button', { name: 'Change role' });
  await expect(save).toBeDisabled();
  await dialog.getByRole('radio', { name: /^User/ }).check();
  await save.click();
  await expect(page.getByText(`${name}’s role is now User.`)).toBeVisible();
  await expect(row.getByText('User', { exact: true })).toBeVisible();
  await expect(button).toBeFocused();

  // At once, in the account's own session.
  expect(await ownStatus()).toEqual({ status: 200, role: 'user' });
});

test('disable signs the account out at once, enable says the old password works again', async ({ adminPage: page }) => {
  const name = `Rowan ${family}`;
  await page.goto('/admin/users');
  let { row, menu } = await openMenuFor(page, name);
  // Delete is not offered for an account that is still active, and says why.
  const del = menu.getByRole('menuitem', { name: /Delete account/ });
  await expect(del).toHaveAttribute('aria-disabled', 'true');
  await expect(del).toContainText('Disable the account first.');
  await menu.getByRole('menuitem', { name: 'Disable account…' }).click();
  const dialog = page.getByRole('dialog', { name: `Disable ${name}?` });
  await expect(dialog).toContainText('signed out now');
  await dialog.getByRole('button', { name: 'Disable account' }).click();
  await expect(page.getByText(`${name} is disabled and signed out.`)).toBeVisible();
  await expect(row.getByText('Disabled', { exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: `Actions for ${name}` })).toBeFocused();
  expect((await ownStatus()).status).toBe(401);

  ({ row, menu } = await openMenuFor(page, name));
  await menu.getByRole('menuitem', { name: 'Enable account' }).click();
  await expect(
    page.getByText('Their old password works again. Make a set-password link', { exact: false }),
  ).toBeVisible();
  await expect(row.getByText('Active', { exact: true })).toBeVisible();
  // Its old session stays dead: signing in again is what the person does.
  expect((await ownStatus()).status).toBe(401);
});

test('delete needs the typed email, keeps the person, and writes ids-only log lines', async ({ adminPage: page }) => {
  const name = `Rowan ${family}`;
  await page.goto('/admin/users');
  let { row, menu } = await openMenuFor(page, name);
  await menu.getByRole('menuitem', { name: 'Disable account…' }).click();
  await page
    .getByRole('dialog', { name: `Disable ${name}?` })
    .getByRole('button', { name: 'Disable account' })
    .click();
  await expect(row.getByText('Disabled', { exact: true })).toBeVisible();

  ({ row, menu } = await openMenuFor(page, name));
  await menu.getByRole('menuitem', { name: 'Delete account…' }).click();
  const dialog = page.getByRole('dialog', { name: `Delete the account of ${name}?` });
  await expect(dialog).toContainText('The person it was linked to, and everything on the tree, stays');
  const confirm = dialog.getByRole('button', { name: 'Delete account' });
  await expect(confirm).toBeDisabled();
  const field = dialog.getByLabel(`Type ${email} to confirm`);
  await field.fill(email.slice(0, -3));
  await expect(confirm).toBeDisabled();
  await field.fill(email.toUpperCase());
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(page.getByText(`The account of ${name} was deleted.`)).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(email) })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Users' })).toBeFocused();

  // The person stays on the tree.
  const person = await page.request.get(`/api/people/${personId}`);
  expect(person.status()).toBe(200);

  // Log lines: ids only, no email and no name.
  const lines = apiLog()
    .split('\n')
    .filter((line) => /account_(role_changed|disabled|enabled|deleted)/.test(line) && line.includes(account.id));
  expect(lines.map((l) => /account_(role_changed|disabled|enabled|deleted)/.exec(l)?.[0])).toEqual([
    'account_role_changed',
    'account_disabled',
    'account_enabled',
    'account_disabled',
    'account_deleted',
  ]);
  for (const line of lines) {
    expect(line).not.toContain(email);
    expect(line).not.toContain('Rowan');
  }
});
