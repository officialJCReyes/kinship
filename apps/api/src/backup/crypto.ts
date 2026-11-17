// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Backup encryption with Node's own crypto: scrypt for the key, HKDF to split it into an encryption key and a key-check
// value, and AES-256-GCM over 64 KiB chunks (counter nonce; the preamble and a "final" flag as AAD). See format.ts.
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { Buffer } from 'node:buffer';
import { Transform } from 'node:stream';
import type { TransformCallback } from 'node:stream';
import {
  BackupFormatError,
  CHUNK_SIZE,
  DEFAULT_KDF,
  FORMAT_VERSION,
  LEAD_LENGTH,
  TAG_LENGTH,
  encodePreamble,
  parseHeader,
  readLead,
} from './format.js';
import type { ArchiveHeader, KdfParams, Preamble } from './format.js';

/** The shortest passphrase accepted for backups. */
export const MIN_PASSPHRASE_LENGTH = 16;
export const PASSPHRASE_PLACEHOLDER = 'change-me-backup';

/** The state of the configured passphrase, for the Admin page (never the passphrase itself). */
export function passphraseState(passphrase: string | undefined): 'ok' | 'missing' | 'too_short' | 'placeholder' {
  if (passphrase === undefined || passphrase === '') return 'missing';
  if (passphrase.startsWith(PASSPHRASE_PLACEHOLDER)) return 'placeholder';
  return Array.from(passphrase).length < MIN_PASSPHRASE_LENGTH ? 'too_short' : 'ok';
}

/** null when the passphrase is acceptable, otherwise why not (never includes the passphrase). */
export function passphraseProblem(passphrase: string | undefined): string | null {
  if (passphrase === undefined || passphrase === '') return 'no passphrase is set';
  if (passphrase.startsWith(PASSPHRASE_PLACEHOLDER)) return 'the passphrase is still the placeholder from .env.example';
  if (Array.from(passphrase).length < MIN_PASSPHRASE_LENGTH) {
    return `the passphrase is shorter than ${MIN_PASSPHRASE_LENGTH} characters`;
  }
  return null;
}

function scrypt(passphrase: string, kdf: KdfParams): Promise<Buffer> {
  const maxmem = 128 * kdf.N * kdf.r + 128 * kdf.r * kdf.p + 16 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    scryptCallback(
      Buffer.from(passphrase.normalize('NFC'), 'utf8'),
      Buffer.from(kdf.salt, 'base64'),
      32,
      { N: kdf.N, r: kdf.r, p: kdf.p, maxmem },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

export interface Keys {
  encryption: Buffer;
  check: Buffer;
}

export async function deriveKeys(passphrase: string, kdf: KdfParams): Promise<Keys> {
  const master = await scrypt(passphrase, kdf);
  const expand = (info: string) =>
    Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), Buffer.from(info, 'utf8'), 32));
  return { encryption: expand('kinship-backup v1 key'), check: expand('kinship-backup v1 check') };
}

/** 12 bytes: four zero bytes, then the chunk counter as a 64-bit big-endian number. */
function nonce(counter: number): Buffer {
  const out = Buffer.alloc(12);
  out.writeBigUInt64BE(BigInt(counter), 4);
  return out;
}

const aad = (preamble: Buffer, final: boolean): Buffer => Buffer.concat([preamble, Buffer.from([final ? 1 : 0])]);

export interface EncryptOptions {
  passphrase: string;
  appVersion: string;
  schema: number;
  /** Defaults to now. */
  created?: Date;
  /** Only tests lower this; the default is the production cost. */
  kdf?: { N: number; r: number; p: number };
}

class EncryptStream extends Transform {
  private pending: Buffer = Buffer.alloc(0);
  private counter = 0;

  constructor(
    private readonly preamble: Buffer,
    private readonly key: Buffer,
  ) {
    super();
    this.push(preamble);
  }

  private seal(plain: Buffer, final: boolean): Buffer {
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce(this.counter++), { authTagLength: TAG_LENGTH });
    cipher.setAAD(aad(this.preamble, final));
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    return Buffer.concat([length, body, cipher.getAuthTag()]);
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    try {
      this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
      // Keep at least one byte back: the last chunk has to be sealed as the final one.
      while (this.pending.length > CHUNK_SIZE) {
        this.push(this.seal(this.pending.subarray(0, CHUNK_SIZE), false));
        this.pending = this.pending.subarray(CHUNK_SIZE);
      }
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  override _flush(callback: TransformCallback): void {
    try {
      this.push(this.seal(this.pending, true));
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }
}

/** A stream that turns plaintext (a tar) into an archive. Derives the key first, so it is async. */
export async function createEncryptStream(options: EncryptOptions): Promise<Transform> {
  const kdf: KdfParams = { alg: 'scrypt', ...(options.kdf ?? DEFAULT_KDF), salt: randomBytes(16).toString('base64') };
  const keys = await deriveKeys(options.passphrase, kdf);
  const header: ArchiveHeader = {
    format: FORMAT_VERSION,
    appVersion: options.appVersion,
    schema: options.schema,
    created: (options.created ?? new Date()).toISOString(),
    kdf,
    chunkSize: CHUNK_SIZE,
    check: keys.check.toString('base64'),
  };
  return new EncryptStream(encodePreamble(header), keys.encryption);
}

type DecryptState = 'lead' | 'header' | 'chunks';

class DecryptStream extends Transform {
  private buffer: Buffer = Buffer.alloc(0);
  private state: DecryptState = 'lead';
  private headerLength = 0;
  private preamble: Preamble | undefined;
  private key: Buffer | undefined;
  private counter = 0;
  /** A complete frame that may or may not be the last one: decided when more bytes arrive or the stream ends. */
  private held: { body: Buffer; tag: Buffer } | undefined;
  private done = false;

  constructor(
    private readonly passphrase: string,
    private readonly onHeader?: (header: ArchiveHeader) => void,
  ) {
    super();
  }

  private open(body: Buffer, tag: Buffer, final: boolean): Buffer {
    const preamble = this.preamble as Preamble;
    const decipher = createDecipheriv('aes-256-gcm', this.key as Buffer, nonce(this.counter), {
      authTagLength: TAG_LENGTH,
    });
    decipher.setAAD(aad(preamble.bytes, final));
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(body), decipher.final()]);
    } catch {
      throw new BackupFormatError('corrupt', 'The backup is damaged: a block failed its integrity check.');
    }
  }

  private async step(): Promise<boolean> {
    if (this.state === 'lead') {
      if (this.buffer.length < LEAD_LENGTH) return false;
      this.headerLength = readLead(this.buffer.subarray(0, LEAD_LENGTH));
      this.state = 'header';
    }
    if (this.state === 'header') {
      const end = LEAD_LENGTH + this.headerLength;
      if (this.buffer.length < end) return false;
      const header = parseHeader(this.buffer.subarray(LEAD_LENGTH, end));
      this.preamble = { header, bytes: Buffer.from(this.buffer.subarray(0, end)) };
      this.buffer = this.buffer.subarray(end);
      const keys = await deriveKeys(this.passphrase, header.kdf);
      const expected = Buffer.from(header.check, 'base64');
      if (expected.length !== keys.check.length || !timingSafeEqual(expected, keys.check)) {
        throw new BackupFormatError('wrong_passphrase', 'The passphrase does not match this backup.');
      }
      this.key = keys.encryption;
      this.state = 'chunks';
      this.onHeader?.(header);
    }
    // chunks: [length][ciphertext][tag]
    const chunkSize = (this.preamble as Preamble).header.chunkSize;
    if (this.buffer.length < 4) return false;
    const length = this.buffer.readUInt32BE(0);
    if (length > chunkSize)
      throw new BackupFormatError('corrupt', 'The backup is damaged: a block has an impossible length.');
    const total = 4 + length + TAG_LENGTH;
    if (this.buffer.length < total) return false;
    const frame = { body: this.buffer.subarray(4, 4 + length), tag: this.buffer.subarray(4 + length, total) };
    this.buffer = this.buffer.subarray(total);
    if (this.held) {
      // Another frame follows, so the held one was not the last.
      this.push(this.open(this.held.body, this.held.tag, false));
      this.counter++;
    }
    this.held = { body: Buffer.from(frame.body), tag: Buffer.from(frame.tag) };
    return true;
  }

  private async drain(): Promise<void> {
    if (this.done) throw new BackupFormatError('corrupt', 'The backup is damaged: there is data after its last block.');
    while (await this.step()) {
      /* keep going while whole frames are available */
    }
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    this.drain().then(
      () => callback(),
      (error: Error) => callback(error),
    );
  }

  override _flush(callback: TransformCallback): void {
    this.drain()
      .then(() => {
        if (this.state !== 'chunks') throw new BackupFormatError('truncated', 'The backup ends inside its header.');
        if (this.buffer.length > 0)
          throw new BackupFormatError('truncated', 'The backup ends in the middle of a block.');
        if (!this.held) throw new BackupFormatError('truncated', 'The backup has no blocks: it was cut short.');
        const { body, tag } = this.held;
        try {
          this.push(this.open(body, tag, true));
        } catch (error) {
          // A block that only authenticates as "not the last" means the real last blocks were cut off.
          try {
            this.open(body, tag, false);
          } catch {
            throw error;
          }
          throw new BackupFormatError('truncated', 'The backup was cut short: its final block is missing.');
        }
        this.held = undefined;
        this.done = true;
      })
      .then(
        () => callback(),
        (error: Error) => callback(error),
      );
  }
}

/**
 * A stream that turns an archive back into plaintext. It errors with a BackupFormatError: wrong_passphrase before any
 * plaintext is produced; corrupt or truncated when a block fails or the end is missing. Plaintext is only complete and
 * trustworthy once the stream has ended without an error, so callers write to a temporary file and use it afterwards.
 */
export function createDecryptStream(passphrase: string, onHeader?: (header: ArchiveHeader) => void): Transform {
  return new DecryptStream(passphrase, onHeader);
}
