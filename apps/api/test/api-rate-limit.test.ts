// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';
import { buildFamily, signInAll } from './helpers/family.js';

let t: TestApp;
let as: Awaited<ReturnType<typeof signInAll>>;

beforeAll(async () => {
  t = await createTestApp({ apiRequestsPerMinute: 5 });
  as = await signInAll(t.app, await buildFamily(t.owner));
});
afterAll(() => t.close());

describe('the cap on people, relationship and tree requests', () => {
  it('limits each signed-in account separately, and answers 429 with how long to wait', async () => {
    for (let i = 0; i < 5; i++) expect((await as('user', 'GET', '/api/people')).status).toBe(200);
    const refused = await as('user', 'GET', '/api/people');
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({ error: 'rate_limited', retryAfterSeconds: expect.any(Number) });
    // another account is not affected by it
    expect((await as('member', 'GET', '/api/people')).status).toBe(200);
  });

  it('does not count requests from nobody, who are refused first', async () => {
    for (let i = 0; i < 10; i++) expect((await as('anonymous', 'GET', '/api/people')).status).toBe(401);
  });
});
