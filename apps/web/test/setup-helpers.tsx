// SPDX-License-Identifier: AGPL-3.0-or-later
import { fireEvent, screen } from '@testing-library/react';
import { ALICE, ME, mockApi, needsSetup, renderApp } from './helpers.js';
import type { MockRoute } from './helpers.js';

export const GOOD = 'correct horse battery staple';
export const TOKEN = 'tok-secret-123';
export const SIGNED_IN_ME = { ...ME, user: { ...ALICE, personId: 'p-marcus' } };

export const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
export const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });
export const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next' }));
export const back = () => fireEvent.click(screen.getByRole('button', { name: 'Back' }));
export const progress = () => screen.getByText(/^Step \d of 7/).textContent;

export function fillAccount(overrides: Partial<Record<string, string>> = {}) {
  const values: Record<string, string> = {
    'Setup token': TOKEN,
    'Your name': 'Marcus Hale',
    Email: 'marcus@example.com',
    Password: GOOD,
    'Confirm password': GOOD,
    ...overrides,
  } as Record<string, string>;
  for (const [label, value] of Object.entries(values)) type(label, value);
}

/** An install that is set up once POST /api/setup has been answered. */
export function installRoutes(extra: Record<string, MockRoute> = {}) {
  let done = false;
  let account: typeof SIGNED_IN_ME = SIGNED_IN_ME;
  return {
    ...needsSetup,
    '/api/setup/status': () => ({ status: 200, body: { needsSetup: !done } }),
    '/api/auth/me': () => (done ? { status: 200, body: account } : { status: 401, body: {} }),
    'POST /api/setup/check': { status: 204 },
    'POST /api/setup': (init: RequestInit) => {
      done = true;
      // The account comes back with the settings that were sent, as the real server does.
      const sent = JSON.parse(String(init.body)) as { settings?: { colorScheme?: string } };
      account = { ...SIGNED_IN_ME, user: { ...SIGNED_IN_ME.user, ...sent.settings } } as typeof SIGNED_IN_ME;
      return { status: 201, body: account };
    },
    '/api/tree/*': { status: 404, body: { error: 'person_not_found' } },
    '/api/people/*': { status: 404, body: { error: 'person_not_found' } },
    ...extra,
  } satisfies Record<string, MockRoute>;
}

export async function openSetup(extra: Record<string, MockRoute> = {}) {
  const fetchMock = mockApi(installRoutes(extra));
  renderApp('/setup');
  await screen.findByRole('heading', { name: 'Welcome to KinShip' });
  return fetchMock;
}

/** Steps 1 and 2 done: on the "You" step. */
export async function toYou(extra: Record<string, MockRoute> = {}) {
  const fetchMock = await openSetup(extra);
  fillAccount();
  next();
  await screen.findByRole('heading', { name: 'Name your first tree' });
  next();
  await screen.findByRole('heading', { name: 'Start with you' });
  return fetchMock;
}

export const skip = () => fireEvent.click(screen.getByRole('button', { name: 'Skip this step' }));

/** From You, skip Partner, Parents and Children to Review. */
export async function skipToReview() {
  next();
  await screen.findByRole('heading', { name: 'Add your spouse or partner' });
  skip();
  await screen.findByRole('heading', { name: 'Add your parents' });
  skip();
  await screen.findByRole('heading', { name: 'Add your children' });
  skip();
  await screen.findByRole('heading', { name: 'Check your tree' });
}

export async function toReview(extra: Record<string, MockRoute> = {}) {
  const fetchMock = await toYou(extra);
  await skipToReview();
  return fetchMock;
}
export const create = () => fireEvent.click(screen.getByRole('button', { name: 'Create my tree' }));
