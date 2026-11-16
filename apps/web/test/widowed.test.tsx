// SPDX-License-Identifier: AGPL-3.0-or-later
import type { UnionStatus } from '@kinship/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, detailFor, haleRoutes, PEOPLE } from './family.js';
import { newlyAutoWidowed } from '../src/lib/people.js';
import { calls, mockApi, renderApp } from './helpers.js';
import type { MockRoute } from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
  patched = false;
});

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const union = (id: string, status: UnionStatus, statusAuto: boolean) => ({ id, status, statusAuto });

describe('newlyAutoWidowed', () => {
  it('counts relationships that are Widowed and automatic now and were not before', () => {
    expect(newlyAutoWidowed([union('a', 'married', false)], [union('a', 'widowed', true)])).toBe(1);
    expect(
      newlyAutoWidowed(
        [union('a', 'married', false), union('b', 'married', false), union('c', 'divorced', false)],
        [union('a', 'widowed', true), union('b', 'widowed', true), union('c', 'divorced', false)],
      ),
    ).toBe(2);
  });

  it('does not count what was already automatic, what is Widowed by hand, or what the server did not change', () => {
    expect(newlyAutoWidowed([union('a', 'widowed', true)], [union('a', 'widowed', true)])).toBe(0);
    expect(newlyAutoWidowed([union('a', 'married', false)], [union('a', 'widowed', false)])).toBe(0);
    expect(newlyAutoWidowed([union('a', 'married', false)], [union('a', 'married', false)])).toBe(0);
    expect(newlyAutoWidowed([], [])).toBe(0);
  });
});

/** GET /api/people/daniel answers the original until the PATCH has happened, and `then` after it. */
let patched = false;
function danielReads(then: ReturnType<typeof detailFor>): MockRoute {
  const first = detailFor(ADMIN, 'daniel');
  return () => ({ status: 200, body: patched ? then : first });
}
function danielWith(status: string, auto: boolean) {
  const detail = detailFor(ADMIN, 'daniel');
  return {
    ...detail,
    unions: detail.unions.map((u) => (u.id === 'u1' ? { ...u, status, statusAuto: auto } : u)),
  } as ReturnType<typeof detailFor>;
}

describe('the "set to Widowed automatically" notice', () => {
  const markDeceased = async (route: MockRoute) => {
    const fetchMock = mockApi(
      haleRoutes(ADMIN, {
        'GET /api/people/daniel': route,
        'PATCH /api/people/daniel': () => {
          patched = true;
          return { status: 200, body: { person: PEOPLE[2], warnings: [] } };
        },
      }),
    );
    renderApp('/people/daniel');
    await screen.findByRole('heading', { name: 'Daniel Hale' });
    click('Edit details');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'deceased' } });
    click('Save');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    return fetchMock;
  };

  it('is shown when the server reports a relationship it set to Widowed', async () => {
    await markDeceased(danielReads(danielWith('widowed', true)));
    expect(await screen.findByText('1 marriage was set to Widowed automatically.')).toBeTruthy();
  });

  it('is not shown when the server reports no change, even though the person is deceased', async () => {
    await markDeceased(danielReads(danielWith('married', false)));
    expect(screen.queryByText(/Widowed automatically/)).toBeNull();
  });

  it('is not shown for a relationship that was already automatic before', async () => {
    const before = danielWith('widowed', true);
    mockApi(
      haleRoutes(ADMIN, {
        'GET /api/people/daniel': { status: 200, body: before },
        'PATCH /api/people/daniel': { status: 200, body: { person: PEOPLE[2], warnings: [] } },
      }),
    );
    renderApp('/people/daniel');
    await screen.findByRole('heading', { name: 'Daniel Hale' });
    click('Edit details');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'deceased' } });
    click('Save');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByText(/Widowed automatically/)).toBeNull();
  });

  it('does not even look when living or deceased was not changed', async () => {
    const fetchMock = mockApi(
      haleRoutes(ADMIN, { 'PATCH /api/people/daniel': { status: 200, body: { person: PEOPLE[2], warnings: [] } } }),
    );
    renderApp('/people/daniel');
    await screen.findByRole('heading', { name: 'Daniel Hale' });
    const reads = () => calls(fetchMock).filter((c) => c === 'GET /api/people/daniel').length;
    click('Edit details');
    const dialogReads = reads();
    fireEvent.change(screen.getByLabelText('Given name'), { target: { value: 'Danny' } });
    click('Save');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByText(/Widowed automatically/)).toBeNull();
    // Only the profile's own refresh after saving, no before-and-after reads from the dialog.
    expect(reads() - dialogReads).toBeLessThanOrEqual(1);
  });
});

describe('the relationship editor', () => {
  it('says an automatic Widowed was set automatically, and nothing for one that was not', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/people/rosa');
    const card = await screen.findByRole('article', { name: 'Relationship with Walter Hale' });
    fireEvent.click(within(card).getByRole('button', { name: 'Edit relationship' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Set automatically; saving a status here makes it permanent.')).toBeTruthy();
  });

  it('shows no such note for a relationship set by hand', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/people/daniel');
    const card = await screen.findByRole('article', { name: 'Relationship with Elena Ruiz' });
    fireEvent.click(within(card).getByRole('button', { name: 'Edit relationship' }));
    expect(within(screen.getByRole('dialog')).queryByText(/Set automatically/)).toBeNull();
  });

  it('sends the status even when it is the same, and tells the admin when the server saved Widowed instead of Married', async () => {
    const fetchMock = mockApi(
      haleRoutes(ADMIN, {
        'PATCH /api/unions/u1': { status: 200, body: { union: { id: 'u1', status: 'widowed', statusAuto: true } } },
      }),
    );
    renderApp('/people/daniel');
    const card = await screen.findByRole('article', { name: 'Relationship with Elena Ruiz' });
    fireEvent.click(within(card).getByRole('button', { name: 'Edit relationship' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const call = [...fetchMock.mock.calls].reverse().find(([url]) => String(url) === '/api/unions/u1');
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ status: 'married' });
    expect(await screen.findByText('Saved as Widowed, because a partner is deceased.')).toBeTruthy();
  });

  it('does not add that notice when the server saved what was asked', async () => {
    mockApi(
      haleRoutes(ADMIN, {
        'PATCH /api/unions/u1': { status: 200, body: { union: { id: 'u1', status: 'married', statusAuto: false } } },
      }),
    );
    renderApp('/people/daniel');
    const card = await screen.findByRole('article', { name: 'Relationship with Elena Ruiz' });
    fireEvent.click(within(card).getByRole('button', { name: 'Edit relationship' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByText(/Saved as Widowed/)).toBeNull();
  });
});

describe('add relative: a partner who is deceased', () => {
  it('tells the admin when the server stored Widowed for a Married relationship', async () => {
    mockApi(
      haleRoutes(ADMIN, {
        '/api/people?q=len&limit=8': { status: 200, body: { items: [PEOPLE[9]], nextCursor: null } },
        'POST /api/unions': { status: 201, body: { union: { id: 'new', status: 'widowed', statusAuto: true } } },
      }),
    );
    renderApp('/people/marcus');
    await screen.findByRole('heading', { name: 'Marcus Hale' });
    click('Add relative');
    click(/^Add partner/);
    fireEvent.click(screen.getByLabelText('Someone already on the tree'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Find them by name' }), { target: { value: 'len' } });
    fireEvent.click(await screen.findByRole('option', { name: /Lena Okafor/ }));
    click('Save');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Saved as Widowed, because a partner is deceased.')).toBeTruthy();
  });
});
