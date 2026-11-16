// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Birth and adoptive parent links (ADR 0007): the rules, who may add them, what each viewer's chart follows,
// and the account setting that chooses it.
import { cp } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAppDb } from '../src/db.js';
import { ensureAppRole } from '../src/migrations/roles.js';
import { runMigrations } from '../src/migrations/runner.js';
import { withUserTransaction } from '../src/request-context.js';
import { createTestApp } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';
import { createTestDatabase } from './helpers/db.js';
import { buildFamily, insertPersonRow, insertUnionRow, linkChild, signInAll } from './helpers/family.js';
import type { Family, Json } from './helpers/family.js';
import { realMigrationsDir, removeMigrationsFrom, tempMigrationsDir } from './helpers/migrations-dir.js';

let t: TestApp;
let f: Family;
let as: Awaited<ReturnType<typeof signInAll>>;

// Samuel Hale (1936) was adopted in 1938 by Joseph and Anna Hale. His birth parents are Frank and Ruth Doyle, who
// kept their daughter Gina (1938). Joseph and Anna's own son is Peter (1940). Samuel has a son, Tim (1965).
const p: Record<string, string> = {};
const u: Record<string, string> = {};

beforeAll(async () => {
  t = await createTestApp();
  f = await buildFamily(t.owner);
  as = await signInAll(t.app, f);
  const make = async (key: string, given: string, surname: string, birth: string, gender: string) => {
    p[key] = await insertPersonRow(t.owner, given, surname, { gender, birth });
  };
  await make('samuel', 'Samuel', 'Hale', '1936', 'male');
  await make('joseph', 'Joseph', 'Hale', '1905', 'male');
  await make('anna', 'Anna', 'Hale', '1908', 'female');
  await make('peter', 'Peter', 'Hale', '1940', 'male');
  await make('frank', 'Frank', 'Doyle', '1910', 'male');
  await make('ruth', 'Ruth', 'Doyle', '1912', 'female');
  await make('gina', 'Gina', 'Doyle', '1938', 'female');
  await make('tim', 'Tim', 'Hale', '1965', 'male');
  u.hale = await insertUnionRow(t.owner, p.joseph!, p.anna!, 'married', { start: '1930' });
  u.doyle = await insertUnionRow(t.owner, p.frank!, p.ruth!, 'married', { start: '1932' });
  await linkChild(t.owner, p.samuel!, { union: u.doyle! }, 'birth');
  await linkChild(t.owner, p.samuel!, { union: u.hale! }, 'adoptive', '1938');
  await linkChild(t.owner, p.peter!, { union: u.hale! });
  await linkChild(t.owner, p.gina!, { union: u.doyle! });
  await linkChild(t.owner, p.tim!, { parent: p.samuel! });
}, 60_000);
afterAll(() => t.close());

const tree = async (who: 'user' | 'member' | 'familyadmin', focal: string, query = 'up=3&down=2&collateral=true') => {
  const response = await as(who, 'GET', `/api/tree/${focal}?${query}`);
  expect(response.status).toBe(200);
  return response.body as Json;
};
const idsOf = (body: Json) => (body.people as Json[]).map((x) => x.id as string);
const person = (body: Json, id: string) => (body.people as Json[]).find((x) => x.id === id) as Json;

describe('what a chart follows (the effective set)', () => {
  it('adoptive view: Samuel is the child of Joseph and Anna, and his birth family is behind a leaf', async () => {
    const body = await tree('user', p.samuel!, 'up=1&down=0&collateral=false');
    expect(body.lineage).toBe('adoptive');
    expect(body.parentage[p.samuel!]).toMatchObject({
      kind: 'adoptive',
      unionId: u.hale,
      link: { value: '1938', precision: 'exactly' },
    });
    expect(idsOf(body).sort()).toEqual([p.samuel, p.joseph, p.anna].sort());
    expect(person(body, p.samuel!).otherFamily).toEqual({ kind: 'birth', count: 2 });
  });

  it('birth view: Samuel is the child of Frank and Ruth, and his adoptive family is behind the leaf', async () => {
    const body = await tree('user', p.samuel!, 'up=1&down=0&collateral=false&lineage=birth');
    expect(body.lineage).toBe('birth');
    expect(body.parentage[p.samuel!]).toMatchObject({ kind: 'birth', unionId: u.doyle });
    expect(idsOf(body).sort()).toEqual([p.samuel, p.frank, p.ruth].sort());
    expect(person(body, p.samuel!).otherFamily).toEqual({ kind: 'adoptive', count: 2 });
  });

  it('a person with no adoptive set uses their birth links in both views, and has no other family', async () => {
    for (const lineage of ['adoptive', 'birth']) {
      const body = await tree('user', f.person.marcus, `up=1&down=0&lineage=${lineage}`);
      expect(body.parentage[f.person.marcus]).toMatchObject({ kind: 'birth' });
      expect(person(body, f.person.marcus).otherFamily).toBeUndefined();
    }
  });

  it('descendants follow the same rule: Samuel is under Joseph (adoptive view) or under Frank (birth view), never both', async () => {
    const adoptive = (who: string) => tree('user', who, 'up=0&down=1&collateral=false&lineage=adoptive');
    const birth = (who: string) => tree('user', who, 'up=0&down=1&collateral=false&lineage=birth');
    expect(idsOf(await adoptive(p.joseph!))).toEqual(expect.arrayContaining([p.samuel, p.peter]));
    expect(idsOf(await adoptive(p.frank!))).not.toContain(p.samuel);
    expect(idsOf(await adoptive(p.frank!))).toContain(p.gina);
    expect(idsOf(await birth(p.frank!))).toEqual(expect.arrayContaining([p.samuel, p.gina]));
    expect(idsOf(await birth(p.joseph!))).not.toContain(p.samuel);
    expect(idsOf(await birth(p.joseph!))).toContain(p.peter);
  });

  it('draws adoptive siblings as siblings in the adoptive view and birth siblings in the birth view', async () => {
    const adoptive = await tree('user', p.samuel!, 'up=1&down=0&collateral=true&lineage=adoptive');
    expect(idsOf(adoptive)).toContain(p.peter);
    expect(idsOf(adoptive)).not.toContain(p.gina);
    const birth = await tree('user', p.samuel!, 'up=1&down=0&collateral=true&lineage=birth');
    expect(idsOf(birth)).toContain(p.gina);
    expect(idsOf(birth)).not.toContain(p.peter);
  });

  it('leaf counts follow the view: a cut-off person counts the ancestors of the set the view follows', async () => {
    const adoptive = await tree('user', p.samuel!, 'up=0&down=0&lineage=adoptive');
    expect(person(adoptive, p.samuel!)).toMatchObject({ hasParents: true, ancestorCount: 2 });
    const birth = await tree('user', p.samuel!, 'up=0&down=0&lineage=birth');
    expect(person(birth, p.samuel!)).toMatchObject({ hasParents: true, ancestorCount: 2 });
  });

  it('birth view with no birth set recorded shows no parents (no fallback), and the leaf opens the adoptive family', async () => {
    const zed = await insertPersonRow(t.owner, 'Zed', 'Hale', { gender: 'male', birth: '1950' });
    await linkChild(t.owner, zed, { union: u.hale! }, 'adoptive', '1951');
    const birth = await tree('user', zed, 'up=2&down=0&lineage=birth');
    expect(person(birth, zed)).toMatchObject({ hasParents: false, otherFamily: { kind: 'adoptive', count: 2 } });
    expect(birth.parentage[zed]).toBeUndefined();
    expect(idsOf(birth)).toEqual([zed]);
    const adoptive = await tree('user', zed, 'up=2&down=0&lineage=adoptive');
    expect(adoptive.parentage[zed]).toMatchObject({ kind: 'adoptive' });
    expect(person(adoptive, zed).otherFamily).toBeUndefined();
  });

  it('the detail of a person always lists both families, whatever the viewer chose', async () => {
    await as('user', 'PATCH', '/api/auth/me', { lineageView: 'birth' });
    const detail = (await as('user', 'GET', `/api/people/${p.samuel}`)).body as Json;
    expect(detail.parents.birth).toMatchObject({ unionId: u.doyle, kind: 'birth' });
    expect(detail.parents.adoptive).toMatchObject({ unionId: u.hale, kind: 'adoptive', link: { value: '1938' } });
    const joseph = (await as('user', 'GET', `/api/people/${p.joseph}`)).body as Json;
    const kinds = Object.fromEntries(joseph.unions[0].children.map((c: Json) => [c.id, c.kind]));
    expect(kinds).toMatchObject({ [p.samuel!]: 'adoptive', [p.peter!]: 'birth' });
    await as('user', 'PATCH', '/api/auth/me', { lineageView: 'adoptive' });
  });
});

describe('each viewer chooses their own family', () => {
  it('starts on adoptive, changes only the viewer’s own charts, and is read by the tree route', async () => {
    const me = await as('familyadmin', 'GET', '/api/auth/me');
    expect(me.body?.user.lineageView).toBe('adoptive');
    const changed = await as('familyadmin', 'PATCH', '/api/auth/me', { lineageView: 'birth' });
    expect(changed.status).toBe(200);
    expect(changed.body?.user.lineageView).toBe('birth');
    // The admin's chart follows birth; the Member's and the User's are unchanged.
    const q = 'up=1&down=0&collateral=false';
    expect((await tree('familyadmin', p.samuel!, q)).parentage[p.samuel!]).toMatchObject({ kind: 'birth' });
    expect((await tree('member', p.samuel!, q)).parentage[p.samuel!]).toMatchObject({ kind: 'adoptive' });
    expect((await tree('user', p.samuel!, q)).parentage[p.samuel!]).toMatchObject({ kind: 'adoptive' });
    // The override beats the setting, and what is stored for everyone else is not touched.
    expect((await tree('familyadmin', p.samuel!, `${q}&lineage=adoptive`)).parentage[p.samuel!]).toMatchObject({
      kind: 'adoptive',
    });
    await as('familyadmin', 'PATCH', '/api/auth/me', { lineageView: 'adoptive' });
  });

  it('every role can change its own setting; nobody can send anything else', async () => {
    for (const who of ['superadmin', 'familyadmin', 'member', 'user'] as const) {
      expect((await as(who, 'PATCH', '/api/auth/me', { lineageView: 'birth' })).status).toBe(200);
      expect((await as(who, 'PATCH', '/api/auth/me', { lineageView: 'adoptive' })).status).toBe(200);
    }
    expect((await as('user', 'PATCH', '/api/auth/me', { lineageView: 'biological' })).status).toBe(400);
    expect((await as('user', 'PATCH', '/api/auth/me', { lineageView: 'birth', role: 'superadmin' })).status).toBe(400);
    expect((await as('user', 'PATCH', '/api/auth/me', {})).status).toBe(400);
    expect((await as('anonymous', 'PATCH', '/api/auth/me', { lineageView: 'birth' })).status).toBe(401);
    expect((await as('user', 'GET', `/api/tree/${p.samuel}?lineage=biological`)).status).toBe(400);
  });
});

describe('the app role may change only lineage_view, and only on its own row', () => {
  const asUser = <T>(userId: string, fn: Parameters<typeof withUserTransaction<T>>[2]) =>
    withUserTransaction(t.db, userId, fn);
  const me = () => f.account.user.id;

  it('updates its own lineage_view', async () => {
    await asUser(me(), (trx) => sql`update users set lineage_view = 'birth' where id = ${me()}`.execute(trx));
    const row = await t.owner
      .selectFrom('users')
      .select('lineage_view')
      .where('id', '=', me())
      .executeTakeFirstOrThrow();
    expect(row.lineage_view).toBe('birth');
    await asUser(me(), (trx) => sql`update users set lineage_view = 'adoptive' where id = ${me()}`.execute(trx));
  });

  it('cannot change role, person_id, email, display name, password hash or any other column', async () => {
    for (const change of [
      sql`update users set role = 'superadmin' where id = ${me()}`,
      sql`update users set person_id = ${p.samuel}::uuid where id = ${me()}`,
      sql`update users set email = 'x@example.com' where id = ${me()}`,
      sql`update users set display_name = 'Hacked' where id = ${me()}`,
      sql`update users set password_hash = 'x' where id = ${me()}`,
      sql`update users set lineage_view = 'birth', role = 'superadmin' where id = ${me()}`,
      sql`update users set id = gen_random_uuid() where id = ${me()}`,
    ]) {
      await expect(asUser(me(), (trx) => change.execute(trx))).rejects.toThrow(/permission denied/);
    }
  });

  it('cannot change another account’s row: the policy hides it, so nothing is updated', async () => {
    const result = await asUser(me(), (trx) =>
      sql`update users set lineage_view = 'birth' where id = ${f.account.member.id}`.execute(trx),
    );
    expect(result.numAffectedRows).toBe(0n);
    const other = await t.owner
      .selectFrom('users')
      .select('lineage_view')
      .where('id', '=', f.account.member.id)
      .executeTakeFirstOrThrow();
    expect(other.lineage_view).toBe('adoptive');
  });

  it('refuses a value that is not a view, and cannot insert or delete accounts', async () => {
    await expect(
      asUser(me(), (trx) => sql`update users set lineage_view = 'biological' where id = ${me()}`.execute(trx)),
    ).rejects.toThrow(/lineage_view/);
    await expect(asUser(me(), (trx) => sql`delete from users where id = ${me()}`.execute(trx))).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('adding adoption links', () => {
  it('an admin adds adoptive parents; a second adoptive parent creates an Unknown relationship, even later', async () => {
    const child = await insertPersonRow(t.owner, 'Ada', 'Quinn', { birth: '1990' });
    const a = await insertPersonRow(t.owner, 'Alma', 'Quinn', { gender: 'female' });
    const b = await insertPersonRow(t.owner, 'Bea', 'Quinn', { gender: 'female' });
    const first = await as('familyadmin', 'POST', `/api/people/${child}/parents`, {
      parentId: a,
      kind: 'adoptive',
      link: { value: '1992' },
    });
    expect(first.status).toBe(201);
    expect(first.body?.parentage).toMatchObject({ kind: 'adoptive', parentId: a, link: { value: '1992' } });
    // Much later: the second adoptive parent. Two women with no relationship get an Unknown one.
    const second = await as('superadmin', 'POST', `/api/people/${child}/parents`, { parentId: b, kind: 'adoptive' });
    expect(second.status).toBe(201);
    const union = await as('user', 'GET', `/api/unions/${second.body?.parentage.unionId}`);
    expect(union.body?.union).toMatchObject({ status: 'unknown', children: [{ id: child, kind: 'adoptive' }] });
    expect(second.body?.parentage).toMatchObject({ kind: 'adoptive', link: { value: '1992' } });
    // The same rule when the two already have one relationship: it is reused.
    const c = await insertPersonRow(t.owner, 'Cal', 'Quinn', { birth: '1991' });
    await as('familyadmin', 'POST', `/api/people/${c}/parents`, { parentId: a, kind: 'adoptive' });
    const again = await as('familyadmin', 'POST', `/api/people/${c}/parents`, { parentId: b, kind: 'adoptive' });
    expect(again.body?.parentage.unionId).toBe(union.body?.union.id);
    // The child's birth set is still free and separate.
    const detail = (await as('user', 'GET', `/api/people/${child}`)).body as Json;
    expect(detail.parents.birth).toBeNull();
    expect(detail.parents.adoptive).toMatchObject({ unionId: union.body?.union.id });
  });

  it('two people with several relationships need the caller to say which, for adoptive parents too', async () => {
    const child = await insertPersonRow(t.owner, 'Dee', 'Quinn');
    const a = await insertPersonRow(t.owner, 'Ann', 'Rowe');
    const b = await insertPersonRow(t.owner, 'Bo', 'Rowe');
    await insertUnionRow(t.owner, a, b, 'divorced');
    await insertUnionRow(t.owner, a, b, 'married', { start: '2005' });
    await as('familyadmin', 'POST', `/api/people/${child}/parents`, { parentId: a, kind: 'adoptive' });
    const refused = await as('familyadmin', 'POST', `/api/people/${child}/parents`, { parentId: b, kind: 'adoptive' });
    expect(refused.status).toBe(409);
    expect(refused.body?.error).toBe('union_ambiguous');
  });

  it('an admin adds an adoptive child under a relationship, with its date; a birth link is the default', async () => {
    const added = await as('familyadmin', 'POST', `/api/people/${f.person.daniel}/children`, {
      child: { givenName: 'Ines', surname: 'Hale' },
      unionId: f.union.danielBeatriz,
      kind: 'adoptive',
      link: { value: '2012-03', precision: 'about' },
    });
    expect(added.status).toBe(201);
    expect(added.body?.parentage).toMatchObject({
      kind: 'adoptive',
      unionId: f.union.danielBeatriz,
      link: { value: '2012-03', precision: 'about' },
    });
    const plain = await as('familyadmin', 'POST', `/api/people/${f.person.daniel}/children`, {
      child: { givenName: 'Ivo', surname: 'Hale' },
    });
    expect(plain.body?.parentage).toMatchObject({ kind: 'birth', link: null });
    // No age warning for adoptive links.
    expect(added.body?.warnings).toEqual([]);
  });

  it('a Member can add a birth link only: adoptive is refused by the API and by the policy', async () => {
    const api = await as('member', 'POST', `/api/people/${f.person.marcus}/children`, {
      child: { givenName: 'Ila', surname: 'Hale' },
      kind: 'adoptive',
    });
    expect(api.status).toBe(403);
    const ok = await as('member', 'POST', `/api/people/${f.person.marcus}/children`, {
      child: { givenName: 'Ila', surname: 'Hale' },
    });
    expect(ok.status).toBe(201);
    expect(ok.body?.parentage.kind).toBe('birth');
    expect(
      (
        await as('member', 'POST', `/api/people/${ok.body?.person.id}/parents`, {
          parentId: p.joseph,
          kind: 'adoptive',
        })
      ).status,
    ).toBe(403);

    // Straight to the database as the Member: a child they just made, a birth link passes, an adoptive link is refused.
    const outcome = (kind: string) =>
      withUserTransaction(t.db, f.account.member.id, async (trx) => {
        const child = await sql<{ id: string }>`
          insert into people (given_name, surname, created_by) values ('Raw', 'Child', ${f.account.member.id}) returning id`.execute(
          trx,
        );
        await sql`insert into person_parents (child_id, parent_id, kind, created_by)
                  values (${child.rows[0]!.id}, ${f.person.marcus}, ${kind}, ${f.account.member.id})`.execute(trx);
      });
    await expect(outcome('birth')).resolves.toBeUndefined();
    await expect(outcome('adoptive')).rejects.toThrow(/row-level security/);
    // And nobody but an admin can change a link’s date or kind afterwards.
    await expect(
      withUserTransaction(t.db, f.account.member.id, (trx) =>
        sql`update person_parents set link_date = '1999' where child_id = ${ok.body?.person.id}`.execute(trx),
      ).then((r) => r.numAffectedRows),
    ).resolves.toBe(0n);
    await expect(
      withUserTransaction(t.db, f.account.member.id, (trx) =>
        sql`update person_parents set kind = 'adoptive' where child_id = ${ok.body?.person.id}`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('an admin changes the date of a link, or clears it; a missing set is not found', async () => {
    const set = await as('familyadmin', 'PATCH', `/api/people/${p.samuel}/parents/adoptive`, {
      link: { value: '1938-06', precision: 'about' },
    });
    expect(set.status).toBe(200);
    expect(set.body?.parentage).toMatchObject({ kind: 'adoptive', link: { value: '1938-06', precision: 'about' } });
    const cleared = await as('familyadmin', 'PATCH', `/api/people/${p.samuel}/parents/adoptive`, { link: null });
    expect(cleared.body?.parentage.link).toBeNull();
    await as('familyadmin', 'PATCH', `/api/people/${p.samuel}/parents/adoptive`, { link: { value: '1938' } });
    expect(
      (await as('familyadmin', 'PATCH', `/api/people/${p.samuel}/parents/adoptive`, { link: { value: '1938-13' } }))
        .status,
    ).toBe(400);
    expect((await as('familyadmin', 'PATCH', `/api/people/${p.samuel}/parents/step`, { link: null })).status).toBe(400);
    expect((await as('familyadmin', 'PATCH', `/api/people/${p.tim}/parents/adoptive`, { link: null })).status).toBe(
      404,
    );
    expect((await as('member', 'PATCH', `/api/people/${p.samuel}/parents/adoptive`, { link: null })).status).toBe(403);
    expect((await as('user', 'PATCH', `/api/people/${p.samuel}/parents/adoptive`, { link: null })).status).toBe(403);
  });
});

describe('rules across both kinds', () => {
  it('the same person cannot be a birth parent and an adoptive parent of the same child', async () => {
    const child = await insertPersonRow(t.owner, 'Cy', 'Vale');
    const a = await insertPersonRow(t.owner, 'Al', 'Vale');
    await as('familyadmin', 'POST', `/api/people/${child}/parents`, { parentId: a });
    const refused = await as('familyadmin', 'POST', `/api/people/${child}/parents`, { parentId: a, kind: 'adoptive' });
    expect(refused.status).toBe(409);
    expect(refused.body?.error).toBe('same_person_both_kinds');
    // Nothing was left behind by the refused request.
    expect(((await as('user', 'GET', `/api/people/${child}`)).body as Json).parents.adoptive).toBeNull();
  });

  it('a stepparent adoption works: the adoptive set is a relationship of the staying birth parent and the adopter', async () => {
    const child = await insertPersonRow(t.owner, 'Dan', 'Vale', { birth: '2000' });
    const mum = await insertPersonRow(t.owner, 'Mum', 'Vale', { gender: 'female' });
    const dad = await insertPersonRow(t.owner, 'Dad', 'Gone', { gender: 'male' });
    const step = await insertPersonRow(t.owner, 'Stef', 'Vale', { gender: 'male' });
    const birthUnion = await insertUnionRow(t.owner, mum, dad, 'divorced');
    await linkChild(t.owner, child, { union: birthUnion });
    const marriage = await insertUnionRow(t.owner, mum, step, 'married');
    // Step by step: the adopter alone first, then the staying parent joins; the set becomes their relationship.
    expect(
      (await as('familyadmin', 'POST', `/api/people/${child}/parents`, { parentId: step, kind: 'adoptive' })).status,
    ).toBe(201);
    const joined = await as('familyadmin', 'POST', `/api/people/${child}/parents`, { parentId: mum, kind: 'adoptive' });
    expect(joined.status).toBe(201);
    expect(joined.body?.parentage).toMatchObject({ kind: 'adoptive', unionId: marriage });
    // The adoptive view follows Mum and Stef; the birth view still Mum and Dad.
    const adoptive = await tree('user', child, 'up=1&down=0&lineage=adoptive');
    expect(adoptive.parentage[child]).toMatchObject({ kind: 'adoptive', unionId: marriage });
    expect(idsOf(adoptive)).toEqual(expect.arrayContaining([child, mum, step]));
    expect(person(adoptive, child).otherFamily).toEqual({ kind: 'birth', count: 2 });
    const birth = await tree('user', child, 'up=1&down=0&lineage=birth');
    expect(birth.parentage[child]).toMatchObject({ kind: 'birth', unionId: birthUnion });
    expect(person(birth, child).otherFamily).toEqual({ kind: 'adoptive', count: 2 });
    // Legal parents (the adoptive set) include the staying birth parent.
    const legal = await sql<{ id: string }>`select * from kinship_legal_parent_ids(${child}::uuid) as id`.execute(
      t.owner,
    );
    expect(legal.rows.map((r) => Object.values(r)[0]).sort()).toEqual([mum, step].sort());
    // Removing the adopter ends the adoptive set (it would otherwise repeat the birth parent).
    const removed = await as('familyadmin', 'DELETE', `/api/people/${child}/parents/${step}`);
    expect(removed.status).toBe(200);
    expect(removed.body?.parentage).toBeNull();
    expect(((await as('user', 'GET', `/api/people/${child}`)).body as Json).parents.adoptive).toBeNull();
  });

  it('a stepparent adoption cannot reuse both birth parents, or use a single adoptive parent who is a birth parent', async () => {
    const child = await insertPersonRow(t.owner, 'Eli', 'Vale');
    const mum = await insertPersonRow(t.owner, 'Mum2', 'Vale');
    const dad = await insertPersonRow(t.owner, 'Dad2', 'Vale');
    const union = await insertUnionRow(t.owner, mum, dad, 'married');
    await linkChild(t.owner, child, { union });
    const both = await as('familyadmin', 'POST', `/api/people/${child}/parents`, {
      parentId: mum,
      kind: 'adoptive',
      unionId: union,
    });
    expect(both.body?.error).toBe('same_person_both_kinds');
    // Direct SQL as the owner is refused by the trigger too: two overlapping people.
    await expect(linkChild(t.owner, child, { union }, 'adoptive')).rejects.toThrow(/same_person_both_kinds/);
  });

  it('a cycle is refused across kinds: a person cannot be adopted by their own descendant', async () => {
    const grand = await insertPersonRow(t.owner, 'Gran', 'Loop', { birth: '1930' });
    const kid = await insertPersonRow(t.owner, 'Kid', 'Loop', { birth: '1960' });
    await linkChild(t.owner, kid, { parent: grand });
    const refused = await as('familyadmin', 'POST', `/api/people/${grand}/parents`, {
      parentId: kid,
      kind: 'adoptive',
    });
    expect(refused.status).toBe(409);
    expect(refused.body?.error).toBe('would_create_cycle');
    const self = await as('familyadmin', 'POST', `/api/people/${kid}/parents`, { parentId: kid, kind: 'adoptive' });
    expect(self.body?.error).toBe('parent_is_self');
  });

  it('removing a parent takes them out of the right set; deleting a person keeps each set’s other parent', async () => {
    const child = await insertPersonRow(t.owner, 'Fay', 'Nest', { birth: '1980' });
    const bm = await insertPersonRow(t.owner, 'Bmum', 'Nest');
    const bf = await insertPersonRow(t.owner, 'Bdad', 'Nest');
    const am = await insertPersonRow(t.owner, 'Amum', 'Nest');
    const af = await insertPersonRow(t.owner, 'Adad', 'Nest');
    await linkChild(t.owner, child, { union: await insertUnionRow(t.owner, bm, bf, 'married') });
    await linkChild(t.owner, child, { union: await insertUnionRow(t.owner, am, af, 'married') }, 'adoptive', '1982');
    const removed = await as('familyadmin', 'DELETE', `/api/people/${child}/parents/${af}`);
    expect(removed.body?.parentage).toMatchObject({ kind: 'adoptive', parentId: am });
    expect(((await as('user', 'GET', `/api/people/${child}`)).body as Json).parents.birth).toMatchObject({
      kind: 'birth',
    });
    // Deleting the birth mother leaves the birth father as the single birth parent; the adoptive set is untouched.
    expect((await as('familyadmin', 'DELETE', `/api/people/${bm}?confirm=true`)).status).toBe(204);
    const detail = (await as('user', 'GET', `/api/people/${child}`)).body as Json;
    expect(detail.parents.birth).toMatchObject({ kind: 'birth', parentId: bf, unionId: null });
    expect(detail.parents.adoptive).toMatchObject({ kind: 'adoptive', parentId: am, link: { value: '1982' } });
    expect((await as('familyadmin', 'DELETE', `/api/people/${child}/parents/${bf}`)).body?.parentage).toBeNull();
    expect((await as('familyadmin', 'DELETE', `/api/people/${child}/parents/${bf}`)).status).toBe(404);
  });
});

describe('helper functions for later features', () => {
  it('birth and legal parents are read by kind, never by a viewer’s setting', async () => {
    const list = async (fn: string, id: string) => {
      const r = await sql<Record<string, string>>`select ${sql.raw(`kinship_${fn}`)}(${id}::uuid) as id`.execute(
        t.owner,
      );
      return r.rows.map((row) => row.id).sort();
    };
    expect(await list('birth_parent_ids', p.samuel!)).toEqual([p.frank, p.ruth].sort());
    expect(await list('legal_parent_ids', p.samuel!)).toEqual([p.joseph, p.anna].sort());
    // Someone with no adoptive set: legal parents are the birth parents. Someone with neither: none.
    expect(await list('legal_parent_ids', p.gina!)).toEqual([p.frank, p.ruth].sort());
    expect(await list('legal_parent_ids', p.frank!)).toEqual([]);
    // An adopted-away child is not a child of the birth parent for the legal rule.
    const legalChildren = await sql<{ child_id: string }>`
      select c.id as child_id from people c where ${p.frank}::uuid in (select * from kinship_legal_parent_ids(c.id))`.execute(
      t.owner,
    );
    expect(legalChildren.rows.map((r) => r.child_id)).toEqual([p.gina]);
  });
});

describe('migration 0006 on data from before it', () => {
  it('turns every existing link into a birth link, gives every account the adoptive view, and keeps the tree', async () => {
    const test = await createTestDatabase();
    const dir = await tempMigrationsDir(true);
    try {
      await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
      await removeMigrationsFrom(dir.dir, 6); // 0006 and everything after it
      await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
      // Old data: a user, a family, links in the old shape (one row per child).
      await sql`insert into users (email, display_name, password_hash, role) values ('a@example.com', 'A', 'x', 'superadmin')`.execute(
        test.owner,
      );
      const mum = await insertPersonRow(test.owner, 'Old', 'Mum');
      const dad = await insertPersonRow(test.owner, 'Old', 'Dad');
      const kid = await insertPersonRow(test.owner, 'Old', 'Kid');
      const solo = await insertPersonRow(test.owner, 'Old', 'Solo');
      const union = await insertUnionRow(test.owner, mum, dad, 'married');
      await sql`insert into person_parents (child_id, union_id) values (${kid}, ${union})`.execute(test.owner);
      await sql`insert into person_parents (child_id, parent_id) values (${solo}, ${mum})`.execute(test.owner);

      await cp(join(realMigrationsDir, '0006_adoptive_parentage.sql'), join(dir.dir, '0006_adoptive_parentage.sql'));
      const result = await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
      expect(result.applied).toEqual(['0006_adoptive_parentage']);

      const links = await sql<{ child_id: string; kind: string; link_date: string | null; link_precision: string }>`
        select child_id, kind, link_date, link_precision from person_parents order by child_id`.execute(test.owner);
      expect(links.rows).toHaveLength(2);
      expect(
        links.rows.every((r) => r.kind === 'birth' && r.link_date === null && r.link_precision === 'exactly'),
      ).toBe(true);
      const users = await sql<{ lineage_view: string }>`select lineage_view from users`.execute(test.owner);
      expect(users.rows).toEqual([{ lineage_view: 'adoptive' }]);
      // The key is now (child, kind): a second, adoptive set can be added; a second birth set cannot.
      const step = await insertPersonRow(test.owner, 'Old', 'Step');
      await sql`insert into person_parents (child_id, parent_id, kind) values (${kid}, ${step}, 'adoptive')`.execute(
        test.owner,
      );
      const other = await insertPersonRow(test.owner, 'Old', 'Other');
      await expect(
        sql`insert into person_parents (child_id, parent_id, kind) values (${kid}, ${other}, 'birth')`.execute(
          test.owner,
        ),
      ).rejects.toThrow(/person_parents_pkey/);
      // The helper reads the old data the same way as before.
      const parents = await sql<{ id: string }>`select kinship_parent_ids_in(${kid}::uuid, 'birth') as id`.execute(
        test.owner,
      );
      expect(parents.rows.map((r) => r.id).sort()).toEqual([mum, dad].sort());
      // And the app role has what it needs and no more.
      const app = test.track(createAppDb(test.config));
      await expect(sql`update users set role = 'superadmin'`.execute(app)).rejects.toThrow(/permission denied/);
    } finally {
      await dir.remove();
      await test.cleanup();
    }
  }, 60_000);
});
