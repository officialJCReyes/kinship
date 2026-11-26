// SPDX-License-Identifier: AGPL-3.0-or-later
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode, Ref } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n.js';

export interface RowMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  /** When set the item is unavailable: it stays in the menu, is announced as disabled, and shows this reason. */
  disabledReason?: string | undefined;
  danger?: boolean | undefined;
  /** Draws a separator line above the item (for example before a destructive group). */
  divider?: boolean | undefined;
}

/**
 * What a custom trigger must put on its button (a menu button that is not the row's "Actions" text button, such as the camera on
 * an avatar): the ref, the id, the ARIA state and the handlers. `label` is the accessible name.
 */
export interface RowMenuTriggerProps {
  ref: Ref<HTMLButtonElement>;
  id: string;
  label: string;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
  disabled: boolean | undefined;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

/** Where the panel goes: under its button, right edges lined up, unless that would push it off the left of the window. */
type Placement = { top: number; right: number } | { top: number; left: number };

function place(box: DOMRect, width: number | null): Placement {
  const top = box.bottom + 4;
  if (width !== null && box.right - width < 8) return { top, left: Math.max(8, box.left) };
  return { top, right: Math.max(8, window.innerWidth - box.right) };
}

/** The id of a row menu's button, so a page can put focus back on it after a dialog closes. */
export const rowMenuButtonId = (key: string) => `row-menu-${key}`;

/**
 * A menu button for the actions of one table row (WAI-ARIA menu button). Enter, Space or the Down arrow opens it and focus
 * goes to the first item; arrows, Home and End move; Enter or Space chooses; Escape closes and gives focus back to the
 * button; Tab and a click outside close it. An unavailable item stays focusable, says it is disabled (`aria-disabled`) and
 * shows its reason as text, so nobody has to guess why. The panel is drawn on the page body so a scrolling table cannot
 * clip it, and it follows its button when the page scrolls or is resized (scrolling that a click itself causes, to bring the
 * button into view, can arrive just after the menu opens, so scrolling must not close it).
 */
export function RowMenu({
  id,
  label,
  items,
  disabled,
  trigger,
  onOpen,
}: {
  /** A stable key for the row (the account id): the button's id is rowMenuButtonId(id). */
  id: string;
  /** The accessible name of the button, for example "Actions for Eleanor Brandt". */
  label: string;
  items: RowMenuItem[];
  disabled?: boolean;
  /** Draws the button instead of the "Actions" text button (it must spread the props it is given onto a <button>). */
  trigger?: (props: RowMenuTriggerProps) => ReactNode;
  /** Called each time the menu opens (to start loading what an item needs). */
  onOpen?: () => void;
}) {
  const [position, setPosition] = useState<Placement | null>(null);
  const open = position !== null;
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const show = () => {
    const box = button.current?.getBoundingClientRect();
    if (!box) return;
    onOpen?.();
    setPosition(place(box, null));
  };
  const close = (focusButton: boolean) => {
    setPosition(null);
    if (focusButton) button.current?.focus();
  };

  // Once the panel is drawn its width is known: a button near the left edge (an avatar's camera) opens it to the right instead.
  useLayoutEffect(() => {
    if (!open) return;
    const box = button.current?.getBoundingClientRect();
    const width = panel.current?.offsetWidth ?? null;
    if (box && width !== null && 'right' in position && box.right - width < 8) setPosition(place(box, width));
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const away = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) setPosition(null);
    };
    const follow = () => {
      const box = button.current?.getBoundingClientRect();
      if (box) setPosition(place(box, panel.current?.offsetWidth ?? null));
    };
    document.addEventListener('mousedown', away);
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => {
      document.removeEventListener('mousedown', away);
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
    };
  }, [open]);

  const entries = () => [...(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  const onMenuKey = (event: KeyboardEvent) => {
    const list = entries();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const go = (next: number) => {
      event.preventDefault();
      list[(next + list.length) % list.length]?.focus();
    };
    if (event.key === 'ArrowDown') go(index + 1);
    else if (event.key === 'ArrowUp') go(index - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(list.length - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') close(false);
  };

  return (
    <>
      {(trigger ?? TextTrigger)({
        ref: button,
        id: rowMenuButtonId(id),
        label,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': open ? menuId : undefined,
        disabled,
        onClick: () => (open ? close(false) : show()),
        onKeyDown: (event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            show();
          }
        },
      })}
      {open
        ? createPortal(
            <div
              ref={panel}
              id={menuId}
              className="menu-panel row-menu-panel card"
              role="menu"
              aria-label={label}
              style={position}
              onKeyDown={onMenuKey}
            >
              {items.map((item) => {
                const reasonId = `${menuId}-${item.key}`;
                return (
                  <Fragment key={item.key}>
                    {item.divider ? <hr /> : null}
                    <button
                      type="button"
                      role="menuitem"
                      className={`menu-item${item.danger ? ' danger-text' : ''}${item.disabledReason ? ' unavailable' : ''}`}
                      aria-disabled={item.disabledReason ? true : undefined}
                      aria-describedby={item.disabledReason ? reasonId : undefined}
                      onClick={() => {
                        if (item.disabledReason) return;
                        close(false);
                        item.onSelect();
                      }}
                    >
                      {item.label}
                      {item.disabledReason ? (
                        <span id={reasonId} className="menu-reason muted small-text">
                          {item.disabledReason}
                        </span>
                      ) : null}
                    </button>
                  </Fragment>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** The default trigger: the small "Actions" text button of a table row. */
function TextTrigger({ label, ...button }: RowMenuTriggerProps) {
  return (
    <button type="button" className="button small" aria-label={label} {...button}>
      {t('users.menu.label')}
    </button>
  );
}
