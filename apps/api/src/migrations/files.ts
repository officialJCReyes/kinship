// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface MigrationFile {
  /** File name without ".sql", for example "0001_schema_info_and_grants". Kysely orders by this. */
  name: string;
  /** The leading number, for example 1. Stored in schema_info as the schema number. */
  number: number;
  sql: string;
  /** SHA-256 of the exact file bytes, as hex. */
  sha256: string;
}

const FILE_NAME = /^(\d{4})_[a-z0-9_]+\.sql$/;

/** Reads the numbered .sql files in a folder, in order. Anything else in the folder is an error. */
export async function readMigrationFiles(dir: string): Promise<MigrationFile[]> {
  const entries = await readdir(dir);
  const files: MigrationFile[] = [];
  const seen = new Map<number, string>();

  for (const entry of entries.sort()) {
    const match = FILE_NAME.exec(entry);
    if (!match) {
      throw new Error(`Unexpected file in the migrations folder: ${entry} (names look like 0001_what_it_does.sql)`);
    }
    const number = Number(match[1]);
    const earlier = seen.get(number);
    if (earlier !== undefined) {
      throw new Error(`Two migrations have the number ${match[1]}: ${earlier} and ${entry}`);
    }
    seen.set(number, entry);

    const bytes = await readFile(join(dir, entry));
    files.push({
      name: entry.slice(0, -'.sql'.length),
      number,
      sql: bytes.toString('utf8'),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  return files;
}
