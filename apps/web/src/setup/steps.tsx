// SPDX-License-Identifier: AGPL-3.0-or-later
import { GENDERS, MIN_PASSWORD_LENGTH, NAME_MAX_LENGTH } from '@kinship/shared';
import type { Gender, MessageKey, SetupStepId } from '@kinship/shared';
import type { ReactNode } from 'react';
import { ColorSchemePicker } from '../components/ColorSchemePicker.js';
import { DateInput } from '../components/DateInput.js';
import { Field } from '../components/Field.js';
import { SelectField } from '../components/SelectField.js';
import { t } from '../i18n.js';
import { draftToInput, formatDate } from '../lib/dates.js';
import { displayName } from '../lib/names.js';
import { treeNameOf, youNamesOf } from '../lib/setup-wizard.js';
import type { WizardState } from '../lib/setup-wizard.js';

/** What every step is given: the state, the problems by request field, and the one way to change the state. */
export interface StepProps {
  state: WizardState;
  errors: Record<string, string>;
  set: <K extends keyof WizardState>(key: K, value: WizardState[K]) => void;
}

export function AccountStep({ state, errors, set }: StepProps) {
  return (
    <>
      <h1 tabIndex={-1}>{t('setup.title')}</h1>
      <p className="muted">{t('setup.intro')}</p>
      <Field
        label={t('setup.tokenLabel')}
        name="token"
        autoComplete="off"
        spellCheck={false}
        value={state.token}
        onChange={(event) => set('token', event.target.value)}
        help={t('setup.tokenHelp')}
        error={errors['token']}
        required
      />
      <Field
        label={t('setup.displayName')}
        name="displayName"
        autoComplete="name"
        value={state.displayName}
        onChange={(event) => set('displayName', event.target.value)}
        error={errors['displayName']}
        required
      />
      <Field
        label={t('setup.email')}
        type="email"
        name="email"
        autoComplete="username"
        value={state.email}
        onChange={(event) => set('email', event.target.value)}
        help={t('setup.emailHelp')}
        error={errors['email']}
        required
      />
      <Field
        label={t('setup.password')}
        type="password"
        name="password"
        autoComplete="new-password"
        value={state.password}
        onChange={(event) => set('password', event.target.value)}
        help={t('setup.passwordHelp', { min: MIN_PASSWORD_LENGTH })}
        error={errors['password']}
        required
      />
      <Field
        label={t('setup.confirmPassword')}
        type="password"
        name="confirmPassword"
        autoComplete="new-password"
        value={state.confirm}
        onChange={(event) => set('confirm', event.target.value)}
        error={errors['confirm']}
        required
      />
      <p className="muted small">{t('setup.neverAgain')}</p>
    </>
  );
}

export function TreeStep({ state, errors, set }: StepProps) {
  return (
    <>
      <h1 tabIndex={-1}>{t('setup.tree.title')}</h1>
      <Field
        label={t('setup.treeName')}
        name="treeName"
        value={treeNameOf(state)}
        onChange={(event) => set('treeName', event.target.value)}
        help={t('setup.treeNameHelp')}
        error={errors['treeName']}
        required
      />
      <div className="field">
        <h2 className="label" id="setup-colors">
          {t('setup.colors')}
        </h2>
        <ColorSchemePicker
          value={state.colorScheme}
          onChange={(scheme) => set('colorScheme', scheme)}
          labelledBy="setup-colors"
        />
        <div className="muted field-help">{t('setup.colorsHelp')}</div>
      </div>
    </>
  );
}

export function YouStep({ state, errors, set }: StepProps) {
  const you = youNamesOf(state);
  return (
    <>
      <h1 tabIndex={-1}>{t('setup.you.title')}</h1>
      <p className="muted">{t('setup.you.intro', { tree: treeNameOf(state) })}</p>
      <div className="setup-grid">
        <Field
          label={t('person.givenName')}
          name="givenName"
          autoComplete="given-name"
          maxLength={NAME_MAX_LENGTH}
          value={you.given}
          onChange={(event) => set('youGiven', event.target.value)}
          error={errors['family.you.givenName']}
          required
        />
        <Field
          label={t('person.surname')}
          name="surname"
          autoComplete="family-name"
          maxLength={NAME_MAX_LENGTH}
          value={you.surname}
          onChange={(event) => set('youSurname', event.target.value)}
          error={errors['family.you.surname']}
          required
        />
      </div>
      <div className="setup-grid">
        <DateInput
          label={t('person.birth')}
          draft={state.youBirth}
          onChange={(draft) => set('youBirth', draft)}
          externalError={errors['family.you.birth']}
        />
        <GenderSelect
          value={state.youGender}
          onChange={(value) => set('youGender', value)}
          error={errors['family.you.gender']}
        />
      </div>
    </>
  );
}

/** Gender is optional everywhere: nothing is preselected, and "Not specified" stores nothing. */
export function GenderSelect(props: {
  value: '' | Gender;
  onChange: (value: '' | Gender) => void;
  error?: string | undefined;
}) {
  return (
    <SelectField
      label={t('person.gender')}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value as '' | Gender)}
      error={props.error}
    >
      <option value="">{t('setup.you.genderNotSpecified')}</option>
      {GENDERS.map((gender) => (
        <option key={gender} value={gender}>
          {t(`person.gender.${gender}` as MessageKey)}
        </option>
      ))}
    </SelectField>
  );
}

/** One section of the review: a heading, what will be created, and a way back to change it. */
function ReviewSection(props: {
  id: string;
  title: string;
  step: SetupStepId;
  onChange: (step: SetupStepId) => void;
  children: ReactNode;
}) {
  return (
    <section className="review-section" aria-labelledby={`review-${props.id}`}>
      <div className="review-head">
        <h2 id={`review-${props.id}`}>{props.title}</h2>
        <button
          type="button"
          className="link-button"
          onClick={() => props.onChange(props.step)}
          aria-label={t('setup.review.change', { section: props.title })}
        >
          {t('setup.review.changeButton')}
        </button>
      </div>
      {props.children}
    </section>
  );
}

export function ReviewStep({ state, onChange }: { state: WizardState; onChange: (step: SetupStepId) => void }) {
  const you = youNamesOf(state);
  const birth = draftToInput(state.youBirth);
  const youName = displayName({ givenName: you.given.trim(), surname: you.surname.trim() }, 'birth');
  return (
    <>
      <h1 tabIndex={-1}>{t('setup.review.title')}</h1>
      <p className="muted">{t('setup.review.intro')}</p>
      <ReviewSection id="account" title={t('setup.review.account')} step="account" onChange={onChange}>
        <dl className="facts">
          <dt>{t('setup.displayName')}</dt>
          <dd>{state.displayName.trim()}</dd>
          <dt>{t('setup.email')}</dt>
          <dd>{state.email.trim()}</dd>
        </dl>
      </ReviewSection>
      <ReviewSection id="tree" title={t('setup.review.tree')} step="tree" onChange={onChange}>
        <dl className="facts">
          <dt>{t('setup.treeName')}</dt>
          <dd>{treeNameOf(state).trim()}</dd>
          <dt>{t('setup.review.colors')}</dt>
          <dd>{t(`settings.scheme.${state.colorScheme}` as MessageKey)}</dd>
        </dl>
      </ReviewSection>
      <ReviewSection id="you" title={t('setup.review.you')} step="you" onChange={onChange}>
        <ul className="review-people">
          <li>
            <strong>{youName}</strong>
            {birth ? <span className="muted"> · {t('setup.review.born', { date: formatDate(birth) })}</span> : null}
            {state.youGender ? (
              <span className="muted"> · {t(`person.gender.${state.youGender}` as MessageKey)}</span>
            ) : null}
          </li>
        </ul>
      </ReviewSection>
      <p className="review-count">
        <strong>{t('setup.review.person')}</strong>
      </p>
    </>
  );
}
