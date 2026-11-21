// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Custom relationship labels in the finder (ADR 0009 and 0010): the headline stays the derived name, and an admin's
// label shows under it as "Also called ...". The one exception is a step title (Stepmother, Stepbrother): there the
// label replaces the derived title, as it does on the profile. A label never changes the tree.
import type { RelationshipResponse } from '@kinship/shared';
import { t } from '../i18n.js';
import { displayName } from '../lib/names.js';

export interface CustomLines {
  /** What replaces the derived step title as the headline, or null when the derived name stays. */
  headline: string | null;
  /** Lines under the headline, each a custom label. */
  lines: string[];
}

export function customLines(result: RelationshipResponse): CustomLines {
  const first = result.people[result.a];
  const second = result.people[result.b];
  const direct: string[] = [];
  const sentences: string[] = [];
  for (const entry of result.labels) {
    // `from`: the second person IS the first person's label. `to` with a reverse label: they are its reverse.
    if (entry.direction === 'from') direct.push(entry.label);
    else if (entry.reverseLabel) direct.push(entry.reverseLabel);
    else if (first && second) {
      // The first person is the second's label and there is no word for the other way round: say it as a sentence.
      sentences.push(
        t('finder.labelOf', { first: displayName(first), second: displayName(second), label: entry.label }),
      );
    }
  }
  const replaces = result.stepTitle && direct.length > 0;
  const shown = replaces ? direct.slice(1) : direct;
  return {
    headline: replaces ? direct[0]! : null,
    lines: [...shown.map((label) => t('finder.alsoCalled', { label })), ...sentences],
  };
}
