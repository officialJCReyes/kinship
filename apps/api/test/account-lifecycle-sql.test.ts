// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Migration 0019 as SQL (ADR 0029): role change, disable, enable and delete as plain functions under the app role, the
// last-SuperAdmin triggers for the owner and for anyone, the replaced sign-in and session functions, the grants, and the
// migration itself on a populated database. No route is involved. Fictional Hale family only.
import { cp } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fingerprint } from '../src/backup/inspect.js';
import { ensureAppRole } from '../src/migrations/roles.js';
import { runMigrations } from '../src/migrations/runner.js';
import { withUserTransaction } from '../src/request-context.js';
import { createTestApp, insertUser } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';
import { createTestDatabase } from './helpers/db.js';
import { buildFamily } from './helpers/family.js';
import type { Family } from './helpers/family.js';
import { realMigrationsDir, removeMigrationsFrom, tempMigrationsDir } from './helpers/migrations-dir.js';

let t: TestApp;
let f: Family;
let seq = 0;

beforeAll(async () => {
  t = await createTestApp();
  f = await buildFamily(t.owner);
});
afterAll(() => t.close());

type Role = 'superadmin' | 'familyadmin' | 'member' | 'user';
const ROLES: Role[] = ['superadmin', 'familyadmin', 'member', 'user'];
const mk = (role: Role) => insertUser(t.owner, { email: `acct${++seq}-${role}@example.com`, role });
/** The SQLSTATE a statement ends with, or 'ok'. */
async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return 'ok';
  } catch (error) {
    return typeof error === 'object' && error && 'code' in error ? String(error.code) : String(error);
  }
}
/** Runs a SQL function the way the API does: as the app role, with only kinship.user_id set. */
const asApp = (actor: string, query: ReturnType<typeof sql>) =>
  withUserTransaction(t.db, actor, (trx) => query.execute(trx));
const row = async (id: string) =>
  (
    await sql<{ role: string; disabled_at: Date | null }>`select role, disabled_at from users where id = ${id}`.execute(
      t.owner,
    )
  ).rows[0];

/** The matrix, written out on its own (not copied from the SQL): [actor][target] -> may disable, enable or delete. */
const MAY_DISABLE: Record<Role, Record<Role, boolean>> = {
  superadmin: { superadmin: true, familyadmin: true, member: true, user: true },
  familyadmin: { superadmin: false, familyadmin: false, member: true, user: true },
  member: { superadmin: false, familyadmin: false, member: false, user: false },
  user: { superadmin: false, familyadmin: false, member: false, user: false },
};
const mayChange = (actor: Role, target: Role, next: Role) =>
  target !== 'superadmin' &&
  next !== 'superadmin' &&
  (actor === 'superadmin' || (actor === 'familyadmin' && target !== 'familyadmin' && next !== 'familyadmin'));

describe('role change as SQL', () => {
  it('follows the matrix for every actor, target and new role; nobody changes their own role', async () => {
    for (const actorRole of ROLES) {
      for (const targetRole of ROLES) {
        for (const next of ROLES) {
          const actor = await mk(actorRole);
          const target = await mk(targetRole);
          const result = await outcome(() =>
            asApp(actor, sql`select * from kinship_auth.change_account_role(${target}::uuid, ${next}, ${targetRole})`),
          );
          const admin = actorRole === 'superadmin' || actorRole === 'familyadmin';
          const expected = !admin ? 'KS010' : mayChange(actorRole, targetRole, next) ? 'ok' : 'KS020';
          expect(result, `${actorRole} sets ${targetRole} to ${next}`).toBe(expected);
          expect((await row(target))?.role).toBe(expected === 'ok' ? next : targetRole);
        }
      }
    }
  }, 120_000);

  it('refuses your own account first (KS045), before the matrix', async () => {
    const fa = await mk('familyadmin');
    expect(
      await outcome(() =>
        asApp(fa, sql`select * from kinship_auth.change_account_role(${fa}::uuid, 'member', 'familyadmin')`),
      ),
    ).toBe('KS045');
    const sa = await mk('superadmin');
    expect(
      await outcome(() =>
        asApp(sa, sql`select * from kinship_auth.change_account_role(${sa}::uuid, 'member', 'superadmin')`),
      ),
    ).toBe('KS045');
  });

  it('answers a stale page with KS046, does nothing when the role is already that one, and finds no account', async () => {
    const sa = await mk('superadmin');
    const member = await mk('member');
    expect(
      await outcome(() =>
        asApp(sa, sql`select * from kinship_auth.change_account_role(${member}::uuid, 'user', 'user')`),
      ),
    ).toBe('KS046');
    expect((await row(member))?.role).toBe('member');
    const same = await asApp(
      sa,
      sql`select * from kinship_auth.change_account_role(${member}::uuid, 'member', 'member')`,
    );
    expect(same.rows).toEqual([{ previous_role: 'member' }]);
    expect(
      await outcome(() =>
        asApp(
          sa,
          sql`select * from kinship_auth.change_account_role('00000000-0000-4000-8000-000000000000'::uuid, 'user', 'user')`,
        ),
      ),
    ).toBe('KS025');
  });

  it('is allowed for a disabled account', async () => {
    const sa = await mk('superadmin');
    const member = await mk('member');
    await sql`update users set disabled_at = now() where id = ${member}`.execute(t.owner);
    await asApp(sa, sql`select * from kinship_auth.change_account_role(${member}::uuid, 'user', 'member')`);
    expect((await row(member))?.role).toBe('user');
  });
});

describe('disable, enable and delete as SQL', () => {
  it('follow the matrix, and nobody does it to themselves', async () => {
    for (const actorRole of ROLES) {
      for (const targetRole of ROLES) {
        const second = targetRole === 'superadmin' ? await mk('superadmin') : null; // a spare, so the guard never decides this test
        const actor = await mk(actorRole);
        const target = await mk(targetRole);
        const admin = actorRole === 'superadmin' || actorRole === 'familyadmin';
        const expected = !admin ? 'KS010' : MAY_DISABLE[actorRole][targetRole] ? 'ok' : 'KS020';
        expect(
          await outcome(() => asApp(actor, sql`select * from kinship_auth.disable_account(${target}::uuid)`)),
          `${actorRole} disables ${targetRole}`,
        ).toBe(expected);
        expect((await row(target))?.disabled_at !== null).toBe(expected === 'ok');
        if (expected === 'ok') {
          expect(
            await outcome(() => asApp(actor, sql`select * from kinship_auth.enable_account(${target}::uuid)`)),
          ).toBe('ok');
          expect((await row(target))?.disabled_at).toBeNull();
        } else {
          expect(
            await outcome(() => asApp(actor, sql`select * from kinship_auth.enable_account(${target}::uuid)`)),
          ).toBe(expected);
        }
        // delete needs a disabled account; the matrix still comes first
        const typed = (await sql<{ email: string }>`select email from users where id = ${target}`.execute(t.owner))
          .rows[0]!.email;
        await sql`update users set disabled_at = now() where id = ${target}`.execute(t.owner);
        const deleted = await outcome(() =>
          asApp(actor, sql`select kinship_auth.delete_account(${target}::uuid, ${typed})`),
        );
        expect(deleted, `${actorRole} deletes ${targetRole}`).toBe(expected);
        expect(Boolean(await row(target))).toBe(expected !== 'ok');
        if (second) await sql`delete from users where id = ${second}`.execute(t.owner);
      }
    }
  }, 120_000);

  it('self first (KS045), then the matrix (KS020), then the last-SuperAdmin count (KS044), then state', async () => {
    const fa = await mk('familyadmin');
    for (const call of [
      sql`select * from kinship_auth.disable_account(${fa}::uuid)`,
      sql`select * from kinship_auth.enable_account(${fa}::uuid)`,
      sql`select kinship_auth.delete_account(${fa}::uuid, 'x')`,
    ]) {
      expect(await outcome(() => asApp(fa, call))).toBe('KS045');
    }
    // matrix before state: a Family Admin deleting a Family Admin that is NOT disabled is KS020, not KS048
    const other = await mk('familyadmin');
    expect(await outcome(() => asApp(fa, sql`select kinship_auth.delete_account(${other}::uuid, 'x')`))).toBe('KS020');
    // state, then the typed email
    const member = await mk('member');
    expect(await outcome(() => asApp(fa, sql`select kinship_auth.delete_account(${member}::uuid, 'wrong')`))).toBe(
      'KS048',
    );
    await sql`update users set disabled_at = now() where id = ${member}`.execute(t.owner);
    expect(await outcome(() => asApp(fa, sql`select kinship_auth.delete_account(${member}::uuid, 'wrong')`))).toBe(
      'KS049',
    );
    const email = (await sql<{ email: string }>`select email from users where id = ${member}`.execute(t.owner)).rows[0]!
      .email;
    expect(
      await outcome(() =>
        asApp(fa, sql`select kinship_auth.delete_account(${member}::uuid, ${`  ${email.toUpperCase()} `})`),
      ),
    ).toBe('ok');
  });

  it('the guard is a count of the active SuperAdmins that would remain', async () => {
    // Clean slate for the count: one active SuperAdmin besides the family's own.
    const lone = await mk('superadmin');
    const stale = await mk('superadmin');
    await sql`update users set disabled_at = now() where role = 'superadmin' and id not in (${lone}, ${stale})`.execute(
      t.owner,
    );
    // The trigger lets one go while another is active; now `lone` is the last active SuperAdmin.
    await sql`update users set disabled_at = now() where id = ${stale}`.execute(t.owner);
    // A (stale) actor that is itself a SuperAdmin cannot take the last one out by any function.
    expect(await outcome(() => asApp(stale, sql`select * from kinship_auth.disable_account(${lone}::uuid)`))).toBe(
      'KS044',
    );
    expect(
      await outcome(() =>
        asApp(stale, sql`select * from kinship_auth.change_account_role(${lone}::uuid, 'member', 'superadmin')`),
      ),
    ).toBe('KS020');
    expect((await row(lone))?.disabled_at).toBeNull();
    // Restore the family's SuperAdmin for the later tests.
    await sql`update users set disabled_at = null where role = 'superadmin'`.execute(t.owner);
  });

  it('disable ends the sessions and revokes the open set-password link at once; enable brings the sign-in back', async () => {
    const sa = await mk('superadmin');
    const member = await mk('member');
    await sql`insert into sessions (user_id, token_hash, expires_at, absolute_expires_at)
              values (${member}, 'tok-1', now() + interval '1 hour', now() + interval '1 day')`.execute(t.owner);
    await asApp(sa, sql`select * from kinship_auth.create_reset_link(${member}::uuid, 'reset-1')`);
    const before = await asApp(sa, sql`select * from kinship_auth.disable_account(${member}::uuid)`);
    expect(before.rows[0]).toMatchObject({ changed: true });
    expect((await sql`select 1 from sessions where user_id = ${member}`.execute(t.owner)).rows).toHaveLength(0);
    expect(
      (await sql`select 1 from account_links where user_id = ${member} and revoked_at is not null`.execute(t.owner))
        .rows,
    ).toHaveLength(1);
    // already disabled: a no-op
    expect((await asApp(sa, sql`select * from kinship_auth.disable_account(${member}::uuid)`)).rows[0]).toMatchObject({
      changed: false,
    });
    // no sign-in, no session, no new link, no accepting an old one
    const email = (await sql<{ email: string }>`select email from users where id = ${member}`.execute(t.owner)).rows[0]!
      .email;
    expect(
      (await t.owner.executeQuery(sql`select * from kinship_auth.find_login(${email})`.compile(t.owner))).rows,
    ).toHaveLength(0);
    expect(
      (await sql`select * from kinship_auth.create_session(${member}::uuid, 'tok-2', 60, 120)`.execute(t.owner)).rows,
    ).toHaveLength(0);
    expect(
      await outcome(() => asApp(sa, sql`select * from kinship_auth.create_reset_link(${member}::uuid, 'reset-2')`)),
    ).toBe('KS047');
    await sql`update account_links set revoked_at = null where user_id = ${member}`.execute(t.owner); // an old link somehow still open
    expect(await outcome(() => sql`select kinship_auth.accept_reset('reset-1', 'hash')`.execute(t.owner))).toBe(
      'KS030',
    );
    // a session that somehow exists resolves to nobody
    await sql`insert into sessions (user_id, token_hash, expires_at, absolute_expires_at)
              values (${member}, 'tok-3', now() + interval '1 hour', now() + interval '1 day')`.execute(t.owner);
    expect((await sql`select * from kinship_auth.resolve_session('tok-3', 60)`.execute(t.owner)).rows).toHaveLength(0);
    // enable: the sign-in is found again; old sessions stay gone only because they were deleted
    expect((await asApp(sa, sql`select * from kinship_auth.enable_account(${member}::uuid)`)).rows[0]).toEqual({
      changed: true,
    });
    expect(
      (await t.owner.executeQuery(sql`select * from kinship_auth.find_login(${email})`.compile(t.owner))).rows,
    ).toHaveLength(1);
    expect((await sql`select * from kinship_auth.resolve_session('tok-3', 60)`.execute(t.owner)).rows).toHaveLength(1);
  });

  it('delete keeps the person and their record, nulls created_by, removes the accepted invitation, and frees the email', async () => {
    const sa = await mk('superadmin');
    const victim = await mk('member');
    const email = (await sql<{ email: string }>`select email from users where id = ${victim}`.execute(t.owner)).rows[0]!
      .email;
    await sql`update users set person_id = ${f.person.priya} where id = ${victim}`.execute(t.owner);
    await sql`update people set created_by = ${victim} where id = ${f.person.leo}`.execute(t.owner);
    await sql`insert into account_links (kind, token_hash, expires_at, created_by, email, role, accepted_at, accepted_user_id)
              values ('invite', 'inv-1', now() + interval '7 days', ${sa}, ${email}, 'member', now(), ${victim})`.execute(
      t.owner,
    );
    await sql`insert into sessions (user_id, token_hash, expires_at, absolute_expires_at)
              values (${victim}, 'tok-9', now() + interval '1 hour', now() + interval '1 day')`.execute(t.owner);
    const preview = await asApp(sa, sql`select * from kinship_auth.delete_preview(${victim}::uuid)`);
    expect(preview.rows[0]).toMatchObject({ account_role: 'member', is_disabled: false, people_added: '1' });
    await asApp(sa, sql`select * from kinship_auth.disable_account(${victim}::uuid)`);
    await asApp(sa, sql`select kinship_auth.delete_account(${victim}::uuid, ${email})`);
    expect(await row(victim)).toBeUndefined();
    expect(
      (await sql`select 1 from people where id in (${f.person.priya}, ${f.person.leo})`.execute(t.owner)).rows,
    ).toHaveLength(2);
    expect(
      (
        await sql<{ created_by: string | null }>`select created_by from people where id = ${f.person.leo}`.execute(
          t.owner,
        )
      ).rows[0]!.created_by,
    ).toBeNull();
    expect((await sql`select 1 from account_links where email = ${email}`.execute(t.owner)).rows).toHaveLength(0);
    expect((await sql`select 1 from sessions where token_hash = 'tok-9'`.execute(t.owner)).rows).toHaveLength(0);
    // the email can be invited again
    const invite = await asApp(
      sa,
      sql`select * from kinship_auth.create_invitation(${email}, 'user', null, null, 'inv-2')`,
    );
    expect(invite.rows).toHaveLength(1);
    await sql`delete from account_links where email = ${email}`.execute(t.owner);
  });
});

describe('the last-SuperAdmin triggers (owner SQL, any route)', () => {
  it('refuse to demote, disable or delete the last active SuperAdmin, and allow it while another is active', async () => {
    await sql`delete from users where role = 'superadmin' and id <> ${f.account.superadmin.id} and email like 'acct%'`.execute(
      t.owner,
    );
    await sql`update users set disabled_at = now() where role = 'superadmin' and id <> ${f.account.superadmin.id}`.execute(
      t.owner,
    );
    const only = f.account.superadmin.id;
    expect(await outcome(() => sql`update users set role = 'member' where id = ${only}`.execute(t.owner))).toBe(
      'KS044',
    );
    expect(await outcome(() => sql`update users set disabled_at = now() where id = ${only}`.execute(t.owner))).toBe(
      'KS044',
    );
    expect(await outcome(() => sql`delete from users where id = ${only}`.execute(t.owner))).toBe('KS044');
    expect(
      await outcome(() =>
        sql`update users set last_sign_in_at = now(), display_name = 'Marcus' where id = ${only}`.execute(t.owner),
      ),
    ).toBe('ok');
    // a second active SuperAdmin: the first can go, and then the second is the last
    const second = await mk('superadmin');
    expect(await outcome(() => sql`update users set role = 'familyadmin' where id = ${only}`.execute(t.owner))).toBe(
      'ok',
    );
    expect(await outcome(() => sql`delete from users where id = ${second}`.execute(t.owner))).toBe('KS044');
    await sql`update users set role = 'superadmin' where id = ${only}`.execute(t.owner); // promoting is not guarded
    await sql`update users set role = 'member', disabled_at = now() where id = ${second}`.execute(t.owner);
    await sql`delete from users where id = ${second}`.execute(t.owner);
  });

  it('two SuperAdmins removing each other at the same moment: exactly one succeeds', async () => {
    const a = await mk('superadmin');
    const b = await mk('superadmin');
    await sql`update users set disabled_at = now() where role = 'superadmin' and id not in (${a}, ${b})`.execute(
      t.owner,
    );
    const results = await Promise.all([
      outcome(() =>
        t.owner
          .transaction()
          .execute((trx) =>
            sql`update users set disabled_at = now() where id = ${a}`
              .execute(trx)
              .then(() => new Promise((r) => setTimeout(r, 150))),
          ),
      ),
      outcome(() =>
        t.owner
          .transaction()
          .execute((trx) =>
            sql`update users set disabled_at = now() where id = ${b}`
              .execute(trx)
              .then(() => new Promise((r) => setTimeout(r, 150))),
          ),
      ),
    ]);
    expect(results.sort()).toEqual(['KS044', 'ok']);
    await sql`update users set disabled_at = null where role = 'superadmin'`.execute(t.owner);
  });
});

describe('rights', () => {
  it('the app role reads disabled_at but cannot write it or the role; only the five functions are executable by name', async () => {
    const sa = await mk('superadmin');
    expect((await asApp(sa, sql`select disabled_at from users where id = ${sa}`)).rows).toHaveLength(1);
    expect(await outcome(() => asApp(sa, sql`update users set disabled_at = now() where id = ${sa}`))).toBe('42501');
    expect(await outcome(() => asApp(sa, sql`update users set role = 'member' where id = ${sa}`))).toBe('42501');
    const names = await sql<{ proname: string; app: boolean; pub: boolean }>`
      select p.proname,
             has_function_privilege(${t.test.config.appUser}, p.oid, 'EXECUTE') as app,
             exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as pub
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'kinship_auth' and p.proname in
         ('change_account_role','disable_account','enable_account','delete_account','delete_preview',
          'can_change_role_for','can_disable_for','lock_superadmins','other_active_superadmins','guard_last_superadmin')`.execute(
      t.owner,
    );
    const exec = names.rows
      .filter((n) => n.app)
      .map((n) => n.proname)
      .sort();
    expect(exec).toEqual([
      'change_account_role',
      'delete_account',
      'delete_preview',
      'disable_account',
      'enable_account',
    ]);
    expect(names.rows.some((n) => n.pub)).toBe(false);
    const rows = names.rows.length;
    expect(rows).toBe(10);
  });
});

describe('migration 0019 on a populated database (0001 to 0018 with the Hale family)', () => {
  it('changes no data: every account is active, sessions and links are intact, sign-in still finds the account', async () => {
    const test = await createTestDatabase();
    const dir = await tempMigrationsDir(true);
    try {
      await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
      await removeMigrationsFrom(dir.dir, 19);
      const before = await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
      expect(before.applied.at(-1)).toBe('0018_chart_settings');
      const family = await buildFamily(test.owner);
      await sql`insert into sessions (user_id, token_hash, expires_at, absolute_expires_at)
                values (${family.account.member.id}, 'tok', now() + interval '1 hour', now() + interval '1 day')`.execute(
        test.owner,
      );
      await sql`insert into account_links (kind, token_hash, expires_at, created_by, user_id)
                values ('reset', 'r1', now() + interval '1 day', ${family.account.superadmin.id}, ${family.account.user.id})`.execute(
        test.owner,
      );
      await sql`insert into account_links (kind, token_hash, expires_at, created_by, email, role, accepted_at, accepted_user_id)
                values ('invite', 'i1', now() + interval '1 day', ${family.account.superadmin.id}, 'member@example.com', 'member', now(), ${family.account.member.id})`.execute(
        test.owner,
      );
      const snapshot = async () => ({
        people: (await sql`select * from people order by id`.execute(test.owner)).rows,
        unions: (await sql`select * from unions order by id`.execute(test.owner)).rows,
        users: (
          await sql`select id, email, role, person_id, display_name, password_hash from users order by id`.execute(
            test.owner,
          )
        ).rows,
        sessions: (await sql`select * from sessions order by id`.execute(test.owner)).rows,
        links: (await sql`select * from account_links order by id`.execute(test.owner)).rows,
      });
      const beforeData = await snapshot();
      const beforePrints = await fingerprint(test.owner, test.config.appUser);

      await cp(
        join(realMigrationsDir, '0019_account_roles_disable_delete.sql'),
        join(dir.dir, '0019_account_roles_disable_delete.sql'),
      );
      const result = await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
      expect(result.applied).toEqual(['0019_account_roles_disable_delete']);
      expect(await snapshot()).toEqual(beforeData);
      expect((await sql`select 1 from users where disabled_at is not null`.execute(test.owner)).rows).toHaveLength(0);
      expect(
        (await sql`select * from kinship_auth.find_login('member@example.com')`.execute(test.owner)).rows,
      ).toHaveLength(1);
      expect((await sql`select * from kinship_auth.resolve_session('tok', 60)`.execute(test.owner)).rows).toHaveLength(
        1,
      );

      // Only functions, a column grant and two triggers move; no table, policy or table grant changes.
      const after = await fingerprint(test.owner, test.config.appUser);
      for (const key of ['tables', 'policies', 'tableGrants', 'schemaPrivileges', 'defaultPrivileges'] as const) {
        expect(after[key]).toEqual(beforePrints[key]);
      }
      expect(after.columnGrants.length).toBe(beforePrints.columnGrants.length + 1);
      const triggers = await sql<{
        tgname: string;
      }>`select tgname from pg_trigger where tgrelid = 'users'::regclass and not tgisinternal order by 1`.execute(
        test.owner,
      );
      expect(triggers.rows.map((r) => r.tgname)).toEqual([
        'users_keep_a_superadmin_delete',
        'users_keep_a_superadmin_update',
        'users_new_last_seen',
      ]);
    } finally {
      await dir.remove();
      await test.cleanup();
    }
  }, 60_000);
});
