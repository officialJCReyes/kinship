// SPDX-License-Identifier: AGPL-3.0-or-later
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
