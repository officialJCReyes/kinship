# KinShip public tree: what a signed-out visitor sees (Nov 16, 2026)

Asked by JC, Nov 16: "What does a signed-out user see? Could someone make a public tree that only shows deceased individuals, with living people's first name and other personal details hidden, and gender and year of birth still visible?" Proposed design, not built, not mocked up yet. Items marked **Proposed** need JC's yes. Companion to `kinship-v2-requirements.md`, `kinship-adoption.md` and `kinship-identity-numbers.md`.

## Today (as designed and built)
KinShip is **public internet, login required** (requirements doc). A signed-out visitor sees only:
- the **sign-in page**, with the version and a **Source code** link in the footer (the AGPL requirement);
- the **setup page** before the first account exists.

Every other route, and every API call except sign-in, setup and the version, needs a session. Nothing about the family is visible. Search engines see only the sign-in page.

## What JC asked for
An optional **public tree** that shows **deceased people** in full and **living people only as masked entries** with **gender and year of birth** visible. Everything else about a living person is hidden.

**Default: off.** Turning it on is a deliberate act by the SuperAdmin, and every other part of the app still requires sign-in.

## What a visitor sees
| Item | Deceased person | Living person |
|---|---|---|
| Name | Full name | **"Living"** (no first name, no surname; **Proposed:** an admin option to show the surname, off) |
| Gender | Shown | Shown (JC) |
| Birth | Date, place | **Year only** (JC). **Proposed:** hidden for anyone under 18 (the same rule as birthday reminders) |
| Death | Date, place | n/a |
| Photos, files, sources, stories, notes | Hidden in v1 | Hidden |
| Relationships | Drawn | Drawn (the tree lines are the point) |
| Marriage and relationship dates and places | Shown when **both** partners are deceased | Hidden |
| Cause of death, medical history, surgeries, DNA and the DNA badge, identity numbers, email, phone, address, account status | **Never** | **Never** |
| Adoption | Only the **legal** family is drawn, with no "adopted" label and no birth family (**Proposed**: adoption is sensitive and there is no private flag on birth links) | Same |

A masked card says "Living · Female · born 1986" and nothing else. Clicking a deceased person opens a small read-only card with their facts; clicking a masked person does nothing but explain "Details of living people are private."

**Honest limit:** hiding names does not make a living person anonymous. A masked node with a gender, a birth year and named deceased parents is recognisable to anyone who knows the family. That is the trade-off JC chose by keeping gender and year of birth; the proposed under-18 rule and the surname option reduce it. An admin who wants no hint at all can switch to **"Count only"** (**Proposed**): living people become one summary node ("3 living descendants") with no gender or year.

## Who counts as living (one rule, used everywhere)
- A person is **deceased only if marked deceased** in KinShip. No death date alone is not enough, and no birth year alone is not enough.
- **Proposed:** an Admin data check lists people with no death record **born more than 110 years ago**, titled "Possibly deceased; shown as living on the public tree", so they are not silently masked forever.
- The same function decides GEDCOM export ("Living") and the public tree, so there is one rule to test. Marking someone deceased makes them visible on the public tree, so the edit window says so: "Details of {name} will become visible on the public tree." Marking them living again hides them at once.
- **Per-person override (Proposed):** an admin can mark a deceased person **"Keep private on the public tree"** (shown as masked). Living people can never be shown publicly in v1. A later option could let a living person choose to appear.

## Settings (Admin → Settings → Public tree, SuperAdmin only; **Proposed**)
- **Public tree:** Off (default) / On.
- **Who can open it:** **Anyone with the link** (a random link; **Regenerate** revokes the old one; default) or **Anyone, listed at `/tree/public`**. Both are `noindex`; search engines are told not to list it.
- **Start from:** the person the tree opens on (default: the SuperAdmin's own person) and how many generations up and down a visitor may open (default 4 up, 3 down).
- **Living people:** show gender (on), show year of birth (on), show surname (off), "count only" (off).
- **Deceased:** show only people who died at least **N years ago** (default 0; some families prefer 10 or 25 so recent losses stay private).
- **View as a visitor** button, which opens the public view in a new tab with the current settings, so the SuperAdmin sees exactly what the world sees before turning it on.
- The login page gets a **"View the public family tree"** link only when the listed option is on.

## How it is built (and kept safe)
- **Masking happens in the database, not in the browser.** The public routes (`GET /api/public/tree/:personId`, `GET /api/public/people/:id`) return only what a `SECURITY DEFINER` function `kinship_public_person()` allows, with the masked fields replaced. The app role that serves signed-in users is not used for them. Hiding a field in the web app is never the protection.
- **An "Anonymous" role in the privacy test suite**, next to Admin, Member and User: a seeded fixture puts a canary value in every hidden field of every living person (name, notes, photos, medical, identity number) and in the hidden fields of deceased people, and a property test asserts no public response, error body or log line contains any canary. The existing partnerChildren-style property test pattern is reused.
- **Link access:** the link token is a random 128-bit value stored hashed. IDs in public responses are not the internal person IDs (opaque, per-link), so a visitor cannot walk the database by guessing numbers.
- **Abuse limits:** rate limit by address, a ceiling on how many people one response returns, short caching, no cookies, no analytics, `X-Robots-Tag: noindex`. A SuperAdmin sees a simple counter of public views, nothing about visitors.
- **No public search by name for living people**, since they have no name. Search covers deceased names only (**Proposed:** not in v1; open the tree from the start person).
- **Files and photos are not served publicly in v1.** They carry names, addresses and numbers; a later option could mark individual photos of deceased people as public.
- Public requests never touch session or CSRF code, and the public routes are read-only (`GET` only).
- Every change to these settings is written to the change history (who, when, what), and turning the tree on shows a confirmation that lists exactly what becomes visible.

## Interaction with other decisions
- **Adoption (ADR 0007):** each signed-in viewer picks birth or adoptive. The public view has no viewer, so it uses the **legal family** only and shows no "adopted" label.
- **Medical, DNA, identity numbers, cause of death:** never in the public view, even for the deceased. Their visibility rules for signed-in accounts are unchanged.
- **Merge, GEDCOM, backups:** unchanged. Backups already include everything and stay private.
- **Roadmap:** needs the shared living/deceased function and an Anonymous role in the privacy suite, so the earliest sensible place is **0.7**, next to GEDCOM export ("Living" masking). **Proposed.**

## Open
- Confirm the masked-entry fields: gender and birth year as JC said, plus the under-18 year rule and "no surname by default".
- "Anyone with the link" as the default access, or fully public and listed?
- Whether recently deceased people should wait N years (default 0).
- Whether to include the "count only" mode in v1 or later.
- Whether deceased people's photos and short stories can be marked public, in v1 or later.
- Mockup next: the sign-in page with the "View the public family tree" link, the public tree with masked cards, the deceased card, and the Admin → Public tree settings page with "View as a visitor".
