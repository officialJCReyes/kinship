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

## Rules for the public repository

- **Never commit real family data**: no real names, photos, GEDCOM files, database dumps or `.env` files. Test and demo data is the fictional Hale family only.
- Never put secrets in the repository or in a database. Secrets live in `.env` or `*_FILE` Docker secrets.
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

## Security problems

Do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).

## Conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
