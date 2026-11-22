// SPDX-License-Identifier: AGPL-3.0-or-later
import { en, RESTORE_WORD } from '@kinship/shared';
import type { BackupListItem, MessageKey, RestoreCheck } from '@kinship/shared';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import * as api from '../api.js';
import { ApiError } from '../api.js';
import { Dialog } from '../components/Dialog.js';
import { Field } from '../components/Field.js';
import { t } from '../i18n.js';
import { formatBytes, formatInstant } from '../lib/backups.js';
import { errorMessage } from '../lib/errors.js';
import { enterMaintenance } from '../lib/maintenance.js';

/** Why a check was refused, as a sentence. A refusal that carries its own sentence (no path in it) shows that. */
function problemText(error: unknown): string {
  if (!(error instanceof ApiError)) return errorMessage(error);
  if (error.code === 'restore_failed') {
    const kind = typeof error.details.errorKind === 'string' ? error.details.errorKind : 'other';
    const detail = typeof error.details.detail === 'string' ? error.details.detail : null;
    if (detail && (kind === 'refused' || kind === 'disk_space')) return detail;
    const key = `backups.restore.problem.${kind}`;
    return t(key in en ? (key as MessageKey) : 'backups.restore.problem.other');
  }
  return errorMessage(error);
}

/**
 * Restore one listed backup. First the archive is checked (nothing changes, nobody is signed out), and what a restore would do is
 * shown; then the SuperAdmin types their password and the word RESTORE. The restore pauses the site and replaces everything.
 */
export function RestoreDialog({ item, zone, onClose }: { item: BackupListItem; zone: string; onClose: () => void }) {
  const [check, setCheck] = useState<RestoreCheck | null>(null);
  const [problem, setProblem] = useState<{ text: string; code?: string } | null>(null);
  const [password, setPassword] = useState('');
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const when = formatInstant(item.modifiedAt, zone);

  // Bumped to check again (an expired ticket, a busy server): the effect below asks once per attempt.
  const [attempt, setAttempt] = useState(0);
  const again = () => {
    setCheck(null);
    setProblem(null);
    setError(null);
    setAttempt((n) => n + 1);
  };
  useEffect(() => {
    let ignore = false;
    api.checkRestore(item.name).then(
      (facts) => {
        if (!ignore) setCheck(facts);
      },
      (failure: unknown) => {
        if (!ignore)
          setProblem({
            text: problemText(failure),
            ...(failure instanceof ApiError && failure.code ? { code: failure.code } : {}),
          });
      },
    );
    return () => {
      ignore = true;
    };
  }, [item.name, attempt]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!check) return;
    setBusy(true);
    setError(null);
    try {
      await api.startRestore({ ticket: check.ticket, word, password });
      // The site is paused from here on: the page is replaced by the maintenance screen.
      enterMaintenance();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 503 && failure.details.error === 'maintenance') return;
      setError(
        failure instanceof ApiError && failure.code === 'invalid_current_password'
          ? t('backups.download.wrong')
          : problemText(failure),
      );
      setBusy(false);
      if (failure instanceof ApiError && failure.code === 'restore_ticket_invalid') setCheck(null);
    }
  };

  const ready = check !== null && word === RESTORE_WORD && password !== '' && !busy;
  return (
    <Dialog title={t('backups.restore.dialog.title', { when })} onClose={onClose}>
      <div className="stack">
        <p>
          <strong className="mono">{item.name}</strong>
        </p>
        {problem ? (
          <>
            <p className="alert" role="alert">
              {problem.text}
            </p>
            <div className="row">
              {problem.code === 'restore_ticket_invalid' || problem.code === 'restore_busy' ? (
                <button type="button" className="button" onClick={again}>
                  {t('backups.restore.checkAgain')}
                </button>
              ) : null}
              <button type="button" className="button" onClick={onClose}>
                {t('common.close')}
              </button>
            </div>
          </>
        ) : check === null ? (
          <p role="status" className="muted">
            {error ? (
              <>
                <span className="alert" role="alert">
                  {error}
                </span>{' '}
                <button type="button" className="button small" onClick={again}>
                  {t('backups.restore.checkAgain')}
                </button>
              </>
            ) : (
              t('backups.restore.checking')
            )}
          </p>
        ) : (
          <form onSubmit={(event) => void submit(event)} className="stack">
            <div className="callout warn" role="note">
              {t('backups.restore.warn', { when })}
            </div>
            <p className="muted">
              {t('backups.restore.made', {
                when: formatInstant(check.createdAt, zone),
                version: check.appVersion,
                schema: check.schema,
              })}{' '}
              {check.pendingMigrations > 0 ? t('backups.restore.pending', { count: check.pendingMigrations }) : null}
            </p>
            <div>
              <strong>{t('backups.restore.willDo')}</strong>
              <ol className="restore-steps">
                <li>{t('backups.restore.will1')}</li>
                <li>{t('backups.restore.will2')}</li>
                <li>{t('backups.restore.will3')}</li>
                <li>{t('backups.restore.will4')}</li>
              </ol>
            </div>
            <ul className="restore-warnings">
              <li>{t('backups.restore.accountsBack')}</li>
              <li>
                {check.files.included
                  ? t('backups.restore.photosIncluded', {
                      count: check.files.count,
                      size: formatBytes(check.files.bytes),
                    })
                  : t('backups.restore.photosNone')}
              </li>
              {check.newerApp ? <li>{t('backups.restore.newerApp', { version: check.appVersion })}</li> : null}
              {check.ownAccountMissing ? <li className="bad">{t('backups.restore.ownMissing')}</li> : null}
              {check.accounts === 0 ? <li className="bad">{t('backups.restore.noAccounts')}</li> : null}
            </ul>
            <Field
              label={t('backups.restore.password')}
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <Field
              label={t('backups.restore.word')}
              type="text"
              name="word"
              autoComplete="off"
              autoCapitalize="characters"
              value={word}
              onChange={(event) => setWord(event.target.value)}
              error={error ?? undefined}
              required
            />
            <div className="row">
              <button type="submit" className="button danger" disabled={!ready}>
                {busy ? t('backups.restore.going') : t('backups.restore.go')}
              </button>
              <button type="button" className="button" onClick={onClose} disabled={busy}>
                {t('common.cancel')}
              </button>
            </div>
          </form>
        )}
      </div>
    </Dialog>
  );
}
