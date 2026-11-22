# 0033. File encryption key, stored-file format and the files volume (#98)

- Status: **Accepted** (decisions by JC, step 37 phase 1)
- Date: 2026-11-22
- Builds on: [0014 Built-in backups, and the api's use of the owner role](0014-backup-and-owner-access.md), [0021 Optional AI features](0021-optional-ai-features.md)
- Part of step 37 (profile photos and encrypted media, release 0.3.0). This record covers the key, the format and the storage; the table and the sweeper join it in the next part, and photos themselves are [0034](0034-photos-and-media.md) (later).
- No migration in this part.

## Context

`design/kinship-storage-encryption.md` decided that KinShip encrypts every stored file itself. It was written for S3 and for a longer list of file kinds, and some of its details do not fit what is built or what JC decided later. **Where this record and that document differ, this record wins** (`design/` is a read-only mirror and is not edited from the repository):

| design doc says | built |
|---|---|
| `FILE_ENCRYPTION=on` (default), switchable off | **There is no such variable and no off switch.** Every file is always encrypted. |
| "a fresh random nonce per file" | A random **16-byte salt per file** goes through HKDF to make a per-file key; chunk nonces are counters. |
| `./data/media`, `MEDIA_PATH`, or a named volume | **`./data/files:/var/lib/kinship/files`** (a bind mount, like backups) and **`FILES_DIR`**. |

## Decisions

### The key
- `FILE_ENCRYPTION_KEY` or `FILE_ENCRYPTION_KEY_FILE` (the existing `_FILE` rules: both set is an error; the `change-me` placeholder is refused). The value is **base64 of exactly 32 bytes** (`openssl rand -base64 32`; it must be the canonical encoding) **or 64 hex characters**. Anything else is a `ConfigError` and the api refuses to start. The message never contains the value.
- **HKDF-SHA-256 derives from it** the file master key (info `kinship-file v1`) and an 8-byte, non-secret **key id** (info `kinship-file v1 key id`). The configured bytes are never used directly.
- **The key is optional at start.** Without it the api runs; uploads and photos answer 503 `files_unavailable` (built with the routes); Admin → Backups says "key missing". Optional, because an existing install must still start when it upgrades to 0.3.0 before the owner has made a key.
- Added to `scrubSecretsFromEnv`. Every child process (pg_dump, tar, …) already gets an explicit environment and never the api's.
- **The key is never in the database and never in a backup.** A backup holds files encrypted with it; the key is kept by the owner. **A lost or changed key is permanent loss of the stored photos**, and INSTALL, UPGRADE, `.env.example` and Admin all say so plainly. There is no rotation in 0.3.0 (a later `kinship files rekey` needs no format change: the header carries the key id).

### The stored-file format, version 1 (KSFL)
```
"KSFL" | version (1 byte) | key id (8 bytes) | salt (16 random bytes)     <- 29-byte preamble, in the clear
then chunks of 64 KiB:  length (u32 big endian) | ciphertext | 16-byte GCM tag
```
- AES-256-GCM, **counter nonce**, and the **preamble plus a "final chunk" flag as the AAD** of every chunk: chunks cannot be reordered, repeated, appended, cut off the end or moved to another file. An empty file is one empty final chunk.
- Per-file key = HKDF(master file key, salt = the header's 16 bytes, info `kinship-file v1 object`).
- **The chunk core is shared with backups.** `seal`, `open`, nonce and AAD moved to `src/crypto/chunks.ts`; the backup format (KSBK) is unchanged to the byte (its format tests, and the stand-alone decrypt script reading real output, pin it).
- One file holds one image variant (full or avatar), a few MB at most, so a file is **sealed and opened in memory**: a tag failure is an error before any byte leaves, never a truncated success.

### The files volume
- `./data/files:/var/lib/kinship/files`, `FILES_DIR` in the container. Linux needs `mkdir -p data/files && sudo chown 1000:1000 data/files`; the api prints those commands when it cannot use the folder, as it does for backups. Containers stay `read_only`, so a forgotten mount is not writable and photos stay off.
- Layout: `objects/<2 hex>/<32 hex>` for files, `tmp/` and `staging/` on the **same mount**, so a rename is atomic. Random 128-bit hex names: no original file name, no extension.
- A **marker file** (`.kinship-files`) says the folder was set up by KinShip. State is decided at start and again when Admin asks: `key_missing`; `files_unavailable` (not writable, **or the marker is absent while media rows exist: a missing mount is never treated as an empty folder**); `key_mismatch` (a sampled stored key id differs from the current key: the api starts, **new uploads are refused**, Admin says "does not match your files"); `ready`. The two checks that need the media table are hooks, wired in with the table.
- `GET /api/admin/files` (SuperAdmin) answers the state and the key id in hex (not secret).

## Consequences
- 0.3.0 is no longer an image-only update for an existing install: it needs a key in `.env` and the bind mount in `compose.yml` before photos work. UPGRADE.md says so. The key is optional, so nothing breaks for someone who does not follow it (no `feat!:` is needed; the release pipeline only demands an UPGRADE section for a breaking commit or lists a migration, and this block exists either way).
- The e2e stack and the upgrade test must create the folder and a key.
- Backups keep working unchanged; carrying the files in them is the next part (backup lists files from the snapshot), and **restore-with-files must exist before any file can be created** (#205, ADR 0035).
