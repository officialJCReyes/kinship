// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Person } from '@kinship/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router';
import * as api from '../api.js';
import { ActionButton } from '../components/ActionButton.js';
import { Dialog } from '../components/Dialog.js';
import { t } from '../i18n.js';
import { errorMessage, warningTexts } from '../lib/errors.js';
import { personName } from '../lib/people.js';
import { useNotices } from '../notices.js';
import { checkPersonDraft, draftFromPerson, emptyPersonDraft, PersonFields } from './PersonForm.js';
import type { PersonDraft } from './PersonForm.js';
import { useRefreshPeople } from './queries.js';

function FormError({ error }: { error: unknown }) {
  return error ? (
    <div className="alert" role="alert">
      {errorMessage(error)}
    </div>
  ) : null;
}

interface PersonFormDialogProps {
  title: string;
  initial: PersonDraft;
  submitLabel: string;
  onClose: () => void;
  run: (draft: PersonDraft, input: NonNullable<ReturnType<typeof checkPersonDraft>['input']>) => Promise<void>;
  error: unknown;
  pending: boolean;
}

function PersonFormDialog({ title, initial, submitLabel, onClose, run, error, pending }: PersonFormDialogProps) {
  const [draft, setDraft] = useState(initial);
  const [submitted, setSubmitted] = useState(false);
  const { input, problems } = checkPersonDraft(draft);
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (input) void run(draft, input);
  };
  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate>
        <PersonFields draft={draft} onChange={setDraft} showErrors={submitted} problems={problems} />
        <FormError error={error} />
        <div className="actions">
          <ActionButton onClick={onClose}>{t('common.cancel')}</ActionButton>
          <button className="button primary" type="submit" disabled={pending}>
            {pending ? t('common.saving') : submitLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Edit details: name, gender, birth, living or deceased, death. */
export function EditPersonDialog({ person, onClose }: { person: Person; onClose: () => void }) {
  const refresh = useRefreshPeople();
  const { notify } = useNotices();
  const save = useMutation({
    mutationFn: (input: Parameters<typeof api.updatePerson>[1]) => api.updatePerson(person.id, input),
  });
  return (
    <PersonFormDialog
      title={t('edit.title', { name: personName(person) })}
      initial={draftFromPerson(person)}
      submitLabel={t('common.save')}
      onClose={onClose}
      error={save.error}
      pending={save.isPending}
      run={async (_draft, input) => {
        const result = await save.mutateAsync(input).catch(() => null);
        if (!result) return;
        await refresh();
        for (const text of warningTexts(result.warnings)) notify('warning', text);
        onClose();
      }}
    />
  );
}

/** Add person (admins): someone who is not yet connected to anyone. Opens their profile afterwards. */
export function AddPersonDialog({ onClose }: { onClose: () => void }) {
  const refresh = useRefreshPeople();
  const { notify } = useNotices();
  const navigate = useNavigate();
  const create = useMutation({ mutationFn: api.createPerson });
  return (
    <PersonFormDialog
      title={t('people.addTitle')}
      initial={emptyPersonDraft()}
      submitLabel={t('people.addSubmit')}
      onClose={onClose}
      error={create.error}
      pending={create.isPending}
      run={async (_draft, input) => {
        const result = await create.mutateAsync(input).catch(() => null);
        if (!result) return;
        await refresh();
        for (const text of warningTexts(result.warnings)) notify('warning', text);
        notify('success', t('notice.added', { name: personName(result.person) }));
        onClose();
        void navigate(`/people/${result.person.id}`);
      }}
    />
  );
}
