// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The open and close behaviour of a small popover in the chart's top bar (the view switcher, the chart settings): a trigger
// button, a panel, focus moved into the panel on opening, a press or focus outside closes it, Esc closes it and gives focus back
// to the button, and opening one popover closes the others.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

const OPENED = 'kinship:popover-opened';

export interface PopoverOptions {
  /** The element in the panel that gets focus when it opens. */
  focusOnOpen: (root: HTMLElement) => HTMLElement | null | undefined;
}

export function usePopover({ focusOnOpen }: PopoverOptions) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const pick = useRef(focusOnOpen);
  useEffect(() => {
    pick.current = focusOnOpen;
  });

  useEffect(() => {
    if (!open) return;
    if (root.current) pick.current(root.current)?.focus();
    const away = (event: Event) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    // Another popover opened: this one closes (without taking focus back).
    const other = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== panelId) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('focusin', away);
    document.addEventListener(OPENED, other);
    document.dispatchEvent(new CustomEvent(OPENED, { detail: panelId }));
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('focusin', away);
      document.removeEventListener(OPENED, other);
    };
  }, [open, panelId]);

  const close = useCallback((focusTrigger: boolean) => {
    setOpen(false);
    if (focusTrigger) trigger.current?.focus();
  }, []);
  const toggle = useCallback(() => setOpen((was) => !was), []);
  /** Esc anywhere in the popover closes it and gives focus back to the trigger. */
  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.key === 'Escape' && open) {
        event.preventDefault();
        close(true);
      }
    },
    [open, close],
  );

  return { open, root, trigger, panelId, close, toggle, onKeyDown };
}
