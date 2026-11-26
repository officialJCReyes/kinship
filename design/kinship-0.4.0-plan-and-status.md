# KinShip 0.4.0 plan, decisions and status (started Nov 25, 2026; updated Nov 26 after step 51)

Read after `kinship-build-status-and-handoff.md`. That note is current through step 47 (0.3.0 published); this note carries everything from step 48 on and **wins wherever the two differ**. The plan comes from Claude Code's Step 48 report, approved by JC with the changes below (prompt `04-plan-0.4.0-decisions.md`). The release plan's 0.4.0 entry (`kinship-release-and-deployment-plan.md`, section 6) is older; the corrections are at the end of this note.

## Where things stand (Nov 26)
- **Merged:** step 49 (person panel: PRs #283, #285, #286; ADR 0040), step 50 (migration 0025: PR #282), step 51 (#287, #288, #289). #156 and #230 are closed. #271, #221, #228 and #220 are fixed.
- **Open PR:** #284, the bot's "chore(main): release 0.4.0". **Do not merge it.** It keeps growing with each `feat` and `fix`. It is merged only for the final 0.4.0 (after the rc).
- **Latest migration 0025; next 0026.** Latest ADR 0040; next 0041 (0041 is reserved for the email foundation, step 53; step 52 uses 0042, so a gap is expected).
- **Tests after step 51:** API 1,787, web 1,058, script tests 60, docs 7, e2e 87 (sign-ins still 6).
- **Next:** step 52 (#227 sign-in lock), prompt `07-signin-lock-227.md`, phase 1 not yet run.
- **Dev box:** local Node is 22 and the repo needs 26; two local failures (`update-checker` proxy test, `pnpm test:scripts` directory form) come from that, not from the code. CI uses 26.

## The prompts folder (`prompts/` in the repo, git-ignored)
01 release 0.3.0; 02 plan 0.4.0 (step 48); 03 side panel (step 49); 04 decisions on the plan; 05 contract migration 0025 (step 50); 06 small carry-over (step 51); 07 sign-in lock #227 (step 52).

## Plan, in build order (ADR and migration numbers shift if the order changes)
| Step | What | Migration | ADR | Status |
|---|---|---|---|---|
| 48 | The plan | none | none | Done |
| 49 | Side panel: born/died lines with ages, relationship line, icon buttons, FamilySearch research link, View family, More menu | none | 0040 | **Done** (#283, #285, #286) |
| 50 | Contract migration: drop `people.surname_particle` and `users.surname_choice` (#220) | 0025 | addendum to 0038 | **Done** (#282) |
| 51 | #271, #221, #156, #230, #228, CLAUDE.md line | none | note on 0037 | **Done** (#287, #288, #289) |
| 52 | #227: per-(account, IP) sign-in lock, limits ready for TOTP | none | 0042 | Prompt ready |
| 53 | Email foundation: Resend or SMTP, outbox, templates, Admin -> Storage & email, Deployment page (split 53a, 53b, 53c) | 0026 | 0041 | |
| 54 | Email flows: invitation by email, reset request form, "password changed" notice, "Secure my account"; "Forgot password?" only when mail is set up and SSO is off (#59) | 0027 | 0041 amended | |
| 55 | TOTP for every SuperAdmin; start with a shared enrol-and-compute-code test helper, then move the e2e fixture, `upgrade-test.sh`, `smoke-test.sh` and the screenshots script onto it | 0028 | 0043 | |
| 56 | OpenID Connect SSO (56a core, 56b group roles and account event log, 56c screens, mock provider, e2e); then JC's manual Authentik check | 0029 | 0044 | |
| 57 | Notifications (57a bell and update notice, 57b birthdays and remembrance days, 57c weekly digest) | 0030 | 0045 | |
| 58 | Photos: tag a person, pick any family photo, non-destructive crop (58a tagging, 58b crop data and per-person avatar, 58c crop dialog) | 0031 | 0046 | |
| 59 | Photo location capture | 0032 | 0047 (amends 0034) | |
| 60 | #263: replace a placeholder parent with a real person | none expected | 0048 (amends 0019) | |
| 61 | `0.4.0-rc.1`: `seed-0.4.0.sh`, version PR, tag, pin PR | | | |
| 62+ | rc fixes, then the final 0.4.0 (website, UPGRADE, `design/` mirror, release PR #284, tag, pin) | | | |

About 35 PRs in all. Steps 51 and 60 do not depend on the auth work.

## Release candidates
One `0.4.0-rc.1` after step 60, once every migration is in; rc.2 and later carry fixes only (the 0.3.0 rule). The final waits for JC's manual Authentik check (including break glass end to end) and a real mail check. SSO and TOTP ship in the same rc. An early rc after step 56 needs JC's explicit exception and is not planned.

## Migrations (each needs the upgrade test from v0.3.0 plus all pins, and a restore test)
0025 drop particle and surname_choice (done; rows too long to fold go to an owner-only leftover table `people_surname_particle_leftover`); 0026 outbox, template overrides, email defaults; 0027 hashed reset tokens; 0028 TOTP secret and recovery codes (in `kinship_auth`, functions only); 0029 `user_identities`, `sessions.auth_method`, `account_events`; 0030 notifications and `users` notification and legend columns; 0031 crop and per-person avatar, tagging function; 0032 photo latitude and longitude. The crop's restore query must work on a schema-24 archive (the restore check runs before newer migrations).

## Decisions (JC, Nov 25 to 26)
**Approved as Claude Code recommended:** 1 GPS visible to the uploader and admins only (not in lists); 3 no link to a Place in 0.4; 5 crop entry points (camera menu, panel, Media viewer; any new profile photo opens the crop with the automatic crop filled in); 6 tagging uses `canEditPerson`; 8 SSO enforcement details (403 `local_sign_in_disabled`, invitation and set-password routes refused while SSO is on, sessions ended at start, "Local only" marker); 9 #227 per (account, IP) pair, a correct password from a quiet IP always gets through, a loose per-account slow-down, check the backup ticket limiter; 10 one live reset or set-password link per account (emailed 1 h, admin 24 h, both send "password changed"); 11 email settings only in env, Admin shows status and "Send test to me"; 12 template editing of subject and text blocks, no raw HTML; 13 "Send by email" ticked when mail is set up, show-once link stays as fallback; 14 one install-wide notification time zone (defaults to `TZ`, else UTC); 15 notification defaults (birthdays in the bell "on the day", email reminders off, remembrance days off, people with no birth year treated as possibly under 18, digest Sunday 18:00 and not sent when empty); 16 a minimal `account_events` table in 0029; 17 drop `users.surname_choice` in 0025; 18 the Admin page is "Storage & email".
**Approved with a change:**
- **2 and 4, GPS:** round to 2 decimals (about 1 km) on the API side before storing, with an "exact place" tick box; the unrounded value is never written unless ticked (test it). Never offered for a photo of a living person under 18 or with no birth year; for other living people a one-line privacy note; a "Remove location" action.
- **7, TOTP: do not hand-write RFC 6238.** Use a maintained library (first pick `otpauth`, MIT; fallback `otplib`); step 55 phase 1 must verify the licence passes the Dependency licenses job, a +/-1 step window that reports which step matched (for the used-step guard), constant-time compare, and the RFC 6238 vectors kept as our own test. `qrcode` (MIT) for the QR picture. 10 argon2-hashed single-use recovery codes; the secret in `kinship_auth` behind functions only (stored unencrypted on purpose so sign-in does not depend on the optional `FILE_ENCRYPTION_KEY`; ADR 0043 says so); forced enrolment after the first local sign-in; its own route and limiter. The code step's per-account cap must BLOCK (a 6-digit code has a million values), unlike the password step's slow-down.
- **19, #263:** the real person already related to the other parent: the children move onto that relationship and the placeholder pair's Unknown relationship is deleted; admins only. Step 60 phase 1 must show the concrete data changes with a Hale worked example before any code.
**Answers during steps 49 to 51:**
- Places do not exist until 0.5, so the Born and Died lines take an optional place that the panel does not pass yet.
- Research link (ADR 0040): deceased people, and living people aged 18 or over with a known birth year; never living under 18, living with no birth year, or placeholders. An uncertain birth date counts the youngest the person could be (a bare year "2008" gives no link until the next year).
- The More menu holds only actions that exist: Copy link to this person (new), Change photo, and Delete person (admins; afterwards stay on the tree centred on your own person, or `/people` with no linked person). Medical history, Add a story, Add an event, Add a source and Merge duplicate join the menu when they ship.
- #271 was the reverse of how the plan worded it: `POST /api/people/:id/parents` must REFUSE a placeholder (404 `person_not_found`), as parent and, decided, as child.
- #156 and #230 closed on CI evidence (no `adoption-ui` failure since #257; journeys 06 and 08 clean since #258 and #241). Journey 09 (`09-my-settings.spec.ts:72,92`) flaked once on Nov 23: watch item, no issue.
- #221 did not reproduce as an overflow at 360 px (one dialog tested); the real defect was the dialog's Close button at 27.5 px, now 36 px, plus three defensive CSS rules. The Restore and photo dialogs were not tested at 360 px.
- #228: a step in `release.yml` swaps `autorelease: pending` to `tagged` after a stable release (added before removed; two matching PRs fail the step). **Untested until the real 0.4.0 tag**: check the Release run log afterwards, and if it fails swap the label by hand and re-run the job (a PR still marked pending blocks release-please).

## Checklist for the release (step 61 and 62)
- UPGRADE.md: the safety copy name quoted for 0025 (`pre-upgrade-0024-to-0025`) changes when later migrations land; the final block needs the real name. TOTP: a pre-0.4 archive brings SuperAdmins back without TOTP, so they enrol again (say so).
- JC's manual checks: Authentik (claims shape, `email_verified`, break glass: SSO on, local refused, `OIDC_ENABLED=false`, restart, password then code); real mail through both providers to Gmail and Outlook; a phone authenticator app and recovery codes; the 0025 queries on his tree and the demo; the crop dialog on a real phone; the person panel's six-button row on a phone, Safari, Firefox and a screen reader (nothing has looked at it in a real browser yet).
- TOTP breaks every script that signs in as a SuperAdmin (upgrade test, `smoke-test.sh`, e2e fixture, screenshots): the biggest CI risk of the release; step 55 starts with the shared helper.
- SSO in e2e needs a second api container and a mock provider inside the existing "End-to-end (Playwright)" job; no new job names.

## Corrections to older docs (nothing has been changed in them; this list wins)
- **Handoff:** its "Open items" list #8, #9, #10, #39, #48 as open; all are closed. #156, #230, #220, #221, #228, #271 are done (above). "Latest migration 0024, next 0025" is now 0025 and 0026; "latest ADR 0039, next 0040" is now 0040 and 0041. The contract migration for the particle is done in step 50. Test counts above.
- **Release plan, v0.4.0 entry:** "Photo location (GPS) capture is proposed, not decided" is stale: decided Nov 23 (capture in 0.4.0, shown in 0.5) with the privacy rules above. "Admin -> System status" should read "Admin -> Storage & email". The entry does not list the contract migration (done), #263, #271, #221 and #228.
- **Requirements doc:** the names bullet still lists an optional surname particle (gone since 0024 and 0025); "GPS is always dropped" (Profile photos) becomes true only for the stored and served file once photo location capture ships; the finder paragraph and the Add relative line are older than steps 43 and 45; the person panel's top (relationship line, born and died lines, icon row, More menu) is not described. ADR 0034 and the storage-encryption doc ("GPS and everything else is dropped") also change with step 59.
- **Email-templates doc:** section 1 still says `/invite/<token>` and "resend"; section 3 leaves open how reset and admin links interact (decided: decision 10); no time zone for the digest or birthdays (decision 14).
- **SSO doc:** says role changes are written to "the change history", which does not exist; decision 16 adds `account_events` in 0029.
- **Mockup:** still shows "Authentik (OIDC)" in Sign-in & SSO, the Users Sign-in column and the reset email; its panel More menu has five items that belong to later releases and "Medical visible/restricted" pills; its Research link shows for children (ADR 0040 overrides it); it disables Edit with a tooltip-only reason; its age ignores date precision; it has no crop, tagging or location prompt.
- **Website:** the Features "Email and sign-in 0.4" card has no crop, tagging or photo location; update it in the release PR.
- **Build history:** still stops at step 42.
