# KinShip backlog and rc findings (started Nov 23, 2026; status updated after rc.2)

Where JC's findings from testing a release candidate go, with the release each one is aimed at. Companion to `kinship-release-and-deployment-plan.md`, whose 0.4.0 section now carries the 0.4.0 items below. When an item ships, move its line into `kinship-build-history.md` (steps 41 and 42 already hold the rc.2 items).

## Findings from testing 0.3.0-rc.1 (JC, Nov 23)
| # | Finding | Target | Status |
|---|---|---|---|
| 1 | Centre the sign-in logo, heading and button | rc.2 | **Done in rc.2 (#235).** |
| 2 | Legend hidden by default and remembered | rc.2 | **Done in rc.2 (#237).** Remembered in this browser; a per-user setting could ride on a 0.4 migration. |
| 3 | Camera menu on the person panel and profile (and the gallery): upload new or choose one of the person's own photos | rc.2 | **Done in rc.2 (#238, #239).** No schema change: the profile photo must be one of the person's own linked photos (composite foreign key, migration 0021). |
| 3b | Pick ANY family photo as someone's profile photo | 0.4.0 | Open. Needs a tag-a-person route, its permission rule and probably a SECURITY DEFINER function in a migration (`media_people` rows are written only through functions). Design with the crop and the Media viewer: choose photo, tag the person, crop. |
| 4 | Camera icon style | rc.2 | **Done in rc.2 (#236).** |
| 5 | Non-destructive crop | 0.4.0 | Open (migration; design below). |
| 6 | Select arrows spilling out of their boxes | rc.2 | **Done in rc.2 (#236).** |
| 7 | Keep a photo's location so it can be placed on a map | Proposed: capture 0.4.0, show 0.5 | **Open, needs JC's yes** (reverses "GPS is never kept"). Design below. |

Also open for 0.4.0: #227 (the per-account sign-in lock also refuses the correct password), the emailed password-reset request form (design in `kinship-email-templates.md`, section 3), and #228 (automate the `autorelease` label swap).

## Non-destructive crop (0.4.0, design to confirm)
- The saved photo (the 2400 px variant) is never changed. The Media grid thumbnail is not changed either.
- The crop belongs to the person, not the photo: one person's profile crop must not change how the same photo looks for someone else in it. Store the crop (a square, as x, y and size relative to the 2400 px variant) on the person, and a **separate per-person avatar file** made from that crop, so the existing avatar variant of the photo stays as it is.
- The server makes the avatar (decrypt the 2400 px variant, crop, resize to 192 px, encrypt, store). A display-only CSS crop would make every tree node load a 2400 px picture, so it is not an option.
- Cross-cutting work the step must include: a migration, a reference the sweeper, backup (`files.json`) and restore (ADR 0035) all know about, a reset to the automatic crop, and tests for each.
- The UI is a square crop with drag and zoom, reachable from the profile photo, the person panel and the Media viewer.

## Photo location (proposed, needs JC)
- Today GPS is read by nobody: the server re-encodes every upload and drops all EXIF except the date taken (ADR 0034, Nov 22). Photos uploaded so far have no location, and it cannot be recovered from them.
- Proposed, in the same pattern as the date taken: the server reads the GPS position before the strip and offers it to the uploader (**"This photo has a location. Keep it?", off by default**). It is saved only when the uploader says yes, as two nullable numbers on the photo, and it is never written into the stored or served file.
- Privacy points to settle: a photo's position is often someone's home, and photos of living people are visible to every account. Options: show the position only to the uploader and admins until 0.5 defines map display; round to about 1 km unless the uploader picks an exact place; let the uploader link it to a Place instead of keeping raw numbers. Children's photos need the same care as the birthday rule.
- The map consumer arrives with the Places library in 0.5 (and map tiles in 1.1), so capture could wait for 0.5. Capturing in 0.4.0 means photos uploaded before 0.5 can still be placed, at the cost of one small migration.
- Needs an ADR that amends 0034, and the requirements doc line "GPS is always dropped" changes.

## Rules for a release candidate (learned from rc.1 and rc.2)
- It carries fixes only. Anything that needs a migration waits for 0.4.0.
- Before tagging: the seed wrapper for the rc, the version PR (UPGRADE and CHANGELOG headings renamed, manifest unchanged) merged last, then "tag it". After publishing, the pin PR keeping the earlier pins. Full list: `kinship-release-lessons-and-corrections.md`.
