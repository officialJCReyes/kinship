// SPDX-License-Identifier: AGPL-3.0-or-later
import { GENDERS, NAME_MAX_LENGTH, NAME_PREFIXES, NAME_SUFFIXES } from '@kinship/shared';
import type { Gender, MessageKey, Person, PersonInput } from '@kinship/shared';
import { DateInput } from '../components/DateInput.js';
import { Field } from '../components/Field.js';
import { SelectField } from '../components/SelectField.js';
import { t } from '../i18n.js';
import { AffixField } from './AffixField.js';
import { draftFromDate, draftToInput, emptyDateDraft } from '../lib/dates.js';
import type { DateDraft } from '../lib/dates.js';

/** What the person form holds while it is being filled in. */
export interface PersonDraft {
  namePrefix: string;
  givenName: string;
  nickname: string;
  surname: string;
  secondSurname: string;
  marriedSurname: string;
  nameSuffix: string;
  gender: Gender | '';
  birth: DateDraft;
  deceased: boolean;
  death: DateDraft;
}

export function emptyPersonDraft(gender: Gender | '' = ''): PersonDraft {
  return {
    namePrefix: '',
    givenName: '',
    nickname: '',
    surname: '',
    secondSurname: '',
    marriedSurname: '',
    nameSuffix: '',
    gender,
    birth: emptyDateDraft,
    deceased: false,
    death: emptyDateDraft,
  };
}

export function draftFromPerson(person: Person): PersonDraft {
  return {
    namePrefix: person.namePrefix ?? '',
    givenName: person.givenName,
    nickname: person.nickname ?? '',
    surname: person.surname,
    secondSurname: person.secondSurname ?? '',
    marriedSurname: person.marriedSurname ?? '',
    nameSuffix: person.nameSuffix ?? '',
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
      secondSurname: draft.secondSurname.trim() || null,
      marriedSurname: draft.marriedSurname.trim() || null,
      namePrefix: draft.namePrefix.trim() || null,
      nameSuffix: draft.nameSuffix.trim() || null,
      nickname: draft.nickname.trim() || null,
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
  /**
   * Show the married surname. Always on in Edit details and Add person; in the relationship forms the caller
   * turns it on while the status is Married or Widowed (what was typed stays in the draft when it is hidden).
   */
  showMarriedSurname?: boolean;
}

export function PersonFields({ draft, onChange, showErrors, problems, showMarriedSurname = false }: PersonFieldsProps) {
  // The same three name rows as the first-run wizard's row 1 (backlog 13): Given and Surname first, in look and in tab order,
  // with the cursor in Given when the form opens; then the other surnames; then prefix, suffix and nickname.
  return (
    <>
      <div className="grid2 name-row">
        <Field
          label={t('person.givenName')}
          name="givenName"
          autoComplete="off"
          maxLength={NAME_MAX_LENGTH}
          value={draft.givenName}
          onChange={(event) => onChange({ ...draft, givenName: event.target.value })}
          error={showErrors && problems.givenName ? t('error.invalid_given_name') : undefined}
          required
          markRequired
          data-autofocus
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
          markRequired
        />
      </div>
      <div className={showMarriedSurname ? 'grid2 name-row' : 'name-row'}>
        <Field
          label={t('person.secondSurname')}
          name="secondSurname"
          autoComplete="off"
          maxLength={NAME_MAX_LENGTH}
          help={t('person.secondSurnameHelp')}
          value={draft.secondSurname}
          onChange={(event) => onChange({ ...draft, secondSurname: event.target.value })}
        />
        {showMarriedSurname ? (
          <Field
            label={t('person.marriedSurname')}
            name="marriedSurname"
            autoComplete="off"
            maxLength={NAME_MAX_LENGTH}
            value={draft.marriedSurname}
            onChange={(event) => onChange({ ...draft, marriedSurname: event.target.value })}
          />
        ) : null}
      </div>
      <div className="grid3 name-row">
        <AffixField
          label={t('person.namePrefix')}
          otherLabel={t('person.namePrefixOther')}
          name="namePrefix"
          list={NAME_PREFIXES}
          value={draft.namePrefix}
          onChange={(namePrefix) => onChange({ ...draft, namePrefix })}
        />
        <AffixField
          label={t('person.nameSuffix')}
          otherLabel={t('person.nameSuffixOther')}
          name="nameSuffix"
          list={NAME_SUFFIXES}
          value={draft.nameSuffix}
          onChange={(nameSuffix) => onChange({ ...draft, nameSuffix })}
        />
        <Field
          label={t('person.nickname')}
          name="nickname"
          autoComplete="off"
          maxLength={NAME_MAX_LENGTH}
          placeholder={t('person.nicknamePlaceholder')}
          value={draft.nickname}
          onChange={(event) => onChange({ ...draft, nickname: event.target.value })}
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
