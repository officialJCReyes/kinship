// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The place of a relationship (migration 0015): the field in the create and edit forms, what is sent, and the person
// panel on the chart. The profile does not show it yet (see the PR).
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, haleRoutes, PEOPLE, UNIONS } from './family.js';
import { mockApi, renderApp } from './helpers.js';

let undo: Array<() => void> = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const fn of undo) fn();
  undo = [];
});
function withPlace(id: string, place: string | null) {
  const union = UNIONS.find((u) => u.id === id)!;
  const before = union.place;
  union.place = place;
  undo.push(() => (union.place = before));
}

type Fetch = ReturnType<typeof mockApi>;
function bodyOf(fetchMock: Fetch, key: string): unknown {
  const call = [...fetchMock.mock.calls]
    .reverse()
    .find(([input, init]) => `${(init?.method ?? 'GET').toUpperCase()} ${String(input)}` === key);
  return call?.[1]?.body ? JSON.parse(String(call[1].body)) : undefined;
}

describe('editing a relationship', () => {
  const open = async (routes = {}) => {
    const fetchMock = mockApi(
      haleRoutes(ADMIN, { 'PATCH /api/unions/u1': { status: 200, body: { union: {} } }, ...routes }),
    );
    renderApp('/people/daniel');
    const card = await screen.findByRole('article', { name: 'Relationship with Elena Ruiz' });
    fireEvent.click(within(card).getByRole('button', { name: 'Edit relationship' }));
    const dialog = screen.getByRole('dialog', { name: 'Relationship: Daniel Hale and Elena Ruiz' });
    return { fetchMock, dialog };
  };
  const save = async (dialog: HTMLElement) => {
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  };

  it('has an empty optional Place, and sends no place (null) when it is left empty', async () => {
    const { fetchMock, dialog } = await open();
    expect((within(dialog).getByLabelText('Place (optional)') as HTMLInputElement).value).toBe('');
    await save(dialog);
    expect(bodyOf(fetchMock, 'PATCH /api/unions/u1')).toMatchObject({ place: null });
  });

  it('sends the place trimmed', async () => {
    const { fetchMock, dialog } = await open();
    fireEvent.change(within(dialog).getByLabelText('Place (optional)'), {
      target: { value: '  Santo Domingo, Dominican Republic ' },
    });
    await save(dialog);
    expect(bodyOf(fetchMock, 'PATCH /api/unions/u1')).toMatchObject({ place: 'Santo Domingo, Dominican Republic' });
  });

  it('shows the saved place, keeps it when untouched, and clears it when emptied', async () => {
    withPlace('u1', 'Madrid, Spain');
    const first = await open();
    expect((within(first.dialog).getByLabelText('Place (optional)') as HTMLInputElement).value).toBe('Madrid, Spain');
    await save(first.dialog);
    expect(bodyOf(first.fetchMock, 'PATCH /api/unions/u1')).toMatchObject({ place: 'Madrid, Spain' });
  });

  it('clears it when emptied', async () => {
    withPlace('u1', 'Madrid, Spain');
    const { fetchMock, dialog } = await open();
    fireEvent.change(within(dialog).getByLabelText('Place (optional)'), { target: { value: '   ' } });
    await save(dialog);
    expect(bodyOf(fetchMock, 'PATCH /api/unions/u1')).toMatchObject({ place: null });
  });

  it('stops at 200 characters in the field', async () => {
    const { dialog } = await open();
    expect(within(dialog).getByLabelText('Place (optional)').getAttribute('maxlength')).toBe('200');
  });
});

describe('adding a partner', () => {
  it('asks for the place and sends it with the new relationship', async () => {
    const fetchMock = mockApi(
      haleRoutes(ADMIN, {
        '/api/people?q=len&limit=8': { status: 200, body: { items: [PEOPLE[9]], nextCursor: null } },
        'POST /api/unions': { status: 201, body: { union: {} } },
      }),
    );
    renderApp('/people/marcus');
    await screen.findByRole('heading', { name: 'Marcus Hale' });
    fireEvent.click(screen.getByRole('button', { name: 'Add relative' }));
    fireEvent.click(screen.getByRole('button', { name: /^Add partner/ }));
    fireEvent.click(screen.getByLabelText('Someone already on the tree'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Find them by name' }), { target: { value: 'len' } });
    fireEvent.click(await screen.findByRole('option', { name: /Lena Okafor/ }));
    fireEvent.change(screen.getByLabelText('Place (optional)'), { target: { value: 'Lagos, Nigeria' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bodyOf(fetchMock, 'POST /api/unions')).toMatchObject({ place: 'Lagos, Nigeria' });
  });
});

describe('the person panel on the chart', () => {
  const panelFor = async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus');
    fireEvent.click(await screen.findByRole('button', { name: /^Daniel Hale/ }));
    const panel = screen.getByRole('complementary', { name: 'Selected person' });
    await within(panel).findByText(/Elena Ruiz/);
    return panel;
  };

  it('shows where a relationship began under that partner', async () => {
    withPlace('u1', 'Madrid, Spain');
    const panel = await panelFor();
    expect(within(panel).getByText('Place: Madrid, Spain')).toBeTruthy();
    expect(within(panel).getAllByText(/^Place:/)).toHaveLength(1); // not on the other relationship
  });

  it('shows nothing when no place is recorded', async () => {
    const panel = await panelFor();
    expect(within(panel).queryByText(/^Place:/)).toBeNull();
  });
});
