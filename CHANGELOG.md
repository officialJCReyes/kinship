# Changelog

All notable changes to KinShip are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0-rc.3] - 2026-11-18

**A third release candidate for 0.2.0. The database changes twice more (migrations 0015 and 0016, schema 14 to 16, no data changes):** a safety copy is made first, and nothing in your tree is touched. Upgrading from rc.1 or rc.2 is an image update; from 0.1.0-alpha.2 read [UPGRADE.md](https://github.com/officialJCReyes/kinship/blob/main/UPGRADE.md) first. Release candidates are offered by the in-app update check only when "Include pre-releases" is on.

### Added

- **A brother or sister for someone with no parents.** Add relative no longer asks you to add a parent first. When the person has no parents on the tree, KinShip adds an "Unknown father" and an "Unknown mother" for them and links both children to them, in one step. They are dashed cards on the chart; give one a name (Add details) and it becomes an ordinary person. They never appear in the people list, in search or in counts.

- **Link an existing account to a person** ([#8](https://github.com/officialJCReyes/kinship/issues/8)). In Admin → Users an admin can link an account that has no person to a person on the tree, change the link, or unlink it. The dialog says what the link changes before anything is saved (for a Member: the person and the people they added below them). One person has at most one account and one account at most one person; a person with an open invitation, and an "Unknown father or mother", cannot be linked. A SuperAdmin links any account, a Family Admin Members, Users and their own. Every link, change and unlink is one line in the api log, with ids only.

### Fixed

- **An invitation can no longer be made for an "Unknown father or mother".** The Invite dialog never offered one, but the API accepted it, and accepting such an invitation would have failed with an unexplained error. It now answers `person_is_placeholder`.

### Changed

- **Success messages are a small pill** at the top centre that fades after about 5 seconds (and waits while the pointer or keyboard focus is on it). Warnings are still bars with a Dismiss button.
- The database changes twice more (migrations 0015 and 0016, no data changes): see [UPGRADE.md](https://github.com/officialJCReyes/kinship/blob/main/UPGRADE.md).

## [0.2.0-rc.2] - 2026-11-17

**A second release candidate for 0.2.0. No database change** (the schema stays at 0014), so upgrading from 0.2.0-rc.1 is a plain image update; from 0.1.0-alpha.2 read [UPGRADE.md](https://github.com/officialJCReyes/kinship/blob/main/UPGRADE.md) first.

### Added

- **A date of birth for your partner in the first-run wizard.** Optional: a year, a month or a full date, exact or approximate, shown in your date format.

### Changed

- **Tree cards show the whole name.** Every card is now the same size, with room for three lines of name; a long name wraps and, if it still does not fit, gets a smaller type size instead of being cut with "…". The male and female icon is gone: the border colour (blue, orange, grey for other or unknown) is the only sign, and the sex is still in the card's name for screen readers. The legend reads "Other or unknown".
- **A selected card is tinted as well as ringed,** so it stands out in every colour scheme.
- **The person panel shows the birth surname** when a married surname is the one shown ("Birth surname: Ruiz").

## [0.2.0-rc.1] - 2026-11-17

**A release candidate for 0.2.0, "A tree you can trust". The data promise starts here:** upgrades keep your data, and a safety copy is made before each database change. Read [UPGRADE.md](https://github.com/officialJCReyes/kinship/blob/main/UPGRADE.md) before upgrading from an alpha: it needs a backups folder and a backup passphrase first. Release candidates are offered by the in-app update check only when "Include pre-releases" is on.

### What 0.2.0-rc.1 adds

- **Backups and restore.** Encrypted backups (one file, your passphrase), on a schedule or on demand, with a test that restores the newest one into a temporary database, a download that asks for your password again, and `kinship restore` on the server. A safety copy of the database is written before every database change. See [ADR 0014](https://github.com/officialJCReyes/kinship/blob/main/docs/decisions/0014-backup-and-owner-access.md).
- **Updates.** Admin → Updates tells the SuperAdmin about a new version (a daily read of GitHub's public release list that sends nothing about your install, switched on or off in the app), shows what it changes with a backup warning, and every admin sees a "What's new" popup after an update. The web and the api must be the same version, and say so if they are not. See [ADR 0015](https://github.com/officialJCReyes/kinship/blob/main/docs/decisions/0015-update-check-and-whats-new.md).
- **A seven-step first-run wizard** that creates your account, your tree, you, and optionally a partner, parents and children, all at once.
- **Invitations and passwords.** Admins invite people by a link they copy; an admin can make a set-password link for someone locked out, and the account shows that an admin set the password; everyone can change their password.
- **My settings.** Four color schemes, light or dark, a date format, which surname shows, and which family the charts follow for an adopted person.
- **A fuller relationship model.** Second and married surnames; Married relationships become Widowed automatically when a partner is marked deceased; custom relationship labels (Godmother, Guardian); step relatives, and a partner's children from another relationship.

### Changed

- Dates now read "Jan 1, 2026" by default (the alpha showed "January 1, 2026"). Each person can change it.
- The top bar's "My profile" and "About" moved into the account menu.
- The database gains migrations 0007 to 0014, applied at startup after a safety copy. **One-time data change:** Married relationships with a deceased partner become Widowed.

### What it does not include yet

- **Profile photos and media upload** (planned for 0.3), other chart views, the relationship finder, reports, sources, places, DNA and health history.
- **A Restore button** (restore is a command on the server) and S3 or other backup destinations.
- **Email** (invitations and password links are copied by hand) and single sign-on.

## [0.1.0-alpha.2] - 2026-11-16

**This is an alpha. Data may be wiped between 0.1.x releases, so nobody should enter real family data.** It is the first release with a family tree: you can add people and relationships and see them on a chart.

### What 0.1.0-alpha.2 adds

- **First run with your own person.** Setup can create the first person and link it to your SuperAdmin account; "My profile" opens it.
- **People and relationships.** Add, edit and delete people; partner relationships with a status (married, divorced, engaged, partner and more) and dates; parents, children and siblings with **Add relative**; name search that ignores case and accents. A child hangs from a relationship (or from one parent), so the children of an earlier marriage stay with that marriage. Dates keep the precision they were typed with ("about 1955", "before 1950").
- **Roles that are enforced.** SuperAdmin and Family Admin edit everything; a Member edits their own profile and adds children below themselves; a User reads. Every rule is checked twice, in the API and by PostgreSQL row-level security. (There are still no invitations, so Members and Users cannot be created in the app yet.)
- **The family tree chart.** Pan, zoom (wheel, pinch, buttons, keyboard) and fit; couples joined by a solid or a dotted line (together, or ended), children hanging from their relationship, a legend, and a person panel with Edit details, Add relative and the person's relationships. A **small green leaf** on a spouse opens that spouse's own family and flips the chart to it; a partner's own children from before are drawn under them. It stays smooth with over a thousand people. Light and dark theme, keyboard navigation and screen-reader names. See [ADR 0006](https://github.com/officialJCReyes/kinship/blob/main/docs/decisions/0006-tree-view.md).
- **Adoption.** A person can have birth parents and adoptive parents, each with an optional date. Each viewer chooses which family the charts follow (adoptive by default; the profile has a switch), and a second leaf opens the other family. The profile always lists both. Only admins add adoptive links. See [ADR 0007](https://github.com/officialJCReyes/kinship/blob/main/docs/decisions/0007-adoption-parentage.md).
- **Tests and docs.** End-to-end tests in a real browser against the real containers (not a required check), screenshots and the logo in the README, and the decisions in `docs/decisions/`.

### Changed

- The database gains the people, relationship, parent-link and account-setting tables (migrations 0003 to 0006), applied automatically at startup.
- The shared API types and the password rule live in one place (`packages/shared`).
- **Upgrading from 0.1.0-alpha.1:** see [UPGRADE.md](https://github.com/officialJCReyes/kinship/blob/main/UPGRADE.md).

### What it does not include yet

- **Other chart views** (pedigree, fan, descendants), the relationship finder, reports, photos, sources, places, DNA and health history.
- **Users page and invitations** for Members and Users, and the My settings page.
- **No backup or restore feature** (the install guide shows how to dump the database by hand), no update notice, no email, no single sign-on.
- **No upgrade promise.** Until 0.2 a new release may require starting with an empty database.

## [0.1.0-alpha.1] - 2026-11-15

**This is an alpha. Data may be wiped between 0.1.x releases, so do not enter real family data.** It is the first release that can be installed: it proves the whole delivery chain, but there is no family tree yet.

### What 0.1.0-alpha.1 includes

- **Install with Docker Compose**: one `compose.yml`, one `.env`, three services (`web`, `api`, `db`). Images are published to GHCR for linux/amd64 and linux/arm64, with the same version tag for web and api. See [INSTALL.md](INSTALL.md).
- **First-run setup**: a one-time setup token is printed in the api log; with it you create the SuperAdmin account and name your tree.
- **Sign in and out**: local accounts, argon2id passwords (at least 12 characters), server-side sessions, CSRF protection, sign-in rate limits.
- **Recovery**: `docker compose exec -it api kinship set-password <email>` for whoever runs the server.
- **Database**: PostgreSQL 18 with row-level security, an owner role that migrates and a separate app role that serves requests, migrations applied automatically at startup (forward-only, checksummed).
- **About page** with the web and API versions, the database schema number, the build date and commit, the license and the source link; the same version and source link on the sign-in screen.
- **Health checks** on every service; `/api/health`, `/api/version`.
- Light and dark theme following the device; English text as translation keys.

### What it does not include yet

- **People, relationships and the family tree.** There is nothing to put in your tree yet; the home page says so. Adding and editing people, parents, partners and children, the tree view and profile facts come before 0.1.0.
- **Roles are stored** (SuperAdmin, Family Admin, Member, User) but only the SuperAdmin created by setup exists; there are no invitations or screens for the others.
- **No backup or restore feature.** The install guide shows how to dump the database by hand. A built-in backup arrives in 0.2.
- **No update notice, no "What's new" popup, no file storage, no email, no single sign-on, no password reset by email.** Later releases add them.
- **No upgrade promise.** Until 0.2, a new release may require starting with an empty database.

[Unreleased]: https://github.com/officialJCReyes/kinship/compare/v0.2.0-rc.3...HEAD
[0.2.0-rc.3]: https://github.com/officialJCReyes/kinship/compare/v0.2.0-rc.2...v0.2.0-rc.3
[0.2.0-rc.2]: https://github.com/officialJCReyes/kinship/compare/v0.2.0-rc.1...v0.2.0-rc.2
[0.2.0-rc.1]: https://github.com/officialJCReyes/kinship/compare/v0.1.0-alpha.2...v0.2.0-rc.1
[0.1.0-alpha.2]: https://github.com/officialJCReyes/kinship/compare/v0.1.0-alpha.1...v0.1.0-alpha.2
[0.1.0-alpha.1]: https://github.com/officialJCReyes/kinship/releases/tag/v0.1.0-alpha.1
