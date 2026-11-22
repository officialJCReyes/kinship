-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- 0022: row-level security stays ON for the photo tables but is no longer FORCED on their owner (fixes 0021).
--
-- 0021 forced it, like the people tables. But the three start-up functions of 0021 (kinship_media_exists, _key_ids and
-- _storage_ids) are SECURITY DEFINER and run as the owner with nobody signed in; with the policies forced on the owner they saw
-- an empty table whenever the owner role is not a superuser (ADR 0001 allows that), and the orphan sweeper would then have taken
-- every stored photo for an orphan. The app role is not the owner, so every policy still applies to it exactly as before; only
-- the owner (migrations, the definer functions, backups) is exempt, the same as `users` and `family_tree` (0005).
--
-- Additive in effect (no data changes); the previous release never touches these tables.
ALTER TABLE media_files NO FORCE ROW LEVEL SECURITY;
ALTER TABLE media_people NO FORCE ROW LEVEL SECURITY;
