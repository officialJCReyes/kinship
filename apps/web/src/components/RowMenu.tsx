// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n.js';

export interface RowMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  /** When set the item is unavailable: it stays in the menu, is announced as disabled, and shows this reason. */
  disabledReason?: string | undefined;
  danger?: boolean | undefined;
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
}: {
  /** A stable key for the row (the account id): the button's id is rowMenuButtonId(id). */
  id: string;
  /** The accessible name of the button, for example "Actions for Eleanor Brandt". */
  label: string;
  items: RowMenuItem[];
  disabled?: boolean;
}) {
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);
  const open = position !== null;
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const show = () => {
    const box = button.current?.getBoundingClientRect();
    if (!box) return;
    setPosition({ top: box.bottom + 4, right: Math.max(8, window.innerWidth - box.right) });
  };
  const close = (focusButton: boolean) => {
    setPosition(null);
    if (focusButton) button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const away = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) setPosition(null);
    };
    const follow = () => {
      const box = button.current?.getBoundingClientRect();
      if (box) setPosition({ top: box.bottom + 4, right: Math.max(8, window.innerWidth - box.right) });
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
      <button
        ref={button}
        id={rowMenuButtonId(id)}
        type="button"
        className="button small"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        disabled={disabled}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            show();
          }
        }}
      >
        {t('users.menu.label')}
      </button>
      {open
        ? createPortal(
            <div
              ref={panel}
              id={menuId}
              className="menu-panel row-menu-panel card"
              role="menu"
              aria-label={label}
              style={{ top: position.top, right: position.right }}
              onKeyDown={onMenuKey}
            >
              {items.map((item) => {
                const reasonId = `${menuId}-${item.key}`;
                return (
                  <button
                    key={item.key}
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
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
