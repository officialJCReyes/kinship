# 0031. Restoring a backup from the app, and maintenance mode (#73)

- Status: **Accepted** (decisions by JC, 2026-11-21, after the step 36 phase 1 report)
- Date: 2026-11-22
- Builds on: [0014 Built-in backups, and the api's use of the owner role](0014-backup-and-owner-access.md), [0029 Changing a role, disabling and deleting accounts](0029-account-roles-disable-delete.md), [0003 Accounts and sessions](0003-accounts-and-sessions.md)
- No migration. The record of a restore lives in `state.json` on the backups volume.

## Context

In 0.2 a restore was a command on the server (`kinship restore`, ADR 0014). It makes a safety copy, replaces the database in one transaction, checks the result before it commits, and refuses to start while the app role has open connections. #73 asks for a button in Admin → Backups. Inside the running api the "open connections" are the api's own pool, so the button needs a maintenance mode, and it must not weaken what the command line already guarantees. Step 35 also added two row triggers on `users` that refuse to demote, disable or delete the last active SuperAdmin whoever runs the SQL (ADR 0029), so a restore had to be checked against them.

## Decisions

### Who, and how it is asked
- **SuperAdmin only** (the same hook as every backup route). It is never automatic.
- **Two steps.** `POST /api/admin/backups/restore-check` opens and verifies a listed archive, runs every refusal that does not need the app stopped, and returns what a restore would do plus a **single-use ticket** (60 seconds, tied to the session). It changes nothing and signs nobody out. `POST /api/admin/backups/restore` takes the ticket, the typed word **RESTORE** and the **password again** (the same limiters as the download ticket), in the body, never a URL. It answers 202. The word is checked by the server too, and neither a wrong word nor a wrong password spends the ticket.
- **Only archives listed in the app** (`classifyName`, encrypted `.tar.enc`): the route looks the name up in `listBackups(dir)` and never joins user input into a path. Plain `.sql.gz` safety copies have no button and are never executed. **No upload** (a browser upload goes through nginx and the read-only containers; and a brand-new server has no SuperAdmin to click: that case stays the command line).
- **The passphrase comes from the api's configuration only**, never from the browser. If it is missing or too short the buttons are off and the page says why.

### What a restore does to `users` (ADR 0029)
A restore **rebuilds, it never edits**: it drops the `kinship_auth` and `public` schemas, recreates them and replays the dump, whose rows arrive by `COPY` and whose triggers are created **after** the data. It runs no `DELETE`, `UPDATE`, `TRUNCATE` or `ALTER TABLE ... DISABLE TRIGGER` on `users`, so the two last-SuperAdmin triggers never see it. Proved against Postgres 18 with a database that has exactly one active SuperAdmin (the restore succeeds and the guard still fires afterwards), and with a backup from before 0019 (the migrations that follow the restore bring the column and both triggers back). Three tests pin it; **do not add `DISABLE TRIGGER`**: it is a second way to leave the table unguarded. Swapping databases was rejected too: it needs CREATEDB on the owner and zero connections.

### Maintenance mode, in the api process
The order, in `backup/restore-service.ts`:

1. `started` is written to `state.json`.
2. The gate goes up: every request except `GET /api/health`, `/api/version` and `/api/maintenance` answers **503 `maintenance`** with `Retry-After: 5` and `Cache-Control: no-store`. Requests already running are counted. The periodic jobs and the backup scheduler pause, and the session cleanup stops.
3. Wait for those requests and jobs, at most 30 seconds.
4. Check the backup again under the gate, and look at the backup lock (another process may hold it).
5. Close the app role's pool.
6. `restoreBackup()`: advisory lock, preflight (the app role has no connections now), safety copy, one transaction that replaces the schemas, row counts and the protections fingerprint checked **before** it commits, migrations if the backup is older, the `upgrade_log` row.
7. Write the result to `state.json` and **exit**, so Docker starts a fresh api (a new pool, new jobs, no stale caches; its start-up applies any migration still pending, with its own safety copy).

**The exit rule.** A failure in steps 1 to 4 changes nothing and closes nothing: the gate comes down and the site goes on, with no restart. A failure after step 5 cannot lift the gate (the pool is gone), so the process exits with **code 1**, Docker restarts the api, and the result (the data unchanged, or restored but a later database change failed) is shown on the maintenance page and kept in `state.json`. Success exits 0.

**Why in-process, not a child process.** The heavy work already runs in child processes (`tar | pg_restore | psql`); Node only orchestrates. A second Node process would need the passphrase and the owner password passed to it (they are scrubbed from `process.env` on purpose) and would not survive the container stopping either. What survives an api that is killed in the middle is **Postgres**: the replacement is one transaction, so a dead client means rollback. Measured with 50,000 people by terminating the connection in the middle of the data load: the database was exactly as before and the safety copy was kept.

**Health and the page.** During maintenance `GET /api/health` answers **200** `{status: 'maintenance', database: 'ok'}` without touching the database (so nothing restarts the container in the middle of a restore). `GET /api/maintenance` is public (people are signed out), touches no database, has a cheap rate limit, and returns the phase, when it began, and after a restore `lastRestore: {ok, kind, finishedAt, safetyCopy?}`: no ids, no emails, no paths. nginx needs no change: it passes the 503 through, and answers 502 for the few seconds the api is restarting. The web app replaces itself with a full-screen maintenance page (no navigation, `role="status"`), polls every two seconds and treats 502, 503 and network errors as "starting again".

### What a restore changes
The data is the backup's. **Accounts deleted or disabled since the backup come back active, with the backup's passwords**; accounts created since are gone, which can include the SuperAdmin who clicked (the dialog says so, from the backup's date); a backup with no accounts returns the app to first-run setup (the token is in the api log). **Everyone is signed out**, open invitations and set-password links are cancelled. The safety copy of what was there, `pre-restore-<time>.tar.enc`, is in the list: **restoring it is the undo**.

### Version rules and refusals
- An **older schema** is allowed (migrations apply after the restore); a **newer schema** is refused; a **newer app version with a schema this image knows** is allowed with a warning.
- **A backup that carries files is refused.** Restore replays the database only; the archive's `files/` entries are not put back. Nothing can carry files before uploads exist, but a restore that silently skipped photos would be data loss. **Step 37 (photos, #98) must extend restore to put the files back and delete this guard** (`preflight` in `backup/restore.ts`, and its test).
- **Free space** in the backups folder must be at least **twice the database** (the safety copy and the decrypted backup), for the command line too. The message gives both amounts and no path. The api cannot see the database volume: it needs about twice the database size free there while the old schema is still in place.

### Concurrency
A second click answers 409 `restore_busy`; a running backup or test answers 409 `backup_busy` before anything is paused; two api containers fail closed (the other one still holds app connections, and the preflight refuses). The command line shares the same advisory lock.

### Audit
`state.json` keeps the last 20 restores (`started`, `restored`, `unchanged`, `restored_not_migrated`, `did_not_finish`; the uuid of the account that asked; the generated archive and safety copy names; an error code, never a message). A `started` with no result at the next start is marked "did not finish; your data is unchanged". The restored database also gets its `upgrade_log` row (feeds "What's new"). Log lines carry ids only. The API answers a check or a start problem with a code, and a sentence only when it is ours and holds no path.

## Consequences
- The Restore button needs the api to be restarted by Docker (`restart: unless-stopped` in `compose.yml`). A custom compose file or `docker run` without a restart policy leaves the api down after a restore. INSTALL.md and UPGRADE.md say so.
- The site is paused for roughly 5 to 15 seconds on a family tree (a restore of 50,000 people measured at 2.8 seconds including the safety copy); the rest is the restart.
- Two bugs were found by testing this and fixed with it: a wrong password did not stop the download-ticket handler (the helper returned the reply, which is thenable), and a `pg_restore` that ended before reading the dump left `tar` blocked and the restore hanging.
- Not built: upload, restoring from a plain `.sql.gz`, partial restores, a preview diff, restoring media files, an automatic rollback after a failed post-restore migration, a passphrase typed in the browser.
