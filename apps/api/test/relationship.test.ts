// SPDX-License-Identifier: AGPL-3.0-or-later
//
// GET /api/relationship (ADR 0028): the Hale pairs through the real API and database, half and full, both lineage
// views and the adoption hint, a placeholder hop, custom labels, who may ask, what the body carries, and the errors.
import { createTranslator, en, renderRelName } from '@kinship/shared';
import type { RelationshipResponse } from '@kinship/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieHeader, createTestApp, CSRF, insertUser, login } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';
import { seedHale } from './fixtures/hale-db.js';

const t = createTranslator(en);
let app: TestApp;
let id: Record<string, string>;
let admin: string;
let user: string;

const get = (cookie: string, url: string) => app.app.inject({ method: 'GET', url, headers: { ...CSRF, cookie } });
const ask = async (a: string, b: string, query = '', cookie = admin) => {
  const response = await get(cookie, `/api/relationship?a=${id[a]}&b=${id[b]}${query}`);
  expect(response.statusCode).toBe(200);
  return response.json() as RelationshipResponse;
};
const said = (body: RelationshipResponse): string =>
  body.name ? renderRelName(body.name, t) : 'No relationship found';

beforeAll(async () => {
  app = await createTestApp();
  await insertUser(app.owner, { email: 'admin@example.com', role: 'superadmin' });
  await insertUser(app.owner, { email: 'user@example.com', role: 'user' });
  admin = cookieHeader(await login(app.app, 'admin@example.com'));
  user = cookieHeader(await login(app.app, 'user@example.com'));
  id = await seedHale(app.owner);
}, 60_000);
afterAll(() => app.close());

describe('the Hale pairs through the API', () => {
  it.each([
    ['marcus', 'naomi', 'First cousin'],
    ['leo', 'naomi', 'First cousin once removed'],
    ['marcus', 'lucas', 'Half first cousin'],
    ['leo', 'lucas', 'Half first cousin once removed'],
    ['marcus', 'elise', 'Second cousin'],
    ['leo', 'elise', 'Second cousin once removed'],
    ['marcus', 'paul', 'First cousin once removed'],
    ['marcus', 'samuel', 'Great-uncle'],
    ['marcus', 'ines', 'Half-aunt'],
    ['marcus', 'gabriel', 'Half-brother'],
    ['marcus', 'tomas', 'Stepbrother'],
    ['marcus', 'raymond', 'Stepfather'],
    ['marcus', 'raj', 'Father-in-law'],
    ['priya', 'sofia', 'Sister-in-law'],
    ['walter', 'mia', 'Great-granddaughter'],
    ['leo', 'beatriz', 'Step-grandmother'],
    ['daniel', 'lucia', 'Father’s ex-wife'],
    ['tomas', 'leo', 'Stepbrother’s son'],
  ])('%s to %s reads %s', async (a, b, expected) => {
    expect(said(await ask(a!, b!))).toBe(expected);
  });

  it('carries the shared ancestors, the line down to each person and the people it names', async () => {
    const body = await ask('marcus', 'naomi');
    expect(body.kind).toBe('blood');
    expect(body.blood).toMatchObject({ dA: 2, dB: 2, half: false });
    expect(body.blood!.ancestors.sort()).toEqual([id.walter, id.rosa].sort());
    expect(body.blood!.lineA).toEqual([id.daniel, id.marcus]);
    expect(body.blood!.lineB).toEqual([id.carla, id.naomi]);
    expect(Object.keys(body.people).sort()).toEqual(
      [id.walter, id.rosa, id.daniel, id.marcus, id.carla, id.naomi].sort(),
    );
    expect(body.lineage).toBe('adoptive');
    expect(body.other).toBeNull();
  });

  it('returns the chain for an in-law or step result', async () => {
    const body = await ask('marcus', 'raymond');
    expect(body.kind).toBe('step');
    expect(body.stepTitle).toBe(true);
    expect(body.chain!.people).toEqual([id.marcus, id.elena, id.raymond]);
    expect(body.chain!.links).toHaveLength(2);
    // Up from Marcus to his mother (a direct line), then the marriage.
    expect(body.chain!.hops).toEqual([
      { dA: 1, dB: 0, half: false, ancestors: [id.elena], lineA: [id.marcus], lineB: [] },
      null,
    ]);
  });
});

describe('the shared ancestors of each link in a chain (backlog 9)', () => {
  it('a wife’s brother: the marriage, then the brothers-and-sisters link with both their parents', async () => {
    const body = await ask('marcus', 'arjun');
    expect(said(body)).toBe('Brother-in-law');
    expect(body.chain!.people).toEqual([id.marcus, id.priya, id.arjun]);
    expect(body.chain!.hops[0]).toBeNull();
    const hop = body.chain!.hops[1]!;
    expect(hop).toMatchObject({ dA: 1, dB: 1, half: false, lineA: [id.priya], lineB: [id.arjun] });
    expect(hop.ancestors.sort()).toEqual([id.raj, id.meera].sort());
    // Everyone the diagram draws is in people, and nobody else.
    expect(Object.keys(body.people).sort()).toEqual([id.marcus, id.priya, id.arjun, id.raj, id.meera].sort());
  });

  it('a stepbrother: up to the father, across the marriage, down from the stepmother', async () => {
    const body = await ask('marcus', 'tomas');
    expect(body.chain!.people).toEqual([id.marcus, id.daniel, id.beatriz, id.tomas]);
    expect(body.chain!.hops).toEqual([
      { dA: 1, dB: 0, half: false, ancestors: [id.daniel], lineA: [id.marcus], lineB: [] },
      null,
      { dA: 0, dB: 1, half: false, ancestors: [id.beatriz], lineA: [], lineB: [id.tomas] },
    ]);
  });

  it('an aunt’s ex-husband: the two-generation link through the grandparents, then the former partner', async () => {
    const body = await ask('marcus', 'anthony');
    expect(said(body)).toBe('Aunt’s ex-husband');
    expect(body.kind).toBe('former');
    const hop = body.chain!.hops[0]!;
    expect(hop).toMatchObject({ dA: 2, dB: 1, lineA: [id.daniel, id.marcus], lineB: [id.carla] });
    expect(hop.ancestors.sort()).toEqual([id.walter, id.rosa].sort());
    expect(body.chain!.hops[1]).toBeNull();
    for (const person of [id.walter, id.rosa, id.daniel]) expect(body.people[person!]).toBeDefined();
  });

  it('a stepson: the marriage, then straight down from the husband (a direct line, his only parent drawn)', async () => {
    const body = await ask('beatriz', 'marcus');
    expect(said(body)).toBe('Stepson');
    expect(body.chain!.hops[1]).toMatchObject({ dA: 0, dB: 1, ancestors: [id.daniel], lineB: [id.marcus] });
  });
});

describe('adoption and the lineage view', () => {
  it('follows the viewer’s own setting and the ?lineage= override, and says when the other view has a path', async () => {
    const adoptive = await ask('marcus', 'samuel');
    expect(said(adoptive)).toBe('Great-uncle');
    const birth = await ask('marcus', 'samuel', '&lineage=birth');
    expect(birth.kind).toBe('none');
    expect(birth.other).toBe('adoption');
    expect(birth.lineage).toBe('birth');
    // The account setting is the default when no override is sent
    await sql`update users set lineage_view = 'birth' where email = 'user@example.com'`.execute(app.owner);
    const own = await ask('marcus', 'samuel', '', user);
    expect(own.lineage).toBe('birth');
    expect(own.other).toBe('adoption');
    await sql`update users set lineage_view = 'adoptive' where email = 'user@example.com'`.execute(app.owner);
  });

  it('names adoptive and birth relatives in the closest words', async () => {
    expect(said(await ask('walter', 'samuel'))).toBe('Adoptive brother');
    expect(said(await ask('samuel', 'frank', '&lineage=birth'))).toBe('Birth father');
    expect(said(await ask('marcus', 'frank'))).toBe('No relationship found');
    expect((await ask('marcus', 'frank')).other).toBeNull();
  });
});

describe('unknown parents are a hop, never a result', () => {
  it('finds two siblings through placeholders, and refuses a placeholder as an end', async () => {
    const ph = async (gender: 'male' | 'female') =>
      (
        await sql<{ id: string }>`insert into people (given_name, surname, gender, is_placeholder)
          values ('', '', ${gender}, true) returning id`.execute(app.owner)
      ).rows[0]!.id;
    const father = await ph('male');
    const mother = await ph('female');
    const [lo, hi] = father < mother ? [father, mother] : [mother, father];
    const union = (
      await sql<{ id: string }>`insert into unions (partner_a_id, partner_b_id, status)
        values (${lo}, ${hi}, 'unknown') returning id`.execute(app.owner)
    ).rows[0]!.id;
    id.orphanA = (
      await sql<{
        id: string;
      }>`insert into people (given_name, surname, gender) values ('Ora', 'Test', 'female') returning id`.execute(
        app.owner,
      )
    ).rows[0]!.id;
    id.orphanB = (
      await sql<{
        id: string;
      }>`insert into people (given_name, surname, gender) values ('Otis', 'Test', 'male') returning id`.execute(
        app.owner,
      )
    ).rows[0]!.id;
    for (const child of [id.orphanA!, id.orphanB!]) {
      await sql`insert into person_parents (child_id, union_id, kind) values (${child}, ${union}, 'birth')`.execute(
        app.owner,
      );
    }
    const body = await ask('orphanA', 'orphanB');
    expect(said(body)).toBe('Brother');
    expect(body.blood!.ancestors.sort()).toEqual([father, mother].sort());
    expect(body.people[father]!.isPlaceholder).toBe(true);
    expect((await get(admin, `/api/relationship?a=${id.orphanA}&b=${father}`)).statusCode).toBe(404);
  });
});

describe('custom labels for the pair (ADR 0009)', () => {
  it('returns the labels from the first person’s side, and changes nothing else', async () => {
    const before = await ask('marcus', 'beatriz');
    await sql`insert into relationship_labels (from_id, to_id, label, reverse_label)
      values (${id.marcus}, ${id.beatriz}, 'Godmother', 'Godchild')`.execute(app.owner);
    const from = await ask('marcus', 'beatriz');
    expect(from.labels).toEqual([{ direction: 'from', label: 'Godmother', reverseLabel: 'Godchild' }]);
    const to = await ask('beatriz', 'marcus');
    expect(to.labels).toEqual([{ direction: 'to', label: 'Godmother', reverseLabel: 'Godchild' }]);
    // The derived answer is the same with or without the label
    expect({ ...from, labels: [] }).toEqual(before);
    expect((await ask('marcus', 'sofia')).labels).toEqual([]);
  });
});

describe('who may ask, and what the body carries', () => {
  it('answers a User (read-only) and nobody who is signed out', async () => {
    expect(said(await ask('marcus', 'naomi', '', user))).toBe('First cousin');
    const anonymous = await app.app.inject({
      method: 'GET',
      url: `/api/relationship?a=${id.marcus}&b=${id.naomi}`,
      headers: CSRF,
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it('carries names and years only: no health, DNA, identity, nickname or account data', async () => {
    const response = await get(user, `/api/relationship?a=${id.daniel}&b=${id.marcus}`);
    const body = response.json() as RelationshipResponse;
    const allowed = [
      'id',
      'givenName',
      'surname',
      'secondSurname',
      'marriedSurname',
      'namePrefix',
      'nameSuffix',
      'surnameParticle',
      'gender',
      'birth',
      'deceased',
      'death',
      'isPlaceholder',
      'photoMediaId',
    ].sort();
    for (const person of Object.values(body.people)) expect(Object.keys(person).sort()).toEqual(allowed);
    expect(response.body).not.toMatch(/nickname|Danny|createdAt|email|medical|dna|identity/i);
  });

  it('stays small', async () => {
    const response = await get(admin, `/api/relationship?a=${id.leo}&b=${id.elise}`);
    expect(response.body.length).toBeLessThan(5_000);
  });
});

describe('errors', () => {
  it('answers 404 for a person who does not exist or is not an id', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    expect((await get(admin, `/api/relationship?a=${id.marcus}&b=${missing}`)).statusCode).toBe(404);
    expect((await get(admin, `/api/relationship?a=${missing}&b=${id.marcus}`)).statusCode).toBe(404);
    const notAnId = await get(admin, `/api/relationship?a=${id.marcus}&b=nope`);
    expect(notAnId.statusCode).toBe(404);
    expect(notAnId.json()).toEqual({ error: 'person_not_found' });
  });

  it('answers 400 for a missing person, a bad lineage or an unknown parameter', async () => {
    expect((await get(admin, `/api/relationship?a=${id.marcus}`)).statusCode).toBe(400);
    expect((await get(admin, `/api/relationship?b=${id.marcus}`)).statusCode).toBe(400);
    expect((await get(admin, `/api/relationship?a=${id.marcus}&b=${id.leo}&lineage=both`)).statusCode).toBe(400);
    expect((await get(admin, `/api/relationship?a=${id.marcus}&b=${id.leo}&x=1`)).statusCode).toBe(400);
  });

  it('says "same person" for one person asked twice', async () => {
    const body = await ask('marcus', 'marcus');
    expect(body.kind).toBe('self');
  });
});
