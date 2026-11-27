// SPDX-License-Identifier: AGPL-3.0-or-later
// Journey 11: backups. The SuperAdmin opens Admin > Backups, backs up now, sees the backup pass its test, downloads it with their
// password again, changes the schedule; opens Admin > Storage & email (Photos and files, and email "Not set up", with no secret
// anywhere on the page); a Member cannot see or use any of it; the command line lists and checks the backup, and nothing secret
// reached the api log. Adds no sign-in. Fictional Hale-style data only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAccount } from '../support/accounts.js';
import { createPerson } from '../support/api.js';
import { password, surname, uniq } from '../support/data.js';
import { expect, test } from '../support/fixtures.js';
import { WORK_DIR, apiExec, apiLog, webLog } from '../support/stack.js';

test.describe.configure({ mode: 'serial' });

let backupName = '';

test('the SuperAdmin opens Backups, sees there is none yet, and backs up now', async ({ adminPage: page }) => {
  await createPerson(page.request, { givenName: 'Walter', surname: surname('Hale'), gender: 'male', birth: '1931' });
  await page.goto('/admin/users');
  await page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Backups' }).click();
  await expect(page).toHaveURL(/\/admin\/backups$/);
  await expect(page.getByRole('heading', { name: 'Backups', level: 1 })).toBeVisible();
  await expect(page.getByText('There is no backup yet. Press Back up now.')).toBeVisible();
  await expect(page.getByText('No backups yet.')).toBeVisible();
  // No backup yet, so nothing to restore: no Restore button. The command line steps for a new server are on the page.
  await expect(page.getByRole('button', { name: /^Restore / })).toHaveCount(0);
  await expect(
    page.getByText('docker compose run --rm api kinship restore kinship-YYYY-MM-DD-HHMM.tar.enc'),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Back up now' }).click();
  const row = page.getByRole('region', { name: 'Backups on this server' }).getByRole('row').nth(1);
  await expect(row).toContainText(/kinship-\d{4}-\d{2}-\d{2}-\d{4}\.tar\.enc/, { timeout: 60_000 });
  backupName = (await row.getByRole('rowheader').innerText()).trim();
  await expect(page.getByRole('region', { name: 'Backups are working' })).toBeVisible();
  // Each new backup is tested by restoring it into a temporary database.
  await expect(row.getByText('Passed')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/Last test: passed \(\d+ tables, \d+ rows, kinship-/)).toBeVisible();

  // The new backup has a Restore button. Opening it only CHECKS the backup (nothing is changed, nobody is signed out); Escape closes
  // it and the focus goes back to the button. The restore itself is journey 15, the last one, because it signs everyone out.
  const restore = page.getByRole('button', { name: `Restore ${backupName}` });
  await restore.focus();
  await restore.click();
  const dialog = page.getByRole('dialog', { name: /^Restore / });
  await expect(dialog.getByText(/by KinShip .* \(database schema \d+\)\./)).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText(/Anything added since .* is lost\./)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Restore now' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(restore).toBeFocused();
  await expect(page.getByRole('region', { name: 'Backups are working' })).toBeVisible();
});

test('the newest backup can be tested again on request', async ({ adminPage: page }) => {
  await page.goto('/admin/backups');
  await page.getByRole('button', { name: 'Test the latest backup' }).click();
  await expect(page.getByRole('button', { name: 'Back up now' })).toBeEnabled({ timeout: 90_000 });
  await expect(page.getByText(/Last test: passed/)).toBeVisible();
});

test('a download needs the password again, and hands over the encrypted file', async ({ adminPage: page }) => {
  await page.goto('/admin/backups');
  await page.getByRole('button', { name: `Download ${backupName}` }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Your password').fill('definitely not the password');
  await dialog.getByRole('button', { name: 'Download' }).click();
  await expect(dialog.getByText('That password is not right.')).toBeVisible();

  await dialog.getByLabel('Your password').fill(password());
  const [download, ticketResponse] = await Promise.all([
    page.waitForEvent('download'),
    page.waitForResponse((r) => r.url().endsWith('/api/admin/backups/download-ticket') && r.status() === 200),
    dialog.getByRole('button', { name: 'Download' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(backupName);
  // The one-time ticket travels in the download's query string; neither the api's log nor nginx's keeps it (#74).
  const ticket = ((await ticketResponse.json()) as { ticket: string }).ticket;
  expect(ticket.length).toBeGreaterThan(20);
  await expect.poll(() => webLog()).toContain('GET /api/admin/backups/download HTTP/1.1');
  expect(webLog()).not.toContain(ticket);
  expect(apiLog()).toContain('/api/admin/backups/download?ticket=[redacted]');
  expect(apiLog()).not.toContain(ticket);
  const path = await download.path();
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 4).toString('latin1')).toBe('KSBK');
  // It is encrypted: nothing readable from the family is in it.
  expect(bytes.includes(Buffer.from('Walter'))).toBe(false);
  await expect(dialog).toBeHidden();
});

test('the schedule and retention can be changed, and are kept', async ({ adminPage: page }) => {
  await page.goto('/admin/backups');
  const form = page.getByRole('region', { name: 'Schedule and what to keep' });
  await form.getByLabel('Schedule').selectOption('weekly');
  await form.getByLabel('Day of the week').selectOption('3');
  await form.getByLabel('Daily backups to keep').fill('3');
  await form.getByLabel('Time zone').fill('Europe/Berlin');
  await form.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  await page.reload();
  const again = page.getByRole('region', { name: 'Schedule and what to keep' });
  await expect(again.getByLabel('Schedule')).toHaveValue('weekly');
  await expect(again.getByLabel('Day of the week')).toHaveValue('3');
  await expect(again.getByLabel('Daily backups to keep')).toHaveValue('3');
  await expect(again.getByLabel('Time zone')).toHaveValue('Europe/Berlin');
});

test('Storage & email shows Photos and files and that email is not set up, with no secret anywhere', async ({
  adminPage: page,
}) => {
  await page.goto('/admin/backups');
  await expect(page.getByRole('heading', { name: 'Backups', level: 1 })).toBeVisible();
  // The Photos and files card moved to Storage & email.
  await expect(page.getByRole('region', { name: 'Photos and files' })).toHaveCount(0);
  const tabs = page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link');
  await expect(tabs).toHaveText(['Users', 'Storage & email', 'Backups', 'Updates']);
  await tabs.filter({ hasText: 'Storage & email' }).click();
  await expect(page).toHaveURL(/\/admin\/storage$/);
  await expect(page.getByRole('heading', { name: 'Storage & email', level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Photos and files' }).getByText(/Photos are on/)).toBeVisible();
  // The e2e stack sets no mail provider: the card says so, and the test button cannot be pressed.
  const mail = page.getByRole('region', { name: 'Email' });
  await expect(mail.getByText('Not set up', { exact: true })).toBeVisible();
  await expect(mail.getByRole('link', { name: /How to set up email/ })).toHaveAttribute(
    'href',
    /INSTALL\.md#sending-email$/,
  );
  await expect(mail.getByRole('button', { name: 'Send test to me' })).toBeDisabled();
  await expect(mail.getByText('Set up email first', { exact: false })).toBeVisible();

  // No secret of this stack is on the page or in the status, in any form.
  const env = readFileSync(join(WORK_DIR, '.env'), 'utf8');
  const secrets = ['DB_OWNER_PASSWORD', 'DB_APP_PASSWORD', 'BACKUP_PASSPHRASE', 'FILE_ENCRYPTION_KEY'].map(
    (name) => new RegExp(`^${name}=(.*)$`, 'm').exec(env)?.[1]?.trim() ?? '',
  );
  expect(secrets.every((secret) => secret.length >= 16)).toBe(true);
  const status = await (await page.request.get('/api/admin/mail')).text();
  const html = await page.content();
  for (const secret of secrets) {
    expect(html).not.toContain(secret);
    expect(status).not.toContain(secret);
  }

  // At phone width the page never scrolls sideways, and the button keeps its 36 px tap size.
  await page.setViewportSize({ width: 360, height: 800 });
  try {
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    const box = await mail.getByRole('button', { name: 'Send test to me' }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(36);
  } finally {
    await page.setViewportSize({ width: 1280, height: 720 });
  }
});

test('the logo every email shows is served by the web image without sign-in', async ({ request }) => {
  const logo = await request.get('/email/logo.png');
  expect(logo.status()).toBe(200);
  expect(logo.headers()['content-type']).toBe('image/png');
  expect((await logo.body()).subarray(1, 4).toString('latin1')).toBe('PNG');
});

test('a Member cannot see or use any of it', async ({ page, adminApi }) => {
  const member = await createAccount(adminApi, {
    email: `bea-${uniq()}@hale.example`,
    role: 'member',
    displayName: 'Bea Member',
  });
  await page.context().addCookies(member.cookies);
  for (const path of ['/admin/backups', '/admin/storage']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  }
  for (const path of [
    '/api/admin/backups',
    '/api/admin/backups/settings',
    '/api/admin/mail',
    '/api/admin/files',
    '/api/admin/mail/templates',
    '/api/admin/mail/templates/invitation',
  ]) {
    expect((await page.request.get(path)).status(), path).toBe(403);
  }
  const started = await page.request.post('/api/admin/backups', { headers: { 'X-KinShip-Request': '1' } });
  expect(started.status()).toBe(403);
  const mailTest = await page.request.post('/api/admin/mail/test', { headers: { 'X-KinShip-Request': '1' } });
  expect(mailTest.status()).toBe(403);
});

test('the command line lists and checks the backup, and no secret reached the api log', async () => {
  expect(apiExec(['kinship', 'backup-list'])).toContain(backupName);
  const verified = apiExec(['kinship', 'backup-verify', backupName]);
  expect(verified).toContain('OK: every block authenticated');
  const log = apiLog();
  expect(log).toContain('backup written');
  const passphrase = process.env['E2E_BACKUP_PASSPHRASE'] ?? '';
  expect(passphrase.length).toBeGreaterThanOrEqual(16);
  expect(log).not.toContain(passphrase);
});
