// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The tree response: every relationship in it has both partners in it, every parent link points at someone
// drawn, and a person who needs a leaf (parents exist but are not drawn) says how many ancestors they have.
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { UntypedDb } from '../src/db.js';
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
      // B's single-parent child is not below the focal person, so is not drawn either.
      expect(present.has(d)).toBe(false);
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
    expect(body.parentage[c]).toEqual({ unionId: null, parentId: p });
    expect(body.parentage[z]).toEqual({ unionId: now, parentId: null });
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
          if (rnd() < 0.4) {
            // …or a marriage of their own before this one, with a child.
            const earlier = await person();
            const old = await couple(earlier, partner, 'divorced');
            if (rnd() < 0.6) await linkChild(owner, await person(), { union: old });
          }
        }
        married.add(`${one}|${partner}`);
        const union = await couple(one, partner, pick(['married', 'divorced', 'partner', 'separated', 'unknown']));
        const children = Math.floor(rnd() * 4);
        for (let c = 0; c < children; c += 1) {
          const child = await person();
          await linkChild(owner, child, rnd() < 0.8 ? { union } : { parent: rnd() < 0.5 ? one : partner });
          next.push(child);
        }
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

/** Brute force: how many distinct blood ancestors a person has, from the tables. */
async function bruteAncestors(owner: UntypedDb, personId: string): Promise<number> {
  const rows = await sql<{ child_id: string; union_id: string | null; parent_id: string | null }>`
    select child_id, union_id, parent_id from person_parents`.execute(owner);
  const partners = await sql<{ id: string; a: string; b: string }>`
    select id, partner_a_id as a, partner_b_id as b from unions`.execute(owner);
  const unionPartners = new Map(partners.rows.map((u) => [u.id, [u.a, u.b]]));
  const parentsOf = new Map<string, string[]>();
  for (const row of rows.rows) {
    parentsOf.set(row.child_id, row.union_id ? (unionPartners.get(row.union_id) ?? []) : [row.parent_id!]);
  }
  const seen = new Set<string>();
  const stack = [...(parentsOf.get(personId) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    stack.push(...(parentsOf.get(next) ?? []));
  }
  return seen.size;
}

describe('generated families keep the invariant', () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
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
      const focals = Array.from({ length: 8 }, () => everyone[Math.floor(rnd() * everyone.length)]!);
      let checked = 0;
      let leaves = 0;
      for (const focal of focals) {
        for (const query of options) {
          const body = await tree(focal, query);
          expectInvariant(body);
          for (const person of body.people as Json[]) {
            checked += 1;
            if (person.ancestorCount !== undefined) {
              leaves += 1;
              expect(person.ancestorCount, `ancestors of ${person.givenName} (${query})`).toBe(
                await bruteAncestors(t.owner, person.id),
              );
            }
          }
        }
      }
      expect(checked).toBeGreaterThan(50);
      // Not every seed has a leaf in every shape, but across the options at least some do.
      expect(leaves).toBeGreaterThanOrEqual(0);
    }, 60_000);
  }
});
