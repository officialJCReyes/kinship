# Installing KinShip

> **From 0.2, upgrades keep your data.** Migrations are forward-only and preserve every row, a safety copy of the database is made before each one, and backups are built in. Releases before 0.2 (the `0.1.0-alpha` ones) had no such promise: do not keep real family data in them. Upgrading from an alpha needs two changes first; read [UPGRADE.md](UPGRADE.md).

You need a machine that runs Docker (Linux, a Raspberry Pi, a NAS, or a cloud server) with Docker Compose v2. You do not need to build anything.

## 1. Get the files

Make a folder and put two files in it, from the [release page](https://github.com/officialJCReyes/kinship/releases) (each release has them attached as `compose.yml` and `env.example`; GitHub does not keep a leading dot in an attached file's name, so the settings file is called `env.example` there and `.env.example` in the repository):

```sh
mkdir kinship && cd kinship
# compose.yml and env.example, downloaded from the release you want
cp env.example .env
chmod 600 .env
```

## 2. Fill in `.env`

Open `.env`; every setting is explained in it. Three secrets must be set: `DB_OWNER_PASSWORD` and `DB_APP_PASSWORD` (two different database passwords) and `BACKUP_PASSPHRASE` (encrypts every backup). Let `openssl` make them. Run this in the folder that holds `.env`:

```sh
# Fill in the three secrets. Only a value that still says "change-me" is replaced,
# so running this again never changes a secret you have already set.
fill() {
  grep -q "^$1=change-me" .env || return 0
  tmp=$(mktemp) && awk -v k="$1" -v v="$(openssl rand -hex 32)" \
    'index($0, k "=") == 1 { print k "=" v; next } { print }' .env > "$tmp" && cat "$tmp" > .env && rm -f "$tmp"
}
fill DB_OWNER_PASSWORD
fill DB_APP_PASSWORD
fill BACKUP_PASSPHRASE

# Show them, so you can copy BACKUP_PASSPHRASE into your password manager now.
grep -E '^(DB_OWNER_PASSWORD|DB_APP_PASSWORD|BACKUP_PASSPHRASE)=' .env
```

It only fills in values that still say `change-me`, so it is safe to run again. `openssl` is on macOS and most Linux; on Windows use WSL or Git Bash. To choose your own instead, keep the two database passwords different and the passphrase at least 16 characters.

**Copy `BACKUP_PASSPHRASE` to a password manager now.** Backups do not contain it, and without it they cannot be opened. Do not change `DB_OWNER_PASSWORD` after the first start (see the note beside it in `.env`).

Worth a look before you start:

- `PUBLIC_URL`: the address people will type (for example `https://family.example.com`).
- `KINSHIP_PORT` and `KINSHIP_BIND`: the web port (default 8080). Use `KINSHIP_BIND=127.0.0.1` if your reverse proxy runs on the same machine.
- `TRUST_PROXY`: see "Behind a reverse proxy" below.

`.env` holds your passwords. Do not commit it or share it.

## 3. Create the backups folder

KinShip writes its backups to `./data/backups` next to `compose.yml`. Create it before the first start so the api (user 1000, not root) can write to it:

```sh
mkdir -p data/backups && sudo chown 1000:1000 data/backups
```

Docker Desktop on macOS and Windows does not need the `chown`. Without a usable `BACKUP_PASSPHRASE` (step 2) KinShip still runs but makes no backups, and says so in Admin.

## 4. Start it

```sh
docker compose up -d
docker compose ps        # wait until web, api and db say "healthy"
```

Only the `web` service publishes a port (plain HTTP, 8080 by default); the database and the api are not reachable from outside.

## 5. First run: create your account

Setup needs a one-time token, so a stranger who finds your site first cannot claim it. The token is printed in the api log:

```sh
docker compose logs api
```

Look for the box that says **"KinShip is not set up yet"** and copy the token. Open your site (for example `http://localhost:8080`) and the setup wizard starts. It has seven steps:

1. **Account**: the setup token, your name, your email (also your sign-in name) and a password of at least 12 characters.
2. **Tree**: a name for your tree and the color scheme.
3. **You**: your name, birth date and gender. This creates you as the first person on the tree and links your account to you.
4. **Partner**, 5. **Parents** and 6. **Children**: optional; press **Skip this step** to leave one out.
7. **Review**: press **Create my tree**.

Nothing is created until the last step, and then everything is created at once; if it fails, nothing is kept and your token still works. Refreshing or closing the tab restarts the wizard from step 1. You become the SuperAdmin and are signed in. The setup page never appears again once an account exists; if the connection drops right after **Create my tree**, sign in with the email and password you chose.

## 6. Add your family

Open **People** and **Add person**, or open your profile (**My profile**) and use **Add relative** to add parents, partners, children and brothers and sisters. **Family tree** draws them: drag to pan, scroll or pinch to zoom, and click a person to see their details. A small green leaf on someone opens their own family (a spouse's parents, or an adopted person's other family).

If you restart before finishing, a new token is made (look in the log again).

## Behind a reverse proxy

KinShip speaks plain HTTP on one port. Put a reverse proxy in front of it for HTTPS (Caddy, Nginx Proxy Manager, Traefik, a Cloudflare Tunnel) and point it at `http://<this machine>:8080`. Then:

- Set `PUBLIC_URL` to your `https://` address.
- Your proxy must pass on the original `Host` header (or send `X-Forwarded-Host`) and should send `X-Forwarded-Proto` and `X-Forwarded-For`. Common proxies do this by default.
- `TRUST_PROXY` tells KinShip which proxies to believe about those headers. The default trusts private networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`). If your proxy reaches KinShip from a public address, add that address. Do not set it to `true` if the web port can be reached directly from the internet.
- If it is wrong you will see it: sign-in cookies are not marked `Secure` over HTTPS, every visitor shares one rate limit, or signing in fails with a "csrf" error.

## Inviting people

Sign in as a SuperAdmin or Family Admin, open the account menu (your name, top right) and choose **Admin**, then **Invite user**. Enter their email address, choose a role, and optionally a person on the tree who has no account yet. KinShip makes a link to copy and send yourself (it sends no email). The link works once, lasts 7 days and is shown only once; if you lose it, make a new one (that cancels the old). Whoever opens it chooses a password and is signed in. An account linked to nobody can be linked later under **Admin → Users → Link to a person**.

## Locked out? Set a new password

**Anyone who is not a SuperAdmin:** ask an admin. On **Admin → Users**, **Set-password link** makes a 24-hour link for that account (a Family Admin can do this for Members and Users; a SuperAdmin for anyone but themselves). Using it signs the account out everywhere, and the account's **My settings** page shows that an admin set the password.

**A SuperAdmin who is locked out:** whoever runs the server sets a new password from the command line; it asks twice, shows nothing, and signs that account out everywhere:

```sh
docker compose exec -it api kinship set-password you@example.com
```

For a script, pipe the password in: `printf '%s' "$NEW_PASSWORD" | docker compose exec -T api kinship set-password you@example.com --password-stdin`. This command exists only inside the container and cannot be reached over HTTP.

## Updating

**Admin → Updates** (SuperAdmin only) tells you when a new version exists, and **What's changing** shows what it brings. Read it, and [UPGRADE.md](UPGRADE.md), first. **Back up before every update** (Admin → Backups → Back up now, then copy it off the server). When a release changes the database or breaks something, the notice hides the steps until you have a backup from the last 24 hours.

1. Change `KINSHIP_VERSION` in `.env` to the new version (both images always share it).
2. `docker compose pull && docker compose up -d`.

KinShip never updates itself. The web and the api must be the same version; if they differ, KinShip shows a page that says so and works again once both match.

After an update, every admin sees a **What's new** popup once at their next sign-in. It can be opened again from **Account menu → About KinShip → What's new**.

Database changes are applied automatically when the api starts. **Before it applies any, it writes an encrypted safety copy of the database** to `data/backups/pre-upgrade-<from>-to-<to>.tar.enc` (the newest three are kept) and checks that it opens. It sits on the same server, so it does not replace your own backup. If the copy cannot be made the upgrade does not start and your data is untouched; the api log says why. On a big database the copy can take minutes, and `docker compose ps` says "starting" until it is done.

To go back after a database change there are no down-migrations: put the old version back and restore the backup you took (see "Back up and restore").

### The update check

Once a day KinShip reads GitHub's public list of releases for this project (`api.github.com`) and shows a notice to the SuperAdmin. It sends **nothing about your installation**; GitHub sees your server's address, as with any download. There is no email. The switch is **Admin → Updates → Check for new versions** (on by default), not a setting in `.env`. With no internet access the check fails quietly; turn it off if you like. **Include pre-releases** (off) also offers release candidates, and **Check now** runs it at once.

If your server reaches the internet through a proxy, set `HTTPS_PROXY` (and `NO_PROXY`) in `.env`. Nothing else in KinShip makes outgoing web requests.

## Back up and restore

**What a backup is.** One encrypted file, `data/backups/kinship-YYYY-MM-DD-HHMM.tar.enc` (UTC), holding a copy of the whole database (0.2 stores no photos or other files yet). It is encrypted with `BACKUP_PASSPHRASE`, which the backup does not contain: keep it somewhere other than this server. Without it nobody can open the backup.

**Making them.** Backups run on a schedule inside the api (every day at 03:00 by default; change the schedule, how many to keep and the time zone in **Admin → Backups**, SuperAdmin only). **Back up now** makes one at once, and **Test the latest backup** restores the newest one into a temporary database, compares it, and throws it away. **Download** asks for your password again. From the command line:

```sh
docker compose exec api kinship backup              # make one now
docker compose exec api kinship backup-list         # what is in the folder
docker compose exec api kinship backup-verify kinship-2026-11-14-0300.tar.enc --full
```

Copy `data/backups` (and your `.env`) somewhere else regularly: a backup on the same disk does not survive the disk.

**If a backup says the database owner cannot read every row.** KinShip's database owner role must be a superuser (the default in the `postgres` image) or have `BYPASSRLS`, otherwise a dump would silently miss rows hidden by row-level security. If you gave KinShip a plain owner role, a superuser must run this once: `docker compose exec db psql -U postgres -c 'ALTER ROLE "<DB_OWNER_USER>" BYPASSRLS;'`.

### Restoring

A restore **replaces everything**: people, accounts, settings. There are two ways.

**From the app (the usual way).** **Admin → Backups**, SuperAdmin only: press **Restore** next to a backup. KinShip first checks the backup (nothing changes) and tells you what it will do; then you type your password and the word `RESTORE`. KinShip makes a safety copy of what is there, pauses the site (people see a maintenance page), replaces the database in one transaction, and **restarts itself**; everyone is signed out, you too, and the page says how it ended. The password you sign in with afterwards is the one the account had when the backup was made, and accounts that were deleted or disabled since then come back active (review Admin → Users). To undo it, restore the `pre-restore-<time>.tar.enc` copy it made. It needs:

- **a restart policy**: the `compose.yml` in this repository has `restart: unless-stopped`. If you run KinShip with your own compose file or `docker run`, give the api container a restart policy, or it stays stopped after a restore;
- **a usable `BACKUP_PASSPHRASE`** in `.env` (it is never typed in the browser);
- **free space** in the backups folder of at least **twice the size of the database**, and **at least the size of the database free on the PostgreSQL volume** (the old data stays until the new data is committed);
- a backup without uploaded files: a backup that carries files is refused until a later release can put the files back.

It does not work for a brand-new server (nobody can sign in yet): use the command line below.

**From the command line** (a new server, a backup made with another passphrase, or when KinShip will not start). Done on the server with KinShip stopped:

```sh
docker compose stop web api
docker compose run --rm api kinship restore kinship-2026-11-14-0300.tar.enc   # asks you to type RESTORE
docker compose up -d
```

It checks the whole backup first, makes a safety copy of what is there (`pre-restore-<time>.tar.enc`), then replaces the database in **one transaction**; if anything fails, the database is exactly as it was. It refuses a backup made by a newer KinShip or PostgreSQL, one with other database role names, one that carries uploaded files, one when the backups folder has less than twice the database size free, and any restore while KinShip is running. Afterwards everyone is signed out and open invitations and set-password links are cancelled. A backup from an older version is brought up to date at the next start. `--yes` skips the question (for scripts), and the passphrase comes from `.env` or `--passphrase-file`.

### A new machine, after a disaster

You need the backup file, your `.env` (**the same database and role names**, and the backup passphrase) and `compose.yml`.

1. Install Docker, put `compose.yml` and `.env` in a folder, `mkdir -p data/backups`, and copy the backup file into it (`chown 1000:1000` as in step 3).
2. `docker compose up -d db --wait` (a new, empty database).
3. `docker compose run --rm api kinship restore kinship-2026-11-14-0300.tar.enc --yes`. It creates the app role itself.
4. `docker compose up -d`.

### Opening a backup without KinShip

You need only the file and the passphrase. **Plain `openssl` cannot open it** (it does not do chunked AES-GCM). Use the stand-alone script, which needs only Node.js: `BACKUP_PASSPHRASE='…' node kinship-decrypt.mjs backup.tar.enc out.tar` ([docs/backup/kinship-decrypt.mjs](docs/backup/kinship-decrypt.mjs)), or the image: `docker run --rm -it -v "$PWD:/b" -e BACKUP_PASSPHRASE ghcr.io/officialjcreyes/kinship-api:<version> kinship backup-decrypt /b/backup.tar.enc /b/out.tar`. Then `tar -xf out.tar`; `database.dump` is a PostgreSQL custom-format dump for `pg_restore`. The format is written down in [docs/backup-format.md](docs/backup-format.md).

### A plain safety copy (`.sql.gz`)

Without a usable passphrase the safety copy before an upgrade is a plain `pre-upgrade-….sql.gz` (mode 0600, on the same disk). `kinship restore` never runs it: it has no password protecting it from being changed, and its SQL would run as the database owner. To use one by hand, into an **empty** database, as the person who trusts the file:

```sh
# The dump gives rights to the app role, but roles are not part of a dump: create it first
# (your DB_APP_USER from .env; kinship_app by default).
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "CREATE ROLE kinship_app LOGIN"'
gunzip -c data/backups/pre-upgrade-0012-to-0013.sql.gz | docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -1 -q'
docker compose up -d      # KinShip sets the app role's password from .env when it starts
```

Set a passphrase so the safety copy is encrypted next time.

### A manual dump (no KinShip needed)

```sh
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | gzip > "kinship-$(date +%F).sql.gz"
```

`.env` holds your passwords: keep it with your backups, somewhere other than this server.

## Stopping and removing

```sh
docker compose down        # stop; the data stays in the volume
docker compose down -v     # stop and DELETE the data
```

## Something wrong?

- `docker compose ps` shows which service is unhealthy; `docker compose logs api` explains why.
- `Configuration error: ... is still the placeholder` means a password in `.env` still starts with `change-me`. (The backup passphrase is the exception: the api starts without a usable one, makes no backups, and Admin → Backups says so.)
- **"KinShip did not start: The safety copy before the database upgrade could not be made"**: the log says why (the backups folder is missing or not writable, no free space, a failing `pg_dump`) and how to fix it. If you cannot, and you have your own backup and accept upgrading without the copy, start once with `KINSHIP_SAFETY_COPY=skip` added under `environment:` of the `api` service (or in `.env`), then remove it again. It is recorded in the upgrade log. Do not leave it set.
- **"The backups folder cannot be written to"** after updating from an earlier release: your `compose.yml` has no backups volume yet. Add the lines under `api:` shown in [UPGRADE.md](UPGRADE.md) and create the folder.
- Report bugs at <https://github.com/officialJCReyes/kinship/issues>. Security problems go through the private reporting form described in [SECURITY.md](SECURITY.md).
