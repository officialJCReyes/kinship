# 0035. Restoring a backup that carries photos (#205)

- Status: **Accepted** (decisions by JC, step 37)
- Date: 2026-11-22
- Supersedes: the "a backup that carries files is refused" decision and the "restoring media files is not built" consequence of [0031 Restoring a backup from the app](0031-in-app-restore.md)
- Builds on: [0033 File encryption and storage](0033-file-encryption-and-storage.md), [0014 Built-in backups](0014-backup-and-owner-access.md)
- No migration.

## Context
A backup now carries the photo files (0033). A restore has to put them back, and the database and the files folder cannot share one transaction. Restoring the database and then failing to swap the files, or the other way round, would leave rows without files or files nobody refers to, with no way to tell which half happened. The in-app restore and the command line run the same code, so they behave the same.

## Decisions

### The order, built so that every step before the commit can be abandoned
1. **Check** (no change, no lock): the key must be the one that sealed the photos (the backup's index carries each file's key id; a different or missing key is refused, with ids and no key material); the files folder must be writable; free space. 
2. **Safety copy**, which now **includes the current photos**. If the photo files here cannot be read (photos in the database, a folder without its marker: a lost mount, which is what a restore from backup repairs) the copy is the database alone, and the restore says so.
3. **Unpack** the archive's files into `staging/<restore id>/` on the files volume and verify each one against the index (size, SHA-256, and the key id in its own header). `objects/` is never touched. Any mismatch removes the staging and stops.
4. **Write the restore intent** (`<files>/.restore-intent`, the restore id).
5. **The database transaction.** It sets the **restore marker** to that id (a comment on the `public` schema; no migration, and any role can read it) and **before it commits** prints every file name the restored photo rows use. The restore compares them with the staged files and sends `COMMIT` or `ROLLBACK`: a row the backup's files do not cover aborts it with the files folder untouched. (psql's transaction stays open while the comparison runs.)
6. **After the commit:** `objects/` is renamed to `objects.old-<id>`, the staged tree becomes `objects/`, the old one is deleted, the intent removed. Every step looks at what is there, so it can be run again.

### A crash between 5 and 6
At the next start (before anything else looks at the files folder) `reconcileFiles` reads the intent and the marker. **Same id: the database committed, finish the swap. Any other id: it did not, discard the staging.** A marker carried by a later backup's dump is an old id that can never equal a new restore's id (a fresh random one each time), so a stale marker cannot be mistaken for the current restore. This was proved before anything else was built (`restore-marker.test.ts`): the comment commits with the restore, rolls back with it, is written after the dump is replayed so it wins, is carried by later dumps, and works for an owner that is not a superuser. Any other leftover staging folder at start is removed.

### A database-only backup
An archive without files (`files.included: false`: an upgrade safety copy, "Include uploaded files" switched off, or a family with no photos yet) **leaves the files folder untouched**. Photos uploaded since the backup have no row after the restore, so they are orphans; the sweeper (0033) removes orphans only after a **7-day hold** written by the restore (`.sweep-hold`). A row whose file is missing shows a placeholder. The Restore dialog and `kinship restore` say this before anything happens, and say whether the chosen backup carries photos.

### Free space
The backups folder needs twice the database, **plus the photos here** (in the safety copy) **plus the backup's photos** (in the unpacked copy); the files folder needs the backup's photos and a tenth more. When both folders are on the same disk the amounts are added. The refusal gives each amount.

### The guard is gone
`preflight` no longer refuses a backup that carries files, and its test was deleted.

## Consequences
- A restore with photos takes longer and needs more room; the dialog and INSTALL say so.
- The marker is a schema comment: **do not drop or recreate the `public` schema's comment by hand** while a restore may be in flight.
- Known: a crash while the files are being swapped in a way the intent cannot describe (someone deleting `staging/` by hand mid-restore) leaves the safety copy as the way back, which holds the photos that were here.
