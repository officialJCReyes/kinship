// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ReactNode } from 'react';

/**
 * The KinShip sailboat mark alone (no wordmark), for the top of a card on a page whose header already shows the full logo
 * (sign in, invitation and set-password links, the first-run wizard, the maintenance page). The shapes are those of
 * design/brand/svg/kinship-mark-small.svg, the variant drawn for small sizes (no portholes, a larger anchor), with the same
 * --logo-* tokens as the full logo, so it follows light and dark. Decorative: the card's heading says what the page is.
 * The logo itself is not AGPL-licensed (TRADEMARK.md).
 */
export function LogoMark({ size }: { size: number }) {
  return (
    <svg
      className="logo"
      viewBox="20 20 160 172"
      width={(size * 160) / 172}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M100 28 V128" stroke="var(--logo-ink)" strokeWidth="7" strokeLinecap="round" fill="none" />
      <path d="M106 30 C150 52 166 92 150 122 Q140 126 106 124 Z" fill="var(--logo-sail)" />
      <path
        d="M106 108 L138 92 M106 86 L132 70 M106 64 L122 54"
        stroke="var(--logo-detail)"
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M94 56 C70 80 62 104 66 122 L94 122 Z" fill="var(--amber)" />
      <path d="M30 134 H170 Q164 166 124 170 H76 Q36 166 30 134 Z" fill="var(--logo-ink)" />
      <g transform="translate(100 150) scale(1.35) translate(-100 -150)">
        <circle cx="100" cy="141" r="3.5" stroke="var(--logo-detail)" strokeWidth="3" fill="none" />
        <path
          d="M100 145 V161 M94 149 H106 M90 154 Q92 162 100 162 Q108 162 110 154"
          stroke="var(--logo-detail)"
          strokeWidth="3.5"
          strokeLinecap="round"
          fill="none"
        />
      </g>
      <path
        d="M34 186 q16.5 -9 33 0 t33 0 t33 0 t33 0"
        stroke="var(--logo-sail)"
        strokeWidth="6"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The card header shared by the signed-out card pages (sign in, /invite and /reset, the first-run wizard's first step,
 * the maintenance page): the mark, then the page's own heading, both centred. The fields below stay full width and
 * left-aligned. A page that has no heading yet (a link still loading) passes none and still shows the mark.
 */
export function CardHeader({ children }: { children?: ReactNode }) {
  return (
    <div className="card-header">
      <LogoMark size={44} />
      {children}
    </div>
  );
}
