// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  MIN_PASSWORD_LENGTH,
  DATE_FORMATS,
  LINEAGE_VIEWS,
  NAME_FORMS,
  THEMES,
  displayName as sharedDisplayName,
  formatPartialDate,
} from '@kinship/shared';
import type { AuthUser, MessageKey, UserSettings } from '@kinship/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link } from 'react-router';
import * as api from '../api.js';
import { ApiError } from '../api.js';
import { meKey, useSession } from '../auth.js';
import { ColorSchemePicker } from '../components/ColorSchemePicker.js';
import { Field } from '../components/Field.js';
import { SelectField } from '../components/SelectField.js';
import { Loading } from '../components/States.js';
import { t } from '../i18n.js';
import { errorMessage } from '../lib/errors.js';
import { displayName } from '../lib/names.js';
import { passwordTrace } from '../lib/password-trace.js';
import { useUpdateSettings } from '../lib/settings.js';
import { usePersonDetail } from '../people/queries.js';

/** A fixed, fictional date for the live example: the day and the month differ, so every format reads differently. */
const EXAMPLE_DATE = { value: '2026-03-09', precision: 'exactly' } as const;
/** A fixed, fictional person for the name example (Rosa Mendez, married name Hale). */
const EXAMPLE_PERSON = {
  givenName: 'Rosa',
  surname: 'Mendez',
  secondSurname: null,
  marriedSurname: 'Mendez Hale',
  namePrefix: 'Dr.',
  nameSuffix: null,
};

/** A labelled on/off box. */
function NameSwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="option">
      <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <label htmlFor={id}>{label}</label>
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card settings-card">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/** Change your own password: the current one, the new one twice. The other devices are signed out; this one stays in. */
function PasswordForm() {
  const client = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [wrongCurrent, setWrongCurrent] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  const tooShort = next.length < MIN_PASSWORD_LENGTH;
  const mismatch = next !== again;
  const missingCurrent = current === '';

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    setSaved(false);
    setFailure(null);
    setWrongCurrent(false);
    if (missingCurrent || tooShort || mismatch) return;
    setBusy(true);
    try {
      await api.changePassword({ currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setAgain('');
      setSubmitted(false);
      setSaved(true);
      await client.invalidateQueries({ queryKey: meKey });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'invalid_current_password') setWrongCurrent(true);
      else setFailure(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="password-form"
      onSubmit={(event) => void onSubmit(event)}
      noValidate
      aria-labelledby="password-title"
    >
      <h3 id="password-title">{t('settings.password.title')}</h3>
      <Field
        label={t('settings.password.current')}
        type="password"
        name="current-password"
        autoComplete="current-password"
        value={current}
        onChange={(event) => setCurrent(event.target.value)}
        error={wrongCurrent ? t('error.invalid_current_password') : undefined}
      />
      <Field
        label={t('settings.password.new')}
        type="password"
        name="new-password"
        autoComplete="new-password"
        value={next}
        onChange={(event) => setNext(event.target.value)}
        help={t('settings.password.help', { min: MIN_PASSWORD_LENGTH })}
        error={submitted && tooShort ? t('settings.password.help', { min: MIN_PASSWORD_LENGTH }) : undefined}
      />
      <Field
        label={t('settings.password.confirm')}
        type="password"
        name="confirm-password"
        autoComplete="new-password"
        value={again}
        onChange={(event) => setAgain(event.target.value)}
        error={submitted && mismatch ? t('settings.password.mismatch') : undefined}
      />
      {failure ? (
        <div className="alert" role="alert">
          {errorMessage(failure)}
        </div>
      ) : null}
      <div role="status">{saved ? t('settings.password.saved') : ''}</div>
      <button className="button" type="submit" disabled={busy}>
        {busy ? t('settings.password.saving') : t('settings.password.submit')}
      </button>
    </form>
  );
}

function AccountCard({ user }: { user: AuthUser }) {
  const person = usePersonDetail(user.personId ?? undefined);
  return (
    <Section title={t('settings.account')}>
      <dl className="facts">
        <dt>{t('settings.account.name')}</dt>
        <dd>{user.displayName}</dd>
        <dt>{t('settings.account.email')}</dt>
        <dd>{user.email}</dd>
        <dt>{t('settings.account.person')}</dt>
        <dd>
          {user.personId ? (
            person.data ? (
              <Link to={`/people/${user.personId}`}>{displayName(person.data.person)}</Link>
            ) : (
              <span className="muted">…</span>
            )
          ) : (
            <span className="muted">{t('settings.account.notLinked')}</span>
          )}
        </dd>
        <dt>{t('settings.account.role')}</dt>
        <dd>{t(`role.${user.role}` as MessageKey)}</dd>
        <dt>{t('settings.account.signIn')}</dt>
        <dd>{t('settings.account.localPassword')}</dd>
        <dt>{t('settings.account.password')}</dt>
        <dd>{passwordTrace(user.passwordChangedAt, user.passwordChangedVia)}</dd>
      </dl>
      <PasswordForm />
    </Section>
  );
}

export function SettingsPage() {
  const session = useSession(false);
  const save = useUpdateSettings();
  const [saved, setSaved] = useState(false);
  const user = session.data?.user;
  if (!user) return <Loading />;

  const change = (patch: Partial<UserSettings>) => {
    setSaved(false);
    save.mutate(patch, { onSuccess: () => setSaved(true) });
  };

  return (
    <div className="stack settings-page">
      <div>
        <h1>{t('settings.title')}</h1>
        <p className="muted">{t('settings.intro')}</p>
      </div>
      <div className="sr-only" role="status">
        {save.isSuccess && saved ? t('settings.saved') : ''}
      </div>
      {save.isError ? (
        <div className="alert" role="alert">
          {t('settings.saveFailed')} {errorMessage(save.error)}
        </div>
      ) : null}

      <Section title={t('settings.display')}>
        <div className="field">
          <span className="label" id="scheme-label">
            {t('settings.colorScheme')}
          </span>
          <ColorSchemePicker
            value={user.colorScheme}
            onChange={(scheme) => change({ colorScheme: scheme })}
            labelledBy="scheme-label"
          />
          <div className="muted field-help">{t('settings.colorSchemeHelp')}</div>
        </div>
        <SelectField
          label={t('settings.theme')}
          value={user.theme}
          onChange={(event) => change({ theme: event.target.value as UserSettings['theme'] })}
        >
          {THEMES.map((theme) => (
            <option key={theme} value={theme}>
              {t(`settings.theme.${theme}` as MessageKey)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t('settings.dateFormat')}
          value={user.dateFormat}
          onChange={(event) => change({ dateFormat: event.target.value as UserSettings['dateFormat'] })}
          help={t('settings.dateExample', { date: formatPartialDate(EXAMPLE_DATE, user.dateFormat, t) })}
        >
          {DATE_FORMATS.map((format) => (
            <option key={format} value={format}>
              {t(`settings.dateFormat.${format}` as MessageKey)}
            </option>
          ))}
        </SelectField>
      </Section>

      <Section title={t('settings.names')}>
        <SelectField
          label={t('settings.nameForm')}
          value={user.nameForm}
          onChange={(event) => change({ nameForm: event.target.value as UserSettings['nameForm'] })}
          help={
            <>
              {t('settings.nameExample', { name: sharedDisplayName(EXAMPLE_PERSON, user) })}{' '}
              {t('settings.nameFormHelp')}
            </>
          }
        >
          {NAME_FORMS.map((form) => (
            <option key={form} value={form}>
              {t(`settings.nameForm.${form}` as MessageKey)}
            </option>
          ))}
        </SelectField>
        <NameSwitch
          label={t('settings.showPrefix')}
          checked={user.showPrefix}
          onChange={(value) => change({ showPrefix: value })}
        />
        <NameSwitch
          label={t('settings.showSuffix')}
          checked={user.showSuffix}
          onChange={(value) => change({ showSuffix: value })}
        />
        <div className="muted field-help">{t('settings.namesNote')}</div>
      </Section>

      <Section title={t('settings.family')}>
        <SelectField
          label={t('settings.lineage')}
          value={user.lineageView}
          onChange={(event) => change({ lineageView: event.target.value as UserSettings['lineageView'] })}
          help={t('settings.lineageHelp')}
        >
          {LINEAGE_VIEWS.map((view) => (
            <option key={view} value={view}>
              {t(`settings.lineage.${view}` as MessageKey)}
            </option>
          ))}
        </SelectField>
      </Section>

      <AccountCard user={user} />
    </div>
  );
}
