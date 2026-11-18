# 0004. Releases, images and the production compose file

- Status: **Accepted** (requested by JC, 2026-11-15; the first-tag choice was made by JC)
- Date: 2026-11-15
- Follows: [`design/kinship-release-and-deployment-plan.md`](../../design/kinship-release-and-deployment-plan.md), sections 3 to 8. Where this ADR differs from the plan, it says so.

## Context

KinShip is released as two container images (`kinship-web`, `kinship-api`) plus a `compose.yml` that wires them to the official `postgres:18` image. Anyone should be able to run a release with one compose file and one `.env`, and every release must be traceable to a git tag, a changelog entry and a commit.

## Decisions

### The first release is `v0.1.0-alpha.1`, not `v0.1.0`
The plan's 0.1.0 includes people, relationships, one tree view and basic profile facts, and its exit test is a working tree in ten minutes. None of that is built. The plan allows `-alpha` "only for 0.1", so the infrastructure milestone (install, setup, sign-in, About, health checks, migrations) is `0.1.0-alpha.1`, and `v0.1.0` is tagged when the people and tree work lands. (JC chose this over tagging `v0.1.0` as it stands.) The release notes and INSTALL.md say plainly what is missing and that data may be wiped.

### A release is a tag, and the tag must match the code
- `release.yml` runs on a pushed tag `v*`, by hand (`workflow_dispatch`), and as a **dry run on pull requests that touch the release machinery** (the workflow, `ci.yml`, the Dockerfiles, nginx config, `compose.yml`, `.env.example`, the release scripts, `CHANGELOG.md`). The last exists because GitHub only lets a workflow be started by hand once it is on the default branch, so a change to the release process could not otherwise be rehearsed before it is merged. On a pull request the full CI is not repeated (it already runs as its own workflow).
- `scripts/release-info.mjs` (unit-tested) refuses to build unless the tag is a valid `vMAJOR.MINOR.PATCH[-pre.N]`, **every** `package.json` (root, api, web, shared, e2e) has exactly that version, and `CHANGELOG.md` has a non-empty section for it. A mismatch fails before anything is built.
- **A pull-request run is always a dry run. A manual run is a dry run by default and can never publish from a branch.** It publishes only when started on a tag with the dry-run box cleared, which is how a half-finished release is repeated. The tag/version check applies then too.
- The version, the commit (7 characters) and the build date are stamped into both images as build arguments, labels (`org.opencontainers.image.version/revision/created`) and environment, and appear in `/api/version` and on the About page. The web version comes from `package.json` at build time.

### Image tags (plan, section 3)
| Release | Tags pushed |
|---|---|
| stable, for example `0.3.1` | `0.3.1`, `0.3`, `latest` (only when no newer stable tag exists), `sha-<7>`; from 1.0 also `1` |
| pre-release (`-alpha.N`, `-beta.N`, `-rc.N`) | the exact version and `sha-<7>` only; never `latest`, minor or major |

- There is **no `0` tag** for 0.x, because the plan creates the major tag only after 1.0.
- `latest` never moves backwards: re-releasing an old patch after a newer stable exists does not take it.
- Image names are lowercase (`ghcr.io/officialjcreyes/kinship-web`, `kinship-api`), as GHCR requires. Web and api always share one version.
- **Not built, from the plan:** the `edge` tag on every merge to `main` (it would publish on every merge; a separate decision).

### What the release does, in order
1. **All of CI runs again** (`ci.yml` is also a reusable workflow): lint, format, typecheck, tests against Postgres 18, the license check, both image builds.
2. **Build and push both images for linux/amd64 and linux/arm64**, with an SBOM stored with the image and a **signed build-provenance attestation** (`actions/attest-build-provenance`, verifiable with `gh attestation verify`). The plan asks for both; cosign signing stays optional until 1.0. BuildKit's own unsigned provenance is turned off so the registry holds one provenance record, not two.
3. **Smoke-test the pushed images as a real installation** (`scripts/smoke-test.sh`, below).
4. **Only then create the GitHub Release**, with the notes taken from the matching `CHANGELOG.md` section, marked pre-release for `-alpha/-beta/-rc`, and with `compose.yml`, `.env.example` and `release-manifest.json` attached (the manifest is what the in-app update notice will read from 0.2; the plan's section 7). Migration and breaking-change flags are worked out by comparing with the previous tag; a breaking change without an `UPGRADE.md` section fails the release.
- A **dry run** does steps 2 and 3 (and step 1, except on pull requests) (it builds both architectures but pushes nothing, and tests images built for the runner) and creates no release.
- **Vulnerability scan (plan, section 5):** Trivy, **report only**: the report is shown in the job summary and kept as an artifact, but it does not stop a release, so a base-image advisory cannot block a fix. It runs in the read-only `smoke` job (no write permissions), because it is the one third-party action here outside GitHub and Docker. It can be removed without touching anything else.
- **Not built here, from the plan:** the upgrade test from the previous release (built in step 18, [ADR 0016](0016-upgrade-test.md)) and the api refusing to start next to a web of a different version (built as a 503 on requests, [ADR 0015](0015-update-check-and-whats-new.md)).

### Least privilege and pinning
- `permissions: {}` at the top; each job lists what it needs: `contents: read` almost everywhere; `packages: write`, `id-token: write` and `attestations: write` only on the job that pushes and attests; `packages: read` on the smoke test; `contents: write` only on the job that creates the release.
- No `pull_request_target`, no secrets other than the automatic `GITHUB_TOKEN`, and `persist-credentials: false` on every checkout.
- Every action is pinned to a full commit SHA with its version in a comment, and Dependabot proposes updates.

### Multi-arch builds without emulating everything
Both Dockerfiles run the install and compile stages on the build machine's own architecture (`--platform=$BUILDPLATFORM`), because the output (compiled JavaScript, static files) is identical for every architecture. Only the stages that must be per-architecture run for the target: nginx for the web image, and the api's production-dependency install (the argon2 library ships a native binary per architecture and libc). This was checked by building the api for amd64 on an arm64 machine and hashing a password inside it.

### The production `compose.yml`
- Three services, only `web` publishes a port (`KINSHIP_PORT`, default 8080, on `KINSHIP_BIND`, default all interfaces; use `127.0.0.1` when the reverse proxy is on the same machine). The database and the api are not reachable from outside.
- Images are `…:${KINSHIP_VERSION}`, defaulting to the current release, **never `latest`**; both images share the one variable, so upgrading is one deliberate edit.
- `db` is `postgres:18` with its volume at `/var/lib/postgresql` (the version-folder layout of the 18 images). `api` waits for a healthy `db`, `web` waits for a healthy `api`; each has a health check and `restart: unless-stopped`.
- Hardening: `api` and `web` run read-only with only `/tmp` writable, with all Linux capabilities dropped and `no-new-privileges`. They already run as unprivileged users (`node`, uid 1000; `nginx`, uid 101).
- Secrets come from `.env` (or `*_FILE` Docker secrets), never from the images or the database. The database owner password is required; compose refuses to start without it, and the api refuses the `change-me` placeholders.
- **`TRUST_PROXY` defaults to the private address ranges**, because the api sits behind the web container and usually a reverse proxy: without it the api would take every visitor for the web container, never see HTTPS (no `Secure` cookie) and pool everyone into one rate limit. `.env.example` explains how to widen or narrow it and warns against `true` when the web port is exposed directly. nginx now forwards `X-Forwarded-Host`, so the Origin check also works behind a proxy that rewrites `Host`.
- The plan's example also has file and backup volumes; those arrive with file storage and backups in 0.2 and are left out.

### Base-image hygiene
The first dry run's scan found HIGH and CRITICAL advisories that were not in KinShip's own code: the api image carried them in the **npm bundled in `node:26-alpine`** (which nothing at runtime uses), the web image in Alpine packages (brotli, curl, expat, libxslt, musl, zlib) whose fixes were already published. So the api image **removes npm and npx**, and the web image runs **`apk upgrade`** (as root, then back to the unprivileged user) when it is built. The cost of `apk upgrade` is that the same Dockerfile gives slightly different bytes on different days; that is accepted for a security fix, and each release is built once and pushed, so what is published is what was tested.

### nginx stays on the stable branch
The web image uses `nginxinc/nginx-unprivileged:1.30.6-alpine`, an exact patch of the stable branch. Dependabot ignores nginx minor and major updates for `/apps/web`, so only 1.30.x patches are proposed; moving to a newer branch is a deliberate edit of the Dockerfile. (A floating `1.30-alpine` tag would have made patch updates invisible to Dependabot.) The automatic PR that proposed 1.31 was closed.

### One smoke test for everything
`scripts/smoke-test.sh` starts `compose.yml` and `.env.example` exactly as shipped, with random throwaway passwords, and checks: all services healthy; only the web port published; non-root containers; `/healthz`; `/api/version` reporting the right version, commit, build date and schema; setup needed on a fresh install and refused with a wrong token; setup with the logged token; sign-out, a wrong password, sign-in; the cookie `Secure` behind a proxy header and not on plain HTTP; data surviving `down`/`up` with no new token; `kinship set-password`; no password in any log. It runs on a developer's machine, in the dry run (on images built for the runner) and after publishing (on the images pulled from GHCR).

### Backups in 0.1 are by hand
The plan has no built-in backup until 0.2, so INSTALL.md documents a `pg_dump` and a restore, and no more. The restore was tested: a dump does not contain roles, so restoring into a fresh database fails (`role "kinship_app" does not exist`, 23 privilege statements) unless the app role is created first; the documented procedure does that and stops on the first error.

### GHCR packages
Packages start private. After the first push each must be made public and linked to the repository once, by hand (a package setting, not something a workflow can do). The images carry the `org.opencontainers.image.source` label, which links them to the repo.

## Consequences and known gaps
- The first release does not meet the plan's exit test (no tree yet); the notes say so.
- Scanning is report-only and the SBOM is not yet published as a release asset.
- QEMU is used for the one per-architecture install stage; a native arm64 runner would be faster if builds become slow.
- Nothing is verified by a second maintainer; the release is as safe as the tag, the branch protection on `main`, and the person pushing the tag.
