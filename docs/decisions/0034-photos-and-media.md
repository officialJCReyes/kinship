# 0034. Photos: the image pipeline, upload and serving, date taken (#98)

- Status: **Accepted** (decisions by JC, step 37)
- Date: 2026-11-22
- Builds on: [0033 File encryption and storage](0033-file-encryption-and-storage.md), [0035 Restoring a backup that carries photos](0035-restore-with-photos.md)
- Migration: none in this part (the tables are 0021 and 0022).

## Context
Photos arrive from family members' phones and cameras: any size, any orientation, carrying GPS positions, camera serial numbers and sometimes a hidden thumbnail of an earlier edit. They are shown to everyone with an account, so what is stored must be a picture and only a picture, and what is served must never be able to run as anything else.

## Decisions

### The image pipeline: sharp
- **sharp** (Apache-2.0) with libvips. The spike (before any code) installed it on Alpine/musl for **amd64 and arm64** from the prebuilt platform package, with no compiler and no install script (`allowBuilds: sharp: false`). Cost in the api image: about **19 MB** (libvips 17.9 MB for the image's own architecture, only that one is installed). Peak memory at **50 megapixels**, one picture at a time: about **150 to 210 MB** for JPEG, PNG and WebP, in 1.5 to 4.5 seconds (arm64 native; amd64 emulated). A 50 MP JPEG is cheap because the decoder shrinks while reading. The numbers are in the pull request for 37c.
- **Licence.** libvips arrives as a separate platform package, `@img/sharp-libvips-*`, licensed **LGPL-3.0-or-later**, which is compatible with AGPL-3.0-or-later. It is a shared library file loaded at run time next to sharp's native addon, never copied into KinShip's code, so anyone can replace it. `scripts/check-licenses.mjs` gets a **named exception**: one entry per libvips platform package, exactly that licence, nothing else (a test proves it does not cover another package, another licence or an unlisted platform). LGPL is still not on the allow list. The docs site (Astro) installs the same files as a development tool, so the old workspace setting that kept them out is removed.
- **Fallback, not needed:** thumbnails made in the browser.

### What goes in, what comes out
- **Types:** JPEG, PNG and WebP, decided by the file's **first bytes**, never by its name or the browser's content type. GIF, SVG, HEIC and PDF are refused (415 `unsupported_image`); an SVG can carry script, and the others are out of scope for 0.3.0. The file input says the same in its `accept`.
- **Limits:** the body is the raw picture (no multipart dependency), at most **12 MB** on the wire, **10 MB** as a picture (413 `image_too_large`), **50 megapixels** (413 `image_too_many_pixels`, checked by libvips before the pixels are decoded). A damaged picture is 400 `invalid_image`.
- **Two variants, both re-encoded from the decoded pixels in the same type:** `full`, at most **2400 px** on the long side and never enlarged; `avatar`, **192 px** square (cropped to the area of interest). The EXIF orientation is applied, so the stored picture is upright and carries no orientation tag. Re-encoding keeps **no metadata at all**: no GPS, no camera, no software, no thumbnail, no XMP or IPTC. The original is never stored. An animated WebP keeps its first frame.
- **One picture at a time** in the api (`oneAtATime`), because a 50 MP picture needs about 150 MB while it is decoded. Up to four uploads wait; more are told 429 and to try again in 5 seconds.

### Date taken
- The only thing kept from EXIF is a **calendar date**: DateTimeOriginal, else CreateDate, read from the original **before** the metadata is dropped. A small reader (`media/exif.ts`) walks the TIFF structure with every offset checked, accepts only a real date (not `0000:00:00`, not February 30th) and drops the time and the time zone. It never throws.
- It is **not saved** by the upload. The upload response carries it as `suggestedTakenOn`, the form shows it, and the person confirms or changes it with `PATCH /api/media/:id {takenOn}` (`null` clears). It is stored as `taken_on` in the same partial-date text as a birth date (`2019`, `2019-07`, `2019-07-04`), checked by the same rule in the api and the database, and shown with the viewer's date-format setting.

### Who may do what
- **Upload and unlink:** whoever may change that person (`canEditPerson`): admins, and a Member for their own person and people in their line they added. A User and the signed-out never. The check is made before any time is spent on the picture.
- **Date taken:** the uploader, or anyone who may change a person the photo shows.
- **Delete a photo:** an admin, or the Member who uploaded it. **Profile photo:** `PATCH /api/people/:id {photoMediaId}`, which must be a photo linked to that person (409 `photo_not_linked`); unlinking a photo clears it (the database does that).
- **Seeing** a photo: every signed-in account, living people included (decided: a family tree app, one family).
- **Deleting a person** deletes the photos that show **only** them (rows first, in the same transaction) and removes their files **after the commit**; a photo that shows someone else too stays, and loses only the link. A rolled-back delete never loses a file; a file left behind by a failed removal is an orphan the sweeper takes within the hour.

### Serving
- `GET /api/media/:id/avatar` and `/full`, signed-in only. The whole file is **decrypted before the first byte is sent**, so damage is an error and never a half picture. Headers: the stored `Content-Type`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cache-Control: private, max-age=31536000, immutable` (a photo's id never changes what it shows). **No Range support**: a Range request gets the whole picture.
- Without a key, without the folder, or with a photo sealed with another key: **503 `files_unavailable`**. A missing file is 404 `photo_not_found`. An upload also looks at the key against the stored photos every time, so a mismatch refuses new uploads.

### Rate limits and the proxy
- **Uploads:** 20 per account per 10 minutes. **Pictures:** one bucket per account, **2400 a minute**, shared by every photo and avatar and **apart from the general 600 a minute** (one tree can draw several hundred avatars at once; the browser then keeps them for a year). One route serves both variants because the rate limiter counts per route.
- **nginx** has a location for `POST /api/people/:id/photos` with `client_max_body_size 12m`, `proxy_request_buffering off` (the body streams to the api; the container's disk is read-only) and 120 second timeouts. A reverse proxy in front may refuse 10 MB by default: INSTALL.md says to allow 12 MB (413 otherwise).

## Consequences
- The api image grows by about 19 MB, and a very large upload costs about 200 MB of memory for a few seconds.
- Metadata is gone for good: there is no "show the original" and no place for the date's time of day. That is the point.
- Photos in the Media page, Documents and PDFs, and several people per photo in the interface are later releases; the tables already allow them.
