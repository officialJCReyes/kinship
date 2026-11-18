# 0018. The step 21 scope audit: what moved out of 0.2.0

- Status: **Accepted** (decisions by JC, 2026-11-18, after the step 21 audit report)
- Date: 2026-11-18
- Sources: `design/kinship-release-and-deployment-plan.md` (v0.2.0 section), `design/kinship-build-status-and-handoff.md`

## Context

An audit of all 33 issues against the release plan and the mockup found items from the plan's 0.2.0 list that the build does not contain. This record states where each one goes. **`design/` is a read-only mirror, so its 0.2.0 line is not edited here. The Project copy of the plan was updated with the changes under "Plan lines to change" on 2026-11-18.**

## Decisions

- **Moved to 0.3.0:** the in-app Restore button (#73; restore stays a command in 0.2), profile photos and encrypted media upload (#98), changing an account's role (#57), disabling and deleting accounts (#56), the per-user default chart view (#48; the plan said 1.5).
- **Moved to 0.5.0:** the Edit details fields for birth and death places, cause of death and marriage place (part of #17), with the Places library. Draft PR #91 (marriage place) is therefore not part of 0.2.0: it waits for 0.5.0 and is rebuilt against the Places library, or is closed. Its migration number (0015) must not be assumed; the next migration is numbered when it is written, and 0.2.0 may use 0015 for #8 or placeholder parents instead.
- **Pulled into 0.2.0:** linking an existing account to a person (#8; the plan said 0.4 for SSO linking). **Built in #101, see [ADR 0020](0020-link-account-to-person.md).**
- **Accepted cut:** crossing minimisation in the tree layout (#21), now 0.3.0.
- **Deferred, no release:** a family default color scheme (#47) and a one-color logo (#50).
- **Required checks before tagging 0.2.0:** "Upgrade test (previous release)" (ADR 0016) and "End-to-end (Playwright)" are to be added to the "Protect main" ruleset by JC. Until then CLAUDE.md's list stands.
- **Release tags are annotated and unsigned** (`git tag -a`), as CLAUDE.md says and as v0.1.0-alpha.1 to v0.2.0-rc.2 were made. CONTRIBUTING and ADR 0017 said `-s` and "signed tags"; they now say `-a` and "annotated and unsigned". Tags are created only when JC says "tag it", and a `v*` tag is never deleted or moved. The plan's "signed release tags" no longer holds.
- **Issues** are for bugs and for tracking work left out of a release; milestones 0.2.0 to 1.5.0 and the labels `scope:planned-later`, `scope:0.2-cut`, `scope:unplanned-gap`, `security`, `tech-debt` were created.

## Plan lines changed (in the Project)

- v0.2.0: remove "profile photos; Media upload to local storage, encrypted before it is stored" (now 0.3); change "test and restore buttons, command line" to "test button, command-line restore" (button in 0.3); add "link an existing account to a person".
- v0.3.0: add profile photos and media, the Restore button, role change, disable and delete accounts, the per-user default chart view.
- 1.5: remove "a per-user default chart view". Section 2: "signed release tags" becomes "annotated release tags"; "Issues for bugs only" follows CONTRIBUTING.
