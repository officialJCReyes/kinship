# Installing KinShip

> **Release 0.1 is an alpha.** It installs and runs, you can set up and sign in, add people and relationships (with birth and adoptive parents) and see them on a family tree chart. **Data may be wiped between 0.1.x releases: do not enter real family data.** A data-safe upgrade path (and a built-in backup) starts with 0.2.

You need a machine that runs Docker (Linux, a Raspberry Pi, a NAS, or a cloud server) with Docker Compose v2. You do not need to build anything.

## 1. Get the files

Make a folder and put two files in it, from the [release page](https://github.com/officialJCReyes/kinship/releases) (each release has them attached):

```sh
mkdir kinship && cd kinship
# compose.yml and .env.example, from the release you want
cp .env.example .env
chmod 600 .env
```

## 2. Fill in `.env`

Open `.env`; every setting is explained in it. You must set two things:

- `DB_OWNER_PASSWORD` and `DB_APP_PASSWORD`: two different, long, random passwords. For example `openssl rand -base64 24`, twice. KinShip refuses to start while they still say `change-me`.

Worth a look before you start:

- `PUBLIC_URL`: the address people will type (for example `https://family.example.com`).
- `KINSHIP_PORT` and `KINSHIP_BIND`: the web port (default 8080). Use `KINSHIP_BIND=127.0.0.1` if your reverse proxy runs on the same machine.
- `TRUST_PROXY`: see "Behind a reverse proxy" below.

`.env` holds your passwords. Do not commit it or share it.

## 3. Create the backups folder

KinShip writes its backups to `./data/backups` next to `compose.yml` (see "Back up and restore" below). Create it before the first start, so the api (which runs as user 1000, not as root) can write to it:

```sh
mkdir -p data/backups && sudo chown 1000:1000 data/backups
```

Docker Desktop on macOS and Windows does not need the `chown`. Also set `BACKUP_PASSPHRASE` in `.env` (step 2): it encrypts every backup, it must be at least 16 characters, and **you must keep a copy somewhere other than this server** (a password manager is a good place). Without it KinShip still runs, but it makes no backups and says so in Admin.

## 4. Start it

```sh
docker compose up -d
docker compose ps        # wait until web, api and db say "healthy"
```

The first start downloads the images and creates the database. Only the `web` service publishes a port (plain HTTP, 8080 by default); the database and the api are not reachable from outside.

## 5. First run: create your account

A fresh install must be set up before anyone can sign in, and setup needs a one-time token, so a stranger who finds your site first cannot claim it. The token is printed in the api log:

```sh
docker compose logs api
```

Look for the box that says **"KinShip is not set up yet"** and copy the token. Open your site (for example `http://localhost:8080`), and the setup wizard appears. It has seven steps, with a progress bar:

1. **Account**: the setup token, your name, your email (also your sign-in name) and a password of at least 12 characters. The token is checked when you press **Next**.
2. **Tree**: a name for your tree (suggested from your surname, like "Hale Family") and the color scheme.
3. **You**: your given name and surname (suggested from your name), your birth date and gender. This creates you as the first person on the tree and links your account to you.
4. **Partner**, 5. **Parents** and 6. **Children**: optional. Press **Skip this step** to leave one out, or fill in what you know. You can add everyone else from the tree afterwards.
7. **Review**: a list of the people who will be created. Press **Create my tree**.

**Nothing is created until the last step**, and then everything is created at once: if anything fails, nothing is kept and your token still works. If you refresh the page or close the tab before then, the wizard starts again from step 1 (nothing you typed is stored in the browser). The shortest way through is steps 1 to 3 and then Review. You become the SuperAdmin and are signed in, and your own place on the family tree opens. The setup page never appears again once an account exists; if the connection drops right after you press **Create my tree**, open the sign-in page and use the email and password you chose.

## 6. Add your family

Open **People** and **Add person**, or open your profile (**My profile**) and use **Add relative** to add parents, partners, children and brothers and sisters. **Family tree** draws them: drag to pan, scroll or pinch to zoom, and click a person to see their details. A small green leaf on someone opens their own family (a spouse's parents, or an adopted person's other family).

If you restart before finishing, a new token is made (look in the log again). The token stops working once setup is done.

## Behind a reverse proxy

KinShip speaks plain HTTP on one port. Put a reverse proxy in front of it for HTTPS (Caddy, Nginx Proxy Manager, Traefik, a Cloudflare Tunnel, and so on) and point it at that port (`http://<this machine>:8080`). Then:

- Set `PUBLIC_URL` to your `https://` address.
- Your proxy must pass on the original `Host` header (or send `X-Forwarded-Host`), and should send `X-Forwarded-Proto` and `X-Forwarded-For`. The common proxies do this by default.
- `TRUST_PROXY` tells KinShip which proxies to believe about those headers. The default trusts private networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), which covers a proxy on the same machine, in Docker, or on your home or office network. If your proxy reaches KinShip from a public address, add that address. Do not set it to `true` if the web port can be reached directly from the internet.
- If this is wrong you will see it: sign-in cookies are not marked `Secure` over HTTPS, every visitor shares one rate limit, or signing in fails with a "csrf" error.

## Inviting people

Sign in as a SuperAdmin or Family Admin, open the account menu (your name, top right) and choose **Admin**, then **Invite user**. Enter their email address, choose a role, and optionally a person on the tree who has no account yet. KinShip makes a link: copy it and send it yourself, because KinShip sends no email yet. The link works once and lasts 7 days. It is shown only once; if you lose it, make a new link (that cancels the old one). Whoever opens it chooses a password and is signed in.

## Locked out? Set a new password

**Anyone who is not a SuperAdmin:** ask an admin. On **Admin → Users**, **Set-password link** makes a 24-hour link for that account (a Family Admin can do this for Members and Users; a SuperAdmin for anyone but themselves). Using it signs the account out everywhere, and the account's **My settings** page shows that an admin set the password.

**A SuperAdmin who is locked out:** whoever runs the server sets a new password from the command line; it asks twice, shows nothing, and signs that account out everywhere:

```sh
docker compose exec -it api kinship set-password you@example.com
```

For a script, pipe the password in: `printf '%s' "$NEW_PASSWORD" | docker compose exec -T api kinship set-password you@example.com --password-stdin`. This command exists only inside the container and cannot be reached over HTTP.

## Updating

Watch the [releases page](https://github.com/officialJCReyes/kinship/releases) and read the release notes and [UPGRADE.md](UPGRADE.md) first. **Back up before every update** (Admin → Backups → Back up now, then download it or copy it off the server).

1. Change `KINSHIP_VERSION` in `.env` to the new version (both images always share it).
2. `docker compose pull && docker compose up -d`.

Database changes are applied automatically when the api starts (in order, and the api refuses to start if an already-applied migration file was edited). **Before it applies any, it writes a safety copy of the database** to `data/backups/pre-upgrade-<from>-to-<to>.tar.enc` (encrypted with your backup passphrase; the newest three are kept) and checks that it opens. It is a net under your own backup, not a replacement: it sits on the same server. If the copy cannot be made the upgrade does not start and your data is untouched; the api log says why and how to fix it. On a big database the copy can take minutes: the site shows nothing, and `docker compose ps` says "starting", until the copy and the change are done.

To go back after a database change there are no down-migrations: put the old version back and restore the backup you took (see "Back up and restore").

## Back up and restore

**What a backup is.** One encrypted file, `data/backups/kinship-YYYY-MM-DD-HHMM.tar.enc` (UTC), holding a copy of the whole database (and, once KinShip stores photos, the files). It is encrypted with `BACKUP_PASSPHRASE`. **The backup does not contain that passphrase or `FILE_ENCRYPTION_KEY`: keep both somewhere other than this server.** Without the passphrase a backup cannot be opened by anyone, including you.

**Making them.** Backups run on a schedule inside the api (every day at 03:00 by default; change it, how many to keep and the time zone in **Admin → Backups**, which only the SuperAdmin sees). **Back up now** makes one at once, and **Test the latest backup** restores the newest one into a temporary database, compares it with what was backed up, and throws it away. **Download** asks for your password again. From the command line:

```sh
docker compose exec api kinship backup              # make one now
docker compose exec api kinship backup-list         # what is in the folder
docker compose exec api kinship backup-verify kinship-2026-11-14-0300.tar.enc --full
```

Copy `data/backups` (and your `.env`) somewhere else regularly: a backup on the same disk does not survive the disk.

**If a backup says the database owner cannot read every row.** KinShip's database owner role must be a superuser (the default in the `postgres` image) or have `BYPASSRLS`, otherwise a dump would silently miss rows hidden by row-level security. If you gave KinShip a plain owner role, a superuser must run this once: `docker compose exec db psql -U postgres -c 'ALTER ROLE "<DB_OWNER_USER>" BYPASSRLS;'`.

### Restoring

A restore **replaces everything**: people, accounts, settings. It is done on the server with KinShip stopped, never from the browser.

```sh
docker compose stop web api
docker compose run --rm api kinship restore kinship-2026-11-14-0300.tar.enc   # asks you to type RESTORE
docker compose up -d
```

It first decrypts and checks the whole backup; refuses one made by a newer KinShip, from a newer PostgreSQL, with other database role names, or while KinShip is still running; makes a safety copy of what is there (`pre-restore-<time>.tar.enc`); then replaces the database in **one transaction** that checks the result before it commits. If anything fails, the database is exactly as it was. Afterwards everyone is signed out and open invitations and set-password links are cancelled. A backup from an older version is brought up to date by the same start. `--yes` skips the question (for scripts), and the passphrase comes from `.env` or `--passphrase-file`.

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
