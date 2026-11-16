// SPDX-License-Identifier: AGPL-3.0-or-later
import { LABEL_MAX_LENGTH } from '@kinship/shared';
import { displayName } from '../lib/names.js';
import type { Person, PersonLabel } from '@kinship/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { FormEvent } from 'react';
import * as api from '../api.js';
import { ActionButton } from '../components/ActionButton.js';
import { Dialog } from '../components/Dialog.js';
import { Field } from '../components/Field.js';
import { PersonPicker } from '../components/PersonPicker.js';
import { t } from '../i18n.js';
import { errorMessage } from '../lib/errors.js';
import { useNotices } from '../notices.js';
import { useRefreshPeople } from './queries.js';

function FormError({ error }: { error: unknown }) {
  return error ? (
    <div className="alert" role="alert">
      {errorMessage(error)}
    </div>
  ) : null;
}

/**
 * "Other relationship" (admins): a label like Godmother or Guardian between this person and someone else, with an
 * optional reverse label. Opened from the profile. With `existing`, changes the wording of that label (the two
 * people are fixed; remove it and add a new one to change them).
 */
export function LabelDialog({
  person,
  existing,
  onClose,
}: {
  person: Person;
  existing?: PersonLabel;
  onClose: () => void;
}) {
  const refresh = useRefreshPeople();
  const { notify } = useNotices();
  const [other, setOther] = useState<Person | null>(null);
  const [label, setLabel] = useState(existing?.label ?? '');
  const [reverse, setReverse] = useState(existing?.reverseLabel ?? '');
  const [submitted, setSubmitted] = useState(false);
  const save = useMutation({
    mutationFn: async () => {
      const reverseLabel = reverse.trim() === '' ? null : reverse.trim();
      if (existing) return api.updateLabel(existing.id, { label: label.trim(), reverseLabel });
      return api.createLabel({ fromId: person.id, toId: (other as Person).id, label: label.trim(), reverseLabel });
    },
  });

  // The stored meaning is "`to` is the label of `from`". Opened from the `to` side, the words are turned around.
  const names = existing
    ? existing.direction === 'from'
      ? { from: displayName(person), to: displayName(existing.other) }
      : { from: displayName(existing.other), to: displayName(person) }
    : { from: displayName(person), to: other ? displayName(other) : '' };
  const labelProblem = label.trim() === '' || Array.from(label.trim()).length > LABEL_MAX_LENGTH;
  const reverseProblem = Array.from(reverse.trim()).length > LABEL_MAX_LENGTH;
  const missingPerson = !existing && other === null;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (labelProblem || reverseProblem || missingPerson) return;
    const result = await save.mutateAsync().catch(() => null);
    if (!result) return;
    await refresh();
    if (!existing) notify('success', t('notice.labelAdded'));
    onClose();
  };

  return (
    <Dialog
      title={
        existing
          ? t('label.editTitle', { from: names.from, to: names.to })
          : t('label.addTitle', { name: displayName(person) })
      }
      onClose={onClose}
    >
      <form onSubmit={(event) => void onSubmit(event)} noValidate>
        {existing ? null : (
          <>
            <PersonPicker label={t('label.person')} value={other} onChange={setOther} excludeIds={[person.id]} />
            {submitted && missingPerson ? (
              <div className="field-error" role="alert">
                {t('label.pickRequired')}
              </div>
            ) : null}
          </>
        )}
        <Field
          label={existing ? t('label.labelForEdit', names) : t('label.labelFor', { name: displayName(person) })}
          name="label"
          autoComplete="off"
          maxLength={LABEL_MAX_LENGTH}
          placeholder={t('label.labelPlaceholder')}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          error={submitted && labelProblem ? t('label.labelRequired') : undefined}
          required
        />
        <Field
          label={existing ? t('label.reverseForEdit', names) : t('label.reverseFor', { name: displayName(person) })}
          name="reverseLabel"
          autoComplete="off"
          maxLength={LABEL_MAX_LENGTH}
          help={t('label.reverseHelp', { label: label.trim() || '…', name: names.from })}
          value={reverse}
          onChange={(event) => setReverse(event.target.value)}
          error={submitted && reverseProblem ? t('label.labelRequired') : undefined}
        />
        <FormError error={save.error} />
        <div className="actions">
          <ActionButton onClick={onClose}>{t('common.cancel')}</ActionButton>
          <button className="button primary" type="submit" disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('label.save')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function DeleteLabelDialog({
  person,
  entry,
  onClose,
}: {
  person: Person;
  entry: PersonLabel;
  onClose: () => void;
}) {
  const refresh = useRefreshPeople();
  const { notify } = useNotices();
  const remove = useMutation({ mutationFn: () => api.deleteLabel(entry.id) });
  const [from, to] =
    entry.direction === 'from'
      ? [displayName(person), displayName(entry.other)]
      : [displayName(entry.other), displayName(person)];
  return (
    <Dialog title={t('label.deleteTitle')} onClose={onClose}>
      <p>{t('label.deleteBody', { label: entry.label, from, to })}</p>
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
                notify('success', t('notice.labelDeleted'));
                onClose();
              })
              .catch(() => undefined);
          }}
        >
          {t('label.deleteSubmit')}
        </ActionButton>
      </div>
    </Dialog>
  );
}
