// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Linking children who already exist to a second parent (step 45, ADR 0039). The case that started it: a child added under
// one parent alone stays that parent's child only, so when the other parent is added later as a partner, the app calls the
// child a half-sibling of their brothers and sisters and a stepchild of their own parent. In the Hale family that is Tomas,
// who hangs from Beatriz alone while Gabriel hangs from Daniel and Beatriz.
import { createTranslator, en, renderRelName } from '@kinship/shared';
import type { RelationshipResponse } from '@kinship/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieHeader, createTestApp, CSRF, insertUser, login } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';
import { seedHale } from './fixtures/hale-db.js';
import { insertPersonRow, insertUnionRow, linkChild } from './helpers/family.js';

const tr = createTranslator(en);
let app: TestApp;
let id: Record<string, string>;
let admin: string;

const send = async (method: 'GET' | 'POST', url: string, payload?: unknown, cookie = admin) => {
  const response = await app.app.inject({
    method,
    url,
    headers: { ...CSRF, cookie },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  return { status: response.statusCode, body: response.body ? (response.json() as Record<string, unknown>) : null };
};
const said = async (a: string, b: string): Promise<string> => {
  const response = await send('GET', `/api/relationship?a=${id[a]}&b=${id[b]}`);
  expect(response.status).toBe(200);
  const body = response.body as unknown as RelationshipResponse;
  return body.name ? renderRelName(body.name, tr) : 'No relationship found';
};
const unionOf = async (a: string, b: string): Promise<string> => {
  const [lo, hi] = id[a]! < id[b]! ? [id[a]!, id[b]!] : [id[b]!, id[a]!];
  const result = await sql<{ id: string }>`
    select id from unions where partner_a_id = ${lo} and partner_b_id = ${hi}`.execute(app.owner);
  return result.rows[0]!.id;
};
const partnerChildIds = async (who: string): Promise<string[]> => {
  const body = (await send('GET', `/api/people/${id[who]}`)).body as {
    partnerChildren: Array<{ child: { id: string } }>;
  };
  return body.partnerChildren.map((entry) => entry.child.id);
};

beforeAll(async () => {
  app = await createTestApp();
  await insertUser(app.owner, { email: 'admin@example.com', role: 'superadmin' });
  admin = cookieHeader(await login(app.app, 'admin@example.com'));
  id = await seedHale(app.owner);
}, 60_000);
afterAll(() => app.close());

describe('a child linked to the second parent afterwards (the stepsister case)', () => {
  it('today: Tomas hangs from Beatriz alone, so he reads as Gabriel’s half-brother and Daniel’s stepson', async () => {
    expect(await said('gabriel', 'tomas')).toBe('Half-brother');
    expect(await said('daniel', 'tomas')).toBe('Stepson');
    expect(await partnerChildIds('daniel')).toContain(id.tomas);
  });

  it('after linking Tomas to Daniel too: brother and son, and no step title on either profile', async () => {
    const union = await unionOf('daniel', 'beatriz');
    const linked = await send('POST', `/api/unions/${union}/children`, { childIds: [id.tomas] });
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    expect(await said('gabriel', 'tomas')).toBe('Brother');
    expect(await said('daniel', 'tomas')).toBe('Son');
    expect(await said('tomas', 'daniel')).toBe('Father');
    // Daniel's profile no longer lists Tomas among Beatriz's children from another relationship (the source of
    // "your stepson"), and Tomas now hangs from the relationship, not from Beatriz alone.
    expect(await partnerChildIds('daniel')).not.toContain(id.tomas);
    const daniel = (await send('GET', `/api/people/${id.daniel}`)).body as {
      unions: Array<{ id: string; children: Array<{ id: string }> }>;
    };
    expect(daniel.unions.find((u) => u.id === union)?.children.map((c) => c.id)).toContain(id.tomas);
    const beatriz = (await send('GET', `/api/people/${id.beatriz}`)).body as {
      singleParentChildren: Array<{ id: string }>;
    };
    expect(beatriz.singleParentChildren.map((c) => c.id)).not.toContain(id.tomas);
  });
});

/** A small family of its own for each case, so the cases never disturb each other or the Hale family. */
const person = (given: string, extra: { gender?: string; birth?: string } = {}) =>
  insertPersonRow(app.owner, given, 'Linkcase', extra);
const setOf = async (child: string, kind = 'birth') =>
  (
    await sql<{ union_id: string | null; parent_id: string | null }>`
      select union_id, parent_id from person_parents where child_id = ${child} and kind = ${kind}`.execute(app.owner)
  ).rows[0];
const linkable = async (parent: string, query = '') => {
  const response = await send('GET', `/api/people/${parent}/linkable-children${query}`);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return (response.body as { children: Array<{ child: { id: string }; kind: string }> }).children;
};

describe('GET /api/people/:id/linkable-children', () => {
  it('lists the children who hang from the person alone, oldest first, with the kind of each link', async () => {
    const p = await person('Pat');
    const older = await person('Older', { birth: '1990' });
    const younger = await person('Younger', { birth: '1995' });
    const adopted = await person('Adopted', { birth: '1999' });
    const both = await person('Both');
    const other = await person('Other');
    await linkChild(app.owner, younger, { parent: p });
    await linkChild(app.owner, older, { parent: p });
    await linkChild(app.owner, adopted, { parent: p }, 'adoptive');
    // A child of Pat and someone else already has two parents: not listed.
    await linkChild(app.owner, both, { union: await insertUnionRow(app.owner, p, other, 'married') });
    const rows = await linkable(p);
    expect(rows.map((r) => [r.child.id, r.kind])).toEqual([
      [older, 'birth'],
      [younger, 'birth'],
      [adopted, 'adoptive'],
    ]);
    expect((await linkable(p, `?exclude=${older}`)).map((r) => r.child.id)).toEqual([younger, adopted]);
  });

  it('leaves out the partner themselves, a child who is the partner’s ancestor, and a both-sets clash', async () => {
    const p = await person('Pia');
    const child = await person('Child');
    const grandchild = await person('Grandchild');
    const clash = await person('Clash');
    const fine = await person('Fine');
    await linkChild(app.owner, child, { parent: p });
    await linkChild(app.owner, grandchild, { parent: child });
    await linkChild(app.owner, clash, { parent: p });
    await linkChild(app.owner, fine, { parent: p });
    // Partner Q: a descendant of `child` (so linking `child` under Q would be a cycle), and already the adoptive parent of
    // `clash` on their own (so Q may not join clash's birth set too).
    const q = await person('Quinn');
    await linkChild(app.owner, q, { parent: grandchild });
    await linkChild(app.owner, clash, { parent: q }, 'adoptive');
    expect((await linkable(p)).map((r) => r.child.id).sort()).toEqual([child, clash, fine].sort());
    expect((await linkable(p, `?partner=${q}`)).map((r) => r.child.id)).toEqual([fine]);
    // The partner being one of the person's own one-parent children is refused too.
    expect((await linkable(p, `?partner=${fine}`)).map((r) => r.child.id)).not.toContain(fine);
  });

  it('answers 404 for an unknown person or partner', async () => {
    const p = await person('Lone');
    expect((await send('GET', `/api/people/00000000-0000-4000-8000-000000000000/linkable-children`)).status).toBe(404);
    expect((await send('GET', `/api/people/${p}/linkable-children?partner=nope`)).status).toBe(404);
  });
});

describe('POST /api/unions/:id/children', () => {
  it('keeps the kind of each link and hangs the children from the relationship', async () => {
    const a = await person('Ana');
    const b = await person('Ben');
    const birth = await person('Birthkid');
    const adopted = await person('Adoptkid');
    await linkChild(app.owner, birth, { parent: a });
    await linkChild(app.owner, adopted, { parent: b }, 'adoptive');
    const union = await insertUnionRow(app.owner, a, b, 'married');
    const response = await send('POST', `/api/unions/${union}/children`, { childIds: [birth, adopted] });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(await setOf(birth, 'birth')).toEqual({ union_id: union, parent_id: null });
    expect(await setOf(adopted, 'adoptive')).toEqual({ union_id: union, parent_id: null });
    expect(await setOf(adopted, 'birth')).toBeUndefined();
    const body = response.body as { union: { children: Array<{ id: string; kind: string }> }; warnings: unknown[] };
    expect(body.union.children.map((c) => [c.id, c.kind]).sort()).toEqual(
      [
        [birth, 'birth'],
        [adopted, 'adoptive'],
      ].sort(),
    );
    expect(body.warnings).toEqual([]);
  });

  it('saves nothing when one child cannot be linked, and names that child', async () => {
    const a = await person('Ari');
    const b = await person('Bea');
    const c = await person('Cy');
    const ok = await person('Okay');
    const taken = await person('Taken');
    await linkChild(app.owner, ok, { parent: a });
    // Already the child of A and C: not a one-parent child of either partner of A + B.
    await linkChild(app.owner, taken, { union: await insertUnionRow(app.owner, a, c, 'partner') });
    const union = await insertUnionRow(app.owner, a, b, 'married');
    const response = await send('POST', `/api/unions/${union}/children`, { childIds: [ok, taken] });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ error: 'child_not_linkable', childId: taken });
    expect(await setOf(ok)).toEqual({ union_id: null, parent_id: a });
  });

  it('saves nothing when the database refuses a link (a cycle), and names that child', async () => {
    const a = await person('Abe');
    const ok = await person('Fine2');
    const elder = await person('Elder');
    await linkChild(app.owner, ok, { parent: a });
    await linkChild(app.owner, elder, { parent: a });
    // B is Elder's child: making Elder B's child as well would make Elder their own ancestor.
    const b = await person('Bo');
    await linkChild(app.owner, b, { parent: elder });
    const union = await insertUnionRow(app.owner, a, b, 'partner');
    const response = await send('POST', `/api/unions/${union}/children`, { childIds: [ok, elder] });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ error: 'would_create_cycle', childId: elder });
    expect(await setOf(ok)).toEqual({ union_id: null, parent_id: a });
    expect(await setOf(elder)).toEqual({ union_id: null, parent_id: a });
  });

  it('returns a too-young warning for the new parent, without blocking', async () => {
    const a = await person('Amy', { birth: '1960' });
    const b = await person('Bob', { birth: '1985' });
    const kid = await person('Kid', { birth: '1990' });
    await linkChild(app.owner, kid, { parent: a });
    const union = await insertUnionRow(app.owner, a, b, 'married');
    const response = await send('POST', `/api/unions/${union}/children`, { childIds: [kid] });
    expect(response.status).toBe(200);
    expect((response.body as { warnings: unknown[] }).warnings).toEqual([
      { code: 'parent_too_young', childId: kid, parentId: b, yearsDifference: 5 },
    ]);
  });

  it('refuses a malformed body and an unknown relationship or child', async () => {
    const a = await person('Al');
    const b = await person('Bi');
    const union = await insertUnionRow(app.owner, a, b, 'partner');
    expect((await send('POST', `/api/unions/${union}/children`, { childIds: [] })).status).toBe(400);
    expect((await send('POST', `/api/unions/${union}/children`, { childIds: [a, a] })).status).toBe(400);
    expect(
      (await send('POST', `/api/unions/00000000-0000-4000-8000-000000000000/children`, { childIds: [a] })).status,
    ).toBe(404);
    expect(
      (await send('POST', `/api/unions/${union}/children`, { childIds: ['00000000-0000-4000-8000-000000000000'] }))
        .status,
    ).toBe(404);
  });
});

describe('invariant: linking never gives a child more than two parents in a set, or makes anyone their own ancestor', () => {
  it('holds over many random link attempts', async () => {
    // A small deterministic generator, so a failure can be replayed.
    let seed = 45;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    const people: string[] = [];
    for (let i = 0; i < 24; i += 1) people.push(await person(`Gen${i}`));
    // Some one-parent links (always to an earlier person, so there are no cycles to start with) and some relationships.
    for (let i = 4; i < people.length; i += 1) {
      if (random(3) > 0)
        await linkChild(app.owner, people[i]!, { parent: people[random(i)]! }, random(4) ? 'birth' : 'adoptive');
    }
    const unions: string[] = [];
    for (let i = 0; i < 14; i += 1) {
      const a = people[random(people.length)]!;
      const b = people[random(people.length)]!;
      if (a === b) continue;
      unions.push(await insertUnionRow(app.owner, a, b, 'partner'));
    }
    const outcomes = new Map<number, number>();
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const union = unions[random(unions.length)]!;
      // Mostly the partners' own one-parent children (the ones a dialog would offer), now and then anybody at all.
      const own = (
        await sql<{ child_id: string }>`
          select pp.child_id from person_parents pp join unions u on u.id = ${union}
           where pp.parent_id in (u.partner_a_id, u.partner_b_id) order by pp.child_id`.execute(app.owner)
      ).rows.map((r) => r.child_id);
      const picked = [...own.filter(() => random(3) > 0)];
      if (picked.length === 0 || random(4) === 0) picked.push(people[random(people.length)]!);
      const response = await send('POST', `/api/unions/${union}/children`, { childIds: [...new Set(picked)] });
      expect([200, 409, 400], JSON.stringify(response.body)).toContain(response.status);
      outcomes.set(response.status, (outcomes.get(response.status) ?? 0) + 1);
      const bad = await sql<{ n: number }>`
        select count(*)::int as n from person_parents pp
         where pp.child_id = any(${people}::uuid[])
           and (
             (pp.union_id is not null) = (pp.parent_id is not null)
             or pp.child_id = pp.parent_id
             or exists (select 1 from unions u where u.id = pp.union_id and pp.child_id in (u.partner_a_id, u.partner_b_id))
             or pp.child_id in (
               with recursive up(id) as (
                 select unnest(case when pp.parent_id is not null then array[pp.parent_id]
                                    else (select array[u.partner_a_id, u.partner_b_id] from unions u where u.id = pp.union_id) end)
                 union
                 select x.pid from up join person_parents q on q.child_id = up.id
                 cross join lateral (
                   select q.parent_id where q.parent_id is not null
                   union all select u.partner_a_id from unions u where u.id = q.union_id
                   union all select u.partner_b_id from unions u where u.id = q.union_id
                 ) x(pid)
               ) select id from up)
           )`.execute(app.owner);
      expect(bad.rows[0]!.n).toBe(0);
    }
    // The run must have linked some children and had some refused, or it proved nothing.
    expect(outcomes.get(200) ?? 0).toBeGreaterThan(0);
    expect(outcomes.get(409) ?? 0).toBeGreaterThan(0);
  });
});

const peopleNamed = async (given: string) =>
  (await sql<{ n: number }>`select count(*)::int as n from people where given_name = ${given}`.execute(app.owner))
    .rows[0]!.n;
const unionsOf = async (a: string, b: string) => {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return (
    await sql<{ id: string; status: string }>`
      select id, status from unions where partner_a_id = ${lo} and partner_b_id = ${hi}`.execute(app.owner)
  ).rows;
};
const saidBetween = async (a: string, b: string): Promise<string> => {
  const body = (await send('GET', `/api/relationship?a=${a}&b=${b}`)).body as unknown as RelationshipResponse;
  return body.name ? renderRelName(body.name, tr) : 'No relationship found';
};
const newPerson = (givenName: string, gender: 'male' | 'female') => ({ givenName, surname: 'Linkcase', gender });

describe('POST /api/people/:id/partners', () => {
  it('adds a new partner, the relationship and the shared children in one call, each child keeping its kind', async () => {
    const p = await person('Paz', { gender: 'female' });
    const birth = await person('Kidbirth');
    const adopted = await person('Kidadopt');
    const notTheirs = await person('Notheirs');
    await linkChild(app.owner, birth, { parent: p });
    await linkChild(app.owner, adopted, { parent: p }, 'adoptive');
    await linkChild(app.owner, notTheirs, { parent: p });
    const response = await send('POST', `/api/people/${p}/partners`, {
      partner: newPerson('Newpartner', 'male'),
      union: { status: 'married', start: { value: '1990' } },
      linkChildren: [birth, adopted],
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const body = response.body as {
      person: { id: string; givenName: string };
      union: { id: string; status: string; children: Array<{ id: string; kind: string }> };
    };
    expect(body.person.givenName).toBe('Newpartner');
    expect(body.union.status).toBe('married');
    expect(body.union.children.map((c) => [c.id, c.kind]).sort()).toEqual(
      [
        [birth, 'birth'],
        [adopted, 'adoptive'],
      ].sort(),
    );
    // A child not ticked stays with Paz alone.
    expect(await setOf(notTheirs)).toEqual({ union_id: null, parent_id: p });
  });

  it('with no children ticked behaves as before: only the relationship', async () => {
    const p = await person('Pim');
    const kid = await person('Pimkid');
    await linkChild(app.owner, kid, { parent: p });
    const q = await person('Quill');
    const response = await send('POST', `/api/people/${p}/partners`, { partnerId: q, union: { status: 'partner' } });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect((await unionsOf(p, q)).map((u) => u.status)).toEqual(['partner']);
    expect(await setOf(kid)).toEqual({ union_id: null, parent_id: p });
  });

  it('saves nothing (not even the new partner) when one child is refused', async () => {
    const p = await person('Pol');
    const ok = await person('Polkid');
    const other = await person('Polother');
    const taken = await person('Poltaken');
    await linkChild(app.owner, ok, { parent: p });
    await linkChild(app.owner, taken, { union: await insertUnionRow(app.owner, p, other, 'partner') });
    const response = await send('POST', `/api/people/${p}/partners`, {
      partner: newPerson('Rolledback', 'male'),
      union: { status: 'married' },
      linkChildren: [ok, taken],
    });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ error: 'child_not_linkable', childId: taken });
    expect(await peopleNamed('Rolledback')).toBe(0);
    expect(await setOf(ok)).toEqual({ union_id: null, parent_id: p });
  });

  it('refuses an existing partner the database would refuse for a child (a cycle), and saves nothing', async () => {
    const p = await person('Pru');
    const kid = await person('Prukid');
    await linkChild(app.owner, kid, { parent: p });
    const q = await person('Prugrandkid');
    await linkChild(app.owner, q, { parent: kid });
    const response = await send('POST', `/api/people/${p}/partners`, {
      partnerId: q,
      union: { status: 'partner' },
      linkChildren: [kid],
    });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ error: 'would_create_cycle', childId: kid });
    expect(await unionsOf(p, q)).toEqual([]);
  });

  it('asks for exactly one of partner and partnerId, and never pairs a placeholder with a real person', async () => {
    const p = await person('Pen');
    const q = await person('Pencil');
    expect((await send('POST', `/api/people/${p}/partners`, { union: { status: 'partner' } })).status).toBe(400);
    expect(
      (
        await send('POST', `/api/people/${p}/partners`, {
          partnerId: q,
          partner: newPerson('Both', 'male'),
          union: { status: 'partner' },
        })
      ).status,
    ).toBe(400);
    const placeholder = (
      await sql<{ id: string }>`
        insert into people (given_name, surname, gender, is_placeholder) values ('', '', 'female', true) returning id`.execute(
        app.owner,
      )
    ).rows[0]!.id;
    expect(
      (await send('POST', `/api/people/${p}/partners`, { partnerId: placeholder, union: { status: 'unknown' } }))
        .status,
    ).toBe(404);
    expect(
      (await send('POST', `/api/people/${placeholder}/partners`, { partnerId: p, union: { status: 'unknown' } }))
        .status,
    ).toBe(404);
  });

  it('the stepsister case through Add partner: a full sister, and the mother’s daughter', async () => {
    // The father is added first, then the sister under him alone, then the wife with both parents, then the mother.
    const father = await person('Fred', { gender: 'male' });
    const sister = await person('Sue', { gender: 'female' });
    await linkChild(app.owner, sister, { parent: father });
    const added = await send('POST', `/api/people/${father}/partners`, {
      partner: newPerson('Mona', 'female'),
      union: { status: 'married' },
      linkChildren: [sister],
    });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    const mother = (added.body as { person: { id: string } }).person.id;
    const union = (added.body as { union: { id: string } }).union.id;
    const wife = await person('Wren', { gender: 'female' });
    await linkChild(app.owner, wife, { union });
    expect(await saidBetween(wife, sister)).toBe('Sister');
    expect(await saidBetween(mother, sister)).toBe('Daughter');
    expect(await partnerChildIds2(mother)).toEqual([]);
  });
});

const partnerChildIds2 = async (personId: string): Promise<string[]> =>
  (
    (await send('GET', `/api/people/${personId}`)).body as { partnerChildren: Array<{ child: { id: string } }> }
  ).partnerChildren.map((entry) => entry.child.id);

describe('POST /api/people/:id/parents with linkChildren', () => {
  it('adds a new second parent and links the brothers and sisters ticked, each keeping its kind, on one Unknown relationship', async () => {
    const f = await person('Ford', { gender: 'male' });
    const c = await person('Cleo');
    const s1 = await person('Sib1');
    const s2 = await person('Sib2');
    const s3 = await person('Sib3');
    await linkChild(app.owner, c, { parent: f });
    await linkChild(app.owner, s1, { parent: f });
    await linkChild(app.owner, s2, { parent: f }, 'adoptive');
    await linkChild(app.owner, s3, { parent: f });
    const response = await send('POST', `/api/people/${c}/parents`, {
      parent: newPerson('Newmum', 'female'),
      linkChildren: [s1, s2],
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const mum = (response.body as { person: { id: string } }).person.id;
    const unions = await unionsOf(f, mum);
    expect(unions.map((u) => u.status)).toEqual(['unknown']);
    expect(await setOf(c)).toEqual({ union_id: unions[0]!.id, parent_id: null });
    expect(await setOf(s1)).toEqual({ union_id: unions[0]!.id, parent_id: null });
    expect(await setOf(s2, 'adoptive')).toEqual({ union_id: unions[0]!.id, parent_id: null });
    expect(await setOf(s3)).toEqual({ union_id: null, parent_id: f });
  });

  it('reuses the relationship an existing parent already has with the one on the tree', async () => {
    const f = await person('Finn', { gender: 'male' });
    const m = await person('Maeve', { gender: 'female' });
    const union = await insertUnionRow(app.owner, f, m, 'married');
    const c = await person('Cass');
    const s = await person('Sky');
    await linkChild(app.owner, c, { parent: f });
    await linkChild(app.owner, s, { parent: f });
    const response = await send('POST', `/api/people/${c}/parents`, { parentId: m, linkChildren: [s, c] });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect((await unionsOf(f, m)).map((u) => u.id)).toEqual([union]);
    expect(await setOf(c)).toEqual({ union_id: union, parent_id: null });
    expect(await setOf(s)).toEqual({ union_id: union, parent_id: null });
  });

  it('saves nothing (not the new parent, not the child’s link) when a sibling is refused', async () => {
    const f = await person('Flo');
    const c = await person('Cole');
    const s = await person('Sam');
    const elsewhere = await person('Elsewhere');
    await linkChild(app.owner, c, { parent: f });
    await linkChild(app.owner, s, { union: await insertUnionRow(app.owner, f, elsewhere, 'partner') });
    const response = await send('POST', `/api/people/${c}/parents`, {
      parent: newPerson('Gonemum', 'female'),
      linkChildren: [s],
    });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ error: 'child_not_linkable', childId: s });
    expect(await peopleNamed('Gonemum')).toBe(0);
    expect(await setOf(c)).toEqual({ union_id: null, parent_id: f });
  });

  it('links no other children when the child had no parent of that kind, and asks for exactly one parent', async () => {
    const c = await person('Orphan');
    const s = await person('Other');
    expect(
      (await send('POST', `/api/people/${c}/parents`, { parent: newPerson('First', 'male'), linkChildren: [s] }))
        .status,
    ).toBe(409);
    expect(await peopleNamed('First')).toBe(0);
    expect((await send('POST', `/api/people/${c}/parents`, {})).status).toBe(400);
    // Without linkChildren the new-parent form works as the old two calls did, in one.
    const response = await send('POST', `/api/people/${c}/parents`, { parent: newPerson('Firstdad', 'male') });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(await setOf(c)).toEqual({
      union_id: null,
      parent_id: (response.body as { person: { id: string } }).person.id,
    });
  });
});

describe('placeholders stay out of it', () => {
  it('two sisters through an unknown mother and father read Sister, not Stepsister, and a placeholder is never a result', async () => {
    const wife = await person('Willa', { gender: 'female' });
    const added = await send('POST', `/api/people/${wife}/siblings`, { sibling: newPerson('Sadie', 'female') });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    const body = added.body as { person: { id: string }; placeholders: Array<{ id: string }> };
    expect(await saidBetween(wife, body.person.id)).toBe('Sister');
    const mother = body.placeholders[1]!.id;
    expect((await send('GET', `/api/relationship?a=${wife}&b=${mother}`)).status).toBe(404);
    // An unknown parent has no one-parent children to offer, and is never offered as a partner's child.
    expect(await linkable(mother)).toEqual([]);
  });
});
