// SPDX-License-Identifier: AGPL-3.0-or-later
// Journey 15: restore a backup from the app (ADR 0031). It is the LAST journey on purpose: a restore signs everyone out, including
// the SuperAdmin session every other journey shares, and it restarts the api. Adds no sign-in: it ends signed out, which is the
// thing to check. Fictional Hale-style data only.
import { createPerson } from '../support/api.js';
import { password, surname } from '../support/data.js';
import { expect, test } from '../support/fixtures.js';
import { apiExec, apiLog, dbExec } from '../support/stack.js';

test('restore a backup: maintenance page, result, signed out, data replaced, api back', async ({ adminPage: page }) => {
  test.setTimeout(240_000);
  // A backup of the data as it is now.
  await page.goto('/admin/backups');
  await page.getByRole('button', { name: 'Back up now' }).click();
  const list = page.getByRole('region', { name: 'Backups on this server' });
  await expect(page.getByText('Working…')).toBeHidden({ timeout: 120_000 });
  const first = list.getByRole('row').nth(1);
  const name = (await first.getByRole('rowheader').innerText()).trim();
  expect(name).toMatch(/^kinship-/);

  // Something happens after it: a person who is not in the backup.
  const marker = await createPerson(page.request, { givenName: 'Afterwards', surname: surname('Hale'), birth: '1999' });
  expect(dbExec(`select count(*) from people where id = '${marker.id}'`)).toBe('1');

  // The check changes nothing; the restore needs the password and the word.
  await page.reload();
  await page.getByRole('button', { name: `Restore ${name}` }).click();
  const dialog = page.getByRole('dialog', { name: /^Restore / });
  await expect(dialog.getByText(/by KinShip .* \(database schema \d+\)\./)).toBeVisible({ timeout: 60_000 });
  await expect(dialog.getByText(/deleted or disabled since then comes back active/)).toBeVisible();
  const go = dialog.getByRole('button', { name: 'Restore now' });
  await dialog.getByLabel('Your password').fill(password());
  await dialog.getByLabel('Type RESTORE to confirm').fill('restore');
  await expect(go).toBeDisabled();
  await dialog.getByLabel('Type RESTORE to confirm').fill('RESTORE');
  await go.click();

  // The whole app is replaced by the maintenance page, with no navigation, and then says how it ended.
  await expect(page.getByRole('heading', { name: 'KinShip is being restored from a backup' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Restore finished' })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/Everyone was signed out, you too/)).toBeVisible();
  await expect(page.getByText(/Accounts deleted or disabled since the backup are back and active/)).toBeVisible();
  await expect(page.getByText(/pre-restore-\d{8}-\d{6}\.tar\.enc/)).toBeVisible();

  // Signed out: Sign in goes to the sign-in page, and a protected address goes there too.
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/people');
  await expect(page).toHaveURL(/\/login$/);

  // The api is back (Docker restarted it), the data is the backup's, nobody has a session, and the safety copy is kept.
  await expect.poll(async () => (await page.request.get('/api/health')).status(), { timeout: 60_000 }).toBe(200);
  expect(await (await page.request.get('/api/health')).json()).toEqual({ status: 'ok', database: 'ok' });
  expect(dbExec(`select count(*) from people where id = '${marker.id}'`)).toBe('0');
  expect(dbExec('select count(*) from sessions')).toBe('0');
  expect(dbExec("select count(*) from upgrade_log where event = 'restore'")).toBe('1');
  expect(apiExec(['kinship', 'backup-list'])).toMatch(/pre-restore-\d{8}-\d{6}\.tar\.enc/);

  // Nothing secret reached the api log, and no path was put in a message.
  const log = apiLog();
  expect(log).not.toContain(process.env['E2E_BACKUP_PASSPHRASE'] ?? 'no passphrase');
  expect(log).not.toContain(password());
  expect(log).toContain('restore requested');
});
