// SPDX-License-Identifier: AGPL-3.0-or-later

/** Response of GET /api/version. */
export interface ApiVersion {
  name: 'kinship-api';
  version: string;
  commit: string;
}

/** Response of GET /api/health (HTTP 200 when ok, 503 when unavailable). */
export interface ApiHealth {
  status: 'ok' | 'unavailable';
  database: 'ok' | 'unreachable';
}

export const SOURCE_URL = 'https://github.com/officialJCReyes/kinship';
export const LICENSE_ID = 'AGPL-3.0-or-later';
