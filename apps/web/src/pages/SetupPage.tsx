// SPDX-License-Identifier: AGPL-3.0-or-later
import { MIN_PASSWORD_LENGTH } from '@kinship/shared';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../api.js';
import { useSetup } from '../auth.js';
import { Field } from '../components/Field.js';
import { t } from '../i18n.js';

function serverMessage(error: unknown): string {
  if (!(error instanceof ApiError) || error.status === undefined || error.status >= 500)
    return t('common.cannotReachApi');
  switch (error.code) {
    case 'invalid_setup_token':
      return t('setup.invalidToken');
    case 'already_set_up':
      return t('setup.alreadyDone');
    case 'invalid_email':
      return t('setup.invalidEmail');
    case 'password_too_short':
      return t('setup.passwordTooShort', { min: MIN_PASSWORD_LENGTH });
    case 'rate_limited':
      return t('setup.rateLimited', { minutes: Math.max(1, Math.ceil((error.retryAfterSeconds ?? 60) / 60)) });
    default:
      return t('common.unexpectedError');
  }
}

export function SetupPage() {
  const [token, setToken] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [treeName, setTreeName] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const setup = useSetup();

  // Checked in the browser for a quick answer; the server checks everything again.
  const passwordError =
    password.length < MIN_PASSWORD_LENGTH ? t('setup.passwordTooShort', { min: MIN_PASSWORD_LENGTH }) : undefined;
  const confirmError = confirm !== password ? t('setup.passwordMismatch') : undefined;
  const emailError = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? undefined : t('setup.invalidEmail');
  const hasProblem = Boolean(passwordError ?? confirmError ?? emailError);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (hasProblem) return;
    setup.mutate({ token: token.trim(), displayName, email, password, treeName });
  };

  return (
    <section className="card narrow">
      <h1>{t('setup.title')}</h1>
      <p className="muted">{t('setup.intro')}</p>
      <form onSubmit={onSubmit} noValidate>
        <Field
          label={t('setup.tokenLabel')}
          name="token"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          help={t('setup.tokenHelp')}
          required
        />
        <Field
          label={t('setup.displayName')}
          name="displayName"
          autoComplete="name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          required
        />
        <Field
          label={t('setup.email')}
          type="email"
          name="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={submitted ? emailError : undefined}
          required
        />
        <Field
          label={t('setup.password')}
          type="password"
          name="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          help={t('setup.passwordHelp', { min: MIN_PASSWORD_LENGTH })}
          error={submitted ? passwordError : undefined}
          required
        />
        <Field
          label={t('setup.confirmPassword')}
          type="password"
          name="confirmPassword"
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          error={submitted ? confirmError : undefined}
          required
        />
        <Field
          label={t('setup.treeName')}
          name="treeName"
          value={treeName}
          onChange={(event) => setTreeName(event.target.value)}
          help={t('setup.treeNameHelp')}
          required
        />
        {setup.isError ? (
          <div className="alert" role="alert">
            {serverMessage(setup.error)}
            {setup.error instanceof ApiError && setup.error.code === 'already_set_up' ? (
              <>
                {' '}
                <Link to="/login">{t('setup.goToLogin')}</Link>
              </>
            ) : null}
          </div>
        ) : null}
        <button className="button primary" type="submit" disabled={setup.isPending}>
          {setup.isPending ? t('setup.submitting') : t('setup.submit')}
        </button>
      </form>
      <p className="muted small">{t('setup.neverAgain')}</p>
    </section>
  );
}
