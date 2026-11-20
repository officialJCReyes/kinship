// SPDX-License-Identifier: AGPL-3.0-or-later
//
// An account's own display settings (My settings). They are saved on the account, apply to that account only, and
// change nothing about who can see what. One definition for the API, the web app and the first-run wizard.
import { DEFAULT_LINEAGE_VIEW, LINEAGE_VIEWS } from './people.js';
import type { LineageView } from './people.js';

/** The four color schemes (design/kinship-color-schemes.md). Forest is the logo kit's palette. */
export const COLOR_SCHEMES = ['forest', 'sand', 'slate', 'graphite'] as const;
export type ColorScheme = (typeof COLOR_SCHEMES)[number];

/** Light or dark: follow the device (the default), or always one of them. */
export const THEMES = ['device', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/**
 * How a date is shown (the mockup's codes). The stored text is always YYYY, YYYY-MM or YYYY-MM-DD.
 *   mdy   Jan 1, 2026        dmy   1 Jan, 2026       dmy2  1 Jan 2026      long  January 1, 2026
 *   iso   2026-01-01         us    01/01/2026 (month first)                eu    01/01/2026 (day first)
 */
export const DATE_FORMATS = ['mdy', 'dmy', 'dmy2', 'long', 'iso', 'us', 'eu'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

/**
 * How a married woman's name is shown (ADR 0024; replaces the two-way surname choice of ADR 0011). With Rosa Mendez, married
 * name Hale: `maiden_married` "Rosa Mendez (Hale)", `married_born` "Rosa Hale (born Mendez)", `married` "Rosa Hale",
 * `maiden` "Rosa Mendez". A person with no married surname shows the maiden name in every form.
 */
export const NAME_FORMS = ['maiden_married', 'married_born', 'married', 'maiden'] as const;
export type NameForm = (typeof NAME_FORMS)[number];

/** Everything an account chooses for itself. */
export interface UserSettings {
  /** Which family this account's charts follow for an adopted person. */
  lineageView: LineageView;
  colorScheme: ColorScheme;
  theme: Theme;
  dateFormat: DateFormat;
  nameForm: NameForm;
  /** Show a person's prefix (Dr., Sir) and suffix (Jr., II). */
  showPrefix: boolean;
  showSuffix: boolean;
}

export const DEFAULT_COLOR_SCHEME: ColorScheme = 'forest';
export const DEFAULT_THEME: Theme = 'device';
export const DEFAULT_DATE_FORMAT: DateFormat = 'mdy';
export const DEFAULT_NAME_FORM: NameForm = 'maiden_married';
export const DEFAULT_SHOW_PREFIX = true;
export const DEFAULT_SHOW_SUFFIX = true;

/** What a new account starts with (the same values as the column defaults in migrations 0006, 0010 and 0017). */
export const DEFAULT_USER_SETTINGS: UserSettings = {
  lineageView: DEFAULT_LINEAGE_VIEW,
  colorScheme: DEFAULT_COLOR_SCHEME,
  theme: DEFAULT_THEME,
  dateFormat: DEFAULT_DATE_FORMAT,
  nameForm: DEFAULT_NAME_FORM,
  showPrefix: DEFAULT_SHOW_PREFIX,
  showSuffix: DEFAULT_SHOW_SUFFIX,
};

/** The error code for each setting that was given a value that is not on its list. */
export const SETTING_ERROR_CODES = {
  lineageView: 'invalid_lineage',
  colorScheme: 'invalid_color_scheme',
  theme: 'invalid_theme',
  dateFormat: 'invalid_date_format',
  nameForm: 'invalid_name_form',
  showPrefix: 'invalid_show_prefix',
  showSuffix: 'invalid_show_suffix',
} as const;
export type SettingErrorCode = (typeof SETTING_ERROR_CODES)[keyof typeof SETTING_ERROR_CODES];

/** For each setting: the list of allowed strings, or `'boolean'`. */
const LISTS: { [K in keyof UserSettings]: readonly string[] | 'boolean' } = {
  lineageView: LINEAGE_VIEWS,
  colorScheme: COLOR_SCHEMES,
  theme: THEMES,
  dateFormat: DATE_FORMATS,
  nameForm: NAME_FORMS,
  showPrefix: 'boolean',
  showSuffix: 'boolean',
};

export type ParsedSettings =
  { ok: true; settings: Partial<UserSettings> } | { ok: false; code: SettingErrorCode | 'invalid_request' };

/**
 * Checks any subset of the settings. Unknown keys and an empty object are `invalid_request`; a value that is not
 * on its list is that setting's own error code. The API uses it for PATCH /api/auth/me and the first-run setup,
 * and the wizard can use it before it sends anything.
 */
export function parseUserSettings(input: unknown): ParsedSettings {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    return { ok: false, code: 'invalid_request' };
  const settings: Record<string, string | boolean> = {};
  const entries = Object.entries(input);
  if (entries.length === 0) return { ok: false, code: 'invalid_request' };
  for (const [key, value] of entries) {
    if (!(key in LISTS)) return { ok: false, code: 'invalid_request' };
    const name = key as keyof UserSettings;
    const allowed = LISTS[name];
    const valid =
      allowed === 'boolean' ? typeof value === 'boolean' : typeof value === 'string' && allowed.includes(value);
    if (!valid) return { ok: false, code: SETTING_ERROR_CODES[name] };
    settings[name] = value as string | boolean;
  }
  return { ok: true, settings: settings as Partial<UserSettings> };
}
