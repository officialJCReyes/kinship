// SPDX-License-Identifier: AGPL-3.0-or-later
import type { LinkCreated } from '@kinship/shared';
import { useRef, useState } from 'react';
import { Dialog } from '../components/Dialog.js';
import { t } from '../i18n.js';
import { formatMoment } from '../lib/timestamps.js';
import { linkAddress } from './links.js';

export interface ShownLink {
  created: LinkCreated;
  /** The invitee's email, or the name of the account the set-password link is for. */
  who: string;
  /** This replaced an earlier link, which no longer works. */
  replaced: boolean;
}

/**
 * Shows a link ONCE. The token exists only in this component's props: it is not in the query cache, not in storage and
 * not in the address bar. Closing the dialog drops it for good, and the server cannot show it again (it keeps only a hash).
 */
export function LinkDialog({ shown, onClose }: { shown: ShownLink; onClose: () => void }) {
  const { created, who, replaced } = shown;
  const address = linkAddress(created);
  const field = useRef<HTMLInputElement>(null);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const date = formatMoment(created.expiresAt);
  const invite = created.kind === 'invite';

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopy('copied');
    } catch {
      field.current?.select();
      setCopy('failed');
    }
  };

  return (
    <Dialog
      title={invite ? t('link.titleInvite', { email: who }) : t('link.titleReset', { name: who })}
      onClose={onClose}
    >
      <div className="stack">
        <p>{invite ? t('link.introInvite', { email: who, date }) : t('link.introReset', { name: who, date })}</p>
        {!invite ? <p className="muted">{t('link.resetWarning', { name: who })}</p> : null}
        {replaced ? <p className="muted">{t('link.replaced')}</p> : null}
        <div className="field">
          <label htmlFor="link-address">{t('link.label')}</label>
          <input
            id="link-address"
            ref={field}
            className="link-address"
            readOnly
            value={address}
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
        <div className="actions wrap">
          <button className="button primary" type="button" onClick={() => void onCopy()}>
            {t('link.copy')}
          </button>
          <span role="status" className="muted">
            {copy === 'copied' ? t('link.copied') : copy === 'failed' ? t('link.copyFailed') : ''}
          </span>
        </div>
        <div className="notice warning" role="note">
          {t('link.once')}
        </div>
        <div className="actions">
          <button className="button" type="button" onClick={onClose}>
            {t('link.done')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
