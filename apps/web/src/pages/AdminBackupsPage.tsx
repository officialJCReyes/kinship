// SPDX-License-Identifier: AGPL-3.0-or-later
import { BACKUP_SCHEDULES } from '@kinship/shared';
import type { BackupListItem, BackupSettings, BackupStatus, MessageKey } from '@kinship/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { FormEvent } from 'react';
import * as api from '../api.js';
import { ApiError } from '../api.js';
import { useSession } from '../auth.js';
import { backupsKey, useBackups } from '../admin/backups.js';
import { Dialog } from '../components/Dialog.js';
import { Field } from '../components/Field.js';
import { SelectField } from '../components/SelectField.js';
import { ErrorState, Loading } from '../components/States.js';
import { t } from '../i18n.js';
import { formatBytes, formatInstant } from '../lib/backups.js';
import { startDownload } from '../lib/download.js';
import { errorMessage } from '../lib/errors.js';
import { NotFoundPage } from './NotFoundPage.js';

const FAILURES = new Set([
  'passphrase_missing',
  'passphrase_too_short',
  'passphrase_placeholder',
  'folder_not_writable',
  'last_backup_failed',
  'last_test_failed',
  'overdue',
]);

function StatusCard({
  status,
  onBackup,
  onTest,
  busy,
  message,
}: {
  status: BackupStatus;
  onBackup: () => void;
  onTest: () => void;
  busy: boolean;
  message: string | null;
}) {
  const zone = status.settings.timeZone;
  const running = status.running || busy;
  const cannot = status.passphrase !== 'ok' || !status.folderWritable;
  const lastRun = status.lastRun;
  const test = status.lastTest;
  return (
    <section className="card stack" aria-labelledby="backups-status">
      <div className="row between">
        <h2 id="backups-status">{status.healthy ? t('backups.status.ok') : t('backups.status.problem')}</h2>
        <span className={status.healthy ? 'pill ok' : 'pill crit'}>
          {status.healthy ? t('backups.status.ok') : t('backups.status.problem')}
        </span>
      </div>
      {status.problems.length > 0 ? (
        <ul className={`backup-problems${status.healthy ? '' : ' bad'}`}>
          {status.problems.map((problem) => (
            <li key={problem} className={FAILURES.has(problem) ? 'bad' : undefined}>
              {t(`backups.problem.${problem}` as MessageKey)}
            </li>
          ))}
        </ul>
      ) : null}
      {lastRun && !lastRun.ok ? (
        <p className="alert">{t('backups.lastFailure', { error: lastRun.error ?? '' })}</p>
      ) : null}
      <dl className="facts">
        <dt>{t('backups.lastSuccess')}</dt>
        <dd>{status.lastSuccessAt ? formatInstant(status.lastSuccessAt, zone) : t('backups.never')}</dd>
        <dt>{t('backups.nextRun')}</dt>
        <dd>{status.nextRunAt ? formatInstant(status.nextRunAt, zone) : t('backups.notScheduled')}</dd>
      </dl>
      {test ? (
        <p className="muted small">
          {test.mode === 'archive-only'
            ? t('backups.lastTest.archiveOnly', { note: test.note ?? '' })
            : test.ok
              ? t('backups.lastTest.ok', { tables: test.tables, rows: test.rows, file: test.file })
              : t('backups.lastTest.failed', { file: test.file, failed: (test.failed ?? []).join('; ') })}
        </p>
      ) : null}
      <div className="row">
        <button type="button" className="button primary" onClick={onBackup} disabled={running || cannot}>
          {running ? t('backups.running') : t('backups.backUpNow')}
        </button>
        <button type="button" className="button" onClick={onTest} disabled={running || cannot}>
          {t('backups.testLatest')}
        </button>
      </div>
      <p className="muted small">{t('backups.testHelp')}</p>
      {message ? (
        <p className="muted small" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}

function DownloadDialog({ item, onClose }: { item: BackupListItem; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { ticket } = await api.requestDownloadTicket(item.name, password);
      startDownload(`/api/admin/backups/download?ticket=${encodeURIComponent(ticket)}`);
      onClose();
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.code === 'invalid_current_password'
          ? t('backups.download.wrong')
          : errorMessage(failure),
      );
      setBusy(false);
    }
  };
  return (
    <Dialog title={t('backups.download.title')} onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="stack">
        <p>
          <strong>{item.name}</strong>
        </p>
        <p className="muted">{t('backups.download.help')}</p>
        <Field
          label={t('backups.download.password')}
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={error ?? undefined}
          required
        />
        <div className="row">
          <button type="submit" className="button primary" disabled={busy || password === ''}>
            {t('backups.download.start')}
          </button>
          <button type="button" className="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function BackupTable({
  items,
  zone,
  onDownload,
}: {
  items: BackupListItem[];
  zone: string;
  onDownload: (item: BackupListItem) => void;
}) {
  if (items.length === 0) return <p className="muted">{t('backups.list.empty')}</p>;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">{t('backups.col.name')}</th>
            <th scope="col">{t('backups.col.type')}</th>
            <th scope="col">{t('backups.col.size')}</th>
            <th scope="col">{t('backups.col.date')}</th>
            <th scope="col">{t('backups.col.state')}</th>
            <th scope="col">
              <span className="sr-only">{t('backups.download')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.name}>
              <th scope="row" className="mono">
                {item.name}
                {!item.encrypted ? <span className="pill gray"> {t('backups.notEncrypted')}</span> : null}
              </th>
              <td>{t(`backups.kind.${item.kind}` as MessageKey)}</td>
              <td>{formatBytes(item.bytes)}</td>
              <td>{formatInstant(item.modifiedAt, zone)}</td>
              <td>
                {item.tested ? (
                  <span className={item.tested === 'ok' ? 'pill ok' : 'pill crit'}>
                    {t(`backups.tested.${item.tested}` as MessageKey)}
                  </span>
                ) : null}
              </td>
              <td>
                {item.encrypted ? (
                  <button
                    type="button"
                    className="button small"
                    aria-label={t('backups.downloadFile', { name: item.name })}
                    onClick={() => onDownload(item)}
                  >
                    {t('backups.download')}
                  </button>
                ) : (
                  <span className="muted small">{t('backups.downloadNotEncrypted')}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface Draft {
  schedule: string;
  time: string;
  weekday: string;
  keepDaily: string;
  keepWeekly: string;
  keepMonthly: string;
  includeFiles: boolean;
  testAfterBackup: boolean;
  timeZone: string;
}

const toDraft = (s: BackupSettings): Draft => ({
  schedule: s.schedule,
  time: s.time,
  weekday: String(s.weekday),
  keepDaily: String(s.keepDaily),
  keepWeekly: String(s.keepWeekly),
  keepMonthly: String(s.keepMonthly),
  includeFiles: s.includeFiles,
  testAfterBackup: s.testAfterBackup,
  timeZone: s.timeZone,
});

function SettingsForm({
  settings,
  saved,
  setSaved,
}: {
  settings: BackupSettings;
  saved: boolean;
  setSaved: (saved: boolean) => void;
}) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<Draft>(toDraft(settings));
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  const save = useMutation({
    mutationFn: () =>
      api.updateBackupSettings({
        schedule: draft.schedule as BackupSettings['schedule'],
        time: draft.time,
        weekday: Number(draft.weekday),
        keepDaily: Number(draft.keepDaily),
        keepWeekly: Number(draft.keepWeekly),
        keepMonthly: Number(draft.keepMonthly),
        includeFiles: draft.includeFiles,
        testAfterBackup: draft.testAfterBackup,
        timeZone: draft.timeZone,
      }),
    onSuccess: async () => {
      setSaved(true);
      await client.invalidateQueries({ queryKey: backupsKey });
    },
  });
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setSaved(false);
    setDraft((previous) => ({ ...previous, [key]: value }));
  };
  const numeric = (key: 'keepDaily' | 'keepWeekly' | 'keepMonthly', label: string, min: number) => (
    <Field
      label={label}
      type="number"
      inputMode="numeric"
      min={min}
      value={draft[key]}
      onChange={(event) => set(key, event.target.value)}
    />
  );
  return (
    <section className="card" aria-labelledby="backups-settings">
      <h2 id="backups-settings">{t('backups.settings.title')}</h2>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <div className="setup-grid">
          <SelectField
            label={t('backups.settings.schedule')}
            value={draft.schedule}
            onChange={(event) => set('schedule', event.target.value)}
          >
            {BACKUP_SCHEDULES.map((schedule) => (
              <option key={schedule} value={schedule}>
                {t(`backups.settings.schedule.${schedule}` as MessageKey)}
              </option>
            ))}
          </SelectField>
          <Field
            label={t('backups.settings.time')}
            type="time"
            value={draft.time}
            onChange={(event) => set('time', event.target.value)}
          />
        </div>
        {draft.schedule === 'weekly' ? (
          <SelectField
            label={t('backups.settings.weekday')}
            value={draft.weekday}
            onChange={(event) => set('weekday', event.target.value)}
          >
            {[0, 1, 2, 3, 4, 5, 6].map((day) => (
              <option key={day} value={day}>
                {t(`backups.weekday.${day}` as MessageKey)}
              </option>
            ))}
          </SelectField>
        ) : null}
        <div>
          <Field
            label={t('backups.settings.timeZone')}
            list="backup-zones"
            value={draft.timeZone}
            onChange={(event) => set('timeZone', event.target.value)}
            help={t('backups.settings.timeZoneHelp')}
          />
          <datalist id="backup-zones">
            {zones.map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
        </div>
        <div className="setup-grid">
          {numeric('keepDaily', t('backups.settings.keepDaily'), 1)}
          {numeric('keepWeekly', t('backups.settings.keepWeekly'), 0)}
          {numeric('keepMonthly', t('backups.settings.keepMonthly'), 0)}
        </div>
        <p className="muted small">{t('backups.settings.keepHelp')}</p>
        <label className="check">
          <input
            type="checkbox"
            checked={draft.includeFiles}
            onChange={(event) => set('includeFiles', event.target.checked)}
          />{' '}
          {t('backups.settings.includeFiles')}
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={draft.testAfterBackup}
            onChange={(event) => set('testAfterBackup', event.target.checked)}
          />{' '}
          {t('backups.settings.testAfter')}
        </label>
        {save.isError ? (
          <p className="alert" role="alert">
            {t('backups.settings.saveFailed')} {errorMessage(save.error)}
          </p>
        ) : null}
        {saved ? (
          <p className="muted" role="status">
            {t('backups.settings.saved')}
          </p>
        ) : null}
        <div className="row">
          <button type="submit" className="button primary" disabled={save.isPending}>
            {t('backups.settings.save')}
          </button>
        </div>
      </form>
    </section>
  );
}

function RestoreCard() {
  return (
    <section className="card stack" aria-labelledby="backups-restore">
      <h2 id="backups-restore">{t('backups.restore.title')}</h2>
      <p>{t('backups.restore.intro')}</p>
      <ol className="restore-steps">
        <li>
          {t('backups.restore.step1')}
          <pre className="code">docker compose stop web api</pre>
        </li>
        <li>
          {t('backups.restore.step2')}
          <pre className="code">docker compose run --rm api kinship restore kinship-YYYY-MM-DD-HHMM.tar.enc</pre>
        </li>
        <li>
          {t('backups.restore.step3')}
          <pre className="code">docker compose up -d</pre>
        </li>
      </ol>
      <p className="muted small">{t('backups.restore.more')}</p>
    </section>
  );
}

/**
 * Admin → Backups. SuperAdmin only (anyone else gets the not-found page; the API refuses them anyway). The page shows how
 * backups are doing, starts one, tests the newest, lists what is on the server with a password-protected download, edits the
 * schedule and retention, and says how to restore (from the command line; there is no Restore button).
 */
export function AdminBackupsPage() {
  const session = useSession(false);
  const client = useQueryClient();
  const isSuper = session.data?.user.role === 'superadmin';
  const backups = useBackups(isSuper);
  const [message, setMessage] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<BackupListItem | null>(null);
  // Kept here, not in the form: the form is rebuilt when the saved settings come back from the server.
  const [saved, setSaved] = useState(false);
  const start = useMutation({
    mutationFn: (what: 'backup' | 'test') => (what === 'backup' ? api.startBackup() : api.startBackupTest()),
    onSuccess: async () => {
      setMessage(t('backups.started'));
      await client.invalidateQueries({ queryKey: backupsKey });
    },
  });
  if (session.isPending) return <Loading />;
  if (!isSuper) return <NotFoundPage />;
  if (backups.isPending) return <Loading />;
  if (backups.isError) return <ErrorState error={backups.error} onRetry={() => void backups.refetch()} />;

  const { status, backups: items } = backups.data;
  return (
    <div className="stack backups-page">
      <div>
        <h1>{t('backups.title')}</h1>
        <p className="muted">{t('backups.intro')}</p>
      </div>
      {start.isError ? (
        <p className="alert" role="alert">
          {errorMessage(start.error)}
        </p>
      ) : null}
      <StatusCard
        status={status}
        message={message}
        busy={start.isPending}
        onBackup={() => start.mutate('backup')}
        onTest={() => start.mutate('test')}
      />
      <section className="card stack" aria-labelledby="backups-list">
        <h2 id="backups-list">{t('backups.list.title')}</h2>
        <BackupTable items={items} zone={status.settings.timeZone} onDownload={setDownloading} />
      </section>
      <SettingsForm
        key={JSON.stringify(status.settings)}
        settings={status.settings}
        saved={saved}
        setSaved={setSaved}
      />
      <section className="card stack" aria-labelledby="backups-keep">
        <h2 id="backups-keep">{t('backups.keep.title')}</h2>
        <p>{t('backups.keep.body')}</p>
      </section>
      <RestoreCard />
      {downloading ? <DownloadDialog item={downloading} onClose={() => setDownloading(null)} /> : null}
    </div>
  );
}
