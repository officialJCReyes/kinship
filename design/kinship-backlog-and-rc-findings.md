# KinShip backlog and rc findings (started Nov 23, 2026; updated Nov 26 after step 51)

Where JC's findings from testing a release candidate go, with the release each one is aimed at. Companion to `kinship-release-and-deployment-plan.md`, whose 0.4.0 section carries the 0.4.0 items below, and to `kinship-0.4.0-plan-and-status.md`, which has the step-by-step 0.4.0 plan and its status. When an item ships, its detail is in `kinship-build-history.md` (steps 41, 42 and 43) or the 0.4.0 note.

## Findings from testing 0.3.0-rc.1 and rc.2 (JC, Nov 23)
| # | Finding | Target | Status |
|---|---|---|---|
| 1 | Centre the sign-in logo, heading and button | rc.2 | **Done in rc.2 (#235).** |
| 2 | Legend hidden by default and remembered | rc.2 | **Done in rc.2 (#237).** Remembered in this browser; a per-user setting rides on migration 0030 (step 57). |
| 3 | Camera menu on the person panel and profile (and the gallery): upload new or choose one of the person's own photos | rc.2 | **Done in rc.2 (#238, #239).** The profile photo must be one of the person's own linked photos (composite foreign key, migration 0021). |
| 3b | Pick ANY family photo as someone's profile photo | 0.4.0 | Open (step 58, migration 0031). Needs a tag-a-person route, its permission rule (`canEditPerson` of that person) and a SECURITY DEFINER function (`media_people` rows are written only through functions). Design with the crop and the Media viewer: choose photo, tag the person, crop. |
| 4 | Camera icon style | rc.2 | **Done in rc.2 (#236).** |
| 5 | Non-destructive crop | 0.4.0 | Open (step 58, migration 0031; design below). |
| 6 | Select arrows spilling out of their boxes | rc.2 | **Done in rc.2 (#236).** |
| 7 | Keep a photo's location so it can be placed on a map | Capture 0.4.0, show 0.5 | **Decided Nov 23; details decided Nov 25 to 26.** Step 59, migration 0032, ADR 0047 (amends 0034). Design below. |
| 8 | A way to clear a person's profile photo | next rc or the final | **Done in step 43 (#252).** |
| 9 | Relationship finder: show the path the way MyHeritage does | next rc or the final | **Done in step 43 (#253).** |
| 10 | Remove the explainer paragraph under the finder | next rc or the final | **Done in step 43 (#248).** |
| 11 | Remove the "Surname particle" field | next rc or the final | **Done: data folded in step 43 (#249, migration 0024, ADR 0038); the column is dropped by migration 0025 (step 50, #282).** |
| 12 | Prefix and suffix as pre-populated drop-downs | next rc or the final | **Done in step 43 (#250).** |
| 13 | Name form layout, asterisks, helper text removed | next rc or the final | **Done in step 43 (#251).** |
| 14 | Double-click a card opens the side panel even if collapsed | next rc or the final | **Done in step 43 (#254).** Also Shift+Enter. |
| 15 | A "+" nub on each card opens the Add relative wizard | next rc or the final | **Done in step 43 (#255).** |

## 0.4.0 carry-over: status (Nov 26)
- **Done:** the contract migration for the particle and #220 (step 50, #282; rows too long to fold are kept in `people_surname_particle_leftover`); #271, #221, #228 (step 51, #287 to #289); #156 and #230 closed (clean since #257, #258 and #241); the person panel (step 49, #283, #285, #286, ADR 0040).
- **Still open:** #227 (step 52); the emailed reset form (step 54); items 3b, 5 and 7 above (steps 58 and 59); #263 (step 60).
- **Watch:** journey 09 (`09-my-settings.spec.ts:72,92`) failed once on Nov 23; no issue opened.
- #221 note: no sideways overflow reproduced at 360 px on one dialog; the real defect was the Close button's tap target, fixed in #288. The Restore and photo dialogs were not opened at 360 px.

## Docs that still need correcting (do not edit `design/` from Claude Code)
The list is in `kinship-0.4.0-plan-and-status.md`, last section. In short: the requirements doc (names bullet, GPS line, finder paragraph, panel top), the handoff's open items and migration and ADR numbers, the release plan's v0.4.0 entry, the email-templates and SSO docs, the mockup, and the website's 0.4 card.

## Non-destructive crop (0.4.0, step 58, design to confirm)
- The saved photo (the 2400 px variant) is never changed. The Media grid thumbnail is not changed either.
- The crop belongs to the person, not the photo: one person's profile crop must not change how the same photo looks for someone else in it. Store the crop (a square, as x, y and size relative to the 2400 px variant) on the person, and a **separate per-person avatar file** made from that crop, so the existing avatar variant of the photo stays as it is.
- The server makes the avatar (decrypt the 2400 px variant, crop, resize to 192 px, encrypt, store). A display-only CSS crop would make every tree node load a 2400 px picture, so it is not an option.
- Cross-cutting work the step must include: a migration, a reference the sweeper, backup (`files.json`), verify, restore (ADR 0035) and `kinship_media_storage_ids()` all know about, a reset to the automatic crop, and tests for each. The crop's restore query must work on a schema-24 archive.
- The UI is a square crop with drag and zoom. Entry points (decided Nov 25): the camera menu on the profile and the person panel ("Adjust crop", "Reset to automatic"); in the Media viewer "Use as profile photo of..." goes to tag, then crop. Setting any profile photo opens the crop dialog with the automatic crop filled in.
- "Remove profile photo" must also drop any stored crop and per-person avatar once the crop exists; the sweeper removes a dropped crop's file after an hour.

## Photo location (decided: capture in 0.4.0, show in 0.5)
- Today GPS is read by nobody: the server re-encodes every upload and drops all EXIF except the date taken (ADR 0034, Nov 22). Photos uploaded so far have no location, and it cannot be recovered from them. This decision reverses "GPS is never kept".
- Design, in the same pattern as the date taken: the server reads the GPS position before the strip and offers it to the uploader (**"This photo has a location. Keep it?", off by default**). It is saved only when the uploader says yes, as two nullable numbers on the photo (a range CHECK), and it is never written into the stored or served file.
- **Decided Nov 25 to 26:** the stored position is visible to the uploader and admins only until 0.5; the API leaves it out for everyone else and it is not in `GET /api/media` lists. It is rounded to 2 decimals (about 1 km) on the API side before storing, unless the uploader ticks "exact place"; the unrounded value is never written otherwise (test it). It is never offered for a photo of a living person under 18 or with no birth year; for other living people it comes with a one-line privacy note. A "Remove location" action exists. No link to a Place in 0.4 (Places is 0.5; the numbers are stored now and linked later).
- The map consumer arrives with the Places library in 0.5 (and map tiles in 1.1).
- Needs ADR 0047, which amends 0034; the requirements doc line "GPS is always dropped" and the storage-encryption doc change when it is built.

## Rules for a release candidate (learned from rc.1 and rc.2)
- It carries fixes only. Anything that needs a migration waits for 0.4.0. **Exception used in step 43: migration 0024 (the particle fold), because the field never reached a stable release.**
- Before tagging: the seed wrapper for the rc, the version PR (UPGRADE and CHANGELOG headings renamed, manifest unchanged) merged last, then "tag it". After publishing, the pin PR keeping the earlier pins. Full list: `kinship-release-lessons-and-corrections.md`.
- Since step 51 (#289), the final release's workflow swaps the release PR's label automatically; check the Release run log after the 0.4.0 tag, and swap by hand if that step fails.
