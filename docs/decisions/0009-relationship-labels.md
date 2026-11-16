# 0009. Custom relationship labels

- Status: **Accepted** (decisions by JC, 2026-11-16)
- Date: 2026-11-16
- Builds on: [0005 People, relationships and who may change them](0005-people-and-relationships.md), [0008 Second and married surnames, and the automatic Widowed status](0008-names-and-widowed.md)
- Sources: `design/kinship-v2-requirements.md`, `design/kinship-navigation.md` ("Other relationship"), the mockup's relationship list.

## Context

A family has roles that are not a parent or partner link: a godmother, a guardian, a family friend who is "an aunt to everybody". Foster, guardian and step links as **structure** stay out of the model (`kinship-adoption.md`); a label is only a note.

## Decision

- Table `relationship_labels` (migration 0009): `from_id`, `to_id` (both `people ON DELETE CASCADE`), `label` (1 to 60), `reverse_label` (optional, 1 to 60), `created_by`, `created_at`. **`to_id` is the label of `from_id`**: "Carla is Marcus's Godmother" is from Marcus, to Carla, `Godmother`, reverse `Godchild`.
- One row shows on both profiles. The from side reads "Godmother: Carla". The to side reads the reverse label ("Godchild: Marcus"), or "Godmother of Marcus" when none was given. Both carry a "(custom)" pill.
- Unique on `(from_id, to_id, lower(label))`: the same pair can carry several labels, and the reverse direction can carry the same label; only an exact repeat is `duplicate_label`. The two people of a label never change (the app role may update only the wording).
- Row-level security enabled and forced, the pattern of `unions`: any signed-in account reads (through `GET /api/people/:id`, which carries `labels` with the other person), only admins insert, change or delete (`POST`, `PATCH`, `DELETE /api/labels`).
- **A label never feeds anything else**: not the tree, the cycle checks, "my line", next of kin or the adoption logic. A test compares the tree, the parent helpers, "my line", the parent links and the relationships before and after adding labels of every shape.
- **Derived titles.** Where a custom label and a derived title (for example the step titles of the next step) describe the same pair on a profile, only the custom one is shown (`withoutOverriddenTitles`). The family sections (parents, partners, children, siblings) are the structure of the tree and are never hidden by a label.
- The web app opens "Other relationship" from the profile (admins), not from Add relative; editing and removing a label are on its row.

## Left for later

Bulk import, GEDCOM mapping, and showing labels in the tree panel and the relationship finder (0.3) are tracked as issues.
