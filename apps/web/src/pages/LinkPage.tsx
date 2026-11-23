// SPDX-License-Identifier: AGPL-3.0-or-later
import { MIN_PASSWORD_LENGTH, NAME_MAX_LENGTH } from '@kinship/shared';
import type { LinkLookup, MessageKey } from '@kinship/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import * as api from '../api.js';
import { ApiError } from '../api.js';
import { meKey } from '../auth.js';
import { Field } from '../components/Field.js';
import { CardMark } from '../components/LogoMark.js';
import { Loading } from '../components/States.js';
import { t } from '../i18n.js';
import { errorMessage } from '../lib/errors.js';
import { forgetFragmentToken, takeFragmentToken } from '../lib/fragment-token.js';

/** A failed call: the API's reason when it gave one, and "cannot reach the server" when there was no answer at all. */
const problem = (error: unknown): string =>
  error instanceof ApiError ? errorMessage(error) : t('common.cannotReachApi');

/** The one screen for any link that does not work: unknown, expired, used, revoked or missing look the same. */
function InvalidLink() {
  return (
    <section className="card narrow">
      <CardMark />
      <h1>{t('linkPage.invalidTitle')}</h1>
      <p>{t('linkPage.invalidBody')}</p>
      <p>
        <Link to="/login">{t('linkPage.toSignIn')}</Link>
      </p>
    </section>
  );
}

/**
 * /invite and /reset: both open the same page, which shows what the link is (the server says which) and takes a password.
 * Works with nobody signed in. On success the new session is the browser's session and the home page opens.
 */
export function LinkPage() {
  // Read once, at once: this also removes the token from the address bar.
  const [token] = useState(() => takeFragmentToken());
  const navigate = useNavigate();
  const client = useQueryClient();
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [name, setName] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [dead, setDead] = useState(token === '');

  const lookup = useQuery({
    // A constant key: the token is only closed over, so it is in no cache key. The answer is dropped when the page goes.
    queryKey: ['link', 'lookup'],
    queryFn: ({ signal }) => api.lookupLink(token, signal),
    enabled: token !== '' && !dead,
    retry: false,
    gcTime: 0,
    staleTime: Infinity,
  });

  if (dead || (lookup.error instanceof ApiError && lookup.error.code === 'invalid_link')) return <InvalidLink />;
  if (lookup.isPending) {
    return (
      <section className="card narrow">
        <CardMark />
        <Loading />
      </section>
    );
  }
  if (lookup.isError) {
    return (
      <section className="card narrow">
        <CardMark />
        <div className="alert" role="alert">
          {problem(lookup.error)}
        </div>
        <button className="button" type="button" onClick={() => void lookup.refetch()}>
          {t('common.retry')}
        </button>
      </section>
    );
  }

  const link: LinkLookup = lookup.data;
  const askName = link.kind === 'invite' && link.person === null;
  const tooShort = password.length < MIN_PASSWORD_LENGTH;
  const mismatch = password !== again;
  const nameMissing = askName && name.trim() === '';

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    setFailure(null);
    if (tooShort || mismatch || nameMissing) return;
    setBusy(true);
    try {
      const me = await api.acceptLink({ token, password, ...(askName ? { displayName: name.trim() } : {}) });
      forgetFragmentToken();
      client.removeQueries({ queryKey: ['link'] });
      client.setQueryData(meKey, me);
      void navigate('/', { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'invalid_link') {
        forgetFragmentToken();
        client.removeQueries({ queryKey: ['link'] });
        setDead(true);
        return;
      }
      setFailure(error);
      setBusy(false);
    }
  };

  return (
    <section className="card narrow">
      <CardMark />
      {link.kind === 'invite' ? (
        <>
          <h1>
            {link.treeName ? t('linkPage.inviteTitle', { tree: link.treeName }) : t('linkPage.inviteTitleNoTree')}
          </h1>
          {link.invitedBy ? <p>{t('linkPage.invitedBy', { name: link.invitedBy })}</p> : null}
          <p>
            {t('linkPage.role', { role: t(`role.${link.role}` as MessageKey) })}{' '}
            {link.person ? t('linkPage.personLinked', { name: link.person.name }) : t('linkPage.personNone')}
          </p>
          <p className="muted">{t('linkPage.email', { email: link.email })}</p>
          {link.note ? (
            <blockquote className="note">
              <div className="muted small-text">{t('linkPage.note')}</div>
              {link.note}
            </blockquote>
          ) : null}
        </>
      ) : (
        <>
          <h1>{t('linkPage.resetTitle')}</h1>
          <p>{t('linkPage.resetBody', { name: link.displayName })}</p>
        </>
      )}
      <form onSubmit={(event) => void onSubmit(event)} noValidate>
        {askName ? (
          <Field
            label={t('linkPage.name')}
            name="name"
            autoComplete="name"
            maxLength={NAME_MAX_LENGTH}
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={submitted && nameMissing ? t('linkPage.nameMissing') : undefined}
          />
        ) : null}
        <Field
          label={t('linkPage.password')}
          type="password"
          name="new-password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          help={t('linkPage.passwordHelp', { min: MIN_PASSWORD_LENGTH })}
          error={submitted && tooShort ? t('linkPage.passwordHelp', { min: MIN_PASSWORD_LENGTH }) : undefined}
        />
        <Field
          label={t('linkPage.confirm')}
          type="password"
          name="confirm-password"
          autoComplete="new-password"
          value={again}
          onChange={(event) => setAgain(event.target.value)}
          error={submitted && mismatch ? t('linkPage.mismatch') : undefined}
        />
        {failure ? (
          <div className="alert" role="alert">
            {problem(failure)}
          </div>
        ) : null}
        <button className="button primary" type="submit" disabled={busy}>
          {busy
            ? t('linkPage.saving')
            : link.kind === 'invite'
              ? t('linkPage.acceptInvite')
              : t('linkPage.acceptReset')}
        </button>
      </form>
    </section>
  );
}
