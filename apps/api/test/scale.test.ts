// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 2,000 people: the tree call and the name search stay fast. The family is generated (fictional
// names like "Given17 Surname4"); generations of couples, three children each.
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, insertUser, login, cookieHeader, CSRF } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';

let t: TestApp;
let cookie: string;
let total = 0;
let focal = '';
let root = '';

beforeAll(async () => {
  t = await createTestApp();
  await insertUser(t.owner, { email: 'admin@example.com', role: 'superadmin' });
  cookie = cookieHeader(await login(t.app, 'admin@example.com'));

  let couples: Array<[string, string]> = [];
  let counter = 0;
  const addPerson = async (): Promise<string> => {
    counter += 1;
    const r = await sql<{ id: string }>`
      insert into people (given_name, surname, birth_date)
      values (${'Given' + counter}, ${'Surname' + (counter % 40)}, ${String(1800 + Math.floor(counter / 10))}) returning id`.execute(
      t.owner,
    );
    return r.rows[0]!.id;
  };
  for (let i = 0; i < 8; i++) couples.push([await addPerson(), await addPerson()]);
  const generations: Array<Array<[string, string]>> = [couples];
  while (counter < 1900) {
    const next: Array<[string, string]> = [];
    for (const [a, b] of couples) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      const u = await sql<{
        id: string;
      }>`insert into unions (partner_a_id, partner_b_id, status) values (${lo}, ${hi}, 'married') returning id`.execute(
        t.owner,
      );
      for (let k = 0; k < 3 && counter < 1900; k++) {
        const child = await addPerson();
        await sql`insert into person_parents (child_id, union_id) values (${child}, ${u.rows[0]!.id})`.execute(t.owner);
        next.push([child, await addPerson()]);
      }
    }
    couples = next;
    generations.push(next);
  }
  total = counter;
  // a person in the middle of the family: a child in the third generation
  focal = generations[2]![10]![0];
  root = generations[0]![0]![0];
}, 120_000);
afterAll(() => t.close());

const get = (url: string) => t.app.inject({ method: 'GET', url, headers: { ...CSRF, cookie } });

describe('about 2,000 people', () => {
  it('has built a family of about two thousand', () => {
    expect(total).toBeGreaterThan(1500);
  });

  it('draws the tree around a person quickly, in few queries, with everything it needs', async () => {
    for (const query of [
      'up=3&down=3&collateral=false',
      'up=4&down=3&collateral=true',
      'up=10&down=10&collateral=true',
    ]) {
      const started = performance.now();
      const response = await get(`/api/tree/${focal}?${query}`);
      const ms = performance.now() - started;
      expect(response.statusCode).toBe(200);
      const body = response.json() as { people: unknown[]; unions: unknown[]; parentage: Record<string, unknown> };
      console.log(`tree ${query}: ${body.people.length} people, ${body.unions.length} unions, ${Math.round(ms)} ms`);
      expect(ms).toBeLessThan(1500);
      expect(body.people.length).toBeGreaterThan(5);
    }
  });

  it('draws the whole family (every person, from the oldest couple down) quickly too', async () => {
    const started = performance.now();
    const response = await get(`/api/tree/${root}?up=0&down=10`);
    const ms = performance.now() - started;
    const body = response.json() as { people: unknown[]; unions: unknown[] };
    console.log(
      `whole family from the root: ${body.people.length} people, ${body.unions.length} unions, ${Math.round(ms)} ms`,
    );
    expect(response.statusCode).toBe(200);
    expect(body.people.length).toBeGreaterThan(100);
    expect(ms).toBeLessThan(1500);
  });

  it('searches names quickly without an index', async () => {
    const queries = ['given17', 'surname4 given1', 'zzz', 'giv'];
    for (const q of queries) {
      const started = performance.now();
      const response = await get(`/api/people?q=${encodeURIComponent(q)}&limit=50`);
      const ms = performance.now() - started;
      expect(response.statusCode).toBe(200);
      console.log(
        `search "${q}": ${(response.json() as { items: unknown[] }).items.length} results, ${Math.round(ms)} ms`,
      );
      expect(ms).toBeLessThan(500);
    }
    // the raw query, without the HTTP layer
    const plan = await sql<{ 'QUERY PLAN': string }>`
      explain analyze select id from people where search_name like '%given1%' and search_name like '%surname4%'`.execute(
      t.owner,
    );
    const text = plan.rows.map((r) => r['QUERY PLAN']).join('\n');
    console.log(
      text
        .split('\n')
        .filter((l) => /Seq Scan|Execution Time/.test(l))
        .join('\n'),
    );
    expect(Number(/Execution Time: ([0-9.]+) ms/.exec(text)?.[1])).toBeLessThan(50);
  });

  it('pages through everyone with a cursor', async () => {
    let cursor: string | null = null;
    let seen = 0;
    do {
      const response = await get(`/api/people?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      const page = response.json() as { items: unknown[]; nextCursor: string | null };
      seen += page.items.length;
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toBe(total);
  });
});
