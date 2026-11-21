// SPDX-License-Identifier: AGPL-3.0-or-later
import type { AccountSummary } from '@kinship/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import * as api from '../api.js';
import { Dialog } from '../components/Dialog.js';
import { Field } from '../components/Field.js';
import { t } from '../i18n.js';
import { errorMessage } from '../lib/errors.js';

/**
 * Delete a disabled account (Admin → Users, ADR 0029). It says what stays (the person and everything on the tree), shows how
 * many people the account added (advice from the server), and asks for the account's email to be typed. The button stays off
 * until it matches (trimmed, ignoring case); the server checks it again.
 */
export function DeleteAccountDialog({
  account,
  onDone,
  onClose,
}: {
  account: AccountSummary;
  onDone: () => void;
  onClose: () => void;
}) {
  const name = account.displayName ?? account.email;
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const preview = useQuery({
    queryKey: ['admin', 'delete-preview', account.id],
    queryFn: ({ signal }) => api.fetchDeletePreview(account.id, signal),
    retry: false,
    gcTime: 0,
  });
  const matches = typed.trim().toLowerCase() === account.email.toLowerCase();

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount(account.id, { confirmEmail: typed.trim() });
      onDone();
    } catch (failure) {
      setError(failure);
      setBusy(false);
    }
  };

  return (
    <Dialog title={t('users.delete.title', { name })} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (matches && !busy) void remove();
        }}
      >
        {error ? (
          <div className="alert" role="alert">
            {errorMessage(error)}
          </div>
        ) : null}
        <p>{t('users.delete.body', { email: account.email })}</p>
        <div aria-live="polite">
          {preview.data && preview.data.peopleAdded > 0 ? (
            <div className="notice warning" role="note">
              {t('users.delete.created', { count: preview.data.peopleAdded })}
            </div>
          ) : null}
        </div>
        <Field
          label={t('users.delete.typeLabel', { email: account.email })}
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
        <div className="actions">
          <button className="button" type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="button danger" type="submit" disabled={!matches || busy}>
            {t('users.delete.confirm')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
