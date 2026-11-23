// SPDX-License-Identifier: AGPL-3.0-or-later
import { relWord } from '@kinship/shared';
import type { RelationshipResponse } from '@kinship/shared';
import { Fragment, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { t } from '../i18n.js';
import { initials } from '../tree/family.js';
import { fitName, measureText } from '../tree/cardText.js';
import { displayName } from '../lib/names.js';
import { lifespan } from '../lib/people.js';
import { photoUrl } from '../lib/photos.js';
import { CARD_H, CARD_W, layoutPath } from './diagramLayout.js';
import type { DiagramCard } from './diagramLayout.js';
import { relationText } from './path.js';
import { pathSteps } from './path.js';

/** A person's card in the drawing: avatar (photo or initials), the whole name on up to two lines, and the years. */
function Card({ result, card }: { result: RelationshipResponse; card: DiagramCard }) {
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const clip = `${useId()}-clip`;
  const person = result.people[card.id];
  if (!person) return null;
  const name = displayName(person);
  const fit = fitName(name, CARD_W - 16, measureText, 2, 13);
  const left = card.x - CARD_W / 2;
  const avatarY = card.y + 24;
  const photo = person.photoMediaId && !failed ? person.photoMediaId : null;
  const nameTop = card.y + 50;
  const body = (
    <>
      <rect className="rbox" x={left} y={card.y} width={CARD_W} height={CARD_H} rx={10} />
      <circle className="ravatar" cx={card.x} cy={avatarY} r={17} />
      <text className="rini" x={card.x} y={avatarY + 4} textAnchor="middle">
        {initials(person)}
      </text>
      {photo ? (
        <>
          <clipPath id={clip}>
            <circle cx={card.x} cy={avatarY} r={17} />
          </clipPath>
          <image
            href={photoUrl(photo, 'avatar')}
            x={card.x - 17}
            y={avatarY - 17}
            width={34}
            height={34}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#${clip})`}
            onError={() => setFailed(true)}
          />
        </>
      ) : null}
      <text className="rname" textAnchor="middle" style={{ fontSize: fit.size }}>
        {fit.lines.map((line, index) => (
          <tspan key={index} x={card.x} y={nameTop + index * fit.lineHeight + fit.size * 0.8}>
            {line}
          </tspan>
        ))}
      </text>
      <text className="ryears" x={card.x} y={card.y + CARD_H - 8} textAnchor="middle">
        {lifespan(person)}
      </text>
    </>
  );
  const className = `rcard${card.highlight ? ' hl' : ''}`;
  // Keyboard and screen reader users read "The path in words" below; the drawing's links are for the mouse.
  return (
    <a
      className={className}
      href={`/people/${card.id}`}
      tabIndex={-1}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        void navigate(`/people/${card.id}`);
      }}
    >
      <title>{name}</title>
      {body}
    </a>
  );
}

/**
 * The picture of the path (backlog 9): the shared ancestors above each blood link with lines down to both sides, and a
 * labelled horizontal link for each marriage (see diagramLayout.ts). The same people, in the same order, are listed in
 * words next to it (`PathText`), so this is hidden from assistive technology. It scales down to fit, but not below 0.7;
 * a longer path then scrolls sideways inside its box, never the page.
 */
export function PathDiagram({ result }: { result: RelationshipResponse }) {
  const layout = useMemo(
    () =>
      layoutPath(result, {
        parentLabel: (upper) =>
          upper.length > 1
            ? t('finder.diagram.parents')
            : relationText(relWord('parent', result.people[upper[0]!]?.gender ?? null)),
        linkLabel: (index) => {
          const name = index < 0 ? result.name : result.chain?.links[index];
          return name ? relationText(name) : '';
        },
        measure: measureText,
        drawable: (id) => Boolean(result.people[id]) && !result.people[id]!.isPlaceholder,
        gender: (id) => result.people[id]?.gender ?? null,
      }),
    [result],
  );
  if (!layout) return null;
  return (
    <div className="rdiagram" aria-hidden="true">
      <svg
        className="rsvg"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width={layout.width}
        height={layout.height}
        style={{ maxWidth: '100%', minWidth: Math.round(layout.width * 0.7), height: 'auto' }}
      >
        {layout.lines.map((d, index) => (
          <path key={`l${index}`} className="rline" d={d} />
        ))}
        {layout.links.map((link, index) => (
          <g key={`k${index}`} className="rlink">
            <path d={link.d} />
            <path className="rarrow" d={link.arrow} />
          </g>
        ))}
        {layout.labels.map((label, index) => (
          <text key={`t${index}`} className="rlabel" x={label.x} y={label.y} textAnchor={label.anchor}>
            {label.text}
          </text>
        ))}
        {layout.cards.map((card) => (
          <Card key={card.id} result={result} card={card} />
        ))}
      </svg>
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
  // Two people as "A and B", each a link, in the order the translation puts them.
  const linkedPair = (first: ReactNode, second: ReactNode) =>
    t('finder.listAnd', { first: '{first}', second: '{second}' })
      .split(/(\{first\}|\{second\})/)
      .map((part, i) => (
        <Fragment key={i}>{part === '{first}' ? first : part === '{second}' ? second : part}</Fragment>
      ));
  // A person is a link to their profile; an unknown parent has no page, so it is plain text.
  const personLink = (id: string) =>
    result.people[id]?.isPlaceholder ? nameOf(id) : <Link to={`/people/${id}`}>{nameOf(id)}</Link>;
  return (
    <section aria-labelledby="finder-path-title">
      <h2 id="finder-path-title" className="finder-subtitle">
        {t('finder.path.title')}
      </h2>
      <ol className="finder-path">
        {steps.map((step, index) => {
          const previous = steps[index - 1];
          return (
            <li key={`${step.id}-${index}`}>
              {personLink(step.id)}
              {step.relation ? (
                <span className="muted">
                  {' · '}
                  {t('finder.path.relation', { relation: relationText(step.relation), names: namesOf(step.to) })}
                </span>
              ) : null}
              {step.shared ? <span className="muted"> ({t('finder.path.shared')})</span> : null}
              {step.via && previous ? (
                <ul
                  className="finder-path-via"
                  aria-label={t('finder.path.via', { first: nameOf(previous.id), second: nameOf(step.id) })}
                >
                  {step.via.map((via) => (
                    <li key={via.ids.join('+')}>
                      {via.ids.length === 2
                        ? linkedPair(personLink(via.ids[0]!), personLink(via.ids[1]!))
                        : personLink(via.ids[0]!)}
                      <span className="muted">
                        {' · '}
                        {t('finder.path.relation', {
                          relation:
                            via.relation === 'parents'
                              ? t('finder.diagram.parents').toLowerCase()
                              : relationText(via.relation),
                          names: namesOf(via.to),
                        })}
                        {via.shared
                          ? ` (${t(via.ids.length > 1 ? 'finder.path.sharedMany' : 'finder.path.shared')})`
                          : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
