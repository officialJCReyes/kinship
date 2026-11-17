# 0014. Built-in backups, and the api's use of the owner role

- Status: **Accepted** (decisions by JC, 2026-11-17)
- Date: 2026-11-17
- Amends: [0001 Stack](0001-stack.md) (the owner role "never serves a request")
- Builds on: [0003 Accounts and sessions](0003-accounts-and-sessions.md), [0005 People and relationships](0005-people-and-relationships.md), [0008 Names and Widowed](0008-names-and-widowed.md)
- Sources: `design/kinship-release-and-deployment-plan.md` (section 4, "Data promise"; section 7), `design/kinship-research-records-and-backup.md`
- Format: [docs/backup-format.md](../backup-format.md)

## Context

0.2 starts the data promise: migrations keep data, and rolling back means restoring a backup. A backup that silently misses rows, or one that cannot be opened, is worse than none. Two facts shape the design. The app role is a non-owner without `BYPASSRLS`, so a dump taken as the app role would skip every row its policies hide (with nobody signed in, that is all of them). And only the database owner can create a database or replace the schema, which a restore and a verification need.

## Decisions

### Dump as the owner, in a short-lived child process
`pg_dump -Fc --no-owner` runs as the **owner role** in a child process of the api (or of the `kinship` command line). The owner credentials are already in the api's environment. They go **only into the child's explicit environment** (`PGPASSWORD`), never into argv, a log line, an error message (tool output is cleaned of the password and the passphrase), the API or the database. No new database role was added: a read-only backup role needs `BYPASSRLS`, which only a superuser can grant (so it fails for the plain-role owner ADR 0001 allows), it would be a third secret, and it still could not restore or verify.

Before every dump the owner must be a superuser or have `BYPASSRLS`. A plain owner would be filtered by the forced row-level security on `people`, `unions`, `person_parents` and `relationship_labels` and a dump would miss rows without saying so. In that case a manual or scheduled backup **refuses** with a message that includes the exact fix (`ALTER ROLE "<owner>" BYPASSRLS;`, run once by a superuser). The safety copy before a migration is **skipped, loudly and with a recorded reason**, so such an installation can still upgrade (decided in PR 5). A real dump failure on a capable owner blocks the migration.

Row counts and digests are taken under the same exported snapshot as the dump (`pg_export_snapshot` and `pg_dump --snapshot`), so they describe the same moment.

### The api keeps owner credentials for maintenance (this amends ADR 0001)
ADR 0001 said the owner connection is closed before the api serves requests. That stays true for migrations, but backups, the verification of a backup and the safety copy need the owner while the api is running. So: **the api keeps the owner credentials and opens short-lived owner connections and child processes for maintenance jobs, reached only through SuperAdmin-gated routes, the scheduler, and the command line.** No request that touches family data uses them.

**Threat model, stated honestly.** Code execution inside the api process already exposes the owner password (it is in the container's environment, in `/proc/<pid>/environ`, and in memory). Keeping it does not make that worse; it means the owner password and the backup passphrase are as exposed as the app role's password already is. What this design does protect against: SQL injection and any bug in a request handler (they run as the app role under row-level security); a leaked backup file (encrypted); a wrong or damaged archive being trusted. After the configuration is loaded, `DB_OWNER_PASSWORD`, `DB_APP_PASSWORD` and `BACKUP_PASSPHRASE` (and their `_FILE` variants) are deleted from `process.env`, so a library, a diagnostic report or a child process that inherits the environment cannot see them. It does not remove them from `/proc/<pid>/environ`, which is fixed when the process starts.

**An archive is trusted only after it authenticates with the passphrase.** Its cleartext header can be read to say "too new", but nothing in it (or the file name, or the folder) is believed until a block has been authenticated. A restore never runs SQL from an archive that has not passed, and never runs a plain `.sql.gz` safety copy at all (it carries no authentication and would run as the owner).

### Archive format
One tar, encrypted with Node's `crypto`: scrypt, HKDF, AES-256-GCM in 64 KiB chunks, with the header and a final flag as AAD. See [docs/backup-format.md](../backup-format.md). A wrong passphrase, damage and truncation are told apart. The format number lets a newer KinShip read older archives and never the reverse. Disaster recovery without KinShip is a 100-line script using only `node:crypto` (plain `openssl` cannot read chunked GCM, and the docs say so).

### Tools in the image
`apk add postgresql18-client` (about 6 MB of packages; `pg_dump`, `pg_restore`, `psql`), plus the image's busybox `tar`. They are **separate programs run through `exec`, under the PostgreSQL License** (permissive, OSI, compatible with AGPL-3.0-or-later; it is the license of the `postgres` image the stack already runs). The license check covers npm packages only, so this paragraph is the record. The client major must equal the server's or be newer (`pg_dump` refuses an older one); the code checks and says so. Every tool is used through stdin and stdout only, which also lets the test suite run them inside the dev database container.

### The database
Migration `0013`: `app_settings` (SuperAdmin-only row-level security; enabled but not forced, like `users`, so the owner can read the safety-copy switch at start without a user), `upgrade_log` (written by the owner only), `schema_info.app_version`, and the fix for issue #35: the three owner-only widow policies from 0007 now test "the current user is a member of the table owner" instead of naming the role that ran the migration, so a dump can be restored under another owner role name. The app role is never a member of the owner (a test proves it).

## Consequences
- The api image grows by about 9 MB.
- A backup needs a passphrase of at least 16 characters; without one the schedule stays off and Admin and the log say so. The placeholder `change-me-backup` is refused.
- The backup does not contain the passphrase or `FILE_ENCRYPTION_KEY`. Keep both elsewhere.
- Restore, the scheduler, the safety copy and the Admin page follow in later PRs of step 16a.
