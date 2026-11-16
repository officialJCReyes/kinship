// SPDX-License-Identifier: AGPL-3.0-or-later
import type { MessageKey, PasswordChangeCode } from '@kinship/shared';
import { t } from '../i18n.js';
import { formatMoment } from './timestamps.js';

/**
 * "Password last changed 14 Nov, using a link from an admin". The owner of an account sees this on their Account card and
 * admins see it on the Users page, so an admin-made reset is never invisible to the person it was made for. Accounts older
 * than the record say it was not recorded.
 */
export function passwordTrace(changedAt: string | null, via: PasswordChangeCode | null): string {
  if (!changedAt || !via) return t('password.unknown');
  return t('password.changed', { date: formatMoment(changedAt), how: t(`password.how.${via}` as MessageKey) });
}
