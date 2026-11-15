# KinShip: instructions for Claude Code

KinShip is a self-hosted family tree app. Public repo `officialJCReyes/kinship`, license AGPL-3.0-or-later. Maintainer: JC (one person).

## Source of truth
- `design/kinship-mockup.html` is the approved UI mockup (single-file, vanilla JS). It is the SPECIFICATION for screens, behavior and sample data (the fictional Hale family). It is not the code layout.
- `design/*.md` are the requirement docs. Start with `kinship-v2-requirements.md`, then `kinship-release-and-deployment-plan.md` (versions, pipelines, what ships when). When a doc and the mockup disagree, ask JC.

## Stack (decided)
- PostgreSQL 18 (official image), TypeScript API on Node, React UI built with Vite, nginx (unprivileged, Alpine) as the `web` container.
- Three compose services: `web` (only published port, 8080, proxies /api), `api`, `db`. Same version tag for web and api.
- Proposed picks, confirm with JC before locking in: Fastify, Kysely with plain `.sql` migrations, own SVG tree drawing (no diagram library), Vitest, Playwright.
- Monorepo: apps/web, apps/api, packages/ (shared types, translation keys), docs/, design/.

## Hard rules
- No AI features anywhere.
- Compose files are named `compose.yml` / `compose.dev.yml` / `compose.demo.yml`, never docker-compose.yml.
- Postgres row-level security: app connects as a NON-owner role, a separate owner role runs migrations. Set the signed-in user per request/transaction. Migrations are forward-only, hand-written SQL, expand-then-contract. Never `db push`.
- Every UI string is a translation key (English only at launch).
- Files are encrypted by the app before storage; secrets only in `.env` or `*_FILE` Docker secrets, never in the database.
- The update check is an in-app toggle stored in the DB, never an env var. No update email.
- Public repo: never commit real names, photos, GEDCOM files, dumps or `.env`. Test/demo data is the fictional Hale family only. Dependencies must be AGPL-compatible (check in CI). Add `SPDX-License-Identifier: AGPL-3.0-or-later` headers.
- Conventional Commits (`feat:`, `fix:`, `feat!:`). Releases: manual for 0.1, release-please from 0.2. Only the newest release is supported.
- Image names are lowercase: ghcr.io/officialjcreyes/kinship-web and kinship-api.

## Build order
Follow the release plan: 0.1 "It runs" first (repo, CI, images on GHCR, compose, health checks, migrations at startup, first-run setup, login, people and relationships, one tree view, About page). Exit test: a stranger follows the README on a clean machine and has a working tree in ten minutes. Do not start 0.2 features during 0.1.

## Working style
Small PRs, tests with each change, update CHANGELOG via Conventional Commits. Write an ADR in docs/decisions/ for the stack choices (Milestone 0) before the first feature code.
