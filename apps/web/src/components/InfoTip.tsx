// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { TipBubble } from './TipBubble.js';

/**
 * A small "i" button with a tooltip, for explanations that should not sit on the page as text.
 *   - Opens on hover and on keyboard focus; closes when the pointer leaves, on blur and on Escape. A tap (or a click) pins it
 *     open and the next one closes it, which is how it works on a touch screen.
 *   - The text is always in the page, hidden from sight, under `id`: point `aria-describedby` of the control it explains at that id.
 *     The bubble people see is a copy (hidden from screen readers, so nothing is read twice) drawn in a portal on <body>, placed
 *     beside the button, so no card or table can clip it.
 *   - It must be placed OUTSIDE a <label>, or the label's text (and clicks on it) would include the button.
 */
export function InfoTip({ id, label, text }: { id: string; label: string; text: string }) {
  const [button, setButton] = useState<HTMLButtonElement | null>(null);
  const pinned = useRef(false);
  const [open, setOpen] = useState(false);

  const close = useCallback(() => {
    pinned.current = false;
    setOpen(false);
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      close();
    }
  };

  return (
    <span className="infotip" onMouseEnter={() => setOpen(true)} onMouseLeave={() => !pinned.current && setOpen(false)}>
      <button
        ref={setButton}
        type="button"
        className="infotip-button"
        aria-label={label}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={close}
        onKeyDown={onKeyDown}
        onClick={() => {
          if (open && pinned.current) close();
          else {
            pinned.current = true;
            setOpen(true);
          }
        }}
      >
        <span aria-hidden="true">i</span>
      </button>
      {/* What a screen reader reads as the description of the control (see the note above). */}
      <span id={id} className="sr-only">
        {text}
      </span>
      {open ? <TipBubble anchor={button}>{text}</TipBubble> : null}
    </span>
  );
}
