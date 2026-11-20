// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 2,000 people: the tree call and the name search stay fast. The family is generated (fictional
// names like "Given17 Surname4"); generations of couples, three children each.
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, insertUser, login, cookieHeader, CSRF } from './helpers/app.js';
import { countPeople } from '../src/people/store.js';
import { withUserTransaction } from '../src/request-context.js';
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

  it('counts everyone the viewer may see for the chart counter ("N of M people") at about two thousand, cheaply', async () => {
    const body = (await get(`/api/tree/${focal}?up=3&down=2&collateral=true`)).json() as { totalPeople: number };
    expect(body.totalPeople).toBe(total);
    // The count alone, as the viewer (row-level security applies), median of nine.
    const user = (await sql<{ id: string }>`select id from users where email = 'admin@example.com'`.execute(t.owner))
      .rows[0]!.id;
    const times: number[] = [];
    for (let i = 0; i < 9; i++) {
      const started = performance.now();
      const n = await withUserTransaction(t.db, user, async (trx) => {
        return countPeople(trx);
      });
      times.push(performance.now() - started);
      expect(n).toBe(total);
    }
    times.sort((a, b) => a - b);
    console.log(
      `count of ${total} people under row-level security: median ${times[4]!.toFixed(2)} ms (a whole transaction)`,
    );
    expect(times[4]!).toBeLessThan(50);
  });

  it("answers a person's profile data quickly and small (the profile asks for it on every page)", async () => {
    // A person in the middle of the family, and the oldest couple's first child (many relatives around them).
    for (const [name, id] of [
      ['a third-generation person', focal],
      ['the oldest person', root],
    ] as const) {
      const times: number[] = [];
      let bytes = 0;
      for (let i = 0; i < 7; i++) {
        const started = performance.now();
        const response = await get(`/api/people/${id}`);
        times.push(performance.now() - started);
        expect(response.statusCode).toBe(200);
        bytes = response.body.length;
      }
      times.sort((a, b) => a - b);
      const median = Math.round(times[Math.floor(times.length / 2)]!);
      console.log(
        `GET /api/people/:id for ${name}: ${bytes} bytes, median ${median} ms (best ${Math.round(times[0]!)} ms)`,
      );
      expect(median).toBeLessThan(250);
      expect(bytes).toBeLessThan(40_000);
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

  it('answers a profile with many partners and many partner children without a request per relative', async () => {
    // Six partners in a row, each with five children from other relationships (some alone, some with someone else).
    const person = await sql<{
      id: string;
    }>`insert into people (given_name, surname) values ('Many', 'Partners') returning id`.execute(t.owner);
    const me = person.rows[0]!.id;
    let made = 0;
    for (let p = 0; p < 6; p++) {
      const partner = (
        await sql<{
          id: string;
        }>`insert into people (given_name, surname) values (${'Partner' + p}, 'Step') returning id`.execute(t.owner)
      ).rows[0]!.id;
      const [lo, hi] = me < partner ? [me, partner] : [partner, me];
      await sql`insert into unions (partner_a_id, partner_b_id, status) values (${lo}, ${hi}, ${p % 2 ? 'widowed' : 'married'})`.execute(
        t.owner,
      );
      const other = (
        await sql<{
          id: string;
        }>`insert into people (given_name, surname) values (${'Other' + p}, 'Step') returning id`.execute(t.owner)
      ).rows[0]!.id;
      const [olo, ohi] = partner < other ? [partner, other] : [other, partner];
      const apart = (
        await sql<{
          id: string;
        }>`insert into unions (partner_a_id, partner_b_id, status) values (${olo}, ${ohi}, 'divorced') returning id`.execute(
          t.owner,
        )
      ).rows[0]!.id;
      for (let k = 0; k < 5; k++) {
        const child = (
          await sql<{
            id: string;
          }>`insert into people (given_name, surname) values (${'Kid' + p + '_' + k}, 'Step') returning id`.execute(
            t.owner,
          )
        ).rows[0]!.id;
        if (k % 2)
          await sql`insert into person_parents (child_id, union_id) values (${child}, ${apart})`.execute(t.owner);
        else await sql`insert into person_parents (child_id, parent_id) values (${child}, ${partner})`.execute(t.owner);
        made += 1;
      }
    }
    const times: number[] = [];
    let bytes = 0;
    let body: { partnerChildren: unknown[] } = { partnerChildren: [] };
    for (let i = 0; i < 7; i++) {
      const started = performance.now();
      const response = await get(`/api/people/${me}`);
      times.push(performance.now() - started);
      expect(response.statusCode).toBe(200);
      bytes = response.body.length;
      body = response.json() as { partnerChildren: unknown[] };
    }
    times.sort((a, b) => a - b);
    const median = Math.round(times[3]!);
    console.log(
      `GET /api/people/:id for 6 partners with ${made} partner children: ${bytes} bytes, median ${median} ms`,
    );
    expect(body.partnerChildren).toHaveLength(made);
    expect(median).toBeLessThan(250);
  });
});

describe('ancestorCount at scale', () => {
  it('stays cheap when many drawn in-laws each have a deep ancestry', async () => {
    // Give 60 in-laws (partners with no parents) a full five-generation pedigree of their own: 60 x 62 ancestors.
    const inLaws = await sql<{ id: string }>`
      select p.id from people p
       where not exists (select 1 from person_parents pp where pp.child_id = p.id)
         and exists (select 1 from unions u where u.partner_a_id = p.id or u.partner_b_id = p.id)
         and p.given_name !~ '^Given([1-9]|1[0-6])$'
       order by p.id limit 60`.execute(t.owner);
    let extra = 0;
    const makePerson = async (): Promise<string> => {
      extra += 1;
      const r = await sql<{ id: string }>`
        insert into people (given_name, surname) values (${'Anc' + extra}, ${'Deep' + (extra % 40)}) returning id`.execute(
        t.owner,
      );
      return r.rows[0]!.id;
    };
    const pedigree = async (child: string, depth: number): Promise<void> => {
      if (depth === 0) return;
      const a = await makePerson();
      const b = await makePerson();
      const [lo, hi] = a < b ? [a, b] : [b, a];
      const u = await sql<{ id: string }>`
        insert into unions (partner_a_id, partner_b_id, status) values (${lo}, ${hi}, 'married') returning id`.execute(
        t.owner,
      );
      await sql`insert into person_parents (child_id, union_id) values (${child}, ${u.rows[0]!.id})`.execute(t.owner);
      await pedigree(a, depth - 1);
      await pedigree(b, depth - 1);
    };
    for (const row of inLaws.rows) await pedigree(row.id, 5);

    // One apex couple above the eight oldest couples, so a single response holds the whole family.
    const apexA = await makePerson();
    const apexB = await makePerson();
    const [lo, hi] = apexA < apexB ? [apexA, apexB] : [apexB, apexA];
    const apex = await sql<{ id: string }>`
      insert into unions (partner_a_id, partner_b_id, status) values (${lo}, ${hi}, 'married') returning id`.execute(
      t.owner,
    );
    // The eight oldest couples are Given1+Given2, Given3+Given4 and so on.
    const oldest = await sql<{ id: string }>`
      select id from people where given_name in ('Given1','Given3','Given5','Given7','Given9','Given11','Given13','Given15')`.execute(
      t.owner,
    );
    for (const row of oldest.rows) {
      await sql`insert into person_parents (child_id, union_id) values (${row.id}, ${apex.rows[0]!.id})`.execute(
        t.owner,
      );
    }

    const started = performance.now();
    const response = await get(`/api/tree/${apexA}?up=0&down=10`);
    const ms = performance.now() - started;
    const body = response.json() as { people: Array<{ ancestorCount?: number }> };
    const leaves = body.people.filter((p) => p.ancestorCount !== undefined);
    console.log(
      `ancestorCount: ${body.people.length} people, ${leaves.length} leaves of ${leaves[0]?.ancestorCount ?? 0} ancestors each, whole response ${Math.round(ms)} ms`,
    );
    expect(leaves.length).toBeGreaterThanOrEqual(inLaws.rows.length);
    expect(leaves.every((p) => p.ancestorCount === 62)).toBe(true);
    expect(ms).toBeLessThan(1500);

    const ids = leaves.map((_, i) => inLaws.rows[i]?.id).filter(Boolean) as string[];
    // The same query the route runs, with JIT off as the route does.
    const plan = await t.owner.transaction().execute(async (trx) => {
      await sql`set local jit = off`.execute(trx);
      return sql<{ 'QUERY PLAN': string }>`
        explain analyze
        with recursive anc(origin, id) as (
          select o.id, x.pid from unnest(${ids}::uuid[]) as o(id), lateral public.kinship_parent_ids_in(o.id, 'adoptive') as x(pid)
          union
          select a.origin, x.pid from anc a, lateral public.kinship_parent_ids_in(a.id, 'adoptive') as x(pid)
        ) select origin, count(*) from anc group by origin`.execute(trx);
    });
    const time = /Execution Time: ([0-9.]+) ms/.exec(plan.rows.map((r) => r['QUERY PLAN']).join('\n'))?.[1];
    console.log(`ancestorCount query alone, ${ids.length} leaves: ${time} ms`);
    expect(Number(time)).toBeLessThan(1000);
    // The all-kinds walk (what the cycle check and "my line" use) over the same people, for comparison.
    const allKinds = await t.owner.transaction().execute(async (trx) => {
      await sql`set local jit = off`.execute(trx);
      return sql<{ 'QUERY PLAN': string }>`
        explain analyze
        with recursive anc(origin, id) as (
          select o.id, x.pid from unnest(${ids}::uuid[]) as o(id), lateral public.kinship_parent_ids(o.id) as x(pid)
          union
          select a.origin, x.pid from anc a, lateral public.kinship_parent_ids(a.id) as x(pid)
        ) select origin, count(*) from anc group by origin`.execute(trx);
    });
    console.log(
      `all-kinds walk, same ${ids.length} people: ${/Execution Time: ([0-9.]+) ms/.exec(allKinds.rows.map((r) => r['QUERY PLAN']).join('\n'))?.[1]} ms`,
    );
  }, 120_000);
});
