// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The encrypted files on the volume: objects/<2 hex>/<32 hex>, written through tmp/ on the same mount so a file appears whole or
// not at all. Names are random 128-bit hex with no extension and nothing of the original; a name that is not exactly that is
// refused, so nothing a caller passes can reach outside objects/.
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { decryptFile, encryptFile } from './crypto.js';
import type { FileKeys } from './key.js';

export const STORAGE_ID = /^[0-9a-f]{32}$/;

export const newStorageId = (): string => randomBytes(16).toString('hex');

export interface StoredFile {
  storageId: string;
  /** Bytes on disk (the encrypted file). */
  bytes: number;
}

export interface ObjectInfo {
  storageId: string;
  bytes: number;
  modifiedMs: number;
}

export interface ObjectStore {
  /** Encrypts and stores. The file is visible under its name only once it is complete and flushed. */
  put(plain: Buffer, storageId?: string): StoredFile;
  /** The decrypted bytes. Throws FileCryptoError when the file is damaged or sealed with another key, ENOENT when missing. */
  read(storageId: string): Buffer;
  /** The stored (encrypted) bytes, as they are on disk, for a backup. */
  readRaw(storageId: string): Buffer;
  exists(storageId: string): boolean;
  /** Removes it; true when there was one. */
  remove(storageId: string): boolean;
  /** Every object on disk. */
  list(): ObjectInfo[];
  /** Files left in tmp/ (a crash during an upload) older than `olderThanMs`, removed. Returns how many. */
  clearTmp(olderThanMs: number, now?: number): number;
  pathOf(storageId: string): string;
}

function check(storageId: string): void {
  if (!STORAGE_ID.test(storageId)) throw new Error('not a storage id');
}

export function createObjectStore(dir: string, keys: () => FileKeys | null): ObjectStore {
  const need = (): FileKeys => {
    const k = keys();
    if (!k) throw new Error('no file encryption key is configured');
    return k;
  };
  const pathOf = (storageId: string): string => {
    check(storageId);
    return join(dir, 'objects', storageId.slice(0, 2), storageId);
  };
  return {
    pathOf,
    put(plain, storageId = newStorageId()) {
      const sealed = encryptFile(need(), plain);
      const target = pathOf(storageId);
      mkdirSync(join(dir, 'objects', storageId.slice(0, 2)), { recursive: true, mode: 0o700 });
      mkdirSync(join(dir, 'tmp'), { recursive: true, mode: 0o700 });
      const temp = join(dir, 'tmp', `${storageId}.part`);
      const fd = openSync(temp, 'wx', 0o600);
      try {
        writeSync(fd, sealed);
        fsyncSync(fd);
      } catch (error) {
        closeSync(fd);
        rmSync(temp, { force: true });
        throw error;
      }
      closeSync(fd);
      renameSync(temp, target);
      return { storageId, bytes: sealed.length };
    },
    read: (storageId) => decryptFile(need(), readFileSync(pathOf(storageId))),
    readRaw: (storageId) => readFileSync(pathOf(storageId)),
    exists(storageId) {
      try {
        return statSync(pathOf(storageId)).isFile();
      } catch {
        return false;
      }
    },
    remove(storageId) {
      try {
        rmSync(pathOf(storageId));
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    },
    list() {
      const out: ObjectInfo[] = [];
      let prefixes: string[];
      try {
        prefixes = readdirSync(join(dir, 'objects'));
      } catch {
        return out;
      }
      for (const prefix of prefixes) {
        if (!/^[0-9a-f]{2}$/.test(prefix)) continue;
        for (const name of readdirSync(join(dir, 'objects', prefix))) {
          if (!STORAGE_ID.test(name) || !name.startsWith(prefix)) continue;
          const stat = statSync(join(dir, 'objects', prefix, name));
          if (stat.isFile()) out.push({ storageId: name, bytes: stat.size, modifiedMs: stat.mtimeMs });
        }
      }
      return out;
    },
    clearTmp(olderThanMs, now = Date.now()) {
      let removed = 0;
      let names: string[];
      try {
        names = readdirSync(join(dir, 'tmp'));
      } catch {
        return 0;
      }
      for (const name of names) {
        const path = join(dir, 'tmp', name);
        try {
          if (now - statSync(path).mtimeMs >= olderThanMs) {
            rmSync(path, { recursive: true, force: true });
            removed++;
          }
        } catch {
          /* gone already */
        }
      }
      return removed;
    },
  };
}
