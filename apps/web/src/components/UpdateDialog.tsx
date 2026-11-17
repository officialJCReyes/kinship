// SPDX-License-Identifier: AGPL-3.0-or-later
//
// "What's changing": what every release newer than the running one brings, the backup warning, and the steps to update. The
// steps stay hidden until a backup from the last 24 hours exists or the SuperAdmin ticks "I have a backup I can restore".
import { needsBackupWarning, updateStepsVisible } from '@kinship/shared';
import type { KnownRelease, OfferedRange, UpdatesResponse } from '@kinship/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import * as api from '../api.js';
import { backupsKey, useBackups } from '../admin/backups.js';
import { updatesKey } from '../admin/updates.js';
import { t } from '../i18n.js';
import { ageText } from '../lib/age.js';
import { formatInstant } from '../lib/backups.js';
import { errorMessage } from '../lib/errors.js';
import { Markdown } from '../lib/markdown.js';
import { Dialog } from './Dialog.js';

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function ReleaseLabels({ release }: { release: KnownRelease }) {
  return (
    <div className="pills">
      {release.security ? <span className="pill crit">{t('updates.security')}</span> : null}
      {release.breaking ? <span className="pill warn">{t('updates.label.breaking')}</span> : null}
      {release.migration ? <span className="pill warn">{t('updates.label.migration')}</span> : null}
      {!release.details ? <span className="pill gray">{t('updates.label.unknown')}</span> : null}
    </div>
  );
}

function ReleaseBlock({ release }: { release: KnownRelease }) {
  return (
    <section className="release-block" aria-label={t('updates.popup.release', { version: release.version })}>
      <div className="row between">
        <h3>{t('updates.popup.release', { version: release.version })}</h3>
        <span className="muted small">{release.date}</span>
      </div>
      <ReleaseLabels release={release} />
      {!release.details ? <p className="muted small">{t('updates.popup.unknownNote')}</p> : null}
      <Markdown text={release.notes} />
      {release.upgradeNotes ? (
        <div className={`callout${release.breaking || release.migration ? ' warn' : ''}`}>
          <strong>{t('updates.popup.upgradeNotes')}</strong>
          <Markdown text={release.upgradeNotes} />
        </div>
      ) : null}
    </section>
  );
}

function BackupWarning({ range, updates, now }: { range: OfferedRange; updates: UpdatesResponse; now: Date }) {
  const client = useQueryClient();
  const backups = useBackups(true);
  const status = backups.data?.status;
  const start = useMutation({
    mutationFn: api.startBackup,
    onSuccess: () => client.invalidateQueries({ queryKey: backupsKey }),
  });
  const last = status?.lastSuccessAt ?? null;
  const old = !last || now.getTime() - Date.parse(last) > 24 * 3_600_000;
  const cannot = status !== undefined && (status.passphrase !== 'ok' || !status.folderWritable);
  const running = Boolean(status?.running) || start.isPending;
  return (
    <div className="callout warn" role="group" aria-label={t('updates.backup.title')}>
      <strong>{t('updates.backup.title')}</strong>
      {range.migration ? <div>{t('updates.backup.migration')}</div> : null}
      {range.breaking ? <div>{t('updates.backup.breaking')}</div> : null}
      {range.unknownDetails && !range.migration && !range.breaking ? <div>{t('updates.backup.unknown')}</div> : null}
      <div className="row backup-last">
        {last ? (
          <>
            <span>{t('updates.backup.last', { time: formatInstant(last, zone()) })}</span>
            <span className={old ? 'pill crit' : 'pill ok'}>
              {t('updates.backup.ago', { age: ageText(last, now) })}
            </span>
          </>
        ) : (
          <span>{t('updates.backup.never')}</span>
        )}
      </div>
      <div className="row">
        <button
          type="button"
          className={`button${old ? ' primary' : ''}`}
          disabled={running || cannot}
          onClick={() => start.mutate()}
        >
          {running ? t('updates.backup.running') : t('updates.backup.backUpNow')}
        </button>
      </div>
      {cannot ? <p className="muted small">{t('updates.backup.cannot')}</p> : null}
      {start.isError ? <p role="alert">{errorMessage(start.error)}</p> : null}
      <p className="muted small">
        {updates.settings.safetyCopy ? t('updates.backup.safetyOn') : t('updates.backup.safetyOff')}
      </p>
    </div>
  );
}

function Steps({ range, updates, visible }: { range: OfferedRange; updates: UpdatesResponse; visible: boolean }) {
  const client = useQueryClient();
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no');
  const ack = useMutation({
    mutationFn: (checked: boolean) => api.ackUpdateBackup({ version: range.to, ack: checked }),
    onSuccess: () => client.invalidateQueries({ queryKey: updatesKey }),
  });
  const text = t('updates.steps.text', { version: range.to });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('yes');
    } catch {
      setCopied('failed');
    }
  };
  return (
    <section aria-labelledby="update-steps">
      <h3 id="update-steps">{t('updates.steps.heading')}</h3>
      {visible ? (
        <>
          <pre className="update-steps">{text}</pre>
          <div className="row">
            <button type="button" className="button small" onClick={() => void copy()}>
              {copied === 'yes' ? t('updates.steps.copied') : t('updates.steps.copy')}
            </button>
            {copied === 'failed' ? <span role="status">{t('updates.popup.copyFailed')}</span> : null}
          </div>
        </>
      ) : (
        <>
          <p className="muted">{t('updates.steps.hidden')}</p>
          <label className="check">
            <input
              type="checkbox"
              checked={updates.backupAckVersion === range.to}
              disabled={ack.isPending}
              onChange={(event) => ack.mutate(event.target.checked)}
            />{' '}
            {t('updates.steps.ack')}
          </label>
        </>
      )}
      {ack.isError ? <p role="alert">{errorMessage(ack.error)}</p> : null}
    </section>
  );
}

export function UpdateDialog({ updates, onClose }: { updates: UpdatesResponse; onClose: () => void }) {
  const range = updates.range;
  const backups = useBackups(true);
  if (!range) return null;
  const now = new Date();
  const warn = needsBackupWarning(range);
  const visible = updateStepsVisible({
    range,
    lastBackupAt: backups.data?.status.lastSuccessAt ?? null,
    now,
    ackVersion: updates.backupAckVersion,
  });
  const count = range.releases.length;
  return (
    <Dialog title={t('updates.popup.title')} onClose={onClose}>
      <div className="stack update-dialog">
        <p className="muted">
          {t('updates.popup.range2', {
            from: range.from,
            to: range.to,
            releases: count === 1 ? t('updates.popup.releases.one') : t('updates.popup.releases.many', { count }),
          })}{' '}
          {range.security ? <span className="pill crit">{t('updates.security')}</span> : null}
        </p>
        {warn ? (
          <BackupWarning range={range} updates={updates} now={now} />
        ) : (
          <p className="muted">{t('updates.popup.noWarning')}</p>
        )}
        {range.releases.map((release) => (
          <ReleaseBlock key={release.version} release={release} />
        ))}
        <Steps range={range} updates={updates} visible={visible} />
        <div className="row end">
          <button type="button" className="button" onClick={onClose}>
            {t('updates.popup.later')}
          </button>
          <button type="button" className="button primary" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
