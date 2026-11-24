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
  const body = (await send('GET', `/api/people/${id[who]}`)).body as { partnerChildren: Array<{ child: { id: string } }> };
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
