# KinShip release and deployment plan (Nov 15, 2026, revised four times the same day)

Companion to `kinship-v2-requirements.md`. Written at JC's request: a public GitHub repository, Docker images built and hosted on GitHub so future users can deploy easily, a versioning scheme, and what ships in each version, starting below 1.0 and building to a v1 release.

**Decided by JC (Nov 15):** license is **AGPL-3.0** (my recommendation, JC said "license is okay"); the repository owner is **officialJCReyes**; the repository is **public from day one**; the **trimmed 1.0** below is right; the **update check is a toggle inside the app, not an environment variable**; **no update email**; clicking an update notice opens a **popup with the changes**; after an update a **"What's new" popup** shows the changelog, **to every admin when they sign in** (SuperAdmin and Family Admins); **any breaking change or database migration must warn the SuperAdmin to take a backup first**; the **automatic safety copy before a migration is on by default**; the **support policy** (newest release only) and **release automation** (manual for 0.1, release-please from 0.2) were accepted. The update notice, both popups, the backup warning and the About page are **built in the mockup** (Admin → Updates; account menu → About KinShip).

**Stack decided by JC (Nov 15): PostgreSQL 18, a TypeScript API, an nginx `web` container, and a React UI** (section 6, Milestone 0).

## 1. Goals
- Anyone can run KinShip with **one `compose.yml`, one `.env` file and `docker compose up -d`**. No building on the user's machine.
- Every release is **reproducible and traceable**: a git tag, a changelog entry, and images with the same version tag.
- **Real family data is safe across upgrades** from the first release anyone puts real data in.
- The repo is public, so **no secrets, no real family data and no private health examples** ever go in it. The sample family is fictional.
- Matches decisions already made: Docker Compose + Postgres 18, three services (`web`, `api`, `db`), same tag for web and api, external reverse proxy for TLS, no AI features.
- **The SuperAdmin is told when a new version is out, and what is in it** (section 7). The app sends nothing about the installation when it checks.

## 2. Repository (public, GitHub)
**Repository:** `github.com/officialJCReyes/kinship`, public from the first commit, so the pipeline and the images are public from 0.1. One repo (monorepo), not one per service, so web and api always release together.

**License: AGPL-3.0.** Anyone may run, change and share KinShip, but a person who runs a modified copy as a network service must offer their users the source of their changes. Consequences to build in: a `LICENSE` file with the AGPL text; an **About page** (account menu) and the login screen footer showing the version and a **"Source code" link to the repository**, which is how a running instance meets the "offer the source" rule; license headers or an `SPDX-License-Identifier: AGPL-3.0-or-later` line in source files; a `NOTICE` or `docs/third-party.md` listing dependency licenses, checked in CI so no incompatible license slips in. Contributors agree to license their work under the same terms (a short note in CONTRIBUTING; a DCO sign-off is enough, no separate agreement). The logo and the KinShip name are not licensed by AGPL; a short `TRADEMARK.md` can say forks should use another name and logo. (I am not a lawyer; a quick review of these points is cheap before 1.0.)

```
kinship/
  README.md                 what it is, screenshots, 5-minute quick start, link to docs
  LICENSE                   AGPL-3.0
  CHANGELOG.md              Keep a Changelog format, one section per release (also bundled in the images)
  SECURITY.md               how to report a vulnerability privately (GitHub private advisories)
  CONTRIBUTING.md  CODE_OF_CONDUCT.md  TRADEMARK.md
  compose.yml               production example: pulls ghcr.io images, pinned by tag
  compose.dev.yml           for contributors: builds from source, hot reload
  compose.demo.yml          optional: loads the fictional Hale sample family
  .env.example              every setting, commented, with safe placeholder values
  apps/web/                 React UI + nginx config
  apps/api/                 TypeScript API, SQL migrations, background jobs
  packages/                 shared code (types, translation keys)
  docs/                     install, upgrade, backup and restore, reverse proxy examples, settings reference, decisions/
  design/                   the approved HTML mockup and the requirement docs (the history of why)
  .github/workflows/        ci.yml, release.yml, codeql.yml (and dependabot.yml)
  .github/ISSUE_TEMPLATE/   bug, feature request; pull request template
```
Compose files are named `compose.yml` (not `docker-compose.yml`), as JC prefers.

**Branches:** trunk-based. `main` is always releasable; short-lived feature branches and pull requests; branch protection on `main` (required CI checks, no force push). After 1.0, a `release/1.x` branch is created only if a patch must be backported.

**Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`; `feat!:` or a `BREAKING CHANGE:` footer marks a breaking change), so the changelog and release notes can be generated and breaking changes are never missed.

**GitHub settings on day one:** two-factor on the account, secret scanning and push protection on, Dependabot (npm and Docker base images, GitHub Actions), private vulnerability reporting on, GitHub Discussions for questions (Issues for bugs only), signed release tags. (Done Nov 15: private vulnerability reporting, secret protection, push protection, dependency graph, Dependabot alerts and security updates are on.)

## 3. Container images (GitHub Container Registry)
- **Registry:** `ghcr.io`. Images: **`ghcr.io/officialjcreyes/kinship-web`** and **`ghcr.io/officialjcreyes/kinship-api`**. (The registry requires lowercase, so the owner name is written in lowercase here.) The database is the official `postgres:18` image, not ours, so there are only two images to build.
- **Public:** GHCR packages start private. After the first push, set each package to Public (a one-time click on the package page) and link it to the repo so the page shows the README. Public packages can be pulled without logging in. Each image carries the label `org.opencontainers.image.source` pointing at the repo, which links it automatically.
- **Architectures:** `linux/amd64` and `linux/arm64`, one multi-arch tag, so it runs on a normal server, a Raspberry Pi and an Apple-silicon Docker host.
- **Built by GitHub Actions** (`release.yml`) with the built-in `GITHUB_TOKEN`; no personal access token stored. Steps: checkout, QEMU and Buildx, log in to GHCR, `docker/metadata-action` for tags and labels, `docker/build-push-action` with layer cache, then a vulnerability scan (Trivy), an SBOM and a build provenance attestation. Signing with cosign is optional and can wait until 1.0.
- **Image hygiene:** small base images (Alpine or distroless), run as a non-root user, a `HEALTHCHECK` in each image, base images pinned and updated by Dependabot, no secrets baked in, version and git commit shown in `/api/version` and on the About page.

### Tags
| Tag | Moves? | For |
|---|---|---|
| `0.3.1` (exact) | Never | **Recommended for production.** Pin this in `compose.yml` |
| `0.3` | To the latest patch of that minor | Hands-off patch updates |
| `1` (after 1.0) | To the latest 1.x | People who want every minor |
| `latest` | To the newest **stable** release | Trying it out; not for production |
| `edge` | On every merge to `main` | Contributors and testers |
| `sha-abc1234` | Never | Reproducing a bug |
| `0.3.0-rc.1` | Never | Release candidates (not tagged `latest`) |

`web` and `api` always share the same version number. The `api` refuses to start if it detects a `web` of a different version (checked through a version header), so a half-upgraded stack fails loudly instead of misbehaving.

## 4. Versioning
**Semantic Versioning** (`MAJOR.MINOR.PATCH`), with pre-release suffixes.

- **0.y.z (before 1.0):** `0.MINOR.0` is a milestone from section 6. `PATCH` is bug fixes only. Breaking changes are allowed between minors, but see the data promise below.
- **Pre-releases:** `0.4.0-rc.1` for release candidates, tested on JC's own instance first. `-alpha` and `-beta` are used only for 0.1 and the 1.0 run-up.
- **1.0.0:** the promise that stable features will not break without a major version.
- **After 1.0:** MINOR adds features, PATCH fixes bugs, MAJOR is reserved for a breaking change that needs the user to do something. **The version number is not a size of scope.** Adding DNA or S3 in 1.2 does not need a 2.0.
- A release is **milestone-driven, not calendar-driven**. Security fixes go out as a patch at once.

### Data promise (important for a family archive)
- **0.1.x:** data may be wiped between releases. The release notes say so in the first line. Nobody should enter real family data.
- **From 0.2.0:** forward-only database migrations that **preserve data**, tested on every release (see section 5). From here JC can use his real tree.
- Every upgrade note says "back up first" and links to the built-in backup (from 0.2). **A release with a database migration or a breaking change also triggers the backup warning inside the app (section 7).**
- **Rollback = restore the backup** taken before the upgrade. Down-migrations are not written. To make a one-step rollback realistic, schema changes use *expand then contract*: a release adds the new column or table while still working with the old one, and a later release removes the old one.
- The API runs pending migrations at startup under a lock (as already decided). If a migration fails the container stops, the database is left unchanged (migrations run in a transaction where Postgres allows), and the log says what to do.
- **Automatic safety copy before a migration (decided: on by default, JC Nov 15):** when the `api` starts and finds pending migrations, it first writes a Postgres dump to the backups volume (`pre-upgrade-<from>-to-<to>.sql.gz`), keeps the last three, and only then migrates. This is a safety net, **not a replacement for the SuperAdmin's own backup** (it sits on the same server and does not include media files). The SuperAdmin can switch it off in Admin → Updates ("Safety copy before a database change"), for example for a very large database. The "What's new" popup names the copy that was written.
- **Postgres major versions:** the app moves to a newer Postgres major only in a release that says so and ships the upgrade steps (a dump and restore, which the built-in backup already does). Postgres 18 is supported by its makers until November 2030, so this is not expected before then.

### Support policy (accepted by JC, Nov 15)
Keep it simple, because there is one maintainer:
- **Only the newest release is supported.** Bug fixes and security fixes ship as a new patch of the newest minor. Older versions are not patched.
- This works because **upgrading is made safe and easy**: every upgrade runs migrations forward, the update notice tells every SuperAdmin about it (security releases are flagged in red), and from 1.0 any 1.x installation can jump straight to the newest 1.x in one step (migrations are applied in order). So "please upgrade" is a reasonable answer to a bug report.
- **Before 1.0**, nobody is promised anything beyond that: breaking changes are allowed between minors and are announced in the popup.
- **After 1.0**, a major release (2.0) gets the previous major's security fixes for **6 months**, so people have time to move. Within 1.x there is no separate support window.
- Why not a longer window: patching several old lines multiplies testing and release work for one person, and an old line keeps old security problems alive. If the project grows and people need an older line, a `release/1.x` branch can be opened later without changing anything else here.
- The public repo says this in `SECURITY.md` ("supported versions: the latest release") so reporters know what to expect.

### What is versioned together
| Thing | How |
|---|---|
| App (web + api images) | The release version |
| Database schema | An ordered migration number; the app version records the schema it needs |
| Backup archive format | A `format` number inside the archive; a newer app reads older archives, never the reverse |
| GEDCOM export | Writes GEDCOM 5.5.1 (the version most programs read); a field in the file header names the KinShip version |
| Settings (`.env`) | New settings always have a default; removed ones are listed in the upgrade notes for one minor before being dropped |
| Release manifest | A small JSON file attached to each GitHub release that the app reads (section 7) |

## 5. Pipelines
**On every pull request (`ci.yml`):** lint and type check, unit tests, build both images (not pushed), start the whole stack from `compose.dev.yml` against a real Postgres, run migrations on an empty database, run the API tests, run Playwright smoke tests (setup wizard, login, add a person, view the tree), check translation keys have no missing entries, license check of dependencies, CodeQL and dependency audit.

**On every merge to `main`:** the same, then push `edge` images.

**On a version tag (`v0.3.0`) (`release.yml`):**
1. Re-run all tests.
2. **Upgrade test:** start the *previous* released images with the demo family loaded, take a backup, switch to the new images, check migrations ran and the family is intact, then restore the backup into a clean stack. This is the check that protects real data.
3. **Detect migrations and breaking changes automatically.** The pipeline compares the migration folder with the previous tag: any new migration file sets `migration: true`. A commit marked breaking (`!` or `BREAKING CHANGE:`) sets `breaking: true`. **The release fails if `breaking` is true and `UPGRADE.md` has no matching section**, so the warning text can never be forgotten.
4. Build and push multi-arch images with the tags above.
5. Scan, create SBOM and attestation.
6. Create the GitHub Release with the generated notes (with a "Security", "Breaking changes" and "Database migration" heading when they apply), the upgrade notes, `compose.yml` and `.env.example`, **and the `release-manifest.json` asset** (section 7).
7. Mark pre-release tags as "pre-release" and do not move `latest`.

**Release checklist (a template issue):** changelog and upgrade notes written; migration reviewed for data loss; new settings documented in `.env.example` and the Deployment page; screenshots updated; release candidate run on JC's own server for at least a few days; tag; verify the images pull and start on a clean machine (amd64 and arm64).

### Release automation, explained (accepted by JC, Nov 15)
**The chore it removes.** Every release means: pick the next version number, write the changelog from what changed, edit the version in several files, create the git tag and the GitHub Release. Done by hand this is easy to get wrong (a forgotten changelog line, a wrong number, a tag that does not match the files), and the update popup depends on the changelog and the manifest being right.

**How the automatic way works (the tool is called release-please, a free GitHub Action):**
1. You write commit messages in a fixed style, which this plan already uses (Conventional Commits): `feat: add family group sheet` (a new feature), `fix: keep date precision` (a bug fix), `feat!: rename BACKUP_KEEP` (a breaking change).
2. As changes land on `main`, the tool reads those messages and keeps **one open pull request called "Release 0.4.0"**. That pull request already contains the next version number (new features raise the minor, fixes raise the patch, a breaking change is flagged), the updated `CHANGELOG.md` grouped into New, Fixed and Breaking, and the bumped version in the files.
3. When you are ready to ship, **you merge that pull request**. That is the only manual step. The tool then creates the git tag and the GitHub Release, and the tag starts `release.yml` (tests, upgrade test, build, push images, manifest).
4. Nothing ships by accident: the release only happens when you merge the release pull request, and you can read and edit the changelog text first.

**Manual way:** you edit `CHANGELOG.md` and the versions yourself, run `git tag v0.4.0`, push, and `release.yml` does the rest. Fine for the first few releases, but the changelog and the update popup are only as good as your notes.

**Decision:** start manual for 0.1 (nothing to automate yet), switch on release-please from 0.2 once commits follow the style, because from 0.2 the changelog feeds the "What's new" popup and the breaking-change and migration warnings. It adds no running service and can be removed later without losing anything.

## 6. What ships in each version
**Is this too much for v1? Yes, and the plan trims it (JC agreed).** 1.0 should mean "the core is stable and safe", not "everything is built". Because the version number is not a size of scope, the remaining features ship as **1.1, 1.2 and so on**, not as a 2.0. A **2.0** is kept for a real breaking change (for example a new data model for adoption and guardians, or multiple linked trees).

The order puts **deployability first, data safety second, the family's privacy-sensitive features before public sharing**. Each version is a usable stopping point.

### Milestone 0, before any release: the stack (decided by JC, Nov 15)
**JC chose:**
| Part | Choice |
|---|---|
| Database | **PostgreSQL 18** (official `postgres:18` image). Supported by its makers until November 2030, the longest runway for self-hosters. Required for row-level security. |
| API | **TypeScript on Node** |
| Web container | **nginx** (the unprivileged Alpine image), serving the built UI and proxying `/api` |
| UI | **React** |

**My picks inside those choices (not yet confirmed by JC; each can be changed before the first release, and the written decision records them):**
- **API framework:** Fastify (mature plugins for OIDC, file upload streaming and rate limiting; Hono is the alternative). **Database access:** a SQL-first query builder such as Kysely, with plain hand-written `.sql` migration files and a small runner. **Prisma is dropped** because it handles row-level security (a database session per request that knows the signed-in user) and an owner role for migrations awkwardly, and the previous build used it.
- **UI build:** Vite, producing static files that the nginx image serves. The family tree is drawn as SVG by our own code, as in the mockup, not with a diagramming library (the scrapped build used React Flow).
- **Shared types:** the API and the UI share TypeScript types and translation keys from `packages/`, which was the main reason for choosing TypeScript on both sides.
- **Tests:** Vitest for units, Playwright for the browser smoke tests already in the pipeline.

**What the choices must still support** (a short written decision, an "ADR" in `docs/decisions/`, records how): Postgres row-level security with a non-owner app role and an owner role for migrations (hand-written SQL migrations are first-class); streaming encrypted files; S3-compatible storage (added in 1.1, but the file layer is built so a second backend can plug in); SMTP and Resend; OIDC; a small image; and **a dependency list that is compatible with AGPL-3.0**. The mockup's single-file structure is not the code layout; it is the specification. The previous Node/Express/Prisma build is scrapped.

**Postgres 18 note for the compose file:** the official 18 image changed where it keeps data (the volume is mounted one level higher, at `/var/lib/postgresql`, with a version folder inside). The example below uses that path; confirm it against the image documentation when writing the real file.

### v0.1.0 — "It runs" (alpha, data may be wiped)
Purpose: prove the whole delivery chain with the smallest useful app.
- Public repo (`officialJCReyes/kinship`) with README, AGPL-3.0 license, CI and the release pipeline; **images published to GHCR and public**; `compose.yml`, `.env.example`, `compose.dev.yml`.
- `web`, `api`, `db` start with health checks; migrations run at startup; `/api/version`; Admin → System shows health; About page with the version and source link.
- First-run setup (account, tree name, you); local login and logout; roles stored (SuperAdmin, Family Admin, Member, User) and checked by the API.
- People and relationships: add, edit, delete a person; parents, partners, children; one tree view (Family tree) with pan, zoom, fit; person panel; basic profile Facts.
- Light and dark theme following the device. English strings as translation keys from the first line of code.
- **Exit test:** a stranger follows the README on a clean machine and has a working tree in ten minutes.

### v0.2.0 — "A tree you can trust" (data promise starts)
- Full relationship model: statuses and dates, children hanging from the union, maiden and married surnames, custom labels, derived step and half relatives, widowed set automatically.
- Add relative as in the mockup (diagram of cards with plus buttons; Member = children only); Edit details; flexible date entry and per-user date format; profile photos; Media upload to local storage, **encrypted before it is stored**.
- Seven-step first-run wizard; My settings; the four color schemes.
- **Built-in backup and restore** (local destination, encrypted archive, test and restore buttons, command line), because real data starts here. Automatic pre-migration safety copy.
- **Admin → Updates:** update check toggle, banner, "What's changing" popup with the backup warning, and the "What's new" popup for admins after an update (section 7).
- Upgrade test in the pipeline begins to run.
- Invites by copied link (email comes in 0.4); password change.
- Permissions: Admin edits all, Member own profile and descendants, User read only.

### v0.3.0 — "See the family"
- All four chart views (Pedigree, Fan, Descendants) and the view switcher; the spouse's family leaf and flip; tree legend; centered page layouts.
- Relationship finder with cousin levels, half and in-law and step names, the "once removed" explainer.
- People search and a quick find box; Home with Memory of the day and Coming up; Jump to shortcuts.
- Timeline and map (OpenStreetMap by default).
- Performance target: 2,000 people draw and pan smoothly.

### v0.4.0 — "Email, sign-in and notifications"
- Email through Resend or SMTP with the editable templates and a test button; invites and password resets by email.
- Authentik OIDC single sign-on with the local login fallback; the linking of an account to one person.
- In-app bell; birthday notifications (lead times, children under 18 excluded), remembrance days, optional weekly digest. **The update notice also appears in the SuperAdmin's bell** (no email).
- Deployment page and Admin → System status for email and storage.

### v0.5.0 — "Research records"
- Sources library, repositories, citations on birth, death and cause of death, reliability; typed life events; Places library with coordinates and merge; Stories and notes; Archive tab.
- Members can add sources, places and stories; Users read only.
- Files on facts. Duplicate people finder and **merge with 30-day undo** (it is needed once GEDCOM import exists, so it stays in 1.0).
- Tree-wide change history (who changed what), since several people now edit.
- Data check report.

### v0.6.0 — "Health, and privacy done right" (the most sensitive release)
- Medical history on each profile: blood type, searchable conditions, cancer type, statuses; custom conditions with admin merge.
- **Per-person sharing enforced by Postgres row-level security**, deceased records visible to all, private conditions, cause of death visible to all; edits by admins logged and notified.
- Reports that respect it: medical patterns, **family health history for a doctor** with the "left out because not shared" counts.
- Security review focused on this release: a test suite that logs in as every role and tries to read every record that should be hidden, run on every pull request from now on.
- Release notes say plainly what is private and what is not.

### v0.7.0 — "Reports, import and export"
- Core reports: life summary, family group sheet, ancestors and descendants outlines, data check; **print and PDF, and plain text**; sources as footnotes.
- **GEDCOM 5.5.1 import** (with a preview and a list of what was skipped) and **export** (living people shown as "Living"); Import & export page.

### v1.0.0-rc.1, rc.2 — "Release candidates" (no new features)
- Security review of the whole app; accessibility pass (keyboard, screen reader, contrast in all four schemes and both themes); mobile pass.
- Load test at 10,000 people and 50 accounts; backup and restore of a large tree.
- **Upgrade test from every earlier release** back to 0.2.
- Documentation: install on Linux, Synology and Unraid examples, Raspberry Pi note, reverse proxy examples (Caddy, Nginx Proxy Manager, Traefik, Cloudflare Tunnel), backup and restore, upgrade, every setting, troubleshooting.
- Translation guide so the community can add languages.
- Demo instance (read-only, fictional family) and screenshots.
- Fix list from at least two weeks of JC's family using it.

### v1.0.0 — "Stable"
**What 1.0 contains:** everything in 0.1 to 0.7, the update notification and What's new popup, and the hardening above.

**Release criteria**
1. A new user installs from the README in ten minutes, on amd64 and arm64.
2. Upgrade from every 0.x release from 0.2 keeps all data; restore of a backup into a new server works with the key and passphrase kept separately.
3. The role and privacy test suite passes; no open high or critical vulnerabilities in the images.
4. Every feature in "What 1.0 contains" is shipped, and everything moved to 1.x is written in the release notes.
5. Docs, license, security policy and contribution guide are in place.

### After 1.0 (minor releases, in the order I would do them; JC can reorder)
- **1.1 — Storage and polish:** S3 and S3-compatible storage with the migrate-between-backends tool, S3 as a backup destination, MapTiler as the keyed map provider, Word (.docx) output, the family book, the birthday and anniversary list, rate limiting and session management extras.
- **1.2 — DNA (basic):** DNA tab on profiles (tests table, haplogroups, ethnicity estimate, admin upload on someone's behalf with the permission checkbox), the orange tree badge, the Health and DNA admin overview, Y-DNA and mtDNA lines. Visible to every account as decided; raw files private and encrypted.
- **1.3 — DNA matches:** match lists, the cM check against the tree (ranges verified against published shared-cM data first), "good people to test next".
- **1.4 — Sharing and safety:** suggest-a-change approval for Members, two-factor login and passkeys, calendar feed (ICS), hourglass chart, paternal and maternal line highlight, a people list view.
- **1.5 — Research tools:** research to-dos, alternate names and date ranges, Gramps XML import, a per-user default chart view, printing a chart as a poster.
- **2.0 (only if needed):** adoptive, foster and guardian relationships (paused by JC) or multiple linked trees, if they require changing the data model.

### Summary table
| Version | Theme | Data safe? |
|---|---|---|
| 0.1 | It runs: pipeline, images, one tree view | No, may be wiped |
| 0.2 | A tree you can trust: relationships, add relative, backup, update notice | **Yes, from here** |
| 0.3 | All views, finder, search, timeline and map | Yes |
| 0.4 | Email, invites, SSO, notifications | Yes |
| 0.5 | Sources, places, stories, merge, change history | Yes |
| 0.6 | Health and private sharing (row-level security) | Yes |
| 0.7 | Core reports, GEDCOM import and export | Yes |
| 1.0-rc | Hardening, docs, upgrade tests | Yes |
| **1.0** | **Stable core** | Yes, with the compatibility promise |
| 1.1 | S3, MapTiler, Word, family book | Yes |
| 1.2, 1.3 | DNA, then DNA matches | Yes |
| 1.4, 1.5 | Approvals and 2FA, research tools | Yes |

## 7. Update notice and "What's new" (decided by JC, Nov 15; built in the mockup)

### Settings (Admin → Updates, SuperAdmin only)
- **Check for new versions:** one toggle inside the app, stored in the database. **There is no environment variable for it** (JC's decision), so it survives upgrades and is changed in the app. Default on, because JC asked for the notification; the toggle states plainly what is contacted.
- **Include pre-releases:** off by default.
- **Safety copy before a database change:** on by default (section 4).
- The tab also shows the running version, the database schema number, the time of the last check and the result ("Up to date", "0.6.0 available" or "Checking is off"), a **Check now** button and a note that KinShip never updates itself. Family Admins see a note that only a SuperAdmin manages update checks.
- **No email.** The notice appears in the app only: a banner across the top of the Admin pages and an item in the SuperAdmin's bell (from 0.4).
- On an install with no outbound internet the check fails quietly and says so, with the time of the last successful check. The toggle can then be turned off.

### How the check works
- A daily job in the `api` (the same in-app job runner as birthdays; no new container) reads GitHub's public releases list for `officialJCReyes/kinship`, using a conditional request so an unchanged answer costs almost nothing. No account or token is needed. A **Check now** button runs it on demand.
- **Nothing about the installation is sent**: no version, no instance name, no user count. The request is a plain read of public data (GitHub sees the server's IP, as with any download).
- Each release has an attached **`release-manifest.json`** made by the pipeline, which the app reads instead of guessing from free text:
```json
{ "version": "0.4.1", "date": "2026-12-02", "channel": "stable",
  "security": false, "breaking": false, "migration": true,
  "upgradeFrom": "0.2.0", "notes": "…markdown of this release…",
  "upgradeNotes": "…markdown, present when breaking or migration…" }
```
- The app takes **every stable release newer than the running version** (not only the latest), so someone three versions behind sees all the changes together, with the warning flags combined (any `security`, `breaking` or `migration` in the range turns the flag on).
- Versions are compared as SemVer (`0.10.0` is newer than `0.9.0`). The server needs outbound HTTPS to `api.github.com`; `HTTPS_PROXY` is honored.

### What the SuperAdmin sees
1. **Banner** across the top of the Admin pages and an item in the **bell**: "KinShip 0.6.0 is available. You are on 0.5.0." with the line "Includes a database change. Back up first." (or breaking changes) when it applies, and a red **Security update** label when any release in the range is marked security. Buttons **What's changing** and **Dismiss**; dismissing hides it for that version, and a newer version notifies again. Family Admins and below never see the notice.
2. **Clicking the notice (or the bell item) opens the popup "What's changing"**:
   - Title with the version range ("KinShip 0.5.0 to 0.6.1 · 2 releases") and a **Security update** label when it applies.
   - **The backup warning box (below) when it applies.**
   - The changes, one block per release, newest first, each with its date, labels (Security, Breaking change, Database change) and lists grouped as Security, Breaking changes, New, Improved, Fixed, plus the release's **upgrade notes** when it has some.
   - **How to update:** change both image tags in `compose.yml`, run `docker compose pull && docker compose up -d`, sign in. A Copy button copies the commands. The notice never updates the app itself: it cannot change its own containers.
   - Buttons: **Remind me later** and **Close**.

### Backup warning (required when a release has a migration or a breaking change)
- The popup shows an amber box at the top: **"Back up before you update."** Under it: "This update changes the database structure" (migration) and/or "This update has breaking changes. Read the upgrade notes below."
- It shows **when the last backup was taken**. If it is older than 24 hours the age is a red label ("6 days ago") and **Back up now** is the main button.
- **The update steps stay hidden** until a backup from the last 24 hours exists (after pressing Back up now) **or the SuperAdmin ticks "I have a backup I can restore"** (a soft gate; the app cannot stop someone running Docker by hand, but the warning cannot be missed).
- The same message is in the banner text and the bell item, so it is visible before the popup is opened.
- Releases with neither flag show no warning box, only a plain line that a recent backup is still wise.
- The automatic pre-migration safety copy is mentioned in the box as extra protection, not a replacement (or "turned off" when it is).
- The GitHub release notes, `UPGRADE.md` and the README carry the same warning, so it also appears for people who never open the app.

### "What's new" popup after an update (to every admin)
- **Who sees it (decided by JC, Nov 15): every admin, SuperAdmin and Family Admin, the first time they sign in after the version changed.** The app compares the version each admin last saw (stored on their account) with the running version. Members and Users do not see it. Anyone can reopen the latest one from the account menu → **About KinShip** → **What's new**.
- Title **"KinShip was updated to 0.6.0"**, with the version they came from.
- Content comes from the **`CHANGELOG.md` bundled inside the image**, so it works with no internet and always matches the running version. If several versions were skipped it lists all of them.
- Shows: a note when the **database was migrated** (schema number before and after, and the name of the safety copy that was written, or that the copy was off); any **breaking change instructions** still to do, in an amber box titled "Check this now"; the changes grouped like above.
- Buttons: **Got it** (closes and records the version) and **View full release notes**.
- A fresh install shows no popup, and a downgrade (restoring an older backup) shows a small notice that the version went down.

### About KinShip (also from the AGPL decision)
Account menu → **About KinShip** shows the version, schema, build, license (AGPL-3.0-or-later), a **Source code link** to the repository and the sentence that anyone running a modified copy for others must offer them its source, plus the **What's new** button.

### First-run wizard
The last step has a short note that KinShip checks for new versions once a day by reading GitHub's public release list, sends nothing about the install, and can be turned off in Admin → Updates.

### Why GitHub and not an update server of our own
One more thing to run and secure; GitHub already publishes the release feed, and the manifest makes it machine-readable.

## 8. Deployment experience for a new user
1. Install Docker. 2. Download `compose.yml` and `.env.example`, copy to `.env`, set the database password, the file encryption key and (optionally) email, storage and map settings. Docker secrets (`*_FILE`) are supported for anyone who prefers them. 3. `docker compose up -d`. 4. Point a reverse proxy at port 8080 (examples for Caddy, Nginx Proxy Manager, Traefik and Cloudflare Tunnel). 5. Open the site; the first-run wizard creates the SuperAdmin and the tree. The last step names the update check and its toggle. 6. Turn on backups and store the file key and backup passphrase somewhere other than the server.

**Upgrade:** the SuperAdmin sees the update notice (section 7) and opens "What's changing"; if there is a database change or breaking change, takes the backup the popup asks for; changes the version tag in `compose.yml`; `docker compose pull && docker compose up -d`. On the next sign-in each admin gets the "What's new" popup confirming the new version and any migration. **Rollback:** put the old tag back and restore the backup.

Example `compose.yml` shape (three services, only `web` published):
```yaml
name: kinship
services:
  web:
    image: ghcr.io/officialjcreyes/kinship-web:0.3.1
    ports: ["8080:8080"]
    depends_on: { api: { condition: service_healthy } }
    restart: unless-stopped
  api:
    image: ghcr.io/officialjcreyes/kinship-api:0.3.1
    env_file: .env
    depends_on: { db: { condition: service_healthy } }
    volumes: ["kinship-files:/data/files", "kinship-backups:/data/backups"]
    restart: unless-stopped
  db:
    image: postgres:18
    environment:
      POSTGRES_USER: kinship
      POSTGRES_DB: kinship
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    volumes: ["kinship-db:/var/lib/postgresql"]   # Postgres 18 images keep data in a version folder under this path
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U kinship"], interval: 10s }
    restart: unless-stopped
volumes: { kinship-db: {}, kinship-files: {}, kinship-backups: {} }
```
(The exact fields are finalized when the first release is built. There is no update-check variable; that setting lives in the app.)

## 9. Public-repo safety
- No real names, photos, GEDCOM files, dumps or `.env` files ever committed (`.gitignore`, a pre-commit secret scan and GitHub push protection).
- The demo and test data are the fictional Hale family only.
- The medical and DNA examples in docs and screenshots use fictional people.
- Dependency and image scanning in CI; a SECURITY.md with a private reporting address and the supported-versions line; a public statement of what the app does and does not do with health data.
- The design docs in `design/` contain JC's decisions, not personal data; review them once before making the repo public (it is public from day one, so do this before the first push).

## 10. Decisions
**Decided (Nov 15):** AGPL-3.0; owner officialJCReyes; public from day one; trimmed 1.0; update check is an in-app toggle (no variable); no update email; click the notice for a popup of changes; What's new popup after an update, shown to every admin; backup warning on any migration or breaking change; automatic safety copy before a migration on by default; update notice, popups and About page built in the mockup; **stack: PostgreSQL 18, TypeScript API, nginx `web` container (separate, three services stay), React UI**; **support policy: newest release only**; **release automation: manual for 0.1, release-please from 0.2**.

**Proposed, waiting for JC's yes**
1. **Library picks inside the stack** (section 6): Fastify, Kysely with plain SQL migrations, Vite, own SVG tree drawing, Vitest and Playwright.

**Still open:** nothing blocks starting the repository. The mockup's final approval is JC's call.

## 11. Risks
- **Health privacy is the highest risk.** It is why 0.6 has its own security review and a permanent role-by-role test suite.
- **Upgrade data loss** is the second. It is why the upgrade test, the built-in backup, the pre-migration safety copy and the backup warning exist, all before anyone is told to use real data.
- **One maintainer.** Keep releases small, automate changelogs and tags, and avoid promising fast support (hence the newest-release-only support policy).
- **Scope.** Even the trimmed 1.0 is large; the milestone order lets JC stop at any version and still have something that works. Any feature can be moved to 1.x without blocking the release.
- **The update check relies on GitHub being reachable.** It fails quietly and shows the last successful check, so a blocked network never breaks the app.
- **AGPL and dependencies:** every dependency's license is checked in CI so the project can stay AGPL-compliant.
- **Postgres major upgrades** are a chore for self-hosters; choosing 18 pushes the first forced upgrade out to about 2030.
