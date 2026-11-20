// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The chart's view switcher: one icon button that shows the current view. It opens a panel of icons only (the names are
// in tooltips and accessible labels): the views, then the number of generations for the views that have the choice.
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { t } from '../i18n.js';
import { generationOptions } from './treeView.js';
import type { TreeViewName } from './treeView.js';

const SVG = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const ICONS: Record<TreeViewName | 'generations', ReactNode> = {
  family: (
    <svg {...SVG}>
      <rect x="8.5" y="2.5" width="7" height="5" rx="1" />
      <path d="M12 7.5V11M5.5 14V11H18.5V14" />
      <rect x="2.5" y="14" width="6" height="5" rx="1" />
      <rect x="15.5" y="14" width="6" height="5" rx="1" />
    </svg>
  ),
  pedigree: (
    <svg {...SVG}>
      <rect x="2.5" y="9.5" width="5" height="5" rx="1" />
      <path d="M7.5 12H10M10 6.5V17.5M10 6.5H13M10 17.5H13" />
      <rect x="13" y="4" width="4.5" height="5" rx="1" />
      <rect x="13" y="15" width="4.5" height="5" rx="1" />
      <path d="M17.5 6.5H21M17.5 17.5H21" />
    </svg>
  ),
  fan: (
    <svg {...SVG}>
      <path d="M3 19A9 9 0 0 1 21 19Z" />
      <path d="M12 19L12 10M12 19L6.2 12.2M12 19L17.8 12.2" />
    </svg>
  ),
  descendants: (
    <svg {...SVG}>
      <rect x="2.5" y="9.5" width="5" height="5" rx="1" />
      <path d="M7.5 12H10M10 5V19M10 5H14M10 12H14M10 19H14" />
      <rect x="14" y="3" width="4" height="4" rx="1" />
      <rect x="14" y="10" width="4" height="4" rx="1" />
      <rect x="14" y="17" width="4" height="4" rx="1" />
    </svg>
  ),
  generations: (
    <svg {...SVG} width={18} height={18}>
      <path d="M4 6h16M7 12h10M10 18h4" />
    </svg>
  ),
};

export interface ViewSwitcherProps {
  view: TreeViewName;
  gen: number;
  /** The views on offer, in order. */
  views: readonly TreeViewName[];
  onView: (view: TreeViewName) => void;
  onGen: (gen: number) => void;
}

export function ViewSwitcher({ view, gen, views, onView, onGen }: ViewSwitcherProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const name = t(`tree.view.${view}`);
  const options = generationOptions(view);

  // Opening puts focus on the current view; a press or focus outside closes the panel.
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[data-view][aria-pressed="true"]')?.focus();
    const away = (event: Event) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('focusin', away);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('focusin', away);
    };
  }, [open]);

  const close = (focusTrigger: boolean) => {
    setOpen(false);
    if (focusTrigger) trigger.current?.focus();
  };

  // One tab stop in each group (the pressed button); the arrow keys move inside the group.
  const onGroupKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    }
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    event.preventDefault();
    const last = buttons.length - 1;
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? last
          : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
            ? (at + last) % (last + 1)
            : (at + 1) % (last + 1);
    buttons[next]?.focus();
  };

  return (
    <div
      className="view-switcher"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          close(true);
        }
      }}
    >
      <button
        ref={trigger}
        className="button view-trigger"
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={t('tree.view.current', { name })}
        title={t('tree.view.current', { name })}
        onClick={() => setOpen((was) => !was)}
      >
        {ICONS[view]}
      </button>
      {open ? (
        <div className="view-panel" id={panelId}>
          <div className="view-group" role="group" aria-label={t('tree.view.group')} onKeyDown={onGroupKey}>
            {views.map((v) => (
              <button
                key={v}
                className="button"
                type="button"
                data-view={v}
                tabIndex={v === view ? 0 : -1}
                aria-pressed={v === view}
                aria-label={t(`tree.view.${v}`)}
                title={t(`tree.view.${v}`)}
                onClick={() => {
                  onView(v);
                  close(true);
                }}
              >
                {ICONS[v]}
              </button>
            ))}
          </div>
          {options.length > 0 ? (
            <>
              <span className="view-generations-icon" aria-hidden="true" title={t('tree.view.generations')}>
                {ICONS.generations}
              </span>
              <div className="view-group" role="group" aria-label={t('tree.view.generations')} onKeyDown={onGroupKey}>
                {options.map((n) => (
                  <button
                    key={n}
                    className="button num"
                    type="button"
                    data-gen={n}
                    tabIndex={n === gen ? 0 : -1}
                    aria-pressed={n === gen}
                    aria-label={t('tree.view.generationsN', { n })}
                    title={t('tree.view.generationsN', { n })}
                    onClick={() => onGen(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
