// SPDX-License-Identifier: AGPL-3.0-or-later
import type { LinkKind, Person } from '@kinship/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { FormEvent } from 'react';
import * as api from '../api.js';
import { ActionButton } from '../components/ActionButton.js';
import { DateInput } from '../components/DateInput.js';
import { Dialog } from '../components/Dialog.js';
import { t } from '../i18n.js';
import { draftFromDate, draftToInput } from '../lib/dates.js';
import type { DateDraft } from '../lib/dates.js';
import { errorMessage } from '../lib/errors.js';
import { personName } from '../lib/people.js';
import { useNotices } from '../notices.js';
import { useRefreshPeople } from './queries.js';

/** Change or clear the date of one set of a person's parent links (for an adoption, its year). Admins only. */
export function EditLinkDialog({
  child,
  kind,
  parentNames,
  current,
  onClose,
}: {
  child: Person;
  kind: LinkKind;
  parentNames: string;
  current: Parameters<typeof draftFromDate>[0];
  onClose: () => void;
}) {
  const refresh = useRefreshPeople();
  const { notify } = useNotices();
  const [draft, setDraft] = useState<DateDraft>(draftFromDate(current));
  const [submitted, setSubmitted] = useState(false);
  const save = useMutation({
    mutationFn: (link: ReturnType<typeof draftToInput>) => api.updateParentLink(child.id, kind, { link: link ?? null }),
  });
  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    const link = draftToInput(draft);
    if (link === undefined) return;
    const result = await save.mutateAsync(link).catch(() => null);
    if (!result) return;
    await refresh();
    notify('success', t('link.saved'));
    onClose();
  };
  return (
    <Dialog
      title={t('link.editTitle', {
        kind: t(`link.kind.${kind}`).toLowerCase(),
        parent: parentNames,
        child: personName(child),
      })}
      onClose={onClose}
    >
      <form onSubmit={(event) => void onSubmit(event)} noValidate>
        <DateInput label={t(`link.date.${kind}`)} draft={draft} onChange={setDraft} showError={submitted} />
        {save.error ? (
          <div className="alert" role="alert">
            {errorMessage(save.error)}
          </div>
        ) : null}
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
