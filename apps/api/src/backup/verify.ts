// SPDX-License-Identifier: AGPL-3.0-or-later
//
// "Test the latest backup": prove an archive is good by really restoring it into a temporary database, comparing what came back
// with what the manifest recorded, and throwing the database away. Nothing about the live data is touched, and the app role is
// only used for the final functional check (inside the temporary database).
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { createDb } from '../db.js';
import type { AnySchema, UntypedDb } from '../db.js';
import { readMigrationFiles } from '../migrations/files.js';
import { BACKUP_LOCK_KEY, openArchive } from './archive.js';
import type { BackupContext } from './archive.js';
import { BackupError } from './errors.js';
import { fingerprint, fingerprintDifferences, tableStats } from './inspect.js';
import { applyArchive } from './restore.js';
import { clean } from './tools.js';

export interface VerifyCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface VerifyResult {
  /** `restore`: restored into a temporary database. `archive-only`: only decrypted and checked (see `note`). */
  mode: 'restore' | 'archive-only';
  ok: boolean;
  checks: VerifyCheck[];
  tables: number;
  rows: number;
  note?: string;
  ms: number;
}

const PREFIX = 'kinship_verify_';

/**
 * Drops every `kinship_verify_*` database left behind by a test that was cut short. Run at start-up. Skips quietly if a
 * backup, test or restore holds the lock right now (that one may be using such a database).
 */
export async function sweepVerifyDatabases(ctx: BackupContext, db?: UntypedDb): Promise<string[]> {
  const own = db ?? createDb<AnySchema>(ctx.config.db, ctx.config.db.ownerUser, ctx.config.db.ownerPassword, 2);
  const dropped: string[] = [];
  try {
    await own.connection().execute(async (conn) => {
      const lock = await sql<{ ok: boolean }>`select pg_try_advisory_lock(${BACKUP_LOCK_KEY}) as ok`.execute(conn);
      if (!lock.rows[0]?.ok) return;
      try {
        const found = await sql<{ datname: string }>`
          select datname from pg_database where datname like ${`${PREFIX}%`} order by datname`.execute(conn);
        for (const { datname } of found.rows) {
          await sql`drop database if exists ${sql.id(datname)} with (force)`.execute(conn);
          dropped.push(datname);
        }
      } finally {
        await sql`select pg_advisory_unlock(${BACKUP_LOCK_KEY})`.execute(conn);
      }
    });
  } finally {
    if (!db) await own.destroy();
  }
  if (dropped.length > 0) ctx.log('warn', 'removed leftover temporary test databases', { databases: dropped });
  return dropped;
}

/**
 * Checks an archive. Always: every block authenticates, the entry names, the manifest, the SHA-256 of the dump and that
 * pg_restore can read it. Then, if the owner may create databases: restore into `kinship_verify_<random>`, compare every table's
 * row count and digest and the protections fingerprint with the manifest, check the migration checksums match THIS image, and
 * read the people as the app role. One at a time (the backup lock). The temporary database is always dropped.
 */
export async function verifyBackup(ctx: BackupContext, archivePath: string): Promise<VerifyResult> {
  const { config, tools, log } = ctx;
  const passphrase = config.backup.passphrase;
  if (passphrase === undefined) throw new BackupError('passphrase', 'Testing a backup needs the backup passphrase.');
  const started = Date.now();
  const checks: VerifyCheck[] = [];
  const secrets = [config.db.ownerPassword, passphrase];
  const archive = await openArchive(archivePath, passphrase, tools, config.backup.dir);
  checks.push({ name: 'Every block authenticates; the manifest and the database dump match', ok: true });
  const tableCount = Object.keys(archive.manifest.tables).length;
  const rows = Object.values(archive.manifest.tables).reduce((sum, t) => sum + t.rows, 0);
  const db = createDb<AnySchema>(config.db, config.db.ownerUser, config.db.ownerPassword, 3);
  const temp = `${PREFIX}${randomBytes(6).toString('hex')}`;
  let created = false;
  try {
    return await db.connection().execute(async (conn) => {
      const lock = await sql<{ ok: boolean }>`select pg_try_advisory_lock(${BACKUP_LOCK_KEY}) as ok`.execute(conn);
      if (!lock.rows[0]?.ok) throw new BackupError('busy', 'A backup, test or restore is already running.');
      try {
        const can = await sql<{ ok: boolean }>`
          select (rolsuper or rolcreatedb) as ok from pg_roles where rolname = current_user`.execute(conn);
        if (!can.rows[0]?.ok) {
          return {
            mode: 'archive-only' as const,
            ok: true,
            checks,
            tables: tableCount,
            rows,
            note: `The database owner role "${config.db.ownerUser}" cannot create databases, so the backup was decrypted and checked but not restored into a temporary database. A superuser can allow it with: ALTER ROLE "${config.db.ownerUser}" CREATEDB;`,
            ms: Date.now() - started,
          };
        }

        await sql`create database ${sql.id(temp)} template template0`.execute(conn);
        created = true;
        await applyArchive(ctx, archive, temp, { resetState: false });
        checks.push({
          name: 'Restored into a temporary database; row counts and the protections fingerprint matched inside the transaction',
          ok: true,
        });

        const inTemp = createDb<AnySchema>(
          { ...config.db, name: temp },
          config.db.ownerUser,
          config.db.ownerPassword,
          2,
        );
        const asApp = createDb<AnySchema>({ ...config.db, name: temp }, config.db.appUser, config.db.appPassword, 1);
        try {
          // Digests: the data itself, not just how much of it.
          const stats = await inTemp.transaction().execute((trx) => tableStats(trx));
          const bad = Object.entries(archive.manifest.tables).filter(([name, expected]) => {
            const actual = stats[name];
            return !actual || actual.rows !== expected.rows || actual.digest !== expected.digest;
          });
          checks.push({
            name: 'Every table has the same rows as when the backup was made (counts and digests)',
            ok: bad.length === 0,
            ...(bad.length > 0 ? { detail: `different: ${bad.map(([name]) => name).join(', ')}` } : {}),
          });

          const print = await fingerprint(inTemp, config.db.appUser);
          const differences = fingerprintDifferences(archive.manifest.fingerprint, print);
          checks.push({
            name: 'Row-level security, policies, functions and grants are the same',
            ok: differences.length === 0,
            ...(differences.length > 0 ? { detail: differences.slice(0, 5).join('; ') } : {}),
          });

          // The migrations the backup recorded must be the ones this image carries.
          const files = new Map((await readMigrationFiles(config.migrationsDir)).map((f) => [f.name, f.sha256]));
          const recorded = await sql<{
            name: string;
            sha256: string;
          }>`select name, sha256 from kinship_migration_checksum`.execute(inTemp);
          const mismatched = recorded.rows.filter((row) => files.has(row.name) && files.get(row.name) !== row.sha256);
          const unknown = recorded.rows.filter((row) => !files.has(row.name));
          checks.push({
            name: "The backup's migrations match this version of KinShip",
            ok: mismatched.length === 0 && unknown.length === 0,
            ...(mismatched.length + unknown.length > 0
              ? {
                  detail: [
                    ...mismatched.map((r) => `${r.name} differs`),
                    ...unknown.map((r) => `${r.name} is unknown here`),
                  ].join('; '),
                }
              : {}),
          });

          // A SuperAdmin, as the app role, can read the people: the grants and policies work in the restored copy.
          const admin = await sql<{
            id: string;
          }>`select id from users where role = 'superadmin' order by created_at limit 1`.execute(inTemp);
          const expectedPeople = archive.manifest.tables['people']?.rows ?? 0;
          const adminId = admin.rows[0]?.id;
          if (adminId === undefined) {
            checks.push({
              name: 'The app role reads the people as a SuperAdmin',
              ok: true,
              detail: 'skipped: this backup has no SuperAdmin yet',
            });
          } else {
            const seen = await asApp.transaction().execute(async (trx) => {
              await sql`select set_config('kinship.user_id', ${adminId}, true)`.execute(trx);
              return (await sql<{ n: string }>`select count(*)::text as n from people`.execute(trx)).rows[0]?.n;
            });
            checks.push({
              name: 'The app role reads the people as a SuperAdmin',
              ok: Number(seen) === expectedPeople,
              ...(Number(seen) !== expectedPeople ? { detail: `saw ${seen}, expected ${expectedPeople}` } : {}),
            });
          }
        } finally {
          await inTemp.destroy();
          await asApp.destroy();
        }
        return {
          mode: 'restore' as const,
          ok: checks.every((c) => c.ok),
          checks,
          tables: tableCount,
          rows,
          ms: Date.now() - started,
        };
      } finally {
        if (created) {
          await sql`drop database if exists ${sql.id(temp)} with (force)`.execute(conn).catch((error: unknown) => {
            log('error', 'could not drop the temporary test database', {
              database: temp,
              reason: clean(String(error), secrets),
            });
          });
        }
        await sql`select pg_advisory_unlock(${BACKUP_LOCK_KEY})`.execute(conn);
      }
    });
  } finally {
    archive.cleanup();
    await db.destroy();
  }
}
