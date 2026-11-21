# 0030. The website's Docs move to Starlight

- Status: **Accepted** (decision by JC, 2026-11-21)
- Date: 2026-11-21
- Supersedes: [0023 The website's Docs are built from the repository's Markdown](0023-docs-on-the-site-from-the-repository.md) (the build tool changes; the principle that the Markdown files are the only copy stays)
- Builds on: [0022 The website shows the latest released version on its own](0022-website-version.md)
- Code: `apps/docs/`, `.github/workflows/pages.yml`, `pnpm-workspace.yaml`. Design note: `design/kinship-website.md`.

## Context

ADR 0023 built the Docs with a script and pandoc into the site's own template. That worked, but it left the project to
maintain its own documentation theme: the sidebar markup, the "On this page" list, tables, code blocks and the narrow-screen
layout were all hand-written CSS, and there was no search. The Docs are meant to grow (more pages, more release notes).

## Decision

- **Starlight (Astro) builds the Docs.** `apps/docs` is a pnpm workspace package. It is published under `/docs/` of
  `https://kinshiptree.app/` (Astro `base: '/docs'`), so every existing address and heading anchor keeps working. No
  subdomain.
- **The Markdown files stay the only copy.** `apps/docs/scripts/sync-docs.mjs` copies `INSTALL.md`, `UPGRADE.md` and
  `docs/backup-format.md` into Starlight's content folder before every dev and build. Nothing it writes is committed. It adds
  the front matter, an "Edit page" link to the source file on GitHub, points links between the documents at their pages and
  other repository files at GitHub, and fails on a link to a file that is not in the repository. Starlight's heading ids are
  GitHub's, so `INSTALL.md#updating` style links still land.
- **Three documents, as before.** CHANGELOG, CONTRIBUTING and the ADRs still link to GitHub from the sidebar. They can be added
  to `DOCS` in `apps/docs/scripts/docs.mjs` later; the ADRs would need an index page.
- **Broken links still stop the build.** `starlight-links-validator` checks every link inside the built pages, and
  `apps/docs/scripts/sync-docs.test.mjs` checks every sidebar anchor against the headings that really exist. `pnpm build` in
  the "Lint, format, typecheck, build" job builds the Docs, so the failure shows in the pull request that causes it.
- **Search comes with Starlight** (Pagefind, built into the static output, no third-party requests).
- **The landing page, the sidebar and the KinShip colours are hand-written** (`apps/docs/src/content/docs/index.mdx`,
  `apps/docs/scripts/docs.mjs`, `apps/docs/src/styles/kinship.css`).
- **The Website workflow** installs Node and pnpm (as CI does), builds the Docs, copies the result to `_site/docs/`, and then
  fills in `@@VERSION@@` as before (ADR 0022). Starlight's own 404 page is dropped; the site keeps its own at the root.
  pandoc is no longer used anywhere.
- **No image optimization in the Docs.** Astro's image service needs `sharp`, whose prebuilt libvips binaries are
  LGPL-3.0-or-later and not on the license allow list. The Docs have no images that need optimizing, so
  `astro.config.mjs` uses Astro's passthrough image service and `pnpm-workspace.yaml` tells pnpm not to install `@img/sharp-*`
  (`ignoredOptionalDependencies`). The license check passes with no new exception. If images that need optimizing are added
  later, that is a new license decision (add a named exception for the libvips packages, with a reason).

## Consequences

- The Docs now add Astro, Starlight and a few hundred packages to the pnpm workspace, the lockfile, the license check and
  Dependabot (the `/apps/*` entry already covers `apps/docs`). They are build tools: nothing from them is in the api or web
  image (both install with `--filter`).
- The Docs no longer share the site's exact header and footer. They carry the KinShip logo, colours and a link to GitHub; a
  header link back to the rest of the site and the version in the footer need the Starlight component overrides (not done in
  this change).
- Opening `site/docs/` from disk was already impossible; preview with `pnpm --filter @kinship/docs dev`.
- The Website workflow needs Node and pnpm and takes a little longer than the pandoc build did.

## Alternatives considered

- **Keep the pandoc build (ADR 0023).** No new dependencies, but the project keeps maintaining a documentation theme and has no
  search.
- **A separate `docs.kinshiptree.app`.** New DNS and Pages setup, and every old `/docs/...` address would need a redirect.
- **Another documentation tool (Docusaurus, VitePress, MkDocs).** Any would do the job. Starlight ships static HTML with search
  built in and little client script, and keeps the site's "no third-party requests" rule.
