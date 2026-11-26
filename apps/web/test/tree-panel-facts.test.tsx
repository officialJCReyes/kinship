// SPDX-License-Identifier: AGPL-3.0-or-later
// The person panel (step 49 A): Born and Died lines with ages, and the round icon actions.
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, haleRoutes, MEMBER, READER } from './family.js';
import { mockApi, renderApp } from './helpers.js';

beforeEach(() => {
  // Only the clock is faked (25 November 2026), so React Query's timers still run.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 25, 12));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

async function panelFor(me: typeof ADMIN, id: string) {
  mockApi(haleRoutes(me));
  renderApp(`/tree/marcus?sel=${id}`);
  const panel = await screen.findByRole('complementary', { name: 'Selected person' });
  await within(panel).findByRole('heading', { level: 2 });
  return panel;
}

const factText = (panel: HTMLElement, kind: 'born' | 'died') =>
  panel.querySelector(`.panel-${kind}`)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

describe('the Born and Died lines', () => {
  it('gives a living person their age (from the year alone, so with a tilde)', async () => {
    const panel = await panelFor(ADMIN, 'rosa');
    expect(factText(panel, 'born')).toBe('Born 1934 (age ~92)');
    expect(factText(panel, 'died')).toBeNull();
    expect(within(panel).getByText('Living')).toBeTruthy();
  });

  it('gives a deceased person a Died line with the age at death, and no lifespan line', async () => {
    const panel = await panelFor(ADMIN, 'walter');
    expect(factText(panel, 'born')).toBe('Born 1930');
    expect(factText(panel, 'died')).toBe('Died 2005 (at age ~75)');
    expect(within(panel).queryByText(/1930 – 2005/)).toBeNull();
    // No place yet (0.5): no stray separator.
    expect(panel.querySelector('.panel-facts')?.textContent).not.toMatch(/·|\?/);
  });
});

describe('the icon actions', () => {
  it('are round buttons in a named group, with the old names and hidden icons', async () => {
    const panel = await panelFor(ADMIN, 'walter');
    const group = within(panel).getByRole('group', { name: 'Actions for Walter Hale' });
    const actions = Array.from(group.querySelectorAll('a, button'));
    expect(actions.map((el) => el.getAttribute('aria-label'))).toEqual([
      'Open profile',
      'Edit details',
      'Add relative',
      'Research this person on FamilySearch (opens in a new tab)',
      'View Walter’s family',
      'More actions',
    ]);
    for (const action of actions) {
      expect(action.classList.contains('round')).toBe(true);
      expect(action.textContent).toBe('');
      expect(action.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    }
    expect(within(group).getByRole('link', { name: 'Open profile' }).getAttribute('href')).toBe('/people/walter');
  });

  it('show their name in a bubble on hover and on keyboard focus', async () => {
    const panel = await panelFor(ADMIN, 'walter');
    const edit = within(panel).getByRole('button', { name: 'Edit details' });
    fireEvent.focus(edit);
    expect(document.querySelector('.infotip-bubble')?.textContent).toBe('Edit details');
    fireEvent.blur(edit);
    expect(document.querySelector('.infotip-bubble')).toBeNull();
    fireEvent.mouseEnter(within(panel).getByRole('link', { name: 'Open profile' }));
    expect(document.querySelector('.infotip-bubble')?.textContent).toBe('Open profile');
  });

  it('open Edit details and Add relative for an admin', async () => {
    const panel = await panelFor(ADMIN, 'walter');
    fireEvent.click(within(panel).getByRole('button', { name: 'Edit details' }));
    expect(await screen.findByRole('dialog', { name: /Walter Hale/ })).toBeTruthy();
  });

  it('keep the reason an action is unavailable as page text, read as the description and shown on focus', async () => {
    const panel = await panelFor(READER, 'walter');
    for (const name of ['Edit details', 'Add relative']) {
      const button = within(panel).getByRole('button', { name });
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.hasAttribute('disabled')).toBe(false);
      const reason = document.getElementById(button.getAttribute('aria-describedby') ?? '');
      expect(reason?.textContent).toMatch(/\S/);
      expect(button.getAttribute('title')).toBeNull();
      fireEvent.focus(button);
      expect(document.querySelector('.infotip-bubble .tip-reason')?.textContent).toBe(reason?.textContent);
      fireEvent.blur(button);
      fireEvent.click(button);
      expect(screen.queryByRole('dialog')).toBeNull();
      // A tap (no hover on a touch screen) shows the reason too.
      expect(document.querySelector('.infotip-bubble .tip-reason')?.textContent).toBe(reason?.textContent);
      fireEvent.blur(button);
    }
  });

  it('lets a Member edit their own person', async () => {
    const own = await panelFor(MEMBER, 'marcus');
    expect(within(own).getByRole('button', { name: 'Edit details' }).getAttribute('aria-disabled')).toBeNull();
    expect(within(own).getByRole('button', { name: 'Add relative' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('explains to a Member why they cannot edit someone else', async () => {
    const other = await panelFor(MEMBER, 'walter');
    const edit = within(other).getByRole('button', { name: 'Edit details' });
    expect(edit.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(edit.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'You can only edit your own profile',
    );
  });
});
