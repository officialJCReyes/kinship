// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Delete an account (#56, migration 0019, ADR 0029): only a disabled one, only with its email typed, the person and their
// record kept, created_by emptied, the accepted invitation (which holds the email) removed, the email free to invite again,
// the hierarchy, the last SuperAdmin, and a log line with ids only. Fictional Hale family only.
import { Writable } from 'node:stream';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { canDisableAccount } from '@kinship/shared';
import type { Role } from '@kinship/shared';
import { cookieHeader, createTestApp, insertUser, login } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';
import { ACCOUNTS, buildFamily, signInAll } from './helpers/family.js';
import type { AccountKey, Family, Who } from './helpers/family.js';

let t: TestApp;
let f: Family;
let as: Awaited<ReturnType<typeof signInAll>>;
const logged: string[] = [];

const ROLE: Record<AccountKey, Role> = {
  superadmin: 'superadmin',
  familyadmin: 'familyadmin',
  member: 'member',
  unlinked: 'member',
  user: 'user',
};
const NOBODY = '00000000-0000-4000-8000-000000000000';

beforeAll(async () => {
  const logStream = new Writable({ write: (chunk: Buffer, _enc, done) => (logged.push(chunk.toString()), done()) });
  t = await createTestApp({ logLevel: 'info', logStream });
  f = await buildFamily(t.owner);
  await sql`insert into family_tree (id, name) values (true, 'Hale Family')`.execute(t.owner);
  as = await signInAll(t.app, f);
});
afterAll(() => t.close());

beforeEach(() => {
  logged.length = 0;
});

let seq = 0;
/** A throwaway disabled account of this role (the Family's own accounts are kept for the matrix and the sessions). */
async function victim(role: Role, disabled = true) {
  const email = `gone${++seq}@example.com`;
  const id = await insertUser(t.owner, { email, role });
  if (disabled) await sql`update users set disabled_at = now() where id = ${id}`.execute(t.owner);
  return { id, email };
}
const remove = (who: Who, id: string, confirmEmail: string) =>
  as(who, 'POST', `/api/admin/accounts/${id}/delete`, { confirmEmail });
const exists = async (id: string) =>
  (await sql`select 1 from users where id = ${id}`.execute(t.owner)).rows.length === 1;

describe('who may delete whom', () => {
  const callers: Who[] = ['anonymous', ...ACCOUNTS];
  for (const caller of callers) {
    for (const role of ['superadmin', 'familyadmin', 'member', 'user'] as Role[]) {
      const allowed =
        caller !== 'anonymous' && canDisableAccount({ id: caller, role: ROLE[caller] }, { id: 'x', role });
      it(`${caller} for a disabled ${role}: ${allowed ? 'allowed' : 'refused'}`, async () => {
        // a second active SuperAdmin exists in this test only so the guard never decides the matrix
        const spare =
          role === 'superadmin'
            ? await insertUser(t.owner, { email: `spare${++seq}@example.com`, role: 'superadmin' })
            : null;
        const target = await victim(role);
        const response = await remove(caller, target.id, target.email);
        const admin = caller === 'superadmin' || caller === 'familyadmin';
        if (allowed) {
          expect(response.status).toBe(204);
          expect(await exists(target.id)).toBe(false);
        } else {
          expect(response.status).toBe(caller === 'anonymous' ? 401 : 403);
          if (caller !== 'anonymous') expect(response.body?.['error']).toBe(admin ? 'role_not_allowed' : 'forbidden');
          expect(await exists(target.id)).toBe(true);
        }
        if (spare) await sql`delete from users where id = ${spare}`.execute(t.owner);
        await sql`delete from users where id = ${target.id}`.execute(t.owner);
      });
    }
  }

  it('nobody deletes their own account', async () => {
    for (const who of ['superadmin', 'familyadmin'] as const) {
      expect(await remove(who, f.account[who].id, f.account[who].email)).toMatchObject({
        status: 403,
        body: { error: 'self_not_allowed' },
      });
      expect(await exists(f.account[who].id)).toBe(true);
    }
  });

  it('a Family Admin cannot reach above the ceiling: another Family Admin or a SuperAdmin, disabled or not', async () => {
    const fa = await victim('familyadmin');
    expect(await remove('familyadmin', fa.id, fa.email)).toMatchObject({
      status: 403,
      body: { error: 'role_not_allowed' },
    });
    const live = await victim('familyadmin', false);
    expect(await remove('familyadmin', live.id, live.email)).toMatchObject({
      status: 403,
      body: { error: 'role_not_allowed' },
    });
    expect(await remove('familyadmin', f.account.superadmin.id, f.account.superadmin.email)).toMatchObject({
      status: 403,
      body: { error: 'role_not_allowed' },
    });
    expect(await exists(fa.id)).toBe(true);
    await sql`delete from users where id in (${fa.id}, ${live.id})`.execute(t.owner);
  });
});

describe('the order and the checks', () => {
  it('a live account is 409 account_not_disabled (the matrix first), a wrong email is 400 confirmation_mismatch', async () => {
    const live = await victim('member', false);
    expect(await remove('superadmin', live.id, live.email)).toMatchObject({
      status: 409,
      body: { error: 'account_not_disabled' },
    });
    const gone = await victim('member');
    expect(await remove('superadmin', gone.id, 'someone-else@example.com')).toMatchObject({
      status: 400,
      body: { error: 'confirmation_mismatch' },
    });
    expect(await remove('superadmin', gone.id, '')).toMatchObject({
      status: 400,
      body: { error: 'confirmation_mismatch' },
    });
    expect(await exists(gone.id)).toBe(true);
    // trimmed, ignoring case
    expect((await remove('superadmin', gone.id, `  ${gone.email.toUpperCase()}  `)).status).toBe(204);
    await sql`delete from users where id = ${live.id}`.execute(t.owner);
  });

  it('unknown and malformed accounts, bad bodies; there is no DELETE route that would put the email in a URL', async () => {
    expect(await remove('superadmin', NOBODY, 'x@example.com')).toMatchObject({
      status: 404,
      body: { error: 'account_not_found' },
    });
    expect((await remove('superadmin', 'nope', 'x@example.com')).status).toBe(404);
    expect((await as('superadmin', 'POST', `/api/admin/accounts/${NOBODY}/delete`, {})).status).toBe(400);
    expect((await as('superadmin', 'DELETE', `/api/admin/accounts/${f.account.member.id}?confirmEmail=x`)).status).toBe(
      404,
    );
    expect(await exists(f.account.member.id)).toBe(true);
  });

  it('the only active SuperAdmin cannot be deleted by any route', async () => {
    expect(await remove('superadmin', f.account.superadmin.id, f.account.superadmin.email)).toMatchObject({
      status: 403,
      body: { error: 'self_not_allowed' },
    });
    expect(await remove('familyadmin', f.account.superadmin.id, f.account.superadmin.email)).toMatchObject({
      status: 403,
      body: { error: 'role_not_allowed' },
    });
    await expect(sql`delete from users where id = ${f.account.superadmin.id}`.execute(t.owner)).rejects.toMatchObject({
      code: 'KS044',
    });
    expect(await exists(f.account.superadmin.id)).toBe(true);
  });
});

describe('what a delete removes and what it keeps', () => {
  it('keeps the person and their record, empties created_by, drops the accepted invitation, and frees the email', async () => {
    const gone = await victim('member');
    await sql`update users set person_id = ${f.person.priya} where id = ${gone.id}`.execute(t.owner);
    await sql`update people set created_by = ${gone.id} where id = ${f.person.leo}`.execute(t.owner);
    await sql`update unions set created_by = ${gone.id} where id = ${f.union.marcusPriya}`.execute(t.owner);
    await sql`insert into account_links (kind, token_hash, expires_at, created_by, email, role, accepted_at, accepted_user_id)
              values ('invite', 'inv-acc', now() + interval '7 days', ${f.account.superadmin.id}, ${gone.email}, 'member', now(), ${gone.id})`.execute(
      t.owner,
    );
    await sql`insert into account_links (kind, token_hash, expires_at, created_by, user_id)
              values ('reset', 'reset-open', now() + interval '1 day', ${f.account.superadmin.id}, ${gone.id})`.execute(
      t.owner,
    );
    // an invitation this account made stays, and its "invited by" goes blank
    await sql`insert into account_links (kind, token_hash, expires_at, created_by, email, role)
              values ('invite', 'inv-open', now() + interval '7 days', ${gone.id}, 'later@example.com', 'user')`.execute(
      t.owner,
    );
    const cookie = cookieHeader(await login(t.app, f.account.user.email)); // someone else, unaffected
    const before = Number((await sql<{ n: string }>`select count(*) as n from people`.execute(t.owner)).rows[0]!.n);

    expect((await remove('superadmin', gone.id, gone.email)).status).toBe(204);

    expect(await exists(gone.id)).toBe(false);
    expect(Number((await sql<{ n: string }>`select count(*) as n from people`.execute(t.owner)).rows[0]!.n)).toBe(
      before,
    );
    const people = await sql<{
      id: string;
      created_by: string | null;
    }>`select id, created_by from people where id in (${f.person.priya}, ${f.person.leo})`.execute(t.owner);
    expect(people.rows).toHaveLength(2);
    expect(people.rows.every((p) => p.created_by === null)).toBe(true);
    expect(
      (
        await sql<{
          created_by: string | null;
        }>`select created_by from unions where id = ${f.union.marcusPriya}`.execute(t.owner)
      ).rows[0]!.created_by,
    ).toBeNull();
    const links = await sql<{
      token_hash: string;
      created_by: string | null;
    }>`select token_hash, created_by from account_links order by token_hash`.execute(t.owner);
    expect(links.rows).toEqual([{ token_hash: 'inv-open', created_by: null }]);
    expect((await t.app.inject({ url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(200);

    // the email is free for a new invitation, and the person can be linked to a new account again
    const invite = await as('superadmin', 'POST', '/api/admin/invitations', {
      email: gone.email,
      role: 'user',
      personId: f.person.priya,
    });
    expect(invite.status).toBe(201);
    await sql`delete from account_links`.execute(t.owner);
  });

  it('the deleted account’s session stays dead', async () => {
    const gone = await victim('user', false);
    const cookie = cookieHeader(await login(t.app, gone.email));
    expect((await as('superadmin', 'POST', `/api/admin/accounts/${gone.id}/disable`)).status).toBe(200);
    expect((await remove('superadmin', gone.id, gone.email)).status).toBe(204);
    expect((await t.app.inject({ url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(401);
    expect((await login(t.app, gone.email)).statusCode).toBe(401);
  });

  it('writes one log line with ids only: no email, no name', async () => {
    const gone = await victim('user');
    expect((await remove('superadmin', gone.id, gone.email)).status).toBe(204);
    const lines = logged
      .filter((l) => l.includes('account_deleted'))
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ event: 'account_deleted', actor: f.account.superadmin.id, account: gone.id });
    expect(logged.join('')).not.toContain(gone.email);
    expect(logged.join('')).not.toContain('confirmEmail');
  });
});

describe('the delete preview', () => {
  it('counts the people the account added, follows the same hierarchy, and says whether it is disabled', async () => {
    const gone = await victim('member', false);
    await sql`update people set created_by = ${gone.id} where id in (${f.person.leo}, ${f.person.sofia})`.execute(
      t.owner,
    );
    expect((await as('superadmin', 'GET', `/api/admin/accounts/${gone.id}/delete-preview`)).body).toEqual({
      accountId: gone.id,
      role: 'member',
      disabled: false,
      peopleAdded: 2,
    });
    await sql`update users set disabled_at = now() where id = ${gone.id}`.execute(t.owner);
    expect((await as('familyadmin', 'GET', `/api/admin/accounts/${gone.id}/delete-preview`)).body).toMatchObject({
      disabled: true,
      peopleAdded: 2,
    });
    expect((await as('member', 'GET', `/api/admin/accounts/${gone.id}/delete-preview`)).status).toBe(403);
    expect((await as('anonymous', 'GET', `/api/admin/accounts/${gone.id}/delete-preview`)).status).toBe(401);
    expect(
      await as('familyadmin', 'GET', `/api/admin/accounts/${f.account.superadmin.id}/delete-preview`),
    ).toMatchObject({
      status: 403,
      body: { error: 'role_not_allowed' },
    });
    expect(
      await as('superadmin', 'GET', `/api/admin/accounts/${f.account.superadmin.id}/delete-preview`),
    ).toMatchObject({
      status: 403,
      body: { error: 'self_not_allowed' },
    });
    expect((await as('superadmin', 'GET', `/api/admin/accounts/${NOBODY}/delete-preview`)).status).toBe(404);
    await sql`update people set created_by = null where id in (${f.person.leo}, ${f.person.sofia})`.execute(t.owner);
    await sql`delete from users where id = ${gone.id}`.execute(t.owner);
  });

  it('the accounts list says which accounts may be deleted: only disabled ones, within the hierarchy', async () => {
    const gone = await victim('member');
    const rows = (await as('familyadmin', 'GET', '/api/admin/accounts')).body!['accounts'] as Array<
      Record<string, unknown>
    >;
    expect(rows.find((r) => r['id'] === gone.id)).toMatchObject({ canDelete: true, status: 'disabled' });
    expect(rows.find((r) => r['id'] === f.account.user.id)).toMatchObject({ canDelete: false });
    expect(rows.find((r) => r['id'] === f.account.superadmin.id)).toMatchObject({ canDelete: false });
    await sql`delete from users where id = ${gone.id}`.execute(t.owner);
  });
});
