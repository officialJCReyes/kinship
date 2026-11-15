// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ReactNode } from 'react';
import { t } from '../i18n.js';
import { errorMessage } from '../lib/errors.js';

export function Loading() {
  return (
    <p className="muted" role="status">
      {t('common.loading')}
    </p>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="muted empty">{children}</p>;
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="alert" role="alert">
      {errorMessage(error)}{' '}
      {onRetry ? (
        <button className="button small" type="button" onClick={onRetry}>
          {t('common.retry')}
        </button>
      ) : null}
    </div>
  );
}
