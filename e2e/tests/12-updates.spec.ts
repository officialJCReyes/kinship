// SPDX-License-Identifier: AGPL-3.0-or-later
// Journey 12: Admin > Updates, the update banner, What's changing, What's new and the version check. The real stack never talks to
// GitHub here (the daily check is switched off at the start; this journey writes what a check would have found, into the database,
// the way the check itself does). Adds no sign-in. Fictional Hale-style data only.
import { createAccount } from '../support/accounts.js';
import { expect, test } from '../support/fixtures.js';
import { apiLog, dbExec } from '../support/stack.js';
import { uniq } from '../support/data.js';

test.describe.configure({ mode: 'serial' });

let running = '';

const release = (version: string, flags: { security?: boolean; migration?: boolean; breaking?: boolean }) => ({
  version,
  date: '2027-03-01',
  channel: 'stable',
  security: flags.security ?? false,
  breaking: flags.breaking ?? false,
  migration: flags.migration ?? false,
  notes: `### Fixed\n\n- Something in ${version}.\n\n<script>document.title='hacked'</script>`,
  upgradeNotes: flags.breaking ? 'Rename BACKUP_KEEP in your .env.' : null,
  details: true,
  githubUpdatedAt: '2027-03-01T00:00:00Z',
});

/** What a check that found these releases would have written (and that nothing is due for a month). */
function seedCheck(releases: unknown[], checking = true) {
  const json = JSON.stringify(releases).replace(/'/g, "''");
  dbExec(
    `update update_check set status = 'ok', last_attempt_at = now(), last_success_at = now(), next_check_at = now() + interval '30 days', failures = 0, releases = '${json}'::jsonb`,
  );
  dbExec(
    `insert into app_settings (key, value) values ('updates.check', '${checking}'::jsonb) on conflict (key) do update set value = excluded.value`,
  );
}

test('a fresh install shows no What’s new popup, and Updates has the version, the three switches and the default states', async ({
  adminPage: page,
  adminApi,
}) => {
  const version = (await (await adminApi.get('/api/version')).json()) as { version: string; webVersion: string | null };
  running = version.version;
  // nginx reported the web image's version on the way in, and it is the api's own.
  expect(version.webVersion).toBe(running);

  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.goto('/admin/users');
  await page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Updates' }).click();
  await expect(page).toHaveURL(/\/admin\/updates$/);
  const card = page.getByRole('region', { name: 'Version' });
  await expect(card.getByText(`${running} (web ${running}, api ${running})`)).toBeVisible();
  await expect(card.getByText('Checking is off')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Check now' })).toBeDisabled();
  await expect(card.getByText('KinShip never updates itself.', { exact: false })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Update notice' })).toHaveCount(0);

  const settings = page.getByRole('region', { name: 'Settings' });
  await expect(settings.getByRole('checkbox', { name: /Check for new versions/ })).not.toBeChecked();
  await expect(settings.getByRole('checkbox', { name: /Include pre-releases/ })).not.toBeChecked();
  const safety = settings.getByRole('checkbox', { name: /Safety copy before a database change/ });
  await expect(safety).toBeChecked();
  // The safety copy switch is the one the upgrade reads at start: switching it off is saved, and back on again.
  // The box follows the saved value, so it changes when the api has answered (click, then wait).
  await safety.click();
  await expect(settings.getByText('Saved.')).toBeVisible();
  await expect(safety).not.toBeChecked();
  expect(dbExec(`select value from app_settings where key = 'safety_copy'`)).toBe('false');
  await page.reload();
  await expect(page.getByRole('checkbox', { name: /Safety copy before a database change/ })).not.toBeChecked();
  await page.getByRole('checkbox', { name: /Safety copy before a database change/ }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Safety copy before a database change/ })).toBeChecked();
  expect(dbExec(`select value from app_settings where key = 'safety_copy'`)).toBe('true');
});

test('the SuperAdmin sees the banner on Admin pages, opens What’s changing, and dismisses it for that version', async ({
  adminPage: page,
}) => {
  seedCheck([release('9.0.1', { security: true }), release('9.0.0', { migration: true, breaking: true })]);
  await page.goto('/admin/users');
  const banner = page.getByRole('region', { name: 'Update notice' });
  await expect(banner.getByText(`KinShip 9.0.1 is available. You are on ${running}.`)).toBeVisible();
  await expect(banner.getByText('Security update')).toBeVisible();
  await expect(banner.getByText('Includes breaking changes and a database change. Back up first.')).toBeVisible();
  // Every Admin page has it, and the Updates tab shows the result.
  await page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Backups' }).click();
  await expect(page.getByRole('region', { name: 'Update notice' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Updates' }).click();
  await expect(page.getByRole('region', { name: 'Version' }).getByText('9.0.1 available')).toBeVisible();

  await page.getByRole('region', { name: 'Update notice' }).getByRole('button', { name: 'What’s changing' }).click();
  const dialog = page.getByRole('dialog', { name: 'What’s changing' });
  await expect(dialog.getByText(`KinShip ${running} to 9.0.1 · 2 releases`)).toBeVisible();
  const box = dialog.getByRole('group', { name: 'Back up before you update.' });
  await expect(box.getByText('This update changes the database structure.')).toBeVisible();
  await expect(box.getByText('This update has breaking changes. Read the upgrade notes below.')).toBeVisible();
  await expect(box.getByText(/ago$/)).toBeVisible(); // journey 11 made a backup in this stack
  await expect(dialog.getByText('Rename BACKUP_KEEP in your .env.')).toBeVisible();
  // Notes from the internet are text, never markup.
  await expect(dialog.getByText("<script>document.title='hacked'</script>").first()).toBeVisible();
  expect(await page.title()).not.toBe('hacked');
  // A backup from the last 24 hours exists, so the steps are there to copy.
  await expect(dialog.getByText('docker compose pull && docker compose up -d', { exact: false })).toBeVisible();
  await expect(dialog.getByText('ghcr.io/officialjcreyes/kinship-api:9.0.1')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Dismiss hides it for that version, on this account, across reloads.
  await page.getByRole('region', { name: 'Update notice' }).getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByRole('region', { name: 'Update notice' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Admin sections' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Update notice' })).toHaveCount(0);

  // A newer version notifies again.
  seedCheck([release('9.0.2', {}), release('9.0.1', { security: true }), release('9.0.0', { migration: true })]);
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'Update notice' }).getByText(`KinShip 9.0.2 is available.`),
  ).toBeVisible();
});

test('a Family Admin has the Updates tab with a note only, no banner, and the api refuses them', async ({
  adminApi,
  browser,
}) => {
  const account = await createAccount(adminApi, {
    email: `fa-${uniq()}@example.com`,
    role: 'familyadmin',
    displayName: 'Priya Nair',
  });
  const context = await browser.newContext();
  await context.addCookies(account.cookies);
  const page = await context.newPage();
  await page.goto('/admin/updates');
  await expect(page.getByText('Only a SuperAdmin manages update checks.', { exact: false })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Update notice' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Check now' })).toHaveCount(0);
  for (const path of ['/api/admin/updates']) expect((await page.request.get(path)).status()).toBe(403);
  const post = await page.request.post('/api/admin/updates/check', {
    headers: { 'X-KinShip-Request': '1' },
  });
  expect(post.status()).toBe(403);
  await context.close();
});

test('What’s new opens once for an admin after an update, from the changelog inside the app, and Got it records it', async ({
  adminApi,
  browser,
}) => {
  const account = await createAccount(adminApi, {
    email: `fa-${uniq()}@example.com`,
    role: 'familyadmin',
    displayName: 'Daniel Hale',
  });
  // This account last saw an old version.
  dbExec(
    `update users set last_seen_version = '0.0.1', last_seen_at = now() - interval '30 days' where id = '${account.id}'`,
  );
  const context = await browser.newContext();
  await context.addCookies(account.cookies);
  const page = await context.newPage();
  await page.goto('/');
  const dialog = page.getByRole('dialog', { name: `KinShip was updated to ${running}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('From 0.0.1.')).toBeVisible();
  await expect(dialog.getByRole('region').first()).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'View full release notes' })).toHaveAttribute(
    'href',
    `https://github.com/officialJCReyes/kinship/releases/tag/v${running}`,
  );
  await dialog.getByRole('button', { name: 'Got it' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(dbExec(`select last_seen_version from users where id = '${account.id}'`)).toBe(running);
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // It can be opened again from About KinShip, for the latest update.
  await page.goto('/about');
  await page.getByRole('button', { name: 'What’s new' }).click();
  await expect(page.getByRole('dialog', { name: `KinShip was updated to ${running}` })).toBeVisible();
  await page.keyboard.press('Escape');
  await context.close();
});

test('a Member is told nothing: no popup, no button, no banner', async ({ adminApi, browser }) => {
  const account = await createAccount(adminApi, {
    email: `m-${uniq()}@example.com`,
    role: 'member',
    displayName: 'Carla Hale',
  });
  dbExec(`update users set last_seen_version = '0.0.1' where id = '${account.id}'`);
  const context = await browser.newContext();
  await context.addCookies(account.cookies);
  const page = await context.newPage();
  await page.goto('/about');
  await expect(page.getByRole('heading', { name: 'About KinShip' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'What’s new' })).toHaveCount(0);
  expect((await page.request.get('/api/updates/whats-new')).status()).toBe(403);
  await context.close();
});

test('a web and an api on different versions give a page of their own, and nothing was sent to GitHub', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 503, json: { error: 'version_mismatch', web: '0.1.0', api: '0.2.0' } }),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'KinShip’s web and api are on different versions' })).toBeVisible();
  await expect(page.getByText('The web container is 0.1.0 and the api is 0.2.0.', { exact: false })).toBeVisible();
  await context.close();

  // With checking off at the start, the api never made a check in this whole run.
  expect(apiLog()).not.toContain('update check');
});
