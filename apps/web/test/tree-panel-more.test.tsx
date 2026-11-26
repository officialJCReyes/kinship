// SPDX-License-Identifier: AGPL-3.0-or-later
// The person panel (step 49 C): the View family button and the More menu (Copy link, Change photo, Delete person).
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { viewFamilyLeaf } from '../src/tree/family.js';
import { personLink } from '../src/tree/PanelMore.js';
import { ADMIN, haleRoutes, MEMBER } from './family.js';
import { calls, mockApi, renderApp } from './helpers.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

/** An admin whose account is linked to Marcus. */
const LINKED_ADMIN = { ...ADMIN, personId: 'marcus' };

async function panelFor(me: typeof ADMIN, id: string, extra: Parameters<typeof haleRoutes>[1] = {}) {
  const fetchMock = mockApi(haleRoutes(me, extra));
  renderApp(`/tree/marcus?sel=${id}`);
  const panel = await screen.findByRole('complementary', { name: 'Selected person' });
  await within(panel).findByRole('heading', { level: 2 });
  // Wait for the person's details (permissions) so every action is settled.
  await waitFor(() =>
    expect(within(panel).getByRole('button', { name: 'Edit details' }).hasAttribute('disabled')).toBe(false),
  );
  return { panel, fetchMock };
}

const moreButton = (panel: HTMLElement) => within(panel).getByRole('button', { name: 'More actions' });
const menuItems = () => within(screen.getByRole('menu', { name: 'More actions' })).getAllByRole('menuitem');
const itemNames = () => menuItems().map((item) => item.firstChild?.textContent);

describe('the More menu', () => {
  it('is a menu button that opens and closes with the mouse', async () => {
    const { panel } = await panelFor(ADMIN, 'walter');
    const more = moreButton(panel);
    expect(more.getAttribute('aria-haspopup')).toBe('menu');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(more.classList.contains('round')).toBe(true);
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(itemNames()).toEqual(['Copy link to this person', 'Change photo', 'Delete person']);
    // A click outside closes it.
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    // And a second click on the button does too.
    fireEvent.click(more);
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.click(more);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('works from the keyboard, and Escape gives the focus back to the More button', async () => {
    const { panel } = await panelFor(ADMIN, 'walter');
    const more = moreButton(panel);
    more.focus();
    fireEvent.keyDown(more, { key: 'ArrowDown' });
    const items = menuItems();
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it('puts Delete person after a line, in the danger colour, for an admin only', async () => {
    const admin = await panelFor(ADMIN, 'walter');
    fireEvent.click(moreButton(admin.panel));
    const remove = menuItems().at(-1)!;
    expect(remove.textContent).toBe('Delete person');
    expect(remove.classList.contains('danger-text')).toBe(true);
    expect(remove.previousElementSibling?.tagName).toBe('HR');
  });

  it('has no Delete for a Member, and Change photo says why it is unavailable on someone else', async () => {
    const { panel } = await panelFor(MEMBER, 'walter');
    fireEvent.click(moreButton(panel));
    expect(itemNames()).toEqual(['Copy link to this person', 'Change photo']);
    expect(screen.queryByRole('menuitem', { name: /Delete/ })).toBeNull();
    const photo = menuItems()[1]!;
    expect(photo.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(photo.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'You can only edit your own profile',
    );
  });
});

describe('Copy link to this person', () => {
  it('builds the absolute profile address', () => {
    expect(personLink('walter', 'https://tree.example.org')).toBe('https://tree.example.org/people/walter');
  });

  it('copies the address and says "Link copied" in a polite live region, then clears it', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const { panel } = await panelFor(ADMIN, 'walter');
    fireEvent.click(moreButton(panel));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link to this person' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/people/walter`);
    const status = panel.querySelector('.panel-status')!;
    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    await act(async () => {
      await Promise.resolve();
    });
    expect(status.textContent).toBe('Link copied');
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(status.textContent).toBe('');
  });

  it('shows the address to copy by hand when the browser refuses', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: () => Promise.reject(new Error('NotAllowedError')) },
    });
    const { panel } = await panelFor(ADMIN, 'walter');
    fireEvent.click(moreButton(panel));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link to this person' }));
    const dialog = await screen.findByRole('dialog', { name: 'Link to Walter Hale' });
    const field = within(dialog).getByLabelText<HTMLInputElement>('Link');
    expect(field.value).toBe(`${window.location.origin}/people/walter`);
    expect(field.readOnly).toBe(true);
    expect(panel.querySelector('.panel-status')?.textContent).toBe('');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the address too when there is no clipboard at all (a plain-http address)', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    const { panel } = await panelFor(ADMIN, 'walter');
    fireEvent.click(moreButton(panel));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link to this person' }));
    expect(await screen.findByRole('dialog', { name: 'Link to Walter Hale' })).toBeTruthy();
  });
});

describe('Change photo', () => {
  it('opens the avatar’s camera menu, with the focus in it', async () => {
    const { panel } = await panelFor(ADMIN, 'walter');
    fireEvent.click(moreButton(panel));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Change photo' }));
    const camera = await screen.findByRole('menu', { name: 'Add profile photo' });
    expect(within(camera).getByRole('menuitem', { name: 'Upload a new photo' })).toBeTruthy();
    expect(screen.queryByRole('menu', { name: 'More actions' })).toBeNull();
    await waitFor(() => expect(camera.contains(document.activeElement)).toBe(true));
  });
});

describe('Delete person', () => {
  const deleted = { 'DELETE /api/people/walter': { status: 204 } } as const;

  it('opens the delete dialog, and afterwards stays on the tree centred on your own person', async () => {
    const { panel, fetchMock } = await panelFor(LINKED_ADMIN, 'walter', deleted);
    fireEvent.click(moreButton(panel));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete person' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete Walter Hale?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete person' }));
    await waitFor(() => expect(calls(fetchMock)).toContain('DELETE /api/people/walter'));
    await waitFor(() =>
      expect(
        within(screen.getByRole('complementary', { name: 'Selected person' })).queryByRole('heading', {
          name: 'Marcus Hale',
        }),
      ).toBeTruthy(),
    );
    expect(screen.queryByRole('heading', { name: 'People', level: 1 })).toBeNull();
  });

  it('goes to the People page when the account has no person of its own', async () => {
    const { panel } = await panelFor(ADMIN, 'walter', deleted);
    fireEvent.click(moreButton(panel));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete person' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete Walter Hale?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete person' }));
    expect(await screen.findByRole('heading', { name: 'People', level: 1 })).toBeTruthy();
  });
});

describe('View family', () => {
  it('does what clicking the person’s leaf does', async () => {
    const { panel, fetchMock } = await panelFor(ADMIN, 'lena');
    fireEvent.click(within(panel).getByRole('button', { name: 'View Lena’s family' }));
    expect(await screen.findByText('Lena’s family')).toBeTruthy();
    expect(calls(fetchMock)).toContain('GET /api/tree/lena?up=3&down=1&collateral=true');
  });

  it('flips to the family of someone who is not a leaf', async () => {
    const { panel, fetchMock } = await panelFor(ADMIN, 'daniel');
    fireEvent.click(within(panel).getByRole('button', { name: 'View Daniel’s family' }));
    expect(await screen.findByText('Daniel’s family')).toBeTruthy();
    expect(calls(fetchMock).some((call) => call.startsWith('GET /api/tree/daniel?'))).toBe(true);
  });

  it('takes the leaf’s own target when there is one, else a flip', () => {
    const leaf = { personId: 'walter', count: 2, target: { kind: 'root' as const, personId: 'walter' } };
    expect(viewFamilyLeaf('walter', new Map([['walter', leaf]]))).toBe(leaf);
    expect(viewFamilyLeaf('daniel', new Map([['walter', leaf]]))).toEqual({
      personId: 'daniel',
      count: null,
      target: { kind: 'family', personId: 'daniel' },
    });
  });
});
