// SPDX-License-Identifier: AGPL-3.0-or-later
// The README screenshots. Builds the fictional Hale family through the API on a fresh stack (the real one, from
// compose.yml), then takes the pictures. Only fictional people appear. Output: docs/assets/screenshots/.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { createChild, createPerson, createUnion } from '../support/api.js';
import type { Made } from '../support/api.js';
import { BASE_URL } from '../support/stack.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'assets', 'screenshots');
const HEADERS = { 'X-KinShip-Request': '1', Origin: BASE_URL };
const PASSWORD = process.env['E2E_PASSWORD'] ?? '';

test.describe.configure({ mode: 'serial' });

let page: Page;
const ids: Record<string, string> = {};

async function person(
  key: string,
  given: string,
  surname: string,
  gender: 'male' | 'female',
  birth: string,
  death?: string,
): Promise<Made> {
  const made = await createPerson(page.request, {
    givenName: given,
    surname,
    gender,
    birth,
    ...(death ? { deceased: true, death } : {}),
  });
  ids[key] = made.id;
  return made;
}

test.beforeAll(async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  page = await (
    await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1200, height: 760 }, deviceScaleFactor: 2 })
  ).newPage();
  // First run, as a person following the README: the one-time token from the api log.
  const setup = await page.request.post('/api/setup', {
    headers: HEADERS,
    data: {
      token: process.env['E2E_SETUP_TOKEN'] ?? '',
      displayName: 'Marcus Hale',
      email: 'marcus@hale.example',
      password: PASSWORD,
      treeName: 'Hale Family',
      person: { givenName: 'Marcus', surname: 'Hale' },
    },
  });
  expect(setup.status()).toBe(201);
  const me = (await (await page.request.get('/api/auth/me')).json()) as { user: { personId: string } };
  ids['marcus'] = me.user.personId;
  await page.request.patch(`/api/people/${ids['marcus']}`, {
    headers: HEADERS,
    data: { gender: 'male', birth: { value: '1986-04-12' } },
  });
});
test.afterAll(async () => {
  await page.context().close();
});

test('build the fictional Hale family', async () => {
  const r = page.request;
  // Joseph and Anna Hale: their son Walter, and Samuel, adopted in 1938 (his birth parents are Frank and Ruth Doyle).
  const joseph = await person('joseph', 'Joseph', 'Hale', 'male', '1905', '1979');
  const anna = await person('anna', 'Anna', 'Hale', 'female', '1908', '1990');
  const josephAnna = await createUnion(r, joseph.id, anna.id, 'married', '1929');
  const walter = await createChild(r, joseph.id, { givenName: 'Walter', surname: 'Hale', gender: 'male' }, josephAnna);
  const frank = await person('frank', 'Frank', 'Doyle', 'male', '1910', '1962');
  const ruth = await person('ruth', 'Ruth', 'Doyle', 'female', '1912', '1988');
  const doyle = await createUnion(r, frank.id, ruth.id, 'married', '1932');
  const samuel = await createChild(r, frank.id, { givenName: 'Samuel', surname: 'Hale', gender: 'male' }, doyle);
  ids['samuel'] = samuel.id;
  await r.post(`/api/people/${samuel.id}/parents`, {
    headers: HEADERS,
    data: { parentId: joseph.id, kind: 'adoptive', link: { value: '1938' } },
  });
  await r.post(`/api/people/${samuel.id}/parents`, {
    headers: HEADERS,
    data: { parentId: anna.id, kind: 'adoptive', link: { value: '1938' } },
  });
  await r.patch(`/api/people/${samuel.id}`, { headers: HEADERS, data: { birth: { value: '1936-02-03' } } });
  await r.patch(`/api/people/${walter.id}`, {
    headers: HEADERS,
    data: { birth: { value: '1931-05-20' }, deceased: true, death: { value: '2005' } },
  });
  const lucia = await person('lucia', 'Lucía', 'Ortega', 'female', '1938', '2012');
  await createUnion(r, samuel.id, lucia.id, 'married', '1960');
  await r.patch(`/api/people/${samuel.id}`, { headers: HEADERS, data: { deceased: true, death: { value: '2015' } } });
  await createChild(r, samuel.id, { givenName: 'Tim', surname: 'Hale', gender: 'male' }, undefined);

  const rosa = await person('rosa', 'Rosa', 'Mendez', 'female', '1934');
  const walterRosa = await createUnion(r, walter.id, rosa.id, 'married', '1955-06-04');
  const daniel = await createChild(r, walter.id, { givenName: 'Daniel', surname: 'Hale', gender: 'male' }, walterRosa);
  await r.patch(`/api/people/${daniel.id}`, { headers: HEADERS, data: { birth: { value: '1958' } } });
  const elena = await person('elena', 'Elena', 'Ruiz', 'female', '1960');
  const beatriz = await person('beatriz', 'Beatriz', 'Navarro', 'female', '1965');
  const danielElena = await createUnion(r, daniel.id, elena.id, 'divorced', '1984-08-01');
  const danielBeatriz = await createUnion(r, daniel.id, beatriz.id, 'married', '2006-09-16');
  const marcusId = ids['marcus']!;
  // Marcus and Sofia are Daniel and Elena's children; the profile of Marcus was made at first run.
  await r.post(`/api/people/${marcusId}/parents`, { headers: HEADERS, data: { parentId: daniel.id } });
  await r.post(`/api/people/${marcusId}/parents`, {
    headers: HEADERS,
    data: { parentId: elena.id, unionId: danielElena },
  });
  await createChild(r, daniel.id, { givenName: 'Sofia', surname: 'Hale', gender: 'female' }, danielElena);
  await createChild(r, daniel.id, { givenName: 'Gabriel', surname: 'Hale', gender: 'male' }, danielBeatriz);
  await createChild(r, beatriz.id, { givenName: 'Tomás', surname: 'Navarro', gender: 'male' });
  const priya = await person('priya', 'Priya', 'Nair', 'female', '1987');
  const marcusPriya = await createUnion(r, marcusId, priya.id, 'married', '2013-06-08');
  await createChild(r, marcusId, { givenName: 'Leo', surname: 'Hale', gender: 'male' }, marcusPriya);
  // Priya's parents, behind her leaf.
  const raj = await person('raj', 'Raj', 'Nair', 'male', '1958');
  const meera = await person('meera', 'Meera', 'Iyer', 'female', '1960');
  const rajMeera = await createUnion(r, raj.id, meera.id, 'married', '1985');
  await r.post(`/api/people/${priya.id}/parents`, { headers: HEADERS, data: { parentId: raj.id } });
  await r.post(`/api/people/${priya.id}/parents`, {
    headers: HEADERS,
    data: { parentId: meera.id, unionId: rajMeera },
  });
});

const shot = (name: string) => join(OUT, name);

/** Remember (in this browser) whether the person panel is a rail, the way a person would set it once. */
async function panel(p: Page, collapsed: boolean) {
  await p.goto('/about');
  await p.evaluate((value) => window.localStorage.setItem('kinship.tree.panelCollapsed', value), collapsed ? '1' : '0');
}

async function chartReady(p: Page, name: RegExp) {
  await expect(p.getByRole('button', { name })).toBeVisible();
  await p.waitForTimeout(600); // let the fit finish
}

for (const scheme of ['light', 'dark'] as const) {
  test(`family tree chart, ${scheme}`, async () => {
    await page.emulateMedia({ colorScheme: scheme });
    await panel(page, true);
    await page.goto(`/tree/${ids['marcus']}`);
    await chartReady(page, /^Marcus Hale/);
    await page.screenshot({ path: shot(`tree-${scheme}.png`) });
  });
}

test('the profile of an adopted person, with the banner', async () => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1200, height: 1000 });
  await page.goto(`/people/${ids['samuel']}`);
  await expect(page.getByText(/The charts follow Samuel’s adoptive family/)).toBeVisible();
  await page.screenshot({ path: shot('profile-adopted-light.png'), clip: { x: 0, y: 60, width: 1200, height: 880 } });
  await page.setViewportSize({ width: 1200, height: 760 });
});

test('the second leaf on an adopted person, and the flipped birth-family view', async () => {
  await page.emulateMedia({ colorScheme: 'light' });
  await panel(page, false);
  await page.goto(`/tree/${ids['samuel']}`);
  await chartReady(page, /^Samuel Hale/);
  // A close-up of Samuel's card, so the second leaf (top left of the card) can be seen.
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.waitForTimeout(400);
  const card = (await page.getByRole('button', { name: /^Samuel Hale/ }).boundingBox())!;
  await page.screenshot({
    path: shot('tree-adopted-second-leaf.png'),
    clip: { x: Math.max(card.x - 330, 0), y: Math.max(card.y - 150, 0), width: 760, height: 400 },
  });
  await page.locator(`[data-leaf-other="${ids['samuel']}"]`).click();
  await expect(page.getByText('Samuel’s birth family', { exact: true })).toBeVisible();
  await chartReady(page, /^Frank Doyle/);
  await page.screenshot({ path: shot('tree-birth-family.png') });
});

test('Add relative as an admin, with the type of link', async () => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/people');
  await page.getByRole('link', { name: 'Tim Hale' }).click();
  await page.getByRole('button', { name: 'Add relative' }).click();
  await page.getByRole('button', { name: 'Add mother' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('group', { name: 'Type of parent-child link' })).toBeVisible();
  await dialog.getByRole('radio', { name: 'Adoptive' }).check();
  await page.screenshot({ path: shot('add-relative-link-type.png') });
});

test('the People list', async () => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/people');
  await expect(page.getByRole('link', { name: 'Walter Hale' })).toBeVisible();
  await page.screenshot({ path: shot('people-list.png') });
});

// A look at other zoom levels, for the person making the screenshots (not published).
test('zoom check, light and dark (not published)', async () => {
  const dir = join(OUT, '..', '..', '..', 'e2e', 'artifacts', 'zoom-check');
  mkdirSync(dir, { recursive: true });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await panel(page, false);
    await page.goto(`/tree/${ids['marcus']}`);
    await chartReady(page, /^Marcus Hale/);
    await page.screenshot({ path: join(dir, `${scheme}-fit.png`) });
    for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(dir, `${scheme}-zoom-in.png`) });
    await page.getByRole('button', { name: 'Fit the whole chart' }).click();
    for (let i = 0; i < 5; i += 1) await page.getByRole('button', { name: 'Zoom out' }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(dir, `${scheme}-zoom-out.png`) });
  }
});
