// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Person } from '@kinship/shared';
import { useId, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { t } from '../i18n.js';
import { lifespan } from '../lib/people.js';
import { displayName } from '../lib/names.js';
import { usePeopleLookup } from '../people/queries.js';

/** Lower case, no accents: how the database compares names too. */
const fold = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * The nickname to add to a result's detail line: only when the match came from the nickname alone, that is, some typed
 * word is not in the name as this viewer sees it, and every word is in the shown name or the nickname.
 */
export function nicknameHint(person: Person, text: string): string | null {
  if (!person.nickname) return null;
  const words = fold(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const shown = fold(displayName(person));
  const nick = fold(person.nickname);
  const missing = words.filter((word) => !shown.includes(word));
  if (missing.length === 0) return null;
  return missing.every((word) => nick.includes(word)) ? person.nickname : null;
}

/**
 * A search box for the chart's top bar. A combobox: type, Up and Down, Enter to choose, Esc to close; a tap or click
 * on a row chooses it. The matching is the People page's (`GET /api/people?q=`), over every part of a name.
 */
export function TreeSearch({ onChoose }: { onChoose: (person: Person) => void }) {
  const id = useId();
  const listId = `${id}-list`;
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const lookup = usePeopleLookup(text, { limit: 8 });
  const options = lookup.items;
  const showList = open && lookup.query !== '';

  const choose = (person: Person) => {
    setOpen(false);
    setText('');
    onChoose(person);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, Math.max(options.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && showList && options[active]) {
      event.preventDefault();
      choose(options[active]);
    } else if (event.key === 'Escape' && showList) {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="tree-search" data-nopan>
      <input
        role="combobox"
        type="search"
        aria-label={t('tree.search.label')}
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && options[active] ? `${id}-option-${active}` : undefined}
        autoComplete="off"
        placeholder={t('tree.search.placeholder')}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
      />
      <ul id={listId} role="listbox" aria-label={t('tree.search.label')} hidden={!showList} className="picker-list">
        {options.map((person, index) => {
          const nickname = nicknameHint(person, text);
          const detail = [lifespan(person), nickname ? t('tree.search.alsoCalled', { nickname }) : ''].filter(Boolean);
          return (
            <li
              key={person.id}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(person)}
            >
              <span className="result-name">{displayName(person)}</span>
              {detail.length > 0 ? <span className="muted result-detail">{detail.join(' · ')}</span> : null}
            </li>
          );
        })}
        {lookup.hasMore ? (
          <li role="presentation" className="muted result-more">
            {t('tree.search.more')}
          </li>
        ) : null}
      </ul>
      {showList && !lookup.isFetching && options.length === 0 ? (
        <div className="muted field-help tree-search-none" role="status">
          {t('tree.search.none')}
        </div>
      ) : null}
    </div>
  );
}
