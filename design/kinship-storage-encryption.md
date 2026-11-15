# KinShip file encryption (Nov 14, 2026)

Adds to the "File storage" decision in `kinship-v2-requirements.md`. **Confirmed by JC:** KinShip encrypts its own files before they are uploaded to S3. JC's reason: this is self-hosted software, so security is usually a top priority.

## Where things stood
Nothing in the earlier design encrypted files for S3. Files were private (permission check, short-lived signed links) and DNA raw files were described as "encrypted at rest", but no mechanism was specified. What the provider does on its own varies: AWS S3 encrypts new objects by default; Backblaze B2 and MinIO need server-side encryption turned on; Cloudflare R2 encrypts at rest always. That protects against a stolen disk, not against someone with access to the bucket or the provider account.

## Decision (confirmed)
Two separate variables:
- **`FILE_ENCRYPTION=on` (default on), plus `FILE_ENCRYPTION_KEY`.** KinShip encrypts **every file** (photos, documents, DNA raw files, thumbnails) with AES-256-GCM and a fresh random nonce per file **before** it leaves the server, for S3 and for the local volume. The provider only ever stores scrambled bytes. The key lives in `.env` (mode 600) or a Docker secret (`FILE_ENCRYPTION_KEY_FILE`), never in the database or the Admin page. The Admin page shows only "set". Because security is the priority, it is on by default and turning it off is a deliberate edit.
- **`S3_SSE=AES256` (optional, S3 only).** Asks the provider to encrypt at rest as well (also `aws:kms` for AWS KMS). A second layer on top, not a replacement.

## How the key is created (decided by JC: the Deployment page explains it)
The Deployment page has a **File encryption key** card (built in the mockup):
1. Generate a random 32-byte key with `openssl rand -base64 32`.
2. Put it in `.env` as `FILE_ENCRYPTION_KEY=...` (mode 600), or save it to a file and point `FILE_ENCRYPTION_KEY_FILE` at it (Docker secret), with `chmod 600`.
3. Start the stack; Admin shows the key as "set" and never the value.
4. **Back the key up now**, separately from the database and file backups (a password manager is a good place). Files cannot be decrypted without it and it cannot be recovered.
The card also warns not to change the key later without a re-encrypt run.

## What "streaming" means here
Without encryption, the browser can fetch a file straight from the bucket with a short-lived signed link, so the server never touches the bytes. With encryption, the bucket holds scrambled bytes, so a direct link would give the browser a file it cannot open. Instead: the browser asks the api for the file, the api checks the person's permission, reads the encrypted object from S3, decrypts it **in small chunks as it arrives** and sends each chunk on to the browser straight away. It is called streaming because the whole file is never held in memory or written to disk, so a 2 GB video does not need 2 GB of RAM, and playback can start before the download finishes. Seeking in a video works through HTTP range requests (the app maps the requested byte range to the encrypted chunks it needs). Cost: every file view passes through the server, so it uses some CPU and bandwidth there instead of at the provider. For a family archive of 10 to 50 people this is small.
Implementation note: files are encrypted in fixed-size chunks (for example 64 KB), each with its own authentication tag, so a range can be decrypted without reading the whole file and tampering is detected.

## Other consequences
- **Losing the key means losing the files.** Key rotation needs a re-encrypt job (the Admin migrate action can double as that).
- Turning it on for an install that already has plain files: new uploads are encrypted, and a migrate action re-encrypts old ones. Each stored file records whether it is encrypted, so mixed state works.
- Thumbnails and the Media grid are generated server-side from decrypted files and are also stored encrypted.
- DNA raw files use the same mechanism (this is what "encrypted at rest" means in the DNA doc).
- Backups of the media folder or bucket stay encrypted too, which is a benefit when they go to another provider.

## In the mockup (published)
Admin → Storage & email, File storage card: `FILE_ENCRYPTION` (on by default) and `FILE_ENCRYPTION_KEY` (hidden, "set") for both backends, `S3_SSE` for S3, and a note about streaming and the key. Deployment page: the File encryption key card. The compose example has `FILE_ENCRYPTION: "on"` and a commented `S3_SSE`.

## Open
- None right now.
