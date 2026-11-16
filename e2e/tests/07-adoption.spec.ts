// SPDX-License-Identifier: AGPL-3.0-or-later
// Journey 7: adoption. A person with birth parents is given adoptive parents through Add relative, the profile
// lists both families, each viewer chooses which one the charts follow, and the leaf opens the other.
import { createChild, createPerson, createUnion, signIn } from '../support/api.js';
import type { Made } from '../support/api.js';
import { password, surname, uniq } from '../support/data.js';
import { expect, test } from '../support/fixtures.js';
import type { Page } from '@playwright/test';
import { ADMIN } from '../support/data.js';
import { BASE_URL } from '../support/stack.js';
import { insertTestAccount } from '../support/stack.js';

test.describe.configure({ mode: 'serial' });

const adopters = surname('Hale');
const birthFamily = surname('Doyle');
let samuel: Made;
// One signed-in admin session for the whole journey (the sign-in route is rate limited, and this is one story).
let admin: Page;
test.beforeAll(async ({ browser }) => {
  admin = await (await browser.newContext({ baseURL: BASE_URL })).newPage();
  await signIn(admin, ADMIN.email, password());
});
test.afterAll(async () => {
  await admin.context().close();
});

const person = (page: import('@playwright/test').Page, given: string, family: string) =>
  page.getByRole('button', { name: new RegExp(`^${given} ${family}`) });

test('the birth family is already there: Frank and Ruth, and their son Samuel', async () => {
  const page = admin;
  const frank = await createPerson(page.request, {
    givenName: 'Frank',
    surname: birthFamily,
    gender: 'male',
    birth: '1910',
  });
  const ruth = await createPerson(page.request, {
    givenName: 'Ruth',
    surname: birthFamily,
    gender: 'female',
    birth: '1912',
  });
  const union = await createUnion(page.request, frank.id, ruth.id, 'married', '1932');
  samuel = await createChild(page.request, frank.id, { givenName: 'Samuel', surname: adopters, gender: 'male' }, union);
});

test('an admin adds adoptive parents in Add relative, with the year, and the profile lists both families', async () => {
  const page = admin;
  await page.goto(`/people/${samuel.id}`);
  await page.getByRole('button', { name: 'Add relative' }).click();
  await page.getByRole('button', { name: 'Add father' }).click();
  let dialog = page.getByRole('dialog', { name: /^Add father to/ });
  // Samuel already has two birth parents, so only the adoptive kind can take another.
  const kinds = dialog.getByRole('group', { name: 'Type of parent-child link' });
  await expect(kinds.getByRole('radio', { name: 'Birth' })).toBeDisabled();
  await expect(kinds.getByRole('radio', { name: 'Adoptive' })).toBeChecked();
  await dialog.getByLabel('Given name').fill('Joseph');
  await dialog.getByLabel('Surname', { exact: true }).fill(adopters);
  await dialog.getByLabel('Gender').selectOption('male');
  await dialog.getByLabel('Date of the adoption (the year is enough)', { exact: true }).fill('1938');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: 'Add relative' }).click();
  await page.getByRole('button', { name: 'Add mother' }).click();
  dialog = page.getByRole('dialog', { name: /^Add mother to/ });
  await expect(dialog.getByText(/a relationship with status Unknown will be created/)).toBeVisible();
  await dialog.getByLabel('Given name').fill('Anna');
  await dialog.getByLabel('Surname', { exact: true }).fill(adopters);
  await dialog.getByLabel('Date of the adoption (the year is enough)', { exact: true }).fill('1938');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  const parents = page.getByRole('heading', { name: 'Parents', level: 2 }).locator('..');
  await expect(parents.getByRole('heading', { name: 'Adoptive family' })).toBeVisible();
  await expect(parents.getByRole('heading', { name: 'Birth family' })).toBeVisible();
  await expect(parents.getByRole('link', { name: new RegExp(`Joseph ${adopters}.*Adoptive father`) })).toBeVisible();
  await expect(parents.getByRole('link', { name: new RegExp(`Anna ${adopters}.*Adoptive mother`) })).toBeVisible();
  await expect(parents.getByRole('link', { name: new RegExp(`Frank ${birthFamily}.*Birth father`) })).toBeVisible();
  await expect(parents.getByRole('link', { name: new RegExp(`Ruth ${birthFamily}.*Birth mother`) })).toBeVisible();
  await expect(parents.getByText(/1938/).first()).toBeVisible();
  // The adoptive couple has an Unknown relationship, made automatically.
  await page.getByRole('link', { name: new RegExp(`Joseph ${adopters}`) }).click();
  await expect(
    page
      .getByRole('article', { name: new RegExp(`^Relationship with Anna ${adopters}`) })
      .getByText('Unknown', { exact: true }),
  ).toBeVisible();
  // …and Joseph's profile calls Samuel his adopted son.
  await expect(page.getByRole('link', { name: new RegExp(`Samuel ${adopters}.*Adopted son, 1938`) })).toBeVisible();
});

test('each viewer chooses their own family: the banner switch changes the charts and the profile of a parent', async () => {
  const page = admin;
  await page.goto(`/people/${samuel.id}`);
  await expect(page.getByText(/The charts follow Samuel’s adoptive family/)).toBeVisible();
  await page.getByRole('button', { name: 'Show birth families' }).click();
  await expect(page.getByText(/The charts follow Samuel’s birth family/)).toBeVisible();
  await page.goto(`/tree/${samuel.id}`);
  await expect(person(page, 'Frank', birthFamily)).toBeVisible();
  await expect(person(page, 'Joseph', adopters)).toHaveCount(0);
  // Back to the default for the next steps.
  await page.goto(`/people/${samuel.id}`);
  await page.getByRole('button', { name: 'Show adoptive families' }).click();
  await expect(page.getByText(/The charts follow Samuel’s adoptive family/)).toBeVisible();
});

test('the chart follows the adoptive family, and the leaf (or the panel button) opens the birth family and back', async () => {
  const page = admin;
  await page.goto(`/tree/${samuel.id}`);
  await expect(person(page, 'Joseph', adopters)).toBeVisible();
  await expect(person(page, 'Frank', birthFamily)).toHaveCount(0);
  const leaf = page.locator(`[data-leaf-other="${samuel.id}"]`);
  await expect(leaf).toHaveAttribute('aria-label', 'Show Samuel’s birth family (2 people)');
  await leaf.click();
  await expect(page.getByText('Samuel’s birth family', { exact: true })).toBeVisible();
  await expect(person(page, 'Frank', birthFamily)).toBeVisible();
  await expect(person(page, 'Joseph', adopters)).toHaveCount(0);
  await expect(page).toHaveURL(/of=.*lineage=birth/);
  // On this chart the leaf on Samuel opens the adoptive family, which is the main chart.
  await page.locator(`[data-leaf-other="${samuel.id}"]`).click();
  await expect(page.getByText('Samuel’s birth family', { exact: true })).toBeHidden();
  await expect(person(page, 'Joseph', adopters)).toBeVisible();

  // The keyboard path: the button in the person panel, with the count in its name.
  const panel = page.getByRole('complementary', { name: 'Selected person' });
  const button = panel.getByRole('button', { name: 'Show Samuel’s birth family (2 people)' });
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Samuel’s birth family', { exact: true })).toBeVisible();
});

test('a Member adding a child gets no choice of link type, and the child is a birth child', async ({ page }) => {
  const who = { email: `member-${uniq()}@hale.example`, name: 'Mara' };
  const own = await createPersonAsAdmin();
  insertTestAccount({
    email: who.email,
    displayName: `${who.name} ${adopters}`,
    role: 'member',
    password: password(),
    personId: own.id,
  });
  await signIn(page, who.email, password());
  await page.goto(`/people/${own.id}`);
  await page.getByRole('button', { name: 'Add relative' }).click();
  await page.getByRole('button', { name: 'Add son' }).click();
  const dialog = page.getByRole('dialog', { name: /^Add son to/ });
  await expect(dialog.getByText('Type of parent-child link')).toHaveCount(0);
  await dialog.getByLabel('Given name').fill('Milo');
  await dialog.getByLabel('Surname', { exact: true }).fill(adopters);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('link', { name: new RegExp(`Milo ${adopters}.*Son`) })).toBeVisible();
});

async function createPersonAsAdmin(): Promise<Made> {
  return createPerson(admin.request, { givenName: 'Mara', surname: adopters, gender: 'female', birth: '1985' });
}
