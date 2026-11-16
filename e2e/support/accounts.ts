// SPDX-License-Identifier: AGPL-3.0-or-later
// Makes a Member, a User or a Family Admin the way the product does: an admin invites them and the invitee accepts the link.
// No SQL, no command line. The accepted link signs the new account in, and its session cookie is handed back, so a test
// that needs the account does not even have to sign in (the sign-in route is limited to 30 requests a minute).
import type { APIRequestContext } from '@playwright/test';
import { expect, request } from '@playwright/test';
import { password } from './data.js';
import { BASE_URL } from './stack.js';

const HEADERS = { 'X-KinShip-Request': '1', Origin: BASE_URL };

type Cookies = Parameters<import('@playwright/test').BrowserContext['addCookies']>[0];

export interface Account {
  id: string;
  email: string;
  displayName: string;
  /** The new account's session cookies: add them to a browser context to be signed in as this account. */
  cookies: Cookies;
}

export async function createAccount(
  admin: APIRequestContext,
  input: {
    email: string;
    role: 'familyadmin' | 'member' | 'user';
    /** The name to give. Ignored when a person is linked (the account then takes the person's name). */
    displayName: string;
    personId?: string;
  },
): Promise<Account> {
  const invited = await admin.post('/api/admin/invitations', {
    headers: HEADERS,
    data: { email: input.email, role: input.role, ...(input.personId ? { personId: input.personId } : {}) },
  });
  expect(invited.status(), 'invite through the API').toBe(201);
  const { token } = (await invited.json()) as { token: string };

  // A browser that has never been signed in, the way the invitee opens it.
  const guest = await request.newContext({ baseURL: BASE_URL });
  try {
    const accepted = await guest.post('/api/links/accept', {
      headers: HEADERS,
      data: { token, password: password(), ...(input.personId ? {} : { displayName: input.displayName }) },
    });
    expect(accepted.status(), 'accept the invitation through the API').toBe(201);
    const me = (await accepted.json()) as { user: { id: string; displayName: string } };
    return {
      id: me.user.id,
      email: input.email,
      displayName: me.user.displayName,
      cookies: (await guest.storageState()).cookies,
    };
  } finally {
    await guest.dispose();
  }
}
