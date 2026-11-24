# KinShip backlog and rc findings (started Nov 23, 2026; updated Nov 24 after step 43)

Where JC's findings from testing a release candidate go, with the release each one is aimed at. Companion to `kinship-release-and-deployment-plan.md`, whose 0.4.0 section carries the 0.4.0 items below. When an item ships, its detail is in `kinship-build-history.md` (steps 41, 42 and 43).

## Findings from testing 0.3.0-rc.1 and rc.2 (JC, Nov 23)
| # | Finding | Target | Status |
|---|---|---|---|
| 1 | Centre the sign-in logo, heading and button | rc.2 | **Done in rc.2 (#235).** |
| 2 | Legend hidden by default and remembered | rc.2 | **Done in rc.2 (#237).** Remembered in this browser; a per-user setting could ride on a 0.4 migration. |
| 3 | Camera menu on the person panel and profile (and the gallery): upload new or choose one of the person's own photos | rc.2 | **Done in rc.2 (#238, #239).** The profile photo must be one of the person's own linked photos (composite foreign key, migration 0021). |
| 3b | Pick ANY family photo as someone's profile photo | 0.4.0 | Open. Needs a tag-a-person route, its permission rule and probably a SECURITY DEFINER function in a migration (`media_people` rows are written only through functions). Design with the crop and the Media viewer: choose photo, tag the person, crop. |
| 4 | Camera icon style | rc.2 | **Done in rc.2 (#236).** |
| 5 | Non-destructive crop | 0.4.0 | Open (migration; design below). |
| 6 | Select arrows spilling out of their boxes | rc.2 | **Done in rc.2 (#236).** |
| 7 | Keep a photo's location so it can be placed on a map | Capture 0.4.0, show 0.5 | **Decided Nov 23 (JC took the recommendation).** Design below; still needs its ADR (amends 0034) when built. |
| 8 | A way to clear a person's profile photo | next rc or the final | **Done in step 43 (#252).** "Remove profile photo" in the camera menu, with a confirm; only unsets the profile photo; no migration. |
| 9 | Relationship finder: show the path the way MyHeritage does (shared parents above a sibling or cousin hop) | next rc or the final | **Done in step 43 (#253).** |
| 10 | Remove the explainer paragraph under the finder | next rc or the final | **Done in step 43 (#248).** The "What 'once removed' means" panel stays. |
| 11 | Remove the "Surname particle" field; a particle is part of the surname | next rc or the final | **Done in step 43 (#249, migration 0024, ADR 0038).** Data folded; the column is dropped in a 0.4.0 contract migration. |
| 12 | Prefix and suffix as pre-populated drop-downs | next rc or the final | **Done in step 43 (#250).** |
| 13 | Name form layout: Given (and middle) name and Surname first, then second and married surname, then prefix, suffix and nickname; asterisks on required fields; helper text removed | next rc or the final | **Done in step 43 (#251).** |
| 14 | Double-click a card opens the side panel even if collapsed | next rc or the final | **Done in step 43 (#254).** Also Shift+Enter. |
| 15 | A "+" nub on each card opens the Add relative wizard | next rc or the final | **Done in step 43 (#255).** Offset to the right of the bottom centre; no nub in the Fan. |

Step 43 is merged to `main` and **not tagged**. Whether to cut `0.3.0-rc.3` now (it carries migration 0024) or wait for more findings is JC's call after he tests on a copy of his real tree.

## Still open for 0.4.0
- #227 (the per-account sign-in lock also refuses the correct password); the emailed password-reset request form (design in `kinship-email-templates.md`, section 3); #228 (automate the `autorelease` label swap).
- **The contract migration for the particle:** drop `people.surname_particle`; rewrite the `search_names` expression, the placeholder CHECK and the grants; replace `complete_setup_family`. Deal first with any row 0024 left untouched because particle plus surname passed 100 characters (0024 raises a NOTICE naming them).
- Items 3b, 5 and 7 above.
- The `adoption-ui` test flake (#156) now fails often; fix it before the next release candidate if possible.

## Docs that still need correcting (do not edit `design/` from Claude Code)
- `kinship-v2-requirements.md`: the names bullet (still lists an optional surname particle); the Relationship finder paragraph (explainer and the old diagram); Profile photos (Remove profile photo, double-click, the "+" nub).
- `kinship-tree-settings-and-search.md` and `kinship-release-and-deployment-plan.md`: the particle mentions.
- The mockup: the finder explainer and drawing, the particle field and old name form, no "+", no "Remove profile photo", no double-click.
- Fixed in the Nov 24 sync: the handoff, the lessons doc, the build history and `kinship-gedcom-coverage.md` (an SPFX is joined to the front of the surname on import).

## Non-destructive crop (0.4.0, design to confirm)
- The saved photo (the 2400 px variant) is never changed. The Media grid thumbnail is not changed either.
- The crop belongs to the person, not the photo: one person's profile crop must not change how the same photo looks for someone else in it. Store the crop (a square, as x, y and size relative to the 2400 px variant) on the person, and a **separate per-person avatar file** made from that crop, so the existing avatar variant of the photo stays as it is.
- The server makes the avatar (decrypt the 2400 px variant, crop, resize to 192 px, encrypt, store). A display-only CSS crop would make every tree node load a 2400 px picture, so it is not an option.
- Cross-cutting work the step must include: a migration, a reference the sweeper, backup (`files.json`) and restore (ADR 0035) all know about, a reset to the automatic crop, and tests for each.
- The UI is a square crop with drag and zoom, reachable from the profile photo, the person panel and the Media viewer.
- "Remove profile photo" (item 8) must also drop any stored crop and per-person avatar once the crop exists.

## Photo location (decided Nov 23: capture in 0.4.0, show in 0.5)
- Today GPS is read by nobody: the server re-encodes every upload and drops all EXIF except the date taken (ADR 0034, Nov 22). Photos uploaded so far have no location, and it cannot be recovered from them. This decision reverses "GPS is never kept".
- Design, in the same pattern as the date taken: the server reads the GPS position before the strip and offers it to the uploader (**"This photo has a location. Keep it?", off by default**). It is saved only when the uploader says yes, as two nullable numbers on the photo, and it is never written into the stored or served file.
- Privacy points to settle in the 0.4.0 prompt and ADR: a photo's position is often someone's home, and photos of living people are visible to every account. Options: show the position only to the uploader and admins until 0.5 defines map display; round to about 1 km unless the uploader picks an exact place; let the uploader link it to a Place instead of keeping raw numbers. Children's photos need the same care as the birthday rule.
- The map consumer arrives with the Places library in 0.5 (and map tiles in 1.1). Capturing in 0.4.0 means photos uploaded before 0.5 can still be placed, at the cost of one small migration.
- Needs an ADR that amends 0034, and the requirements doc line "GPS is always dropped" changes when it is built.

## Rules for a release candidate (learned from rc.1 and rc.2)
- It carries fixes only. Anything that needs a migration waits for 0.4.0. **Exception used in step 43: migration 0024 (the particle fold), because the field never reached a stable release.**
- Before tagging: the seed wrapper for the rc, the version PR (UPGRADE and CHANGELOG headings renamed, manifest unchanged) merged last, then "tag it". After publishing, the pin PR keeping the earlier pins. Full list: `kinship-release-lessons-and-corrections.md`.
