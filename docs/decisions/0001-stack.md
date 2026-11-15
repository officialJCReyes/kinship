# 0001. Stack

- Status: **Accepted** (JC confirmed the stack and the library picks, 2026-11-15)
- Date: 2026-11-15
- Sources: `design/kinship-v2-requirements.md` (Decisions), `design/kinship-release-and-deployment-plan.md` (section 6, Milestone 0)

## Context

KinShip is a self-hosted family tree for a family of roughly 10 to 50 people. It holds private health history and DNA results, so privacy rules must be enforced by the database and not only by application code. It is deployed by people who are not necessarily developers, from one `compose.yml`, and maintained by one person. It is AGPL-3.0-or-later, so every dependency must be license-compatible. It has no AI features. The previous build (Express, Prisma, React Flow) is scrapped.

## 1. Decided by JC (2026-11-15)

| Part | Choice | Why |
|---|---|---|
| Database | PostgreSQL 18 (official `postgres:18` image) | Row-level security for medical privacy. Supported to Nov 2030. |
| API | TypeScript on Node | One language, shared types with the UI. |
| Web container | nginx, unprivileged Alpine image | Serves the built UI and proxies `/api`. Only published port (8080). |
| UI | React | |

Three compose services (`web`, `api`, `db`). `web` and `api` always share one version tag.

## 2. Library picks (accepted by JC, 2026-11-15)

| Concern | Pick | Alternative considered |
|---|---|---|
| API framework | **Fastify** | Hono |
| Database access | **Kysely** (SQL-first query builder) over `pg`, with **plain hand-written, numbered `.sql` migrations** applied through Kysely's `Migrator` with a custom `MigrationProvider` (see below) | Prisma (dropped), Drizzle, raw `pg`, a fully custom runner |
| UI build | **Vite** (static output served by nginx) | |
| Tree drawing | **Our own SVG code**, as in the mockup | React Flow or another diagram library (dropped) |
| Unit and API tests | **Vitest** | |
| Browser smoke tests | **Playwright** | |

Reasons:

- **Fastify.** Mature plugins for what the plan needs: OIDC, streaming uploads and downloads (encrypted files are decrypted in chunks while streaming), rate limiting, schema validation. It is MIT-licensed.
- **Kysely and plain SQL migrations.** Row-level security needs two things: the app connects as a non-owner role, and every request runs in a transaction that sets the signed-in user (`set_config('app.user_id', ..., true)`, transaction-local so pooled connections never leak identity). A query builder that lets us own the connection and transaction makes this direct. Migrations are forward-only, hand-written SQL, expand-then-contract, run by an owner role at startup. Kysely types are generated from the real schema.
- **Migration runner: Kysely `Migrator` with a custom `MigrationProvider`, not a custom runner.** JC asked to check which is simpler. I read the `kysely` 0.29.9 source: for Postgres the `Migrator` already takes a Postgres advisory lock for the run (with a lock timeout), runs the migrations in a transaction (Postgres has transactional DDL), applies them in name order, refuses to run if an already-applied migration is missing or out of order (unless `allowUnorderedMigrations` is set, which we will not set), and keeps its own history table. A custom runner would re-implement all of that. The provider's job is small: read the numbered `.sql` files from the migrations folder and return each as a `Migration` whose `up` executes the file's SQL. `down` is never provided (forward-only).
- **Checksums are not provided by Kysely, so we add them.** Each migration's `up` also inserts the SHA-256 of its file into a `kinship_migration_checksum` table in the same transaction. Before migrating, the runner compares the checksum of every already-applied file on disk with the stored value; any mismatch stops startup with a clear error naming the file ("migration NNNN was edited after it was applied"). This also protects against a corrupted or hand-edited image. A migration missing from disk but recorded as applied already fails in the `Migrator`.
- Verified against the source: lock, transaction and ordering behavior above. Not yet verified by running code: the checksum flow and multi-statement `.sql` execution. Both are covered by tests when the runner is written (0.1 step "migrations at startup").
- **Prisma dropped.** It handles per-request database sessions, RLS and a separate migration owner role awkwardly, and it prefers `db push`-style workflows, which the project forbids.
- **Vite.** Produces plain static files, so the `web` image is just nginx plus files.
- **Own SVG tree.** The mockup already draws the tree as SVG. Pedigree, fan and descendants views, the spouse's-family leaf flip and print output all need control that a diagram library would fight.
- **Vitest and Playwright.** Vitest shares config with Vite. Playwright is the smoke-test tool the CI plan already names.

### Implementation notes (api skeleton, 2026-11-15)

- The app role's name reaches the migrations through a transaction-local setting, `kinship.app_role`, which the provider sets before each file runs. The `.sql` files therefore never hard-code the role, and their checksums do not depend on `.env`.
- The app role itself is created (or its password refreshed) by the API at every start, before the migrations, as the owner role. The password is a secret and cannot live in a `.sql` file. `CREATE/ALTER ROLE ... PASSWORD` sends the password in the statement text, so a server that logs all statements would log it; the default Postgres configuration does not.
- `schema_info` holds the schema number. The provider updates it in the same transaction as each migration, so it cannot disagree with the migration history.
- **The owner role is a superuser, on purpose, and only for migrations.** In the official `postgres` image the `POSTGRES_USER` account is created as a superuser; we use it as the owner role (`DB_OWNER_USER`). That is acceptable because (1) only the migration runner and role setup use it, once at startup, and the process closes its connections before it starts serving requests; (2) it never serves a request: every request runs as the separate app role, which is `NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB`, owns no objects and cannot create any (tests assert all of this); (3) superusers bypass row-level security, so privacy must hold for the app role, and it does because the API is built so that code paths with user data cannot use the owner connection; (4) a non-superuser owner would need extra setup by every self-hoster (creating the database, the role and its privileges by hand) for little gain in a single-database container whose only client is this API. The trade-off is that a bug allowing arbitrary SQL under the *owner* connection at startup would be serious; it runs only our own migration files, whose checksums are verified. A self-hoster who wants more can point `DB_OWNER_USER` at a non-superuser with `CREATEROLE` and ownership of the database; nothing in the code requires superuser.
- Each request's database work runs through `withUserTransaction`, which sets `kinship.user_id` with `set_config(..., true)` (transaction-local). Row-level security policies read it with `nullif(current_setting('kinship.user_id', true), '')::uuid`.

## 3. Consequences

- **Monorepo:** `apps/web`, `apps/api`, `packages/` (shared types, translation keys), `docs/`, `design/`. Shared types come from `packages/`, which is the main reason for TypeScript on both sides.
- **Two database roles:** an owner role used only by the migration runner, and a non-owner app role used for all requests. RLS is enabled and forced on tables that need it. Migrations never run as the app role.
- **Files** are encrypted by the app (AES-256-GCM in chunks) before storage, behind a storage interface so S3 can plug in later (1.1) without changing callers.
- **Licenses (checked 2026-11-15 by `pnpm licenses:check`, `scripts/check-licenses.mjs`).** The check reads the license of every installed npm package, direct and transitive, and fails on anything outside the allow list: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, MPL-2.0, BlueOak-1.0.0, Python-2.0, CC0-1.0 (all compatible with AGPL-3.0). Result for the current workspace: **PASS, 201 packages, 0 rejected.** 62 are production dependencies (54 MIT, 4 ISC, 4 BSD-3-Clause), including Fastify 5.12.8, Kysely 0.29.9 and `pg` 8.23.1 (all MIT). 139 are development tools and are not shipped: 104 MIT, 17 Apache-2.0 (TypeScript, among others), 6 BSD-2-Clause, 5 ISC, 3 BlueOak-1.0.0, 2 BSD-3-Clause and 2 MPL-2.0 (`lightningcss`, pulled in by Vite/Vitest). CI runs the check on every pull request and saves the full report as an artifact. **Not covered by this check:** React, Vite as a runtime dependency and Playwright are not installed yet, so their licenses will be checked when they are added; the nginx and Postgres container images are not npm packages, so their licenses (BSD-2-Clause and the PostgreSQL License, from memory) are not checked by it. The check only sees packages installed on the machine it runs on; platform-specific binaries (for example esbuild's) carry the same license as their main package.
- **Images** stay small (Alpine, non-root, `HEALTHCHECK` in each).
- **Reversibility.** Each pick can change before 0.1.0 ships at low cost. After that, Kysely and plain SQL are the hardest to change because they shape the migrations, which is why they are confirmed first.

## 4. Tooling choices

- **Package manager:** pnpm workspaces (accepted by JC). The exact version is pinned in the root `package.json` `packageManager` field and activated with corepack, so every contributor and CI run uses the same pnpm.
- **Node:** 26 (codename Lithium), the newest LTS line as of 2026-11-15 (checked against nodejs.org's release index). Pinned in `.nvmrc` and the root `engines` field, and used as the base of the Dockerfiles.
- **Lint and format:** ESLint and Prettier (my default, easy to change).
- **Postgres driver:** `pg`.

## 5. Not decided here

OIDC and email libraries (0.4), password hashing library (0.1 login, chosen when written), PDF output (0.7), the exact file-encryption chunking (0.2). Each gets its own ADR if the choice is not obvious.
