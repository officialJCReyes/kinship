# 0015. The update check, the "What's changing" and "What's new" popups, and the version check between web and api

- Status: **Accepted** (decisions by JC, 2026-11-16, after the step 17 phase 1 report)
- Date: 2026-11-16
- Builds on: [0003 Accounts and sessions](0003-accounts-and-sessions.md), [0004 Releases and images](0004-release-and-images.md), [0014 Backups and owner access](0014-backup-and-owner-access.md)
- Sources: `design/kinship-release-and-deployment-plan.md` (sections 3, 4, 7), `design/kinship-navigation.md` ("Admin → Updates", "About KinShip"), the mockup's Updates screens. Where they differ, this record says so.

## Context

A SuperAdmin must hear that a new version exists, see what it changes, and be warned to back up before a database change; every admin must see what an update changed once, offline. The rules from CLAUDE.md apply: the check is an in-app toggle stored in the database (never an environment variable), there is no update email, and nothing about the installation is sent.

## Decisions

### The manifest generator already exists; step 17 fixes and proves it
`scripts/release-info.mjs notes` has produced `release-manifest.json` since alpha.1 (alpha.2's release carries one). Step 17 does **not** build another. It fixes four gaps (PR 1):
- The manifest was only made in the `release` job, which dry runs and pull requests skip. It is now also made, validated and kept as a workflow artifact in the read-only `prepare` job in every mode. Nothing is published.
- A stable release with no earlier stable tag (0.2.0 before 0.1.0 is tagged) was compared with nothing, so its migration and breaking flags were silently false. It now falls back to the latest earlier tag of any kind.
- The CHANGELOG heading matcher understood only `## [x.y.z] - date`. It now also reads release-please's `## [x.y.z](compare-url) (date)` and `## x.y.z (date)`.
- `notes` and `upgradeNotes` are capped at 20,000 characters, and `validateManifest` (also `release-info.mjs validate <file>`) checks the contract. `upgradeFrom` stays null: no part of the app uses it yet, and the plan does not say what it means.
Step 18 wires this to release-please.

### Where the data lives (migration 0014, additive; later PR)
- `app_settings` keys `updates.check` (default on) and `updates.prereleases` (default off); the safety-copy switch keeps `safety_copy`. Shared parsers, like the backup settings.
- A single-row table `update_check` for the state of the check (times, status, ETag, parsed releases). SuperAdmin-only select; the owner connection writes it, as ADR 0014 allows for jobs started by the scheduler or a SuperAdmin-only route.
- Four columns on `users`: `last_seen_version`, `last_seen_at`, `update_dismissed_version`, `update_backup_ack_version`. A BEFORE INSERT trigger fills `last_seen_*` from `schema_info.app_version`, so a fresh install and every new account start current and see no popup. An account that predates tracking has NULL, treated as `0.1.0-alpha.2` (the last release that did not track it).

### The check
A daily job in the api, run by a small shared job runner (`apps/api/src/jobs/runner.ts`; birthdays in 0.4 become another job; the backup scheduler registers with no change of behavior). The next check is stored with a random 0 to 2 hours of jitter and survives restarts; failures back off from 1 hour to 24. One conditional request (`If-None-Match`) to the fixed URL `https://api.github.com/repos/officialJCReyes/kinship/releases?per_page=100`, with a constant user agent that carries no version, no token and no cookies. A 304 does not count against GitHub's 60 requests an hour for anonymous callers.
- Manifests are fetched only for stable releases newer than the running version that are not yet cached (at most 30 per check). The URL is rebuilt from the tag, never copied from the response. Redirects are followed by hand: at most 3, HTTPS only, and only to `github.com` and GitHub's `githubusercontent.com` hosts (release assets are served from there). Limits: 10 seconds a request, 2 MiB for the list, 128 KiB a manifest.
- `HTTPS_PROXY` and `NO_PROXY` are honored with Node's own `http.setGlobalProxyFromEnv()`, no new dependency. The proxy value is never logged or returned.
- A release with no manifest, or an invalid one, shows GitHub's release text and is treated as "details unavailable, back up first". A manifest whose version is not the tag is rejected. `channel` is cross-checked with GitHub's `prerelease` flag and the stricter wins.
- With the toggle off nothing is sent and Check now answers 409. With no internet the check fails quietly and the Updates tab shows the time of the last good one.
- The range (every stable release newer than the running version; pre-releases only when asked) is computed when read, so a version change or a switch needs no new request.

### Notes are untrusted text
Release and upgrade notes come from the internet and are shown to the SuperAdmin. They are rendered by a small renderer of our own (about 150 lines, no dependency) that builds React elements: raw HTML is shown as text, links are `http(s)` only with `rel="noopener noreferrer nofollow"`, images become link text. The CSP needs no change (the fetch is server-side).

### What's new
Every admin sees it once at the first sign-in after the version changed (SuperAdmin and Family Admin). The content comes from the `CHANGELOG.md` and `UPGRADE.md` bundled in the api image (so it works offline): the sections in `(last seen, running]`, newest first, with a stable release's pre-release sections folded away. "The database was migrated" comes from `upgrade_log` rows newer than the admin's last acknowledgement. "The version went down" comes from a `restore` row whose `from_version` is greater than its `to_version`; for that, the restore command now records the live version before the restore as `from_version` (it recorded the backup's). A patch release with no migration leaves no `upgrade_log` row; the popup then has the changelog and no database note.

### The backup warning
It reads the last successful backup time from `GET /api/admin/backups`. A migration or breaking change in the range with no backup in the last 24 hours hides the update steps until a backup exists or the SuperAdmin ticks "I have a backup I can restore". The tick is stored per target version on the account (`update_backup_ack_version`).

### The web and the api must be the same version
nginx adds `X-KinShip-Web-Version` to every proxied request (the version is written into the config at image build, from `package.json`). The api compares it with its own version and, on a difference, logs once and answers **503 `version_mismatch`** to every `/api/*` request except `/api/health` and `/api/version`. A request without the header is not checked (the Vite dev server). The plan said "refuses to start"; the api cannot see the web container at start, so it refuses requests. The web app shows a full-page message for that error that names both versions and what to change.

## Where this differs from the docs and the mockup
- The mockup shows the banner twice on the Updates tab; the real page shows it once, above every Admin tab.
- The mockup names the safety copy `pre-upgrade-0.5.0-to-X.sql.gz`; the real name is `pre-upgrade-0012-to-0013.tar.enc` (schema numbers).
- The mockup's About is a modal; the built one is the `/about` page. The mockup groups notes as Security, Breaking changes, New, Improved and Fixed; the CHANGELOG is free-form today and release-please writes Features and Bug Fixes, so headings are mapped and unknown ones are kept as written.
- The plan says the update check uses "the same in-app job runner as birthdays"; there was none, so the small shared runner above is new.
- The bell item comes in 0.4. In step 17 the update notice is the banner only.

## As built (differences from the plan above)
- In What's changing the notes of each release are shown as that release's own Markdown (with its own headings), not regrouped into Security, Breaking changes, New, Improved and Fixed. What's new does regroup, from the changelog.
- `GET /api/updates/whats-new?latest=1` returns the running version's section whatever was seen, for the About button.
- The scheduled job reads the database's next-check time again when it is due, so a second api container or an earlier run is respected; turning checking on makes the next tick check at once.
- The e2e stack switches the check off from the start (a setting in the database) and journey 12 writes what a check would have found, so no test contacts GitHub.
- Every scan of the Markdown renderer looks at most 2,000 characters ahead; an unmatched `[` or `<` in a long text was quadratic before.
- The release's settings file is attached as `env.example`: GitHub drops a leading dot, and `.env.example` became `default.env.example`.

## Consequences
- A third row-level-security surface (`update_check`) and four columns on `users`; all additive.
- The api image grows by `CHANGELOG.md` and `UPGRADE.md` (about 25 KB).
- Step 18's upgrade test asserts the `upgrade_log` row and the What's new content. Its first run upgrades alpha.2, which has no `app_version`, so `from_version` is null there.
