// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The tree response: every relationship in it has both partners in it, every parent link points at someone
// drawn, and a person who needs a leaf (parents exist but are not drawn) says how many ancestors they have.
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { UntypedDb } from '../src/db.js';
import { countPeople } from '../src/people/store.js';
import { withUserTransaction } from '../src/request-context.js';
import { createTestApp } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';
import { buildFamily, insertPersonRow, insertUnionRow, linkChild, signInAll } from './helpers/family.js';
import type { Family, Json } from './helpers/family.js';

let t: TestApp;
let f: Family;
let as: Awaited<ReturnType<typeof signInAll>>;

beforeAll(async () => {
  t = await createTestApp();
  f = await buildFamily(t.owner);
  as = await signInAll(t.app, f);
}, 60_000);
afterAll(() => t.close());

const tree = async (focal: string, query = 'up=3&down=2&collateral=true'): Promise<Json> => {
  const response = await as('user', 'GET', `/api/tree/${focal}?${query}`);
  expect(response.status).toBe(200);
  return response.body as Json;
};

describe('totalPeople, for the chart counter', () => {
  it('is everyone the viewer may see, and leaves placeholders out', async () => {
    const real = Number(
      (await sql<{ n: string }>`select count(*) as n from people where not is_placeholder`.execute(t.owner)).rows[0]!.n,
    );
    expect((await tree(f.person.marcus)).totalPeople).toBe(real);
    await sql`insert into people (given_name, surname, gender, is_placeholder) values ('', '', 'male', true)`.execute(
      t.owner,
    );
    const body = await tree(f.person.marcus);
    expect(body.totalPeople).toBe(real);
    expect(body.people.length).toBeLessThanOrEqual(body.totalPeople + 1);
    // Every role reads the same number, a smaller drawing does not change it.
    for (const who of ['member', 'familyadmin', 'unlinked'] as const) {
      const r = await as(who, 'GET', `/api/tree/${f.person.leo}?up=0&down=0`);
      expect(r.body?.totalPeople, who).toBe(real);
      expect(r.body?.people.length).toBeLessThan(real);
    }
  });

  it('counts only what row-level security shows: an account that does not exist sees none', async () => {
    const n = await withUserTransaction(t.db, '00000000-0000-4000-8000-000000000000', async (trx) => {
      return countPeople(trx);
    });
    expect(n).toBe(0);
  });
});

const idsOf = (body: Json) => (body.people as Json[]).map((x) => x.id as string);

/** Everything a chart relies on, checked against the people the response itself contains. */
function expectInvariant(body: Json): void {
  const ids = new Set<string>(body.people.map((p: Json) => p.id));
  const unionIds = new Set<string>();
  for (const union of body.unions as Json[]) {
    unionIds.add(union.id);
    expect(ids.has(union.partnerIds[0]), `partner ${union.partnerIds[0]} of ${union.id} is drawn`).toBe(true);
    expect(ids.has(union.partnerIds[1]), `partner ${union.partnerIds[1]} of ${union.id} is drawn`).toBe(true);
  }
  for (const [child, link] of Object.entries(body.parentage as Record<string, Json>)) {
    expect(ids.has(child), `child ${child} is drawn`).toBe(true);
    expect((link.unionId === null) !== (link.parentId === null), 'exactly one of unionId and parentId').toBe(true);
    if (link.unionId !== null) expect(unionIds.has(link.unionId), 'the union a child hangs from is drawn').toBe(true);
    if (link.parentId !== null) expect(ids.has(link.parentId), 'the parent a child hangs from is drawn').toBe(true);
  }
  for (const person of body.people as Json[]) {
    const needsLeaf = person.hasParents && body.parentage[person.id] === undefined;
    expect(person.ancestorCount !== undefined, `ancestorCount only for ${person.id} when it needs a leaf`).toBe(
      needsLeaf,
    );
  }
}

describe('a remarried in-law (the bug found with a probe)', () => {
  // Marcus's partner B was married to X1 and to X2 before. Whichever of the three was created first, the
  // chart must not get a line to somebody who is not on it, and must not lose a line between two who are.
  for (const order of ['in-law first', 'in-law last']) {
    it(`draws only relationships between people it returns (${order})`, async () => {
      const make = (name: string) => insertPersonRow(t.owner, name, `Probe${order.length}`, { gender: 'female' });
      let b: string, x1: string, x2: string, d: string;
      if (order === 'in-law first') {
        b = await make('B');
        x1 = await make('X1');
        x2 = await make('X2');
        d = await make('D');
      } else {
        x1 = await make('X1');
        x2 = await make('X2');
        d = await make('D');
        b = await make('B');
      }
      const parent = await insertPersonRow(t.owner, 'Parent', `Probe${order.length}`);
      const mine = await insertUnionRow(t.owner, parent, b, 'married');
      const childOfMine = await insertPersonRow(t.owner, 'Child', `Probe${order.length}`);
      await linkChild(t.owner, childOfMine, { union: mine });
      const old1 = await insertUnionRow(t.owner, x1, b, 'divorced');
      const old2 = await insertUnionRow(t.owner, b, x2, 'divorced');
      // A child of one of the earlier marriages, and a single-parent child of B.
      const half = await insertPersonRow(t.owner, 'Half', `Probe${order.length}`);
      await linkChild(t.owner, half, { union: old1 });
      await linkChild(t.owner, d, { parent: b });
      void old2;

      const body = await tree(parent, 'up=0&down=2&collateral=false');
      expectInvariant(body);
      const present = new Set<string>(body.people.map((p: Json) => p.id));
      expect(present.has(b)).toBe(true);
      expect(present.has(x1)).toBe(false);
      expect(present.has(x2)).toBe(false);
      expect(body.unions.map((u: Json) => u.id)).toEqual([mine]);
      // B's own children by people who are not drawn come along, hanging from B alone (one hop).
      expect(present.has(d)).toBe(true);
      expect(present.has(half)).toBe(true);
      expect(body.parentage[d]).toMatchObject({ unionId: null, parentId: b });
      expect(body.parentage[half]).toMatchObject({ unionId: null, parentId: b });
    });
  }

  it('keeps the child of a union with a missing partner, hanging from the drawn partner alone', async () => {
    // F is married to P. F's child Z marries C, who is P's child from an earlier union with Q (step-siblings).
    // Drawn from F, one generation down: P and C are drawn only as partners, and Q is not drawn at all.
    const mk = (n: string) => insertPersonRow(t.owner, n, 'Step');
    const [f1, p, q, z, c] = [await mk('F'), await mk('P'), await mk('Q'), await mk('Z'), await mk('C')];
    const now = await insertUnionRow(t.owner, f1, p, 'married');
    const before = await insertUnionRow(t.owner, p, q, 'divorced');
    await linkChild(t.owner, z, { union: now });
    await linkChild(t.owner, c, { union: before });
    await insertUnionRow(t.owner, z, c, 'married');

    const body = await tree(f1, 'up=0&down=1&collateral=false');
    expectInvariant(body);
    const present = new Set<string>(body.people.map((x: Json) => x.id));
    expect(present.has(c)).toBe(true);
    expect(present.has(q)).toBe(false);
    expect(body.unions.map((u: Json) => u.id)).not.toContain(before);
    expect(body.parentage[c]).toMatchObject({ unionId: null, parentId: p });
    expect(body.parentage[z]).toMatchObject({ unionId: now, parentId: null });
  });
});

describe("a partner's own children (issue #22)", () => {
  it('draws Tomas, Beatriz’s son from before, hanging from her alone, and nothing of his own', async () => {
    // Tomas has a partner and a child: they are not part of the one hop.
    const zoe = await insertPersonRow(t.owner, 'Zoe', 'Navarro');
    const kid = await insertPersonRow(t.owner, 'Zed', 'Navarro');
    const tomasUnion = await insertUnionRow(t.owner, f.person.tomas, zoe, 'married');
    await linkChild(t.owner, kid, { union: tomasUnion });
    const body = await tree(f.person.marcus);
    expectInvariant(body);
    expect(body.parentage[f.person.tomas]).toMatchObject({ unionId: null, parentId: f.person.beatriz });
    const ids = idsOf(body);
    expect(ids).not.toContain(zoe);
    expect(ids).not.toContain(kid);
  });

  it('includes children of a partner and an undrawn ex, hanging from the partner alone; the ex stays undrawn', async () => {
    const focal = await insertPersonRow(t.owner, 'Fia', 'Lone');
    const partner = await insertPersonRow(t.owner, 'Pat', 'Lone');
    const ex = await insertPersonRow(t.owner, 'Ex', 'Lone');
    const child = await insertPersonRow(t.owner, 'Cleo', 'Lone');
    await insertUnionRow(t.owner, focal, partner, 'married');
    const old = await insertUnionRow(t.owner, ex, partner, 'divorced');
    await linkChild(t.owner, child, { union: old });
    const body = await tree(focal, 'up=0&down=0&collateral=false');
    expectInvariant(body);
    expect(idsOf(body).sort()).toEqual([focal, partner, child].sort());
    expect(body.parentage[child]).toMatchObject({ unionId: null, parentId: partner });
    expect(body.unions).toHaveLength(1);
  });

  it('leaves the children of a drawn couple to the walk, so the down limit holds', async () => {
    const focal = await insertPersonRow(t.owner, 'Gil', 'Limit');
    const kid = await insertPersonRow(t.owner, 'Kai', 'Limit');
    const inLaw = await insertPersonRow(t.owner, 'Ina', 'Limit');
    const grandchild = await insertPersonRow(t.owner, 'Gus', 'Limit');
    const apart = await insertPersonRow(t.owner, 'Abe', 'Limit');
    await linkChild(t.owner, kid, { parent: focal });
    const couple = await insertUnionRow(t.owner, kid, inLaw, 'married');
    await linkChild(t.owner, grandchild, { union: couple });
    await linkChild(t.owner, apart, { parent: inLaw });
    const body = await tree(focal, 'up=0&down=1&collateral=false');
    expectInvariant(body);
    expect(idsOf(body)).toContain(apart);
    expect(idsOf(body)).not.toContain(grandchild);
  });

  it('draws a union between two in-laws, and follows the viewer’s family for an adopted-away child', async () => {
    const focal = await insertPersonRow(t.owner, 'Hal', 'Two');
    const a = await insertPersonRow(t.owner, 'Ann', 'Two');
    const b = await insertPersonRow(t.owner, 'Bob', 'Two');
    const c = await insertPersonRow(t.owner, 'Cat', 'Two');
    await insertUnionRow(t.owner, focal, a, 'married');
    await insertUnionRow(t.owner, focal, b, 'married');
    // Ann and Bob had a child together; Ann had Cat alone, but Cat was adopted by two people not on the chart.
    const ab = await insertUnionRow(t.owner, a, b, 'divorced');
    const abKid = await insertPersonRow(t.owner, 'Dot', 'Two');
    await linkChild(t.owner, abKid, { union: ab });
    const adopter1 = await insertPersonRow(t.owner, 'Ada', 'Two');
    const adopter2 = await insertPersonRow(t.owner, 'Aldo', 'Two');
    await linkChild(t.owner, c, { parent: a });
    await linkChild(t.owner, c, { union: await insertUnionRow(t.owner, adopter1, adopter2, 'married') }, 'adoptive');
    const adoptive = await tree(focal, 'up=0&down=0&collateral=false&lineage=adoptive');
    expectInvariant(adoptive);
    expect(adoptive.parentage[abKid]).toMatchObject({ unionId: ab });
    expect(idsOf(adoptive)).not.toContain(c); // in the adoptive view Cat belongs to her adoptive parents
    const birth = await tree(focal, 'up=0&down=0&collateral=false&lineage=birth');
    expectInvariant(birth);
    expect(birth.parentage[c]).toMatchObject({ unionId: null, parentId: a, kind: 'birth' });
    expect(birth.parentage[abKid]).toMatchObject({ unionId: ab });
  });
});

describe('ancestorCount', () => {
  it('counts every known blood ancestor of an in-law whose parents are not drawn', async () => {
    // Priya is Marcus's partner. Give her two parents and one grandparent couple on one side (4 + 2 = 6… as built below).
    const priya = f.person.priya;
    const raj = await insertPersonRow(t.owner, 'Raj', 'Nair', { gender: 'male' });
    const meera = await insertPersonRow(t.owner, 'Meera', 'Iyer', { gender: 'female' });
    const hari = await insertPersonRow(t.owner, 'Hari', 'Nair', { gender: 'male' });
    const lakshmi = await insertPersonRow(t.owner, 'Lakshmi', 'Nair', { gender: 'female' });
    const rajParents = await insertUnionRow(t.owner, hari, lakshmi, 'married');
    await linkChild(t.owner, raj, { union: rajParents });
    const priyaParents = await insertUnionRow(t.owner, raj, meera, 'married');
    await linkChild(t.owner, priya, { union: priyaParents });

    const body = await tree(f.person.marcus, 'up=3&down=2&collateral=true');
    expectInvariant(body);
    const byId = new Map<string, Json>(body.people.map((p: Json) => [p.id, p]));
    expect(byId.get(priya)?.hasParents).toBe(true);
    expect(body.parentage[priya]).toBeUndefined();
    expect(byId.get(priya)?.ancestorCount).toBe(4); // Raj, Meera, Hari, Lakshmi
    // Marcus's own parents are drawn, so no count and no leaf.
    expect(byId.get(f.person.marcus)?.ancestorCount).toBeUndefined();
    // Raj is not drawn at all.
    expect(byId.has(raj)).toBe(false);
  });

  it('counts a shared ancestor once (cousins who married)', async () => {
    const mk = (n: string) => insertPersonRow(t.owner, n, 'Cousin');
    const [gp1, gp2, a, b, wifeOfA, husbandOfB, c1, c2] = [
      await mk('Gp1'),
      await mk('Gp2'),
      await mk('A'),
      await mk('B'),
      await mk('WifeOfA'),
      await mk('HusbandOfB'),
      await mk('C1'),
      await mk('C2'),
    ];
    const gp = await insertUnionRow(t.owner, gp1, gp2, 'married');
    await linkChild(t.owner, a, { union: gp });
    await linkChild(t.owner, b, { union: gp });
    const ua = await insertUnionRow(t.owner, a, wifeOfA, 'married');
    const ub = await insertUnionRow(t.owner, b, husbandOfB, 'married');
    await linkChild(t.owner, c1, { union: ua });
    await linkChild(t.owner, c2, { union: ub });
    const cousinsUnion = await insertUnionRow(t.owner, c1, c2, 'married');
    const kid = await mk('Kid');
    await linkChild(t.owner, kid, { union: cousinsUnion });
    // From Kid, only one generation up: C1 and C2 are drawn, their parents are not.
    const body = await tree(kid, 'up=1&down=0&collateral=false');
    expectInvariant(body);
    const byId = new Map<string, Json>(body.people.map((p: Json) => [p.id, p]));
    // C1: A, WifeOfA, Gp1, Gp2 = 4.  C2: B, HusbandOfB, Gp1, Gp2 = 4.
    expect(byId.get(c1)?.ancestorCount).toBe(4);
    expect(byId.get(c2)?.ancestorCount).toBe(4);
  });
});

// --- generated families --------------------------------------------------------------------------

function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A family with the awkward cases mixed in: in-laws with their own parents, in-laws with earlier marriages
 * (some with children), people who remarry two or three times, single-parent children, and cousins who marry.
 */
async function generateFamily(owner: UntypedDb, seed: number): Promise<string[]> {
  const rnd = random(seed);
  const pick = <T>(list: T[]): T => list[Math.floor(rnd() * list.length)]!;
  const surname = `Gen${seed}`;
  let counter = 0;
  const everyone: string[] = [];
  const person = async (): Promise<string> => {
    counter += 1;
    const id = await insertPersonRow(owner, `P${counter}`, surname, {
      gender: rnd() < 0.5 ? 'male' : 'female',
      birth: String(1900 + Math.floor(counter / 3)),
    });
    everyone.push(id);
    return id;
  };
  const couple = async (a: string, b: string, status = 'married'): Promise<string> =>
    insertUnionRow(owner, a, b, status);

  const unionLog: Array<{ id: string; level: number }> = [];
  let generation: string[] = [await person(), await person(), await person(), await person()];
  for (let level = 0; level < 4; level += 1) {
    const next: string[] = [];
    const married = new Set<string>();
    for (const one of generation) {
      const howMany = rnd() < 0.55 ? 1 + Math.floor(rnd() * 3) : 0; // up to three unions: remarriage
      for (let n = 0; n < howMany; n += 1) {
        // Partner: an existing person of this generation (cousins marry), or an in-law.
        let partner: string;
        const candidates = generation.filter(
          (g) => g !== one && !(married.has(`${one}|${g}`) || married.has(`${g}|${one}`)),
        );
        if (candidates.length > 0 && rnd() < 0.25) {
          partner = pick(candidates);
        } else {
          partner = await person();
          if (rnd() < 0.5) {
            // The in-law has parents of their own (not drawn from our side)…
            const mum = await person();
            const dad = await person();
            const parents = await couple(mum, dad);
            await linkChild(owner, partner, { union: parents });
            if (rnd() < 0.5) await linkChild(owner, await person(), { union: parents }); // …and a sibling
          }
          if (rnd() < 0.3) await linkChild(owner, await person(), { parent: partner }); // …a child of their own…
          if (rnd() < 0.4) {
            // …or a marriage of their own before this one, with a child.
            const earlier = await person();
            const old = await couple(earlier, partner, 'divorced');
            if (rnd() < 0.6) await linkChild(owner, await person(), { union: old });
          }
        }
        married.add(`${one}|${partner}`);
        const union = await couple(one, partner, pick(['married', 'divorced', 'partner', 'separated', 'unknown']));
        unionLog.push({ id: union, level });
        const children = Math.floor(rnd() * 4);
        for (let c = 0; c < children; c += 1) {
          const child = await person();
          await linkChild(owner, child, rnd() < 0.8 ? { union } : { parent: rnd() < 0.5 ? one : partner });
          next.push(child);
          // Some children are also (or only) adopted, by another couple of the same generation.
          if (rnd() < 0.2) {
            const others = unionLog.filter((x) => x.level === level && x.id !== union);
            if (others.length > 0) {
              try {
                await linkChild(owner, child, { union: pick(others).id }, 'adoptive', String(1950 + level));
              } catch {
                // the same person in both sets is refused by the database: that is the rule under test elsewhere
              }
            }
          }
        }
      }
      if (rnd() < 0.15) {
        const adopted = await person(); // adopted, with no birth parents recorded
        await linkChild(owner, adopted, { parent: one }, 'adoptive');
        next.push(adopted);
      }
      if (rnd() < 0.25) {
        const solo = await person(); // a single-parent child
        await linkChild(owner, solo, { parent: one });
        next.push(solo);
      }
    }
    generation = next.length > 0 ? next : [await person()];
  }
  return everyone;
}

interface LinkRow {
  child_id: string;
  kind: string;
  union_id: string | null;
  parent_id: string | null;
}

/** Brute force from the tables: the parents of each child in one view, and each child's other set. */
async function loadLinks(owner: UntypedDb) {
  const rows = await sql<LinkRow>`select child_id, kind, union_id, parent_id from person_parents`.execute(owner);
  const partners = await sql<{ id: string; a: string; b: string }>`
    select id, partner_a_id as a, partner_b_id as b from unions`.execute(owner);
  const unionPartners = new Map(partners.rows.map((x) => [x.id, [x.a, x.b]]));
  const setOf = (row: LinkRow) => (row.union_id ? (unionPartners.get(row.union_id) ?? []) : [row.parent_id!]);
  const byChild = new Map<string, LinkRow[]>();
  for (const row of rows.rows) byChild.set(row.child_id, [...(byChild.get(row.child_id) ?? []), row]);
  const effective = (child: string, view: string): string[] => {
    const mine = byChild.get(child) ?? [];
    const kind = view === 'adoptive' && mine.some((r) => r.kind === 'adoptive') ? 'adoptive' : 'birth';
    const row = mine.find((r) => r.kind === kind);
    return row ? setOf(row) : [];
  };
  const ancestors = (starts: string[], view: string): Set<string> => {
    const seen = new Set<string>();
    const stack = [...starts];
    while (stack.length > 0) {
      const next = stack.pop()!;
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(...effective(next, view));
    }
    return seen;
  };
  const other = (child: string, view: string): { kind: string; parents: string[] } | undefined => {
    const mine = byChild.get(child) ?? [];
    const kind = view === 'adoptive' && mine.some((r) => r.kind === 'adoptive') ? 'adoptive' : 'birth';
    const row = mine.find((r) => r.kind !== kind);
    return row ? { kind: row.kind, parents: setOf(row) } : undefined;
  };
  return { effective, ancestors, other };
}

let adoptedSeen = 0;

describe('generated families keep the invariant', () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
  const lineages = ['adoptive', 'birth'];
  const options = [
    'up=0&down=0&collateral=false',
    'up=1&down=1&collateral=false',
    'up=1&down=2&collateral=true',
    'up=3&down=2&collateral=true',
    'up=3&down=1&collateral=true',
    'up=10&down=10&collateral=true',
  ];
  for (const seed of seeds) {
    it(`family ${seed}`, async () => {
      const everyone = await generateFamily(t.owner, seed);
      const rnd = random(seed * 7919);
      const focals = Array.from({ length: 6 }, () => everyone[Math.floor(rnd() * everyone.length)]!);
      const brute = await loadLinks(t.owner);
      let checked = 0;
      let others = 0;
      for (const focal of focals) {
        for (const query of options) {
          for (const lineage of lineages) {
            const body = await tree(focal, `${query}&lineage=${lineage}`);
            expect(body.lineage).toBe(lineage);
            expectInvariant(body);
            for (const person of body.people as Json[]) {
              checked += 1;
              // every parent link follows the view
              const followed = brute.effective(person.id, lineage);
              expect(person.hasParents, `${person.id} hasParents (${lineage})`).toBe(followed.length > 0);
              const link = body.parentage[person.id];
              if (link) {
                const drawn = link.unionId
                  ? (body.unions as Json[]).find((x) => x.id === link.unionId)!.partnerIds
                  : [link.parentId];
                expect(drawn.every((id: string) => followed.includes(id))).toBe(true);
              }
              if (person.ancestorCount !== undefined) {
                expect(person.ancestorCount, `ancestors of ${person.givenName} (${query}, ${lineage})`).toBe(
                  brute.ancestors(followed, lineage).size,
                );
              }
              const other = brute.other(person.id, lineage);
              if (other) {
                others += 1;
                expect(person.otherFamily, `otherFamily of ${person.givenName} (${lineage})`).toEqual({
                  kind: other.kind,
                  count: brute.ancestors(other.parents, lineage).size,
                });
              } else {
                expect(person.otherFamily).toBeUndefined();
              }
            }
          }
        }
      }
      expect(checked).toBeGreaterThan(50);
      adoptedSeen += others;
    }, 120_000);
  }
  it('the generated families really contained adopted people (otherwise the checks above prove nothing)', () => {
    expect(adoptedSeen).toBeGreaterThan(20);
  });
});

describe("a brother's or sister's partner (the chart draws them; the family view trims client-side)", () => {
  for (const lineage of ['birth', 'adoptive']) {
    it(`returns the sibling's partner and their children, not the partner's parents (${lineage} view)`, async () => {
      const mk = (n: string) => insertPersonRow(t.owner, n, 'Sibpartner');
      const [dad, mum, me, sib, spouse, spouseDad, spouseMum, niece] = [
        await mk('Dad'),
        await mk('Mum'),
        await mk('Me'),
        await mk('Sib'),
        await mk('Spouse'),
        await mk('SpouseDad'),
        await mk('SpouseMum'),
        await mk('Niece'),
      ];
      const parents = await insertUnionRow(t.owner, dad, mum, 'married');
      await linkChild(t.owner, me, { union: parents });
      await linkChild(t.owner, sib, { union: parents });
      const couple = await insertUnionRow(t.owner, sib, spouse, 'married');
      await linkChild(t.owner, niece, { union: couple });
      const inLaws = await insertUnionRow(t.owner, spouseDad, spouseMum, 'married');
      await linkChild(t.owner, spouse, { union: inLaws });

      const body = await tree(me, `up=3&down=2&collateral=true&lineage=${lineage}`);
      expectInvariant(body);
      const present = new Set<string>(body.people.map((p: Json) => p.id));
      expect(present.has(sib)).toBe(true);
      expect(present.has(spouse)).toBe(true);
      expect(present.has(niece)).toBe(true);
      expect(body.unions.map((u: Json) => u.id)).toContain(couple);
      expect(body.parentage[niece]).toMatchObject({ unionId: couple });
      // The partner's parents stay out; the partner gets a leaf with their count.
      expect(present.has(spouseDad)).toBe(false);
      expect(present.has(spouseMum)).toBe(false);
      expect(body.parentage[spouse]).toBeUndefined();
      const spouseRow = body.people.find((p: Json) => p.id === spouse);
      expect(spouseRow.hasParents).toBe(true);
      expect(spouseRow.ancestorCount).toBe(2);
    });
  }
});
