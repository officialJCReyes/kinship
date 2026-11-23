// SPDX-License-Identifier: AGPL-3.0-or-later
// Journey 15: restore a backup from the app (ADR 0031). It is the LAST journey on purpose: a restore signs everyone out, including
// the SuperAdmin session every other journey shares, and it restarts the api. Adds no sign-in: it ends signed out, which is the
// thing to check. Fictional Hale-style data only.
import { createPerson } from '../support/api.js';
import { password, surname } from '../support/data.js';
import { expect, test } from '../support/fixtures.js';
import { makePng } from '../support/images.js';
import { apiExec, apiLog, dbExec, storedFiles } from '../support/stack.js';

test('restore a backup: maintenance page, result, signed out, data replaced, api back', async ({ adminPage: page }) => {
  test.setTimeout(300_000);
  // A person with a photo (added through the screen): this is the photo the restore has to bring back.
  const family = surname('Hale');
  const holder = await createPerson(page.request, {
    givenName: 'Pia',
    surname: family,
    gender: 'female',
    birth: '1988',
  });
  await page.goto(`/people/${holder.id}`);
  const choose = page.getByLabel('Choose a photo (JPEG, PNG or WebP, up to 10 MB)');
  await choose.setInputFiles({ name: 'original.png', mimeType: 'image/png', buffer: makePng({ tint: 3 }) });
  await page.getByRole('dialog', { name: 'Photo added' }).getByRole('button', { name: 'Leave it empty' }).click();
  await expect(page.getByRole('list', { name: 'Photos' }).getByRole('listitem')).toHaveCount(1);
  const originalFiles = storedFiles();
  expect(originalFiles).toHaveLength(2);
  const originalRow = dbExec('select id from media_files');

  // A backup of the data as it is now.
  await page.goto('/admin/backups');
  const list = page.getByRole('region', { name: 'Backups on this server' });
  // The names stop at the minute, so a backup made in the same minute as an earlier one gets a "-2" and so on: the way to know
  // WHICH backup is ours is to wait for a name that was not listed before (waiting for "Working…" to disappear can pass before
  // it has appeared, and then the photos would change while the backup is still running). Not a count of rows: retention keeps
  // the newest backup of each day, so the earlier backup of today (journey 11's) can be removed as soon as this one is written,
  // and the number of rows then stays the same.
  const listed = async () => (await list.getByRole('rowheader').allInnerTexts()).map((n) => n.trim());
  const namesBefore = await listed();
  const newNames = async () => (await listed()).filter((n) => !namesBefore.includes(n));
  await page.getByRole('button', { name: 'Back up now' }).click();
  await expect.poll(newNames, { timeout: 120_000 }).toHaveLength(1);
  await expect(page.getByText('Working…')).toBeHidden({ timeout: 120_000 });
  const name = (await newNames())[0] ?? '';
  expect(name).toMatch(/^kinship-/);

  // Something happens after it: a person who is not in the backup.
  const marker = await createPerson(page.request, { givenName: 'Afterwards', surname: surname('Hale'), birth: '1999' });
  expect(dbExec(`select count(*) from people where id = '${marker.id}'`)).toBe('1');

  // After the backup the photos change: the original is deleted (through the screen) and a different one is added.
  await page.goto(`/people/${holder.id}`);
  await page.getByRole('button', { name: 'Open photo 1 of 1' }).click();
  await page
    .getByRole('dialog', { name: `Photo of Pia ${family}` })
    .getByRole('button', { name: 'Delete photo' })
    .click();
  await page.getByRole('dialog', { name: 'Delete this photo?' }).getByRole('button', { name: 'Delete photo' }).click();
  await expect(page.getByText('No photos yet. Add the first one.')).toBeVisible();
  expect(storedFiles()).toHaveLength(0);
  await choose.setInputFiles({ name: 'different.png', mimeType: 'image/png', buffer: makePng({ tint: 90 }) });
  await page.getByRole('dialog', { name: 'Photo added' }).getByRole('button', { name: 'Leave it empty' }).click();
  await expect(page.getByRole('list', { name: 'Photos' }).getByRole('listitem')).toHaveCount(1);
  const differentFiles = storedFiles();
  expect(differentFiles).toHaveLength(2);
  expect(differentFiles.some((file) => originalFiles.includes(file))).toBe(false);

  // The check changes nothing; the restore needs the password and the word.
  await page.goto('/admin/backups');
  await page.getByRole('button', { name: `Restore ${name}` }).click();
  const dialog = page.getByRole('dialog', { name: /^Restore / });
  await expect(dialog.getByText(/by KinShip .* \(database schema \d+\)\./)).toBeVisible({ timeout: 60_000 });
  await expect(dialog.getByText(/deleted or disabled since then comes back active/)).toBeVisible();
  // The dialog says this backup carries photos, and what happens to the ones here.
  await expect(dialog.getByText(/this backup carries 2 photo files/)).toBeVisible();
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
  // The photos are the backup's: the original is back (row and the very same two files), the different one is gone.
  expect(dbExec('select id from media_files')).toBe(originalRow);
  expect(storedFiles()).toEqual(originalFiles);
  expect(storedFiles().some((file) => differentFiles.includes(file))).toBe(false);
  expect(dbExec('select count(*) from sessions')).toBe('0');
  expect(dbExec("select count(*) from upgrade_log where event = 'restore'")).toBe('1');
  expect(apiExec(['kinship', 'backup-list'])).toMatch(/pre-restore-\d{8}-\d{6}\.tar\.enc/);

  // Nothing secret reached the api log, and no path was put in a message.
  const log = apiLog();
  expect(log).not.toContain(process.env['E2E_BACKUP_PASSPHRASE'] ?? 'no passphrase');
  expect(log).not.toContain(password());
  expect(log).toContain('restore requested');
});
