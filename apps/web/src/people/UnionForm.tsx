// SPDX-License-Identifier: AGPL-3.0-or-later
import { NAME_MAX_LENGTH, UNION_END_STATUSES, UNION_STATUSES } from '@kinship/shared';
import type { PartialDateInput, Union, UnionStatus } from '@kinship/shared';
import { DateInput } from '../components/DateInput.js';
import { Field } from '../components/Field.js';
import { SelectField } from '../components/SelectField.js';
import { t } from '../i18n.js';
import { draftFromDate, draftToInput, emptyDateDraft } from '../lib/dates.js';
import type { DateDraft } from '../lib/dates.js';
import { statusName } from '../lib/labels.js';

export interface UnionDraft {
  status: UnionStatus;
  start: DateDraft;
  end: DateDraft;
}

export function emptyUnionDraft(status: UnionStatus = 'married'): UnionDraft {
  return { status, start: emptyDateDraft, end: emptyDateDraft };
}

export function draftFromUnion(union: Union): UnionDraft {
  return { status: union.status, start: draftFromDate(union.start), end: draftFromDate(union.end) };
}

export function hasEndDate(status: UnionStatus): boolean {
  return (UNION_END_STATUSES as readonly string[]).includes(status);
}

/** `ok` is false when a date is not a date. The end date is sent only for the statuses that have one. */
export function checkUnionDraft(draft: UnionDraft): {
  ok: boolean;
  start: PartialDateInput | null;
  end: PartialDateInput | null;
} {
  const start = draftToInput(draft.start);
  const end = hasEndDate(draft.status) ? draftToInput(draft.end) : null;
  return { ok: start !== undefined && end !== undefined, start: start ?? null, end: end ?? null };
}

export function UnionFields({
  draft,
  onChange,
  showErrors,
}: {
  draft: UnionDraft;
  onChange: (draft: UnionDraft) => void;
  showErrors: boolean;
}) {
  return (
    <>
      <SelectField
        label={t('union.status')}
        value={draft.status}
        onChange={(event) => onChange({ ...draft, status: event.target.value as UnionStatus })}
      >
        {UNION_STATUSES.map((status) => (
          <option key={status} value={status}>
            {statusName(status)}
          </option>
        ))}
      </SelectField>
      <DateInput
        label={t('union.start')}
        draft={draft.start}
        onChange={(start) => onChange({ ...draft, start })}
        showError={showErrors}
      />
      {hasEndDate(draft.status) ? (
        <DateInput
          label={t(`union.end.${draft.status as 'divorced' | 'separated' | 'annulment'}`)}
          draft={draft.end}
          onChange={(end) => onChange({ ...draft, end })}
          showError={showErrors}
        />
      ) : null}
    </>
  );
}

/** A partner whose married surname the relationship form can change. */
export interface PartnerSurname {
  id: string;
  /** For the field label: the partner's name. */
  name: string;
  value: string;
}

/** True for the statuses where married surnames are asked for. */
export function asksMarriedSurname(status: UnionStatus): boolean {
  return status === 'married' || status === 'widowed';
}

/**
 * "Surnames at marriage": one married-surname field per partner the signed-in account may change. Shown
 * while the status is Married or Widowed; what was typed stays in the caller's state when it is hidden.
 */
export function MarriedSurnames({
  status,
  partners,
  onChange,
}: {
  status: UnionStatus;
  partners: PartnerSurname[];
  onChange: (id: string, value: string) => void;
}) {
  if (!asksMarriedSurname(status) || partners.length === 0) return null;
  return (
    <fieldset className="choice">
      <legend>{t('union.surnames.title')}</legend>
      {partners.map((partner) => (
        <Field
          key={partner.id}
          label={t('union.surnames.field', { name: partner.name })}
          name={`marriedSurname-${partner.id}`}
          autoComplete="off"
          maxLength={NAME_MAX_LENGTH}
          value={partner.value}
          onChange={(event) => onChange(partner.id, event.target.value)}
        />
      ))}
      <div className="muted field-help">{t('union.surnames.help')}</div>
    </fieldset>
  );
}
