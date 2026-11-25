// SPDX-License-Identifier: AGPL-3.0-or-later
import { useId, useState } from 'react';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, KeyboardEvent, ReactNode } from 'react';
import { Link } from 'react-router';
import { TipBubble } from './TipBubble.js';

/**
 * Round icon-only actions (the person panel's row). The name is the `aria-label`; a bubble shows it on hover and on
 * keyboard focus. Like ActionButton, an unavailable action uses `aria-disabled` (it stays focusable and does nothing),
 * and its reason is page text linked by `aria-describedby` and shown in the bubble, so it never lives only in a hover
 * tooltip. A tap on an unavailable action shows the bubble too (a touch screen has no hover).
 */

function useTip<T extends HTMLElement>(): {
  /** A callback ref: the element is kept in state so the bubble can be placed next to it. */
  ref: (element: T | null) => void;
  anchor: T | null;
  open: boolean;
  handlers: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onFocus: () => void;
    onBlur: () => void;
    onKeyDown: (event: KeyboardEvent) => void;
  };
  show: () => void;
} {
  const [anchor, ref] = useState<T | null>(null);
  const [open, setOpen] = useState(false);
  return {
    ref,
    anchor,
    open,
    show: () => setOpen(true),
    handlers: {
      onMouseEnter: () => setOpen(true),
      onMouseLeave: () => setOpen(false),
      onFocus: () => setOpen(true),
      onBlur: () => setOpen(false),
      onKeyDown: (event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
        }
      },
    },
  };
}

function Bubble({ anchor, label, reason }: { anchor: HTMLElement | null; label: string; reason?: string }) {
  return (
    <TipBubble anchor={anchor}>
      {label}
      {reason ? <span className="tip-reason">{reason}</span> : null}
    </TipBubble>
  );
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'aria-label' | 'children'> {
  /** The accessible name, also shown in the bubble. */
  label: string;
  icon: ReactNode;
  /** When set, the action is unavailable and this says why (read as the description, shown in the bubble). */
  disabledReason?: string | undefined;
  danger?: boolean;
}

export function IconButton({ label, icon, disabledReason, danger, className, onClick, ...rest }: IconButtonProps) {
  const { ref, anchor, open, handlers, show } = useTip<HTMLButtonElement>();
  const reasonId = useId();
  const classes = ['button', 'icon-button', 'round', danger ? 'danger' : '', className ?? ''].filter(Boolean).join(' ');
  const unavailable = Boolean(disabledReason);
  return (
    <>
      <button
        {...rest}
        {...handlers}
        ref={ref}
        type="button"
        aria-label={label}
        className={unavailable ? `${classes} is-disabled` : classes}
        {...(unavailable ? { 'aria-disabled': true, 'aria-describedby': reasonId } : {})}
        onClick={(event) => {
          if (unavailable) {
            event.preventDefault();
            show();
            return;
          }
          onClick?.(event);
        }}
      >
        {icon}
      </button>
      {unavailable ? (
        <span id={reasonId} className="sr-only">
          {disabledReason}
        </span>
      ) : null}
      {open ? <Bubble anchor={anchor} label={label} {...(disabledReason ? { reason: disabledReason } : {})} /> : null}
    </>
  );
}

interface IconLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'aria-label' | 'children' | 'href'> {
  label: string;
  icon: ReactNode;
  /** An address inside the app (a router link). */
  to?: string;
  /** An address outside the app (a plain link). */
  href?: string;
}

/** The same round icon, as a link: `to` for a page of the app, `href` for anywhere else. */
export function IconLink({ label, icon, to, href, className, ...rest }: IconLinkProps) {
  const { ref, anchor, open, handlers } = useTip<HTMLAnchorElement>();
  const classes = ['button', 'icon-button', 'round', className ?? ''].filter(Boolean).join(' ');
  const shared = { ...rest, ...handlers, ref, 'aria-label': label, className: classes };
  return (
    <>
      {to !== undefined ? (
        <Link {...shared} to={to}>
          {icon}
        </Link>
      ) : (
        <a {...shared} href={href}>
          {icon}
        </a>
      )}
      {open ? <Bubble anchor={anchor} label={label} /> : null}
    </>
  );
}
