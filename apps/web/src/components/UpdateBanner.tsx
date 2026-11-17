// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The update notice across the top of every Admin page, for the SuperAdmin only. In step 17 it is the only place the notice
// appears (the bell comes in 0.4). Dismiss hides it for that version; a newer version shows it again.
import { bannerLine, bannerVisible } from '@kinship/shared';
import type { MessageKey } from '@kinship/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import * as api from '../api.js';
import { updatesKey, useUpdates } from '../admin/updates.js';
import { t } from '../i18n.js';
import { UpdateDialog } from './UpdateDialog.js';

export function UpdateBanner() {
  const client = useQueryClient();
  const updates = useUpdates(true);
  const [open, setOpen] = useState(false);
  const dismiss = useMutation({
    mutationFn: (version: string) => api.dismissUpdate({ version }),
    onSuccess: () => client.invalidateQueries({ queryKey: updatesKey }),
  });
  const data = updates.data;
  const range = data?.range ?? null;
  if (!data || !range) return null;
  const line = bannerLine(range);
  const shown = bannerVisible(range, data.dismissedVersion);
  const warn = line !== 'none';
  return (
    <>
      {shown ? (
        <div
          className={`callout update-banner${warn ? ' warn' : ''}`}
          role="region"
          aria-label={t('updates.banner.region')}
        >
          <div className="row between">
            <div>
              <strong>{t('updates.banner.title', { version: range.to, current: range.from })}</strong>{' '}
              {range.security ? <span className="pill crit">{t('updates.security')}</span> : null}{' '}
              {line !== 'none' ? t(`updates.banner.${line}` as MessageKey) : null}
            </div>
            <div className="row">
              <button type="button" className="button primary" onClick={() => setOpen(true)}>
                {t('updates.whatsChanging')}
              </button>
              <button
                type="button"
                className="button"
                disabled={dismiss.isPending}
                onClick={() => dismiss.mutate(range.to)}
              >
                {t('updates.banner.dismiss')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {open ? <UpdateDialog updates={data} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
