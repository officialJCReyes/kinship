// SPDX-License-Identifier: AGPL-3.0-or-later
import { COLOR_SCHEMES } from '@kinship/shared';
import type { ColorScheme, MessageKey } from '@kinship/shared';
import { t } from '../i18n.js';

interface ColorSchemePickerProps {
  value: ColorScheme;
  onChange: (scheme: ColorScheme) => void;
  /** The id of the element that names the group (a label or heading). */
  labelledBy: string;
}

/** The four color scheme swatches (My settings and the first-run wizard). A radio group: one is checked. */
export function ColorSchemePicker({ value, onChange, labelledBy }: ColorSchemePickerProps) {
  return (
    <div className="swatches" role="radiogroup" aria-labelledby={labelledBy}>
      {COLOR_SCHEMES.map((scheme) => (
        <button
          key={scheme}
          type="button"
          role="radio"
          aria-checked={value === scheme}
          className={`swatch swatch-${scheme}`}
          onClick={() => onChange(scheme)}
        >
          <span className="swatch-chips" aria-hidden="true">
            <span className="chip-accent" />
            <span className="chip-tint" />
          </span>
          {t(`settings.scheme.${scheme}` as MessageKey)}
        </button>
      ))}
    </div>
  );
}
