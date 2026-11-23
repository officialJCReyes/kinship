# 0033. File encryption key, stored-file format and the files volume (#98)

- Status: **Accepted** (decisions by JC, step 37 phase 1)
- Date: 2026-11-22
- Builds on: [0014 Built-in backups, and the api's use of the owner role](0014-backup-and-owner-access.md), [0021 Optional AI features](0021-optional-ai-features.md)
- Part of step 37 (profile photos and encrypted media, release 0.3.0). This record covers the key, the format and the storage; the table and the sweeper join it in the next part, and photos themselves are [0034](0034-photos-and-media.md).
- Migration **0021** (media tables) arrived with the second part; its section is at the end.

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

## The media tables, the store and the sweeper (part 37b)

### Migration 0021 (forward-only, additive; the previous release ignores it)
- `media_files`: id, `storage_id` and `avatar_storage_id` (the two files of one photo: **one file per variant**, each 32 random hex characters, unique), `mime` (JPEG, PNG or WebP only), `size` and `avatar_size` (bytes on disk), `width`, `height`, **`taken_on`**, `key_id` (16 hex), `uploaded_by` (SET NULL), `created_at`. The prompt's column list had one storage id; a second is needed because each variant is its own file.
- **`taken_on` is `public.partial_date`**, the domain people's dates already use (`YYYY`, `YYYY-MM` or `YYYY-MM-DD`, stored as typed; migration 0003), and NULL is valid. A photo has no `before`/`about`/`after` precision (EXIF is a plain date and the person typing it is giving a date, not a claim); that is the one place it is narrower than a person's date, and it needs no new column if it is ever wanted.
- `media_people(media_id, person_id)`, both ON DELETE CASCADE, the pair is the primary key.
- `people.photo_media_id` with **two foreign keys**: to `media_files` (SET NULL) and a composite `(photo_media_id, id)` to `media_people` (SET NULL on the column). The second makes the database itself refuse a profile photo that is not linked to that person, and clears it when the link or the photo goes. It has its own column GRANT (`people` uses column grants).
- **Privileges:** 0001's default privileges give the app role everything on a new table, so 0021 revokes all and grants only what is used: `media_files` SELECT, DELETE, INSERT of the listed columns and UPDATE of `taken_on` alone; `media_people` SELECT, INSERT, DELETE. A test proves a `width` update is refused.
- **Row-level security, forced:** SELECT for every signed-in role. INSERT into `media_files` for an admin or a Member with `uploaded_by` = the signed-in account (Users never). UPDATE (the date) and DELETE for admins or the uploader; the uploader must still be a Member or admin (a demoted account cannot delete or edit). Link rows follow **`kinship_can_edit_person`** (new helper `kinship_can_edit_person_id`): admins; a Member for their own person and people in their line that they added. Raw-SQL tests run the whole matrix.
- Three small SECURITY DEFINER functions (`kinship_media_exists`, `kinship_media_key_ids`, `kinship_media_storage_ids`, EXECUTE for the app role only) answer what start-up and the sweeper must ask with nobody signed in, where row-level security would show an empty table.

### The store (`src/files/objects.ts`, `src/media/store.ts`)
- The object store writes through `tmp/` (exclusive create, fsync, rename) so a file appears whole or not at all, and accepts only a name that is exactly 32 lowercase hex characters, so no caller can reach outside `objects/`.
- The row functions take the request's transaction. Deleting returns the storage ids, and **the files are removed after the commit**: a rolled-back delete never loses a file, and a failed removal leaves an orphan for the sweeper. A person delete first deletes the photos that show only that person (a photo shared with someone else stays), then the person.

### The sweeper
Hourly, in the existing job runner. It removes an object file no row names only when it is **older than one hour** and not inside a **hold**: a DB-only restore writes `<files>/.sweep-hold` with a time seven days ahead (written by the restore part), and nothing is removed until then. It also clears `tmp/` leftovers older than an hour. It does nothing unless the files state is `ready`, and does nothing while the backup lock is held. The lock is only probed, not kept: an in-app restore pauses the job runner and the command line runs with the api stopped, so nothing else changes the folder during a sweep, and holding the lock would make a scheduled backup find it busy.

## Backups carry the photos (part 37f)
- The archive gains `files/<storage_id>` (each file byte for byte, still sealed with the file key) and `files.json` (name, bytes, SHA-256, key id of each, and a `missing` list). The manifest's `files` is `{included, count, bytes}`; the format number stays 1: an older reader refuses an archive that carries files through its existing guard, and by its entry-name check.
- **The list of files comes from the database rows under the same exported snapshot as the dump**, not from the folder afterwards. A file on disk with no row (uploaded after the snapshot) is left out. A row whose file is gone is listed as `missing` and the backup still succeeds (Test the latest backup reports it as a failure). Photos in the database with a files folder that has no marker is a hard refusal with the fix: a backup that quietly leaves every photo out would be worse.
- **Database-only is the default of the code** (`includeFiles` off): upgrade safety copies are database-only, and so are backups with "Include uploaded files" switched off. The scheduler, the manual backup and `kinship backup` apply the setting. `files.included` means "there is something to put back": with no photos (and none missing) the archive is the same as a database-only one, so restoring it leaves the files folder alone.
- **Free space** is now (database + twice the photo bytes) plus a tenth, and the refusal text gives each amount. (Twice: each photo is staged beside the archive the moment it is read, as a hard link when the folders share a disk and otherwise a copy, so a photo deleted while the backup runs cannot break it; then the archive holds them again.)
- **Test the latest backup** checks, for an archive with files: the index against the tar entries and the manifest; (with the temporary database) that every photo row is covered by the index and nothing was already missing; and about 20 sampled files read back out of the archive, matched to their size and SHA-256 and **decrypted with the server's current key**: "N files, X MB, key OK". A different key fails the test; no key here skips it. It does not re-hash every file.
- **Fix to 0021 (migration 0022).** The three definer functions run as the owner, and 0021 forced row-level security on the photo tables, so for an owner that is not a superuser they saw an empty table (and the sweeper would have taken every file for an orphan). 0022 un-forces it for the owner; the app role is unaffected. A test with a non-superuser owner proves it.
