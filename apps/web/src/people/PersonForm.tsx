// SPDX-License-Identifier: AGPL-3.0-or-later
import { GENDERS, NAME_MAX_LENGTH } from '@kinship/shared';
import type { Gender, MessageKey, Person, PersonInput } from '@kinship/shared';
import { DateInput } from '../components/DateInput.js';
import { Field } from '../components/Field.js';
import { SelectField } from '../components/SelectField.js';
import { t } from '../i18n.js';
import { draftFromDate, draftToInput, emptyDateDraft } from '../lib/dates.js';
import type { DateDraft } from '../lib/dates.js';

/** What the person form holds while it is being filled in. */
export interface PersonDraft {
  givenName: string;
  surname: string;
  gender: Gender | '';
  birth: DateDraft;
  deceased: boolean;
  death: DateDraft;
}

export function emptyPersonDraft(gender: Gender | '' = ''): PersonDraft {
  return { givenName: '', surname: '', gender, birth: emptyDateDraft, deceased: false, death: emptyDateDraft };
}

export function draftFromPerson(person: Person): PersonDraft {
  return {
    givenName: person.givenName,
    surname: person.surname,
    gender: person.gender ?? '',
    birth: draftFromDate(person.birth),
    deceased: person.deceased,
    death: draftFromDate(person.death),
  };
}

export interface PersonProblems {
  givenName: boolean;
  surname: boolean;
  birth: boolean;
  death: boolean;
}

/** Checks the form in the browser for a quick answer (the API checks everything again). */
export function checkPersonDraft(draft: PersonDraft): { input: PersonInput | null; problems: PersonProblems } {
  const birth = draftToInput(draft.birth);
  const death = draft.deceased ? draftToInput(draft.death) : null;
  const problems: PersonProblems = {
    givenName: draft.givenName.trim() === '',
    surname: draft.surname.trim() === '',
    birth: birth === undefined,
    death: death === undefined,
  };
  if (problems.givenName || problems.surname || problems.birth || problems.death) return { input: null, problems };
  return {
    input: {
      givenName: draft.givenName.trim(),
      surname: draft.surname.trim(),
      gender: draft.gender === '' ? null : draft.gender,
      birth: birth ?? null,
      deceased: draft.deceased,
      death: death ?? null,
    },
    problems,
  };
}

interface PersonFieldsProps {
  draft: PersonDraft;
  onChange: (draft: PersonDraft) => void;
  /** Show the problems now (after a failed save), not just after leaving a field. */
  showErrors: boolean;
  problems: PersonProblems;
}

export function PersonFields({ draft, onChange, showErrors, problems }: PersonFieldsProps) {
  return (
    <>
      <div className="grid2">
        <Field
          label={t('person.givenName')}
          name="givenName"
          autoComplete="off"
          maxLength={NAME_MAX_LENGTH}
          value={draft.givenName}
          onChange={(event) => onChange({ ...draft, givenName: event.target.value })}
          error={showErrors && problems.givenName ? t('error.invalid_given_name') : undefined}
          required
        />
        <Field
          label={t('person.surname')}
          name="surname"
          autoComplete="off"
          maxLength={NAME_MAX_LENGTH}
          value={draft.surname}
          onChange={(event) => onChange({ ...draft, surname: event.target.value })}
          error={showErrors && problems.surname ? t('error.invalid_surname') : undefined}
          required
        />
      </div>
      <div className="grid2">
        <SelectField
          label={t('person.gender')}
          value={draft.gender}
          onChange={(event) => onChange({ ...draft, gender: event.target.value as Gender | '' })}
        >
          <option value="">{t('person.gender.unknown')}</option>
          {GENDERS.map((gender) => (
            <option key={gender} value={gender}>
              {t(`person.gender.${gender}` as MessageKey)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t('person.status')}
          value={draft.deceased ? 'deceased' : 'living'}
          onChange={(event) => onChange({ ...draft, deceased: event.target.value === 'deceased' })}
        >
          <option value="living">{t('person.living')}</option>
          <option value="deceased">{t('person.deceased')}</option>
        </SelectField>
      </div>
      <DateInput
        label={t('person.birth')}
        draft={draft.birth}
        onChange={(birth) => onChange({ ...draft, birth })}
        showError={showErrors}
      />
      {draft.deceased ? (
        <DateInput
          label={t('person.death')}
          draft={draft.death}
          onChange={(death) => onChange({ ...draft, death })}
          showError={showErrors}
        />
      ) : null}
    </>
  );
}
