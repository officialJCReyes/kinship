# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Seeds a stack running KinShip 0.2.1 (sourced by scripts/upgrade-test.sh, which provides the helpers used here).
# 0.2.1 changed no API route, migration or stored data (a web fix and the website), so this is the 0.2.0 seed unchanged; the
# comments below that say 0.2.0 describe what that release added, which 0.2.1 still has.
# 0.2.0 still accepts the setup page's one `person` (the wizard's `family` is optional), and it has invitations, but a
# link has to be accepted in a browser-like flow, so the Member and the User are inserted as rows by the database owner, as
# the earlier seeds do. Everything else goes through its API, including what 0.2.0 added (ADR 0019 and ADR 0020):
#   - a person with no parents gets a brother (POST /api/people/:id/siblings), which makes the two "Unknown" parents
#     (placeholders) and the Unknown relationship between them;
#   - the User account ("Visiting User", made with no person) is linked to a person (PUT /api/admin/accounts/:id/person).
#
# What it makes, a few people of the fictional Hale family:
#   Marcus Hale (setup person, linked to the SuperAdmin), Eleanor Brandt (his wife, linked to the Member account),
#   their children Thomas and Ruth, and Marcus's parents Walter (deceased) and Margaret, married;
#   Lone Hale and her brother Twin Hale (no parents on the tree, so two placeholders and an Unknown relationship);
#   Vera Hale, linked to the Visiting User.
# Walter is deceased, so a release from rc.1 on already stores his marriage as "widowed" (migration 0007's rule); the upgrade must keep it so.
# The seed's expectations (counts, values) are in assert_seed_after_upgrade, which runs on the upgraded stack.

seed_previous_release() {
  local token created
  token="$(compose logs --no-color --no-log-prefix api | grep -A2 'one-time setup token' | tail -1 | tr -d ' ')"
  [ -n "$token" ] || fail "no setup token in the previous release's api log"
  created="$(post /api/setup "$(printf '{"token":"%s","displayName":"Marcus Hale","email":"%s","password":"%s","treeName":"Hale Family","person":{"givenName":"Marcus","surname":"Hale"}}' "$token" "$admin_email" "$admin_password")" -c "$jar" -w ' %{http_code}')"
  [ "${created##* }" = "201" ] || fail "setup of the previous release failed: $created"

  marcus="$(sql "select person_id from users where email = '$admin_email'")"
  [ -n "$marcus" ] || fail "the SuperAdmin is not linked to Marcus"
  api_patch "/api/people/$marcus" '{"gender":"male","birth":{"value":"1955-03-14"}}' >/dev/null
  eleanor="$(new_person '{"givenName":"Eleanor","surname":"Brandt","gender":"female","birth":{"value":"1957-06-02"}}')"
  walter="$(new_person '{"givenName":"Walter","surname":"Hale","gender":"male","birth":{"value":"1928-01-09"},"deceased":true,"death":{"value":"2001-11-23"}}')"
  margaret="$(new_person '{"givenName":"Margaret","surname":"Ames","gender":"female","birth":{"value":"1930-04-21"}}')"
  # Margaret has a married surname, so the new name forms (migration 0017) have something to show.
  api_patch "/api/people/$margaret" '{"marriedSurname":"Ames Hale"}' >/dev/null
  union_marcus="$(new_union "$marcus" "$eleanor" married 1982-09-18)"
  union_walter="$(new_union "$walter" "$margaret" married 1952-05-03)"
  api_post "/api/people/$marcus/parents" "$(printf '{"parentId":"%s","unionId":"%s"}' "$walter" "$union_walter")" >/dev/null
  api_post "/api/people/$marcus/children" "$(printf '{"child":{"givenName":"Thomas","surname":"Hale","gender":"male","birth":{"value":"1984-02-11"}},"unionId":"%s"}' "$union_marcus")" >/dev/null
  api_post "/api/people/$marcus/children" "$(printf '{"child":{"givenName":"Ruth","surname":"Hale","gender":"female","birth":{"value":"1987-08-30"}},"unionId":"%s"}' "$union_marcus")" >/dev/null

  # What 0.2.0 added. Lone has no parents on the tree: adding her brother makes an Unknown father and an Unknown mother.
  lone="$(new_person '{"givenName":"Lone","surname":"Hale","gender":"female","birth":{"value":"1990-05-05"}}')"
  twin="$(api_post "/api/people/$lone/siblings" '{"sibling":{"givenName":"Twin","surname":"Hale","gender":"male","birth":{"value":"1992-07-07"}}}' | json "['person']['id']")"
  vera="$(new_person '{"givenName":"Vera","surname":"Hale","gender":"female","birth":{"value":"1960-01-01"}}')"

  # A Member (Eleanor's account) and a User, as rows. The hash is made by the previous release's own password library.
  local member_hash user_hash
  member_hash="$(hash_password "$member_password")"
  user_hash="$(hash_password "$user_password")"
  sql "insert into users (email, display_name, password_hash, role, person_id) values
         ('$member_email', 'Eleanor Hale', '$member_hash', 'member', '$eleanor'),
         ('$user_email', 'Visiting User', '$user_hash', 'user', null)" >/dev/null

  # Migration 0017 moves the surname choice to the new name form: an account on "birth" becomes "maiden" and every other account
  # "maiden_married". The SuperAdmin and the Member are on the old default (married); the Visiting User chose birth names.
  sql "update users set surname_choice = 'birth' where email = '$user_email'" >/dev/null

  # The Visiting User has no person: an admin links it to Vera through the new route.
  visitor="$(sql "select id from users where email = '$user_email'")"
  api PUT "/api/admin/accounts/$visitor/person" "$(printf '{"personId":"%s","currentPersonId":null}' "$vera")" >/dev/null
}

# Counts and values that must be the same after the upgrade (the digest in the main script covers every row; these say what
# a human would look for if it fails).
assert_seed_after_upgrade() {
  # Migration 0015 (placeholders): the pair made for Lone's brother is still there, and they are not real people.
  expect 2 "$(sql 'select count(*) from people where is_placeholder')" "placeholder people after the upgrade"
  expect "1" "$(sql "select count(*) from unions u where u.status = 'unknown' and (select count(*) from people p where p.id in (u.partner_a_id, u.partner_b_id) and p.is_placeholder) = 2")" "the Unknown relationship between the two placeholders"
  expect 2 "$(sql "select count(*) from person_parents pp join unions u on u.id = pp.union_id where u.status = 'unknown' and pp.child_id in ('$lone', '$twin')")" "Lone and her brother hang from the Unknown relationship"
  expect 11 "$(sql 'select count(*) from people')" "people after the upgrade (nine real, two placeholders)"
  expect 3 "$(sql 'select count(*) from unions')" "relationships after the upgrade"
  expect 5 "$(sql 'select count(*) from person_parents')" "parent links after the upgrade"
  expect 3 "$(sql 'select count(*) from users')" "accounts after the upgrade"
  expect "Ruth Hale|1987-08-30" "$(sql "select given_name || ' ' || surname || '|' || birth_date::text from people where given_name = 'Ruth'")" "Ruth"
  expect "Walter Hale|true|2001-11-23" "$(sql "select given_name || ' ' || surname || '|' || deceased::text || '|' || death_date::text from people where given_name = 'Walter'")" "Walter"
  expect "superadmin member user" "$(sql "select string_agg(role, ' ' order by case role when 'superadmin' then 1 when 'member' then 2 else 3 end) from users")" "the roles"
  # Already Widowed in 0.2.0 (the rule of migration 0007), and still: the living couple stays Married.
  expect "widowed" "$(sql "select status from unions where id = '$union_walter'")" "Walter and Margaret's relationship"
  expect "married" "$(sql "select status from unions where id = '$union_marcus'")" "Marcus and Eleanor's relationship"

  # Migration 0016 (linking an account to a person): the Visiting User is still Vera, and one person still has at most one account.
  expect "$vera" "$(sql "select person_id from users where email = '$user_email'")" "the Visiting User's person"
  expect "$eleanor" "$(sql "select person_id from users where email = '$member_email'")" "the Member's person"
  if sql "update users set person_id = '$vera' where email = '$member_email'" >/dev/null 2>&1; then
    fail "the unique index let a second account take Vera"
  fi
  expect "$vera" "$(sql "select person_id from users where email = '$user_email'")" "the Visiting User's person after the refused second link"

  # Migration 0017 (names): the surname choice moved to the name form, prefixes and suffixes show for every account, the people
  # got four empty name fields, and Margaret's married surname is still there and searchable.
  expect "maiden_married maiden_married maiden" "$(sql "select string_agg(name_form, ' ' order by case role when 'superadmin' then 1 when 'member' then 2 else 3 end) from users")" "the name form of the SuperAdmin, the Member and the Visiting User"
  expect "3" "$(sql 'select count(*) from users where show_prefix and show_suffix')" "accounts that show prefixes and suffixes"
  expect "birth" "$(sql "select surname_choice from users where email = '$user_email'")" "the old surname choice, kept for the contract step"
  expect "0" "$(sql 'select count(*) from people where name_prefix is not null or name_suffix is not null or nickname is not null or surname_particle is not null')" "people with a prefix, suffix, nickname or particle"
  expect "Ames Hale" "$(sql "select married_surname from people where given_name = 'Margaret'")" "Margaret's married surname"

  # Migration 0018 (the chart's own settings): every account, the existing ones too, takes the defaults. Aunts, uncles and cousins
  # are hidden for everyone, the wheel zooms, the Family tree opens first and the dagger shows.
  expect "zoom zoom zoom" "$(sql "select string_agg(tree_wheel, ' ') from users")" "the mouse wheel setting of every account"
  expect "family family family" "$(sql "select string_agg(tree_default_view, ' ') from users")" "the default chart of every account"
  expect "0" "$(sql 'select count(*) from users where show_extended_relatives')" "accounts that show aunts, uncles and cousins"
  expect "3" "$(sql 'select count(*) from users where show_deceased_mark')" "accounts that show the dagger"

  # Through the API, as an admin signed in just for this check: the placeholders are not in the people list, and the 0016 route
  # refuses a second account for Vera and a placeholder. (A fresh cookie jar: the main one may predate a restore.)
  local jar2="$work/assert-cookies.txt" list ids refused
  rm -f "$jar2"
  expect 200 "$(login_status "$admin_email" "$admin_password" -c "$jar2")" "sign-in for the seed checks"
  list="$(curl -s -b "$jar2" "${base}/api/people?limit=50")"
  expect "9" "$(echo "$list" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["items"]))')" "people in GET /api/people (the two placeholders are left out)"
  expect "0" "$(echo "$list" | python3 -c 'import json,sys; print(sum(1 for p in json.load(sys.stdin)["items"] if p.get("isPlaceholder") or not p.get("givenName")))')" "placeholders in GET /api/people"
  expect "maiden_married" "$(curl -s -b "$jar2" "${base}/api/auth/me" | json "['user']['nameForm']")" "nameForm in GET /api/auth/me"
  expect "true" "$(curl -s -b "$jar2" "${base}/api/auth/me" | python3 -c 'import json,sys; print(str(json.load(sys.stdin)["user"]["showPrefix"]).lower())')" "showPrefix in GET /api/auth/me"
  expect "zoom family false true" "$(curl -s -b "$jar2" "${base}/api/auth/me" | python3 -c 'import json,sys; u=json.load(sys.stdin)["user"]; print(u["treeWheel"], u["treeDefaultView"], str(u["showExtendedRelatives"]).lower(), str(u["showDeceasedMark"]).lower())')" "the chart settings in GET /api/auth/me"
  expect "1" "$(curl -s -b "$jar2" "${base}/api/people?q=margaret%20hale" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["items"]))')" "search for Margaret by her given name and married surname"
  member_id="$(sql "select id from users where email = '$member_email'")"
  refused="$(curl -s -X PUT -b "$jar2" -H 'X-KinShip-Request: 1' -H 'Content-Type: application/json' -H "Origin: ${base}" \
    -d "$(printf '{"personId":"%s","currentPersonId":"%s"}' "$vera" "$eleanor")" "${base}/api/admin/accounts/${member_id}/person")"
  expect "person_already_linked" "$(echo "$refused" | json "['error']")" "linking Vera to a second account"

  # Migration 0019 (disable, delete and role change; ADR 0029). Nothing here changes what the digest or the counts above see: every
  # account came through active, and each action below is refused, a no-op, or reversed before the function ends.
  expect "3" "$(sql 'select count(*) from users where disabled_at is null')" "accounts that are active after the upgrade"
  expect "2" "$(sql "select count(*) from pg_trigger where tgrelid = 'users'::regclass and tgname like 'users_keep_a_superadmin_%'")" "the two last-SuperAdmin triggers"
  # The last SuperAdmin is protected from everyone, the database owner included.
  if sql "update users set role = 'member' where role = 'superadmin'" >/dev/null 2>&1; then fail "the owner demoted the last SuperAdmin"; fi
  if sql "update users set disabled_at = now() where role = 'superadmin'" >/dev/null 2>&1; then fail "the owner disabled the last SuperAdmin"; fi
  if sql "delete from users where role = 'superadmin'" >/dev/null 2>&1; then fail "the owner deleted the last SuperAdmin"; fi
  expect "superadmin" "$(sql "select role from users where email = '$admin_email'")" "the SuperAdmin after the refused changes"
  local admin_id visitor_id post_as_admin
  admin_id="$(sql "select id from users where email = '$admin_email'")"
  visitor_id="$(sql "select id from users where email = '$user_email'")"
  post_as_admin() { # <path> <json> prints the status and the body
    curl -s -b "$jar2" -H 'X-KinShip-Request: 1' -H 'Content-Type: application/json' -H "Origin: ${base}" -w ' %{http_code}' -d "$2" "${base}$1"
  }
  expect "self_not_allowed 403" "$(post_as_admin "/api/admin/accounts/$admin_id/disable" '{}' | python3 -c 'import sys; t=sys.stdin.read(); b,c=t.rsplit(" ",1); import json; print(json.loads(b)["error"], c)')" "the SuperAdmin disabling themselves"
  expect "account_not_disabled 409" "$(post_as_admin "/api/admin/accounts/$visitor_id/delete" "$(printf '{"confirmEmail":"%s"}' "$user_email")" | python3 -c 'import sys; t=sys.stdin.read(); b,c=t.rsplit(" ",1); import json; print(json.loads(b)["error"], c)')" "deleting an account that is not disabled"
  expect "200" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH -b "$jar2" -H 'X-KinShip-Request: 1' -H 'Content-Type: application/json' -H "Origin: ${base}" -d '{"role":"user","currentRole":"user"}' "${base}/api/admin/accounts/$visitor_id/role")" "setting a role the account already has (a no-op)"
  expect "false true" "$(curl -s -b "$jar2" "${base}/api/admin/accounts" | python3 -c 'import json,sys; a=[x for x in json.load(sys.stdin)["accounts"] if x["kind"]=="account"]; v=[x for x in a if x["role"]=="user"][0]; print(str(v["lastSuperAdmin"]).lower(), str([x for x in a if x["role"]=="superadmin"][0]["lastSuperAdmin"]).lower())')" "lastSuperAdmin in the accounts list (the User, the SuperAdmin)"
  # Disable the Visiting User, check it cannot sign in and that a wrong email cannot delete it, then enable it again.
  expect "200" "$(post_as_admin "/api/admin/accounts/$visitor_id/disable" '{}' | awk '{print $NF}')" "disabling the Visiting User"
  expect "401" "$(login_status "$user_email" "$user_password")" "a disabled account signing in with the right password"
  expect "confirmation_mismatch 400" "$(post_as_admin "/api/admin/accounts/$visitor_id/delete" '{"confirmEmail":"nobody@example.com"}' | python3 -c 'import sys; t=sys.stdin.read(); b,c=t.rsplit(" ",1); import json; print(json.loads(b)["error"], c)')" "deleting with the wrong email"
  expect "1" "$(sql "select count(*) from users where id = '$visitor_id' and disabled_at is not null")" "the Visiting User while disabled"
  expect "200" "$(post_as_admin "/api/admin/accounts/$visitor_id/enable" '{}' | awk '{print $NF}')" "enabling the Visiting User"
  expect "200" "$(login_status "$user_email" "$user_password")" "the Visiting User signing in after it was enabled again"
  expect "$vera" "$(sql "select person_id from users where email = '$user_email'")" "the Visiting User's person after disable and enable"

  # Migration 0020 (the week start; ADR 0032): every account, the existing ones too, starts on Sunday, and the API says so.
  expect "sunday sunday sunday" "$(sql "select string_agg(week_start, ' ') from users")" "the week start of every account"
  expect "sunday" "$(curl -s -b "$jar2" "${base}/api/auth/me" | json "['user']['weekStart']")" "weekStart in GET /api/auth/me"
  rm -f "$jar2"
}
