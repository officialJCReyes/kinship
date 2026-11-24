// SPDX-License-Identifier: AGPL-3.0-or-later
// Journey 3: Add relative as an admin. One family is built step by step through the screens, so the
// tests run in order and share it.
import { createChild, createPerson } from '../support/api.js';
import type { Made } from '../support/api.js';
import { surname } from '../support/data.js';
import { expect, test } from '../support/fixtures.js';

test.describe.configure({ mode: 'serial' });

const family = surname('Hale');
let daniel: Made;
const named = (given: string) => `${given} ${family}`;

test('add a partner with a status and a date', async ({ adminPage: page }) => {
  daniel = await createPerson(page.request, { givenName: 'Daniel', surname: family, gender: 'male', birth: '1960' });
  await page.goto(`/people/${daniel.id}`);
  await page.getByRole('button', { name: 'Add relative' }).click();
  await page.getByRole('button', { name: /^Add partner/ }).click();
  const dialog = page.getByRole('dialog', { name: `Add partner to ${named('Daniel')}` });
  await dialog.getByLabel('Given (and middle) name').fill('Elena');
  await dialog.getByLabel('Surname', { exact: true }).fill(family);
  await dialog.getByLabel('Gender').selectOption('female');
  await dialog.getByLabel('Relationship status').selectOption('married');
  await dialog.getByLabel('Marriage or start date', { exact: true }).fill('1985-05');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  // The card says Wife, with the status and the date.
  const card = page.getByRole('article', { name: `Relationship with ${named('Elena')}` });
  await expect(card.getByRole('heading', { name: new RegExp(`^Wife:`) })).toBeVisible();
  await expect(card.getByText('Married', { exact: true })).toBeVisible();
  await expect(card.getByText('May 1985')).toBeVisible();
});

test('add a child with that partner as the other parent', async ({ adminPage: page }) => {
  await page.goto(`/people/${daniel.id}`);
  await page.getByRole('button', { name: 'Add relative' }).click();
  await page.getByRole('button', { name: 'Add son' }).click();
  const dialog = page.getByRole('dialog', { name: `Add son to ${named('Daniel')}` });
  await dialog.getByLabel('Given (and middle) name').fill('Marcus');
  await dialog.getByLabel('Surname', { exact: true }).fill(family);
  await expect(dialog.getByLabel('Other parent')).toHaveValue(/.+/); // the partner is chosen already
  await expect(dialog.getByRole('option', { name: `${named('Elena')} (Married)` })).toBeAttached();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  const card = page.getByRole('article', { name: `Relationship with ${named('Elena')}` });
  await expect(card.getByRole('link', { name: new RegExp(`${named('Marcus')}.*Son`) })).toBeVisible();
});

test('add a child whose other parent is not on the tree', async ({ adminPage: page }) => {
  await page.goto(`/people/${daniel.id}`);
  await page.getByRole('button', { name: 'Add relative' }).click();
  await page.getByRole('button', { name: 'Add daughter' }).click();
  const dialog = page.getByRole('dialog', { name: `Add daughter to ${named('Daniel')}` });
  await dialog.getByLabel('Given (and middle) name').fill('Carla');
  await dialog.getByLabel('Surname', { exact: true }).fill(family);
  await dialog.getByLabel('Other parent').selectOption({ label: 'The other parent is not on the tree' });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  // Listed as a child of Daniel alone, not under the marriage.
  await expect(page.getByRole('heading', { name: 'Children of this person alone' })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(`${named('Carla')}.*Daughter`) })).toBeVisible();
  const card = page.getByRole('article', { name: `Relationship with ${named('Elena')}` });
  await expect(card.getByText(named('Carla'))).toHaveCount(0);
});

test('a second parent who is not linked gets a relationship with status Unknown', async ({ adminPage: page }) => {
  await page.goto('/people');
  await page.getByLabel('Search by name').fill(named('Carla'));
  await page.getByRole('link', { name: named('Carla') }).click();
  await expect(page.getByRole('heading', { name: named('Carla'), level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Add relative' }).click();
  // Daniel is her birth father, so only the birth mother is missing (an admin can also add adoptive parents).
  await page.getByRole('button', { name: 'Add mother' }).click();
  const dialog = page.getByRole('dialog', { name: `Add mother to ${named('Carla')}` });
  await expect(dialog.getByRole('radio', { name: 'Birth' })).toBeChecked();
  await expect(dialog.getByText(/a relationship with status Unknown will be created/)).toBeVisible();
  await dialog.getByLabel('Given (and middle) name').fill('Priya');
  await dialog.getByLabel('Surname', { exact: true }).fill(family);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  const parents = page.getByRole('heading', { name: 'Parents' }).locator('..');
  await expect(parents.getByRole('link', { name: new RegExp(named('Daniel')) })).toBeVisible();
  await expect(parents.getByRole('link', { name: new RegExp(named('Priya')) })).toBeVisible();

  // On Daniel's page the new relationship is there, as Unknown.
  await page.goto(`/people/${daniel.id}`);
  const card = page.getByRole('article', { name: `Relationship with ${named('Priya')}` });
  await expect(card.getByText('Unknown', { exact: true })).toBeVisible();
  await expect(card.getByRole('heading', { name: /^Partner \(status unknown\):/ })).toBeVisible();
});

test('add a sibling, and tell full siblings from half-siblings', async ({ adminPage: page }) => {
  await page.goto('/people');
  await page.getByLabel('Search by name').fill(named('Marcus'));
  await page.getByRole('link', { name: named('Marcus') }).click();
  await expect(page.getByRole('heading', { name: named('Marcus'), level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Add relative' }).click();
  await page.getByRole('button', { name: 'Add sister' }).click();
  const dialog = page.getByRole('dialog', { name: `Add sister to ${named('Marcus')}` });
  await dialog.getByLabel('Given (and middle) name').fill('Sofia');
  await dialog.getByLabel('Surname', { exact: true }).fill(family);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  // Sofia has both of Marcus's parents; Carla has only Daniel (and Priya), so she is a half-sister.
  const full = page.getByRole('list', { name: 'Full siblings' });
  await expect(full.getByRole('link', { name: new RegExp(`${named('Sofia')}.*Sister`) })).toBeVisible();
  const half = page.getByRole('list', { name: 'Half-siblings' });
  await expect(half.getByRole('link', { name: new RegExp(`${named('Carla')}.*Half-sister`) })).toBeVisible();
  await expect(full.getByText(named('Carla'))).toHaveCount(0);
});

test('children entered under one parent first are linked to the second parent (ADR 0039)', async ({
  adminPage: page,
}) => {
  // The stepsister case: a father, his daughter added under him alone, then the mother added as his partner.
  const kin = surname('Hale');
  const as = (given: string) => `${given} ${kin}`;
  const frank = await createPerson(page.request, { givenName: 'Frank', surname: kin, gender: 'male', birth: '1950' });
  await createChild(page.request, frank.id, { givenName: 'Sue', surname: kin, gender: 'female' });
  await page.goto(`/people/${frank.id}`);
  await page.getByRole('button', { name: 'Add relative' }).click();
  await page.getByRole('button', { name: /^Add partner/ }).click();
  const dialog = page.getByRole('dialog', { name: `Add partner to ${as('Frank')}` });
  await dialog.getByLabel('Given (and middle) name').fill('Mona');
  await dialog.getByLabel('Surname', { exact: true }).fill(kin);
  await dialog.getByLabel('Gender').selectOption('female');
  await dialog.getByLabel('Relationship status').selectOption('married');
  // Frank has no other relationship, so his daughter is ticked already.
  const list = dialog.getByRole('group', { name: 'Are any of these also Mona’s children?' });
  await expect(list.getByRole('checkbox', { name: new RegExp(as('Sue')) })).toBeChecked();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  const card = page.getByRole('article', { name: `Relationship with ${as('Mona')}` });
  await expect(card.getByRole('link', { name: new RegExp(`${as('Sue')}.*Daughter`) })).toBeVisible();

  // A second daughter, again under Frank alone, is linked later from Mona's profile.
  await createChild(page.request, frank.id, { givenName: 'Tess', surname: kin, gender: 'female' });
  await card.getByRole('link', { name: as('Mona') }).click();
  await expect(page.getByRole('heading', { name: as('Mona'), level: 1 })).toBeVisible();
  await page.getByRole('button', { name: `${as('Tess')} is also ${as('Mona')}’s child` }).click();
  const repair = page.getByRole('dialog', { name: `Also ${as('Mona')}’s children` });
  await expect(repair.getByRole('checkbox', { name: new RegExp(as('Tess')) })).toBeChecked();
  await repair.getByRole('button', { name: 'Save' }).click();
  await expect(repair).toBeHidden();
  const monaCard = page.getByRole('article', { name: `Relationship with ${as('Frank')}` });
  await expect(monaCard.getByRole('link', { name: new RegExp(`${as('Tess')}.*Daughter`) })).toBeVisible();
  await expect(page.getByRole('button', { name: /is also .*’s child/ })).toHaveCount(0);

  // Sue and Tess are full sisters now, and neither has a step title.
  await page.goto(`/people/${frank.id}`);
  await card.getByRole('link', { name: new RegExp(`${as('Sue')}.*Daughter`) }).click();
  await expect(page.getByRole('heading', { name: as('Sue'), level: 1 })).toBeVisible();
  const full = page.getByRole('list', { name: 'Full siblings' });
  await expect(full.getByRole('link', { name: new RegExp(`${as('Tess')}.*Sister`) })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Step relatives' })).toHaveCount(0);
});
