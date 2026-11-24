// SPDX-License-Identifier: AGPL-3.0-or-later
// Journey 16: photos (#98, ADR 0033, ADR 0034). Add a photo to a person through the screen, keep its EXIF date as a suggestion,
// make it the profile photo and see it on the profile, the People list and the tree, check that what is on disk is encrypted, that
// a wrong or oversized file is refused with a clear message, and that deleting the photo or the person removes the files.
// Uses the SuperAdmin session every journey shares: no extra sign-in. Fictional Hale-style data only.
import { request } from '@playwright/test';
import { createPerson } from '../support/api.js';
import { surname } from '../support/data.js';
import { expect, test } from '../support/fixtures.js';
import { makePng } from '../support/images.js';
import { BASE_URL, dbExec, storedFiles, storedFilesContain } from '../support/stack.js';

const CHOOSE = 'Choose a photo (JPEG, PNG or WebP, up to 10 MB)';
const HEADERS = { 'X-KinShip-Request': '1', Origin: BASE_URL };

test('add a photo, its date, the profile photo; encrypted on disk; refuse bad files; delete it', async ({
  adminPage: page,
}) => {
  test.setTimeout(120_000);
  const family = surname('Hale');
  const person = await createPerson(page.request, {
    givenName: 'Lena',
    surname: family,
    gender: 'female',
    birth: '1990',
  });
  const before = storedFiles().length;
  await page.goto(`/people/${person.id}`);
  await expect(page.getByRole('heading', { name: `Lena ${family}`, level: 1 })).toBeVisible();
  await expect(page.getByText('No photos yet. Add the first one.')).toBeVisible();
  await expect(page.locator('.profile-avatar img')).toHaveCount(0);

  // The file input takes exactly the three types.
  const input = page.getByLabel(CHOOSE);
  await expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');

  // A wrong choice never leaves the machine; a file that only CLAIMS to be a PNG is refused by the api, by what is inside it.
  await input.setInputFiles({ name: 'party.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') });
  await expect(page.getByRole('alert').filter({ hasText: 'Only JPEG, PNG and WebP' })).toBeVisible();
  await input.setInputFiles({ name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('this is not a picture') });
  await expect(page.getByRole('alert').filter({ hasText: 'Only JPEG, PNG and WebP' })).toBeVisible();
  await expect(page.getByText('No photos yet. Add the first one.')).toBeVisible();

  // The api's own limits, through the real web container (nginx lets a 10 MB body through but not 13 MB).
  const tooBig = await page.request.post(`/api/people/${person.id}/photos`, {
    headers: { ...HEADERS, 'Content-Type': 'image/png' },
    data: Buffer.alloc(13 * 1024 * 1024),
  });
  expect(tooBig.status()).toBe(413);
  const notPicture = await page.request.post(`/api/people/${person.id}/photos`, {
    headers: { ...HEADERS, 'Content-Type': 'image/png' },
    data: Buffer.alloc(3 * 1024 * 1024),
  });
  expect(notPicture.status()).toBe(415);
  expect(storedFiles()).toHaveLength(before);

  // A real picture, with the date its EXIF carries.
  await input.setInputFiles({
    name: 'holiday.png',
    mimeType: 'image/png',
    buffer: makePng({ takenOn: '2019:07:04 10:11:12' }),
  });
  const added = page.getByRole('dialog', { name: 'Photo added' });
  await expect(added.getByLabel('Date taken')).toHaveValue('2019-07-04');
  await expect(added.getByText(/The photo says it was taken on/)).toBeVisible();
  await added.getByRole('button', { name: 'Save date' }).click();
  await expect(added).toBeHidden();
  expect(dbExec(`select count(*) from media_files where taken_on = '2019-07-04'`)).toBe('1');

  // On disk: two sealed files, and nothing in them is a picture.
  expect(storedFiles()).toHaveLength(before + 2);
  expect(storedFilesContain('IHDR')).toBe(false);
  expect(storedFilesContain('PNG')).toBe(false);

  // Open it, see it full size and its date, make it the profile photo.
  await page.getByRole('button', { name: 'Open photo 1 of 1' }).click();
  const viewer = page.getByRole('dialog', { name: `Photo of Lena ${family}` });
  await expect(viewer.locator('img.photo-full')).toHaveJSProperty('naturalWidth', 64);
  await expect(viewer.locator('.photo-dialog-facts')).toContainText('2019');
  await viewer.getByRole('button', { name: 'Set as profile photo' }).click();
  await expect(viewer).toBeHidden();
  await expect(page.locator('.profile-avatar img')).toHaveJSProperty('naturalWidth', 192);
  await expect(page.locator('.profile-avatar img')).toHaveAttribute('alt', '');
  expect(dbExec(`select photo_media_id is not null from people where id = '${person.id}'`)).toBe('t');

  // The same picture in the People list and on the tree.
  await page.goto('/people');
  await page.getByLabel('Search by name').fill(family);
  await expect(page.getByRole('link', { name: `Lena ${family}` })).toBeVisible();
  await expect(
    page
      .getByRole('listitem')
      .filter({ hasText: `Lena ${family}` })
      .locator('img'),
  ).toHaveJSProperty('naturalWidth', 192);
  await page.goto(`/tree/${person.id}`);
  await expect(page.locator(`[data-node="${person.id}"] image`)).toHaveAttribute(
    'href',
    /^\/api\/media\/[0-9a-f-]+\/avatar$/,
  );

  // The Media tab lists every photo of the family; filtered to Lena it is just hers, and the viewer opens from it.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Media' }).click();
  await expect(page.getByRole('heading', { name: 'Media', level: 1 })).toBeVisible();
  await page.getByRole('combobox', { name: 'Show photos of' }).fill(`Lena`);
  await page.getByRole('option', { name: new RegExp(`Lena ${family}`) }).click();
  const tile = page.getByRole('button', { name: `Open photo of Lena ${family}` });
  await expect(page.getByRole('list', { name: 'Media' }).getByRole('listitem')).toHaveCount(1);
  await expect(tile.locator('img')).toHaveJSProperty('naturalWidth', 192);
  await expect(page.getByRole('button', { name: /add photo|upload/i })).toHaveCount(0);
  await tile.click();
  const fromMedia = page.getByRole('dialog', { name: `Photo of Lena ${family}` });
  await expect(fromMedia.getByText(/Shows:/)).toBeVisible();
  await expect(fromMedia.getByRole('button', { name: 'Delete photo' })).toBeVisible();
  await fromMedia.getByRole('button', { name: 'Done' }).click();
  await expect(fromMedia).toBeHidden();

  // Pictures are for signed-in accounts only.
  const photo = dbExec(`select id from media_files where uploaded_by is not null order by created_at desc limit 1`);
  const stranger = await request.newContext({ baseURL: BASE_URL });
  expect((await stranger.get(`/api/media/${photo}/full`)).status()).toBe(401);
  await stranger.dispose();
  const served = await page.request.get(`/api/media/${photo}/full`);
  expect(served.status()).toBe(200);
  expect(served.headers()['content-type']).toBe('image/png');
  expect(served.headers()['x-content-type-options']).toBe('nosniff');

  // Delete the photo: the row and both files go, and the profile falls back to initials.
  await page.goto(`/people/${person.id}`);
  await page.getByRole('button', { name: 'Open photo 1 of 1, the profile photo' }).click();
  await page
    .getByRole('dialog', { name: `Photo of Lena ${family}` })
    .getByRole('button', { name: 'Delete photo' })
    .click();
  const confirm = page.getByRole('dialog', { name: 'Delete this photo?' });
  await expect(confirm.getByText(/deleted for everyone/)).toBeVisible();
  await confirm.getByRole('button', { name: 'Delete photo' }).click();
  await expect(page.getByText('No photos yet. Add the first one.')).toBeVisible();
  await expect(page.locator('.profile-avatar img')).toHaveCount(0);
  expect(storedFiles()).toHaveLength(before);
  expect(dbExec(`select count(*) from media_files`)).toBe('0');
});

test('deleting a person says how many photos go with them, and removes the files', async ({ adminPage: page }) => {
  const family = surname('Hale');
  const person = await createPerson(page.request, {
    givenName: 'Ines',
    surname: family,
    gender: 'female',
    birth: '1985',
  });
  const before = storedFiles().length;
  await page.goto(`/people/${person.id}`);
  const input = page.getByLabel(CHOOSE);
  for (const tint of [10, 20]) {
    await input.setInputFiles({ name: `p${tint}.png`, mimeType: 'image/png', buffer: makePng({ tint }) });
    await page.getByRole('dialog', { name: 'Photo added' }).getByRole('button', { name: 'Leave it empty' }).click();
  }
  await expect(page.getByRole('list', { name: 'Photos' }).getByRole('listitem')).toHaveCount(2);
  expect(storedFiles()).toHaveLength(before + 4);

  await page.getByRole('button', { name: 'Delete person' }).click();
  const dialog = page.getByRole('dialog', { name: `Delete Ines ${family}?` });
  await expect(dialog.getByText('2 photos that show only this person will be deleted with them.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete person' }).click();
  await expect(page).toHaveURL(/\/people$/);
  expect(dbExec(`select count(*) from media_files`)).toBe('0');
  expect(storedFiles()).toHaveLength(before);
});

test('the camera on the avatar: upload a new profile photo, then choose another of their photos from the tree', async ({
  adminPage: page,
}) => {
  test.setTimeout(120_000);
  const family = surname('Hale');
  const person = await createPerson(page.request, {
    givenName: 'Mira',
    surname: family,
    gender: 'female',
    birth: '1992',
  });
  const before = storedFiles().length;
  await page.goto(`/people/${person.id}`);
  await expect(page.getByRole('heading', { name: `Mira ${family}`, level: 1 })).toBeVisible();

  // No photos yet: choosing is greyed out, with the reason.
  // (The hidden file input next to it has the same name, and Chromium calls it a button too: find the camera by its class.)
  const camera = page.locator('.profile-avatar .photo-button');
  await expect(camera).toHaveAccessibleName('Add profile photo');
  await camera.click();
  const menu = page.getByRole('menu', { name: 'Add profile photo' });
  await expect(menu.getByRole('menuitem', { name: /Choose from their photos/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expect(menu).toContainText(`There are no photos of Mira ${family} yet.`);

  // Upload a new photo: the same upload as the Photos card, then the date step; it becomes the profile photo.
  const chooser = page.waitForEvent('filechooser');
  await menu.getByRole('menuitem', { name: 'Upload a new photo' }).click();
  await (await chooser).setFiles({ name: 'first.png', mimeType: 'image/png', buffer: makePng({ tint: 30 }) });
  await page.getByRole('dialog', { name: 'Photo added' }).getByRole('button', { name: 'Leave it empty' }).click();
  await expect(page.locator('.profile-avatar img')).toHaveJSProperty('naturalWidth', 192);
  const first = await page.locator('.profile-avatar img').getAttribute('src');

  // A second photo through the Photos card (which stays a gallery and does not change the profile photo).
  await page
    .getByLabel(CHOOSE)
    .setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: makePng({ tint: 60 }) });
  await page.getByRole('dialog', { name: 'Photo added' }).getByRole('button', { name: 'Leave it empty' }).click();
  await expect(page.getByRole('list', { name: 'Photos' }).getByRole('listitem')).toHaveCount(2);
  await expect(page.locator('.profile-avatar img')).toHaveAttribute('src', first ?? '');

  // On the tree: the person panel's camera, Choose from their photos, the newest one. Panel and card change without a reload.
  await page.goto(`/tree/${person.id}`);
  const panel = page.getByRole('complementary', { name: 'Selected person' });
  await expect(panel.locator('.photo-button')).toHaveAccessibleName('Change profile photo');
  await panel.locator('.photo-button').click();
  await page
    .getByRole('menu', { name: 'Change profile photo' })
    .getByRole('menuitem', { name: 'Choose from their photos' })
    .click();
  const picker = page.getByRole('dialog', { name: `Choose a profile photo for Mira ${family}` });
  await expect(picker.getByRole('button', { name: 'Photo 2, the profile photo now' })).toBeVisible();
  await picker.getByRole('button', { name: 'Use photo 1 as the profile photo' }).click();
  await expect(picker).toBeHidden();
  await expect(page.getByText('Profile photo changed.')).toBeVisible();
  await expect(panel.locator('.profile-avatar img')).not.toHaveAttribute('src', first ?? '');
  const now = await panel.locator('.profile-avatar img').getAttribute('src');
  await expect(page.locator(`[data-node="${person.id}"] image`).first()).toHaveAttribute('href', now ?? '');

  // Remove profile photo (backlog 8): asks first, then the avatar and the card go back to initials; both photos stay hers.
  await panel.locator('.photo-button').click();
  await page
    .getByRole('menu', { name: 'Change profile photo' })
    .getByRole('menuitem', { name: 'Remove profile photo' })
    .click();
  const confirm = page.getByRole('dialog', { name: `Remove Mira ${family}’s profile photo?` });
  await confirm.getByRole('button', { name: 'Remove profile photo' }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByText('Profile photo removed. The photo is still in their photos.')).toBeVisible();
  await expect(panel.locator('.profile-avatar img')).toHaveCount(0);
  await expect(panel.locator('.photo-button')).toHaveAccessibleName('Add profile photo');
  await expect(page.locator(`[data-node="${person.id}"] image`)).toHaveCount(0);
  const kept = await page.request.get(`/api/people/${person.id}/photos`);
  expect(((await kept.json()) as { items: unknown[] }).items).toHaveLength(2);

  // Leave nothing behind for the journeys after this one.
  const removed = await page.request.delete(`/api/people/${person.id}`, { headers: HEADERS });
  expect(removed.status()).toBe(204);
  expect(storedFiles()).toHaveLength(before);
});
