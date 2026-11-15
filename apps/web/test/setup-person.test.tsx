// SPDX-License-Identifier: AGPL-3.0-or-later
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ME, mockApi, needsSetup, renderApp } from './helpers.js';

afterEach(() => vi.unstubAllGlobals());

function fillAccount() {
  const set = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  set('Setup token', 'tok');
  set('Your name', 'Marcus Hale');
  set('Email', 'marcus@example.com');
  set('Password', 'a long enough password');
  set('Confirm password', 'a long enough password');
  set('Name your first tree', 'Hale Family');
  return set;
}

describe('setup: the first person', () => {
  it('sends the person with the account', async () => {
    const fetchMock = mockApi({ ...needsSetup, 'POST /api/setup': { status: 201, body: ME } });
    renderApp('/setup');
    await screen.findByRole('heading', { name: 'Welcome to KinShip' });
    const set = fillAccount();
    set('Your given name', ' Marcus ');
    set('Your surname', 'Hale');
    fireEvent.click(screen.getByRole('button', { name: 'Create account and continue' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/setup')).toBe(true));
    const call = fetchMock.mock.calls.find(([url]) => String(url) === '/api/setup');
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ person: { givenName: 'Marcus', surname: 'Hale' } });
  });

  it('sends no person when both names are empty', async () => {
    const fetchMock = mockApi({ ...needsSetup, 'POST /api/setup': { status: 201, body: ME } });
    renderApp('/setup');
    await screen.findByRole('heading', { name: 'Welcome to KinShip' });
    fillAccount();
    fireEvent.click(screen.getByRole('button', { name: 'Create account and continue' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/setup')).toBe(true));
    const call = fetchMock.mock.calls.find(([url]) => String(url) === '/api/setup');
    expect(JSON.parse(String(call?.[1]?.body))).not.toHaveProperty('person');
  });

  it('asks for both names, or neither, and ties the message to the field', async () => {
    const fetchMock = mockApi({ ...needsSetup, 'POST /api/setup': { status: 201, body: ME } });
    renderApp('/setup');
    await screen.findByRole('heading', { name: 'Welcome to KinShip' });
    const set = fillAccount();
    set('Your given name', 'Marcus');
    fireEvent.click(screen.getByRole('button', { name: 'Create account and continue' }));
    const surname = screen.getByLabelText('Your surname');
    expect(await screen.findByText('Enter a surname (up to 100 characters).')).toBeTruthy();
    expect(surname.getAttribute('aria-invalid')).toBe('true');
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/setup')).toBe(false);
  });
});
