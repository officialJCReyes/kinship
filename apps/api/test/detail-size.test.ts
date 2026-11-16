// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How big and how slow GET /api/people/:id is on the small test family (the fictional Hale family). It prints
// the numbers so a change that makes the profile heavier shows up in the log, and fails only on a big regression.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';
import { buildFamily, signInAll } from './helpers/family.js';
import type { Family } from './helpers/family.js';

let t: TestApp;
let f: Family;
let as: Awaited<ReturnType<typeof signInAll>>;

beforeAll(async () => {
  t = await createTestApp();
  f = await buildFamily(t.owner);
  as = await signInAll(t.app, f);
});
afterAll(() => t.close());

describe('GET /api/people/:id on the Hale family', () => {
  it('stays small and fast for every person', async () => {
    let bytes = 0;
    let count = 0;
    const times: number[] = [];
    for (const id of Object.values(f.person)) {
      await as('familyadmin', 'GET', `/api/people/${id}`); // warm up the connection and plans
    }
    for (let round = 0; round < 5; round++) {
      for (const id of Object.values(f.person)) {
        const started = performance.now();
        const response = await t.app.inject({
          method: 'GET',
          url: `/api/people/${id}`,
          headers: { 'x-kinship-request': '1', cookie: await cookieOf() },
        });
        times.push(performance.now() - started);
        expect(response.statusCode).toBe(200);
        if (round === 0) {
          bytes += response.body.length;
          count += 1;
        }
      }
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)]!;
    console.log(
      `Hale family: GET /api/people/:id for ${count} people: ${bytes} bytes in all (${Math.round(bytes / count)} each), median ${median.toFixed(1)} ms`,
    );
    expect(median).toBeLessThan(100);
    expect(bytes / count).toBeLessThan(8_000);
  });
});

let cached = '';
async function cookieOf(): Promise<string> {
  if (cached) return cached;
  const { cookieHeader, login } = await import('./helpers/app.js');
  cached = cookieHeader(await login(t.app, f.account.familyadmin.email));
  return cached;
}
