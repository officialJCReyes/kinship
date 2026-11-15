// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it } from 'vitest';
import { readMigrationFiles } from '../src/migrations/files.js';
import { realMigrationsDir, tempMigrationsDir } from './helpers/migrations-dir.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function emptyDir() {
  const dir = await tempMigrationsDir(false);
  cleanups.push(dir.remove);
  return dir;
}

describe('readMigrationFiles', () => {
  it('reads the real migrations with a name, a number and a checksum', async () => {
    const files = await readMigrationFiles(realMigrationsDir);
    expect(files[0]).toMatchObject({ name: '0001_schema_info_and_grants', number: 1 });
    expect(files[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(files.map((f) => f.number)).toEqual([...files.map((f) => f.number)].sort((a, b) => a - b));
  });

  it('changes the checksum when the file changes by a single byte', async () => {
    const dir = await emptyDir();
    await dir.add('0001_a.sql', 'select 1;');
    const before = (await readMigrationFiles(dir.dir))[0]?.sha256;
    await dir.add('0001_a.sql', 'select 1; ');
    const after = (await readMigrationFiles(dir.dir))[0]?.sha256;
    expect(after).not.toBe(before);
  });

  it('rejects files that are not numbered migrations', async () => {
    const dir = await emptyDir();
    await dir.add('notes.txt', 'hello');
    await expect(readMigrationFiles(dir.dir)).rejects.toThrow(/Unexpected file/);
  });

  it('rejects two migrations with the same number', async () => {
    const dir = await emptyDir();
    await dir.add('0002_a.sql', 'select 1;');
    await dir.add('0002_b.sql', 'select 1;');
    await expect(readMigrationFiles(dir.dir)).rejects.toThrow(/Two migrations have the number 0002/);
  });
});
