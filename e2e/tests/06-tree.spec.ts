// SPDX-License-Identifier: AGPL-3.0-or-later
// Journey 6: the Family tree chart. One family is built through the API (the chart is what is being tested, not
// the forms), then looked at through the screens.
import { createAccount } from '../support/accounts.js';
import { createChild, createPerson, createUnion } from '../support/api.js';
import type { Made } from '../support/api.js';
import { surname, uniq } from '../support/data.js';
import { expect, tabTo, test } from '../support/fixtures.js';
import { BASE_URL } from '../support/stack.js';

test.describe.configure({ mode: 'serial' });

const family = surname('Hale');
const lenaFamily = surname('Okafor');
let daniel: Made;
let sofia: Made;
let marcus: Made;
let unions: { elena: string; carla: string; lena: string };

const person = (page: import('@playwright/test').Page, given: string, surnameText = family) =>
  page.getByRole('button', { name: new RegExp(`^${given} ${surnameText}`) });

/**
 * Opens a chart. The legend starts hidden (step 41), so it cannot sit on top of a card: a chart that is wider than 0.7 of the window
 * opens centred on the home person (ADR 0027), and an open legend, bottom left, could cover one. Each test has a fresh browser, so
 * no choice is remembered from another test; this checks the legend really is closed.
 */
async function openChart(page: import('@playwright/test').Page, path: string) {
  await page.goto(path);
  await expect(page.locator('.tree-canvas')).toBeVisible();
  await expect(page.locator('details.legend')).not.toHaveAttribute('open');
}

/** Opens the legend with its small Legend button. */
async function openLegend(page: import('@playwright/test').Page) {
  await page.locator('details.legend > summary').click();
  await expect(page.locator('details.legend')).toHaveAttribute('open', '');
}

test('build a family: two partners, children, an in-law with parents', async ({ adminPage: page }) => {
  const request = page.request;
  daniel = await createPerson(request, { givenName: 'Daniel', surname: family, gender: 'male', birth: '1960' });
  const elena = await createPerson(request, { givenName: 'Elena', surname: family, gender: 'female', birth: '1962' });
  const carla = await createPerson(request, { givenName: 'Carla', surname: family, gender: 'female', birth: '1965' });
  const married = await createUnion(request, daniel.id, elena.id, 'married', '1985');
  const divorced = await createUnion(request, daniel.id, carla.id, 'divorced', '1993');
  marcus = await createChild(request, daniel.id, { givenName: 'Marcus', surname: family, gender: 'male' }, married);
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
  await openChart(page, `/tree/${daniel.id}`);
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
  // Selected is more than a ring: the card's fill is tinted, and its sex border colour is unchanged, in every scheme.
  const box = (name: string) => person(page, name).locator('.box');
  const paint = (name: string) =>
    box(name).evaluate((b) => ({ fill: getComputedStyle(b).fill, stroke: getComputedStyle(b).stroke }));
  const unselectedBefore = await paint('Sofia');
  const selectedNow = await paint('Marcus');
  expect(selectedNow.fill).not.toBe(unselectedBefore.fill);
  for (const scheme of ['forest', 'sand', 'slate', 'graphite']) {
    for (const theme of ['light', 'dark']) {
      await page.evaluate(
        ([s, t]) => {
          document.documentElement.dataset['scheme'] = s;
          document.documentElement.dataset['theme'] = t;
        },
        [scheme!, theme],
      );
      const selected = await paint('Marcus');
      const other = await paint('Ben');
      expect(selected.fill, `${scheme} ${theme}: selected fill differs`).not.toBe(other.fill);
      expect(selected.stroke, `${scheme} ${theme}: male border`).toBe(
        await box('Marcus').evaluate((b) => getComputedStyle(b).stroke),
      );
      const male = await person(page, 'Ben')
        .locator('.box')
        .evaluate((b) => getComputedStyle(b).stroke);
      expect(selected.stroke, `${scheme} ${theme}: same border as another male card`).toBe(male);
    }
  }
  // Back works: the selection is in the address, so Back returns to the first state.
  await person(page, 'Sofia').click();
  await expect(panel.getByRole('heading', { name: `Sofia ${family}` })).toBeVisible();
  await page.goBack();
  await expect(panel.getByRole('heading', { name: `Marcus ${family}` })).toBeVisible();
});

test('a partner’s own child from before is drawn under her, and her ex-partner’s family is not pulled in', async ({
  adminPage: page,
}) => {
  await openChart(page, `/tree/${daniel.id}`);
  await expect(person(page, 'Nico')).toBeVisible();
  await expect(person(page, 'Carla')).toBeVisible();
  const nico = await person(page, 'Nico').boundingBox();
  const carla = await person(page, 'Carla').boundingBox();
  expect(nico!.y).toBeGreaterThan(carla!.y);
  // He is below her and hangs from her alone, not from the relationship with Daniel.
  await expect(page.locator(`[data-union="${unions.carla}"]`)).toHaveCount(1);
});

test('the "+" on a card opens Add relative for that person, without selecting them or moving the chart', async ({
  adminPage: page,
}) => {
  await openChart(page, `/tree/${daniel.id}`);
  const plus = page.getByRole('button', { name: `Add a relative to Carla ${family}` });
  await expect(plus).toBeVisible();
  const view = page.locator('.tree-canvas svg > g').first();
  const before = await view.getAttribute('transform');
  await plus.click();
  const dialog = page.getByRole('dialog', { name: `Add relative to Carla ${family}` });
  await expect(dialog).toBeVisible();
  await expect(person(page, 'Carla')).toHaveAttribute('aria-pressed', 'false');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  expect(await view.getAttribute('transform')).toBe(before);
});

test('lines: solid for a marriage, dotted for a divorce, and a couple line opens its relationship', async ({
  adminPage: page,
}) => {
  await openChart(page, `/tree/${daniel.id}`);
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
  await openChart(page, `/tree/${daniel.id}`);
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

test('the legend starts hidden and keeps the open or closed choice across people, the leaf and views', async ({
  adminPage: page,
}) => {
  await openChart(page, `/tree/${daniel.id}`);
  await expect(page.locator('details.legend > summary')).toBeVisible();
  await openLegend(page);
  // Another person's tree, a family view (the leaf) and another view: still open.
  await page.goto(`/tree/${marcus.id}`);
  await expect(person(page, 'Marcus')).toBeVisible();
  await expect(page.locator('details.legend')).toHaveAttribute('open', '');
  // A family view by its address (the web tests flip with the leaf itself; here the open legend could cover a leaf).
  await page.goto(`/tree/${daniel.id}?of=${marcus.id}`);
  await expect(page.getByText('Marcus’s family', { exact: true })).toBeVisible();
  await expect(page.locator('details.legend')).toHaveAttribute('open', '');
  await page.goto(`/tree/${marcus.id}?view=pedigree`);
  await expect(page.locator('details.legend')).toHaveAttribute('open', '');
  // Closed: it stays closed on the next person.
  await page.locator('details.legend > summary').click();
  await expect(page.locator('details.legend')).not.toHaveAttribute('open');
  await page.goto(`/tree/${daniel.id}`);
  await expect(person(page, 'Daniel')).toBeVisible();
  await expect(page.locator('details.legend')).not.toHaveAttribute('open');
});

test('a brother’s or sister’s partner is in a family view, with a leaf for their parents', async ({
  adminPage: page,
}) => {
  await page.goto(`/tree/${daniel.id}?of=${marcus.id}`);
  await expect(page.getByText('Marcus’s family', { exact: true })).toBeVisible();
  await expect(person(page, 'Sofia')).toBeVisible();
  const lena = person(page, 'Lena', lenaFamily);
  await expect(lena).toBeVisible();
  // Her parents stay behind the leaf, with the right count; her own relationship to Sofia is drawn.
  await expect(person(page, 'Femi', lenaFamily)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show Lena’s family (2 people)' })).toBeVisible();
  await expect(page.locator(`[data-union="${unions.lena}"]`)).toHaveCount(1);
  // Daniel's ex-partner is not part of Marcus's family.
  await expect(person(page, 'Carla')).toHaveCount(0);
  // The counter counts what is drawn, and the legend says where to find anyone else.
  await expect(page.locator('.tree-count')).toContainText(' of ');
  await openLegend(page);
  await expect(page.getByText('Someone not on the chart?', { exact: false })).toBeVisible();
});

test('keyboard: one tab stop, arrows move between people, Enter selects', async ({ adminPage: page }) => {
  await openChart(page, `/tree/${daniel.id}`);
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

test('cards are one size, show the whole name, and show sex by border colour alone, in every colour scheme', async ({
  adminPage: page,
}) => {
  // A long name and no gender, no birth date (an unknown-sex card is grey), in the same family.
  const given = 'Nova Estelle Octavia';
  const long = await createChild(
    page.request,
    daniel.id,
    { givenName: given, surname: `${family}-Fernandez` },
    unions.elena,
  );
  await openChart(page, `/tree/${daniel.id}`);
  const card = page.locator(`[data-node="${long.id}"]`);
  await expect(card).toBeVisible();
  await expect(card).toHaveAccessibleName(`${given} ${family}-Fernandez, unknown`);
  await expect(card.locator('title')).toHaveText(`${given} ${family}-Fernandez`);
  // no sex icon anywhere, and the whole name is there (up to three lines, no ellipsis)
  await expect(page.locator('.tnode .glyph')).toHaveCount(0);
  const text = (await card.locator('.name tspan').allTextContents()).join(' ').replace(/- /g, '-');
  expect(text).toBe(`${given} ${family}-Fernandez`);
  expect(await card.locator('.name tspan').count()).toBeLessThanOrEqual(3);
  // every card is the same size
  const heights = await page.locator('.tnode .box').evaluateAll((boxes) => boxes.map((b) => b.getAttribute('height')));
  expect(new Set(heights).size).toBe(1);
  // The border colour tells the sex, and it differs in all four schemes, light and dark.
  const border = (id: string) => page.locator(`[data-node="${id}"] .box`).evaluate((b) => getComputedStyle(b).stroke);
  for (const scheme of ['forest', 'sand', 'slate', 'graphite']) {
    for (const theme of ['light', 'dark']) {
      await page.evaluate(
        ([s, t]) => {
          document.documentElement.dataset['scheme'] = s;
          document.documentElement.dataset['theme'] = t;
        },
        [scheme!, theme],
      );
      const colours = [await border(daniel.id), await border(sofia.id), await border(long.id)];
      expect(new Set(colours).size, `${scheme} ${theme}: ${colours.join(' | ')}`).toBe(3);
    }
  }
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

test('search in the chart: by nickname, jump to someone drawn, re-root on someone who is not, and the people counter', async ({
  adminPage: page,
}) => {
  const patched = await page.request.patch(`/api/people/${sofia.id}`, {
    headers: { 'X-KinShip-Request': '1', Origin: BASE_URL },
    data: { nickname: 'Sosa' },
  });
  expect(patched.status()).toBe(200);
  const stranger = await createPerson(page.request, {
    givenName: 'Wallace',
    surname: surname('Quill'),
    nickname: 'Wally',
  });

  await openChart(page, `/tree/${daniel.id}`);
  const counter = page.locator('.tree-count');
  await expect(counter).toHaveText(/^\d+ of \d+ people$/);
  const [, drawn, everyone] = /^(\d+) of (\d+) people$/.exec((await counter.textContent())!)!.map(Number);
  expect(drawn!).toBeGreaterThan(5);
  expect(everyone!).toBeGreaterThan(drawn!);

  // Someone who is drawn: found by the nickname alone, which the result says; Enter selects them in the same chart.
  const search = page.getByRole('combobox', { name: 'Find someone in the tree' });
  await search.fill('sosa');
  const option = page.getByRole('option', { name: new RegExp(`^Sofia ${family}.*also called Sosa`) });
  await expect(option).toBeVisible();
  await search.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/tree/${daniel.id}\\?sel=${sofia.id}`));
  await expect(
    page.getByRole('complementary', { name: 'Selected person' }).getByRole('heading', { name: `Sofia ${family}` }),
  ).toBeVisible();
  // (other journeys may add people meanwhile, so the total is only a number)
  await expect(counter).toHaveText(new RegExp(`^${drawn} of \\d+ people$`));

  // Someone who is not drawn: the chart is re-rooted on them, and the counter follows what is drawn.
  await search.fill('wally');
  await page.getByRole('option', { name: /^Wallace .*also called Wally/ }).click();
  await expect(page).toHaveURL(new RegExp(`/tree/${stranger.id}\\?sel=${stranger.id}`));
  await expect(
    page.getByRole('complementary', { name: 'Selected person' }).getByRole('heading', { name: /^Wallace / }),
  ).toBeVisible();
  await expect(counter).toHaveText(/^1 of \d+ people$/);
});

test('the switcher shows the Pedigree, the Descendants and the Fan, and goes back to the Family tree', async ({
  adminPage: page,
}) => {
  await openChart(page, `/tree/${marcus.id}`);
  const switcher = page.getByRole('button', { name: /^Chart view:/ });
  await expect(switcher).toHaveAccessibleName('Chart view: Family tree');
  const choose = async (name: string) => {
    await page.getByRole('button', { name: /^Chart view:/ }).click();
    await page.getByRole('group', { name: 'View' }).getByRole('button', { name, exact: true }).click();
  };

  // Pedigree: Marcus and his parents, with the father above the mother; Daniel's own parents are not on the tree.
  await choose('Pedigree');
  await expect(page).toHaveURL(new RegExp(`/tree/${marcus.id}\\?view=pedigree$`));
  await expect(switcher).toHaveAccessibleName('Chart view: Pedigree');
  await expect(person(page, 'Daniel')).toBeVisible();
  await expect(person(page, 'Elena')).toBeVisible();
  await expect(page.getByText('Father not on the tree').first()).toBeVisible();
  await expect(page.getByText('Grandparents', { exact: true })).toBeVisible();
  // Choosing a person makes them the centre of the chart, in the same view.
  await person(page, 'Daniel').click();
  await expect(page).toHaveURL(new RegExp(`/tree/${daniel.id}\\?view=pedigree$`));
  await expect(person(page, 'Marcus')).toHaveCount(0);

  // Descendants: Daniel's children under him, the partners listed on his card, and the generations choice.
  await choose('Descendants');
  await expect(page).toHaveURL(new RegExp(`/tree/${daniel.id}\\?view=descendants$`));
  await expect(person(page, 'Marcus')).toBeVisible();
  await expect(person(page, 'Sofia')).toBeVisible();
  // (the card says how Daniel and Elena are related now, whatever earlier tests did to the relationship)
  await expect(page.getByText(/^(m|sep|div|eng)\. Elena/)).toBeVisible();
  await page.getByRole('button', { name: /^Chart view:/ }).click();
  await page.getByRole('button', { name: '3 generations' }).click();
  await expect(page).toHaveURL(new RegExp(`/tree/${daniel.id}\\?view=descendants&gen=3$`));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('group', { name: 'View' })).toHaveCount(0);

  // Fan: Marcus in the middle, his father on the father's side.
  await openChart(page, `/tree/${marcus.id}?view=fan`);
  await expect(page.getByRole('button', { name: new RegExp(`^Daniel ${family}.*father’s side$`) })).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(`^Elena ${family}.*mother’s side$`) })).toBeVisible();

  // Back to the Family tree: no view in the address, the whole family drawn again, with its couple lines.
  await choose('Family tree');
  await expect(page).toHaveURL(new RegExp(`/tree/${marcus.id}$`));
  await expect(page.locator('[data-union]').first()).toBeAttached();
  await expect(switcher).toHaveAccessibleName('Chart view: Family tree');
});

test('aunts, uncles and cousins are hidden by default, the legend says so, and the gear shows them', async ({
  adminPage: page,
}) => {
  const request = page.request;
  const api = { headers: { 'X-KinShip-Request': '1', Origin: BASE_URL } };
  const clan = surname('Brandt');
  // Walter and Rosa have Daniel and Greta. Daniel has Marcus, who is the home person; Greta has a daughter, Nina.
  const walter = await createPerson(request, { givenName: 'Walter', surname: clan, gender: 'male', birth: '1930' });
  const rosa = await createPerson(request, { givenName: 'Rosa', surname: clan, gender: 'female', birth: '1932' });
  const grandparents = await createUnion(request, walter.id, rosa.id, 'married', '1955');
  const dan = await createChild(request, walter.id, { givenName: 'Dan', surname: clan, gender: 'male' }, grandparents);
  const greta = await createChild(
    request,
    walter.id,
    { givenName: 'Greta', surname: clan, gender: 'female' },
    grandparents,
  );
  const mara = await createPerson(request, { givenName: 'Mara', surname: clan, gender: 'female', birth: '1962' });
  const parents = await createUnion(request, dan.id, mara.id, 'married', '1985');
  const home = await createChild(request, dan.id, { givenName: 'Homer', surname: clan, gender: 'male' }, parents);
  const sister = await createChild(request, dan.id, { givenName: 'Sissy', surname: clan, gender: 'female' }, parents);
  await createChild(request, greta.id, { givenName: 'Nina', surname: clan, gender: 'female' });
  try {
    // Hidden by default; the siblings stay. The legend says where the others went.
    await page.goto(`/tree/${home.id}`);
    await openLegend(page);
    await expect(person(page, 'Sissy', clan)).toBeVisible();
    await expect(person(page, 'Walter', clan)).toBeVisible();
    await expect(person(page, 'Greta', clan)).toHaveCount(0);
    await expect(person(page, 'Nina', clan)).toHaveCount(0);
    await expect(
      page.getByText(
        'Aunts, uncles and cousins are hidden. Show them in the chart settings (gear), or search for them above.',
      ),
    ).toBeVisible();
    const count = page.locator('.tree-count');
    const hidden = (await count.textContent()) ?? '';
    // Turn them on in the gear: the aunt and the cousin appear, the counter grows, the panel stays open.
    await page.getByRole('button', { name: 'Chart settings' }).click();
    const panel = page.getByRole('group', { name: 'Chart settings' });
    await panel.getByRole('switch', { name: 'Show aunts, uncles and cousins' }).click();
    await expect(person(page, 'Greta', clan)).toBeVisible();
    await expect(person(page, 'Nina', clan)).toBeVisible();
    await expect(count).not.toHaveText(hidden);
    await expect(panel).toBeVisible();
    await expect(page.getByText('Aunts, uncles and cousins are hidden.', { exact: false })).toHaveCount(0);
    // It is the account's setting: a reload keeps it. Restore defaults hides them again.
    await page.reload();
    await expect(person(page, 'Greta', clan)).toBeVisible();
    await page.getByRole('button', { name: 'Chart settings' }).click();
    await page.getByRole('group', { name: 'Chart settings' }).getByRole('button', { name: 'Restore defaults' }).click();
    await expect(person(page, 'Greta', clan)).toHaveCount(0);
    await expect(person(page, 'Sissy', clan)).toBeVisible();
  } finally {
    // The shared admin account goes back to the default whatever happened.
    const restored = await request.patch('/api/auth/me', { ...api, data: { showExtendedRelatives: false } });
    expect(restored.status()).toBe(200);
    void sister;
  }
});
