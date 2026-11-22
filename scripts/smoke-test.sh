#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Starts the production stack (compose.yml and .env.example, exactly as shipped) with throwaway
# passwords, walks through a fresh install over HTTP, and removes everything again.
#
#   scripts/smoke-test.sh <version> [expected-commit]
#
# <version> is the KINSHIP_VERSION to run: images ghcr.io/officialjcreyes/kinship-{web,api}:<version>
# must exist locally or be pullable. /api/version must report <version> too, unless EXPECT_VERSION
# says otherwise (for images tagged with a throwaway name). Set SMOKE_PORT to change the port
# (default 18080) and KEEP=1 to leave the stack running afterwards.
set -euo pipefail

version="${1:?usage: smoke-test.sh <version> [expected-commit]}"
expected_commit="${2:-}"
port="${SMOKE_PORT:-18080}"
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
project="kinship-smoke"
base="http://127.0.0.1:${port}"
email="smoke@example.com"
password="smoke-test-passphrase-$(openssl rand -hex 6)"
new_password="smoke-test-changed-$(openssl rand -hex 6)"
owner_password="$(openssl rand -hex 16)"
backup_passphrase="smoke-backup-$(openssl rand -hex 12)"
third_password="smoke-test-restored-$(openssl rand -hex 6)"
app_password="$(openssl rand -hex 16)"

compose() { docker compose --project-name "$project" --project-directory "$work" "$@"; }
# JSON bodies are built here, not inline, so the quoting survives old shells (macOS has bash 3.2).
login_body() { printf '{"email":"%s","password":"%s"}' "$1" "$2"; }
# setup_body <token> <name> <email> <password> <tree>
setup_body() { printf '{"token":"%s","displayName":"%s","email":"%s","password":"%s","treeName":"%s"}' "$1" "$2" "$3" "$4" "$5"; }
# login_status <email> <password> [curl options...]  prints the HTTP status of a sign-in attempt
login_status() { local body; body="$(login_body "$1" "$2")"; shift 2; post /api/auth/login "$body" -o /dev/null -w '%{http_code}' "$@"; }
step() { printf '\n== %s\n' "$*"; }
fail() { printf '\nFAILED: %s\n' "$*" >&2; compose logs --no-color --tail 60 >&2 || true; exit 1; }
cleanup() {
  if [ "${KEEP:-0}" = "1" ]; then echo "KEEP=1: leaving the stack running (project $project, files in $work)"; return; fi
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

expect() { # expect <expected> <actual> <what>
  [ "$2" = "$1" ] || fail "$3: expected $1, got $2"
}
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print(d$1)"; }
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
post() { # post <path> <json> [curl options...]
  local path="$1" body="$2"; shift 2
  curl -s -H 'X-KinShip-Request: 1' -H 'Content-Type: application/json' -H "Origin: ${base}" "$@" -d "$body" "${base}${path}"
}

step "Prepare a throwaway install from the shipped files"
cp "$repo/compose.yml" "$work/compose.yml"
cp "$repo/.env.example" "$work/.env"
# The folder INSTALL.md tells people to create for backups. Made here, writable for the api's user, so that Docker does not
# create it as root (which this script could not remove afterwards).
mkdir -p "$work/data/backups"
chmod 777 "$work/data/backups"
# The same for the encrypted photos folder.
mkdir -p "$work/data/files"
chmod 777 "$work/data/files"
file_key=$(openssl rand -base64 32)
sed -i.bak \
  -e "s|^KINSHIP_VERSION=.*|KINSHIP_VERSION=${version}|" \
  -e "s|^KINSHIP_PORT=.*|KINSHIP_PORT=${port}|" \
  -e "s|^KINSHIP_BIND=.*|KINSHIP_BIND=127.0.0.1|" \
  -e "s|^PUBLIC_URL=.*|PUBLIC_URL=${base}|" \
  -e "s|^DB_OWNER_PASSWORD=.*|DB_OWNER_PASSWORD=${owner_password}|" \
  -e "s|^DB_APP_PASSWORD=.*|DB_APP_PASSWORD=${app_password}|" \
  -e "s|^BACKUP_PASSPHRASE=.*|BACKUP_PASSPHRASE=${backup_passphrase}|" \
  -e "s|^FILE_ENCRYPTION_KEY=.*|FILE_ENCRYPTION_KEY=${file_key}|" \
  "$work/.env"
rm -f "$work/.env.bak"

step "Start the stack and wait until every service is healthy"
compose up -d --wait --wait-timeout 240 || fail "the stack did not become healthy"
compose ps --format 'table {{.Service}}\t{{.Status}}'

step "Only the web port is published; the api and the database are not reachable from outside"
compose ps --format '{{.Service}}: {{.Publishers}}'
published="$(compose ps --format json | python3 -c "
import json, sys
rows = [json.loads(line) for line in sys.stdin if line.strip()]
out = {r['Service']: sorted(p['PublishedPort'] for p in (r.get('Publishers') or []) if p.get('PublishedPort')) for r in rows}
print(json.dumps({k: v for k, v in sorted(out.items()) if v}))")"
[ "$published" = "{\"web\": [${port}]}" ] || fail "expected only web to publish port ${port}, got ${published}"

step "Containers do not run as root"
[ "$(compose exec -T api id -u)" != "0" ] || fail "api runs as root"
[ "$(compose exec -T web id -u)" != "0" ] || fail "web runs as root"

step "Health and version"
[ "$(curl -s "${base}/healthz")" = "ok" ] || fail "/healthz"
version_json="$(curl -s "${base}/api/version")"
echo "$version_json"
expected_version="${EXPECT_VERSION:-$version}"
[ "$(echo "$version_json" | json "['version']")" = "$expected_version" ] || fail "/api/version reports a different version than ${expected_version}"
[ "$(echo "$version_json" | json "['buildDate']")" != "unknown" ] || fail "the build date is not stamped"
[ "$(echo "$version_json" | json "['commit']")" != "unknown" ] || fail "the commit is not stamped"
[ -z "$expected_commit" ] || [ "$(echo "$version_json" | json "['commit']")" = "$expected_commit" ] || fail "the commit is not ${expected_commit}"
[ "$(echo "$version_json" | json "['schema']")" -ge 2 ] || fail "the database was not migrated"
expect 200 "$(status "${base}/")" "the web page"
expect 200 "$(status "${base}/about")" "the web page fallback"

step "A fresh install needs setup, and only the logged token completes it"
[ "$(curl -s "${base}/api/setup/status" | json "['needsSetup']")" = "True" ] || fail "setup should be needed"
token="$(compose logs --no-color --no-log-prefix api | grep -A2 'one-time setup token' | tail -1 | tr -d ' ')"
[ -n "$token" ] || fail "no setup token in the api log"
expect 400 "$(status -X POST -H 'X-KinShip-Request: 1' -H 'Content-Type: application/json' -d '{}' "${base}/api/setup")" "an empty setup should be a bad request"
wrong="$(post /api/setup '{"token":"not-the-token","displayName":"X","email":"x@example.com","password":"aaaaaaaaaaaa","treeName":"X"}' -o /dev/null -w '%{http_code}')"
[ "$wrong" = "403" ] || fail "a wrong token should be refused (got $wrong)"
jar="$work/cookies.txt"
created="$(post /api/setup "$(setup_body "$token" "Smoke Test" "$email" "$password" "Smoke Family")" -c "$jar" -w ' %{http_code}')"
[ "${created##* }" = "201" ] || fail "setup failed: $created"
[ "$(curl -s -b "$jar" "${base}/api/auth/me" | json "['treeName']")" = "Smoke Family" ] || fail "not signed in after setup"
second="$(post /api/setup "$(setup_body "$token" X y@example.com "$password" X)" -w ' %{http_code}')"
[ "${second##* }" = "409" ] || fail "a second setup should be refused with 409: $second"

step "Sign out, refuse a wrong password, sign in"
expect 204 "$(status -X POST -H 'X-KinShip-Request: 1' -b "$jar" "${base}/api/auth/logout")" "logout"
expect 401 "$(status -b "$jar" "${base}/api/auth/me")" "still signed in after logout"
expect 403 "$(status -X POST -H 'Content-Type: application/json' -d '{}' "${base}/api/auth/login")" "a request without the CSRF header should be refused"
expect 401 "$(login_status "$email" "wrong wrong wrong")" "a wrong password should be refused"
rm -f "$jar"
expect 200 "$(login_status "$email" "${password}" -c "$jar")" "sign in"
grep -q "HttpOnly" "$jar" || fail "the session cookie is not HttpOnly"

step "Behind an HTTPS proxy the cookie is marked Secure (the default TRUST_PROXY works)"
login_json="$(login_body "$email" "$password")"
secure="$(post /api/auth/login "$login_json" -D - -o /dev/null -H 'X-Forwarded-Proto: https' | grep -i '^set-cookie' || true)"
echo "$secure" | grep -qi 'secure' || fail "no Secure flag behind an HTTPS proxy: $secure"
plain="$(post /api/auth/login "$login_json" -D - -o /dev/null | grep -i '^set-cookie' || true)"
echo "$plain" | grep -qi 'secure' && fail "Secure flag on plain HTTP: $plain"

step "Data survives taking the stack down and up again, and no new token is made"
compose down >/dev/null
compose up -d --wait --wait-timeout 240 || fail "the stack did not come back"
[ "$(curl -s "${base}/api/setup/status" | json "['needsSetup']")" = "False" ] || fail "setup is needed again after a restart"
expect 200 "$(login_status "$email" "${password}")" "cannot sign in after a restart"
# The containers are new, so their log starts empty: a restart after setup must print no token box at all.
[ "$(compose logs --no-color --no-log-prefix api | grep -c 'one-time setup token')" = "0" ] || fail "a setup token was printed although setup is done"

step "Recovery: kinship set-password (password read from standard input)"
printf '%s' "$new_password" | compose exec -T api kinship set-password "$email" --password-stdin
expect 401 "$(login_status "$email" "${password}")" "the old password still works"
expect 200 "$(login_status "$email" "${new_password}")" "the new password does not work"

step "Photos: an upload through the web container is stored encrypted and served back; too big a body is refused by nginx"
# set-password signed everyone out: sign in again with the new password.
rm -f "$jar"
expect 200 "$(login_status "$email" "${new_password}" -c "$jar")" "sign-in before the photo step"
python3 - "$work/photo.png" <<'PY'
import struct, sys, zlib
w = h = 64
raw = b"".join(b"\x00" + bytes(v for x in range(w) for v in ((x * 4) % 256, (y * 4) % 256, 128)) for y in range(h))
def chunk(kind, data):
    body = kind + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
open(sys.argv[1], "wb").write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
PY
# The smoke account is linked to nobody (setup was sent without a family): add a person to put the photo on.
my_person="$(post /api/people '{"givenName":"Photo","surname":"Smoke"}' -b "$jar" | json "['person']['id']")"
[ -n "$my_person" ] || fail "could not add a person for the photo"
upload_out="$(curl -s -w '\n%{http_code}' -X POST -H 'X-KinShip-Request: 1' -H "Origin: ${base}" -H 'Content-Type: image/png' -b "$jar" --data-binary "@$work/photo.png" "${base}/api/people/${my_person}/photos")"
expect 201 "${upload_out##*$'\n'}" "the photo upload (${upload_out%$'\n'*})"
photo_id="$(echo "${upload_out%$'\n'*}" | json "['photo']['id']")"
expect 2 "$(compose exec -T api sh -c 'find /var/lib/kinship/files/objects -type f | wc -l' | tr -d ' \r')" "files on disk after one upload (full size and avatar)"
curl -s -b "$jar" -D "$work/photo-headers.txt" -o "$work/photo-avatar.png" "${base}/api/media/${photo_id}/avatar"
grep -qi '^content-type: image/png' "$work/photo-headers.txt" || fail "the avatar was not served as image/png"
grep -qi '^cache-control: private, max-age=31536000, immutable' "$work/photo-headers.txt" || fail "the picture is not cached for a year"
grep -qi '^x-content-type-options: nosniff' "$work/photo-headers.txt" || fail "the picture has no nosniff header"
avatar_sum="$(openssl dgst -sha256 "$work/photo-avatar.png" | awk '{print $NF}')"
# nginx refuses a body over 12 MB for the upload route before it reaches the api (and the api refuses over 10 MB by itself).
head -c 13000000 /dev/zero > "$work/too-big.bin"
expect 413 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'X-KinShip-Request: 1' -H "Origin: ${base}" -H 'Content-Type: image/png' -b "$jar" --data-binary "@$work/too-big.bin" "${base}/api/people/${my_person}/photos")" "a 13 MB upload"
# A body between 1 MB and 10 MB must get through nginx (its default limit is 1 MB): the api refuses it as a picture, not nginx as too large.
head -c 3000000 /dev/zero > "$work/not-a-photo.bin"
expect 415 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'X-KinShip-Request: 1' -H "Origin: ${base}" -H 'Content-Type: image/png' -b "$jar" --data-binary "@$work/not-a-photo.bin" "${base}/api/people/${my_person}/photos")" "a 3 MB file that is not a picture"
rm -f "$work/too-big.bin" "$work/not-a-photo.bin"

step "Backup: make one, list it, verify it in full (restored into a temporary database)"
backup_out="$(compose exec -T api kinship backup 2>&1)" || fail "kinship backup failed: $backup_out"
echo "$backup_out"
backup_file="$(echo "$backup_out" | sed -n 's/^Backup written: \([^ ]*\) .*/\1/p' | head -1)"
[ -n "$backup_file" ] || fail "kinship backup did not name the file it wrote"
compose exec -T api kinship backup-list | grep -q "^${backup_file} " || fail "backup-list does not show ${backup_file}"
compose exec -T api kinship backup-verify "$backup_file" --full || fail "backup-verify --full failed"
[ -f "$work/data/backups/${backup_file}" ] || fail "the backup file is not in the mounted backups folder"

step "Restore: data changed after the backup comes back as it was"
printf '%s' "$third_password" | compose exec -T api kinship set-password "$email" --password-stdin
expect 200 "$(login_status "$email" "${third_password}")" "the changed password does not work"
compose stop web api >/dev/null
restore_out="$(compose run --rm -T api kinship restore "$backup_file" --yes 2>&1)" || fail "kinship restore failed: $restore_out"
echo "$restore_out" | tail -4
compose up -d --wait --wait-timeout 240 || fail "the stack did not come back after the restore"
expect 401 "$(login_status "$email" "${third_password}")" "the password changed after the backup survived the restore"
expect 200 "$(login_status "$email" "${new_password}")" "the password from the backup does not work after the restore"
[ "$(curl -s "${base}/api/setup/status" | json "['needsSetup']")" = "False" ] || fail "setup is needed again after a restore"
rm -f "$jar"
expect 200 "$(login_status "$email" "${new_password}" -c "$jar")" "sign-in after the restore (everyone is signed out by it)"
expect 1 "$(curl -s -b "$jar" "${base}/api/admin/files" | json "['photos']")" "photos after the restore"
curl -s -b "$jar" -o "$work/photo-restored.png" "${base}/api/media/${photo_id}/avatar"
expect "$avatar_sum" "$(openssl dgst -sha256 "$work/photo-restored.png" | awk '{print $NF}')" "the avatar's bytes after the restore"

step "No password appears in any log (the setup token is shown once, on purpose)"
leaked="$({ compose logs --no-color; echo "$backup_out"; echo "$restore_out"; } | grep -F -e "$password" -e "$new_password" -e "$third_password" -e "$owner_password" -e "$app_password" -e "$backup_passphrase" || true)"
[ -z "$leaked" ] || fail "a password appears in the logs"

printf '\nSMOKE TEST PASSED (version %s)\n' "$version"
