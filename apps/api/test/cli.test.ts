// SPDX-License-Identifier: AGPL-3.0-or-later
import { sql } from 'kysely';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyPassword } from '../src/auth/passwords.js';
import { runCli, setUserPassword } from '../src/cli.js';
import { createOwnerDb } from '../src/db.js';
import type { CliDeps } from '../src/cli.js';
import { PASSWORD, createTestApp, insertUser, login, cookieHeader } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';

const apps: TestApp[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

function setup(t: TestApp, password: string) {
  const out: string[] = [];
  const err: string[] = [];
  const readPassword = vi.fn(() => Promise.resolve(password));
  const deps: CliDeps = {
    // runCli closes the connection it is given, so give it its own.
    openDb: () => t.test.track(createOwnerDb(t.test.config)),
    readPassword,
    out: (text) => out.push(text),
    err: (text) => err.push(text),
  };
  return { deps, out, err, readPassword };
}

describe('kinship set-password', () => {
  it('sets a new password and signs the account out everywhere', async () => {
    const t = await createTestApp();
    apps.push(t);
    await insertUser(t.owner, { email: 'marcus@example.com', role: 'superadmin' });
    const cookie = cookieHeader(await login(t.app, 'marcus@example.com'));
    expect((await t.app.inject({ url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(200);

    const { deps, out, err } = setup(t, 'a brand new password');
    expect(await runCli(['set-password', 'Marcus@Example.com'], deps)).toBe(0);
    expect(err).toEqual([]);
    expect(out.join('\n')).toContain('Password changed for marcus@example.com');
    expect(out.join('\n')).not.toContain('a brand new password');

    expect((await t.app.inject({ url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(401); // signed out
    expect((await login(t.app, 'marcus@example.com', PASSWORD)).statusCode).toBe(401); // old password
    expect((await login(t.app, 'marcus@example.com', 'a brand new password')).statusCode).toBe(200);
  });

  it('records that the server owner did it (cli) and retires an open set-password link', async () => {
    const t = await createTestApp();
    apps.push(t);
    const admin = await insertUser(t.owner, { email: 'root@example.com', role: 'superadmin' });
    const target = await insertUser(t.owner, { email: 'lost@example.com', role: 'member' });
    const adminCookie = cookieHeader(await login(t.app, 'root@example.com'));
    const link = await t.app.inject({
      method: 'POST',
      url: `/api/admin/accounts/${target}/set-password-link`,
      headers: { 'x-kinship-request': '1', cookie: adminCookie },
    });
    expect(link.statusCode).toBe(201);
    expect(await runCli(['set-password', 'lost@example.com'], setup(t, 'a brand new password').deps)).toBe(0);
    const row = await sql<{ password_changed_via: string; password_changed_at: Date }>`
      select password_changed_via, password_changed_at from users where id = ${target}`.execute(t.owner);
    expect(row.rows[0]?.password_changed_via).toBe('cli');
    expect(row.rows[0]?.password_changed_at).toBeInstanceOf(Date);
    const token = (link.json() as { token: string }).token;
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: '/api/links/lookup',
          headers: { 'x-kinship-request': '1' },
          payload: { token },
        })
      ).statusCode,
    ).toBe(404);
    expect(admin).toBeDefined();
  });

  it('only touches the named account', async () => {
    const t = await createTestApp();
    apps.push(t);
    await insertUser(t.owner, { email: 'one@example.com' });
    await insertUser(t.owner, { email: 'two@example.com' });
    const twoCookie = cookieHeader(await login(t.app, 'two@example.com'));
    expect(await runCli(['set-password', 'one@example.com'], setup(t, 'a brand new password').deps)).toBe(0);
    expect((await login(t.app, 'two@example.com', PASSWORD)).statusCode).toBe(200);
    expect((await t.app.inject({ url: '/api/auth/me', headers: { cookie: twoCookie } })).statusCode).toBe(200);
  });

  it('stores an argon2id hash, never the password', async () => {
    const t = await createTestApp();
    apps.push(t);
    await insertUser(t.owner, { email: 'marcus@example.com' });
    await runCli(['set-password', 'marcus@example.com'], setup(t, 'a brand new password').deps);
    const stored = await sql<{ password_hash: string }>`select password_hash from users`.execute(t.owner);
    expect(stored.rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(stored.rows[0]?.password_hash ?? '', 'a brand new password')).toBe(true);
  });

  it('fails clearly for an unknown email, a short password and bad arguments', async () => {
    const t = await createTestApp();
    apps.push(t);
    await insertUser(t.owner, { email: 'marcus@example.com' });

    const unknown = setup(t, 'a brand new password');
    expect(await runCli(['set-password', 'ghost@example.com'], unknown.deps)).toBe(1);
    expect(unknown.err.join()).toContain('There is no account with the email ghost@example.com');

    const short = setup(t, 'too short');
    expect(await runCli(['set-password', 'marcus@example.com'], short.deps)).toBe(1);
    expect(short.err.join()).toContain('at least 12 characters');

    for (const argv of [
      [],
      ['nonsense'],
      ['set-password'],
      ['set-password', 'a@b.cc', 'extra'],
      ['set-password', 'a@b.cc', '--password=hunter2hunter2'],
    ]) {
      const bad = setup(t, 'a brand new password');
      expect(await runCli(argv, bad.deps), argv.join(' ')).toBe(2);
      expect(bad.err.join()).toContain('Usage:');
      expect(bad.readPassword).not.toHaveBeenCalled(); // never asks, never touches the database
    }
    const stored = await sql<{ password_hash: string }>`select password_hash from users`.execute(t.owner);
    expect(await verifyPassword(stored.rows[0]?.password_hash ?? '', PASSWORD)).toBe(true); // unchanged
  });

  it('never accepts the password on the command line', async () => {
    const t = await createTestApp();
    apps.push(t);
    const { deps, readPassword } = setup(t, 'a brand new password');
    expect(await runCli(['set-password', 'a@b.cc', '--password', 'secret-secret-secret'], deps)).toBe(2);
    expect(readPassword).not.toHaveBeenCalled();
  });

  it('asks for the password from stdin only when told to', async () => {
    const t = await createTestApp();
    apps.push(t);
    await insertUser(t.owner, { email: 'marcus@example.com' });
    const { deps, readPassword } = setup(t, 'a brand new password');
    await runCli(['set-password', 'marcus@example.com', '--password-stdin'], deps);
    expect(readPassword).toHaveBeenCalledWith({ fromStdin: true });
  });

  it('setUserPassword reports whether an account matched', async () => {
    const t = await createTestApp();
    apps.push(t);
    await insertUser(t.owner, { email: 'marcus@example.com' });
    expect(await setUserPassword(t.owner, 'nobody@example.com', 'x')).toBe(false);
    expect(await setUserPassword(t.owner, 'MARCUS@example.com', 'x')).toBe(true);
  });
});

describe('kinship set-password on a disabled account', () => {
  it('still sets the password, and says that the account is disabled', async () => {
    const t = await createTestApp();
    apps.push(t);
    await insertUser(t.owner, { email: 'root@example.com', role: 'superadmin' });
    await insertUser(t.owner, { email: 'off@example.com', role: 'member' });
    await sql`update users set disabled_at = now() where email = 'off@example.com'`.execute(t.owner);
    const { deps, out, err } = setup(t, 'a brand new password');
    expect(await runCli(['set-password', 'off@example.com'], deps)).toBe(0);
    expect(err).toEqual([]);
    expect(out.join('\n')).toContain('Password changed for off@example.com');
    expect(out.join('\n')).toContain('That account is disabled');
    // and a normal account does not get the note
    const second = setup(t, 'another new password');
    expect(await runCli(['set-password', 'root@example.com'], second.deps)).toBe(0);
    expect(second.out.join('\n')).not.toContain('disabled');
  });
});
