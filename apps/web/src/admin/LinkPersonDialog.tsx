// SPDX-License-Identifier: AGPL-3.0-or-later
import type { AccountSummary, Person } from '@kinship/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import * as api from '../api.js';
import { Dialog } from '../components/Dialog.js';
import { PersonPicker } from '../components/PersonPicker.js';
import { t } from '../i18n.js';
import { errorMessage } from '../lib/errors.js';
import { displayName } from '../lib/names.js';

/**
 * Link an account to a person, or change the link (Admin → Users, ADR 0020). Choose a person, read what that changes
 * (advice from the server, in a polite live region), then confirm. Nothing is saved before the confirm button; the
 * server checks every rule again and a refusal shows here as an alert.
 */
export function LinkPersonDialog({
  account,
  takenPersonIds,
  onDone,
  onClose,
}: {
  account: AccountSummary;
  /** People who already have an account or an open invitation: they cannot be chosen. */
  takenPersonIds: readonly string[];
  /** Called after the link was saved, with the person's name. */
  onDone: (personName: string) => void;
  onClose: () => void;
}) {
  const name = account.displayName ?? account.email;
  const changing = account.person !== null;
  const [person, setPerson] = useState<Person | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const preview = useQuery({
    queryKey: ['admin', 'link-preview', account.id, person?.id ?? null],
    queryFn: ({ signal }) => api.fetchLinkPreview(account.id, person?.id ?? '', signal),
    enabled: person !== null,
    retry: false,
    gcTime: 0,
  });

  const save = async () => {
    if (!person) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api.linkAccountPerson(account.id, {
        personId: person.id,
        currentPersonId: account.person?.id ?? null,
      });
      onDone(saved.person.name);
    } catch (failure) {
      setError(failure);
      setBusy(false);
    }
  };

  const advice = preview.data;
  const who = person ? displayName(person) : '';
  return (
    <Dialog title={t(changing ? 'users.link.titleChange' : 'users.link.title', { name })} onClose={onClose}>
      <div className="stack">
        <p className="muted">{t('users.link.intro')}</p>
        {error ? (
          <div className="alert" role="alert">
            {errorMessage(error)}
          </div>
        ) : null}
        <PersonPicker
          label={t('users.link.person')}
          value={person}
          onChange={(next) => {
            setPerson(next);
            setError(null);
          }}
          excludeIds={takenPersonIds}
        />
        <div aria-live="polite" className="stack">
          {person && preview.isFetching ? <div className="muted">{t('users.link.checking')}</div> : null}
          {person && preview.isError ? (
            <div className="alert" role="alert">
              {errorMessage(preview.error)}
            </div>
          ) : null}
          {advice && !preview.isFetching ? (
            advice.role === 'member' ? (
              <div className="notice" role="note">
                <p>{t('users.link.preview.member', { account: name, person: who })}</p>
                {advice.createdByAccountInLine > 0 ? (
                  <p>
                    {t('users.link.preview.created', {
                      count: advice.createdByAccountInLine,
                      account: name,
                      person: who,
                    })}
                  </p>
                ) : null}
                {advice.losesEdit > 0 ? (
                  <p>{t('users.link.preview.loses', { count: advice.losesEdit, account: name })}</p>
                ) : null}
              </div>
            ) : (
              <div className="notice" role="note">
                {t('users.link.preview.other', { account: name })}
              </div>
            )
          ) : null}
        </div>
        <div className="actions">
          <button className="button" type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="button primary"
            type="button"
            disabled={busy || person === null || preview.isFetching || preview.isError}
            onClick={() => void save()}
          >
            {t(changing ? 'users.link.confirmChange' : 'users.link.confirm')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
