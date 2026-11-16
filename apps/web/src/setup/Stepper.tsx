// SPDX-License-Identifier: AGPL-3.0-or-later
import { SETUP_STEPS } from '@kinship/shared';
import type { MessageKey, SetupStepId } from '@kinship/shared';
import { t } from '../i18n.js';
import { stepNumber } from '../lib/setup-wizard.js';

/**
 * The wizard's progress: an ordered list of the seven steps (the current one has aria-current="step"), drawn as a segmented
 * bar, with the same thing in words underneath ("Step 3 of 7 · You").
 */
export function Stepper({ current }: { current: SetupStepId }) {
  const position = stepNumber(current);
  return (
    <div className="setup-progress">
      <ol className="setup-steps" aria-label={t('setup.progress.label')}>
        {SETUP_STEPS.map((step, index) => (
          <li
            key={step.id}
            className={index + 1 < position ? 'done' : undefined}
            aria-current={step.id === current ? 'step' : undefined}
          >
            <span className="sr-only">{t(`setup.step.${step.id}` as MessageKey)}</span>
          </li>
        ))}
      </ol>
      <p className="muted small">
        {t('setup.progress.text', {
          step: position,
          total: SETUP_STEPS.length,
          name: t(`setup.step.${current}` as MessageKey),
        })}
      </p>
    </div>
  );
}
