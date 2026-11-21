# Upgrading KinShip

Notes for upgrading from one release to the next, newest first. Read the section for the version you are moving to. The release process requires a section here for any release with a breaking change.

## Unreleased (will become 0.3.0)

**0.3.0 changes the database and some settings.** Back up first (Admin → Backups). From 0.2.1 it is an image update: change `KINSHIP_VERSION`, then `docker compose pull && docker compose up -d`. The first start writes a safety copy named by schema numbers (`pre-upgrade-0016-to-0019.tar.enc` so far; later 0.3.0 steps may add migrations and raise the second number) and then applies the migrations.

### What changes for people

- **Married women's names now show as "Maiden name (Married name)"**, for every account, for example "Rosa Mendez (Hale)". Change it in **My settings → Names**, where there are four forms: Maiden name (Married name), Married name (born Maiden name), Married name, and Maiden name. A person with no married surname always shows the birth name. If a married surname starts with the birth name ("Mendez Hale" for "Mendez"), the birth name is not repeated in the brackets.
- **Existing accounts move automatically (migration 0017).** An account that showed married surnames (the old default) now uses "Maiden name (Married name)". An account that had chosen birth names now uses "Maiden name". KinShip cannot tell a deliberate "married" choice from the default, so check **My settings → Names** if you had picked it on purpose.
- **Four new optional name fields** on each person: prefix (Dr., Sir), suffix (Jr., II), nickname and surname particle (de, de la, van). They are in Add relative and Edit details, on the profile under Facts, and searchable. Prefix and suffix show on the tree and profile for every account, new and existing; turn them off in My settings → Names. A nickname is never part of the shown name. Nothing is filled in for existing people, and the setup wizard asks for none of them.
- **Charts hide aunts, uncles and cousins by default (migration 0018, which adds four columns to `users`).** *Charts now hide aunts, uncles and cousins by default. Turn them back on in the new gear panel, where you can also choose how the mouse wheel works and which view opens first.* The Family tree used to draw them; now it draws the person, the ancestors, brothers and sisters (and half-siblings), their partners and children, and nobody else's branches. This applies to every account, existing ones included. To see them again, open the chart's **gear** (Chart settings) and turn on **Show aunts, uncles and cousins**. No action is needed.
- **A chart settings panel (gear)** in the top bar of the tree: show † after the name of someone who has died, the married-name forms and prefix and suffix switches (the same settings as My settings → Names), the mouse wheel (zoom or scroll), and which chart opens first from the menu or after signing in (a link that names a view always wins). The defaults are today's behaviour, except for the relatives above.
- **A relationship finder** under Family tree → Relationship finder: pick any two people to see how they are related (cousin levels, half, in-law and step names, and the path between them). It needs no action; it only reads the tree.
- **Admins can change an account's role, disable an account and delete a disabled account** (Admin → Users, the Actions button on each row; migration 0019). *Admins can change an account's role, disable an account (it is signed out at once and can be enabled again) and delete a disabled account. The last SuperAdmin can never be demoted, disabled or deleted.* A SuperAdmin sets Family Admin, Member or User on any other account; a Family Admin switches Members and Users between Member and User. Nobody changes their own account, and nobody can be made SuperAdmin from the screen. A disabled account cannot sign in (the page says "wrong password", as it does for any wrong password), its open set-password link is revoked, and its person, history and shares stay. **Enabling it again brings its old password back**; make a set-password link if you want the person to choose a new one. Deleting needs the account to be disabled and its email typed; the person on the tree and everything else stays, and only the account goes (the people it added can then be edited by admins only). No action is needed.
- Admins see a "What's new" popup once after the update.

### Things to know

- The migration changes the search text in place (`people.search_names`, now including the four new fields). This rewrites one column and is quick for a family tree. The previous release still searches correctly if you restore the safety copy. The old `people.search_name` column and `users.surname_choice` stay until a later release.

### API changes

Migrations 0018 and 0019 change the database; the safety copy's name ends in `-to-0019`. Migration 0018 adds four columns to `users`. `GET /api/auth/me`, the sign-in response, `PATCH /api/auth/me` and the `settings` object of `POST /api/setup` gain `treeWheel` (`zoom` or `scroll`), `treeDefaultView` (`family`, `pedigree`, `fan` or `descendants`), `showExtendedRelatives` and `showDeceasedMark` (booleans). New error codes: `invalid_tree_wheel`, `invalid_tree_default_view`, `invalid_show_extended_relatives`, `invalid_show_deceased_mark`. `GET /api/tree/:id` accepts `collateral=siblings` (the person's siblings and half-siblings with their partners and descendants, without aunts, uncles and cousins); `collateral=true` keeps its meaning.

Migration 0019 adds `users.disabled_at` (null while the account is active), account functions, and two triggers that refuse to demote, disable or delete the last active SuperAdmin, **whoever runs the SQL**: if you ever edit the `users` table by hand and need to, `ALTER TABLE users DISABLE TRIGGER users_keep_a_superadmin_update` (and `..._delete`). Nothing else changes for scripts. New routes, all admin-only: `PATCH /api/admin/accounts/:id/role` (`{role, currentRole}`), `POST /api/admin/accounts/:id/disable` and `/enable`, `GET /api/admin/accounts/:id/delete-preview` and `POST /api/admin/accounts/:id/delete` (`{confirmEmail}`; a body, not a URL). Each row of `GET /api/admin/accounts` gains `allowedRoles`, `disabledAt`, `canDisable`, `canDelete` and `lastSuperAdmin`, and a `status` of `disabled`. New error codes: `self_not_allowed`, `last_superadmin`, `account_role_changed`, `account_disabled`, `account_not_disabled`, `confirmation_mismatch`.

`surnameChoice` is gone from `PATCH /api/auth/me`, the sign-in and `GET /api/auth/me` responses, and the `settings` object of `POST /api/setup`. It is replaced by `nameForm` (`maiden_married`, `married_born`, `married` or `maiden`), `showPrefix` and `showSuffix` (booleans). A request that still sends `surnameChoice` is refused with `invalid_request`. `GET /api/people/:id`, the tree and the list gain `namePrefix`, `nameSuffix`, `nickname` and `surnameParticle` (null when not set); they can be sent when creating or changing a person. New error codes: `invalid_name_form`, `invalid_show_prefix`, `invalid_show_suffix`, `invalid_name_prefix`, `invalid_name_suffix`, `invalid_nickname`, `invalid_surname_particle`; `invalid_surname_choice` is gone.

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
