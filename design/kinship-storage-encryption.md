# KinShip file encryption (Nov 14, 2026; updated Nov 22 after 0.3.0 step 37)

Adds to the "File storage" decision in `kinship-v2-requirements.md`. **Confirmed by JC:** KinShip encrypts its own files before they are stored. JC's reason: this is self-hosted software, so security is usually a top priority. **Built in 0.3.0 step 37 for the local folder (profile photos); S3 is later** (the S3 parts below are the plan, not built). Decisions and ADRs: 0033 (the key and the store), 0034 (the image pipeline, upload, serve and the Media page), 0035 (backup with files and restore).

## What is built (0.3.0)
- **One key, no off switch.** `FILE_ENCRYPTION_KEY` or `FILE_ENCRYPTION_KEY_FILE` (a Docker secret), either base64 of 32 random bytes or 64 hex characters. There is **no `FILE_ENCRYPTION=off`**: every stored file is encrypted. The key is **optional at startup**, so an install that does not use files still starts. The Admin "Photos and files" card shows one of four states and never the value: `key_missing` (no key set), `files_unavailable` (the folder is not mounted or not writable), `key_mismatch` (files exist that this key cannot open) and `ready`. A photo upload with no key or no folder answers 503 `files_unavailable` with a `reason`.
- **Where files live.** A bind mount `./data/files:/var/lib/kinship/files` (`FILES_DIR`), under `objects/<2 hex>/<32 hex>`, with `tmp/` and `staging/` beside it for uploads and restores in progress.
- **Format (KSFL v1).** AES-256-GCM in 64 KiB chunks, each with its own authentication tag, a per-file random salt (HKDF derives the file's key from the master key and the salt) and an 8-byte key id, so a wrong key is told apart from a damaged file and tampering is detected. The chunk code is shared with the backup archive (`crypto/chunks.ts`).
- **Pictures only in 0.3.0.** JPEG, PNG and WebP, decided by the first bytes of the file, not the name or the claimed type. Each upload is re-encoded by the server (sharp): a 2400 px full variant and a 192 px avatar, both upright and with no EXIF. **The date taken is the only thing kept from EXIF** (DateTimeOriginal, else CreateDate), offered to the uploader as a suggestion and saved only as a plain date the uploader can edit; GPS and everything else is dropped. Documents, PDFs, video and audio are later releases.
- **Serving.** `GET /api/media/:id/:variant` checks the signed-in account's permission, decrypts the whole picture (at most 10 MB) and sends it with `nosniff`, `default-src 'none'; sandbox` and an immutable cache. Streaming with range requests (below) arrives with video.
- **Access.** Photos of living people are visible to every signed-in account. Edit and delete follow the person rules (admins; a Member on their own person and people in their line; a User never; a Member deletes only their own uploads).
- **Orphans.** A sweeper removes stored files that no row uses once they are an hour old. It honours the backup lock and a `.sweep-hold` file, and refuses to delete anything when the database shows no photos but the folder holds files (a wrong database or a failed restore must never wipe the folder).
- **Backups and restore carry the photos.** The backup archive has a `files/` slot, an index (`files.json`) and a manifest entry (`files: {included, count, bytes}`); the archive format number stays 1. Photos are included by default; pre-upgrade safety copies stay database-only. Restore checks the key first, stages and verifies the files, then swaps the folder after the database commit, with crash recovery at the next start (ADR 0035). **Losing the key means losing the photos, and a backup is only as restorable as the key you keep separately.**
- **Engine keys.** A key saved in Admin for automatic transcription (0.5) is encrypted with a subkey derived from `FILE_ENCRYPTION_KEY` (or an explicit `SECRETS_ENCRYPTION_KEY`); an environment variable wins and locks the field.

## How the key is created (decided by JC: the Deployment page explains it)
1. Generate a random 32-byte key with `openssl rand -base64 32`.
2. Put it in `.env` as `FILE_ENCRYPTION_KEY=...` (mode 600), or save it to a file and point `FILE_ENCRYPTION_KEY_FILE` at it (Docker secret), with `chmod 600`.
3. Start the stack; Admin shows the key as "set" and never the value.
4. **Back the key up now**, separately from the database and the backups (a password manager is a good place). Files cannot be decrypted without it and it cannot be recovered.
Do not change the key later: there is no re-encrypt job yet (the key id in each file makes a wrong key visible, but nothing converts old files).

## Where things stood before 0.3.0
Nothing in the earlier design encrypted files for S3. Files were private (permission check, short-lived signed links) and DNA raw files were described as "encrypted at rest", but no mechanism was specified. What a provider does on its own varies: AWS S3 encrypts new objects by default; Backblaze B2 and MinIO need server-side encryption turned on; Cloudflare R2 encrypts at rest always. That protects against a stolen disk, not against someone with access to the bucket or the provider account.

## Later: S3 and streaming (planned, not built)
- **`S3_SSE=AES256` (optional, S3 only)** would ask the provider to encrypt at rest as well (also `aws:kms`): a second layer on top of KinShip's own encryption, not a replacement.
- **Streaming.** With encryption the bucket holds scrambled bytes, so a signed link would give the browser a file it cannot open. The api would read the encrypted object, decrypt it **in small chunks as it arrives** and send each chunk on, so a 2 GB video does not need 2 GB of RAM and playback can start early. Seeking uses HTTP range requests (the requested byte range is mapped to the 64 KiB chunks it needs; the chunk format already allows this). Cost: every file view passes through the server. For a family archive of 10 to 50 people this is small.
- DNA raw files, documents and other media will use the same mechanism (this is what "encrypted at rest" means in the DNA doc).
- A key rotation or re-encrypt job is not built.

## Open
- Re-encrypting existing files under a new key (rotation) and the S3 backend (0.5 or later).
