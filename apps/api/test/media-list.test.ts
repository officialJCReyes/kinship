// SPDX-License-Identifier: AGPL-3.0-or-later
//
// GET /api/media: the family-wide photo list (step 37e). Paged, newest first, filtered by person, the same rows for every signed-in
// role (row-level security), with each photo's permissions for the asking account and the names of the people it shows.
import { randomBytes } from 'node:crypto';
import { MEDIA_PAGE_SIZE } from '@kinship/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';
import { ACCOUNTS, buildFamily, signInAll } from './helpers/family.js';
import type { Family, Json, Who } from './helpers/family.js';

let t: TestApp;
let family: Family;
let as: Awaited<ReturnType<typeof signInAll>>;
const TOTAL = 75;

/** Inserts a photo row (no files: this test is about the list) and links it to people, as the owner. */
async function addRow(personIds: string[], uploadedBy: string | null): Promise<string> {
  const hex = () => randomBytes(16).toString('hex');
  const row = await sql<{ id: string }>`
    insert into media_files (storage_id, avatar_storage_id, mime, size, avatar_size, width, height, key_id, uploaded_by)
    values (${hex()}, ${hex()}, 'image/png', 100, 50, 64, 48, '0123456789abcdef', ${uploadedBy}) returning id`.execute(
    t.owner,
  );
  const id = row.rows[0]!.id;
  for (const person of personIds)
    await sql`insert into media_people (media_id, person_id) values (${id}, ${person})`.execute(t.owner);
  return id;
}

const ids: string[] = []; // oldest first

beforeAll(async () => {
  t = await createTestApp();
  family = await buildFamily(t.owner);
  as = await signInAll(t.app, family);
  for (let i = 0; i < TOTAL; i++) {
    // Mostly Marcus (the Member's own person), some Sofia, a few both, one of nobody.
    const who =
      i % 10 === 0
        ? [family.person.marcus, family.person.sofia]
        : i % 3 === 0
          ? [family.person.sofia]
          : [family.person.marcus];
    ids.push(await addRow(who, i % 2 === 0 ? family.account.member.id : family.account.superadmin.id));
  }
  ids.push(await addRow([], null));
}, 120_000);

afterAll(() => t.close());

describe('GET /api/media', () => {
  it('pages 60 at a time, newest first, with no photo twice and none missed', async () => {
    const first = await as('user', 'GET', '/api/media');
    expect(first.status).toBe(200);
    const page1 = first.body!['items'] as Json[];
    expect(page1).toHaveLength(MEDIA_PAGE_SIZE);
    expect(first.body!['nextCursor']).toBe(page1.at(-1)!['id']);
    const second = await as('user', 'GET', `/api/media?cursor=${first.body!['nextCursor'] as string}`);
    const page2 = second.body!['items'] as Json[];
    expect(page2).toHaveLength(ids.length - MEDIA_PAGE_SIZE);
    expect(second.body!['nextCursor']).toBeNull();
    const all = [...page1, ...page2].map((p) => p['id'] as string);
    expect(all).toEqual([...ids].reverse());
  });

  it('is the same list for every signed-in role, and refused to the signed-out (photos of living people included)', async () => {
    const seen: string[][] = [];
    for (const who of ACCOUNTS) {
      const response = await as(who, 'GET', '/api/media');
      expect(response.status, who).toBe(200);
      seen.push((response.body!['items'] as Json[]).map((p) => p['id'] as string));
    }
    for (const list of seen) expect(list).toEqual(seen[0]);
    expect((await as('anonymous' as Who, 'GET', '/api/media')).status).toBe(401);
  });

  it('filters by person, and says who each photo shows, by name', async () => {
    const sofia = await as('user', 'GET', `/api/media?person=${family.person.sofia}`);
    const items = sofia.body!['items'] as Json[];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      const shows = item['shows'] as Json[];
      expect(shows.map((p) => p['id'])).toContain(family.person.sofia);
      expect([...(item['people'] as string[])].sort()).toEqual(shows.map((p) => p['id'] as string).sort());
      for (const p of shows) expect(p).toMatchObject({ givenName: expect.any(String), surname: expect.any(String) });
    }
    // A photo of two people lists both, and a photo of nobody appears only in the unfiltered list.
    const both = items.find((p) => (p['shows'] as Json[]).length === 2)!;
    expect((both['shows'] as Json[]).map((p) => p['givenName']).sort()).toEqual(['Marcus', 'Sofia']);
    expect(
      ((await as('user', 'GET', '/api/media')).body!['items'] as Json[]).some(
        (p) => (p['shows'] as Json[]).length === 0,
      ),
    ).toBe(true);
    const nobody = await as('user', 'GET', `/api/media?person=${family.person.leo}`);
    expect(nobody.body).toEqual({ items: [], nextCursor: null });
  });

  it('carries the permissions of the asking account on each photo, as the person list does', async () => {
    const mine = (account: 'superadmin' | 'member' | 'user' | 'unlinked') =>
      as(account, 'GET', `/api/media?person=${family.person.marcus}`).then((r) => r.body!['items'] as Json[]);
    const asUser = await mine('user');
    expect(
      asUser.every(
        (p) => (p['permissions'] as Json)['edit'] === false && (p['permissions'] as Json)['delete'] === false,
      ),
    ).toBe(true);
    const asAdmin = await mine('superadmin');
    expect(
      asAdmin.every(
        (p) => (p['permissions'] as Json)['edit'] === true && (p['permissions'] as Json)['delete'] === true,
      ),
    ).toBe(true);
    // The Member can change Marcus (their own person), but delete only what they uploaded themselves.
    const asMember = await mine('member');
    for (const p of asMember) {
      expect((p['permissions'] as Json)['edit']).toBe(true);
      expect((p['permissions'] as Json)['delete']).toBe(p['uploadedBy'] === family.account.member.id);
    }
    // A Member linked to nobody can change only what they uploaded: none of these.
    expect((await mine('unlinked')).every((p) => (p['permissions'] as Json)['edit'] === false)).toBe(true);
  });

  it('answers the same as the person list for one person (same photos, same permissions)', async () => {
    const family1 = await as('member', 'GET', `/api/people/${family.person.sofia}/photos`);
    const list = await as('member', 'GET', `/api/media?person=${family.person.sofia}`);
    const strip = (items: Json[]) =>
      items
        .map((item) => Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'shows')))
        .sort((a, b) => (a['id'] < b['id'] ? 1 : -1));
    expect(strip(list.body!['items'] as Json[])).toEqual(strip(family1.body!['items'] as Json[]));
  });

  it('refuses a person or a cursor that is not an id', async () => {
    expect((await as('user', 'GET', '/api/media?person=nope')).status).toBe(404);
    expect((await as('user', 'GET', '/api/media?cursor=nope')).body).toEqual({ error: 'invalid_cursor' });
    expect((await as('user', 'GET', '/api/media?other=1')).status).toBe(400);
  });
});
