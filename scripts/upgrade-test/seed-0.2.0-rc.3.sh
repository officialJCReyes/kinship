# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Seeds a stack running KinShip 0.2.0-rc.3 (sourced by scripts/upgrade-test.sh, which provides the helpers used here).
# 0.2.0-rc.3 still accepts the setup page's one `person` (the wizard's `family` is optional), and it has invitations, but a
# link has to be accepted in a browser-like flow, so the Member and the User are inserted as rows by the database owner, as
# the earlier seeds do. Everything else goes through its API, including what rc.3 added (ADR 0019 and ADR 0020):
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
  union_marcus="$(new_union "$marcus" "$eleanor" married 1982-09-18)"
  union_walter="$(new_union "$walter" "$margaret" married 1952-05-03)"
  api_post "/api/people/$marcus/parents" "$(printf '{"parentId":"%s","unionId":"%s"}' "$walter" "$union_walter")" >/dev/null
  api_post "/api/people/$marcus/children" "$(printf '{"child":{"givenName":"Thomas","surname":"Hale","gender":"male","birth":{"value":"1984-02-11"}},"unionId":"%s"}' "$union_marcus")" >/dev/null
  api_post "/api/people/$marcus/children" "$(printf '{"child":{"givenName":"Ruth","surname":"Hale","gender":"female","birth":{"value":"1987-08-30"}},"unionId":"%s"}' "$union_marcus")" >/dev/null

  # What rc.3 added. Lone has no parents on the tree: adding her brother makes an Unknown father and an Unknown mother.
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
  # Already Widowed in rc.3 (the rule of migration 0007), and still: the living couple stays Married.
  expect "widowed" "$(sql "select status from unions where id = '$union_walter'")" "Walter and Margaret's relationship"
  expect "married" "$(sql "select status from unions where id = '$union_marcus'")" "Marcus and Eleanor's relationship"

  # Migration 0016 (linking an account to a person): the Visiting User is still Vera, and one person still has at most one account.
  expect "$vera" "$(sql "select person_id from users where email = '$user_email'")" "the Visiting User's person"
  expect "$eleanor" "$(sql "select person_id from users where email = '$member_email'")" "the Member's person"
  if sql "update users set person_id = '$vera' where email = '$member_email'" >/dev/null 2>&1; then
    fail "the unique index let a second account take Vera"
  fi
  expect "$vera" "$(sql "select person_id from users where email = '$user_email'")" "the Visiting User's person after the refused second link"

  # Through the API, as an admin signed in just for this check: the placeholders are not in the people list, and the 0016 route
  # refuses a second account for Vera and a placeholder. (A fresh cookie jar: the main one may predate a restore.)
  local jar2="$work/assert-cookies.txt" list ids refused
  rm -f "$jar2"
  expect 200 "$(login_status "$admin_email" "$admin_password" -c "$jar2")" "sign-in for the seed checks"
  list="$(curl -s -b "$jar2" "${base}/api/people?limit=50")"
  expect "9" "$(echo "$list" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["items"]))')" "people in GET /api/people (the two placeholders are left out)"
  expect "0" "$(echo "$list" | python3 -c 'import json,sys; print(sum(1 for p in json.load(sys.stdin)["items"] if p.get("isPlaceholder") or not p.get("givenName")))')" "placeholders in GET /api/people"
  member_id="$(sql "select id from users where email = '$member_email'")"
  refused="$(curl -s -X PUT -b "$jar2" -H 'X-KinShip-Request: 1' -H 'Content-Type: application/json' -H "Origin: ${base}" \
    -d "$(printf '{"personId":"%s","currentPersonId":"%s"}' "$vera" "$eleanor")" "${base}/api/admin/accounts/${member_id}/person")"
  expect "person_already_linked" "$(echo "$refused" | json "['error']")" "linking Vera to a second account"
  rm -f "$jar2"
}
