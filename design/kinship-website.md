# KinShip project website (Nov 18, 2026)

Companion to `kinship-release-and-deployment-plan.md` (sections 4 and 5). The site is the public face of the project: a small static website in `site/`, published to GitHub Pages at `https://officialjcreyes.github.io/kinship/` (no custom domain yet). Built Nov 18 (PR #114); the chart view tabs on the home page and the name wrapping followed in #115 and #116.

## What it is
- Plain HTML and CSS, no build step, no web fonts, no third-party requests, no trackers. One small script (`site/assets/site.js`) switches the chart tabs on the home page.
- Pages: Home, Features, Get started, Docs (backup and restore, with a sidebar of GitHub-linked articles), Roadmap, About, and a 404.
- Every link is relative or points at GitHub, so it works under `/kinship/` and on a custom domain unchanged.
- The home page shows the **Darwin-Wedgwood family** from public records as an illustration (Family tree, Pedigree, Fan and Descendants). Pedigree, Fan and Descendants are previews until 0.3 ships them, and the page says so. Real screenshots replace the illustration once the demo exists.
- Published by `.github/workflows/pages.yml` (workflow name "Website"). Pages must be set to Source: GitHub Actions (done Nov 18).

## The current version is automatic (decided by JC, Nov 18; ADR 0022)
- The pages state the current version in a handful of places: the footer on every page, the hero badge on the home page, the "Install x.y.z" call to action, and the pinned image tag and "Version" chip in Get started. In `site/` each one is written as **`@@VERSION@@`**.
- The Website workflow copies `site/` to `_site/` and replaces `@@VERSION@@` with the version of the **latest published GitHub Release** (stable only; release candidates are pre-releases and never count). It fails if the latest tag is not `x.y.z` or if a placeholder is left behind.
- **When it runs:** on a push to `main` that changes `site/` or the workflow; **after the Release workflow finishes successfully on a pushed version tag** (`workflow_run`; dry runs and pull requests are ignored); and by hand.
- **Why the Release workflow and not the release pull request:** release-please's pull request changes the version files before the images exist, and the tag is made later by hand. The Release workflow creates the GitHub Release only after the images are pushed and smoke-tested, so the site can never announce a version nobody can pull.
- Opening `site/` files straight from disk shows the placeholder. That is expected; `site/README.md` has the preview commands.

## What stays hand-written
The version number is the only automatic part. Wording that depends on what a release contains is edited by a person, **in the same pull request as the feature** or in the release pull request:
- **Roadmap page:** a release's status chip (Planned, In progress, Published) and its list.
- **Features page:** each feature's chip ("Soon", "0.3", "0.2.0") and any "arrives in 0.x" sentence.
- **Home page:** the "arrive in 0.3" sentence under "Four ways to see one family", and the previews note under the chart picture.

## Release checklist, website line (added Nov 18)
After merging the release pull request and **before** tagging: update the Roadmap and Features pages (status chips, "Soon" labels, "arrives in" sentences) so they describe the release. The tag then publishes the version number on its own. After the Release workflow finishes, open the site and check that the version shows the new number. (This line belongs in the release checklist of `kinship-release-and-deployment-plan.md` section 5; add it there the next time that doc is edited.)

## Commit types for site work
`feat(site):` and `fix(site):` count as user-facing for release-please, so they can raise the next version (the first two site commits made it propose 0.3.0 before any 0.3 feature existed). Use **`docs(site):`** or **`chore(site):`** for website-only changes. Reserve `feat` and `fix` for changes to the app.

## Open
- Real screenshots for the home page after the demo exists (the Darwin-Wedgwood demo; host not decided: home VM behind a Cloudflare Tunnel, or a small droplet).
- A custom domain, if JC buys one. The site uses only relative links, so it should need no changes.
