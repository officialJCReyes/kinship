// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Person, UnionWithChildren } from '@kinship/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router';
import * as api from '../api.js';
import { ActionButton } from '../components/ActionButton.js';
import { Dialog } from '../components/Dialog.js';
import { t } from '../i18n.js';
import { errorMessage } from '../lib/errors.js';
import { personName } from '../lib/people.js';
import { useNotices } from '../notices.js';
import { useRefreshPeople } from './queries.js';
import { checkUnionDraft, draftFromUnion, UnionFields } from './UnionForm.js';

function FormError({ error }: { error: unknown }) {
  return error ? (
    <div className="alert" role="alert">
      {errorMessage(error)}
    </div>
  ) : null;
}

/** Add or edit a relationship: status, dates, and an end date only for divorce, separation or annulment. */
export function EditUnionDialog({
  union,
  names,
  onClose,
}: {
  union: UnionWithChildren;
  names: [string, string];
  onClose: () => void;
}) {
  const refresh = useRefreshPeople();
  const [draft, setDraft] = useState(draftFromUnion(union));
  const [submitted, setSubmitted] = useState(false);
  const save = useMutation({
    mutationFn: (patch: Parameters<typeof api.updateUnion>[1]) => api.updateUnion(union.id, patch),
  });
  const checked = checkUnionDraft(draft);
  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!checked.ok) return;
    const result = await save
      .mutateAsync({ status: draft.status, start: checked.start, end: checked.end })
      .catch(() => null);
    if (!result) return;
    await refresh();
    onClose();
  };
  return (
    <Dialog title={t('union.editTitle', { a: names[0], b: names[1] })} onClose={onClose}>
      <form onSubmit={(event) => void onSubmit(event)} noValidate>
        <UnionFields draft={draft} onChange={setDraft} showErrors={submitted} />
        <FormError error={save.error} />
        <div className="actions">
          <ActionButton onClick={onClose}>{t('common.cancel')}</ActionButton>
          <button className="button primary" type="submit" disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function DeleteUnionDialog({
  union,
  names,
  onClose,
}: {
  union: UnionWithChildren;
  names: [string, string];
  onClose: () => void;
}) {
  const refresh = useRefreshPeople();
  const { notify } = useNotices();
  const remove = useMutation({ mutationFn: () => api.deleteUnion(union.id) });
  return (
    <Dialog title={t('union.deleteTitle')} onClose={onClose}>
      <p>{t('union.deleteBody', { a: names[0], b: names[1] })}</p>
      <FormError error={remove.error} />
      <div className="actions">
        <ActionButton onClick={onClose}>{t('common.cancel')}</ActionButton>
        <ActionButton
          danger
          disabled={remove.isPending}
          onClick={() => {
            void remove
              .mutateAsync()
              .then(async () => {
                await refresh();
                notify('success', t('notice.relationshipDeleted'));
                onClose();
              })
              .catch(() => undefined);
          }}
        >
          {t('union.deleteSubmit')}
        </ActionButton>
      </div>
    </Dialog>
  );
}

/** Delete a person. A person with relationships or children is refused with 409; the counts are shown to confirm. */
export function DeletePersonDialog({ person, onClose }: { person: Person; onClose: () => void }) {
  const refresh = useRefreshPeople();
  const { notify } = useNotices();
  const navigate = useNavigate();
  const [counts, setCounts] = useState<{ unions: number; children: number } | null>(null);
  const remove = useMutation({ mutationFn: (confirm: boolean) => api.deletePerson(person.id, confirm) });

  const run = (confirm: boolean) => {
    remove.mutate(confirm, {
      onSuccess: async () => {
        await refresh();
        notify('success', t('notice.deleted', { name: personName(person) }));
        onClose();
        void navigate('/people');
      },
      onError: (error) => {
        if (error instanceof api.ApiError && error.status === 409 && error.code === 'confirm_required') {
          setCounts({ unions: Number(error.details.unions ?? 0), children: Number(error.details.children ?? 0) });
        }
      },
    });
  };
  const showError = remove.isError && !counts;

  return (
    <Dialog title={t('delete.title', { name: personName(person) })} onClose={onClose}>
      {counts ? (
        <>
          <p role="alert">{t('delete.confirmCounts', { unions: counts.unions, children: counts.children })}</p>
          <p className="muted">{t('delete.confirmExplain')}</p>
        </>
      ) : (
        <p>{t('delete.body')}</p>
      )}
      {showError ? <FormError error={remove.error} /> : null}
      <div className="actions">
        <ActionButton onClick={onClose}>{t('common.cancel')}</ActionButton>
        <ActionButton danger disabled={remove.isPending} onClick={() => run(counts !== null)}>
          {counts ? t('delete.submitAnyway') : t('delete.submit')}
        </ActionButton>
      </div>
    </Dialog>
  );
}
