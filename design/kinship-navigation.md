# KinShip navigation (Nov 14, 2026; updated Nov 15)

Supersedes the "Navigation" section of `kinship-v2-requirements.md`.

## Decided by JC: five header tabs for admins, four for everyone else
| Header tab | Sub tabs | Notes |
|---|---|---|
| Home | none | Memory of the day and the other cards (all kept, see below) |
| Family tree | Chart, Relationship finder | Chart has a collapsed view switcher: Family tree, Pedigree, Fan, Descendants |
| Media | none | Own tab because it can get lost inside a group and is not obvious to look for there (JC) |
| Archive | Timeline & map, **Sources, Places, Stories**, Reports | Sources, Places and Stories added Nov 14 (see `kinship-research-records-and-backup.md`); Reports includes the Family group sheet |
| Health and DNA | Medical, DNA | **Admins only.** An overview of everyone's health and DNA data in one place. Health shows only what each person shared with the admin; DNA is visible to all |

- **Health and DNA live on each person's profile (JC).** Profile tabs: Facts, Events, **Stories**, Photos & documents, **Medical history**, **DNA**. Members and Users open a person's profile to see (and, for their own, edit) health and DNA. Health follows per-person sharing; DNA is open to every account. The admin overview pages show the same content with a person list and an "Open in profile" button.
- **Facts tab:** Born, Died and **Cause of death** (deceased only) each show their citations, file chips and a **+ Source or file** button. **Events tab:** typed life events with an **Add event** button.
- A Member or User who lands on the overview URL is sent to their own profile tab instead.
- Profile pages for people with no record say so ("No DNA results have been added for X") and offer "Add DNA results" to admins and to the person themselves.
- A sub tab bar sits under the header on grouped pages. Clicking a header tab reopens the sub tab you used last in that group.
- Page content is centered in the window (all pages except the tree chart, which fills it).
- **Account menu:** My profile, My settings, Import & export, Admin (admins only), Deployment, **About KinShip**, Sign out. Home's "Jump to" has "My health and DNA" and "Health history for my doctor".
- The person panel stays on the left of the tree chart and collapses to a rail.
- **Add relative (redesigned Nov 14 from JC's MyHeritage screenshots):** the button opens a dimmed full-screen view with the person's card in the middle and "Add ..." cards around them, joined by lines: **above** father and mother (only the ones missing; hidden when both parents are on the tree), **left** brother and sister, **right** partner ("Add another partner" when they already have one, with the hint "Husband, ex-husband, partner, ..."), **below** son and daughter. Blue border for male, coral for female, grey silhouettes; a Close button at the top right. Clicking a card opens the form with the relationship and gender filled in, plus a Back button (relationship status, other parent for a child, custom label, given and surname, married surname, birth date, status, gender). Admins also get a link for **Other relationship** (godparent, guardian, step, custom label). **Members only have the son and daughter cards enabled** (descendants only, decided Nov 14); the rest are dimmed with a note to ask an admin.
- **Chart view switcher (decided by JC, built Nov 14):** one icon button at the top right of the chart shows the current view. Clicking it opens a small panel of icons only, no words: Family tree, Pedigree, Fan and Descendants, then (for every view except Family tree) the generations choice as plain numbers (3, 4, 5; 2 to 5 for Descendants). Each icon has a tooltip and an accessible label with its name. Choosing a view closes the panel; choosing a generation count keeps it open; clicking anywhere else closes it.
- **A spouse's family:** a small logo-green leaf on an in-law's card flips the chart to that family; no back button (see `kinship-tree-views-and-dna.md`).

## Admin tabs
Users, Roles & access, Sign-in & SSO, Storage & email, **Backups** (SuperAdmin), **Updates** (SuperAdmin, added Nov 15), **Duplicates**, Emails, Languages. Home → Needs attention shows "N possible duplicate people" with a Review button for admins.

## Admin → Updates (added Nov 15, decided by JC; plan in `kinship-release-and-deployment-plan.md`, section 7)
SuperAdmin only. Family Admins see a note that only a SuperAdmin manages update checks.
- **Version card:** running version (web and api), database schema number, time of the last check, result ("Up to date", "0.6.0 available" or "Checking is off"), **Check now**, and **What's changing** when an update exists. A line says KinShip never updates itself.
- **Settings card (three switches, stored in the app, no environment variable):** **Check for new versions** (default on; once a day KinShip reads GitHub's public release list and sends nothing about the install), **Include pre-releases** (off) and **Safety copy before a database change** (on; keeps the last 3 dumps; extra protection, not a replacement for a full backup).
- **Banner:** when a newer version exists a banner heads every Admin page (SuperAdmin only) with "KinShip 0.6.0 is available. You are on 0.5.0." plus "Includes a database change. Back up first." or "Includes breaking changes. Back up first." where it applies, a red **Security update** label, and the buttons **What's changing** and **Dismiss** (hides it for that version). The same item appears in the SuperAdmin's bell.
- **What's changing popup:** version range and number of releases; an amber **"Back up before you update"** box when any release has a database change or breaking change (shows the age of the last backup, red when older than 24 hours, a **Back up now** button, and a note about the safety copy); one block per release with date, labels and lists grouped Security, Breaking changes, New, Improved, Fixed, and amber upgrade notes; **How to update** (change both image tags, `docker compose pull && docker compose up -d`, with Copy). The steps stay hidden until a backup from the last 24 hours exists or the SuperAdmin ticks "I have a backup I can restore". Buttons **Remind me later** and **Close**.
- **What's new popup (every admin, at the first sign-in after an update):** "KinShip was updated to 0.6.0" with the changes since the version they last saw, a note when the database was migrated (schema numbers and the safety copy name), and an amber "Check this now" box for breaking-change instructions. Buttons **Got it** and **View full release notes**. Read from the changelog bundled in the image, so it works offline.
- **Preview panel (mockup only):** a switch for "up to date / small fixes / database change / security, breaking and database change", a switch for the age of the last backup, and a button to show the What's new popup.

## About KinShip (added Nov 15)
Account menu → About KinShip: logo, version, database schema, build, license (AGPL-3.0-or-later), a **Source code** link to `github.com/officialJCReyes/kinship`, the sentence that anyone running a modified copy for others must offer them its source, and a **What's new** button. Required by the AGPL decision; also shown on the login screen footer in the real app.

## First-run setup
The last step (Review) has a short note that KinShip checks for new versions once a day by reading GitHub's public release list, sends nothing about the install and can be turned off in Admin → Updates.

## DNA badge on the tree (decided by JC)
Orange badge on the avatar of everyone who has uploaded DNA, shown to every role. DNA is now visible to every account, so the badge matches what the DNA tab shows. Details in `kinship-tree-views-and-dna.md`.

## Deployment page
Shows the request flow diagram, how medical privacy works, what you run, a **File encryption key** card, a **Map tiles** card (OpenStreetMap default with no key; MapTiler with `MAP_PROVIDER=maptiler` and `MAPTILER_API_KEY`), a **Backups** card (`BACKUP_ENABLED`, `BACKUP_DEST`, `BACKUP_PASSPHRASE`, and the warning to keep the passphrase and the file key outside the backup), the `compose.yml` starting point (now with the backup variables and a `./data/backups` volume) and the open decisions. Admin → System also has a Map tiles card with a preview switch between the two setups. (The mockup's Deployment page does not yet show the GitHub image names; the real compose example uses `ghcr.io/officialjcreyes/kinship-web` and `kinship-api`.)

## Admin → Storage & email: file encryption
The File storage card shows `FILE_ENCRYPTION` (on by default), `FILE_ENCRYPTION_KEY` (hidden) and, for S3, the optional `S3_SSE`. KinShip encrypts every file itself before upload (confirmed by JC, who named security a top priority for self-hosting). Details and consequences in `kinship-storage-encryption.md`.

## Home
**JC decided to keep all cards.**
- **Memory of the day (JC: "a nice feature"):** card at the top with picture, title, year and "N years ago", caption, chips for the people involved, "Open in Media" and "Show another". Picks something tied to today's date (birth, wedding, anniversary) when there is one, otherwise a photo or document from the archive. Only items every account can see are chosen; photos of children are skipped.
- Coming up (birthdays), Recent activity, The family at a glance, Needs attention (admins; includes possible duplicates), Jump to.

## DNA with several providers (mockup)
Each person's record holds a list of tests; Marcus has AncestryDNA and 23andMe. Each test keeps its own ethnicity estimate (side by side, never blended), raw file and match list. The Matches tab merges the lists: one row per relative with each company's cM and label, a "Seen at both" or "Only at <company>" tag, and a tree check that flags the row if any company's figure is outside the typical range. Haplogroups stay per person.
