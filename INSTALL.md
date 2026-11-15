# Installing KinShip

> **Release 0.1 is an alpha.** It installs and runs, you can set up and sign in, but there is no family tree yet. **Data may be wiped between 0.1.x releases: do not enter real family data.** A data-safe upgrade path (and a built-in backup) starts with 0.2.

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

## 3. Start it

```sh
docker compose up -d
docker compose ps        # wait until web, api and db say "healthy"
```

The first start downloads the images and creates the database. Only the `web` service publishes a port (plain HTTP, 8080 by default); the database and the api are not reachable from outside.

## 4. First run: create your account

A fresh install must be set up before anyone can sign in, and setup needs a one-time token, so a stranger who finds your site first cannot claim it. The token is printed in the api log:

```sh
docker compose logs api
```

Look for the box that says **"KinShip is not set up yet"** and copy the token. Open your site (for example `http://localhost:8080`), and the setup page appears. Enter the token, your name, your email, a password of at least 12 characters, and a name for your tree. You become the SuperAdmin and are signed in. The setup page never appears again once an account exists.

If you restart before finishing, a new token is made (look in the log again). The token stops working once setup is done.

## Behind a reverse proxy

KinShip speaks plain HTTP on one port. Put a reverse proxy in front of it for HTTPS (Caddy, Nginx Proxy Manager, Traefik, a Cloudflare Tunnel, and so on) and point it at that port (`http://<this machine>:8080`). Then:

- Set `PUBLIC_URL` to your `https://` address.
- Your proxy must pass on the original `Host` header (or send `X-Forwarded-Host`), and should send `X-Forwarded-Proto` and `X-Forwarded-For`. The common proxies do this by default.
- `TRUST_PROXY` tells KinShip which proxies to believe about those headers. The default trusts private networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), which covers a proxy on the same machine, in Docker, or on your home or office network. If your proxy reaches KinShip from a public address, add that address. Do not set it to `true` if the web port can be reached directly from the internet.
- If this is wrong you will see it: sign-in cookies are not marked `Secure` over HTTPS, every visitor shares one rate limit, or signing in fails with a "csrf" error.

## Locked out? Set a new password

There is no email yet. Whoever runs the server can set a new password from the command line; it asks twice, shows nothing, and signs that account out everywhere:

```sh
docker compose exec -it api kinship set-password you@example.com
```

For a script, pipe the password in: `printf '%s' "$NEW_PASSWORD" | docker compose exec -T api kinship set-password you@example.com --password-stdin`. This command exists only inside the container and cannot be reached over HTTP.

## Updating

In 0.1 there is no update notice; watch the [releases page](https://github.com/officialJCReyes/kinship/releases). **0.1.x releases may need an empty database**, so treat an update as a fresh install unless the release notes say otherwise.

1. Read the release notes.
2. Change `KINSHIP_VERSION` in `.env` to the new version (both images always share it).
3. `docker compose pull && docker compose up -d`.

Database changes are applied automatically at startup (migrations run in order, and the api refuses to start if an already-applied migration file was edited). To go back, put the old version back; there are no down-migrations, so going back after a database change means restoring a dump.

## Backing up (by hand, for now)

KinShip has no built-in backup in 0.1. The data is one PostgreSQL database, kept in a Docker volume (`kinship_kinship-db`). **Back up before every update, and keep `.env` with it** (it has your passwords), somewhere other than this server.

```sh
# A compressed dump of the database. Run it in the folder with compose.yml and .env.
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | gzip > "kinship-$(date +%F).sql.gz"
```

## Restoring a backup

Into a **new, empty** install: same `compose.yml`, the same `.env` (the same database and role names and the same `KINSHIP_VERSION`), and no data volume yet.

```sh
docker compose up -d db --wait

# The dump gives rights to the app role, but roles are not part of a dump: create it first.
# Use the DB_APP_USER from your .env (kinship_app by default).
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "CREATE ROLE kinship_app LOGIN"'

# Restore, and stop at the first error.
gunzip -c kinship-2026-11-15.sql.gz | docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q'

docker compose up -d      # KinShip sets the app role's password from .env when it starts
```

Skipping the role step makes the restore fail with `role "kinship_app" does not exist`. If it fails part-way, run `docker compose down -v` (this deletes the half-restored data) and start again.

## Stopping and removing

```sh
docker compose down        # stop; the data stays in the volume
docker compose down -v     # stop and DELETE the data
```

## Something wrong?

- `docker compose ps` shows which service is unhealthy; `docker compose logs api` explains why.
- `Configuration error: ... is still the placeholder` means a password in `.env` still starts with `change-me`.
- Report bugs at <https://github.com/officialJCReyes/kinship/issues>. Security problems go through the private reporting form described in [SECURITY.md](SECURITY.md).
