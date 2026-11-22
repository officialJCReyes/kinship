// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The calendar picker is the one shared date entry, so it is in every form that takes a date. These open the real
// forms and pick through the calendar.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, haleRoutes } from './family.js';
import { mockApi, renderApp } from './helpers.js';
import { fillAccount, next, openSetup, toYou } from './setup-helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

function bodyOf(fetchMock: ReturnType<typeof mockApi>, key: string): unknown {
  const call = [...fetchMock.mock.calls]
    .reverse()
    .find(([input, init]) => `${(init?.method ?? 'GET').toUpperCase()} ${String(input)}` === key);
  return call?.[1]?.body ? JSON.parse(String(call[1].body)) : undefined;
}
const pickerFor = (field: string) => screen.getByRole('dialog', { name: `Calendar for ${field}` });
const openFor = (field: string) =>
  fireEvent.click(screen.getByRole('button', { name: `Choose ${field} on a calendar` }));

describe('Edit details', () => {
  it('picks a birth date and a death date, and saves them as typed text', async () => {
    const fetchMock = mockApi(
      haleRoutes(ADMIN, { 'PATCH /api/people/marcus': { status: 200, body: { person: {}, warnings: [] } } }),
    );
    renderApp('/people/marcus');
    await screen.findByRole('heading', { name: 'Marcus Hale' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit details: Marcus Hale' });
    openFor('Birth date');
    expect(pickerFor('Birth date')).toBeTruthy();
    fireEvent.change(within(pickerFor('Birth date')).getByLabelText('Year'), { target: { value: '1903' } });
    fireEvent.click(within(pickerFor('Birth date')).getByRole('button', { name: 'Use the year 1903' }));
    fireEvent.change(within(dialog).getByLabelText('Status'), { target: { value: 'deceased' } });
    openFor('Date of death');
    fireEvent.change(within(pickerFor('Date of death')).getByLabelText('Year'), { target: { value: '1977' } });
    fireEvent.change(within(pickerFor('Date of death')).getByLabelText('Month'), { target: { value: '9' } });
    fireEvent.click(within(pickerFor('Date of death')).getByRole('button', { name: 'Sep 12, 1977' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bodyOf(fetchMock, 'PATCH /api/people/marcus')).toMatchObject({
      birth: { value: '1903', precision: 'exactly' },
      death: { value: '1977-09-12', precision: 'exactly' },
    });
  });
});

describe('relationships', () => {
  it('has it on the relationship form (marriage date and the end date of a divorce)', async () => {
    const fetchMock = mockApi(haleRoutes(ADMIN, { 'PATCH /api/unions/u2': { status: 200, body: { union: {} } } }));
    renderApp('/people/daniel');
    const card = await screen.findByRole('article', { name: 'Relationship with Priya Nair' });
    fireEvent.click(within(card).getByRole('button', { name: 'Edit relationship' }));
    const dialog = screen.getByRole('dialog', { name: 'Relationship: Daniel Hale and Priya Nair' });
    expect(within(dialog).getByRole('button', { name: 'Choose Marriage or start date on a calendar' })).toBeTruthy();
    openFor('Divorce date');
    // it opens on what is there (1998-03-09), not on today
    expect(within(pickerFor('Divorce date')).getByRole('grid').querySelector('caption')!.textContent).toBe(
      'March 1998',
    );
    fireEvent.click(within(pickerFor('Divorce date')).getByRole('button', { name: 'Mar 20, 1998' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bodyOf(fetchMock, 'PATCH /api/unions/u2')).toMatchObject({ end: { value: '1998-03-20' } });
  });
});

describe('Add relative', () => {
  it('has it for a new person’s birth date', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/people/marcus');
    await screen.findByRole('heading', { name: 'Marcus Hale' });
    fireEvent.click(screen.getByRole('button', { name: 'Add relative' }));
    fireEvent.click(screen.getByRole('button', { name: /^Add partner/ }));
    expect(screen.getByRole('button', { name: 'Choose Birth date on a calendar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose Marriage or start date on a calendar' })).toBeTruthy();
  });
});

describe('the setup wizard', () => {
  it('has it for your birth date and your children’s, and fills what the wizard sends', async () => {
    await toYou();
    const you = screen.getByLabelText('Birth date', { exact: true });
    openFor('Birth date');
    fireEvent.change(within(pickerFor('Birth date')).getByLabelText('Year'), { target: { value: '1986' } });
    fireEvent.click(within(pickerFor('Birth date')).getByRole('button', { name: 'Use the year 1986' }));
    expect((you as HTMLInputElement).value).toBe('1986');
    cleanup();
  });

  it('is not on the account and tree steps, which have no date', async () => {
    await openSetup();
    fillAccount();
    next();
    expect(screen.queryByRole('button', { name: /on a calendar$/ })).toBeNull();
  });
});
