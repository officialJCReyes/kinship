# Upgrading KinShip

Notes for upgrading from one release to the next, newest first. Read the section for the version you are moving to. The release process requires a section here for any release with a breaking change.

## Unreleased (will become 0.4.0)

### Database: migration 0026 adds the email outbox (nothing to do)

Migration 0026 adds two empty tables, `mail_outbox` and `mail_template_overrides`. No existing data changes, and nothing changes for you until you set up email (all of it optional; see "Email" in `.env.example`; INSTALL.md gets a full section later in 0.4.0). Without email settings KinShip works exactly as before. A backup carries the template text an admin changed, but never queued email (the outbox rows are left out on purpose: a queued email can hold a one-time link).

### Database: migration 0025 removes the surname particle and the old surname choice

Migration 0025 drops two columns that nothing has read since 0.3.0: `people.surname_particle` (0.3.0's migration 0024 folded every particle into the surname, "de" + "la Cruz" became "de la Cruz") and `users.surname_choice` (replaced by the name form in 0.3.0). Names, search and settings look the same as before. It is quick for a family tree; the search text is rebuilt in place.

**Only if a name was too long to fold.** A particle, a space and the surname together may hold at most 100 characters. 0024 left any person over that limit as it was and named them in its log. 0025 folds any particle that fits, then copies what is still left (the person's id, the particle and the surname) into a table of its own, `people_surname_particle_leftover`, before it drops the column, and names those people's ids (never their names) in the api log. Nothing is cut short or lost. Only the database owner can read that table; the app never does.

Before you upgrade, you can see whether this concerns you (the `kinship` owner is the database superuser, so row-level security does not hide rows from it):

```
docker compose logs api | grep '0024:'
docker compose exec db psql -U kinship -d kinship -c "SELECT id, surname_particle, surname FROM people WHERE surname_particle IS NOT NULL;"
```

After the upgrade:

```
docker compose logs api | grep '0025:'
docker compose exec db psql -U kinship -d kinship -c "SELECT * FROM people_surname_particle_leftover;"
```

An empty result means nothing was kept aside. For each row that is there, open that person in KinShip (Edit details), type a surname of at most 100 characters that includes the particle, save, and then remove the row:

```
docker compose exec db psql -U kinship -d kinship -c "DELETE FROM people_surname_particle_leftover WHERE person_id = '<id>';"
```

The empty table stays and does no harm. To go back to 0.3.0, restore the safety copy the first start of 0.4.0 makes (`pre-upgrade-0024-to-0026.tar.enc` from 0.3.0); it still holds both columns.

## 0.3.0

**0.3.0 changes the database and some settings. Back up first** (Admin → Backups), then find your starting version below.

### Which upgrade are you making?

| You run | What to do |
|---|---|
| **0.2.1** (schema 16) | Do the photo steps in the next section first, then change `KINSHIP_VERSION` and run `docker compose pull && docker compose up -d`. The first start writes `data/backups/pre-upgrade-0016-to-0024.tar.enc` and applies migrations 0017 to 0024. |
| **0.3.0-rc.1 or rc.2** (schema 23) | An image update. The first start writes `pre-upgrade-0023-to-0024.tar.enc` and applies 0024. Read "If you are on a release candidate" below. |
| **0.3.0-rc.3 or rc.4** (schema 24) | An image update only. There is no database change and no safety copy. |

The safety copy holds the database only, not the photos (there are none before 0.3.0); your own backups and the copy a restore makes carry the photos.

### From 0.2.1: photos need a key and a folder

Photos (profile pictures and a photo gallery per person) are stored encrypted on disk, and they stay **off** until both of these are in place. KinShip starts and works without them; Admin → Backups says what is missing. Your backups folder and `BACKUP_PASSPHRASE` from 0.2 stay as they are.

1. **Make a key and put it in `.env`:** `openssl rand -base64 32`, then add `FILE_ENCRYPTION_KEY=<that value>` (or `FILE_ENCRYPTION_KEY_FILE=/run/secrets/...` for a Docker secret). 64 hex characters also work; anything else is refused and the api does not start.
2. **Store the key in a password manager, apart from this server. A lost or changed key means the stored photos can never be opened again**, and nobody can recover them. Backups do not contain the key (a backup holds the photos encrypted with it).
3. **Create the folder:** `mkdir -p data/files && sudo chown 1000:1000 data/files` (Docker Desktop on macOS and Windows does not need the `chown`).
4. **Add the bind mount to your `compose.yml`**, under `api:` → `volumes:` next to the backups one: `- ./data/files:/var/lib/kinship/files`. The repository's `compose.yml` has it; an existing copy of yours does not.

There is no setting to turn file encryption off. If the key in `.env` is not the one your stored photos were encrypted with, KinShip still starts, refuses new uploads and says "does not match your files" in Admin.

Two more things to check:

- **A reverse proxy in front of KinShip must allow request bodies of 12 MB**, or photo uploads fail with 413 (INSTALL.md, "Behind a reverse proxy"). KinShip's own web container already does.
- **The api needs a restart policy** for the new Restore button: the repository's `compose.yml` has `restart: unless-stopped`; a custom compose file or `docker run` needs one too, or the api stays stopped after a restore.

### What changes for people

- **Married women's names now show as "Maiden name (Married name)"**, for example "Rosa Mendez (Hale)". Migration 0017 moves existing accounts: one that showed married surnames (the old default) now uses "Maiden name (Married name)", one that had chosen birth names now uses "Maiden name". KinShip cannot tell a deliberate "married" choice from the default, so check **My settings → Names** if you had picked it on purpose. There are four forms: Maiden name (Married name), Married name (born Maiden name), Married name, and Maiden name. If a married surname starts with the birth name, the birth name is not repeated in the brackets.
- **Three new optional name fields** on each person: a prefix and a suffix, both picked from a list (Dr., Mrs., Jr., III and others, with "Other…" for anything else), and a nickname. They are in Add relative and Edit details, on the profile under Facts, and searchable. Prefix and suffix show on the tree and profile for every account; turn them off in My settings → Names. A nickname is never part of the shown name. Nothing is filled in for existing people, and the setup wizard asks for none of them. A particle such as de or van is typed as part of the surname ("de la Cruz").
- **Charts hide aunts, uncles and cousins by default** (migration 0018), for every account. The Family tree now draws the person, the ancestors, brothers and sisters (and half-siblings), their partners and children. Turn the others back on in the chart's **gear** (Chart settings) → **Show aunts, uncles and cousins**.
- **The gear panel** in the tree's top bar also has the † mark after the name of someone who has died, the name settings, the mouse wheel (zoom or scroll) and which chart opens first. The other defaults are the old behaviour.
- **Pedigree, Fan and Descendants** charts sit next to the Family tree, and **a relationship finder** (Family tree → Relationship finder) shows how two people are related and draws the path. Both only read the tree.
- **Admins can change an account's role, disable an account and delete a disabled account** (Admin → Users, the Actions button on each row; migration 0019). A SuperAdmin sets Family Admin, Member or User on any other account; a Family Admin switches Members and Users. Nobody changes their own account, nobody can be made SuperAdmin from the screen, and the last SuperAdmin can never be demoted, disabled or deleted. A disabled account cannot sign in (the page says "wrong password", as for any wrong password), and its open set-password link is revoked. **Enabling it again brings its old password back.** Deleting needs the account disabled and its email typed; the person on the tree stays.
- **A Restore button in Admin → Backups** (SuperAdmin only). KinShip checks the backup, makes a safety copy, pauses the site for a few seconds, replaces everything and restarts. Everyone is signed out afterwards, and **accounts deleted or disabled since the backup come back active, with the passwords they had then**. A backup that carries photos puts them back (the same `FILE_ENCRYPTION_KEY` is required); a backup without photos leaves the photos folder as it is and removes photos added since after 7 days. `kinship restore` on the command line does the same and is still the way onto a new server.
- **A calendar beside every typed date** and a **"Week starts on"** setting (My settings → Display; Sunday for every account; migration 0020). Typing a date works as before.
- **Photos**, once the key and the folder are in place: each profile has a **Photos** card (JPEG, PNG or WebP, at most 10 MB, with the date taken), and any photo of a person can be their **profile photo**, shown as a round avatar wherever the person appears. The camera on a person's picture uploads a new one, chooses an existing one or removes it. The **Media** page shows every photo of the family. Admins, and Members for the people they may change, add photos; everyone with an account sees them. Pictures are re-encoded on upload, which drops the location and camera details.
- **Backups get bigger and slower once you add photos** ("Include uploaded files" is on by default), and so does the free space a backup, a test and a restore need.
- **Children already on the tree can get their second parent.** When an admin adds a partner or a second parent, Add relative asks which of the children who hang from one parent alone are the new person's too; a profile can also link a partner's child to both parents ("Also {name}'s child"). Nothing changes until you use it.
- Admins see a "What's new" popup once after the update.

### If you are on a release candidate

- **From rc.1 or rc.2,** migration 0024 folds the separate surname particle into the surname ("de la Cruz", not doubled when the surname already starts with it) and empties the field. Names show as before, but initials use the particle's letter (RD) and lists sort by the surname as written. A particle and surname over 100 characters together are left as they were and named in the api log (`database notice: 0024: ...`); edit those by hand. Restoring an rc.1 or rc.2 backup folds it the same way. Going back to the release candidate is a restore of `pre-upgrade-0023-to-0024.tar.enc` with the rc image.
- A prefix or suffix stored before the lists existed (for example "Pastor") opens as "Other…" with its text and is kept exactly as typed.
- **From rc.3 or rc.4** nothing else changes.

### Things to know

- **Going back to 0.2.1 is a restore** of `pre-upgrade-0016-to-0024.tar.enc` with the 0.2.1 image; there are no down-migrations.
- Migration 0017 rewrites the search text (`people.search_names`) in place; it is quick for a family tree. Migration 0023 drops the old `people.search_name` column, which nothing has read since 0.2.0. `users.surname_choice` and `people.surname_particle` stay, unused and empty, until a later release removes them.

### API changes

For people who built on the API (it is not a public interface before 1.0):

- **Names (0017):** `surnameChoice` is gone from `PATCH /api/auth/me`, sign-in, `GET /api/auth/me` and the setup `settings`; it is replaced by `nameForm` (`maiden_married`, `married_born`, `married` or `maiden`), `showPrefix` and `showSuffix`. A request that sends `surnameChoice` or `surnameParticle` is refused with `invalid_request`. People gain `namePrefix`, `nameSuffix` and `nickname`. New errors: `invalid_name_form`, `invalid_show_prefix`, `invalid_show_suffix`, `invalid_name_prefix`, `invalid_name_suffix`, `invalid_nickname`; `invalid_surname_choice` is gone.
- **Chart settings (0018):** the account gains `treeWheel`, `treeDefaultView`, `showExtendedRelatives` and `showDeceasedMark` (with `invalid_…` errors for each); `GET /api/tree/:id` accepts `collateral=siblings`.
- **Accounts (0019):** `users.disabled_at`, and two triggers that refuse to demote, disable or delete the last active SuperAdmin whoever runs the SQL (`ALTER TABLE users DISABLE TRIGGER users_keep_a_superadmin_update`, and `..._delete`, if you must edit by hand). Admin routes `PATCH /api/admin/accounts/:id/role`, `POST …/disable`, `…/enable`, `GET …/delete-preview`, `POST …/delete` (`{confirmEmail}`). New errors: `self_not_allowed`, `last_superadmin`, `account_role_changed`, `account_disabled`, `account_not_disabled`, `confirmation_mismatch`.
- **Restore and week start (0020):** `weekStart` on the account (`invalid_week_start`); SuperAdmin routes `POST /api/admin/backups/restore-check` and `/restore`; public `GET /api/maintenance`; while a restore runs every other route answers `503 {"error":"maintenance"}`. New errors: `restore_busy`, `restore_failed`, `restore_ticket_invalid`, `invalid_restore_word`, `maintenance`.
- **Photos (0021, 0022):** tables `media_files` and `media_people` and `people.photo_media_id`; the bytes are encrypted files in `data/files`. Routes `GET /api/media`, `GET` and `POST /api/people/:id/photos`, `DELETE /api/people/:id/photos/:mediaId`, `PATCH` and `DELETE /api/media/:id`, `GET /api/media/:id/avatar` and `/full`. People, the tree, the list and `GET /api/relationship` gain `photoMediaId`, which `PATCH /api/people/:id` accepts. Deleting a person also deletes the photos that show only them. New errors: `files_unavailable` (503, with a `reason`), `photo_not_found`, `unsupported_image`, `invalid_image`, `image_too_large`, `image_too_many_pixels`, `photo_not_linked`.
- **Linking children (ADR 0039, admins only):** `POST /api/people/:id/partners` adds a partner, the relationship and their shared children in one call; `POST /api/people/:id/parents` also takes `parent` and `linkChildren`; `GET /api/people/:id/linkable-children` and `POST /api/unions/:id/children` are new. Existing calls behave as before.

## 0.2.0

**0.2 starts the data promise:** from here an upgrade keeps your data, and a safety copy of the database is made before each database change. Find your starting version below.

### Which upgrade are you making?

| You run | What to do |
|---|---|
| **0.1.0-alpha.2** (schema 6) | Do the three steps in the next section. The first start writes `data/backups/pre-upgrade-0006-to-0016.tar.enc` and applies migrations 0007 to 0016. |
| **0.2.0-rc.1 or rc.2** (schema 14) | An image update: change `KINSHIP_VERSION`, `docker compose pull && docker compose up -d`. The first start writes `pre-upgrade-0014-to-0016.tar.enc` and applies 0015 and 0016. Your backups folder and passphrase are already set. |
| **0.2.0-rc.3** (schema 16) | An image update only. There is no database change and no safety copy. (The update notice shows its backup warning for every earlier version, because 0.2.0 as a whole changes the database; for rc.3 it is only cautious.) |
| **0.1.0-alpha.1** | Update to `0.1.0-alpha.2` first, start it once, then continue as above, or start fresh. The jump from alpha.1 (migrations 0003 to 0016 at once) is not tested. |

### From alpha.2: do these first

1. **Add the backups folder to your `compose.yml`.** Copy the new `compose.yml` from the release, which has it, or give the `api` service
   ```yaml
       volumes:
         - ./data/backups:/var/lib/kinship/backups
   ```
   and create the folder: `mkdir -p data/backups && sudo chown 1000:1000 data/backups` (Docker Desktop on macOS and Windows does not need the `chown`). Without it the api will not start the upgrade, and it prints exactly these lines.
2. **Set `BACKUP_PASSPHRASE` in `.env`** (at least 16 characters; `openssl rand -hex 32` is good), as in the new `env.example`, and **keep a copy somewhere other than the server**. It encrypts every backup and the safety copy.
3. **Back up first anyway** (INSTALL.md, "Back up and restore"): the safety copy sits on the same disk. Then change `KINSHIP_VERSION` to `0.2.0` and run `docker compose pull && docker compose up -d`.

The safety copy can take minutes on a big database (the compose health check allows 10 minutes). If it cannot be made, the upgrade stops and your data is untouched; as a last resort start once with `KINSHIP_SAFETY_COPY=skip` (INSTALL.md, "Something wrong?"). With no passphrase the copy is a plain `.sql.gz` and the api warns. The newest three are kept. **Going back is a restore of a backup; there are no down-migrations.** A database owner role that is neither a superuser nor `BYPASSRLS` cannot make the copy: the upgrade goes on, says so in the log and the upgrade log, and backups need `BYPASSRLS` on that role (INSTALL.md).

### What changes for people

- Every **Married** relationship where either partner is already marked deceased becomes **Widowed**, marked as set automatically (migration 0007). Other statuses do not change. From then on KinShip does it itself: marking someone deceased makes their Married relationships Widowed, marking them living again reverts only the automatic ones (and only if the other partner is not deceased), and saving a status by hand, even the same one, makes it permanent.
- Dates read "Jan 1, 2026" until each person changes it in **My settings**. The top bar's "My profile" and "About" moved into the account menu (click your name), which also has My settings, Admin (for admins) and Sign out.
- Admins see a "What's new" popup once after the update.
- **Accounts made by an alpha may be linked to nobody.** In **Admin → Users** an admin can **link** such an account to a person, change the link or unlink it. Linking makes the account that person on the tree (Home, My profile and the tree open on them) and, for a Member, lets it edit that person and the people it added below them. The dialog says what changes before you save. A SuperAdmin links any account; a Family Admin links Members, Users and their own. A person with an open invitation cannot be linked until the invitation is revoked. No account is linked or unlinked by the upgrade.
- **Unknown parents.** Adding a brother or sister to someone with no parents adds an "Unknown father" and "Unknown mother" (real rows, so backups hold them; no name, no dates; left out of the people list, search and counts). Migration 0015 adds `people.is_placeholder`, false for everyone who exists.
- Custom relationship labels are added by admins only and never change the tree or who is next of kin.
- **Invitations and passwords.** **Admin → Users → Invite user** makes a link you copy and send yourself (KinShip sends no email); it works once, lasts 7 days and is shown only when made (close the window and you make a new one, which cancels the old). A SuperAdmin invites Family Admins, Members and Users; a Family Admin invites Members and Users. An invitation can name an existing person who has no account; a Member with no linked person can only read. A 24-hour **set-password link** helps someone locked out (a Family Admin for Members and Users, a SuperAdmin for anyone but themselves); using it signs the account out everywhere, and the account shows when and how its password last changed, including "using a link from an admin". A locked-out SuperAdmin still uses `kinship set-password` on the server. **Change password** is under My settings → Account and signs out your other devices. Existing accounts keep working unchanged.

### Things to know

- **Admin → Updates** (SuperAdmin) has three switches: **Check for new versions** (on), **Include pre-releases** (off) and **Safety copy before a database change** (on). The check is a daily read of GitHub's public release list and sends nothing about your install. **There is no environment variable for it**; on a server with no internet access use the switch. Behind a proxy, set `HTTPS_PROXY` (and `NO_PROXY`) in `.env`.
- **The web and the api must be the same version.** The api answers 503 `version_mismatch` while they differ, and the web shows a page saying which is which. `KINSHIP_VERSION` changes both. A reverse proxy needs no change.
- **Admin → Backups** (SuperAdmin): status, Back up now, Test the latest backup, a download that asks for your password again, and the schedule (03:00 UTC every day by default; 7 daily, 4 weekly and 6 monthly kept). With no usable passphrase the schedule stays off and the page says so. **Restoring is a command on the server** (`docker compose run --rm api kinship restore <file>`, with `web` and `api` stopped); there is no restore button yet.
- The release page's settings file is called **`env.example`** (GitHub drops a leading dot). The api image carries `CHANGELOG.md` and `UPGRADE.md` for the What's new popup, and the PostgreSQL 18 client tools (about 9 MB larger).
- **Email addresses are unique ignoring case.** Accounts already store them in lower case, so no change is expected; if a database edited by hand has two that differ only in case, migration 0011 stops with a message that says how many and changes nothing.
- **Reverse proxies:** the web container serves `/theme-init.js` (must not be blocked; the bundled nginx makes browsers recheck it on every load) and invitation and set-password links are `/invite#…` and `/reset#…`. The fragment never reaches a server or a log.
- The old `people.search_name` column stays until a later release.

### API changes

For people who built on the API (it is not a public interface before 1.0): list cursors from before the upgrade are refused with `invalid_cursor`; `GET /api/people/:id` gains `labels`, `partnerChildren`, `secondSurname`, `marriedSurname`, `statusAuto` and `isPlaceholder`; `GET /api/auth/me`, sign-in and setup return the display settings and `passwordChangedAt` and `passwordChangedVia`; `POST /api/setup` takes an optional `family` and its errors carry a `field`. New routes: invitations, accounts and links ([ADR 0012](docs/decisions/0012-account-links.md)), `POST /api/setup/check` ([ADR 0013](docs/decisions/0013-setup-wizard.md)), updates and What's new ([ADR 0015](docs/decisions/0015-update-check-and-whats-new.md)), linking an account to a person ([ADR 0020](docs/decisions/0020-link-account-to-person.md)), siblings with unknown parents ([ADR 0019](docs/decisions/0019-placeholder-parents.md)), backups ([ADR 0014](docs/decisions/0014-backup-and-owner-access.md)).

## 0.1.0-alpha.2

**This is an alpha: there is no upgrade promise, and data may be wiped between 0.1.x releases. Do not keep real family data in it.** The data promise starts with 0.2.

- **From 0.1.0-alpha.1 you can usually just update** (this was tried: an alpha.1 install with a SuperAdmin account moved to alpha.2 in place). Change `KINSHIP_VERSION` in `.env` to `0.1.0-alpha.2`, then `docker compose pull && docker compose up -d`. The database changes (migrations 0003 to 0006) are applied at startup and your SuperAdmin account keeps working. That account is **not linked to a person** (a fresh install can link it during setup; 0.1 has no screen to link one later): open **Family tree** and choose who to start from, or add people on the People page.
- **If anything looks wrong, start fresh.** Take a dump first if you want one (the backup command in [INSTALL.md](INSTALL.md)), then `docker compose down --volumes` and install again. Going back to alpha.1 after the database has been upgraded needs a restore of a dump taken before; there are no down-migrations.
- **Breaking changes (internal, for people who built on the API).** The people and tree API changed shape during the alpha: `GET /api/people/:id` returns `parents: {birth, adoptive}` and children as `{id, kind, link, adopted}`; a parent link carries `kind` and `link`; the tree response carries `lineage` and, for a person with a second family, `otherFamily`; `AuthUser` carries `lineageView`. The API is not a public interface in 0.1.
