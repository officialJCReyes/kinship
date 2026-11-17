# KinShip backup archive format, version 1

A KinShip backup is one file, `kinship-YYYY-MM-DD-HHMM.tar.enc` (UTC), an encrypted tar. This page describes it exactly, so
that a backup can be opened without KinShip (see "Disaster recovery"). The reference implementation is
`apps/api/src/backup/`; the stand-alone reader is [`backup/kinship-decrypt.mjs`](backup/kinship-decrypt.mjs).

## What is inside (after decryption)

A tar archive containing:

| Entry | What |
|---|---|
| `manifest.json` | What the backup is: schema number, app version, Postgres versions, role names, per-table row counts and digests, a fingerprint of the row-level security and grants, the SHA-256 of `database.dump`, and a `files` section. |
| `database.dump` | A `pg_dump -Fc --no-owner` dump of the whole database, taken as the database owner so that row-level security hides nothing. |
| `files/...` | Uploaded media, still encrypted with the file key, when there are any. (KinShip 0.2 has none: `files` says `{"included": false, "count": 0}`.) |

The backup does **not** contain `FILE_ENCRYPTION_KEY` or the backup passphrase. Keep both outside the server.

## The encrypted file

All numbers are big endian.

```
offset 0   "KSBK"                 4 bytes of ASCII
offset 4   format version         1 byte, 1 for this page
offset 5   header length H        u32
offset 9   header                 H bytes, UTF-8 JSON
then       chunks                 until the end of the file
```

The first `9 + H` bytes are the **preamble**. The header is not secret (a restore can say "this backup is too new" before it
asks for a passphrase) but it is authenticated: nothing in it is trusted until a chunk has authenticated with the passphrase.

Header fields: `format` (1), `appVersion`, `schema` (the highest applied migration number), `created` (ISO 8601, UTC),
`chunkSize` (65536), `check` (base64, 32 bytes), and `kdf`: `{ "alg": "scrypt", "N": 131072, "r": 8, "p": 1, "salt": "<base64, 16 bytes>" }`.

### Keys

1. `master = scrypt(NFC(passphrase) as UTF-8, salt, 32 bytes, N, r, p)`.
2. `key = HKDF-SHA256(master, salt = empty, info = "kinship-backup v1 key", 32 bytes)`.
3. `check = HKDF-SHA256(master, salt = empty, info = "kinship-backup v1 check", 32 bytes)`.

`check` is stored in the header. A reader derives it again: if it differs the passphrase is wrong, and nothing else is
tried. A reader refuses `scrypt` settings that need more than 512 MiB (`128 * N * r`) or `p` above 4.

### Chunks

Each chunk is `length (u32) | ciphertext (length bytes) | tag (16 bytes)`, with `length` from 0 to `chunkSize`. The plaintext
is cut into `chunkSize` pieces; the last piece (which may be empty, but never is except for an empty file) is the final chunk.

Each chunk is AES-256-GCM with:

- **nonce** (12 bytes): four zero bytes, then the chunk number (the first chunk is 0) as a 64-bit number;
- **AAD**: the whole preamble, followed by one byte: `0x01` for the final chunk, `0x00` for every other.

So chunks cannot be reordered, dropped from the middle, or cut from the end without a tag failing. A reader that gets the end
of the file after a chunk that only authenticates as "not final" reports a **truncated** archive; a failed tag anywhere else is
a **damaged** archive. Plaintext is complete and trustworthy only when the last chunk has authenticated.

## Disaster recovery

You need the archive and the passphrase; nothing else from the server.

1. **Plain openssl cannot do this.** `openssl enc` has no AES-GCM and does not read this chunked layout. Use one of:
2. **The script**, on any machine with Node.js 18 or newer: `BACKUP_PASSPHRASE='...' node kinship-decrypt.mjs backup.tar.enc out.tar`. It uses only `node:crypto`.
3. **The image**: `docker run --rm -it -v "$PWD:/b" -e BACKUP_PASSPHRASE ghcr.io/officialjcreyes/kinship-api:<version> kinship backup-decrypt /b/backup.tar.enc /b/out.tar`.
4. Then `tar -xf out.tar`. `database.dump` is a PostgreSQL custom-format dump: read it with `pg_restore` of the same major version or newer, for example `pg_restore -f - database.dump | less`.

To restore a whole installation, use `kinship restore` (see INSTALL.md). It does the same decryption, then checks the manifest and
replaces the database in one transaction.
