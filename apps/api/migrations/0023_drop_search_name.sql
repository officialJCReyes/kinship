-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- 0023: drop people.search_name, the contract half of 0007's expand (#33, ADR 0036).
--
-- Nothing has read it since 0.2.0: search uses people.search_names (0007, rebuilt by 0017). No index, view, function or other
-- generated column is built on it, and the app role reads people through a table-level grant, so there is no column grant to
-- revoke. A plain DROP (no IF EXISTS, no CASCADE) therefore either works or fails loudly if that ever stops being true.
-- Dropping a column only edits the catalog (no table rewrite); it holds an ACCESS EXCLUSIVE lock on people for a moment.
-- The pre-upgrade safety copy and every older backup still hold the column; restoring one replays it and this migration then
-- drops it again.
--
-- Runs as the owner role.

ALTER TABLE people DROP COLUMN search_name;
