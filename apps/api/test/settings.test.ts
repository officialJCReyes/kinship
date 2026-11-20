// SPDX-License-Identifier: AGPL-3.0-or-later
//
// An account's own display settings: PATCH /api/auth/me takes any non-empty subset of the five, changes only that
// account, and the app role can change nothing else about an account.
import { sql } from 'kysely';
import { API_ERROR_CODES, DEFAULT_USER_SETTINGS, en } from '@kinship/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withUserTransaction } from '../src/request-context.js';
import { createTestApp } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';
import { buildFamily, signInAll } from './helpers/family.js';
import type { Family } from './helpers/family.js';

let t: TestApp;
let f: Family;
let as: Awaited<ReturnType<typeof signInAll>>;

beforeAll(async () => {
  t = await createTestApp();
  f = await buildFamily(t.owner);
  as = await signInAll(t.app, f);
});
afterAll(() => t.close());

const settingsOf = async (who: Parameters<typeof as>[0]) => {
  const user = (await as(who, 'GET', '/api/auth/me')).body?.user;
  return {
    lineageView: user.lineageView,
    colorScheme: user.colorScheme,
    theme: user.theme,
    dateFormat: user.dateFormat,
    nameForm: user.nameForm,
    showPrefix: user.showPrefix,
    showSuffix: user.showSuffix,
  };
};
const asUser = <T>(userId: string, fn: Parameters<typeof withUserTransaction<T>>[2]) =>
  withUserTransaction(t.db, userId, fn);
const WHO = ['superadmin', 'familyadmin', 'member', 'unlinked', 'user'] as const;

describe('defaults', () => {
  it('gives every new account the defaults: Forest, Device, "Jan 1, 2026", Maiden name (Married name), prefixes and suffixes shown, adoptive family', async () => {
    expect(DEFAULT_USER_SETTINGS).toEqual({
      lineageView: 'adoptive',
      colorScheme: 'forest',
      theme: 'device',
      dateFormat: 'mdy',
      nameForm: 'maiden_married',
      showPrefix: true,
      showSuffix: true,
    });
    for (const who of WHO) expect(await settingsOf(who), who).toEqual(DEFAULT_USER_SETTINGS);
  });
});

describe('PATCH /api/auth/me', () => {
  it('changes one setting and leaves the others alone', async () => {
    const changed = await as('familyadmin', 'PATCH', '/api/auth/me', { colorScheme: 'sand' });
    expect(changed.status).toBe(200);
    expect(changed.body?.user).toMatchObject({ colorScheme: 'sand', theme: 'device', dateFormat: 'mdy' });
    expect(await settingsOf('familyadmin')).toEqual({ ...DEFAULT_USER_SETTINGS, colorScheme: 'sand' });
    await as('familyadmin', 'PATCH', '/api/auth/me', { colorScheme: 'forest' });
  });

  it('changes several at once, and every value on every list is accepted', async () => {
    const all = {
      lineageView: 'birth',
      colorScheme: 'graphite',
      theme: 'dark',
      dateFormat: 'eu',
      nameForm: 'maiden',
      showPrefix: false,
      showSuffix: false,
    };
    const changed = await as('superadmin', 'PATCH', '/api/auth/me', all);
    expect(changed.status).toBe(200);
    expect(await settingsOf('superadmin')).toEqual(all);
    for (const [field, values] of [
      ['colorScheme', ['forest', 'sand', 'slate', 'graphite']],
      ['theme', ['device', 'light', 'dark']],
      ['dateFormat', ['mdy', 'dmy', 'dmy2', 'long', 'iso', 'us', 'eu']],
      ['nameForm', ['maiden_married', 'married_born', 'married', 'maiden']],
      ['showPrefix', [true, false]],
      ['showSuffix', [true, false]],
      ['lineageView', ['adoptive', 'birth']],
    ] as const) {
      for (const value of values) {
        expect((await as('superadmin', 'PATCH', '/api/auth/me', { [field]: value })).status, `${field}=${value}`).toBe(
          200,
        );
      }
    }
    await as('superadmin', 'PATCH', '/api/auth/me', DEFAULT_USER_SETTINGS);
    expect(await settingsOf('superadmin')).toEqual(DEFAULT_USER_SETTINGS);
  });

  it('is harmless when the value is the one already saved', async () => {
    const before = await settingsOf('member');
    for (let i = 0; i < 2; i++) {
      const same = await as('member', 'PATCH', '/api/auth/me', { theme: before.theme, dateFormat: before.dateFormat });
      expect(same.status).toBe(200);
    }
    expect(await settingsOf('member')).toEqual(before);
  });

  it('still takes a request with only lineageView, as before', async () => {
    const r = await as('user', 'PATCH', '/api/auth/me', { lineageView: 'birth' });
    expect(r.status).toBe(200);
    expect(r.body?.user).toMatchObject({ lineageView: 'birth', colorScheme: 'forest' });
    await as('user', 'PATCH', '/api/auth/me', { lineageView: 'adoptive' });
  });

  it('refuses a value that is not on its list with that setting’s own error code', async () => {
    const cases = [
      [{ colorScheme: 'neon' }, 'invalid_color_scheme'],
      [{ theme: 'sepia' }, 'invalid_theme'],
      [{ dateFormat: 'dd/mm' }, 'invalid_date_format'],
      [{ nameForm: 'birth' }, 'invalid_name_form'],
      [{ nameForm: 'married_name' }, 'invalid_name_form'],
      [{ showPrefix: 'yes' }, 'invalid_show_prefix'],
      [{ showSuffix: 1 }, 'invalid_show_suffix'],
      [{ surnameChoice: 'birth' }, 'invalid_request'],
      [{ lineageView: 'biological' }, 'invalid_lineage'],
      [{ theme: 7 }, 'invalid_theme'],
      [{ colorScheme: null }, 'invalid_color_scheme'],
    ] as const;
    for (const [body, code] of cases) {
      expect(await as('member', 'PATCH', '/api/auth/me', body), JSON.stringify(body)).toMatchObject({
        status: 400,
        body: { error: code },
      });
    }
    // Nothing was saved by the refused requests.
    expect(await settingsOf('member')).toEqual(DEFAULT_USER_SETTINGS);
  });

  it('refuses an empty body, other keys, and a good value sent with a bad one (all or nothing)', async () => {
    expect((await as('member', 'PATCH', '/api/auth/me', {})).status).toBe(400);
    expect((await as('member', 'PATCH', '/api/auth/me', { role: 'superadmin' })).status).toBe(400);
    expect((await as('member', 'PATCH', '/api/auth/me', { email: 'x@example.com' })).status).toBe(400);
    expect((await as('member', 'PATCH', '/api/auth/me', { theme: 'dark', role: 'superadmin' })).status).toBe(400);
    const mixed = await as('member', 'PATCH', '/api/auth/me', { theme: 'dark', colorScheme: 'neon' });
    expect(mixed).toMatchObject({ status: 400, body: { error: 'invalid_color_scheme' } });
    expect(await settingsOf('member')).toEqual(DEFAULT_USER_SETTINGS);
    expect((await as('anonymous', 'PATCH', '/api/auth/me', { theme: 'dark' })).status).toBe(401);
  });

  it('has an English message for every settings error code', () => {
    for (const code of [
      'invalid_color_scheme',
      'invalid_theme',
      'invalid_date_format',
      'invalid_name_form',
      'invalid_show_prefix',
      'invalid_show_suffix',
    ]) {
      expect(API_ERROR_CODES as readonly string[]).toContain(code);
      expect(en, code).toHaveProperty(`error.${code}`);
    }
  });
});

describe('each account has its own settings', () => {
  it('a Member and a User change only their own; nobody else’s change', async () => {
    await as('member', 'PATCH', '/api/auth/me', { colorScheme: 'slate', theme: 'dark', dateFormat: 'iso' });
    await as('user', 'PATCH', '/api/auth/me', { nameForm: 'maiden', showSuffix: false });
    expect(await settingsOf('member')).toEqual({
      ...DEFAULT_USER_SETTINGS,
      colorScheme: 'slate',
      theme: 'dark',
      dateFormat: 'iso',
    });
    expect(await settingsOf('user')).toEqual({ ...DEFAULT_USER_SETTINGS, nameForm: 'maiden', showSuffix: false });
    for (const who of ['superadmin', 'familyadmin', 'unlinked'] as const) {
      expect(await settingsOf(who), who).toEqual(DEFAULT_USER_SETTINGS);
    }
  });

  it('a change in one session is read by another session of the same account', async () => {
    const { cookieHeader, login } = await import('./helpers/app.js');
    const second = cookieHeader(await login(t.app, f.account.unlinked.email));
    const read = async () =>
      (
        await t.app.inject({
          method: 'GET',
          url: '/api/auth/me',
          headers: { 'x-kinship-request': '1', cookie: second },
        })
      ).json().user;
    expect((await read()).colorScheme).toBe('forest');
    await as('unlinked', 'PATCH', '/api/auth/me', { colorScheme: 'graphite', theme: 'light' });
    expect(await read()).toMatchObject({ colorScheme: 'graphite', theme: 'light' });
    await as('unlinked', 'PATCH', '/api/auth/me', { colorScheme: 'forest', theme: 'device' });
  });

  it('login returns the saved settings', async () => {
    await as('superadmin', 'PATCH', '/api/auth/me', { dateFormat: 'long' });
    const { login } = await import('./helpers/app.js');
    const response = await login(t.app, f.account.superadmin.email);
    expect(response.json().user).toMatchObject({ dateFormat: 'long' });
    await as('superadmin', 'PATCH', '/api/auth/me', { dateFormat: 'mdy' });
  });
});

describe('the app role may change only the settings columns, and only on its own row', () => {
  it('updates its own settings columns and lineage_view', async () => {
    const me = f.account.member.id;
    await asUser(me, (trx) =>
      sql`update users set color_scheme = 'sand', theme = 'light', date_format = 'us', name_form = 'married', show_prefix = false, show_suffix = false, lineage_view = 'birth' where id = ${me}`.execute(
        trx,
      ),
    );
    const row =
      await sql`select color_scheme, theme, date_format, name_form, show_prefix, show_suffix, lineage_view from users where id = ${me}`.execute(
        t.owner,
      );
    expect(row.rows).toEqual([
      {
        color_scheme: 'sand',
        theme: 'light',
        date_format: 'us',
        name_form: 'married',
        show_prefix: false,
        show_suffix: false,
        lineage_view: 'birth',
      },
    ]);
    await sql`update users set color_scheme = 'forest', theme = 'device', date_format = 'mdy', name_form = 'maiden_married', show_prefix = true, show_suffix = true, lineage_view = 'adoptive' where id = ${me}`.execute(
      t.owner,
    );
  });

  it('cannot change another account’s settings: the update sees no row', async () => {
    const me = f.account.member.id;
    const other = f.account.user.id;
    const changed = await asUser(me, (trx) =>
      trx.updateTable('users').set({ theme: 'dark' }).where('id', '=', other).execute(),
    );
    expect(changed[0]!.numUpdatedRows).toBe(0n);
    expect((await sql`select theme from users where id = ${other}`.execute(t.owner)).rows).toEqual([
      { theme: 'device' },
    ]);
  });

  it('cannot change role, email, the person link or the name, even on its own row', async () => {
    const me = f.account.member.id;
    for (const statement of [
      sql`update users set role = 'superadmin' where id = ${me}`,
      sql`update users set email = 'other@example.com' where id = ${me}`,
      sql`update users set person_id = ${f.person.walter} where id = ${me}`,
      sql`update users set display_name = 'Someone' where id = ${me}`,
      sql`update users set password_hash = 'x' where id = ${me}`,
    ]) {
      await expect(asUser(me, (trx) => statement.execute(trx))).rejects.toThrow(/permission denied/);
    }
  });

  it('refuses a value that is not on the list, even by raw SQL', async () => {
    const me = f.account.member.id;
    for (const column of ['color_scheme', 'theme', 'date_format', 'name_form']) {
      await expect(
        asUser(me, (trx) => sql`update users set ${sql.id(column)} = 'nonsense' where id = ${me}`.execute(trx)),
        column,
      ).rejects.toThrow(/check constraint/);
    }
  });

  it('shows no other account’s row to read', async () => {
    const rows = await asUser(f.account.member.id, (trx) =>
      trx.selectFrom('users').select(['id', 'color_scheme', 'theme']).execute(),
    );
    expect(rows.map((r) => r.id)).toEqual([f.account.member.id]);
  });
});
