# Changelog

All notable changes to KinShip are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned for 0.1.0

0.1.0 is tagged when the exit test passes: a stranger follows the README on a clean machine and has a working tree in ten minutes. Until then there are further 0.1.0-alpha releases. Data may still be wiped between 0.1.x releases; the data promise starts with 0.2.

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

[Unreleased]: https://github.com/officialJCReyes/kinship/compare/v0.1.0-alpha.2...HEAD
[0.1.0-alpha.2]: https://github.com/officialJCReyes/kinship/compare/v0.1.0-alpha.1...v0.1.0-alpha.2
[0.1.0-alpha.1]: https://github.com/officialJCReyes/kinship/releases/tag/v0.1.0-alpha.1
