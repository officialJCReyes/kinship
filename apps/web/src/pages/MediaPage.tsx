// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Media: every photo of the family (ADR 0034). A grid of the small variants, a filter by person, "Load more", and the same viewer as
// the profile's Photos card. Photos are added on a person's profile, not here. Photos have no titles or captions.
import type { MediaListItem, Person } from '@kinship/shared';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import * as api from '../api.js';
import { PersonPicker } from '../components/PersonPicker.js';
import { EmptyState, ErrorState, Loading } from '../components/States.js';
import { t } from '../i18n.js';
import { displayName } from '../lib/names.js';
import { photoUrl } from '../lib/photos.js';
import { PhotoActions } from '../people/PhotoActions.js';
import { PhotoDialog, ProfilePhotoMarker } from '../people/photos.js';
import { peopleKey, usePersonDetail } from '../people/queries.js';

/** The viewer for one photo: the person its actions are about is the filtered person, or the only one it shows. */
function Viewer({ photo, filter, onClose }: { photo: MediaListItem; filter: Person | null; onClose: () => void }) {
  const person = photo.shows.find((p) => p.id === filter?.id) ?? (photo.shows.length === 1 ? photo.shows[0]! : null);
  // Whether this account may change THAT person is asked of the person, not guessed from the photo.
  const detail = usePersonDetail(person?.id, { quiet: true });
  return (
    <PhotoDialog
      photo={photo}
      person={person}
      isProfile={person !== null && person.photoMediaId === photo.id}
      canEditPerson={detail.data?.permissions.edit === true}
      shows={photo.shows}
      onClose={onClose}
    />
  );
}

export function MediaPage() {
  const [filter, setFilter] = useState<Person | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const media = useInfiniteQuery({
    queryKey: [...peopleKey, 'media', filter?.id ?? 'all'],
    queryFn: ({ signal, pageParam }) => api.fetchMedia({ person: filter?.id ?? null, cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    placeholderData: keepPreviousData,
  });
  const items = media.data?.pages.flatMap((page) => page.items) ?? [];
  const current = items.find((item) => item.id === open) ?? null;
  return (
    <section className="card stack" aria-labelledby="media-title">
      <div>
        <h1 id="media-title">{t('media.title')}</h1>
        <p className="muted">{t('media.intro')}</p>
      </div>
      <PersonPicker label={t('media.filter')} value={filter} onChange={setFilter} />
      {media.isPending ? <Loading /> : null}
      {media.isError ? <ErrorState error={media.error} onRetry={() => void media.refetch()} /> : null}
      {media.isSuccess && items.length === 0 ? (
        <EmptyState>{filter ? t('media.emptyFilter', { name: displayName(filter) }) : t('media.empty')}</EmptyState>
      ) : null}
      {items.length > 0 ? (
        <ul className="photo-grid" aria-label={t('media.title')}>
          {items.map((item) => {
            const names = item.shows.map((p) => displayName(p)).join(', ');
            // Whose profile photo it is: known from the list itself, so the marker costs nothing.
            const profileOf = item.shows.filter((p) => p.photoMediaId === item.id).map((p) => displayName(p));
            const profile = profileOf.length > 0 ? t('media.tile.profile', { names: profileOf.join(', ') }) : '';
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="photo-tile"
                  aria-label={names ? t('media.tile', { names, profile }) : t('media.tile.nobody')}
                  onClick={() => setOpen(item.id)}
                >
                  <img src={photoUrl(item.id, 'avatar')} alt="" loading="lazy" decoding="async" />
                  {profile ? <ProfilePhotoMarker /> : null}
                </button>
                <PhotoActions mediaId={item.id} people={item.shows.map((p) => p.id)} />
              </li>
            );
          })}
        </ul>
      ) : null}
      {media.hasNextPage ? (
        <button
          className="button"
          type="button"
          disabled={media.isFetchingNextPage}
          onClick={() => void media.fetchNextPage()}
        >
          {media.isFetchingNextPage ? t('common.loading') : t('media.loadMore')}
        </button>
      ) : null}
      {current ? <Viewer photo={current} filter={filter} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}
