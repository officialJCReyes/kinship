// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  cpSync,
  createReadStream,
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { decryptToFile } from '../../src/backup/archive.js';
import { createEncryptStream } from '../../src/backup/crypto.js';
import { runChecked } from '../../src/backup/tools.js';

/**
 * Opens a backup the way a person with the passphrase could, lets `mutate` change what is inside (manifest.json, files.json,
 * files/<name>, database.dump), and writes the result as a new, validly encrypted backup. For the cases a real backup never
 * produces: a photo missing from the index, a changed byte, a different key id.
 */
export async function forgeBackup(
  dir: string,
  from: string,
  passphrase: string,
  asName: string,
  mutate: (work: string) => void,
  kdf = { N: 2 ** 4, r: 8, p: 1 },
): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), 'kinship-forge-'));
  try {
    const tar = join(work, 'in.tar');
    await decryptToFile(join(dir, from), tar, passphrase);
    const inside = join(work, 'inside');
    mkdirSync(inside);
    const env = { PATH: process.env['PATH'] ?? '' };
    await runChecked('tar', ['-x', '-f', tar, '-C', inside], { env });
    mutate(inside);
    const out = join(work, 'out.tar');
    const names = ['manifest.json', 'database.dump'];
    try {
      readFileSync(join(inside, 'files.json'));
      names.push('files.json', 'files');
    } catch {
      /* a database-only backup */
    }
    await runChecked('tar', ['-c', '-f', out, '-C', inside, ...names], { env });
    const manifest = JSON.parse(readFileSync(join(inside, 'manifest.json'), 'utf8')) as {
      appVersion: string;
      schema: number;
    };
    const encrypt = await createEncryptStream({
      passphrase,
      appVersion: manifest.appVersion,
      schema: manifest.schema,
      kdf,
    });
    await pipeline(createReadStream(out), encrypt, createWriteStream(join(dir, asName), { mode: 0o600 }));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
export const writeJson = (path: string, value: unknown): void => writeFileSync(path, JSON.stringify(value));
export { cpSync };
