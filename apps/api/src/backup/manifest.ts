// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Fingerprint, TableStats } from './inspect.js';

export type BackupKind = 'manual' | 'scheduled' | 'pre-upgrade' | 'pre-restore';

/** manifest.json, inside the encrypted archive. It is trusted only after the archive has authenticated. */
export interface Manifest {
  format: 1;
  kind: BackupKind;
  createdAt: string;
  appVersion: string;
  /** The highest applied migration number. */
  schema: number;
  pgDumpMajor: number;
  serverMajor: number;
  database: string;
  ownerRole: string;
  appRole: string;
  tables: Record<string, TableStats>;
  fingerprint: Fingerprint;
  dump: { file: 'database.dump'; sha256: string; bytes: number };
  files: { included: boolean; count: number };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Checks the shape of a manifest read from an archive. Throws an Error with a plain message. */
export function parseManifest(value: unknown): Manifest {
  const fail = (what: string): never => {
    throw new Error(`The backup manifest is not valid (${what}).`);
  };
  if (!isRecord(value)) return fail('not an object');
  if (value['format'] !== 1) return fail('format');
  for (const key of ['kind', 'createdAt', 'appVersion', 'database', 'ownerRole', 'appRole']) {
    if (typeof value[key] !== 'string') fail(key);
  }
  for (const key of ['schema', 'pgDumpMajor', 'serverMajor']) {
    if (!Number.isInteger(value[key])) fail(key);
  }
  if (!isRecord(value['tables']) || !isRecord(value['fingerprint'])) fail('tables or fingerprint');
  const dump = value['dump'];
  if (!isRecord(dump) || dump['file'] !== 'database.dump' || typeof dump['sha256'] !== 'string') fail('dump');
  const files = value['files'];
  if (!isRecord(files) || typeof files['included'] !== 'boolean' || !Number.isInteger(files['count'])) fail('files');
  for (const stats of Object.values(value['tables'] as Record<string, unknown>)) {
    if (!isRecord(stats) || !Number.isInteger(stats['rows']) || typeof stats['digest'] !== 'string') fail('tables');
  }
  return value as unknown as Manifest;
}
