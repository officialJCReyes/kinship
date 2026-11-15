// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';

/** The version in apps/api/package.json, which /api/version must report. */
export const packageVersion: string = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
).version;
