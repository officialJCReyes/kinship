# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Seeds a stack running KinShip 0.2.0-rc.2 (sourced by scripts/upgrade-test.sh, which provides the helpers used here).
# 0.2.0-rc.2 still accepts the setup page's one `person` (the wizard's `family` is optional), and it has invitations (and an optional date of birth for the partner, which this seed does not use), but a
# link has to be accepted in a browser-like flow, so the Member and the User are inserted as rows by the database owner, as
# the alpha.2 seed does. Everything else goes through its API.
#
# What it makes, a few people of the fictional Hale family:
#   Marcus Hale (setup person, linked to the SuperAdmin), Eleanor Brandt (his wife, linked to the Member account),
#   their children Thomas and Ruth, and Marcus's parents Walter (deceased) and Margaret, married.
# Walter is deceased, so rc.2 already stores his marriage as "widowed" (migration 0007's rule); the upgrade must keep it so.
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

  # A Member (Eleanor's account) and a User, as rows. The hash is made by the previous release's own password library.
  local member_hash user_hash
  member_hash="$(hash_password "$member_password")"
  user_hash="$(hash_password "$user_password")"
  sql "insert into users (email, display_name, password_hash, role, person_id) values
         ('$member_email', 'Eleanor Hale', '$member_hash', 'member', '$eleanor'),
         ('$user_email', 'Visiting User', '$user_hash', 'user', null)" >/dev/null
}

# Counts and values that must be the same after the upgrade (the digest in the main script covers every row; these say what
# a human would look for if it fails).
assert_seed_after_upgrade() {
  # Migration 0015 (placeholders): every person that existed before is a real person, none is an "Unknown" stand-in.
  expect 0 "$(sql 'select count(*) from people where is_placeholder')" "placeholder people after the upgrade"
  expect 6 "$(sql 'select count(*) from people')" "people after the upgrade"
  expect 2 "$(sql 'select count(*) from unions')" "relationships after the upgrade"
  expect 3 "$(sql 'select count(*) from person_parents')" "parent links after the upgrade"
  expect 3 "$(sql 'select count(*) from users')" "accounts after the upgrade"
  expect "Ruth Hale|1987-08-30" "$(sql "select given_name || ' ' || surname || '|' || birth_date::text from people where given_name = 'Ruth'")" "Ruth"
  expect "Walter Hale|true|2001-11-23" "$(sql "select given_name || ' ' || surname || '|' || deceased::text || '|' || death_date::text from people where given_name = 'Walter'")" "Walter"
  expect "superadmin member user" "$(sql "select string_agg(role, ' ' order by case role when 'superadmin' then 1 when 'member' then 2 else 3 end) from users")" "the roles"
  # Already Widowed in rc.2 (the rule of migration 0007), and still: the living couple stays Married.
  expect "widowed" "$(sql "select status from unions where id = '$union_walter'")" "Walter and Margaret's relationship"
  expect "married" "$(sql "select status from unions where id = '$union_marcus'")" "Marcus and Eleanor's relationship"
}
