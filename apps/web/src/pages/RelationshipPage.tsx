// SPDX-License-Identifier: AGPL-3.0-or-later
import { renderRelName } from '@kinship/shared';
import type { Person, RelationshipResponse } from '@kinship/shared';
import { Link, useSearchParams } from 'react-router';
import { PersonPicker } from '../components/PersonPicker.js';
import { ErrorState } from '../components/States.js';
import { t } from '../i18n.js';
import { displayName } from '../lib/names.js';
import { usePersonDetail } from '../people/queries.js';
import { PathDiagram, PathText } from '../relationship/PathDiagram.js';
import { relationText } from '../relationship/path.js';
import { useExamplePairs, useRelationship } from '../relationship/queries.js';
import { customLines } from '../relationship/labels.js';
import { generationNote, isRemovedCousin, RemovedPanel } from '../relationship/RemovedPanel.js';

const nameList = (names: string[]): string =>
  names.length === 2 ? t('finder.listAnd', { first: names[0]!, second: names[1]! }) : (names[0] ?? '');

function Result({ result }: { result: RelationshipResponse }) {
  const first = result.people[result.a];
  const second = result.people[result.b];
  if (!first || !second) return null;
  const custom = customLines(result);
  const headline = custom.headline ?? (result.name ? renderRelName(result.name, t) : t('finder.none'));
  const note = generationNote(result);
  const ancestors = (result.blood?.ancestors ?? []).flatMap((id) => {
    const person = result.people[id];
    return person ? [displayName(person)] : [];
  });
  const also = result.also.map((name) => relationText(name));
  return (
    <div className={isRemovedCousin(result) ? 'finder-grid' : undefined}>
      <section className="card finder-result" aria-label={t('finder.title')}>
        <div role="status" aria-live="polite">
          <div className="muted">
            {t('finder.headline', { first: displayName(first), second: displayName(second) })}
          </div>
          <div className="rbig">
            {headline}
            {custom.headline ? <span className="pill gray">{t('label.custom')}</span> : null}
          </div>
        </div>
        {custom.lines.map((line) => (
          <p key={line} className="muted">
            {line} <span className="pill gray">{t('label.custom')}</span>
          </p>
        ))}
        {result.kind === 'self' ? <p className="muted">{t('finder.self')}</p> : null}
        {result.kind === 'none' ? (
          <>
            {result.other === 'adoption' ? (
              <p>{t(`finder.adoption.${result.lineage}`)}</p>
            ) : (
              <p className="muted">{result.tooDistant ? t('finder.tooDistant') : t('finder.noneHelp')}</p>
            )}
          </>
        ) : null}
        {note ? <p className="muted">{note}</p> : null}
        {ancestors.length > 0 ? (
          <p className="muted">
            {t(ancestors.length > 1 ? 'finder.ancestors.many' : 'finder.ancestors.one', {
              names: nameList(ancestors),
            })}
          </p>
        ) : null}
        {also.length > 0 ? <p className="muted">{t('finder.alsoRelated', { names: also.join(', ') })}</p> : null}
        {result.kind !== 'none' && result.kind !== 'self' ? (
          <>
            <div className="finder-diagram">
              <PathDiagram result={result} />
            </div>
            <PathText result={result} />
          </>
        ) : null}
      </section>
      <RemovedPanel result={result} />
    </div>
  );
}

/** Pick any two people and see how the second is related to the first. The two people are in the address (?a=&b=). */
export function RelationshipPage() {
  const [params, setParams] = useSearchParams();
  const a = params.get('a');
  const b = params.get('b');
  const personA = usePersonDetail(a ?? undefined).data?.person ?? null;
  const personB = usePersonDetail(b ?? undefined).data?.person ?? null;
  const result = useRelationship(a, b);
  const examples = useExamplePairs();
  const set = (next: { a?: string | null; b?: string | null }) => {
    const merged = { a, b, ...next };
    const query: Record<string, string> = {};
    if (merged.a) query['a'] = merged.a;
    if (merged.b) query['b'] = merged.b;
    setParams(query);
  };
  const choose = (which: 'a' | 'b') => (person: Person | null) => set({ [which]: person?.id ?? null });

  return (
    <div className="stack">
      <h1>{t('finder.title')}</h1>
      <section className="card stack">
        <p className="muted">{t('finder.intro')}</p>
        <div className="finder-pickers">
          <PersonPicker label={t('finder.person1')} value={personA} onChange={choose('a')} />
          <button
            className="button finder-swap"
            type="button"
            aria-label={t('finder.swap')}
            title={t('finder.swap')}
            disabled={!a && !b}
            onClick={() => set({ a: b, b: a })}
          >
            ⇄
          </button>
          <PersonPicker label={t('finder.person2')} value={personB} onChange={choose('b')} />
        </div>
        {examples.length > 0 ? (
          <div className="finder-examples">
            <span className="muted">{t('finder.examples')}</span>
            {examples.map((pair) => (
              <Link
                key={`${pair.a.id}-${pair.b.id}`}
                className="button small"
                to={`/relationship?a=${pair.a.id}&b=${pair.b.id}`}
              >
                {t('finder.examplePair', { first: pair.a.givenName, second: pair.b.givenName })}
              </Link>
            ))}
          </div>
        ) : null}
      </section>
      {a && b ? (
        result.isPending ? (
          <p className="muted" role="status">
            {t('finder.loading')}
          </p>
        ) : result.isError ? (
          <ErrorState error={result.error} onRetry={() => void result.refetch()} />
        ) : (
          <Result result={result.data} />
        )
      ) : (
        <p className="muted" role="status">
          {t('finder.choose')}
        </p>
      )}
    </div>
  );
}
