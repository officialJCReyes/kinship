// SPDX-License-Identifier: AGPL-3.0-or-later
import type { PersonLabel } from '@kinship/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, detailFor, haleRoutes, MEMBER, PEOPLE, READER } from './family.js';
import { customLabelPrefix, withoutOverriddenTitles } from '../src/lib/labels.js';
import { calls, mockApi, renderApp } from './helpers.js';
import type { MockRoute } from './helpers.js';

afterEach(() => vi.unstubAllGlobals());

const person = (id: string) => PEOPLE.find((p) => p.id === id)!;
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
function bodyOf(fetchMock: ReturnType<typeof mockApi>, key: string): unknown {
  const call = [...fetchMock.mock.calls]
    .reverse()
    .find(([input, init]) => `${(init?.method ?? 'GET').toUpperCase()} ${String(input)}` === key);
  return call?.[1]?.body ? JSON.parse(String(call[1].body)) : undefined;
}

/** Marcus's profile with labels: Carla is his Godmother (reverse Godchild); Ben has him as "Guardian", no reverse. */
const MARCUS_LABELS: PersonLabel[] = [
  {
    id: 'l1',
    otherId: 'carla',
    other: person('carla'),
    direction: 'from',
    label: 'Godmother',
    reverseLabel: 'Godchild',
  },
  { id: 'l2', otherId: 'ben', other: person('ben'), direction: 'to', label: 'Guardian', reverseLabel: null },
  { id: 'l3', otherId: 'sofia', other: person('sofia'), direction: 'to', label: 'Mentor', reverseLabel: 'Protégé' },
];
const marcusWith = (me: typeof ADMIN, labels: PersonLabel[]): MockRoute => ({
  status: 200,
  body: { ...detailFor(me, 'marcus'), labels },
});

describe('what a custom label says', () => {
  const base = { label: 'Godmother', reverseLabel: 'Godchild' };
  it('names the label on the from side, the reverse on the to side, and "<label> of" without one', () => {
    expect(customLabelPrefix({ direction: 'from', ...base })).toBe('Godmother:');
    expect(customLabelPrefix({ direction: 'to', ...base })).toBe('Godchild:');
    expect(customLabelPrefix({ direction: 'to', label: 'Godmother', reverseLabel: null })).toBe('Godmother of');
  });

  it('drops a derived title for a person who has a custom label, and keeps the others', () => {
    // A derived "Stepmother" row (the rows come in the next step) for Carla, and one for Ben.
    const derived = [
      { otherId: 'carla', title: 'Stepmother' },
      { otherId: 'ben', title: 'Stepson' },
    ];
    expect(withoutOverriddenTitles(derived, [{ otherId: 'carla' }])).toEqual([{ otherId: 'ben', title: 'Stepson' }]);
    expect(withoutOverriddenTitles(derived, [])).toEqual(derived);
  });
});

describe('the profile: other relationships', () => {
  it('shows each label with the other person and a (custom) pill, from either side', async () => {
    mockApi(haleRoutes(ADMIN, { 'GET /api/people/marcus': marcusWith(ADMIN, MARCUS_LABELS) }));
    renderApp('/people/marcus');
    await screen.findByRole('heading', { name: 'Marcus Hale' });
    const list = screen.getByRole('list', { name: 'Other relationships' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toMatch(/^Godmother: Carla Nair\(custom\)/);
    expect(rows[1]!.textContent).toMatch(/^Guardian of Ben Hale\(custom\)/);
    expect(rows[2]!.textContent).toMatch(/^Protégé: Sofia Hale\(custom\)/);
    expect(within(rows[0]!).getByRole('link', { name: 'Carla Nair' })).toBeTruthy();
  });

  it('shows no section to a User when there are no labels, and no buttons when there are', async () => {
    mockApi(haleRoutes(READER));
    renderApp('/people/marcus');
    await screen.findByRole('heading', { name: 'Marcus Hale' });
    expect(screen.queryByText('Other relationships')).toBeNull();
    vi.unstubAllGlobals();
    mockApi(haleRoutes(READER, { 'GET /api/people/marcus': marcusWith(READER, MARCUS_LABELS) }));
    renderApp('/people/marcus');
    await screen.findAllByText('Other relationships');
    expect(screen.getAllByText('Godmother:').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Other relationship' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('gives a Member the list but no way to change it', async () => {
    mockApi(haleRoutes(MEMBER, { 'GET /api/people/marcus': marcusWith(MEMBER, MARCUS_LABELS) }));
    renderApp('/people/marcus');
    await screen.findByRole('heading', { name: 'Marcus Hale' });
    expect(screen.getByText('Godmother:')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Other relationship' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('shows an admin the empty state and the button even with no labels', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/people/marcus');
    await screen.findByRole('heading', { name: 'Marcus Hale' });
    expect(screen.getByText('No other relationships recorded.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Other relationship' })).toBeTruthy();
  });
});

describe('the "Other relationship" dialog', () => {
  const open = async (extra: Record<string, MockRoute> = {}) => {
    const fetchMock = mockApi(
      haleRoutes(ADMIN, {
        '/api/people?q=ca&limit=8': {
          status: 200,
          body: { items: [person('marcus'), person('carla')], nextCursor: null },
        },
        ...extra,
      }),
    );
    renderApp('/people/marcus');
    await screen.findByRole('heading', { name: 'Marcus Hale' });
    click('Other relationship');
    return { fetchMock, dialog: screen.getByRole('dialog', { name: 'Other relationship for Marcus Hale' }) };
  };

  it('is opened from the profile, not from Add relative', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/people/marcus');
    await screen.findByRole('heading', { name: 'Marcus Hale' });
    click('Add relative');
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByText(/Other relationship/)).toBeNull();
    expect(within(dialog).queryByLabelText(/label/i)).toBeNull();
  });

  it('cannot pick the person themselves, and needs a person and a label', async () => {
    const { dialog } = await open();
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'The other person' }), { target: { value: 'ca' } });
    expect(await within(dialog).findByRole('option', { name: /Carla Nair/ })).toBeTruthy();
    expect(within(dialog).queryByRole('option', { name: /Marcus Hale/ })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Choose the other person.')).toBeTruthy();
    expect(within(dialog).getByText('Enter a label of 1 to 60 characters.')).toBeTruthy();
  });

  it('saves a label with an optional reverse label (blank is sent as null)', async () => {
    const { fetchMock, dialog } = await open({
      'POST /api/labels': { status: 201, body: { label: { id: 'new' } } },
    });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'The other person' }), { target: { value: 'ca' } });
    fireEvent.click(await within(dialog).findByRole('option', { name: /Carla Nair/ }));
    fireEvent.change(within(dialog).getByLabelText('What they are to Marcus Hale'), {
      target: { value: ' Godmother ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bodyOf(fetchMock, 'POST /api/labels')).toEqual({
      fromId: 'marcus',
      toId: 'carla',
      label: 'Godmother',
      reverseLabel: null,
    });
    expect(await screen.findByText('The relationship was added.')).toBeTruthy();
  });

  it('shows the API’s error code as a translated message and stays open', async () => {
    const { dialog } = await open({ 'POST /api/labels': { status: 409, body: { error: 'duplicate_label' } } });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'The other person' }), { target: { value: 'ca' } });
    fireEvent.click(await within(dialog).findByRole('option', { name: /Carla Nair/ }));
    fireEvent.change(within(dialog).getByLabelText('What they are to Marcus Hale'), { target: { value: 'Godmother' } });
    fireEvent.change(within(dialog).getByLabelText('What Marcus Hale is to them (optional)'), {
      target: { value: 'Godchild' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('These two people already have that label.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('changing and removing a label from the profile row', () => {
  const profile = async (extra: Record<string, MockRoute> = {}, who = 'marcus') => {
    const fetchMock = mockApi(
      haleRoutes(ADMIN, {
        [`GET /api/people/${who}`]:
          who === 'marcus'
            ? marcusWith(ADMIN, MARCUS_LABELS)
            : {
                status: 200,
                body: {
                  ...detailFor(ADMIN, who),
                  labels: [{ ...MARCUS_LABELS[0]!, otherId: 'marcus', other: person('marcus'), direction: 'to' }],
                },
              },
        ...extra,
      }),
    );
    renderApp(`/people/${who}`);
    await screen.findByRole('list', { name: 'Other relationships' });
    return fetchMock;
  };

  it('edits the wording, with the people fixed', async () => {
    const fetchMock = await profile({ 'PATCH /api/labels/l1': { status: 200, body: { label: { id: 'l1' } } } });
    const first = screen.getAllByRole('listitem').find((li) => li.textContent?.startsWith('Godmother:'))!;
    fireEvent.click(within(first).getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Change the relationship between Marcus Hale and Carla Nair' });
    expect(within(dialog).queryByRole('combobox')).toBeNull();
    expect((within(dialog).getByLabelText('What Carla Nair is to Marcus Hale') as HTMLInputElement).value).toBe(
      'Godmother',
    );
    fireEvent.change(within(dialog).getByLabelText('What Carla Nair is to Marcus Hale'), {
      target: { value: 'Guardian' },
    });
    fireEvent.change(within(dialog).getByLabelText('What Marcus Hale is to Carla Nair (optional)'), {
      target: { value: '' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bodyOf(fetchMock, 'PATCH /api/labels/l1')).toEqual({ label: 'Guardian', reverseLabel: null });
  });

  it('turns the words around when opened from the other side', async () => {
    await profile({}, 'carla');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(
      screen.getByRole('dialog', { name: 'Change the relationship between Marcus Hale and Carla Nair' }),
    ).toBeTruthy();
    expect(screen.getByLabelText('What Carla Nair is to Marcus Hale')).toBeTruthy();
  });

  it('removes a label after asking', async () => {
    const fetchMock = await profile({ 'DELETE /api/labels/l2': { status: 204 } });
    const row = screen.getAllByRole('listitem').find((li) => li.textContent?.startsWith('Guardian of'))!;
    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }));
    const dialog = screen.getByRole('dialog', { name: 'Remove this relationship?' });
    expect(within(dialog).getByText(/Nobody is removed from the tree/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove relationship' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls(fetchMock)).toContain('DELETE /api/labels/l2');
    expect(await screen.findByText('The relationship was removed.')).toBeTruthy();
  });
});
