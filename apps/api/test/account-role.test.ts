// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Change an account's role (#57, migration 0019, ADR 0029): who may, every refusal and its code, a stale page, an effect that
// is immediate, the log line, and the shared rule agreeing with the database function. Fictional Hale family only.
import { Writable } from 'node:stream';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { canChangeRole, rolesSettableBy } from '@kinship/shared';
import type { Role } from '@kinship/shared';
import { createTestApp, insertUser } from './helpers/app.js';
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
const ROLES: Role[] = ['superadmin', 'familyadmin', 'member', 'user'];
const NOBODY = '00000000-0000-4000-8000-000000000000';

beforeAll(async () => {
  const logStream = new Writable({ write: (chunk: Buffer, _enc, done) => (logged.push(chunk.toString()), done()) });
  t = await createTestApp({ logLevel: 'info', logStream });
  f = await buildFamily(t.owner);
  await sql`insert into family_tree (id, name) values (true, 'Hale Family')`.execute(t.owner);
  as = await signInAll(t.app, f);
});
afterAll(() => t.close());

/** The Family's accounts back to their own roles. */
beforeEach(async () => {
  for (const key of ACCOUNTS)
    await sql`update users set role = ${ROLE[key]} where id = ${f.account[key].id}`.execute(t.owner);
  logged.length = 0;
});

const idOf = (target: AccountKey | string) => (target in f.account ? f.account[target as AccountKey].id : target);
const patch = (who: Who, target: AccountKey | string, role: string, currentRole?: string) =>
  as(who, 'PATCH', `/api/admin/accounts/${idOf(target)}/role`, {
    role,
    currentRole: currentRole ?? (target in f.account ? ROLE[target as AccountKey] : 'member'),
  });
const roleOf = async (key: AccountKey | string) =>
  (await sql<{ role: string }>`select role from users where id = ${idOf(key)}`.execute(t.owner)).rows[0]!.role;

describe('who may change whose role (the API, the shared rule and the database agree)', () => {
  const callers: Who[] = ['anonymous', ...ACCOUNTS];
  for (const caller of callers) {
    for (const target of ACCOUNTS) {
      for (const next of ROLES) {
        const allowed =
          caller !== 'anonymous' &&
          canChangeRole({ id: caller, role: ROLE[caller] }, { id: target, role: ROLE[target] }, next);
        it(`${caller} sets ${target} (${ROLE[target]}) to ${next}: ${allowed ? 'allowed' : 'refused'}`, async () => {
          const response = await patch(caller, target, next);
          const admin = caller === 'superadmin' || caller === 'familyadmin';
          if (allowed) {
            expect(response.status).toBe(200);
            expect(response.body).toEqual({ accountId: f.account[target].id, role: next, previous: ROLE[target] });
            expect(await roleOf(target)).toBe(next);
          } else {
            expect(response.status).toBe(caller === 'anonymous' ? 401 : 403);
            if (caller !== 'anonymous') {
              const self = caller === target;
              expect(response.body?.['error']).toBe(
                !admin ? 'forbidden' : self ? 'self_not_allowed' : 'role_not_allowed',
              );
            }
            expect(await roleOf(target)).toBe(ROLE[target]);
          }
        });
      }
    }
  }

  it('the database function gives the same answer as the shared rule for every pair of roles', async () => {
    for (const actorRole of ROLES) {
      for (const targetRole of ROLES) {
        for (const next of ROLES) {
          const shared = canChangeRole({ id: 'a', role: actorRole }, { id: 'b', role: targetRole }, next);
          const db = (
            await sql<{
              ok: boolean;
            }>`select kinship_auth.can_change_role_for(${actorRole}, ${targetRole}, ${next}) as ok`.execute(t.owner)
          ).rows[0]!.ok;
          // the database function does not know about "self", the shared one does: compare with different ids
          expect(
            db && (actorRole === 'superadmin' || actorRole === 'familyadmin'),
            `${actorRole} ${targetRole} ${next}`,
          ).toBe(shared && (actorRole === 'superadmin' || actorRole === 'familyadmin'));
        }
      }
    }
  });
});

describe('the ceiling and the refusals', () => {
  it('a Family Admin cannot make a Family Admin, touch another Family Admin, touch a SuperAdmin, or demote themselves', async () => {
    expect(await patch('familyadmin', 'member', 'familyadmin')).toMatchObject({
      status: 403,
      body: { error: 'role_not_allowed' },
    });
    expect(await patch('familyadmin', 'user', 'familyadmin')).toMatchObject({
      status: 403,
      body: { error: 'role_not_allowed' },
    });
    const other = await insertUser(t.owner, { email: 'other-fa@example.com', role: 'familyadmin' });
    expect(await patch('familyadmin', other, 'member', 'familyadmin')).toMatchObject({
      status: 403,
      body: { error: 'role_not_allowed' },
    });
    expect(await patch('familyadmin', 'superadmin', 'member', 'superadmin')).toMatchObject({
      status: 403,
      body: { error: 'role_not_allowed' },
    });
    expect(await patch('familyadmin', 'familyadmin', 'member')).toMatchObject({
      status: 403,
      body: { error: 'self_not_allowed' },
    });
    expect(await roleOf(other)).toBe('familyadmin');
  });

  it('nobody can set SuperAdmin, and a SuperAdmin account is never the target in 0.3', async () => {
    expect(await patch('superadmin', 'member', 'superadmin')).toMatchObject({
      status: 403,
      body: { error: 'role_not_allowed' },
    });
    const second = await insertUser(t.owner, { email: 'second-sa@example.com', role: 'superadmin' });
    expect(await patch('superadmin', second, 'member', 'superadmin')).toMatchObject({
      status: 403,
      body: { error: 'role_not_allowed' },
    });
    expect(await patch('superadmin', 'superadmin', 'member')).toMatchObject({
      status: 403,
      body: { error: 'self_not_allowed' },
    });
    expect(await roleOf(second)).toBe('superadmin');
    await sql`delete from users where id = ${second}`.execute(t.owner);
  });

  it('a stale page is 409 account_role_changed and changes nothing; the same role is a quiet no-op', async () => {
    expect(await patch('superadmin', 'member', 'user', 'user')).toMatchObject({
      status: 409,
      body: { error: 'account_role_changed' },
    });
    expect(await roleOf('member')).toBe('member');
    logged.length = 0;
    expect(await patch('superadmin', 'member', 'member')).toMatchObject({
      status: 200,
      body: { role: 'member', previous: 'member' },
    });
    expect(logged.join('')).not.toContain('account_role_changed');
  });

  it('unknown and malformed accounts, bad bodies', async () => {
    expect(await patch('superadmin', NOBODY, 'user')).toMatchObject({
      status: 404,
      body: { error: 'account_not_found' },
    });
    expect((await patch('superadmin', 'not-a-uuid', 'user')).status).toBe(404);
    expect((await patch('superadmin', 'member', 'boss')).status).toBe(400);
    expect(
      (await as('superadmin', 'PATCH', `/api/admin/accounts/${f.account.member.id}/role`, { role: 'user' })).status,
    ).toBe(400);
  });

  it('is allowed on a disabled account', async () => {
    await sql`update users set disabled_at = now() where id = ${f.account.user.id}`.execute(t.owner);
    expect((await patch('familyadmin', 'user', 'member')).status).toBe(200);
    await sql`update users set disabled_at = null where id = ${f.account.user.id}`.execute(t.owner);
  });
});

describe('what a role change does', () => {
  it('applies at once, in the account’s own session: no sign-out is needed', async () => {
    // The Family Admin is demoted: the very next request with their cookie is refused as a non-admin.
    expect((await as('familyadmin', 'GET', '/api/admin/accounts')).status).toBe(200);
    expect((await patch('superadmin', 'familyadmin', 'member')).status).toBe(200);
    expect((await as('familyadmin', 'GET', '/api/admin/accounts')).status).toBe(403);
    expect((await as('familyadmin', 'GET', '/api/auth/me')).body?.['user']?.role).toBe('member');
    // and a User made Member can edit their own person at once
    expect((await as('user', 'GET', '/api/auth/me')).body?.['user']?.role).toBe('user');
    expect((await patch('familyadmin', 'user', 'member')).status).toBe(403); // the demoted admin can no longer do it
    expect((await patch('superadmin', 'user', 'member')).status).toBe(200);
    expect((await as('user', 'GET', '/api/auth/me')).body?.['user']?.role).toBe('member');
  });

  it('writes one log line with ids and role codes only', async () => {
    expect((await patch('superadmin', 'member', 'user')).status).toBe(200);
    const lines = logged
      .filter((line) => line.includes('account_role_changed'))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      event: 'account_role_changed',
      actor: f.account.superadmin.id,
      account: f.account.member.id,
      from: 'member',
      to: 'user',
    });
    const text = JSON.stringify(lines[0]);
    expect(text).not.toContain('@');
    expect(text).not.toContain('Hale');
  });

  it('the accounts list tells each admin which roles they may set', async () => {
    const asSuper = (await as('superadmin', 'GET', '/api/admin/accounts')).body!['accounts'] as Array<
      Record<string, unknown>
    >;
    const asFamily = (await as('familyadmin', 'GET', '/api/admin/accounts')).body!['accounts'] as Array<
      Record<string, unknown>
    >;
    const pick = (rows: Array<Record<string, unknown>>, key: AccountKey) =>
      rows.find((row) => row['id'] === f.account[key].id)!['allowedRoles'];
    expect(pick(asSuper, 'member')).toEqual(['familyadmin', 'member', 'user']);
    expect(pick(asSuper, 'superadmin')).toEqual([]);
    expect(pick(asFamily, 'member')).toEqual(['member', 'user']);
    expect(pick(asFamily, 'familyadmin')).toEqual([]);
    expect(pick(asFamily, 'superadmin')).toEqual([]);
    expect(rolesSettableBy({ id: 'x', role: 'superadmin' }, { id: 'y', role: 'user' })).toEqual([
      'familyadmin',
      'member',
      'user',
    ]);
  });
});
