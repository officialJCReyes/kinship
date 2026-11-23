// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The one way to set a person's profile photo from their avatar (step 41): the camera button in the avatar's corner opens a menu
// with "Upload a new photo" (the same upload as the Photos card, then made the profile photo) and "Choose from their photos" (a
// picker of the photos that already show this person). Used wherever a large avatar is shown for a person who can be edited: the
// profile header and the tree's person panel. The Photos card keeps its own Upload, and the viewer keeps "Set as profile photo".
import type { MediaListItem, Person } from '@kinship/shared';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import * as api from '../api.js';
import { ActionButton } from '../components/ActionButton.js';
import { Dialog } from '../components/Dialog.js';
import { PhotoButton } from '../components/PhotoButton.js';
import { RowMenu } from '../components/RowMenu.js';
import { Loading } from '../components/States.js';
import { t } from '../i18n.js';
import { displayName } from '../lib/names.js';
import { photoErrorMessage, photoUrl } from '../lib/photos.js';
import { useNotices } from '../notices.js';
import { PhotoError, TakenOnDialog, useFilePicker, usePhotoUpload } from './photos.js';
import { peopleKey, useRefreshPeople } from './queries.js';

/**
 * The photos that show one person, newest first, a page at a time (GET /api/media?person=). The same cache entry as the Media
 * page filtered on that person. Asked for only once `enabled` (the menu was opened), never up front.
 */
export function usePersonMedia(personId: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: [...peopleKey, 'media', personId],
    queryFn: ({ signal, pageParam }) => api.fetchMedia({ person: personId, cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    enabled,
  });
}

/**
 * The camera button and its menu. Shown only when `canEdit` (the person's own permissions.edit from the API: admins, and a Member
 * for their own person and the people in their line; never a User) and never on a placeholder. After a change every people query is
 * refreshed, so the avatar on the profile, the panel, the chart's card and the lists all show the new photo.
 */
export function ProfilePhotoControl({ person, canEdit }: { person: Person; canEdit: boolean }) {
  const [opened, setOpened] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const photos = usePersonMedia(person.id, opened || choosing);
  const upload = usePhotoUpload(person, { asProfile: true });
  const label = t(person.photoMediaId ? 'photo.avatar.change' : 'photo.avatar.add');
  const picker = useFilePicker(label, upload.pick);
  if (!canEdit || person.isPlaceholder) return null;

  const name = displayName(person);
  const count = photos.data?.pages[0]?.items.length ?? 0;
  const chooseReason = photos.isError
    ? photoErrorMessage(photos.error)
    : !photos.isSuccess
      ? t('photo.menu.chooseLoading')
      : count === 0
        ? t('photo.menu.chooseNone', { name })
        : undefined;

  return (
    <>
      <span className="avatar-corner">
        <RowMenu
          id={`photo-${person.id}`}
          label={label}
          disabled={upload.pending}
          onOpen={() => setOpened(true)}
          trigger={(props) => <PhotoButton {...props} />}
          items={[
            { key: 'upload', label: t('photo.menu.upload'), onSelect: picker.open },
            {
              key: 'choose',
              label: t('photo.menu.choose'),
              onSelect: () => setChoosing(true),
              disabledReason: chooseReason,
            },
          ]}
        />
        {picker.input}
      </span>
      <PhotoError message={upload.problem} />
      {upload.uploaded ? <TakenOnDialog uploaded={upload.uploaded} onClose={upload.clearUploaded} /> : null}
      {choosing ? <ChoosePhotoDialog person={person} photos={photos} onClose={() => setChoosing(false)} /> : null}
    </>
  );
}

/** A grid of the photos that show this person (their small variants); picking one makes it the profile photo. */
function ChoosePhotoDialog({
  person,
  photos,
  onClose,
}: {
  person: Person;
  photos: ReturnType<typeof usePersonMedia>;
  onClose: () => void;
}) {
  const refresh = useRefreshPeople();
  const { notify } = useNotices();
  const name = displayName(person);
  const choose = useMutation({
    mutationFn: (mediaId: string) => api.updatePerson(person.id, { photoMediaId: mediaId }),
  });
  const items: MediaListItem[] = photos.data?.pages.flatMap((page) => page.items) ?? [];
  const pick = (mediaId: string) => {
    if (mediaId === person.photoMediaId) {
      onClose();
      return;
    }
    choose.mutate(mediaId, {
      onSuccess: async () => {
        await refresh();
        notify('success', t('photo.notice.profileSet'));
        onClose();
      },
    });
  };
  return (
    <Dialog title={t('photo.choose.title', { name })} onClose={onClose}>
      <p className="muted">{t('photo.choose.help', { name })}</p>
      {photos.isPending ? <Loading /> : null}
      <PhotoError message={photos.isError ? photoErrorMessage(photos.error) : null} />
      {items.length > 0 ? (
        <ul className="photo-grid choose-grid" aria-label={t('photo.choose.title', { name })}>
          {items.map((item, index) => {
            const current = item.id === person.photoMediaId;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={`photo-tile${current ? ' is-profile' : ''}`}
                  aria-label={t(current ? 'photo.choose.current' : 'photo.choose.tile', { n: index + 1 })}
                  aria-current={current ? 'true' : undefined}
                  disabled={choose.isPending}
                  onClick={() => pick(item.id)}
                >
                  <img src={photoUrl(item.id, 'avatar')} alt="" loading="lazy" decoding="async" />
                  {current ? (
                    <span className="photo-badge" aria-hidden="true">
                      {t('photo.choose.currentMark')}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {photos.hasNextPage ? (
        <button
          className="button"
          type="button"
          disabled={photos.isFetchingNextPage}
          onClick={() => void photos.fetchNextPage()}
        >
          {photos.isFetchingNextPage ? t('common.loading') : t('media.loadMore')}
        </button>
      ) : null}
      <PhotoError message={choose.isError ? photoErrorMessage(choose.error) : null} />
      <div className="actions">
        <ActionButton onClick={onClose}>{t('common.cancel')}</ActionButton>
      </div>
    </Dialog>
  );
}
