// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A backup is taken by the database OWNER role. If that role is a plain role (ADR 0001 allows it) it is subject to the
// forced row-level security on the tree tables, so a dump would miss rows: the backup must refuse, say how to fix it, and
// work once the owner may bypass row-level security. The same database proves migration 0013 under a differently named
// owner.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBackup, openArchive } from '../src/backup/archive.js';
import type { BackupContext } from '../src/backup/archive.js';
import { ownerReadsEverything } from '../src/backup/inspect.js';
import { verifyBackup } from '../src/backup/verify.js';
import type { DbConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import type { AnySchema, UntypedDb } from '../src/db.js';
import { ensureAppRole } from '../src/migrations/roles.js';
import { runMigrations } from '../src/migrations/runner.js';
import { server } from './helpers/db.js';
import { realMigrationsDir } from './helpers/migrations-dir.js';
import { testTools } from './helpers/pg-tools.js';

const id = randomBytes(5).toString('hex');
const config: DbConfig = {
  host: server.host,
  port: server.port,
  name: `kinship_bo_${id}`,
  ownerUser: `weird_owner_${id}`,
  ownerPassword: `owner-${id}-password`,
  appUser: `kinship_boapp_${id}`,
  appPassword: `app-${id}-password`,
};
const dir = mkdtempSync(join(tmpdir(), 'kinship-bo-'));
const PASS = 'a long backup passphrase for tests';

let admin: UntypedDb;
let owner: UntypedDb;

beforeAll(async () => {
  admin = createDb<AnySchema>(
    { host: server.host, port: server.port, name: 'postgres' },
    server.user,
    server.password,
    1,
  );
  await sql`create role ${sql.id(config.ownerUser)} login nosuperuser nocreatedb createrole nobypassrls password ${sql.lit(config.ownerPassword)}`.execute(
    admin,
  );
  await sql`create database ${sql.id(config.name)} owner ${sql.id(config.ownerUser)}`.execute(admin);
  owner = createDb<AnySchema>(config, config.ownerUser, config.ownerPassword, 2);
  await ensureAppRole(owner, config.appUser, config.appPassword);
  await runMigrations(owner, { dir: realMigrationsDir, appRole: config.appUser });
}, 60_000);

afterAll(async () => {
  await owner.destroy();
  await sql`drop database if exists ${sql.id(config.name)} with (force)`.execute(admin);
  await sql`drop role if exists ${sql.id(config.appUser)}`.execute(admin);
  await sql`drop role if exists ${sql.id(config.ownerUser)}`.execute(admin);
  await admin.destroy();
  rmSync(dir, { recursive: true, force: true });
});

const context = (): BackupContext => ({
  config: {
    publicUrl: '',
    trustProxy: false,
    sessionIdleSeconds: 1,
    sessionMaxSeconds: 1,
    logLevel: 'silent',
    host: '',
    port: 0,
    migrationsDir: '',
    gitCommit: '',
    buildDate: '',
    db: config,
    backup: { enabled: true, dir, passphrase: PASS },
  },
  tools: testTools(),
  log: () => undefined,
  appVersion: '0.2.0-test',
  kdf: { N: 16, r: 8, p: 1 },
});

describe('an owner role that cannot read every row', () => {
  it('is refused with the exact statement that fixes it, before anything is dumped', async () => {
    expect(await ownerReadsEverything(owner)).toBe(false);
    const failure = await createBackup(context(), { kind: 'manual' }).catch((e: unknown) => e as Error);
    expect(failure).toMatchObject({ kind: 'owner_cannot_read_all' });
    expect((failure as Error).message).toContain(`ALTER ROLE "${config.ownerUser}" BYPASSRLS;`);
  });

  it('works once a superuser lets the owner bypass row-level security, and sees every row', async () => {
    await sql`insert into users (email, display_name, password_hash, role) values ('a@example.com', 'A', 'x', 'superadmin')`.execute(
      owner,
    );
    await sql`alter role ${sql.id(config.ownerUser)} bypassrls`.execute(admin);
    expect(await ownerReadsEverything(owner)).toBe(true);
    // Under forced row-level security the owner now sees the whole table.
    const result = await createBackup(context(), { kind: 'manual' });
    const archive = await openArchive(result.path, PASS, testTools(), dir);
    try {
      expect(archive.manifest.ownerRole).toBe(config.ownerUser);
      expect(archive.manifest.tables['users']?.rows).toBe(1);
      expect(archive.manifest.fingerprint.tables).toContain('people:rls=true:force=true');
    } finally {
      archive.cleanup();
    }
  });
});

describe('testing a backup when the owner cannot create databases', () => {
  it('checks the archive and says it could not restore it into a temporary database', async () => {
    const made = await createBackup(context(), { kind: 'manual' });
    const result = await verifyBackup(context(), made.path);
    expect(result).toMatchObject({ mode: 'archive-only', ok: true });
    expect(result.note).toContain(`ALTER ROLE "${config.ownerUser}" CREATEDB;`);
  });
});

describe('migration 0013 under a differently named, non-superuser owner', () => {
  it('has widow policies that name no role', async () => {
    const policies = await sql<{ polname: string; polroles: string }>`
      select polname, polroles::text from pg_policy where polname like '%widowed_internal' order by polname`.execute(
      owner,
    );
    expect(policies.rows).toEqual([
      { polname: 'people_select_widowed_internal', polroles: '{0}' },
      { polname: 'unions_select_widowed_internal', polroles: '{0}' },
      { polname: 'unions_update_widowed_internal', polroles: '{0}' },
    ]);
  });

  it('opens for a member of the owner, and never for the app role', async () => {
    // A person row, inserted as the owner (who bypasses row-level security now).
    await sql`insert into people (given_name, surname) values ('Walter', 'Hale')`.execute(owner);
    // The app role: even with the setting on, nobody is signed in, so it sees nothing.
    const app = createDb<AnySchema>(config, config.appUser, config.appPassword, 1);
    try {
      await app.transaction().execute(async (trx) => {
        await sql`select set_config('kinship.widow_internal', 'on', true)`.execute(trx);
        const seen = await sql<{ n: string }>`select count(*)::text as n from people`.execute(trx);
        expect(seen.rows[0]?.n).toBe('0');
      });
    } finally {
      await app.destroy();
    }
    // A role that is a member of the owner (but another name): with the setting on it reads, with it off it does not.
    const member = `member_${id}`;
    await sql`create role ${sql.id(member)} login password 'member-pass'`.execute(admin);
    await sql`grant ${sql.id(config.ownerUser)} to ${sql.id(member)}`.execute(admin);
    await sql`grant connect on database ${sql.id(config.name)} to ${sql.id(member)}`.execute(admin);
    const asMember = createDb<AnySchema>(config, member, 'member-pass', 1);
    try {
      const counts = await asMember.transaction().execute(async (trx) => {
        const off = await sql<{ n: string }>`select count(*)::text as n from people`.execute(trx);
        await sql`select set_config('kinship.widow_internal', 'on', true)`.execute(trx);
        const on = await sql<{ n: string }>`select count(*)::text as n from people`.execute(trx);
        return { off: off.rows[0]?.n, on: on.rows[0]?.n };
      });
      expect(counts).toEqual({ off: '0', on: '1' });
    } finally {
      await asMember.destroy();
      await sql`revoke connect on database ${sql.id(config.name)} from ${sql.id(member)}`.execute(admin);
      await sql`drop role if exists ${sql.id(member)}`.execute(admin);
    }
  });
});
