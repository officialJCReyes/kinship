// SPDX-License-Identifier: AGPL-3.0-or-later
//
// "What's new": shown once to every admin at the first sign-in after the version changed, and from About KinShip. It reads the
// changelog inside the image, so it works with no internet.
import type { ChangelogGroup, MessageKey, WhatsNewResponse } from '@kinship/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import * as api from '../api.js';
import { whatsNewKey } from '../admin/updates.js';
import { useSession } from '../auth.js';
import { t } from '../i18n.js';
import { errorMessage } from '../lib/errors.js';
import { Markdown } from '../lib/markdown.js';
import { isAdmin } from '../people/permissions.js';
import { Dialog } from './Dialog.js';

function groupTitle(group: ChangelogGroup): string {
  if (group.kind !== 'other') return t(`updates.group.${group.kind}` as MessageKey);
  return group.title !== '' ? group.title : t('updates.group.other');
}

export function WhatsNewDialog({
  data,
  onClose,
  onGotIt,
  busy = false,
  error,
}: {
  data: WhatsNewResponse;
  onClose: () => void;
  /** Present when this is the popup that records "seen". */
  onGotIt?: () => void;
  busy?: boolean;
  error?: unknown;
}) {
  const down = data.kind === 'down';
  return (
    <Dialog
      title={down ? t('updates.whatsNew.downTitle') : t('updates.whatsNew.title', { version: data.to })}
      onClose={onClose}
    >
      <div className="stack whats-new">
        {down ? (
          <p className="callout">
            {data.restore
              ? t('updates.whatsNew.restored', { from: data.restore.fromVersion ?? '?', to: data.restore.toVersion })
              : t('updates.whatsNew.down', { from: data.from ?? '?', to: data.to })}
          </p>
        ) : (
          <>
            <p className="muted">
              {data.from ? t('updates.whatsNew.from', { version: data.from }) : t('updates.whatsNew.fromUnknown')}{' '}
              {t('updates.whatsNew.offlineNote')}
            </p>
            {data.migrations.map((m) => (
              <div className="callout" key={m.at}>
                <strong>
                  {m.fromSchema === null
                    ? t('updates.whatsNew.migratedUnknownFrom', { to: m.toSchema })
                    : t('updates.whatsNew.migrated', { from: m.fromSchema, to: m.toSchema })}
                </strong>{' '}
                {m.safetyCopy
                  ? t('updates.whatsNew.safetyCopy', { file: m.safetyCopy })
                  : m.safetyNote === 'off'
                    ? t('updates.whatsNew.safetyOff')
                    : m.safetyNote === 'skipped_no_bypassrls' || m.safetyNote === 'break_glass'
                      ? t(`updates.whatsNew.safetyNone.${m.safetyNote}` as MessageKey)
                      : null}
              </div>
            ))}
            {data.checkNow.map((c) => (
              <div className="callout warn" key={c.version}>
                <strong>{t('updates.whatsNew.checkNow')}</strong> <span className="muted small">{c.version}</span>
                <Markdown text={c.markdown} />
              </div>
            ))}
            {data.sections.length === 0 ? (
              <p className="muted">{t('updates.whatsNew.noNotes', { version: data.to })}</p>
            ) : null}
            {data.sections.map((section) => (
              <section className="release-block" key={section.version}>
                <div className="row between">
                  <h3>{t('updates.popup.release', { version: section.version })}</h3>
                  {section.date ? <span className="muted small">{section.date}</span> : null}
                </div>
                {section.groups.map((group, index) => (
                  <div key={`${group.title}-${index}`}>
                    <h4>{groupTitle(group)}</h4>
                    <Markdown text={group.body} />
                  </div>
                ))}
              </section>
            ))}
          </>
        )}
        {error ? <p role="alert">{errorMessage(error)}</p> : null}
        <div className="row end">
          <a className="button" href={data.releaseUrl} target="_blank" rel="noopener noreferrer">
            {t('updates.whatsNew.fullNotes')}
          </a>
          {onGotIt ? (
            <button type="button" className="button primary" disabled={busy} onClick={onGotIt}>
              {t('updates.whatsNew.gotIt')}
            </button>
          ) : (
            <button type="button" className="button primary" onClick={onClose}>
              {t('common.close')}
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/** Mounted once inside the signed-in app. Opens by itself for an admin who has not seen the running version. */
export function WhatsNewHost() {
  const client = useQueryClient();
  const session = useSession(false);
  const admin = isAdmin(session.data?.user);
  const [hidden, setHidden] = useState(false);
  const query = useQuery({
    queryKey: whatsNewKey,
    queryFn: ({ signal }) => api.fetchWhatsNew(false, signal),
    enabled: admin,
    retry: false,
    staleTime: Infinity,
  });
  const seen = useMutation({
    mutationFn: api.markWhatsNewSeen,
    onSuccess: async () => {
      setHidden(true);
      await client.invalidateQueries({ queryKey: whatsNewKey });
    },
  });
  if (!admin || hidden || !query.data?.show) return null;
  return (
    <WhatsNewDialog
      data={query.data}
      // Closing without "Got it" hides it for now and records nothing: it comes again at the next sign-in.
      onClose={() => setHidden(true)}
      onGotIt={() => seen.mutate()}
      busy={seen.isPending}
      error={seen.error}
    />
  );
}

/** The "What's new" button on About KinShip (admins only): the latest update, whatever has been seen. */
export function WhatsNewButton() {
  const session = useSession(false);
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: [...whatsNewKey, 'latest'],
    queryFn: ({ signal }) => api.fetchWhatsNew(true, signal),
    enabled: open,
    retry: false,
  });
  if (!isAdmin(session.data?.user)) return null;
  return (
    <>
      <button type="button" className="button" onClick={() => setOpen(true)}>
        {t('updates.whatsNew.button')}
      </button>
      {open && query.data ? <WhatsNewDialog data={query.data} onClose={() => setOpen(false)} /> : null}
      {open && query.isError ? (
        <Dialog title={t('updates.whatsNew.button')} onClose={() => setOpen(false)}>
          <p role="alert">{errorMessage(query.error)}</p>
        </Dialog>
      ) : null}
    </>
  );
}
