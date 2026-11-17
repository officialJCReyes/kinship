// SPDX-License-Identifier: AGPL-3.0-or-later
import { ACCOUNT_ERROR_CODES } from './accounts.js';
import type { PasswordChangeCode } from './accounts.js';
import { BACKUP_ERROR_CODES } from './backup.js';
import { PEOPLE_ERROR_CODES } from './people.js';
import { SETUP_ERROR_CODES } from './setup.js';
import { UPDATE_ERROR_CODES } from './updates.js';
import type { SetupFamily } from './setup.js';
import type { ColorScheme, DateFormat, SurnameChoice, Theme, UserSettings } from './settings.js';
import type { LineageView } from './people.js';

/** Response of GET /api/version. `schema` is the database schema number, or null when the database is unreachable. */
export interface ApiVersion {
  name: 'kinship-api';
  version: string;
  commit: string;
  /** When the image was built (ISO 8601), or "unknown". */
  buildDate: string;
  schema: number | null;
}

/** Response of GET /api/health (HTTP 200 when ok, 503 when unavailable). */
export interface ApiHealth {
  status: 'ok' | 'unavailable';
  database: 'ok' | 'unreachable';
}

export const SOURCE_URL = 'https://github.com/officialJCReyes/kinship';
export const LICENSE_ID = 'AGPL-3.0-or-later';

/** The four fixed roles (their display names can change later; these codes cannot). */
export type Role = 'superadmin' | 'familyadmin' | 'member' | 'user';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  /** The person this account is linked to, or null. Members change only their own person and add children under it. */
  personId: string | null;
  /** Which family this account's charts follow for an adopted person (the account's own setting). */
  lineageView: LineageView;
  /** The account's own display settings (My settings). They change nothing for anyone else. */
  colorScheme: ColorScheme;
  theme: Theme;
  dateFormat: DateFormat;
  surnameChoice: SurnameChoice;
  /** When and how the password last changed (ISO time and a code), or null when it was set before KinShip recorded it. */
  passwordChangedAt: string | null;
  passwordChangedVia: PasswordChangeCode | null;
}

/** Body of PATCH /api/auth/me: any non-empty subset of the account's own settings. */
export type UpdateMeRequest = Partial<UserSettings>;

/** Response of GET /api/auth/me, POST /api/auth/login and POST /api/setup. */
export interface MeResponse {
  user: AuthUser;
  treeName: string | null;
}

export interface SetupStatus {
  needsSetup: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface SetupRequest {
  token: string;
  displayName: string;
  email: string;
  password: string;
  treeName: string;
  /** The first person on the tree, linked to the new account. Both names, or neither. */
  person?: { givenName: string; surname: string };
  /**
   * The first-run wizard's family: you, a partner, parents and children, created with the account in one transaction
   * (ADR 0013). Not allowed together with `person`. An error names the field: `{ error, field: 'family.children.1.birth' }`.
   */
  family?: SetupFamily;
  /** The new account's own display settings, for example the color scheme picked in the wizard. Same rules as PATCH /api/auth/me. */
  settings?: Partial<UserSettings>;
}

/** Every error code the API can answer with, as `{ error: <code> }` (and `retryAfterSeconds`, `minLength` or `details` where noted). */
export const API_ERROR_CODES = [
  // Sign-in, setup and requests in general.
  'invalid_credentials',
  'rate_limited',
  'unauthenticated',
  'already_set_up',
  'invalid_setup_token',
  'invalid_email',
  'invalid_display_name',
  'invalid_tree_name',
  'password_too_short',
  'invalid_request',
  'payload_too_large',
  'csrf',
  'internal_error',
  // An account's own settings (see settings.ts). invalid_lineage is listed with the people codes.
  'invalid_color_scheme',
  'invalid_theme',
  'invalid_date_format',
  'invalid_surname_choice',
  // Invitations, set-password links and passwords (see accounts.ts).
  ...ACCOUNT_ERROR_CODES,
  // People and relationships (see people.ts).
  ...PEOPLE_ERROR_CODES,
  // The first-run wizard (see setup.ts).
  ...SETUP_ERROR_CODES,
  // Built-in backups (see backup.ts).
  ...BACKUP_ERROR_CODES,
  // The update check and What's new (see updates.ts).
  ...UPDATE_ERROR_CODES,
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** The only password rule. The API enforces it too (apps/api, MIN_PASSWORD_LENGTH). */
export const MIN_PASSWORD_LENGTH = 12;

/** Every state-changing request carries this header (CSRF protection). The API refuses requests without it. */
export const CSRF_HEADER = 'X-KinShip-Request';
export const CSRF_VALUE = '1';
