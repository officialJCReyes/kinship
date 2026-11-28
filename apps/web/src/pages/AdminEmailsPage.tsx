// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Admin → Emails (ADR 0041, 53b). SuperAdmin only (anyone else gets the not-found page; the API refuses them anyway).
//
//   * The list of templates on the left; the reserved ones (step 57) show "Next" and cannot be opened.
//   * The editor: every field a plain textarea, with the placeholders it may use (a click puts one at the cursor) and the
//     live errors the preview answer carries. Save, Reset to default (with a confirm) and Send test to me.
//   * The preview: the draft rendered by the API with the Hale sample, in an <iframe srcdoc sandbox=""> (no script, no
//     same-origin access, no navigation), or as the plain-text part; at desktop width or a phone's 360 px.
// The email text is the API's (the defaults and the family's changes); only the UI around it is translated. Text from the
// server is only ever shown as text, or inside the sandboxed frame.
import type {
  MailPreview,
  MailTemplateDetail,
  MailTemplateField,
  MailTemplateId,
  MailTemplateProblem,
  MailTemplateSummary,
} from '@kinship/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import * as api from '../api.js';
import {
  fieldLabel,
  fieldNote,
  isTemplateId,
  PREVIEW_DELAY_MS,
  problemsOf,
  problemText,
  sameText,
  savedText,
  templateAbout,
  templateKey,
  templateName,
  templatesKey,
  useMailTemplate,
  useMailTemplates,
  usePreview,
  useSettled,
} from '../admin/emails.js';
import { useMailStatus } from '../admin/mail.js';
import { useSession } from '../auth.js';
import { Dialog } from '../components/Dialog.js';
import { ErrorState, Loading } from '../components/States.js';
import { t } from '../i18n.js';
import { errorMessage } from '../lib/errors.js';
import { NotFoundPage } from './NotFoundPage.js';

function TemplateList({ items, current }: { items: MailTemplateSummary[]; current: MailTemplateId }) {
  return (
    <section className="card email-list" aria-labelledby="email-list-title">
      <div className="email-list-head">
        <h2 id="email-list-title">{t('emails.list.title')}</h2>
        <p className="muted small">{t('emails.list.note')}</p>
      </div>
      <ul>
        {items.map((item) => {
          const pill = item.reserved ? (
            <span className="pill gray">{t('emails.pill.next')}</span>
          ) : !item.editable ? (
            <span className="pill gray">{t('emails.pill.fixed')}</span>
          ) : item.overridden ? (
            <span className="pill ok">{t('emails.pill.changed')}</span>
          ) : null;
          const text = (
            <span className="email-list-text">
              <span className="email-list-name">{templateName(item.id)}</span>
              <span className="muted small">{templateAbout(item.id)}</span>
            </span>
          );
          return (
            <li key={item.id}>
              {item.reserved ? (
                // Not built yet: plain text, so it cannot be opened (the API answers 404 for it anyway).
                <div className="email-list-item reserved">
                  {text}
                  {pill}
                </div>
              ) : (
                <Link
                  className="email-list-item"
                  to={`/admin/emails/${item.id}`}
                  aria-current={item.id === current ? 'page' : undefined}
                >
                  {text}
                  {pill}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Toggle<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V;
  options: [V, string][];
  onChange: (value: V) => void;
}) {
  return (
    <div className="email-toggle" role="group" aria-label={label}>
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          className="button small"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function PreviewCard({ preview, stale, pending }: { preview: MailPreview | null; stale: boolean; pending: boolean }) {
  const [format, setFormat] = useState<'html' | 'text'>('html');
  const [width, setWidth] = useState<'desktop' | 'phone'>('desktop');
  return (
    <section className="card stack email-preview" aria-labelledby="email-preview-title">
      <div className="row between">
        <h2 id="email-preview-title">{t('emails.preview.title')}</h2>
        <div className="row">
          <Toggle
            label={t('emails.preview.width')}
            value={width}
            options={[
              ['desktop', t('emails.preview.desktop')],
              ['phone', t('emails.preview.phone')],
            ]}
            onChange={setWidth}
          />
          <Toggle
            label={t('emails.preview.format')}
            value={format}
            options={[
              ['html', t('emails.preview.html')],
              ['text', t('emails.preview.text')],
            ]}
            onChange={setFormat}
          />
        </div>
      </div>
      <p className="muted small">{t('emails.preview.note')}</p>
      {stale ? (
        <p className="muted small" role="status">
          {t('emails.preview.stale')}
        </p>
      ) : null}
      {preview === null ? (
        pending ? (
          <p className="muted">{t('emails.preview.loading')}</p>
        ) : null
      ) : (
        <>
          <dl className="facts">
            <dt>{t('emails.preview.subject')}</dt>
            <dd className="email-subject">{preview.subject}</dd>
          </dl>
          <div className={`email-frame ${width}`}>
            {format === 'html' ? (
              // sandbox="" : no script, no forms, no same-origin access, no navigation. The email's HTML can do nothing here.
              <iframe title={t('emails.preview.frame')} sandbox="" srcDoc={preview.html} />
            ) : (
              <pre className="email-text">{preview.text}</pre>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function FieldEditor({
  field,
  value,
  problems,
  onChange,
}: {
  field: MailTemplateField;
  value: string;
  problems: MailTemplateProblem[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const label = fieldLabel(field.key);
  const note = fieldNote(field.key);
  const kind =
    field.kind === 'subject' || field.kind === 'preview'
      ? t(`emails.kind.${field.kind}`, { max: field.maxLength })
      : t(`emails.kind.${field.kind}`);
  const insert = (placeholder: string) => {
    const element = box.current;
    const token = `{${placeholder}}`;
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + token + value.slice(end));
    // Back into the box, with the cursor after what was put in.
    window.requestAnimationFrame(() => {
      if (!element) return;
      element.focus();
      element.setSelectionRange(start + token.length, start + token.length);
    });
  };
  const oneLine = field.kind === 'subject' || field.kind === 'preview' || field.kind === 'heading';
  return (
    <div className="field email-field">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        ref={box}
        name={field.key}
        rows={oneLine ? 2 : 5}
        value={value}
        required={field.required}
        aria-invalid={problems.length > 0 ? true : undefined}
        aria-describedby={`${id}-help${problems.length > 0 ? ` ${id}-error` : ''}`}
        onChange={(event) => onChange(event.target.value)}
      />
      <div id={`${id}-help`} className="muted field-help">
        <span className="block">{kind}</span>
        {note ? <span className="block">{note}</span> : null}
      </div>
      {field.placeholders.length > 0 ? (
        <div className="email-placeholders" role="group" aria-label={t('emails.placeholders', { field: label })}>
          {field.placeholders.map((name) => (
            <button
              key={name}
              type="button"
              className="button small mono"
              aria-label={t('emails.insert', { placeholder: `{${name}}`, field: label })}
              onClick={() => insert(name)}
            >
              {`{${name}}`}
            </button>
          ))}
        </div>
      ) : null}
      {problems.length > 0 ? (
        <div id={`${id}-error`} className="field-error">
          {problems.map((problem, index) => (
            <span key={index} className="block">
              {problemText(problem)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ResetDialog({
  name,
  busy,
  onConfirm,
  onClose,
}: {
  name: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog title={t('emails.reset.title', { template: name })} onClose={onClose}>
      <div className="stack">
        <p>{t('emails.reset.body')}</p>
        <div className="row">
          <button type="button" className="button danger" disabled={busy} onClick={onConfirm}>
            {t('emails.reset.confirm')}
          </button>
          <button type="button" className="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/** "Send test to me": the saved text, to the SuperAdmin's own address; off with a reason when email is not set up. */
function TestButton({ id, unsaved }: { id: MailTemplateId; unsaved: boolean }) {
  const mail = useMailStatus(true, false);
  const send = useMutation({ mutationFn: () => api.sendTemplateTest(id) });
  const configured = mail.data !== undefined && mail.data.provider !== 'off';
  const wait = send.error instanceof api.ApiError ? send.error.retryAfterSeconds : undefined;
  const note = mail.data
    ? configured
      ? t('mail.test.recipient', { address: mail.data.testRecipient })
      : t('mail.test.off')
    : null;
  return (
    <div className="stack email-test">
      <div className="row">
        <button
          type="button"
          className="button"
          disabled={!configured || send.isPending}
          aria-describedby="email-test-note"
          onClick={() => send.mutate()}
        >
          {send.isPending ? t('mail.test.sending') : t('mail.test.send')}
        </button>
      </div>
      <p id="email-test-note" className="muted small">
        {note ? <span className="block">{note}</span> : null}
        {configured && unsaved ? <span className="block">{t('emails.test.unsaved')}</span> : null}
      </p>
      {send.isSuccess ? (
        <p className="callout" role="status">
          {t('emails.test.queued')}
        </p>
      ) : null}
      {send.isError ? (
        <p className="alert" role="alert">
          {wait !== undefined ? t('mail.test.wait', { seconds: wait }) : errorMessage(send.error)}
        </p>
      ) : null}
    </div>
  );
}

function Editor({ detail }: { detail: MailTemplateDetail }) {
  const client = useQueryClient();
  const saved = useMemo(() => savedText(detail), [detail]);
  const [draft, setDraft] = useState<Record<string, string>>(saved);
  const [banner, setBanner] = useState<'saved' | 'reset' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const unsaved = !sameText(draft, saved);

  // The live preview, and with it the live errors: asked for once the typing has paused.
  const settled = useSettled(draft, PREVIEW_DELAY_MS);
  const preview = usePreview(detail.id, settled);
  const result = preview.data;
  // The last preview that rendered stays on screen while the draft has mistakes (state updated during render, not in an effect).
  const [shown, setShown] = useState<MailPreview | null>(null);
  if (result && 'preview' in result && result.preview !== shown) setShown(result.preview);
  const previewProblems = result && 'problems' in result ? result.problems : [];

  const after = (next: MailTemplateDetail, done: 'saved' | 'reset') => {
    client.setQueryData(templateKey(next.id), next);
    void client.invalidateQueries({ queryKey: templatesKey, exact: true });
    setDraft(savedText(next));
    setBanner(done);
  };
  const save = useMutation({
    mutationFn: () => api.saveMailTemplate(detail.id, draft),
    onMutate: () => setBanner(null),
    onSuccess: (next) => after(next, 'saved'),
  });
  const reset = useMutation({
    mutationFn: () => api.resetMailTemplate(detail.id),
    onMutate: () => setBanner(null),
    onSuccess: (next) => {
      setConfirming(false);
      after(next, 'reset');
    },
  });
  const change = (key: string, value: string) => {
    setBanner(null);
    save.reset();
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const status = unsaved
    ? t('emails.status.unsaved')
    : Object.keys(detail.overrides).length > 0
      ? t('emails.status.changed')
      : t('emails.status.default');
  const saveProblems = problemsOf(save.error);
  const problems = previewProblems.length > 0 ? previewProblems : (saveProblems ?? []);

  return (
    <>
      <section className="card stack email-editor" aria-labelledby="email-editor-title">
        <div>
          <h2 id="email-editor-title">{templateName(detail.id)}</h2>
          <p className="muted small">{templateAbout(detail.id)}</p>
        </div>
        {detail.editable ? (
          <>
            <div className="muted small">
              <span className="block">{t('emails.help.placeholders')}</span>
              <span className="block">{t('emails.help.braces')}</span>
              <span className="block">{t('emails.help.links')}</span>
            </div>
            <p className="email-status" role="status">
              {status}
            </p>
            {detail.fields.map((field) => (
              <FieldEditor
                key={field.key}
                field={field}
                value={draft[field.key] ?? ''}
                problems={problems.filter((problem) => problem.field === field.key)}
                onChange={(value) => change(field.key, value)}
              />
            ))}
            {banner === 'saved' ? (
              <p className="callout" role="status">
                {t('emails.saved')}
              </p>
            ) : null}
            {banner === 'reset' ? (
              <p className="callout" role="status">
                {t('emails.resetDone')}
              </p>
            ) : null}
            {save.isError ? (
              <p className="alert" role="alert">
                {saveProblems ? t('emails.saveFailed') : errorMessage(save.error)}
              </p>
            ) : null}
            {reset.isError ? (
              <p className="alert" role="alert">
                {errorMessage(reset.error)}
              </p>
            ) : null}
            <div className="row">
              <button
                type="button"
                className="button primary"
                disabled={!unsaved || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? t('emails.saving') : t('emails.save')}
              </button>
              <button
                type="button"
                className="button"
                disabled={(Object.keys(detail.overrides).length === 0 && !unsaved) || reset.isPending}
                onClick={() => setConfirming(true)}
              >
                {t('emails.reset')}
              </button>
            </div>
          </>
        ) : (
          <p className="callout">{t('emails.fixed')}</p>
        )}
        <TestButton id={detail.id} unsaved={unsaved} />
      </section>
      {preview.isError ? (
        <ErrorState error={preview.error} onRetry={() => void preview.refetch()} />
      ) : (
        <PreviewCard preview={shown} stale={problems.length > 0 && shown !== null} pending={preview.isPending} />
      )}
      {confirming ? (
        <ResetDialog
          name={templateName(detail.id)}
          busy={reset.isPending}
          onConfirm={() => reset.mutate()}
          onClose={() => setConfirming(false)}
        />
      ) : null}
    </>
  );
}

function TemplatePane({ id }: { id: MailTemplateId }) {
  const detail = useMailTemplate(id);
  if (detail.isPending) return <Loading />;
  if (detail.isError) return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  // A new editor (and a new draft) for each template; a draft is not carried from one template to another.
  return <Editor key={id} detail={detail.data} />;
}

function EmailsBody({ id }: { id: MailTemplateId }) {
  const list = useMailTemplates();
  if (list.isPending) return <Loading />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  return (
    <div className="email-columns">
      <TemplateList items={list.data} current={id} />
      <div className="stack email-main">
        <TemplatePane id={id} />
      </div>
    </div>
  );
}

export function AdminEmailsPage() {
  const session = useSession(false);
  const { id } = useParams();
  if (session.isPending) return <Loading />;
  if (session.data?.user.role !== 'superadmin') return <NotFoundPage />;
  if (id === undefined) return <Navigate to="/admin/emails/invitation" replace />;
  // A reserved ("Next") template or an unknown name has nothing to open.
  if (!isTemplateId(id)) return <NotFoundPage />;
  return (
    <div className="stack">
      <div>
        <h1>{t('emails.title')}</h1>
        <p className="muted">{t('emails.intro')}</p>
      </div>
      <EmailsBody id={id} />
    </div>
  );
}
