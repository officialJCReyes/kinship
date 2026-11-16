// SPDX-License-Identifier: AGPL-3.0-or-later
import { displayName } from '../lib/names.js';
import { useState } from 'react';
import { Link } from 'react-router';
import { useSession } from '../auth.js';
import { ActionButton } from '../components/ActionButton.js';
import { EmptyState, ErrorState, Loading } from '../components/States.js';
import { t } from '../i18n.js';
import { lifespan } from '../lib/people.js';
import { useDebounced } from '../lib/useDebounced.js';
import { isAdmin } from '../people/permissions.js';
import { AddPersonDialog } from '../people/PersonDialogs.js';
import { usePeopleSearch } from '../people/queries.js';

export function PeoplePage() {
  const me = useSession(false).data?.user;
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  const q = useDebounced(text, 250);
  const people = usePeopleSearch(q.trim());
  const items = people.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section className="card">
      <div className="profile-head">
        <h1>{t('people.title')}</h1>
        {isAdmin(me) ? <ActionButton onClick={() => setAdding(true)}>{t('people.add')}</ActionButton> : null}
      </div>
      <div className="field">
        <label htmlFor="people-search">{t('people.search')}</label>
        <input
          id="people-search"
          type="search"
          autoComplete="off"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      {people.isPending ? <Loading /> : null}
      {people.isError ? <ErrorState error={people.error} onRetry={() => void people.refetch()} /> : null}
      {people.isSuccess && items.length === 0 ? (
        <EmptyState>{q.trim() ? t('people.noMatch', { query: q.trim() }) : t('people.empty')}</EmptyState>
      ) : null}
      {items.length > 0 ? (
        <ul className="people-list" aria-label={t('people.title')}>
          {items.map((person) => (
            <li key={person.id}>
              <Link to={`/people/${person.id}`}>{displayName(person)}</Link>
              <span className="muted">{lifespan(person)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {people.hasNextPage ? (
        <button
          className="button"
          type="button"
          disabled={people.isFetchingNextPage}
          onClick={() => void people.fetchNextPage()}
        >
          {people.isFetchingNextPage ? t('common.loading') : t('people.loadMore')}
        </button>
      ) : null}
      {adding ? <AddPersonDialog onClose={() => setAdding(false)} /> : null}
    </section>
  );
}
