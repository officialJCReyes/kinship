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
sed -i.bak \
  -e "s|^KINSHIP_VERSION=.*|KINSHIP_VERSION=${version}|" \
  -e "s|^KINSHIP_PORT=.*|KINSHIP_PORT=${port}|" \
  -e "s|^KINSHIP_BIND=.*|KINSHIP_BIND=127.0.0.1|" \
  -e "s|^PUBLIC_URL=.*|PUBLIC_URL=${base}|" \
  -e "s|^DB_OWNER_PASSWORD=.*|DB_OWNER_PASSWORD=${owner_password}|" \
  -e "s|^DB_APP_PASSWORD=.*|DB_APP_PASSWORD=${app_password}|" \
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

step "No password appears in any log (the setup token is shown once, on purpose)"
leaked="$(compose logs --no-color | grep -F -e "$password" -e "$new_password" -e "$owner_password" -e "$app_password" || true)"
[ -z "$leaked" ] || fail "a password appears in the logs"

printf '\nSMOKE TEST PASSED (version %s)\n' "$version"
