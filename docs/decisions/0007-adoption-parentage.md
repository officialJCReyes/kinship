# 0007. Birth and adoptive parent links

- Status: **Accepted** (decisions by JC, 2026-11-16)
- Date: 2026-11-16
- Builds on: [0005 People, relationships and who may change them](0005-people-and-relationships.md), [0006 The Family tree chart](0006-tree-view.md)
- Sources: `design/kinship-adoption.md`, `design/kinship-identity-numbers.md` (legal family only). Where those copies differ from JC's step brief, the brief won: no private flag on links, an admin-only way to add adoptive links, and the per-viewer setting.

## Context

ADR 0005 gave a child exactly one set of parents (`person_parents.child_id` was the primary key). A person who was adopted has two: the birth parents and the adoptive parents. 0.1 may still wipe data and 0.2 starts the data promise, so this is the cheapest moment to change the schema.

## The model

- A parent-child link has a **kind**: `birth` (the default) or `adoptive`. A child has **at most one set of each kind**, and a set is what it always was: a union (two parents) or one parent alone. Nothing is overwritten, and nobody has to choose between the families when entering data.
- The key of `person_parents` is now `(child_id, kind)`. Existing rows become `birth` through the column default, so migration 0006 needs no backfill.
- A link has an optional **date** (`link_date`, `link_precision`, the same text and precision as other dates). The Add relative form asks for a year when the link is adoptive. Place and source on a link come with the Places and Sources libraries (0.5).
- There is **no private flag**: adoption links are visible to every account.
- The app says "birth" everywhere, never "biological".

## Which family a chart follows: one rule, in one place

`kinship_effective_kind(child, view)` (migration 0006) says which set a chart follows for a child:

| view | the child has an adoptive set | the child has no adoptive set |
|---|---|---|
| adoptive (the default) | adoptive set | birth set |
| birth | birth set (an adopted person with no birth set recorded has **no parents**: there is no fallback to the adoptive set) | birth set |

Everything that draws or walks a chart goes through it: `kinship_parent_ids_in(child, view)` for ancestors and `kinship_effective_kind` in the descendant and collateral walks of `loadTree`. In the adoptive view an adopted-away child is not among a birth parent's descendants but is among the adoptive parents'; in the birth view it is the other way round. The effects are:

- `hasParents`, `ancestorCount` (leaf counts) and full or half sibling logic all follow the set the view follows. Adoptive siblings are siblings in the adoptive view.
- `otherFamily` on a person in the response says there is a set the view does **not** follow: `{kind, count}`, where `kind` is the family behind the leaf. In the adoptive view that is the birth set of an adopted person. In the birth view it is their adoptive set, even when no birth set is recorded, so the leaf there reads "Show X's adoptive family".
- The **profile always lists both families** (from the raw rows, not the view), so a parent's list of children includes children adopted away. That list needs people from both views, so the profile asks for the tree around the person in both.

## The viewer's choice

`users.lineage_view` is the **viewer's own display setting**, default `adoptive`. The app role may update only that column, only on its own row (`GRANT UPDATE (lineage_view)` and the policy `users_update_own`); tests prove that role, `person_id`, email, name and password fields and other accounts' rows cannot be changed. It is changed with `PATCH /api/auth/me {lineageView}`. The tree route follows it by default and accepts `?lineage=` as an override. An override applies to the **whole flip** and never stores anything.

**Privacy never reads the setting.** Medical, DNA and identity-number logic read link kinds explicitly, through `kinship_parent_ids_of_kind`, `kinship_birth_parent_ids` and `kinship_legal_parent_ids`.

## Who may add adoption links

Admins only, because an adoption changes two families. A Member adding a child (the existing rule) adds a **birth** link only, in the API (403) and in the database (`kinship_can_attach_child(…, kind)` returns false for a Member unless the kind is birth). The Add relative form shows a Member no choice of link type; admins get "Type of parent-child link" (Birth or Adoptive) when adding a parent, a child or a sibling, with a kind that cannot take another parent disabled and the reason as its tooltip. Admins also edit a link's date. "My line" for a Member (`kinship_in_my_line`) follows links of **both** kinds: an adopted child is family.

An adoptive couple with no relationship gets an **Unknown** union automatically, the same rule as birth parents, including when the second adoptive parent is added much later.

## Integrity across both kinds

The self-parent, child-is-partner and cycle checks (KS011 to KS013) apply across both kinds (the cycle walk uses `kinship_parent_ids`, which follows every kind). New: **KS015, `same_person_both_kinds`**. The same person cannot be both a birth parent and an adoptive parent of one child, **except in a stepparent adoption**: the person may be in both sets only when the adoptive set is a relationship (a union) of that person and the adopting stepparent, and exactly one person overlaps. Deleting the adopter then ends the adoptive set, because it would otherwise repeat a birth parent.

**Known limit (accepted for now):** a stepparent adopting **alone**, with the staying birth parent *not* in the adoptive set, drops that parent from the legal family under the rule below. The way to keep them is to record the adoptive set as the stepparent's relationship with the staying parent.

## Legal family (for identity numbers, later; nothing here builds it)

A person's **legal parents** are their adoptive parents if they have any, otherwise their birth parents (`kinship_legal_parent_ids`). Birth relatives of an adopted person are not next of kin, and an adopted-away child is not a child of the birth parent for next-of-kin purposes. Because a stepparent adoption's adoptive set includes the staying parent, they stay a legal parent. Both functions read link kinds and ignore every display setting.

## In the flipped family view

The leaf on a person flips the chart to their family. With `lineage` set, the **whole view follows that lineage**, for everyone in it: a parent who was themself adopted is shown with the parents the lineage gives them (their adoptive parents in an adoptive view, their birth parents in a birth view), and the other family behind that parent is one more leaf. The family view keeps ancestors, full siblings (same set), partners and the partners' children, as before, and carries the override through further flips; flipping back to the main chart drops it. If the main chart already follows the family a leaf would open and draws that person's parents, the leaf flips back instead.

## The chart and keyboard access

The second leaf (the other family) is the same logo green, on the left of the top edge, named "Show X's birth family (N people)" or "...adoptive family...". It is focusable and activated with Enter or Space. The **person panel has a button** ("Show birth family" or "Show adoptive family", with the same longer text and count as its accessible name) as the keyboard path, like Edit relationship for couple lines; Up from a person with no drawn parents also moves to a leaf. The legend explains it. The layout needed no change: it draws whichever set the response follows.

## Wording kept for later (not built)

The relationship finder, when a path crosses an adoption the viewer's setting hides, says **"No relationship found"** and adds "Related through adoption. Switch to the adoptive view to see it." The finder's labels ("adoptive half-sister") are 0.3.

## Measured

At 161 people in one response the tree takes 16 to 29 ms; the whole 161-person family from its root 12 to 14 ms (unchanged from before). The ancestor-count worst case (60 people each with 62 ancestors, a 1,272-person response) takes 64 to 76 ms for the count itself and 105 to 138 ms for the whole response. The all-kinds parent walk (used by the cycle trigger and "my line") was 375 ms after the new key until it was rewritten on top of the per-kind function; it is now 82 to 90 ms.

## Consequences and breaking changes

- `GET /api/people/:id` returns `parents: {birth, adoptive}`, children as `{id, kind, link, adopted}` (`UnionWithChildren.children`, `singleParentChildren`); `Parentage` carries `kind` and `link`; `TreeResponse` carries `lineage` and `TreePerson` may carry `otherFamily`; `AuthUser` carries `lineageView`. New routes: `PATCH /api/people/:id/parents/:kind` and `PATCH /api/auth/me`. `DELETE /api/people/:id/parents/:parentId` needs no kind (a person is in one set of a child, apart from the stepparent case).
- Later features read the helpers in migration 0006, never the viewer's setting, for anything about privacy.
- Out of scope, still: place and source on links, GEDCOM `PEDI`, the My settings page (0.2; the profile switch is enough now), foster or guardian links, step relatives, and a partner's own children by someone else (#22).
