// SPDX-License-Identifier: AGPL-3.0-or-later
// Journey 13: the calendar beside every typed date. Typing still works; the calendar only fills the same field.
import { createPerson, createUnion } from '../support/api.js';
import { surname } from '../support/data.js';
import { expect, test } from '../support/fixtures.js';

test('pick a date from 1903 with the calendar: type the year, choose the month, move with the keyboard', async ({
  adminPage: page,
}) => {
  const family = surname('Hale');
  const person = await createPerson(page.request, { givenName: 'Walter', surname: family, gender: 'male' });
  await page.goto(`/people/${person.id}`);
  await page.getByRole('button', { name: 'Edit details' }).click();
  const dialog = page.getByRole('dialog', { name: /^Edit details/ });
  const field = dialog.getByLabel('Birth date', { exact: true });

  // Typing is exactly as before.
  await field.fill('1950-01');
  await expect(dialog.getByText('Reads as: Jan 1950')).toBeVisible();

  // The calendar opens on what was typed (a month), not on today, with focus on a day.
  const toggle = dialog.getByRole('button', { name: 'Choose Birth date on a calendar' });
  await toggle.click();
  const calendar = page.getByRole('dialog', { name: 'Calendar for Birth date' });
  await expect(calendar.locator('caption')).toHaveText('January 1950');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(':focus')).toHaveAccessibleName('Jan 1, 1950');

  // 1903 is a typed year and a month away, not 560 clicks.
  await calendar.getByLabel('Year', { exact: true }).fill('1903');
  await calendar.getByLabel('Month', { exact: true }).selectOption('12');
  await expect(calendar.locator('caption')).toHaveText('December 1903');
  await calendar.getByRole('button', { name: 'Dec 1, 1903' }).focus();
  await page.keyboard.press('ArrowDown'); // Dec 8
  await page.keyboard.press('ArrowDown'); // Dec 15
  await page.keyboard.press('ArrowRight'); // Dec 16
  await page.keyboard.press('ArrowRight'); // Dec 17: the first powered flight
  await page.keyboard.press('Enter');
  await expect(calendar).toBeHidden();
  await expect(field).toHaveValue('1903-12-17');
  await expect(dialog.getByText('Reads as: Dec 17, 1903')).toBeVisible();
  await expect(toggle).toBeFocused();

  // Partial: the year alone, then the month alone.
  await toggle.click();
  await calendar.getByRole('button', { name: 'Use the year 1903' }).click();
  await expect(field).toHaveValue('1903');
  await toggle.click();
  await expect(calendar.locator('caption')).toHaveText('January 1903'); // opened on the year it holds
  await calendar.getByLabel('Month', { exact: true }).selectOption('3');
  await calendar.getByRole('button', { name: 'Use Mar 1903' }).click();
  await expect(field).toHaveValue('1903-03');

  // Escape closes the calendar first, and only then the dialog.
  await toggle.click();
  await page.keyboard.press('Escape');
  await expect(calendar).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(toggle).toBeFocused();

  // Save, and the profile shows it in the account's format.
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Mar 1903').first()).toBeVisible();
});

test('the calendar is readable in every colour scheme, light and dark', async ({ adminPage: page }) => {
  const person = await createPerson(page.request, { givenName: 'Rosa', surname: surname('Hale'), gender: 'female' });
  await page.goto(`/people/${person.id}`);
  await page.getByRole('button', { name: 'Edit details' }).click();
  const dialog = page.getByRole('dialog', { name: /^Edit details/ });
  await dialog.getByLabel('Birth date', { exact: true }).fill('1934-06-15');
  await dialog.getByRole('button', { name: 'Choose Birth date on a calendar' }).click();
  const calendar = page.getByRole('dialog', { name: 'Calendar for Birth date' });
  const selected = calendar.locator('td[aria-selected="true"] button');
  await expect(selected).toHaveText('15');
  const parse = (css: string) =>
    css
      .match(/\d+(\.\d+)?/g)!
      .slice(0, 3)
      .map(Number);
  const luminance = ([r, g, b]: number[]) => {
    const c = [r, g, b].map((v) => {
      const s = v! / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const ratio = (a: number[], b: number[]) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  };
  for (const scheme of ['forest', 'sand', 'slate', 'graphite']) {
    for (const theme of ['light', 'dark']) {
      await page.evaluate(
        ([s, t]) => {
          document.documentElement.dataset['scheme'] = s;
          document.documentElement.dataset['theme'] = t;
        },
        [scheme!, theme],
      );
      const style = (locator: typeof selected, name: 'color' | 'backgroundColor') =>
        locator.evaluate((el, prop) => getComputedStyle(el)[prop as 'color'], name);
      // the chosen day: text on its fill; an ordinary day: text on the panel; the weekday headings
      expect(
        ratio(parse(await style(selected, 'color')), parse(await style(selected, 'backgroundColor'))),
        `${scheme} ${theme} chosen day`,
      ).toBeGreaterThanOrEqual(4.5);
      const plain = calendar.getByRole('button', { name: 'Jun 16, 1934' });
      const panel = parse(await calendar.evaluate((el) => getComputedStyle(el).backgroundColor));
      expect(ratio(parse(await style(plain, 'color')), panel), `${scheme} ${theme} day`).toBeGreaterThanOrEqual(4.5);
      const heading = calendar.locator('th').first();
      expect(ratio(parse(await style(heading, 'color')), panel), `${scheme} ${theme} weekday`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  }
});

test('it is in the relationship form too, opening on the date that is there', async ({ adminPage: page }) => {
  const family = surname('Hale');
  const a = await createPerson(page.request, { givenName: 'Daniel', surname: family, gender: 'male' });
  const b = await createPerson(page.request, { givenName: 'Elena', surname: family, gender: 'female' });
  await createUnion(page.request, a.id, b.id, 'married', '1985-05');
  await page.goto(`/people/${a.id}`);
  await page
    .getByRole('article', { name: `Relationship with Elena ${family}` })
    .getByRole('button', { name: 'Edit relationship' })
    .click();
  const dialog = page.getByRole('dialog', { name: /^Relationship: / });
  await dialog.getByRole('button', { name: 'Choose Marriage or start date on a calendar' }).click();
  await expect(page.getByRole('dialog', { name: 'Calendar for Marriage or start date' }).locator('caption')).toHaveText(
    'May 1985',
  );
});
