// SPDX-License-Identifier: AGPL-3.0-or-later
import { GENDERS, MIN_PASSWORD_LENGTH, NAME_MAX_LENGTH, SETUP_UNION_STATUSES } from '@kinship/shared';
import type { Gender, MessageKey, SetupStepId, SetupUnionStatus } from '@kinship/shared';
import type { ReactNode } from 'react';
import { ColorSchemePicker } from '../components/ColorSchemePicker.js';
import { DateInput } from '../components/DateInput.js';
import { Field } from '../components/Field.js';
import { SelectField } from '../components/SelectField.js';
import { t } from '../i18n.js';
import { formatDate } from '../lib/dates.js';
import {
  MAX_CHILDREN,
  childSurnameOf,
  duplicateNotes,
  fatherSurnameOf,
  parentAgeWarnings,
  parentEntered,
  partnerEntered,
  recordedStatus,
  requestIndexOfChild,
  reviewPeople,
  reviewRelationships,
  treeNameOf,
  warningTexts,
  youNamesOf,
} from '../lib/setup-wizard.js';
import type { ChildDraft, WizardState } from '../lib/setup-wizard.js';

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

const NOTE = (text: string) => (
  <p className="setup-note muted small" role="note">
    {text}
  </p>
);

function LivingSelect(props: {
  label: string;
  value: boolean;
  onChange: (deceased: boolean) => void;
  error?: string | undefined;
}) {
  return (
    <SelectField
      label={props.label}
      value={props.value ? 'deceased' : 'living'}
      onChange={(event) => props.onChange(event.target.value === 'deceased')}
      error={props.error}
    >
      <option value="living">{t('setup.living')}</option>
      <option value="deceased">{t('setup.deceasedOption')}</option>
    </SelectField>
  );
}

function StatusSelect(props: {
  label: string;
  value: SetupUnionStatus;
  onChange: (status: SetupUnionStatus) => void;
  help?: string;
  error?: string | undefined;
}) {
  return (
    <SelectField
      label={props.label}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value as SetupUnionStatus)}
      help={props.help}
      error={props.error}
    >
      {SETUP_UNION_STATUSES.map((status) => (
        <option key={status} value={status}>
          {t(`union.status.${status}` as MessageKey)}
        </option>
      ))}
    </SelectField>
  );
}

/** The note under a person who looks like one entered earlier. */
function duplicateNote(state: WizardState, key: string): ReactNode {
  const other = duplicateNotes(state).get(key);
  return other ? NOTE(t('setup.warn.duplicate', { other })) : null;
}

export function PartnerStep({ state, errors, set }: StepProps) {
  const p = state.partner;
  const change = (patch: Partial<typeof p>) => set('partner', { ...p, ...patch });
  const showsMarried = p.status === 'married' || p.status === 'widowed';
  // Widowed with someone living can never be saved: say so at once, as well as on Next.
  const widowedProblem =
    errors['family.partner.deceased'] ??
    (partnerEntered(state) && p.status === 'widowed' && !p.deceased
      ? t('setup.partner.widowedNeedsDeceased')
      : undefined);
  return (
    <>
      <h1 tabIndex={-1}>{t('setup.partner.title')}</h1>
      <p className="muted">{t('setup.partner.intro')}</p>
      <div className="setup-grid">
        <Field
          label={t('person.givenName')}
          name="partnerGivenName"
          autoComplete="off"
          maxLength={NAME_MAX_LENGTH}
          value={p.given}
          onChange={(event) => change({ given: event.target.value })}
          error={errors['family.partner.givenName']}
        />
        <Field
          label={t('setup.partner.surname')}
          name="partnerSurname"
          autoComplete="off"
          maxLength={NAME_MAX_LENGTH}
          value={p.surname}
          onChange={(event) => change({ surname: event.target.value })}
          error={errors['family.partner.surname']}
        />
      </div>
      <div className="setup-grid">
        <StatusSelect label={t('setup.partner.status')} value={p.status} onChange={(status) => change({ status })} />
        <LivingSelect
          label={t('setup.partner.livingStatus')}
          value={p.deceased}
          onChange={(deceased) => change({ deceased })}
          error={widowedProblem}
        />
      </div>
      <div className="setup-grid">
        <DateInput
          label={t('setup.partner.birth')}
          draft={p.birth}
          onChange={(birth) => change({ birth })}
          externalError={errors['family.partner.birth']}
        />
      </div>
      {showsMarried ? (
        <Field
          label={t('setup.partner.marriedSurname')}
          name="partnerMarriedSurname"
          autoComplete="off"
          maxLength={NAME_MAX_LENGTH}
          value={p.marriedSurname}
          onChange={(event) => change({ marriedSurname: event.target.value })}
          help={t('setup.partner.marriedSurnameHelp')}
          error={errors['family.partner.marriedSurname']}
        />
      ) : null}
      <GenderSelect
        value={p.gender}
        onChange={(gender) => change({ gender })}
        error={errors['family.partner.gender']}
      />
      {partnerEntered(state) && recordedStatus(p.status, p.deceased) !== p.status
        ? NOTE(t('setup.partner.autoWidowed'))
        : null}
      {duplicateNote(state, 'partner')}
    </>
  );
}

export function ParentsStep({ state, errors, set }: StepProps) {
  const { father, mother } = state;
  const both = parentEntered(father) && parentEntered(mother);
  const statusProblem =
    errors['family.parents.status'] ??
    (both && state.parentsStatus === 'widowed' && !father.deceased && !mother.deceased
      ? t('setup.parents.widowedNeedsDeceased')
      : undefined);
  return (
    <>
      <h1 tabIndex={-1}>{t('setup.parents.title')}</h1>
      <p className="muted">{t('setup.parents.intro')}</p>
      <fieldset className="choice">
        <legend>{t('setup.parents.father')}</legend>
        <div className="setup-grid">
          <Field
            label={t('person.givenName')}
            name="fatherGivenName"
            autoComplete="off"
            maxLength={NAME_MAX_LENGTH}
            value={father.given}
            onChange={(event) => set('father', { ...father, given: event.target.value })}
            error={errors['family.parents.father.givenName']}
          />
          <Field
            label={t('person.surname')}
            name="fatherSurname"
            autoComplete="off"
            maxLength={NAME_MAX_LENGTH}
            value={fatherSurnameOf(state)}
            onChange={(event) => set('father', { ...father, surname: event.target.value, surnameEdited: true })}
            error={errors['family.parents.father.surname']}
          />
        </div>
        <LivingSelect
          label={t('person.status')}
          value={father.deceased}
          onChange={(deceased) => set('father', { ...father, deceased })}
        />
        {duplicateNote(state, 'father')}
      </fieldset>
      <fieldset className="choice">
        <legend>{t('setup.parents.mother')}</legend>
        <div className="setup-grid">
          <Field
            label={t('person.givenName')}
            name="motherGivenName"
            autoComplete="off"
            maxLength={NAME_MAX_LENGTH}
            value={mother.given}
            onChange={(event) => set('mother', { ...mother, given: event.target.value })}
            error={errors['family.parents.mother.givenName']}
          />
          <Field
            label={t('person.birthSurname')}
            name="motherSurname"
            autoComplete="off"
            maxLength={NAME_MAX_LENGTH}
            value={mother.surname}
            onChange={(event) => set('mother', { ...mother, surname: event.target.value })}
            error={errors['family.parents.mother.surname']}
          />
        </div>
        <LivingSelect
          label={t('person.status')}
          value={mother.deceased}
          onChange={(deceased) => set('mother', { ...mother, deceased })}
        />
        {duplicateNote(state, 'mother')}
      </fieldset>
      {both ? (
        <StatusSelect
          label={t('setup.parents.status')}
          value={state.parentsStatus}
          onChange={(status) => set('parentsStatus', status)}
          help={t('setup.parents.statusHelp')}
          error={statusProblem}
        />
      ) : null}
    </>
  );
}

export function ChildrenStep({
  state,
  errors,
  set,
  onAdd,
  onRemove,
}: StepProps & { onAdd: () => void; onRemove: (key: number) => void }) {
  const hasPartner = partnerEntered(state);
  const partnerName = `${state.partner.given.trim()} ${state.partner.surname.trim()}`.trim();
  const warnings = parentAgeWarnings(state);
  const update = (child: ChildDraft, patch: Partial<ChildDraft>) =>
    set(
      'children',
      state.children.map((c) => (c.key === child.key ? { ...c, ...patch } : c)),
    );
  const full = state.children.length >= MAX_CHILDREN;
  return (
    <>
      <h1 tabIndex={-1}>{t('setup.children.title')}</h1>
      <p className="muted">
        {hasPartner ? t('setup.children.introPartner', { partner: partnerName }) : t('setup.children.introNone')}
      </p>
      {state.children.map((child, position) => {
        const index = requestIndexOfChild(state, child);
        const path = `family.children.${index ?? `row${child.key}`}`;
        const warning = warnings.find((w) => w.childKey === child.key);
        const number = position + 1;
        return (
          <fieldset
            className="child-row"
            key={child.key}
            data-child-key={child.key}
            aria-label={t('setup.children.row', { number })}
          >
            <legend>{t('setup.children.row', { number })}</legend>
            <div className="setup-grid">
              <Field
                label={t('person.givenName')}
                name={`childGivenName${child.key}`}
                autoComplete="off"
                maxLength={NAME_MAX_LENGTH}
                value={child.given}
                onChange={(event) => update(child, { given: event.target.value })}
                error={errors[`${path}.givenName`]}
              />
              <Field
                label={t('person.surname')}
                name={`childSurname${child.key}`}
                autoComplete="off"
                maxLength={NAME_MAX_LENGTH}
                value={childSurnameOf(state, child)}
                onChange={(event) => update(child, { surname: event.target.value, surnameEdited: true })}
                error={errors[`${path}.surname`]}
              />
            </div>
            <div className="setup-grid">
              <DateInput
                label={t('person.birth')}
                draft={child.birth}
                onChange={(birth) => update(child, { birth })}
                externalError={errors[`${path}.birth`]}
              />
              <GenderSelect
                value={child.gender}
                onChange={(gender) => update(child, { gender })}
                error={errors[`${path}.gender`]}
              />
            </div>
            {hasPartner ? (
              <SelectField
                label={t('setup.children.otherParent')}
                value={child.otherParent ?? 'partner'}
                onChange={(event) => update(child, { otherParent: event.target.value as 'partner' | 'none' })}
              >
                <option value="partner">{partnerName}</option>
                <option value="none">{t('setup.children.notOnTree')}</option>
              </SelectField>
            ) : null}
            {warning
              ? NOTE(
                  warning.kind === 'bornBefore'
                    ? t('setup.warn.bornBefore', { child: warning.child, parent: warning.parent })
                    : t('setup.warn.tooYoung', { parent: warning.parent, child: warning.child, years: warning.years }),
                )
              : null}
            {duplicateNote(state, `child:${child.key}`)}
            <button
              type="button"
              className="button small"
              aria-label={t('setup.children.remove', { number })}
              onClick={() => onRemove(child.key)}
            >
              {t('common.remove')}
            </button>
          </fieldset>
        );
      })}
      {full ? <p className="muted small">{t('setup.children.limit', { max: MAX_CHILDREN })}</p> : null}
      <button type="button" className="button small" id="add-child" disabled={full} onClick={onAdd}>
        {t('setup.children.add')}
      </button>
    </>
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

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();

function People({ items }: { items: ReturnType<typeof reviewPeople> }) {
  if (items.length === 0) return <p className="muted">{t('setup.review.none')}</p>;
  return (
    <ul className="chips">
      {items.map((person) => (
        <li key={person.key} className="chip">
          <span className="avatar" aria-hidden="true">
            {initials(person.name)}
          </span>
          <span>
            <strong>{person.name}</strong>, {person.relation}
            {person.deceased ? <span className="muted"> · {t('setup.review.deceased')}</span> : null}
            {person.birth ? <span className="muted"> · {t('setup.review.born', { date: person.birth })}</span> : null}
            {person.detail ? <span className="muted"> · {person.detail}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ReviewStep({ state, onChange }: { state: WizardState; onChange: (step: SetupStepId) => void }) {
  const birthText = (value: string, precision: string) =>
    formatDate({ value, precision: precision as 'exactly' | 'about' | 'before' | 'after' });
  const people = reviewPeople(state, birthText);
  const byKey = (keys: (key: string) => boolean) => people.filter((p) => keys(p.key));
  const relationships = reviewRelationships(state);
  const warnings = warningTexts(state);
  const count = people.length;
  const outcome = (r: (typeof relationships)[number]) =>
    t(r.automatic ? 'setup.review.recordedAsAuto' : 'setup.review.recordedAs', {
      names: r.names,
      status: t(`union.status.${r.status}` as MessageKey),
    });
  const partnerRel = relationships.filter((r) => r.kind === 'partner');
  const parentRel = relationships.filter((r) => r.kind === 'parents');
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
        <People items={byKey((k) => k === 'you')} />
      </ReviewSection>
      <ReviewSection id="partner" title={t('setup.review.partner')} step="partner" onChange={onChange}>
        <People items={byKey((k) => k === 'partner')} />
        {partnerRel.map((r) => (
          <p key={r.names} className="muted small">
            {outcome(r)}
          </p>
        ))}
      </ReviewSection>
      <ReviewSection id="parents" title={t('setup.review.parents')} step="parents" onChange={onChange}>
        <People items={byKey((k) => k === 'father' || k === 'mother')} />
        {parentRel.map((r) => (
          <p key={r.names} className="muted small">
            {outcome(r)}
          </p>
        ))}
      </ReviewSection>
      <ReviewSection id="children" title={t('setup.review.children')} step="children" onChange={onChange}>
        <People items={byKey((k) => k.startsWith('child:'))} />
      </ReviewSection>
      {warnings.length > 0 ? (
        <section className="review-warnings" aria-labelledby="review-warnings">
          <h2 id="review-warnings">{t('setup.review.warnings')}</h2>
          <ul>
            {warnings.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="review-count">
        <strong>{count === 1 ? t('setup.review.person') : t('setup.review.people', { count })}</strong>
      </p>
      <p className="muted small">{t('setup.review.next')}</p>
      <div className="callout setup-update-note">
        <strong>{t('setup.review.updateTitle')}</strong> {t('setup.review.updateNote')}
      </div>
    </>
  );
}
