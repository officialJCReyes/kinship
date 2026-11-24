// SPDX-License-Identifier: AGPL-3.0-or-later
// Journey 4: change and remove things. Every test builds its own small family through the API first.
import { createChild, createPerson, createUnion } from '../support/api.js';
import type { APIRequestContext } from '@playwright/test';
import { ADMIN, surname } from '../support/data.js';
import { expect, test } from '../support/fixtures.js';

async function marriedWithChild(request: APIRequestContext) {
  const family = surname('Hale');
  const daniel = await createPerson(request, { givenName: 'Daniel', surname: family, gender: 'male', birth: '1960' });
  const elena = await createPerson(request, { givenName: 'Elena', surname: family, gender: 'female', birth: '1962' });
  const unionId = await createUnion(request, daniel.id, elena.id, 'married', '1985-05');
  const marcus = await createChild(
    request,
    daniel.id,
    { givenName: 'Marcus', surname: family, gender: 'male' },
    unionId,
  );
  return { family, daniel, elena, marcus, unionId };
}

test('edit a relationship: the end date appears only for divorce, separation and annulment', async ({
  adminPage: page,
}) => {
  const { family, daniel, elena } = await marriedWithChild(page.request);
  await page.goto(`/people/${daniel.id}`);
  const card = page.getByRole('article', { name: `Relationship with Elena ${family}` });
  await card.getByRole('button', { name: 'Edit relationship' }).click();
  const dialog = page.getByRole('dialog', { name: `Relationship: Daniel ${family} and Elena ${family}` });
  const status = dialog.getByLabel('Relationship status');
  await expect(dialog.getByLabel('Divorce date', { exact: true })).toHaveCount(0);

  await status.selectOption('divorced');
  await expect(dialog.getByLabel('Divorce date', { exact: true })).toBeVisible();
  await status.selectOption('separated');
  await expect(dialog.getByLabel('Separation date', { exact: true })).toBeVisible();
  await status.selectOption('annulment');
  await expect(dialog.getByLabel('Annulment date', { exact: true })).toBeVisible();
  await status.selectOption('engaged');
  for (const label of ['Divorce date', 'Separation date', 'Annulment date']) {
    await expect(dialog.getByLabel(label, { exact: true })).toHaveCount(0);
  }

  await status.selectOption('divorced');
  await dialog.getByLabel('Divorce date', { exact: true }).fill('1998-03-09');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  // Now Elena is the ex-wife, with the end date.
  await expect(card.getByRole('heading', { name: /^Ex-wife:/ })).toBeVisible();
  await expect(card.getByText('Divorced', { exact: true })).toBeVisible();
  await expect(card.getByText('Mar 9, 1998')).toBeVisible();
  // Seen from her side too.
  await page.goto(`/people/${elena.id}`);
  await expect(page.getByRole('heading', { name: /^Ex-husband:/ })).toBeVisible();
});

test('a relationship with children cannot be deleted, and the refusal is explained', async ({ adminPage: page }) => {
  const { family, daniel } = await marriedWithChild(page.request);
  await page.goto(`/people/${daniel.id}`);
  const card = page.getByRole('article', { name: `Relationship with Elena ${family}` });
  await card.getByRole('button', { name: 'Delete relationship' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete relationship?' });
  await dialog.getByRole('button', { name: 'Delete relationship' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'This relationship has children. Change its status instead of deleting it.',
  );
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(card).toBeVisible();
});

test('a relationship without children can be deleted', async ({ adminPage: page }) => {
  const family = surname('Hale');
  const a = await createPerson(page.request, { givenName: 'Ines', surname: family, gender: 'female' });
  const b = await createPerson(page.request, { givenName: 'Omar', surname: family, gender: 'male' });
  await createUnion(page.request, a.id, b.id, 'partner');
  await page.goto(`/people/${a.id}`);
  const card = page.getByRole('article', { name: `Relationship with Omar ${family}` });
  await card.getByRole('button', { name: 'Delete relationship' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete relationship' }).click();
  await expect(page.getByText('The relationship was deleted.')).toBeVisible();
  await expect(card).toHaveCount(0);
  await expect(page.getByText('No partners on record.')).toBeVisible();
});

test('remove a parent link, and the child keeps the other parent', async ({ adminPage: page }) => {
  const { family, marcus } = await marriedWithChild(page.request);
  await page.goto(`/people/${marcus.id}`);
  const parents = page.getByRole('heading', { name: 'Parents' }).locator('..');
  await expect(parents.getByRole('link')).toHaveCount(2);
  await page.getByRole('button', { name: `Remove Daniel ${family} as parent` }).click();
  const dialog = page.getByRole('dialog', { name: 'Remove a parent' });
  await dialog.getByRole('button', { name: 'Remove parent' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('The parent link was removed.')).toBeVisible();
  await expect(parents.getByRole('link')).toHaveCount(1);
  await expect(parents.getByRole('link', { name: new RegExp(`Elena ${family}`) })).toBeVisible();
});

test('delete a person: the counts are shown and nothing else is deleted', async ({ adminPage: page }) => {
  const { family, daniel, elena, marcus } = await marriedWithChild(page.request);
  await page.goto(`/people/${daniel.id}`);
  await page.getByRole('button', { name: 'Delete person' }).click();
  const dialog = page.getByRole('dialog', { name: `Delete Daniel ${family}?` });
  await dialog.getByRole('button', { name: 'Delete person' }).click();
  // The API wants a confirmation because a relationship and a child are affected.
  await expect(dialog.getByRole('alert')).toHaveText(
    'This person has 1 relationship(s) and 1 child(ren) that would be affected.',
  );
  await dialog.getByRole('button', { name: 'Delete anyway' }).click();

  await expect(page.getByRole('heading', { name: 'People', level: 1 })).toBeVisible();
  await expect(page.getByText(`Daniel ${family} was deleted.`)).toBeVisible();
  await page.getByLabel('Search by name').fill(family);
  await expect(page.getByRole('link', { name: `Elena ${family}` })).toBeVisible();
  await expect(page.getByRole('link', { name: `Daniel ${family}` })).toHaveCount(0);
  // The child kept the other parent.
  await page.goto(`/people/${marcus.id}`);
  const parents = page.getByRole('heading', { name: 'Parents' }).locator('..');
  await expect(parents.getByRole('link', { name: new RegExp(`Elena ${family}`) })).toBeVisible();
  expect(elena.id).toBeTruthy();
});

test('a person who has an account cannot be deleted', async ({ adminPage: page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Open my profile' }).click();
  await expect(page.getByRole('heading', { name: ADMIN.displayName, level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Delete person' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Delete person' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('An account is linked to this person. Unlink it first.');
});

test('a brother can be added to someone with no parents: unknown parents appear, and the success pill fades by itself', async ({
  adminPage: page,
}) => {
  const family = surname('Hale');
  const person = await createPerson(page.request, { givenName: 'Lone', surname: family });
  await page.goto(`/people/${person.id}`);
  await page.getByRole('button', { name: 'Add relative' }).click();
  const brother = page.getByRole('button', { name: 'Add brother' });
  await expect(brother).not.toHaveAttribute('aria-disabled', 'true');
  await brother.click();
  const dialog = page.getByRole('dialog', { name: `Add brother to Lone ${family}` });
  await expect(dialog.getByTestId('placeholder-note')).toBeVisible();
  await dialog.getByLabel('Given (and middle) name').fill('Brandon');
  await dialog.getByLabel('Surname', { exact: true }).fill(family);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  // A small pill, not a bar: it has no button, and it goes away by itself.
  const pill = page.getByTestId('notice-pill');
  await expect(pill).toHaveText(`Brandon ${family} was added to the tree.`);
  await expect(pill.getByRole('button')).toHaveCount(0);
  await expect(pill).toBeHidden({ timeout: 10_000 });

  // The profile lists the unknown parents and the new brother.
  await expect(page.getByRole('link', { name: /^Unknown father/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Unknown mother/ })).toBeVisible();
  await expect(page.getByRole('link', { name: `Brandon ${family}` })).toBeVisible();

  // On the chart they are dashed cards that are named by what they are, not by a sex.
  await page.goto(`/tree/${person.id}`);
  const father = page.getByRole('button', { name: 'Unknown father, add details' });
  await expect(father).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unknown mother, add details' })).toBeVisible();
  await father.click();
  await page.getByRole('button', { name: 'Add details', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Add details: Unknown father' });
  await edit.getByLabel('Given (and middle) name').fill('Joseph');
  await edit.getByLabel('Surname', { exact: true }).fill(family);
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(edit).toBeHidden();
  // Named: an ordinary person now, in the list and on the chart.
  await expect(page.getByRole('button', { name: `Joseph ${family}, male`, exact: false })).toBeVisible();
  await page.goto(`/people?q=${encodeURIComponent('Joseph ' + family)}`);
  await expect(page.getByRole('link', { name: `Joseph ${family}` })).toBeVisible();
  // The one that is still unknown is not in the list.
  await page.goto('/people?q=Unknown');
  await expect(page.getByRole('link', { name: /^Unknown/ })).toHaveCount(0);
});
