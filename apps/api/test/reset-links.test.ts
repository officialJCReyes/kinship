// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Set-password links: an admin lets a locked-out account choose a new password (migration 0011, ADR 0012).
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canMakeSetPasswordLink } from '@kinship/shared';
import type { Role } from '@kinship/shared';
import { withUserTransaction } from '../src/request-context.js';
import { PASSWORD, cookieHeader, createTestApp, login, post } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';
import { ACCOUNTS, buildFamily, signInAll } from './helpers/family.js';
import type { AccountKey, Family, Json, Who } from './helpers/family.js';

let t: TestApp;
let f: Family;
let as: Awaited<ReturnType<typeof signInAll>>;
const NEW = 'a brand new passphrase';

beforeAll(async () => {
  t = await createTestApp();
  f = await buildFamily(t.owner);
  await sql`insert into family_tree (id, name) values (true, 'Hale Family')`.execute(t.owner);
  as = await signInAll(t.app, f);
});
afterAll(() => t.close());

const ROLE: Record<AccountKey, Role> = {
  superadmin: 'superadmin',
  familyadmin: 'familyadmin',
  member: 'member',
  unlinked: 'member',
  user: 'user',
};
const asUser = <T>(userId: string | null, fn: Parameters<typeof withUserTransaction<T>>[2]) =>
  withUserTransaction(t.db, userId, fn);
const link = (who: Who, target: AccountKey) =>
  as(who, 'POST', `/api/admin/accounts/${f.account[target].id}/set-password-link`);
const lookup = (token: string) => post(t.app, '/api/links/lookup', { token });
const accept = (token: string, password = NEW) => post(t.app, '/api/links/accept', { token, password });
const clearLinks = () => sql`delete from account_links where kind = 'reset'`.execute(t.owner);

describe('who may make a set-password link for whom', () => {
  const callers: Who[] = ['anonymous', ...ACCOUNTS];
  for (const caller of callers) {
    for (const target of ACCOUNTS) {
      // Computed from the rule table in packages/shared, with stand-in ids (the real ones exist only after beforeAll).
      const allowed =
        caller !== 'anonymous' &&
        canMakeSetPasswordLink({ id: caller, role: ROLE[caller] }, { id: target, role: ROLE[target] });
      it(`${caller} for ${target}: ${allowed ? 'allowed' : 'refused'} (API and database)`, async () => {
        const callerAccount = caller === 'anonymous' ? null : { id: f.account[caller].id, role: ROLE[caller] };
        await clearLinks();
        const response = await link(caller, target);
        if (allowed) expect(response.status).toBe(201);
        else if (caller === 'anonymous') expect(response.status).toBe(401);
        else expect(response.status).toBe(403);
        if (!allowed && caller !== 'anonymous') {
          expect(response.body?.['error']).toBe(
            ['superadmin', 'familyadmin'].includes(ROLE[caller]) ? 'role_not_allowed' : 'forbidden',
          );
        }
        await clearLinks();
        const direct = asUser(callerAccount?.id ?? null, (trx) =>
          sql`select * from kinship_auth.create_reset_link(${f.account[target].id}::uuid, ${`hash-${caller}-${target}`})`.execute(
            trx,
          ),
        );
        if (allowed) await expect(direct).resolves.toBeDefined();
        else await expect(direct).rejects.toThrow(/forbidden|role_not_allowed/);
        await clearLinks();
      });
    }
  }

  it('is never for yourself, even for a SuperAdmin (a locked-out SuperAdmin uses the command)', async () => {
    expect(await link('superadmin', 'superadmin')).toMatchObject({ status: 403, body: { error: 'role_not_allowed' } });
  });

  it('answers 404 for an account that does not exist', async () => {
    const response = await as(
      'superadmin',
      'POST',
      '/api/admin/accounts/00000000-0000-4000-8000-000000000000/set-password-link',
    );
    expect(response).toMatchObject({ status: 404, body: { error: 'account_not_found' } });
    expect((await as('superadmin', 'POST', '/api/admin/accounts/nope/set-password-link')).status).toBe(404);
  });

  it('a Family Admin cannot regenerate or revoke a link a SuperAdmin made for a Family Admin', async () => {
    await clearLinks();
    const other = await sql<{ id: string }>`
      insert into users (email, display_name, password_hash, role) values ('fa2@example.com', 'Second Admin', 'h', 'familyadmin') returning id`.execute(
      t.owner,
    );
    const made = await as('superadmin', 'POST', `/api/admin/accounts/${other.rows[0]!.id}/set-password-link`);
    expect(made.status).toBe(201);
    const id = made.body?.['linkId'];
    expect(await as('familyadmin', 'POST', `/api/admin/links/${id}/regenerate`)).toMatchObject({
      status: 403,
      body: { error: 'role_not_allowed' },
    });
    expect(await as('familyadmin', 'POST', `/api/admin/links/${id}/revoke`)).toMatchObject({ status: 403 });
    const accounts = (await as('familyadmin', 'GET', '/api/admin/accounts')).body!['accounts'] as Json[];
    const row = accounts.find((a) => a['id'] === other.rows[0]!.id);
    expect(row).toMatchObject({ canSetPasswordLink: false, setPasswordLink: { canManage: false } });
    expect((await as('superadmin', 'POST', `/api/admin/links/${id}/revoke`)).status).toBe(204);
    await sql`delete from users where id = ${other.rows[0]!.id}`.execute(t.owner);
  });
});

describe('a set-password link', () => {
  it('lasts 24 hours, names the account and nothing more, and shows on the Users page', async () => {
    await clearLinks();
    const made = await link('familyadmin', 'user');
    expect(made.body).toMatchObject({ kind: 'reset' });
    const hours = (new Date(made.body?.['expiresAt'] as string).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);
    const info = await lookup(made.body?.['token'] as string);
    expect(info.statusCode).toBe(200);
    expect(info.json()).toMatchObject({ kind: 'reset', treeName: 'Hale Family', displayName: 'user' });
    expect(JSON.stringify(info.json())).not.toMatch(/user@example|email/);
    const accounts = (await as('superadmin', 'GET', '/api/admin/accounts')).body!['accounts'] as Json[];
    expect(accounts.find((a) => a['id'] === f.account.user.id)).toMatchObject({
      setPasswordLink: { id: made.body?.['linkId'], expired: false, canManage: true },
      canSetPasswordLink: true,
    });
    expect(accounts.filter((a) => a['kind'] === 'invitation')).toHaveLength(0); // it is not an invitation
    const stored = await sql<{
      token_hash: string;
    }>`select token_hash from account_links where id = ${made.body?.['linkId'] as string}`.execute(t.owner);
    expect(stored.rows[0]?.token_hash).not.toBe(made.body?.['token']);
    expect(stored.rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('allows one open link per account: a second is refused, and a new link replaces the first', async () => {
    await clearLinks();
    const first = await link('superadmin', 'member');
    expect(await link('familyadmin', 'member')).toMatchObject({ status: 409, body: { error: 'link_exists' } });
    const next = await as('familyadmin', 'POST', `/api/admin/links/${first.body?.['linkId']}/regenerate`);
    expect(next.status).toBe(200);
    expect(next.body).toMatchObject({ kind: 'reset', linkId: first.body?.['linkId'] });
    expect((await accept(first.body?.['token'] as string)).statusCode).toBe(404);
    expect((await lookup(next.body?.['token'] as string)).statusCode).toBe(200);
    expect((await as('superadmin', 'POST', `/api/admin/links/${next.body?.['linkId']}/revoke`)).status).toBe(204);
    expect((await lookup(next.body?.['token'] as string)).statusCode).toBe(404);
    expect((await link('superadmin', 'member')).status).toBe(201); // after a revoke a new one can be made
    await clearLinks();
  });

  it('changes the password, records admin_link, signs the account out everywhere and in on this browser', async () => {
    await clearLinks();
    const email = f.account.user.email;
    const old1 = cookieHeader(await login(t.app, email));
    const old2 = cookieHeader(await login(t.app, email));
    const bystander = cookieHeader(await login(t.app, f.account.member.email));
    const made = await link('superadmin', 'user');

    const done = await accept(made.body?.['token'] as string);
    expect(done.statusCode).toBe(201);
    expect(done.headers['cache-control']).toBe('no-store');
    expect((done.json() as Json)['user']).toMatchObject({ email, role: 'user' });
    const cookie = cookieHeader(done);
    const probe = (c: string) => t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: c } });
    expect((await probe(cookie)).statusCode).toBe(200);
    expect((await probe(old1)).statusCode).toBe(401);
    expect((await probe(old2)).statusCode).toBe(401);
    expect((await probe(bystander)).statusCode).toBe(200);
    expect((await login(t.app, email, PASSWORD)).statusCode).toBe(401);
    expect((await login(t.app, email, NEW)).statusCode).toBe(200);
    const row = await sql<{
      password_changed_via: string;
      password_changed_at: Date;
    }>`select password_changed_via, password_changed_at from users where id = ${f.account.user.id}`.execute(t.owner);
    expect(row.rows[0]?.password_changed_via).toBe('admin_link');
    expect(row.rows[0]?.password_changed_at).toBeInstanceOf(Date);
    // The owner of the account sees the trace; nothing else changed.
    const mine = await t.app.inject({ method: 'GET', url: '/api/admin/accounts', headers: { cookie } });
    expect(mine.statusCode).toBe(403);
  });

  it('works once, and every bad link looks the same (unknown, used, revoked, expired)', async () => {
    await clearLinks();
    const used = await link('superadmin', 'unlinked');
    expect((await accept(used.body?.['token'] as string)).statusCode).toBe(201);
    const revoked = await link('superadmin', 'user');
    await as('superadmin', 'POST', `/api/admin/links/${revoked.body?.['linkId']}/revoke`);
    const expired = await link('superadmin', 'member');
    await sql`update account_links set expires_at = now() - interval '1 second' where id = ${expired.body?.['linkId'] as string}`.execute(
      t.owner,
    );
    const tokens = ['never-issued', used.body?.['token'], revoked.body?.['token'], expired.body?.['token']] as string[];
    const answers = [];
    for (const token of tokens) {
      const [a, b] = [await lookup(token), await accept(token)];
      answers.push({ lookup: [a.statusCode, a.body], accept: [b.statusCode, b.body] });
    }
    for (const answer of answers) expect(answer).toEqual(answers[0]);
    expect(answers[0]?.lookup).toEqual([404, JSON.stringify({ error: 'invalid_link' })]);
  });

  it('an expired link does not block a new one, and a regenerated expired one works again', async () => {
    await clearLinks();
    const old = await link('superadmin', 'member');
    await sql`update account_links set expires_at = now() - interval '1 minute' where id = ${old.body?.['linkId'] as string}`.execute(
      t.owner,
    );
    const accounts = (await as('superadmin', 'GET', '/api/admin/accounts')).body!['accounts'] as Json[];
    expect(accounts.find((a) => a['id'] === f.account.member.id)?.['setPasswordLink']).toMatchObject({ expired: true });
    const fresh = await link('familyadmin', 'member');
    expect(fresh.status).toBe(201);
    expect((await lookup(fresh.body?.['token'] as string)).statusCode).toBe(200);
    await sql`update account_links set expires_at = now() - interval '1 minute' where id = ${fresh.body?.['linkId'] as string}`.execute(
      t.owner,
    );
    const again = await as('superadmin', 'POST', `/api/admin/links/${fresh.body?.['linkId']}/regenerate`);
    expect((await accept(again.body?.['token'] as string)).statusCode).toBe(201);
  });

  it('refuses a short password without using the link up', async () => {
    await clearLinks();
    const made = await link('superadmin', 'unlinked');
    expect(await accept(made.body?.['token'] as string, 'short')).toMatchObject({ statusCode: 400 });
    expect((await accept(made.body?.['token'] as string)).statusCode).toBe(201);
  });

  it('ten accepts at once change the password once and sign in once', async () => {
    await clearLinks();
    const made = await link('superadmin', 'member');
    const results = await Promise.all(Array.from({ length: 10 }, () => accept(made.body?.['token'] as string)));
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    const refused = results.filter((r) => r.statusCode !== 201);
    expect(refused).toHaveLength(9);
    for (const r of refused) expect([r.statusCode, r.body]).toEqual([404, JSON.stringify({ error: 'invalid_link' })]);
  });

  it('the two kinds of link stay apart: accepting an invitation changes nobody else’s password', async () => {
    await clearLinks();
    const invite = await as('superadmin', 'POST', '/api/admin/invitations', {
      email: 'kind@hale.example',
      role: 'user',
    });
    const lookedUp = (await lookup(invite.body?.['token'] as string)).json() as Json;
    expect(lookedUp['kind']).toBe('invite');
    const reset = await link('superadmin', 'user');
    expect(((await lookup(reset.body?.['token'] as string)).json() as Json)['kind']).toBe('reset');
    const before = await sql<{ n: string }>`select count(*) as n from users`.execute(t.owner);
    // Accepting the invitation makes an account and does not touch anyone's password.
    expect(
      (
        await post(t.app, '/api/links/accept', {
          token: invite.body?.['token'],
          password: NEW,
          displayName: 'Kind Test',
        })
      ).statusCode,
    ).toBe(201);
    const after = await sql<{ n: string }>`select count(*) as n from users`.execute(t.owner);
    expect(Number(after.rows[0]?.n)).toBe(Number(before.rows[0]?.n) + 1);
    expect((await login(t.app, f.account.user.email, NEW)).statusCode).toBe(200); // set by the earlier test's link
    await clearLinks();
  });

  it('goes away with the account', async () => {
    await clearLinks();
    const doomed = await sql<{
      id: string;
    }>`insert into users (email, display_name, password_hash, role) values ('doomed@example.com', 'Doomed', 'h', 'user') returning id`.execute(
      t.owner,
    );
    const made = await as('superadmin', 'POST', `/api/admin/accounts/${doomed.rows[0]!.id}/set-password-link`);
    expect(made.status).toBe(201);
    await sql`delete from users where id = ${doomed.rows[0]!.id}`.execute(t.owner);
    expect((await lookup(made.body?.['token'] as string)).statusCode).toBe(404);
  });
});
