// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The person panel's relationship line (step 49): who the selected person is to you. "This is you" on your own person;
// "Your grandfather" otherwise, from the relationship finder. An admin's custom step title replaces the derived one as
// typed (ADR 0010); other custom labels stay on the profile and in the finder. Nothing shows while it loads, with no
// relationship, or when the account has no person. The request waits until the selection has rested for 250 ms, so
// walking the tree with the keyboard does not ask for every person passed.
import { renderRelName } from '@kinship/shared';
import type { Person, RelationshipResponse } from '@kinship/shared';
import { t } from '../i18n.js';
import { useDebounced } from '../lib/useDebounced.js';
import { customLines } from '../relationship/labels.js';
import { useRelationship } from '../relationship/queries.js';

export const RELATIONSHIP_DEBOUNCE_MS = 250;

/** "Your grandfather", or null when there is nothing to say. Pure, for the tests. */
export function relationshipLine(result: RelationshipResponse): string | null {
  if (result.kind === 'none' || result.kind === 'self') return null;
  const custom = customLines(result).headline;
  if (custom) return t('tree.panel.relationship', { name: custom });
  if (!result.name) return null;
  const derived = renderRelName(result.name, t);
  return t('tree.panel.relationship', { name: derived.charAt(0).toLowerCase() + derived.slice(1) });
}

export function PanelRelationship({ person, mePersonId }: { person: Person; mePersonId: string | null }) {
  const self = mePersonId !== null && mePersonId === person.id;
  const wanted = mePersonId === null || self || person.isPlaceholder ? null : person.id;
  const target = useDebounced(wanted, RELATIONSHIP_DEBOUNCE_MS);
  const query = useRelationship(target === null ? null : mePersonId, target);
  if (self) return <div className="panel-rel">{t('tree.panel.thisIsYou')}</div>;
  // A stale answer (the selection moved on, the debounce has not caught up) is never shown.
  const result = query.data && query.data.b === person.id && target === person.id ? query.data : null;
  const line = result ? relationshipLine(result) : null;
  return line ? <div className="panel-rel">{line}</div> : null;
}
