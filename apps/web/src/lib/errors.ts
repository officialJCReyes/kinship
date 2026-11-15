// SPDX-License-Identifier: AGPL-3.0-or-later
import { en } from '@kinship/shared';
import type { ApiWarning } from '@kinship/shared';
import type { MessageKey } from '@kinship/shared';
import { ApiError } from '../api.js';
import { t } from '../i18n.js';

/** The message for a failed API call: `error.<code>` when we have one, and friendly fallbacks otherwise. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return t('common.unexpectedError');
  if (error.status === 429 || error.code === 'rate_limited') {
    return t('error.rate_limited', { seconds: error.retryAfterSeconds ?? 60 });
  }
  if (error.status === undefined || error.status === 502 || error.status === 503 || error.status === 504) {
    return t('common.cannotReachApi');
  }
  const key = `error.${error.code ?? ''}`;
  return key in en ? t(key as MessageKey) : t('common.unexpectedError');
}

/** The text for warnings that came back with a successful save. They are shown and never block. */
export function warningTexts(warnings: readonly ApiWarning[] | undefined): string[] {
  return (warnings ?? []).map((warning) =>
    t(`warning.${warning.code}` as MessageKey, { years: warning.yearsDifference }),
  );
}
