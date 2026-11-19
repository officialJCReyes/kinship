# KinShip project website (Nov 19, 2026)

Companion to `kinship-release-and-deployment-plan.md` (sections 4 and 5). The site is the public face of the project: a small static website in `site/`, published to GitHub Pages at **`https://kinshiptree.app/`** (custom domain, HTTPS enforced; `www.kinshiptree.app` also works). Built Nov 18 (PR #114); the chart view tabs and the name wrapping followed in #115 and #116; the Demo page in #125.

## What it is
- Plain HTML and CSS, no build step, no web fonts, no third-party requests, no trackers. One small script (`site/assets/site.js`) runs the chart tabs on the home page.
- Pages: Home, Features, **Demo**, Get started, Docs (backup and restore, with a sidebar of GitHub-linked articles), Roadmap, About, and a 404.
- Links are relative or point at GitHub. The one exception is `404.html`: GitHub serves it for any missing address, so its links start with `/` (`/assets/site.css`, `/features/`). That is right at the root of a domain and would be wrong under `/kinship/`; it was fixed on Nov 19 when the custom domain went live.
- The home page shows the **Darwin-Wedgwood family** from public records as an illustration (Family tree, Pedigree, Fan and Descendants). The four views **take turns every 2 seconds** on their own. The tour pauses while the pointer or keyboard focus is on the picture, waits in a background tab, does not start for visitors who ask for reduced motion, and stops for good when a visitor clicks a tab. Pedigree, Fan and Descendants are previews until 0.3 ships them, and the page says so. Real screenshots replace the illustration once 0.3 is out.
- Published by `.github/workflows/pages.yml` (workflow name "Website"). Pages must be set to Source: GitHub Actions (done Nov 18).

## The Demo page (`site/demo/`)
- It points at the live demo, `https://demo.kinshiptree.app`, and shows the **public visitor sign-in** (a read-only User account linked to Charles Darwin) and a notice that **the demo resets every night at about 08:00 UTC** and is offline for about a minute.
- The demo is a real KinShip install of release 0.2.0 on a DigitalOcean droplet, reached through a Cloudflare Tunnel (the droplet opens no inbound ports). It is filled with the Darwin-Wedgwood family (34 people, 6 unions; names, years and relationships from Wikipedia, years only apart from Emma Wedgwood and the 1839-01-29 marriage; no portraits until 0.3).
- The deployment files (`compose.tunnel.yml`, `seed.py`, `reset.sh`, `darwin-wedgwood.json`, `SETUP.md`) live on the droplet in `/opt/stacks/kinship-demo`, **not in the repository**. Using the Darwin-Wedgwood family in the repository later needs an ADR and an exception to the "Hale family only" rule in `CLAUDE.md`.
- **Keep these in step by hand:** the visitor password and the reset time on the page must match `demo.env` and the cron line on the droplet. The demo's version is pinned (`KINSHIP_VERSION=0.2.0`) and does not follow releases; update it deliberately.

## The domain
- `kinshiptree.app` (registered Nov 18, 2026; DNS on Cloudflare; GitHub Pages custom domain, verified on the account). Records: four A and four AAAA records for GitHub Pages on the apex, `www` as a CNAME to `officialjcreyes.github.io`, a TXT challenge for domain verification, and `demo` through the tunnel. The Pages records are **DNS only** (grey cloud), not proxied.
- DNSSEC is off at the registrar and in Cloudflare. It was on in Cloudflare without a matching DS record at the registry, and GitHub's domain verification failed with a lookup error until it was switched off.
- `.app` is on the HSTS preload list, so browsers only use HTTPS; GitHub's certificate has to exist before the site opens.

## The current version is automatic (decided by JC, Nov 18; ADR 0022)
- The pages state the current version in a handful of places: the footer on every page, the hero badge on the home page, the "Install x.y.z" call to action, and the pinned image tag and "Version" chip in Get started. In `site/` each one is written as **`@@VERSION@@`**.
- The Website workflow copies `site/` to `_site/` and replaces `@@VERSION@@` with the version of the **latest published GitHub Release** (stable only; release candidates are pre-releases and never count). It fails if the latest tag is not `x.y.z` or if a placeholder is left behind.
- **When it runs:** on a push to `main` that changes `site/` or the workflow; **after the Release workflow finishes successfully on a pushed version tag** (`workflow_run`; dry runs and pull requests are ignored); and by hand.
- **Why the Release workflow and not the release pull request:** release-please's pull request changes the version files before the images exist, and the tag is made later by hand. The Release workflow creates the GitHub Release only after the images are pushed and smoke-tested, so the site can never announce a version nobody can pull.
- Opening `site/` files straight from disk shows the placeholder. That is expected; `site/README.md` has the preview commands.

## What stays hand-written
The version number is the only automatic part. Wording that depends on what a release contains is edited by a person, **in the same pull request as the feature** or in the release pull request:
- **Roadmap page:** a release's status chip (Planned, In progress, Published), its list, and the "Latest release" card (it shows 0.2.1 as of Nov 19).
- **Features page:** each feature's chip ("Soon", "0.3", "0.2.0") and any "arrives in 0.x" sentence.
- **Home page:** the "arrive in 0.3" sentence under "Four ways to see one family", and the previews note under the chart picture.
- **Demo page:** the visitor sign-in, the reset time, and the version note.

## Release checklist, website line (added Nov 18)
After merging the release pull request and **before** tagging: update the Roadmap and Features pages (status chips, "Soon" labels, "arrives in" sentences, the Latest release card) so they describe the release. The tag then publishes the version number on its own. After the Release workflow finishes, open the site and check that the version shows the new number. (The same checklist now also tells the maintainer to add `scripts/upgrade-test/seed-<version>.sh` before tagging; see `CONTRIBUTING.md` and ADR 0016. This line belongs in the release checklist of `kinship-release-and-deployment-plan.md` section 5; add it there the next time that doc is edited.)

## Commit types for site work
`feat(site):` and `fix(site):` count as user-facing for release-please, so they can raise the next version (the first two site commits made it propose 0.3.0 before any 0.3 feature existed). Use **`docs(site):`** or **`chore(site):`** for website-only changes. Reserve `feat` and `fix` for changes to the app.

## Open
- Real screenshots for the home page after 0.3 (the live demo exists, but it runs 0.2.0 and has no Pedigree, Fan or Descendants charts).
- Move the demo deployment files into the repository (a `compose.demo.yml`, a seed script, a nightly reset) with an ADR and the `CLAUDE.md` exception, if JC wants the demo to be reproducible from the repo.
- Check the real visitor address reaches the sign-in rate limit through the Cloudflare Tunnel (`TRUST_PROXY`, `CF-Connecting-IP`); untested.
