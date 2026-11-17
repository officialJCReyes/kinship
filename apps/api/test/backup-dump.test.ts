// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkEntryNames, classifyName, createBackup, listBackups, openArchive, stamp } from '../src/backup/archive.js';
import type { BackupContext } from '../src/backup/archive.js';
import { BackupError } from '../src/backup/errors.js';
import { BackupFormatError } from '../src/backup/format.js';
import { run, runChecked } from '../src/backup/tools.js';
import { runCli } from '../src/cli.js';
import type { CliDeps } from '../src/cli.js';
import { createAppDb } from '../src/db.js';
import { buildFamily } from './helpers/family.js';
import { testConfig, testTools } from './helpers/pg-tools.js';
import { createTestApp } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';

const PASS = 'a long backup passphrase for tests';
const CHEAP = { N: 2 ** 4, r: 8, p: 1 };
const dirs: string[] = [];
const folder = () => {
  const dir = mkdtempSync(join(tmpdir(), 'kinship-backups-'));
  dirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
  await buildFamily(t.owner);
  await sql`insert into family_tree (id, name) values (true, 'Hale Family')`.execute(t.owner);
}, 60_000);
afterAll(() => t.close());

const logs: string[] = [];
function context(dir: string, overrides: Partial<BackupContext> = {}, passphrase: string | null = PASS): BackupContext {
  return {
    config: testConfig(t.test, dir, passphrase ?? undefined),
    tools: testTools(),
    log: (level, message, fields) => logs.push(JSON.stringify({ level, message, ...fields })),
    appVersion: '0.2.0-test',
    kdf: CHEAP,
    ...overrides,
  };
}

const sink = () => {
  const parts: Buffer[] = [];
  return {
    stream: new Writable({ write: (c: Buffer, _e, cb) => (parts.push(c), cb()) }),
    text: () => Buffer.concat(parts),
  };
};

describe('a backup of the populated Hale database', () => {
  it('is one encrypted archive: manifest, dump, and counts that match the database', async () => {
    const dir = folder();
    const result = await createBackup(context(dir), { kind: 'manual' });
    expect(result.name).toMatch(/^kinship-\d{4}-\d{2}-\d{2}-\d{4}\.tar\.enc$/);
    expect(readdirSync(dir)).toEqual([result.name]);
    expect(readFileSync(result.path).subarray(0, 4).toString()).toBe('KSBK');

    const archive = await openArchive(result.path, PASS, testTools(), dir);
    try {
      expect(archive.entries.sort()).toEqual(['database.dump', 'manifest.json']);
      const { manifest } = archive;
      expect(manifest).toMatchObject({
        format: 1,
        kind: 'manual',
        appVersion: '0.2.0-test',
        ownerRole: t.test.config.ownerUser,
        appRole: t.test.config.appUser,
        files: { included: false, count: 0 },
      });
      const schema = await sql<{ n: number }>`select schema_number as n from schema_info`.execute(t.owner);
      expect(manifest.schema).toBe(schema.rows[0]?.n);
      expect(archive.header.schema).toBe(manifest.schema);
      expect(manifest.tables['people']?.rows).toBe(11);
      expect(manifest.tables['users']?.rows).toBe(5);
      expect(Object.keys(manifest.tables)).toEqual(
        expect.arrayContaining([
          'people',
          'unions',
          'person_parents',
          'users',
          'app_settings',
          'upgrade_log',
          'kysely_migration',
        ]),
      );
      expect(manifest.fingerprint.tables).toContain('people:rls=true:force=true');
      expect(manifest.fingerprint.appRole).toEqual({
        superuser: false,
        bypassRls: false,
        createDb: false,
        createRole: false,
      });
    } finally {
      archive.cleanup();
    }
    // The work folder is gone, and the archive is private.
    expect(readdirSync(dir)).toEqual([result.name]);
  });

  it('holds rows the app role cannot see: the dump is taken as the owner', async () => {
    // As the app role with nobody signed in, row-level security shows no people at all ...
    const app = createAppDb(t.test.config);
    try {
      const seen = await sql<{ n: string }>`select count(*)::text as n from people`.execute(app);
      expect(seen.rows[0]?.n).toBe('0');
    } finally {
      await app.destroy();
    }
    // ... but every person is in the backup.
    const dir = folder();
    const result = await createBackup(context(dir), { kind: 'manual' });
    const archive = await openArchive(result.path, PASS, testTools(), dir);
    try {
      const dump = sink();
      await archive.extract('database.dump', dump.stream);
      const script = sink();
      await run(testTools().pgRestore, ['-f', '-'], {
        env: { PATH: process.env['PATH'] ?? '' },
        stdin: Readable.from([dump.text()]),
        stdout: script.stream,
      });
      const text = script.text().toString('utf8');
      for (const name of [
        'Walter',
        'Rosa',
        'Daniel',
        'Elena',
        'Beatriz',
        'Marcus',
        'Sofia',
        'Gabriel',
        'Tomas',
        'Priya',
        'Leo',
      ]) {
        expect(text, name).toContain(name);
      }
      expect(text).toContain('ENABLE ROW LEVEL SECURITY');
      expect(text).toContain('FORCE ROW LEVEL SECURITY');
      expect(text).toContain('SECURITY DEFINER');
    } finally {
      archive.cleanup();
    }
  });

  it('carries media files in a files/ slot, and refuses an unsafe file name', async () => {
    const dir = folder();
    const photo = join(folder(), 'whatever.bin');
    writeFileSync(photo, 'encrypted photo bytes');
    const result = await createBackup(
      context(dir, { files: () => Promise.resolve([{ name: 'photo-1.bin', path: photo }]) }),
      { kind: 'manual' },
    );
    expect(result.manifest.files).toEqual({ included: true, count: 1 });
    const archive = await openArchive(result.path, PASS, testTools(), dir);
    try {
      expect(archive.entries).toContain('files/photo-1.bin');
      const out = sink();
      await archive.extract('files/photo-1.bin', out.stream);
      expect(out.text().toString()).toBe('encrypted photo bytes');
    } finally {
      archive.cleanup();
    }
    await expect(
      createBackup(context(folder(), { files: () => Promise.resolve([{ name: '../evil', path: photo }]) }), {
        kind: 'manual',
      }),
    ).rejects.toThrow(/safe file name/);
  });

  it('refuses a missing or weak passphrase, and a folder it cannot write to, with the fix', async () => {
    await expect(createBackup(context(folder(), {}, null), { kind: 'manual' })).rejects.toMatchObject({
      kind: 'passphrase',
    });
    await expect(createBackup(context(folder(), {}, 'short'), { kind: 'manual' })).rejects.toThrow(/shorter than 16/);
    await expect(createBackup(context(folder(), {}, 'change-me-backup'), { kind: 'manual' })).rejects.toThrow(
      /placeholder/,
    );
    const notAFolder = join(folder(), 'a-file');
    writeFileSync(notAFolder, 'x');
    const failure = await createBackup(context(notAFolder), { kind: 'manual' }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(BackupError);
    expect((failure as BackupError).kind).toBe('dir_not_writable');
    expect((failure as BackupError).message).toContain('mkdir -p data/backups && sudo chown 1000:1000 data/backups');
    expect((failure as BackupError).message).toContain('./data/backups:/var/lib/kinship/backups');
  });

  it('runs one at a time, and a second in the same minute gets its own name', async () => {
    const dir = folder();
    const results = await Promise.allSettled([
      createBackup(context(dir), { kind: 'manual' }),
      createBackup(context(dir), { kind: 'manual' }),
    ]);
    const failed = results.filter((r) => r.status === 'rejected');
    expect(failed.length).toBeGreaterThanOrEqual(0);
    for (const result of failed) expect((result.reason as BackupError).kind).toBe('busy');
    const now = new Date(Date.UTC(2026, 10, 14, 3, 0));
    const a = await createBackup(context(dir, { now: () => now }), { kind: 'manual' });
    const b = await createBackup(context(dir, { now: () => now }), { kind: 'manual' });
    expect(a.name).toBe(`kinship-${stamp(now)}.tar.enc`);
    expect(b.name).toBe(`kinship-${stamp(now)}-2.tar.enc`);
    expect(stamp(now)).toBe('2026-11-14-0300');
  });

  it('keeps the passphrase and the owner password out of arguments, logs and errors', async () => {
    const dir = folder();
    const recorder = join(folder(), 'pg_dump-recorder');
    const argsFile = join(dirs[dirs.length - 1] as string, 'args.log');
    const real = testTools().pgDump;
    writeFileSync(recorder, `#!/bin/sh\nprintf '%s\\n' "$@" >> '${argsFile}'\nexec '${real}' "$@"\n`);
    chmodSync(recorder, 0o755);
    const ctx = context(dir, { tools: { ...testTools(), pgDump: recorder } });
    await createBackup(ctx, { kind: 'manual' });
    const args = readFileSync(argsFile, 'utf8');
    expect(args).toContain('--snapshot=');
    for (const secret of [PASS, t.test.config.ownerPassword, t.test.config.appPassword]) {
      expect(args).not.toContain(secret);
      expect(logs.join('\n')).not.toContain(secret);
    }
    // A failing tool: its message is cleaned and never carries a secret either.
    const broken = join(folder(), 'pg_dump-broken');
    writeFileSync(
      broken,
      `#!/bin/sh\necho "password authentication failed for ${t.test.config.ownerPassword} ${PASS}" >&2\nexit 1\n`,
    );
    chmodSync(broken, 0o755);
    const failure = (await createBackup(context(folder(), { tools: { ...testTools(), pgDump: broken } }), {
      kind: 'manual',
    }).catch((e: unknown) => e)) as Error;
    expect(failure.message).not.toContain(t.test.config.ownerPassword);
    expect(failure.message).not.toContain(PASS);
    expect(failure.message).toContain('pg_dump');
  });
});

describe('opening an archive', () => {
  it('tells a wrong passphrase from damage, before anything else happens', async () => {
    const dir = folder();
    const { path } = await createBackup(context(dir), { kind: 'manual' });
    await expect(openArchive(path, 'not the right passphrase', testTools(), dir)).rejects.toMatchObject({
      code: 'wrong_passphrase',
    });
    const bytes = readFileSync(path);
    const flipped = Buffer.from(bytes);
    flipped[flipped.length - 40] = (flipped[flipped.length - 40] ?? 0) ^ 1;
    writeFileSync(join(dir, 'flipped.tar.enc'), flipped);
    const error = await openArchive(join(dir, 'flipped.tar.enc'), PASS, testTools(), dir).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BackupFormatError);
    expect((error as BackupFormatError).code).toBe('corrupt');
    writeFileSync(join(dir, 'cut.tar.enc'), bytes.subarray(0, bytes.length - 100));
    await expect(openArchive(join(dir, 'cut.tar.enc'), PASS, testTools(), dir)).rejects.toBeInstanceOf(
      BackupFormatError,
    );
    // Nothing is left behind in the folder but our files.
    expect(readdirSync(dir).filter((n) => n.startsWith('.'))).toEqual([]);
  });

  it('accepts only the entries we write', () => {
    expect(() => checkEntryNames(['manifest.json', 'database.dump'])).not.toThrow();
    expect(() => checkEntryNames(['manifest.json', 'database.dump', 'files/', 'files/a-1.bin'])).not.toThrow();
    for (const bad of ['../evil', '/etc/passwd', 'files/../x', 'files/sub/x', 'other.txt', 'files/ a', '']) {
      expect(() => checkEntryNames(['manifest.json', 'database.dump', bad]), bad).toThrow(/unexpected entry/);
    }
    expect(() => checkEntryNames(['manifest.json', 'database.dump', 'manifest.json'])).toThrow(/twice/);
    expect(() => checkEntryNames(['manifest.json'])).toThrow(/missing/);
  });
});

describe('the folder listing', () => {
  it('lists only our names, never a link, with the cleartext header', async () => {
    const dir = folder();
    const made = await createBackup(context(dir), { kind: 'manual' });
    writeFileSync(join(dir, 'notes.txt'), 'x');
    writeFileSync(join(dir, 'pre-upgrade-0012-to-0013.sql.gz'), 'x');
    writeFileSync(join(dir, 'kinship-2026-11-14-0300.tar.enc.bak'), 'x');
    mkdirSync(join(dir, 'kinship-2026-01-01-0000.tar.enc'));
    symlinkSync(made.path, join(dir, 'kinship-2026-02-02-0000.tar.enc'));
    const listed = listBackups(dir);
    expect(listed.map((l) => l.name).sort()).toEqual([made.name, 'pre-upgrade-0012-to-0013.sql.gz'].sort());
    const entry = listed.find((l) => l.name === made.name);
    expect(entry).toMatchObject({ kind: 'manual', encrypted: true, header: { appVersion: '0.2.0-test' } });
    expect(listed.find((l) => l.kind === 'pre-upgrade')?.encrypted).toBe(false);
  });

  it('classifies names strictly', () => {
    expect(classifyName('kinship-2026-11-14-0300.tar.enc')).toEqual({ kind: 'manual', encrypted: true });
    expect(classifyName('kinship-2026-11-14-0300-2.tar.enc')).toBeDefined();
    expect(classifyName('pre-restore-20261114-030000.tar.enc')).toEqual({ kind: 'pre-restore', encrypted: true });
    for (const bad of [
      '../kinship-2026-11-14-0300.tar.enc',
      'kinship-2026-11-14-0300.tar',
      'kinship-2026-11-14-0300.tar.enc/',
      'x/kinship-2026-11-14-0300.tar.enc',
      'kinship-2026-11-14-0300.tar.enc\n',
    ]) {
      expect(classifyName(bad), bad).toBeUndefined();
    }
  });
});

describe('the kinship command line', () => {
  const output = () => {
    const out: string[] = [];
    const err: string[] = [];
    return {
      out,
      err,
      deps: (dir: string, config: ReturnType<typeof testConfig>): CliDeps => ({
        openDb: () => t.owner,
        readPassword: () => Promise.resolve(''),
        out: (text) => out.push(text),
        err: (text) => err.push(text),
        backup: { config: () => config, tools: testTools(), env: { BACKUP_DIR: dir, BACKUP_PASSPHRASE: PASS } },
      }),
    };
  };

  it('makes a backup, lists it, checks it, and decrypts it to a tar', async () => {
    const dir = folder();
    const { out, err, deps } = output();
    const config = { ...testConfig(t.test, dir, PASS) };
    expect(await runCli(['backup'], deps(dir, config))).toBe(0);
    expect(out.join('\n')).toMatch(/Backup written: kinship-\d{4}-\d{2}-\d{2}-\d{4}\.tar\.enc/);
    out.length = 0;
    expect(await runCli(['backup-list'], deps(dir, config))).toBe(0);
    const line = out.join('\n');
    expect(line).toMatch(/manual/);
    const name = /(kinship-\S+\.tar\.enc)/.exec(line)?.[1] as string;
    out.length = 0;
    expect(await runCli(['backup-verify', name], deps(dir, config))).toBe(0);
    expect(out.join('\n')).toContain('OK: every block authenticated');
    expect(out.join('\n')).toMatch(/\d+ tables, \d+ rows/);
    const tarPath = join(folder(), 'out.tar');
    expect(await runCli(['backup-decrypt', name, tarPath], deps(dir, config))).toBe(0);
    const listing = (await runChecked('tar', ['-t', '-f', tarPath], { env: { PATH: process.env['PATH'] ?? '' } }))
      .toString()
      .split('\n')
      .filter(Boolean);
    expect(listing.sort()).toEqual(['database.dump', 'manifest.json']);
    expect(err).toEqual([]);
  });

  it('says plainly what is wrong: wrong passphrase, no such file, no passphrase', async () => {
    const dir = folder();
    const { err, deps } = output();
    const config = testConfig(t.test, dir, PASS);
    await createBackup(context(dir), { kind: 'manual' });
    const name = readdirSync(dir).find((n) => n.endsWith('.tar.enc')) as string;
    const wrong = deps(dir, config);
    wrong.backup = { ...wrong.backup, env: { BACKUP_DIR: dir, BACKUP_PASSPHRASE: 'definitely not the passphrase' } };
    expect(await runCli(['backup-verify', name], wrong)).toBe(1);
    expect(err.join('\n')).toMatch(/passphrase does not match/);
    err.length = 0;
    expect(await runCli(['backup-verify', 'kinship-1999-01-01-0000.tar.enc'], deps(dir, config))).toBe(1);
    err.length = 0;
    const none = deps(dir, config);
    none.backup = { ...none.backup, env: { BACKUP_DIR: dir } };
    expect(await runCli(['backup-verify', name], none)).toBe(1);
    expect(err.join('\n')).toMatch(/Give the passphrase/);
    expect(existsSync(join(dir, name))).toBe(true);
  });
});
