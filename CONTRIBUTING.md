# Contributing to KinShip

KinShip is early (release candidates for 0.2) and has one maintainer, so changes are best discussed in an issue before a large pull request. Questions and feature ideas go in GitHub Discussions. Issues are for bugs and for tracking work that was left out of a release (labelled `scope:planned-later`, `scope:0.2-cut` or `scope:unplanned-gap`, each with a milestone).

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
- AI features are optional and off by default (ADR 0021). None may call an AI service until an admin connects an engine, and none is added unless the maintainer asks for it. Reports, summaries and person matching stay fixed rules and templates.
- Every UI string is a translation key.
- Dependencies must be AGPL-3.0-compatible. CI checks this.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `security:` (a security fix: it gets its own "Security" heading in the changelog and flags the release), `docs:`, `chore:`, `test:`, `refactor:`. Mark a breaking change with `!` (`feat!:`) or a `BREAKING CHANGE:` footer. Changes that only touch the website use `docs(site):` or `chore(site):`, so they stay out of the changelog and do not raise the version. The changelog and release notes are generated from these.
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

1. Set the same version in the five `package.json` files (root, `apps/api`, `apps/web`, `packages/shared`, `e2e`), in `compose.yml` (two places) and in `.env.example`, and put a section for it in `CHANGELOG.md` (`## [0.2.0] - 2026-12-01`). Pre-releases look like `0.2.0-rc.1` and never become `latest`. From the release after 0.2.0 the **Release PR** workflow ([ADR 0017](docs/decisions/0017-release-please.md)) does all of this: on every push to `main` it opens or updates one pull request (it never makes a tag or a Release). Its `CHANGELOG.md` section may be rewritten by hand on its branch first (as for 0.3.0); merge nothing else to `main` meanwhile, as release-please rebuilds the branch when `main` moves. The maintainer merges it, then continues at step 3. Once the tag's GitHub Release exists, change the merged pull request's label from `autorelease: pending` to `autorelease: tagged`, or every later run aborts and no new release pull request opens ([ADR 0037](docs/decisions/0037-pre-releases.md)). If the release needs an `UPGRADE.md` section, it must be on `main` first, with the version as its heading (`## 0.3.0`); the workflow's pull request does not write it. **A release candidate** (`0.3.0-rc.1`) is made by hand instead ([ADR 0037](docs/decisions/0037-pre-releases.md)): one `chore(release): prepare …` pull request sets the version in the files above, adds a hand-written `## [0.3.0-rc.1] - <date>` section to `CHANGELOG.md` and renames the `UPGRADE.md` block to `## 0.3.0-rc.1` (the final release renames it to `## 0.3.0`); `.release-please-manifest.json` stays at the last stable version. Merge it right before tagging, with nothing merged in between.
2. Merge that to `main` through a pull request, once CI is green.
3. A pull request that touches the release files (the workflow, Dockerfiles, `compose.yml`, `.env.example`, the release scripts, `CHANGELOG.md`) runs the **Release** workflow as a dry run automatically. Once it is on `main` you can also start it by hand with "dry run" on. Either way it builds both images for amd64 and arm64, installs the stack from `compose.yml` and tests it, and pushes nothing.
   Also update the website for the release in the same pull request, before tagging: the Roadmap and Features pages (status chips, "Soon" labels, "arrives in" sentences). The version number on the site is filled in by itself after the release is published ([ADR 0022](docs/decisions/0022-website-version.md)).
   And add `scripts/upgrade-test/seed-<version>.sh` for the new version (copy the newest seed; change it only if the release changed an API route, a migration or stored data). The upgrade test in CI starts from the newest published release and fails every pull request, with "there is no seed for ...", until that file exists. It can be added before tagging, because nothing reads it until the release is published. Prove it first with a rehearsal against images built from the branch: `REHEARSE=<version> scripts/upgrade-test.sh <image-tag>` (the script's header says how). A seed that stores photos sets `SEED_FILE_KEY=1` and `SEED_PHOTOS`; a release candidate's seed can source its release's seed.
4. Tag the merge commit and push the tag: `git tag -a v0.2.0 -m "KinShip 0.2.0" && git push origin v0.2.0`. The tag must match the version in the files, or the workflow stops before building.
5. Watch the workflow. It re-runs CI, pushes the images, tests the pushed images as a real install, and only then creates the GitHub Release.

You can also test the whole production stack on your own machine: build the images, then `scripts/smoke-test.sh <image-tag>` (see the comment at its top).

## Security problems

Do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).

## Conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
