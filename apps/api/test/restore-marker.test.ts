// SPDX-License-Identifier: AGPL-3.0-or-later
//
// SPIKE GATE of the restore-with-files work (ADR 0035): the restore id is written as a comment on the `public` schema INSIDE the
// restore transaction. Everything the design relies on is proved here against the real dump/restore path, not assumed:
//   1. it commits with the restore and is readable afterwards, by any role, with nobody signed in;
//   2. a restore that fails (or is cut short) leaves the previous marker, not the new one;
//   3. the schema is dropped and recreated by every restore, and the marker is written AFTER the dump is replayed, so it wins;
//   4. a later backup's dump carries the marker, and replaying that dump brings the OLD id back (a stale one that can never equal a
//      new restore's id) until the new id is written over it;
//   5. a marker in a dump does not upset the checks (counts, protections fingerprint, Test the backup);
//   6. it works for an owner that is not a superuser.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { createBackup, openArchive } from '../src/backup/archive.js';
import type { BackupContext } from '../src/backup/archive.js';
import { applyArchive, suffixSql } from '../src/backup/restore.js';
import { verifyBackup } from '../src/backup/verify.js';
import { createAppDb, createDb } from '../src/db.js';
import type { AnySchema } from '../src/db.js';
import { isRestoreId, markerSql, readRestoreMarker } from '../src/files/restore-marker.js';
import { ensureAppRole } from '../src/migrations/roles.js';
import { runMigrations } from '../src/migrations/runner.js';
import { buildFamily } from './helpers/family.js';
import { createTestDatabase, server } from './helpers/db.js';
import { realMigrationsDir } from './helpers/migrations-dir.js';
import { runChecked } from '../src/backup/tools.js';
import { testConfig, testTools } from './helpers/pg-tools.js';

const PASS = 'a long backup passphrase for tests';
const CHEAP = { N: 2 ** 4, r: 8, p: 1 };
const id = () => randomBytes(16).toString('hex');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function rig() {
  const test = await createTestDatabase();
  await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
  await runMigrations(test.owner, { dir: realMigrationsDir, appRole: test.config.appUser });
  await buildFamily(test.owner);
  await sql`insert into family_tree (id, name) values (true, 'Hale Family')`.execute(test.owner);
  const dir = mkdtempSync(join(tmpdir(), 'kinship-marker-'));
  dirs.push(dir);
  const ctx: BackupContext = {
    config: { ...testConfig(test, dir, PASS), migrationsDir: realMigrationsDir },
    tools: testTools(),
    log: () => undefined,
    appVersion: '0.3.0-test',
    kdf: CHEAP,
  };
  const restoreWith = async (backup: string, options: { restoreId?: string }) => {
    const archive = await openArchive(join(dir, backup), PASS, ctx.tools, dir);
    try {
      await applyArchive(ctx, archive, test.config.name, { resetState: true, ...options });
    } finally {
      archive.cleanup();
    }
  };
  return { test, dir, ctx, restoreWith };
}

describe('the restore marker (spike)', () => {
  it('only accepts a 32-hex id, so nothing else can reach the SQL', () => {
    expect(isRestoreId(id())).toBe(true);
    for (const bad of ['', 'x', `${id()}'; drop table people; --`, id().toUpperCase(), id().slice(1)]) {
      expect(isRestoreId(bad), bad).toBe(false);
      expect(() => markerSql(bad)).toThrow('not a restore id');
    }
    expect(markerSql('a'.repeat(32))).toBe(`COMMENT ON SCHEMA public IS 'kinship-restore:${'a'.repeat(32)}';`);
  });

  it('is committed with the restore, readable by the app role with nobody signed in, and written after the replay', async () => {
    const r = await rig();
    try {
      expect(await readRestoreMarker(r.test.owner)).toBeNull();
      const made = await createBackup(r.ctx, { kind: 'manual' });
      const first = id();
      await r.restoreWith(made.name, { restoreId: first });
      expect(await readRestoreMarker(r.test.owner)).toBe(first);
      const asApp = r.test.track(createAppDb(r.test.config));
      expect(await readRestoreMarker(asApp)).toBe(first);
      // The script puts it right before the commit, after every check.
      const script = suffixSql(
        await openArchive(join(r.dir, made.name), PASS, r.ctx.tools, r.dir).then((a) => (a.cleanup(), a.manifest)),
        r.test.config.appUser,
        { resetState: true, restoreId: first },
      );
      const lines = script.split('\n');
      expect(lines.indexOf(markerSql(first))).toBeGreaterThan(lines.findIndex((l) => l.includes('fingerprint')));
      expect(lines.indexOf(markerSql(first))).toBeLessThan(lines.indexOf('COMMIT;'));
    } finally {
      await r.test.cleanup();
    }
  }, 120_000);

  it('a restore that fails leaves the previous marker, never the new one', async () => {
    const r = await rig();
    try {
      const made = await createBackup(r.ctx, { kind: 'manual' });
      const kept = id();
      await r.restoreWith(made.name, { restoreId: kept });
      // A restore whose row counts do not match the manifest rolls back after the dump was replayed and before the commit.
      const archive = await openArchive(join(r.dir, made.name), PASS, r.ctx.tools, r.dir);
      try {
        const tampered = { ...archive, manifest: { ...archive.manifest, tables: { ...archive.manifest.tables } } };
        const first = Object.keys(tampered.manifest.tables)[0] as string;
        tampered.manifest.tables[first] = {
          ...(tampered.manifest.tables[first] as { rows: number; digest: string }),
          rows: 987_654,
        };
        await expect(
          applyArchive(r.ctx, tampered, r.test.config.name, { resetState: true, restoreId: id() }),
        ).rejects.toThrow();
      } finally {
        archive.cleanup();
      }
      expect(await readRestoreMarker(r.test.owner)).toBe(kept);
      // And the data is still there (the schema drop rolled back too).
      expect((await sql<{ n: string }>`select count(*)::text as n from people`.execute(r.test.owner)).rows[0]?.n).toBe(
        '11',
      );
    } finally {
      await r.test.cleanup();
    }
  }, 120_000);

  it('a later backup carries the marker; replaying it brings the old id back until the new one is written over it', async () => {
    const r = await rig();
    try {
      const first = await createBackup(r.ctx, { kind: 'manual' });
      const a = id();
      await r.restoreWith(first.name, { restoreId: a });
      // A backup taken after that restore: its dump holds the comment.
      const second = await createBackup(r.ctx, { kind: 'manual' });
      const archive = await openArchive(join(r.dir, second.name), PASS, r.ctx.tools, r.dir);
      try {
        const parts: Buffer[] = [];
        await archive.extract('database.dump', new Writable({ write: (c: Buffer, _e, cb) => (parts.push(c), cb()) }));
        const sqlText = (
          await runChecked(r.ctx.tools.pgRestore, ['-f', '-', '--no-owner'], {
            env: { PATH: process.env['PATH'] ?? '' },
            stdin: Readable.from([Buffer.concat(parts)]),
          })
        ).toString('utf8');
        expect(sqlText).toContain(`COMMENT ON SCHEMA public IS 'kinship-restore:${a}'`);
      } finally {
        archive.cleanup();
      }
      // Replayed WITHOUT a new id (a database-only style restore): the stale id from the backup comes back, which is not any new id.
      await r.restoreWith(second.name, {});
      expect(await readRestoreMarker(r.test.owner)).toBe(a);
      // Replayed WITH a new id: the new one wins, because it is written after the replay.
      const b = id();
      await r.restoreWith(second.name, { restoreId: b });
      expect(await readRestoreMarker(r.test.owner)).toBe(b);
      expect(b).not.toBe(a);
    } finally {
      await r.test.cleanup();
    }
  }, 180_000);

  it('does not upset Test the backup or the fingerprint check', async () => {
    const r = await rig();
    try {
      const first = await createBackup(r.ctx, { kind: 'manual' });
      await r.restoreWith(first.name, { restoreId: id() });
      const second = await createBackup(r.ctx, { kind: 'manual' });
      const result = await verifyBackup(r.ctx, join(r.dir, second.name));
      expect(result.ok).toBe(true);
      expect(result.mode).toBe('restore');
    } finally {
      await r.test.cleanup();
    }
  }, 180_000);
});

describe('the marker with an owner that is not a superuser', () => {
  it('the drop, recreate and comment in one transaction work, commit, and read back', async () => {
    const suffix = randomBytes(5).toString('hex');
    const name = `kinship_marker_${suffix}`;
    const owner = `kinship_markerown_${suffix}`;
    const admin = createDb<AnySchema>(
      { host: server.host, port: server.port, name: 'postgres' },
      server.user,
      server.password,
      1,
    );
    await sql`create role ${sql.id(owner)} login nosuperuser nocreatedb createrole nobypassrls password 'pw-${sql.raw(suffix)}'`.execute(
      admin,
    );
    await sql`create database ${sql.id(name)} owner ${sql.id(owner)}`.execute(admin);
    const db = createDb<AnySchema>({ host: server.host, port: server.port, name }, owner, `pw-${suffix}`, 1);
    try {
      const restoreId = id();
      await db.transaction().execute(async (trx) => {
        await sql`drop schema if exists public cascade`.execute(trx);
        await sql`create schema public`.execute(trx);
        await sql.raw(markerSql(restoreId)).execute(trx);
      });
      expect(await readRestoreMarker(db)).toBe(restoreId);
      // A rolled-back attempt does not change it.
      await expect(
        db.transaction().execute(async (trx) => {
          await sql.raw(markerSql(id())).execute(trx);
          throw new Error('cut short');
        }),
      ).rejects.toThrow('cut short');
      expect(await readRestoreMarker(db)).toBe(restoreId);
      // Someone who edits the comment by hand does not make a valid marker.
      await sql`comment on schema public is 'my own note'`.execute(db);
      expect(await readRestoreMarker(db)).toBeNull();
    } finally {
      await db.destroy();
      await sql`drop database if exists ${sql.id(name)} with (force)`.execute(admin);
      await sql`drop role if exists ${sql.id(owner)}`.execute(admin);
      await admin.destroy();
    }
  }, 60_000);
});
