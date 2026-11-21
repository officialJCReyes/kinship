// SPDX-License-Identifier: AGPL-3.0-or-later
// Journey 8: names, Widowed and step relatives. A partner is added with a second and a married surname (Facts and
// the chart show them), marking someone deceased turns their marriage into Widowed and back, a step-parent and a
// stepchild appear through a Married relationship, and an admin's custom label replaces the derived step title on
// both profiles of the pair. The relationship finder names the same pair a stepmother and a half-sister, and the
// custom label then replaces the step headline. Fictional Hale-style data only.
import type { Page } from '@playwright/test';
import { createChild, createPerson, createUnion } from '../support/api.js';
import type { Made } from '../support/api.js';
import { surname } from '../support/data.js';
import { expect, test } from '../support/fixtures.js';
import { BASE_URL } from '../support/stack.js';

test.describe.configure({ mode: 'serial' });

const hale = surname('Hale');
const ruiz = surname('Ruiz');
const nair = surname('Nair');
let daniel: Made;
let carla: Made;
let elena: Made;
let priya: Made;
// One signed-in admin session for the whole journey (the sign-in route is rate limited, and this is one story).
let admin: Page;
test.beforeAll(async ({ browser, adminCookies }) => {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await context.addCookies(adminCookies);
  admin = await context.newPage();
});
test.afterAll(async () => {
  await admin.context().close();
});

const person = (page: Page, given: string, family: string) =>
  page.getByRole('button', { name: new RegExp(`^${given} ${family}`) });

test('Daniel was married to Priya, who is divorced from him, and they have Carla', async () => {
  const page = admin;
  daniel = await createPerson(page.request, { givenName: 'Daniel', surname: hale, gender: 'male', birth: '1958' });
  priya = await createPerson(page.request, {
    givenName: 'Priya',
    surname: nair,
    gender: 'female',
    birth: '1962',
  });
  const union = await createUnion(page.request, daniel.id, priya.id, 'divorced', '1985');
  carla = await createChild(page.request, daniel.id, { givenName: 'Carla', surname: nair, gender: 'female' }, union);
});

test('a new partner with a second and a married surname shows on Facts and on the chart', async () => {
  const page = admin;
  await page.goto(`/people/${daniel.id}`);
  await page.getByRole('button', { name: 'Add relative' }).click();
  await page.getByRole('button', { name: /^Add partner/ }).click();
  const dialog = page.getByRole('dialog', { name: /^Add partner to/ });
  // Married is the default status, so the married-surname fields are there.
  await dialog.getByLabel('Given name').fill('Elena');
  await dialog.getByLabel('Surname', { exact: true }).fill(ruiz);
  await dialog.getByLabel('Second surname').fill('Vega');
  await dialog.getByLabel('Married surname', { exact: true }).fill(hale);
  await dialog.getByLabel('Gender').selectOption('female');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  await page
    .getByRole('link', { name: new RegExp(`Elena ${ruiz}`) })
    .first()
    .click();
  await expect(page.getByRole('heading', { level: 1, name: `Elena ${ruiz} Vega (${hale})` })).toBeVisible();
  const facts = page.locator('dl.facts').first();
  await expect(facts.getByText('Birth surname')).toBeVisible();
  await expect(facts.getByText(ruiz, { exact: true })).toBeVisible();
  await expect(facts.getByText('Vega', { exact: true })).toBeVisible();
  await expect(facts.getByText('Married surname')).toBeVisible();
  elena = { id: page.url().split('/').pop()!, givenName: 'Elena', surname: ruiz };

  await page.goto(`/tree/${daniel.id}`);
  await expect(person(page, 'Elena', ruiz)).toBeVisible();
  // The default form is Maiden name (Married name): both birth surnames, then the married one in brackets.
  await expect(page.getByRole('button', { name: new RegExp(`^Elena ${ruiz} Vega \\(${hale}\\)`) })).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(`^Elena ${hale}`) })).toHaveCount(0);
});

test('marking someone deceased turns the marriage into Widowed, and marking them living turns it back', async () => {
  const page = admin;
  const walter = await createPerson(page.request, {
    givenName: 'Walter',
    surname: hale,
    gender: 'male',
    birth: '1931',
  });
  const rosa = await createPerson(page.request, { givenName: 'Rosa', surname: hale, gender: 'female', birth: '1934' });
  await createUnion(page.request, walter.id, rosa.id, 'married', '1955');

  await page.goto(`/people/${walter.id}`);
  await page.getByRole('button', { name: 'Edit details' }).click();
  let dialog = page.getByRole('dialog', { name: /^Edit details/ });
  await dialog.getByLabel('Status').selectOption('deceased');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('1 marriage was set to Widowed automatically.')).toBeVisible();
  const card = page.getByRole('article', { name: new RegExp(`^Relationship with Rosa ${hale}`) });
  await expect(card.getByText('Widowed', { exact: true })).toBeVisible();

  // An automatic Widowed says so when an admin opens it.
  await card.getByRole('button', { name: 'Edit relationship' }).click();
  dialog = page.getByRole('dialog', { name: /^Relationship:/ });
  await expect(dialog.getByText('Set automatically; saving a status here makes it permanent.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // Marking him living again reverts only what was automatic.
  await page.getByRole('button', { name: 'Edit details' }).click();
  dialog = page.getByRole('dialog', { name: /^Edit details/ });
  await dialog.getByLabel('Status').selectOption('living');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(card.getByText('Married', { exact: true })).toBeVisible();
});

test('a step-parent and a stepchild come through the Married relationship, and not through the divorce', async () => {
  const page = admin;
  // Carla: Daniel's second wife Elena is her stepmother. Her mother Priya's divorce gives nothing.
  await page.goto(`/people/${carla.id}`);
  const steps = page.getByRole('list', { name: 'Step relatives' });
  await expect(steps.getByRole('link', { name: new RegExp(`Elena ${ruiz}.*Stepmother`) })).toBeVisible();
  await expect(steps.getByRole('link')).toHaveCount(1);

  // Elena: Carla is her stepdaughter, and the relationship card lists Daniel's children from another relationship.
  await page.goto(`/people/${elena.id}`);
  await expect(
    page
      .getByRole('list', { name: 'Step relatives' })
      .getByRole('link', { name: new RegExp(`Carla ${nair}.*Stepdaughter`) }),
  ).toBeVisible();
  const card = page.getByRole('article', { name: new RegExp(`^Relationship with Daniel ${hale}`) });
  await expect(card.getByText('Daniel’s children from another relationship')).toBeVisible();
  await expect(card.getByText(new RegExp(`Carla ${nair}`)).locator('..')).toContainText(
    `with Priya ${nair}, your stepdaughter`,
  );
});

/** Chooses a person in one of the finder's two pickers by typing a name. */
async function pick(page: Page, picker: 'Person 1' | 'Person 2', given: string, family: string) {
  await page.getByRole('combobox', { name: picker }).fill(given);
  await page.getByRole('option', { name: new RegExp(`${given} ${family}`) }).click();
}

test('the relationship finder calls Elena Carla’s stepmother and Priya’s other daughter her half-sister', async () => {
  const page = admin;
  const sofia = await createChild(page.request, priya.id, { givenName: 'Sofia', surname: nair, gender: 'female' });
  await page.goto('/relationship');
  await pick(page, 'Person 1', 'Carla', nair);
  await pick(page, 'Person 2', 'Elena', ruiz);
  const answer = page.getByRole('status').filter({ hasText: 'relationship to' });
  await expect(answer).toContainText(new RegExp(`Elena ${ruiz}.*relationship to Carla ${nair}`));
  await expect(answer).toContainText('Stepmother');
  // The same path, in words, with links to the profiles
  await expect(page.locator('ol.finder-path').getByRole('link', { name: new RegExp(`Elena ${ruiz}`) })).toBeVisible();

  // Swap to the second person's other daughter: a half-sister through their mother Priya
  await page.getByRole('button', { name: 'Change' }).nth(1).click();
  await pick(page, 'Person 2', 'Sofia', nair);
  await expect(page.getByRole('status').filter({ hasText: 'Half-sister' })).toBeVisible();
  expect(page.url()).toContain(`a=${carla.id}`);
  expect(page.url()).toContain(`b=${sofia.id}`);
});

test('a custom label between the step pair replaces the derived title on both profiles', async () => {
  const page = admin;
  await page.goto(`/people/${carla.id}`);
  await page.getByRole('button', { name: 'Other relationship' }).click();
  const dialog = page.getByRole('dialog', { name: /^Other relationship for/ });
  await dialog.getByRole('combobox', { name: 'The other person' }).fill('Elena');
  await dialog.getByRole('option', { name: new RegExp(`Elena ${ruiz}`) }).click();
  await dialog.getByLabel(/^What they are to/).fill('Godmother');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  // Carla's profile: the custom row replaces "Stepmother".
  const other = page.getByRole('list', { name: 'Other relationships' });
  await expect(other.getByText('Godmother:')).toBeVisible();
  await expect(other.getByText('(custom)')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Step relatives' })).toHaveCount(0);
  await expect(page.getByText('Stepmother')).toHaveCount(0);

  // Elena's profile: "Godmother of Carla" replaces "Stepdaughter"; the card still lists Carla, without the step wording.
  await page.goto(`/people/${elena.id}`);
  await expect(page.getByRole('list', { name: 'Other relationships' }).getByText('Godmother of')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Step relatives' })).toHaveCount(0);
  const card = page.getByRole('article', { name: new RegExp(`^Relationship with Daniel ${hale}`) });
  const row = card.getByText(new RegExp(`Carla ${nair}`)).locator('..');
  await expect(row).toContainText(`with Priya ${nair}`);
  await expect(row).not.toContainText('stepdaughter');
});

test('the finder shows the custom label as the headline instead of Stepmother, and the tree is unchanged', async () => {
  const page = admin;
  await page.goto(`/relationship?a=${carla.id}&b=${elena.id}`);
  const answer = page.getByRole('status').filter({ hasText: 'relationship to' });
  await expect(answer).toContainText('Godmother');
  await expect(answer).toContainText('(custom)');
  await expect(answer).not.toContainText('Stepmother');
  // A blood relative keeps the derived name: Carla's father is still her Father
  await page.goto(`/relationship?a=${carla.id}&b=${daniel.id}`);
  await expect(page.getByRole('status').filter({ hasText: 'Father' })).toBeVisible();
});
