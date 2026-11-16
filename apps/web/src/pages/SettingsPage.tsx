// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  COLOR_SCHEMES,
  DATE_FORMATS,
  LINEAGE_VIEWS,
  SURNAME_CHOICES,
  THEMES,
  displayName as sharedDisplayName,
  formatPartialDate,
} from '@kinship/shared';
import type { AuthUser, MessageKey, UserSettings } from '@kinship/shared';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useSession } from '../auth.js';
import { SelectField } from '../components/SelectField.js';
import { Loading } from '../components/States.js';
import { t } from '../i18n.js';
import { errorMessage } from '../lib/errors.js';
import { displayName } from '../lib/names.js';
import { useUpdateSettings } from '../lib/settings.js';
import { usePersonDetail } from '../people/queries.js';

/** A fixed, fictional date for the live example: the day and the month differ, so every format reads differently. */
const EXAMPLE_DATE = { value: '2026-03-09', precision: 'exactly' } as const;
/** A fixed, fictional person for the surname example. */
const EXAMPLE_PERSON = { givenName: 'Rosa', surname: 'Mendez', secondSurname: null, marriedSurname: 'Mendez Hale' };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card settings-card">
      <h2>{title}</h2>
      {children}
    </section>
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
      </dl>
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
          <div className="swatches" role="radiogroup" aria-labelledby="scheme-label">
            {COLOR_SCHEMES.map((scheme) => (
              <button
                key={scheme}
                type="button"
                role="radio"
                aria-checked={user.colorScheme === scheme}
                className={`swatch swatch-${scheme}`}
                onClick={() => change({ colorScheme: scheme })}
              >
                <span className="swatch-chips" aria-hidden="true">
                  <span className="chip-accent" />
                  <span className="chip-tint" />
                </span>
                {t(`settings.scheme.${scheme}` as MessageKey)}
              </button>
            ))}
          </div>
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
          label={t('settings.surnameChoice')}
          value={user.surnameChoice}
          onChange={(event) => change({ surnameChoice: event.target.value as UserSettings['surnameChoice'] })}
          help={
            <>
              {t('settings.surnameExample', { name: sharedDisplayName(EXAMPLE_PERSON, user.surnameChoice) })}{' '}
              {t('settings.surnameHelp')}
            </>
          }
        >
          {SURNAME_CHOICES.map((choice) => (
            <option key={choice} value={choice}>
              {t(`settings.surname.${choice}` as MessageKey)}
            </option>
          ))}
        </SelectField>
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
