# Contributing to KinShip

KinShip is early (pre-alpha) and has one maintainer, so changes are best discussed in an issue before a large pull request. Questions go in GitHub Discussions; Issues are for bugs.

## Before you start

- Read [`design/kinship-v2-requirements.md`](design/kinship-v2-requirements.md) and the [release plan](design/kinship-release-and-deployment-plan.md). The mockup in `design/` is the specification for screens and behavior.
- Technical decisions are recorded in [`docs/decisions/`](docs/decisions/). A change to the stack or a major library needs a new decision record.
- Work follows the release plan's order. Features from a later release are not accepted early.

## Setup

You need Node 26 (see `.nvmrc`) and pnpm. The pnpm version is pinned in `package.json`; use corepack so you get exactly that version:

```sh
corepack enable
pnpm install
```

Newer Node versions may not bundle corepack. If the `corepack` command is not found, run `npm install -g corepack` first.

## Running it and signing in

```sh
docker compose -f compose.dev.yml up --build     # db, api and web with hot reload; open http://localhost:5173
docker compose -f compose.dev.yml logs api       # the one-time setup token for a fresh database
```

A fresh database shows the setup page; use the token from the log. Starting over: `docker compose -f compose.dev.yml down -v` removes the database volume. The dev stack's database passwords are throwaway values in `compose.dev.yml`. Never reuse your real data or passwords there.

For tests that need a signed-in person, use the helpers in `apps/api/test/helpers/app.ts` (`createTestApp`, `insertUser`, `login`). Do not add test-only ways around authentication to the application code.

## Rules for the public repository

- **Never commit real family data**: no real names, photos, GEDCOM files, database dumps or `.env` files. Test and demo data is the fictional Hale family only.
- Never put secrets in the repository or in a database. Secrets live in `.env` or `*_FILE` Docker secrets. (Hashes of random tokens and passwords are not secrets in this sense; plain passwords and tokens are never stored.)
- Anything that reads or changes private data runs through the per-request transaction (`request.withTransaction`), so row-level security applies. New tables get row-level security and, where they hold secrets, no direct access for the app role (see migration 0002).
- No AI features.
- Every UI string is a translation key.
- Dependencies must be AGPL-3.0-compatible. CI checks this.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`. Mark a breaking change with `!` (`feat!:`) or a `BREAKING CHANGE:` footer. The changelog and release notes are generated from these.
- Keep pull requests small, with tests for the change.
- Database changes are new numbered, hand-written `.sql` migration files. Never edit a migration that has been released. Migrations are forward-only and follow expand-then-contract.

## License headers

Every source file starts with an SPDX line naming the license, in the file's own comment style:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
```

```sql
-- SPDX-License-Identifier: AGPL-3.0-or-later
```

```yaml
# SPDX-License-Identifier: AGPL-3.0-or-later
```

```html
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
```

Files where a comment is not possible (JSON, lockfiles, images) and generated files are exempt. Markdown documents do not need a header.

## Sign-off (DCO)

By contributing you agree your work is licensed under AGPL-3.0-or-later and that you have the right to submit it, as stated in the [Developer Certificate of Origin](https://developercertificate.org/). Show this by signing off every commit:

```sh
git commit -s -m "fix: keep date precision"
```

This adds a `Signed-off-by: Your Name <you@example.com>` line using your git name and email. Commits without it will be asked to add it.

## Releasing (maintainer)

A release is a tag. [ADR 0004](docs/decisions/0004-release-and-images.md) explains how it works.

1. Set the same version in the four `package.json` files (root, `apps/api`, `apps/web`, `packages/shared`) and put a section for it in `CHANGELOG.md` (`## [0.2.0] - 2026-12-01`). Pre-releases look like `0.2.0-rc.1` and never become `latest`.
2. Merge that to `main` through a pull request, once CI is green.
3. Optional: run the **Release** workflow by hand on the branch or on `main` with "dry run" on. It builds both images for amd64 and arm64, installs the stack from `compose.yml` and tests it, and pushes nothing.
4. Tag the merge commit and push the tag: `git tag -s v0.2.0 -m "KinShip 0.2.0" && git push origin v0.2.0`. The tag must match the version in the files, or the workflow stops before building.
5. Watch the workflow. It re-runs CI, pushes the images, tests the pushed images as a real install, and only then creates the GitHub Release.

You can also test the whole production stack on your own machine: build the images, then `scripts/smoke-test.sh <image-tag>` (see the comment at its top).

## Security problems

Do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).

## Conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
