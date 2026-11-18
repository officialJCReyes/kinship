// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Link an existing account to a person (#8, migration 0016, ADR 0020): who may, every refusal, the Member's edit rights
// really changing, the log line, and the placeholder fix in create_invitation. Fictional Hale family only.
import { Writable } from 'node:stream';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { canLinkPerson } from '@kinship/shared';
import type { Role } from '@kinship/shared';
import { withUserTransaction } from '../src/request-context.js';
import { createTestApp } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';
import { ACCOUNTS, buildFamily, insertPersonRow, signInAll } from './helpers/family.js';
import type { AccountKey, Family, Who } from './helpers/family.js';

let t: TestApp;
let f: Family;
let as: Awaited<ReturnType<typeof signInAll>>;
const logged: string[] = [];
let placeholder: string;
const makePlaceholder = async () =>
  (
    await sql<{ id: string }>`
      insert into people (given_name, surname, gender, is_placeholder) values ('', '', 'male', true) returning id`.execute(
      t.owner,
    )
  ).rows[0]!.id;

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

/** Back to the family's own state: only the Member account is linked (to Marcus), no invitations. */
beforeEach(async () => {
  await sql`update users set person_id = null`.execute(t.owner);
  await sql`update users set person_id = ${f.person.marcus} where id = ${f.account.member.id}`.execute(t.owner);
  await sql`delete from account_links`.execute(t.owner);
  logged.length = 0;
  // An unknown parent with no relationship is removed by a person delete (ADR 0019), so each test gets its own.
  await sql`delete from people where is_placeholder`.execute(t.owner);
  placeholder = await makePlaceholder();
});

const put = (who: Who, target: AccountKey | string, personId: string, currentPersonId: string | null = null) =>
  as(who, 'PUT', `/api/admin/accounts/${target in f.account ? f.account[target as AccountKey].id : target}/person`, {
    personId,
    currentPersonId,
  });
const unlink = (who: Who, target: AccountKey | string, current: string) =>
  as(
    who,
    'DELETE',
    `/api/admin/accounts/${target in f.account ? f.account[target as AccountKey].id : target}/person?currentPersonId=${current}`,
  );
const preview = (who: Who, target: AccountKey | string, personId: string) =>
  as(
    who,
    'GET',
    `/api/admin/accounts/${target in f.account ? f.account[target as AccountKey].id : target}/link-preview?personId=${personId}`,
  );
const personOf = async (key: AccountKey) =>
  (
    await sql<{ person_id: string | null }>`select person_id from users where id = ${f.account[key].id}`.execute(
      t.owner,
    )
  ).rows[0]!.person_id;
const asUser = <T>(userId: string | null, fn: Parameters<typeof withUserTransaction<T>>[2]) =>
  withUserTransaction(t.db, userId, fn);

describe('who may link whom (API and database agree with the shared rule)', () => {
  const callers: Who[] = ['anonymous', ...ACCOUNTS];
  for (const caller of callers) {
    for (const target of ACCOUNTS) {
      const allowed =
        caller !== 'anonymous' && canLinkPerson({ id: caller, role: ROLE[caller] }, { id: target, role: ROLE[target] });
      it(`${caller} for ${target}: ${allowed ? 'allowed' : 'refused'}`, async () => {
        // A person nobody is linked to: Priya (the `member` account is on Marcus, so use a different person per target).
        const person = f.person.priya;
        await sql`update users set person_id = null where id = ${f.account[target].id}`.execute(t.owner);
        const response = await put(caller, target, person);
        if (allowed) expect(response.status).toBe(200);
        else if (caller === 'anonymous') expect(response.status).toBe(401);
        else expect(response.status).toBe(403);
        if (!allowed && caller !== 'anonymous') {
          expect(response.body?.['error']).toBe(
            ROLE[caller] === 'superadmin' || ROLE[caller] === 'familyadmin' ? 'role_not_allowed' : 'forbidden',
          );
          expect(await personOf(target)).toBeNull();
        } else if (allowed) {
          expect(await personOf(target)).toBe(person);
        }
        // The database refuses the same calls even when the API is bypassed.
        await sql`update users set person_id = null where id = ${f.account[target].id}`.execute(t.owner);
        const direct = asUser(caller === 'anonymous' ? null : f.account[caller].id, (trx) =>
          sql`select * from kinship_auth.link_account_person(${f.account[target].id}::uuid, ${f.person.priya}::uuid, null)`.execute(
            trx,
          ),
        );
        if (allowed) await expect(direct).resolves.toBeDefined();
        else await expect(direct).rejects.toThrow(/forbidden|role_not_allowed/);
      });
    }
  }

  it('answers the same for change and unlink, and for the preview', async () => {
    // Family Admin: a Member yes, a SuperAdmin no, themselves yes.
    expect((await preview('familyadmin', 'user', f.person.priya)).status).toBe(200);
    expect((await preview('familyadmin', 'superadmin', f.person.priya)).status).toBe(403);
    expect((await preview('member', 'user', f.person.priya)).status).toBe(403);
    expect((await preview('anonymous', 'user', f.person.priya)).status).toBe(401);
    expect((await unlink('familyadmin', 'member', f.person.marcus)).status).toBe(204);
    expect((await put('familyadmin', 'member', f.person.marcus)).status).toBe(200);
    await sql`update users set person_id = ${f.person.sofia} where id = ${f.account.superadmin.id}`.execute(t.owner);
    expect((await unlink('familyadmin', 'superadmin', f.person.sofia)).status).toBe(403);
    expect((await put('familyadmin', 'superadmin', f.person.leo, f.person.sofia)).status).toBe(403);
    expect((await unlink('member', 'member', f.person.marcus)).status).toBe(403);
    expect((await unlink('anonymous', 'member', f.person.marcus)).status).toBe(401);
    expect((await put('user', 'user', f.person.priya)).status).toBe(403);
  });
});

describe('linking, changing and unlinking', () => {
  it('links an account that has no person, and /me shows it at once', async () => {
    const response = await put('superadmin', 'user', f.person.priya);
    expect(response).toMatchObject({
      status: 200,
      body: { accountId: f.account.user.id, person: { id: f.person.priya, name: 'Priya Nair' } },
    });
    expect((await as('user', 'GET', '/api/auth/me')).body?.['user']?.personId).toBe(f.person.priya);
    expect((await as('superadmin', 'GET', '/api/admin/accounts')).body?.['accounts']).toContainEqual(
      expect.objectContaining({ id: f.account.user.id, person: { id: f.person.priya, name: 'Priya Nair' } }),
    );
    expect((await as('user', 'GET', `/api/people/${f.person.priya}`)).body?.['hasAccount']).toBe(true);
  });

  it('changes the link to another person, and unlinks', async () => {
    expect((await put('superadmin', 'member', f.person.sofia, f.person.marcus)).status).toBe(200);
    expect(await personOf('member')).toBe(f.person.sofia);
    expect((await unlink('superadmin', 'member', f.person.sofia)).status).toBe(204);
    expect(await personOf('member')).toBeNull();
    expect((await as('member', 'GET', '/api/auth/me')).body?.['user']?.personId).toBeNull();
  });

  it('linking the same person again changes nothing and logs nothing', async () => {
    expect((await put('superadmin', 'member', f.person.marcus, f.person.marcus)).status).toBe(200);
    expect(logged.filter((line) => line.includes('account_person'))).toEqual([]);
  });

  it('lets a Family Admin and a SuperAdmin link their own account', async () => {
    expect((await put('familyadmin', 'familyadmin', f.person.daniel)).status).toBe(200);
    expect((await put('superadmin', 'superadmin', f.person.walter)).status).toBe(200);
    expect(await personOf('familyadmin')).toBe(f.person.daniel);
  });

  it('writes one structured log line per link, change and unlink: ids only, no names or emails', async () => {
    await put('superadmin', 'user', f.person.priya);
    await put('superadmin', 'user', f.person.leo, f.person.priya);
    await unlink('superadmin', 'user', f.person.leo);
    const lines = logged
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => typeof line['event'] === 'string' && String(line['event']).startsWith('account_person'));
    const fields = (line: Record<string, unknown>) => ({
      event: line['event'],
      actor: line['actor'],
      account: line['account'],
      from: line['from'],
      to: line['to'],
    });
    expect(lines.map(fields)).toEqual([
      {
        event: 'account_person_linked',
        actor: f.account.superadmin.id,
        account: f.account.user.id,
        from: null,
        to: f.person.priya,
      },
      {
        event: 'account_person_linked',
        actor: f.account.superadmin.id,
        account: f.account.user.id,
        from: f.person.priya,
        to: f.person.leo,
      },
      {
        event: 'account_person_unlinked',
        actor: f.account.superadmin.id,
        account: f.account.user.id,
        from: f.person.leo,
        to: null,
      },
    ]);
    const text = logged.filter((line) => line.includes('account_person')).join('');
    for (const secret of ['Priya', 'Leo', 'example.com']) expect(text).not.toContain(secret);
  });

  it('writes no log line for a refused request', async () => {
    await put('superadmin', 'user', placeholder);
    expect(logged.filter((line) => line.includes('account_person'))).toEqual([]);
  });
});

describe('every refusal', () => {
  it('400/404 for malformed ids and bodies', async () => {
    expect((await put('superadmin', 'nope', f.person.priya)).status).toBe(404);
    expect((await put('superadmin', 'user', 'nope')).status).toBe(404);
    expect(
      (await as('superadmin', 'PUT', `/api/admin/accounts/${f.account.user.id}/person`, { personId: f.person.priya }))
        .status,
    ).toBe(400);
    expect((await put('superadmin', 'user', f.person.priya, 'nope')).status).toBe(400);
    expect((await unlink('superadmin', 'member', 'nope')).status).toBe(400);
    expect((await preview('superadmin', 'user', 'nope')).status).toBe(404);
  });

  it('404 account_not_found and person_not_found', async () => {
    expect(await put('superadmin', NOBODY, f.person.priya)).toMatchObject({
      status: 404,
      body: { error: 'account_not_found' },
    });
    expect(await put('superadmin', 'user', NOBODY)).toMatchObject({ status: 404, body: { error: 'person_not_found' } });
    expect(await unlink('superadmin', NOBODY, f.person.marcus)).toMatchObject({
      status: 404,
      body: { error: 'account_not_found' },
    });
    expect(await preview('superadmin', 'user', NOBODY)).toMatchObject({
      status: 404,
      body: { error: 'person_not_found' },
    });
  });

  it('409 person_already_linked: another account has the person', async () => {
    expect(await put('superadmin', 'user', f.person.marcus)).toMatchObject({
      status: 409,
      body: { error: 'person_already_linked' },
    });
    expect(await personOf('user')).toBeNull();
    expect((await preview('superadmin', 'user', f.person.marcus)).body?.['error']).toBe('person_already_linked');
  });

  it('409 person_is_placeholder: an unknown parent is never linked', async () => {
    expect(await put('superadmin', 'user', placeholder)).toMatchObject({
      status: 409,
      body: { error: 'person_is_placeholder' },
    });
    expect((await preview('superadmin', 'user', placeholder)).body?.['error']).toBe('person_is_placeholder');
    expect(await personOf('user')).toBeNull();
  });

  it('409 person_has_open_invitation, and it clears once the invitation is revoked', async () => {
    const invited = await as('superadmin', 'POST', '/api/admin/invitations', {
      email: 'priya@example.com',
      role: 'user',
      personId: f.person.priya,
    });
    expect(invited.status).toBe(201);
    expect(await put('superadmin', 'user', f.person.priya)).toMatchObject({
      status: 409,
      body: { error: 'person_has_open_invitation' },
    });
    expect((await as('superadmin', 'POST', `/api/admin/links/${invited.body?.['linkId']}/revoke`)).status).toBe(204);
    expect((await put('superadmin', 'user', f.person.priya)).status).toBe(200);
  });

  it('an expired invitation does not block', async () => {
    const invited = await as('superadmin', 'POST', '/api/admin/invitations', {
      email: 'priya@example.com',
      role: 'user',
      personId: f.person.priya,
    });
    await sql`update account_links set expires_at = now() - interval '1 hour' where id = ${invited.body?.['linkId']}`.execute(
      t.owner,
    );
    expect((await put('superadmin', 'user', f.person.priya)).status).toBe(200);
  });

  it('409 account_already_linked: the page was out of date (a link or change made meanwhile)', async () => {
    // The page thinks the Member has nobody; they are linked to Marcus.
    expect(await put('superadmin', 'member', f.person.sofia, null)).toMatchObject({
      status: 409,
      body: { error: 'account_already_linked' },
    });
    expect(await personOf('member')).toBe(f.person.marcus);
    // The page thinks Sofia, but it is Marcus.
    expect(await put('superadmin', 'member', f.person.leo, f.person.sofia)).toMatchObject({
      status: 409,
      body: { error: 'account_already_linked' },
    });
    expect(await unlink('superadmin', 'member', f.person.sofia)).toMatchObject({
      status: 409,
      body: { error: 'account_already_linked' },
    });
    expect(await personOf('member')).toBe(f.person.marcus);
  });

  it('409 account_not_linked: unlinking an account with no person', async () => {
    expect(await unlink('superadmin', 'user', f.person.marcus)).toMatchObject({
      status: 409,
      body: { error: 'account_not_linked' },
    });
  });

  it('a concurrent double link: exactly one account gets the person', async () => {
    const results = await Promise.all([
      put('superadmin', 'user', f.person.priya),
      put('superadmin', 'unlinked', f.person.priya),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)?.body?.['error']).toBe('person_already_linked');
    const holders = await sql<{
      n: string;
    }>`select count(*) as n from users where person_id = ${f.person.priya}`.execute(t.owner);
    expect(Number(holders.rows[0]!.n)).toBe(1);
  });

  it('the unique index is still the last guard, and the app role cannot write the column', async () => {
    await expect(
      sql`update users set person_id = ${f.person.marcus} where id = ${f.account.user.id}`.execute(t.owner),
    ).rejects.toThrow(/unique|duplicate/i);
    await expect(
      asUser(f.account.user.id, (trx) =>
        sql`update users set person_id = ${f.person.priya} where id = ${f.account.user.id}`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('the preview (advice only)', () => {
  it('says what a Member may edit afterwards, and what they lose', async () => {
    // Marcus's account added Leo; Daniel's line: Marcus, Sofia, Gabriel (and Leo below Marcus).
    await sql`update people set created_by = ${f.account.member.id} where id in (${f.person.leo}, ${f.person.gabriel})`.execute(
      t.owner,
    );
    const toDaniel = await preview('superadmin', 'member', f.person.daniel);
    expect(toDaniel.body).toMatchObject({
      role: 'member',
      person: { id: f.person.daniel, name: 'Daniel Hale' },
      current: { id: f.person.marcus, name: 'Marcus Hale' },
      descendantsInLine: 4, // Marcus, Sofia, Gabriel and Leo
      createdByAccountInLine: 2, // Gabriel and Leo, whom this account added
      losesEdit: 1, // Marcus (their own person today); Leo stays editable, as one they added in Daniel's line
    });
  });

  it('counts people lost through the old link', async () => {
    await sql`update people set created_by = ${f.account.member.id} where id = ${f.person.leo}`.execute(t.owner);
    const toSofia = await preview('superadmin', 'member', f.person.sofia);
    // Through Marcus the account edits Marcus and Leo; through Sofia (no descendants) neither.
    expect(toSofia.body).toMatchObject({ descendantsInLine: 0, createdByAccountInLine: 0, losesEdit: 2 });
  });

  it('is all zeros for a role whose rights do not depend on the link', async () => {
    expect((await preview('superadmin', 'familyadmin', f.person.daniel)).body).toMatchObject({
      role: 'familyadmin',
      current: null,
      descendantsInLine: 0,
      createdByAccountInLine: 0,
      losesEdit: 0,
    });
  });
});

describe("a Member's edit rights really change with the link (PATCH /api/people/:id)", () => {
  const edit = (who: Who, id: string) => as(who, 'PATCH', `/api/people/${id}`, { gender: 'other' });

  it('edits the linked person, and people they added below them; nobody else', async () => {
    await sql`update people set created_by = ${f.account.unlinked.id} where id = ${f.person.leo}`.execute(t.owner);
    // Not linked: edits nothing, not even a person they added.
    expect((await edit('unlinked', f.person.priya)).status).toBe(403);
    expect((await edit('unlinked', f.person.leo)).status).toBe(403);

    // Linked to Priya: Priya yes; Leo is not Priya's descendant (Leo is her child: he IS below her), and they added him.
    expect((await put('superadmin', 'unlinked', f.person.priya)).status).toBe(200);
    expect((await edit('unlinked', f.person.priya)).status).toBe(200);
    expect((await edit('unlinked', f.person.leo)).status).toBe(200);
    expect((await edit('unlinked', f.person.sofia)).status).toBe(403);

    // Changed to Sofia: Priya and Leo are out of reach again; Sofia is theirs.
    expect((await put('superadmin', 'unlinked', f.person.sofia, f.person.priya)).status).toBe(200);
    expect((await edit('unlinked', f.person.sofia)).status).toBe(200);
    expect((await edit('unlinked', f.person.priya)).status).toBe(403);
    expect((await edit('unlinked', f.person.leo)).status).toBe(403);

    // Unlinked: nothing.
    expect((await unlink('superadmin', 'unlinked', f.person.sofia)).status).toBe(204);
    expect((await edit('unlinked', f.person.sofia)).status).toBe(403);
  });
});

describe('deleting a person who has an account', () => {
  it('is blocked while linked and allowed after unlink', async () => {
    const lone = await insertPersonRow(t.owner, 'Ada', 'Hale');
    expect((await put('superadmin', 'user', lone)).status).toBe(200);
    expect(await as('superadmin', 'DELETE', `/api/people/${lone}?confirm=true`)).toMatchObject({
      status: 409,
      body: { error: 'person_has_account' },
    });
    expect((await unlink('superadmin', 'user', lone)).status).toBe(204);
    expect((await as('superadmin', 'DELETE', `/api/people/${lone}?confirm=true`)).status).toBe(204);
  });
});

describe('an invitation never links a placeholder (the 0011 gap, fixed in 0016)', () => {
  it('the route says 409 person_is_placeholder', async () => {
    expect(
      await as('superadmin', 'POST', '/api/admin/invitations', {
        email: 'unknown@example.com',
        role: 'user',
        personId: placeholder,
      }),
    ).toMatchObject({ status: 409, body: { error: 'person_is_placeholder' } });
  });

  it('the database function refuses it too, when the route is bypassed', async () => {
    await expect(
      asUser(f.account.superadmin.id, (trx) =>
        sql`select * from kinship_auth.create_invitation('unknown@example.com', 'user', ${placeholder}::uuid, null, 'hash-placeholder')`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow(/person_is_placeholder/);
    const open = await sql<{
      n: string;
    }>`select count(*) as n from account_links where person_id = ${placeholder}`.execute(t.owner);
    expect(Number(open.rows[0]!.n)).toBe(0);
  });

  it('an ordinary person can still be invited', async () => {
    expect(
      (
        await as('superadmin', 'POST', '/api/admin/invitations', {
          email: 'priya@example.com',
          role: 'user',
          personId: f.person.priya,
        })
      ).status,
    ).toBe(201);
  });
});
