// SPDX-License-Identifier: AGPL-3.0-or-later
// Journey 6: the Family tree chart. One family is built through the API (the chart is what is being tested, not
// the forms), then looked at through the screens.
import { createAccount } from '../support/accounts.js';
import { createChild, createPerson, createUnion } from '../support/api.js';
import type { Made } from '../support/api.js';
import { surname, uniq } from '../support/data.js';
import { expect, tabTo, test } from '../support/fixtures.js';

test.describe.configure({ mode: 'serial' });

const family = surname('Hale');
const lenaFamily = surname('Okafor');
let daniel: Made;
let sofia: Made;
let unions: { elena: string; carla: string; lena: string };

const person = (page: import('@playwright/test').Page, given: string, surnameText = family) =>
  page.getByRole('button', { name: new RegExp(`^${given} ${surnameText}`) });

test('build a family: two partners, children, an in-law with parents', async ({ adminPage: page }) => {
  const request = page.request;
  daniel = await createPerson(request, { givenName: 'Daniel', surname: family, gender: 'male', birth: '1960' });
  const elena = await createPerson(request, { givenName: 'Elena', surname: family, gender: 'female', birth: '1962' });
  const carla = await createPerson(request, { givenName: 'Carla', surname: family, gender: 'female', birth: '1965' });
  const married = await createUnion(request, daniel.id, elena.id, 'married', '1985');
  const divorced = await createUnion(request, daniel.id, carla.id, 'divorced', '1993');
  await createChild(request, daniel.id, { givenName: 'Marcus', surname: family, gender: 'male' }, married);
  sofia = await createChild(request, daniel.id, { givenName: 'Sofia', surname: family, gender: 'female' }, married);
  await createChild(request, daniel.id, { givenName: 'Ben', surname: family, gender: 'male' }, divorced);
  // Carla's own son from before: hangs from her alone, and the chart draws him under her (issue #22).
  await createChild(request, carla.id, { givenName: 'Nico', surname: family, gender: 'male' });
  // Lena is Sofia's fiancée; her parents are on the tree but belong to her side.
  const femi = await createPerson(request, { givenName: 'Femi', surname: lenaFamily, gender: 'male', birth: '1960' });
  const nora = await createPerson(request, { givenName: 'Nora', surname: lenaFamily, gender: 'female', birth: '1962' });
  const parents = await createUnion(request, femi.id, nora.id, 'married', '1985');
  const lena = await createChild(
    request,
    femi.id,
    { givenName: 'Lena', surname: lenaFamily, gender: 'female' },
    parents,
  );
  const engaged = await createUnion(request, sofia.id, lena.id, 'engaged', '2024');
  unions = { elena: married, carla: divorced, lena: engaged };
});

test('open the chart, select a person and read the panel', async ({ adminPage: page }) => {
  await page.goto(`/tree/${daniel.id}`);
  const marcus = person(page, 'Marcus');
  await expect(marcus).toHaveAccessibleName(new RegExp(`^Marcus ${family}, male$`));
  await marcus.click();
  const panel = page.getByRole('complementary', { name: 'Selected person' });
  await expect(panel.getByRole('heading', { name: `Marcus ${family}` })).toBeVisible();
  await expect(panel.getByText('Living')).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Open profile' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Edit details' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Add relative' })).toBeVisible();
  await expect(page).toHaveURL(/[?&]sel=/);
  // Back works: the selection is in the address, so Back returns to the first state.
  await person(page, 'Sofia').click();
  await expect(panel.getByRole('heading', { name: `Sofia ${family}` })).toBeVisible();
  await page.goBack();
  await expect(panel.getByRole('heading', { name: `Marcus ${family}` })).toBeVisible();
});

test('a partner’s own child from before is drawn under her, and her ex-partner’s family is not pulled in', async ({
  adminPage: page,
}) => {
  await page.goto(`/tree/${daniel.id}`);
  await expect(person(page, 'Nico')).toBeVisible();
  await expect(person(page, 'Carla')).toBeVisible();
  const nico = await person(page, 'Nico').boundingBox();
  const carla = await person(page, 'Carla').boundingBox();
  expect(nico!.y).toBeGreaterThan(carla!.y);
  // He is below her and hangs from her alone, not from the relationship with Daniel.
  await expect(page.locator(`[data-union="${unions.carla}"]`)).toHaveCount(1);
});

test('lines: solid for a marriage, dotted for a divorce, and a couple line opens its relationship', async ({
  adminPage: page,
}) => {
  await page.goto(`/tree/${daniel.id}`);
  await expect(person(page, 'Marcus')).toBeVisible();
  await expect(page.locator(`[data-union="${unions.elena}"] .line`)).toHaveAttribute('data-line', 'solid');
  await expect(page.locator(`[data-union="${unions.carla}"] .line`)).toHaveAttribute('data-line', 'dotted');
  await expect(page.locator(`[data-union="${unions.lena}"] .line`)).toHaveAttribute('data-line', 'solid');

  // Click the line between Daniel and Elena, change the status, and see the chart change.
  const hit = page.locator(`[data-union="${unions.elena}"] .hit`);
  const box = (await hit.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const dialog = page.getByRole('dialog', { name: /^Relationship: / });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Relationship status').selectOption('separated');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(`[data-union="${unions.elena}"] .line`)).toHaveAttribute('data-line', 'dotted');
  // …and the panel's partner list has the same relationship, with Edit relationship as the keyboard path.
  await person(page, 'Daniel').click();
  const panel = page.getByRole('complementary', { name: 'Selected person' });
  await expect(panel.getByRole('button', { name: 'Edit relationship' })).toHaveCount(2);
});

test('the leaf flips to an in-law’s family and back', async ({ adminPage: page }) => {
  await page.goto(`/tree/${daniel.id}`);
  const leaf = page.getByRole('button', { name: 'Show Lena’s family (2 people)' });
  await expect(leaf).toBeVisible();
  // Lena's parents are not on the chart until the leaf is used; a leaf is not on Sofia (her parents are drawn).
  await expect(person(page, 'Femi', lenaFamily)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Show Sofia/ })).toHaveCount(0);
  await leaf.click();
  await expect(page.getByText('Lena’s family', { exact: true })).toBeVisible();
  await expect(person(page, 'Femi', lenaFamily)).toBeVisible();
  await expect(person(page, 'Nora', lenaFamily)).toBeVisible();
  await expect(person(page, 'Sofia')).toBeVisible();
  // Sofia's brothers and the rest of the Hales are not part of Lena's family.
  await expect(person(page, 'Marcus')).toHaveCount(0);
  await expect(page).toHaveURL(/of=/);
  // No back button: Sofia's parents are on the main chart, so her leaf goes back.
  await expect(page.getByRole('button', { name: /^Back/ })).toHaveCount(0);
  await page.getByRole('button', { name: /^Show Sofia’s family/ }).click();
  await expect(page.getByText('Lena’s family', { exact: true })).toBeHidden();
  await expect(person(page, 'Marcus')).toBeVisible();
  await expect(page).not.toHaveURL(/of=/);
});

test('keyboard: one tab stop, arrows move between people, Enter selects', async ({ adminPage: page }) => {
  await page.goto(`/tree/${daniel.id}`);
  const stops = page.locator('[data-node][tabindex="0"]');
  await expect(stops).toHaveCount(1);
  await tabTo(page, stops.first());
  await page.keyboard.press('ArrowDown'); // from Daniel to one of his children
  const focusedName = async () => (await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) ?? '';
  expect(await focusedName()).toContain(family);
  expect(await focusedName()).not.toMatch(/^Daniel/);
  await page.keyboard.press('ArrowUp'); // and back up to a parent
  expect(await focusedName()).toMatch(/^(Daniel|Elena|Carla)/);
  await page.keyboard.press('Enter');
  const panel = page.getByRole('complementary', { name: 'Selected person' });
  await expect(panel.getByRole('heading', { level: 2 })).toContainText(family);
  // Up from Lena goes to her leaf, and Enter on it flips the chart.
  await person(page, 'Lena', lenaFamily).focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Lena’s family', { exact: true })).toBeVisible();
  // Zoom with the keyboard.
  const before = await page.locator('.tree-canvas > svg > g').getAttribute('transform');
  await person(page, 'Sofia').focus();
  await page.keyboard.press('+');
  await expect.poll(() => page.locator('.tree-canvas > svg > g').getAttribute('transform')).not.toBe(before);
});

test('an account linked to nobody is asked who to start from', async ({ page, adminApi }) => {
  const who = { email: `viewer-${uniq()}@hale.example`, name: 'Vera' };
  const account = await createAccount(adminApi, {
    email: who.email,
    role: 'member',
    displayName: `${who.name} ${family}`,
  });
  await page.context().addCookies(account.cookies);
  await page.goto('/tree');
  await expect(page.getByRole('heading', { name: 'Choose who to start from' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Starting person' }).fill(`Daniel ${family}`);
  await page.getByRole('option', { name: new RegExp(`Daniel ${family}`) }).click();
  await page.getByRole('button', { name: 'Show the tree' }).click();
  await expect(page).toHaveURL(new RegExp(`/tree/${daniel.id}`));
  await expect(person(page, 'Marcus')).toBeVisible();
  // A Member linked to nobody cannot edit a relationship from the chart: the line only has its tooltip.
  await expect(page.locator(`[data-union="${unions.elena}"] .hit.editable`)).toHaveCount(0);
});
