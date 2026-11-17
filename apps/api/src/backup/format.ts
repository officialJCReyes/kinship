// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The backup archive format, version 1 (docs/backup-format.md is the readable spec; keep the two in step).
//
//   "KSBK" | format version (1 byte) | header length (u32 big endian) | header (UTF-8 JSON)   <- the "preamble"
//   then chunks, each:  length n (u32 big endian, 0 to chunkSize) | n bytes of ciphertext | 16-byte GCM tag
//
// The header is in the clear (so a restore can say "this backup is too new" before asking for a passphrase) and is
// authenticated: the whole preamble is the AAD of every chunk. Nothing in it is trusted until a chunk has authenticated
// with the passphrase.
import { Buffer } from 'node:buffer';

export const MAGIC = Buffer.from('KSBK', 'ascii');
export const FORMAT_VERSION = 1;
export const CHUNK_SIZE = 64 * 1024;
export const TAG_LENGTH = 16;
export const MAX_HEADER_BYTES = 16 * 1024;
const MIN_CHUNK_SIZE = 4 * 1024;
const MAX_CHUNK_SIZE = 1024 * 1024;

/** scrypt parameters as stored in the header. Writing uses DEFAULT_KDF; reading accepts anything under the ceiling. */
export interface KdfParams {
  alg: 'scrypt';
  N: number;
  r: number;
  p: number;
  /** base64, 16 random bytes. */
  salt: string;
}

export const DEFAULT_KDF = { N: 2 ** 17, r: 8, p: 1 } as const;
/** What a reader will spend on a header it has not authenticated yet: 512 MiB of scrypt memory (128 * N * r) at most. */
export const KDF_MAX_MEMORY = 512 * 1024 * 1024;
export const KDF_MAX_P = 4;

export interface ArchiveHeader {
  format: number;
  appVersion: string;
  /** The schema number (highest applied migration) of the database in the archive. */
  schema: number;
  /** ISO 8601, UTC. */
  created: string;
  kdf: KdfParams;
  chunkSize: number;
  /** base64 of the key-check value: tells a wrong passphrase from a damaged file. */
  check: string;
}

export type BackupErrorCode =
  | 'not_a_backup' // does not start with the magic
  | 'unsupported_format' // a newer format than this program reads
  | 'bad_header' // the header is malformed or asks for more than the ceiling allows
  | 'wrong_passphrase'
  | 'corrupt' // an authentication tag failed, or there are extra bytes
  | 'truncated'; // the stream ended early

export class BackupFormatError extends Error {
  override name = 'BackupFormatError';
  constructor(
    readonly code: BackupErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface Preamble {
  header: ArchiveHeader;
  /** The exact bytes of the preamble: the AAD of every chunk. */
  bytes: Buffer;
}

export function encodePreamble(header: ArchiveHeader): Buffer {
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  if (json.length > MAX_HEADER_BYTES) throw new Error('backup header too large');
  const lead = Buffer.alloc(MAGIC.length + 1 + 4);
  MAGIC.copy(lead, 0);
  lead[MAGIC.length] = FORMAT_VERSION;
  lead.writeUInt32BE(json.length, MAGIC.length + 1);
  return Buffer.concat([lead, json]);
}

/** Bytes needed before the header length is known. */
export const LEAD_LENGTH = MAGIC.length + 1 + 4;

/** The header length from the first LEAD_LENGTH bytes. Throws not_a_backup, unsupported_format or bad_header. */
export function readLead(lead: Buffer): number {
  if (lead.length < LEAD_LENGTH || !lead.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new BackupFormatError('not_a_backup', 'This is not a KinShip backup (it does not start with KSBK).');
  }
  const version = lead[MAGIC.length] ?? 0;
  if (version > FORMAT_VERSION) {
    throw new BackupFormatError(
      'unsupported_format',
      `This backup uses format ${version}; this program reads format ${FORMAT_VERSION} and older. Use a newer KinShip.`,
    );
  }
  if (version < 1) throw new BackupFormatError('bad_header', 'Unknown backup format version.');
  const length = lead.readUInt32BE(MAGIC.length + 1);
  if (length < 2 || length > MAX_HEADER_BYTES) {
    throw new BackupFormatError('bad_header', 'The backup header has an impossible length.');
  }
  return length;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Parses and validates the header JSON, including the read-side KDF ceiling. */
export function parseHeader(json: Buffer): ArchiveHeader {
  let value: unknown;
  try {
    value = JSON.parse(json.toString('utf8'));
  } catch {
    throw new BackupFormatError('bad_header', 'The backup header is not valid JSON.');
  }
  if (!isRecord(value) || !isRecord(value['kdf']))
    throw new BackupFormatError('bad_header', 'Malformed backup header.');
  const { kdf } = value;
  const bad = (what: string) => new BackupFormatError('bad_header', `Malformed backup header: ${what}.`);
  if (value['format'] !== FORMAT_VERSION) throw bad('format');
  if (typeof value['appVersion'] !== 'string' || value['appVersion'].length > 100) throw bad('appVersion');
  if (!Number.isInteger(value['schema']) || (value['schema'] as number) < 0) throw bad('schema');
  if (typeof value['created'] !== 'string' || Number.isNaN(Date.parse(value['created']))) throw bad('created');
  const chunkSize = value['chunkSize'];
  if (
    !Number.isInteger(chunkSize) ||
    (chunkSize as number) < MIN_CHUNK_SIZE ||
    (chunkSize as number) > MAX_CHUNK_SIZE
  ) {
    throw bad('chunkSize');
  }
  if (typeof value['check'] !== 'string' || Buffer.from(value['check'], 'base64').length !== 32) throw bad('check');
  const { alg, N, r, p, salt } = kdf;
  if (alg !== 'scrypt') throw bad('kdf.alg');
  if (!Number.isInteger(N) || (N as number) < 2 || ((N as number) & ((N as number) - 1)) !== 0) throw bad('kdf.N');
  if (!Number.isInteger(r) || (r as number) < 1 || (r as number) > 32) throw bad('kdf.r');
  if (!Number.isInteger(p) || (p as number) < 1 || (p as number) > KDF_MAX_P) throw bad('kdf.p');
  if (128 * (N as number) * (r as number) > KDF_MAX_MEMORY) {
    throw new BackupFormatError(
      'bad_header',
      'The backup asks for more key-derivation memory than this program allows.',
    );
  }
  if (typeof salt !== 'string' || Buffer.from(salt, 'base64').length < 16) throw bad('kdf.salt');
  return value as unknown as ArchiveHeader;
}

/** Reads the preamble from the start of a buffer, without any passphrase. Untrusted until a chunk authenticates. */
export function readPreamble(buffer: Buffer): Preamble {
  const length = readLead(buffer.subarray(0, LEAD_LENGTH));
  const end = LEAD_LENGTH + length;
  if (buffer.length < end) throw new BackupFormatError('truncated', 'The backup ends inside its header.');
  return { header: parseHeader(buffer.subarray(LEAD_LENGTH, end)), bytes: Buffer.from(buffer.subarray(0, end)) };
}
