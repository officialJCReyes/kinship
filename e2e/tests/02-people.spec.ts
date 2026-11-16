// SPDX-License-Identifier: AGPL-3.0-or-later
// Journey 2: people. Add a person, find them, open the profile, edit details, and see a warning that
// does not block the save.
import { createPerson } from '../support/api.js';
import { surname } from '../support/data.js';
import { expect, test } from '../support/fixtures.js';

test('add a person, find them in People, open the profile and edit the details', async ({ adminPage: page }) => {
  const family = surname('Hale');
  await page.goto('/people');
  await page.getByRole('button', { name: 'Add person' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add person' });
  await dialog.getByLabel('Given name').fill('Walter');
  await dialog.getByLabel('Surname', { exact: true }).fill(family);
  await dialog.getByLabel('Gender').selectOption('male');
  await dialog.getByLabel('Birth date', { exact: true }).fill('1930-03');
  await expect(dialog.getByText('Reads as: Mar 1930')).toBeVisible();
  await dialog.getByRole('button', { name: 'Add person' }).click();

  // The new profile opens, with a message.
  await expect(page.getByRole('heading', { name: `Walter ${family}`, level: 1 })).toBeVisible();
  await expect(page.getByText(`Walter ${family} was added.`)).toBeVisible();
  await expect(page.getByText('Mar 1930')).toBeVisible();

  // The same person is found by searching for the surname.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'People' }).click();
  await page.getByLabel('Search by name').fill(family);
  await page.getByRole('link', { name: `Walter ${family}` }).click();
  await expect(page.getByRole('heading', { name: `Walter ${family}`, level: 1 })).toBeVisible();

  // Edit details: deceased, with a death date.
  await page.getByRole('button', { name: 'Edit details' }).click();
  const edit = page.getByRole('dialog', { name: `Edit details: Walter ${family}` });
  await edit.getByLabel('Status', { exact: true }).selectOption('deceased');
  await edit.getByLabel('Date of death', { exact: true }).fill('2005-11-02');
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(edit).toBeHidden();
  const facts = page.getByRole('main');
  await expect(facts.getByText('Nov 2, 2005')).toBeVisible();
  await expect(facts.getByText('Deceased', { exact: true })).toBeVisible();
  await expect(facts.getByText('1930 – 2005')).toBeVisible();
});

test('a bad date is explained and nothing is saved', async ({ adminPage: page }) => {
  const person = await createPerson(page.request, { givenName: 'Iris', surname: surname('Hale') });
  await page.goto(`/people/${person.id}`);
  await page.getByRole('button', { name: 'Edit details' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Birth date', { exact: true }).fill('1955-02-30');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText(/Enter a date as YYYY/)).toBeVisible();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Birth date', { exact: true }).fill('1955-02-28');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Feb 28, 1955')).toBeVisible();
});

test('a parent who is too young is warned about, and the child is still saved', async ({ adminPage: page }) => {
  const family = surname('Hale');
  const parent = await createPerson(page.request, {
    givenName: 'Pia',
    surname: family,
    gender: 'female',
    birth: '1950',
  });
  await page.goto(`/people/${parent.id}`);
  await page.getByRole('button', { name: 'Add relative' }).click();
  await page.getByRole('button', { name: 'Add son' }).click();
  const dialog = page.getByRole('dialog', { name: `Add son to Pia ${family}` });
  await dialog.getByLabel('Given name').fill('Tomas');
  await dialog.getByLabel('Surname', { exact: true }).fill(family);
  await dialog.getByLabel('Birth date', { exact: true }).fill('1958');
  await dialog.getByRole('button', { name: 'Save' }).click();

  await expect(dialog).toBeHidden();
  await expect(
    page.getByText('The parent is only 8 years older than the child. Please check the birth years.'),
  ).toBeVisible();
  await expect(page.getByText(`Tomas ${family} was added to the tree.`)).toBeVisible();
  // He hangs from Pia alone, and is listed that way.
  await expect(page.getByRole('heading', { name: 'Children of this person alone' })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(`Tomas ${family}`) })).toBeVisible();
});

test('a dialog closes with Escape and gives focus back to the button that opened it', async ({ adminPage: page }) => {
  const person = await createPerson(page.request, { givenName: 'Nell', surname: surname('Hale') });
  await page.goto(`/people/${person.id}`);
  const opener = page.getByRole('button', { name: 'Edit details' });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Focus moved into the dialog.
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
  // Tab never leaves it.
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});
