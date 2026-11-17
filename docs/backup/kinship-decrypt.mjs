// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Decrypts a KinShip backup archive (kinship-YYYY-MM-DD-HHMM.tar.enc) WITHOUT KinShip. It needs only Node.js 18 or newer
// (https://nodejs.org) and your backup passphrase. It writes the plain tar; open it with `tar -xf`.
//
//   BACKUP_PASSPHRASE='your passphrase' node kinship-decrypt.mjs kinship-2026-11-14-0300.tar.enc [out.tar]
//   node kinship-decrypt.mjs backup.tar.enc out.tar --passphrase-file /path/to/passphrase.txt
//
// It checks every block and the end of the file. If anything is wrong it deletes the output and says so, so a damaged
// or cut-short archive never leaves a plausible-looking tar behind. The format is described in backup-format.md; this
// file is written from that description and does not share code with KinShip.
import { createDecipheriv, hkdfSync, scryptSync, timingSafeEqual } from 'node:crypto';
import { closeSync, fstatSync, openSync, readFileSync, readSync, rmSync, writeSync } from 'node:fs';

const fail = (message) => {
  console.error(`kinship-decrypt: ${message}`);
  process.exit(1);
};

const args = process.argv.slice(2);
let passphraseFile;
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--passphrase-file') passphraseFile = args[++i];
  else positional.push(args[i]);
}
const [input, output = positional[0]?.replace(/\.enc$/, '') || 'backup.tar'] = positional;
if (!input) fail('usage: node kinship-decrypt.mjs <archive> [output.tar] [--passphrase-file <file>]');
let passphrase = passphraseFile ? readFileSync(passphraseFile, 'utf8').replace(/\r?\n$/, '') : process.env.BACKUP_PASSPHRASE;
if (!passphrase) fail('give the passphrase in BACKUP_PASSPHRASE or with --passphrase-file <file>');
passphrase = passphrase.normalize('NFC');

const fd = openSync(input, 'r');
const size = fstatSync(fd).size;
let position = 0;
function take(length) {
  const buffer = Buffer.alloc(length);
  let got = 0;
  while (got < length) {
    const n = readSync(fd, buffer, got, length - got, position + got);
    if (n === 0) break;
    got += n;
  }
  position += got;
  return got === length ? buffer : null;
}

// 1. The preamble: "KSBK", the format version, the header length, the header (JSON).
const lead = take(9);
if (!lead || lead.subarray(0, 4).toString('latin1') !== 'KSBK') fail('this is not a KinShip backup');
if (lead[4] !== 1) fail(`this backup uses format ${lead[4]}; this script reads format 1`);
const headerLength = lead.readUInt32BE(5);
if (headerLength < 2 || headerLength > 16384) fail('the backup header has an impossible length');
const headerBytes = take(headerLength);
if (!headerBytes) fail('the backup is cut short (inside its header)');
const preamble = Buffer.concat([lead, headerBytes]);
const header = JSON.parse(headerBytes.toString('utf8'));
const { N, r, p } = header.kdf;
if (header.kdf.alg !== 'scrypt' || 128 * N * r > 512 * 1024 * 1024 || p > 4) fail('the backup asks for key settings this script will not use');

// 2. The keys. The key-check tells a wrong passphrase from a damaged file.
const master = scryptSync(passphrase, Buffer.from(header.kdf.salt, 'base64'), 32, {
  N,
  r,
  p,
  maxmem: 128 * N * r + 128 * r * p + 16 * 1024 * 1024,
});
const expand = (info) => Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), Buffer.from(info), 32));
const key = expand('kinship-backup v1 key');
const check = Buffer.from(header.check, 'base64');
if (check.length !== 32 || !timingSafeEqual(check, expand('kinship-backup v1 check'))) fail('wrong passphrase');

// 3. The blocks: [length u32][ciphertext][16-byte tag]. The last one is sealed with the "final" flag.
const out = openSync(output, 'w', 0o600);
const abort = (message) => {
  closeSync(out);
  rmSync(output, { force: true });
  fail(message);
};
const open = (body, tag, counter, final) => {
  const nonce = Buffer.alloc(12);
  nonce.writeBigUInt64BE(BigInt(counter), 4);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  decipher.setAAD(Buffer.concat([preamble, Buffer.from([final ? 1 : 0])]));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
};
let counter = 0;
let total = 0;
for (;;) {
  const lengthBytes = take(4);
  if (!lengthBytes) abort('the backup is cut short (a block is missing its length)');
  const length = lengthBytes.readUInt32BE(0);
  if (length > header.chunkSize) abort('the backup is damaged (a block has an impossible length)');
  const body = take(length);
  const tag = body && take(16);
  if (!body || !tag) abort('the backup is cut short (inside a block)');
  const last = position >= size;
  let plain;
  try {
    plain = open(body, tag, counter, last);
  } catch {
    if (last) {
      try {
        open(body, tag, counter, false);
        abort('the backup was cut short: its final block is missing');
      } catch {
        /* not a plain "not final" block either: damaged */
      }
    }
    abort('the backup is damaged: a block failed its integrity check');
  }
  writeSync(out, plain);
  total += plain.length;
  counter++;
  if (last) break;
}
closeSync(out);
console.log(`Decrypted ${total} bytes to ${output}. Extract it with: tar -xf ${output}`);
