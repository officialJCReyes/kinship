// SPDX-License-Identifier: AGPL-3.0-or-later
import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const realMigrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));

/** A throwaway copy of a migrations folder (of the real one by default), so tests can edit it. */
export async function tempMigrationsDir(
  copyReal = true,
): Promise<{ dir: string; add(name: string, sql: string): Promise<void>; remove(): Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'kinship-migrations-'));
  if (copyReal) await cp(realMigrationsDir, dir, { recursive: true });
  return {
    dir,
    add: (name, sql) => writeFile(join(dir, name), sql),
    remove: () => rm(dir, { recursive: true, force: true }),
  };
}

/**
 * Removes every migration numbered `from` or higher from a throwaway copy, so a test can run the database up to
 * just before one migration, put data in, and then add that one migration back. Later migrations stay out too:
 * they may depend on it.
 */
export async function removeMigrationsFrom(dir: string, from: number): Promise<string[]> {
  const removed: string[] = [];
  for (const name of await readdir(dir)) {
    const match = /^(\d+)_.*\.sql$/.exec(name);
    if (match && Number(match[1]) >= from) {
      await rm(join(dir, name));
      removed.push(name);
    }
  }
  return removed;
}
