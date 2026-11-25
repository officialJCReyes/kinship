# 0040. The person panel's outbound research link

- Status: **Accepted** (decisions by JC, 2026-11-25, step 49)
- Date: 2026-11-25
- Builds on: [0010 Step relatives](0010-step-relatives.md) (a custom step title replaces the derived one), [0021 Optional AI
  features](0021-optional-ai-features.md) (nothing calls an outside service unless it is asked for)
- Migration: none.

## Context

The approved mockup (step 49) gives the tree's person panel a round **Research** button: a FamilySearch record search for the
selected person, prefilled with their name and years, opened in a new tab. It is the first place KinShip points family data
at another site, so where the line sits, what is sent and for whom needs to be written down.

## Decisions

### An outbound link, nothing more
The button is a plain `<a href target="_blank" rel="noopener noreferrer">`. KinShip makes **no request** to FamilySearch: no
API, no key, no account link, no preview, no prefetch. Nothing leaves the browser until a person clicks, and then it is the
browser that opens the address. `noreferrer` keeps the tree's own address (and with it the person's id) out of the request.
Its name and tooltip say where it goes and that it opens a new tab: "Research this person on FamilySearch (opens in a new
tab)".

### What a click sends
The address carries, in the query string, the person's **given name**, **surname** (the birth surname and, when there is one,
the second surname, joined by a space), the **birth year** and, for a deceased person, the **death year**:

```
https://www.familysearch.org/en/search/record/results?count=20&q.birthLikeDate.from=YYYY&q.deathLikeDate.from=YYYY&q.givenName=…&q.surname=…
```

In that order, each year only when known, no `.to` bounds, values encoded with `encodeURIComponent`. Never the married
surname, the nickname, full dates, places, relatives or anything else. Clicking it for a **living adult** sends that adult's
name and birth year to FamilySearch too; that is accepted, because the person clicking can already see both and could type
them into the same search.

### Who gets the link
- **Deceased people:** always (when they have a given name and a surname).
- **Living people:** only with a **known birth year** and an age of **18 or more**. The age counts the youngest the person
  could be: from a complete exact date it is the real age; from a year alone, a month alone or an "about" date it is one year
  less than the difference of the years; an "after" date has no upper bound and never counts.
- **Never** for a living person under 18, a living person with no birth year (they could be a child), a placeholder, or a
  person without a given name or a surname.

The rule is applied in the browser from the person the viewer can already see; the API is unchanged. When privacy for living
people and minors arrives (0.6), the link follows whatever that release hides: a person whose facts are masked gets no link.

### The relationship line beside it
The same step adds "Your grandfather" ("This is you" on your own person) to the panel, from the existing relationship finder.
It is asked for only when the selection has rested for 250 ms, never for your own person or a placeholder, and shows nothing
while it loads. An admin's custom step title replaces the derived title as typed (ADR 0010); other custom labels stay on the
profile and in the finder.

## Consequences

- A future "research on another site" button follows the same rules: a link, not a call; the same minimal fields; the same
  exclusions for children and people with no birth year.
- If FamilySearch changes its search address, only `apps/web/src/lib/research.ts` changes.
