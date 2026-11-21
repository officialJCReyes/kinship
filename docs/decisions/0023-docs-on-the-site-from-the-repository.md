# 0023. The website's Docs are built from the repository's Markdown

- Status: **Superseded by [0030](0030-docs-in-starlight.md)** (was accepted 2026-11-19)
- Date: 2026-11-19
- Builds on: [0022 The website shows the latest released version on its own](0022-website-version.md)
- Code: `scripts/build-docs.mjs`, `scripts/site-docs/`, `.github/workflows/pages.yml`, `scripts/build-docs.test.mjs`. Design note: `design/kinship-website.md`.

## Context

The website's Docs section was one hand-written page (backup and restore) whose sidebar linked to the Markdown files on GitHub. The real instructions live in `INSTALL.md`, `UPGRADE.md` and `docs/backup-format.md`, and the hand-written page was a second copy that had already drifted (it still named a file encryption key that 0.2 does not have). Visitors also had to leave the site to read the install guide.

## Decision

- **The Markdown files stay the only copy.** The Website workflow runs `node scripts/build-docs.mjs _site` after copying `site/`, and the script turns `INSTALL.md`, `UPGRADE.md` and `docs/backup-format.md` into `/docs/install/`, `/docs/upgrade/` and `/docs/backup-format/`, plus a `/docs/` landing page, all in the site's own template (`scripts/site-docs/template.html`). Nothing generated is committed.
- **pandoc does the conversion** (`-f gfm`, installed with apt on the runner). It gives the same heading ids GitHub does, so old links such as `INSTALL.md#updating` keep working on the site. It is a build tool, not a dependency of KinShip: nothing is added to `package.json` or the lockfile, and the script itself uses only Node's built-in modules.
- **The build fails instead of publishing a broken page.** A relative link to a file that is not in the repository, a link between pages to a heading that does not exist, and a sidebar entry whose heading was renamed all stop the build. Links to other repository files (ADRs, `SECURITY.md`) become GitHub links.
- **The same check runs on every pull request.** `scripts/build-docs.test.mjs` builds the real documents in the existing "Lint, format, typecheck, build" job (pandoc is installed there), so a broken link is found in the pull request that causes it, not after merge.
- **The workflow also runs when those files change**, not only when `site/` does, so a merged change to `INSTALL.md` is on the site within minutes.
- **The landing page and the sidebar are hand-written** (in the script and `scripts/site-docs/index.body.html`), because they describe the site, not a document. The sidebar's links into a page are checked against the headings that are really there.
- The Docs build comes after the copy and before the version is filled in, so the footer of every generated page gets `@@VERSION@@` replaced like any other page (ADR 0022).

## Consequences

- The site has a build step now. It is one command and one tool, and `site/README.md` says how to run it.
- Opening `site/docs/` straight from disk no longer works; build into a folder and serve it (see `site/README.md`).
- Documentation changes are made once, in the Markdown, in the same pull request as the code. Headings that the sidebar links to (first-run setup, reverse proxy, inviting people, updating, backup and restore, troubleshooting) must keep their names, or the sidebar in `scripts/build-docs.mjs` is changed in the same pull request; the build tells you.
- The pandoc on the runner (Ubuntu 24.04) is newer than some local installs. The page markup the script relies on (`<pre>`, `<table>`, heading ids) is the same in both; the test builds the real documents to catch a difference.
- **Not done here:** `CHANGELOG.md`, `CONTRIBUTING.md` and the ADRs still link to GitHub. They can be added to `DOCS` in the script later; the ADRs would need an index page.

## Alternatives considered

- **Hand-written pages plus a CI check that fails when `INSTALL.md` changes and the page does not.** No build step, but two copies that people must keep equal by hand, and the check can only say "something changed", not what.
- **Keep linking out to GitHub.** Nothing to maintain, but visitors leave the site and the old hand-written page keeps going stale.
- **A Markdown library from npm (such as marked) in the pnpm workspace.** It would work, but adds a dependency to the lockfile, the licence check and Dependabot for something that runs once per deploy; pandoc adds none.
