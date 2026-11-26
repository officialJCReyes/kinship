# 0037. How a release candidate is made (0.3.0-rc.1 and later)

- Status: **Accepted** (decisions by JC, step 38)
- Date: 2026-11-22
- Amends: [0017 release-please](0017-release-please.md) (its "Pre-releases" line and the `UPGRADE.md` gap)
- Amended by: [0038 The surname particle is part of the surname](0038-surname-particle-folded.md) (the rc.1 and rc.2 seed wrappers also set `SEED_PARTICLES=1`)
- Builds on: [0004 Releases and images](0004-release-and-images.md), [0016 The upgrade test](0016-upgrade-test.md)
- No migration.

## Context
0.3.0 gets a release candidate first (JC, Nov 21). release-please (ADR 0017) proposes the next version from the Conventional
Commits since the last release in `.release-please-manifest.json`: with `0.2.1` there and a `feat!:` since, it proposes `0.3.0`.
It can be made to write `0.3.0-rc.1` (a `Release-As:` footer, or `prerelease` in the config), but the manifest would then say
`0.3.0-rc.1`, and the proposal for `0.3.0` would list only the commits after the candidate. The 0.2.0 candidates were made by hand
before release-please was switched on, with the manifest left alone, and that worked.

`scripts/release-info.mjs` reads the release's sections by their exact version: `CHANGELOG.md` needs `## [0.3.0-rc.1] - <date>`,
and because there is a breaking change since `v0.2.1` (the highest earlier tag, which is what a pre-release compares with),
`UPGRADE.md` needs `## 0.3.0-rc.1`. `## 0.3.0` does not match a candidate.

## Decisions
- **A release candidate is made by hand, in one pull request** `chore(release): prepare X.Y.Z-rc.N`:
  - the version in the five checked `package.json` files (root, `apps/api`, `apps/web`, `packages/shared`, `e2e`), the two
    `${KINSHIP_VERSION:-…}` defaults in `compose.yml` and the `KINSHIP_VERSION=` line of `.env.example` (`release-info.mjs prepare`
    refuses a tag when they disagree); `apps/docs/package.json` is not one of them and is left alone (nothing reads its version);
  - a hand-written `CHANGELOG.md` section `## [X.Y.Z-rc.N] - <date>`, first line "Release candidate of X.Y.Z. Back up first and read
    UPGRADE.md.", then the What's new sentences (the in-app popup and the GitHub Release are built from it);
  - the `UPGRADE.md` block renamed from "Unreleased (will become X.Y.Z)" to `## X.Y.Z-rc.N`.
- **`.release-please-manifest.json` stays at the last stable release** (`0.2.1`). release-please keeps proposing `X.Y.Z` with
  every commit since that release, which is what the stable release's changelog must list. Its pull request may be open at the
  same time; it is not merged until the stable release.
- **The heading is renamed per tag:** `## 0.3.0-rc.1` for the candidate, `## 0.3.0-rc.2` for a second one, `## 0.3.0` for the
  final (in its release pull request, before merging it). The in-app reader accepts all of these.
- **The version pull request is merged immediately before tagging, and nothing merges in between.** Once `package.json` says a
  version that has no tag, every pull request that runs the release preview is strict about the `UPGRADE.md` heading (#216), and
  the tag must point at the commit that carries the right versions and headings. JC merges, then says "tag it": `git tag -a
  vX.Y.Z-rc.N` on that merge commit and `git push origin vX.Y.Z-rc.N`.
- **`release.yml` treats it as a pre-release with no change:** images get only the exact version and `sha-…` (no `X.Y`, never
  `latest`), the GitHub Release is created with `--prerelease`, the manifest says `channel: prerelease`. The in-app update check
  offers it only when "Include pre-releases" is on (tested in `updates-shared.test.ts` and `update-checker.test.ts`), and the
  website's `@@VERSION@@` comes from GitHub's "latest" release, which is never a pre-release, so `site/` is not edited for a
  candidate (its wording changes in the stable release's pull request).
- **The upgrade test needs a seed for the candidate before the tag** (the 0.2.1 lesson: once it is published, every pull request
  starts from it). A candidate's seed is a wrapper that sources the release's seed (`seed-0.3.0-rc.1.sh` sources
  `seed-0.3.0.sh`), since a candidate and its release have the same API and schema. If a later candidate changes either, it gets
  its own file. The seeds are proved before the tag with the rehearsal mode of `scripts/upgrade-test.sh` (`REHEARSE=0.3.0`).
- **After the candidate is published:** a pull request pins `PREVIOUS_TAG: v0.3.0-rc.1` in `ci.yml` (`ci:`), and the build status
  notes it. Fixes found in the candidate go to `main` as usual and ship in the next candidate or the release.

## Consequences
- release-please's own run on `main` does not know about the candidate tag and is not affected by it.
- **The release pull request's label is changed by hand (resolved at 0.3.0).** A merged release pull request keeps the label
  `autorelease: pending`, which only release-please's own release step changes to `autorelease: tagged`; with `skip-github-release`
  that step never runs, so every later run ends with "There are untagged, merged release PRs outstanding - aborting". That kept
  release-please stuck from 0.2.1 until 0.3.0: the `autorelease: tagged` label was created in the repository (it did not exist) and
  set by hand on #117 (0.2.1) before the 0.3.0 run, and on #276 (0.3.0) after its merge. The same swap is needed after each stable
  release, best once the tag's GitHub Release exists: without the pending label and without that release, a run finds no release
  to stop at and could open a release pull request built from the whole history. It does not affect a hand-made candidate.
- **From 0.4.0 the swap is a step in `release.yml` (#228).** After "Create the release", in the "Create the GitHub Release" job and
  for a stable tag only, "Find the release pull request" asks GitHub for the pull requests of the tagged commit and picks the
  merged one labelled `autorelease: pending` whose merge commit is that commit (`releasePrLabel` in `scripts/release-info.mjs`,
  unit-tested). "Mark the release pull request tagged" then adds `autorelease: tagged` and removes `autorelease: pending`, in that
  order, so a stop in between leaves both labels and never neither. No match (a release made by hand) logs a notice and changes
  nothing; one already tagged is left alone; two candidates fail the step. The job gains `pull-requests: write` for the labels.
  A failure there shows the run red with the release already published; re-running the job is safe. A candidate tag skips both
  steps.
