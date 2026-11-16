// SPDX-License-Identifier: AGPL-3.0-or-later
import { MIN_PASSWORD_LENGTH, setupStepOfField } from '@kinship/shared';
import type { SetupStepId } from '@kinship/shared';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router';
import * as api from '../api.js';
import { ApiError } from '../api.js';
import { useSetup } from '../auth.js';
import { t } from '../i18n.js';
import { errorMessage } from '../lib/errors.js';
import { applyColorScheme } from '../lib/theme.js';
import { FIELD_OF, buildSetupRequest, initialWizardState, validateStep, youNamesOf } from '../lib/setup-wizard.js';
import type { WizardState } from '../lib/setup-wizard.js';
import { Stepper } from '../setup/Stepper.js';
import { AccountStep, ReviewStep, TreeStep, YouStep } from '../setup/steps.js';

/** The steps that exist, in order. Partner, Parents and Children join in the next PR; the progress still counts all seven. */
const FLOW: readonly SetupStepId[] = ['account', 'tree', 'you', 'review'];

type Banner = { text: string } | { alreadyDone: true };

/** The message for one field the server named. */
function fieldMessage(error: ApiError): string {
  if (error.code === 'password_too_short') return t('setup.passwordTooShort', { min: MIN_PASSWORD_LENGTH });
  if (error.code === 'invalid_email') return t('setup.invalidEmail');
  if (error.code === 'invalid_setup_token') return t('setup.invalidToken');
  return errorMessage(error);
}

/**
 * First-run setup: seven steps (Account, Tree, You, Partner, Parents, Children, Review). Everything typed stays in this
 * component's state; nothing is created, and nothing is stored in the browser, until "Create my tree" sends one request.
 */
export function SetupPage() {
  const [state, setState] = useState<WizardState>(initialWizardState);
  const [step, setStep] = useState<SetupStepId>('account');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [attempt, setAttempt] = useState(0);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [checkedToken, setCheckedToken] = useState('');
  const [checking, setChecking] = useState(false);
  const setup = useSetup();
  const card = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  // A new step starts at its heading, so a screen reader announces where it is; a failed Next then moves on to the first
  // field with a problem.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    card.current?.querySelector<HTMLElement>('h1')?.focus();
  }, [step]);
  useEffect(() => {
    if (attempt > 0) card.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempt]);

  const set = <K extends keyof WizardState>(key: K, value: WizardState[K]) => {
    // The colors show at once; the account keeps them when it is created.
    if (key === 'colorScheme') applyColorScheme(value as WizardState['colorScheme']);
    setState((previous) => {
      const next = { ...previous, [key]: value };
      if (key === 'treeName') next.treeNameEdited = true;
      if (key === 'youGiven' || key === 'youSurname') {
        // Typing over one of your names keeps both, as they were shown.
        const shown = youNamesOf(previous);
        next.youEdited = true;
        if (key === 'youGiven') next.youSurname = shown.surname;
        else next.youGiven = shown.given;
      }
      return next;
    });
    setErrors((previous) => {
      if (!(FIELD_OF[key] in previous)) return previous;
      const rest = { ...previous };
      delete rest[FIELD_OF[key]];
      return rest;
    });
  };

  const flowIndex = FLOW.indexOf(step);
  const goTo = (target: SetupStepId) => {
    setStep(target);
    setBanner(null);
  };

  /** Puts the server's answer where the person can fix it: the step and the field it names, or a message here. */
  const showServerError = (error: unknown) => {
    if (!(error instanceof ApiError) || error.status === undefined || error.status >= 500) {
      setBanner({ text: t('common.cannotReachApi') });
      return;
    }
    if (error.code === 'already_set_up') {
      setBanner({ alreadyDone: true });
      return;
    }
    if (error.code === 'rate_limited') {
      setBanner({
        text: t('setup.rateLimited', { minutes: Math.max(1, Math.ceil((error.retryAfterSeconds ?? 60) / 60)) }),
      });
      return;
    }
    // The token is wrong, or changed because the api restarted: back to the first step, everything typed kept.
    const field = error.code === 'invalid_setup_token' ? 'token' : error.field;
    const target = field ? setupStepOfField(field) : null;
    if (field && target) {
      if (field === 'token') setCheckedToken('');
      setErrors({ [field]: fieldMessage(error) });
      setBanner(null);
      setStep(target);
      setAttempt((count) => count + 1);
      return;
    }
    setBanner({ text: t('setup.failed', { reason: errorMessage(error) }) });
  };

  const onNext = async (event: FormEvent) => {
    event.preventDefault();
    const problems = validateStep(step, state);
    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      setAttempt((count) => count + 1);
      return;
    }
    setErrors({});
    if (step === 'account' && checkedToken !== state.token.trim()) {
      setChecking(true);
      setBanner(null);
      try {
        await api.checkSetupToken(state.token.trim());
        setCheckedToken(state.token.trim());
      } catch (error) {
        showServerError(error);
        return;
      } finally {
        setChecking(false);
      }
    }
    goTo(FLOW[flowIndex + 1] ?? 'review');
  };

  const onCreate = (event: FormEvent) => {
    event.preventDefault();
    setBanner(null);
    setup.mutate(buildSetupRequest(state), { onError: showServerError });
  };

  const isReview = step === 'review';
  const creating = setup.isPending;
  return (
    <section className="card setup-card" ref={card} aria-label={t('setup.title')}>
      <Stepper current={step} />
      <form className="setup-form" onSubmit={isReview ? onCreate : onNext} noValidate>
        {step === 'account' ? <AccountStep state={state} errors={errors} set={set} /> : null}
        {step === 'tree' ? <TreeStep state={state} errors={errors} set={set} /> : null}
        {step === 'you' ? <YouStep state={state} errors={errors} set={set} /> : null}
        {isReview ? <ReviewStep state={state} onChange={goTo} /> : null}
        {banner ? (
          <div className="alert" role="alert">
            {'alreadyDone' in banner ? (
              <>
                {t('setup.alreadyDone')} <Link to="/login">{t('setup.goToLogin')}</Link>
              </>
            ) : (
              banner.text
            )}
          </div>
        ) : null}
        <div className="setup-nav">
          {flowIndex > 0 ? (
            <button
              type="button"
              className="button"
              onClick={() => goTo(FLOW[flowIndex - 1] ?? 'account')}
              disabled={creating}
            >
              {t('common.back')}
            </button>
          ) : (
            <span />
          )}
          <button className="button primary" type="submit" disabled={creating || checking}>
            {isReview
              ? creating
                ? t('setup.creating')
                : t('setup.create')
              : checking
                ? t('setup.checking')
                : t('setup.next')}
          </button>
        </div>
      </form>
    </section>
  );
}
