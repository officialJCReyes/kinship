// SPDX-License-Identifier: AGPL-3.0-or-later
import { INVITATION_NOTE_MAX, ROLES_INVITABLE_BY } from '@kinship/shared';
import type { AuthUser, InvitationInput, LinkCreated, MessageKey, Person, Role } from '@kinship/shared';
import { useState } from 'react';
import type { FormEvent } from 'react';
import * as api from '../api.js';
import { Dialog } from '../components/Dialog.js';
import { Field } from '../components/Field.js';
import { PersonPicker } from '../components/PersonPicker.js';
import { SelectField } from '../components/SelectField.js';
import { t } from '../i18n.js';
import { errorMessage } from '../lib/errors.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type InvitableRole = InvitationInput['role'];

/**
 * "Invite user": an email address, a role (only the ones this admin may invite), an optional person who has no account
 * yet, and an optional note. It makes a link to copy; nothing is sent. The response (with the one-time token) goes to the
 * parent through `onCreated` and is not kept here.
 */
export function InviteDialog({
  me,
  takenPersonIds,
  onCreated,
  onClose,
}: {
  me: AuthUser;
  /** People who already have an account or an open invitation: they cannot be chosen. */
  takenPersonIds: readonly string[];
  onCreated: (created: LinkCreated, email: string) => void;
  onClose: () => void;
}) {
  const roles = ROLES_INVITABLE_BY[me.role].filter((role): role is InvitableRole => role !== 'superadmin');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>(roles.includes('user') ? 'user' : (roles[0] ?? 'user'));
  const [person, setPerson] = useState<Person | null>(null);
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const address = email.trim();
  const emailProblem = !EMAIL.test(address);
  const noteProblem = Array.from(note).length > INVITATION_NOTE_MAX;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    setError(null);
    if (emailProblem || noteProblem) return;
    setBusy(true);
    try {
      const created = await api.createInvitation({
        email: address,
        role: role as InvitableRole,
        personId: person?.id ?? null,
        note: note.trim() === '' ? null : note.trim(),
      });
      onCreated(created, address.toLowerCase());
    } catch (failure) {
      setError(failure);
      setBusy(false);
    }
  };

  return (
    <Dialog title={t('invite.title')} onClose={onClose}>
      <form className="stack" onSubmit={(event) => void onSubmit(event)} noValidate>
        <p className="muted">{t('invite.intro')}</p>
        {error ? (
          <div className="alert" role="alert">
            {errorMessage(error)}
          </div>
        ) : null}
        <Field
          label={t('invite.email')}
          type="email"
          autoComplete="off"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={submitted && emailProblem ? t('invite.emailInvalid') : undefined}
        />
        <SelectField label={t('invite.role')} value={role} onChange={(event) => setRole(event.target.value as Role)}>
          {roles.map((value) => (
            <option key={value} value={value}>
              {t(`role.${value}` as MessageKey)}
            </option>
          ))}
        </SelectField>
        <PersonPicker label={t('invite.person')} value={person} onChange={setPerson} excludeIds={takenPersonIds} />
        <div className="muted field-help">{t('invite.personHelp')}</div>
        {role === 'member' && person === null ? (
          <div className="notice warning" role="note">
            {t('invite.memberWarning')}
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="invite-note">{t('invite.note')}</label>
          <textarea
            id="invite-note"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            aria-invalid={submitted && noteProblem ? true : undefined}
          />
          <div className="muted field-help">{t('invite.noteHelp', { max: INVITATION_NOTE_MAX })}</div>
        </div>
        <div className="actions">
          <button className="button" type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="button primary" type="submit" disabled={busy}>
            {busy ? t('invite.submitting') : t('invite.submit')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
