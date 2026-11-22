// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Whether stored files (photos) can be used right now, and if not, why (ADR 0033). Decided at start-up and again on request:
//   key_missing        no FILE_ENCRYPTION_KEY: KinShip runs, uploads and photos answer 503 files_unavailable.
//   files_unavailable  the files folder cannot be written (not mounted), or it has no marker although photos exist. A missing
//                      mount is never treated as an empty folder.
//   key_mismatch       a sample of the stored photos was sealed with a different key: the api runs, new uploads are refused.
// The folder holds objects/<2 hex>/<32 hex>, tmp/ and staging/ on one mount so a rename is atomic, and a marker file that says
// "this volume was set up by KinShip".
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FilesState, FilesHealth } from '@kinship/shared';
import type { FilesConfig } from '../config.js';
import { deriveFileKeys } from './key.js';
import type { FileKeys } from './key.js';

export const MARKER = '.kinship-files';

/** The commands that make the files folder usable, for a log line and for Admin. */
export const FILES_FIX_LONG = [
  'Add the files folder to the api service in compose.yml:',
  '    api:',
  '      volumes:',
  '        - ./data/files:/var/lib/kinship/files',
  'then create it on the host and let the api (user 1000) write to it:',
  '    mkdir -p data/files && sudo chown 1000:1000 data/files',
  '(Docker Desktop on macOS and Windows does not need the chown.) Then start KinShip again.',
].join('\n');

export interface FilesHooks {
  /** Do any media rows exist? (Without a marker that means the volume was lost, not that it is new.) Wired in with the table. */
  mediaRowsExist?: () => Promise<boolean>;
  /** The distinct key ids (hex) of a sample of the stored files' rows. Wired in with the table. */
  sampleKeyIds?: () => Promise<string[]>;
}

export interface FilesService {
  /** The file keys, or null without a configured key. */
  keys(): FileKeys | null;
  dir: string;
  /** Looks again (the folder may have been mounted or fixed, the sample may have changed). */
  refresh(): Promise<FilesHealth>;
  status(): FilesHealth;
  /** Uploads and serving need exactly this. */
  usable(): boolean;
  /** New uploads additionally need the key to match what is stored. */
  acceptsUploads(): boolean;
}

function writable(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const probe = join(dir, `.write-test-${randomBytes(4).toString('hex')}`);
    writeFileSync(probe, '', { mode: 0o600 });
    rmSync(probe);
    return true;
  } catch {
    return false;
  }
}

function hasMarker(dir: string): boolean {
  try {
    readFileSync(join(dir, MARKER));
    return true;
  } catch {
    return false;
  }
}

/** Creates the marker and the three folders. */
function initialise(dir: string): void {
  for (const sub of ['objects', 'tmp', 'staging']) mkdirSync(join(dir, sub), { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, MARKER), JSON.stringify({ version: 1, id: randomBytes(8).toString('hex') }), { mode: 0o600 });
}

export function createFilesService(config: FilesConfig, hooks: FilesHooks = {}): FilesService {
  const keys = config.key ? deriveFileKeys(config.key) : null;
  const keyId = keys ? keys.keyId.toString('hex') : null;
  let state: FilesState = keys ? 'files_unavailable' : 'key_missing';

  async function decide(): Promise<FilesState> {
    if (!keys) return 'key_missing';
    if (!writable(config.dir)) return 'files_unavailable';
    if (!hasMarker(config.dir)) {
      if (hooks.mediaRowsExist && (await hooks.mediaRowsExist())) return 'files_unavailable';
      try {
        initialise(config.dir);
      } catch {
        return 'files_unavailable';
      }
    }
    const stored = hooks.sampleKeyIds ? await hooks.sampleKeyIds() : [];
    if (stored.some((id) => id !== keyId)) return 'key_mismatch';
    return 'ready';
  }

  return {
    dir: config.dir,
    keys: () => keys,
    async refresh() {
      state = await decide();
      return { state, keyId };
    },
    status: () => ({ state, keyId }),
    usable: () => state === 'ready' || state === 'key_mismatch',
    acceptsUploads: () => state === 'ready',
  };
}
