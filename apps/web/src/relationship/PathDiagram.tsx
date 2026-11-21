// SPDX-License-Identifier: AGPL-3.0-or-later
import { relWord } from '@kinship/shared';
import type { RelationshipResponse } from '@kinship/shared';
import { Link } from 'react-router';
import { t } from '../i18n.js';
import { displayName } from '../lib/names.js';
import { lifespan } from '../lib/people.js';
import { relationText } from './path.js';
import { pathSteps } from './path.js';

function PersonCard({ result, id }: { result: RelationshipResponse; id: string }) {
  const person = result.people[id];
  if (!person) return null;
  const highlighted = id === result.a || id === result.b;
  const body = (
    <>
      <b>{displayName(person)}</b>
      <small>{lifespan(person)}</small>
    </>
  );
  const className = `rcard${highlighted ? ' hl' : ''}`;
  // An unknown parent is a hop on the path, never a page of its own.
  if (person.isPlaceholder) return <span className={className}>{body}</span>;
  // Keyboard and screen reader users read "The path in words" below; the diagram's links are for the mouse.
  return (
    <Link className={className} to={`/people/${id}`} tabIndex={-1}>
      {body}
    </Link>
  );
}

function Edge({ label }: { label: string }) {
  return (
    <div className="redge">
      <span>{label}</span>
    </div>
  );
}

/**
 * The picture of the path: the shared ancestor(s) on top and each person's line down to them, or a chain of people
 * with the relationship written between each pair. The same people, in the same order, are listed in words next to
 * it (`PathText`), so this is hidden from assistive technology.
 */
export function PathDiagram({ result }: { result: RelationshipResponse }) {
  if (result.chain) {
    const { people, links } = result.chain;
    return (
      <div className="rdiagram" aria-hidden="true">
        <div className="rchain">
          {people.map((id, index) => (
            <div className="rchain-item" key={`${id}-${index}`}>
              <PersonCard result={result} id={id} />
              {index < links.length ? <Edge label={relationText(links[index]!)} /> : null}
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (!result.blood) return null;
  const { ancestors, lineA, lineB, dA, dB } = result.blood;
  const column = (line: string[], which: 'a' | 'b') => (
    <div className={`rcol rcol-${which}`}>
      {line.map((id, index) => {
        const upper = index === 0 ? ancestors : [line[index - 1]!];
        const gender = result.people[upper[0]!]?.gender ?? null;
        const label = upper.length > 1 ? t('finder.diagram.parents') : relationText(relWord('parent', gender));
        return (
          <div key={id}>
            <Edge label={label} />
            <PersonCard result={result} id={id} />
          </div>
        );
      })}
    </div>
  );
  return (
    <div className="rdiagram" aria-hidden="true">
      <div className="rrow">
        {ancestors.map((id) => (
          <PersonCard key={id} result={result} id={id} />
        ))}
      </div>
      <div className="rcols">
        {dA > 0 ? column(lineA, 'a') : null}
        {dB > 0 ? column(lineB, 'b') : null}
      </div>
    </div>
  );
}

/** The path as an ordered list of the same people, each a link, with what they are to the one before. */
export function PathText({ result }: { result: RelationshipResponse }) {
  const steps = pathSteps(result);
  if (steps.length === 0) return null;
  const nameOf = (id: string) => {
    const person = result.people[id];
    return person ? displayName(person) : t('finder.people.unknown');
  };
  const namesOf = (ids: string[]) =>
    ids.length === 2 ? t('finder.listAnd', { first: nameOf(ids[0]!), second: nameOf(ids[1]!) }) : nameOf(ids[0]!);
  return (
    <section aria-labelledby="finder-path-title">
      <h2 id="finder-path-title" className="finder-subtitle">
        {t('finder.path.title')}
      </h2>
      <ol className="finder-path">
        {steps.map((step, index) => {
          const person = result.people[step.id];
          const name = nameOf(step.id);
          const label = person?.isPlaceholder ? name : null;
          return (
            <li key={`${step.id}-${index}`}>
              {label ?? <Link to={`/people/${step.id}`}>{name}</Link>}
              {step.relation ? (
                <span className="muted">
                  {' · '}
                  {t('finder.path.relation', { relation: relationText(step.relation), names: namesOf(step.to) })}
                </span>
              ) : null}
              {step.shared ? <span className="muted"> ({t('finder.path.shared')})</span> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
