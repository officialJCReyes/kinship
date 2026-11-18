# Upgrading KinShip

Notes for upgrading from one release to the next, newest first. Read the section for the version you are moving to. The release process requires a section here for any release with a breaking change.

## 0.2.0

**0.2 starts the data promise:** from here an upgrade keeps your data, and a safety copy of the database is made before each database change. The notes below are in the order the changes were made, newest first; the parts that need you to act are at the top.

### Upgrading from 0.1.0-alpha.2 (or earlier): do these two things first

1. **Add the backups folder to your `compose.yml`** (copy the new `compose.yml` from the release, which has it) and create the folder: `mkdir -p data/backups && sudo chown 1000:1000 data/backups` (Docker Desktop on macOS and Windows does not need the `chown`). Without it the api will not start the upgrade, and prints exactly these lines.
2. **Set `BACKUP_PASSPHRASE` in `.env`** (at least 16 characters; `openssl rand -base64 32` is good) and **keep a copy somewhere other than the server**. It encrypts every backup and the safety copy.

Then change `KINSHIP_VERSION` to the new version (the release's `env.example` shows every new setting), `docker compose pull && docker compose up -d`. The first start writes a safety copy (`data/backups/pre-upgrade-0006-to-0014.tar.enc` from alpha.2), then applies migrations 0007 to 0014. **Back up first anyway** (INSTALL.md, "Back up and restore"): the safety copy sits on the same disk. Going back is a restore of that backup; there are no down-migrations.

What changes for people: every Married relationship with a deceased partner becomes Widowed (see "Names and relationships" below); everyone sees dates as "Jan 1, 2026" until they change it in My settings; admins see a "What's new" popup once. An alpha account may not be linked to a person: an admin links it in **Admin → Users** ("Link to a person", see below), or you open **Family tree** and choose who to start from meanwhile.

### Link an account to a person (database change, back up first)

- **No action is needed, and no data changes.** Migration 0016 adds five functions and replaces one (`create_invitation`); it adds no table and no column, and no account is linked or unlinked by the upgrade. An account that had no person before still has none afterwards.
- **What it is for:** accounts made by an alpha or a release candidate may be linked to nobody (the first-run person was optional, and so was the person on an invitation). In **Admin → Users**, an admin can now **link** such an account to a person, **change** the link or **unlink** it. Linking an account to a person makes it that person on the tree (Home, My profile and the tree open on them) and, for a Member, lets it edit that person and the people it added below them. The dialog says what changes before you save. A SuperAdmin links any account; a Family Admin links Members, Users and their own account.
- **A person who has an open invitation cannot be linked** until you revoke the invitation. An "Unknown father or mother" cannot be linked, and an invitation can no longer name one (before, the screen hid them but the API did not refuse them).
- **API:** new `GET /api/admin/accounts/:id/link-preview?personId=`, `PUT /api/admin/accounts/:id/person` and `DELETE /api/admin/accounts/:id/person?currentPersonId=` (admins only), new error codes `account_already_linked`, `person_is_placeholder`, `person_has_open_invitation` and `account_not_linked`, and `canLinkPerson` on each row of `GET /api/admin/accounts`. Each link, change and unlink writes one line to the api log (`account_person_linked` or `account_person_unlinked`, with the ids of the admin, the account and the people, never names or emails).
- The safety copy is named by schema numbers as always (`pre-upgrade-0015-to-0016` from the release after 0.2.0-rc.2 that has 0015).

### Unknown parents (database change, back up first)

- **No action is needed, and no data changes.** Migration 0015 adds one column to every person, `is_placeholder`, `false` for everyone who exists already, and lets only a placeholder have no name. A placeholder is an "Unknown father" or "Unknown mother" that KinShip adds when you add a brother or sister to someone with no parents. It has no name and no dates; giving it a name makes it an ordinary person.
- Placeholders are real rows in the database, so a backup holds them and a restore brings them back. They are left out of the people list, search and counts, and a future GEDCOM export will not write them.
- **API:** new `POST /api/people/:id/siblings` (admins only; one transaction). `Person` has a new field `isPlaceholder`. A script that added a sibling with `POST /api/people` and `POST /api/people/:id/parents` still works for a person who has parents.
- The safety copy is named by schema numbers as always (`pre-upgrade-0014-to-0015` from 0.2.0-rc.2).

### Update check, What's changing and What's new (database change, back up first)

- **No action is needed, and no data changes.** Migration 0014 adds a table for the state of the update check and four columns to every account (the version they last saw What's new for, and the SuperAdmin's dismissed banner and backup tick). An account that exists already is shown the changes since 0.1.0-alpha.2 once, at its next sign-in (admins only); a new account starts current. It also adds a column to the upgrade log that records the version of a backup that was restored.
- **Admin → Updates** (SuperAdmin only) has the three switches: **Check for new versions** (on), **Include pre-releases** (off) and **Safety copy before a database change** (on, the same switch the upgrade reads). The check is a daily read of GitHub's public release list; it sends nothing about your install. **There is no environment variable for it.** To turn it off on a server with no internet access, use the switch. If a proxy is needed, set `HTTPS_PROXY` (and `NO_PROXY`) in `.env`.
- **The web and the api must be the same version.** The web container now tells the api its version on every request, and the api answers 503 "version_mismatch" to everything but its health and version checks while they differ (the web shows a page that says which is which). Change both image tags together, as before (`KINSHIP_VERSION` does both). **A reverse proxy in front needs no change.**
- **The api image now carries `CHANGELOG.md` and `UPGRADE.md`** (about 25 KB), for the What's new popup. `GET /api/version` also returns `webVersion`.
- **The release page's settings file is called `env.example`** (it was uploaded as `default.env.example` because GitHub drops a leading dot). INSTALL.md says so.
- **API:** `GET /api/admin/updates`, `PATCH /api/admin/updates/settings`, `POST /api/admin/updates/check`, `POST /api/admin/updates/dismiss`, `POST /api/admin/updates/backup-ack` (SuperAdmin only) and `GET /api/updates/whats-new`, `POST /api/updates/whats-new/seen` (any admin). See [ADR 0015](docs/decisions/0015-update-check-and-whats-new.md).

### Built-in backups and the safety copy (database change, back up first)

- **Before you update: add the backups folder to your `compose.yml`, and set a passphrase.** Copy the new `compose.yml` from the release (or add the two lines yourself) so the `api` service has
  ```yaml
      volumes:
        - ./data/backups:/var/lib/kinship/backups
  ```
  then create the folder next to it: `mkdir -p data/backups && sudo chown 1000:1000 data/backups` (Docker Desktop on macOS and Windows does not need the `chown`). Add `BACKUP_PASSPHRASE=` (at least 16 characters; `openssl rand -base64 32` is good) to `.env`, as in the new `.env.example`, and **keep a copy of it somewhere other than the server**. If the folder is missing the api will not start the upgrade, and prints exactly these lines.
- **A safety copy is now made before every database change** (`data/backups/pre-upgrade-<from>-to-<to>.tar.enc`, encrypted with the passphrase; a plain `.sql.gz`, with a warning, if there is none; the newest three are kept). The first database change after you add the passphrase gets one (from alpha.2 that is the whole jump, `pre-upgrade-0006-to-0014`). It can take minutes on a big database; the compose health check now allows 10 minutes. If it cannot be made the upgrade stops and your data is untouched; as a last resort start once with `KINSHIP_SAFETY_COPY=skip` (see INSTALL.md, "Something wrong?"). A database owner role that cannot read every row (neither a superuser nor `BYPASSRLS`) skips the copy with a loud log line and says so in the upgrade log.
- **Admin → Backups** (SuperAdmin only): status, Back up now, Test the latest backup, a download that asks for your password again, and the schedule (every day at 03:00 UTC by default; set your time zone), with 7 daily, 4 weekly and 6 monthly backups kept. With no usable passphrase the schedule stays off and the page says so.
- **Restoring is a command on the server** (`docker compose run --rm api kinship restore <file>`, with `web` and `api` stopped); there is no restore button. See INSTALL.md.
- Migration 0013 adds `app_settings`, `upgrade_log` and `schema_info.app_version`, and rewrites three internal row-level-security policies so they no longer name the database owner role (they now mean "the table's owner"). No data changes. The `kinship` command gained `backup`, `backup-list`, `backup-verify`, `backup-decrypt` and `restore`. The api image carries the PostgreSQL 18 client tools (about 9 MB larger).
- **For a plain (non-superuser) database owner role:** a backup needs `BYPASSRLS` on it (INSTALL.md). Starting no longer rewrites the app role's attributes on every start (a plain owner could not), only its password.

### First-run wizard (database change, back up first)

- **No action is needed, and no data changes.** Migration 0012 adds the function the new first-run wizard uses to create the account, the tree and your closest relatives in one step, and drops an old unused one (the five-argument `complete_setup`, issue [#9](https://github.com/officialJCReyes/kinship/issues/9)). An installation that has an account already never sees the wizard. A new install sees a seven-step setup wizard instead of the one-page form: everything is created at the end in one step.
- **API:** `POST /api/setup` takes an optional `family` object (you, partner, parents, children) and answers errors with the field that is wrong (`{ "error": "invalid_date", "field": "family.children.1.birth" }`); other setup errors now carry a `field` too. New `POST /api/setup/check` tells whether a setup token is right. A script that sends `person` instead of `family` keeps working. See [ADR 0013](docs/decisions/0013-setup-wizard.md).

### Invitations, set-password links and Change password (database change, back up first)

- **No action is needed, and every existing account keeps working** (your SuperAdmin, and any Members or Users you made by hand). Migration 0011 adds a table for invitation and set-password links, and three columns to every account: when it last signed in, when its password last changed, and how. For accounts that exist already, "how" is empty and the Account card says "Password change not recorded"; it fills in the next time the password changes.
- **Admins can now invite people.** **Account menu → Admin → Users → Invite user** makes a link to send yourself (KinShip sends no email yet). A SuperAdmin invites Family Admins, Members and Users; a Family Admin invites Members and Users. The link works once and lasts 7 days, and it is shown only when you make it: if you close the window, make a new link (that cancels the old one). An invitation can link an existing person who has no account; a Member with no linked person can only read, and linking an account afterwards is not possible yet ([#8](https://github.com/officialJCReyes/kinship/issues/8)).
- **Set-password links.** An admin can make a 24-hour link for someone who is locked out (a Family Admin for a Member or a User, a SuperAdmin for anyone but themselves). Using it signs the account out everywhere. **The account shows that an admin set the password**: under **My settings → Account**, "Password last changed 14 Nov, using a link from an admin", and admins see the same line on the Users page. A SuperAdmin who is locked out still uses `kinship set-password` on the server, which now also shows as "by the person who runs the server".
- **Change password** is under **My settings → Account**. It signs out every other device.
- **Email addresses are unique ignoring case.** Accounts have always stored addresses in lower case with a unique index, so no existing database can have a clash and the migration does not change any account. It adds the same rule on `lower(email)` as well. If a database edited by hand ever had two accounts whose addresses differ only in case, the migration stops with a message that says how many (never the addresses) and changes nothing: give each its own address and start KinShip again.
- **Admins now read every account row** (name, email, role, linked person, last sign-in, how the password changed) through a new row-level security policy. The password hash is still unreadable by the application.
- **Links are in the address fragment** (`https://your-tree.example/invite#…`, `/reset#…`). A browser never sends a fragment to a server, so the secret is in no access log, including your reverse proxy's. **Reverse proxies:** nothing to change; `/invite` and `/reset` are served like any other page, and the API answers for them under `/api/links/` with `Cache-Control: no-store`.
- **API:** `POST /api/admin/invitations`, `GET /api/admin/accounts`, `POST /api/admin/links/:id/regenerate`, `POST /api/admin/links/:id/revoke`, `POST /api/admin/accounts/:id/set-password-link`, public `POST /api/links/lookup` and `POST /api/links/accept` (the token in the body), and `POST /api/auth/password`. `GET /api/auth/me`, sign-in and setup also return `passwordChangedAt` and `passwordChangedVia`. See [ADR 0012](docs/decisions/0012-account-links.md).

### Display settings (database change, back up first)

- **No action is needed.** Migration 0010 adds four columns to every account: color scheme, theme (light or dark), date format, and which surname shows, next to the family setting that already exists. Every existing account gets the defaults: Forest, Device (follows your device), dates like "Jan 1, 2026", and the married surname when someone has one.
- **Dates now read "Jan 1, 2026" by default** (the alpha showed "January 1, 2026"). Each person changes this, the color scheme (Forest, Warm sand, Slate blue, Graphite), Light or Dark, which surname shows, and the family to follow for an adopted person under **account menu → My settings**. These settings belong to the account and change nothing for anyone else.
- **The top bar changed.** "My profile" and "About" moved into the account menu (click your name), which also has "My settings" and "Sign out".
- **API:** `GET /api/auth/me`, sign-in and first-run setup return `colorScheme`, `theme`, `dateFormat` and `surnameChoice`; `PATCH /api/auth/me` accepts any of the five settings. The browser keeps a copy of the color scheme and theme (`kinship.display` in local storage) so a page is drawn right before sign-in; the account decides.
- **Reverse proxies:** the web container now also serves one small file, `/theme-init.js`. It must not be blocked, and it must not be cached for long: the bundled nginx makes the browser check it on every load, so a new release reaches people at once.

### Names and relationships (database change, back up first)

- Migrations 0007, 0008 and 0009 add second and married surnames, a new search column, automatic Widowed tracking, and custom relationship labels. No action is needed.
- **One-time data change:** every relationship with status **Married** where either partner is already marked **deceased** becomes **Widowed**, marked as set automatically. Other statuses are not changed.
- From then on the app does this itself. Marking a person deceased turns their Married relationships into Widowed. Marking them living again reverts only the automatic ones, and only if the other partner is not deceased. Saving a status by hand in the relationship editor, even the same one, makes it permanent.
- The old `search_name` column stays until a later release.
- **API:** list cursors from before the upgrade are refused with `invalid_cursor`. `GET /api/people/:id` has new fields: `labels` and `partnerChildren`, plus `secondSurname`, `marriedSurname` and `statusAuto` on people and relationships.
- **Custom labels** are added by admins only. A label never changes the tree or who is next of kin.

## 0.1.0-alpha.2

**This is an alpha: there is no upgrade promise, and data may be wiped between 0.1.x releases. Do not keep real family data in it.** The data promise starts with 0.2.

- **From 0.1.0-alpha.1 you can usually just update** (this was tried: an alpha.1 install with a SuperAdmin account moved to alpha.2 in place). Change `KINSHIP_VERSION` in `.env` to `0.1.0-alpha.2`, then `docker compose pull && docker compose up -d`. The database changes (migrations 0003 to 0006) are applied at startup and your SuperAdmin account keeps working. That account is **not linked to a person** (a fresh install can link it during setup; 0.1 has no screen to link one later): open **Family tree** and choose who to start from, or add people on the People page.
- **If anything looks wrong, start fresh.** Take a dump first if you want one (the backup command in [INSTALL.md](INSTALL.md)), then `docker compose down --volumes` and install again. Going back to alpha.1 after the database has been upgraded needs a restore of a dump taken before; there are no down-migrations.
- **Breaking changes (internal, for people who built on the API).** The people and tree API changed shape during the alpha: `GET /api/people/:id` returns `parents: {birth, adoptive}` and children as `{id, kind, link, adopted}`; a parent link carries `kind` and `link`; the tree response carries `lineage` and, for a person with a second family, `otherFamily`; `AuthUser` carries `lineageView`. The API is not a public interface in 0.1.
