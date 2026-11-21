// SPDX-License-Identifier: AGPL-3.0-or-later
import { cousinName, ordinalName, removedName, removedWordName } from '@kinship/shared';
import type { RelationshipResponse } from '@kinship/shared';
import { t } from '../i18n.js';
import { displayName } from '../lib/names.js';
import { relationText } from './path.js';

const generations = (n: number): string =>
  n === 1 ? t('finder.removed.generation.one') : t('finder.removed.generation.many', { n });

/** Whether the "What … means" panel and the generation note apply: two cousins who are not in the same generation. */
export function isRemovedCousin(result: RelationshipResponse): boolean {
  const blood = result.blood;
  return blood !== null && blood.dA >= 2 && blood.dB >= 2 && blood.dA !== blood.dB;
}

/** "{deep} is one generation further down the family tree than {shallow}." (tree generations, never ages). */
export function generationNote(result: RelationshipResponse): string | null {
  const blood = result.blood;
  if (!blood || !isRemovedCousin(result)) return null;
  const deepIsA = blood.dA > blood.dB;
  const deep = result.people[deepIsA ? result.a : result.b];
  const shallow = result.people[deepIsA ? result.b : result.a];
  if (!deep || !shallow) return null;
  const gap = Math.abs(blood.dA - blood.dB);
  const names = { deep: displayName(deep), shallow: displayName(shallow) };
  return gap === 1 ? t('finder.note.one', names) : t('finder.note.many', { ...names, n: gap });
}

/** The side panel that says how "once removed" is worked out, with this pair's own numbers. */
export function RemovedPanel({ result }: { result: RelationshipResponse }) {
  const blood = result.blood;
  const first = result.people[result.a];
  const second = result.people[result.b];
  if (!blood || !first || !second || !isRemovedCousin(result)) return null;
  const small = Math.min(blood.dA, blood.dB);
  const large = Math.max(blood.dA, blood.dB);
  const removed = large - small;
  const degree = small - 1;
  const cousin = cousinName(degree);
  const removedLabel = relationText(removedWordName(removed));
  const ordinalText = relationText(ordinalName(degree));
  const fullName = relationText(removedName(removed, cousin));
  const deepIsA = blood.dA > blood.dB;
  const deepId = deepIsA ? result.a : result.b;
  const shallowId = deepIsA ? result.b : result.a;
  const deepLine = deepIsA ? blood.lineA : blood.lineB;
  const peerId = deepLine[small - 1];
  const peer = peerId ? result.people[peerId] : undefined;
  const ancestors = blood.ancestors
    .map((id) => result.people[id])
    .flatMap((person) => (person ? [displayName(person)] : []));
  const ancestorNames =
    ancestors.length === 2 ? t('finder.listAnd', { first: ancestors[0]!, second: ancestors[1]! }) : ancestors[0]!;
  const nameOf = (id: string) => displayName(result.people[id]!);
  return (
    <aside className="card finder-explainer" aria-labelledby="finder-removed-title">
      <h2 id="finder-removed-title">{t('finder.removed.title', { name: fullName })}</h2>
      <p className="muted">{t('finder.removed.intro')}</p>
      <div className="tblwrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{t('finder.removed.person')}</th>
              <th scope="col">{t('finder.removed.below', { names: ancestorNames })}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{displayName(first)}</td>
              <td>{generations(blood.dA)}</td>
            </tr>
            <tr>
              <td>{displayName(second)}</td>
              <td>{generations(blood.dB)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="muted">
        {t('finder.removed.cousinNumber', { small, ordinal: ordinalText })}
        <br />
        {t('finder.removed.removedNumber', { large, small, removed: removedLabel })}
      </p>
      {peer && peerId !== deepId ? (
        <p>
          {t('finder.removed.peer', {
            peer: displayName(peer),
            shallow: nameOf(shallowId),
            ordinal: ordinalText,
            deep: nameOf(deepId),
            gap: removed === 1 ? t('finder.removed.gap.one') : t('finder.removed.gap.many', { n: removed }),
            removed: removedLabel,
          })}
        </p>
      ) : null}
      <p>{t('finder.removed.bothWays', { first: displayName(first), second: displayName(second), name: fullName })}</p>
      <p className="muted">{t('finder.removed.example')}</p>
    </aside>
  );
}
