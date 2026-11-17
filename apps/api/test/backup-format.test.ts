// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { createDecryptStream, createEncryptStream, passphraseProblem } from '../src/backup/crypto.js';
import { BackupFormatError, CHUNK_SIZE, KDF_MAX_MEMORY, readPreamble } from '../src/backup/format.js';
import type { BackupErrorCode } from '../src/backup/format.js';

// A cheap KDF so the tests are fast; the production cost is DEFAULT_KDF (checked below).
const CHEAP = { N: 2 ** 4, r: 8, p: 1 };
const PASS = 'correct horse battery staple';

async function collect(stream: NodeJS.ReadableStream & NodeJS.WritableStream, input: Buffer): Promise<Buffer> {
  const parts: Buffer[] = [];
  stream.on('data', (part: Buffer) => parts.push(part));
  await pipeline(Readable.from([input]), stream);
  return Buffer.concat(parts);
}

async function encrypt(plain: Buffer, passphrase = PASS): Promise<Buffer> {
  const stream = await createEncryptStream({ passphrase, appVersion: '0.2.0', schema: 12, kdf: CHEAP });
  return collect(stream, plain);
}

const decrypt = (archive: Buffer, passphrase = PASS) => collect(createDecryptStream(passphrase), archive);

async function code(promise: Promise<unknown>): Promise<BackupErrorCode | 'no error'> {
  try {
    await promise;
    return 'no error';
  } catch (error) {
    if (error instanceof BackupFormatError) return error.code;
    throw error;
  }
}

const sample = (size: number) => Buffer.from(Array.from({ length: size }, (_, i) => (i * 31 + 7) & 0xff));

describe('round trip', () => {
  it.each([0, 1, 100, CHUNK_SIZE - 1, CHUNK_SIZE, CHUNK_SIZE + 1, CHUNK_SIZE * 3, CHUNK_SIZE * 3 + 17])(
    'returns exactly what went in (%i bytes)',
    async (size) => {
      const plain = sample(size);
      const archive = await encrypt(plain);
      expect((await decrypt(archive)).equals(plain)).toBe(true);
    },
  );

  it('does not contain the plaintext, and is different every time (fresh salt)', async () => {
    const plain = Buffer.from('Marcus Hale, born 1986, a very recognisable sentence '.repeat(50));
    const first = await encrypt(plain);
    const second = await encrypt(plain);
    expect(first.includes(Buffer.from('Marcus Hale'))).toBe(false);
    expect(first.equals(second)).toBe(false);
  });

  it('puts the version, schema and time in a readable header, with no passphrase', async () => {
    const archive = await encrypt(sample(10));
    const { header } = readPreamble(archive);
    expect(header).toMatchObject({ format: 1, appVersion: '0.2.0', schema: 12, chunkSize: CHUNK_SIZE });
    expect(Number.isNaN(Date.parse(header.created))).toBe(false);
  });

  it('reports the header while decrypting', async () => {
    const archive = await encrypt(sample(10));
    let seen: number | undefined;
    await collect(
      createDecryptStream(PASS, (header) => {
        seen = header.schema;
      }),
      archive,
    );
    expect(seen).toBe(12);
  });
});

describe('what goes wrong is told apart', () => {
  it('a wrong passphrase is wrong_passphrase, before any plaintext', async () => {
    const archive = await encrypt(sample(CHUNK_SIZE * 2));
    const parts: Buffer[] = [];
    const stream = createDecryptStream('another passphrase entirely');
    stream.on('data', (part: Buffer) => parts.push(part));
    expect(await code(pipeline(Readable.from([archive]), stream))).toBe('wrong_passphrase');
    expect(parts).toHaveLength(0);
  });

  it('a flipped byte in any block is corrupt', async () => {
    const archive = await encrypt(sample(CHUNK_SIZE * 2 + 5));
    const { bytes } = readPreamble(archive);
    for (const offset of [bytes.length + 10, bytes.length + CHUNK_SIZE + 4 + 16 + 4 + 100, archive.length - 3]) {
      const damaged = Buffer.from(archive);
      damaged[offset] = (damaged[offset] ?? 0) ^ 0x01;
      expect(await code(decrypt(damaged)), `offset ${offset}`).toBe('corrupt');
    }
  });

  it('cutting the file is truncated, wherever it is cut', async () => {
    const archive = await encrypt(sample(CHUNK_SIZE * 2 + 5));
    const { bytes } = readPreamble(archive);
    const frame = 4 + CHUNK_SIZE + 16;
    const cuts = [
      archive.length - 1, // inside the final tag
      archive.length - (4 + 5 + 16), // exactly the final chunk removed
      bytes.length + frame, // after the first chunk
      bytes.length + 2, // inside a length
      bytes.length, // right after the header
      12, // inside the header
    ];
    for (const cut of cuts) {
      const result = await code(decrypt(archive.subarray(0, cut)));
      expect(['truncated', 'corrupt'], `cut at ${cut}`).toContain(result);
    }
    // Dropping the final chunk cleanly is reported as truncated, not as damage.
    expect(await code(decrypt(archive.subarray(0, archive.length - (4 + 5 + 16))))).toBe('truncated');
    expect(await code(decrypt(archive.subarray(0, 12)))).toBe('truncated');
  });

  it('extra bytes at the end are corrupt', async () => {
    const archive = await encrypt(sample(100));
    expect(await code(decrypt(Buffer.concat([archive, Buffer.from('trailing')])))).not.toBe('no error');
  });

  it('editing the header is caught: the preamble is authenticated', async () => {
    const archive = await encrypt(sample(CHUNK_SIZE + 3));
    const { bytes, header } = readPreamble(archive);
    const edited = Buffer.from(archive);
    // Change the schema number in place (same length), leaving the key and everything else alone.
    const json = bytes
      .subarray(9)
      .toString('utf8')
      .replace(`"schema":${header.schema}`, `"schema":${header.schema + 1}`);
    Buffer.from(json, 'utf8').copy(edited, 9);
    expect(readPreamble(edited).header.schema).toBe(header.schema + 1);
    expect(await code(decrypt(edited))).toBe('corrupt');
  });

  it('reordering chunks is corrupt', async () => {
    const archive = await encrypt(sample(CHUNK_SIZE * 3 + 1));
    const { bytes } = readPreamble(archive);
    const frame = 4 + CHUNK_SIZE + 16;
    const first = archive.subarray(bytes.length, bytes.length + frame);
    const second = archive.subarray(bytes.length + frame, bytes.length + 2 * frame);
    const swapped = Buffer.concat([bytes, second, first, archive.subarray(bytes.length + 2 * frame)]);
    expect(await code(decrypt(swapped))).toBe('corrupt');
  });

  it('something that is not a backup, and a newer format, are named', async () => {
    expect(await code(decrypt(Buffer.from('this is just some text, long enough to read a header from')))).toBe(
      'not_a_backup',
    );
    const archive = await encrypt(sample(10));
    const newer = Buffer.from(archive);
    newer[4] = 2;
    expect(await code(decrypt(newer))).toBe('unsupported_format');
  });
});

describe('the key derivation ceiling', () => {
  function withKdf(archive: Buffer, change: (kdf: Record<string, unknown>) => void): Buffer {
    const { bytes, header } = readPreamble(archive);
    const kdf = { ...header.kdf } as Record<string, unknown>;
    change(kdf);
    const json = Buffer.from(JSON.stringify({ ...header, kdf }), 'utf8');
    const lead = Buffer.from(bytes.subarray(0, 9));
    lead.writeUInt32BE(json.length, 5);
    return Buffer.concat([lead, json, archive.subarray(bytes.length)]);
  }

  it('refuses a header that asks for a huge amount of memory, before deriving anything', async () => {
    const archive = await encrypt(sample(10));
    const greedy = withKdf(archive, (kdf) => {
      kdf['N'] = 2 ** 24;
    });
    const started = Date.now();
    expect(await code(decrypt(greedy))).toBe('bad_header');
    expect(Date.now() - started).toBeLessThan(1000);
    expect(128 * 2 ** 24 * 8).toBeGreaterThan(KDF_MAX_MEMORY);
  });

  it.each([
    ['N not a power of two', { N: 3000 }],
    ['p too large', { p: 99 }],
    ['an unknown algorithm', { alg: 'md5' }],
    ['a short salt', { salt: 'AAAA' }],
  ])('refuses %s', async (_name, change) => {
    const archive = await encrypt(sample(10));
    expect(await code(decrypt(withKdf(archive, (kdf) => Object.assign(kdf, change))))).toBe('bad_header');
  });

  it('writes with N = 2^17, r = 8, p = 1 by default', async () => {
    const stream = await createEncryptStream({ passphrase: PASS, appVersion: '0.2.0', schema: 1 });
    const archive = await collect(stream, sample(1));
    expect(readPreamble(archive).header.kdf).toMatchObject({ alg: 'scrypt', N: 131072, r: 8, p: 1 });
    expect((await decrypt(archive)).equals(sample(1))).toBe(true);
  }, 60_000);
});

describe('passphrase rules', () => {
  it('needs 16 characters and refuses the placeholder', () => {
    expect(passphraseProblem(undefined)).toMatch(/no passphrase/);
    expect(passphraseProblem('short')).toMatch(/shorter than 16/);
    expect(passphraseProblem('change-me-backup')).toMatch(/placeholder/);
    expect(passphraseProblem('change-me-backup-and-more-text')).toMatch(/placeholder/);
    expect(passphraseProblem('a sixteen chars ok')).toBeNull();
  });
});

describe('the stand-alone script', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kinship-decrypt-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const script = fileURLToPath(new URL('../../../docs/backup/kinship-decrypt.mjs', import.meta.url));
  const run = (args: string[], passphrase = PASS) =>
    execFileSync('node', [script, ...args], {
      env: { ...process.env, BACKUP_PASSPHRASE: passphrase },
      encoding: 'utf8',
      stdio: 'pipe',
    });

  it('decrypts what the library wrote, byte for byte', async () => {
    for (const size of [0, 5, CHUNK_SIZE, CHUNK_SIZE * 2 + 9]) {
      const plain = sample(size);
      const input = join(dir, `in-${size}.tar.enc`);
      const output = join(dir, `out-${size}.tar`);
      writeFileSync(input, await encrypt(plain));
      expect(run([input, output])).toContain('Decrypted');
      expect(readFileSync(output).equals(plain)).toBe(true);
    }
  });

  it('refuses a wrong passphrase and a damaged or cut file, and leaves no output behind', async () => {
    const archive = await encrypt(sample(CHUNK_SIZE * 2 + 9));
    const input = join(dir, 'bad.tar.enc');
    writeFileSync(input, archive);
    const output = join(dir, 'bad.tar');
    expect(() => run([input, output], 'not the passphrase at all')).toThrow(/wrong passphrase/);
    const flipped = Buffer.from(archive);
    flipped[flipped.length - 20] = (flipped[flipped.length - 20] ?? 0) ^ 1;
    writeFileSync(input, flipped);
    expect(() => run([input, output])).toThrow(/damaged/);
    writeFileSync(input, archive.subarray(0, archive.length - (4 + 9 + 16)));
    expect(() => run([input, output])).toThrow(/cut short/);
    expect(existsSync(output)).toBe(false);
  });
});
