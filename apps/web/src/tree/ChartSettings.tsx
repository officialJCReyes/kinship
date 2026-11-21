// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The chart's settings: a gear button in the top bar that opens a small panel of display settings kept on the account (ADR 0027).
// Four disclosure groups (Cards, Names, Relatives, Navigation) and a Restore defaults link. Every change is one request, shown
// at once and undone with a message if it fails. The Names group is the same setting as My settings, Names. The chart is not
// remounted by a change, so the panel, the focus and the view stay where they are.
import { CHART_SETTING_DEFAULTS, NAME_FORMS, TREE_WHEELS } from '@kinship/shared';
import type { AuthUser, MessageKey, UserSettings } from '@kinship/shared';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { t } from '../i18n.js';

import { useUpdateSettings } from '../lib/settings.js';
import { errorMessage } from '../lib/errors.js';
import { usePopover } from './usePopover.js';

type GroupName = 'cards' | 'names' | 'relatives' | 'navigation';

/** Relatives and Navigation start open, Cards and Names collapsed. Nothing is remembered between visits. */
const START_OPEN: Record<GroupName, boolean> = { cards: false, names: false, relatives: true, navigation: true };

const GEAR = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </svg>
);

function Switch({
  label,
  checked,
  onChange,
  help,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  help?: string;
}) {
  const id = useId();
  const helpId = useId();
  return (
    <div className="option">
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        aria-describedby={help ? helpId : undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <label htmlFor={id}>{label}</label>
        {help ? (
          <span id={helpId} className="muted field-help">
            {help}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function Radios<V extends string>({
  legend,
  name,
  value,
  values,
  labelOf,
  onChange,
  hint,
}: {
  legend: string;
  name: string;
  value: V;
  values: readonly V[];
  labelOf: (value: V) => string;
  onChange: (value: V) => void;
  hint?: ReactNode;
}) {
  return (
    <fieldset className="option-group">
      <legend>{legend}</legend>
      {values.map((v) => (
        <label key={v} className="option">
          <input type="radio" name={name} value={v} checked={v === value} onChange={() => onChange(v)} />
          <span>{labelOf(v)}</span>
        </label>
      ))}
      {hint}
    </fieldset>
  );
}

export function ChartSettings({ user }: { user: AuthUser }) {
  const { open, root, trigger, panelId, toggle, onKeyDown } = usePopover({
    focusOnOpen: (el) => el.querySelector<HTMLElement>('[data-group-toggle]'),
  });
  const save = useUpdateSettings();
  const [groups, setGroups] = useState(START_OPEN);
  const [status, setStatus] = useState<'saved' | 'restored' | null>(null);

  const change = (patch: Partial<UserSettings>, done: 'saved' | 'restored' = 'saved') => {
    setStatus(null);
    save.mutate(patch, { onSuccess: () => setStatus(done) });
  };

  const group = (name: GroupName, body: ReactNode) => {
    const bodyId = `${panelId}-${name}`;
    return (
      <section className="settings-group" key={name}>
        <h3>
          <button
            type="button"
            className="settings-group-toggle"
            data-group-toggle={name}
            aria-expanded={groups[name]}
            aria-controls={bodyId}
            onClick={() => setGroups((was) => ({ ...was, [name]: !was[name] }))}
          >
            <span aria-hidden="true">{groups[name] ? '▾' : '▸'}</span> {t(`tree.settings.group.${name}` as MessageKey)}
          </button>
        </h3>
        {groups[name] ? (
          <div className="settings-group-body" id={bodyId}>
            {body}
          </div>
        ) : null}
      </section>
    );
  };

  return (
    <div className="chart-settings" ref={root} onKeyDown={onKeyDown} data-nopan>
      <button
        ref={trigger}
        className="button view-trigger"
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={t('tree.settings.open')}
        title={t('tree.settings.open')}
        onClick={toggle}
      >
        {GEAR}
      </button>
      {open ? (
        <div className="settings-panel" id={panelId} role="group" aria-label={t('tree.settings.open')}>
          <div className="sr-only" role="status" aria-live="polite">
            {status === 'restored' ? t('tree.settings.restored') : status === 'saved' ? t('settings.saved') : ''}
          </div>
          {save.isError ? (
            <div className="alert" role="alert">
              {t('settings.saveFailed')} {errorMessage(save.error)}
            </div>
          ) : null}
          {group(
            'cards',
            <Switch
              label={t('tree.settings.showDeceasedMark')}
              checked={user.showDeceasedMark}
              onChange={(value) => change({ showDeceasedMark: value })}
            />,
          )}
          {group(
            'names',
            <>
              <Radios
                legend={t('settings.nameForm')}
                name={`${panelId}-name-form`}
                value={user.nameForm}
                values={NAME_FORMS}
                labelOf={(form) => t(`settings.nameForm.${form}` as MessageKey)}
                onChange={(nameForm) => change({ nameForm })}
              />
              <Switch
                label={t('settings.showPrefix')}
                checked={user.showPrefix}
                onChange={(value) => change({ showPrefix: value })}
              />
              <Switch
                label={t('settings.showSuffix')}
                checked={user.showSuffix}
                onChange={(value) => change({ showSuffix: value })}
              />
            </>,
          )}
          {group(
            'relatives',
            <Switch
              label={t('tree.settings.showExtended')}
              help={t('tree.settings.showExtendedHelp')}
              checked={user.showExtendedRelatives}
              onChange={(value) => change({ showExtendedRelatives: value })}
            />,
          )}
          {group(
            'navigation',
            <Radios
              legend={t('tree.settings.wheel')}
              name={`${panelId}-wheel`}
              value={user.treeWheel}
              values={TREE_WHEELS}
              labelOf={(wheel) => t(`tree.settings.wheel.${wheel}` as MessageKey)}
              onChange={(treeWheel) => change({ treeWheel })}
              hint={
                user.treeWheel === 'scroll' ? (
                  <p className="muted field-help" id={`${panelId}-wheel-hint`}>
                    {t('tree.settings.wheelHint')}
                  </p>
                ) : null
              }
            />,
          )}
          <div className="settings-footer">
            <button
              type="button"
              className="link-button"
              onClick={() => change({ ...CHART_SETTING_DEFAULTS }, 'restored')}
            >
              {t('tree.settings.restore')}
            </button>
            <p className="muted field-help">{t('tree.settings.namesNote')}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
