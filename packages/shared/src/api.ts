// SPDX-License-Identifier: AGPL-3.0-or-later
import { PEOPLE_ERROR_CODES } from './people.js';

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
}

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
  // People and relationships (see people.ts).
  ...PEOPLE_ERROR_CODES,
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** The only password rule. The API enforces it too (apps/api, MIN_PASSWORD_LENGTH). */
export const MIN_PASSWORD_LENGTH = 12;

/** Every state-changing request carries this header (CSRF protection). The API refuses requests without it. */
export const CSRF_HEADER = 'X-KinShip-Request';
export const CSRF_VALUE = '1';
