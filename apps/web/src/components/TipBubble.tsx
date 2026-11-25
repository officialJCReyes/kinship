// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * The bubble people see next to a control (an info button's text, an icon button's name or why it is unavailable). It is
 * drawn in a portal on <body> so no card or panel can clip it, centred under its anchor (above when there is no room
 * below), and kept on screen. It is hidden from screen readers: the control carries the same text as its name or as a
 * description, so nothing is read twice.
 */
export function TipBubble({ anchor, children }: { anchor: HTMLElement | null; children: ReactNode }) {
  const bubble = useRef<HTMLSpanElement>(null);
  const [place, setPlace] = useState<CSSProperties>({ visibility: 'hidden' });

  const reposition = useCallback(() => {
    if (!anchor || !bubble.current) return;
    const box = anchor.getBoundingClientRect();
    const size = bubble.current.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(
      Math.max(margin, box.left + box.width / 2 - size.width / 2),
      window.innerWidth - size.width - margin,
    );
    const below = box.bottom + 6;
    const top = below + size.height > window.innerHeight - margin ? Math.max(margin, box.top - 6 - size.height) : below;
    setPlace({ top, left, visibility: 'visible' });
  }, [anchor]);

  // Placed before the browser paints, so the bubble never shows at its previous spot.
  useLayoutEffect(() => {
    reposition();
  }, [reposition, children]);

  useEffect(() => {
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [reposition]);

  return createPortal(
    <span ref={bubble} className="infotip-bubble" style={place} aria-hidden="true">
      {children}
    </span>,
    document.body,
  );
}
