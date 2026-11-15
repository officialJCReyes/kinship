// SPDX-License-Identifier: AGPL-3.0-or-later
import { SOURCE_URL } from '@kinship/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, fetchVersion } from '../api.js';
import { useLogin } from '../auth.js';
import { Field } from '../components/Field.js';
import { t } from '../i18n.js';

function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'invalid_credentials') return t('login.invalidCredentials');
    if (error.code === 'rate_limited') {
      return t('login.rateLimited', { minutes: Math.max(1, Math.ceil((error.retryAfterSeconds ?? 60) / 60)) });
    }
    if (error.status === undefined || error.status >= 500) return t('common.cannotReachApi');
  } else {
    return t('common.cannotReachApi');
  }
  return t('common.unexpectedError');
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useLogin();
  const version = useQuery({ queryKey: ['api', 'version'], queryFn: ({ signal }) => fetchVersion(signal) });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    login.mutate({ email, password });
  };

  return (
    <section className="card narrow">
      <h1>{t('login.title')}</h1>
      <p className="muted">{t('login.subtitle')}</p>
      <form onSubmit={onSubmit} noValidate>
        <Field
          label={t('login.email')}
          type="email"
          name="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <Field
          label={t('login.password')}
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        {login.isError ? (
          <div className="alert" role="alert">
            {loginErrorMessage(login.error)}
          </div>
        ) : null}
        <button className="button primary" type="submit" disabled={login.isPending}>
          {login.isPending ? t('login.submitting') : t('login.submit')}
        </button>
      </form>
      <p className="muted small">{t('login.forgot')}</p>
      <p className="muted small login-footer">
        {t('login.footer', { version: version.data?.version ?? __WEB_VERSION__ })} ·{' '}
        <a href={SOURCE_URL} target="_blank" rel="noopener">
          {t('about.sourceCode')}
        </a>
      </p>
    </section>
  );
}
