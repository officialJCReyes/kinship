// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Admin > Updates. The SuperAdmin sees the version card, the three switches and Check now; a Family Admin sees only a note.
import type { MessageKey, UpdateSettings, UpdatesResponse } from '@kinship/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import * as api from '../api.js';
import { updatesKey, useUpdates } from '../admin/updates.js';
import { useSession } from '../auth.js';
import { InfoTip } from '../components/InfoTip.js';
import { UpdateDialog } from '../components/UpdateDialog.js';
import { ErrorState, Loading } from '../components/States.js';
import { t } from '../i18n.js';
import { formatInstant } from '../lib/backups.js';
import { errorMessage } from '../lib/errors.js';

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** The result pill and, when the last check failed, one sentence that says so quietly. */
function Result({ data }: { data: UpdatesResponse }) {
  const { settings, check, range } = data;
  let pill: { text: string; className: string };
  if (!settings.check) pill = { text: t('updates.result.off'), className: 'pill gray' };
  else if (range)
    pill = {
      text: t('updates.result.available', { version: range.to }),
      className: range.security ? 'pill crit' : 'pill warn',
    };
  else if (check.status === 'never') pill = { text: t('updates.result.never'), className: 'pill gray' };
  else if (check.lastSuccessAt === null) pill = { text: t('updates.result.never'), className: 'pill gray' };
  else pill = { text: t('updates.result.upToDate'), className: 'pill ok' };
  const failure: MessageKey | null =
    !settings.check || !['offline', 'rate_limited', 'bad_response'].includes(check.status)
      ? null
      : check.status === 'offline'
        ? check.lastSuccessAt
          ? 'updates.failed.offline'
          : 'updates.failed.offlineNever'
        : check.status === 'rate_limited'
          ? 'updates.failed.rateLimited'
          : 'updates.failed.badResponse';
  return (
    <>
      <span className={pill.className}>{pill.text}</span>
      {failure ? (
        <p className="muted small" role="status">
          {t(failure, { time: check.lastSuccessAt ? formatInstant(check.lastSuccessAt, zone()) : '' })}
        </p>
      ) : null}
    </>
  );
}

function VersionCard({ data, onChanging }: { data: UpdatesResponse; onChanging: () => void }) {
  const client = useQueryClient();
  const check = useMutation({
    mutationFn: api.checkForUpdates,
    onSuccess: (fresh) => client.setQueryData(updatesKey, fresh),
  });
  const { running, settings } = data;
  const web = running.webVersion ?? running.version;
  const cannot = !settings.check;
  const notice = check.isError ? errorMessage(check.error) : null;
  const wait = check.isError && check.error instanceof api.ApiError && check.error.retryAfterSeconds;
  return (
    <section className="card stack" aria-labelledby="updates-version">
      <h2 id="updates-version">{t('updates.version.heading')}</h2>
      <dl className="facts">
        <dt>{t('updates.version.running')}</dt>
        <dd className="mono">
          {t('updates.version.runningValue', { version: running.version, web, api: running.version })}
        </dd>
        <dt>{t('updates.version.schema')}</dt>
        <dd className="mono">{running.schema ?? t('about.unknown')}</dd>
        <dt>{t('updates.version.lastCheck')}</dt>
        <dd>
          {data.check.lastAttemptAt ? formatInstant(data.check.lastAttemptAt, zone()) : t('updates.version.never')}
        </dd>
        {settings.check && data.check.nextCheckAt ? (
          <>
            <dt>{t('updates.version.nextCheck')}</dt>
            <dd>{formatInstant(data.check.nextCheckAt, zone())}</dd>
          </>
        ) : null}
        <dt>{t('updates.version.result')}</dt>
        <dd>
          <Result data={data} />
        </dd>
      </dl>
      <div className="row">
        <button type="button" className="button" disabled={cannot || check.isPending} onClick={() => check.mutate()}>
          {check.isPending ? t('updates.checking') : t('updates.checkNow')}
        </button>
        {data.range ? (
          <button type="button" className="button primary" onClick={onChanging}>
            {t('updates.whatsChanging')}
          </button>
        ) : null}
      </div>
      {cannot ? <p className="muted small">{t('updates.checkNow.off')}</p> : null}
      {notice ? <p role="alert">{wait ? t('updates.checkNow.wait', { seconds: wait }) : notice}</p> : null}
      {data.check.viaProxy ? <p className="muted small">{t('updates.viaProxy')}</p> : null}
      <p className="muted small">{t('updates.neverSelf')}</p>
    </section>
  );
}

/**
 * A setting with a checkbox. The explanation is either shown under the label (`tip` false) or kept in a tooltip beside it
 * (`tip` true); the checkbox's description points at it either way. The tooltip button sits outside the <label>.
 */
function Switch({
  name,
  label,
  help,
  tip = false,
  checked,
  busy,
  onChange,
}: {
  name: keyof UpdateSettings;
  label: string;
  help: string;
  tip?: boolean;
  checked: boolean;
  busy: boolean;
  onChange: (value: boolean) => void;
}) {
  const inputId = useId();
  const helpId = `${inputId}-help`;
  return (
    <div className="option">
      <input
        id={inputId}
        type="checkbox"
        name={name}
        checked={checked}
        disabled={busy}
        aria-describedby={helpId}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <label htmlFor={inputId}>
          <strong>{label}</strong>
        </label>
        {tip ? <InfoTip id={helpId} label={t('updates.settings.moreAbout', { setting: label })} text={help} /> : null}
        {tip ? null : (
          <span id={helpId} className="muted block">
            {help}
          </span>
        )}
      </span>
    </div>
  );
}

function SettingsCard({ data }: { data: UpdatesResponse }) {
  const client = useQueryClient();
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: (patch: Partial<UpdateSettings>) => api.updateUpdateSettings(patch),
    onSuccess: async () => {
      setSaved(true);
      await client.invalidateQueries({ queryKey: updatesKey });
    },
    onMutate: () => setSaved(false),
  });
  const { settings } = data;
  const set = (name: keyof UpdateSettings) => (value: boolean) => save.mutate({ [name]: value });
  return (
    <section className="card stack" aria-labelledby="updates-settings">
      <h2 id="updates-settings">{t('updates.settings.heading')}</h2>
      <Switch
        name="check"
        label={t('updates.settings.check')}
        help={t('updates.settings.check.help')}
        tip
        checked={settings.check}
        busy={save.isPending}
        onChange={set('check')}
      />
      <Switch
        name="preReleases"
        label={t('updates.settings.pre')}
        help={t('updates.settings.pre.help')}
        checked={settings.preReleases}
        busy={save.isPending}
        onChange={set('preReleases')}
      />
      <Switch
        name="safetyCopy"
        label={t('updates.settings.safety')}
        help={t('updates.settings.safety.help')}
        tip
        checked={settings.safetyCopy}
        busy={save.isPending}
        onChange={set('safetyCopy')}
      />
      {save.isError ? <p role="alert">{errorMessage(save.error)}</p> : null}
      {saved && !save.isError ? (
        <p className="muted small" role="status">
          {t('updates.settings.saved')}
        </p>
      ) : null}
    </section>
  );
}

function SuperAdminUpdates() {
  const updates = useUpdates(true);
  const [open, setOpen] = useState(false);
  if (updates.isPending) return <Loading />;
  if (updates.isError) return <ErrorState error={updates.error} onRetry={() => void updates.refetch()} />;
  return (
    <div className="stack">
      <div className="two-columns">
        <VersionCard data={updates.data} onChanging={() => setOpen(true)} />
        <SettingsCard data={updates.data} />
      </div>
      {open ? <UpdateDialog updates={updates.data} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

export function AdminUpdatesPage() {
  const session = useSession(false);
  if (session.isPending) return <Loading />;
  return (
    <div className="stack">
      <h1 className="visually-hidden">{t('updates.title')}</h1>
      {session.data?.user.role === 'superadmin' ? (
        <SuperAdminUpdates />
      ) : (
        <p className="callout" role="note">
          {t('updates.familyAdminNote')}
        </p>
      )}
    </div>
  );
}
