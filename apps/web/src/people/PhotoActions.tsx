// SPDX-License-Identifier: AGPL-3.0-or-later
//
// "Photo actions" on a thumbnail (step 41): set the photo as someone's profile photo straight from a grid (the Media page and a
// profile's Photos card), without opening the viewer. The viewer keeps its own "Set as profile photo". Same request as the viewer
// (PATCH /api/people/:id {photoMediaId}) and the same permission: the person's own permissions.edit from the API.
import type { PersonDetail } from '@kinship/shared';
import { useMutation, useQueries } from '@tanstack/react-query';
import { useState } from 'react';
import * as api from '../api.js';
import { useSession } from '../auth.js';
import { PhotoActionsButton } from '../components/PhotoButton.js';
import { RowMenu } from '../components/RowMenu.js';
import type { RowMenuItem } from '../components/RowMenu.js';
import { t } from '../i18n.js';
import { displayName } from '../lib/names.js';
import { photoErrorMessage } from '../lib/photos.js';
import { useNotices } from '../notices.js';
import { isAdmin } from './permissions.js';
import { peopleKey, useRefreshPeople } from './queries.js';

/**
 * The overlay button and its menu for one photo. `people` are the ids it shows. `known` says, for people whose permission the
 * page already has (the profile's own person), whether this account may edit them, so that nothing is asked for them.
 *
 * Who may edit whom is decided by the API, never guessed here: when the menu opens, each person's detail (the same query the
 * profile and the viewer use, so mostly already cached) is asked for, and only the people whose permissions.edit is true get an
 * item. Nothing is asked before the menu opens, so a grid makes no request per thumbnail. No button at all for a User (who may
 * never edit), and none when every person's permission is already known to be no.
 */
export function PhotoActions({
  mediaId,
  people,
  known = {},
}: {
  mediaId: string;
  people: string[];
  known?: Record<string, boolean>;
}) {
  const me = useSession(false).data?.user;
  const [opened, setOpened] = useState(false);
  const details = useQueries({
    queries: people.map((id) => ({
      queryKey: [...peopleKey, 'detail', id],
      queryFn: ({ signal }: { signal: AbortSignal }) => api.fetchPerson(id, signal),
      enabled: opened,
      retry: false,
    })),
  });
  const refresh = useRefreshPeople();
  const { notify } = useNotices();
  const set = useMutation({
    mutationFn: (personId: string) => api.updatePerson(personId, { photoMediaId: mediaId }),
  });

  if (!me || me.role === 'user' || people.length === 0) return null;
  if (!isAdmin(me) && people.every((id) => known[id] === false)) return null;

  const loaded = details.map((query) => query.data).filter((detail): detail is PersonDetail => detail !== undefined);
  const checking = details.some((query) => query.isPending);
  const editable = loaded.filter((detail) => detail.permissions.edit);
  const one = people.length === 1;

  const choose = (detail: PersonDetail) => {
    const name = displayName(detail.person);
    set.mutate(detail.person.id, {
      onSuccess: async () => {
        await refresh();
        notify('success', t('photo.notice.profileSetFor', { name }));
      },
      onError: (error) => notify('warning', photoErrorMessage(error)),
    });
  };

  // Items are keyed by position: when the check ends, the first item stays the same element and keeps the keyboard focus.
  const items: RowMenuItem[] = checking
    ? [
        {
          key: 'item-0',
          label: t('photo.setProfile'),
          onSelect: () => undefined,
          disabledReason: t('photo.actions.checking'),
        },
      ]
    : editable.length === 0
      ? [
          {
            key: 'item-0',
            label: t('photo.setProfile'),
            onSelect: () => undefined,
            disabledReason: t('photo.actions.nobody'),
          },
        ]
      : editable.map((detail, index) => ({
          key: `item-${index}`,
          label: one ? t('photo.setProfile') : t('photo.actions.setProfileFor', { name: displayName(detail.person) }),
          onSelect: () => choose(detail),
          disabledReason: detail.person.photoMediaId === mediaId ? t('photo.actions.already') : undefined,
        }));

  return (
    <span className="photo-actions">
      <RowMenu
        id={`photo-actions-${mediaId}`}
        label={t('photo.actions')}
        disabled={set.isPending}
        onOpen={() => setOpened(true)}
        trigger={(props) => <PhotoActionsButton {...props} />}
        items={items}
      />
    </span>
  );
}
