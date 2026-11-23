// SPDX-License-Identifier: AGPL-3.0-or-later
import type { LastRestore, MaintenanceStatus, MessageKey } from '@kinship/shared';
import { useEffect, useRef, useState } from 'react';
import * as api from '../api.js';
import { CardMark } from '../components/LogoMark.js';
import { t } from '../i18n.js';

/** How often the page asks where the restore is. */
export const POLL_MS = 2000;

type Shown = { kind: 'working'; text: string } | { kind: 'done'; last: LastRestore | null };

/**
 * Replaces the whole app while the site is paused for a restore (ADR 0031). It asks GET /api/maintenance every two seconds, which
 * needs no sign-in and no database, and keeps asking through the few seconds the api is gone while Docker starts it again
 * (those answers fail: that is "starting again", not an error). When the api says it is idle again the restore is over, and the
 * page says how it ended. Nothing here is a link into the app: the sessions are gone.
 */
export function MaintenancePage({ onLeave }: { onLeave: () => void }) {
  const [shown, setShown] = useState<Shown>({ kind: 'working', text: t('maintenance.phase.pausing') });
  // Once a phase other than idle has been seen (or the api has been unreachable), an idle answer means the restore is over.
  const seenBusy = useRef(true);
  const done = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const poll = async () => {
      const status: MaintenanceStatus | null = await api.fetchMaintenance(controller.signal);
      if (controller.signal.aborted || done.current) return;
      if (status === null) {
        seenBusy.current = true;
        setShown({ kind: 'working', text: t('maintenance.phase.restarting') });
      } else if (status.phase === 'idle') {
        if (seenBusy.current) {
          done.current = true;
          setShown({ kind: 'done', last: status.lastRestore ?? null });
          return;
        }
      } else {
        seenBusy.current = true;
        setShown({ kind: 'working', text: t(`maintenance.phase.${status.phase}` as MessageKey) });
      }
      timer = setTimeout(() => void poll(), POLL_MS);
    };
    void poll();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (shown.kind === 'working') {
    return (
      <main className="page-width">
        <section className="card stack maintenance" aria-labelledby="maintenance-title">
          <CardMark />
          <h1 id="maintenance-title">{t('maintenance.title')}</h1>
          <p className="muted">{t('maintenance.intro')}</p>
          <p role="status" aria-live="polite" className="maintenance-phase">
            {shown.text}
          </p>
        </section>
      </main>
    );
  }
  const last = shown.last;
  const kind = last ? last.kind : 'unknown';
  const signedOut = kind === 'restored' || kind === 'restored_not_migrated';
  const key = (part: string) => `maintenance.result.${kind}.${part}` as MessageKey;
  return (
    <main className="page-width">
      <section className="card stack maintenance" aria-labelledby="maintenance-title" role="status" aria-live="polite">
        <CardMark />
        <h1 id="maintenance-title">{t(key('title'))}</h1>
        <p>{t(key('body'))}</p>
        {kind === 'restored' ? <p>{t('maintenance.result.restored.accounts')}</p> : null}
        {last?.safetyCopy ? (
          <p className="muted">
            {t(kind === 'unchanged' ? 'maintenance.result.unchanged.safety' : 'maintenance.result.restored.safety', {
              file: last.safetyCopy,
            })}
          </p>
        ) : null}
        <div className="row">
          <button
            type="button"
            className="button primary"
            onClick={() => {
              onLeave();
              // A full load: nothing from before the restore (people, the signed-in account) may stay on the page.
              window.location.assign(signedOut ? '/login' : '/admin/backups');
            }}
          >
            {signedOut ? t('maintenance.signIn') : t('maintenance.back')}
          </button>
        </div>
      </section>
    </main>
  );
}
