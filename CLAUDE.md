# KinShip: instructions for Claude Code

KinShip is a self-hosted family tree app. Public repo `officialJCReyes/kinship`, license AGPL-3.0-or-later. Maintainer: JC (one person).

## Source of truth
- `design/kinship-mockup.html` is the approved UI mockup (single-file, vanilla JS). It is the SPECIFICATION for screens, behavior and sample data (the fictional Hale family). It is not the code layout.
- `design/*.md` are the requirement docs. Start with `kinship-v2-requirements.md`, then `kinship-release-and-deployment-plan.md` (versions, pipelines, what ships when). When a doc and the mockup disagree, ask JC.
- **`design/` is a read-only mirror of the Project docs, which JC and Claude (in chat) maintain.** Never create, edit, move, rename or delete anything in `design/`, by any tool or shell command (`.claude/settings.json` blocks the edit tools; the shell is on you). If a doc is wrong, stale or missing something, say so in your report and carry the correction in your prompt text or an ADR in `docs/decisions/`; do not fix it in `design/`.

## Stack (decided)
- PostgreSQL 18 (official image), TypeScript API on Node, React UI built with Vite, nginx (unprivileged, Alpine) as the `web` container.
- Three compose services: `web` (only published port, 8080, proxies /api), `api`, `db`. Same version tag for web and api.
- Proposed picks, confirm with JC before locking in: Fastify, Kysely with plain `.sql` migrations, own SVG tree drawing (no diagram library), Vitest, Playwright.
- Monorepo: apps/web, apps/api, packages/ (shared types, translation keys), docs/, design/.

## Hard rules
- AI features are optional and off by default (ADR 0021). The first planned one is **Automatic transcription** (release 0.5, design in `design/kinship-transcription-engines-and-matching.md`). An AI feature stays off unless an admin connects an engine, and nothing in the app may call an AI service before that feature is built and asked for. Person matching, reports and summaries stay fixed rules and templates.
- Compose files are named `compose.yml` / `compose.dev.yml` / `compose.demo.yml`, never docker-compose.yml.
- Postgres row-level security: app connects as a NON-owner role, a separate owner role runs migrations. Set the signed-in user per request/transaction. Migrations are forward-only, hand-written SQL, expand-then-contract. Never `db push`.
- Every UI string is a translation key (English only at launch).
- Files are encrypted by the app before storage; secrets only in `.env` or `*_FILE` Docker secrets, never in the database.
- The update check is an in-app toggle stored in the DB, never an env var. No update email.
- Public repo: never commit real names, photos, GEDCOM files, dumps or `.env`. Test/demo data is the fictional Hale family only. Dependencies must be AGPL-compatible (check in CI). Add `SPDX-License-Identifier: AGPL-3.0-or-later` headers.
- Conventional Commits (`feat:`, `fix:`, `feat!:`). Releases: manual up to and including 0.2.0; from the release after 0.2.0 release-please opens the release pull request for a stable release and JC tags it (ADR 0017); a release candidate is prepared by hand in a `chore(release): prepare x.y.z-rc.N` pull request and leaves the release-please manifest at the last stable version. Only the newest release is supported.
- Image names are lowercase: ghcr.io/officialjcreyes/kinship-web and kinship-api.

## Build order
- Read `design/kinship-build-status-and-handoff.md` first. It records what is built, the decisions made, the open issues and what comes next. It is the current state; the release plan is the intended order.
- Follow `design/kinship-release-and-deployment-plan.md` (section 6, "What ships in each version") for what belongs in each release. **0.3 "See the family": `0.3.0-rc.1` is published, `0.3.0-rc.2` is in preparation (fixes only), and the final `0.3.0` comes next. The latest stable release is 0.2.1.** 0.2 started the data promise: migrations are forward-only and must preserve real data, and every upgrade path is tested. Nothing from 0.4 on starts unless the prompt says so.
- Work comes as numbered steps from JC's prompts, often in two phases: phase 1 is read-and-report only (write no code, make no commits, open no PR, then stop and wait for "go"); phase 2 builds. Prompts carry the approved design; where a prompt and a doc differ, the prompt wins, and tell JC about any conflict that matters before building.
- Stop before irreversible steps (publishing, releases) and wait for JC. You may create and push a release tag (`git tag -a`, then `git push origin <tag>`) only when JC says "tag it". Never force-push. Never delete or move a `v*` tag. If any release job fails, stop and report the log excerpt instead of retrying or re-tagging.
- The Release workflow (`.github/workflows/release.yml`) runs on a `v*` tag push. It has five jobs:
  - `checks` runs the whole of `ci.yml` (the 7 required checks, the upgrade test included);
  - `prepare` ("Work out what to release") checks the tag against the versions, CHANGELOG and UPGRADE.md;
  - `images` ("Build and push api/web") needs `checks` and `prepare`;
  - `smoke` ("Smoke test the production stack") needs `prepare` and `images`;
  - `release` ("Create the GitHub Release") needs all four.
  `checks` and `prepare` need nothing and run side by side. A pull request that touches the release files runs it as a dry run (`prepare`, `images`, `smoke`; nothing is pushed). When a Release run has finished, the Website workflow rebuilds the site.
- Exception (JC): if a Release run fails in `checks` on a known flaky test and nothing was pushed (no image, no GitHub Release), JC may re-run the failed jobs. Never re-tag.

## Working style
- Small PRs, one branch per part, tests with each change. Merge only when CI is green. The required checks come from the repository ruleset "Protect main" (not classic branch protection, whose API answers 404). It requires these 7, all of them, End-to-end included: Lint, format, typecheck, build; Tests (Postgres 18); Dependency licenses; Build api image (not pushed); Build web image (not pushed); Upgrade test (previous release); End-to-end (Playwright). Do not change these names. The same ruleset blocks deleting and force-pushing `main`. The "Protect release tags" ruleset (`refs/tags/v*`, no bypass) blocks moving, deleting and force-pushing a release tag; creating one is not restricted.
- Commit with `git commit -s` and let git config supply the sign-off. Never type a name or email by hand, including in squash and merge messages. Keep the Claude co-author line in squash and merge messages.
- The website (`site/`) shows the current version from `@@VERSION@@` placeholders that the Website workflow fills in from the latest GitHub Release (ADR 0022); never type a version number into `site/` for "now". Wording tied to a release (Roadmap, Features, "Soon" labels) is updated by hand in the release pull request, before JC tags. Website-only commits are `docs(site):` or `chore(site):`, never `feat`/`fix`, so they do not raise the version.
- Record each architectural decision as an ADR in `docs/decisions/`. Update CHANGELOG via Conventional Commits, and add an `UPGRADE.md` block for any migration or breaking change.
- Report decisions you made on JC's behalf, known gaps, stale doc lines you noticed, new issues opened, test counts and exact CI job names at the end of each step.
- Keep the whole e2e run well under the sign-in rate limit (30 a minute); do not add per-test sign-ins.
