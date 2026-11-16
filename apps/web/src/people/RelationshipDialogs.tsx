// SPDX-License-Identifier: AGPL-3.0-or-later
import { displayName } from '@kinship/shared';
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

import { useSession } from '../auth.js';
import { useNotices } from '../notices.js';
import { useRefreshPeople } from './queries.js';
import { asksMarriedSurname, checkUnionDraft, draftFromUnion, MarriedSurnames, UnionFields } from './UnionForm.js';
import { isAdmin } from './permissions.js';

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
  partners,
  onClose,
}: {
  union: UnionWithChildren;
  names: [string, string];
  /** The two people, so the married surname of each one the signed-in account may change can be edited here. */
  partners?: Array<Person | undefined>;
  onClose: () => void;
}) {
  const refresh = useRefreshPeople();
  const { notify } = useNotices();
  const me = useSession(false).data?.user;
  const [draft, setDraft] = useState(draftFromUnion(union));
  const [submitted, setSubmitted] = useState(false);
  // An admin may change either partner; anyone else only their own person (the API checks again).
  const editable = (partners ?? []).filter(
    (p): p is Person => p !== undefined && (isAdmin(me) || (me?.personId ?? null) === p.id),
  );
  const [married, setMarried] = useState<Record<string, string>>(() =>
    Object.fromEntries(editable.map((p) => [p.id, p.marriedSurname ?? ''])),
  );
  const save = useMutation({
    mutationFn: async (patch: Parameters<typeof api.updateUnion>[1]) => {
      const result = await api.updateUnion(union.id, patch);
      // Married surnames are person data: saved only while the status asks for them, and only when changed.
      if (asksMarriedSurname(patch.status ?? union.status)) {
        for (const p of editable) {
          const next = (married[p.id] ?? '').trim();
          if (next !== (p.marriedSurname ?? '')) await api.updatePerson(p.id, { marriedSurname: next || null });
        }
      }
      return result;
    },
  });
  const checked = checkUnionDraft(draft);
  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!checked.ok) return;
    const result = await save
      .mutateAsync({ status: draft.status, start: checked.start, end: checked.end })
      .catch(() => null);
    await refresh();
    if (!result) return;
    // The server stores Married as Widowed when a partner is deceased; say so when it did.
    if (result.union.status !== draft.status) notify('success', t('notice.unionSavedWidowed'));
    onClose();
  };
  return (
    <Dialog title={t('union.editTitle', { a: names[0], b: names[1] })} onClose={onClose}>
      <form onSubmit={(event) => void onSubmit(event)} noValidate>
        {union.statusAuto ? <p className="muted">{t('union.autoNote')}</p> : null}
        <UnionFields draft={draft} onChange={setDraft} showErrors={submitted} />
        <MarriedSurnames
          status={draft.status}
          partners={editable.map((p) => ({ id: p.id, name: displayName(p), value: married[p.id] ?? '' }))}
          onChange={(id, value) => setMarried({ ...married, [id]: value })}
        />
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
        notify('success', t('notice.deleted', { name: displayName(person) }));
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
    <Dialog title={t('delete.title', { name: displayName(person) })} onClose={onClose}>
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
