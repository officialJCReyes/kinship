// SPDX-License-Identifier: AGPL-3.0-or-later
import type { AuthUser } from '@kinship/shared';
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { useLogout } from '../auth.js';
import { Avatar } from './Avatar.js';
import { t } from '../i18n.js';
import { usePersonDetail } from '../people/queries.js';
import { isAdmin } from '../people/permissions.js';

function initialsOf(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => Array.from(word)[0] ?? '');
  return (letters.length > 1 ? [letters[0], letters.at(-1)] : letters.slice(0, 1)).join('').toUpperCase();
}

/**
 * The account menu: My profile (only when the account is linked to a person), My settings, Admin (admins only), About KinShip and Sign out.
 * A button that opens a menu; arrow keys move, Home and End jump, Escape closes and gives the focus back, Tab and a click
 * outside close it.
 */
export function AccountMenu({ user }: { user: AuthUser }) {
  // The menu is open on one page; a change of page closes it by itself (it was opened on another one).
  const location = useLocation();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === location.pathname;
  const setOpen = (next: boolean) => setOpenOn(next ? location.pathname : null);
  const logout = useLogout();
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  // The picture on the button is the profile photo of the person this account is linked to, when there is one.
  const person = usePersonDetail(user.personId ?? undefined, { quiet: true });

  // A click or tap outside closes it.
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(event.target as Node)) setOpenOn(null);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  // Opening moves the focus to the first item.
  useEffect(() => {
    if (open) wrap.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  const items = () => [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  const onMenuKey = (event: KeyboardEvent) => {
    const list = items();
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
      setOpen(false);
      button.current?.focus();
    } else if (event.key === 'Tab') setOpen(false);
  };

  return (
    <div className="account-menu" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="account-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t('account.menu')}
        title={user.email}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Avatar
          photoMediaId={person.data?.person.photoMediaId ?? null}
          initials={initialsOf(user.displayName)}
          size="sm"
          className="ava-pill"
        />
        <span className="account-name">{user.displayName}</span>
      </button>
      {open ? (
        <div id={menuId} className="menu-panel card" role="menu" aria-label={t('account.menu')} onKeyDown={onMenuKey}>
          <div className="menu-head">
            <b>{user.displayName}</b>
            <div className="muted">{user.email}</div>
          </div>
          {user.personId ? (
            <Link role="menuitem" className="menu-item" to={`/people/${user.personId}`}>
              {t('account.menu.profile')}
            </Link>
          ) : null}
          <Link role="menuitem" className="menu-item" to="/settings">
            {t('account.menu.settings')}
          </Link>
          {isAdmin(user) ? (
            <Link role="menuitem" className="menu-item" to="/admin">
              {t('account.menu.admin')}
            </Link>
          ) : null}
          <Link role="menuitem" className="menu-item" to="/about">
            {t('account.menu.about')}
          </Link>
          <hr />
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          >
            {logout.isPending ? t('account.signingOut') : t('account.signOut')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
