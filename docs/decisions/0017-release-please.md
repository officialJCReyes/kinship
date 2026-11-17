# 0017. release-please, and how it fits the manual release

- Status: **Accepted** (decisions by JC, 2026-11-17, after the step 18 phase 1 report)
- Date: 2026-11-17
- Builds on: [0004 Releases and images](0004-release-and-images.md), [0015 Updates](0015-update-check-and-whats-new.md)

## Decisions

- **release-please opens the pull request; JC tags.** `skip-github-release` is on, so release-please never creates a tag or a GitHub Release. Merging its pull request puts the version, the changelog section and the bumped files on `main`; JC then runs `git tag -s vX.Y.Z && git push` as today, which starts `release.yml`. This keeps signed tags, keeps "JC runs the tag commands", and avoids the rule that events made with `GITHUB_TOKEN` do not start workflows (a tag made by release-please would not start `release.yml`). The "Protect release tags" ruleset has no `creation` rule, so it would not have blocked a bot's tag; that is not relied on.
- **The first 0.2 release (0.2.0) is manual.** The workflow (`.github/workflows/release-please.yml`) is `workflow_dispatch` only. After `v0.2.0` is tagged, `.release-please-manifest.json` is set to `0.2.0` and the trigger is changed to a push to `main`. Without that, release-please would propose `0.2.0-alpha.2` (a dry run showed it: a feature after a pre-release raises the pre-release number's minor), and would list all of the commits since alpha.2 as bare commit subjects.
- **Config** (`release-please-config.json`): one package at the root, type `node`; `include-component-in-tag: false` so the tag is `v0.2.0` (release.yml and `parseTag` need that); `bump-minor-pre-major` so a `feat!:` before 1.0 raises the minor; the four checked `package.json` files, `e2e/package.json`, `compose.yml` (the two `${KINSHIP_VERSION:-x}` defaults) and `.env.example` are updated through `generic` extra files with `x-release-please-version` markers (the `.env.example` markers are comment lines on their own, so no comment sits after a value in a dotenv file). A dry run showed the default type for `.yml` is a YAML path updater that silently changed nothing; the explicit `generic` type works.
- **Changelog sections**: Security (a `security:` commit type, new in CONTRIBUTING), Features, Bug Fixes, Performance, Reverts; `docs`, `test`, `chore`, `refactor`, `ci`, `build` and `style` are hidden. A breaking commit makes release-please write `### ⚠ BREAKING CHANGES`.
- **Both parsers read what it writes.** `scripts/fixtures/release-please-changelog.md` is the dry-run output (a real `security:` and `feat(api)!:` commit were used, then dropped). `scripts/release-info.test.mjs` runs it through the release-notes and manifest reader (the manifest says `security` and `breaking`), and `apps/api/test/updates-shared.test.ts` through the in-app reader (breaking, security, new, fixed). The `release-info.mjs prepare` step now also fails if `compose.yml` or `.env.example` default to another version than the one being released.
- **Pre-releases**: release-please can write `-rc.N` versions (`prerelease` and `prerelease-type` in the config, or `Release-As: 0.2.0-rc.1`); that is not switched on. `release.yml` already handles `-rc.N` tags.

## Known gaps

- **The pull request gets no CI** when opened with `GITHUB_TOKEN`, so the five required checks never report on it. Close and reopen it (a person's reopen starts the workflows), as with other pull requests whose checks do not start. A token or GitHub App would remove that; not done.
- **`UPGRADE.md` is not written by it.** A release with a breaking change needs a section headed with the exact version (`## 0.3.0`), which `release-info.mjs` requires (the in-app reader also accepts "Unreleased (will become 0.3.0)"). The version is known from the release pull request; put the section on `main` before merging it.
- **How it merges a new section into the existing `CHANGELOG.md`** (the `## [Unreleased]` block and the link lines at the bottom) was not visible in a dry run, which prints only the new section. Check the first real release pull request.
- release-please regenerates its branch when `main` moves, so edits made on that branch can be lost.
- The setting "Allow GitHub Actions to create and approve pull requests" is off and stays off until the trigger is switched on.
