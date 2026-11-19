# 0022. The website shows the latest released version on its own

- Status: **Accepted** (decision by JC, 2026-11-18)
- Date: 2026-11-18
- Builds on: [0004 Releases and images](0004-release-and-images.md), [0017 release-please](0017-release-please.md)
- Code: `.github/workflows/pages.yml`, `site/`. Design note: `design/kinship-website.md`.
- Amended by: [0023 The website's Docs are built from the repository's Markdown](0023-docs-on-the-site-from-the-repository.md) (the site has one build step now, run before the version is filled in).

## Context

The project website (`site/`, published to GitHub Pages by the Website workflow) states the current version in several places: the footer, the home page badge, the install button and the pinned image tag in Get started. The workflow only ran when `site/` changed on `main`, and the version was typed into the HTML. A release changes no file under `site/`, so the site would have kept showing the old version until someone edited it.

Two other things came up at the same time:

- `feat(site):` and `fix(site):` commits are user-facing to release-please, so the first two website commits made it open a "release 0.3.0" pull request before any 0.3 feature existed.
- Some wording depends on what a release contains (the roadmap, "Soon" labels). A script cannot know that.

## Decision

- **The version is filled in at deploy time.** In `site/` the version is written as `@@VERSION@@`. The Website workflow copies `site/` to `_site/` and replaces every `@@VERSION@@` with the version of the **latest published stable GitHub Release** (`releases/latest`, which skips pre-releases). It stops if that tag is not a plain `x.y.z` version or if a placeholder is left in the output. Nothing in the repository holds the version for the site, so there is nothing to forget to update.
- **It runs after the release is real.** The workflow also starts when the **Release** workflow completes successfully on a pushed tag (`workflow_run`). That workflow creates the GitHub Release only after the images are pushed and smoke-tested, so the site never announces a version nobody can pull. Release workflow runs for dry runs and pull requests are ignored. It still runs when `site/` changes on `main`, and by hand.
- **Not triggered by the release pull request.** release-please's pull request changes the version files before the images exist, and the tag is made by hand later (ADR 0017). Using it would announce a version too early.
- **Release-specific wording stays hand-written.** The Roadmap and Features pages and the "arrives in 0.x" sentences are edited in the release pull request, before the tag. This is a line in the release checklist (`CONTRIBUTING.md`), because the Release workflow cannot check it.
- **Website-only commits use `docs(site):` or `chore(site):`**, so they do not raise the version or appear in the changelog. `feat` and `fix` are for the app.

## Consequences

- Opening a file from `site/` straight from disk shows `@@VERSION@@`. `site/README.md` says how to preview a built copy.
- If a release is published by hand without the Release workflow (not the normal path), the site updates at the next change to `site/` or when the Website workflow is run by hand.
- The `workflow_run` trigger runs from the default branch, with no pull request code, and checks out `main`. It needs only `contents: read`, plus the Pages permissions it already had.
- A custom domain later changes nothing here: the site uses relative links only.
