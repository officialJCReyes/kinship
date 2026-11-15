# Changelog

All notable changes to KinShip are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/officialJCReyes/kinship/compare/v0.1.0-alpha.1...HEAD
[0.1.0-alpha.1]: https://github.com/officialJCReyes/kinship/releases/tag/v0.1.0-alpha.1
