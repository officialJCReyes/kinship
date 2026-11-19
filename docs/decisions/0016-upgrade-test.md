# 0016. The upgrade test in CI

- Status: **Accepted** (decisions by JC, 2026-11-17, after the step 18 phase 1 report)
- Date: 2026-11-17
- Builds on: [0004 Releases and images](0004-release-and-images.md) ("Not built: the upgrade test"), [0014 Backups](0014-backup-and-owner-access.md), [0015 Updates](0015-update-check-and-whats-new.md)

## Context

From 0.2 the data promise holds: an upgrade must keep every row, and the safety copy it makes must restore. The plan asks for a test that starts the previous release with data, switches to the new images, and restores a backup into a clean stack.

## Decisions

- **Job `Upgrade test (previous release)` in `ci.yml`**, so it runs on pull requests and `main`, and on every tag (`release.yml` runs the whole file). It is **not a required check**; it becomes one after about ten green runs in a row and before the 0.2.0 tag. It builds the two images of the commit (same arguments as the other image jobs, layers from their cache) and runs `scripts/upgrade-test.sh`.
- **The previous release** is chosen by `scripts/upgrade-test/previous-release.mjs` from `gh release list`: on a pull request or `main` the highest published release of any kind (today a pre-release; `releases/latest` ignores pre-releases and answers 404); on a tag run only releases older than the tag, a stable tag preferring the newest older stable one. With no release the job passes with a notice. It uses that release's **own** `compose.yml` and settings file (`env.example`, or `default.env.example` before 0.2.0, because GitHub drops a leading dot) and its published images.
- **Seeding is one script per release it can start from** (`scripts/upgrade-test/seed-<version>.sh`), written against that release's API. The job fails when there is none. Because it starts from the newest published release, the seed for a new version has to be on `main` by the time that release is published (the release checklist in `CONTRIBUTING.md` says so); 0.2.1 was published without one and every pull request failed until it was added. Alpha.2 has no invitations, so its Member and User are inserted as rows by the owner role, with a hash made by that release's own password library.
- **It does what UPGRADE.md tells a user**: the new `compose.yml`, the backups folder, a `BACKUP_PASSPHRASE`, the new version. Then it checks: the schema number; a fingerprint of every person, relationship, parent link and account over columns every release has (status is left out: migration 0007 changes Married to Widowed for a deceased partner, which is checked on its own); counts and values; all three sign-ins and their roles; one `upgrade_log` row with the right schema numbers and versions (`from_version` null for a release that did not track it); the `pre-upgrade-*.tar.enc` file named in the log, listed by `kinship backup-list`, verified by `backup-verify --full`; What's new; and no secret in any log.
- **Restore** is tested the way INSTALL.md describes a new machine: the stack is taken down with its database volume, an empty database is started, and `kinship restore <safety copy> --yes` runs; the data fingerprint, the counts and the sign-ins must match, and the later start migrates it.
- **What's new** is compared with what the api's own functions say about this checkout's `CHANGELOG.md` (`parseChangelog`, `sectionsBetween`), so the check is right at any version. While the build's version is still the previous release's (as on `main` today) the popup is expected to be hidden. On a stable tag it must also list the tagged version.
- **Issue #35.** An upgrade from a release before migration 0007 never has a database in the broken state (0007 and 0013 run in one start), so the test asserts the three policies test membership of the table's owner (`pg_has_role`), then renames the owner role, starts the stack with the new name, and checks the automatic Widowed change still works. A real "created before 0013" database would need a committed schema-12 dump; that is not done.
- The smoke test (`scripts/smoke-test.sh`) also makes, verifies in full and restores a backup on the real stack.

## Not covered

- Upgrades from more than one release back (a matrix) and from a release at schema 7 to 12; arm64.
- Large databases (the safety copy's time).
