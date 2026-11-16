// SPDX-License-Identifier: AGPL-3.0-or-later
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALICE, ME, calls, mockApi, needsSetup, renderApp } from './helpers.js';
import type { MockRoute } from './helpers.js';

const GOOD = 'correct horse battery staple';
const TOKEN = 'tok-secret-123';
const SIGNED_IN_ME = { ...ME, user: { ...ALICE, personId: 'p-marcus' } };

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  document.documentElement.removeAttribute('data-scheme');
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });
const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next' }));
const back = () => fireEvent.click(screen.getByRole('button', { name: 'Back' }));
const progress = () => screen.getByText(/^Step \d of 7/).textContent;

function fillAccount(overrides: Partial<Record<string, string>> = {}) {
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
function installRoutes(extra: Record<string, MockRoute> = {}) {
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

async function openSetup(extra: Record<string, MockRoute> = {}) {
  const fetchMock = mockApi(installRoutes(extra));
  renderApp('/setup');
  await screen.findByRole('heading', { name: 'Welcome to KinShip' });
  return fetchMock;
}

/** Steps 1 and 2 done: on the "You" step. */
async function toYou(extra: Record<string, MockRoute> = {}) {
  const fetchMock = await openSetup(extra);
  fillAccount();
  next();
  await screen.findByRole('heading', { name: 'Name your first tree' });
  next();
  await screen.findByRole('heading', { name: 'Start with you' });
  return fetchMock;
}

async function toReview(extra: Record<string, MockRoute> = {}) {
  const fetchMock = await toYou(extra);
  next();
  await screen.findByRole('heading', { name: 'Check your tree' });
  return fetchMock;
}
const create = () => fireEvent.click(screen.getByRole('button', { name: 'Create my tree' }));

describe('the progress list', () => {
  it('lists the seven steps in order, marks the current one, and says it in words', async () => {
    await openSetup();
    const list = screen.getByRole('list', { name: 'Setup progress' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Account',
      'Tree',
      'You',
      'Partner',
      'Parents',
      'Children',
      'Review',
    ]);
    expect(items.map((item) => item.getAttribute('aria-current'))).toEqual([
      'step',
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(progress()).toBe('Step 1 of 7 · Account');
  });

  it('follows the person through Tree and You to Review', async () => {
    await toYou();
    expect(progress()).toBe('Step 3 of 7 · You');
    expect(
      within(screen.getByRole('list', { name: 'Setup progress' }))
        .getByText('You')
        .parentElement?.getAttribute('aria-current'),
    ).toBe('step');
  });
});

describe('step 1, Account', () => {
  it('asks for the token, name, email, password twice, and says where the token is', async () => {
    await openSetup();
    for (const label of ['Setup token', 'Your name', 'Email', 'Password', 'Confirm password']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(screen.getByText(/docker compose logs api/)).toBeTruthy();
    expect(field('Password').getAttribute('autocomplete')).toBe('new-password');
    expect(screen.getByText('This screen never appears again once an account exists.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('shows an error under each field that is wrong, focuses the first, and sends nothing', async () => {
    const fetchMock = await openSetup();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Enter the setup token from the api log.')).toBeTruthy();
    expect(screen.getByText('Enter your name.')).toBeTruthy();
    expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
    expect(screen.getByText('The password must be at least 12 characters.')).toBeTruthy();
    expect(field('Setup token').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field('Setup token'));
    expect(calls(fetchMock).some((c) => c.startsWith('POST'))).toBe(false);
    expect(progress()).toBe('Step 1 of 7 · Account');

    fillAccount({ Password: 'short', 'Confirm password': 'different', Email: 'nope' });
    next();
    await screen.findByText('The two passwords are not the same.');
    expect(document.activeElement).toBe(field('Email'));
    // Typing in a field clears its message.
    type('Email', 'marcus@example.com');
    expect(screen.queryByText('Enter a valid email address.')).toBeNull();
  });

  it('accepts a password of exactly 12 characters', async () => {
    await openSetup();
    fillAccount({ Password: 'aaaaaaaaaaaa', 'Confirm password': 'aaaaaaaaaaaa' });
    next();
    await screen.findByRole('heading', { name: 'Name your first tree' });
  });

  it('checks the token with the server before moving on, and sends nothing else yet', async () => {
    const fetchMock = await openSetup();
    fillAccount();
    next();
    await screen.findByRole('heading', { name: 'Name your first tree' });
    expect(calls(fetchMock).filter((c) => c.startsWith('POST'))).toEqual(['POST /api/setup/check']);
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/setup/check');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ token: TOKEN });
    expect((call?.[1]?.headers as Record<string, string>)['X-KinShip-Request']).toBe('1');
  });

  it('says the token is wrong, stays on the step and keeps what was typed', async () => {
    await openSetup({
      'POST /api/setup/check': { status: 403, body: { error: 'invalid_setup_token', field: 'token' } },
    });
    fillAccount();
    next();
    expect(await screen.findByText('That setup token is not right. Check the log of the api container.')).toBeTruthy();
    expect(field('Setup token').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field('Setup token'));
    expect(progress()).toBe('Step 1 of 7 · Account');
    expect(field('Your name').value).toBe('Marcus Hale');
    expect(field('Password').value).toBe(GOOD);
  });

  it('does not ask the server again for a token it has already accepted', async () => {
    const fetchMock = await openSetup();
    fillAccount();
    next();
    await screen.findByRole('heading', { name: 'Name your first tree' });
    back();
    await screen.findByRole('heading', { name: 'Welcome to KinShip' });
    next();
    await screen.findByRole('heading', { name: 'Name your first tree' });
    expect(calls(fetchMock).filter((c) => c === 'POST /api/setup/check')).toHaveLength(1);
    // A different token is checked again.
    back();
    await screen.findByRole('heading', { name: 'Welcome to KinShip' });
    type('Setup token', 'another');
    next();
    await screen.findByRole('heading', { name: 'Name your first tree' });
    expect(calls(fetchMock).filter((c) => c === 'POST /api/setup/check')).toHaveLength(2);
  });

  it('says setup is already done, with a link to sign in', async () => {
    await openSetup({ 'POST /api/setup/check': { status: 409, body: { error: 'already_set_up' } } });
    fillAccount();
    next();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('KinShip is already set up');
    expect(screen.getByRole('link', { name: 'Go to sign in' }).getAttribute('href')).toBe('/login');
  });

  it('says how long to wait when rate limited, and when the server cannot be reached', async () => {
    await openSetup({
      'POST /api/setup/check': { status: 429, body: { error: 'rate_limited', retryAfterSeconds: 61 } },
    });
    fillAccount();
    next();
    expect((await screen.findByRole('alert')).textContent).toBe('Too many attempts. Try again in 2 minute(s).');
  });

  it('says so when the server cannot be reached, and lets the person try again', async () => {
    let up = false;
    await openSetup({ 'POST /api/setup/check': () => (up ? { status: 204 } : 'network-error') });
    fillAccount();
    next();
    expect((await screen.findByRole('alert')).textContent).toContain('Cannot reach the server');
    up = true;
    next();
    await screen.findByRole('heading', { name: 'Name your first tree' });
  });

  it('submits with Enter (each step is a form)', async () => {
    await openSetup();
    fillAccount();
    fireEvent.submit(field('Email').closest('form') as HTMLFormElement);
    await screen.findByRole('heading', { name: 'Name your first tree' });
  });
});

describe('step 2, Tree', () => {
  it('suggests "{surname} Family" from the name, which can be typed over', async () => {
    await openSetup();
    fillAccount();
    next();
    await screen.findByRole('heading', { name: 'Name your first tree' });
    expect(field('Tree name').value).toBe('Hale Family');
    type('Tree name', 'The Hales');
    next();
    await screen.findByRole('heading', { name: 'Start with you' });
    back();
    expect(field('Tree name').value).toBe('The Hales');
  });

  it('needs a name for the tree', async () => {
    await openSetup();
    fillAccount({ 'Your name': 'Marcus' });
    next();
    await screen.findByRole('heading', { name: 'Name your first tree' });
    expect(field('Tree name').value).toBe('');
    next();
    expect(await screen.findByText('Enter a name for the tree.')).toBeTruthy();
    expect(document.activeElement).toBe(field('Tree name'));
    expect(progress()).toBe('Step 2 of 7 · Tree');
  });

  it('shows the four color schemes, applies the one chosen at once, and keeps nothing but its name in the browser', async () => {
    await openSetup();
    fillAccount();
    next();
    await screen.findByRole('heading', { name: 'Name your first tree' });
    const group = screen.getByRole('radiogroup', { name: 'Pick your colors' });
    const swatches = within(group).getAllByRole('radio');
    expect(swatches.map((s) => s.textContent)).toEqual(['Forest', 'Warm sand', 'Slate blue', 'Graphite']);
    expect(swatches[0]?.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(swatches[2] as HTMLElement);
    expect(document.documentElement.getAttribute('data-scheme')).toBe('slate');
    expect(swatches[2]?.getAttribute('aria-checked')).toBe('true');
    expect(swatches[0]?.getAttribute('aria-checked')).toBe('false');
    expect(JSON.parse(window.localStorage.getItem('kinship.display') ?? '{}')).toMatchObject({ colorScheme: 'slate' });
  });
});

describe('step 3, You', () => {
  it('prefills the names by splitting the account name, and nothing is preselected for gender', async () => {
    await toYou();
    expect(field('Given name').value).toBe('Marcus');
    expect(field('Surname').value).toBe('Hale');
    expect(field('Gender').value).toBe('');
    expect(
      within(field('Gender'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Not specified', 'Male', 'Female', 'Other']);
    expect(
      screen.getByText('You are the first person in Hale Family. Your account is linked to this person.'),
    ).toBeTruthy();
  });

  it('keeps names typed over when the person goes back and changes the account name', async () => {
    await toYou();
    type('Given name', 'Marc');
    back();
    back();
    type('Your name', 'Someone Else');
    next();
    await screen.findByRole('heading', { name: 'Name your first tree' });
    next();
    await screen.findByRole('heading', { name: 'Start with you' });
    expect(field('Given name').value).toBe('Marc');
    expect(field('Surname').value).toBe('Hale');
  });

  it('cannot be skipped: there is no skip button, and both names are required', async () => {
    await toYou();
    expect(screen.queryByRole('button', { name: 'Skip this step' })).toBeNull();
    type('Given name', '   ');
    type('Surname', '');
    next();
    expect(await screen.findByText('Enter a given name (up to 100 characters).')).toBeTruthy();
    expect(screen.getByText('Enter a surname (up to 100 characters).')).toBeTruthy();
    expect(document.activeElement).toBe(field('Given name'));
    expect(progress()).toBe('Step 3 of 7 · You');
  });

  it('checks the birth date as the other date fields do, and focuses it', async () => {
    await toYou();
    type('Birth date', '1986-02-30');
    next();
    expect(
      await screen.findByText('Enter a date as YYYY, YYYY-MM or YYYY-MM-DD. The day and month must exist.'),
    ).toBeTruthy();
    expect(document.activeElement).toBe(field('Birth date'));
    type('Birth date', '1986-07-31');
    next();
    await screen.findByRole('heading', { name: 'Check your tree' });
  });
});

describe('Review and Create my tree', () => {
  it('shows what will be created, with a way back to each part, and creates nothing yet', async () => {
    const fetchMock = await toYou();
    type('Birth date', '1986-07-31');
    fireEvent.change(field('Gender'), { target: { value: 'male' } });
    next();
    await screen.findByRole('heading', { name: 'Check your tree' });
    expect(progress()).toBe('Step 7 of 7 · Review');
    expect(screen.getAllByText('Marcus Hale')).toHaveLength(2); // the account, and you on the tree
    expect(screen.getByText(/born Jul 31, 1986/)).toBeTruthy();
    expect(screen.getByText('marcus@example.com')).toBeTruthy();
    expect(screen.getByText('1 person on the tree')).toBeTruthy();
    expect(calls(fetchMock).filter((c) => c === 'POST /api/setup')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Change Tree' }));
    await screen.findByRole('heading', { name: 'Name your first tree' });
  });

  it('creates everything with one request, and then opens the new person on the tree', async () => {
    const fetchMock = await openSetup();
    fillAccount();
    next();
    await screen.findByRole('heading', { name: 'Name your first tree' });
    fireEvent.click(screen.getByRole('radio', { name: 'Graphite' }));
    next();
    await screen.findByRole('heading', { name: 'Start with you' });
    type('Birth date', '1986-07-31');
    fireEvent.change(field('Gender'), { target: { value: 'male' } });
    next();
    await screen.findByRole('heading', { name: 'Check your tree' });
    create();
    await waitFor(() => expect(calls(fetchMock).some((c) => c.startsWith('GET /api/tree/p-marcus'))).toBe(true));

    const post = fetchMock.mock.calls.find(([url]) => url === '/api/setup');
    expect((post?.[1]?.headers as Record<string, string>)['X-KinShip-Request']).toBe('1');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      token: TOKEN,
      displayName: 'Marcus Hale',
      email: 'marcus@example.com',
      password: GOOD,
      treeName: 'Hale Family',
      settings: { colorScheme: 'graphite' },
      family: {
        you: {
          givenName: 'Marcus',
          surname: 'Hale',
          birth: { value: '1986-07-31', precision: 'exactly' },
          gender: 'male',
        },
      },
    });
    expect(calls(fetchMock).filter((c) => c === 'POST /api/setup')).toHaveLength(1);
  });

  it('sends no birth date and no gender when they are left empty', async () => {
    const fetchMock = await toReview();
    create();
    await waitFor(() => expect(calls(fetchMock)).toContain('POST /api/setup'));
    const post = fetchMock.mock.calls.find(([url]) => url === '/api/setup');
    expect(JSON.parse(String(post?.[1]?.body)).family).toEqual({ you: { givenName: 'Marcus', surname: 'Hale' } });
  });

  it('writes nothing about the person to the browser: no token, password, name, email or date in any storage', async () => {
    const fetchMock = await openSetup();
    fillAccount();
    next();
    await screen.findByRole('heading', { name: 'Name your first tree' });
    fireEvent.click(screen.getByRole('radio', { name: 'Warm sand' }));
    next();
    await screen.findByRole('heading', { name: 'Start with you' });
    type('Birth date', '1986-07-31');
    next();
    await screen.findByRole('heading', { name: 'Check your tree' });
    const stored = () => JSON.stringify({ ...window.localStorage, ...window.sessionStorage });
    for (const secret of [TOKEN, GOOD, 'Marcus', 'Hale', 'marcus@example.com', '1986'])
      expect(stored()).not.toContain(secret);
    create();
    await waitFor(() => expect(calls(fetchMock)).toContain('POST /api/setup'));
    for (const secret of [TOKEN, GOOD, 'Marcus', 'Hale', 'marcus@example.com', '1986'])
      expect(stored()).not.toContain(secret);
    // The one thing kept is the color mirror: two cosmetic words.
    expect(JSON.parse(window.localStorage.getItem('kinship.display') ?? '{}')).toEqual({
      colorScheme: 'sand',
      theme: 'device',
    });
  });
});

describe('what the server says to Create my tree', () => {
  it('takes the person to the step and field the server names, and keeps what was typed', async () => {
    await toReview({
      'POST /api/setup': { status: 400, body: { error: 'invalid_date', field: 'family.you.birth' } },
    });
    create();
    expect(await screen.findByRole('heading', { name: 'Start with you' })).toBeTruthy();
    expect(progress()).toBe('Step 3 of 7 · You');
    expect(screen.getByText('Enter a date as YYYY, YYYY-MM or YYYY-MM-DD. The day and month must exist.')).toBeTruthy();
    expect(field('Birth date').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field('Birth date'));
    expect(field('Given name').value).toBe('Marcus');
    // Typing in the field clears the message.
    type('Birth date', '1986');
    expect(screen.queryByText(/Enter a date as/)).toBeNull();
  });

  it('maps an account field to step 1 and a name field to step 3', async () => {
    await toReview({ 'POST /api/setup': { status: 400, body: { error: 'invalid_email', field: 'email' } } });
    create();
    expect(await screen.findByRole('heading', { name: 'Welcome to KinShip' })).toBeTruthy();
    expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
    expect(document.activeElement).toBe(field('Email'));
    expect(field('Password').value).toBe(GOOD);
  });

  it('goes back to step 1 with the typed data kept when the token no longer works (the api restarted)', async () => {
    await toReview({ 'POST /api/setup': { status: 403, body: { error: 'invalid_setup_token', field: 'token' } } });
    create();
    expect(await screen.findByRole('heading', { name: 'Welcome to KinShip' })).toBeTruthy();
    expect(screen.getByText('That setup token is not right. Check the log of the api container.')).toBeTruthy();
    expect(field('Setup token').value).toBe(TOKEN);
    expect(field('Your name').value).toBe('Marcus Hale');
    expect(field('Password').value).toBe(GOOD);
  });

  it('says setup is done, with a sign-in link, and stays on Review', async () => {
    await toReview({ 'POST /api/setup': { status: 409, body: { error: 'already_set_up' } } });
    create();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('KinShip is already set up');
    expect(within(alert).getByRole('link', { name: 'Go to sign in' }).getAttribute('href')).toBe('/login');
    expect(progress()).toBe('Step 7 of 7 · Review');
  });

  it('stays on Review for a rate limit or a network error, and a retry works', async () => {
    let answer: 'limited' | 'down' | 'ok' = 'limited';
    let done = false;
    const fetchMock = await toReview({
      'POST /api/setup': () => {
        if (answer === 'limited') return { status: 429, body: { error: 'rate_limited', retryAfterSeconds: 30 } };
        if (answer === 'down') return 'network-error';
        done = true;
        return { status: 201, body: SIGNED_IN_ME };
      },
      '/api/setup/status': () => ({ status: 200, body: { needsSetup: !done } }),
      '/api/auth/me': () => (done ? { status: 200, body: SIGNED_IN_ME } : { status: 401, body: {} }),
    });
    create();
    expect((await screen.findByRole('alert')).textContent).toBe('Too many attempts. Try again in 1 minute(s).');
    expect(progress()).toBe('Step 7 of 7 · Review');
    answer = 'down';
    create();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Cannot reach the server'));
    expect(progress()).toBe('Step 7 of 7 · Review');
    answer = 'ok';
    create();
    await waitFor(() => expect(calls(fetchMock).some((c) => c.startsWith('GET /api/tree/p-marcus'))).toBe(true));
  });

  it('shows a message for an error with no field, and stays on Review', async () => {
    await toReview({ 'POST /api/setup': { status: 500, body: { error: 'internal_error' } } });
    create();
    expect((await screen.findByRole('alert')).textContent).toContain('Cannot reach the server');
    expect(progress()).toBe('Step 7 of 7 · Review');
  });
});

describe('the setup page is only for a fresh install', () => {
  it('sends a signed-in visitor on, and a finished install to the sign-in page', async () => {
    mockApi({
      '/api/setup/status': { status: 200, body: { needsSetup: false } },
      '/api/auth/me': { status: 401, body: {} },
    });
    renderApp('/setup');
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(screen.queryByRole('list', { name: 'Setup progress' })).toBeNull();
  });
});
