// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Placeholder people (migration 0015, ADR 0019): "Unknown father" and "Unknown mother" created when a brother or
// sister is added to someone with no parents; never counted, listed or searched; naming one makes an ordinary person.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';
import { buildFamily, insertPersonRow, insertUnionRow, linkChild } from './helpers/family.js';
import type { Family, Json } from './helpers/family.js';
import { signInAll } from './helpers/family.js';

let t: TestApp;
let f: Family;
let send: Awaited<ReturnType<typeof signInAll>>;
const as = async (...args: Parameters<typeof send>) => {
  const response = await send(...args);
  return { status: response.status, body: (response.body ?? {}) as Json };
};

beforeAll(async () => {
  t = await createTestApp();
  f = await buildFamily(t.owner);
  send = await signInAll(t.app, f);
}, 60_000);
afterAll(() => t.close());

const sibling = (given: string, extra: Json = {}) => ({ sibling: { givenName: given, surname: 'Hale', ...extra } });
const placeholdersOf = async () =>
  (
    await sql<{
      id: string;
      gender: string;
    }>`select id, gender from people where is_placeholder order by gender`.execute(t.owner)
  ).rows;

describe('adding a brother or sister to someone with no parents', () => {
  it('creates two placeholder parents and an Unknown relationship, and links both children, in one call', async () => {
    const lone = await insertPersonRow(t.owner, 'Walter', 'Hale', { gender: 'male', birth: '1960' });
    const before = await placeholdersOf();
    const res = await as('superadmin', 'POST', `/api/people/${lone}/siblings`, sibling('Samuel', { gender: 'male' }));
    expect(res.status).toBe(201);
    expect(res.body.placeholders).toHaveLength(2);
    expect(res.body.placeholders.map((x: Json) => [x.gender, x.isPlaceholder, x.givenName, x.surname]).sort()).toEqual([
      ['female', true, '', ''],
      ['male', true, '', ''],
    ]);
    expect((await placeholdersOf()).length - before.length).toBe(2);

    const a = await as('superadmin', 'GET', `/api/people/${lone}`);
    const b = await as('superadmin', 'GET', `/api/people/${res.body.person.id}`);
    expect(a.body.parents.birth.unionId).toBeTruthy();
    expect(a.body.parents.birth.unionId).toBe(b.body.parents.birth.unionId);
    const union = await as('superadmin', 'GET', `/api/unions/${a.body.parents.birth.unionId}`);
    expect(union.body.union.status).toBe('unknown');
    expect(union.body.union.children.map((c: Json) => c.id).sort()).toEqual([lone, res.body.person.id].sort());
  });

  it('a second sibling reuses the pair and adds no placeholder', async () => {
    const lone = await insertPersonRow(t.owner, 'Ruth', 'Hale', { gender: 'female' });
    await as('superadmin', 'POST', `/api/people/${lone}/siblings`, sibling('Peter'));
    const after1 = (await placeholdersOf()).length;
    const second = await as('superadmin', 'POST', `/api/people/${lone}/siblings`, sibling('Anna'));
    expect(second.status).toBe(201);
    expect(second.body.placeholders).toEqual([]);
    expect((await placeholdersOf()).length).toBe(after1);
  });

  it('with one parent, reuses that parent and adds no placeholder', async () => {
    const parent = await insertPersonRow(t.owner, 'Paul', 'Hale', { gender: 'male', birth: '1930' });
    const child = await insertPersonRow(t.owner, 'Elise', 'Hale', { gender: 'female', birth: '1960' });
    await linkChild(t.owner, child, { parent });
    const before = (await placeholdersOf()).length;
    const res = await as('superadmin', 'POST', `/api/people/${child}/siblings`, sibling('Leo'));
    expect(res.status).toBe(201);
    expect(res.body.placeholders).toEqual([]);
    expect(res.body.parentage).toMatchObject({ parentId: parent, unionId: null, kind: 'birth' });
    expect((await placeholdersOf()).length).toBe(before);
  });

  it('adds nothing when it fails: a bad sibling leaves no placeholder and no person behind', async () => {
    const lone = await insertPersonRow(t.owner, 'Carla', 'Hale', {});
    const people = Number((await sql<{ n: string }>`select count(*) as n from people`.execute(t.owner)).rows[0]?.n);
    const bad = await as('superadmin', 'POST', `/api/people/${lone}/siblings`, {
      sibling: { givenName: ' ', surname: 'Hale' },
    });
    expect(bad.status).toBe(400);
    expect(Number((await sql<{ n: string }>`select count(*) as n from people`.execute(t.owner)).rows[0]?.n)).toBe(
      people,
    );
  });

  it('an adoptive sibling needs an adoptive set; a Member, a User and anyone signed out are refused', async () => {
    const lone = await insertPersonRow(t.owner, 'Daniel', 'Hale', {});
    const adoptive = await as('superadmin', 'POST', `/api/people/${lone}/siblings`, {
      ...sibling('Gabriel'),
      kind: 'adoptive',
    });
    expect(adoptive.status).toBe(400);
    expect(adoptive.body.error).toBe('sibling_needs_parent');
    const before = (await placeholdersOf()).length;
    for (const who of ['member', 'user', 'unlinked'] as const) {
      expect((await as(who, 'POST', `/api/people/${lone}/siblings`, sibling('Nope'))).status).toBe(403);
    }
    expect((await as('anonymous', 'POST', `/api/people/${lone}/siblings`, sibling('Nope'))).status).toBe(401);
    expect((await placeholdersOf()).length).toBe(before);
  });

  it('a Member who is the person is refused too (descendants only, as before)', async () => {
    const res = await as('member', 'POST', `/api/people/${f.person.marcus}/siblings`, sibling('Nope'));
    expect(res.status).toBe(403);
  });
});

describe('placeholders are not people for lists, search and counts', () => {
  it('are not in the people list or search, but are in the tree', async () => {
    const lone = await insertPersonRow(t.owner, 'Tomas', 'Hale', {});
    const made = await as('superadmin', 'POST', `/api/people/${lone}/siblings`, sibling('Sofia'));
    const list = await as('superadmin', 'GET', '/api/people?limit=200');
    const ids = (list.body.items as Json[]).map((x) => x.id);
    for (const ph of made.body.placeholders as Json[]) expect(ids).not.toContain(ph.id);
    expect(ids).toContain(lone);
    expect(
      (await as('superadmin', 'GET', '/api/people?q=%20&limit=200')).body.items.some((x: Json) => x.isPlaceholder),
    ).toBe(false);
    const tree = await as('superadmin', 'GET', `/api/tree/${lone}?up=2&down=1&collateral=true`);
    const drawn = (tree.body.people as Json[]).filter((x) => x.isPlaceholder).map((x) => x.id);
    expect(drawn.sort()).toEqual((made.body.placeholders as Json[]).map((x) => x.id).sort());
  });

  it('are not counted as ancestors on a leaf', async () => {
    // Raj's father Hari is real and his mother is an Unknown placeholder; Raj's son is Arjun. From Arjun, one step up
    // draws Raj, and Raj's own parents sit behind a leaf that counts Hari only.
    const arjun = await insertPersonRow(t.owner, 'Arjun', 'Nair', {});
    const raj = await insertPersonRow(t.owner, 'Raj', 'Nair', {});
    const hari = await insertPersonRow(t.owner, 'Hari', 'Nair', { gender: 'male' });
    const unknown = (
      await sql<{
        id: string;
      }>`insert into people (given_name, surname, gender, is_placeholder) values ('', '', 'female', true) returning id`.execute(
        t.owner,
      )
    ).rows[0]!.id;
    const union = await insertUnionRow(t.owner, hari, unknown, 'unknown', {});
    await linkChild(t.owner, raj, { union });
    await linkChild(t.owner, arjun, { parent: raj });
    const tree = await as('superadmin', 'GET', `/api/tree/${arjun}?up=1&down=0&collateral=false`);
    const node = (tree.body.people as Json[]).find((x) => x.id === raj) as Json;
    expect(node.ancestorCount).toBe(1);
  });
});

describe('naming a placeholder, and deleting the last child', () => {
  it('a name makes an ordinary person (the flag is cleared); a patch with no name is refused', async () => {
    const lone = await insertPersonRow(t.owner, 'Marcus', 'Hale', {});
    const made = await as('superadmin', 'POST', `/api/people/${lone}/siblings`, sibling('Priya'));
    const father = (made.body.placeholders as Json[]).find((x) => x.gender === 'male') as Json;
    const noName = await as('superadmin', 'PATCH', `/api/people/${father.id}`, { birth: { value: '1930' } });
    expect(noName.status).toBe(400);
    expect(noName.body.error).toBe('placeholder_needs_name');
    const named = await as('superadmin', 'PATCH', `/api/people/${father.id}`, { givenName: 'Joseph', surname: 'Hale' });
    expect(named.status).toBe(200);
    expect(named.body.person).toMatchObject({ givenName: 'Joseph', isPlaceholder: false, gender: 'male' });
    const list = await as('superadmin', 'GET', '/api/people?q=joseph&limit=50');
    expect((list.body.items as Json[]).map((x) => x.id)).toContain(father.id);
    // A Member cannot edit one (admin-edited only).
    const mother = (made.body.placeholders as Json[]).find((x) => x.gender === 'female') as Json;
    expect(
      (await as('member', 'PATCH', `/api/people/${mother.id}`, { givenName: 'Anna', surname: 'Hale' })).status,
    ).toBe(403);
  });

  it('the database refuses a placeholder with a name or a date, and a real person with no name', async () => {
    const bad = (q: ReturnType<typeof sql>) =>
      q.execute(t.owner).then(
        () => 'ok',
        (e: Error) => e.message,
      );
    expect(
      await bad(sql`insert into people (given_name, surname, gender, is_placeholder) values ('A', '', 'male', true)`),
    ).toMatch(/placeholder_is_blank/);
    expect(
      await bad(
        sql`insert into people (given_name, surname, gender, is_placeholder, birth_date) values ('', '', 'male', true, '1900')`,
      ),
    ).toMatch(/placeholder_is_blank/);
    expect(await bad(sql`insert into people (given_name, surname) values ('', '')`)).toMatch(/given_name_check/);
  });

  it('deleting the last child removes the Unknown pair; deleting one of two keeps it', async () => {
    const lone = await insertPersonRow(t.owner, 'Elena', 'Hale', {});
    const one = await as('superadmin', 'POST', `/api/people/${lone}/siblings`, sibling('Naomi'));
    const ids = (one.body.placeholders as Json[]).map((x) => x.id as string);
    const left = async () =>
      Number(
        (await sql<{ n: string }>`select count(*) as n from people where id = any(${ids}::uuid[])`.execute(t.owner))
          .rows[0]?.n,
      );
    expect(await left()).toBe(2);
    expect((await as('superadmin', 'DELETE', `/api/people/${one.body.person.id}?confirm=true`)).status).toBe(204);
    expect(await left()).toBe(2); // Elena still hangs from them
    expect((await as('superadmin', 'DELETE', `/api/people/${lone}?confirm=true`)).status).toBe(204);
    expect(await left()).toBe(0);
    expect(
      Number(
        (
          await sql<{
            n: string;
          }>`select count(*) as n from unions u where not exists (select 1 from people p where p.id = u.partner_a_id)`.execute(
            t.owner,
          )
        ).rows[0]?.n,
      ),
    ).toBe(0);
  });
});

describe('every read of people says what it does about placeholders', () => {
  it('a direct read of the people table is marked "placeholders: included" or filters them', () => {
    const src = join(import.meta.dirname, '..', 'src');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (entry.name !== 'migrations') walk(join(dir, entry.name));
        } else if (entry.name.endsWith('.ts')) files.push(join(dir, entry.name));
      }
    };
    walk(src);
    const read = /selectFrom\('people'\)|\b(from|join)\s+(public\.)?people\b/i;
    const unmarked: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!read.test(line) || /^\s*(\/\/|\*|--)/.test(line)) return;
        const near = lines.slice(Math.max(0, i - 9), i + 4).join('\n');
        if (!/placeholders: included|is_placeholder/.test(near))
          unmarked.push(`${file.replace(src, 'src')}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(unmarked).toEqual([]);
  });
});
