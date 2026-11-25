# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Seeds a stack running KinShip 0.3.0 (sourced by scripts/upgrade-test.sh, which provides the helpers used here).
# seed-0.3.0-rc.1.sh and seed-0.3.0-rc.2.sh source this file with SEED_PARTICLES=1 (see below); seed-0.3.0-rc.3.sh and
# seed-0.3.0-rc.4.sh source it without, as from rc.3 on there is migration 0024 and the API refuses the field.
#
# The 0.2.1 seed's family, and on top of it what 0.3.0 added, each through the API where 0.3.0 has a route for it:
#   - names (migration 0017): a prefix, a suffix and a nickname, and Margaret's married surname;
#   - account settings (0017, 0018, 0020): the Member chose "Married name" and a Monday week start, the SuperAdmin the scroll
#     wheel, the Pedigree view and aunts, uncles and cousins shown, the Visiting User "Maiden name";
#   - a disabled account (0019), made as a row (no browser for the invitation) and disabled through the admin route;
#   - a profile photo (0021, 0022): a small JPEG made with sharp inside the 0.3.0 api container (PNG made here if that fails;
#     nothing binary is in the repository), uploaded for Marcus, set as his profile photo, with a date taken.
#
# Surname particles (ADR 0038): the release candidates had a separate surnameParticle field, which 0.3.0 folds into the surname
# (migration 0024) and no longer accepts. With SEED_PARTICLES=1, set by the rc wrappers, the seed adds two people through that
# field: Rosa Cruz with "de la" (folded to "de la Cruz") and Hugo with "de" and the surname "de Vries" (left as it is, not
# doubled). Without it (the final 0.3.0, whose API refuses the field) the seed is unchanged.
#
# Every variant also leaves one particle that is too long to fold, written by hand in SQL (no 0.3.0 API writes one): Otto, with
# "von" and a 98-character surname (3 + 1 + 98 = 102 characters, over the 100-character limit). 0024 leaves it and names it in
# a NOTICE; 0025 keeps it in people_surname_particle_leftover, names Otto's id (never his name) in a NOTICE and drops the column.
#
# The photo needs a file key in the 0.3.0 stack: SEED_FILE_KEY=1 makes upgrade-test.sh put one in .env before that stack
# starts, and keep it for the upgraded one. SEED_PHOTOS is how many photos the seed leaves (the script counts files with it).
#
# What it makes, the fictional Hale family:
#   Dr. Marcus Hale (setup person, linked to the SuperAdmin, with the profile photo), Eleanor Brandt (his wife, linked to the
#   Member account), their children Thomas "Tom" and Ruth, and Marcus's parents Walter Hale Sr. (deceased) and Margaret Ames,
#   married; Lone Hale and her brother Twin Hale (no parents on the tree, so two placeholders and an Unknown relationship);
#   Vera Hale, linked to the Visiting User; and a fourth, disabled account linked to nobody.
SEED_FILE_KEY=1
SEED_PHOTOS=1
SEED_PARTICLES="${SEED_PARTICLES:-0}"

seed_disabled_email="former@example.com"
seed_long_surname="$(printf '%098d' 0 | tr 0 L)"
seed_disabled_password="upgrade-former-$(rand 6)"

seed_previous_release() {
  local token created
  token="$(compose logs --no-color --no-log-prefix api | grep -A2 'one-time setup token' | tail -1 | tr -d ' ')"
  [ -n "$token" ] || fail "no setup token in the previous release's api log"
  created="$(post /api/setup "$(printf '{"token":"%s","displayName":"Marcus Hale","email":"%s","password":"%s","treeName":"Hale Family","person":{"givenName":"Marcus","surname":"Hale"}}' "$token" "$admin_email" "$admin_password")" -c "$jar" -w ' %{http_code}')"
  [ "${created##* }" = "201" ] || fail "setup of the previous release failed: $created"

  marcus="$(sql "select person_id from users where email = '$admin_email'")"
  [ -n "$marcus" ] || fail "the SuperAdmin is not linked to Marcus"
  api_patch "/api/people/$marcus" '{"gender":"male","birth":{"value":"1955-03-14"},"namePrefix":"Dr."}' >/dev/null
  eleanor="$(new_person '{"givenName":"Eleanor","surname":"Brandt","gender":"female","birth":{"value":"1957-06-02"}}')"
  walter="$(new_person '{"givenName":"Walter","surname":"Hale","nameSuffix":"Sr.","gender":"male","birth":{"value":"1928-01-09"},"deceased":true,"death":{"value":"2001-11-23"}}')"
  margaret="$(new_person '{"givenName":"Margaret","surname":"Ames","marriedSurname":"Ames Hale","gender":"female","birth":{"value":"1930-04-21"}}')"
  union_marcus="$(new_union "$marcus" "$eleanor" married 1982-09-18)"
  union_walter="$(new_union "$walter" "$margaret" married 1952-05-03)"
  api_post "/api/people/$marcus/parents" "$(printf '{"parentId":"%s","unionId":"%s"}' "$walter" "$union_walter")" >/dev/null
  api_post "/api/people/$marcus/children" "$(printf '{"child":{"givenName":"Thomas","surname":"Hale","nickname":"Tom","gender":"male","birth":{"value":"1984-02-11"}},"unionId":"%s"}' "$union_marcus")" >/dev/null
  api_post "/api/people/$marcus/children" "$(printf '{"child":{"givenName":"Ruth","surname":"Hale","gender":"female","birth":{"value":"1987-08-30"}},"unionId":"%s"}' "$union_marcus")" >/dev/null

  # Lone has no parents on the tree: adding her brother makes an Unknown father and an Unknown mother (0015).
  lone="$(new_person '{"givenName":"Lone","surname":"Hale","gender":"female","birth":{"value":"1990-05-05"}}')"
  twin="$(api_post "/api/people/$lone/siblings" '{"sibling":{"givenName":"Twin","surname":"Hale","gender":"male","birth":{"value":"1992-07-07"}}}' | json "['person']['id']")"
  vera="$(new_person '{"givenName":"Vera","surname":"Hale","gender":"female","birth":{"value":"1960-01-01"}}')"
  otto="$(new_person "$(printf '{"givenName":"Otto","surname":"%s","gender":"male","birth":{"value":"1940-02-02"}}' "$seed_long_surname")")"
  sql "update people set surname_particle = 'von' where id = '$otto'" >/dev/null
  expect "von|$seed_long_surname" "$(sql "select surname_particle || '|' || surname from people where id = '$otto'")" "Otto's over-long particle before the upgrade"
  if [ "$SEED_PARTICLES" = "1" ]; then
    rosa_cruz="$(new_person '{"givenName":"Rosa","surname":"Cruz","surnameParticle":"de la","gender":"female","birth":{"value":"1966-03-03"}}')"
    hugo="$(new_person '{"givenName":"Hugo","surname":"de Vries","surnameParticle":"de","gender":"male","birth":{"value":"1970-10-10"}}')"
    expect "de la|Cruz" "$(sql "select surname_particle || '|' || surname from people where id = '$rosa_cruz'")" "Rosa's particle before the upgrade"
  fi

  # Three more accounts, as rows (accepting an invitation needs a browser-like flow). The hashes are made by 0.3.0's own library.
  local member_hash user_hash former_hash
  member_hash="$(hash_password "$member_password")"
  user_hash="$(hash_password "$user_password")"
  former_hash="$(hash_password "$seed_disabled_password")"
  sql "insert into users (email, display_name, password_hash, role, person_id) values
         ('$member_email', 'Eleanor Hale', '$member_hash', 'member', '$eleanor'),
         ('$user_email', 'Visiting User', '$user_hash', 'user', null),
         ('$seed_disabled_email', 'Former Member', '$former_hash', 'member', null)" >/dev/null
  visitor="$(sql "select id from users where email = '$user_email'")"
  api PUT "/api/admin/accounts/$visitor/person" "$(printf '{"personId":"%s","currentPersonId":null}' "$vera")" >/dev/null
  local former
  former="$(sql "select id from users where email = '$seed_disabled_email'")"
  api_post "/api/admin/accounts/$former/disable" '{}' >/dev/null

  # Each account's own settings, through PATCH /api/auth/me as that account.
  api_patch /api/auth/me '{"treeWheel":"scroll","treeDefaultView":"pedigree","showExtendedRelatives":true}' >/dev/null
  local other="$work/seed-other-cookies.txt"
  rm -f "$other"
  expect 200 "$(login_status "$member_email" "$member_password" -c "$other")" "the Member signing in to 0.3.0"
  seed_patch_me "$other" '{"nameForm":"married","weekStart":"monday"}'
  rm -f "$other"
  expect 200 "$(login_status "$user_email" "$user_password" -c "$other")" "the Visiting User signing in to 0.3.0"
  seed_patch_me "$other" '{"nameForm":"maiden"}'
  rm -f "$other"

  # The profile photo. A gradient, so the picture is not one flat color; JPEG from sharp in the 0.3.0 api container.
  local photo="$work/seed-photo" mime=image/jpeg out code
  if ! compose exec -T api node -e '
      import("sharp").then(async ({ default: sharp }) => {
        const w = 96, h = 72, px = Buffer.alloc(w * h * 3);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set([x * 2, y * 3, 120], (y * w + x) * 3);
        process.stdout.write(await sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 85 }).toBuffer());
      }).catch((e) => { console.error(e); process.exit(1); });' > "$photo" 2>/dev/null \
     || [ "$(head -c 3 "$photo" | od -An -tx1 | tr -d ' \n')" != "ffd8ff" ]; then
    echo "sharp in the 0.3.0 container did not make a JPEG; using a PNG made here"
    mime=image/png
    python3 - "$photo" <<'PY'
import struct, sys, zlib
w, h = 96, 72
raw = b"".join(b"\x00" + bytes(v for x in range(w) for v in ((x * 2) % 256, (y * 3) % 256, 120)) for y in range(h))
def chunk(kind, data):
    body = kind + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
open(sys.argv[1], "wb").write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
PY
  fi
  out="$(curl -s -w '\n%{http_code}' -X POST -H 'X-KinShip-Request: 1' -H "Origin: ${base}" -H "Content-Type: ${mime}" -b "$jar" --data-binary "@$photo" "${base}/api/people/${marcus}/photos")"
  code="${out##*$'\n'}"; out="${out%$'\n'*}"
  expect 201 "$code" "the seed's photo upload to 0.3.0 ($out)"
  seed_photo_id="$(echo "$out" | json "['photo']['id']")"
  seed_photo_mime="$mime"
  api_patch "/api/media/$seed_photo_id" '{"takenOn":"1999-07"}' >/dev/null
  api_patch "/api/people/$marcus" "$(printf '{"photoMediaId":"%s"}' "$seed_photo_id")" >/dev/null
  seed_avatar_sum="$(curl -s -b "$jar" "${base}/api/media/${seed_photo_id}/avatar" | openssl dgst -sha256 | awk '{print $NF}')"
  expect 1 "$(sql 'select count(*) from media_files')" "photos in the seeded 0.3.0"
}

# PATCH /api/auth/me with another account's cookie jar; fails the test on anything but 200.
seed_patch_me() { # <jar> <json>
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' -X PATCH -H 'X-KinShip-Request: 1' -H 'Content-Type: application/json' -H "Origin: ${base}" -b "$1" -d "$2" "${base}/api/auth/me")"
  expect 200 "$code" "PATCH /api/auth/me $2"
}

# Counts and values that must be the same after the upgrade (the digest in the main script covers the 0.1 columns of every row;
# these cover what 0.3.0 added, and say what a human would look for if it fails).
assert_seed_after_upgrade() {
  local real=10
  [ "$SEED_PARTICLES" = "1" ] && real=12
  expect 2 "$(sql 'select count(*) from people where is_placeholder')" "placeholder people after the upgrade"
  expect "$((real + 2))" "$(sql 'select count(*) from people')" "people after the upgrade ($real real, two placeholders)"
  expect 3 "$(sql 'select count(*) from unions')" "relationships after the upgrade"
  expect 5 "$(sql 'select count(*) from person_parents')" "parent links after the upgrade"
  expect 4 "$(sql 'select count(*) from users')" "accounts after the upgrade"
  expect "widowed" "$(sql "select status from unions where id = '$union_walter'")" "Walter and Margaret's relationship"
  expect "married" "$(sql "select status from unions where id = '$union_marcus'")" "Marcus and Eleanor's relationship"
  expect "$vera" "$(sql "select person_id from users where email = '$user_email'")" "the Visiting User's person"
  expect "$eleanor" "$(sql "select person_id from users where email = '$member_email'")" "the Member's person"

  # Names (0017), and the old search column gone (0023).
  expect "Dr.|Marcus" "$(sql "select name_prefix || '|' || given_name from people where id = '$marcus'")" "Marcus's prefix"
  expect "Sr." "$(sql "select name_suffix from people where id = '$walter'")" "Walter's suffix"
  expect "Tom" "$(sql "select nickname from people where given_name = 'Thomas'")" "Thomas's nickname"
  expect "Ames Hale" "$(sql "select married_surname from people where id = '$margaret'")" "Margaret's married surname"
  expect 0 "$(sql "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'people' and column_name = 'search_name'")" "the old people.search_name column (dropped by 0023)"
  # 0024 folded every particle that fits into its surname; 0025 kept Otto's, which does not, aside and dropped the column
  # (ADR 0038). The NOTICE names his id and never his name.
  expect 0 "$(sql "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'people' and column_name = 'surname_particle'")" "the people.surname_particle column (dropped by 0025)"
  expect 0 "$(sql "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'surname_choice'")" "the users.surname_choice column (dropped by 0025)"
  expect "$otto|von|$seed_long_surname" "$(sql "select string_agg(person_id || '|' || surname_particle || '|' || surname, ',') from people_surname_particle_leftover")" "the leftover table (0025)"
  expect "$seed_long_surname" "$(sql "select surname from people where id = '$otto'")" "Otto's surname, unchanged"
  local notice
  notice="$({ cat "$logs"; compose logs --no-color api 2>/dev/null; } | grep -F 'database notice: 0025:' | tail -1)"
  case "$notice" in *"$otto"*) ;; *) fail "no 0025 NOTICE naming Otto's id in the api log" ;; esac
  case "$notice" in *LLLLLLLLLL*|*von*) fail "the 0025 NOTICE shows a name: $notice" ;; esac
  if [ "$SEED_PARTICLES" = "1" ]; then
    expect "de la Cruz" "$(sql "select surname from people where id = '$rosa_cruz'")" "Rosa's surname, folded by 0024"
    expect "de Vries" "$(sql "select surname from people where id = '$hugo'")" "Hugo's surname, not doubled by 0024"
  fi

  # The accounts' settings (0017, 0018, 0020) and the disabled account (0019).
  expect "married|monday" "$(sql "select name_form || '|' || week_start from users where email = '$member_email'")" "the Member's name form and week start"
  expect "maiden" "$(sql "select name_form from users where email = '$user_email'")" "the Visiting User's name form"
  expect "scroll|pedigree|true|sunday" "$(sql "select tree_wheel || '|' || tree_default_view || '|' || show_extended_relatives || '|' || week_start from users where email = '$admin_email'")" "the SuperAdmin's chart settings"
  expect 1 "$(sql "select count(*) from users where email = '$seed_disabled_email' and disabled_at is not null")" "the disabled account"
  expect 401 "$(login_status "$seed_disabled_email" "$seed_disabled_password")" "the disabled account signing in with its right password"
  expect 2 "$(sql "select count(*) from pg_trigger where tgrelid = 'users'::regclass and tgname like 'users_keep_a_superadmin_%'")" "the two last-SuperAdmin triggers"

  # The photo (0021, 0022): its row, its link, Marcus's profile photo, its date, and the same picture served back.
  expect 1 "$(sql "select count(*) from media_files where id = '$seed_photo_id' and mime = '$seed_photo_mime' and taken_on = '1999-07'")" "the seed's photo row"
  expect "$seed_photo_id" "$(sql "select photo_media_id from people where id = '$marcus'")" "Marcus's profile photo"
  expect 1 "$(sql "select count(*) from media_people where media_id = '$seed_photo_id' and person_id = '$marcus'")" "the photo's link to Marcus"

  # Through the API, as an admin signed in just for this check (a fresh cookie jar: the main one may predate a restore).
  local jar2="$work/assert-cookies.txt" code
  rm -f "$jar2"
  expect 200 "$(login_status "$admin_email" "$admin_password" -c "$jar2")" "sign-in for the seed checks"
  expect "$real" "$(curl -s -b "$jar2" "${base}/api/people?limit=50" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["items"]))')" "people in GET /api/people (the two placeholders are left out)"
  if [ "$SEED_PARTICLES" = "1" ]; then
    expect "Rosa" "$(curl -s -b "$jar2" "${base}/api/people?q=de%20la%20cruz" | python3 -c 'import json,sys; print(" ".join(p["givenName"] for p in json.load(sys.stdin)["items"]))')" "search for a folded surname with its particle"
    expect "" "$(curl -s -b "$jar2" "${base}/api/people/${rosa_cruz}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["person"].get("surnameParticle", ""))')" "no surnameParticle in GET /api/people/:id"
  fi
  expect "Thomas" "$(curl -s -b "$jar2" "${base}/api/people?q=tom%20hale" | python3 -c 'import json,sys; print(" ".join(p["givenName"] for p in json.load(sys.stdin)["items"]))')" "search by nickname"
  expect "Margaret" "$(curl -s -b "$jar2" "${base}/api/people?q=margaret%20hale" | python3 -c 'import json,sys; print(" ".join(p["givenName"] for p in json.load(sys.stdin)["items"]))')" "search by married surname"
  expect "$seed_photo_id" "$(curl -s -b "$jar2" "${base}/api/people/${marcus}" | json "['person']['photoMediaId']")" "photoMediaId in GET /api/people/:id"
  code="$(curl -s -o "$work/seed-avatar" -w '%{http_code}' -b "$jar2" "${base}/api/media/${seed_photo_id}/avatar")"
  expect 200 "$code" "the seed photo's avatar after the upgrade"
  expect "$seed_avatar_sum" "$(openssl dgst -sha256 "$work/seed-avatar" | awk '{print $NF}')" "the seed photo's avatar bytes after the upgrade"
  expect 200 "$(curl -s -o /dev/null -w '%{http_code}' -b "$jar2" "${base}/api/media/${seed_photo_id}/full")" "the seed photo's full size after the upgrade"
  expect "$seed_photo_id" "$(curl -s -b "$jar2" "${base}/api/media" | python3 -c 'import json,sys; print(" ".join(m["id"] for m in json.load(sys.stdin)["items"] if m["id"] == sys.argv[1]))' "$seed_photo_id")" "the seed photo on the Media page"
  rm -f "$jar2"
}
