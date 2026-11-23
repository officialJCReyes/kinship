// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A name prefix or suffix as a drop down (backlog 12): None, the shared list (packages/shared NAME_PREFIXES or
// NAME_SUFFIXES), and "Other…", which shows the 30-character text box. The value is plain text, as stored: a stored value that
// is not in the list opens as "Other…" with its text in the box, and saving never changes it unless the person edits it.
import { affixChoice, AFFIX_MAX_LENGTH } from '@kinship/shared';
import { useState } from 'react';
import { Field } from '../components/Field.js';
import { SelectField } from '../components/SelectField.js';
import { t } from '../i18n.js';

/** The select's value for "Other…". A stored value that happens to be this text still opens as "Other…" with it in the box. */
export const OTHER = '__other__';

interface AffixFieldProps {
  /** The select's label ("Prefix (optional)"). */
  label: string;
  /** The text box's label, shown under "Other…". */
  otherLabel: string;
  /** The select's name (`namePrefix`, `nameSuffix`); the text box is `<name>Other`. */
  name: string;
  list: readonly string[];
  value: string;
  onChange: (value: string) => void;
}

export function AffixField({ label, otherLabel, name, list, value, onChange }: AffixFieldProps) {
  // "Other…" stays chosen while its box is empty, so clearing the text does not jump back to None.
  const [other, setOther] = useState(() => affixChoice(value, list).kind === 'other');
  const choice = affixChoice(value, list);
  const selected = other ? OTHER : choice.kind === 'listed' ? choice.value : '';
  return (
    <div className="affix-field">
      <SelectField
        label={label}
        name={name}
        value={selected}
        onChange={(event) => {
          const next = event.target.value;
          if (next === OTHER) {
            setOther(true);
            // Keep what was there as a starting point for the text.
            return;
          }
          setOther(false);
          onChange(next);
        }}
      >
        <option value="">{t('person.affix.none')}</option>
        {list.map((entry) => (
          // Data, not interface text: a prefix or suffix is shown as written in every language, like a name.
          <option key={entry} value={entry}>
            {entry}
          </option>
        ))}
        <option value={OTHER}>{t('person.affix.other')}</option>
      </SelectField>
      {other ? (
        <Field
          label={otherLabel}
          name={`${name}Other`}
          autoComplete="off"
          maxLength={AFFIX_MAX_LENGTH}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : null}
    </div>
  );
}
