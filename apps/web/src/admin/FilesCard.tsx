// SPDX-License-Identifier: AGPL-3.0-or-later
import type { FilesStatus, MessageKey } from '@kinship/shared';
import { useQuery } from '@tanstack/react-query';
import * as api from '../api.js';
import { t } from '../i18n.js';

export const filesKey = ['admin', 'files'] as const;

/** Admin > Backups: can photos be stored, and which key is in use (its id, never the key). Shows nothing while it loads or fails. */
export function useFilesStatus(enabled: boolean) {
  return useQuery({ queryKey: filesKey, queryFn: ({ signal }) => api.fetchFilesStatus(signal), enabled });
}

export function FilesCard({ status }: { status: FilesStatus }) {
  const ok = status.state === 'ready';
  return (
    <section className="card stack" aria-labelledby="files-title">
      <h2 id="files-title">{t('files.title')}</h2>
      <p className={ok ? undefined : 'alert'} role={ok ? undefined : 'alert'}>
        {t(`files.state.${status.state}` as MessageKey)}
      </p>
      {status.keyId ? (
        <dl className="facts">
          <dt>{t('files.keyId')}</dt>
          <dd>
            <code>{status.keyId}</code>
          </dd>
        </dl>
      ) : null}
      <p className="muted small">{t('files.keyWarning')}</p>
    </section>
  );
}
