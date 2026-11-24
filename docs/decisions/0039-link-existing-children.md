# 0039. Linking children who already exist to a second parent

- Status: **Accepted** (decisions by JC, 2026-11-24, step 45)
- Date: 2026-11-24
- Builds on: [0005 People and relationships](0005-people-and-relationships.md) (children hang from a relationship),
  [0007 Adoptive and birth parents](0007-adoption-parentage.md) (one set per kind), [0019 Placeholder parents](0019-placeholder-parents.md)
- Covers part of issue #15 ("one call to add a parent, partner or sibling together with the new person"): the partner and the
  parent. #15 stays open.
- Migration: none.

## Context

A child added under one parent alone hangs from that parent alone. When the other parent is added later, as that parent's
partner or as a parent of one of the child's brothers or sisters, nothing asked about the children already on the tree, so
the child stayed a one-parent child: a half-sibling of their full brothers and sisters and a stepchild of their own parent.
There was no way to repair it in the app short of deleting and re-adding the child.

## Decisions

### What a link does
A child who hangs from parent P alone, in a set of one kind (birth or adoptive), moves to hang from the relationship of P and
the second parent Q. **The kind is kept**: there is no kind choice. If P and Q have no relationship yet, one is created as
usual (status from the dialog, or Unknown when it exists only because of a shared child).

### Who may link
**Admins only, for all of it** (SuperAdmin and Family Admin). Members and Users get 403, even for a child in the Member's own
line and a relationship the Member is in. Moving a child onto a relationship is an UPDATE of the `person_parents` row and
creating a relationship is an INSERT into `unions`; the database policies keep both for admins (migration 0005), so no
migration is needed, and the API checks first with the same rule.

### Which children are offered (eligible)
A child is offered only when:
- their set of that kind has exactly one parent, P;
- Q is not the child, and the child is not one of Q's ancestors (the link would be a cycle);
- the link would not put one person in both of the child's sets in a way the database refuses (it allows only a stepparent
  adoption: the adoptive set is a relationship and shares one person with the birth set).

The database triggers (`kinship_check_parentage`) stay the last word; the list leaves out what they would refuse, so a
refusal at save time means something changed in between. A child the account may not edit is never offered (for an admin that
is nobody).

### All or nothing
The new person, the relationship and every link are written in one transaction. If any child is refused, nothing is saved,
and the answer names the child: `409 { error, childId }` with `child_not_linkable` (they no longer hang from that parent
alone), `would_create_cycle` or `same_person_both_kinds`.

### Warnings
`parent_too_young` comes back for each linked child (birth links only), as for any new parent link. It never blocks, and the
web app shows it after saving, as it does for the other Add relative forms.

### The API (admins only)
- `GET /api/people/:id/linkable-children?partner=&exclude=`: the children who hang from `:id` alone, oldest first, each with
  its kind. With `partner` (an existing person) the ones the database would refuse are left out; `exclude` leaves out one
  child (the child a parent is being added to). Two indexed queries and one walk up from the partner.
- `POST /api/unions/:id/children { childIds }` (1 to 50, unique): each child, who hangs from one partner of the relationship
  alone, hangs from the relationship instead. Used by the profile's "also their child" action.
- `POST /api/people/:id/partners` (new, next pull request): a new or existing partner, the relationship, and
  `linkChildren`, in one transaction.
- `POST /api/people/:id/parents` (extended, next pull request): `parent` (a new person) as well as `parentId`, and
  `linkChildren` (the child's brothers and sisters through the existing parent), in one transaction.

### Cost
`GET /api/people/:id/linkable-children` on the 1,900-person scale family (`scale.test.ts`): a new partner 6.3 ms, an existing
partner from the youngest generation 11.1 ms (medians of seven, on the development machine).

## Consequences
- The profile can repair a tree where a child was entered under one parent first.
- The add-partner and add-parent forms stop using two requests with a compensating delete (`createThenLink`) for the cases
  they cover.
- Replacing a placeholder ("Unknown mother") with a real person is a separate feature and not part of this decision.
