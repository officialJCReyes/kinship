// SPDX-License-Identifier: AGPL-3.0-or-later

/** Response of GET /api/version. `schema` is the database schema number, or null when the database is unreachable. */
export interface ApiVersion {
  name: 'kinship-api';
  version: string;
  commit: string;
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
}

/** Error bodies the API sends, as `{ error: <code> }` (and `retryAfterSeconds` or `minLength` where noted). */
export type ApiErrorCode =
  | 'invalid_credentials'
  | 'rate_limited'
  | 'unauthenticated'
  | 'already_set_up'
  | 'invalid_setup_token'
  | 'invalid_email'
  | 'invalid_display_name'
  | 'invalid_tree_name'
  | 'password_too_short'
  | 'invalid_request'
  | 'csrf'
  | 'internal_error';

/** The only password rule. The API enforces it too (apps/api, MIN_PASSWORD_LENGTH). */
export const MIN_PASSWORD_LENGTH = 12;

/** Every state-changing request carries this header (CSRF protection). The API refuses requests without it. */
export const CSRF_HEADER = 'X-KinShip-Request';
export const CSRF_VALUE = '1';
