// SPDX-License-Identifier: AGPL-3.0-or-later
import { displayName } from '../lib/names.js';
import type { Person } from '@kinship/shared';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import type { KeyboardEvent } from 'react';
import * as api from '../api.js';
import { t } from '../i18n.js';
import { lifespan } from '../lib/people.js';
import { useDebounced } from '../lib/useDebounced.js';
import { peopleKey } from '../people/queries.js';

interface PersonPickerProps {
  label: string;
  value: Person | null;
  onChange: (person: Person | null) => void;
  /** People who cannot be chosen (for example the person the form is about). */
  excludeIds?: readonly string[];
}

/** Search the tree by name and choose one person. A combobox: type, use the arrow keys, Enter to choose. */
export function PersonPicker({ label, value, onChange, excludeIds = [] }: PersonPickerProps) {
  const id = useId();
  const listId = `${id}-list`;
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const query = useDebounced(text.trim(), 200);
  const results = useQuery({
    queryKey: [...peopleKey, 'picker', query],
    queryFn: ({ signal }) => api.listPeople({ q: query, limit: 8 }, signal),
    enabled: query !== '' && !value,
  });
  const options = (results.data?.items ?? []).filter((person) => !excludeIds.includes(person.id));

  if (value) {
    return (
      <div className="field">
        <span className="label">{label}</span>
        <div className="picked">
          <span>
            {displayName(value)} <span className="muted">{lifespan(value)}</span>
          </span>
          <button
            className="button small"
            type="button"
            onClick={() => {
              onChange(null);
              setText('');
            }}
          >
            {t('picker.change')}
          </button>
        </div>
      </div>
    );
  }

  const choose = (person: Person) => {
    onChange(person);
    setOpen(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, Math.max(options.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && open && options[active]) {
      event.preventDefault();
      choose(options[active]);
    } else if (event.key === 'Escape' && open) {
      // Close the list first; a second Escape closes the dialog around it.
      event.stopPropagation();
      setOpen(false);
    }
  };

  const showList = open && query !== '';
  return (
    <div className="field picker">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && options[active] ? `${id}-option-${active}` : undefined}
        autoComplete="off"
        placeholder={t('picker.placeholder')}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
      />
      <ul id={listId} role="listbox" aria-label={label} hidden={!showList} className="picker-list">
        {options.map((person, index) => (
          <li
            key={person.id}
            id={`${id}-option-${index}`}
            role="option"
            aria-selected={index === active}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(person)}
          >
            {displayName(person)} <span className="muted">{lifespan(person)}</span>
          </li>
        ))}
      </ul>
      {showList && !results.isFetching && options.length === 0 ? (
        <div className="muted field-help" role="status">
          {t('picker.none')}
        </div>
      ) : null}
    </div>
  );
}
