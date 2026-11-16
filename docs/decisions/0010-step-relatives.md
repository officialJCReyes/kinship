# 0010. Step relatives and a partner's children from another relationship

- Status: **Accepted** (decisions by JC, 2026-11-16)
- Date: 2026-11-16
- Builds on: [0007 Birth and adoptive parent links](0007-adoption-parentage.md), [0009 Custom relationship labels](0009-relationship-labels.md)
- Sources: `design/kinship-v2-requirements.md` (partner relationships), the mockup's relationship list and cards.

## Rules

- **Step-parent:** the other partner of a **Married or Widowed** relationship of one of this person's parents, who is not already one of this person's parents (a parent through the same relationship is never a step-parent). **Stepchild:** a child of one of this person's Married or Widowed partners who does not hang from this person: from the partner alone, or from the partner's relationship with somebody else. Divorced, separated, engaged, partner, annulment, friends, unknown and other give no step titles.
- **The viewer's lineage view decides**, as it does for half-siblings: an adopted person's step-parents come through the set the view follows, and a partner's adopted-away child is a stepchild only in the view that follows the partner's set.
- **Where it shows:** a "Step relatives" list on the profile with the title (Stepmother, Stepson, ...); and, on each relationship card, "<partner>'s children from another relationship", with "with <other parent>" or "other parent not on the tree", and "your stepson" only for a Married or Widowed relationship. The card lists the child for every status.
- **A custom label replaces the derived step title for the same pair, on both profiles** (Carla's "Stepmother" row for Elena, and Elena's "Stepdaughter" row for Carla). It changes only the title row: the card still lists the child, without the step wording. Parents, partners, children and siblings are structure and are never hidden by a label.

## Data

Step-parents are derived in the web app from the tree response the profile already loads. Stepchildren and the cards need the partner's other children and their other parent, which the tree response cannot say (a relationship with somebody who is not drawn collapses to "the partner alone"), so `GET /api/people/:id` gains one field, `partnerChildren`: the children of the person's partners who do not hang from the person, with the other parent as a person. It is one batched query for all partners and one for the people it names, never per relative. Candidates are chosen through the indexes on the partner first, and the viewer's rule for which set a child follows is applied only to those, so it is not run over the whole table (the first version did, and a profile in a 2,000-person tree took 26 to 33 ms instead of 8 to 10).

## Measured

`GET /api/people/:id`: Hale family 862 bytes per person before, 1,112 after (labels and `partnerChildren`), median about 8 to 11 ms; 2,000-person fixture 1,126 to 1,147 bytes, 8 to 10 ms; a person with six partners and 30 partner children 16 KB, 13 ms. The "all-kinds walk" over 60 people stays at 86 ms.
