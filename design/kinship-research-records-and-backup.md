# KinShip research records, duplicate merge and backups (Nov 14, 2026)

Asked by JC after a feature comparison with Gramps, MyHeritage and AncestryDNA. JC picked: **Sources and Places libraries, more event types, stories and notes, backup/restore, duplicate merge**, and **a cause of death on deaths, with source citations and file upload on birth, death and any other fact, like MyHeritage**. All of it is built in the mockup. Companion to `kinship-v2-requirements.md` and `kinship-navigation.md`. The doctor-visit report that followed is in `kinship-family-health-history-report.md`.

**Decided by JC, Nov 15:** **Members can add sources** (to the library and as citations and files on any person's facts, not only their own). **The merge undo window is 30 days.**

Not picked from the comparison (left for later): suggest-a-change approval flow, tree-wide change history and undo, people list and search, stronger data check rules, two-factor login, calendar feed, Gramps XML import, DNA shared matches and cM lookup. Deliberately skipped: record and tree matching against outside databases, AI photo tools, ethnicity calculation.

## Sources and files on any fact
- **Edit details** now has a collapsible **Sources & files** panel under **Birth**, **Death** and **Cause of death**, each with a count. The panel lists what is attached, then lets you pick a source from the library or name a new one, add a page or record number, choose a reliability, add a link and attach a scan, photo or PDF.
- The profile **Facts** tab shows each fact with its numbered citations and file chips, plus a **+ Source or file** button for admins, for the person's own account, and **for every Member** on any person (Members still cannot change the fact itself). Users cannot. The same panel opens on its own for one fact.
- Files are encrypted like all other files (`kinship-storage-encryption.md`). Sources and files on a fact are visible to every account.
- **Reliability** (replaces a numeric confidence): **Primary** (an original record made at the time), **Secondary** (a copy, index or later account), **Questionable**.
- Citations number to match the source list on the profile.

## Cause of death
Free text with suggestions (heart disease, cardiac arrest, stroke, cancer, pneumonia, diabetes complications, accident, natural causes, unknown). It sits under the death date and place, with its own Sources & files panel, and shows on Facts as "Cause of death". **Visible to every account**, like the rest of a deceased person's record. It is a separate field from the medical record, which can still list the condition. The family health history report reads it.

## More event types
The profile **Events** tab has an **Add event** button. Types: Occupation, Residence, Education, Military service, Immigration, Emigration, Naturalization, Baptism, Burial, Census, Award, Religion, and **Other with your own label**. Each event has a date (same flexible entry), a place picked from the Places library (a new name is added to it), details, and Sources & files. Birth, death, marriage, divorce and separation stay on the person and the relationship. Events show on the timeline, with a type tag.

## Sources library (Archive → Sources)
- A table of every source: title, type, author or publisher, number of citations, files. Search and a type filter. Click a row for the detail panel: type, author, repository, date, link, files, reliability, **citations** (each use, with the page or record number) and the people it supports. Buttons for edit and merge (mock).
- **Repositories** tab: where a source is kept (archive, government office, website, private collection).
- **Add source:** title, type, reliability, author, date, repository (or a new one), link, scan. Opened from a person it can also attach straight to their birth, death or cause of death.
- Types: vital record, marriage record, census, military record, passenger list, newspaper, obituary, letter, book, website, interview, other.
- Admins and Members can add; Users cannot.

## Places library (Archive → Places)
- One record per place: name, kind (city, township, borough, county, state, country, military base, cemetery, church, hospital, address), **part of** (for example Yonkers › Westchester County › New York › United States), coordinates (optional), other and historical names, a note, counts of events and people. Search matches other names too.
- **Duplicates:** an imported spelling like "Yonkers, New York" is flagged "Possible duplicate" with a **Merge into Yonkers, NY** button (admins). Merging moves its events and keeps the name as another name.
- **Add place** (admins and Members). Show on the map jumps to Timeline & map. Map pins are only drawn for places with coordinates.

## Stories and notes (Archive → Stories, and a Stories tab on each profile)
- Kinds: **Story, Note, Recording, Research note**. Each has a title, text, people it is about, an optional photo or audio file, an author and a date.
- Visible to every account, except **admins only**, which hides a note from everyone else (meant for research to-dos).
- Admins and Members can write; Users can read. Filters by kind and person on the Stories page.

## Duplicate merge (Admin → Duplicates; Home → Needs attention)
- A list of suspected duplicates with a match percentage and the reasons (same surname, birth year and month, same parents, nickname of the same name, birth place spelled differently). Fixed rules, no AI. **Nothing merges automatically**, including right after a GEDCOM import.
- Side by side comparison. Pick the value to keep for each field (name, birth date, birth place, death, gender); the first record stays on the tree. A summary lists what moves: sources, photos, relationships (combined, duplicates dropped), stories, events, files and DNA results.
- **Medical records are never merged**; if both people have one, an admin chooses which to keep.
- A required "I checked that these are the same person" box. A pair where one record is living and the other has a death date is **blocked** until fixed. Actions: Merge people, Not the same person (never suggested again), Decide later.
- **Every merge is logged and can be undone for 30 days (decided).**

## Backup and restore (Admin → Backups, SuperAdmin only; Deployment page card)
- **What a backup is:** one encrypted archive holding a Postgres dump (every table, medical records included) and the media files (which stay encrypted with the file key). Named like `kinship-2026-11-14-0300.tar.enc`.
- **Variables:** `BACKUP_ENABLED=on`, `BACKUP_DEST=local` (or `s3`, a separate bucket), `BACKUP_PASSPHRASE` (secret, `.env` or `BACKUP_PASSPHRASE_FILE`). The schedule runs inside the api container, so there is still no extra service. `compose.yml` mounts `./data/backups:/var/lib/kinship/backups`.
- **Editable in Admin (not secret):** schedule (every day, every week or off), time, how many daily, weekly and monthly backups to keep, destination, whether to include files, and whether to test each backup after it is made.
- **Page:** latest backup card with **Back up now** and **Test the latest backup** (restores into a temporary database, counts people, sources and files, throws it away); a table of backups with Download and Restore; the command line steps.
- **Restore (built in 0.3.0 step 36; the app's dialog also asks for the SuperAdmin's password, and replaces files only after media upload ships in step 37):** a dialog that says it replaces everything, lists the steps (safety backup first, maintenance mode, replace database and files, run migrations if the backup is older, check and reopen) and needs the word **RESTORE** typed. Command line: `docker compose exec api kinship backup` and `docker compose run --rm api kinship restore <file>`, which is also how to move to a new server with the old `.env`.
- **Important:** the backup does **not** contain `FILE_ENCRYPTION_KEY` or `BACKUP_PASSPHRASE`. Without the first, restored files cannot be opened; without the second, the archive cannot be opened. Store both in a password manager away from the server. Both the Admin page and the Deployment page say so.
- Family Admins see that the page is SuperAdmin only.

## Open
- Editing and deleting an event, source or place is not mocked up (the buttons say mockup only).
- Whether a source can be shared by several citations with different page numbers per person (the mockup keeps one default detail per source and one per attachment).
- Whether Members adding places should also need approval (only sources were decided).
