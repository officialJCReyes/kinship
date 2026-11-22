#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The upgrade test: a real installation of the PREVIOUS published release is filled with data, upgraded in place to the build
# under test, and checked. Nothing may be lost, and the safety copy it made must restore on a brand-new machine.
#
#   scripts/upgrade-test.sh <image-tag> [expected-commit]
#
# <image-tag> is the KINSHIP_VERSION of the build under test: ghcr.io/officialjcreyes/kinship-{web,api}:<image-tag> must exist
# locally (CI builds them as :ci). Its real version is whatever its package.json says; set EXPECT_VERSION to check it.
#
# Environment:
#   PREVIOUS_TAG      the release to start from (v0.1.0-alpha.2). Default: scripts/upgrade-test/previous-release.mjs picks it from
#                     `gh release list` (needs the gh command and GH_TOKEN). ON_TAG=true makes it pick one older than the build.
#   EXPECT_VERSION    the version the images under test must report (default: package.json of the checkout)
#   UPGRADE_PORT      host port (default 18081); KEEP=1 leaves the stack running.
#
# What it does, in the order a person upgrading would:
#   1. starts the previous release from ITS compose.yml and env example, with its own images from GHCR
#   2. seeds data through its API (scripts/upgrade-test/seed-<version>.sh; one per release it can start from)
#   3. does what UPGRADE.md tells a real user: the new compose.yml, the backups folder, a backup passphrase, the new version
#   4. starts the new images and checks the migration, the data, the sign-ins, the upgrade log, the safety copy, What's new
#   5. stops everything, throws the database away, and restores the safety copy on an empty database (a new machine)
#   6. checks that no secret is in any log
set -euo pipefail

image_tag="${1:?usage: upgrade-test.sh <image-tag> [expected-commit]}"
expected_commit="${2:-}"
port="${UPGRADE_PORT:-18081}"
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
project="kinship-upgrade"
base="http://127.0.0.1:${port}"
rand() { openssl rand -hex "$1"; }
admin_email="marcus@example.com"; admin_password="upgrade-admin-$(rand 6)"
member_email="eleanor@example.com"; member_password="upgrade-member-$(rand 6)"
user_email="visitor@example.com"; user_password="upgrade-visitor-$(rand 6)"
owner_password="$(rand 16)"; app_password="$(rand 16)"; backup_passphrase="upgrade-backup-$(rand 12)"
jar="$work/cookies.txt"
logs="$work/logs.txt"
: > "$logs"

compose() { docker compose --project-name "$project" --project-directory "$work" "$@"; }
step() { printf '\n== %s\n' "$*"; }
fail() { printf '\nFAILED: %s\n' "$*" >&2; compose logs --no-color --tail 80 >&2 || true; exit 1; }
cleanup() {
  if [ "${KEEP:-0}" = "1" ]; then echo "KEEP=1: leaving the stack running (project $project, files in $work)"; return; fi
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

expect() { [ "$2" = "$1" ] || fail "$3: expected '$1', got '$2'"; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print(d$1)"; }
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
post() { # post <path> <json> [curl options...]
  local path="$1" body="$2"; shift 2
  curl -s -H 'X-KinShip-Request: 1' -H 'Content-Type: application/json' -H "Origin: ${base}" "$@" -d "$body" "${base}${path}"
}
# The same, signed in with the cookie jar; fails the test on any status but 2xx and prints the body.
api() { # api <METHOD> <path> <json>
  local out code
  out="$(curl -s -X "$1" -H 'X-KinShip-Request: 1' -H 'Content-Type: application/json' -H "Origin: ${base}" -b "$jar" -d "$3" -w '\n%{http_code}' "${base}$2")"
  code="${out##*$'\n'}"; out="${out%$'\n'*}"
  case "$code" in 2??) printf '%s' "$out" ;; *) fail "$1 $2 answered $code: $out" ;; esac
}
api_post() { api POST "$1" "$2"; }
api_patch() { api PATCH "$1" "$2"; }
new_person() { api_post /api/people "$1" | json "['person']['id']"; }
new_union() { # new_union <a> <b> <status> <start>
  api_post /api/unions "$(printf '{"partnerIds":["%s","%s"],"status":"%s","start":{"value":"%s"}}' "$1" "$2" "$3" "$4")" | json "['union']['id']"
}
login_status() { # login_status <email> <password> [curl options...]
  local body; body="$(printf '{"email":"%s","password":"%s"}' "$1" "$2")"; shift 2
  post /api/auth/login "$body" -o /dev/null -w '%{http_code}' "$@"
}
# Runs SQL as the database owner and prints bare values.
sql() { compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -v ON_ERROR_STOP=1' <<<"$1"; }
# An argon2id hash made by the api container that is running (so it is the hash that release verifies).
hash_password() { compose exec -T api node --input-type=module -e "import { hash } from '@node-rs/argon2'; process.stdout.write(await hash(process.argv[1]))" "$1"; }
save_logs() { compose logs --no-color >> "$logs" 2>&1 || true; }

# A fingerprint of everything a person typed in, over columns every release has. Status is left out on purpose: migration 0007
# changes Married to Widowed when a partner is deceased.
digest() {
  sql "select md5(string_agg(x, '|' order by x)) from (
         select 'p:' || id || given_name || surname || coalesce(gender, '') || coalesce(birth_date::text, '') || birth_precision || deceased::text || coalesce(death_date::text, '') as x from people
         union all select 'u:' || id || partner_a_id || partner_b_id || coalesce(start_date::text, '') from unions
         union all select 'c:' || child_id || kind || coalesce(union_id::text, '') || coalesce(parent_id::text, '') from person_parents
         union all select 'a:' || id || email || role || coalesce(person_id::text, '') from users) t"
}

# ---- which release to start from ---------------------------------------------------------------------------------------------
current_version="${EXPECT_VERSION:-$(node -p "require('$repo/package.json').version")}"
previous_tag="${PREVIOUS_TAG:-}"
if [ -z "$previous_tag" ]; then
  step "Find the previous release"
  set +e
  previous_tag="$(gh release list --repo officialJCReyes/kinship --exclude-drafts --limit 100 --json tagName | CURRENT_VERSION="$current_version" ON_TAG="${ON_TAG:-false}" node "$repo/scripts/upgrade-test/previous-release.mjs")"
  found=$?
  set -e
  if [ "$found" = "3" ]; then echo "There is no earlier release to upgrade from; nothing to test."; exit 0; fi
  [ "$found" = "0" ] || fail "could not work out the previous release"
fi
previous_version="${previous_tag#v}"
echo "Upgrading from ${previous_tag} to ${current_version} (images tagged ${image_tag})"
seed="$repo/scripts/upgrade-test/seed-${previous_version}.sh"
[ -f "$seed" ] || fail "there is no seed for ${previous_version}: add scripts/upgrade-test/seed-${previous_version}.sh (copy the newest seed in scripts/upgrade-test/ and adjust it; the upgrade test starts every run from a published release, and needs one seed per release it can start from)"

# ---- the previous release, as a user installed it ----------------------------------------------------------------------------
step "Fetch ${previous_tag}'s own compose.yml and settings file from its release page"
mkdir -p "$work/release"
gh release download "$previous_tag" --repo officialJCReyes/kinship --dir "$work/release" --pattern 'compose.yml' --pattern '*env.example'
cp "$work/release/compose.yml" "$work/compose.yml"
# env.example from 0.2.0 on; GitHub dropped the leading dot of .env.example before that (default.env.example).
env_example=""
for candidate in env.example default.env.example; do
  if [ -z "$env_example" ] && [ -f "$work/release/$candidate" ]; then env_example="$work/release/$candidate"; fi
done
[ -n "$env_example" ] || fail "the release has no settings file"
cp "$env_example" "$work/.env"
set_env() { sed -i.bak -e "s|^$1=.*|$1=$2|" "$work/.env"; rm -f "$work/.env.bak"; }
set_env KINSHIP_VERSION "$previous_version"
set_env KINSHIP_PORT "$port"
set_env KINSHIP_BIND 127.0.0.1
set_env PUBLIC_URL "$base"
set_env DB_OWNER_PASSWORD "$owner_password"
set_env DB_APP_PASSWORD "$app_password"

# The backups folder, made before anything starts: a release from 0.2.0-rc.1 on bind-mounts it, and Docker would otherwise create it
# owned by root, which this script could neither change nor remove. World-writable, like the chown in UPGRADE.md, so the api (uid
# 1000) can write to it and this script can remove what it wrote.
mkdir -p "$work/data/backups" "$work/data/files"; chmod 777 "$work/data/backups" "$work/data/files"

step "Start ${previous_tag} from its published images"
compose pull -q
compose up -d --wait --wait-timeout 240 || fail "the previous release did not become healthy"
prev_version_json="$(curl -s "${base}/api/version")"
expect "$previous_version" "$(echo "$prev_version_json" | json "['version']")" "the previous release's version"
previous_schema="$(echo "$prev_version_json" | json "['schema']")"
echo "schema ${previous_schema}"

step "Seed it with data through its own API"
# shellcheck disable=SC1090
. "$seed"
seed_previous_release
before_digest="$(digest)"
echo "fingerprint of the data: ${before_digest}"
before_counts="$(sql 'select (select count(*) from people) || chr(32) || (select count(*) from unions) || chr(32) || (select count(*) from person_parents) || chr(32) || (select count(*) from users)')"
echo "people, relationships, parent links, accounts: ${before_counts}"
expect 200 "$(login_status "$member_email" "$member_password")" "the seeded Member cannot sign in to the previous release"
expect 200 "$(login_status "$user_email" "$user_password")" "the seeded User cannot sign in to the previous release"
save_logs

# ---- the upgrade, as UPGRADE.md says -----------------------------------------------------------------------------------------
step "Upgrade: the new compose.yml, the backups folder, a passphrase, the new version"
compose down >/dev/null
cp "$repo/compose.yml" "$work/compose.yml"
printf '\nBACKUP_PASSPHRASE=%s\nFILE_ENCRYPTION_KEY=%s\n' "$backup_passphrase" "$(openssl rand -base64 32)" >> "$work/.env"
set_env KINSHIP_VERSION "$image_tag"
compose up -d --wait --wait-timeout 600 || fail "the new build did not become healthy"
save_logs

step "The new build runs, and it migrated"
version_json="$(curl -s "${base}/api/version")"
echo "$version_json"
expect "$current_version" "$(echo "$version_json" | json "['version']")" "the version of the build under test"
[ -z "$expected_commit" ] || expect "$expected_commit" "$(echo "$version_json" | json "['commit']")" "the commit of the build under test"
top_schema="$(ls "$repo/apps/api/migrations" | sed -n 's/^\([0-9]*\)_.*\.sql$/\1/p' | sort | tail -1 | sed 's/^0*//')"
expect "$top_schema" "$(echo "$version_json" | json "['schema']")" "the database schema number"
expect "$top_schema" "$(sql 'select schema_number from schema_info')" "schema_info"

step "Nothing was lost"
expect "$before_digest" "$(digest)" "the fingerprint of the data"
expect "$before_counts" "$(sql 'select (select count(*) from people) || chr(32) || (select count(*) from unions) || chr(32) || (select count(*) from person_parents) || chr(32) || (select count(*) from users)')" "the counts"
assert_seed_after_upgrade

step "Everyone can still sign in, with the same passwords, and the roles are what they were"
for who in admin member user; do
  eval "mail=\$${who}_email; pass=\$${who}_password"
  rm -f "$jar"
  expect 200 "$(login_status "$mail" "$pass" -c "$jar")" "sign-in of the ${who}"
  me="$(curl -s -b "$jar" "${base}/api/auth/me")"
  role="$(echo "$me" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("user", {}).get("role", "?"))')"
  [ "$role" != "?" ] || fail "GET /api/auth/me for the ${who} answered: $me"
  case "$who" in admin) expect superadmin "$role" "role of the admin" ;; member) expect member "$role" "role of the member" ;; user) expect user "$role" "role of the user" ;; esac
done
rm -f "$jar"
expect 200 "$(login_status "$admin_email" "$admin_password" -c "$jar")" "sign-in of the admin"

step "Photos after the upgrade: the key and the files folder are in place, and a missing key does not stop KinShip"
files_json="$(curl -s -b "$jar" "${base}/api/admin/files")"
echo "$files_json"
expect ready "$(echo "$files_json" | json "['state']")" "the photo state with the key and the folder in place"
echo "$files_json" | python3 -c 'import json,re,sys; sys.exit(0 if re.fullmatch(r"[0-9a-f]{16}", json.load(sys.stdin)["keyId"] or "") else 1)' || fail "the key id is not 16 hex characters"
expect 0 "$(echo "$files_json" | json "['photos']")" "photos in a database that has never had one"
expect 1 "$(sql "select count(*) from pg_proc where proname = 'kinship_media_exists'")" "migration 0021 left its start-up function"
expect "t" "$(sql "select (obj_description('public'::regnamespace, 'pg_namespace') is null or obj_description('public'::regnamespace, 'pg_namespace') not like 'kinship-restore:%')")" "no restore marker before any restore"
# The key is optional: take it away, and the api still starts, signs people in, and says why photos are off.
file_key_line="$(grep '^FILE_ENCRYPTION_KEY=' "$work/.env" | tail -1 | cut -d= -f2-)"
[ -n "$file_key_line" ] || fail "the test did not put a FILE_ENCRYPTION_KEY in .env"
set_env FILE_ENCRYPTION_KEY ""
compose up -d --force-recreate --wait --wait-timeout 600 api || fail "the api did not start without a file key"
expect key_missing "$(curl -s -b "$jar" "${base}/api/admin/files" | json "['state']")" "the photo state without a key"
expect 200 "$(curl -s -o /dev/null -w '%{http_code}' -b "$jar" "${base}/api/people")" "the tree with photos off"
set_env FILE_ENCRYPTION_KEY "$file_key_line"
compose up -d --force-recreate --wait --wait-timeout 600 api || fail "the api did not start with the file key back"
expect ready "$(curl -s -b "$jar" "${base}/api/admin/files" | json "['state']")" "the photo state with the key back"
save_logs

step "A photo uploaded after the upgrade is stored encrypted, served back, and carried by a backup"
# A real 64x64 PNG made here (no picture from anywhere else goes in this repo).
python3 - "$work/test-photo.png" <<'PY'
import struct, sys, zlib
w = h = 64
raw = b"".join(b"\x00" + bytes(v for x in range(w) for v in ((x * 4) % 256, (y * 4) % 256, 128)) for y in range(h))
def chunk(kind, data):
    body = kind + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
open(sys.argv[1], "wb").write(png)
PY
upload_out="$(curl -s -w '\n%{http_code}' -X POST -H 'X-KinShip-Request: 1' -H "Origin: ${base}" -H 'Content-Type: image/png' -b "$jar" --data-binary "@$work/test-photo.png" "${base}/api/people/${marcus}/photos")"
upload_code="${upload_out##*$'\n'}"; upload_body="${upload_out%$'\n'*}"
expect 201 "$upload_code" "the upload after the upgrade ($upload_body)"
photo_id="$(echo "$upload_body" | json "['photo']['id']")"
expect 2 "$(find "$work/data/files/objects" -type f | wc -l | tr -d ' ')" "files on disk after one upload (full size and avatar)"
if grep -q 'PNG' "$(find "$work/data/files/objects" -type f | head -1)"; then fail "a stored photo file is not encrypted"; fi
curl -s -b "$jar" -o "$work/avatar.png" -w '%{http_code} %{content_type}\n' "${base}/api/media/${photo_id}/avatar" | grep -q '^200 image/png$' || fail "the avatar was not served as a PNG"
[ "$(head -c 8 "$work/avatar.png" | od -An -tx1 | tr -d ' \n')" = "89504e470d0a1a0a" ] || fail "the served avatar is not a PNG"
avatar_sum="$(openssl dgst -sha256 "$work/avatar.png" | awk '{print $NF}')"
expect 1 "$(echo "$(curl -s -b "$jar" "${base}/api/admin/files")" | json "['photos']")" "photos Admin counts"
# A backup now carries the photo, and its test reads it back with the key.
with_files="$(compose exec -T api kinship backup 2>&1 | sed -n 's/^Backup written: \([^ ]*\) .*/\1/p' | head -1)"
echo "backup with photos: ${with_files}"
[ -f "$work/data/backups/${with_files}" ] || fail "the backup with photos is not in the backups folder (${with_files})"
verify_out="$(compose exec -T api kinship backup-verify "${with_files}" --full 2>&1)" || fail "kinship backup-verify --full failed for ${with_files}: ${verify_out}"
echo "$verify_out" | tail -4
echo "$verify_out" | grep -qi 'key OK' || fail "the backup test did not report 'key OK' for the photos: ${verify_out}"
save_logs

# A release that already keeps an upgrade log (0.2.0-rc.1 on) wrote its own row for its fresh install, with from_schema NULL; the
# rows that count here are the ones from an upgrade (from_schema set).
if [ "$previous_schema" != "$top_schema" ]; then
  step "The upgrade log says what happened"
  expect 1 "$(sql "select count(*) from upgrade_log where event = 'migrate' and from_schema is not null")" "upgrade_log migrate rows"
  expect "${previous_schema}|${top_schema}" "$(sql "select from_schema || '|' || to_schema from upgrade_log where event = 'migrate' and from_schema is not null")" "from and to schema numbers"
  # A release that did not track its version leaves schema_info.app_version empty, and the log says so with NULL.
  if [ "$previous_version" = "0.1.0-alpha.2" ] || [ "$previous_version" = "0.1.0-alpha.1" ]; then
    expect "" "$(sql "select coalesce(from_version, '') from upgrade_log where event = 'migrate' and from_schema is not null")" "from_version of a release that has none"
  else
    expect "$previous_version" "$(sql "select from_version from upgrade_log where event = 'migrate' and from_schema is not null")" "from_version"
  fi
  expect "$current_version" "$(sql "select to_version from upgrade_log where event = 'migrate' and from_schema is not null")" "to_version"

  step "The safety copy exists, is listed, verifies in full, and nothing secret is in its name"
  safety="pre-upgrade-$(printf '%04d' "$previous_schema")-to-$(printf '%04d' "$top_schema").tar.enc"
  expect "$safety" "$(sql "select safety_copy from upgrade_log where event = 'migrate' and from_schema is not null")" "the safety copy named in the log"
  [ -f "$work/data/backups/$safety" ] || fail "$safety is not in the backups folder"
  compose exec -T api kinship backup-list | grep -q "^${safety} " || fail "kinship backup-list does not show $safety"
  compose exec -T api kinship backup-verify "$safety" --full || fail "kinship backup-verify --full failed for $safety"
else
  step "The build has no database change over ${previous_tag}: no upgrade_log row is expected"
  expect 0 "$(sql "select count(*) from upgrade_log where event = 'migrate' and from_schema is not null")" "upgrade_log migrate rows"
  safety=""
fi

step "What's new, for an admin who last saw the previous release"
# The route answers for the signed-in admin. The expected answer is computed from this checkout's own CHANGELOG.md with the
# same functions the api uses, so it is right whatever the version is; on a release (tag) it also has to name the release.
whats_new="$(curl -s -b "$jar" "${base}/api/updates/whats-new")"
echo "$whats_new" | head -c 600; echo
latest="$(curl -s -b "$jar" "${base}/api/updates/whats-new?latest=1")"
expect "$current_version" "$(echo "$latest" | json "['to']")" "What's new (latest) names the running version"
# The popup is for what changed since the version the admin last saw. An account of a release that does not track versions
# (alpha.1 and alpha.2) counts as having seen 0.1.0-alpha.2; an account made by a release that does has seen that release.
whats_new_floor="0.1.0-alpha.2"
case "$previous_version" in 0.1.0-alpha.1 | 0.1.0-alpha.2) ;; *) whats_new_floor="$previous_version" ;; esac
expected_show="$(node --input-type=module -e "
  import { readFileSync } from 'node:fs';
  import { parseChangelog, sectionsBetween, compareSemver, parseSemver } from '$repo/packages/shared/dist/index.js';
  const running = process.argv[1], floor = process.argv[2];
  const newer = compareSemver(parseSemver(running), parseSemver(floor)) > 0;
  const sections = sectionsBetween(parseChangelog(readFileSync('$repo/CHANGELOG.md', 'utf8')), floor, running).map((s) => s.version);
  console.log(JSON.stringify({ show: newer, sections }));
" "$current_version" "$whats_new_floor")"
expect "$(echo "$expected_show" | json "['show']")" "$(echo "$whats_new" | json "['show']")" "whether What's new is shown"
expect "$(echo "$expected_show" | python3 -c 'import json,sys; print(json.load(sys.stdin)["sections"])')" \
  "$(echo "$whats_new" | python3 -c 'import json,sys; print([s["version"] for s in json.load(sys.stdin)["sections"]])')" "the sections What's new lists"
if [ "$previous_schema" != "$top_schema" ] && [ "$(echo "$whats_new" | json "['show']")" = "True" ]; then
  expect "$top_schema" "$(echo "$whats_new" | json "['migrations'][0]['toSchema']")" "the migration What's new reports"
  expect "$safety" "$(echo "$whats_new" | json "['migrations'][0]['safetyCopy']")" "the safety copy What's new reports"
fi
# A stable release must have its own section in What's new. This runs on every stable build, on a tag and on a pull request
# (so the check cannot first fail on a real tag), whenever What's new is shown; a tag run requires it even when it is not.
if [ "$(echo "$current_version" | grep -c -- '-')" = "0" ] && { [ "${ON_TAG:-false}" = "true" ] || [ "$(echo "$whats_new" | json "['show']")" = "True" ]; }; then
  echo "$whats_new" | node "$repo/scripts/upgrade-test/whats-new-lists.mjs" "$current_version" \
    || fail "What's new does not list ${current_version} on a stable release"
fi

# Issue #35: the owner-only policies must not name a role. Two proofs: their definitions, and the stack running with the
# owner role renamed (a new name in .env as well).
step "Issue #35: the widow policies follow the table's owner, not a role name"
policy_count="$(sql "select count(*) from pg_policies where policyname in ('people_select_widowed_internal','unions_select_widowed_internal','unions_update_widowed_internal') and qual like '%pg_has_role%'")"
expect 3 "$policy_count" "widow policies that test membership of the table owner"
save_logs
compose stop web api >/dev/null
sql "create role upgrade_tmp superuser login" >/dev/null
compose exec -T db psql -U upgrade_tmp -d postgres -At -v ON_ERROR_STOP=1 -c 'alter role "kinship" rename to "kinship_owner"' >/dev/null
compose exec -T db psql -U upgrade_tmp -d postgres -At -v ON_ERROR_STOP=1 -c 'drop role upgrade_tmp' >/dev/null || true
set_env DB_OWNER_USER kinship_owner
compose up -d --wait --wait-timeout 300 || fail "the stack did not start with the owner role renamed"
rm -f "$jar"
expect 200 "$(login_status "$admin_email" "$admin_password" -c "$jar")" "sign-in with the owner role renamed"
eleanor_id="$(sql "select person_id from users where email = '$member_email'")"
api_patch "/api/people/${eleanor_id}" '{"deceased":true}' >/dev/null
expect "widowed" "$(sql "select status from unions where id = '$union_marcus'")" "the Widowed trigger with the owner role renamed"
api_patch "/api/people/${eleanor_id}" '{"deceased":false}' >/dev/null
expect "married" "$(sql "select status from unions where id = '$union_marcus'")" "the automatic Widowed reverts when she is living again"
set_env DB_OWNER_USER kinship
expect "$before_digest" "$(digest)" "the fingerprint after the owner rename check"

# ---- a new machine -----------------------------------------------------------------------------------------------------------
if [ -n "$safety" ]; then
  step "Restore the safety copy on a brand-new machine: stopped stack, empty database, only the file, .env and compose.yml"
  save_logs
  compose down --volumes >/dev/null     # the database volume goes; ./data/backups stays, as a copied folder would
  [ -f "$work/data/backups/$safety" ] || fail "the safety copy disappeared with the stack"
  compose up -d db --wait --wait-timeout 120
  restore_out="$(compose run --rm -T api kinship restore "$safety" --yes 2>&1)" || fail "kinship restore of the safety copy failed: $restore_out"
  echo "$restore_out" | tail -5
  echo "$restore_out" >> "$logs"
  compose up -d --wait --wait-timeout 600 || fail "the restored stack did not become healthy"
  expect "$top_schema" "$(curl -s "${base}/api/version" | json "['schema']")" "the schema after the restore"
  expect "$before_digest" "$(digest)" "the fingerprint of the data after the restore"
  assert_seed_after_upgrade
  rm -f "$jar"
  expect 200 "$(login_status "$admin_email" "$admin_password" -c "$jar")" "sign-in after the restore"
  expect 200 "$(login_status "$member_email" "$member_password")" "member sign-in after the restore"
  [ "$(sql "select count(*) from upgrade_log where event = 'restore'")" -ge 1 ] || fail "no restore row in the upgrade log"
fi

step "Restore the backup WITH photos on a brand-new machine: empty database, empty files folder, only the file, .env and compose.yml"
save_logs
compose down --volumes >/dev/null
find "$work/data/files" -mindepth 1 -delete
[ -f "$work/data/backups/${with_files}" ] || fail "the backup with photos disappeared with the stack"
compose up -d db --wait --wait-timeout 120
restore_out="$(compose run --rm -T api kinship restore "${with_files}" --yes 2>&1)" || fail "kinship restore of the backup with photos failed: ${restore_out}"
echo "$restore_out" | tail -6
echo "$restore_out" >> "$logs"
compose up -d --wait --wait-timeout 600 || fail "the stack restored from a backup with photos did not become healthy"
rm -f "$jar"
expect 200 "$(login_status "$admin_email" "$admin_password" -c "$jar")" "sign-in after restoring the backup with photos"
expect 1 "$(curl -s -b "$jar" "${base}/api/admin/files" | json "['photos']")" "photos after the restore"
expect ready "$(curl -s -b "$jar" "${base}/api/admin/files" | json "['state']")" "the photo state after the restore"
expect 2 "$(find "$work/data/files/objects" -type f | wc -l | tr -d ' ')" "files on disk after the restore"
curl -s -b "$jar" -o "$work/avatar-restored.png" "${base}/api/media/${photo_id}/avatar"
expect "$avatar_sum" "$(openssl dgst -sha256 "$work/avatar-restored.png" | awk '{print $NF}')" "the avatar's bytes after the restore"

# ---- secrets -----------------------------------------------------------------------------------------------------------------
step "No secret appears in any log"
save_logs
leaked="$(grep -F -e "$admin_password" -e "$member_password" -e "$user_password" -e "$owner_password" -e "$app_password" -e "$backup_passphrase" "$logs" || true)"
[ -z "$leaked" ] || fail "a secret appears in the logs"

printf '\nUPGRADE TEST PASSED (%s -> %s)\n' "$previous_tag" "$current_version"
