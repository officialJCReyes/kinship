// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Admin → Storage & email (ADR 0041). SuperAdmin only (anyone else gets the not-found page; the API refuses them anyway).
// It shows what KinShip read from .env at start: the email provider and sender, PUBLIC_URL, the outbox counts, the last
// failure and the last test, with "Send test to me"; and the Photos and files card. A key or a password is only ever "set".
// Every value from the server is shown as text, never as HTML.
import { SOURCE_URL } from '@kinship/shared';
import type { MailHint, MailStatus, MailTestResult, MessageKey } from '@kinship/shared';
import { en } from '@kinship/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import * as api from '../api.js';
import { FilesCard, useFilesStatus } from '../admin/FilesCard.js';
import { mailKey, TEST_POLL_FOR_MS, useMailStatus } from '../admin/mail.js';
import { useSession } from '../auth.js';
import { ErrorState, Loading } from '../components/States.js';
import { t } from '../i18n.js';
import { formatInstant } from '../lib/backups.js';
import { errorMessage } from '../lib/errors.js';
import { NotFoundPage } from './NotFoundPage.js';

/** The INSTALL.md section on email (the link on "Not set up"). */
export const MAIL_SETUP_URL = `${SOURCE_URL}/blob/main/INSTALL.md#sending-email`;

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const when = (iso: string) => formatInstant(iso, zone());

/** "test email" for a template we have a name for; the template id (a plain lower-case word) otherwise. */
function templateName(id: string): string {
  const key = `mail.template.${id}`;
  return key in en ? t(key as MessageKey) : id;
}

function providerText(status: MailStatus): string {
  if (status.provider === 'resend') return t('mail.provider.resend');
  if (status.provider === 'smtp' && status.smtp) {
    return t('mail.provider.smtp', {
      host: status.smtp.host,
      port: status.smtp.port,
      security: t(`mail.security.${status.smtp.security}`),
    });
  }
  return t('mail.provider.off');
}

/** The cleaned provider error (as plain text) and, when KinShip recognised the cause, one sentence of advice. */
function ProviderError({ error, hint }: { error: string | null; hint: MailHint | null }) {
  return (
    <>
      {error ? <span className="mono small block mail-error">{error}</span> : null}
      {hint ? <span className="muted small block">{t(`mail.hint.${hint}`)}</span> : null}
    </>
  );
}

function TestPill({ test }: { test: MailTestResult }) {
  if (test.status === 'sent') return <span className="pill ok">{t('mail.lastTest.sent')}</span>;
  if (test.status === 'failed' || test.status === 'cancelled') {
    return <span className="pill crit">{t('mail.lastTest.failed')}</span>;
  }
  return <span className="pill gray">{t('mail.lastTest.waiting')}</span>;
}

/** What happened to the test sent from this page, once the status names it. */
function TestOutcome({ status, testId, timedOut }: { status: MailStatus; testId: string; timedOut: boolean }) {
  const test = status.lastTest?.id === testId ? status.lastTest : null;
  if (test?.status === 'sent') {
    return (
      <p className="callout" role="status">
        {t('mail.test.sent')}
      </p>
    );
  }
  if (test && (test.status === 'failed' || test.status === 'cancelled')) {
    return (
      <div className="alert" role="alert">
        <span className="block">{t('mail.test.failed')}</span>
        <ProviderError error={test.error} hint={test.hint} />
      </div>
    );
  }
  const text = timedOut ? t('mail.test.slow') : test?.error ? t('mail.test.retrying') : t('mail.test.checking');
  return (
    <div className="muted" role="status">
      <span className="block">{text}</span>
      {test?.error ? <ProviderError error={test.error} hint={test.hint} /> : null}
    </div>
  );
}

function MailCard({ status, onWaiting }: { status: MailStatus; onWaiting: (waiting: boolean) => void }) {
  const client = useQueryClient();
  const configured = status.provider !== 'off';
  // The test sent from this page, and whether the 30 seconds of asking for its result are over.
  const [testId, setTestId] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const send = useMutation({
    mutationFn: api.sendTestMail,
    onMutate: () => {
      setTestId(null);
      setTimedOut(false);
    },
    onSuccess: async ({ id }) => {
      setTestId(id);
      await client.invalidateQueries({ queryKey: mailKey });
    },
  });
  useEffect(() => {
    if (testId === null) return undefined;
    const timer = window.setTimeout(() => setTimedOut(true), TEST_POLL_FOR_MS);
    return () => window.clearTimeout(timer);
  }, [testId]);
  const finished =
    status.lastTest?.id === testId && ['sent', 'failed', 'cancelled'].includes(status.lastTest?.status ?? '');
  const waiting = testId !== null && !finished && !timedOut;
  useEffect(() => onWaiting(waiting), [waiting, onWaiting]);
  const wait = send.error instanceof api.ApiError ? send.error.retryAfterSeconds : undefined;
  const failure = status.lastFailure;
  return (
    <section className="card stack mail-card" aria-labelledby="mail-title">
      <h2 id="mail-title">{t('mail.title')}</h2>
      <dl className="facts">
        <dt>{t('mail.provider')}</dt>
        <dd>
          {configured ? <span className="pill ok">{providerText(status)}</span> : <span>{providerText(status)}</span>}
          {configured ? null : (
            <>
              <span className="muted small block">{t('mail.offNote')}</span>
              <a className="small" href={MAIL_SETUP_URL} target="_blank" rel="noopener">
                {t('mail.setupLink')}
              </a>
            </>
          )}
        </dd>
        {status.smtp ? (
          <>
            <dt>{t('mail.smtpUser')}</dt>
            <dd className="mono">{status.smtp.user ?? t('mail.smtpUser.none')}</dd>
            <dt>{t('mail.smtpPassword')}</dt>
            <dd>{status.smtp.passwordSet ? t('mail.secret.set') : t('mail.secret.notSet')}</dd>
          </>
        ) : null}
        {status.resend ? (
          <>
            <dt>{t('mail.resendKey')}</dt>
            <dd>{status.resend.keySet ? t('mail.secret.set') : t('mail.secret.notSet')}</dd>
          </>
        ) : null}
        {status.from ? (
          <>
            <dt>{t('mail.from')}</dt>
            <dd className="mono">{status.from}</dd>
          </>
        ) : null}
        <dt>{t('mail.publicUrl')}</dt>
        <dd>
          <span className="mono">{status.publicUrl}</span>
          {status.publicUrlWarning ? (
            <span className="alert small block" role="alert">
              {t(`mail.publicUrl.${status.publicUrlWarning}`)}
            </span>
          ) : null}
        </dd>
        <dt>{t('mail.queued')}</dt>
        <dd>{status.queued}</dd>
        <dt>{t('mail.failedLastWeek')}</dt>
        <dd>{status.failedLastWeek}</dd>
        <dt>{t('mail.lastFailure')}</dt>
        <dd>
          {failure ? (
            <>
              <span className="block">
                {t('mail.lastFailure.when', { time: when(failure.at), template: templateName(failure.template) })}
              </span>
              <ProviderError error={failure.error} hint={failure.hint} />
              <span className="muted small block">
                {failure.final ? t('mail.lastFailure.final') : t('mail.lastFailure.retrying')}
              </span>
            </>
          ) : (
            t('mail.lastFailure.none')
          )}
        </dd>
        <dt>{t('mail.lastTest')}</dt>
        <dd>
          {status.lastTest ? (
            <>
              <span className="block">
                {when(status.lastTest.sentAt ?? status.lastTest.at)} <TestPill test={status.lastTest} />
              </span>
              {status.lastTest.status === 'failed' ? (
                <ProviderError error={status.lastTest.error} hint={status.lastTest.hint} />
              ) : null}
            </>
          ) : (
            t('mail.lastTest.never')
          )}
        </dd>
      </dl>
      <div className="row">
        <button
          type="button"
          className="button primary"
          disabled={!configured || send.isPending || waiting}
          aria-describedby="mail-test-note"
          onClick={() => send.mutate()}
        >
          {send.isPending ? t('mail.test.sending') : t('mail.test.send')}
        </button>
      </div>
      <p id="mail-test-note" className="muted small">
        {configured ? t('mail.test.recipient', { address: status.testRecipient }) : t('mail.test.off')}
      </p>
      {send.isError ? (
        <p className="alert" role="alert">
          {wait !== undefined ? t('mail.test.wait', { seconds: wait }) : errorMessage(send.error)}
        </p>
      ) : null}
      {testId ? <TestOutcome status={status} testId={testId} timedOut={timedOut} /> : null}
    </section>
  );
}

/** The email card asks again every 2 seconds while a test it sent is on its way (about 30 seconds at most). */
function StorageCards() {
  const [polling, setPolling] = useState(false);
  const mail = useMailStatus(true, polling);
  const files = useFilesStatus(true);
  if (mail.isPending) return <Loading />;
  if (mail.isError) return <ErrorState error={mail.error} onRetry={() => void mail.refetch()} />;
  return (
    <div className="storage-columns">
      {files.data ? <FilesCard status={files.data} /> : null}
      <MailCard status={mail.data} onWaiting={setPolling} />
    </div>
  );
}

export function AdminStoragePage() {
  const session = useSession(false);
  if (session.isPending) return <Loading />;
  if (session.data?.user.role !== 'superadmin') return <NotFoundPage />;
  return (
    <div className="stack">
      <div>
        <h1>{t('storage.title')}</h1>
        <p className="muted">{t('storage.intro')}</p>
      </div>
      <StorageCards />
    </div>
  );
}
